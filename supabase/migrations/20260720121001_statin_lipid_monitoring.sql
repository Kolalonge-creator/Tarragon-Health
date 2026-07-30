-- Tarragon Health — Cholesterol / lipid management as a CV-risk module
-- Phase 2 (Monitoring + treatment, inside the HTN & diabetes pathways).
--
-- Statins and other lipid-lowering drugs are ordinary rows in
-- public.medications, so they ALREADY flow through the medication tracker,
-- adherence engine, refill dates and reminders exactly like BP/diabetes meds
-- — no new medication plumbing needed. This migration adds the drug-class
-- monitoring rules so that STARTING one of these drugs auto-schedules the
-- right follow-up labs via the existing
-- private.schedule_medication_lab_monitoring() trigger:
--   • a lipid-profile RESPONSE (efficacy) recheck ~3 months after initiation,
--     so the care team can confirm the drug is working and titrate — the
--     lipid analogue of an HbA1c recheck after starting a diabetes drug;
--   • liver-function (LFT) safety monitoring for statins that didn't yet have
--     a rule (only atorvastatin/simvastatin/rosuvastatin did).
--
-- All rows are idempotent (unique (match_pattern, monitoring_label) + ON
-- CONFLICT DO NOTHING). The 3-month recheck interval here is a sensible
-- clinical default; the CV-risk *thresholds and targets* that decide who
-- needs a drug at all live in the Medical-Director-signed cv_risk_config
-- (Phase 3), never hardcoded.

insert into public.drug_monitoring_rules
  (match_pattern, drug_class, monitoring_label, interval_months, monitor_on_initiation)
values
  -- Lipid-profile efficacy recheck after starting any statin
  ('atorvastatin%',  'Statin', 'Lipid profile response (efficacy)', 3, false),
  ('simvastatin%',   'Statin', 'Lipid profile response (efficacy)', 3, false),
  ('rosuvastatin%',  'Statin', 'Lipid profile response (efficacy)', 3, false),
  ('pravastatin%',   'Statin', 'Lipid profile response (efficacy)', 3, false),
  ('pitavastatin%',  'Statin', 'Lipid profile response (efficacy)', 3, false),
  ('lovastatin%',    'Statin', 'Lipid profile response (efficacy)', 3, false),
  ('fluvastatin%',   'Statin', 'Lipid profile response (efficacy)', 3, false),
  -- LFT safety monitoring for the statins that lacked a rule
  ('pravastatin%',   'Statin', 'Liver function (LFTs)', null, false),
  ('pitavastatin%',  'Statin', 'Liver function (LFTs)', null, false),
  ('lovastatin%',    'Statin', 'Liver function (LFTs)', null, false),
  ('fluvastatin%',   'Statin', 'Liver function (LFTs)', null, false),
  -- Ezetimibe (cholesterol-absorption inhibitor) — efficacy recheck only
  ('ezetimibe%',     'Cholesterol absorption inhibitor', 'Lipid profile response (efficacy)', 3, false),
  -- Fibrates — lipid + LFT monitoring
  ('fenofibrate%',   'Fibrate', 'Lipid profile + liver function', 3, false),
  ('bezafibrate%',   'Fibrate', 'Lipid profile + liver function', 3, false),
  ('gemfibrozil%',   'Fibrate', 'Lipid profile + liver function', 3, false)
on conflict (match_pattern, monitoring_label) do nothing;
