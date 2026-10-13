-- S67, migration 4 of 4: bp_care_triage v4 (DRAFT), the server reads the three new symptom values, and the `maternal_enabled` go-live guard.
--
-- NOTHING IS SIGNED OR SWITCHED ON. The rule set row is a draft (the CMO approves it with approve_triage_rule_set, which an agent never
-- does); the guard is created OFF and no sign-off, attestation or log row is written. `go_live_guard_log`, `go_live_attestations` and
-- `triage_rule_sets.approved_*` stay exactly as they were.
--
-- 1. (Moved.) The pregnancy rule set is now version 5 and lives in 20261013190000_s67_bp_rule_set_v5_pregnancy.sql, because version 4 is S07x's
--    decision C5 and the two must not share a version number.
-- 2. `public.triage_context_for_observation` is patched IN PLACE (its live body is read with pg_get_functiondef and one list is widened),
--    so this does not restate a function that other sessions may have changed since. The patch asserts it found its anchor.
-- 3. `private.go_live_conditions` gets one new branch the same way. Conditions for `maternal_enabled`: an approved obstetric protocol
--    (data), an approved bp_care_triage carrying rule BP-P6 (data), the NAFDAC and MDCN replies recorded (attestation, decision B2)
--    and the CMO pressing the switch.
begin;

-- (The bp_care_triage rule-set row moved to 20261013190000_s67_bp_rule_set_v5_pregnancy.sql: main-dev's S07x already owns version 4, decision C5.)

do $patch$
declare
  v_def text;
begin
  select pg_get_functiondef('public.triage_context_for_observation(uuid, text, integer)'::regprocedure) into v_def;
  if v_def is null then raise exception 'S67: triage_context_for_observation(uuid,text,integer) not found'; end if;
  if v_def like '%''convulsion''%' then
    return; -- already patched
  end if;
  if position($a$'dizziness', 'palpitations')$a$ in v_def) = 0 then raise exception 'S67: symptom list anchor not found in triage_context_for_observation'; end if;
  v_def := replace(v_def, $a$'dizziness', 'palpitations')$a$,
                          $a$'dizziness', 'palpitations', 'convulsion', 'loss_of_consciousness', 'sudden_face_hand_swelling')$a$);
  execute v_def;
end $patch$;

do $patch$
declare
  v_def text;
begin
  select pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure) into v_def;
  if v_def is null then raise exception 'S67: go_live_conditions(text,uuid) not found'; end if;
  if v_def like '%maternal_enabled%' then
    return;
  end if;
  if position($a$  -- An unknown key has no conditions$a$ in v_def) = 0 then raise exception 'S67: go_live_conditions anchor not found'; end if;
  v_def := replace(v_def, $a$  end if;
  -- An unknown key has no conditions$a$, $a$  elsif p_key = 'maternal_enabled' then
    return jsonb_build_array(
      private.go_live_cond('obstetric_protocol_signed', 'An approved obstetric protocol, signed by the Chief Medical Officer',
        exists (select 1 from public.protocols where status = 'approved' and code ~ '^(obstetric|maternal|pregnan|antenatal)'), 'data',
        (select count(*) from public.protocols where status = 'approved' and code ~ '^(obstetric|maternal|pregnan|antenatal)') || ' approved'),
      private.go_live_cond('pregnancy_rule_set_approved', 'An approved blood pressure triage rule set that carries the pregnancy rules (BP-P6)',
        exists (select 1 from public.triage_rule_sets where status = 'approved' and code = 'bp_care_triage' and rules -> 'rules' @> '[{"id":"BP-P6"}]'::jsonb), 'data', null),
      private.go_live_cond('regulator_queries_answered', 'The NAFDAC and MDCN written queries are sent and the replies recorded', private.go_live_attested(p_key, 'regulator_queries_answered'), 'attestation', null),
      private.go_live_cond('cmo_confirmation', 'Chief Medical Officer confirmation', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  end if;
  -- An unknown key has no conditions$a$);
  execute v_def;
end $patch$;

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in)
values ('maternal_enabled', 'Pregnancy care (module 16)',
        'Week-by-week content, antenatal schedule, baby movement counter, contraction timer and birth plan for patients',
        'An approved obstetric protocol, an approved blood pressure rule set carrying the pregnancy rules, the regulator replies recorded, and the Chief Medical Officer pressing the switch.',
        'cmo', '{}',
        'Not enforced anywhere yet: S67 ships the guard and its conditions only. The screens are built behind it in a later pass, so switching it on or off changes nothing today.')
on conflict (key) do nothing;

do $$
declare v_on boolean; v_conds jsonb;
begin
  select is_on into v_on from public.go_live_guards where key = 'maternal_enabled';
  if v_on is distinct from false then raise exception 'S67 self-check: maternal_enabled must exist and be OFF'; end if;
  if exists (select 1 from public.go_live_guard_log where guard_key = 'maternal_enabled') or exists (select 1 from public.go_live_attestations where guard_key = 'maternal_enabled') then
    raise exception 'S67 self-check: no log or attestation row may exist for maternal_enabled';
  end if;
  v_conds := private.go_live_conditions('maternal_enabled', null);
  if jsonb_array_length(v_conds) <> 4 or exists (select 1 from jsonb_array_elements(v_conds) c where c ->> 'code' = 'unknown_guard') then
    raise exception 'S67 self-check: maternal_enabled has no conditions';
  end if;
  if exists (select 1 from jsonb_array_elements(v_conds) c where c ->> 'code' in ('obstetric_protocol_signed', 'pregnancy_rule_set_approved', 'regulator_queries_answered') and (c ->> 'met')::boolean) then
    raise exception 'S67 self-check: a maternal_enabled condition is already met; nothing was signed by this migration';
  end if;
  if pg_get_functiondef('public.triage_context_for_observation(uuid, text, integer)'::regprocedure) not like '%''convulsion''%' then
    raise exception 'S67 self-check: the triage context does not read the new symptoms';
  end if;
end $$;

commit;
