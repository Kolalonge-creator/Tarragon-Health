-- F1 fix 3: symptom checker go-live. A new S37 go-live guard `symptom_checker_enabled`, seeded OFF, a database
-- refusal on every symptom-triage assessment insert while it is off, and a DRAFT (never signed, never active)
-- escalation SLA version that carries the missing `symptom_triage` pathway.
--
-- WHY. The signed, active escalation_slas config (v7, signed 2026-09-04) has no `symptom_triage` pathway, so
-- private.handle_symptom_triage_assessment() raises for any urgent or review-required assessment
-- (private.escalation_sla_minutes() raises "No active escalation SLA configured"), and the checker would
-- also go live with no recorded regulatory position. Module 12 stays dark until a human has done both.
-- The founder decision of 2026-10-07 is "interface plus in-house adapter only; symptom_checker_enabled stays OFF".
--
-- WHAT IS ENFORCED (INV-14, server side and client side):
--  * trigger symptom_triage_assessments_00_go_live_guard (BEFORE INSERT, named to fire first) refuses the row unless
--    private.go_live_open_patient('symptom_checker_enabled', patient_id), i.e. the guard is on or the patient is a
--    test account (same test rule as S37). The web insert uses the service role, so the table, not the app, is the gate.
--  * the web server action and the patient screen read the same guard and show a calm closed state (apps/web).
--  * the red-flag and danger-symptom check, the symptom log and emergency guidance are NOT behind the guard.
--
-- CONDITIONS (all must be met before switch_role 'cmo' can switch it on):
--   data:        a signed, active triage protocol exists; the ACTIVE escalation_slas config carries symptom_triage
--                for both urgent_escalation and clinician_review
--   attestation: NAFDAC / counsel position recorded; engine licence or internal validation recorded;
--                localisation sign-off recorded; accuracy baseline recorded
--   (attestations are recorded by an admin or the CMO through attest_go_live_condition; nothing is attested here.)
--
-- THE DRAFT SLA. One new escalation_slas row: version = highest existing + 1, config = the highest existing version's
-- config plus two symptom_triage entries (the values were first proposed in draft v6; channels are push then email now
-- that WhatsApp is removed), approved_by / approved_at null, is_active false. THIS MIGRATION SIGNS AND ACTIVATES NOTHING.
-- The founder or CMO must read it and sign it with public.sign_escalation_slas(); signing replaces the active config
-- wholesale, so the signer is also signing whatever else the highest existing draft carried over (for example the
-- pulse_vitals_red_flag pathway in draft v8). Idempotent: it inserts only if the highest version does not already
-- carry symptom_triage.
--
-- ROWS AFFECTED: 0 existing rows changed. symptom_triage_assessments has been unreachable (no active guard, protocol v1
-- signed 2026-09-04 but the checker was never announced); the count live is unverified here and the dry run should
-- record `select count(*) from symptom_triage_assessments`. Existing rows are untouched either way.

-- 1. The guard, seeded off
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in)
values (
  'symptom_checker_enabled', 'Symptom checker',
  'The patient symptom checker (triage wizard) and every new symptom triage assessment',
  'NAFDAC and counsel position recorded; engine licence or internal validation recorded; localisation sign-off recorded; accuracy baseline recorded; a signed triage protocol; the active escalation SLA carries symptom_triage',
  'cmo',
  array['symptom_triage_assessments insert (trigger symptom_triage_assessments_00_go_live_guard)', 'symptom checker web action and screen'],
  'The red-flag screen, the danger-symptom check, the symptom log and emergency guidance are not behind it. There is no mobile symptom checker.')
on conflict (key) do nothing;

-- 2. Conditions (patch the live definitions; fail loudly if drifted)
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  v_new := replace(v_def,
    E'  end if;\n  -- An unknown key has no conditions',
    E'  elsif p_key = ''symptom_checker_enabled'' then\n' ||
    E'    return jsonb_build_array(\n' ||
    E'      private.go_live_cond(''nafdac_position_recorded'', ''A NAFDAC and counsel position on a symptom checker is recorded'', private.go_live_attested(p_key, ''nafdac_position_recorded''), ''attestation'', null),\n' ||
    E'      private.go_live_cond(''engine_licence_or_validation_recorded'', ''An engine licence or an internal validation is recorded'', private.go_live_attested(p_key, ''engine_licence_or_validation_recorded''), ''attestation'', null),\n' ||
    E'      private.go_live_cond(''localisation_signoff_recorded'', ''Localisation sign-off is recorded'', private.go_live_attested(p_key, ''localisation_signoff_recorded''), ''attestation'', null),\n' ||
    E'      private.go_live_cond(''accuracy_baseline_recorded'', ''An accuracy baseline is recorded'', private.go_live_attested(p_key, ''accuracy_baseline_recorded''), ''attestation'', null),\n' ||
    E'      private.go_live_cond(''triage_protocol_signed'', ''A triage protocol is signed and active'',\n' ||
    E'        exists (select 1 from public.triage_protocols where is_active), ''data'', null),\n' ||
    E'      private.go_live_cond(''symptom_triage_sla_signed'', ''The active escalation SLA carries symptom_triage for urgent and review'',\n' ||
    E'        (select count(distinct e ->> ''tier'') from public.escalation_slas s, jsonb_array_elements(s.config) e\n' ||
    E'          where s.is_active and e ->> ''pathway'' = ''symptom_triage'' and e ->> ''tier'' in (''urgent_escalation'', ''clinician_review'')) = 2,\n' ||
    E'        ''data'', null));\n' ||
    E'  end if;\n  -- An unknown key has no conditions');
  if v_new = v_def then
    raise exception 'F1: go_live_conditions marker not found (definition drifted)';
  end if;
  execute v_new;

  v_def := pg_get_functiondef('public.attest_go_live_condition(text, text, boolean, text)'::regprocedure);
  v_new := replace(v_def,
    '(''public_signup_enabled'', ''stage2_exit_criteria_met'')) then',
    '(''public_signup_enabled'', ''stage2_exit_criteria_met''),' || E'\n' ||
    '       (''symptom_checker_enabled'', ''nafdac_position_recorded''), (''symptom_checker_enabled'', ''engine_licence_or_validation_recorded''),' || E'\n' ||
    '       (''symptom_checker_enabled'', ''localisation_signoff_recorded''), (''symptom_checker_enabled'', ''accuracy_baseline_recorded'')) then');
  if v_new = v_def then
    raise exception 'F1: attest_go_live_condition marker not found (definition drifted)';
  end if;
  execute v_new;
