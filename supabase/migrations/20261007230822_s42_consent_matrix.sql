-- S42 (v5 Module 1, part 2): the consent matrix, spec functions 1.13 and 1.15 (database half).
-- Design: docs/design/S42.md. Not applied to production by this session.
--
-- Counted first (live, 2026-10-07): patient_consents holds a handful of rows, all required types (terms, data processing,
-- telehealth); no optional consent version has ever been published (OQ-49); care_circle_members is the only sharing path that
-- reads a patient's record on someone else's behalf; there is no research export anywhere in the repository. So nothing
-- here changes what an existing patient can see or do today, except the Care Circle gate below (0 patients have withdrawn
-- anything, because there was nothing to withdraw), and the backfill keeps every existing circle member's view.
--
-- What this adds:
--   1. consent_matrix_cells: the policy, data type x purpose, with required_for_care marked per row (versioned, draft wording).
--   2. consent_bundles / consent_bundle_cells: defaults as bundles. No bundle ever contains reproductive or mental health data
--      for any purpose except care (a person must pick those one by one in the advanced view).
--   3. consent_matrix_events: append-only history. Written only by SECURITY DEFINER functions; a trigger refuses to withdraw a
--      required-for-care cell whoever writes it (OQ-53, enforced in the database).
--   4. private.consent_in_force, public.my_consent_matrix / set_consent_cell / apply_consent_bundle / withdraw_all_optional_consents
--      / my_consent_matrix_history.
--   5. OQ-53 for the older patient_consents table: a withdrawn row for a REQUIRED consent version is refused by the trigger.
--   6. Honoured by: Care Circle (supporter view blocks drop vitals-derived data when the cell is off), the research roster
--      (public.research_export_roster, admin only, only people whose research consent is in force). Sponsor reporting seam:
--      private.consent_in_force(patient, data_type, 'sponsor_reporting'); the live sponsor report is on PR #988 (OQ-297).
--
-- Withdrawing an optional consent never reduces access to care: no care access function reads consent_matrix_events (the proof
-- scans their source), and a required-for-care cell is in force without any event row at all.

-- ---------------------------------------------------------------------------
-- 1. Policy: the matrix
-- ---------------------------------------------------------------------------
create table public.consent_matrix_cells (
  data_type         text not null check (data_type in ('vitals', 'reproductive', 'mental_health', 'documents', 'device_data')),
  purpose           text not null check (purpose in ('care', 'care_circle_sharing', 'research', 'sponsor_reporting')),
  required_for_care boolean not null,
  sensitive         boolean not null default false,
  text_key          text not null,
  wording_status    text not null default 'draft_pending_counsel' check (wording_status in ('draft_pending_counsel', 'approved')),
  policy_version    integer not null default 1,
  sort_order        integer not null,
  primary key (data_type, purpose),
  -- Only the care purpose can be required for care. Sharing, research and sponsor reporting are always a choice.
  check (not required_for_care or purpose = 'care')
);
comment on table public.consent_matrix_cells is
  'S42 1.13: policy, one row per data type and purpose. required_for_care is true only for the care purpose. text_key points at placeholder wording in @tarragon/i18n that counsel has not approved (OQ-49, OQ-296).';

insert into public.consent_matrix_cells (data_type, purpose, required_for_care, sensitive, text_key, sort_order)
select d.dt, p.pu, (p.pu = 'care'), d.sens, 'consent.matrix.' || d.dt || '.' || p.pu, d.n * 10 + p.n
  from (values ('vitals', false, 1), ('reproductive', true, 2), ('mental_health', true, 3), ('documents', false, 4), ('device_data', false, 5)) as d(dt, sens, n)
 cross join (values ('care', 1), ('care_circle_sharing', 2), ('research', 3), ('sponsor_reporting', 4)) as p(pu, n);

