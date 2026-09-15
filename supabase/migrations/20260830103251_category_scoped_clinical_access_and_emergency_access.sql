-- =====================================================================================
-- Part B: category-scoped caregiver access. Replaces the single all-or-nothing
-- profile_access.clinical_access switch with 8 independently toggleable categories, so a
-- caregiver can be given "appointments and medications" without also getting "sexual
-- health" -- the exact worked example in the founder's own consent-engine spec.
--
-- Part D: break-glass emergency access. The only real access boundary in this codebase
-- is cross-organisation (private.is_org_staff is org-wide within one org) -- so break-glass
-- means a clinician at Org B getting time-boxed, reason-required, reviewed-afterward access
-- to a patient whose home record is at Org A.
--
-- Combined into one migration because both rewrite the identical DROP POLICY/CREATE POLICY
-- statements on the same ~29 tables -- doing this as two passes would double the diff
-- surface and the chance of the two efforts' policy text drifting apart.
-- =====================================================================================

-- ---------------------------------------------------------------------------
-- B1. The category taxonomy and its junction table.
-- ---------------------------------------------------------------------------
create type public.care_access_category as enum (
  'appointments_care_plan', 'vitals_readings', 'medications', 'labs_results',
  'vaccinations', 'messaging', 'reproductive_health', 'medical_history'
);

create table public.profile_access_categories (
  profile_access_id uuid not null references public.profile_access (id) on delete cascade,
  category          public.care_access_category not null,
  granted_at        timestamptz not null default now(),
  primary key (profile_access_id, category)
);

alter table public.profile_access_categories enable row level security;

create policy profile_access_categories_select on public.profile_access_categories
  for select to authenticated
  using (
    exists (
      select 1 from public.profile_access pa
      where pa.id = profile_access_categories.profile_access_id
        and (pa.profile_id = (select auth.uid()) or pa.grantee_user_id = (select auth.uid()))
    )
    or private.is_admin()
  );

grant select on public.profile_access_categories to authenticated;

create or replace function private.enforce_category_access_owner()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_owner uuid;
  v_uid   uuid := (select auth.uid());
begin
  select profile_id into v_owner from public.profile_access
    where id = coalesce(new.profile_access_id, old.profile_access_id);

  if v_uid is null or v_uid is distinct from v_owner then
    raise exception
      'only the person whose record it is may change who can see their health information'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$function$;

drop trigger if exists profile_access_categories_owner_guard on public.profile_access_categories;
create trigger profile_access_categories_owner_guard
  before insert or delete on public.profile_access_categories
  for each row execute function private.enforce_category_access_owner();

create or replace function private.log_category_access_lifecycle()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_org    uuid;
  v_owner  uuid;
  v_other  uuid;
  v_actor  uuid := (select auth.uid());
  v_kind   public.care_access_event_kind;
  v_cat    public.care_access_category := coalesce(new.category, old.category);
  v_paid   uuid := coalesce(new.profile_access_id, old.profile_access_id);
begin
  select pa.profile_id, pa.grantee_user_id into v_owner, v_other
    from public.profile_access pa where pa.id = v_paid;
  if v_owner is null then
    return coalesce(new, old);
  end if;

  select organisation_id into v_org from public.profiles where id = v_owner;
  if v_org is null then
    return coalesce(new, old);
  end if;

  v_kind := case when tg_op = 'INSERT' then 'category_access_granted' else 'category_access_withdrawn' end;

  begin
    insert into public.care_access_events
      (organisation_id, patient_id, actor_profile_id, subject_profile_id, kind, metadata)
    values
      (v_org, v_owner, v_actor, v_other, v_kind, jsonb_build_object('category', v_cat));
  exception
    when others then
      raise warning 'category access lifecycle log failed for grant % (%): %', v_paid, v_kind, sqlerrm;
  end;

  return coalesce(new, old);
end;
$function$;

drop trigger if exists profile_access_categories_lifecycle_log on public.profile_access_categories;
create trigger profile_access_categories_lifecycle_log
  after insert or delete on public.profile_access_categories
  for each row execute function private.log_category_access_lifecycle();

insert into public.profile_access_categories (profile_access_id, category)
select pa.id, cat.category
from public.profile_access pa
cross join (
  select unnest(enum_range(null::public.care_access_category)) as category
) cat
where pa.clinical_access = true
  and cat.category <> 'reproductive_health';

