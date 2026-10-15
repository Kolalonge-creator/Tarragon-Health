-- S16-S20 W6.3 proof (migration *_s16_s20_care_funnel_metrics.sql): public.care_funnel_metrics(p_days).
--
-- Proves, in one rolled-back transaction (every count is checked as a change from a baseline taken first, so seed data does not matter):
--   1. The Chief Medical Officer can read it; a plain clinician and a patient cannot (42501); anon and public have no EXECUTE.
--   2. Counts: alerts (suppressed ones and test patients not counted), root pages (a merged child page, a test page not counted),
--      completed tasks, emergencies, all inside the window only (a row 40 days old is outside a 30 day window, inside 60).
--   3. Ratios are per alert, computed from the same totals, and are null when there are no alerts.
--   4. Continuity: of completed tasks with a lead, the share the lead handled; each fallback is named (lead handed it back,
--      lead's claim ran out, escalated, offer not taken); a task with no lead is counted apart and is never a fallback.
--   5. No names, ids, emails or phone numbers appear anywhere in the result.
--   6. SABOTAGE: the staff gate is replaced by "true"; the plain clinician is then let in, so check 1 must flip.
-- Fixtures are written as the table owner with the replica session role so foreign keys and transition triggers do not matter; the
-- function is called through the real authenticated role path.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- the funnel as a user: the json, or {"error": "<message>"}
create function pg_temp.funnel_as(p_uid uuid, p_days integer default 30) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.care_funnel_metrics(p_days); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'fn-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'FN ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician', true);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'FN ' || p_label, 'MDCN', 'FN-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true);
  return v;
end $f$;
-- a completed task (not a test row) completed p_age_days ago
create function pg_temp.done_task(p_org uuid, p_patient uuid, p_lead uuid, p_claimer uuid, p_age_days integer default 1) returns uuid
language plpgsql as $f$
declare t uuid := gen_random_uuid();
begin
  insert into public.clinical_tasks (id, organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier,
                                     due_at, lead_clinician_id, state, claimed_by, completed_at, outcome, is_test, created_at)
  values (t, p_org, 'amber_bp_review', 1, 5, 5, p_patient, 'senior_medical_officer', now(), p_lead, 'completed', p_claimer,
          now() - make_interval(days => p_age_days), '{"code":"completed_action_taken"}'::jsonb, false, now() - make_interval(days => p_age_days + 1));
  return t;
