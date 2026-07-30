create or replace function private.actor_role() returns user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function private.actor_patient_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from patients where profile_id = auth.uid();
$$;

-- only an ACTIVE clinician (mdcn/indemnity current) counts for RLS purposes --
-- belt-and-suspenders alongside the nightly suspension job flipping clinicians.active.
create or replace function private.actor_clinician_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from clinicians where profile_id = auth.uid() and active = true;
$$;

create or replace function private.is_own_or_dependant(p_patient_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from patients p
    where p.id = p_patient_id
      and (p.profile_id = auth.uid() or p.guardian_patient_id = private.actor_patient_id())
  );
$$;

create or replace function private.has_open_exception(p_patient_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from triage_classifications tc
    where tc.patient_id = p_patient_id
      and tc.classification in ('needs_review','urgent','emergency')
      and tc.cleared_at is null
  );
$$;

-- Single entry point used by every patient-scoped table's RLS policy.
-- institution_admin and ops_admin always fall through to false here (I9) --
-- they get separate, table-specific, non-patient-keyed policies below/elsewhere.
create or replace function private.can_see_patient(p_patient_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case private.actor_role()
    when 'patient' then private.is_own_or_dependant(p_patient_id)
    when 'clinician' then
      private.actor_clinician_id() is not null and (
        private.has_open_exception(p_patient_id)
        or exists (select 1 from clinical_notes cn where cn.patient_id = p_patient_id and cn.clinician_id = private.actor_clinician_id())
        or exists (select 1 from clinical_contacts cc where cc.patient_id = p_patient_id and cc.clinician_id = private.actor_clinician_id())
      )
    when 'coordinator' then
      private.has_open_exception(p_patient_id)
      or exists (select 1 from clinical_contacts cc where cc.patient_id = p_patient_id and cc.coordinator_id = auth.uid())
      or exists (select 1 from enrolments e where e.patient_id = p_patient_id and e.assigned_coordinator_id = auth.uid())
    when 'superadmin' then true
    else false
  end;
$$;

create or replace function private.is_superadmin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select private.actor_role() = 'superadmin';
$$;

create or replace function private.is_ops_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select private.actor_role() = 'ops_admin';
$$;

