-- S39b: staff read patient records only through a care relationship (INV-12), for both tiers (OQ-260).
-- Founder decision 2026-10-07: tier 1 and tier 2 together. Changes WHO can SELECT, nothing is deleted or rewritten in the data.
--
-- What it does
--   * private.staff_may_read(patient, organisation, category): true for a staff member tied to the patient (private.can_staff_read_clinical:
--     care team, open escalation or alert, live consultation, active clinical task, post-consult window, assigned referral), or holding an
--     active break-glass grant, or an active support view-as session. A care coordinator never passes on a clinical table (logistics only).
--     private.is_org_staff is NOT edited (it gates about 110 other surfaces).
--   * 123 tables (plus 5 keyed by profile or through a parent) have the staff arm of their SELECT policy switched from "any staff of the
--     organisation" to that check. Writes are not changed. The other 103 tables stay organisation-wide on purpose and are listed with a
--     reason in staff_read_scope (scheduling, logistics, work queues that create the tie, billing, self-tracking, system rules).
--   * the switch is a platform module row (tied_staff_reads). Turn it off and every rewritten policy behaves exactly as before; the old policy
--     text is also kept in staff_read_policy_backup.
--   * scribe_transcripts: any staff could read AND delete a transcript; both now need a tie (deletion on consent revocation stays, for tied staff).
-- Live check before writing: a clinician with no tie read a patient's encounter and HIV/hepatitis status rows.
--   * eight organisation-level quality and safety views (counts only) move to owner rights with the staff predicate, so they keep counting the
--     whole organisation; patient_care_gaps lists patients and follows the tie.
-- Not covered: audit of each tied direct read (only about 10 core tables have audited read functions, OQ-278); writes stay organisation-wide.

create table public.staff_read_scope (
  table_name text primary key,
  mode text not null check (mode in ('tied', 'org')),
  patient_expr text not null default 'patient_id',
  category public.care_access_category not null default 'medical_history',
  reason text,
  check (mode = 'tied' or reason is not null)
);
alter table public.staff_read_scope enable row level security;
revoke all on public.staff_read_scope from public, anon, authenticated;
comment on table public.staff_read_scope is 'S39b: for every patient table with a staff read policy, whether staff reads need a care relationship (tied) or stay organisation-wide (org, with the reason).';

insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('ageing_assessments', 'tied', 'patient_id', 'medical_history', null),
  ('ai_assistant_turns', 'tied', 'patient_id', 'medical_history', null),
  ('annual_health_checks', 'tied', 'patient_id', 'appointments_care_plan', null),
  ('annual_reviews', 'tied', 'patient_id', 'appointments_care_plan', null),
  ('antenatal_visits', 'tied', 'patient_id', 'reproductive_health', null),
  ('appointment_prep_suggestions', 'tied', 'patient_id', 'medical_history', null),
  ('async_consults', 'tied', 'patient_id', 'medical_history', null),
  ('bariatric_referrals', 'tied', 'patient_id', 'medical_history', null),
  ('breast_symptom_reports', 'tied', 'patient_id', 'medical_history', null),
  ('care_plan_decisions', 'tied', 'patient_id', 'appointments_care_plan', null),
  ('care_plan_goals', 'tied', 'patient_id', 'appointments_care_plan', null),
  ('care_plan_interventions', 'tied', 'patient_id', 'appointments_care_plan', null),
  ('care_plan_recommendations', 'tied', 'patient_id', 'appointments_care_plan', null),
  ('care_plan_review_prompts', 'tied', 'patient_id', 'appointments_care_plan', null),
  ('care_plan_status_history', 'tied', 'patient_id', 'appointments_care_plan', null),
  ('care_plans', 'tied', 'patient_id', 'appointments_care_plan', null),
  ('case_briefs', 'tied', 'patient_id', 'medical_history', null),
  ('case_review_actions', 'tied', 'patient_id', 'medical_history', null),
  ('child_growth_measurements', 'tied', 'patient_id', 'medical_history', null),
  ('chronic_programme_end_reviews', 'tied', 'patient_id', 'medical_history', null),
  ('chronic_programme_enrolments', 'tied', 'patient_id', 'medical_history', null),
  ('clinical_encounters', 'tied', 'patient_id', 'medical_history', null),
  ('clinical_summaries', 'tied', 'patient_id', 'medical_history', null),
  ('consultation_patient_summaries', 'tied', 'patient_id', 'medical_history', null),
  ('contraception_plans', 'tied', 'patient_id', 'reproductive_health', null),
  ('dependent_transition_status', 'tied', 'patient_id', 'medical_history', null),
  ('developmental_screenings', 'tied', 'patient_id', 'medical_history', null),
  ('diabetes_complication_checks', 'tied', 'patient_id', 'medical_history', null),
  ('diabetic_foot_assessments', 'tied', 'patient_id', 'medical_history', null),
  ('diagnostic_episodes', 'tied', 'patient_id', 'labs_results', null),
  ('diagnostic_repeat_test_recalls', 'tied', 'patient_id', 'labs_results', null),
  ('ecg_parameter_readings', 'tied', 'patient_id', 'labs_results', null),
  ('ecg_report_documents', 'tied', 'patient_id', 'labs_results', null),
  ('ecg_report_extractions', 'tied', 'patient_id', 'labs_results', null),
  ('emergency_contraception_requests', 'tied', 'patient_id', 'reproductive_health', null),
  ('erectile_dysfunction_assessments', 'tied', 'patient_id', 'reproductive_health', null),
  ('exercise_readiness_screens', 'tied', 'patient_id', 'medical_history', null),
  ('falls_risk_assessments', 'tied', 'patient_id', 'medical_history', null),
  ('fertility_assessment_requests', 'tied', 'patient_id', 'reproductive_health', null),
  ('fertility_assessments', 'tied', 'patient_id', 'reproductive_health', null),
  ('foot_self_checks', 'tied', 'patient_id', 'medical_history', null),
  ('health_literacy_assessments', 'tied', 'patient_id', 'medical_history', null),
  ('imaging_ai_assist_drafts', 'tied', 'patient_id', 'labs_results', null),
  ('imaging_incidental_findings', 'tied', 'patient_id', 'labs_results', null),
  ('imaging_orders', 'tied', 'patient_id', 'labs_results', null),
  ('imaging_report_documents', 'tied', 'patient_id', 'labs_results', null),
  ('imaging_reports', 'tied', 'patient_id', 'labs_results', null),
  ('imaging_safety_questionnaires', 'tied', 'patient_id', 'labs_results', null),
  ('insulin_logs', 'tied', 'patient_id', 'medical_history', null),
  ('lab_analyte_readings', 'tied', 'patient_id', 'labs_results', null),
  ('lab_report_extractions', 'tied', 'patient_id', 'labs_results', null),
  ('lab_result_consult_requests', 'tied', 'patient_id', 'labs_results', null),
  ('lab_result_documents', 'tied', 'patient_id', 'labs_results', null),
  ('lab_result_interpretations', 'tied', 'patient_id', 'labs_results', null),
  ('lpe_enrollments', 'tied', 'patient_id', 'medical_history', null),
  ('lpe_measurements', 'tied', 'patient_id', 'medical_history', null),
  ('lpe_red_flag_events', 'tied', 'patient_id', 'medical_history', null),
  ('lpe_reviews', 'tied', 'patient_id', 'medical_history', null),
  ('lpe_task_instances', 'tied', 'patient_id', 'medical_history', null),
  ('male_fertility_assessments', 'tied', 'patient_id', 'reproductive_health', null),
  ('medication_dose_history', 'tied', 'patient_id', 'medications', null),
  ('medication_lab_monitoring', 'tied', 'patient_id', 'medications', null),
  ('medication_reconciliations', 'tied', 'patient_id', 'medications', null),
  ('medication_reviews', 'tied', 'patient_id', 'medications', null),
  ('menopause_symptom_logs', 'tied', 'patient_id', 'reproductive_health', null),
  ('menstrual_cycles', 'tied', 'patient_id', 'reproductive_health', null),
  ('menstrual_daily_logs', 'tied', 'patient_id', 'reproductive_health', null),
  ('mental_health_screening_schedules', 'tied', 'patient_id', 'medical_history', null),
  ('mental_health_screens', 'tied', 'patient_id', 'medical_history', null),
  ('nutrition_meal_plans', 'tied', 'patient_id', 'medical_history', null),
  ('nutrition_referrals', 'tied', 'patient_id', 'medical_history', null),
  ('obesity_assessments', 'tied', 'patient_id', 'medical_history', null),
  ('obesity_ed_screens', 'tied', 'patient_id', 'medical_history', null),
  ('patient_blood_profile', 'tied', 'patient_id', 'medical_history', null),
  ('patient_bp_targets', 'tied', 'patient_id', 'medical_history', null),
  ('patient_cardiovascular_profile', 'tied', 'patient_id', 'medical_history', null),
  ('patient_diabetes_profile', 'tied', 'patient_id', 'medical_history', null),
  ('patient_exposure_reports', 'tied', 'patient_id', 'medical_history', null),
  ('patient_glucose_targets', 'tied', 'patient_id', 'medical_history', null),
  ('patient_hospital_admissions', 'tied', 'patient_id', 'medical_history', null),
  ('patient_pregnancy', 'tied', 'patient_id', 'reproductive_health', null),
  ('patient_pulse_targets', 'tied', 'patient_id', 'medical_history', null),
  ('patient_quarterly_reports', 'tied', 'patient_id', 'medical_history', null),
  ('patient_result_explanations', 'tied', 'patient_id', 'labs_results', null),
  ('patient_risk_scores', 'tied', 'patient_id', 'medical_history', null),
  ('patient_serology_status', 'tied', 'patient_id', 'medical_history', null),
  ('patient_smoking_profiles', 'tied', 'patient_id', 'medical_history', null),
  ('patient_spo2_targets', 'tied', 'patient_id', 'medical_history', null),
  ('patient_temperature_targets', 'tied', 'patient_id', 'medical_history', null),
  ('patient_timeline', 'tied', 'patient_id', 'medical_history', null),
  ('postnatal_checkins', 'tied', 'patient_id', 'reproductive_health', null),
  ('postnatal_profiles', 'tied', 'patient_id', 'reproductive_health', null),
  ('prevention_campaign_enrolments', 'tied', 'patient_id', 'medical_history', null),
  ('preventive_programme_enrolments', 'tied', 'patient_id', 'medical_history', null),
  ('preventive_reviews', 'tied', 'patient_id', 'medical_history', null),
  ('prostate_symptom_assessments', 'tied', 'patient_id', 'reproductive_health', null),
  ('record_conflicts', 'tied', 'patient_id', 'medical_history', null),
  ('reproductive_health_profiles', 'tied', 'patient_id', 'reproductive_health', null),
  ('risk_predictions', 'tied', 'patient_id', 'medical_history', null),
  ('screening_completions', 'tied', 'patient_id', 'labs_results', null),
  ('screening_results', 'tied', 'patient_id', 'labs_results', null),
  ('screening_schedules', 'tied', 'patient_id', 'labs_results', null),
  ('screening_upgrades', 'tied', 'patient_id', 'labs_results', null),
  ('scribe_consents', 'tied', 'patient_id', 'medical_history', null),
  ('second_opinion_requests', 'tied', 'patient_id', 'medical_history', null),
  ('senior_case_reviews', 'tied', 'patient_id', 'medical_history', null),
  ('serology_status_transitions', 'tied', 'patient_id', 'labs_results', null),
  ('sexual_health_screens', 'tied', 'patient_id', 'reproductive_health', null),
  ('sick_day_logs', 'tied', 'patient_id', 'medical_history', null),
  ('social_determinant_screenings', 'tied', 'patient_id', 'medical_history', null),
  ('social_history', 'tied', 'patient_id', 'medical_history', null),
  ('sti_case_episodes', 'tied', 'patient_id', 'reproductive_health', null),
  ('sti_partner_notifications', 'tied', 'patient_id', 'reproductive_health', null),
  ('sti_risk_checks', 'tied', 'patient_id', 'reproductive_health', null),
  ('symptom_triage_assessments', 'tied', 'patient_id', 'medical_history', null),
  ('therapy_sessions', 'tied', 'patient_id', 'medical_history', null),
  ('vaccination_adverse_events', 'tied', 'patient_id', 'vaccinations', null),
  ('vaccination_card_extractions', 'tied', 'patient_id', 'vaccinations', null),
  ('vaccination_schedules', 'tied', 'patient_id', 'vaccinations', null),
  ('verified_documents', 'tied', 'patient_id', 'medical_history', null),
  ('scribe_transcripts', 'tied', '(select sc.patient_id from public.scribe_consents sc where sc.id = scribe_consent_id)', 'medical_history', null),
  ('wearable_readings', 'tied', '(select wc.patient_id from public.wearable_connections wc where wc.id = connection_id)', 'medical_history', null),
  ('risk_assessment_responses', 'tied', 'profile_id', 'medical_history', null),
  ('prevention_risk_scores', 'tied', 'profile_id', 'medical_history', null),
  ('vaccination_records', 'tied', 'profile_id', 'vaccinations', null),
  ('activity_log_entries', 'org', 'patient_id', 'medical_history', 'activity log'),
  ('adolescent_confidentiality_waivers', 'org', 'patient_id', 'medical_history', 'consent record'),
  ('alcohol_consumption_logs', 'tied', 'patient_id', 'medical_history', null),
  ('alert_follow_up_tasks', 'org', 'patient_id', 'medical_history', 'work queue'),
  ('appointment_waiting_list', 'org', 'patient_id', 'medical_history', 'scheduling'),
  ('appointments', 'org', 'patient_id', 'medical_history', 'scheduling: coordinators book; ties derive from it'),
  ('care_engagement_scores', 'org', 'patient_id', 'medical_history', 'roster'),
  ('care_management_barriers', 'org', 'patient_id', 'medical_history', 'case management work queue'),
  ('care_management_case_events', 'org', 'patient_id', 'medical_history', 'case management work queue'),
  ('care_management_cases', 'org', 'patient_id', 'medical_history', 'case management work queue'),
  ('care_message_draft_replies', 'org', 'patient_id', 'medical_history', 'messaging work'),
  ('care_message_threads', 'org', 'patient_id', 'medical_history', 'thread headers org-readable by decision OQ-157'),
  ('care_outreach_contacts', 'org', 'patient_id', 'medical_history', 'coordinator outreach'),
  ('care_outreach_tasks', 'org', 'patient_id', 'medical_history', 'coordinator outreach queue'),
  ('care_tasks', 'org', 'patient_id', 'medical_history', 'coordinator tasks'),
  ('care_team_assignment', 'org', 'patient_id', 'medical_history', 'creates the tie itself'),
  ('care_team_handovers', 'org', 'patient_id', 'medical_history', 'handover work'),
  ('cds_recommendation_decisions', 'org', 'patient_id', 'medical_history', 'system rules'),
  ('cgm_connections', 'org', 'patient_id', 'medical_history', 'device logistics'),
  ('chronic_programme_coordinator_tasks', 'org', 'patient_id', 'medical_history', 'coordinator tasks'),
  ('chronic_programme_schedule_occurrences', 'org', 'patient_id', 'medical_history', 'programme scheduling'),
  ('clinical_incident_reports', 'org', 'patient_id', 'medical_history', 'clinical governance'),
  ('clinical_rule_action_records', 'org', 'patient_id', 'medical_history', 'system rules'),
  ('clinical_rule_events', 'org', 'patient_id', 'medical_history', 'system rules'),
  ('clinical_rule_executions', 'org', 'patient_id', 'medical_history', 'system rules'),
  ('clinical_rule_suppressions', 'org', 'patient_id', 'medical_history', 'system rules'),
  ('clinical_rules', 'org', 'patient_id', 'medical_history', 'system rules'),
  ('clinician_alerts', 'org', 'patient_id', 'medical_history', 'work queue: unassigned alerts must be visible to qualifying doctors'),
  ('complaints', 'org', 'patient_id', 'medical_history', 'support'),
  ('consultation_feedback', 'org', 'patient_id', 'medical_history', 'feedback'),
  ('consultation_follow_ups', 'org', 'patient_id', 'medical_history', 'consultation logistics'),
  ('data_correction_requests', 'org', 'patient_id', 'medical_history', 'data rights'),
  ('device_data_deletion_requests', 'org', 'patient_id', 'medical_history', 'data rights'),
  ('device_fault_reports', 'org', 'patient_id', 'medical_history', 'device logistics'),
  ('emergency_cards', 'org', 'patient_id', 'medical_history', 'emergency card issue'),
  ('emergency_events', 'org', 'patient_id', 'medical_history', 'work queue: on-call'),
  ('employer_allowance_usage', 'org', 'patient_id', 'medical_history', 'billing'),
  ('employer_campaign_participants', 'org', 'patient_id', 'medical_history', 'employer programme'),
  ('escalations', 'org', 'patient_id', 'medical_history', 'work queue: unassigned pool'),
  ('fhir_import_batches', 'org', 'patient_id', 'medical_history', 'import operations'),
  ('fhir_import_proposed_resources', 'org', 'patient_id', 'medical_history', 'import operations'),
  ('health_education_progress', 'org', 'patient_id', 'medical_history', 'education'),
  ('health_education_recommendations', 'org', 'patient_id', 'medical_history', 'education'),
  ('health_education_unlock_notifications', 'org', 'patient_id', 'medical_history', 'education'),
  ('health_passport_attestation_requests', 'org', 'patient_id', 'medical_history', 'passport operations'),
  ('health_passport_issuances', 'org', 'patient_id', 'medical_history', 'passport operations'),
  ('home_care_requests', 'org', 'patient_id', 'medical_history', 'logistics'),
  ('identity_verifications', 'org', 'patient_id', 'medical_history', 'identity operations'),
  ('insurance_policies', 'org', 'patient_id', 'medical_history', 'billing'),
  ('invoices', 'org', 'patient_id', 'medical_history', 'billing'),
  ('lab_location_reviews', 'org', 'patient_id', 'medical_history', 'lab logistics'),
  ('lab_orders', 'org', 'patient_id', 'medical_history', 'lab booking logistics (coordinator)'),
  ('lab_specimens', 'org', 'patient_id', 'medical_history', 'lab logistics'),
  ('lifestyle_barrier_reports', 'org', 'patient_id', 'medical_history', 'self-tracking'),
  ('lpe_consents', 'org', 'patient_id', 'medical_history', 'consent record'),
  ('masked_call_sessions', 'org', 'patient_id', 'medical_history', 'call logistics'),
  ('medication_access_barriers', 'org', 'patient_id', 'medical_history', 'logistics: access to medicines'),
  ('medication_adherence_alerts', 'org', 'patient_id', 'medical_history', 'coordinator adherence follow-up'),
  ('medication_adherence_checkins', 'org', 'patient_id', 'medical_history', 'coordinator adherence check-ins'),
  ('medication_affordability_reports', 'org', 'patient_id', 'medical_history', 'logistics'),
  ('medication_change_requests', 'org', 'patient_id', 'medical_history', 'refill workflow'),
  ('medication_dispense_flags', 'org', 'patient_id', 'medical_history', 'pharmacy logistics'),
  ('medication_receipt_confirmations', 'org', 'patient_id', 'medical_history', 'pharmacy logistics'),
  ('medication_repeat_requests', 'org', 'patient_id', 'medical_history', 'refill workflow'),
  ('monitoring_schedule_items', 'org', 'patient_id', 'medical_history', 'roster'),
  ('navigation_requests', 'org', 'patient_id', 'medical_history', 'logistics'),
  ('nutrition_log_entries', 'org', 'patient_id', 'medical_history', 'self-tracking'),
  ('patient_activity_goals', 'org', 'patient_id', 'medical_history', 'self-set goals'),
  ('patient_alcohol_goals', 'tied', 'patient_id', 'medical_history', null),
  ('patient_challenge_enrolments', 'org', 'patient_id', 'medical_history', 'wellness programme'),
  ('patient_devices', 'org', 'patient_id', 'medical_history', 'device logistics'),
  ('patient_engagement_interventions', 'org', 'patient_id', 'medical_history', 'roster'),
  ('patient_engagement_scores', 'org', 'patient_id', 'medical_history', 'roster'),
  ('patient_exercise_enrollments', 'org', 'patient_id', 'medical_history', 'wellness programme'),
  ('patient_goal_progress', 'org', 'patient_id', 'medical_history', 'self-set goals'),
  ('patient_goals', 'org', 'patient_id', 'medical_history', 'self-set goals'),
  ('patient_health_resets', 'org', 'patient_id', 'medical_history', 'wellness programme'),
  ('patient_milestones', 'org', 'patient_id', 'medical_history', 'wellness programme'),
  ('patient_notification_preferences', 'org', 'patient_id', 'medical_history', 'preferences'),
  ('patient_shared_decisions', 'org', 'patient_id', 'medical_history', 'consent record'),
  ('patient_sleep_goals', 'org', 'patient_id', 'medical_history', 'self-set goals'),
  ('patient_testimonials', 'org', 'patient_id', 'medical_history', 'marketing consent record'),
  ('patient_weight_goals', 'org', 'patient_id', 'medical_history', 'self-set goals'),
  ('patient_wellness_badges', 'org', 'patient_id', 'medical_history', 'wellness programme'),
  ('pharmacy_order_delivery_attempts', 'org', 'patient_id', 'medical_history', 'pharmacy logistics'),
  ('pharmacy_order_dispenses', 'org', 'patient_id', 'medical_history', 'pharmacy logistics'),
  ('pharmacy_orders', 'org', 'patient_id', 'medical_history', 'pharmacy logistics'),
  ('prescription_renewal_requests', 'org', 'patient_id', 'medical_history', 'refill workflow'),
  ('prescription_supply_attempts', 'org', 'patient_id', 'medical_history', 'pharmacy logistics'),
  ('programme_purchases', 'org', 'patient_id', 'medical_history', 'billing'),
  ('record_shares', 'org', 'patient_id', 'medical_history', 'patient-initiated shares'),
  ('risk_reassessment_queue', 'org', 'patient_id', 'medical_history', 'work queue'),
  ('service_purchases', 'org', 'patient_id', 'medical_history', 'billing'),
  ('sleep_log_entries', 'org', 'patient_id', 'medical_history', 'self-tracking'),
  ('smoking_check_ins', 'tied', 'patient_id', 'medical_history', null),
  ('superseded_source_values', 'org', 'patient_id', 'medical_history', 'system'),
  ('support_tickets', 'org', 'patient_id', 'medical_history', 'support'),
  ('video_consultations', 'org', 'patient_id', 'medical_history', 'consultation logistics: creates ties'),
  ('video_visit_requests', 'org', 'patient_id', 'medical_history', 'consultation logistics'),
  ('wearable_connections', 'org', 'patient_id', 'medical_history', 'device logistics'),
  ('wellbeing_checkin_preferences', 'org', 'patient_id', 'medical_history', 'preferences'),
  ('wellbeing_checkins', 'org', 'patient_id', 'medical_history', 'self-tracking'),
  ('wellness_class_registrations', 'org', 'patient_id', 'medical_history', 'wellness programme'),
  ('wellness_points_balances', 'org', 'patient_id', 'medical_history', 'wellness programme'),
  ('wellness_points_ledger', 'org', 'patient_id', 'medical_history', 'wellness programme'),
  ('wellness_points_redemptions', 'org', 'patient_id', 'medical_history', 'wellness programme');

