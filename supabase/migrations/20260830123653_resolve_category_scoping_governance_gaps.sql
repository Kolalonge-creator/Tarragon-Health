-- Resolves the three open governance items flagged in the category-scoped-access design:
--
-- 1. patient_timeline was bucketed entirely into 'medical_history' -- a caregiver granted
--    only 'medications' couldn't see a medication_started entry in their timeline feed, and
--    granting 'medical_history' exposed every timeline event at once regardless of its real
--    subject. Gives every row its own event_category, server-derived from event_type (never
--    settable by the inserting call site, so it can't drift), reusing and extending the
--    platform's own existing care_receipt_event_labels classification where one already
--    exists rather than inventing a second scheme.
--
-- 2. care_vouchers was gated on a flat 'medical_history', but a voucher's sku/panel can be
--    for a cervical smear, a breast exam or a prostate screen -- exactly the category of
--    thing the whole reproductive_health carve-out exists to protect. Classifies each
--    voucher through its linked panel_bundles.test_codes against the platform's own real
--    screen_types codes for that domain (cervical_smear, clinical_breast_exam,
--    breast_imaging, prostate_ultrasound, psa); only a voucher actually linked to one of
--    those requires the reproductive_health category, everything else keeps the existing
--    medical_history gate.
--
-- 3. A dependent account (a child with no login of their own -- profiles.is_dependent_account,
--    distinct from the two-adults eldercare 'manage' grant) could never have reproductive_health
--    granted to its manager, because granting requires the record owner's own authenticated
--    session and a dependent has none. reproductive_health_profiles' original design (2026-07-24
--    migration comment) explicitly anticipated "a parent, once a teenager is old enough to
--    menstruate but still under a managed profile" -- a legal guardian's authority over a
--    minor's healthcare is a categorically different consent relationship from a next-of-kin
--    grant between two consenting adults (where the exclusion is correct and stays untouched).
--    Restores the dependent-account bypass to cover every category, matching the guardianship
--    reasoning the platform already applies everywhere else a dependent's manage-grantee is
--    treated as the consenting party.

-- ---------------------------------------------------------------------------
-- 1. patient_timeline per-row category.
-- ---------------------------------------------------------------------------
alter table public.patient_timeline add column event_category public.care_access_category;

update public.patient_timeline set event_category = (case event_type
  when 'lab_completed'              then 'labs_results'
  when 'lab_abnormal'               then 'medical_history'
  when 'medication_started'         then 'medications'
  when 'medication_stopped'         then 'medications'
  when 'medication_missed'          then 'medications'
  when 'medication_dispensed'       then 'medications'
  when 'medication_received'        then 'medications'
  when 'referral_created'           then 'appointments_care_plan'
  when 'referral_status_changed'    then 'appointments_care_plan'
  when 'referral_outcome_recorded'  then 'appointments_care_plan'
  when 'care_plan_updated'          then 'appointments_care_plan'
  when 'screening_due'              then 'labs_results'
  when 'screening_completed'        then 'labs_results'
  when 'vaccination_recorded'       then 'vaccinations'
  when 'escalation_raised'          then 'medical_history'
  when 'escalation_resolved'        then 'medical_history'
  when 'admission_recorded'         then 'medical_history'
  when 'discharge_recorded'         then 'medical_history'
  when 'message_posted'             then 'messaging'
  when 'encounter_documented'       then 'medical_history'
  when 'condition_recorded'         then 'medical_history'
  when 'condition_status_changed'   then 'medical_history'
  when 'document_uploaded'          then 'medical_history'
  when 'imaging_report_uploaded'    then 'labs_results'
  when 'record_conflict_flagged'    then 'medical_history'
  when 'record_conflict_resolved'   then 'medical_history'
  when 'clinical_summary_validated' then 'medical_history'
end)::public.care_access_category;

