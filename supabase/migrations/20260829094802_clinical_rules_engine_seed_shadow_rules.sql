-- Tarragon Health — Clinical Rules & Care Protocol Engine, part 6/6:
-- seed catalogue — one real rule per §32.5 category, all in SHADOW mode.
--
-- Every rule below targets an event_type the part-4 emitters actually
-- populate (vital_recorded, screening_result_received, medication_prescribed,
-- appointment_missed), so once real traffic flows, public.clinical_rule_
-- shadow_report(rule_key) returns a genuine "what would this have done"
-- readout rather than a permanently-empty one — the validation step §32.13
-- exists for.
--
-- SHIPPED IN SHADOW, NOT ACTIVE. None of these can affect a patient: shadow
-- status needs no signature and the DB enforces (via CHECK) that only a
-- signed, owned, protocol-linked rule can ever reach 'active'. Promoting any
-- one of these to active is a separate, individually-reviewed decision for
-- a Clinical Director (public.sign_clinical_rule) after its shadow readout
-- has been reviewed — this migration does not, and structurally cannot, do
-- that on its own.
--
-- rule 3 (diagnostic) deliberately never supersedes or duplicates the
-- authoritative abnormal-result pipeline (private.handle_abnormal_
-- screening_result / clinician_alerts, live since Sprint 1) — see its own
-- description and explanation_template, which say so explicitly. Being
-- shadow-only makes this true structurally regardless of wording, but the
-- wording matters too: CLAUDE.md is explicit that an abnormal screening
-- result must never be deprioritised or silently swallowed, and a rule
-- whose OWN text could be misread as "the" abnormal-result handler would be
-- a governance hazard even while harmless in shadow.

insert into public.clinical_rules
  (rule_key, version, name, description, category, domain, event_type,
   population, conditions, actions, priority, specificity, escalation,
   suppression, explanation_template, status, notes)