-- ---------------------------------------------------------------------------
-- D1. Break-glass: cross-organisation emergency access.
-- ---------------------------------------------------------------------------
create table public.emergency_record_access_grants (
  id               uuid primary key default gen_random_uuid(),
  requester_id     uuid not null references public.profiles (id),
  requester_org_id uuid not null references public.organisations (id),
  patient_id       uuid not null references public.profiles (id),
  patient_org_id   uuid not null references public.organisations (id),
  reason           text not null check (length(btrim(reason)) > 0),
  granted_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  ended_at         timestamptz,
  review_status    text not null default 'pending_review'
                     check (review_status in ('pending_review', 'reviewed_ok', 'reviewed_concern')),
  reviewed_by      uuid references public.profiles (id),
  reviewed_at      timestamptz,
  review_note      text,
  created_at       timestamptz not null default now()
);

create index emergency_record_access_grants_patient_idx on public.emergency_record_access_grants (patient_id);
create index emergency_record_access_grants_requester_idx on public.emergency_record_access_grants (requester_id);

alter table public.emergency_record_access_grants enable row level security;

create policy emergency_record_access_grants_select on public.emergency_record_access_grants
  for select to authenticated
  using (
    requester_id = (select auth.uid())
    or exists (
      select 1 from public.clinical_staff cs
      where cs.profile_id = (select auth.uid())
        and cs.organisation_id = emergency_record_access_grants.patient_org_id
        and cs.active
        and cs.is_clinical_director
    )
    or private.is_admin()
  );

grant select on public.emergency_record_access_grants to authenticated;

create or replace function private.is_active_clinical_staff(org uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
  );
$function$;

create or replace function private.has_emergency_access(p_patient uuid, p_category public.care_access_category default null)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.emergency_record_access_grants g
    where g.patient_id = p_patient
      and g.requester_id = (select auth.uid())
      and g.ended_at is null
      and g.expires_at > now()
      and (p_category is null or p_category <> 'reproductive_health')
  );
$function$;

create or replace function public.request_emergency_record_access(p_patient_id uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_requester_org uuid;
  v_patient_org   uuid;
  v_grant_id      uuid;
  v_expires_at    timestamptz;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a reason is required to request emergency access' using errcode = '22023';
  end if;

  select organisation_id into v_requester_org
    from public.clinical_staff where profile_id = (select auth.uid()) and active
    limit 1;
  if v_requester_org is null then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select organisation_id into v_patient_org from public.profiles where id = p_patient_id;
  if v_patient_org is null then
    raise exception 'unknown patient';
  end if;

  if v_patient_org = v_requester_org then
    raise exception 'this patient is already in your organisation -- use the normal chart view'
      using errcode = '22023';
  end if;

  v_expires_at := now() + interval '8 hours';

  insert into public.emergency_record_access_grants
    (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
  values
    ((select auth.uid()), v_requester_org, p_patient_id, v_patient_org, btrim(p_reason), v_expires_at)
  returning id into v_grant_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_patient_org, (select auth.uid()), 'clinician.emergency_record_access_requested', 'patient', p_patient_id,
    jsonb_build_object('reason', btrim(p_reason), 'grant_id', v_grant_id, 'requester_org_id', v_requester_org)
  );

  return jsonb_build_object('id', v_grant_id, 'expires_at', v_expires_at);
end;
$function$;

create or replace function public.review_emergency_record_access(p_grant_id uuid, p_outcome text, p_note text default null)
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
        and cs.is_clinical_director
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

create or replace function public.patient_exists_cross_org(p_patient_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_name text;
  v_org  uuid;
begin
  if not exists (select 1 from public.clinical_staff where profile_id = (select auth.uid()) and active) then
    return null;
  end if;

  select full_name, organisation_id into v_name, v_org
    from public.profiles where id = p_patient_id and role = 'patient';

  if v_org is null then
    return null;
  end if;

  return jsonb_build_object('full_name', v_name, 'organisation_id', v_org);
end;
$function$;

-- ---------------------------------------------------------------------------
-- B2/D2. The new category-aware can_read_clinical, and set_care_access_categories.
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
        (pa.permission_level = 'manage' and p.is_dependent_account and p_category <> 'reproductive_health')
        or exists (
          select 1 from public.profile_access_categories pac
          where pac.profile_access_id = pa.id and pac.category = p_category
        )
      )
  );
$function$;