create table public.staff_read_policy_backup (
  table_name text not null,
  policy_name text not null,
  cmd text not null,
  roles text not null,
  qual text,
  with_check text,
  saved_at timestamptz not null default now(),
  primary key (table_name, policy_name)
);
alter table public.staff_read_policy_backup enable row level security;
revoke all on public.staff_read_policy_backup from public, anon, authenticated;

insert into public.platform_modules (key, label, description, is_enabled, enabled_at, enabled_by, activation_note)
select 'tied_staff_reads', 'Staff read patient records only through a care relationship',
        'S39b (INV-12). On: staff need a tie, a break-glass grant or a support view to read the tables listed as tied in staff_read_scope. Off: the old organisation-wide read.',
        true, now(), (select id from public.profiles where role = 'admin' and is_active order by created_at limit 1), 'S39b migration: on from the start, off is the instant rollback'
on conflict (key) do nothing;

create function private.tied_staff_reads_on() returns boolean language sql stable security definer set search_path = '' as
$$ select coalesce((select is_enabled from public.platform_modules where key = 'tied_staff_reads'), true) $$;

create function private.staff_may_read(p_patient uuid, p_org uuid, p_category public.care_access_category) returns boolean
language sql stable security definer set search_path = '' as
$$
  select case
    when not private.tied_staff_reads_on() then private.is_org_staff(p_org)
    -- a care coordinator is logistics only: never a clinical table, tied or not
    when exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'care_coordinator') then false
    else private.can_staff_read_clinical(p_patient, p_category)
  end
