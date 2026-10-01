-- S05 part 3 of 3: close the direct staff read path (INV-10, OQ-03) on the two health-record tables with no staff caller left.
-- Design: docs/design/S05.md section 5.
--
-- Counted first (live and in code, 2026-10-01): patient_documents 0 rows, family_history 0 rows. Code: 0 `.from()` reads of either table
-- anywhere in apps/web, apps/console, apps/mobile, packages or the edge functions. The only database objects that touch them are
-- four SECURITY DEFINER functions (handle_patient_document_insert, timeline_from_patient_document, search_patient_record,
-- handle_prostate_symptom_assessment_review), which bypass RLS and are unaffected; no view reads either table. So narrowing the
-- SELECT policy to the patient cannot break a staff screen. Staff read both through public.read_patient_chart_audited and
-- public.open_patient_document_audited (part 2).
--
-- Not done here, on purpose: vitals_readings, medications, medication_logs, symptoms, patient_conditions, patient_allergies,
-- clinical_encounter_notes and specialist_referrals are each read directly by staff screens (about 100 call sites, listed in the design
-- note), several through shared react-query hooks and security_invoker views. Narrowing them without moving those callers would blank
-- the clinician chart, which is the failure PR #789 already taught this project. They are the follow-up list in the design note.
--
-- Staff writes: staff can still INSERT a document or a family-history row and read back the row they wrote (own-entry policy, because
-- INSERT ... RETURNING needs a SELECT policy). UPDATE and DELETE by staff need a visible row, so a staff edit of someone else's row
-- now goes through a future audited write path; there are no callers today.

drop policy if exists patient_documents_select on public.patient_documents;
create policy patient_documents_select on public.patient_documents
  for select to authenticated
  using (patient_id = (select auth.uid()));

drop policy if exists patient_documents_select_own_entry on public.patient_documents;
create policy patient_documents_select_own_entry on public.patient_documents
  for select to authenticated
  using (uploaded_by = (select auth.uid()));

drop policy if exists family_history_select on public.family_history;
create policy family_history_select on public.family_history
  for select to authenticated
  using (patient_id = (select auth.uid()));

drop policy if exists family_history_select_own_entry on public.family_history;
create policy family_history_select_own_entry on public.family_history
  for select to authenticated
  using (recorded_by = (select auth.uid()));

do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad from pg_policies
   where schemaname = 'public' and tablename in ('patient_documents', 'family_history') and cmd = 'SELECT'
     and qual ilike '%is_org_staff%';
  if v_bad <> 0 then
    raise exception 'S05 assertion: % SELECT policies on patient_documents / family_history still admit org staff', v_bad;
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'patient_documents' and cmd = 'SELECT') <> 2
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'family_history' and cmd = 'SELECT') <> 2 then
    raise exception 'S05 assertion: expected exactly 2 SELECT policies on each of the two tables';
  end if;
end $$;
