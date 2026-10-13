-- SR2 (scale-readiness plan, Phase 1 item 3). Performance advisor, read 2026-10-13: 1,060 unindexed foreign keys (info), 6 policies that
-- re-evaluate auth.uid() per row (warn), 582 unused indexes (info), 124 multiple permissive policies (warn), 1 duplicate index (warn).
-- Done here, deliberately narrow:
--   1. The 6 auth_rls_initplan policies: auth.uid() becomes (select auth.uid()). ALTER POLICY keeps the policy in force the whole time (no
--      drop and create), keeps its roles, and changes nothing else in the expression. Both sides of each rule are proven in
--      packages/db/tests/sr2_advisor_initplan_and_hot_fk_indexes.sql.
--   2. The one duplicate index (async_consults_patient_month_idx is identical to async_consults_patient_idx) is dropped.
--   3. Indexes on the foreign keys of the tables the queue, paging, alerting, triage, labs, prescribing and event paths use, where the column is
--      a join, lookup or cascade key (deleting a clinician_alert scans every child that points at it). 26 indexes. The other ~1,030 unindexed
--      foreign keys are NOT indexed: most are who-approved-it columns on small tables, an index on each costs write time and space at 100,000
--      Members, and with 12 real accounts the planner has no real data to prove which matter. Revisit with load-test plans (SR4).
-- Deliberately not done: the 582 "unused" indexes (the platform has no real traffic, so "unused" means nothing yet; dropping them now would
-- remove indexes the first real load needs) and the 124 multiple-permissive-policy findings (merging RLS policies on patient-scoped tables
-- is a security change that needs its own proof per table; tracked for after the load test shows which tables are hot).

alter policy clinical_staff_attestations_insert on public.clinical_staff_attestations
  with check ((organisation_id = private.current_org_id()) and exists (
    select 1 from public.clinical_staff cs
     where cs.id = clinical_staff_attestations.clinical_staff_id and cs.profile_id = (select auth.uid())));

alter policy emergency_cards_select on public.emergency_cards
  using ((patient_id = (select auth.uid())) or private.is_org_staff(organisation_id));

alter policy emergency_cards_lookups_select on public.emergency_card_lookups
  using (exists (
    select 1 from public.emergency_cards c
     where c.id = emergency_card_lookups.card_id and (c.patient_id = (select auth.uid()) or private.is_org_staff(c.organisation_id))));

alter policy user_known_devices_select on public.user_known_devices
  using (profile_id = (select auth.uid()));

alter policy patient_result_explanations_select on public.patient_result_explanations
  using ((patient_id = (select auth.uid())) or private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category));

alter policy scribe_consents_insert_clinical on public.scribe_consents
  with check (private.staff_may_write(patient_id, organisation_id, 'medical_history'::public.care_access_category) and exists (
    select 1 from public.clinical_staff cs
     where cs.id = scribe_consents.clinician_staff_id and cs.profile_id = (select auth.uid()) and cs.active = true));

drop index if exists public.async_consults_patient_month_idx;

do $$
declare
  r record;
  v_made integer := 0;
begin
  for r in
    select * from (values
      ('clinical_tasks', 'organisation_id'), ('clinical_tasks', 'lead_clinician_id'), ('clinical_tasks', 'triage_event_id'),
      ('clinical_task_transitions', 'organisation_id'), ('clinical_task_transitions', 'actor_id'),
      ('clinician_alerts', 'backup_clinician_id'), ('clinician_alerts', 'monitoring_schedule_item_id'),
      ('emergency_events', 'clinician_alert_id'), ('emergency_events', 'vital_reading_id'),
      ('symptom_triage_assessments', 'clinician_alert_id'), ('symptom_triage_assessments', 'clinician_review_alert_id'),
      ('symptom_triage_assessments', 'emergency_event_id'),
      ('ops_incidents', 'clinician_alert_id'),
      ('care_message_threads', 'unread_alert_id'), ('care_messages', 'flagged_alert_id'),
      ('consultation_follow_ups', 'linked_outreach_task_id'), ('consultation_follow_ups', 'linked_referral_id'),
      ('vitals_readings', 'triage_event_id'),
      ('lab_results', 'organisation_id'), ('lab_results', 'document_id'), ('lab_results', 'partner_id'), ('lab_results', 'reviewed_by'),
      ('prescriptions', 'organisation_id'), ('prescriptions', 'encounter_note_id'), ('prescriptions', 'signed_by'),
      ('domain_events', 'organisation_id')
    ) as t(tbl, col)
  loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = r.tbl and column_name = r.col) then
      execute format('create index if not exists %I on public.%I (%I)', left('idx_' || r.tbl || '_' || r.col, 63), r.tbl, r.col);
      v_made := v_made + 1;
    else
      raise exception 'SR2: public.%.% does not exist, the index list is out of date', r.tbl, r.col;
    end if;
  end loop;
  if v_made <> 26 then raise exception 'SR2: expected 26 index targets, got %', v_made; end if;

  if exists (select 1 from pg_policies
              where policyname in ('clinical_staff_attestations_insert', 'emergency_cards_select', 'emergency_cards_lookups_select',
                                   'user_known_devices_select', 'patient_result_explanations_select', 'scribe_consents_insert_clinical')
                and regexp_replace(coalesce(qual, '') || coalesce(with_check, ''), '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)', '', 'gi') ~ 'auth\.uid\(\)') then
    raise exception 'SR2: a rewritten policy still calls auth.uid() per row';
  end if;
end $$;
