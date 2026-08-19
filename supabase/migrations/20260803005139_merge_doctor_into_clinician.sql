-- Tarragon Health
-- Merge the 'doctor' account role into 'clinician' — unified doctor access
--
-- Founder decision 2026-07-31: remove the doctor_tier-driven account-role
-- split (Tier 1-3 -> 'clinician', Tier 4-5 -> 'doctor') that gated which
-- pages a doctor could reach. Every doctor, regardless of tier, now uses the
-- single 'clinician' account role and gets the same page access. doctor_tier
-- itself is UNCHANGED — it still drives clinical authority (prescribing,
-- refill-confirmation, etc. via private.has_prescribing_authority and
-- friends) and is_clinical_director is still the separate, orthogonal
-- governance flag it always was. Neither is touched by this migration.
--
-- Real-data check before writing this migration: only 2 profiles ever held
-- role='doctor' (doctor.tier4.test@tarragon.test, doctor.tier5.test@tarragon.test
-- — both QA fixtures with no active clinical_staff row, confirmed live) and
-- custom_roles has zero rows. This is a low-risk merge, not a data-migration
-- exercise — the point of doing it now, before any real doctor account
-- exists, rather than later.
--
-- Follows the proven 20260705211611_merge_nurse_into_clinician.sql playbook
-- (Postgres has no native DROP VALUE for enums, so rename-swap-recreate) but
-- against TODAY's full 12-value user_role, not that migration's own
-- hardcoded 5-value snapshot from before doctor/care_coordinator/pharmacist/
-- analyst/lab_liaison/finance/lab_partner existed — copying that file's
-- `create type` list verbatim would have silently dropped 6 unrelated roles.
--
-- Dependency audit done before writing this (queried live, not assumed):
--   - Columns of type user_role: profiles.role, custom_roles.base_role (both migrated below)
--   - Functions with user_role in their OWN signature (param/return, need rebinding): private.current_role() only
--   - private.handle_new_user() has no user_role in its signature (returns trigger) but is
--     redefined anyway, matching the nurse-merge precedent's own defensive practice for a
--     function whose body casts to ::public.user_role
--   - No RLS policy and no CHECK constraint anywhere references 'doctor' as a role literal
--   - Three functions DO contain a real 'doctor'-as-role-value literal in their body and would
--     have thrown "invalid input value for enum" the first time each was called post-merge if
--     left alone: analytics_doctor_performance(), analytics_staff_activity() (twice), and
--     request_masked_call() — all three redefined below with 'doctor' simply dropped from their
--     `role in (...)` lists (every account that used to match on 'doctor' now matches on
--     'clinician' instead, so no behavioural loss).
--   - private.evaluate_adherence_escalation() and private.care_plan_review_from_missed_medication()
--     also contain the substring 'doctor' but it's a value of the UNRELATED
--     med_adherence_alert_level enum ('coach'/'doctor' adherence-escalation rungs on
--     medication_adherence_alerts.level) — confirmed by reading both bodies in full, left
--     untouched deliberately.
--
-- Real gap found across two failed apply attempts, not anticipated by the dependency audit
-- above: ALTER COLUMN ... TYPE on profiles.role failed twice with "cannot alter type of a
-- column used in a policy definition" — Postgres tracks a pg_depend entry for any RLS policy
-- expression referencing a column directly. A pg_depend query (not a text search) found exactly
-- two such policies platform-wide: leads_admin_select on public.leads, and profiles_select on
-- public.profiles itself (every other admin/staff check in this codebase goes through a
-- private.is_*() wrapper function, which doesn't create this dependency class — these two are
-- the only ones written as a direct inline check). No dependent views, no dependent CHECK
-- constraints. Both dropped before the type swap and recreated byte-for-byte identical after —
-- confirmed via pg_depend that this is the complete list for both profiles.role and
-- custom_roles.base_role, and via an assertion at the end that the recreated profiles_select
-- policy's qual text matches the pre-drop capture character for character.

-- ---------------------------------------------------------------------------
-- Drop the two policies that depend on profiles.role's type. Recreated
-- verbatim further down.
-- ---------------------------------------------------------------------------

