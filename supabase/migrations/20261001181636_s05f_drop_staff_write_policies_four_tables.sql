-- S05f follow-up: drop the staff WRITE policies on patient_documents, family_history, patient_allergies and patient_conditions (INV-10).
-- The reads on these four tables were closed in S05 / S05c; their staff INSERT / UPDATE / DELETE policies were left in place because no
-- staff screen wrote them. This removes them so the tables are closed to org staff in both directions.
--
-- Counted first (live, 2026-10-01): patient_documents 0 rows, family_history 0, patient_allergies 0, patient_conditions 0.
-- Writers found (code scan of apps/web, apps/mobile, supabase/functions plus a live pg_proc scan):
--   * patient_allergies: the patient's own add-allergy hook (health summary page, source 'patient') and the mobile health summary insert,
--     both the patient's own row: unaffected, they keep the patient branch below.
--   * patient_conditions, family_history, patient_documents: no application writer at all.
--   * The only database function that writes any of them is private.enforce_fhir_import_resource_attribution, SECURITY DEFINER (the
--     clinician-confirmed FHIR import), which bypasses RLS and is untouched.
--   * Service-role code bypasses RLS.
-- A future staff edit of a patient's entry goes through an audited, tie-gated write function (S05 documented this), not a policy.
--
-- After this: patient_allergies and family_history keep the patient's own insert / update / delete; patient_documents keeps the patient's
-- own insert (source 'patient'); patient_conditions has no write policy (only the definer FHIR path and the service role write it). The
-- patient SELECT and same-transaction own-entry SELECT policies are unchanged.

drop policy if exists family_history_insert on public.family_history;
create policy family_history_insert on public.family_history
  for insert to authenticated with check (patient_id = (select auth.uid()));
drop policy if exists family_history_update on public.family_history;
create policy family_history_update on public.family_history
  for update to authenticated using (patient_id = (select auth.uid())) with check (patient_id = (select auth.uid()));
drop policy if exists family_history_delete on public.family_history;
create policy family_history_delete on public.family_history
  for delete to authenticated using (patient_id = (select auth.uid()));

drop policy if exists patient_allergies_insert on public.patient_allergies;
create policy patient_allergies_insert on public.patient_allergies
  for insert to authenticated with check (patient_id = (select auth.uid()));
drop policy if exists patient_allergies_update on public.patient_allergies;
create policy patient_allergies_update on public.patient_allergies
  for update to authenticated using (patient_id = (select auth.uid())) with check (patient_id = (select auth.uid()));
drop policy if exists patient_allergies_delete on public.patient_allergies;
create policy patient_allergies_delete on public.patient_allergies
  for delete to authenticated using (patient_id = (select auth.uid()));

drop policy if exists patient_conditions_insert on public.patient_conditions;
drop policy if exists patient_conditions_update on public.patient_conditions;
drop policy if exists patient_conditions_delete on public.patient_conditions;

drop policy if exists patient_documents_insert on public.patient_documents;
create policy patient_documents_insert on public.patient_documents
  for insert to authenticated
  with check (patient_id = (select auth.uid()) and source = 'patient'::public.patient_document_source);
drop policy if exists patient_documents_update on public.patient_documents;

do $$
declare
  v_t text;
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
               and tablename in ('patient_documents', 'family_history', 'patient_allergies', 'patient_conditions')
               and (qual ilike '%is_org_staff%' or with_check ilike '%is_org_staff%'
                    or qual ilike '%has_emergency_access%' or with_check ilike '%has_emergency_access%'
                    or qual ilike '%can_support_view%' or with_check ilike '%can_support_view%')) then
    raise exception 'S05f assertion: a staff clause remains on one of the four tables';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'patient_conditions') <> 2
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'patient_documents') <> 3
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'family_history') <> 5
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'patient_allergies') <> 5 then
    raise exception 'S05f assertion: unexpected policy count on one of the four tables';
  end if;
  foreach v_t in array array['patient_documents', 'family_history', 'patient_allergies', 'patient_conditions'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_t)::regclass) then
      raise exception 'S05f assertion: RLS is off on %', v_t;
    end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public'
               and tablename in ('patient_documents', 'family_history', 'patient_allergies', 'patient_conditions')
               and (roles::text ~ 'anon' or roles::text ~ 'public')) then
    raise exception 'S05f assertion: a policy on one of the four tables admits anon';
  end if;
  if not (select prosecdef from pg_proc where oid = 'private.enforce_fhir_import_resource_attribution()'::regprocedure) then
    raise exception 'S05f assertion: the FHIR import trigger function is no longer SECURITY DEFINER';
  end if;
end $$;
