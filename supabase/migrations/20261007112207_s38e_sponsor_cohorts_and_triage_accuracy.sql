-- S38e: sponsor cohorts with consent and an aggregate-only sponsor report (Module 22.6, 22.9; OQ-254), and the triage agreement field with its
-- accuracy report (Module 22.4; OQ-255). Builds on S38 (outcome_config, v_bp_cohort_90d, outcome_cohort_json), S02 (consent_type 'sponsor_reporting',
-- patient_consents), S16/S17 (clinical_tasks, task_claims), S12 (triage_events) and the I9 institutions rule (organisations.min_cohort_size).
--
-- Counted first (live, 2026-10-07): 0 cohort codes, 0 profile cohorts, 0 sponsor_reporting consent versions, 0 triage events, 0 clinical tasks.
-- Nothing to convert.
--
-- SPONSORS. A sponsor is an existing organisation of type hmo, corporate or ngo. A cohort (spec cohort_codes) is a code the sponsor hands to the people it
-- covers; a person who enters it joins the cohort (spec profile_cohorts). Joining shares NOTHING. Group figures reach a sponsor report only for a member who
-- ALSO ticked "share group figures with this programme", recorded in patient_consents (type sponsor_reporting) and withdrawable at any time, which also
-- happens on leaving. The consent text is a legal text that counsel must approve: it is seeded as a DRAFT with is_current = false, and nobody can consent
-- (so no sponsor figure exists) until a current version exists. The report is aggregate only: no individual, no list, no name; the smallest group shown is
-- the larger of the platform minimum (outcome_config min_cell) and the sponsor's own min_cohort_size; small cells are withheld whole (no subtraction);
-- test accounts never count (INV-13). It carries blood pressure control, adherence and engagement only, kept apart, never reproductive, pregnancy or
-- mental health data. Admin or the active CMO only; every run and every export is written to the audit log.
--
-- TRIAGE AGREEMENT. When a clinician completes a task that came from an automatic triage grade, they may record whether the grade was right, should have
-- been higher or should have been lower. That is the only ground truth the platform can hold for the symptom checker, so the accuracy report measures
-- agreement with the automatic grade, not diagnostic accuracy, and says so. The capture is OFF (platform switch triage_agreement_capture) until the CMO
-- approves it, never blocks completing a task, and shows no patient identity. Reviews are append-only.

-- Known limit (OQ-254): two reports run on different days can show the effect of one member's consent changing. That is inherent to a live aggregate;
-- the report says so and the sponsor figure should be shared once for a period.
--
-- 1. Sponsor cohorts -------------------------------------------------------------------------------------------------------------------
create table public.sponsor_cohorts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  sponsor_org_id  uuid not null references public.organisations (id) on delete restrict,
  name            text not null check (char_length(btrim(name)) between 3 and 80),
  code            text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  valid_from      date not null,
  valid_to        date not null,
  max_uses        integer not null check (max_uses between 1 and 100000),
  uses            integer not null default 0 check (uses >= 0),
  status          text not null default 'active' check (status in ('active', 'closed')),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  is_test         boolean not null default false,
  check (valid_to >= valid_from),
  check (uses <= max_uses)
);
alter table public.sponsor_cohorts enable row level security;
revoke all on public.sponsor_cohorts from public, anon, authenticated;

create table public.profile_cohorts (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  cohort_id          uuid not null references public.sponsor_cohorts (id) on delete restrict,
  joined_at          timestamptz not null default now(),
  left_at            timestamptz,
  reporting_consent  boolean not null default false,
  consented_at       timestamptz,
  consent_version_id uuid references public.consent_versions (id) on delete restrict,
  is_test            boolean not null default false,
  check (not reporting_consent or (consented_at is not null and consent_version_id is not null))
);
create unique index profile_cohorts_one_active on public.profile_cohorts (patient_id, cohort_id) where left_at is null;
create index profile_cohorts_cohort_idx on public.profile_cohorts (cohort_id) where left_at is null;
alter table public.profile_cohorts enable row level security;
revoke all on public.profile_cohorts from public, anon, authenticated;
grant select on public.profile_cohorts to authenticated;
create policy profile_cohorts_own on public.profile_cohorts for select to authenticated using (patient_id = (select auth.uid()));

-- failed tries to enter a code, so guessing is slow (10 an hour per person)
create table public.cohort_join_attempts (
  id              bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  at              timestamptz not null default now()
);
create index cohort_join_attempts_idx on public.cohort_join_attempts (patient_id, at desc);
alter table public.cohort_join_attempts enable row level security;
revoke all on public.cohort_join_attempts from public, anon, authenticated;