end $f$;
create function pg_temp.n(p jsonb, p_path text[]) returns numeric language sql as
$$ select coalesce((p #>> p_path)::numeric, 0) $$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_lead uuid; v_other uuid; v_pat uuid; v_pat_test uuid; v_pat2 uuid;
  b jsonb; b60 jsonb; r jsonb; r1 jsonb; t uuid; v_root uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin);
  v_doc := pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin);
  v_lead := pg_temp.mkdoc(v_org, 'lead', 'senior_medical_officer', v_admin);
  v_other := pg_temp.mkdoc(v_org, 'other', 'senior_medical_officer', v_admin);
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', false);
  v_pat_test := pg_temp.mkuser(v_org, 'pat-test', 'patient', true);
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient', false);

  -- 1. who may read
  b := pg_temp.funnel_as(v_cmo);
  b60 := pg_temp.funnel_as(v_cmo, 60);
  perform pg_temp.rec('the Chief Medical Officer can read the funnel', 'true', (b ? 'alerts')::text);
  perform pg_temp.rec('a plain clinician is refused', 'not authorised', coalesce(pg_temp.funnel_as(v_doc) ->> 'error', 'let in'));
  perform pg_temp.rec('a patient is refused', 'not authorised', coalesce(pg_temp.funnel_as(v_pat) ->> 'error', 'let in'));
  perform pg_temp.rec('anon has no EXECUTE', 'false', has_function_privilege('anon', 'public.care_funnel_metrics(integer)', 'execute')::text);
  perform pg_temp.rec('public has no EXECUTE', '0',
    (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = 'public.care_funnel_metrics(integer)'::regprocedure and a.grantee = 0));

  -- fixtures, as the owner, skipping foreign keys and transition triggers
  set local session_replication_role = replica;
  -- alerts: 2 counted, 1 suppressed, 1 for a test patient, 1 older than the window
  insert into public.clinician_alerts (organisation_id, patient_id, title, category, type_code, suppressed, created_at)
  select v_org, p, 'FN alert', (enum_range(null::public.alert_category))[1], (enum_range(null::public.alert_type_code))[1], s, now() - make_interval(days => d)
  from (values (v_pat, false, 2), (v_pat, false, 3), (v_pat, true, 2), (v_pat_test, false, 2), (v_pat, false, 40)) x(p, s, d);
  -- pages: 1 root counted, 1 test, 1 old, 1 merged child (has a parent)
  insert into public.pages (id, organisation_id, patient_id, triage_event_id, role, to_clinician_id, escalation_level, config_version, is_test, created_at)
  values (v_root, v_org, v_pat, gen_random_uuid(), (enum_range(null::public.page_role))[1], v_doc, 1, 1, false, now() - interval '2 days'),
         (gen_random_uuid(), v_org, v_pat, gen_random_uuid(), (enum_range(null::public.page_role))[1], v_doc, 1, 1, true, now() - interval '2 days'),
         (gen_random_uuid(), v_org, v_pat, gen_random_uuid(), (enum_range(null::public.page_role))[1], v_doc, 1, 1, false, now() - interval '40 days');
  insert into public.pages (organisation_id, patient_id, triage_event_id, parent_page_id, role, to_clinician_id, escalation_level, config_version, is_test, created_at)
  values (v_org, v_pat, gen_random_uuid(), v_root, (enum_range(null::public.page_role))[1], v_doc, 2, 1, false, now() - interval '2 days');
  -- emergencies: 1 counted, 1 test patient, 1 old
  insert into public.emergency_events (organisation_id, patient_id, source, created_at)
  select v_org, p, (enum_range(null::public.emergency_source))[1], now() - make_interval(days => d) from (values (v_pat, 2), (v_pat_test, 2), (v_pat, 40)) x(p, d);
  -- completed tasks: 1 by lead, 1 lead handed back, 1 lead claim expired, 1 escalated, 1 offer not taken, 1 no lead, 1 outside the window
  t := pg_temp.done_task(v_org, v_pat2, v_lead, v_lead);
  t := pg_temp.done_task(v_org, v_pat2, v_lead, v_other);
  insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, ended_at, end_reason, is_test) values (v_org, t, v_lead, now(), now(), 'handed_back', false);
  t := pg_temp.done_task(v_org, v_pat2, v_lead, v_other);
  insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, ended_at, end_reason, is_test) values (v_org, t, v_lead, now(), now(), 'expired', false);
  t := pg_temp.done_task(v_org, v_pat2, v_lead, v_other);
  insert into public.clinical_task_transitions (organisation_id, task_id, from_state, to_state, actor_kind, is_test) values (v_org, t, 'open', 'escalated', 'system', false);
  t := pg_temp.done_task(v_org, v_pat2, v_lead, v_other);
  t := pg_temp.done_task(v_org, v_pat2, null, v_other);
  t := pg_temp.done_task(v_org, v_pat2, v_lead, v_lead, 40);
  set local session_replication_role = origin;

  r := pg_temp.funnel_as(v_cmo);
  -- 2. counts
  perform pg_temp.rec('alerts: suppressed, test patient and old ones are not counted', '2', (pg_temp.n(r, '{alerts}') - pg_temp.n(b, '{alerts}'))::text);
  perform pg_temp.rec('pages: only root, real, in-window pages', '1', (pg_temp.n(r, '{pages}') - pg_temp.n(b, '{pages}'))::text);
  perform pg_temp.rec('doctor reviews: completed tasks in the window', '6', (pg_temp.n(r, '{doctor_reviews}') - pg_temp.n(b, '{doctor_reviews}'))::text);
  perform pg_temp.rec('emergencies: real patient, in the window', '1', (pg_temp.n(r, '{emergencies}') - pg_temp.n(b, '{emergencies}'))::text);
  perform pg_temp.rec('a wider window sees the old alert', '3', (pg_temp.n(pg_temp.funnel_as(v_cmo, 60), '{alerts}') - pg_temp.n(b60, '{alerts}'))::text);
  perform pg_temp.rec('the window is clamped to 90 days', '90', (pg_temp.funnel_as(v_cmo, 5000) ->> 'days'));
  -- 3. ratios, from the same totals
  perform pg_temp.rec('pages per alert', round(pg_temp.n(r, '{pages}') / pg_temp.n(r, '{alerts}'), 3)::text, (r -> 'ratios' ->> 'pages_per_alert'));
  perform pg_temp.rec('reviews per alert', round(pg_temp.n(r, '{doctor_reviews}') / pg_temp.n(r, '{alerts}'), 3)::text, (r -> 'ratios' ->> 'reviews_per_alert'));
  perform pg_temp.rec('emergencies per alert', round(pg_temp.n(r, '{emergencies}') / pg_temp.n(r, '{alerts}'), 3)::text, (r -> 'ratios' ->> 'emergencies_per_alert'));
  -- 4. continuity
  perform pg_temp.rec('completed with a lead (not the no-lead task, not the out-of-window one)', '5',
    (pg_temp.n(r, '{continuity,completed_with_lead}') - pg_temp.n(b, '{continuity,completed_with_lead}'))::text);
  perform pg_temp.rec('handled by the lead', '1', (pg_temp.n(r, '{continuity,handled_by_lead}') - pg_temp.n(b, '{continuity,handled_by_lead}'))::text);
  perform pg_temp.rec('continuity share', round(pg_temp.n(r, '{continuity,handled_by_lead}') / pg_temp.n(r, '{continuity,completed_with_lead}'), 3)::text, (r -> 'continuity' ->> 'share'));
  perform pg_temp.rec('a task with no lead is counted apart', '1', (pg_temp.n(r, '{continuity,completed_without_lead}') - pg_temp.n(b, '{continuity,completed_without_lead}'))::text);
  perform pg_temp.rec('fallback: lead handed it back', '1', (pg_temp.n(r, '{continuity,fallback_reasons,lead_handed_back}') - pg_temp.n(b, '{continuity,fallback_reasons,lead_handed_back}'))::text);
  perform pg_temp.rec('fallback: lead claim ran out', '1', (pg_temp.n(r, '{continuity,fallback_reasons,lead_claim_expired}') - pg_temp.n(b, '{continuity,fallback_reasons,lead_claim_expired}'))::text);
  perform pg_temp.rec('fallback: escalated', '1', (pg_temp.n(r, '{continuity,fallback_reasons,escalated}') - pg_temp.n(b, '{continuity,fallback_reasons,escalated}'))::text);
  perform pg_temp.rec('fallback: offer not taken', '1', (pg_temp.n(r, '{continuity,fallback_reasons,offer_not_taken}') - pg_temp.n(b, '{continuity,fallback_reasons,offer_not_taken}'))::text);
  perform pg_temp.rec('no-lead is never listed as a fallback', 'false', ((r -> 'continuity' -> 'fallback_reasons') ? 'no_lead')::text);
  -- 5. no names or ids anywhere in the result
  perform pg_temp.rec('the result carries no id, email, phone or name', '0',
    (select count(*)::text from jsonb_path_query(r, 'strict $.**') v
      where jsonb_typeof(v) = 'string' and (v #>> '{}') ~* '([0-9a-f]{8}-[0-9a-f]{4}-|@|\+234|FN )'));
  -- 3b. ratios are null when there are no alerts (a one day window has none in a quiet database; otherwise the check is vacuous and says so)
  r1 := pg_temp.funnel_as(v_cmo, 1);
  perform pg_temp.rec('ratios are null when there are no alerts in the window', case when pg_temp.n(r1, '{alerts}') = 0 then 'null' else 'n/a' end,
    case when pg_temp.n(r1, '{alerts}') = 0 then coalesce(r1 -> 'ratios' ->> 'pages_per_alert', 'null') else 'n/a' end);

  -- 6. SABOTAGE: the staff gate wide open
  create or replace function private.task_staff_reader() returns boolean language sql stable security definer set search_path = '' as $g$ select true $g$;
  insert into results values ('sabotaged', 'a plain clinician is refused', 'not authorised', coalesce(pg_temp.funnel_as(v_doc) ->> 'error', 'let in'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'care funnel proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then
    raise exception 'VACUOUS TEST: opening the staff gate did not change the care funnel check';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
