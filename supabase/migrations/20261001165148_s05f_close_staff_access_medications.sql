-- S05f piece C, part 2b: close the direct staff path on medications (INV-10, INV-12). Apply only after the code that uses the C1 read
-- functions and the 2a write functions has deployed (C1 is already live and deployed).
--
-- Counted first (live): 0 rows. After the deploy the application has no staff user-session `.from("medications")` read or write left:
-- reads go through read_patient_medications_audited / read_medication_embeds_audited (C1), prescribing, refill confirmation and
-- amendment through prescribe_medication / confirm_medication_refill / amend_medication (2a). The patient's own screens, the mobile app,
-- caregiver and supporter reads, the AI coach and the exports read or write the patient's own rows and keep their policies; service-role
-- code bypasses RLS.
--
-- SELECT keeps the patient, the 'medications' category grant and a 'view_medication' supporter (family paths, not staff); it loses
-- is_org_staff, has_emergency_access and can_support_view, which the audited read applies per category with an audit row. INSERT keeps the
-- patient and acting-supporter self-add (source patient or specialist). UPDATE narrows to the patient's own row (the allow-list trigger
-- from 2a limits what she may change on a clinician-prescribed row). DELETE has no policy. RLS stays on.

drop policy if exists medications_select on public.medications;
create policy medications_select on public.medications
  for select to authenticated
  using (patient_id = (select auth.uid())
         or private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
         or private.can_read_clinical(patient_id, 'view_medication'::public.caregiver_permission));

drop policy if exists medications_insert on public.medications;
create policy medications_insert on public.medications
  for insert to authenticated
  with check ((patient_id = (select auth.uid()) or private.can_act_for(patient_id))
              and source = any (array['patient'::public.medication_source, 'specialist'::public.medication_source]));

drop policy if exists medications_update on public.medications;
create policy medications_update on public.medications
  for update to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()));

drop policy if exists medications_delete on public.medications;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'medications'
               and (qual ilike '%is_org_staff%' or with_check ilike '%is_org_staff%'
                    or qual ilike '%has_emergency_access%' or with_check ilike '%has_emergency_access%'
                    or qual ilike '%can_support_view%' or with_check ilike '%can_support_view%'
                    or qual ilike '%has_prescribing_authority%' or with_check ilike '%has_prescribing_authority%')) then
    raise exception 'S05f assertion: a staff, break-glass or support-view clause remains on medications';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'medications' and cmd in ('DELETE', 'ALL')) then
    raise exception 'S05f assertion: a DELETE or ALL policy remains on medications';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'medications') <> 3 then
    raise exception 'S05f assertion: expected exactly the select, insert and update policies on medications';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.medications'::regclass) then
    raise exception 'S05f assertion: RLS is off on medications';
  end if;
  -- Not has_table_privilege('anon'): a fresh local replay carries the image's default table ACL (see CLAUDE.md). What matters is that no
  -- policy admits anon.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'medications' and (roles::text ~ 'anon' or roles::text ~ 'public')) then
    raise exception 'S05f assertion: a policy on medications admits anon';
  end if;
end $$;