-- A DRAFT consent text for counsel to approve. is_current = false means nobody can accept it yet.
insert into public.consent_versions (consent_type, version, title, body, is_current, is_optional)
values ('sponsor_reporting', '2026-10-07-draft', 'Share group figures with a programme',
  'DRAFT for counsel review. Not in force until approved and made current. I agree that the programme I joined may see figures about the whole group of members who agreed, such as the share whose blood pressure is under control. The figures never show my name, my readings or anything that identifies me, and a figure is never shown for a small group. I can stop sharing at any time in the app and my information will no longer be counted from then on. Choosing not to share changes nothing about my care.',
  false, true);

create function private.new_cohort_code() returns text
language sql volatile set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b.bytes, i) % 32) + 1, 1), '')
    from (select extensions.gen_random_bytes(8) as bytes) b, generate_series(0, 7) i
$$;
revoke all on function private.new_cohort_code() from public, anon, authenticated;

-- 2. Admin: create, list, close ----------------------------------------------------------------------------------------------------
create function public.admin_create_sponsor_cohort(p_sponsor_org uuid, p_name text, p_valid_from date, p_valid_to date, p_max_uses integer) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_code text; v_id uuid; v_try integer := 0; v_type text;
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  select type::text into v_type from public.organisations where id = p_sponsor_org;
  if v_type is null or v_type not in ('hmo', 'corporate', 'ngo') then raise exception 'sponsor_org_invalid' using errcode = '22023'; end if;
  if p_valid_from is null or p_valid_to is null or p_valid_to < p_valid_from or p_valid_to > p_valid_from + 1100 or p_max_uses is null or p_max_uses < 1 or p_max_uses > 100000
     or char_length(btrim(coalesce(p_name, ''))) not between 3 and 80 then
    raise exception 'sponsor_cohort_invalid' using errcode = '22023';
  end if;
  loop
    v_try := v_try + 1;
    v_code := private.new_cohort_code();
    begin
      insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, created_by)
      values (private.current_org_id(), p_sponsor_org, btrim(p_name), v_code, p_valid_from, p_valid_to, p_max_uses, (select auth.uid())) returning id into v_id;
      exit;
    exception when unique_violation then
      if v_try >= 5 then raise; end if;
    end;
  end loop;
  perform private.log_audit('sponsor.cohort_created', 'sponsor_cohort', v_id, jsonb_build_object('sponsor_org', p_sponsor_org, 'max_uses', p_max_uses));
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;
revoke all on function public.admin_create_sponsor_cohort(uuid, text, date, date, integer) from public, anon;
grant execute on function public.admin_create_sponsor_cohort(uuid, text, date, date, integer) to authenticated;

create function public.admin_list_sponsor_cohorts() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'code', c.code, 'sponsor', o.name, 'valid_from', c.valid_from, 'valid_to', c.valid_to,
                    'max_uses', c.max_uses, 'uses', c.uses, 'status', c.status) order by c.created_at desc)
                     from public.sponsor_cohorts c join public.organisations o on o.id = c.sponsor_org_id where not c.is_test), '[]'::jsonb);
end $$;
revoke all on function public.admin_list_sponsor_cohorts() from public, anon;
grant execute on function public.admin_list_sponsor_cohorts() to authenticated;

