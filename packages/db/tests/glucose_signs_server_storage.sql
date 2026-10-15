-- Proof: the nine glucose warning signs the phone ticks are stored in the server symptom log and reach the glucose engine's context in the right group
-- (migrations *_glucose_signs_symptom_type_{vomiting,abdominal_pain,cannot_swallow}.sql and *_glucose_signs_context_mapping.sql).
--
--   1. The five symptom_type values the mapping needs exist (the three new ones plus convulsion and loss_of_consciousness from the pregnancy work).
--   2. For EACH of the nine signs: a glucose reading plus that sign stored as its symptom_type puts exactly the engine's code in
--      triage_context_for_glucose_observation, and the symptom emits a regrade event for its reading (the sign can arrive after the reading).
--   3. Which group each previously unmapped sign lands in, and the rule it fires (the rule ids come from the engine, pinned by
--      packages/clinical/src/glucose-signs-grading.test.ts, which grades this exact context; the processor's call is emulated here with that rule id,
--      recorded in shadow against the DRAFT rule set, as p1_chain_canary.sql does): GL-R3 for cannot_swallow, convulsion, loss_of_consciousness;
--      GL-R2 for cannot_swallow with a low glucose; GL-R5 for vomiting or stomach pain with raised ketones; GL-R7 for vomiting with glucose 20 or more.
--   4. NO new paging from the older symptom trigger (private.handle_symptom_red_flag is not touched): a tick stored the way the phone stores it
--      (severity 4) is not a red flag and opens no clinician alert or emergency event; the control row at severity 8 shows the trigger still reads severity.
--   5. Idempotent by client id: the same sign sent twice is one row.
--   6. SABOTAGE: with vomiting removed from the context mapping, and with it removed from the regrade list, the matching checks must flip.
--
-- Run it AFTER the migrations are applied. An enum value cannot be used in the transaction that adds it, so on a database where the three values
-- are not live yet (the live project before this branch is merged), the first block swaps the enum type for one that has them, inside this
-- transaction only (it drops and recreates the one dependent view, symptom_reports); on a replayed database the values exist and the block does nothing.
begin;

do $$
declare
  v_labels text;
  v_def text;
  v_opts text[];
begin
  if exists (select 1 from pg_enum where enumtypid = 'public.symptom_type'::regtype and enumlabel = 'vomiting') then
    return;
  end if;
  select pg_get_viewdef('public.symptom_reports'::regclass), (select reloptions from pg_class where oid = 'public.symptom_reports'::regclass)
    into v_def, v_opts;
  drop view public.symptom_reports;
  alter type public.symptom_type rename to symptom_type_before_signs;
  select string_agg(quote_literal(l), ', ') into v_labels
    from (select enumlabel::text as l from pg_enum where enumtypid = 'public.symptom_type_before_signs'::regtype order by enumsortorder) x;
  execute format('create type public.symptom_type as enum (%s, ''vomiting'', ''abdominal_pain'', ''cannot_swallow'')', v_labels);
  alter table public.symptoms alter column symptom_type type public.symptom_type using symptom_type::text::public.symptom_type;
  execute format('create view public.symptom_reports %s as %s',
    case when v_opts is not null then 'with (' || array_to_string(v_opts, ', ') || ')' else '' end, v_def);
end $$;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'gs-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'GS ' || p_label, (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;

create or replace function pg_temp.res(p_phase text, p_check text, p_expected text, p_actual text) returns void
language sql as $f$ insert into results values (p_phase, p_check, p_expected, p_actual) $f$;

-- one patient, one glucose reading, one ticked sign stored as `p_type`; returns the context's symptom codes and whether a regrade event was emitted
create or replace function pg_temp.tick(p_org uuid, p_label text, p_type text, p_mmol numeric, p_ketone numeric default null,
                                        out ctx_symptoms text, out regrade integer, out reading uuid, out patient uuid, out ctx jsonb)