drop policy if exists leads_admin_select on public.leads;
drop policy if exists profiles_select on public.profiles;

-- ---------------------------------------------------------------------------
-- user_role: drop 'doctor'. Rename the old type out of the way, create the
-- new one without 'doctor', migrate both columns, drop the old type.
-- ---------------------------------------------------------------------------

alter type public.user_role rename to user_role_old;

create type public.user_role as enum (
  'patient',
  'clinician',
  'admin',
  'hmo_admin',
  'corporate_admin',
  'care_coordinator',
  'pharmacist',
  'analyst',
  'lab_liaison',
  'finance',
  'lab_partner'
);

alter table public.profiles alter column role drop default;

alter table public.profiles
  alter column role type public.user_role
  using (
    case when role::text = 'doctor' then 'clinician' else role::text end
  )::public.user_role;

alter table public.profiles alter column role set default 'patient'::public.user_role;

alter table public.custom_roles
  alter column base_role type public.user_role
  using (
    case when base_role::text = 'doctor' then 'clinician' else base_role::text end
  )::public.user_role;

-- ---------------------------------------------------------------------------
-- Recreate both dropped policies, byte-for-byte identical expressions
-- (captured live via pg_policies before dropping).
-- ---------------------------------------------------------------------------

create policy leads_admin_select on public.leads
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid()) and profiles.role = 'admin'::public.user_role
    )
  );

create policy profiles_select on public.profiles
  as permissive for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_admin()
    or (organisation_id is not null and private.is_org_staff(organisation_id))
    or (
      private.is_lab_liaison()
      and role = 'patient'::public.user_role
      and organisation_id is not null
      and organisation_id = private.current_org_id()
    )
    or exists (
      select 1 from public.care_plans cp
      where cp.assigned_clinician_id = profiles.id and cp.patient_id = (select auth.uid())
    )
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = profiles.id and pa.grantee_user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- private.current_role(): its return type is public.user_role by name, which
-- CREATE OR REPLACE cannot rebind to a same-named-but-different type — must
-- drop first.
-- ---------------------------------------------------------------------------

drop function private.current_role();

create function private.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- private.handle_new_user(): no user_role in its own signature, but
-- redefined anyway (same defensive practice as the nurse-merge precedent)
-- since its body casts a value to ::public.user_role. Body reproduced
-- byte-for-byte from the live function, only the type identity changes by
-- virtue of this CREATE OR REPLACE running after the swap above.
-- ---------------------------------------------------------------------------

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_org_id uuid;
  v_roster_id uuid;
  v_roster_org_id uuid;
begin
  v_phone := case
    when new.phone is null or new.phone = '' then null
    when new.phone ~ '^\+' then new.phone
    else '+' || new.phone
  end;

  v_org_id := coalesce(
    (new.raw_app_meta_data ->> 'organisation_id')::uuid,
    '00000000-0000-0000-0000-000000000001'
  );

  -- Only consult the roster when no explicit org came through app_metadata
  -- (i.e. this is an ordinary self-serve signup, not an admin-provisioned
  -- staff/clinician account already targeted at a specific org).
  if (new.raw_app_meta_data ->> 'organisation_id') is null and v_phone is not null then
    select id, organisation_id into v_roster_id, v_roster_org_id
    from public.employer_roster_members
    where phone = v_phone and status = 'pending'
    order by created_at
    limit 1;
    if v_roster_id is not null then
      v_org_id := v_roster_org_id;
    end if;
  end if;

  insert into public.profiles (id, role, organisation_id, full_name, phone)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'patient'),
    coalesce(v_org_id, '00000000-0000-0000-0000-000000000001'),
    new.raw_user_meta_data ->> 'full_name',
    v_phone
  );

  if v_roster_id is not null then
    update public.employer_roster_members
      set status = 'claimed', claimed_profile_id = new.id, claimed_at = now()
      where id = v_roster_id;
  end if;

  return new;
end;
$$;

drop type public.user_role_old;