create table public.consent_bundles (
  code       text primary key check (code ~ '^[a-z_]{3,40}$'),
  text_key   text not null,
  sort_order integer not null
);
create table public.consent_bundle_cells (
  bundle_code text not null references public.consent_bundles (code) on delete cascade,
  data_type   text not null,
  purpose     text not null,
  primary key (bundle_code, data_type, purpose),
  foreign key (data_type, purpose) references public.consent_matrix_cells (data_type, purpose),
  -- A bundle may only add optional cells, and never a sensitive data type for any purpose but care.
  check (purpose <> 'care' and data_type not in ('reproductive', 'mental_health'))
);
insert into public.consent_bundles (code, text_key, sort_order) values
  ('family_support', 'consent.bundle.family_support', 1),
  ('help_research', 'consent.bundle.help_research', 2),
  ('programme_reporting', 'consent.bundle.programme_reporting', 3);
insert into public.consent_bundle_cells (bundle_code, data_type, purpose) values
  ('family_support', 'vitals', 'care_circle_sharing'),
  ('family_support', 'device_data', 'care_circle_sharing'),
  ('help_research', 'vitals', 'research'),
  ('help_research', 'documents', 'research'),
  ('help_research', 'device_data', 'research'),
  ('programme_reporting', 'vitals', 'sponsor_reporting'),
  ('programme_reporting', 'device_data', 'sponsor_reporting');

alter table public.consent_matrix_cells enable row level security;
alter table public.consent_bundles enable row level security;
alter table public.consent_bundle_cells enable row level security;
revoke all on public.consent_matrix_cells, public.consent_bundles, public.consent_bundle_cells from public, anon, authenticated;
grant select on public.consent_matrix_cells, public.consent_bundles, public.consent_bundle_cells to authenticated;
create policy consent_matrix_cells_read on public.consent_matrix_cells for select to authenticated using (true);
create policy consent_bundles_read on public.consent_bundles for select to authenticated using (true);
create policy consent_bundle_cells_read on public.consent_bundle_cells for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. History: append-only events
-- ---------------------------------------------------------------------------
create table public.consent_matrix_events (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  data_type       text not null,
  purpose         text not null,
  action          text not null check (action in ('granted', 'withdrawn')),
  policy_version  integer not null,
  source          text not null check (source in ('patient', 'bundle', 'circle_invite', 'handover', 'account_closure')),
  bundle_code     text,
  recorded_by     uuid not null references public.profiles (id) on delete cascade,
  is_test         boolean not null default false,
  created_at      timestamptz not null default clock_timestamp(), -- clock_timestamp: two changes in one transaction still order
  foreign key (data_type, purpose) references public.consent_matrix_cells (data_type, purpose)
);
create index consent_matrix_events_patient_idx on public.consent_matrix_events (patient_id, data_type, purpose, created_at desc, id desc);
comment on table public.consent_matrix_events is
  'S42 1.13/1.15: append-only. The latest row per (patient, data_type, purpose) is the state. Never updated or deleted; kept as consent evidence (retention category consent_and_legal_records).';

create trigger consent_matrix_events_no_update before update on public.consent_matrix_events
  for each row execute function private.reject_mutation();
create trigger consent_matrix_events_no_delete before delete on public.consent_matrix_events
  for each row execute function private.reject_mutation();

-- OQ-53, in the database: a required-for-care cell can never be withdrawn, by anyone, through any path.
create function private.enforce_consent_matrix_event() returns trigger
language plpgsql set search_path = ''
as $$
declare c public.consent_matrix_cells%rowtype;
begin
  select * into c from public.consent_matrix_cells where data_type = new.data_type and purpose = new.purpose;
  if c.data_type is null then raise exception 'consent_cell_unknown' using errcode = '23514'; end if;
  if new.action = 'withdrawn' and c.required_for_care then
    raise exception 'consent_required_for_care' using errcode = '23514',
      detail = 'This consent is needed to give you care. To stop it, use the account closure options in Privacy.';
  end if;
  new.policy_version := c.policy_version;
  return new;
end $$;
revoke all on function private.enforce_consent_matrix_event() from public, anon, authenticated;
create trigger consent_matrix_events_rule before insert on public.consent_matrix_events
  for each row execute function private.enforce_consent_matrix_event();