create or replace function public.set_care_access_categories(p_grant_id uuid, p_categories public.care_access_category[])
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_owner uuid;
begin
  select profile_id into v_owner from public.profile_access where id = p_grant_id;
  if v_owner is null then
    raise exception 'grant not found';
  end if;
  if v_owner <> (select auth.uid()) then
    raise exception
      'only the person whose record it is may change who can see their health information'
      using errcode = '42501';
  end if;

  delete from public.profile_access_categories
    where profile_access_id = p_grant_id
      and category <> all (coalesce(p_categories, array[]::public.care_access_category[]));

  insert into public.profile_access_categories (profile_access_id, category)
  select p_grant_id, c
  from unnest(coalesce(p_categories, array[]::public.care_access_category[])) as c
  on conflict (profile_access_id, category) do nothing;
end;
$function$;

-- ---------------------------------------------------------------------------
-- B3/D3. Rewrite every SELECT (and the 2 messaging INSERT) policy that used the old
-- can_read_clinical(uuid) to the new can_read_clinical(uuid, category) OR
-- has_emergency_access(uuid, category) form.
-- ---------------------------------------------------------------------------

drop policy if exists care_message_attachments_select on public.care_message_attachments;
create policy care_message_attachments_select on public.care_message_attachments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'messaging')
    or private.has_emergency_access(patient_id, 'messaging')
  );

drop policy if exists care_message_threads_select on public.care_message_threads;
create policy care_message_threads_select on public.care_message_threads
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'messaging')
    or private.has_emergency_access(patient_id, 'messaging')
  );

drop policy if exists care_message_threads_insert on public.care_message_threads;
create policy care_message_threads_insert on public.care_message_threads
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'messaging')
    or private.has_emergency_access(patient_id, 'messaging')
  );

drop policy if exists care_messages_select on public.care_messages;
create policy care_messages_select on public.care_messages
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'messaging')
    or private.has_emergency_access(patient_id, 'messaging')
  );

drop policy if exists care_messages_insert on public.care_messages;
create policy care_messages_insert on public.care_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.care_message_threads t
      where t.id = care_messages.thread_id
        and (
          t.patient_id = (select auth.uid())
          or private.is_org_staff(t.organisation_id)
          or private.can_read_clinical(t.patient_id, 'messaging')
          or private.has_emergency_access(t.patient_id, 'messaging')
        )
    )
  );

drop policy if exists care_plan_goals_select on public.care_plan_goals;
create policy care_plan_goals_select on public.care_plan_goals
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'appointments_care_plan')
    or private.has_emergency_access(patient_id, 'appointments_care_plan')
  );

drop policy if exists care_plan_interventions_select on public.care_plan_interventions;
create policy care_plan_interventions_select on public.care_plan_interventions
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'appointments_care_plan')
    or private.has_emergency_access(patient_id, 'appointments_care_plan')
  );

drop policy if exists care_plans_select on public.care_plans;
create policy care_plans_select on public.care_plans
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'appointments_care_plan')
    or private.has_emergency_access(patient_id, 'appointments_care_plan')
  );

-- care_vouchers is a payment/gifting object, not clinical data -- conceptually it doesn't
-- belong in this category system at all (flagged for founder review). Provisionally
-- bucketed into medical_history, preserving today's "some clinical trust required"
-- behaviour without inventing a 9th category for one table. No emergency-access branch:
-- break-glass covers acute-care reading, not gift/voucher visibility.
drop policy if exists care_vouchers_select on public.care_vouchers;
create policy care_vouchers_select on public.care_vouchers
  for select to authenticated
  using (
    beneficiary_profile_id = (select auth.uid())
    or purchaser_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(beneficiary_profile_id, 'medical_history')
  );

drop policy if exists clinical_summaries_select on public.clinical_summaries;
create policy clinical_summaries_select on public.clinical_summaries
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history')
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists clinician_alerts_select on public.clinician_alerts;
create policy clinician_alerts_select on public.clinician_alerts
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history')
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists escalations_select on public.escalations;
create policy escalations_select on public.escalations
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history')
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists lab_analyte_readings_select on public.lab_analyte_readings;
create policy lab_analyte_readings_select on public.lab_analyte_readings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results')
    or private.has_emergency_access(patient_id, 'labs_results')
  );

drop policy if exists lab_orders_select on public.lab_orders;
create policy lab_orders_select on public.lab_orders
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results')
    or private.has_emergency_access(patient_id, 'labs_results')
  );

