-- A sponsor may see clinical data. Only if the patient says so, and only ever
-- read it.
--
-- Founder decision, 2026-07-31, answering the open question left by the
-- diaspora sponsor build ("whether a sponsor should ever see clinical data, not
-- just cost"): yes to seeing, no to editing, and the patient approves it
-- themselves in the app and can withdraw it the same way.
--
-- The consent is deliberately NOT the profile_access grant itself. A next of
-- kin nominated so that somebody can be reached in an emergency has consented
-- to being reachable; they have not thereby consented to a reader of their
-- record. So visibility is a second, separate switch on the same row, off at
-- creation, flipped only by the person whose record it is.
--
-- Row counts before this migration: profile_access 0, vitals_readings 0. This
-- is a pure structural change with nothing to convert.

alter table public.profile_access
  add column if not exists clinical_access boolean not null default false,
  add column if not exists clinical_access_updated_at timestamptz;

comment on column public.profile_access.clinical_access is
  'The record owner has approved this grantee seeing their health information. Read only: every write policy on every clinical table still requires the patient themselves or org staff. Set only by the owner, enforced by private.enforce_clinical_access_consent_owner.';

-- Consent is the record owner's own act, and nobody else's.
--
-- profile_access_update already admits private.is_admin(), so without this a
-- superadmin could appoint a reader of any patient's record. It also admits
-- nothing for the grantee, but a trigger that names the owner explicitly is
-- clearer than one that relies on the policy staying that way.
create or replace function private.enforce_clinical_access_consent_owner()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    -- A new grant never carries health visibility, however it was created
    -- (next of kin, eldercare accept, child dependant). Turning it on is a
    -- separate, deliberate, later act by the owner.
    new.clinical_access := false;
    new.clinical_access_updated_at := null;
    return new;
  end if;

  if new.clinical_access is distinct from old.clinical_access then
    if v_uid is null or v_uid is distinct from old.profile_id then
      raise exception
        'only the person whose record it is may change who can see their health information'
        using errcode = '42501';
    end if;
    new.clinical_access_updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists profile_access_clinical_consent on public.profile_access;
create trigger profile_access_clinical_consent
  before insert or update on public.profile_access
  for each row execute function private.enforce_clinical_access_consent_owner();

-- The single predicate every clinical read policy below shares, so that
-- withdrawing consent is one UPDATE and not a hunt through six tables.
--
-- Invoker rights on purpose: called from a policy it is evaluated as the
-- caller, and profile_access_select already lets a grantee see their own grant
-- row, so the EXISTS resolves under RLS exactly as the inlined version used by
-- lab_analyte_readings and patient_timeline does.
create or replace function private.can_read_clinical(p_patient uuid)
returns boolean
language sql
stable
set search_path to ''
as $$
  select exists (
    select 1
    from public.profile_access pa
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and pa.clinical_access
  );
$$;

-- Read, and only read.
--
-- Each of these six tables' SELECT policy was exactly
--   (patient_id = auth.uid()) or private.is_org_staff(organisation_id)
-- confirmed live before this migration. One clause is added; nothing is
-- removed. The INSERT/UPDATE/DELETE policies are deliberately untouched, which
-- is what makes "can see it, cannot change it" structural rather than a
-- convention the UI happens to follow.
--
-- Deliberately NOT included, flagged rather than guessed at: screening_results
-- and escalations/clinician_alerts. Those carry the raw abnormal-result detail
-- and the escalation reasoning, which is a heavier disclosure than "here is
-- her blood pressure and what she is taking" and deserves its own decision.
drop policy if exists vitals_readings_select on public.vitals_readings;
create policy vitals_readings_select on public.vitals_readings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists care_plans_select on public.care_plans;
create policy care_plans_select on public.care_plans
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists medications_select on public.medications;
create policy medications_select on public.medications
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists screening_schedules_select on public.screening_schedules;
create policy screening_schedules_select on public.screening_schedules
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists lab_orders_select on public.lab_orders;
create policy lab_orders_select on public.lab_orders
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists patient_risk_scores_select on public.patient_risk_scores;
create policy patient_risk_scores_select on public.patient_risk_scores
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

-- The migration is the test.
do $$
declare
  v_read int;
  v_write int;
begin
  select count(*) into v_read
  from pg_policies
  where schemaname = 'public'
    and cmd = 'SELECT'
    and tablename in ('vitals_readings', 'care_plans', 'medications',
                      'screening_schedules', 'lab_orders', 'patient_risk_scores')
    and qual like '%can_read_clinical%';
  if v_read <> 6 then
    raise exception 'expected 6 consent-gated read policies, found %', v_read;
  end if;

  -- If this ever fires, a sponsor has been given a write path by accident.
  select count(*) into v_write
  from pg_policies
  where schemaname = 'public'
    and cmd <> 'SELECT'
    and (coalesce(qual, '') || coalesce(with_check, '')) like '%can_read_clinical%';
  if v_write > 0 then
    raise exception 'can_read_clinical must never gate a write policy, found %', v_write;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'profile_access_clinical_consent' and not tgisinternal
  ) then
    raise exception 'consent-owner trigger missing';
  end if;
end $$;