$$;
revoke all on function private.tied_staff_reads_on() from public, anon, authenticated;
revoke all on function private.staff_may_read(uuid, uuid, public.care_access_category) from public, anon;
grant execute on function private.staff_may_read(uuid, uuid, public.care_access_category) to authenticated;

-- The rewrite. Only SELECT and ALL policies, only the plain staff arm; an ALL policy is split so its writes keep the old text.
do $do$
declare
  s record; p record; v_new text; v_roles text; v_n integer := 0; v_old constant text := 'private.is_org_staff(organisation_id)';
begin
  for s in select * from public.staff_read_scope where mode = 'tied' loop
    for p in select * from pg_policies where schemaname = 'public' and tablename = s.table_name and cmd in ('SELECT', 'ALL') and coalesce(qual, '') like '%' || v_old || '%' loop
      insert into public.staff_read_policy_backup (table_name, policy_name, cmd, roles, qual, with_check)
      values (p.tablename, p.policyname, p.cmd, array_to_string(p.roles, ','), p.qual, p.with_check) on conflict do nothing;
      v_new := replace(p.qual, v_old, format('private.staff_may_read(%s, organisation_id, %L::public.care_access_category)', s.patient_expr, s.category::text));
      v_roles := array_to_string(p.roles, ', ');
      execute format('drop policy %I on public.%I', p.policyname, p.tablename);
      if p.cmd = 'SELECT' then
        execute format('create policy %I on public.%I for select to %s using (%s)', p.policyname, p.tablename, v_roles, v_new);
      else
        execute format('create policy %I on public.%I for select to %s using (%s)', left(p.policyname, 54) || '_read', p.tablename, v_roles, v_new);
        execute format('create policy %I on public.%I for insert to %s with check (%s)', left(p.policyname, 54) || '_ins', p.tablename, v_roles, coalesce(p.with_check, p.qual));
        execute format('create policy %I on public.%I for update to %s using (%s) with check (%s)', left(p.policyname, 54) || '_upd', p.tablename, v_roles, p.qual, coalesce(p.with_check, p.qual));
        execute format('create policy %I on public.%I for delete to %s using (%s)', left(p.policyname, 54) || '_del', p.tablename, v_roles, p.qual);
      end if;
      v_n := v_n + 1;
    end loop;
  end loop;
  raise notice 'S39b rewrote % policies', v_n;