create function public.admin_close_sponsor_cohort(p_cohort uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  update public.sponsor_cohorts set status = 'closed' where id = p_cohort and status = 'active';
  if not found then return false; end if;
  perform private.log_audit('sponsor.cohort_closed', 'sponsor_cohort', p_cohort, '{}'::jsonb);
  return true;
end $$;
revoke all on function public.admin_close_sponsor_cohort(uuid) from public, anon;
grant execute on function public.admin_close_sponsor_cohort(uuid) to authenticated;

-- 3. Patient: join, see, consent, leave ----------------------------------------------------------------------------------------------
-- Every failure returns the same {ok:false}: an unknown, expired, closed or full code cannot be told apart.
create function public.join_cohort(p_code text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); p public.profiles%rowtype; c public.sponsor_cohorts%rowtype;
  v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_today date := (now() at time zone 'Africa/Lagos')::date; v_existing uuid; v_prior boolean;
begin
  if v_uid is null then raise exception 'cohort_not_authorised' using errcode = '42501'; end if;
  select * into p from public.profiles where id = v_uid and role = 'patient' and is_active and not coalesce(is_dependent_account, false);
  if not found then return jsonb_build_object('ok', false); end if;
  if (select count(*) from public.cohort_join_attempts where patient_id = v_uid and at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false);
  end if;
  select * into c from public.sponsor_cohorts
   where code = v_norm and organisation_id = p.organisation_id and status = 'active' and v_today between valid_from and valid_to for update;
  -- someone who was in this programme before may return without using another place (and even when it is full)
  v_prior := found and exists (select 1 from public.profile_cohorts where patient_id = v_uid and cohort_id = c.id);
  if not found or (c.uses >= c.max_uses and not v_prior) then
    delete from public.cohort_join_attempts where patient_id = v_uid and at < now() - interval '1 day';   -- the table never grows past a day of tries
    insert into public.cohort_join_attempts (organisation_id, patient_id) values (p.organisation_id, v_uid);
    return jsonb_build_object('ok', false);
  end if;
  select id into v_existing from public.profile_cohorts where patient_id = v_uid and cohort_id = c.id and left_at is null;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'status', 'already', 'cohort_id', c.id);
  end if;
  begin
    insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test) values (p.organisation_id, v_uid, c.id, coalesce(p.is_test, false));
  exception when unique_violation then
    -- two taps at once: the other one got there first
    return jsonb_build_object('ok', true, 'status', 'already', 'cohort_id', c.id);
  end;
  if not v_prior then update public.sponsor_cohorts set uses = uses + 1 where id = c.id; end if;
  perform private.log_audit('sponsor.cohort_joined', 'sponsor_cohort', c.id, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', 'joined', 'cohort_id', c.id, 'sponsor', (select name from public.organisations where id = c.sponsor_org_id), 'name', c.name);
end $$;
revoke all on function public.join_cohort(text) from public, anon;
grant execute on function public.join_cohort(text) to authenticated;

create function public.my_cohorts() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('cohort_id', c.id, 'name', c.name, 'sponsor', o.name, 'joined_at', pc.joined_at,
           'reporting_consent', (pc.reporting_consent and exists (select 1 from public.consent_versions v where v.id = pc.consent_version_id and v.is_current)),
           'consent_available', exists (select 1 from public.consent_versions v where v.consent_type = 'sponsor_reporting' and v.is_current)) order by pc.joined_at desc), '[]'::jsonb)
    from public.profile_cohorts pc join public.sponsor_cohorts c on c.id = pc.cohort_id join public.organisations o on o.id = c.sponsor_org_id
   where pc.patient_id = (select auth.uid()) and pc.left_at is null
$$;
revoke all on function public.my_cohorts() from public, anon;
grant execute on function public.my_cohorts() to authenticated;

-- true when the person's latest sponsor_reporting row is an acceptance
create function private.sponsor_consent_in_force(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select action = 'accepted' from public.patient_consents where patient_id = p_patient and consent_type = 'sponsor_reporting'
                    order by created_at desc, id desc limit 1), false)
$$;
revoke all on function private.sponsor_consent_in_force(uuid) from public, anon, authenticated;

create function private.withdraw_sponsor_consent_if_unused(p_patient uuid, p_org uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v record;
begin
  if exists (select 1 from public.profile_cohorts where patient_id = p_patient and left_at is null and reporting_consent) then return; end if;
  if not private.sponsor_consent_in_force(p_patient) then return; end if;
  select id, version into v from public.consent_versions where consent_type = 'sponsor_reporting' order by published_at desc limit 1;
  -- the trigger replaces version and version id with the acceptance in force; these are only placeholders for the not-null columns
  -- created_at is the real clock, not now(): two changes inside one transaction must still have an order ("latest wins" reads created_at)
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at)
  values (p_org, p_patient, 'sponsor_reporting', v.id, v.version, 'withdrawn', clock_timestamp());
end $$;
revoke all on function private.withdraw_sponsor_consent_if_unused(uuid, uuid) from public, anon, authenticated;