end $$;

-- 3. The database refusal (fires before the escalate trigger so nothing is raised for a refused row)
create or replace function private.symptom_triage_assessments_go_live_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.go_live_open_patient('symptom_checker_enabled', new.patient_id) then
    raise exception 'The symptom checker is not open yet' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.symptom_triage_assessments_go_live_guard() from public;

drop trigger if exists symptom_triage_assessments_00_go_live_guard on public.symptom_triage_assessments;
create trigger symptom_triage_assessments_00_go_live_guard
  before insert on public.symptom_triage_assessments
  for each row execute function private.symptom_triage_assessments_go_live_guard();

-- 4. The DRAFT escalation SLA (never signed, never active)
insert into public.escalation_slas (version, config, notes, is_active)
select
  top.version + 1,
  top.config || jsonb_build_array(
    jsonb_build_object(
      'tier', 'urgent_escalation', 'pathway', 'symptom_triage', 'sla_minutes', 60,
      'source_function', 'private.handle_symptom_triage_assessment',
      'channel_sequence', jsonb_build_array('push', 'email'),
      'note', 'Symptom checker classified the assessment as urgent. PROPOSED 60 minutes, carried from draft v6; the founder or CMO must confirm.'),
    jsonb_build_object(
      'tier', 'clinician_review', 'pathway', 'symptom_triage', 'sla_minutes', 1440,
      'source_function', 'private.handle_symptom_triage_assessment',
      'channel_sequence', jsonb_build_array('push, batched'),
      'note', 'Symptom checker could not classify confidently as routine or self-care and asked for human review. PROPOSED 24 hours, carried from draft v6; the founder or CMO must confirm.')),
  'DRAFT, UNSIGNED (F1, 2026-10-07). Copies the highest existing version and adds the symptom_triage pathway (urgent_escalation, clinician_review) that the active config lacks, so urgent symptom checker assessments cannot be recorded until this is signed. Needs the founder or the Chief Medical Officer to read it, confirm the two proposed minutes, and sign with sign_escalation_slas(). Signing replaces the whole active config, including anything the previous draft carried (for example pulse_vitals_red_flag).',
  false
from (select version, config from public.escalation_slas order by version desc limit 1) top
where not exists (
  select 1 from public.escalation_slas s2
   where s2.version = top.version
     and exists (select 1 from jsonb_array_elements(s2.config) e where e ->> 'pathway' = 'symptom_triage' and e ->> 'tier' = 'urgent_escalation')
     and exists (select 1 from jsonb_array_elements(s2.config) e where e ->> 'pathway' = 'symptom_triage' and e ->> 'tier' = 'clinician_review')
);

-- 5. Self-checks
do $$
begin
  if not exists (select 1 from public.go_live_guards where key = 'symptom_checker_enabled' and not is_on) then
    raise exception 'FAIL: symptom_checker_enabled missing or on';
  end if;
  if private.go_live_open('symptom_checker_enabled') then raise exception 'FAIL: the guard reads open'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.symptom_triage_assessments'::regclass and tgname = 'symptom_triage_assessments_00_go_live_guard') then
    raise exception 'FAIL: the assessment trigger is missing';
  end if;
  -- the draft must be unsigned and inactive
  if exists (select 1 from public.escalation_slas s
              where s.notes like 'DRAFT, UNSIGNED (F1%' and (s.is_active or s.approved_at is not null or s.approved_by is not null)) then
    raise exception 'FAIL: the F1 draft SLA is signed or active';
  end if;
  if jsonb_array_length(private.go_live_conditions('symptom_checker_enabled', null)) <> 6 then
    raise exception 'FAIL: expected six symptom_checker_enabled conditions';
  end if;
end $$;
