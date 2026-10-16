-- N-overrides: clinician-signed personal threshold overrides for the triage engine.
-- A senior doctor (senior_medical_officer or chief_medical_officer, private.has_prescribing_authority) who is tied to the patient (S39g
-- private.staff_may_write) proposes a personal setting with a reason and a review period, then SIGNS it by typing SIGN. The engine
-- (supabase/functions/_shared/clinical/threshold-override.ts) applies it AFTER the signed rule set has graded, inside hard clamps:
-- it can relax only two chronic-burden ambers (seven day average over target, low reading with no symptom) for an adult who is not pregnant or
-- postpartum and has ticked no symptom, and can tighten (more sensitive) a blood pressure target or the glucose low lines. It can never lower a red.
-- It expires on its own (the loader only serves status active and expires_at > now()), and every grade it changes is stored with provenance.
--
--  1. threshold_override_policies: the versioned, CMO-signed switch and review period (PROPOSED, born unsigned: nothing can be proposed until signed).
--  2. patient_threshold_overrides (+ events, append only) and the clamp functions (mirrored in the engine; a Jest test pins the numbers).
--  3. triage_override_applications: which override changed which triage event (append only). triage_events itself is untouched (it is append
--     only and record_triage_result is the live safety path; nothing here rewrites it).
--  4. RPCs: propose, sign, revoke, review, CMO oversight roster, the patient notice (a yes/no with no numbers, INV-07), and two service-role
--     functions for the process-events handler.
--  5. A routine monthly review task type (class 8, never pushed) created by a daily sweep, which also lapses expired overrides.
-- LIVE COUNT BEFORE: none of these objects exists (new feature); no row is converted.

-- 1. Policy ------------------------------------------------------------------------------------------------------------------------------
create table public.threshold_override_policies (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  config      jsonb not null,
  is_active   boolean not null default false,
  approved_by uuid references public.clinical_staff (id) on delete restrict,
  approved_at timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  check (not is_active or (approved_by is not null and approved_at is not null))
);
create unique index threshold_override_policies_one_active on public.threshold_override_policies (is_active) where is_active;
alter table public.threshold_override_policies enable row level security;
create policy threshold_override_policies_read on public.threshold_override_policies for select to authenticated using (private.is_org_staff((select p.organisation_id from public.profiles p where p.id = (select auth.uid()))));
revoke all on public.threshold_override_policies from public, anon, authenticated;
grant select on public.threshold_override_policies to authenticated;

-- threshold-override-policy-begin
insert into public.threshold_override_policies (version, config, note) values
  (1, $json${
 "maxDays": 90,
 "reviewDays": 30,
 "reviewTaskDueMinutes": 4320
}$json$::jsonb,
  'PROPOSED, unsigned and inactive: public.sign_threshold_override_policy() by the Chief Medical Officer. maxDays is the longest an override can run before it returns to the default; reviewDays is the monthly review cadence.');
-- threshold-override-policy-end

create function private.threshold_override_policy() returns jsonb
language sql stable security definer set search_path = ''
as $$ select config from public.threshold_override_policies where is_active and approved_by is not null $$;
revoke all on function private.threshold_override_policy() from public, anon, authenticated;