create function public.set_cohort_reporting_consent(p_cohort uuid, p_granted boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.profile_cohorts%rowtype; v record;
begin
  if v_uid is null then raise exception 'cohort_not_authorised' using errcode = '42501'; end if;
  if p_granted is null then raise exception 'cohort_consent_invalid' using errcode = '22023'; end if;
  select * into m from public.profile_cohorts where patient_id = v_uid and cohort_id = p_cohort and left_at is null for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if p_granted then
    select id, version into v from public.consent_versions where consent_type = 'sponsor_reporting' and is_current limit 1;
    if not found then return jsonb_build_object('ok', false, 'reason', 'not_available'); end if;
    -- already agreed to the text in force: nothing changes, so the original date and the audit trail stay as they were
    if m.reporting_consent and m.consent_version_id = v.id then return jsonb_build_object('ok', true, 'reporting_consent', true); end if;
    update public.profile_cohorts set reporting_consent = true, consented_at = now(), consent_version_id = v.id where id = m.id;
    if not private.sponsor_consent_in_force(v_uid) then
      insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at)
      values (m.organisation_id, v_uid, 'sponsor_reporting', v.id, v.version, 'accepted', clock_timestamp());
    end if;
    perform private.log_audit('sponsor.consent_given', 'sponsor_cohort', p_cohort, '{}'::jsonb);
  else
    if not m.reporting_consent then return jsonb_build_object('ok', true, 'reporting_consent', false); end if;   -- nothing to withdraw, nothing to log
    update public.profile_cohorts set reporting_consent = false where id = m.id;
    perform private.withdraw_sponsor_consent_if_unused(v_uid, m.organisation_id);
    perform private.log_audit('sponsor.consent_withdrawn', 'sponsor_cohort', p_cohort, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'reporting_consent', p_granted);
end $$;
revoke all on function public.set_cohort_reporting_consent(uuid, boolean) from public, anon;
grant execute on function public.set_cohort_reporting_consent(uuid, boolean) to authenticated;

