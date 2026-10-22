-- Cuff-display camera reader (item 6) and result passport (item 10): the two go-live guards, born OFF, and the AI registration for the cuff reader.
-- Design: docs/design/CUFF-PASSPORT.md. Not applied to production by the session that wrote it.
--
-- RECONCILED, NOT REBUILT.
--   * Photo capture of a device display already exists (S70a, `POST /api/mobile/photo-readings`, source `photo_confirmed`, the plausibility hold,
--     the on-device recogniser seam). That path takes only confirmed NUMBERS. This build adds one new, optional, governed step in front of it:
--     the phone may ask the server to PROPOSE the numbers from the photo. No new table, no new vital_source value (`photo_confirmed` is already
--     live, so no ALTER TYPE here), no change to what is saved or how it is triaged.
--   * Sharing a record already exists (S09 `record_shares`, S09x PIN, S-share extras: recipient, view cap, window; `record_share_lookups` plus
--     `my_access_log()` for who opened it and when; the closed section list has no reproductive_health; `record_share_by_token` filters
--     sensitive_positive). This build adds a printable "result passport" PDF with glucose and lab sections on the existing visit-summary
--     machinery and a calm entry page that leads to the existing share controls. No new table, so no new access path to patient data.
--
-- What this migration adds: two go-live guards (OFF), and AI-022 registered DISABLED. AI-021 is taken by the unmerged S07y diary reader.
-- It seeds no evaluation run, no prompt approval and no knowledge-source approval: the system's criteria stay unmet until a human evaluates it.

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in)
select 'cuff_camera_enabled', 'Cuff display camera reader', 'Asking the server to propose the numbers from a photo of a blood pressure cuff display',
       'AI-022 has a passed evaluation and a Clinical Director approval, the vision provider data agreement is in place, and the founder confirms (OQ-CUFF-1)', 'admin',
       array['the cuff display proposal route', 'the Read it for me button on the phone'],
       'Typing the numbers in, and the on-device photo screen without a proposal, are never blocked. Nothing a proposal says is saved until the person has looked at the photo and confirmed every number. Switching it on needs its conditions added to private.go_live_conditions first; until then it reports "no defined condition" and cannot be switched on.'
where not exists (select 1 from public.go_live_guards where key = 'cuff_camera_enabled');

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in)
select 'result_passport_enabled', 'Result passport', 'Building the result passport PDF with the glucose and lab results sections, and its entry page',
       'The Chief Medical Officer has confirmed the wording of the passport page and which released results may appear; the founder confirms (OQ-PASSPORT-1)', 'admin',
       array['the result passport page', 'the glucose and lab results sections of the PDF'],
       'The existing share links, the visit summary PDF and the health passport are never blocked. Sensitive positive results and reproductive health records can never appear whatever this says. Switching it on needs its conditions added to private.go_live_conditions first; until then it reports "no defined condition" and cannot be switched on.'
where not exists (select 1 from public.go_live_guards where key = 'result_passport_enabled');

insert into public.ai_systems (
  system_code, name, purpose, owner_role, risk_class, autonomy_level, clinically_meaningful,
  lifecycle_status, is_enabled, runtime_governed, fallback_behaviour, code_reference
) values (
  'AI-022',
  'Cuff Display Reader',
  'Proposes the systolic, diastolic and pulse numbers shown on the display of a home blood pressure cuff from a photo the patient chooses to send. '
  || 'It only proposes. The patient sees the photo beside editable boxes and must tick every number before anything is saved, and the saved reading takes '
  || 'exactly the same deterministic route as a typed one. The photo is sent for the one call and is never stored; nothing the model returns reaches triage.',
  'Clinical Director',
  'moderate',
  'assist',
  true,
  'draft',
  false,
  false,
  'The person types the numbers from the display into the same boxes (the S70a photo screen, or the plain reading form), which has always worked and is never removed.',
  'apps/web/src/lib/vitals/cuff-display-vision.ts'
) on conflict (system_code) do nothing;

do $$
begin
  if not exists (select 1 from public.go_live_guards where key = 'cuff_camera_enabled') then raise exception 'cuff/passport self-check: cuff_camera_enabled is missing'; end if;
  if not exists (select 1 from public.go_live_guards where key = 'result_passport_enabled') then raise exception 'cuff/passport self-check: result_passport_enabled is missing'; end if;
  if exists (select 1 from public.go_live_guards where key in ('cuff_camera_enabled', 'result_passport_enabled') and is_on) then
    raise exception 'cuff/passport self-check: both guards must start off';
  end if;
  if not exists (select 1 from public.ai_systems where system_code = 'AI-022' and is_enabled = false and runtime_governed = false and lifecycle_status = 'draft') then
    raise exception 'cuff/passport self-check: AI-022 must be registered, disabled and not runtime governed';
  end if;
  -- no human judgement may be invented for it: no evaluation, approval or knowledge source
  if exists (select 1 from public.ai_evaluation_runs r join public.ai_systems s on s.id = r.ai_system_id where s.system_code = 'AI-022') then
    raise exception 'cuff/passport self-check: AI-022 must have no evaluation run';
  end if;
end $$;
