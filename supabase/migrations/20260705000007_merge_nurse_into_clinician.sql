-- Tarragon Health
-- 07 · Merge the 'nurse' role into 'clinician'
--
-- One frontline clinical role ('clinician') now covers both routine
-- monitoring/worklist review and escalation review — there is no longer a
-- separate 'nurse' role. This migration ALTERs the schema created by
-- 20260705000001-20260705000003 rather than editing those files in place,
-- since they may already be applied to a live project (editing an
-- already-applied migration file has no effect — `supabase db push` only
-- runs migrations it hasn't recorded yet).
--
-- Renamed for consistency with the merged role (no functional change other
-- than the enum drop):
--   user_role:    drop 'nurse' (existing 'nurse' rows become 'clinician')
--   alert_level:  'nurse_review' -> 'clinician_review',
--                 'doctor_escalation' -> 'urgent_escalation'
--   nurse_alerts                      -> clinician_alerts
--   care_plans.assigned_nurse_id      -> assigned_clinician_id
--   escalations.nurse_alert_id        -> clinician_alert_id
--   escalations.assigned_doctor_id    -> assigned_clinician_id
--   screening_upgrades.handled_by_nurse_id -> handled_by_clinician_id

-- ---------------------------------------------------------------------------
-- alert_level: rename the two enum values (native RENAME VALUE, PG10+)
-- ---------------------------------------------------------------------------

alter type public.alert_level rename value 'nurse_review' to 'clinician_review';
alter type public.alert_level rename value 'doctor_escalation' to 'urgent_escalation';

-- ---------------------------------------------------------------------------
-- nurse_alerts -> clinician_alerts (table, indexes, trigger, RLS policies)
-- ---------------------------------------------------------------------------

alter table public.nurse_alerts rename to clinician_alerts;

alter index nurse_alerts_org_status_idx rename to clinician_alerts_org_status_idx;
alter index nurse_alerts_patient_idx rename to clinician_alerts_patient_idx;
alter index nurse_alerts_acknowledged_by_idx rename to clinician_alerts_acknowledged_by_idx;

alter trigger nurse_alerts_set_updated_at on public.clinician_alerts
  rename to clinician_alerts_set_updated_at;

alter policy nurse_alerts_select on public.clinician_alerts rename to clinician_alerts_select;
alter policy nurse_alerts_insert on public.clinician_alerts rename to clinician_alerts_insert;
alter policy nurse_alerts_update on public.clinician_alerts rename to clinician_alerts_update;
alter policy nurse_alerts_delete on public.clinician_alerts rename to clinician_alerts_delete;

-- ---------------------------------------------------------------------------
-- care_plans.assigned_nurse_id -> assigned_clinician_id
-- ---------------------------------------------------------------------------

alter table public.care_plans rename column assigned_nurse_id to assigned_clinician_id;
alter table public.care_plans
  rename constraint care_plans_assigned_nurse_id_fkey to care_plans_assigned_clinician_id_fkey;
alter index care_plans_assigned_nurse_idx rename to care_plans_assigned_clinician_idx;

-- ---------------------------------------------------------------------------
-- escalations: nurse_alert_id -> clinician_alert_id, assigned_doctor_id -> assigned_clinician_id
-- ---------------------------------------------------------------------------

alter table public.escalations rename column nurse_alert_id to clinician_alert_id;
alter table public.escalations
  rename constraint escalations_nurse_alert_id_fkey to escalations_clinician_alert_id_fkey;
alter index escalations_nurse_alert_idx rename to escalations_clinician_alert_idx;

alter table public.escalations rename column assigned_doctor_id to assigned_clinician_id;
alter table public.escalations
  rename constraint escalations_assigned_doctor_id_fkey to escalations_assigned_clinician_id_fkey;
alter index escalations_assigned_doctor_idx rename to escalations_assigned_clinician_idx;

-- ---------------------------------------------------------------------------
-- screening_upgrades.handled_by_nurse_id -> handled_by_clinician_id
-- ---------------------------------------------------------------------------

alter table public.screening_upgrades
  rename column handled_by_nurse_id to handled_by_clinician_id;
alter table public.screening_upgrades
  rename constraint screening_upgrades_handled_by_nurse_id_fkey
  to screening_upgrades_handled_by_clinician_id_fkey;
alter index screening_upgrades_nurse_idx rename to screening_upgrades_clinician_idx;

-- ---------------------------------------------------------------------------
-- private.handle_abnormal_screening_result(): now inserts 'urgent_escalation'
-- into clinician_alerts (table/value already renamed above; the function
-- body referenced the old names literally, so it must be redefined).
-- ---------------------------------------------------------------------------

create or replace function private.handle_abnormal_screening_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condition public.upgrade_condition := 'other';
  v_upgrade_id uuid;
begin
  if new.result_status not in ('abnormal', 'critical') then
    return new;
  end if;

  if new.abnormal_flags && array['bp', 'blood_pressure', 'hypertension'] then
    v_condition := 'hypertension';
  elsif new.abnormal_flags && array['glucose', 'hba1c', 'diabetes'] then
    v_condition := 'diabetes';
  elsif new.abnormal_flags && array['psa', 'cancer', 'mammography', 'cervical', 'fit'] then
    v_condition := 'cancer_referral';
  end if;

  insert into public.screening_upgrades
    (organisation_id, patient_id, screening_result_id, condition_triggered)
  values
    (new.organisation_id, new.patient_id, new.id, v_condition)
  returning id into v_upgrade_id;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at)
  values (
    new.organisation_id,
    new.patient_id,
    'urgent_escalation',
    'open',
    'Priority 1: abnormal screening result',
    format('Screening result %s flagged %s; condition inferred: %s.',
           new.id, coalesce(array_to_string(new.abnormal_flags, ', '), 'none'), v_condition),
    now() + interval '4 hours'
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- user_role: drop 'nurse'. Postgres has no native DROP VALUE for enums, so
-- swap the type: rename the old one out of the way, create the new one
-- without 'nurse', migrate the column, then drop the old type. Existing
-- 'nurse' rows become 'clinician'.
-- ---------------------------------------------------------------------------

alter type public.user_role rename to user_role_old;

create type public.user_role as enum (
  'patient', 'clinician', 'admin', 'hmo_admin', 'corporate_admin'
);

alter table public.profiles alter column role drop default;

alter table public.profiles
  alter column role type public.user_role
  using (
    case when role::text = 'nurse' then 'clinician' else role::text end
  )::public.user_role;

alter table public.profiles alter column role set default 'patient'::public.user_role;

-- Functions that reference public.user_role by name must be redefined so
-- they rebind to the new type (their old definitions still point at the
-- renamed user_role_old).
create or replace function private.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, organisation_id, full_name, phone)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'patient'),
    (new.raw_app_meta_data ->> 'organisation_id')::uuid,
    new.raw_user_meta_data ->> 'full_name',
    new.phone
  );
  return new;
end;
$$;

drop type public.user_role_old;