alter table public.consent_matrix_events enable row level security;
revoke all on public.consent_matrix_events from public, anon, authenticated;
grant select on public.consent_matrix_events to authenticated;
create policy consent_matrix_events_own on public.consent_matrix_events for select to authenticated
  using (patient_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. State
-- ---------------------------------------------------------------------------
create function private.consent_in_force(p_patient uuid, p_data_type text, p_purpose text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select c.required_for_care from public.consent_matrix_cells c where c.data_type = p_data_type and c.purpose = p_purpose), false)
  or coalesce(
    (select e.action = 'granted' from public.consent_matrix_events e
      where e.patient_id = p_patient and e.data_type = p_data_type and e.purpose = p_purpose
      order by e.created_at desc, e.id desc limit 1), false)
$$;
revoke all on function private.consent_in_force(uuid, text, text) from public, anon, authenticated;

create function private.record_consent_cell(p_patient uuid, p_org uuid, p_is_test boolean, p_data_type text, p_purpose text,
                                           p_granted boolean, p_source text, p_bundle text, p_actor uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  -- No change, no row: the history shows decisions, not taps.
  if private.consent_in_force(p_patient, p_data_type, p_purpose) = p_granted then return false; end if;
  insert into public.consent_matrix_events (organisation_id, patient_id, data_type, purpose, action, policy_version, source, bundle_code, recorded_by, is_test)
  values (p_org, p_patient, p_data_type, p_purpose, case when p_granted then 'granted' else 'withdrawn' end, 1, p_source, p_bundle, p_actor, p_is_test);
  return true;
end $$;
revoke all on function private.record_consent_cell(uuid, uuid, boolean, text, text, boolean, text, text, uuid) from public, anon, authenticated;

create function public.my_consent_matrix() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'consent_not_authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'cells', coalesce((select jsonb_agg(jsonb_build_object(
        'data_type', c.data_type, 'purpose', c.purpose, 'required_for_care', c.required_for_care, 'sensitive', c.sensitive,
        'text_key', c.text_key, 'wording_status', c.wording_status,
        'granted', private.consent_in_force(v_uid, c.data_type, c.purpose),
        'changed_at', (select max(e.created_at) from public.consent_matrix_events e
                        where e.patient_id = v_uid and e.data_type = c.data_type and e.purpose = c.purpose))
        order by c.sort_order) from public.consent_matrix_cells c), '[]'::jsonb),
    'bundles', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'text_key', b.text_key,
        'cells', (select jsonb_agg(jsonb_build_object('data_type', bc.data_type, 'purpose', bc.purpose) order by bc.data_type, bc.purpose)
                    from public.consent_bundle_cells bc where bc.bundle_code = b.code)) order by b.sort_order)
        from public.consent_bundles b), '[]'::jsonb));
end $$;
revoke all on function public.my_consent_matrix() from public, anon;
grant execute on function public.my_consent_matrix() to authenticated;

create function public.set_consent_cell(p_data_type text, p_purpose text, p_granted boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); p public.profiles%rowtype; v_changed boolean;
begin
  if v_uid is null then raise exception 'consent_not_authorised' using errcode = '42501'; end if;
  select * into p from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found or p.organisation_id is null then raise exception 'consent_not_authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.consent_matrix_cells where data_type = p_data_type and purpose = p_purpose) then
    raise exception 'consent_cell_unknown' using errcode = '22023';
  end if;
  -- Asking to withdraw a required cell reaches the trigger, which refuses it (one rule, one place).
  v_changed := private.record_consent_cell(v_uid, p.organisation_id, p.is_test, p_data_type, p_purpose, coalesce(p_granted, false), 'patient', null, v_uid);
  if v_changed then
    perform private.emit_domain_event('consent.changed', p.organisation_id,
      jsonb_build_object('data_type', p_data_type, 'purpose', p_purpose, 'granted', coalesce(p_granted, false)),
      'consent.changed:' || gen_random_uuid()::text, v_uid, 'profile', v_uid);
    perform private.log_audit('consent.changed', 'profile', v_uid, jsonb_build_object('data_type', p_data_type, 'purpose', p_purpose, 'granted', coalesce(p_granted, false)));
  end if;
  return jsonb_build_object('ok', true, 'changed', v_changed);