create function public.leave_cohort(p_cohort uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.profile_cohorts%rowtype;
begin
  if v_uid is null then raise exception 'cohort_not_authorised' using errcode = '42501'; end if;
  select * into m from public.profile_cohorts where patient_id = v_uid and cohort_id = p_cohort and left_at is null for update;
  if not found then return jsonb_build_object('ok', false); end if;
  update public.profile_cohorts set left_at = now(), reporting_consent = false where id = m.id;
  perform private.withdraw_sponsor_consent_if_unused(v_uid, m.organisation_id);
  perform private.log_audit('sponsor.cohort_left', 'sponsor_cohort', p_cohort, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.leave_cohort(uuid) from public, anon;
grant execute on function public.leave_cohort(uuid) to authenticated;

-- 4. The sponsor report (aggregate only) ---------------------------------------------------------------------------------------------
create function private.sponsor_report_aggregate(p_cohort uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.sponsor_cohorts%rowtype; v_min integer; a record; v_joined integer; v_agreed integer; v_eng integer; v_sponsor text;
  v_cov jsonb; v_eng_json jsonb;
begin
  select * into c from public.sponsor_cohorts where id = p_cohort;
  if not found then raise exception 'sponsor_cohort_not_found' using errcode = '22023'; end if;
  select name, greatest((private.outcome_rule('min_cell') #>> '{}')::integer, min_cohort_size) into v_sponsor, v_min from public.organisations where id = c.sponsor_org_id;
  -- whole calendar months of joining, so two ranges a day apart cannot be subtracted
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;

  drop table if exists pg_temp._s38e_members;
  create temp table _s38e_members on commit drop as
    select pc.patient_id,
           (pc.reporting_consent and exists (select 1 from public.consent_versions v where v.id = pc.consent_version_id and v.is_current)) as agreed
      from public.profile_cohorts pc join public.profiles p on p.id = pc.patient_id
     where pc.cohort_id = p_cohort and pc.left_at is null and not pc.is_test and not coalesce(p.is_test, false) and p.is_active;
  select count(*), count(*) filter (where agreed and private.sponsor_consent_in_force(patient_id)) into v_joined, v_agreed from _s38e_members;

  drop table if exists pg_temp._s38e_cohort;
  create temp table _s38e_cohort on commit drop as
    select k.* from private.v_bp_cohort_90d k
     where k.patient_id in (select patient_id from _s38e_members where agreed and private.sponsor_consent_in_force(patient_id))
       and (p_from is null or k.anchor >= p_from) and (p_to is null or k.anchor <= p_to);
  select count(*) as n, count(*) filter (where s90 = 'controlled') ctrl, count(*) filter (where s90 = 'uncontrolled') unc, count(*) filter (where s90 = 'insufficient_data') ins,
         count(*) filter (where d_sys is not null) n_both, avg(d_sys) filter (where d_sys is not null) mean_d_sys, avg(d_dia) filter (where d_dia is not null) mean_d_dia,
         count(*) filter (where adh is not null) n_adh, avg(adh) filter (where adh is not null) mean_adh
    into a from _s38e_cohort;

  select count(*) into v_eng from _s38e_members m
   where m.agreed and private.sponsor_consent_in_force(m.patient_id)
     and exists (select 1 from public.vitals_readings v where v.patient_id = m.patient_id and v.vital_type = 'blood_pressure' and v.taken_at > now() - interval '30 days');

  -- how many agreed: shown only when both numbers are large enough and the people who did not agree are not a small group either
  v_cov := case when v_joined >= v_min and v_agreed >= v_min and ((v_joined - v_agreed) = 0 or (v_joined - v_agreed) >= v_min)
                then jsonb_build_object('suppressed', false, 'joined', v_joined, 'agreed_to_share', v_agreed, 'agreed_pct', round(100.0 * v_agreed / v_joined, 1))
                else jsonb_build_object('suppressed', true, 'reason', 'small_cell', 'minimum', v_min) end;
  v_eng_json := case when v_agreed >= v_min then jsonb_build_object('suppressed', false, 'n', v_agreed, 'logged_a_reading_in_30_days_pct', round(100.0 * v_eng / v_agreed, 1))
                     else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end;

  return jsonb_build_object(
    'cohort', jsonb_build_object('name', c.name, 'sponsor', v_sponsor, 'valid_from', c.valid_from, 'valid_to', c.valid_to),
    'minimum_cell', v_min,
    'members', v_cov,
    'bp_control_90d', private.outcome_cohort_json(case when v_agreed >= v_min then a.n::integer else 0 end, a.ctrl::integer, a.unc::integer, a.ins::integer, v_min),
    'change_among_measured', case when v_agreed >= v_min and a.n_both >= v_min then jsonb_build_object('suppressed', false, 'n', a.n_both, 'mean_systolic_change', round(a.mean_d_sys, 1), 'mean_diastolic_change', round(a.mean_d_dia, 1))
                                  else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'adherence_separate', case when v_agreed >= v_min and a.n_adh >= v_min then jsonb_build_object('suppressed', false, 'n', a.n_adh, 'mean_pct', round(a.mean_adh, 1))
                               else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'engagement_separate', v_eng_json,
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'definition', (select numerator_definition || ' Denominator: ' || denominator_definition from public.outcome_measure_specs where code = 'bp_control_90d' and spec_version = (select max(spec_version) from public.outcome_measure_specs where code = 'bp_control_90d')),
    'limitations', 'Only members who joined with this programme code and agreed to share group figures are counted; members who did not agree are in no figure. A figure for a small group is never shown, and if a group is too small to show, the figures that could reveal it are withheld too. Blood pressure control, medicine adherence and engagement are separate measures and are never combined. This describes the members who agreed, not everyone the programme covers, and it does not show that the programme caused any change. Comparing two reports run on different days can show the effect of one member joining or leaving, so share a figure once for a period rather than re-running it.',
    'not_a_causal_claim', true,
    'generated_at', now());
end $$;
revoke all on function private.sponsor_report_aggregate(uuid, date, date) from public, anon, authenticated;

create function public.sponsor_outcome_report(p_cohort uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_r jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  v_r := private.sponsor_report_aggregate(p_cohort, p_from, p_to);
  perform private.log_audit('sponsor.outcome_report', 'sponsor_cohort', p_cohort, jsonb_build_object('from', p_from, 'to', p_to));
  return v_r;
end $$;
revoke all on function public.sponsor_outcome_report(uuid, date, date) from public, anon;
grant execute on function public.sponsor_outcome_report(uuid, date, date) to authenticated;

create function public.log_sponsor_export(p_cohort uuid, p_from date default null, p_to date default null) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.sponsor_cohorts where id = p_cohort) then raise exception 'sponsor_cohort_not_found' using errcode = '22023'; end if;
  perform private.log_audit('sponsor.outcome_export', 'sponsor_cohort', p_cohort, jsonb_build_object('from', p_from, 'to', p_to, 'format', 'csv'));
end $$;
revoke all on function public.log_sponsor_export(uuid, date, date) from public, anon;
grant execute on function public.log_sponsor_export(uuid, date, date) to authenticated;

-- 5. Triage agreement ------------------------------------------------------------------------------------------------------------------
insert into public.platform_switches (key, label, description, is_on, readable_by_anon) values
  ('triage_agreement_capture', 'Triage grade review by clinicians',
   'Lets a clinician record, after completing a task that came from an automatic triage grade, whether the grade was right, should have been higher or should have been lower. Off until the Chief Medical Officer approves. It never blocks completing a task.', false, false)
on conflict (key) do nothing;

create table public.triage_reviews (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  task_id          uuid not null unique references public.clinical_tasks (id) on delete restrict,
  triage_event_id  uuid not null references public.triage_events (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  graded_as        text not null check (graded_as in ('green', 'amber', 'red')),
  agreement        text not null check (agreement in ('right', 'should_have_been_higher', 'should_have_been_lower')),
  reviewed_by      uuid not null references public.profiles (id) on delete restrict,
  reviewed_at      timestamptz not null default now(),
  rule_set_version integer,
  shadow           boolean not null,
  is_test          boolean not null default false,
  check (not (graded_as = 'green' and agreement = 'should_have_been_lower')),
  check (not (graded_as = 'red' and agreement = 'should_have_been_higher'))
);
create index triage_reviews_when_idx on public.triage_reviews (reviewed_at) where not is_test;
alter table public.triage_reviews enable row level security;
revoke all on public.triage_reviews from public, anon, authenticated;

create function private.triage_reviews_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'triage_reviews_append_only' using errcode = 'P0001'; end $$;
create trigger triage_reviews_append_only before update on public.triage_reviews for each row execute function private.triage_reviews_append_only();
revoke all on function private.triage_reviews_append_only() from public, anon, authenticated;

-- The tasks the caller completed in the last 14 days that came from a triage grade and have no review yet. No patient identity, no reading.
create function public.clinician_triage_review_list() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'clinician' and is_active) then raise exception 'triage_review_not_authorised' using errcode = '42501'; end if;
  if not public.platform_switch_is_on('triage_agreement_capture') then return jsonb_build_object('status', 'not_available', 'rows', '[]'::jsonb); end if;
  return jsonb_build_object('status', 'ok', 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('task_id', t.id, 'task_type', t.type, 'completed_at', t.completed_at, 'graded_as', e.grade) order by t.completed_at desc)
      from public.clinical_tasks t join public.triage_events e on e.id = t.triage_event_id
     where t.state = 'completed' and t.completed_at > now() - interval '14 days' and not t.is_test
       and exists (select 1 from public.task_claims c where c.task_id = t.id and c.clinician_id = v_uid and c.end_reason = 'completed')
       and not exists (select 1 from public.triage_reviews r where r.task_id = t.id)), '[]'::jsonb));
end $$;
revoke all on function public.clinician_triage_review_list() from public, anon;
grant execute on function public.clinician_triage_review_list() to authenticated;

create function public.record_triage_review(p_task uuid, p_agreement text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); t public.clinical_tasks%rowtype; e public.triage_events%rowtype;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'clinician' and is_active) then raise exception 'triage_review_not_authorised' using errcode = '42501'; end if;
  if not public.platform_switch_is_on('triage_agreement_capture') then return jsonb_build_object('status', 'not_available'); end if;
  if p_agreement is null or p_agreement not in ('right', 'should_have_been_higher', 'should_have_been_lower') then
    raise exception 'triage_review_invalid' using errcode = '22023';
  end if;
  select * into t from public.clinical_tasks where id = p_task and state = 'completed' and triage_event_id is not null;
  -- only the clinician who completed the task may review its grade; anyone else gets the same answer as for a task that does not exist
  if not found or not exists (select 1 from public.task_claims c where c.task_id = p_task and c.clinician_id = v_uid and c.end_reason = 'completed') then
    return jsonb_build_object('status', 'not_found');
  end if;
  if exists (select 1 from public.triage_reviews where task_id = p_task) then return jsonb_build_object('status', 'already_reviewed'); end if;
  select * into e from public.triage_events where id = t.triage_event_id;
  if (e.grade = 'green' and p_agreement = 'should_have_been_lower') or (e.grade = 'red' and p_agreement = 'should_have_been_higher') then
    raise exception 'triage_review_invalid' using errcode = '22023';
  end if;
  insert into public.triage_reviews (organisation_id, task_id, triage_event_id, patient_id, graded_as, agreement, reviewed_by, rule_set_version, shadow, is_test)
  values (t.organisation_id, t.id, e.id, t.patient_id, e.grade, p_agreement, v_uid, e.rule_set_version, e.shadow, coalesce(t.is_test, false));
  perform private.log_audit('triage.review_recorded', 'triage_review', t.id, jsonb_build_object('agreement', p_agreement));
  return jsonb_build_object('status', 'ok');
end $$;
revoke all on function public.record_triage_review(uuid, text) from public, anon;
grant execute on function public.record_triage_review(uuid, text) to authenticated;

-- 6. The triage accuracy report (admin or CMO) ---------------------------------------------------------------------------------------
create function public.triage_accuracy_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_min integer := (private.outcome_rule('min_cell') #>> '{}')::integer;
  v_from date := coalesce(p_from, (now() at time zone 'Africa/Lagos')::date - 90); v_to date := coalesce(p_to, (now() at time zone 'Africa/Lagos')::date);
  v_total integer; v_reviewed integer; v_right integer; v_higher integer; v_lower integer; v_shadow integer; v_eligible integer;
  v_grades jsonb := '[]'::jsonb; g text; v_out jsonb := '{}'::jsonb; d text; v_cells jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'triage_report_not_authorised' using errcode = '42501'; end if;
  drop table if exists pg_temp._s38e_tr;
  create temp table _s38e_tr on commit drop as
    select r.graded_as, r.agreement, r.shadow, coalesce(p.sex::text, 'unknown') as sex, coalesce(p.state, 'unknown') as state,
           case when p.date_of_birth is null then 'unknown'
                when extract(year from age(tk.completed_at::date, p.date_of_birth)) < 18 then 'under_18'
                else (floor(extract(year from age(tk.completed_at::date, p.date_of_birth)) / 10) * 10)::integer::text || 's' end as age_band
      from public.triage_reviews r join public.profiles p on p.id = r.patient_id join public.clinical_tasks tk on tk.id = r.task_id
     where not r.is_test and not coalesce(p.is_test, false) and (tk.completed_at at time zone 'Africa/Lagos')::date between v_from and v_to;
  select count(*) filter (where not shadow), count(*) filter (where not shadow and agreement = 'right'), count(*) filter (where not shadow and agreement = 'should_have_been_higher'),
         count(*) filter (where not shadow and agreement = 'should_have_been_lower'), count(*) filter (where shadow)
    into v_reviewed, v_right, v_higher, v_lower, v_shadow from _s38e_tr;
  -- how many tasks could have been reviewed: completed in the range, from an approved (not shadow) grade, not a test
  select count(*) into v_eligible from public.clinical_tasks t join public.triage_events e on e.id = t.triage_event_id
    join public.profiles p on p.id = t.patient_id
   where t.state = 'completed' and not e.shadow and not coalesce(t.is_test, false) and not coalesce(p.is_test, false)
     and (t.completed_at at time zone 'Africa/Lagos')::date between v_from and v_to;

  foreach g in array array['green', 'amber', 'red'] loop
    select count(*) filter (where not shadow), count(*) filter (where not shadow and agreement = 'right'), count(*) filter (where not shadow and agreement = 'should_have_been_higher'),
           count(*) filter (where not shadow and agreement = 'should_have_been_lower') into v_total, v_right, v_higher, v_lower from _s38e_tr where graded_as = g;
    v_grades := v_grades || jsonb_build_array(jsonb_build_object('graded_as', g) ||
      case when v_total >= v_min and not ((v_right between 1 and v_min - 1) or (v_higher between 1 and v_min - 1) or (v_lower between 1 and v_min - 1))
           then jsonb_build_object('suppressed', false, 'reviewed', v_total, 'right', v_right, 'should_have_been_higher', v_higher, 'should_have_been_lower', v_lower,
                                   'agree_pct', round(100.0 * v_right / v_total, 1))
           else jsonb_build_object('suppressed', true, 'minimum', v_min) end);
  end loop;
  select count(*) filter (where not shadow and agreement = 'right'), count(*) filter (where not shadow and agreement = 'should_have_been_higher'), count(*) filter (where not shadow and agreement = 'should_have_been_lower')
    into v_right, v_higher, v_lower from _s38e_tr;

  foreach d in array array['sex', 'age_band', 'state'] loop
    execute format($q$
      with cells as (select %1$I as k, count(*) n, count(*) filter (where agreement = 'right') ok, count(*) filter (where agreement = 'should_have_been_higher') hi, count(*) filter (where agreement = 'should_have_been_lower') lo
                       from _s38e_tr where not shadow group by 1),
      flagged as (select c.*, (c.n < %2$s or (c.ok between 1 and %2$s - 1) or (c.hi between 1 and %2$s - 1) or (c.lo between 1 and %2$s - 1)) as small from cells c),
      nxt as (select k from flagged where not small order by n, k limit 1),
      final as (select f.*, (f.small or ((select count(*) from flagged where small) = 1 and f.k = (select k from nxt))) as sup from flagged f)
      select coalesce(jsonb_agg(case when sup then jsonb_build_object('key', k, 'suppressed', true)
                                     else jsonb_build_object('key', k, 'reviewed', n, 'agree_pct', round(100.0 * ok / n, 1), 'should_have_been_higher_pct', round(100.0 * hi / n, 1)) end order by k), '[]'::jsonb)
        from final$q$, d, v_min) into v_cells;
    v_out := v_out || jsonb_build_object(d, v_cells);
  end loop;
  perform private.log_audit('triage.accuracy_report', 'triage_reviews', null, jsonb_build_object('from', v_from, 'to', v_to));
  v_total := v_right + v_higher + v_lower;
  return jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to), 'minimum_cell', v_min,
    'capture_switched_on', public.platform_switch_is_on('triage_agreement_capture'),
    'coverage', case when v_eligible >= v_min then jsonb_build_object('suppressed', false, 'completed_tasks_from_a_grade', v_eligible, 'reviewed', v_total,
                       'reviewed_pct', round(100.0 * v_total / v_eligible, 1), 'low_coverage', (100.0 * v_total / v_eligible) < 50)
                else jsonb_build_object('suppressed', true, 'minimum', v_min) end,
    'overall', case when v_total >= v_min and not ((v_right between 1 and v_min - 1) or (v_higher between 1 and v_min - 1) or (v_lower between 1 and v_min - 1))
                    then jsonb_build_object('suppressed', false, 'reviewed', v_total, 'agree_pct', round(100.0 * v_right / v_total, 1),
                                            'should_have_been_higher_pct', round(100.0 * v_higher / v_total, 1), 'should_have_been_lower_pct', round(100.0 * v_lower / v_total, 1))
                    else jsonb_build_object('suppressed', true, 'minimum', v_min) end,
    'by_grade', v_grades, 'by', v_out,
    'draft_rule_set_reviews', case when v_shadow >= v_min then v_shadow else null end,
    'what_this_is', 'How often the clinician who handled the case agreed with the grade the automatic check gave. It is not diagnostic accuracy: nothing here records the final diagnosis. Reviews of grades from a draft (unapproved) rule set are kept out of every figure above.',
    'limitations', 'Only cases a clinician chose to review are counted, so look at coverage first. A group with few reviews is withheld, and so is the next smallest, so it cannot be worked out by subtraction. This is not a measure of any clinician.',
    'not_a_causal_claim', true, 'generated_at', now());
