-- S05f follow-up: drop the four same-transaction "own entry" SELECT policies on patient_documents, family_history, patient_allergies and
-- patient_conditions (INV-10).
--
-- Why they existed: `INSERT ... RETURNING` also needs a SELECT policy for the inserter. Staff had no read access to these tables, so each
-- table carried `recorded_by (or uploaded_by) = auth.uid() AND created_at = now()`, which let a staff insert return its new row without
-- granting a standing read. Why they are unused now: the staff INSERT policies are gone (20261001175655), so no staff session inserts at
-- all, and the only remaining inserter, the patient, already reads her own rows through the main `patient_id = auth.uid()` policy.
--
-- Deliberately NOT touched: the `*_select_own_entry` policies on medication_logs, symptoms, vitals_readings, insulin_logs,
-- foot_self_checks, sick_day_logs and risk_assessment_responses. Those are `logged_by_profile_id = auth.uid()`, a supporter's standing
-- read of rows she logged for someone else (the acting-supporter path), and are in use.

drop policy if exists family_history_select_own_entry on public.family_history;
drop policy if exists patient_allergies_select_own_entry on public.patient_allergies;
drop policy if exists patient_conditions_select_own_entry on public.patient_conditions;
drop policy if exists patient_documents_select_own_entry on public.patient_documents;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
               and tablename in ('patient_documents', 'family_history', 'patient_allergies', 'patient_conditions')
               and policyname like '%own_entry%') then
    raise exception 'S05f assertion: an own-entry policy remains on one of the four tables';
  end if;
  -- the patient's own SELECT must remain on each, and nothing else should have gone
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'patient_conditions') <> 1
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'patient_documents') <> 2
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'family_history') <> 4
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'patient_allergies') <> 4 then
    raise exception 'S05f assertion: unexpected policy count on one of the four tables';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and cmd = 'SELECT'
        and tablename in ('patient_documents', 'family_history', 'patient_allergies', 'patient_conditions')
        and qual like '%patient_id = ( SELECT auth.uid()%') <> 4 then
    raise exception 'S05f assertion: each of the four tables must keep its patient SELECT policy';
  end if;
  -- the supporter-type own-entry policies stay
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'medication_logs' and policyname = 'medication_logs_select_own_entry')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vitals_readings' and policyname = 'vitals_readings_select_own_entry')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'symptoms' and policyname = 'symptoms_select_own_entry') then
    raise exception 'S05f assertion: a supporter own-entry policy was removed by mistake';
  end if;
end $$;