end $do$;

-- Organisation-level quality and safety aggregates read the tied tables through their caller's rights, so for an untied staff member they would now
-- count nothing. They hold counts per organisation only (no patient rows), so they move to owner rights with the same staff predicate on the
-- organisation (and a caller with no session, such as the cron or the service role, still sees them as before: anon has no grant on them). patient_care_gaps lists patients, so it stays on caller rights and follows the tie.
do $v$
declare v text;
begin
  foreach v in array array['diabetes_quality_metrics', 'hypertension_quality_metrics', 'lpe_programme_outcomes', 'obesity_quality_metrics',
                           'risk_model_drift_signal', 'risk_model_performance', 'risk_model_performance_by_subgroup', 'triage_safety_monitoring'] loop
    continue when to_regclass(format('public.%I', v)) is null;
    execute format('create or replace view public.%I with (security_invoker = off) as select * from (%s) q where private.is_org_staff(q.organisation_id) or (select auth.uid()) is null',
                   v, rtrim(pg_get_viewdef(format('public.%I', v)::regclass, true), ';'));
  end loop;
end $v$;

-- scribe_transcripts: a transcript is deleted by staff when the patient revokes consent, so the staff delete stays, but now only for staff tied to
-- the patient (it was any staff of the organisation)
do $t$
declare p record;
begin
  select * into p from pg_policies where schemaname = 'public' and tablename = 'scribe_transcripts' and policyname = 'scribe_transcripts_delete_staff';
  if found then
    insert into public.staff_read_policy_backup (table_name, policy_name, cmd, roles, qual, with_check)
    values (p.tablename, p.policyname, p.cmd, array_to_string(p.roles, ','), p.qual, p.with_check) on conflict do nothing;
    execute 'drop policy scribe_transcripts_delete_staff on public.scribe_transcripts';
    execute format('create policy scribe_transcripts_delete_staff on public.scribe_transcripts for delete to %s using (%s)', array_to_string(p.roles, ', '),
      replace(p.qual, 'private.is_org_staff(organisation_id)', 'private.staff_may_read((select sc.patient_id from public.scribe_consents sc where sc.id = scribe_consent_id), organisation_id, ''medical_history''::public.care_access_category)'));
  end if;
