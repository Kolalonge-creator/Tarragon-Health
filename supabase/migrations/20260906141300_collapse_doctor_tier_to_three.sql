-- Tarragon Health
-- Collapse the 5-tier doctor_tier ladder (+ orthogonal is_clinical_director
-- flag) down to 3 tiers: medical_officer, senior_medical_officer,
-- chief_medical_officer. care_coordinator (the non-clinical floor) is
-- unchanged. Founder decision 2026-08-31.
--
-- Mapping:
--   tier_1, tier_2                                  -> medical_officer
--   tier_3, tier_4_senior_registrar,
--     tier_5_partner_specialist                     -> senior_medical_officer
--   any row with is_clinical_director = true        -> chief_medical_officer
--     (overrides whatever doctor_tier it had; is_clinical_director column
--     is then dropped -- director/governance authority is now intrinsic to
--     the top tier, not an orthogonal flag)
--
-- Real-data check before writing this migration (project koiplnmbgnqnbywhpjlf):
-- 8 active clinical_staff rows total -- 1 care_coordinator, 1 tier_1,
-- 2 tier_2, 1 tier_3, 1 tier_4_senior_registrar, 1 tier_5_partner_specialist,
-- 1 director-only (doctor_tier null, is_clinical_director true). No inactive
-- rows exist. This is the QA test roster
-- (project_qa_test_accounts_20260727), not real patient-facing staff.
-- clinical_staff_indemnity_exemptions has exactly one live row (the
-- founder's org-wide director exemption, doctor_tier null,
-- applies_to_director true) -- no tier-scoped exemption exists, so there is
-- no collision risk collapsing tier_4_senior_registrar/
-- tier_5_partner_specialist exemption scope into a single
-- senior_medical_officer scope. case_review_actions.confirmed_at_tier and
-- fhir_import_proposed_resources.confirmed_at_tier are both empty (0 rows).
-- clinical_incident_reports.reviewed_by_tier has 3 rows: 2 null, 1 'tier_2'.
--
-- KNOWN BEHAVIOUR CHANGE, confirmed with the founder before writing this:
-- today's tier_1 cannot initiate a new prescription; tier_2 can. Both
-- collapse into medical_officer, which does NOT have prescribing authority
-- (only senior_medical_officer+ does) -- matches the new tier's "standard
-- protocol-driven consultations, refers to Senior on difficulty"
-- description. The 2 live tier_2 QA accounts lose prescribing authority the
-- moment this migration runs, until an admin re-tiers them to
-- senior_medical_officer.
--
-- Dependency audit done before writing this (queried live, not assumed):
--   - Every column of type public.doctor_tier: clinical_staff.doctor_tier,
--     clinical_staff_indemnity_exemptions.doctor_tier,
--     case_review_actions.confirmed_at_tier,
--     clinical_incident_reports.reviewed_by_tier,
--     fhir_import_proposed_resources.confirmed_at_tier -- all five migrated
--     below via ALTER COLUMN TYPE ... USING, same technique as
--     20260803005139_merge_doctor_into_clinician.sql.
--   - Exactly one RLS policy references is_clinical_director directly (not
--     through a private.* wrapper): emergency_record_access_grants_select.
--     Every other policy goes through a private.* function. No CHECK
--     constraint references doctor_tier/is_clinical_director except the
--     single_scope one on clinical_staff_indemnity_exemptions, already
--     handled above. (case_review_actions_proposed_is_clean and
--     fhir_import_proposed_resources_proposed_is_clean depend on
--     confirmed_at_tier but don't reference its values, so they re-validate
--     trivially against both tables' zero live rows.)
--   - No view/matview depends on clinical_staff.doctor_tier or
--     .is_clinical_director (pg_depend swept, authoritatively via
--     refobjid/refobjsubid rather than a text search — the text-search sweep
--     above missed the policy dependency the first pass, because it was run
--     batched with two other queries and only the last one's results came
--     back; re-run standalone, then cross-checked against pg_depend directly
--     for every one of the five migrated columns).
--   - 62 functions reference doctor_tier or is_clinical_director in their
--     body (grepped live via pg_get_functiondef). Every one that gates on a
--     specific tier value or the director flag is redefined below; the
--     handful that only check "doctor_tier is not null"/"<> care_coordinator"
--     (already enum-agnostic) or display doctor_tier as a pass-through
--     report field are left untouched.
--   - clinical_staff_director_idx (partial index on is_clinical_director)
--     and clinical_staff_indemnity_exemptions_director_idx/_org_wide_idx
--     (partial unique indexes referencing applies_to_director) are
--     automatically dropped by Postgres when their columns are dropped
--     below; replacements are created explicitly where the access pattern
--     still exists.
--
-- Real gap this migration closes, found while designing "assigning cases to
-- other doctors" as a Chief Medical Officer governance capability: today
-- escalations.assigned_doctor_id and clinician_alerts.responsible_clinician_id/
-- backup_clinician_id can be set to ANY doctor by ANY org staff member --
-- RLS is the broad is_org_staff() policy, and the only narrowing is on
-- claiming/resolving your OWN work (private.is_clinical_tier/
-- can_handle_emergency_escalation), never on reassigning someone else's.
-- clinician_alerts ownership specifically has no trigger governing changes
-- at all today. Two new BEFORE UPDATE triggers close this: reassigning a
-- case to someone other than yourself now requires
-- doctor_tier = 'chief_medical_officer'; self-claim is unaffected.

-- ---------------------------------------------------------------------------
-- 1. New employment_type attribute. Needed because folding contracted
--    Partner Specialists (old tier_5) and the contracted Senior Registrar
--    (old tier_4) into the same senior_medical_officer value as employed
--    Senior Medical Officers (old tier_3) breaks the old indemnity rule,
--    which depended on tier alone: old tier_3 (employed) never needed
--    individual indemnity tracking (institutional policy), old tier_4/5
--    (contracted) did. Backfilled from OLD doctor_tier values, before the
--    enum swap below.
-- ---------------------------------------------------------------------------

create type public.staff_employment_type as enum ('employed', 'contracted');

alter table public.clinical_staff
  add column employment_type public.staff_employment_type not null default 'employed';

update public.clinical_staff
  set employment_type = 'contracted'
  where doctor_tier::text in ('tier_4_senior_registrar', 'tier_5_partner_specialist');

-- ---------------------------------------------------------------------------
-- 2. Swap the doctor_tier enum itself. Postgres has no ALTER TYPE ... DROP
--    VALUE and this is a genuine N:1 remap, not a rename -- rename the old
--    type out of the way, create the new 4-value type, migrate every column
--    that uses it via ALTER COLUMN TYPE ... USING, then drop the old type.
-- ---------------------------------------------------------------------------

alter type public.doctor_tier rename to doctor_tier_old;

create type public.doctor_tier as enum (
  'care_coordinator',
  'medical_officer',
  'senior_medical_officer',
  'chief_medical_officer'
);

-- The one RLS policy that references is_clinical_director directly (not
-- through a private.* wrapper) must be dropped before that column can be
-- dropped later -- Postgres tracks a pg_depend entry for a policy
-- expression referencing a column directly, same class of dependency as
-- 20260803005139_merge_doctor_into_clinician.sql hit for profiles.role.
-- Recreated verbatim except the flag reference, right after the enum swap
-- below.
drop policy emergency_record_access_grants_select on public.emergency_record_access_grants;

-- clinical_staff.doctor_tier -- the director flag (still present as a
-- column at this point) takes priority over whatever tier the row had.
alter table public.clinical_staff
  alter column doctor_tier type public.doctor_tier
  using (
    case
      when is_clinical_director then 'chief_medical_officer'
      when doctor_tier::text in ('tier_1', 'tier_2') then 'medical_officer'
      when doctor_tier::text in ('tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
        then 'senior_medical_officer'
      when doctor_tier::text = 'care_coordinator' then 'care_coordinator'
      else null
    end
  )::public.doctor_tier;

-- The three denormalized point-in-time snapshot columns -- no director
-- involvement, a plain tier remap. A historically-null value (e.g. an
-- action taken by a director with no tier assigned, under the old
-- orthogonal-flag model) stays null; there is no way to recover after the
-- fact whether that null meant "director" or "tier truly unset", same
-- information loss the old design already had.
alter table public.case_review_actions
  alter column confirmed_at_tier type public.doctor_tier
  using (
    case
      when confirmed_at_tier::text in ('tier_1', 'tier_2') then 'medical_officer'
      when confirmed_at_tier::text in ('tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
        then 'senior_medical_officer'
      when confirmed_at_tier::text = 'care_coordinator' then 'care_coordinator'
      else null
    end
  )::public.doctor_tier;

alter table public.clinical_incident_reports
  alter column reviewed_by_tier type public.doctor_tier
  using (
    case
      when reviewed_by_tier::text in ('tier_1', 'tier_2') then 'medical_officer'
      when reviewed_by_tier::text in ('tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
        then 'senior_medical_officer'
      when reviewed_by_tier::text = 'care_coordinator' then 'care_coordinator'
      else null
    end
  )::public.doctor_tier;

alter table public.fhir_import_proposed_resources
  alter column confirmed_at_tier type public.doctor_tier
  using (
    case
      when confirmed_at_tier::text in ('tier_1', 'tier_2') then 'medical_officer'
      when confirmed_at_tier::text in ('tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
        then 'senior_medical_officer'
      when confirmed_at_tier::text = 'care_coordinator' then 'care_coordinator'
      else null
    end
  )::public.doctor_tier;

-- clinical_staff_indemnity_exemptions.doctor_tier -- the single_scope CHECK
-- must go first: the new mapping legitimately puts a non-null doctor_tier
-- on a row that also has applies_to_director = true (the one live director
-- exemption), which the OLD constraint's mutual-exclusivity rule would
-- reject mid-ALTER. The constraint's job (keep exactly one scope per row)
-- is superseded below by simply dropping applies_to_director -- a director
-- exemption becomes a chief_medical_officer tier exemption.
alter table public.clinical_staff_indemnity_exemptions
  drop constraint clinical_staff_indemnity_exemptions_single_scope;

alter table public.clinical_staff_indemnity_exemptions
  alter column doctor_tier type public.doctor_tier
  using (
    case
      when applies_to_director then 'chief_medical_officer'
      when doctor_tier::text in ('tier_1', 'tier_2') then 'medical_officer'
      when doctor_tier::text in ('tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
        then 'senior_medical_officer'
      when doctor_tier::text = 'care_coordinator' then 'care_coordinator'
      else null
    end
  )::public.doctor_tier;

alter table public.clinical_staff_indemnity_exemptions
  drop column applies_to_director;

-- Replaces the auto-dropped clinical_staff_indemnity_exemptions_org_wide_idx,
-- which used to also require "not applies_to_director" in its predicate.
-- Org-wide scope is now simply "no tier recorded" -- there is no third
-- (director-wide) scope to distinguish from it any more.
create unique index clinical_staff_indemnity_exemptions_org_wide_idx
  on public.clinical_staff_indemnity_exemptions (organisation_id)
  where doctor_tier is null;

drop type public.doctor_tier_old;

-- Replaces the auto-dropped clinical_staff_director_idx (predicate was
-- "active and is_clinical_director") with the tier-based equivalent.
create index clinical_staff_chief_medical_officer_idx
  on public.clinical_staff (organisation_id)
  where active and doctor_tier = 'chief_medical_officer';

-- Recreate emergency_record_access_grants_select, captured live before the
-- drop above, with is_clinical_director swapped for the tier equivalent.
-- Everything else byte-for-byte identical.
create policy emergency_record_access_grants_select on public.emergency_record_access_grants
  as permissive for select to authenticated
  using (
    requester_id = (select auth.uid())
    or exists (
      select 1 from public.clinical_staff cs
      where cs.profile_id = (select auth.uid())
        and cs.organisation_id = emergency_record_access_grants.patient_org_id
        and cs.active
        and cs.doctor_tier = 'chief_medical_officer'
    )
    or private.is_admin()
  );

-- ---------------------------------------------------------------------------
-- 3. Redefine every function that gates on a specific doctor_tier value or
--    on is_clinical_director. Grouped private schema then public schema,
--    alphabetical within each. Functions that only check
--    "doctor_tier is not null" / "<> 'care_coordinator'", or display
--    doctor_tier as a pass-through report field, are already enum-agnostic
--    and are NOT touched here (verified per-function against a live
--    pg_get_functiondef pull before writing this file).
-- ---------------------------------------------------------------------------

-- --- private schema ---------------------------------------------------------

create or replace function private.can_attest_health_passport(org uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
  );
$function$;

create or replace function private.can_confirm_medication_refill(org uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')
  );
$function$;

create or replace function private.can_handle_emergency_escalation(org uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
  );
$function$;

create or replace function private.can_handle_support_escalation(org uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and (doctor_tier = 'chief_medical_officer' or (doctor_tier is not null and doctor_tier <> 'care_coordinator'))
  );
$function$;

create or replace function private.can_review_complaint_governance(org uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select
    exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin')
    or exists (
      select 1 from public.clinical_staff
      where profile_id = (select auth.uid())
        and organisation_id = org
        and active
        and doctor_tier = 'chief_medical_officer'
    );
$function$;

create or replace function private.can_review_safeguarding_concern(org uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
  );
$function$;

create or replace function private.enforce_case_review_action_attribution()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff_id uuid;
  v_tier public.doctor_tier;
  v_authorised boolean;
begin
  if tg_op = 'INSERT' then
    new.status := 'proposed';
    new.confirmed_by := null;
    new.confirmed_by_staff := null;
    new.confirmed_at := null;
    new.confirmed_at_tier := null;
    new.confirmed_payload := null;
    new.dismissed_by_staff := null;
    new.dismissed_at := null;
    new.dismissal_reason := null;
    new.result_table := null;
    new.result_id := null;
    return new;
  end if;

  if new.status = 'superseded' then
    if old.status <> 'proposed' then
      raise exception 'Only a still-proposed action can be superseded (this one is already %).', old.status;
    end if;
    return new;
  end if;

  if old.status <> 'proposed' then
    raise exception 'This action was already % and cannot be changed. Propose a new action instead.', old.status;
  end if;

  if new.status = 'proposed' then
    raise exception 'A proposed action may only move to confirmed, modified, dismissed, or superseded.';
  end if;

  select id, doctor_tier
    into v_staff_id, v_tier
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
  limit 1;

  if v_staff_id is null then
    raise exception 'Only an active clinical staff member in this organisation can act on a review action.';
  end if;

  if v_tier = 'care_coordinator' then
    raise exception 'A Care Coordinator can review and route a case but cannot confirm a clinical action on it.';
  end if;

  -- An unset tier means "needs an admin to assign one" -- never a default.
  -- is_clinical_director is retired: director authority now requires
  -- doctor_tier = 'chief_medical_officer', which is never null, so a null
  -- tier can no longer mean "director without a tier assigned" the way the
  -- old orthogonal flag allowed.
  if v_tier is null then
    raise exception 'Your clinical record has no tier assigned yet, so clinical actions are unavailable. Ask an administrator to set your tier.';
  end if;

  if new.status = 'dismissed' then
    new.dismissed_by_staff := v_staff_id;
    new.dismissed_at := now();
    new.confirmed_by := null;
    new.confirmed_by_staff := null;
    new.confirmed_at := null;
    new.confirmed_at_tier := null;
    new.confirmed_payload := null;
    return new;
  end if;

  v_authorised := case new.required_authority
    when 'any_clinical_tier'     then true
    when 'refill_confirmation'   then private.can_confirm_medication_refill(new.organisation_id)
    when 'prescribing'           then private.has_prescribing_authority(new.organisation_id)
    when 'emergency_resolution'  then private.can_handle_emergency_escalation(new.organisation_id)
  end;

  if not coalesce(v_authorised, false) then
    raise exception 'This action needs a higher level of clinical authority than your record carries (%). You can still add a note and hand the case to a senior colleague.',
      new.required_authority;
  end if;

  new.confirmed_by := (select auth.uid());
  new.confirmed_by_staff := v_staff_id;
  new.confirmed_at := now();
  new.confirmed_at_tier := v_tier;
  new.dismissed_by_staff := null;
  new.dismissed_at := null;
  new.dismissal_reason := null;
  if new.status = 'confirmed' then
    new.confirmed_payload := old.proposed_payload;
  elsif new.confirmed_payload is null then
    raise exception 'A modified action must carry the payload that was actually used.';
  end if;

  new.proposed_payload := old.proposed_payload;
  new.action_type := old.action_type;
  new.required_authority := old.required_authority;
  new.protocol_version_id := old.protocol_version_id;
  new.rationale := old.rationale;
  new.source := old.source;

  return new;
end;
$function$;

create or replace function private.enforce_chronic_programme_protocol_signed()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    if not exists (
      select 1
      from public.protocol_versions pv
      join public.clinical_staff cs on cs.id = pv.approved_by
      where pv.protocol_id = new.protocol_slug
        and pv.approved_by is not null
        and pv.approved_at is not null
        and cs.doctor_tier = 'chief_medical_officer'
        and cs.active = true
    ) then
      raise exception
        'Cannot activate chronic condition "%": no protocol version for "%" has been signed by an active Clinical Director.',
        new.code, new.protocol_slug
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function private.enforce_clinical_encounter_note_attribution()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
    and doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')
  limit 1;

  if v_staff_id is null then
    raise exception 'Only a clinical-tier member of the care team can write or finalize a clinical encounter note.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.authored_by_staff := v_staff_id;
    new.authored_by_profile := (select auth.uid());
    new.status := 'draft';
    new.finalized_by_staff := null;
    new.finalized_at := null;
    new.identity_confirmed := false;
    new.identity_confirmed_by := null;
    new.identity_confirmed_at := null;
    return new;
  end if;

  if old.status = 'finalized' then
    raise exception 'This encounter note is finalized and cannot be edited. Write a new note if something new needs recording.'
      using errcode = '42501';
  end if;

  new.authored_by_staff := old.authored_by_staff;
  new.authored_by_profile := old.authored_by_profile;

  if new.identity_confirmed and not old.identity_confirmed then
    new.identity_confirmed_by := v_staff_id;
    new.identity_confirmed_at := now();
  elsif not new.identity_confirmed then
    new.identity_confirmed_by := null;
    new.identity_confirmed_at := null;
  else
    new.identity_confirmed_by := old.identity_confirmed_by;
    new.identity_confirmed_at := old.identity_confirmed_at;
  end if;

  if new.status = 'finalized' and old.status = 'draft' then
    if not new.identity_confirmed then
      raise exception 'Confirm the patient''s identity (name + date of birth) before finalizing this note.'
        using errcode = '42501';
    end if;
    new.finalized_by_staff := v_staff_id;
    new.finalized_at := now();
  end if;

  return new;
end;
$function$;

create or replace function private.enforce_clinical_incident_report_attribution()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff_id uuid;
  v_tier public.doctor_tier;
begin
  if tg_op = 'INSERT' then
    new.reported_by := (select auth.uid());
    new.reported_at := coalesce(new.reported_at, now());
    new.status := 'open';
    new.reviewed_by_staff := null;
    new.reviewed_by_tier := null;
    new.reviewed_at := null;
    new.review_outcome := null;
    new.corrective_action := null;
    new.closed_by_staff := null;
    new.closed_at := null;
    return new;
  end if;

  if old.status = 'closed' then
    raise exception 'This incident report is closed and cannot be edited further. File a new report if something new needs recording.'
      using errcode = '42501';
  end if;

  new.reported_by := old.reported_by;
  new.reported_at := old.reported_at;

  if new.status = old.status then
    return new;
  end if;

  select id, doctor_tier into v_staff_id, v_tier
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
  limit 1;

  if v_staff_id is null or v_tier = 'care_coordinator' then
    raise exception 'Only a clinical-tier member of the care team can move an incident report into review or close it. A Care Coordinator can file a report and add detail, but cannot review or close one.'
      using errcode = '42501';
  end if;

  new.reviewed_by_staff := v_staff_id;
  new.reviewed_by_tier := v_tier;
  new.reviewed_at := now();

  if new.status = 'closed' then
    if new.review_outcome is null or length(btrim(new.review_outcome)) = 0
       or new.corrective_action is null or length(btrim(new.corrective_action)) = 0 then
      raise exception 'Closing an incident report needs a review outcome and a corrective action (or an explicit "no action needed" statement), so a closed report always says what was found and what changed.';
    end if;
    new.closed_by_staff := v_staff_id;
    new.closed_at := now();
  end if;

  return new;
end;
$function$;

create or replace function private.enforce_clinical_staff_indemnity()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  requires_indemnity boolean;
begin
  requires_indemnity := new.doctor_tier = 'chief_medical_officer'
    or (new.doctor_tier = 'senior_medical_officer' and new.employment_type = 'contracted');

  if not new.active or not requires_indemnity then
    return new;
  end if;

  if new.indemnity_exempt then
    return new;
  end if;

  if exists (
    select 1 from public.clinical_staff_indemnity_exemptions e
    where e.organisation_id = new.organisation_id
      and (
        e.doctor_tier is null
        or e.doctor_tier = new.doctor_tier
      )
  ) then
    return new;
  end if;

  if new.indemnity_expires_at is null or new.indemnity_expires_at <= now() then
    raise exception 'clinical_staff: % requires current indemnity cover, an individual exemption, or an org/tier exemption before activation', new.full_name
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

create or replace function private.enforce_fhir_import_resource_attribution()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff_id uuid;
  v_tier public.doctor_tier;
  v_result_id uuid;
begin
  if tg_op = 'INSERT' then
    new.status := 'proposed';
    new.confirmed_by := null;
    new.confirmed_by_staff := null;
    new.confirmed_at := null;
    new.confirmed_at_tier := null;
    new.confirmed_payload := null;
    new.result_table := null;
    new.result_id := null;
    new.dismissed_by_staff := null;
    new.dismissed_at := null;
    new.dismissal_reason := null;
    return new;
  end if;

  if new.status = 'superseded' then
    if old.status <> 'proposed' then
      raise exception 'Only a still-proposed resource can be superseded (this one is already %).', old.status;
    end if;
    return new;
  end if;

  if old.status <> 'proposed' then
    raise exception 'This resource was already % and cannot be changed. A corrected re-send from the partner supersedes it instead.', old.status;
  end if;

  if new.status = 'proposed' then
    raise exception 'A proposed resource may only move to confirmed, modified, dismissed, or superseded.';
  end if;

  select id, doctor_tier
    into v_staff_id, v_tier
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
  limit 1;

  if v_staff_id is null then
    raise exception 'Only an active clinical staff member in this organisation can act on an imported resource.';
  end if;

  if v_tier = 'care_coordinator' then
    raise exception 'A Care Coordinator can see an imported resource but cannot confirm it into the clinical record.';
  end if;

  if v_tier is null then
    raise exception 'Your clinical record has no tier assigned yet, so confirming imported data is unavailable. Ask an administrator to set your tier.';
  end if;

  new.resource_type := old.resource_type;
  new.batch_id := old.batch_id;
  new.patient_id := old.patient_id;
  new.organisation_id := old.organisation_id;
  new.source := old.source;
  new.fhir_resource_id := old.fhir_resource_id;
  new.raw_resource := old.raw_resource;
  new.normalized_payload := old.normalized_payload;
  new.parse_warnings := old.parse_warnings;
  new.parser_version := old.parser_version;
  new.proposed_at := old.proposed_at;

  if new.status = 'dismissed' then
    if new.dismissal_reason is null or length(btrim(new.dismissal_reason)) = 0 then
      raise exception 'A dismissal needs a reason.';
    end if;
    new.dismissed_by_staff := v_staff_id;
    new.dismissed_at := now();
    new.confirmed_by := null;
    new.confirmed_by_staff := null;
    new.confirmed_at := null;
    new.confirmed_at_tier := null;
    new.confirmed_payload := null;
    new.result_table := null;
    new.result_id := null;
    return new;
  end if;

  if new.status = 'confirmed' then
    new.confirmed_payload := old.normalized_payload;
  elsif new.confirmed_payload is null then
    raise exception 'A modified resource must carry the payload that was actually used.';
  end if;

  new.confirmed_by := (select auth.uid());
  new.confirmed_by_staff := v_staff_id;
  new.confirmed_at := now();
  new.confirmed_at_tier := v_tier;
  new.dismissed_by_staff := null;
  new.dismissed_at := null;
  new.dismissal_reason := null;

  case new.resource_type
    when 'Observation' then
      insert into public.vitals_readings (
        organisation_id, patient_id, source, vital_type, taken_at,
        systolic, diastolic, pulse_bpm,
        glucose_context, glucose_mmol_l,
        weight_kg, temperature_c, spo2_pct, waist_cm, ketones_mmol_l,
        external_reading_id
      ) values (
        new.organisation_id, new.patient_id, 'fhir_import',
        (new.confirmed_payload->>'vital_type')::public.vital_type,
        (new.confirmed_payload->>'taken_at')::timestamptz,
        (new.confirmed_payload->>'systolic')::integer,
        (new.confirmed_payload->>'diastolic')::integer,
        (new.confirmed_payload->>'pulse_bpm')::integer,
        (new.confirmed_payload->>'glucose_context')::public.glucose_context,
        (new.confirmed_payload->>'glucose_mmol_l')::numeric,
        (new.confirmed_payload->>'weight_kg')::numeric,
        (new.confirmed_payload->>'temperature_c')::numeric,
        (new.confirmed_payload->>'spo2_pct')::numeric,
        (new.confirmed_payload->>'waist_cm')::numeric,
        (new.confirmed_payload->>'ketones_mmol_l')::numeric,
        new.fhir_resource_id
      )
      returning id into v_result_id;
      new.result_table := 'vitals_readings';

    when 'AllergyIntolerance' then
      insert into public.patient_allergies (
        organisation_id, patient_id, allergen, reaction, severity, source, noted_at, recorded_by
      ) values (
        new.organisation_id, new.patient_id,
        new.confirmed_payload->>'allergen',
        new.confirmed_payload->>'reaction',
        (new.confirmed_payload->>'severity')::public.allergy_severity,
        'fhir_import',
        coalesce((new.confirmed_payload->>'noted_at')::timestamptz, now()),
        (select auth.uid())
      )
      returning id into v_result_id;
      new.result_table := 'patient_allergies';

    when 'MedicationStatement', 'MedicationRequest' then
      insert into public.medications (
        organisation_id, patient_id, drug_name, dose, frequency, is_active, source, added_by
      ) values (
        new.organisation_id, new.patient_id,
        new.confirmed_payload->>'drug_name',
        new.confirmed_payload->>'dose',
        new.confirmed_payload->>'frequency',
        coalesce((new.confirmed_payload->>'is_active')::boolean, true),
        'fhir_import',
        (select auth.uid())
      )
      returning id into v_result_id;
      new.result_table := 'medications';

    when 'Immunization' then
      insert into public.vaccination_records (
        organisation_id, profile_id, vaccination_catalog_id, dose_number,
        date_administered, provider, verification_status, verified_by, verified_at
      ) values (
        new.organisation_id, new.patient_id,
        (new.confirmed_payload->>'vaccination_catalog_id')::uuid,
        coalesce((new.confirmed_payload->>'dose_number')::integer, 1),
        (new.confirmed_payload->>'date_administered')::date,
        new.confirmed_payload->>'provider',
        'verified',
        (select auth.uid()),
        now()
      )
      returning id into v_result_id;
      new.result_table := 'vaccination_records';
  end case;

  new.result_id := v_result_id;

  return new;
end;
$function$;

create or replace function private.enforce_protocol_draft_attribution()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
    and doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')
  limit 1;

  if v_staff_id is null then
    raise exception 'Only a clinical-tier member of the care team can draft or edit a protocol.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.authored_by_staff := v_staff_id;
    new.authored_by_profile := (select auth.uid());
    new.status := coalesce(nullif(new.status, ''), 'draft');
    if new.status not in ('draft', 'in_review') then
      new.status := 'draft';
    end if;
    new.promoted_to_version_id := null;
    new.rejected_reason := null;
    return new;
  end if;

  if old.status in ('promoted', 'rejected') then
    raise exception 'This protocol draft is % and is closed -- start a new draft if something new needs recording.', old.status
      using errcode = '42501';
  end if;

  new.authored_by_staff := old.authored_by_staff;
  new.authored_by_profile := old.authored_by_profile;
  new.organisation_id := old.organisation_id;
  new.protocol_id := old.protocol_id;

  if new.status in ('promoted', 'rejected') and old.status not in ('promoted', 'rejected')
     and coalesce(current_setting('app.protocol_draft_transition_authorised', true), 'false') <> 'true' then
    raise exception 'A protocol draft can only be promoted or rejected via promote_protocol_draft()/reject_protocol_draft(), not a direct update.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

create or replace function private.enforce_protocol_draft_comment_attribution()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
    and doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')
  limit 1;

  if v_staff_id is null then
    raise exception 'Only a clinical-tier member of the care team can comment on a protocol draft.'
      using errcode = '42501';
  end if;

  new.commented_by_staff := v_staff_id;
  return new;
end;
$function$;

create or replace function private.enforce_provider_complaint_stage()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_from integer := private.provider_complaint_stage_ordinal(old.stage);
  v_to   integer := private.provider_complaint_stage_ordinal(new.stage);
begin
  if new.stage = old.stage then
    return new;
  end if;

  if new.stage = 'withdrawn' then
    if old.stage in ('closed', 'withdrawn') then
      raise exception 'a % complaint cannot be withdrawn', old.stage;
    end if;
    new.withdrawn_at := coalesce(new.withdrawn_at, now());
    return new;
  end if;

  if old.stage in ('closed', 'withdrawn') then
    raise exception 'complaint % is already % and cannot be reopened — raise a new complaint referencing it',
      old.reference, old.stage;
  end if;

  if v_to <> v_from + 1 then
    if not (old.stage = 'resolution' and new.stage = 'closed' and new.category <> 'clinical') then
      raise exception 'invalid complaint transition % -> % (the pipeline is forward-only, one stage at a time; only a non-clinical complaint may close straight from resolution)',
        old.stage, new.stage;
    end if;
  end if;

  if old.stage = 'triage' and (new.triaged_by is null or new.severity is null) then
    raise exception 'triage must record who triaged the complaint and assign a severity before it advances';
  end if;

  if old.stage = 'investigation' and not exists (
    select 1 from public.provider_complaint_investigation_notes where complaint_id = new.id
  ) then
    raise exception 'an investigation must record at least one investigation note before it advances';
  end if;

  if old.stage = 'provider_response' and new.provider_response is null and new.response_requested_at is null then
    raise exception 'the provider must be given a recorded opportunity to respond before the complaint advances';
  end if;

  if old.stage = 'resolution' and (new.outcome is null or new.resolved_by is null) then
    raise exception 'a resolution must record an outcome and who resolved it';
  end if;

  if new.stage = 'closed' and new.category = 'clinical' then
    if new.governance_reviewed_by is null then
      raise exception 'a clinical complaint may not be closed without a signed governance review';
    end if;
    if not exists (
      select 1 from public.clinical_staff
      where id = new.governance_reviewed_by and doctor_tier = 'chief_medical_officer'
    ) then
      raise exception 'the governance review of a clinical complaint must be signed by a Clinical Director';
    end if;
  end if;

  if new.stage = 'investigation' then
    new.investigation_opened_at := coalesce(new.investigation_opened_at, now());
    new.investigation_opened_by := coalesce(new.investigation_opened_by, (select auth.uid()));
  end if;
  if new.stage = 'provider_response' then
    new.response_requested_at := coalesce(new.response_requested_at, now());
  end if;
  if new.stage = 'closed' then
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  return new;
end;
$function$;

create or replace function private.enforce_safeguarding_concern_attribution()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff_id uuid;
  v_tier public.doctor_tier;
begin
  if tg_op = 'INSERT' then
    new.reported_by := (select auth.uid());
    new.reported_at := coalesce(new.reported_at, now());
    new.status := 'open';
    new.reviewed_by_staff := null;
    new.reviewed_at := null;
    new.review_outcome := null;
    new.corrective_action := null;
    new.closed_by_staff := null;
    new.closed_at := null;
    new.clinician_alert_id := private.raise_clinician_alert(
      new.organisation_id,
      new.patient_id,
      'urgent_escalation',
      'Safeguarding concern reported',
      format('Category: %s. %s', new.concern_category, new.description),
      'clinical',
      'safeguarding_concern'
    );
    return new;
  end if;

  if old.status = 'closed' then
    raise exception 'This safeguarding concern is closed and cannot be edited further. File a new concern if something new needs recording.'
      using errcode = '42501';
  end if;

  new.reported_by := old.reported_by;
  new.reported_at := old.reported_at;
  new.clinician_alert_id := old.clinician_alert_id;

  if new.status = old.status then
    return new;
  end if;

  select cs.id, cs.doctor_tier into v_staff_id, v_tier
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = new.organisation_id
    and cs.active
    and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
  limit 1;

  if v_staff_id is null then
    raise exception 'Only a Senior Medical Officer or the Chief Medical Officer can move a safeguarding concern into review or close it.'
      using errcode = '42501';
  end if;

  new.reviewed_by_staff := v_staff_id;
  new.reviewed_at := now();

  if new.status = 'closed' then
    if new.review_outcome is null or length(btrim(new.review_outcome)) = 0 then
      raise exception 'Closing a safeguarding concern needs a stated review outcome, so a closed record always says what was found.';
    end if;
    new.closed_by_staff := v_staff_id;
    new.closed_at := now();
  end if;

  return new;
end;
$function$;

create or replace function private.enforce_specialist_referral_outcome_and_closure()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff_id uuid;
begin
  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'This referral is closed and cannot be reopened. Create a new referral (linked via parent_referral_id) if further specialist input is needed.'
      using errcode = '42501';
  end if;
  if old.closed_at is not null then
    new.closed_at := old.closed_at;
    new.closed_by := old.closed_by;
  end if;

  if new.outcome_document_path is distinct from old.outcome_document_path
     and new.outcome_document_path is not null then
    new.outcome_document_uploaded_at := coalesce(new.outcome_document_uploaded_at, now());
    if (select auth.uid()) is not null then
      new.outcome_document_uploaded_by := (select auth.uid());
    end if;
  end if;

  if new.status = 'closed' and old.status is distinct from 'closed' then
    if not private.is_clinical_tier(new.organisation_id) then
      raise exception 'Only a clinical-tier member of the care team can close a referral.'
        using errcode = '42501';
    end if;

    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active
      and doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')
    limit 1;

    if v_staff_id is null then
      raise exception 'Only a clinical-tier member of the care team can close a referral.'
        using errcode = '42501';
    end if;

    new.closed_by := v_staff_id;
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  return new;
end;
$function$;

create or replace function private.escalate_overdue_clinician_alerts()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
  v_hours_overdue numeric;
  v_tier smallint;
  v_director record;
  v_admin record;
  v_message text;
begin
  for r in
    select ca.id, ca.organisation_id, ca.patient_id, ca.title, ca.level, ca.escalation_level, ca.sla_due_at
    from public.clinician_alerts ca
    where ca.status = 'open'
      and ca.sla_due_at is not null
      and ca.sla_due_at < now()
  loop
    v_hours_overdue := extract(epoch from (now() - r.sla_due_at)) / 3600;
    v_tier := case when v_hours_overdue >= 24 then 2 else 1 end;

    insert into public.clinician_alert_sla_breach_notifications (clinician_alert_id, escalation_tier)
    values (r.id, v_tier)
    on conflict (clinician_alert_id, notified_on) do nothing;

    if not found then
      continue;
    end if;

    v_message := format(
      'Escalation SLA breached: "%s" (%s) is %s hours past its review deadline and still open.',
      r.title, r.level, round(v_hours_overdue)
    );

    for v_director in
      select cs.profile_id
      from public.clinical_staff cs
      where cs.organisation_id = r.organisation_id
        and cs.doctor_tier = 'chief_medical_officer'
        and cs.active
        and cs.profile_id is not null
    loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (v_director.profile_id, r.organisation_id, 'in_app', 'clinician_alert_sla_breach',
        jsonb_build_object('message', v_message, 'clinician_alert_id', r.id, 'hours_overdue', round(v_hours_overdue)),
        'pending', 'clinical');
    end loop;

    if v_tier = 2 then
      for v_admin in select id from public.profiles where role = 'admin'
      loop
        insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
        values (v_admin.id, r.organisation_id, 'in_app', 'clinician_alert_sla_breach',
          jsonb_build_object('message', v_message, 'clinician_alert_id', r.id, 'hours_overdue', round(v_hours_overdue)),
          'pending', 'clinical');
      end loop;
    end if;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (r.organisation_id, null, 'clinician_alert.sla_breach_escalated', 'clinician_alerts', r.id,
      jsonb_build_object('escalation_tier', v_tier, 'hours_overdue', round(v_hours_overdue, 1),
        'level', r.level, 'escalation_level', r.escalation_level, 'sla_due_at', r.sla_due_at));
  end loop;
end;
$function$;

create or replace function private.escalate_unacknowledged_clinician_alerts()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
  v_rule jsonb;
  v_timeout integer;
  v_minutes_open numeric;
  v_message text;
  v_backup_profile_id uuid;
  v_recipient record;
  v_any_found boolean;
begin
  for r in
    select ca.id, ca.organisation_id, ca.title, ca.type_code, ca.severity,
           ca.backup_clinician_id, ca.created_at
    from public.clinician_alerts ca
    where ca.status = 'open'
  loop
    v_rule := private.alert_rule_config(r.type_code);
    if v_rule is null then
      continue;
    end if;

    v_timeout := nullif(v_rule->>'ack_timeout_minutes', '')::integer;
    if v_timeout is null or v_timeout <= 0 then
      continue;
    end if;

    v_minutes_open := extract(epoch from (now() - r.created_at)) / 60;
    v_message := format(
      'Alert "%s" (severity %s) has been open %s minutes, past its %s-minute acknowledgement target.',
      r.title, r.severity, round(v_minutes_open), v_timeout
    );

    if v_minutes_open >= v_timeout and r.backup_clinician_id is not null
       and not exists (select 1 from public.clinician_alert_ack_escalations where clinician_alert_id = r.id and hop = 1)
    then
      select profile_id into v_backup_profile_id from public.clinical_staff where id = r.backup_clinician_id;
      if v_backup_profile_id is not null then
        perform private.notify_clinician_alert(r.id, v_backup_profile_id, 'clinician_alert_ack_timeout_backup', jsonb_build_object('message', v_message));
        insert into public.clinician_alert_ack_escalations (clinician_alert_id, hop, notified_role)
        values (r.id, 1, 'backup');
        insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (r.organisation_id, null, 'clinician_alert.ack_timeout_escalated', 'clinician_alerts', r.id,
          jsonb_build_object('hop', 1, 'role', 'backup', 'minutes_open', round(v_minutes_open)));
      end if;
    end if;

    if v_minutes_open >= v_timeout * 2
       and not exists (select 1 from public.clinician_alert_ack_escalations where clinician_alert_id = r.id and hop = 2)
    then
      v_any_found := false;
      for v_recipient in
        select cs.profile_id
        from public.clinical_staff cs
        where cs.organisation_id = r.organisation_id
          and cs.active
          and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
          and cs.profile_id is not null
      loop
        v_any_found := true;
        perform private.notify_clinician_alert(r.id, v_recipient.profile_id, 'clinician_alert_ack_timeout_senior', jsonb_build_object('message', v_message));
      end loop;

      if v_any_found then
        insert into public.clinician_alert_ack_escalations (clinician_alert_id, hop, notified_role)
        values (r.id, 2, 'senior');
        insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (r.organisation_id, null, 'clinician_alert.ack_timeout_escalated', 'clinician_alerts', r.id,
          jsonb_build_object('hop', 2, 'role', 'senior', 'minutes_open', round(v_minutes_open)));
      end if;
    end if;

    if v_minutes_open >= v_timeout * 3
       and not exists (select 1 from public.clinician_alert_ack_escalations where clinician_alert_id = r.id and hop = 3)
    then
      v_any_found := false;
      for v_recipient in select id as profile_id from public.profiles where role = 'admin'
      loop
        v_any_found := true;
        perform private.notify_clinician_alert(r.id, v_recipient.profile_id, 'clinician_alert_ack_timeout_admin', jsonb_build_object('message', v_message));
      end loop;

      if v_any_found then
        insert into public.clinician_alert_ack_escalations (clinician_alert_id, hop, notified_role)
        values (r.id, 3, 'admin');
        insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (r.organisation_id, null, 'clinician_alert.ack_timeout_escalated', 'clinician_alerts', r.id,
          jsonb_build_object('hop', 3, 'role', 'admin', 'minutes_open', round(v_minutes_open)));
      end if;
    end if;
  end loop;
end;
$function$;

create or replace function private.is_clinical_tier(org uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')
  );
$function$;

create or replace function private.is_complaints_handler()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select private.is_admin() or exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid()) and active and doctor_tier = 'chief_medical_officer'
  );
$function$;

create or replace function private.has_prescribing_authority(org uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
  );
$function$;

create or replace function private.notify_ai_safety_incident()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_system text;
  v_rec    uuid;
begin
  if new.severity not in ('high', 'critical') then
    return new;
  end if;

  select name into v_system from public.ai_systems where id = new.ai_system_id;

  for v_rec in
    select distinct cs.profile_id
    from public.clinical_staff cs
    where cs.active and cs.doctor_tier = 'chief_medical_officer' and cs.profile_id is not null
      and cs.organisation_id = new.organisation_id
    union
    select p.id from public.profiles p where p.role = 'admin'
  loop
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload,
       content_class, priority, source_table, source_id)
    values (
      new.organisation_id, v_rec, 'in_app', 'pending', 'ai_safety_incident_raised',
      jsonb_build_object(
        'ai_system', v_system,
        'severity', new.severity,
        'category', new.category,
        'reporter_kind', new.reporter_kind
      ),
      'clinical', 'critical', 'ai_safety_incidents', new.id
    );
  end loop;

  return new;
end;
$function$;

create or replace function private.notify_clinical_staff_indemnity_lapses()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
  v_already_expired boolean;
  v_admin record;
  v_message text;
begin
  for r in
    select cs.id, cs.organisation_id, cs.full_name, cs.doctor_tier, cs.employment_type, cs.indemnity_expires_at
    from public.clinical_staff cs
    where cs.active
      and (
        cs.doctor_tier = 'chief_medical_officer'
        or (cs.doctor_tier = 'senior_medical_officer' and cs.employment_type = 'contracted')
      )
      and not cs.indemnity_exempt
      and not exists (
        select 1 from public.clinical_staff_indemnity_exemptions e
        where e.organisation_id = cs.organisation_id
          and (e.doctor_tier is null or e.doctor_tier = cs.doctor_tier)
      )
      and (cs.indemnity_expires_at is null or cs.indemnity_expires_at < now() + interval '30 days')
  loop
    v_already_expired := r.indemnity_expires_at is null or r.indemnity_expires_at <= now();

    insert into public.clinical_staff_indemnity_lapse_notifications (clinical_staff_id, already_expired)
    values (r.id, v_already_expired)
    on conflict (clinical_staff_id, notified_on) do nothing;

    if not found then
      continue;
    end if;

    v_message := case
      when r.indemnity_expires_at is null then
        format('%s has no indemnity cover on file and no exemption -- this should not be able to happen for an active record; check clinical_staff.id=%s.', r.full_name, r.id)
      when v_already_expired then
        format('%s''s indemnity cover expired on %s and no exemption is on file. Renew cover or record an exemption.', r.full_name, to_char(r.indemnity_expires_at, 'YYYY-MM-DD'))
      else
        format('%s''s indemnity cover expires on %s (within 30 days) and no exemption is on file. Renew cover before it lapses.', r.full_name, to_char(r.indemnity_expires_at, 'YYYY-MM-DD'))
    end;

    for v_admin in select id from public.profiles where role = 'admin'
    loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (v_admin.id, r.organisation_id, 'in_app', 'clinical_staff_indemnity_lapse',
        jsonb_build_object('message', v_message, 'clinical_staff_id', r.id, 'already_expired', v_already_expired),
        'pending', 'non_clinical');
    end loop;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (r.organisation_id, null, 'clinical_staff.indemnity_lapse_flagged', 'clinical_staff', r.id,
      jsonb_build_object('already_expired', v_already_expired, 'indemnity_expires_at', r.indemnity_expires_at,
        'doctor_tier', r.doctor_tier, 'employment_type', r.employment_type));
  end loop;
end;
$function$;

create or replace function private.notify_serious_clinical_incident()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_recipient record;
begin
  if new.severity not in ('high', 'critical') then
    return new;
  end if;

  for v_recipient in
    select cs.profile_id as id
    from public.clinical_staff cs
    where cs.organisation_id = new.organisation_id
      and cs.active
      and cs.doctor_tier = 'chief_medical_officer'
      and cs.profile_id is not null
    union
    select p.id
    from public.profiles p
    where p.role = 'admin'
  loop
    insert into public.notifications (
      recipient_id, organisation_id, channel, template, payload, status, content_class
    )
    values (
      v_recipient.id,
      new.organisation_id,
      'in_app',
      'serious_clinical_incident_filed',
      jsonb_build_object('incident_id', new.id, 'category', new.category, 'severity', new.severity),
      'pending',
      'non_clinical'
    );
  end loop;

  return new;
end;
$function$;

create or replace function private.notify_unapproved_emergency_access_grants()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
  v_director record;
  v_message text;
  v_minutes_to_expiry numeric;
begin
  for r in
    select g.id, g.patient_id, g.patient_org_id, g.requester_id, g.reason, g.expires_at,
           p.full_name as patient_name, req.full_name as requester_name
    from public.emergency_record_access_grants g
    join public.profiles p on p.id = g.patient_id
    join public.profiles req on req.id = g.requester_id
    where g.review_status = 'pending_review'
      and g.ended_at is null
      and g.expires_at < now() + interval '1 hour'
  loop
    insert into public.emergency_record_access_nudges (grant_id)
    values (r.id)
    on conflict (grant_id, notified_on) do nothing;

    if not found then
      continue;
    end if;

    v_minutes_to_expiry := extract(epoch from (r.expires_at - now())) / 60;
    v_message := format(
      '%s requested emergency access to %s''s record (%s) and it still needs your review — %s.',
      coalesce(r.requester_name, 'A clinician'), coalesce(r.patient_name, 'a patient'), r.reason,
      case when v_minutes_to_expiry > 0
        then format('expires in %s minutes', round(v_minutes_to_expiry))
        else 'already expired'
      end
    );

    for v_director in
      select cs.profile_id
      from public.clinical_staff cs
      where cs.organisation_id = r.patient_org_id
        and cs.doctor_tier = 'chief_medical_officer'
        and cs.active
        and cs.profile_id is not null
    loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (v_director.profile_id, r.patient_org_id, 'in_app', 'emergency_access_review_due',
        jsonb_build_object('message', v_message, 'grant_id', r.id, 'patient_id', r.patient_id),
        'pending', 'clinical');
    end loop;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (r.patient_org_id, null, 'clinician.emergency_record_access_review_nudged', 'patient', r.patient_id,
      jsonb_build_object('grant_id', r.id, 'expires_at', r.expires_at));
  end loop;
end;
$function$;

create or replace function private.stamp_async_consult_answer()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  if new.status = 'answered' and old.status <> 'answered' then
    select cs.id into v_staff
    from public.clinical_staff cs
    where cs.profile_id = (select auth.uid())
      and cs.organisation_id = new.organisation_id
      and cs.active
      and cs.doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer');
    if v_staff is null then
      raise exception 'only an active doctor on this organisation''s care team can answer a consult'
        using errcode = '42501';
    end if;
    new.answered_by := v_staff;
    new.answered_at := now();
    if new.answer is null or length(btrim(new.answer)) = 0 then
      raise exception 'an answered consult must carry an answer';
    end if;
  elsif new.status <> 'answered' and old.status <> 'answered' then
    new.answered_by := null;
    new.answered_at := null;
    new.answer := null;
  else
    new.answered_by := old.answered_by;
    new.answered_at := old.answered_at;
    new.answer := old.answer;
  end if;
  return new;
end;
$function$;

create or replace function private.stamp_protocol_version_approver()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
    and doctor_tier = 'chief_medical_officer';

  if v_staff_id is null then
    raise exception 'Only the org''s active Clinical Director can sign a protocol version'
      using errcode = '42501';
  end if;

  new.approved_by := v_staff_id;
  new.approved_at := now();

  return new;
end;
$function$;

-- Two new case-assignment triggers: reassigning a case to someone OTHER
-- than yourself now requires doctor_tier = 'chief_medical_officer'.
-- Self-claim (setting the assignee to your own id) and unclaiming (setting
-- it to null) are unaffected -- those stay governed by the existing
-- is_clinical_tier/can_handle_emergency_escalation gates.

create or replace function private.enforce_escalation_reassignment_authority()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.assigned_doctor_id is distinct from old.assigned_doctor_id
     and new.assigned_doctor_id is not null
     and new.assigned_doctor_id is distinct from (select auth.uid())
     and not exists (
       select 1 from public.clinical_staff
       where profile_id = (select auth.uid())
         and organisation_id = new.organisation_id
         and active
         and doctor_tier = 'chief_medical_officer'
     )
  then
    raise exception 'Only the Chief Medical Officer / Clinical Director can assign a case to someone else. Claim it for yourself instead.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

create trigger escalations_enforce_reassignment_authority
  before update on public.escalations
  for each row execute function private.enforce_escalation_reassignment_authority();

create or replace function private.enforce_clinician_alert_reassignment_authority()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if (
       new.responsible_clinician_id is distinct from old.responsible_clinician_id
       and new.responsible_clinician_id is not null
       and new.responsible_clinician_id not in (
         select id from public.clinical_staff where profile_id = (select auth.uid())
       )
     )
     or (
       new.backup_clinician_id is distinct from old.backup_clinician_id
       and new.backup_clinician_id is not null
       and new.backup_clinician_id not in (
         select id from public.clinical_staff where profile_id = (select auth.uid())
       )
     )
  then
    if not exists (
      select 1 from public.clinical_staff
      where profile_id = (select auth.uid())
        and organisation_id = new.organisation_id
        and active
        and doctor_tier = 'chief_medical_officer'
    ) then
      raise exception 'Only the Chief Medical Officer / Clinical Director can assign this alert to someone else. Claim it for yourself instead.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

create trigger clinician_alerts_enforce_reassignment_authority
  before update on public.clinician_alerts
  for each row execute function private.enforce_clinician_alert_reassignment_authority();

-- --- public schema -----------------------------------------------------

create or replace function public.action_consultation_follow_up(p_followup_id uuid, p_monitoring_frequency_days integer default null::integer, p_referral_specialist_type text default null::text, p_referral_reason text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_fu       record;
  v_staff    record;
  v_new_id   uuid;
  v_specialist public.specialist_type;
begin
  select * into v_fu from public.consultation_follow_ups where id = p_followup_id for update;
  if v_fu.id is null then
    raise exception 'follow-up not found';
  end if;
  if v_fu.status <> 'pending' then
    raise exception 'this follow-up has already been resolved (status: %)', v_fu.status;
  end if;

  select cs.* into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_fu.organisation_id
    and cs.active;
  if v_staff.id is null then
    raise exception 'only an active member of this organisation''s care team can action a follow-up'
      using errcode = '42501';
  end if;

  if v_fu.action_type in ('monitoring_schedule', 'referral')
     and not (v_staff.doctor_tier in
       ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')) then
    raise exception 'only a clinical-tier member of the care team can action a % follow-up', v_fu.action_type
      using errcode = '42501';
  end if;

  if v_fu.action_type = 'monitoring_schedule' then
    if p_monitoring_frequency_days is null or p_monitoring_frequency_days <= 0 or p_monitoring_frequency_days > 90 then
      raise exception 'a monitoring schedule needs a frequency between 1 and 90 days';
    end if;

    insert into public.vitals_reminder_rules (organisation_id, patient_id, frequency_days)
    values (v_fu.organisation_id, v_fu.patient_id, p_monitoring_frequency_days)
    on conflict (organisation_id, patient_id) where patient_id is not null
      do update set frequency_days = excluded.frequency_days
    returning id into v_new_id;

    update public.consultation_follow_ups
      set status = 'actioned', linked_vitals_reminder_rule_id = v_new_id
      where id = p_followup_id;

  elsif v_fu.action_type = 'referral' then
    if p_referral_specialist_type is null then
      raise exception 'a referral follow-up needs a specialist type';
    end if;
    begin
      v_specialist := p_referral_specialist_type::public.specialist_type;
    exception when invalid_text_representation then
      raise exception '% is not a recognised specialist type', p_referral_specialist_type;
    end;

    insert into public.specialist_referrals
      (organisation_id, patient_id, specialist_type, referral_reason, origin, set_by)
    values
      (v_fu.organisation_id, v_fu.patient_id, v_specialist,
       coalesce(nullif(btrim(p_referral_reason), ''), v_fu.description),
       'clinically_triggered', v_staff.profile_id)
    returning id into v_new_id;

    update public.consultation_follow_ups
      set status = 'actioned', linked_referral_id = v_new_id
      where id = p_followup_id;

  else
    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail, priority)
    values
      (v_fu.organisation_id, v_fu.patient_id, 'consultation_follow_up',
       jsonb_build_object(
         'action_type', v_fu.action_type,
         'description', v_fu.description,
         'encounter_note_id', v_fu.encounter_note_id,
         'due_at', v_fu.due_at
       ),
       2)
    on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted')
      do update set trigger_detail = public.care_outreach_tasks.trigger_detail || excluded.trigger_detail
    returning id into v_new_id;

    update public.consultation_follow_ups
      set status = 'actioned', linked_outreach_task_id = v_new_id
      where id = p_followup_id;
  end if;

  return jsonb_build_object('follow_up_id', p_followup_id, 'action_type', v_fu.action_type, 'linked_id', v_new_id);
end;
$function$;

create or replace function public.activate_ai_prompt_version(p_id uuid, p_note text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_system  record;
  v_staff   uuid;
  v_actor   uuid := (select auth.uid());
  v_org     uuid;
begin
  select s.id, s.system_code, s.name, s.risk_class, s.clinically_meaningful
    into v_system
  from public.ai_prompt_versions pv
  join public.ai_systems s on s.id = pv.ai_system_id
  where pv.id = p_id;

  if v_system.id is null then
    raise exception 'AI prompt version not found';
  end if;

  select cs.id, cs.organisation_id into v_staff, v_org
  from public.clinical_staff cs
  where cs.profile_id = v_actor and cs.active and cs.doctor_tier = 'chief_medical_officer'
  limit 1;

  if v_system.clinically_meaningful or v_system.risk_class in ('high', 'very_high') then
    if v_staff is null then
      raise exception 'not authorised: only an active Clinical Director can activate a prompt version for % (%), a clinically meaningful or high-risk AI system',
        v_system.name, v_system.system_code;
    end if;
  elsif v_staff is null and not private.is_admin() then
    raise exception 'not authorised: activating a prompt version requires an admin or an active Clinical Director';
  end if;

  update public.ai_prompt_versions
     set is_active = false, retired_at = coalesce(retired_at, now())
   where ai_system_id = v_system.id and is_active and id <> p_id;

  update public.ai_prompt_versions
     set approved_by  = coalesce(approved_by, v_staff),
         approved_at  = coalesce(approved_at, now()),
         activated_by = v_actor,
         activated_at = now(),
         retired_at   = null,
         is_active    = true,
         change_summary = coalesce(p_note, change_summary)
   where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    coalesce(v_org, (select organisation_id from public.profiles where id = v_actor)),
    v_actor, 'ai_prompt_version.activated', 'ai_prompt_versions', p_id,
    jsonb_build_object(
      'ai_system_code', v_system.system_code,
      'signed_by_clinical_staff', v_staff,
      'note', p_note
    )
  );

  return p_id;
end;
$function$;

create or replace function public.approve_ai_system_version(p_version_id uuid, p_note text default null::text, p_deploy boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_system record;
  v_gate   jsonb;
  v_staff  uuid;
  v_actor  uuid := (select auth.uid());
  v_org    uuid;
begin
  select s.id, s.system_code, s.name, s.risk_class, s.clinically_meaningful
    into v_system
  from public.ai_system_versions v
  join public.ai_systems s on s.id = v.ai_system_id
  where v.id = p_version_id;

  if v_system.id is null then
    raise exception 'AI system version not found';
  end if;

  select cs.id, cs.organisation_id into v_staff, v_org
  from public.clinical_staff cs
  where cs.profile_id = v_actor and cs.active and cs.doctor_tier = 'chief_medical_officer'
  limit 1;

  if v_system.clinically_meaningful or v_system.risk_class in ('high', 'very_high') then
    if v_staff is null then
      raise exception 'not authorised: only an active Clinical Director can approve a version of % (%), a clinically meaningful or high-risk AI system',
        v_system.name, v_system.system_code;
    end if;
  elsif v_staff is null and not private.is_admin() then
    raise exception 'not authorised: approving a version requires an admin or an active Clinical Director';
  end if;

  v_gate := private.ai_release_gate(p_version_id);

  if not coalesce((v_gate->>'satisfied')::boolean, false) then
    raise exception 'this version has not passed every required evaluation suite: %', v_gate->'outstanding';
  end if;

  update public.ai_system_versions
     set approved_by       = coalesce(approved_by, v_staff),
         approval_actor_id = coalesce(approval_actor_id, v_actor),
         approved_at       = coalesce(approved_at, now()),
         deployed_at       = case when p_deploy then coalesce(deployed_at, now()) else deployed_at end,
         change_summary    = coalesce(p_note, change_summary)
   where id = p_version_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    coalesce(v_org, (select organisation_id from public.profiles where id = v_actor)),
    v_actor, 'ai_system_version.approved', 'ai_system_versions', p_version_id,
    jsonb_build_object(
      'system_code', v_system.system_code,
      'signed_by_clinical_staff', v_staff,
      'release_gate', v_gate,
      'deployed', p_deploy
    )
  );

  return v_gate;
end;
$function$;

create or replace function public.promote_protocol_draft(p_draft_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_draft public.protocol_drafts%rowtype;
  v_director uuid;
  v_next_version int;
  v_new_version_id uuid;
begin
  select * into v_draft from public.protocol_drafts where id = p_draft_id;
  if v_draft.id is null then
    raise exception 'Protocol draft not found';
  end if;
  if v_draft.status in ('promoted', 'rejected') then
    raise exception 'This draft is already %', v_draft.status;
  end if;

  select id into v_director
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = v_draft.organisation_id
    and active
    and doctor_tier = 'chief_medical_officer';
  if v_director is null then
    raise exception 'Only the org''s active Clinical Director can promote a protocol draft'
      using errcode = '42501';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.protocol_versions
  where organisation_id = v_draft.organisation_id and protocol_id = v_draft.protocol_id;

  insert into public.protocol_versions
    (organisation_id, protocol_id, version_number, title, change_summary, content,
     evidence_basis, applicable_population, specialty)
  values
    (v_draft.organisation_id, v_draft.protocol_id, v_next_version, v_draft.title, v_draft.change_summary, v_draft.content,
     v_draft.evidence_basis, v_draft.applicable_population, v_draft.specialty)
  returning id into v_new_version_id;

  perform set_config('app.protocol_draft_transition_authorised', 'true', true);
  update public.protocol_drafts
  set status = 'promoted', promoted_to_version_id = v_new_version_id
  where id = p_draft_id;

  return v_new_version_id;
end;
$function$;

create or replace function public.provider_credential_monitor()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_ladder jsonb;
  v_rows   jsonb;
begin
  if not private.is_complaints_handler() then
    return '{}'::jsonb;
  end if;

  v_ladder := coalesce(private.provider_quality_policy_config() -> 'credential_ladder', '{}'::jsonb);

  select coalesce(jsonb_agg(x order by x ->> 'soonest_expiry' nulls last), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'clinical_staff_id', cs.id,
      'full_name', cs.full_name,
      'doctor_tier', cs.doctor_tier,
      'is_clinical_director', (cs.doctor_tier = 'chief_medical_officer'),
      'credential_type', cs.credential_type,
      'credential_number', cs.credential_number,

      'license_expires_at', cs.license_expires_at,
      'license_state', case
        when cs.license_expires_at is null then 'not_recorded'
        when cs.license_expires_at <= now() then 'expired'
        when cs.license_expires_at <= now() + make_interval(
               days => coalesce((v_ladder ->> 'warning_days_before_expiry')::int, 30)) then 'expiring_soon'
        else 'current' end,
      'license_days_remaining', case
        when cs.license_expires_at is null then null
        else floor(extract(epoch from (cs.license_expires_at - now())) / 86400.0)::int end,
      'license_verified_at', cs.license_verified_at,

      'indemnity_expires_at', cs.indemnity_expires_at,
      'indemnity_state', case
        when cs.indemnity_exempt then 'not_applicable'
        when cs.indemnity_expires_at is null then 'not_recorded'
        when cs.indemnity_expires_at <= now() then 'expired'
        when cs.indemnity_expires_at <= now() + make_interval(
               days => coalesce((v_ladder ->> 'warning_days_before_expiry')::int, 30)) then 'expiring_soon'
        else 'current' end,

      'attestation_current', private.has_current_attestation(cs.id),
      'attestation_expires_at', (
        select max(a.expires_at) from public.clinical_staff_attestations a
        where a.clinical_staff_id = cs.id
      ),

      'restriction_id', (
        select r.id from public.provider_restrictions r
        where r.clinical_staff_id = cs.id and r.lifted_at is null
        order by array_position(
          array['warning', 'grace_period', 'service_restriction', 'suspension']::text[], r.stage::text) desc
        limit 1
      ),
      'restriction_stage', (
        select r.stage from public.provider_restrictions r
        where r.clinical_staff_id = cs.id and r.lifted_at is null
        order by array_position(
          array['warning', 'grace_period', 'service_restriction', 'suspension']::text[], r.stage::text) desc
        limit 1
      ),
      'work_restricted', private.provider_work_restricted(cs.id),
      'open_complaints', (
        select count(*) from public.provider_complaints c
        where c.subject_staff_id = cs.id and c.stage not in ('closed', 'withdrawn')
      ),
      'soonest_expiry', least(cs.license_expires_at,
                              case when cs.indemnity_exempt then null else cs.indemnity_expires_at end)
    ) as x
    from public.clinical_staff cs
    where cs.active
  ) s;

  return jsonb_build_object(
    'ladder', v_ladder,
    'generated_at', now(),
    'providers', v_rows
  );
end;
$function$;

create or replace function public.provider_scorecard(p_clinical_staff_id uuid default null::uuid, p_from timestamp with time zone default null::timestamp with time zone, p_to timestamp with time zone default null::timestamp with time zone)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_uid      uuid := (select auth.uid());
  v_staff    public.clinical_staff;
  v_from     timestamptz := coalesce(p_from, now() - interval '90 days');
  v_to       timestamptz := coalesce(p_to, now());
  v_grace    integer;
  v_entries  jsonb := '[]'::jsonb;
  v_e        jsonb;

  v_terminal integer; v_completed integer; v_prov_cancel integer; v_no_show integer;
  v_started  integer; v_on_time integer;
  v_ack_n    integer; v_ack_avg numeric;
  v_esc_n    integer; v_esc_avg numeric;
  v_sla_n    integer; v_sla_met integer;
  v_note_n   integer; v_note_done integer;
  v_ref_n    integer; v_ref_doc integer;
  v_res_n    integer; v_res_ack integer;
  v_fb_total integer; v_fb_unattributed integer;
begin
  if p_clinical_staff_id is null then
    select * into v_staff from public.clinical_staff where profile_id = v_uid;
  else
    select * into v_staff from public.clinical_staff where id = p_clinical_staff_id;
  end if;

  if v_staff.id is null then
    return '{}'::jsonb;
  end if;

  if v_staff.profile_id is distinct from v_uid and not private.is_complaints_handler() then
    return '{}'::jsonb;
  end if;

  v_grace := coalesce(
    (private.provider_quality_metric_policy('appointment_punctuality_rate') ->> 'grace_minutes')::int, 10);

  select
    count(*) filter (where status in ('completed', 'no_show', 'cancelled', 'patient_cancelled', 'provider_cancelled')),
    count(*) filter (where status = 'completed'),
    count(*) filter (where status = 'provider_cancelled'),
    count(*) filter (where status = 'no_show'),
    count(*) filter (where started_at is not null),
    count(*) filter (where started_at is not null
                       and started_at <= scheduled_for + make_interval(mins => v_grace))
  into v_terminal, v_completed, v_prov_cancel, v_no_show, v_started, v_on_time
  from public.appointments
  where clinician_id = v_staff.profile_id
    and scheduled_for >= v_from and scheduled_for <= v_to;

  select count(*), avg(extract(epoch from (acknowledged_at - created_at)) / 60.0)
  into v_ack_n, v_ack_avg
  from public.clinician_alerts
  where acknowledged_by = v_staff.profile_id and acknowledged_at is not null
    and acknowledged_at >= v_from and acknowledged_at <= v_to;

  select count(*), avg(extract(epoch from (reviewed_at - created_at)) / 3600.0)
  into v_esc_n, v_esc_avg
  from public.escalations
  where reviewed_by = v_staff.profile_id and reviewed_at is not null
    and reviewed_at >= v_from and reviewed_at <= v_to;

  select count(*), count(*) filter (where acknowledged_at <= sla_due_at)
  into v_sla_n, v_sla_met
  from public.clinician_alerts
  where acknowledged_by = v_staff.profile_id and acknowledged_at is not null
    and sla_due_at is not null
    and acknowledged_at >= v_from and acknowledged_at <= v_to;

  select count(*), count(*) filter (where n.finalized_at is not null)
  into v_note_n, v_note_done
  from public.video_consultations vc
  left join lateral (
    select max(cen.finalized_at) as finalized_at
    from public.clinical_encounter_notes cen
    where cen.video_consultation_id = vc.id and cen.status = 'finalized'
  ) n on true
  where vc.status = 'completed'
    and coalesce(vc.ended_at, vc.scheduled_at) >= v_from
    and coalesce(vc.ended_at, vc.scheduled_at) <= v_to
    and private.video_consultation_clinician(vc.id) = v_staff.profile_id;

  select count(*), count(*) filter (where coalesce(btrim(referral_reason), '') <> '')
  into v_ref_n, v_ref_doc
  from public.specialist_referrals
  where set_by = v_staff.profile_id
    and created_at >= v_from and created_at <= v_to;

  select count(*), count(*) filter (where acknowledged_at is not null)
  into v_res_n, v_res_ack
  from public.clinician_alerts
  where responsible_clinician_id = v_staff.id
    and created_at >= v_from and created_at <= v_to;

  for v_e in
    select e from unnest(array[
      private.provider_quality_metric_entry('appointment_completion_rate',
        case when v_terminal > 0 then 100.0 * v_completed / v_terminal end, v_terminal),
      private.provider_quality_metric_entry('provider_cancellation_rate',
        case when v_terminal > 0 then 100.0 * v_prov_cancel / v_terminal end, v_terminal),
      private.provider_quality_metric_entry('patient_no_show_rate',
        case when v_terminal > 0 then 100.0 * v_no_show / v_terminal end, v_terminal),
      private.provider_quality_metric_entry('appointment_punctuality_rate',
        case when v_started > 0 then 100.0 * v_on_time / v_started end, v_started),
      private.provider_quality_metric_entry('alert_response_minutes', v_ack_avg, v_ack_n),
      private.provider_quality_metric_entry('escalation_resolution_hours', v_esc_avg, v_esc_n),
      private.provider_quality_metric_entry('alert_sla_met_rate',
        case when v_sla_n > 0 then 100.0 * v_sla_met / v_sla_n end, v_sla_n),
      private.provider_quality_metric_entry('encounter_note_completion_rate',
        case when v_note_n > 0 then 100.0 * v_note_done / v_note_n end, v_note_n),
      private.provider_quality_metric_entry('referral_documentation_rate',
        case when v_ref_n > 0 then 100.0 * v_ref_doc / v_ref_n end, v_ref_n),
      private.provider_quality_metric_entry('result_acknowledgement_rate',
        case when v_res_n > 0 then 100.0 * v_res_ack / v_res_n end, v_res_n)
    ]) as e
    where e is not null
  loop
    v_entries := v_entries || v_e;
  end loop;

  for v_e in
    select private.provider_quality_metric_entry(m.metric, m.avg_rating, m.n)
    from (
      select 'experience_punctuality'::public.provider_quality_metric as metric,
             avg(punctuality_rating)::numeric as avg_rating,
             count(punctuality_rating)::int as n
      from public.consultation_feedback
      where clinician_id = v_staff.profile_id and created_at >= v_from and created_at <= v_to
      union all
      select 'experience_communication', avg(communication_rating)::numeric, count(communication_rating)::int
      from public.consultation_feedback
      where clinician_id = v_staff.profile_id and created_at >= v_from and created_at <= v_to
      union all
      select 'experience_professionalism', avg(professionalism_rating)::numeric, count(professionalism_rating)::int
      from public.consultation_feedback
      where clinician_id = v_staff.profile_id and created_at >= v_from and created_at <= v_to
      union all
      select 'experience_overall', avg(overall_rating)::numeric, count(overall_rating)::int
      from public.consultation_feedback
      where clinician_id = v_staff.profile_id and created_at >= v_from and created_at <= v_to
    ) m
    where private.provider_quality_metric_entry(m.metric, m.avg_rating, m.n) is not null
  loop
    v_entries := v_entries || v_e;
  end loop;

  select count(*), count(*) filter (where clinician_id is null)
  into v_fb_total, v_fb_unattributed
  from public.consultation_feedback
  where organisation_id = v_staff.organisation_id
    and created_at >= v_from and created_at <= v_to;

  return jsonb_build_object(
    'provider', jsonb_build_object(
      'clinical_staff_id', v_staff.id,
      'full_name', v_staff.full_name,
      'doctor_tier', v_staff.doctor_tier,
      'is_clinical_director', (v_staff.doctor_tier = 'chief_medical_officer'),
      'specialty', v_staff.specialty,
      'active', v_staff.active
    ),
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'policy', (
      select jsonb_build_object('version', version, 'signed', approved_at is not null,
                                'approved_at', approved_at)
      from public.provider_quality_policy where is_active limit 1
    ),
    'domains', jsonb_build_object(
      'operational', (select coalesce(jsonb_agg(e), '[]'::jsonb)
                      from jsonb_array_elements(v_entries) e where e ->> 'domain' = 'operational'),
      'documentation', (select coalesce(jsonb_agg(e), '[]'::jsonb)
                        from jsonb_array_elements(v_entries) e where e ->> 'domain' = 'documentation'),
      'patient_experience', (select coalesce(jsonb_agg(e), '[]'::jsonb)
                             from jsonb_array_elements(v_entries) e where e ->> 'domain' = 'patient_experience'),
      'clinical_quality', (select coalesce(jsonb_agg(e), '[]'::jsonb)
                           from jsonb_array_elements(v_entries) e where e ->> 'domain' = 'clinical_quality')
    ),
    'clinical_quality_reported', exists (
      select 1 from jsonb_array_elements(v_entries) e where e ->> 'domain' = 'clinical_quality'
    ),
    'clinical_quality_note',
      'Clinical quality indicators are reported only where the measure has been validated and signed off in clinical governance (§29.1). None currently are, so this domain is empty rather than estimated.',
    'attribution', jsonb_build_object(
      'feedback_total', v_fb_total,
      'feedback_unattributed', v_fb_unattributed,
      'feedback_unattributed_pct',
        case when v_fb_total > 0 then round(100.0 * v_fb_unattributed / v_fb_total, 1) end,
      'referrals_partial_attribution', true
    ),
    'credentials', jsonb_build_object(
      'license_expires_at', v_staff.license_expires_at,
      'indemnity_expires_at', case when v_staff.indemnity_exempt then null else v_staff.indemnity_expires_at end,
      'indemnity_exempt', v_staff.indemnity_exempt,
      'attestation_current', private.has_current_attestation(v_staff.id),
      'work_restricted', private.provider_work_restricted(v_staff.id),
      'restriction_stage', (
        select r.stage from public.provider_restrictions r
        where r.clinical_staff_id = v_staff.id and r.lifted_at is null
        order by array_position(
          array['warning', 'grace_period', 'service_restriction', 'suspension']::text[], r.stage::text) desc
        limit 1)
    ),
    'open_complaints', (
      select count(*) from public.provider_complaints
      where subject_staff_id = v_staff.id and stage not in ('closed', 'withdrawn')),
    'open_interventions', (
      select count(*) from public.provider_interventions
      where clinical_staff_id = v_staff.id and status in ('open', 'in_progress')),
    'suggested_interventions',
      coalesce(private.provider_quality_policy_config() -> 'intervention_triggers', '[]'::jsonb)
  );
end;
$function$;

create or replace function public.refer_patient_to_specialist(p_patient_id uuid, p_specialist_type text, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff       record;
  v_organisation_id uuid;
  v_specialist  public.specialist_type;
  v_new_id      uuid;
begin
  select organisation_id into v_organisation_id
  from public.profiles
  where id = p_patient_id;

  if v_organisation_id is null then
    raise exception 'patient not found';
  end if;

  select cs.* into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_organisation_id
    and cs.active;
  if v_staff.id is null then
    raise exception 'only an active member of this organisation''s care team can create a referral'
      using errcode = '42501';
  end if;

  if not (v_staff.doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')) then
    raise exception 'only a clinical-tier member of the care team can create a referral'
      using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a referral needs a reason';
  end if;

  begin
    v_specialist := p_specialist_type::public.specialist_type;
  exception when invalid_text_representation then
    raise exception '% is not a recognised specialist type', p_specialist_type;
  end;

  insert into public.specialist_referrals
    (organisation_id, patient_id, specialist_type, referral_reason, origin, set_by)
  values
    (v_organisation_id, p_patient_id, v_specialist, btrim(p_reason), 'clinically_triggered', v_staff.profile_id)
  returning id into v_new_id;

  return v_new_id;
end;
$function$;

create or replace function public.reject_protocol_draft(p_draft_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_org uuid;
  v_director uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A rejection needs a stated reason.';
  end if;

  select organisation_id into v_org from public.protocol_drafts where id = p_draft_id and status not in ('promoted', 'rejected');
  if v_org is null then
    raise exception 'Protocol draft not found, or already promoted/rejected';
  end if;

  select id into v_director
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = v_org
    and active
    and doctor_tier = 'chief_medical_officer';
  if v_director is null then
    raise exception 'Only the org''s active Clinical Director can reject a protocol draft'
      using errcode = '42501';
  end if;

  perform set_config('app.protocol_draft_transition_authorised', 'true', true);
  update public.protocol_drafts
  set status = 'rejected', rejected_reason = p_reason
  where id = p_draft_id;
end;
$function$;

create or replace function public.retire_clinical_rule(p_id uuid, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_rule  public.clinical_rules;
  v_staff public.clinical_staff;
begin
  select * into v_rule from public.clinical_rules where id = p_id;
  if v_rule is null then
    raise exception 'clinical rule version not found';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a retirement reason is required';
  end if;

  select * into v_staff from private.current_clinical_staff();

  if v_rule.status = 'active' then
    if v_staff is null or not (v_staff.doctor_tier = 'chief_medical_officer') then
      raise exception 'not authorised: only an active Clinical Director can retire a live clinical rule';
    end if;
  elsif v_rule.status in ('retired', 'rolled_back') then
    raise exception 'clinical rule % v% is already %', v_rule.rule_key, v_rule.version, v_rule.status;
  elsif not private.is_admin() then
    raise exception 'not authorised: only an admin may retire a draft or shadow clinical rule';
  end if;

  update public.clinical_rules
    set status = 'retired', retired_at = now(), retired_reason = p_reason
  where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    coalesce(v_rule.organisation_id, v_staff.organisation_id), (select auth.uid()),
    'clinical_rule.retired', 'clinical_rules', p_id,
    jsonb_build_object('rule_key', v_rule.rule_key, 'version', v_rule.version,
                       'previous_status', v_rule.status, 'reason', p_reason)
  );

  return p_id;
end;
$function$;

create or replace function public.review_emergency_record_access(p_grant_id uuid, p_outcome text, p_note text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r public.emergency_record_access_grants;
begin
  if p_outcome not in ('reviewed_ok', 'reviewed_concern') then
    raise exception 'invalid review outcome: %', p_outcome using errcode = '22023';
  end if;

  select * into r from public.emergency_record_access_grants where id = p_grant_id;
  if not found then
    raise exception 'grant not found';
  end if;

  if r.requester_id = (select auth.uid()) then
    raise exception 'a different reviewer must review this request' using errcode = '42501';
  end if;

  if not (
    exists (
      select 1 from public.clinical_staff cs
      where cs.profile_id = (select auth.uid())
        and cs.organisation_id = r.patient_org_id
        and cs.active
        and cs.doctor_tier = 'chief_medical_officer'
    )
    or private.is_admin()
  ) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  update public.emergency_record_access_grants
    set review_status = p_outcome, reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = p_note
    where id = p_grant_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    r.patient_org_id, (select auth.uid()), 'clinician.emergency_record_access_reviewed', 'patient', r.patient_id,
    jsonb_build_object('grant_id', p_grant_id, 'outcome', p_outcome, 'note', p_note)
  );
end;
$function$;

create or replace function public.rollback_clinical_rule(p_rule_key text, p_to_version integer, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff   public.clinical_staff;
  v_current public.clinical_rules;
  v_target  public.clinical_rules;
begin
  select * into v_staff from private.current_clinical_staff();
  if v_staff is null or not (v_staff.doctor_tier = 'chief_medical_officer') then
    raise exception 'not authorised: only an active Clinical Director can roll back a clinical rule';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a rollback reason is required: it is the clinical record of why the live rule was withdrawn';
  end if;

  select * into v_current
    from public.clinical_rules where rule_key = p_rule_key and status = 'active';
  if v_current is null then
    raise exception 'clinical rule % has no active version to roll back', p_rule_key;
  end if;

  select * into v_target
    from public.clinical_rules where rule_key = p_rule_key and version = p_to_version;
  if v_target is null then
    raise exception 'clinical rule % has no version %', p_rule_key, p_to_version;
  end if;
  if v_target.id = v_current.id then
    raise exception 'version % of % is the version currently live; nothing to roll back to', p_to_version, p_rule_key;
  end if;
  if v_target.approved_by is null then
    raise exception 'version % of % was never signed, so it cannot be rolled back to', p_to_version, p_rule_key;
  end if;

  update public.clinical_rules
    set status = 'rolled_back',
        rolled_back_at = now(),
        rollback_reason = p_reason
  where id = v_current.id;

  update public.clinical_rules
    set status = 'active',
        activated_at = now(),
        retired_at = null,
        retired_reason = null
  where id = v_target.id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    coalesce(v_current.organisation_id, v_staff.organisation_id), (select auth.uid()),
    'clinical_rule.rolled_back', 'clinical_rules', v_current.id,
    jsonb_build_object(
      'rule_key', p_rule_key,
      'withdrawn_version', v_current.version,
      'restored_version', v_target.version,
      'reason', p_reason,
      'by_clinical_staff', v_staff.id
    )
  );

  return v_target.id;
end;
$function$;

create or replace function public.set_ai_system_enabled(p_id uuid, p_enabled boolean, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  s        record;
  v_actor  uuid := (select auth.uid());
  v_staff  uuid;
  v_org    uuid;
  v_rec    uuid;
  v_report jsonb;
begin
  select * into s from public.ai_systems where id = p_id;
  if s.id is null then
    raise exception 'AI system not found';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'switching an AI system % requires a reason on the record',
      case when p_enabled then 'on' else 'off' end;
  end if;

  select cs.id, cs.organisation_id into v_staff, v_org
  from public.clinical_staff cs
  where cs.profile_id = v_actor and cs.active and cs.doctor_tier = 'chief_medical_officer'
  limit 1;

  if v_staff is null and not private.is_admin() then
    raise exception 'not authorised: only an admin or an active Clinical Director can operate the AI kill switch';
  end if;

  v_org := coalesce(v_org, (select organisation_id from public.profiles where id = v_actor));

  if p_enabled then
    v_report := private.ai_acceptance_criteria(p_id);
    if not coalesce((v_report->>'satisfied')::boolean, false) then
      raise exception 'AI system % cannot be switched on yet -- outstanding acceptance criteria (40.20): %',
        s.system_code, v_report->'outstanding';
    end if;

    update public.ai_systems
       set lifecycle_status = 'live',
           is_enabled       = true,
           disabled_at      = null,
           disabled_by      = null,
           disabled_reason  = null
     where id = p_id;
  else
    update public.ai_systems
       set is_enabled       = false,
           lifecycle_status = 'suspended',
           disabled_at      = now(),
           disabled_by      = v_actor,
           disabled_reason  = p_reason
     where id = p_id;

    for v_rec in
      select distinct cs.profile_id
      from public.clinical_staff cs
      where cs.active and cs.doctor_tier = 'chief_medical_officer' and cs.profile_id is not null
      union
      select p.id from public.profiles p where p.role = 'admin'
    loop
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload,
         content_class, priority, source_table, source_id)
      values (
        v_org, v_rec, 'in_app', 'pending', 'ai_system_disabled',
        jsonb_build_object(
          'ai_system', s.name,
          'system_code', s.system_code,
          'reason', p_reason,
          'fallback', s.fallback_behaviour
        ),
        'non_clinical', 'critical', 'ai_systems', p_id
      );
    end loop;
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org, v_actor,
    case when p_enabled then 'ai_system.enabled' else 'ai_system.disabled' end,
    'ai_systems', p_id,
    jsonb_build_object(
      'system_code', s.system_code,
      'reason', p_reason,
      'by_clinical_staff', v_staff
    )
  );

  return private.ai_acceptance_criteria(p_id);
end;
$function$;

create or replace function public.sign_alert_rules(p_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.alert_rules where id = p_id) then
    raise exception 'Alert rules config version not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.doctor_tier = 'chief_medical_officer'
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the alert rules config';
  end if;

  update public.alert_rules set is_active = false
    where is_active and id <> p_id;

  update public.alert_rules
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'alert_rules.signed',
         'alert_rules', p_id,
         jsonb_build_object('signed_by_clinical_staff', v_staff)
  from public.clinical_staff cs where cs.id = v_staff;

  return p_id;
end;
$function$;

create or replace function public.sign_clinical_rule(p_id uuid, p_activate boolean default true)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_rule   public.clinical_rules;
  v_staff  public.clinical_staff;
  v_prior  public.clinical_rules;
begin
  select * into v_staff from private.current_clinical_staff();
  if v_staff is null or not (v_staff.doctor_tier = 'chief_medical_officer') then
    raise exception 'not authorised: only an active Clinical Director can sign a clinical rule';
  end if;

  select * into v_rule from public.clinical_rules where id = p_id;
  if v_rule is null then
    raise exception 'clinical rule version not found';
  end if;
  if v_rule.status not in ('draft', 'shadow') then
    raise exception 'only a draft or shadow rule can be signed (this one is %)', v_rule.status;
  end if;
  if v_rule.protocol_version_id is null then
    raise exception 'clinical rule % v% has no protocol_version_id: a rule that acts must name the signed protocol its thresholds come from',
      v_rule.rule_key, v_rule.version;
  end if;
  if v_rule.owner_clinical_staff_id is null then
    raise exception 'clinical rule % v% has no owner: assign an accountable clinical_staff owner before signing',
      v_rule.rule_key, v_rule.version;
  end if;

  if p_activate then
    select * into v_prior
      from public.clinical_rules
      where rule_key = v_rule.rule_key and status = 'active' and id <> p_id;

    if v_prior is not null then
      update public.clinical_rules
        set status = 'retired',
            retired_at = now(),
            retired_reason = format('Superseded by version %s, signed by %s.', v_rule.version, v_staff.full_name)
      where id = v_prior.id;
    end if;
  end if;

  update public.clinical_rules
    set approved_by  = v_staff.id,
        approved_at  = now(),
        status       = case when p_activate then 'active' else status end,
        activated_at = case when p_activate then now() else activated_at end
  where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    coalesce(v_rule.organisation_id, v_staff.organisation_id), (select auth.uid()),
    case when p_activate then 'clinical_rule.signed_and_activated' else 'clinical_rule.signed' end,
    'clinical_rules', p_id,
    jsonb_build_object(
      'rule_key', v_rule.rule_key,
      'version', v_rule.version,
      'signed_by_clinical_staff', v_staff.id,
      'protocol_version_id', v_rule.protocol_version_id,
      'superseded_version_id', v_prior.id
    )
  );

  return p_id;
end;
$function$;

create or replace function public.sign_cv_risk_config(p_config_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_org uuid;
  v_staff uuid;
begin
  select organisation_id into v_org from public.cv_risk_config where id = p_config_id;
  if v_org is null then
    raise exception 'CV-risk configuration not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_org
    and cs.active
    and cs.doctor_tier = 'chief_medical_officer'
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the CV-risk configuration';
  end if;

  update public.cv_risk_config set is_active = false
    where organisation_id = v_org and is_active and id <> p_config_id;

  update public.cv_risk_config
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_config_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values
    (v_org, (select auth.uid()), 'cv_risk_config.signed', 'cv_risk_config', p_config_id,
     jsonb_build_object('signed_by_clinical_staff', v_staff));

  return p_config_id;
end $function$;

create or replace function public.sign_escalation_slas(p_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.escalation_slas where id = p_id) then
    raise exception 'Escalation SLA config version not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.doctor_tier = 'chief_medical_officer'
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the escalation SLA config';
  end if;

  update public.escalation_slas set is_active = false
    where is_active and id <> p_id;

  update public.escalation_slas
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'escalation_slas.signed',
         'escalation_slas', p_id,
         jsonb_build_object('signed_by_clinical_staff', v_staff)
  from public.clinical_staff cs where cs.id = v_staff;

  return p_id;
end;
$function$;

create or replace function public.sign_lpe_content_block(p_block_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.lpe_content_blocks where id = p_block_id) then
    raise exception 'Content block not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.doctor_tier = 'chief_medical_officer'
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can approve patient-facing content';
  end if;

  update public.lpe_content_blocks
    set clinician_reviewed = true, reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_block_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, event)
  values (
    (select auth.uid()), 'lpe_content_blocks.reviewed', 'lpe_content_blocks', p_block_id,
    jsonb_build_object('signed_by_clinical_staff', v_staff)
  );

  return p_block_id;
end $function$;

create or replace function public.sign_mental_health_screening_cadences(p_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.mental_health_screening_cadences where id = p_id) then
    raise exception 'Mental-health screening cadence version not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier = 'chief_medical_officer'
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the mental-health screening cadence config';
  end if;

  update public.mental_health_screening_cadences set is_active = false where is_active and id <> p_id;
  update public.mental_health_screening_cadences set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'mental_health_screening_cadences.signed',
         'mental_health_screening_cadences', p_id, jsonb_build_object('signed_by_clinical_staff', v_staff)
  from public.clinical_staff cs where cs.id = v_staff;

  return p_id;
end;
$function$;

create or replace function public.sign_provider_quality_policy(p_policy_id uuid)
 returns provider_quality_policy
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff_id uuid;
  v_row      public.provider_quality_policy;
begin
  select cs.id into v_staff_id
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.doctor_tier = 'chief_medical_officer';

  if v_staff_id is null then
    raise exception 'only an active Clinical Director may sign the provider quality policy'
      using errcode = '42501';
  end if;

  update public.provider_quality_policy
    set is_active = false
    where is_active and id <> p_policy_id;

  update public.provider_quality_policy
    set approved_by = v_staff_id,
        approved_at = now(),
        is_active = true
    where id = p_policy_id
    returning * into v_row;

  if v_row.id is null then
    raise exception 'provider quality policy version not found';
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'provider_quality_policy.signed',
         'provider_quality_policy', v_row.id,
         jsonb_build_object('version', v_row.version)
  from public.clinical_staff cs where cs.id = v_staff_id;

  return v_row;
end;
$function$;

create or replace function public.sign_risk_questionnaire_config(p_config_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_org uuid;
  v_code text;
  v_staff uuid;
begin
  select organisation_id, code into v_org, v_code
  from public.risk_questionnaire_configs where id = p_config_id;
  if v_org is null then
    raise exception 'Risk questionnaire configuration not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_org
    and cs.active
    and cs.doctor_tier = 'chief_medical_officer'
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign a risk questionnaire configuration';
  end if;

  update public.risk_questionnaire_configs set is_active = false
    where organisation_id = v_org and code = v_code and is_active and id <> p_config_id;

  update public.risk_questionnaire_configs
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_config_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values
    (v_org, (select auth.uid()), 'risk_questionnaire_config.signed', 'risk_questionnaire_configs', p_config_id,
     jsonb_build_object('signed_by_clinical_staff', v_staff, 'code', v_code));

  return p_config_id;
end $function$;

create or replace function public.sign_triage_protocol(p_protocol_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.triage_protocols where id = p_protocol_id) then
    raise exception 'Triage protocol not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.doctor_tier = 'chief_medical_officer'
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the symptom triage protocol';
  end if;

  update public.triage_protocols set is_active = false where is_active and id <> p_protocol_id;

  update public.triage_protocols
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_protocol_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, event)
  values (
    (select auth.uid()), 'triage_protocols.signed', 'triage_protocols', p_protocol_id,
    jsonb_build_object('signed_by_clinical_staff', v_staff)
  );

  return p_protocol_id;
end $function$;

create or replace function public.sign_triage_protocols(p_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.triage_protocols where id = p_id) then
    raise exception 'Triage protocol config version not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.doctor_tier = 'chief_medical_officer'
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the triage protocol config';
  end if;

  update public.triage_protocols set is_active = false
    where is_active and id <> p_id;

  update public.triage_protocols
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'triage_protocols.signed',
         'triage_protocols', p_id,
         jsonb_build_object('signed_by_clinical_staff', v_staff)
  from public.clinical_staff cs where cs.id = v_staff;

  return p_id;
end;
$function$;

create or replace function public.sign_vaccination_schedule(p_signoff_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.vaccination_schedule_signoffs where id = p_signoff_id) then
    raise exception 'Vaccination schedule sign-off record not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.doctor_tier = 'chief_medical_officer'
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the vaccination schedule';
  end if;

  update public.vaccination_schedule_signoffs set is_active = false
    where is_active and id <> p_signoff_id;

  update public.vaccination_schedule_signoffs
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_signoff_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'vaccination_schedule.signed',
         'vaccination_schedule_signoffs', p_signoff_id,
         jsonb_build_object('signed_by_clinical_staff', v_staff)
  from public.clinical_staff cs where cs.id = v_staff;

  return p_signoff_id;
end $function$;

-- ---------------------------------------------------------------------------
-- 4. Drop is_clinical_director -- safe now, every function above that used
--    to reference it has been redefined without it.
-- ---------------------------------------------------------------------------

alter table public.clinical_staff drop column is_clinical_director;

-- ---------------------------------------------------------------------------
-- 5. alert_rules: a new active config version with every owner_tier/
--    backup_tier/senior_tier literal remapped. Versioned/approved like any
--    other governance config, not mutated in place -- deactivate the prior
--    version rather than editing it.
-- ---------------------------------------------------------------------------

insert into public.alert_rules (version, config, notes, is_active)
select
  version + 1,
  (
    select jsonb_agg(
      entry
      || jsonb_build_object(
        'owner_tier', case entry->>'owner_tier'
          when 'tier_1' then 'medical_officer'
          when 'tier_2' then 'medical_officer'
          when 'tier_3' then 'senior_medical_officer'
          when 'tier_4_senior_registrar' then 'senior_medical_officer'
          when 'tier_5_partner_specialist' then 'senior_medical_officer'
          else entry->>'owner_tier'
        end
      )
      || jsonb_build_object(
        'backup_tier', case entry->>'backup_tier'
          when 'tier_1' then 'medical_officer'
          when 'tier_2' then 'medical_officer'
          when 'tier_3' then 'senior_medical_officer'
          when 'tier_4_senior_registrar' then 'senior_medical_officer'
          when 'tier_5_partner_specialist' then 'senior_medical_officer'
          else entry->>'backup_tier'
        end
      )
      || jsonb_build_object(
        'senior_tier', case entry->>'senior_tier'
          when 'tier_1' then 'medical_officer'
          when 'tier_2' then 'medical_officer'
          when 'tier_3' then 'senior_medical_officer'
          when 'tier_4_senior_registrar' then 'senior_medical_officer'
          when 'tier_5_partner_specialist' then 'senior_medical_officer'
          else entry->>'senior_tier'
        end
      )
    )
    from jsonb_array_elements(alert_rules.config) as entry
  ),
  'Tier literals remapped to the 3-tier ladder (medical_officer/senior_medical_officer/chief_medical_officer) by the 20260830231508 tier-collapse migration. Content otherwise unchanged from the version this supersedes.',
  true
from public.alert_rules
where is_active;

update public.alert_rules
  set is_active = false
  where is_active and id <> (select id from public.alert_rules order by version desc limit 1);

-- ---------------------------------------------------------------------------
-- 6. Assertions -- the migration is the test.
-- ---------------------------------------------------------------------------

do $$
declare
  v_enum_count int;
  v_tier_counts jsonb;
  v_director_col_count int;
  v_applies_to_director_col_count int;
  v_alert_rules_active_count int;
  v_alert_rules_stale_literal_count int;
  v_incident_report_tier_counts jsonb;
  v_emergency_grants_policy_count int;
begin
  select count(*) into v_emergency_grants_policy_count
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  where c.relname = 'emergency_record_access_grants'
    and pol.polname = 'emergency_record_access_grants_select'
    and pg_get_expr(pol.polqual, pol.polrelid) like '%doctor_tier = ''chief_medical_officer''%';
  if v_emergency_grants_policy_count <> 1 then
    raise exception 'emergency_record_access_grants_select was not correctly recreated with the tier-based check';
  end if;

  select count(*) into v_enum_count from pg_enum where enumtypid = 'public.doctor_tier'::regtype;
  if v_enum_count <> 4 then
    raise exception 'public.doctor_tier has % values, expected 4', v_enum_count;
  end if;

  select jsonb_object_agg(coalesce(doctor_tier::text, 'null'), n) into v_tier_counts
  from (
    select doctor_tier, count(*) n from public.clinical_staff group by doctor_tier
  ) t;
  if v_tier_counts is distinct from jsonb_build_object(
    'care_coordinator', 1, 'medical_officer', 3, 'senior_medical_officer', 3, 'chief_medical_officer', 1
  ) then
    raise exception 'clinical_staff doctor_tier distribution drifted from the expected remap. Got: %', v_tier_counts;
  end if;

  select count(*) into v_director_col_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'clinical_staff' and column_name = 'is_clinical_director';
  if v_director_col_count <> 0 then
    raise exception 'clinical_staff.is_clinical_director still exists after the migration';
  end if;

  select count(*) into v_applies_to_director_col_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'clinical_staff_indemnity_exemptions'
    and column_name = 'applies_to_director';
  if v_applies_to_director_col_count <> 0 then
    raise exception 'clinical_staff_indemnity_exemptions.applies_to_director still exists after the migration';
  end if;

  -- The one live indemnity exemption (founder's org-wide director exemption)
  -- must have remapped to a chief_medical_officer tier-scoped exemption.
  if not exists (
    select 1 from public.clinical_staff_indemnity_exemptions
    where doctor_tier = 'chief_medical_officer'
  ) then
    raise exception 'expected the founder''s director-wide indemnity exemption to have remapped to a chief_medical_officer tier exemption';
  end if;

  select jsonb_object_agg(coalesce(reviewed_by_tier::text, 'null'), n) into v_incident_report_tier_counts
  from (select reviewed_by_tier, count(*) n from public.clinical_incident_reports group by reviewed_by_tier) t;
  if v_incident_report_tier_counts is distinct from jsonb_build_object('null', 2, 'medical_officer', 1) then
    raise exception 'clinical_incident_reports.reviewed_by_tier distribution drifted from the expected remap. Got: %', v_incident_report_tier_counts;
  end if;

  select count(*) into v_alert_rules_active_count from public.alert_rules where is_active;
  if v_alert_rules_active_count <> 1 then
    raise exception 'expected exactly 1 active alert_rules version after the remap, found %', v_alert_rules_active_count;
  end if;

  select count(*) into v_alert_rules_stale_literal_count
  from public.alert_rules, jsonb_array_elements(config) as entry
  where is_active
    and (
      entry->>'owner_tier' in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
      or entry->>'backup_tier' in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
      or entry->>'senior_tier' in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
    );
  if v_alert_rules_stale_literal_count <> 0 then
    raise exception 'the active alert_rules version still contains % entries with a retired tier literal', v_alert_rules_stale_literal_count;
  end if;

  -- Proves every rewritten gate function still compiles and executes cleanly
  -- post-swap (returns null/false here since auth.uid() has no real request
  -- context inside a migration -- the point is that calling it doesn't raise).
  perform private.is_clinical_tier('00000000-0000-0000-0000-000000000001');
  perform private.has_prescribing_authority('00000000-0000-0000-0000-000000000001');
  perform private.can_handle_emergency_escalation('00000000-0000-0000-0000-000000000001');
  perform private.can_confirm_medication_refill('00000000-0000-0000-0000-000000000001');
  perform private.can_attest_health_passport('00000000-0000-0000-0000-000000000001');
end $$;