-- ---------------------------------------------------------------------------
-- analytics_doctor_performance(): 'doctor' dropped from the role filter —
-- every account that used to match it is now 'clinician' and still matches.
-- Body otherwise byte-for-byte identical to the live function.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_doctor_performance(
  p_from timestamp with time zone default null::timestamp with time zone,
  p_to timestamp with time zone default null::timestamp with time zone
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return (
    with doctors as (
      select p.id, coalesce(p.full_name,'(unnamed)') name, p.role::text role,
             cs.id staff_id, cs.doctor_tier::text tier
      from public.profiles p
      left join public.clinical_staff cs on cs.profile_id = p.id and cs.active
      where p.role = 'clinician'
    )
    select jsonb_build_object(
      'by_doctor', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'doctor', d.name, 'role', d.role, 'tier', d.tier,
          'patients_assigned', (select count(*) from public.care_team_assignment where clinician_id = d.id),
          'escalations_reviewed', (select count(*) from public.escalations e where e.reviewed_by = d.id
             and e.reviewed_at is not null and (p_from is null or e.reviewed_at>=p_from) and (p_to is null or e.reviewed_at<=p_to)),
          'alerts_acknowledged', (select count(*) from public.clinician_alerts a where a.acknowledged_by = d.id
             and a.acknowledged_at is not null and (p_from is null or a.acknowledged_at>=p_from) and (p_to is null or a.acknowledged_at<=p_to)),
          'meds_confirmed', (select count(*) from public.medications m where m.last_confirmed_by = d.staff_id),
          'reviews_completed', (select count(*) from public.medication_reviews r where r.reviewed_by = d.staff_id and r.completed_at is not null),
          'avg_ack_minutes', (select coalesce(round(avg(extract(epoch from (acknowledged_at-created_at))/60.0)::numeric,1),0)
             from public.clinician_alerts where acknowledged_by=d.id and acknowledged_at is not null),
          'avg_resolution_hours', (select coalesce(round(avg(extract(epoch from (reviewed_at-created_at))/3600.0)::numeric,1),0)
             from public.escalations where reviewed_by=d.id and reviewed_at is not null),
          'sla_met_pct', (select case when count(*) filter (where sla_due_at is not null)=0 then null
             else round(100.0*count(*) filter (where sla_due_at is not null and acknowledged_at is not null and acknowledged_at<=sla_due_at)
                  / count(*) filter (where sla_due_at is not null),1) end
             from public.clinician_alerts where acknowledged_by=d.id),
          'last_active_at', greatest(
             (select max(reviewed_at) from public.escalations where reviewed_by=d.id),
             (select max(acknowledged_at) from public.clinician_alerts where acknowledged_by=d.id)),
          'patient_panel', (select coalesce(jsonb_agg(pn order by pn), '[]'::jsonb)
             from (select coalesce(p2.patient_number,'PT-?') pn
                   from public.care_team_assignment cta join public.profiles p2 on p2.id=cta.patient_id
                   where cta.clinician_id=d.id order by p2.patient_number limit 200) x)
        ) order by (select count(*) from public.care_team_assignment where clinician_id=d.id) desc), '[]'::jsonb)
        from doctors d
      ),
      'recent_responses', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'doctor', doctor, 'patient', patient, 'type', type,
          'raised_at', raised_at, 'responded_at', responded_at, 'response_min', response_min) order by responded_at desc), '[]'::jsonb)
        from (
          select doc.name doctor, coalesce(p2.patient_number,'PT-?') patient, 'Escalation resolved' type,
                 e.created_at raised_at, e.reviewed_at responded_at,
                 round(extract(epoch from (e.reviewed_at-e.created_at))/60.0)::int response_min
          from public.escalations e
          join doctors doc on doc.id=e.reviewed_by
          join public.profiles p2 on p2.id=e.patient_id
          where e.reviewed_at is not null and (p_from is null or e.reviewed_at>=p_from) and (p_to is null or e.reviewed_at<=p_to)
          union all
          select doc.name, coalesce(p2.patient_number,'PT-?'), 'Alert acknowledged',
                 a.created_at, a.acknowledged_at,
                 round(extract(epoch from (a.acknowledged_at-a.created_at))/60.0)::int
          from public.clinician_alerts a
          join doctors doc on doc.id=a.acknowledged_by
          join public.profiles p2 on p2.id=a.patient_id
          where a.acknowledged_at is not null and (p_from is null or a.acknowledged_at>=p_from) and (p_to is null or a.acknowledged_at<=p_to)
          order by responded_at desc limit 100
        ) t
      )
    )
  );