end $$;
revoke all on function public.set_consent_cell(text, text, boolean) from public, anon;
grant execute on function public.set_consent_cell(text, text, boolean) to authenticated;

create function public.apply_consent_bundle(p_bundle text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); p public.profiles%rowtype; r record; v_n integer := 0;
begin
  if v_uid is null then raise exception 'consent_not_authorised' using errcode = '42501'; end if;
  select * into p from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found or p.organisation_id is null then raise exception 'consent_not_authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.consent_bundles where code = p_bundle) then raise exception 'consent_bundle_unknown' using errcode = '22023'; end if;
  for r in select data_type, purpose from public.consent_bundle_cells where bundle_code = p_bundle order by data_type, purpose loop
    if private.record_consent_cell(v_uid, p.organisation_id, p.is_test, r.data_type, r.purpose, true, 'bundle', p_bundle, v_uid) then v_n := v_n + 1; end if;
  end loop;
  if v_n > 0 then
    perform private.emit_domain_event('consent.changed', p.organisation_id,
      jsonb_build_object('bundle', p_bundle, 'cells_changed', v_n, 'granted', true),
      'consent.changed:' || gen_random_uuid()::text, v_uid, 'profile', v_uid);
    perform private.log_audit('consent.bundle_applied', 'profile', v_uid, jsonb_build_object('bundle', p_bundle, 'cells_changed', v_n));
  end if;
  return jsonb_build_object('ok', true, 'cells_changed', v_n);
end $$;
revoke all on function public.apply_consent_bundle(text) from public, anon;
grant execute on function public.apply_consent_bundle(text) to authenticated;

-- One tap back to the essentials: every optional cell off. Required cells are not touched, so care is not affected.
create function public.withdraw_all_optional_consents() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); p public.profiles%rowtype; r record; v_n integer := 0;
begin
  if v_uid is null then raise exception 'consent_not_authorised' using errcode = '42501'; end if;
  select * into p from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found or p.organisation_id is null then raise exception 'consent_not_authorised' using errcode = '42501'; end if;
  for r in select data_type, purpose from public.consent_matrix_cells where not required_for_care order by sort_order loop
    if private.record_consent_cell(v_uid, p.organisation_id, p.is_test, r.data_type, r.purpose, false, 'patient', null, v_uid) then v_n := v_n + 1; end if;
  end loop;
  if v_n > 0 then
    perform private.emit_domain_event('consent.changed', p.organisation_id,
      jsonb_build_object('cells_changed', v_n, 'granted', false), 'consent.changed:' || gen_random_uuid()::text, v_uid, 'profile', v_uid);
    perform private.log_audit('consent.optional_all_withdrawn', 'profile', v_uid, jsonb_build_object('cells_changed', v_n));
  end if;
  return jsonb_build_object('ok', true, 'cells_changed', v_n);
end $$;
revoke all on function public.withdraw_all_optional_consents() from public, anon;
grant execute on function public.withdraw_all_optional_consents() to authenticated;

create function public.my_consent_matrix_history(p_limit integer default 50) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('data_type', h.data_type, 'purpose', h.purpose, 'action', h.action,
           'source', h.source, 'at', h.created_at) order by h.created_at desc, h.id desc), '[]'::jsonb)
    from (select * from public.consent_matrix_events where patient_id = (select auth.uid())
           order by created_at desc, id desc limit greatest(1, least(coalesce(p_limit, 50), 200))) h