end $$;
revoke all on function public.triage_accuracy_report(date, date) from public, anon;
grant execute on function public.triage_accuracy_report(date, date) to authenticated;

-- 7. Self-check -------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.sponsor_cohorts', 'SELECT') or has_table_privilege('anon', 'public.sponsor_cohorts', 'SELECT') then raise exception 'S38e: sponsor_cohorts is readable directly'; end if;
  if has_table_privilege('authenticated', 'public.profile_cohorts', 'INSERT,UPDATE,DELETE') or has_table_privilege('anon', 'public.profile_cohorts', 'SELECT') then raise exception 'S38e: profile_cohorts has a wrong grant'; end if;
  if has_table_privilege('authenticated', 'public.triage_reviews', 'SELECT') or has_table_privilege('anon', 'public.triage_reviews', 'SELECT') then raise exception 'S38e: triage_reviews is readable directly'; end if;
  if has_table_privilege('authenticated', 'public.cohort_join_attempts', 'SELECT') then raise exception 'S38e: cohort_join_attempts is readable'; end if;
  if has_function_privilege('anon', 'public.join_cohort(text)', 'EXECUTE') or has_function_privilege('anon', 'public.sponsor_outcome_report(uuid,date,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.triage_accuracy_report(date,date)', 'EXECUTE') or has_function_privilege('anon', 'public.record_triage_review(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_create_sponsor_cohort(uuid,text,date,date,integer)', 'EXECUTE') then raise exception 'S38e: anon can execute a sponsor or triage function'; end if;
  if has_function_privilege('authenticated', 'private.sponsor_report_aggregate(uuid,date,date)', 'EXECUTE') or has_function_privilege('authenticated', 'private.new_cohort_code()', 'EXECUTE') then raise exception 'S38e: a private helper is callable by users'; end if;
  if exists (select 1 from public.consent_versions where consent_type = 'sponsor_reporting' and is_current) then raise exception 'S38e: the sponsor consent draft must not be current until counsel approves it'; end if;
end $$;