end; $$;

-- ---------------------------------------------------------------------------
-- analytics_staff_activity(): same treatment, 'doctor' dropped from both
-- occurrences of the role filter.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_staff_activity(
  p_from timestamp with time zone default null::timestamp with time zone,
  p_to timestamp with time zone default null::timestamp with time zone
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return (
    with staff_events as (
      select w.profile_id, w.occurred_at, p.full_name, p.role::text role
      from public.web_events w
      join public.profiles p on p.id = w.profile_id
      where w.profile_id is not null
        and p.role in ('admin','clinician','care_coordinator','analyst')
        and (p_from is null or w.occurred_at >= p_from)
        and (p_to is null or w.occurred_at <= p_to)
    ),
    marked as (
      select *,
        case when lag(occurred_at) over (partition by profile_id order by occurred_at) is null
               or occurred_at - lag(occurred_at) over (partition by profile_id order by occurred_at) > interval '30 minutes'
             then 1 else 0 end new_session
      from staff_events
    ),
    numbered as (
      select *, sum(new_session) over (partition by profile_id order by occurred_at rows unbounded preceding) session_num
      from marked
    ),
    sessions as (
      select profile_id, coalesce(full_name,'(unnamed)') full_name, role, session_num,
        min(occurred_at) started, max(occurred_at) ended, count(*) pageviews,
        round(extract(epoch from (max(occurred_at) - min(occurred_at)))/60.0)::int duration_min
      from numbered group by profile_id, full_name, role, session_num
    )
    select jsonb_build_object(
      'staff_total', (select count(*) from public.profiles where role in ('admin','clinician','care_coordinator','analyst')),
      'active_today', (select count(distinct profile_id) from staff_events where occurred_at >= date_trunc('day', now())),
      'active_7d', (select count(distinct profile_id) from staff_events where occurred_at >= now() - interval '7 days'),
      'sessions_total', (select count(*) from sessions),
      'by_staff', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'staff', full_name, 'role', role, 'sessions', sessions,
          'active_minutes', active_minutes, 'pageviews', pageviews, 'last_seen', last_seen) order by last_seen desc), '[]'::jsonb)
        from (
          select full_name, role, count(*) sessions, sum(duration_min) active_minutes,
                 sum(pageviews) pageviews, max(ended) last_seen
          from sessions group by profile_id, full_name, role
        ) t
      ),
      'recent_sessions', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'staff', full_name, 'role', role, 'started', started, 'ended', ended,
          'duration_min', duration_min, 'pageviews', pageviews) order by started desc), '[]'::jsonb)
        from (select * from sessions order by started desc limit 100) t
      )
    )
  );
end; $$;

-- ---------------------------------------------------------------------------
-- request_masked_call(): 'doctor' dropped from the eligible-staff-role check.
-- ---------------------------------------------------------------------------