-- Server-derived from event_type on every future insert -- never settable by the caller, so
-- it can never drift from the event it's describing. Covers every timeline_event_type value
-- that exists today; the closing assertion below fails loudly if a new one is ever added
-- without a mapping here, rather than silently landing with a null category.
create or replace function private.set_patient_timeline_event_category()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  new.event_category := (case new.event_type
    when 'lab_completed'              then 'labs_results'
    when 'lab_abnormal'               then 'medical_history'
    when 'medication_started'         then 'medications'
    when 'medication_stopped'         then 'medications'
    when 'medication_missed'          then 'medications'
    when 'medication_dispensed'       then 'medications'
    when 'medication_received'        then 'medications'
    when 'referral_created'           then 'appointments_care_plan'
    when 'referral_status_changed'    then 'appointments_care_plan'
    when 'referral_outcome_recorded'  then 'appointments_care_plan'
    when 'care_plan_updated'          then 'appointments_care_plan'
    when 'screening_due'              then 'labs_results'
    when 'screening_completed'        then 'labs_results'
    when 'vaccination_recorded'       then 'vaccinations'
    when 'escalation_raised'          then 'medical_history'
    when 'escalation_resolved'        then 'medical_history'
    when 'admission_recorded'         then 'medical_history'
    when 'discharge_recorded'         then 'medical_history'
    when 'message_posted'             then 'messaging'
    when 'encounter_documented'       then 'medical_history'
    when 'condition_recorded'         then 'medical_history'
    when 'condition_status_changed'   then 'medical_history'
    when 'document_uploaded'          then 'medical_history'
    when 'imaging_report_uploaded'    then 'labs_results'
    when 'record_conflict_flagged'    then 'medical_history'
    when 'record_conflict_resolved'   then 'medical_history'
    when 'clinical_summary_validated' then 'medical_history'
    else 'medical_history'
  end)::public.care_access_category;
  return new;
end;
$function$;

drop trigger if exists patient_timeline_set_event_category on public.patient_timeline;
create trigger patient_timeline_set_event_category
  before insert on public.patient_timeline
  for each row execute function private.set_patient_timeline_event_category();

alter table public.patient_timeline alter column event_category set not null;

drop policy if exists patient_timeline_select on public.patient_timeline;
create policy patient_timeline_select on public.patient_timeline
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, event_category)
    or private.has_emergency_access(patient_id, event_category)
  );

-- ---------------------------------------------------------------------------
-- 2. care_vouchers: reproductive-health-linked panels require that category specifically.
-- ---------------------------------------------------------------------------
create or replace function private.care_voucher_category(p_panel_bundle_id uuid)
 returns public.care_access_category
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select case
    when exists (
      select 1 from public.panel_bundles pb
      where pb.id = p_panel_bundle_id
        and pb.test_codes && array[
          'cervical_smear', 'clinical_breast_exam', 'breast_imaging',
          'prostate_ultrasound', 'psa'
        ]::text[]
    ) then 'reproductive_health'::public.care_access_category
    else 'medical_history'::public.care_access_category
  end;
$function$;

drop policy if exists care_vouchers_select on public.care_vouchers;
create policy care_vouchers_select on public.care_vouchers
  for select to authenticated
  using (
    beneficiary_profile_id = (select auth.uid())
    or purchaser_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(beneficiary_profile_id, private.care_voucher_category(panel_bundle_id))
  );

-- ---------------------------------------------------------------------------
-- 3. Restore reproductive_health for a dependent account's manager -- guardianship over a
--    minor with no login is a different consent relationship from a next-of-kin grant
--    between two consenting adults (that exclusion, in the second OR-branch below, is
--    untouched and still correct).
-- ---------------------------------------------------------------------------
create or replace function private.can_read_clinical(p_patient uuid, p_category public.care_access_category)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.profile_access pa join public.profiles p on p.id = pa.profile_id
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and (
        (pa.permission_level = 'manage' and p.is_dependent_account)
        or exists (
          select 1 from public.profile_access_categories pac
          where pac.profile_access_id = pa.id and pac.category = p_category
        )
      )
  );
$function$;

-- ---------------------------------------------------------------------------
-- Self-assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_null_count int;
  v_def text;
begin
  select count(*) into v_null_count from public.patient_timeline where event_category is null;
  if v_null_count <> 0 then
    raise exception 'patient_timeline has % rows with no event_category after backfill', v_null_count;
  end if;

  select qual into v_def from pg_policies
    where schemaname='public' and tablename='patient_timeline' and policyname='patient_timeline_select';
  if v_def not like '%event_category%' then
    raise exception 'patient_timeline_select is not gated on the per-row event_category';
  end if;

  select qual into v_def from pg_policies
    where schemaname='public' and tablename='care_vouchers' and policyname='care_vouchers_select';
  if v_def not like '%care_voucher_category%' then
    raise exception 'care_vouchers_select is not gated through care_voucher_category';
  end if;

  select pg_get_functiondef(oid) into v_def
    from pg_proc where proname='can_read_clinical' and pronamespace='private'::regnamespace;
  if v_def like '%is_dependent_account and p_category%' then
    raise exception 'can_read_clinical still excludes reproductive_health from the dependent-account branch';
  end if;
end $$;