language plpgsql as $f$
declare v_sym uuid;
begin
  patient := pg_temp.mkuser(p_org, p_label, 'patient');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, ketones_mmol_l, source, taken_at)
    values (p_org, patient, 'glucose', p_mmol, 'random', p_ketone, 'manual', now()) returning id into reading;
  execute format('insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values (%L, %L, %L::public.symptom_type, 4, %L) returning id',
    p_org, patient, p_type, 'Ticked on the glucose form (not rated by the patient).') into v_sym;
  ctx := public.triage_context_for_glucose_observation(reading);
  ctx_symptoms := (select coalesce(string_agg(x, ',' order by x), '') from jsonb_array_elements_text(ctx #> '{input,trigger,symptoms}') x);
  regrade := (select count(*)::integer from public.domain_events where idempotency_key = 'glu:' || reading || ':sym:' || v_sym);
end $f$;

do $$
declare
  v_org uuid; v_rs uuid; v_t record; v_r record; v_n integer; v_res jsonb; v_pat uuid; v_cid uuid := gen_random_uuid(); v_err text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_rs from public.triage_rule_sets where code = 'glucose_care_triage' and version = 1;
  -- The rule set under test is the DRAFT the r2 migration seeds (never approved on a fresh database, and this proof never approves it).
  if v_rs is null then raise exception 'glucose_care_triage v1 is missing: apply the r2 migrations first'; end if;

  -- 1. The values exist
  perform pg_temp.res('real', 'the five symptom_type values the mapping needs exist', '5',
    (select count(*)::text from pg_enum where enumtypid = 'public.symptom_type'::regtype
       and enumlabel in ('vomiting', 'abdominal_pain', 'cannot_swallow', 'convulsion', 'loss_of_consciousness')));

  -- 2. Each of the nine signs: stored type -> engine code, plus the regrade event
  for v_t in
    select * from (values
      ('confusion', 'confusion'), ('convulsion', 'seizure'), ('loss_of_consciousness', 'unconscious'),
      ('cannot_swallow', 'cannot_swallow'), ('vomiting', 'vomiting'), ('abdominal_pain', 'abdominal_pain'),
      ('breathlessness', 'fast_breathing'), ('lethargy', 'drowsiness'), ('dehydration_signs', 'very_thirsty_cannot_keep_fluids')
    ) as m(stored, code)
  loop
    select * into v_r from pg_temp.tick(v_org, 'sign-' || v_t.stored, v_t.stored, 6.0);
    perform pg_temp.res('real', 'sign ' || v_t.code || ' (stored as ' || v_t.stored || ') reaches the context as that code only', v_t.code, v_r.ctx_symptoms);
    perform pg_temp.res('real', 'sign ' || v_t.code || ' emits a regrade event for its reading', '1', v_r.regrade::text);
  end loop;

  -- a symptom the glucose rules do not read still maps to nothing and emits nothing
  select * into v_r from pg_temp.tick(v_org, 'nausea', 'nausea', 6.0);
  perform pg_temp.res('real', 'an unrelated symptom (nausea) maps to no sign and regrades nothing', '|0', v_r.ctx_symptoms || '|' || v_r.regrade);

  -- 3. Group and rule, recorded in shadow against the draft rule set (the engine's own answer is pinned in Jest)
  for v_t in
    select * from (values
      ('cannot_swallow', 6.0, null::numeric, 'GL-R3', 'GLU-E02'),
      ('convulsion', 6.0, null, 'GL-R3', 'GLU-E02'),
      ('loss_of_consciousness', 6.0, null, 'GL-R3', 'GLU-E02'),
      ('cannot_swallow', 3.5, null, 'GL-R2', 'GLU-E01'),
      ('vomiting', 6.0, 2.0, 'GL-R5', 'GLU-E02'),
      ('abdominal_pain', 6.0, 2.0, 'GL-R5', 'GLU-E02'),
      ('vomiting', 21.0, null, 'GL-R7', 'GLU-E02')
    ) as c(stored, mmol, ketone, rule_id, key)
  loop
    select * into v_r from pg_temp.tick(v_org, 'g-' || v_t.stored || v_t.mmol, v_t.stored, v_t.mmol, v_t.ketone);
    v_res := jsonb_build_object('status', 'graded', 'grade', 'red', 'ruleId', v_t.rule_id, 'explanationKey', v_t.key,
      'actions', jsonb_build_array(jsonb_build_object('kind', 'show_emergency_guidance', 'code', v_t.key), jsonb_build_object('kind', 'page_on_call')),
      'matchedRuleIds', jsonb_build_array(v_t.rule_id), 'taskKey', null, 'ruleSet', jsonb_build_object('code', 'glucose_care_triage', 'version', 1));
    perform public.record_glucose_triage_result(v_r.reading, v_res, v_rs);
    perform pg_temp.res('real', v_t.stored || ' at ' || v_t.mmol || coalesce(' with ketones ' || v_t.ketone, '') || ' is graded ' || v_t.rule_id || ' in shadow', v_t.rule_id || '|true|draft',
      (select rule_id || '|' || shadow::text || '|' || rule_set_status from public.triage_events where trigger_id = v_r.reading order by created_at desc limit 1));
  end loop;

  -- 4. No new paging through the older symptom trigger
  v_pat := pg_temp.mkuser(v_org, 'paging', 'patient');
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description)
    select v_org, v_pat, s::public.symptom_type, 4, 'Ticked on the glucose form (not rated by the patient).'
    from unnest(array['vomiting', 'abdominal_pain', 'cannot_swallow', 'convulsion', 'loss_of_consciousness', 'confusion', 'breathlessness', 'lethargy', 'dehydration_signs']) s;
  perform pg_temp.res('real', 'nine ticks at severity 4 are not red flags', '0', (select count(*)::text from public.symptoms where patient_id = v_pat and is_red_flag));
  perform pg_temp.res('real', 'and open no clinician alert and no emergency event', '0|0',
    (select count(*)::text from public.clinician_alerts where patient_id = v_pat) || '|' || (select count(*)::text from public.emergency_events where patient_id = v_pat));
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (v_org, v_pat, 'vomiting', 8);
  perform pg_temp.res('real', 'control: the older trigger still reads severity (a vomiting row at 8 is a red flag)', 'true',
    (select is_red_flag::text from public.symptoms where patient_id = v_pat and severity = 8));

  -- 5. Idempotent by client id
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, client_id) values (v_org, v_pat, 'cannot_swallow', 4, v_cid);
  begin
    insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, client_id) values (v_org, v_pat, 'cannot_swallow', 4, v_cid);
    v_err := 'second row stored';
  exception when unique_violation then v_err := 'duplicate refused'; end;
  perform pg_temp.res('real', 'the same sign sent twice with one client id is one row', 'duplicate refused|1', v_err || '|' ||
    (select count(*)::text from public.symptoms where patient_id = v_pat and client_id = v_cid));

  -- 6. SABOTAGE 1: vomiting removed from the context mapping, the context check must flip
  execute replace(pg_get_functiondef('public.triage_context_for_glucose_observation(uuid)'::regprocedure), $s$('vomiting', 'vomiting'), $s$, '');
  perform pg_temp.res('sabotaged', 'sign vomiting (stored as vomiting) reaches the context as that code only', 'vomiting',
    (select ctx_symptoms from pg_temp.tick(v_org, 'sab-ctx', 'vomiting', 6.0)));
  -- SABOTAGE 2: vomiting removed from the regrade list, the regrade check must flip
  execute replace(pg_get_functiondef('private.emit_glucose_symptom_regrade()'::regprocedure), $s$'vomiting', $s$, '');
  perform pg_temp.res('sabotaged', 'sign vomiting emits a regrade event for its reading', '1',
    (select regrade::text from pg_temp.tick(v_org, 'sab-rg', 'vomiting', 6.0)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'glucose signs proof FAILED: %', (select string_agg(check_name || ' => expected [' || expected || '] got [' || coalesce(actual, 'null') || ']', '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed a result', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results order by phase, check_name;
rollback;