drop policy if exists medication_logs_select on public.medication_logs;
create policy medication_logs_select on public.medication_logs
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medications')
    or private.has_emergency_access(patient_id, 'medications')
  );

drop policy if exists medications_select on public.medications;
create policy medications_select on public.medications
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medications')
    or private.has_emergency_access(patient_id, 'medications')
  );

drop policy if exists patient_blood_profile_select on public.patient_blood_profile;
create policy patient_blood_profile_select on public.patient_blood_profile
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history')
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists patient_cardiovascular_profile_select on public.patient_cardiovascular_profile;
create policy patient_cardiovascular_profile_select on public.patient_cardiovascular_profile
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history')
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists patient_quarterly_reports_select on public.patient_quarterly_reports;
create policy patient_quarterly_reports_select on public.patient_quarterly_reports
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history')
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists patient_risk_scores_select on public.patient_risk_scores;
create policy patient_risk_scores_select on public.patient_risk_scores
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history')
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists patient_serology_status_select on public.patient_serology_status;
create policy patient_serology_status_select on public.patient_serology_status
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history')
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists patient_timeline_select on public.patient_timeline;
create policy patient_timeline_select on public.patient_timeline
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history')
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists reproductive_health_profiles_select on public.reproductive_health_profiles;
create policy reproductive_health_profiles_select on public.reproductive_health_profiles
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'reproductive_health')
    or private.has_emergency_access(patient_id, 'reproductive_health')
  );

drop policy if exists screening_results_select on public.screening_results;
create policy screening_results_select on public.screening_results
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results')
    or private.has_emergency_access(patient_id, 'labs_results')
  );

drop policy if exists screening_schedules_select on public.screening_schedules;
create policy screening_schedules_select on public.screening_schedules
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results')
    or private.has_emergency_access(patient_id, 'labs_results')
  );

drop policy if exists symptom_triage_assessments_select on public.symptom_triage_assessments;
create policy symptom_triage_assessments_select on public.symptom_triage_assessments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history')
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists vaccination_records_select on public.vaccination_records;
create policy vaccination_records_select on public.vaccination_records
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(profile_id, 'vaccinations')
    or private.has_emergency_access(profile_id, 'vaccinations')
  );

drop policy if exists vaccination_schedules_select on public.vaccination_schedules;
create policy vaccination_schedules_select on public.vaccination_schedules
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'vaccinations')
    or private.has_emergency_access(patient_id, 'vaccinations')
  );

drop policy if exists vitals_readings_select on public.vitals_readings;
create policy vitals_readings_select on public.vitals_readings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'vitals_readings')
    or private.has_emergency_access(patient_id, 'vitals_readings')
  );

-- ---------------------------------------------------------------------------
-- B4/D4. Rewrite the 5 non-RLS functions that called can_read_clinical(uuid).
-- Cross-cutting helpers (record corrections, full-record search, the receipt's clinical
-- tier) get 'medical_history', the broadest bucket -- same reasoning as patient_timeline.
-- Messaging helpers get 'messaging'. None of these five carry emergency-access coverage:
-- break-glass covers the acute-care RLS surface above, not every ancillary helper.
-- ---------------------------------------------------------------------------

