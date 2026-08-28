-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as the screening_ladder provider-lookup fix
-- (20260802212102_fix_screening_ladder_lab_tests_provider_lookup.sql):
-- 20260810033834_fix_vitals_red_flag_sla_config_drift.sql's own insert
-- looks up the row it's building v4 from by a hardcoded live-only id
-- ('7b69cc62-06e3-4c22-8b2f-3b91b3de3704') copied from a live query when
-- that migration was written. escalation_slas.id defaults to
-- gen_random_uuid(), so a fresh replay's v3 row (correctly created by
-- 20260807090456_vitals_red_flag_notification_wiring.sql's own dynamic
-- `coalesce(max(version),0)+1` versioning) gets a different random id, the
-- hardcoded-id join matches zero rows, no v4 row is ever inserted, and the
-- immediately-following `update ... set is_active = false where is_active
-- and version <> 4` then deactivates every remaining row -- leaving zero
-- active escalation_slas rows at all, so every private.escalation_sla_
-- minutes() call in the rewired trigger functions raises "No active
-- escalation SLA configured" (confirmed via CI).
--
-- Not fixed by editing the historical migration (touches already-applied
-- content). Instead, this migration performs the exact same insert 33834
-- intends, looked up by "whichever row is currently active" instead of a
-- hardcoded id -- robust regardless of what version number that row
-- actually carries, on live or on a fresh replay alike (the invariant both
-- environments already enforce: exactly one active escalation_slas row at
-- any time). Genuine no-op on the live project: v4 already exists there
-- with is_active=true, so this insert's own guard below correctly skips it.
-- On a fresh replay it creates v4 correctly before 33834 runs; that
-- migration's own hardcoded-id insert then correctly matches nothing and is
-- a harmless no-op, and its deactivate-the-rest update correctly leaves
-- this migration's v4 row as the sole active one.
insert into public.escalation_slas (version, config, notes, is_active)
select
  4,
  (v3.config || '[
    {"pathway": "symptom_red_flag", "tier": "urgent_escalation", "sla_minutes": 240, "channel_sequence": ["push", "whatsapp_nudge"], "source_function": "private.handle_symptom_red_flag", "note": "High-severity (>=8, or a low-threshold red-flag type >=6) patient-logged symptom. As-transcribed from the prior hardcoded 4h literal — no change."},
    {"pathway": "symptom_red_flag", "tier": "clinician_review", "sla_minutes": 4320, "channel_sequence": ["push, batched"], "source_function": "private.handle_symptom_red_flag", "note": "Moderate-severity (5-7) patient-logged symptom. Previously had NO sla_due_at at all (untriaged by SLA) — 4320min chosen to match every other clinician_review-tier entry in this table (bp/lpe/chronic_monitoring_silence)."}
  ]'::jsonb),
  'v4 — wires spo2_vitals_red_flag and temperature_vitals_red_flag into the trigger functions (previously drafted in v3 but never read by code) and registers symptom_red_flag for the first time. Carries forward v3''s still-open review items unchanged (mild-hypothermia amber band, whether SpO2/temperature should share BP''s channel_sequence) plus this migration''s own new item: symptom_red_flag''s clinician_review SLA (4320min) is a first-time value with no prior clinical sign-off, chosen only by consistency with sibling clinician_review entries — flag for Clinical Director review alongside the rest of this table at /admin/settings/escalation-slas. DRAFT, unsigned.',
  true
from public.escalation_slas v3
where v3.is_active
  and not exists (select 1 from public.escalation_slas x where x.version = 4);