values
(
  'preventive_next_screening_after_normal_result', 1,
  'Schedule next screening after a normal result',
  'Preventive: when a screening comes back normal, the programme''s next-screening cadence should be scheduled so a clear result does not quietly end monitoring.',
  'preventive', 'preventive_screening', 'screening_result_received',
  '{"op":"true"}'::jsonb,
  '{"predicate": {"op":"eq","field":"event.result_status","value":"normal"}}'::jsonb,
  '[{"action_type":"monitoring_schedule","payload":{"message":"Schedule this patient''s next screening per the programme''s cadence."},"requires_clinician_oversight":true}]'::jsonb,
  40, 10,
  '{}'::jsonb,
  '{"cooldown_hours": 24}'::jsonb,
  'This screening ({{event.screen_type_code}}) came back normal, so the next screening in this programme''s cadence should now be scheduled, per the preventive screening protocol.',
  'shadow',
  'Seed rule 1/7 (§32.5 preventive). Shadow-only pending Clinical Director review; see shadow_report before any promotion.'
),
(
  'htn_repeated_high_home_bp_review', 1,
  'Repeated high home BP readings trigger a review task',
  'Monitoring: the platform''s own worked example from the Clinical Rules spec (§32.4/§32.11) — three or more home systolic readings at or above 160 mmHg in 14 days for a hypertension-programme patient should generate a clinical review task, not wait for the patient''s next scheduled visit.',
  'monitoring', 'hypertension', 'vital_recorded',
  '{"op":"eq","field":"has_condition_hypertension","value":true}'::jsonb,
  '{"window": {"metric":"vital_reading","vital_type":"blood_pressure","field":"systolic","comparator":"gte","threshold":160,"days":14}, "predicate": {"op":"gte","field":"window.count","value":3}}'::jsonb,
  '[{"action_type":"task","payload":{"title":"Hypertension review needed","reason":"3+ home systolic readings >= 160 mmHg in 14 days"},"requires_clinician_oversight":true}]'::jsonb,
  60, 10,
  '{"owner_tier": "tier_1", "sla_minutes": 2880}'::jsonb,
  '{"cooldown_hours": 72}'::jsonb,
  'This review task was generated because {{window.count}} home BP readings in the last {{window.days}} days had systolic >= {{window.threshold}} mmHg, exceeding the threshold defined in the hypertension monitoring protocol.',
  'shadow',
  'Seed rule 2/7 (§32.5 monitoring). This is the spec''s own literal worked example (§32.4, §32.11) made real. Shadow-only pending Clinical Director review against TH-CP-HTN-001''s actual signed thresholds before any promotion — the 160/3-in-14-days figures here are a reasonable starting point, not yet confirmed against the signed protocol document.'
),
(
  'diagnostic_abnormal_screening_result_review', 1,
  'Abnormal or critical screening result flagged for clinical review',
  'Diagnostic: any abnormal or critical screening result should be visible to this rule catalogue as a governed decision, even though it deliberately never supersedes the platform''s existing, authoritative Category 2 -> 1 escalation pipeline.',
  'diagnostic', 'preventive_screening', 'screening_result_received',
  '{"op":"true"}'::jsonb,
  '{"predicate": {"op":"in","field":"event.result_status","value":["abnormal","critical"]}}'::jsonb,
  '[{"action_type":"escalation","payload":{"note":"Observational shadow parallel only. private.handle_abnormal_screening_result / clinician_alerts is the live, authoritative Category 2->1 escalation path (CLAUDE.md: never deprioritise or silently swallow an abnormal result) and is completely untouched by this rule."},"requires_clinician_oversight":true}]'::jsonb,
  70, 10,
  '{}'::jsonb,
  '{"cooldown_hours": 0}'::jsonb,
  'This screening result was classified {{event.result_status}}, which the preventive screening protocol flags for clinical review -- shown here for governance visibility only; the live abnormal-result escalation pipeline (clinician_alerts) is the pathway that actually acts and is unaffected by this rule.',
  'shadow',
  'Seed rule 3/7 (§32.5 diagnostic). Never promote this rule to ACTIVE with an escalation action that duplicates clinician_alerts writes -- its purpose is governance visibility over the existing pipeline, not a second escalation path. No cooldown (0h) so every abnormal/critical result is visible, matching the "never silently swallow" rule.'
),
(
  'medication_new_prescription_ckd_renal_monitoring', 1,
  'New medication for a CKD patient needs a renal-function recheck',
  'Medication: starting or changing any medication for a patient with active CKD should schedule a renal-function (U&E/eGFR) recheck, per the CKD monitoring protocol''s "after ACE inhibitor / ARB start or dose change" and general nephrotoxin-avoidance guidance.',
  'medication', 'medication_safety', 'medication_prescribed',
  '{"op":"eq","field":"has_condition_ckd","value":true}'::jsonb,
  '{"predicate": {"op":"true"}}'::jsonb,
  '[{"action_type":"monitoring_schedule","payload":{"message":"New medication for a patient with active CKD -- schedule a renal-function (U&E/eGFR) recheck per the CKD monitoring protocol."},"requires_clinician_oversight":true}]'::jsonb,
  50, 10,
  '{}'::jsonb,
  '{"cooldown_hours": 48, "dedup_key_fields": ["event.drug_name"]}'::jsonb,
  '{{event.drug_name}} was newly prescribed for a patient with active CKD; the CKD monitoring protocol calls for a renal-function recheck after starting or changing therapy.',
  'shadow',
  'Seed rule 4/7 (§32.5 medication). Deliberately broad (any new medication, not a drug allow-list) for a first shadow pass -- narrow to nephrotoxin-relevant drug classes once the shadow readout shows real volume/precision.'
),
(
  'referral_critical_screening_specialist_review', 1,
  'Critical screening result recommends a specialist referral',
  'Referral: a screening result classified critical (the more severe of the two abnormal tiers) should recommend specialist referral, distinct from and additional to the diagnostic-category review above.',
  'referral', 'preventive_screening', 'screening_result_received',
  '{"op":"true"}'::jsonb,
  '{"predicate": {"op":"eq","field":"event.result_status","value":"critical"}}'::jsonb,
  '[{"action_type":"referral_recommendation","payload":{"message":"Critical screening result -- recommend specialist referral for clinician review and urgency assignment."},"requires_clinician_oversight":true}]'::jsonb,
  55, 10,
  '{}'::jsonb,
  '{"cooldown_hours": 0}'::jsonb,
  'This screening result was classified critical ({{event.screen_type_code}}), which the preventive screening protocol flags for specialist referral review in addition to clinical review.',
  'shadow',
  'Seed rule 5/7 (§32.5 referral). Intentionally overlaps rule 3 (diagnostic) on critical results -- §32.9 exists precisely because more than one governed rule can legitimately apply to the same event; both are recorded, neither is silently dropped.'
),
(
  'engagement_repeated_missed_appointments', 1,
  'Repeated missed appointments flag disengagement',
  'Engagement: two or more missed (no-show) appointments within 180 days is this rule''s working definition of a patient disengaging, prompting coordinator outreach.',
  'engagement', 'engagement', 'appointment_missed',
  '{"op":"true"}'::jsonb,
  '{"window": {"metric":"appointment_missed","comparator":"gte","threshold":0,"days":180}, "predicate": {"op":"gte","field":"window.count","value":2}}'::jsonb,
  '[{"action_type":"task","payload":{"title":"Patient disengaging -- outreach needed","note":"2+ missed appointments in 180 days"},"requires_clinician_oversight":true}]'::jsonb,
  45, 10,
  '{"owner_tier": "care_coordinator"}'::jsonb,
  '{"cooldown_hours": 720}'::jsonb,
  'This patient has missed {{window.count}} appointments in the last {{window.days}} days, meeting this engagement rule''s threshold for proactive outreach.',
  'shadow',
  'Seed rule 6/7 (§32.5 engagement). Shadow-parallel to the existing repeated_no_show care-gap/outreach pathway (20260828000123, care_outreach_tasks) -- comparing this rule''s shadow volume against that pathway''s real output is a natural first thing to check before ever promoting it.'
),
(
  'operational_missed_appointment_rebooking', 1,
  'Missed appointment recommends prompt rebooking',
  'Operational: every individual missed appointment, regardless of pattern, should prompt a rebooking recommendation so a single no-show does not become a silent gap in care.',
  'operational', 'operational', 'appointment_missed',
  '{"op":"true"}'::jsonb,
  '{"predicate": {"op":"true"}}'::jsonb,
  '[{"action_type":"appointment_recommendation","payload":{"message":"Missed appointment -- recommend offering a rebooking within 7 days."},"requires_clinician_oversight":false}]'::jsonb,
  30, 10,
  '{}'::jsonb,
  '{"cooldown_hours": 24, "dedup_key_fields": ["event.service"]}'::jsonb,
  'An appointment ({{event.service}}) was marked as a no-show; the operational protocol recommends offering a rebooking within 7 days to avoid a gap in care.',
  'shadow',
  'Seed rule 7/7 (§32.5 operational). requires_clinician_oversight=false on its appointment_recommendation is currently moot -- actions.ts only ever auto-applies the notification action_type regardless of this flag (see that file''s header) -- kept accurate here for when appointment_recommendation auto-application is deliberately added.'
);