create or replace function private.can_read_record_correction(p_table_name text, p_organisation_id uuid, p_patient_id uuid, p_corrected_by uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select
    private.is_admin()
    or (p_corrected_by is not null and p_corrected_by = (select auth.uid()))
    or (p_patient_id is not null and (
      p_patient_id = (select auth.uid())
      or private.can_read_clinical(p_patient_id, 'medical_history')
    ))
    or (p_table_name in ('profiles', 'lab_result_documents')
        and p_patient_id is not null
        and private.is_lab_liaison()
        and p_organisation_id is not null
        and p_organisation_id = private.current_org_id())
    or (p_table_name = 'clinical_staff'
        and p_organisation_id is not null
        and p_organisation_id = private.current_org_id())
    or (p_organisation_id is not null and private.is_org_staff(p_organisation_id));
$function$;

create or replace function public.mark_care_message_thread_read(p_thread_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select organisation_id, patient_id into v_org, v_patient
  from public.care_message_threads where id = p_thread_id;
  if v_org is null then raise exception 'thread not found'; end if;

  if private.is_org_staff(v_org) then
    update public.care_message_threads set care_team_last_read_at = now() where id = p_thread_id;
  elsif v_uid = v_patient or private.can_read_clinical(v_patient, 'messaging') then
    update public.care_message_threads set patient_last_read_at = now() where id = p_thread_id;
  else
    raise exception 'not authorised' using errcode = '42501';
  end if;
end;
$function$;

create or replace function public.search_patient_record(p_patient uuid, p_query text)
 returns table(table_name text, record_id uuid, title text, snippet text, occurred_at timestamp with time zone, rank real)
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_org uuid;
  v_ts  tsquery;
begin
  select p.organisation_id into v_org from public.profiles p where p.id = p_patient;
  if v_org is null then
    raise exception 'unknown patient';
  end if;

  if not (
    p_patient = (select auth.uid())
    or private.is_org_staff(v_org)
    or private.can_read_clinical(p_patient, 'medical_history')
  ) then
    raise exception 'insufficient_privilege: not authorised to search this patient''s record';
  end if;

  if p_query is null or length(btrim(p_query)) = 0 then
    return;
  end if;

  v_ts := websearch_to_tsquery('english', p_query);

  return query
  select
    'patient_conditions'::text as table_name, c.id as record_id, c.condition_name as title,
    coalesce(nullif(c.current_treatment, ''), c.supporting_evidence) as snippet,
    coalesce(c.last_reviewed_at, c.date_identified::timestamptz, c.created_at) as occurred_at,
    ts_rank(c.search_vector, v_ts) as rank
    from public.patient_conditions c
    where c.patient_id = p_patient and c.search_vector @@ v_ts
  union all
  select
    'patient_allergies'::text as table_name, a.id as record_id, a.allergen as title, a.reaction as snippet,
    a.noted_at as occurred_at, ts_rank(a.search_vector, v_ts) as rank
    from public.patient_allergies a
    where a.patient_id = p_patient and a.search_vector @@ v_ts
  union all
  select
    'medications'::text as table_name, m.id as record_id, m.drug_name as title, m.dose as snippet,
    m.created_at as occurred_at, ts_rank(m.search_vector, v_ts) as rank
    from public.medications m
    where m.patient_id = p_patient and m.search_vector @@ v_ts
  union all
  select
    'screening_results'::text as table_name, s.id as record_id, 'Screening result'::text as title,
    s.result_summary as snippet, s.created_at as occurred_at, ts_rank(s.search_vector, v_ts) as rank
    from public.screening_results s
    where s.patient_id = p_patient and s.search_vector @@ v_ts
  union all
  select
    'patient_documents'::text as table_name, d.id as record_id, replace(d.document_type::text, '_', ' ') as title,
    coalesce(d.original_filename, d.note) as snippet, d.created_at as occurred_at,
    ts_rank(d.search_vector, v_ts) as rank
    from public.patient_documents d
    where d.patient_id = p_patient and d.search_vector @@ v_ts
  union all
  select
    'imaging_reports'::text as table_name, r.id as record_id, replace(r.modality::text, '_', ' ') as title,
    coalesce(r.findings_summary, r.study_description) as snippet, r.created_at as occurred_at,
    ts_rank(r.search_vector, v_ts) as rank
    from public.imaging_reports r
    where r.patient_id = p_patient and r.search_vector @@ v_ts
  order by rank desc
  limit 50;
end;
$function$;

create or replace function public.start_care_thread(p_subject text, p_body text, p_patient_id uuid default null, p_escalation_id uuid default null, p_care_plan_id uuid default null, p_category care_message_category default 'general'::care_message_category)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
  v_thread_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if length(coalesce(trim(p_subject), '')) = 0 then raise exception 'subject required'; end if;
  if length(coalesce(trim(p_body), '')) = 0 then raise exception 'message required'; end if;

  if p_patient_id is not null then
    select organisation_id into v_org from public.profiles where id = p_patient_id;
    v_patient := p_patient_id;
    if v_org is null
       or not (private.is_org_staff(v_org) or private.can_read_clinical(p_patient_id, 'messaging')) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
  else
    select organisation_id into v_org from public.profiles where id = v_uid;
    v_patient := v_uid;
  end if;
  if v_org is null then raise exception 'no organisation'; end if;

  insert into public.care_message_threads
    (organisation_id, patient_id, subject, created_by, escalation_id, care_plan_id, category)
  values (v_org, v_patient, trim(p_subject), v_uid, p_escalation_id, p_care_plan_id, p_category)
  returning id into v_thread_id;

  insert into public.care_messages (thread_id, body) values (v_thread_id, trim(p_body));
  return v_thread_id;
end;
$function$;

create or replace function public.care_receipt(p_beneficiary uuid, p_from timestamp with time zone default null, p_to timestamp with time zone default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_caller   uuid := (select auth.uid());
  v_is_self  boolean;
  v_grant    public.profile_access;
  v_clinical boolean;
  v_from     timestamptz;
  v_to       timestamptz;
  v_name     text;
  v_events   jsonb;
  v_readings jsonb;
  v_counts   jsonb;
  v_money    jsonb;
  v_status   jsonb;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  v_is_self := v_caller = p_beneficiary;

  if not v_is_self then
    select * into v_grant
      from public.profile_access
     where profile_id = p_beneficiary and grantee_user_id = v_caller;

    if not found then
      raise exception 'you do not have access to this person''s care'
        using errcode = '42501';
    end if;
  end if;

  v_clinical := v_is_self or private.can_read_clinical(p_beneficiary, 'medical_history');

  v_to   := coalesce(p_to, now());
  v_from := coalesce(p_from, v_to - interval '30 days');

  if v_from >= v_to then
    raise exception 'the receipt period must start before it ends' using errcode = '22023';
  end if;

  select coalesce(nullif(trim(full_name), ''), 'This person')
    into v_name from public.profiles where id = p_beneficiary;

  select coalesce(jsonb_agg(e order by e->>'occurred_at' desc), '[]'::jsonb) into v_events
  from (
    select jsonb_strip_nulls(jsonb_build_object(
      'occurred_at', pt.occurred_at,
      'category',    lbl.category,
      'what',        case when v_clinical then pt.title else lbl.activity_label end,
      'detail',      case when v_clinical then pt.summary else null end,
      'reviewed_by', cs.full_name,
      'reviewed_by_credential', case when cs.full_name is not null then cs.credential_type else null end
    )) as e
    from public.patient_timeline pt
    join public.care_receipt_event_labels lbl on lbl.event_type = pt.event_type
    left join public.clinical_staff cs on cs.id = pt.actor_clinical_staff_id
    where pt.patient_id = p_beneficiary
      and pt.occurred_at >= v_from
      and pt.occurred_at < v_to
      and (v_clinical or lbl.activity_label is not null)
  ) rows;

  select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'count', g.n)
                            order by g.day desc), '[]'::jsonb) into v_readings
  from (
    select (date_trunc('day', vr.taken_at at time zone 'Africa/Lagos'))::date as day,
           count(*) as n
      from public.vitals_readings vr
     where vr.patient_id = p_beneficiary
       and vr.taken_at >= v_from
       and vr.taken_at < v_to
     group by 1
  ) g;

  select jsonb_build_object(
    'readings_recorded', (
      select count(*) from public.vitals_readings vr
       where vr.patient_id = p_beneficiary and vr.taken_at >= v_from and vr.taken_at < v_to),
    'doctor_reviews', (
      select count(*) from public.patient_timeline pt
       where pt.patient_id = p_beneficiary and pt.occurred_at >= v_from and pt.occurred_at < v_to
         and pt.actor_clinical_staff_id is not null),
    'tests_completed', (
      select count(*) from public.patient_timeline pt
       join public.care_receipt_event_labels l on l.event_type = pt.event_type
       where pt.patient_id = p_beneficiary and pt.occurred_at >= v_from and pt.occurred_at < v_to
         and l.category = 'tests' and pt.event_type <> 'screening_due'),
    'medication_events', (
      select count(*) from public.patient_timeline pt
       join public.care_receipt_event_labels l on l.event_type = pt.event_type
       where pt.patient_id = p_beneficiary and pt.occurred_at >= v_from and pt.occurred_at < v_to
         and l.category = 'medication' and (v_clinical or l.activity_label is not null))
  ) into v_counts;

  select jsonb_build_object(
    'funded_kobo', coalesce(sum(cv.amount_paid_kobo), 0),
    'vouchers_bought', count(*),
    'vouchers_used', count(*) filter (where cv.redeemed_at is not null),
    'vouchers_waiting', count(*) filter (where cv.status = 'active' and cv.redeemed_at is null),
    'items', coalesce(jsonb_agg(jsonb_build_object(
        'voucher_number', cv.voucher_number,
        'what', cv.sku_name,
        'amount_kobo', cv.amount_paid_kobo,
        'bought_at', cv.created_at,
        'used_at', cv.redeemed_at
      ) order by cv.created_at desc) filter (where cv.id is not null), '[]'::jsonb)
  ) into v_money
  from public.care_vouchers cv
  where cv.beneficiary_profile_id = p_beneficiary
    and cv.created_at >= v_from and cv.created_at < v_to
    and (v_is_self or cv.purchaser_profile_id = v_caller);

  if v_clinical then
    select jsonb_build_object(
      'open_cases', count(*) filter (where ca.status = 'open'),
      'next_review_due', min(ca.sla_due_at) filter (where ca.status = 'open'),
      'last_reviewed_at', max(ca.acknowledged_at)
    ) into v_status
    from public.clinician_alerts ca
    where ca.patient_id = p_beneficiary;
  end if;

  perform private.log_care_access(
    p_beneficiary, 'receipt_generated', 'care_receipt',
    jsonb_build_object('from', v_from, 'to', v_to, 'tier', case when v_clinical then 'clinical' else 'activity' end)
  );

  return jsonb_build_object(
    'beneficiary_name', v_name,
    'beneficiary_id',   p_beneficiary,
    'period_from',      v_from,
    'period_to',        v_to,
    'tier',             case when v_clinical then 'clinical' else 'activity' end,
    'is_self',          v_is_self,
    'generated_at',     now(),
    'summary',          v_counts,
    'events',           v_events,
    'reading_days',     v_readings,
    'money',            v_money,
    'care_status',      v_status
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- B5. Retire the old switch: drop its owner-guard trigger+function first (leaving them
-- would reference a dropped column and error on every future profile_access write, the
-- same lesson as the guard_profiles_self_update fix earlier today), then the columns,
-- then the now-unreferenced 1-arg can_read_clinical -- Postgres will refuse this last DROP
-- if anything above was missed, which is the real safety net for this whole migration.
-- ---------------------------------------------------------------------------
drop trigger if exists profile_access_clinical_consent on public.profile_access;
drop function if exists private.enforce_clinical_access_consent_owner();

alter table public.profile_access
  drop column clinical_access,
  drop column clinical_access_updated_at;

drop function private.can_read_clinical(uuid);

-- ---------------------------------------------------------------------------
-- Self-assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
  v_count int;
begin
  select string_agg(schemaname||'.'||tablename||'.'||policyname, ', ')
  into v_bad
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'care_message_attachments_select','care_message_threads_select','care_message_threads_insert',
      'care_messages_select','care_messages_insert','care_plan_goals_select','care_plan_interventions_select',
      'care_plans_select','clinical_summaries_select','clinician_alerts_select','escalations_select',
      'lab_analyte_readings_select','lab_orders_select','medication_logs_select','medications_select',
      'patient_blood_profile_select','patient_cardiovascular_profile_select','patient_quarterly_reports_select',
      'patient_risk_scores_select','patient_serology_status_select','patient_timeline_select',
      'reproductive_health_profiles_select','screening_results_select','screening_schedules_select',
      'symptom_triage_assessments_select','vaccination_records_select','vaccination_schedules_select',
      'vitals_readings_select'
    )
    and (
      (coalesce(qual,'') || coalesce(with_check,'')) not like '%can_read_clinical(%'
      or (coalesce(qual,'') || coalesce(with_check,'')) not like '%has_emergency_access(%'
    );
  if v_bad is not null then
    raise exception 'these policies are missing can_read_clinical or has_emergency_access: %', v_bad;
  end if;

  if not exists (select 1 from pg_proc where proname = 'can_read_clinical' and pronamespace = 'private'::regnamespace
                 and pg_get_function_identity_arguments(oid) like '%care_access_category%') then
    raise exception 'can_read_clinical(uuid, care_access_category) does not exist';
  end if;
  if exists (select 1 from pg_proc where proname = 'can_read_clinical' and pronamespace = 'private'::regnamespace
             and pg_get_function_identity_arguments(oid) = 'p_patient uuid') then
    raise exception 'the old 1-arg can_read_clinical(uuid) still exists';
  end if;

  select count(*) into v_count from information_schema.columns
    where table_schema='public' and table_name='profile_access' and column_name in ('clinical_access','clinical_access_updated_at');
  if v_count <> 0 then
    raise exception 'profile_access still has clinical_access columns';
  end if;
end $$;