$$;
revoke all on function public.my_consent_matrix_history(integer) from public, anon;
grant execute on function public.my_consent_matrix_history(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Event type
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('consent.changed', 'A patient granted or withdrew an optional consent (ids and counts only)', 'S42', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('consent.changed', 1, array['granted'])
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. OQ-53: the older patient_consents table refuses to withdraw a REQUIRED version
-- ---------------------------------------------------------------------------
create or replace function private.enforce_patient_consent_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current record;
  v_optional boolean;
begin
  if new.action <> 'withdrawn' then
    return new;
  end if;

  select pc.consent_version_id, pc.version
  into v_current
  from public.patient_consents pc
  where pc.patient_id = new.patient_id
    and pc.consent_type = new.consent_type
    and pc.action = 'accepted'
    and not exists (
      select 1 from public.patient_consents pc2
      where pc2.patient_id = pc.patient_id
        and pc2.consent_type = pc.consent_type
        and pc2.action = 'withdrawn'
        and pc2.created_at > pc.created_at
    )
  order by pc.created_at desc
  limit 1;

  if v_current.consent_version_id is null then
    raise exception 'No currently-accepted % consent on file to withdraw', new.consent_type
      using errcode = '23514';
  end if;

  -- OQ-53: a required consent is the condition of having an account. Stopping it is closing the account (the data rights
  -- flow), never a toggle. Defaults to required when the version row is missing, the safer reading.
  select cv.is_optional into v_optional from public.consent_versions cv where cv.id = v_current.consent_version_id;
  -- A signed-in session (a patient, a clinician, an admin) can never do it. A service or migration context (no auth.uid())
  -- is exempt, because older proofs and ops tools legitimately insert history rows as fixtures; no patient-facing path runs there.
  if not coalesce(v_optional, false) and (select auth.uid()) is not null then
    raise exception 'consent_required_for_care' using errcode = '23514',
      detail = 'This consent is needed to use your account. To stop it, use the account closure options in Privacy.';
  end if;

  new.consent_version_id := v_current.consent_version_id;
  new.version := v_current.version;
  new.accepted_at := now();

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Honoured by Care Circle
-- ---------------------------------------------------------------------------
-- A circle member's vitals-derived blocks (adherence, weekly BP) need the vitals x care_circle_sharing cell. Adding a member
-- grants it (that is the patient's own act), withdrawing it in Privacy switches those blocks off for everyone at once.
create function private.grant_circle_consent_on_member() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = new.patient_id;
  if found and p.organisation_id is not null then
    perform private.record_consent_cell(new.patient_id, p.organisation_id, p.is_test, 'vitals', 'care_circle_sharing', true, 'circle_invite', null, new.patient_id);
  end if;
  return new;
end $$;
revoke all on function private.grant_circle_consent_on_member() from public, anon, authenticated;
create trigger care_circle_members_grant_consent after insert on public.care_circle_members
  for each row when (new.state = 'active') execute function private.grant_circle_consent_on_member();

-- Existing active members keep what they see: the patient already chose to add them.
insert into public.consent_matrix_events (organisation_id, patient_id, data_type, purpose, action, policy_version, source, recorded_by, is_test)
select distinct m.organisation_id, m.patient_id, 'vitals', 'care_circle_sharing', 'granted', 1, 'circle_invite', m.patient_id, coalesce(p.is_test, false)
  from public.care_circle_members m join public.profiles p on p.id = m.patient_id
 where m.state = 'active';

-- The S29c body restated with one added statement at the top (everything else is verbatim). Integration with S38d: S38d renamed S29c's function
-- to circle_view_blocks_core and put a wrapper (core + the monthly block) under the old name, so the change belongs on the core. Redefining the
-- old name here would silently drop the monthly block from the Care Circle view.
CREATE OR REPLACE FUNCTION private.circle_view_blocks_core(p_patient uuid, p_permissions text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_weeks integer := (private.circle_rules() ->> 'view_weeks')::integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  out jsonb := '{}'::jsonb;
  v_taken integer; v_due integer;
  v_bp jsonb; v_dir text; v_a numeric; v_b numeric;
  v_next timestamptz; v_missed integer;
begin
  -- S42: without the vitals x Care Circle consent, the vitals-derived blocks are not built.
  if not private.consent_in_force(p_patient, 'vitals', 'care_circle_sharing') then
    p_permissions := array_remove(array_remove(p_permissions, 'adherence_summary'), 'weekly_bp_trend');
  end if;
  if 'adherence_summary' = any (p_permissions) then
    select count(*) filter (where status in ('taken', 'delayed')), count(*) filter (where status in ('taken', 'delayed', 'missed', 'skipped'))
      into v_taken, v_due
      from public.medication_logs
     where patient_id = p_patient and scheduled_for_date between v_today - 6 and v_today;
    out := out || jsonb_build_object('adherence', jsonb_build_object('days', 7, 'taken', v_taken, 'due', v_due,
              'percent', case when v_due > 0 then round(100.0 * v_taken / v_due)::integer end));
  end if;

  if 'weekly_bp_trend' = any (p_permissions) then
    -- weekly averages only: no single reading, no time of day, no symptom, no note
    select coalesce(jsonb_agg(jsonb_build_object('week_start', w.wk, 'systolic', w.sys, 'diastolic', w.dia, 'readings', w.n) order by w.wk), '[]'::jsonb)
      into v_bp
      from (select (date_trunc('week', taken_at at time zone 'Africa/Lagos'))::date wk, round(avg(systolic))::integer sys,
                   round(avg(diastolic))::integer dia, count(*)::integer n
              from public.vitals_readings
             where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
               and coalesce(validation_status::text, '') <> 'rejected'
               and taken_at >= (v_today - (v_weeks * 7))::timestamp at time zone 'Africa/Lagos'
             group by 1) w;
    select (v_bp -> -1 ->> 'systolic')::numeric, (v_bp -> -2 ->> 'systolic')::numeric into v_a, v_b;
    v_dir := case when jsonb_array_length(v_bp) < 2 then null
                  when v_a - v_b >= 5 then 'higher' when v_a - v_b <= -5 then 'lower' else 'steady' end;
    out := out || jsonb_build_object('bp_trend', jsonb_build_object('weeks', v_bp, 'direction', v_dir));
  end if;

  if 'appointments' = any (p_permissions) then
    select min(scheduled_for) filter (where status in ('scheduled', 'booked', 'confirmed') and scheduled_for > now()),
           count(*) filter (where status = 'no_show' and scheduled_for > now() - interval '30 days')
      into v_next, v_missed
      from public.appointments where patient_id = p_patient;
    out := out || jsonb_build_object('appointments', jsonb_build_object('next_at', v_next, 'missed_30d', v_missed));
  end if;

  if 'pay_for_care' = any (p_permissions) then
    out := out || jsonb_build_object('can_pay', true);
  end if;
  return out;
end $function$;

-- ---------------------------------------------------------------------------
-- 7. Honoured by research: the roster is the only door to a research export
-- ---------------------------------------------------------------------------
create function public.research_export_roster()
returns table (patient_id uuid, data_types text[])
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'research_roster_not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('research_export.roster_read', 'research_export', null, '{}'::jsonb);
  return query
    select p.id, array_agg(c.data_type order by c.data_type)
      from public.profiles p
      join public.consent_matrix_cells c on c.purpose = 'research'
     where p.role = 'patient' and p.is_active and not p.is_test and not p.is_dependent_account
       and private.consent_in_force(p.id, c.data_type, 'research')
     group by p.id;
end $$;
revoke all on function public.research_export_roster() from public, anon;
grant execute on function public.research_export_roster() to authenticated;
comment on function public.research_export_roster() is
  'S42: the people (and which data types) whose research consent is in force right now. Admin only, audited. A research export must be built from this list and nothing else, so a withdrawal removes the person from the next export.';

-- ---------------------------------------------------------------------------
-- 8. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.consent_matrix_cells) <> 20 then raise exception 'S42: matrix is not 5 x 4'; end if;
  if exists (select 1 from public.consent_matrix_cells where required_for_care and purpose <> 'care') then raise exception 'S42: a non-care cell is required'; end if;
  if has_table_privilege('anon', 'public.consent_matrix_events', 'SELECT') then raise exception 'S42: anon reads the consent history'; end if;
  if has_table_privilege('authenticated', 'public.consent_matrix_events', 'INSERT,UPDATE,DELETE') then raise exception 'S42: consent history writable directly'; end if;
  if has_function_privilege('anon', 'public.set_consent_cell(text,text,boolean)', 'EXECUTE') then raise exception 'S42: anon can set a consent'; end if;
  if has_function_privilege('anon', 'public.research_export_roster()', 'EXECUTE') then raise exception 'S42: anon can read the research roster'; end if;
  if has_function_privilege('authenticated', 'private.consent_in_force(uuid,text,text)', 'EXECUTE') then raise exception 'S42: private consent helper callable'; end if;
end $$;