create function public.sign_threshold_override_policy(p_id uuid, p_confirm text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid; v_cfg jsonb;
begin
  if upper(btrim(coalesce(p_confirm, ''))) <> 'SIGN' then raise exception 'type SIGN to confirm; nothing was signed' using errcode = '22023'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the personal threshold policy' using errcode = '42501'; end if;
  select config into v_cfg from public.threshold_override_policies where id = p_id;
  if not found then raise exception 'policy version not found' using errcode = '22023'; end if;
  -- Signing a version that was withdrawn switches it back on (the withdraw is not one-way); one that is already on cannot be signed again.
  if exists (select 1 from public.threshold_override_policies where id = p_id and is_active) then raise exception 'this version is already signed and on; a change is a new version' using errcode = '22023'; end if;
  if jsonb_typeof(v_cfg -> 'maxDays') is distinct from 'number' or jsonb_typeof(v_cfg -> 'reviewDays') is distinct from 'number' or jsonb_typeof(v_cfg -> 'reviewTaskDueMinutes') is distinct from 'number'
     or (v_cfg ->> 'maxDays')::int not between 7 and 180 or (v_cfg ->> 'reviewDays')::int not between 7 and (v_cfg ->> 'maxDays')::int or (v_cfg ->> 'reviewTaskDueMinutes')::int < 60 then
    raise exception 'this version is missing a value the policy needs or has one outside 7-180 days' using errcode = '22023';
  end if;
  update public.threshold_override_policies set is_active = false where is_active and id <> p_id;
  update public.threshold_override_policies set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('threshold_override_policy.signed', 'threshold_override_policies', p_id, '{}'::jsonb);
  return p_id;
end $$;
revoke all on function public.sign_threshold_override_policy(uuid, text) from public, anon;
grant execute on function public.sign_threshold_override_policy(uuid, text) to authenticated;

-- The kill switch: withdrawing the policy stops every override at once (the loader serves nothing while no policy is active); the signed
-- rule sets then grade alone. Overrides are kept and come back if a policy is signed again.
create function public.withdraw_threshold_override_policy(p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer') then
    raise exception 'not authorised: only the active Chief Medical Officer can withdraw the personal threshold policy' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.threshold_override_policies set is_active = false where is_active;
  perform private.log_audit('threshold_override_policy.withdrawn', 'threshold_override_policies', null, jsonb_build_object('reason', p_reason));
end $$;
revoke all on function public.withdraw_threshold_override_policy(text) from public, anon;
grant execute on function public.withdraw_threshold_override_policy(text) to authenticated;

-- 2. Clamps, overrides, events -----------------------------------------------------------------------------------------------------------
-- override-limits-begin
create function private.threshold_override_limits() returns jsonb
language sql immutable parallel safe set search_path = ''
as $fn$ select $json${
 "bp": {
  "targetSystolic": { "min": 100, "max": 160 },
  "targetDiastolic": { "min": 60, "max": 100 },
  "lowAmberSystolic": { "min": 80, "max": 90 }
 },
 "glucose": {
  "hypoAlertMmol": { "min": 3.9, "max": 5.0 },
  "hypoSevereMmol": { "min": 3.0, "max": 3.5 }
 }
}$json$::jsonb $fn$;
-- override-limits-end
revoke all on function private.threshold_override_limits() from public, anon, authenticated;

create function private.thr_num_in(p_value jsonb, p_limit jsonb) returns boolean
language sql immutable parallel safe set search_path = ''
as $$ select coalesce(jsonb_typeof(p_value) = 'number' and (p_value #>> '{}')::numeric between (p_limit ->> 'min')::numeric and (p_limit ->> 'max')::numeric, false) $$;
revoke all on function private.thr_num_in(jsonb, jsonb) from public, anon, authenticated;

create function private.threshold_override_params_ok(p_domain text, p_params jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare l jsonb := private.threshold_override_limits(); k text; t jsonb;
begin
  if p_params is null or jsonb_typeof(p_params) <> 'object' or p_params = '{}'::jsonb then return false; end if;
  if p_domain = 'bp' then
    for k in select jsonb_object_keys(p_params) loop
      if k not in ('target', 'lowAmberSystolic') then return false; end if;
    end loop;
    if p_params ? 'target' then
      t := p_params -> 'target';
      if jsonb_typeof(t) <> 'object' then return false; end if;
      for k in select jsonb_object_keys(t) loop
        if k not in ('systolic', 'diastolic') then return false; end if;
      end loop;
      if not private.thr_num_in(t -> 'systolic', l -> 'bp' -> 'targetSystolic') or not private.thr_num_in(t -> 'diastolic', l -> 'bp' -> 'targetDiastolic') then return false; end if;
      if (t ->> 'diastolic')::numeric >= (t ->> 'systolic')::numeric then return false; end if;
    end if;
    if p_params ? 'lowAmberSystolic' and not private.thr_num_in(p_params -> 'lowAmberSystolic', l -> 'bp' -> 'lowAmberSystolic') then return false; end if;
    return true;
  elsif p_domain = 'glucose' then
    for k in select jsonb_object_keys(p_params) loop
      if k not in ('hypoAlertMmol', 'hypoSevereMmol') then return false; end if;
    end loop;
    if p_params ? 'hypoAlertMmol' and not private.thr_num_in(p_params -> 'hypoAlertMmol', l -> 'glucose' -> 'hypoAlertMmol') then return false; end if;
    if p_params ? 'hypoSevereMmol' and not private.thr_num_in(p_params -> 'hypoSevereMmol', l -> 'glucose' -> 'hypoSevereMmol') then return false; end if;
    return true;
  end if;
  return false;
end $$;
revoke all on function private.threshold_override_params_ok(text, jsonb) from public, anon, authenticated;

create table public.patient_threshold_overrides (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  domain           text not null check (domain in ('bp', 'glucose')),
  params           jsonb not null,
  reason           text not null check (length(btrim(reason)) between 10 and 1000),
  status           text not null default 'draft' check (status in ('draft', 'active', 'superseded', 'revoked', 'lapsed')),
  proposed_by      uuid not null references public.clinical_staff (id) on delete restrict,
  proposed_at      timestamptz not null default now(),
  valid_days       integer not null check (valid_days between 1 and 180),
  signed_by        uuid references public.clinical_staff (id) on delete restrict,
  signed_at        timestamptz,
  expires_at       timestamptz,
  review_due_at    timestamptz,
  last_reviewed_at timestamptz,
  policy_version   integer,
  ended_at         timestamptz,
  ended_by         uuid references public.clinical_staff (id) on delete restrict,
  end_reason       text,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  check (private.threshold_override_params_ok(domain, params)),
  check (status <> 'active' or (signed_by is not null and signed_at is not null and expires_at is not null and review_due_at is not null and policy_version is not null)),
  check (expires_at is null or signed_at is null or expires_at > signed_at)
);
create unique index patient_threshold_overrides_one_active on public.patient_threshold_overrides (patient_id, domain) where status = 'active';
create unique index patient_threshold_overrides_one_draft on public.patient_threshold_overrides (patient_id, domain) where status = 'draft';
create index patient_threshold_overrides_review_idx on public.patient_threshold_overrides (review_due_at) where status = 'active';
comment on table public.patient_threshold_overrides is 'Personal triage thresholds signed by a senior doctor tied to the patient. Written only through the propose/sign/revoke/review RPCs. The engine applies one only while status = active and expires_at > now(), inside the hard clamps in threshold-override.ts.';

create table public.patient_threshold_override_events (
  id              uuid primary key default gen_random_uuid(),
  override_id     uuid not null references public.patient_threshold_overrides (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  event           text not null check (event in ('proposed', 'signed', 'superseded', 'revoked', 'reviewed', 'lapsed', 'review_task_created', 'review_task_failed')),
  actor_staff_id  uuid references public.clinical_staff (id) on delete restrict,
  detail          jsonb not null default '{}'::jsonb,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index patient_threshold_override_events_override_idx on public.patient_threshold_override_events (override_id, created_at);

create function private.threshold_override_append_only() returns trigger
language plpgsql set search_path = ''
as $$ begin
  -- the only change allowed is the foreign key cascade when a profile is erased
  if tg_op = 'DELETE' and not exists (select 1 from public.profiles where id = old.patient_id) then return old; end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
revoke all on function private.threshold_override_append_only() from public, anon, authenticated;
create trigger patient_threshold_override_events_no_change before update or delete on public.patient_threshold_override_events
  for each row execute function private.threshold_override_append_only();

-- 3. Provenance --------------------------------------------------------------------------------------------------------------------------
create table public.triage_override_applications (
  triage_event_id uuid primary key references public.triage_events (id) on delete restrict,
  override_id     uuid not null references public.patient_threshold_overrides (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  domain          text not null check (domain in ('bp', 'glucose')),
  direction       text not null check (direction in ('relaxed', 'tightened')),
  parameters      text[] not null,
  default_grade   text not null check (default_grade in ('green', 'amber', 'red')),
  default_rule_id text,
  final_grade     text not null check (final_grade in ('green', 'amber', 'red')),
  final_rule_id   text,
  shadow          boolean not null,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  -- the clamp, in the database too: nothing is ever recorded as relaxing a red, or relaxing to anything but green
  check (direction <> 'relaxed' or (default_grade = 'amber' and final_grade = 'green')),
  check (direction <> 'tightened' or (case default_grade when 'green' then 0 when 'amber' then 1 else 2 end) < (case final_grade when 'green' then 0 when 'amber' then 1 else 2 end))
);
create index triage_override_applications_override_idx on public.triage_override_applications (override_id, created_at desc);
create trigger triage_override_applications_no_change before update or delete on public.triage_override_applications
  for each row execute function private.threshold_override_append_only();

alter table public.patient_threshold_overrides enable row level security;
alter table public.patient_threshold_override_events enable row level security;
alter table public.triage_override_applications enable row level security;
-- Tied staff only. The patient is deliberately NOT given a direct read: the table holds the numbers and the doctor's reason (INV-07), and the patient's only
-- window is my_threshold_override_notice(), a bare yes or no.
create policy patient_threshold_overrides_read on public.patient_threshold_overrides for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));
create policy patient_threshold_override_events_read on public.patient_threshold_override_events for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));
create policy triage_override_applications_read on public.triage_override_applications for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));
revoke all on public.patient_threshold_overrides, public.patient_threshold_override_events, public.triage_override_applications from public, anon, authenticated;
grant select on public.patient_threshold_overrides, public.patient_threshold_override_events, public.triage_override_applications to authenticated;

insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('patient_threshold_overrides', 'tied', 'patient_id', 'medical_history', null),
  ('patient_threshold_override_events', 'tied', 'patient_id', 'medical_history', null),
  ('triage_override_applications', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('patient_threshold_overrides', 'patient_id', 'clinical_record', 'review', true, 'Personal triage thresholds. PROPOSED class, to be confirmed by the CMO and DPO.'),
  ('patient_threshold_override_events', 'patient_id', 'audit', 'review', false, 'Append-only history of an override. PROPOSED class, to be confirmed by the CMO and DPO.'),
  ('triage_override_applications', 'patient_id', 'clinical_record', 'review', false, 'Which override changed which triage grade. PROPOSED class, to be confirmed by the CMO and DPO.')
on conflict (table_name) do nothing;

-- 4. Authority, eligibility and the RPCs -------------------------------------------------------------------------------------------------
-- The doctor acting on this patient: prescribing authority in the patient's organisation AND a true care relationship.
create function private.threshold_override_actor(p_patient uuid) returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid; v_staff uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient and role = 'patient';
  if v_org is null then raise exception 'unknown patient' using errcode = '22023'; end if;
  if not private.has_prescribing_authority(v_org) then
    raise exception 'not authorised: only a senior doctor can set a personal threshold' using errcode = '42501';
  end if;
  -- A true care relationship (care team, open escalation or alert, live consultation, active task, post-consult window, assigned referral). A logged record
  -- opening is NOT enough here: a safety-affecting setting is not something a doctor who merely opened the chart can propose and sign alone.
  if not private.clinician_has_patient_access(p_patient) then
    raise exception 'not authorised: you have no care relationship with this patient' using errcode = '42501';
  end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.organisation_id = v_org and cs.active and cs.status = 'active'
     and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer') limit 1;
  if v_staff is null then raise exception 'not authorised: no active senior doctor record' using errcode = '42501'; end if;
  return v_staff;
end $$;
revoke all on function private.threshold_override_actor(uuid) from public, anon, authenticated;

-- null when the patient may have a personal threshold, else the reason in words. Adults only, never pregnant or in the six weeks after a birth.
create function private.threshold_override_ineligible(p_patient uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when pr.date_of_birth is null then 'the patient has no date of birth on record'
    when pr.date_of_birth > (now() at time zone 'Africa/Lagos')::date - interval '18 years' then 'personal thresholds are for adults only'
    when exists (select 1 from public.patient_pregnancy pp where pp.patient_id = p_patient and pp.is_pregnant) then 'personal thresholds are not available in pregnancy'
    when exists (select 1 from public.postnatal_profiles pn where pn.patient_id = p_patient
                  and pn.delivery_date <= (now() at time zone 'Africa/Lagos')::date and pn.delivery_date > (now() at time zone 'Africa/Lagos')::date - 42) then 'personal thresholds are not available in the six weeks after a birth'
    else null end
  from public.profiles pr where pr.id = p_patient
$$;
revoke all on function private.threshold_override_ineligible(uuid) from public, anon, authenticated;

create function private.threshold_override_event(p_override uuid, p_event text, p_staff uuid, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = ''
as $$
  insert into public.patient_threshold_override_events (override_id, organisation_id, patient_id, event, actor_staff_id, detail, is_test)
  select o.id, o.organisation_id, o.patient_id, p_event, p_staff, coalesce(p_detail, '{}'::jsonb), o.is_test from public.patient_threshold_overrides o where o.id = p_override
$$;
revoke all on function private.threshold_override_event(uuid, text, uuid, jsonb) from public, anon, authenticated;

create function public.propose_threshold_override(p_patient uuid, p_domain text, p_params jsonb, p_reason text, p_days integer) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid; v_policy jsonb; v_why text; v_id uuid; v_old uuid; v_org uuid; v_test boolean;
begin
  v_staff := private.threshold_override_actor(p_patient);
  v_policy := private.threshold_override_policy();
  if v_policy is null then raise exception 'personal thresholds are not switched on: the Chief Medical Officer has not signed the policy' using errcode = '55000'; end if;
  if p_domain is null or p_domain not in ('bp', 'glucose') then raise exception 'domain must be bp or glucose' using errcode = '22023'; end if;
  if p_days is null or p_days < 1 or p_days > (v_policy ->> 'maxDays')::int then raise exception 'the review period must be 1 to % days', (v_policy ->> 'maxDays')::int using errcode = '22023'; end if;
  if not private.threshold_override_params_ok(p_domain, p_params) then raise exception 'the setting is outside the safety limits' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'a reason of at least 10 characters is required' using errcode = '22023'; end if;
  v_why := private.threshold_override_ineligible(p_patient);
  if v_why is not null then raise exception '%', v_why using errcode = '22023'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = p_patient;
  -- a new proposal replaces an unsigned one for the same patient and domain
  for v_old in select id from public.patient_threshold_overrides where patient_id = p_patient and domain = p_domain and status = 'draft' loop
    update public.patient_threshold_overrides set status = 'superseded', ended_at = now(), ended_by = v_staff, end_reason = 'replaced by a new proposal' where id = v_old;
    perform private.threshold_override_event(v_old, 'superseded', v_staff, '{}'::jsonb);
  end loop;
  insert into public.patient_threshold_overrides (organisation_id, patient_id, domain, params, reason, proposed_by, valid_days, is_test)
    values (v_org, p_patient, p_domain, p_params, btrim(p_reason), v_staff, p_days, v_test) returning id into v_id;
  perform private.threshold_override_event(v_id, 'proposed', v_staff, jsonb_build_object('domain', p_domain, 'days', p_days));
  perform private.log_audit('threshold_override.proposed', 'patient_threshold_overrides', v_id, jsonb_build_object('domain', p_domain));
  return v_id;
end $$;
revoke all on function public.propose_threshold_override(uuid, text, jsonb, text, integer) from public, anon;
grant execute on function public.propose_threshold_override(uuid, text, jsonb, text, integer) to authenticated;

create function public.sign_threshold_override(p_id uuid, p_confirm text) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.patient_threshold_overrides%rowtype; v_staff uuid; v_policy jsonb; v_why text; v_old uuid; v_expires timestamptz;
begin
  if upper(btrim(coalesce(p_confirm, ''))) <> 'SIGN' then raise exception 'type SIGN to confirm; nothing was signed' using errcode = '22023'; end if;
  select * into o from public.patient_threshold_overrides where id = p_id for update;
  if not found then raise exception 'override not found' using errcode = '22023'; end if;
  v_staff := private.threshold_override_actor(o.patient_id);
  v_policy := private.threshold_override_policy();
  if v_policy is null then raise exception 'personal thresholds are not switched on: the Chief Medical Officer has not signed the policy' using errcode = '55000'; end if;
  if o.status <> 'draft' then raise exception 'only a proposed override can be signed' using errcode = '22023'; end if;
  if o.valid_days > (v_policy ->> 'maxDays')::int then raise exception 'the review period is longer than the policy allows' using errcode = '22023'; end if;
  v_why := private.threshold_override_ineligible(o.patient_id);
  if v_why is not null then raise exception '%', v_why using errcode = '22023'; end if;
  for v_old in select id from public.patient_threshold_overrides where patient_id = o.patient_id and domain = o.domain and status = 'active' loop
    update public.patient_threshold_overrides set status = 'superseded', ended_at = now(), ended_by = v_staff, end_reason = 'replaced by a newly signed override' where id = v_old;
    perform private.threshold_override_event(v_old, 'superseded', v_staff, '{}'::jsonb);
  end loop;
  v_expires := now() + make_interval(days => o.valid_days);
  update public.patient_threshold_overrides
     set status = 'active', signed_by = v_staff, signed_at = now(), expires_at = v_expires,
         review_due_at = least(v_expires, now() + make_interval(days => (v_policy ->> 'reviewDays')::int)), policy_version = (select version from public.threshold_override_policies where is_active)
   where id = p_id;
  perform private.threshold_override_event(p_id, 'signed', v_staff, jsonb_build_object('expiresAt', v_expires));
  perform private.log_audit('threshold_override.signed', 'patient_threshold_overrides', p_id, jsonb_build_object('domain', o.domain));
end $$;
revoke all on function public.sign_threshold_override(uuid, text) from public, anon;
grant execute on function public.sign_threshold_override(uuid, text) to authenticated;

-- Ending an override is a stop-only action: the active Chief Medical Officer of the patient's organisation may end any override (oversight) without a tie;
-- any other doctor needs authority and a tie. Keeping or proposing one always needs the tie (private.threshold_override_actor).
create function private.threshold_override_overseer(p_patient uuid) returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid; v_staff uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.organisation_id = v_org and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is not null then return v_staff; end if;
  return private.threshold_override_actor(p_patient);
end $$;
revoke all on function private.threshold_override_overseer(uuid) from public, anon, authenticated;

create function public.revoke_threshold_override(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.patient_threshold_overrides%rowtype; v_staff uuid;
begin
  select * into o from public.patient_threshold_overrides where id = p_id for update;
  if not found then raise exception 'override not found' using errcode = '22023'; end if;
  v_staff := private.threshold_override_overseer(o.patient_id);
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if o.status not in ('draft', 'active') then raise exception 'this override has already ended' using errcode = '22023'; end if;
  update public.patient_threshold_overrides set status = 'revoked', ended_at = now(), ended_by = v_staff, end_reason = btrim(p_reason) where id = p_id;
  perform private.threshold_override_event(p_id, 'revoked', v_staff, '{}'::jsonb);
  perform private.log_audit('threshold_override.revoked', 'patient_threshold_overrides', p_id, '{}'::jsonb);
end $$;
revoke all on function public.revoke_threshold_override(uuid, text) from public, anon;
grant execute on function public.revoke_threshold_override(uuid, text) to authenticated;

-- The monthly review: continue (the review date moves on, the expiry does not: a longer run is a new signed override) or revoke.
create function public.review_threshold_override(p_id uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.patient_threshold_overrides%rowtype; v_staff uuid; v_policy jsonb;
begin
  select * into o from public.patient_threshold_overrides where id = p_id for update;
  if not found then raise exception 'override not found' using errcode = '22023'; end if;
  if p_outcome not in ('continue', 'revoke') then raise exception 'outcome must be continue or revoke' using errcode = '22023'; end if;
  v_staff := case when p_outcome = 'revoke' then private.threshold_override_overseer(o.patient_id) else private.threshold_override_actor(o.patient_id) end;
  if o.status <> 'active' or o.expires_at <= now() then raise exception 'only a live override can be reviewed' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'a review note is required' using errcode = '22023'; end if;
  if p_outcome = 'revoke' then
    update public.patient_threshold_overrides set status = 'revoked', ended_at = now(), ended_by = v_staff, end_reason = 'revoked at review: ' || btrim(p_note), last_reviewed_at = now() where id = p_id;
    perform private.threshold_override_event(p_id, 'revoked', v_staff, jsonb_build_object('atReview', true));
  else
    v_policy := private.threshold_override_policy();
    if v_policy is null then raise exception 'personal thresholds are not switched on: the Chief Medical Officer has not signed the policy' using errcode = '55000'; end if;
    update public.patient_threshold_overrides set last_reviewed_at = now(), review_due_at = least(o.expires_at, now() + make_interval(days => (v_policy ->> 'reviewDays')::int)) where id = p_id;
    perform private.threshold_override_event(p_id, 'reviewed', v_staff, jsonb_build_object('outcome', 'continue'));
  end if;
  perform private.log_audit('threshold_override.reviewed', 'patient_threshold_overrides', p_id, jsonb_build_object('outcome', p_outcome));
end $$;
revoke all on function public.review_threshold_override(uuid, text, text) from public, anon;
grant execute on function public.review_threshold_override(uuid, text, text) to authenticated;

-- CMO oversight: every live or recently ended override in the organisation, with who set it and whether its review is overdue. Audited.
create function public.list_threshold_overrides_for_oversight() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_rows jsonb;
begin
  select cs.organisation_id into v_org from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_org is null then raise exception 'not authorised: only the active Chief Medical Officer can review personal thresholds across the organisation' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'patientId', o.patient_id, 'domain', o.domain, 'params', o.params, 'reason', o.reason, 'status', o.status,
      'proposedBy', ps.full_name, 'signedBy', ss.full_name, 'signedAt', o.signed_at, 'expiresAt', o.expires_at, 'reviewDueAt', o.review_due_at,
      'lastReviewedAt', o.last_reviewed_at, 'endedAt', o.ended_at, 'endReason', o.end_reason,
      'reviewOverdue', (o.status = 'active' and o.review_due_at <= now()), 'isTest', o.is_test,
      'appliedCount', (select count(*) from public.triage_override_applications a where a.override_id = o.id)
    ) order by (o.status = 'active') desc, o.review_due_at nulls last, o.created_at desc), '[]'::jsonb)
    into v_rows
    from public.patient_threshold_overrides o
    left join public.clinical_staff ps on ps.id = o.proposed_by
    left join public.clinical_staff ss on ss.id = o.signed_by
   where o.organisation_id = v_org and (o.status in ('draft', 'active') or o.ended_at > now() - interval '30 days');
  perform private.log_audit('threshold_override.oversight_listed', 'patient_threshold_overrides', null, jsonb_build_object('count', jsonb_array_length(v_rows)));
  -- one audit row per override read, so who looked at which patient's setting is on record
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    select v_org, (select auth.uid()), 'threshold_override.oversight_read', 'patient_threshold_overrides', (e ->> 'id')::uuid, jsonb_build_object('patient_id', e ->> 'patientId')
      from jsonb_array_elements(v_rows) e;
  return v_rows;
end $$;
revoke all on function public.list_threshold_overrides_for_oversight() from public, anon;
grant execute on function public.list_threshold_overrides_for_oversight() to authenticated;

-- The hub's counts: how many are live and how many reviews are overdue, and whether the policy is signed. CMO only, counts only (not audited per page load).
create function public.threshold_override_oversight_counts() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid;
begin
  select cs.organisation_id into v_org from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_org is null then raise exception 'not authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'policyActive', private.threshold_override_policy() is not null,
    'policyVersionWaiting', (select version from public.threshold_override_policies where not is_active order by version desc limit 1),
    'policyIdWaiting', (select id from public.threshold_override_policies where not is_active order by version desc limit 1),
    'active', (select count(*) from public.patient_threshold_overrides where organisation_id = v_org and status = 'active' and expires_at > now()),
    'reviewsOverdue', (select count(*) from public.patient_threshold_overrides where organisation_id = v_org and status = 'active' and expires_at > now() and review_due_at <= now()),
    'reviewTaskFailures7d', (select count(*) from public.patient_threshold_override_events where organisation_id = v_org and event = 'review_task_failed' and created_at > now() - interval '7 days'));
end $$;
revoke all on function public.threshold_override_oversight_counts() from public, anon;
grant execute on function public.threshold_override_oversight_counts() to authenticated;

-- The patient-facing note: only whether the care team has set personal targets. Never a number, a domain or a reason (INV-07).
create function public.my_threshold_override_notice() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.patient_threshold_overrides o
                  where o.patient_id = (select auth.uid()) and o.status = 'active' and o.expires_at > now() and private.threshold_override_policy() is not null)
$$;
revoke all on function public.my_threshold_override_notice() from public, anon;
grant execute on function public.my_threshold_override_notice() to authenticated;

-- Service role only: what the process-events handler needs.
create function public.triage_active_override_for_observation(p_observation_id uuid, p_domain text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', o.id, 'domain', o.domain, 'params', o.params, 'signedAt', o.signed_at, 'expiresAt', o.expires_at)
    from public.vitals_readings v
    join public.patient_threshold_overrides o on o.patient_id = v.patient_id and o.domain = p_domain and o.status = 'active' and o.signed_at is not null and o.expires_at > now()
   where v.id = p_observation_id and private.threshold_override_policy() is not null
$$;

create function public.record_triage_override_application(p_observation_id uuid, p_domain text, p_result jsonb, p_rule_set_id uuid, p_basis text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare e public.triage_events%rowtype; ov jsonb := p_result -> 'override'; o public.patient_threshold_overrides%rowtype; v_n integer;
begin
  if ov is null then return jsonb_build_object('created', false); end if;
  select * into e from public.triage_events where trigger_type = 'observation' and trigger_id = p_observation_id and rule_set_id = p_rule_set_id and basis = coalesce(p_basis, '');
  if not found then raise exception 'record_triage_override_application: no triage event for this reading yet' using errcode = 'P0002'; end if;
  select * into o from public.patient_threshold_overrides where id = (ov ->> 'overrideId')::uuid;
  if not found or o.patient_id is distinct from e.patient_id or o.domain <> p_domain then raise exception 'record_triage_override_application: override does not belong to this patient and domain' using errcode = '22023'; end if;
  -- The grade already stored came from an earlier delivery (before the override was signed, or after it lapsed): the override did not produce it, so it is not recorded as having.
  if e.grade is distinct from (ov ->> 'finalGrade') then return jsonb_build_object('created', false, 'reason', 'stored_grade_differs'); end if;
  insert into public.triage_override_applications (triage_event_id, override_id, organisation_id, patient_id, domain, direction, parameters, default_grade, default_rule_id, final_grade, final_rule_id, shadow, is_test)
    values (e.id, o.id, e.organisation_id, e.patient_id, p_domain, ov ->> 'direction',
            coalesce((select array_agg(x) from jsonb_array_elements_text(ov -> 'parameters') x), '{}'), ov ->> 'defaultGrade', ov ->> 'defaultRuleId', ov ->> 'finalGrade', ov ->> 'finalRuleId', e.shadow, e.is_test)
    on conflict (triage_event_id) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('created', v_n = 1);
end $$;

revoke all on function public.triage_active_override_for_observation(uuid, text) from public, anon, authenticated;
revoke all on function public.record_triage_override_application(uuid, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.triage_active_override_for_observation(uuid, text) to service_role;
grant execute on function public.record_triage_override_application(uuid, text, jsonb, uuid, text) to service_role;

-- 5. Monthly review task + daily lapse sweep ---------------------------------------------------------------------------------------------
-- task-types-threshold-override-begin
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('threshold_override_review', 1, 8, 4320, 'senior_medical_officer', '{}', 0, 30, false, true, '{}',
   'N-overrides: a personal threshold is due its monthly review. Routine, never an alarm, never pushed. Holds no reading or target (INV-07).');
-- task-types-threshold-override-end

create function private.sweep_threshold_override_reviews() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; v_policy jsonb := private.threshold_override_policy(); n integer := 0;
begin
  for r in select id from public.patient_threshold_overrides where status = 'active' and expires_at <= now() for update loop
    update public.patient_threshold_overrides set status = 'lapsed', ended_at = now(), end_reason = 'expired' where id = r.id;
    perform private.threshold_override_event(r.id, 'lapsed', null, '{}'::jsonb);
  end loop;
  if v_policy is null then return 0; end if;
  for r in select o.id, o.patient_id, o.review_due_at from public.patient_threshold_overrides o
            where o.status = 'active' and o.review_due_at <= now()
              and not exists (select 1 from public.patient_threshold_override_events e where e.override_id = o.id and e.event = 'review_task_created' and (e.detail ->> 'dueAt')::timestamptz = o.review_due_at) loop
    begin
      perform private.create_clinical_task(r.patient_id, 'threshold_override_review', (v_policy ->> 'reviewTaskDueMinutes')::int,
                                           'threshold_override_review:' || r.id || ':' || (r.review_due_at at time zone 'Africa/Lagos')::date, null, null, null);
      perform private.threshold_override_event(r.id, 'review_task_created', null, jsonb_build_object('dueAt', r.review_due_at));
      n := n + 1;
    exception when others then
      if sqlstate in ('57014', '57P01') then raise; end if;   -- a cancelled or shut-down statement is not a task failure
      -- visible, not silent: the CMO page counts these, and the roster shows the review as overdue whatever the task layer does
      perform private.threshold_override_event(r.id, 'review_task_failed', null, jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end loop;
  return n;
end $$;
revoke all on function private.sweep_threshold_override_reviews() from public, anon, authenticated;
-- One start time that no other job uses (06:12 UTC = 07:12 Lagos); one connection a day.
select cron.schedule('threshold-override-review-daily', '12 6 * * *', $$select private.sweep_threshold_override_reviews()$$);

-- 6. Self-check -------------------------------------------------------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(f, ', ') into v_bad from unnest(array[
    'public.triage_active_override_for_observation(uuid, text)', 'public.record_triage_override_application(uuid, text, jsonb, uuid, text)',
    'private.sweep_threshold_override_reviews()', 'private.threshold_override_policy()']) f
   where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE');
  if v_bad is not null then raise exception 'N-overrides: service-only functions are callable by anon or authenticated: %', v_bad; end if;
  select string_agg(f, ', ') into v_bad from unnest(array[
    'public.propose_threshold_override(uuid, text, jsonb, text, integer)', 'public.sign_threshold_override(uuid, text)', 'public.revoke_threshold_override(uuid, text)',
    'public.review_threshold_override(uuid, text, text)', 'public.list_threshold_overrides_for_oversight()', 'public.threshold_override_oversight_counts()', 'public.my_threshold_override_notice()',
    'public.sign_threshold_override_policy(uuid, text)', 'public.withdraw_threshold_override_policy(text)']) f
   where has_function_privilege('anon', f, 'EXECUTE') or not has_function_privilege('authenticated', f, 'EXECUTE');
  if v_bad is not null then raise exception 'N-overrides: a doctor-facing function has the wrong grants: %', v_bad; end if;
  if (select count(*) from public.threshold_override_policies where is_active) <> 0 then raise exception 'N-overrides: the policy must be born unsigned and inactive'; end if;
  if has_table_privilege('anon', 'public.patient_threshold_overrides', 'SELECT') or has_table_privilege('authenticated', 'public.patient_threshold_overrides', 'INSERT') then
    raise exception 'N-overrides: table grants are wrong';
  end if;
end $$;