end $t$;

do $$
declare v_left text;
begin
  select string_agg(p.tablename || '.' || p.policyname, ', ') into v_left
    from pg_policies p join public.staff_read_scope s on s.table_name = p.tablename and s.mode = 'tied'
   where p.schemaname = 'public' and p.cmd in ('SELECT', 'ALL') and coalesce(p.qual, '') like '%private.is_org_staff(organisation_id)%';
  if v_left is not null then raise exception 'S39b: a tied table still has the plain staff read: %', v_left; end if;
  if (select count(*) from public.staff_read_scope where mode = 'tied') <> 128 then raise exception 'S39b: expected 128 tied tables'; end if;
  if exists (select 1 from unnest(array['diabetes_quality_metrics','hypertension_quality_metrics','lpe_programme_outcomes','obesity_quality_metrics','risk_model_drift_signal','risk_model_performance','risk_model_performance_by_subgroup','triage_safety_monitoring']) v
             where to_regclass('public.' || v) is not null and has_table_privilege('anon', 'public.' || v, 'SELECT')) then
    raise exception 'S39b: anon can read an owner-rights quality view (the no-session bypass relies on anon having no grant)';
  end if;
  if has_function_privilege('anon', 'private.staff_may_read(uuid,uuid,public.care_access_category)', 'EXECUTE') then raise exception 'S39b: anon can execute staff_may_read'; end if;
  if not exists (select 1 from pg_policies where tablename = 'scribe_transcripts' and policyname = 'scribe_transcripts_delete_staff' and qual like '%staff_may_read%') then raise exception 'S39b: the staff transcript delete is not tied'; end if;
end $$;