create or replace function public.request_masked_call(
  p_patient_id uuid,
  p_staff_profile_id uuid,
  p_context masked_call_context,
  p_escalation_id uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_org uuid;
  v_caller uuid := auth.uid();
  v_session_id uuid;
begin
  if v_caller is null then
    raise exception 'Not signed in';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    raise exception 'Patient not found';
  end if;

  if v_caller <> p_patient_id and not private.is_org_staff(v_org) then
    raise exception 'Not authorised to request this call' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_staff_profile_id
      and organisation_id = v_org
      and role in ('clinician', 'care_coordinator')
  ) then
    raise exception 'Staff member not found in the patient organisation';
  end if;

  if p_context = 'escalation_contact' then
    if p_escalation_id is null then
      raise exception 'escalation_contact requires an escalation';
    end if;
    if not exists (
      select 1 from public.escalations
      where id = p_escalation_id and patient_id = p_patient_id and organisation_id = v_org
    ) then
      raise exception 'Escalation not found for this patient';
    end if;
  end if;

  insert into public.masked_call_sessions (organisation_id, patient_id, staff_profile_id, context, escalation_id, initiated_by)
  values (v_org, p_patient_id, p_staff_profile_id, p_context, p_escalation_id, v_caller)
  returning id into v_session_id;

  insert into public.masked_call_participants (session_id, organisation_id, profile_id, role)
  values
    (v_session_id, v_org, p_patient_id, 'patient'),
    (v_session_id, v_org, p_staff_profile_id, 'staff');

  perform private.log_audit('masked_call.requested', 'masked_call_sessions', v_session_id,
    jsonb_build_object('context', p_context, 'escalation_id', p_escalation_id));

  return v_session_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assertions — the migration is the test. Raise if anything didn't take.
-- ---------------------------------------------------------------------------

do $$
declare
  v_doctor_enum_count int;
  v_doctor_profile_count int;
  v_doctor_custom_role_count int;
  v_enum_value_count int;
  v_current_role public.user_role;
  v_leads_policy_count int;
  v_profiles_select_qual text;
  v_expected_qual text := '((id = ( SELECT auth.uid() AS uid)) OR private.is_admin() OR ((organisation_id IS NOT NULL) AND private.is_org_staff(organisation_id)) OR (private.is_lab_liaison() AND (role = ''patient''::user_role) AND (organisation_id IS NOT NULL) AND (organisation_id = private.current_org_id())) OR (EXISTS ( SELECT 1
   FROM care_plans cp
  WHERE ((cp.assigned_clinician_id = profiles.id) AND (cp.patient_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM profile_access pa
  WHERE ((pa.profile_id = profiles.id) AND (pa.grantee_user_id = ( SELECT auth.uid() AS uid))))))';
begin
  select count(*) into v_doctor_enum_count
  from pg_enum where enumtypid = 'public.user_role'::regtype and enumlabel = 'doctor';
  if v_doctor_enum_count <> 0 then
    raise exception 'user_role still has a doctor value after the merge';
  end if;

  select count(*) into v_enum_value_count
  from pg_enum where enumtypid = 'public.user_role'::regtype;
  if v_enum_value_count <> 11 then
    raise exception 'user_role has % values, expected 11', v_enum_value_count;
  end if;

  select count(*) into v_doctor_profile_count
  from public.profiles where role::text = 'doctor';
  if v_doctor_profile_count <> 0 then
    raise exception '% profiles still report role=doctor', v_doctor_profile_count;
  end if;

  select count(*) into v_doctor_custom_role_count
  from public.custom_roles where base_role::text = 'doctor';
  if v_doctor_custom_role_count <> 0 then
    raise exception '% custom_roles still report base_role=doctor', v_doctor_custom_role_count;
  end if;

  select count(*) into v_leads_policy_count
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  where c.relname = 'leads' and pol.polname = 'leads_admin_select';
  if v_leads_policy_count <> 1 then
    raise exception 'leads_admin_select policy was not correctly recreated (found %)', v_leads_policy_count;
  end if;

  select pg_get_expr(pol.polqual, pol.polrelid) into v_profiles_select_qual
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  where c.relname = 'profiles' and pol.polname = 'profiles_select';

  if v_profiles_select_qual is null then
    raise exception 'profiles_select policy was not recreated';
  end if;
  if v_profiles_select_qual <> v_expected_qual then
    raise exception 'profiles_select policy expression drifted from the pre-drop capture. Got: %', v_profiles_select_qual;
  end if;

  -- Proves private.current_role() rebound to the new type and still
  -- executes cleanly post-rebind (it returns null here since auth.uid() has
  -- no real request context inside a migration — that's expected, the point
  -- is that calling it doesn't raise).
  select private.current_role() into v_current_role;
end $$;
