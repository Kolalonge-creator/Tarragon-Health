-- S20 v2 proof: audit review, sampling, config guard, speak-up v2, licences (migrations *_s20v2_*). Plan Stage 4, defects Q1 to Q7, decisions 5 to 8.
--
-- Proves in one rolled-back transaction:
--   1. Q4: quality_config v2 is inactive and unsigned; a version used by an audit or signed cannot be edited or deleted; the sampling
--      seed table is unreadable; only the chief medical officer signs; the governed-config activation guard refuses an older version.
--   2. Q1: the case file carries the clinical content (outcome note, messages in the work window, a matched scribe note) through an
--      audited read (audit_log with the patient as subject, an opens row) with the patient pseudonymised; a score cannot be submitted
--      before the reader opened the case; a critical miss needs a second, independent reviewer (not the first, not the clinician)
--      reading without the first reading; the clinician replies (append-only); the follow-up is append-only history, closed once.
--   3. Q3: the draw is a keyed (secret seed) value, not the public hash; the floor gives every clinician one audit and catches up
--      later in the month; AI-scribe notes are sampled and scored separately for omission and invented content.
--   4. Q7: hand-backs with the queue.claims exempt reasons are not counted; a review the trigger missed is opened by the sweep.
--   5. Q2: no admin reader (RPC, trigger, role change, reader check); an external independent reader; concerns by or about the lead go
--      to the independent reader only; anonymous intake stores no raiser id; check-ins at 30 and 90 days; a retaliation review follows
--      the route; the board report is counts only; leaks (views, export functions, events, logs, notices, incidents).
--   6. Q6: notices at 90/30/7/0, the proof deadline, missing dates ineligible (and never strand anyone), shifts after expiry
--      refused/cancelled, rota-only clinicians inside the nightly net, grace CMO only, evidence of each verification.
--   7. SABOTAGE: six guards removed in turn; each dependent check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- S20 v2: submit_clinical_audit refuses until this reviewer opened the case file, so the v1 checks open it first (errors ignored: a check that
-- expects a refusal before the open gate still gets that refusal). The v2 proof (s20_quality_v2.sql) tests the gate itself.
create function pg_temp.pre_open(p_sql text) returns void language sql as $f$ select 1 $f$;
-- run a statement as a user; returns 'ok' or the error message (the message is the stable queue_* code)
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  perform pg_temp.pre_open(p_sql);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a scalar query as a user; returns the value as text, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  perform pg_temp.pre_open(p_sql);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the same as anon
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.next_as(p_uid uuid) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.queue_next(); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.next_task(p_uid uuid) returns uuid language sql as
$$ select (pg_temp.next_as(p_uid) -> 'task' ->> 'id')::uuid $$;
-- 'claimed', the error code, or the reason no task was given
create function pg_temp.next_outcome(p_uid uuid) returns text language sql as
$$ select coalesce(r ->> 'error', case when jsonb_typeof(r -> 'task') = 'object' then 'claimed' else r ->> 'reason' end)
     from (select pg_temp.next_as(p_uid) as r) x $$;
create function pg_temp.backdate(p_task uuid, p_set text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.task_transition', 'on', true);
  execute format('update public.clinical_tasks set %s where id = %L', p_set, p_task);
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's20-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S20 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid, p_test boolean default true, p_level integer default null) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S20 ' || p_label, 'MDCN', 'S17-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      coalesce(p_level, case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end),
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, p_test)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;
create function pg_temp.mkblock(p_org uuid, p_uid uuid) returns void language sql as
$$ insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
   values (p_org, p_uid, now() - interval '1 minute', now() + interval '2 hours', 'queue', true) $$;
create function pg_temp.mktask(p_patient uuid, p_type text, p_due integer default null) returns uuid language sql as
$$ select private.create_clinical_task(p_patient, p_type, p_due) $$;
-- fixture cleanup without deleting (the logs are append only): end any live claim and cancel what is left
create function pg_temp.clear_queue() returns void language plpgsql as
$f$ declare r record;
begin
  for r in select id from public.clinical_tasks where state not in ('completed', 'cancelled') loop
    update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = r.id and ended_at is null;
    perform private.apply_task_transition(r.id, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');
  end loop;
end $f$;
create function pg_temp.state_of(p_task uuid) returns text language sql as $$ select state::text from public.clinical_tasks where id = p_task $$;
create function pg_temp.score_of(p_uid uuid) returns text language sql as $$ select reliability_score::text from public.clinical_staff where profile_id = p_uid $$;


-- S20 helpers ------------------------------------------------------------------------------------------------------
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language plpgsql as
$f$ begin
  insert into results values ('real', p_name, p_expected, p_actual);
  if p_expected is distinct from p_actual then raise notice 'CHECK FAIL: % => expected [%] got [%]', p_name, p_expected, p_actual; end if;
end $f$;
create function pg_temp.staff_of(p_uid uuid) returns uuid language sql as $$ select id from public.clinical_staff where profile_id = p_uid $$;
-- run a statement as the owner; returns 'ok' or the SQLSTATE
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
-- the clinician claims exactly the task just created and completes it (so the real triggers run)
create function pg_temp.finish(p_uid uuid, p_type text) returns uuid language plpgsql as
$f$
declare v_t uuid; v_got uuid; v_r text;
begin
  perform pg_temp.clear_queue();
  v_t := pg_temp.mktask(pg_temp.f('pat'), p_type);
  v_got := pg_temp.next_task(p_uid);
  if v_got is distinct from v_t then raise exception 'finish: expected the new task, got % (%); task state=% class=% tier=% comps=% test=%', v_got, pg_temp.next_outcome(p_uid), (select state from public.clinical_tasks where id = v_t), (select priority_class from public.clinical_tasks where id = v_t), (select min_tier from public.clinical_tasks where id = v_t), (select required_competencies from public.clinical_tasks where id = v_t), (select is_test from public.clinical_tasks where id = v_t); end if;
  if p_type in ('symptom_review', 'async_question', 'critical_result_review', 'titration_signoff', 'red_event_unacknowledged') then
    -- D4 (S16-S20): these types close only against a system record (a signed note, a released result...), which this proof does not
    -- build; it tests the audit sampling that follows completion, so it closes through the internal transition the real flows also use
    perform private.apply_task_transition(v_t, 'completed', 'clinician', p_uid, null, null, null, '{"code":"closed_for_proof","note":"done"}'::jsonb);
    v_r := 'ok';
  else
    v_r := pg_temp.try_as(p_uid, format('select public.queue_complete(%L, %L::jsonb)', v_t, '{"code":"completed_action_taken","note":"done"}'));
  end if;
  if v_r <> 'ok' then raise exception 'finish: queue_complete failed: %', v_r; end if;
  return v_t;
end $f$;
create function pg_temp.audit_of(p_task uuid) returns uuid language sql as $$ select id from public.clinical_audits where task_id = p_task and state <> 'cancelled' $$;
-- change one config value inside this rolled-back transaction
-- tunes the active config between steps; the guard trigger is switched off for that one update only (the guard itself is tested without cfg)
create function pg_temp.cfg(p_path text[], p_value jsonb) returns void language plpgsql as
$f$ begin
  alter table public.quality_config disable trigger quality_config_guard;
  update public.quality_config set rules = jsonb_set(rules, p_path, p_value) where is_active;
  alter table public.quality_config enable trigger quality_config_guard;
end $f$;
create function pg_temp.live_blocks(p_uid uuid) returns text language sql as
$$ select count(*)::text from public.availability_blocks where clinician_id = p_uid and state <> 'cancelled' and ends_at > now() $$;


-- S20 v2 helpers -----------------------------------------------------------------------------------------------------
create function pg_temp.jv(p_text text, p_key text) returns text language sql as $$ select case when p_text like 'ERR:%' then p_text else (p_text::jsonb ->> p_key) end $$;
create function pg_temp.task_of(p_audit uuid) returns uuid language sql as $$ select task_id from public.clinical_audits where id = p_audit $$;
-- submit as a user; p_extra is the trailing arguments, e.g. ", '{...}'::jsonb, 'probably_avoidable'"
create function pg_temp.sub(p_uid uuid, p_audit uuid, p_safety jsonb, p_quality jsonb, p_rationale text, p_extra text default '') returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select public.submit_clinical_audit(%L, %L::jsonb, %L::jsonb, %L%s)', p_audit, p_safety, p_quality, p_rationale, p_extra)) $$;
create function pg_temp.sub2(p_uid uuid, p_audit uuid, p_safety jsonb, p_quality jsonb, p_rationale text, p_extra text default '') returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select public.submit_second_audit_review(%L, %L::jsonb, %L::jsonb, %L%s)', p_audit, p_safety, p_quality, p_rationale, p_extra)) $$;
create function pg_temp.opn(p_uid uuid, p_audit uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select public.audit_case_file(%L)', p_audit)) $$;

-- 0. Fixtures ------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_comps text := '{hypertension,adult_general,result_review,prescribing,on_call}';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('admin2', pg_temp.mkuser(v_org, 'admin2', 'admin'));
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', v_comps::text[], v_admin));
  perform pg_temp.setf('cmo2', pg_temp.mkdoc(v_org, 'cmo2', 'chief_medical_officer', 'contracted', '{}', v_admin));
  perform pg_temp.setf('fin', pg_temp.mkdoc(v_org, 'fin', 'senior_medical_officer', 'contracted', v_comps::text[], v_admin));
  perform pg_temp.setf('other', pg_temp.mkdoc(v_org, 'other', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_admin));
  perform pg_temp.setf('c1', pg_temp.mkdoc(v_org, 'c1', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_admin));
  perform pg_temp.setf('c2', pg_temp.mkdoc(v_org, 'c2', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_admin));
  perform pg_temp.setf('rdr', pg_temp.mkdoc(v_org, 'rdr', 'senior_medical_officer', 'contracted', '{}', v_admin));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  update public.profiles set date_of_birth = (current_date - interval '45 years')::date where id = pg_temp.f('pat');
  perform pg_temp.setf('indep', pg_temp.mkuser(v_org, 'indep', 'patient'));
  perform pg_temp.setf('indep2', pg_temp.mkuser(v_org, 'indep2', 'patient'));
  perform pg_temp.mkblock(v_org, pg_temp.f('cmo'));
  perform pg_temp.mkblock(v_org, pg_temp.f('fin'));
  perform pg_temp.mkblock(v_org, pg_temp.f('other'));
  perform pg_temp.mkblock(v_org, pg_temp.f('c1'));
  perform pg_temp.mkblock(v_org, pg_temp.f('c2'));
  perform pg_temp.cfg('{sampling,random_rate_percent}', '0'::jsonb);
end $$;

-- 1. Q4: the configuration guard ---------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_oth uuid := pg_temp.f('other'); v_t uuid; v_a uuid;
begin
  perform pg_temp.ck('quality_config v3 exists, inactive and unsigned', 'false/false/3', (select is_active || '/' || (approved_at is not null) || '/' || version from public.quality_config where version = 3));
  perform pg_temp.ck('v2 (main-dev) is the one active version', '2', (select version::text from public.quality_config where is_active));
  -- no audit uses v1 yet: a draft can still be edited (only drafts nobody used)
  perform pg_temp.ck('an unused, unsigned draft can still be edited', 'ok', pg_temp.try_sql($q$update public.quality_config set rules = jsonb_set(rules, '{sampling,due_days}', '14') where version = 3$q$));
  v_t := pg_temp.finish(pg_temp.f('fin'), 'red_event_unacknowledged');
  v_a := pg_temp.audit_of(v_t);
  perform pg_temp.setf('a_red', v_a);
  perform pg_temp.ck('a red event audit was created under v2', '2', (select config_version::text from public.clinical_audits where id = v_a));
  perform pg_temp.ck('v1 is now used by an audit: its rules cannot be edited', '23514', pg_temp.try_sql($q$update public.quality_config set rules = jsonb_set(rules, '{sampling,random_rate_percent}', '50') where version = 2$q$));
  perform pg_temp.ck('...nor its effective date', '23514', pg_temp.try_sql($q$update public.quality_config set effective_from = '2020-01-01' where version = 2$q$));
  perform pg_temp.ck('...nor can it be deleted', '23514', pg_temp.try_sql($q$delete from public.quality_config where version = 2$q$));
  perform pg_temp.ck('...but switching it on or off is not an edit of its rules', 'ok', pg_temp.try_sql($q$update public.quality_config set is_active = is_active where version = 2$q$));
  perform pg_temp.ck('only the chief medical officer can sign a version', 'ERR:only the chief medical officer can sign the quality configuration', pg_temp.q_as(v_oth, 'select public.sign_quality_config(3)'));
  perform pg_temp.ck('anon cannot sign', 'false', has_function_privilege('anon', 'public.sign_quality_config(integer)', 'EXECUTE')::text);
  perform pg_temp.ck('the sampling seed table is unreadable by signed-in users', 'true', (pg_temp.q_as(v_cmo, 'select count(*) from public.quality_sampling_seeds') like 'ERR:%')::text);
  perform pg_temp.ck('...and by anon', 'false', has_table_privilege('anon', 'public.quality_sampling_seeds', 'SELECT')::text);
end $$;

-- 2. Q1: the audit reads the case, through an audited read ------------------------------------------------------------
do $$
declare
  v_cmo uuid := pg_temp.f('cmo'); v_cmo2 uuid := pg_temp.f('cmo2'); v_fin uuid := pg_temp.f('fin'); v_oth uuid := pg_temp.f('other'); v_pat uuid := pg_temp.f('pat');
  v_a uuid := pg_temp.f('a_red'); v_t uuid; v_rev uuid; v_other_cmo uuid; v_res text; v_j jsonb; th uuid; v_msg text;
  v_safe jsonb := '{"identity_and_consent_confirmed":true,"red_flags_recognised_and_acted_on":true,"decision_within_competence_and_protocol":true,"no_unsigned_treatment_change":true,"safety_netting_and_follow_up_given":true,"escalated_when_needed":true}';
  v_q4 jsonb := '{"history_adequate":4,"reasoning_documented":4,"communication_clear":4,"plan_appropriate":4,"patient_questions_answered":4,"documentation_timely":4}';
begin
  select reviewer_id into v_rev from public.clinical_audits where id = v_a;
  v_other_cmo := case when v_rev = v_cmo then v_cmo2 else v_cmo end;
  -- a patient message inside the claim window
  insert into public.care_message_threads (organisation_id, patient_id, subject) values (pg_temp.f('org'), v_pat, 'proof thread') returning id into th;
  v_msg := pg_temp.try_as(v_pat, format('insert into public.care_messages (organisation_id, patient_id, thread_id, author_profile_id, author_role, body) values (%L, %L, %L, %L, %L, %L)', pg_temp.f('org'), v_pat, th, v_pat, 'patient', 'quartzmango my chest feels tight again'));
  perform pg_temp.ck('fixture: a patient message is written', 'ok', v_msg);
  -- the audited clinician answers in the same conversation (the case file shows only conversations the clinician took part in)
  alter table public.care_messages disable trigger user;
  insert into public.care_messages (organisation_id, patient_id, thread_id, author_profile_id, author_role, body)
    values (pg_temp.f('org'), v_pat, th, v_fin, (select e from unnest(enum_range(null::public.care_message_author)) e where e::text <> 'patient' limit 1), 'please recheck tomorrow and tell us how it is');
  alter table public.care_messages enable trigger user;
  -- a second conversation the clinician never wrote in must not appear
  insert into public.care_message_threads (organisation_id, patient_id, subject) values (pg_temp.f('org'), v_pat, 'unrelated thread') returning id into th;
  alter table public.care_messages disable trigger user;
  insert into public.care_messages (organisation_id, patient_id, thread_id, author_profile_id, author_role, body)
    values (pg_temp.f('org'), v_pat, th, v_pat, 'patient', 'zucchini unrelated question about something else');
  alter table public.care_messages enable trigger user;
  -- the gate: no submit before opening
  perform pg_temp.ck('Q1: a score cannot be submitted before the case file was opened', 'ERR:open the case file before you submit the audit', pg_temp.sub(v_rev, v_a, v_safe, v_q4, ''));
  perform pg_temp.ck('...and the other lead cannot open it either', 'ERR:this audit is assigned to another reviewer', pg_temp.opn(v_other_cmo, v_a));
  perform pg_temp.ck('...so opening by someone else does not unlock the reviewer''s submit', 'ERR:open the case file before you submit the audit', pg_temp.sub(v_rev, v_a, v_safe, v_q4, ''));
  v_res := pg_temp.opn(v_rev, v_a);
  v_j := v_res::jsonb;
  perform pg_temp.ck('Q1: the case file carries the clinician''s recorded note', 'done', v_j -> 'task' -> 'outcome' ->> 'note');
  perform pg_temp.ck('...the patient message in the work window', 'true', (v_j -> 'messages' @> '[{"from":"patient"}]' and v_j::text like '%quartzmango%')::text);
  perform pg_temp.ck('...an unrelated conversation is left out', 'true', (v_res not like '%zucchini%')::text);
  perform pg_temp.ck('...the patient is a pseudonymous reference and an age band', 'true', ((v_j -> 'patient' ->> 'ref') ~ '^P-[0-9A-F]{6}$' and (v_j -> 'patient' ->> 'age_band') ~ '^[0-9]+ to [0-9]+$')::text);
  perform pg_temp.ck('...and nowhere in it is the patient''s id, name or phone', '0',
    (select (position(v_pat::text in v_res) + position('S20 pat' in v_res) + position((select phone from public.profiles where id = v_pat) in v_res))::text));
  perform pg_temp.ck('INV-10: the opening is an audit_log row with the patient as the subject', '1',
    (select count(*)::text from public.audit_log where action = 'clinical_audit.case_file_read' and entity_id = pg_temp.task_of(v_a) and subject_patient_id = v_pat and actor_id = v_rev));
  perform pg_temp.ck('...and a row in the opens table', '1', (select count(*)::text from public.clinical_audit_case_opens where audit_id = v_a and reader_id = v_rev and role = 'first'));
  perform pg_temp.ck('...and case_opened_at is recorded', 'true', (select (case_opened_at is not null)::text from public.clinical_audits where id = v_a));
  perform pg_temp.ck('a clinician cannot open it', 'ERR:only the clinical lead can open an audit case file', pg_temp.opn(v_oth, v_a));
  perform pg_temp.ck('an admin account cannot open it', 'ERR:only the clinical lead can open an audit case file', pg_temp.opn(pg_temp.f('admin'), v_a));
  perform pg_temp.ck('a phase comment is refused on a v1 form (it has none)', 'ERR:this form has no phase comments', pg_temp.sub(v_rev, v_a, v_safe, v_q4, '', $x$, '{"assessment":"x"}'::jsonb$x$));
  perform pg_temp.ck('...and so is an avoidability rating', 'ERR:this form has no avoidability rating', pg_temp.sub(v_rev, v_a, v_safe, v_q4, '', $x$, null, 'not_avoidable'$x$));
  -- a satisfactory v1 audit is final at once
  v_res := pg_temp.sub(v_rev, v_a, v_safe, v_q4, '');
  perform pg_temp.ck('a satisfactory audit is final immediately', 'satisfactory/false/true', (v_res::jsonb ->> 'outcome') || '/' || (v_res::jsonb ->> 'needs_second_review') || '/' || (select (final_at is not null)::text from public.clinical_audits where id = v_a));
  perform pg_temp.ck('...final_outcome is the outcome', 'satisfactory', (select final_outcome from public.clinical_audits where id = v_a));
  perform pg_temp.ck('...and a reliability event was written once', '1', (select count(*)::text from public.clinician_reliability_events where task_id = pg_temp.task_of(v_a) and kind = 'audit_result'));
end $$;

-- 3. Q1: a critical miss needs a second, independent reviewer; the clinician can reply; the follow-up is append-only history -----
do $$
declare
  v_cmo uuid := pg_temp.f('cmo'); v_cmo2 uuid := pg_temp.f('cmo2'); v_fin uuid := pg_temp.f('fin'); v_oth uuid := pg_temp.f('other'); v_adm uuid := pg_temp.f('admin');
  v_t uuid; v_a uuid; v_rev uuid; v_sec uuid; v_res text; v_j jsonb; v_hist integer;
  v_safe jsonb := '{"identity_and_consent_confirmed":true,"red_flags_recognised_and_acted_on":true,"decision_within_competence_and_protocol":true,"no_unsigned_treatment_change":true,"safety_netting_and_follow_up_given":true,"escalated_when_needed":true}';
  v_q4 jsonb := '{"history_adequate":4,"reasoning_documented":4,"communication_clear":4,"plan_appropriate":4,"patient_questions_answered":4,"documentation_timely":4}';
begin
  v_t := pg_temp.finish(v_fin, 'symptom_review');
  v_a := (pg_temp.q_as(v_cmo, format('select public.request_clinical_audit(%L)', v_t)))::uuid;
  select reviewer_id into v_rev from public.clinical_audits where id = v_a;
  perform pg_temp.opn(v_rev, v_a);
  v_res := pg_temp.sub(v_rev, v_a, jsonb_set(v_safe, '{escalated_when_needed}', 'false'), v_q4, 'A needed escalation was not made.');
  perform pg_temp.ck('a failed safety item is unsafe and asks for a second review', 'unsafe/true/true', (v_res::jsonb ->> 'outcome') || '/' || (v_res::jsonb ->> 'critical_miss') || '/' || (v_res::jsonb ->> 'needs_second_review'));
  select second_reviewer_id into v_sec from public.clinical_audits where id = v_a;
  perform pg_temp.ck('...the second reviewer is a different lead, not the first and not the clinician', 'true', (v_sec is not null and v_sec <> v_rev and v_sec <> v_fin)::text);
  perform pg_temp.ck('...the audit is not final yet', 'submitted/', (select state || '/' || coalesce(final_at::text, '') from public.clinical_audits where id = v_a));
  perform pg_temp.ck('...no reliability event until it is final', '0', (select count(*)::text from public.clinician_reliability_events where task_id = v_t and kind = 'audit_result'));
  perform pg_temp.ck('...the finding still reaches the lead (an event with ids only)', '1', (select count(*)::text from public.domain_events where event_type = 'clinical_audit.concern_found' and payload ->> 'audit_id' = v_a::text and not payload ? 'rationale'));
  perform pg_temp.ck('...the audited clinician sees nothing until it is final', '0', pg_temp.q_as(v_fin, format('select count(*) from public.clinical_audits where id = %L', v_a)));
  perform pg_temp.ck('...and cannot reply yet', 'ERR:there is no finished audit of your work with that id', pg_temp.q_as(v_fin, format('select public.reply_to_clinical_audit(%L, %L)', v_a, 'I would like to explain what happened here.')));
  perform pg_temp.ck('the first reviewer cannot give the second review', 'ERR:the second review must come from a different reviewer', pg_temp.sub2(v_rev, v_a, v_safe, v_q4, 'Looks fine to me, a different view.'));
  perform pg_temp.ck('the first reviewer cannot open it as the second reader', 'ERR:this audit is assigned to another reviewer', pg_temp.opn(v_rev, v_a));
  perform pg_temp.ck('the second reviewer cannot submit before opening', 'ERR:open the case file before you submit the audit', pg_temp.sub2(v_sec, v_a, v_safe, v_q4, 'Looks fine to me, a different view.'));
  v_res := pg_temp.opn(v_sec, v_a);
  perform pg_temp.ck('...the second reader opens it independently: the first reading''s words are not in the case file', 'true', (v_res not like '%A needed escalation was not made%')::text);
  perform pg_temp.ck('...the open is recorded as the second reader', '1', (select count(*)::text from public.clinical_audit_case_opens where audit_id = v_a and reader_id = v_sec and role = 'second'));
  perform pg_temp.ck('a second review always needs a written reason', 'ERR:a second review always needs a written reason of at least 20 characters', pg_temp.sub2(v_sec, v_a, v_safe, v_q4, 'ok'));
  v_res := pg_temp.sub2(v_sec, v_a, v_safe, v_q4, 'On my reading the escalation was reasonable on the record.');
  perform pg_temp.ck('a disagreeing second review is recorded and is the final reading', 'satisfactory/false', (v_res::jsonb ->> 'final_outcome') || '/' || (v_res::jsonb ->> 'agrees'));
  perform pg_temp.ck('...the audit is now final', 'true', (select (final_at is not null and final_outcome = 'satisfactory' and second_review_agrees = false and outcome = 'unsafe')::text from public.clinical_audits where id = v_a));
  perform pg_temp.ck('...one reliability event, from the final outcome (good = 1)', '1/1', (select count(*)::text || '/' || min(good)::text from public.clinician_reliability_events where task_id = v_t and kind = 'audit_result'));
  perform pg_temp.ck('...the second review row exists once and cannot change', '1/23514', (select count(*)::text from public.clinical_audit_second_reviews where audit_id = v_a) || '/' || pg_temp.try_sql(format('update public.clinical_audit_second_reviews set outcome = %L where audit_id = %L', 'satisfactory', v_a)));
  perform pg_temp.ck('...it cannot be given twice', 'ERR:this audit does not need a second review', pg_temp.sub2(v_sec, v_a, v_safe, v_q4, 'On my reading the escalation was reasonable on the record.'));
  perform pg_temp.ck('...and a final outcome cannot be rewritten', '23514', pg_temp.try_sql(format('update public.clinical_audits set final_outcome = %L where id = %L', 'unsafe', v_a)));
  perform pg_temp.ck('the audited clinician now sees the audit', '1', pg_temp.q_as(v_fin, format('select count(*) from public.clinical_audits where id = %L', v_a)));
  perform pg_temp.ck('a colleague and an admin account do not', '0/0', pg_temp.q_as(v_oth, format('select count(*) from public.clinical_audits where id = %L', v_a)) || '/' || pg_temp.q_as(v_adm, format('select count(*) from public.clinical_audits where id = %L', v_a)));

  -- the reply
  perform pg_temp.ck('a reply needs real words', 'ERR:write a reply of at least 20 characters', pg_temp.q_as(v_fin, format('select public.reply_to_clinical_audit(%L, %L)', v_a, 'no')));
  perform pg_temp.ck('a colleague cannot reply to someone else''s audit', 'ERR:there is no finished audit of your work with that id', pg_temp.q_as(v_oth, format('select public.reply_to_clinical_audit(%L, %L)', v_a, 'I would like to explain what happened here.')));
  perform pg_temp.ck('the audited clinician can reply', 'ok', pg_temp.try_as(v_fin, format('select public.reply_to_clinical_audit(%L, %L)', v_a, 'The patient had already been sent to the emergency pathway by the page.')));
  perform pg_temp.ck('...the lead sees the reply in the audit detail', '1', (pg_temp.q_as(v_cmo, format('select public.audit_detail(%L)', v_a))::jsonb -> 'replies' -> 0 ->> 'body' is not null)::int::text);
  perform pg_temp.ck('...the lead is told in neutral words, without the reply', 'true',
    (select (count(*) >= 1 and bool_and(payload ->> 'message' not ilike '%emergency%'))::text from public.notifications where payload ->> 'subject' = 'A clinical audit has a reply'));
  perform pg_temp.ck('...a colleague cannot read the reply and neither can an admin account', '0/0',
    pg_temp.q_as(v_oth, 'select count(*) from public.clinical_audit_replies') || '/' || pg_temp.q_as(v_adm, 'select count(*) from public.clinical_audit_replies'));
  perform pg_temp.ck('...replies cannot be edited or deleted', '23514/23514', pg_temp.try_sql(format('update public.clinical_audit_replies set body = %L', 'x')) || '/' || pg_temp.try_sql('delete from public.clinical_audit_replies'));

  -- the second reading cleared the first: no follow-up is owed on that audit any more
  perform pg_temp.ck('a follow-up is no longer owed once the second reading cleared the first', 'false/ERR:there is no open follow-up on this audit',
    (select followup_needed::text from public.clinical_audits where id = v_a) || '/' || pg_temp.q_as(v_cmo, format('select public.add_audit_followup_note(%L, %L)', v_a, 'A note on an audit that no longer needs one.')));
  -- a different audit with a real finding carries the follow-up history checks
  v_t := pg_temp.finish(v_fin, 'symptom_review');
  v_a := (pg_temp.q_as(v_cmo, format('select public.request_clinical_audit(%L)', v_t)))::uuid;
  select reviewer_id into v_rev from public.clinical_audits where id = v_a;
  perform pg_temp.opn(v_rev, v_a);
  v_res := pg_temp.sub(v_rev, v_a, v_safe, '{"history_adequate":1,"reasoning_documented":1,"communication_clear":1,"plan_appropriate":1,"patient_questions_answered":1,"documentation_timely":1}', 'Reasoning was not recorded and the plan was thin.');
  perform pg_temp.ck('fixture: a significant finding with a follow-up owed', 'significant_concerns/true', (v_res::jsonb ->> 'outcome') || '/' || (select followup_needed::text from public.clinical_audits where id = v_a));
  -- follow-up history: append-only, closed once
  perform pg_temp.ck('a follow-up note needs real words', 'ERR:say what was done, in at least 20 characters', pg_temp.q_as(v_cmo, format('select public.add_audit_followup_note(%L, %L)', v_a, 'short')));
  perform pg_temp.ck('the lead adds a follow-up note', 'ok', pg_temp.try_as(v_cmo, format('select public.add_audit_followup_note(%L, %L)', v_a, 'Met the clinician and went through the page timeline.')));
  perform pg_temp.ck('the lead closes the follow-up', 'ok', pg_temp.try_as(v_cmo, format('select public.close_audit_followup(%L, %L)', v_a, 'Agreed a refresher on the escalation protocol.')));
  perform pg_temp.ck('closing again is refused (no overwrite)', 'ERR:there is no open follow-up on this audit', pg_temp.q_as(v_cmo, format('select public.close_audit_followup(%L, %L)', v_a, 'A different account of what was done instead.')));
  perform pg_temp.ck('...adding after the close is refused too', 'ERR:there is no open follow-up on this audit', pg_temp.q_as(v_cmo, format('select public.add_audit_followup_note(%L, %L)', v_a, 'Another note after the follow-up was closed.')));
  perform pg_temp.ck('...a direct overwrite of the closed note is refused', '23514', pg_temp.try_sql(format('update public.clinical_audits set followup_note = %L where id = %L', 'rewritten history', v_a)));
  perform pg_temp.ck('...the note is still the first one', 'Agreed a refresher on the escalation protocol.', (select followup_note from public.clinical_audits where id = v_a));
  select count(*) into v_hist from public.clinical_audit_followups where audit_id = v_a;
  perform pg_temp.ck('...the history holds both entries and cannot be edited or deleted', '2/23514/23514',
    v_hist || '/' || pg_temp.try_sql(format('update public.clinical_audit_followups set note = %L where audit_id = %L', 'x', v_a)) || '/' || pg_temp.try_sql(format('delete from public.clinical_audit_followups where audit_id = %L', v_a)));
  perform pg_temp.ck('a clinician cannot add to a follow-up', 'ERR:only the clinical lead can add a follow-up note', pg_temp.q_as(v_oth, format('select public.add_audit_followup_note(%L, %L)', v_a, 'Trying to add to somebody''s audit follow-up.')));
end $$;

-- 3b. no second reviewer is available: the audit waits, the sweep assigns one when a lead returns --------------------------
do $$
declare
  v_cmo uuid := pg_temp.f('cmo'); v_cmo2 uuid := pg_temp.f('cmo2'); v_fin uuid := pg_temp.f('fin'); v_t uuid; v_a uuid; v_res text; v_sw jsonb;
  v_safe jsonb := '{"identity_and_consent_confirmed":true,"red_flags_recognised_and_acted_on":true,"decision_within_competence_and_protocol":true,"no_unsigned_treatment_change":true,"safety_netting_and_follow_up_given":true,"escalated_when_needed":true}';
  v_q4 jsonb := '{"history_adequate":4,"reasoning_documented":4,"communication_clear":4,"plan_appropriate":4,"patient_questions_answered":4,"documentation_timely":4}';
begin
  update public.clinical_staff set active = false where profile_id = v_cmo2;
  v_t := pg_temp.finish(v_fin, 'symptom_review');
  v_a := (pg_temp.q_as(v_cmo, format('select public.request_clinical_audit(%L)', v_t)))::uuid;
  perform pg_temp.ck('with one lead only, the audit is theirs', v_cmo::text, (select reviewer_id::text from public.clinical_audits where id = v_a));
  perform pg_temp.opn(v_cmo, v_a);
  v_res := pg_temp.sub(v_cmo, v_a, jsonb_set(v_safe, '{no_unsigned_treatment_change}', 'false'), v_q4, 'A treatment change was made without a signature.');
  perform pg_temp.ck('a critical miss with nobody to second it waits', 'true/', (v_res::jsonb ->> 'needs_second_review') || '/' || (select coalesce(second_reviewer_id::text, '') from public.clinical_audits where id = v_a));
  v_sw := private.quality_audit_sweep();
  perform pg_temp.ck('...the sweep cannot assign one either', '0', v_sw ->> 'second_assigned');
  perform pg_temp.ck('...and it is not final', 'true', (select (final_at is null)::text from public.clinical_audits where id = v_a));
  update public.clinical_staff set active = true where profile_id = v_cmo2;
  v_sw := private.quality_audit_sweep();
  perform pg_temp.ck('when the second lead is back the sweep assigns them', v_cmo2::text, (select second_reviewer_id::text from public.clinical_audits where id = v_a));
  perform pg_temp.ck('...and the first lead still cannot finish it', 'ERR:the second review must come from a different reviewer', pg_temp.sub2(v_cmo, v_a, v_safe, v_q4, 'Marking my own audit as correct here.'));
end $$;

-- 4. Q3: the secret-seed draw and the stratified floor, version 1 still active ---------------------------------------
do $$
declare
  v_fin uuid := pg_temp.f('fin'); v_t uuid; v_old numeric; v_day integer := extract(day from (now() at time zone 'Africa/Lagos'))::integer;
  v_c uuid; v_made integer; v_bad text := ''; v_prev date := private.lagos_month(now() - interval '1 month'); v_i integer; v_oth uuid := pg_temp.f('other'); v_sw jsonb;
begin
  perform pg_temp.ck('the monthly seed is stable within a month and differs between months', 'true/true',
    (private.sampling_seed('2026-01-01') = private.sampling_seed('2026-01-01'))::text || '/' || (private.sampling_seed('2026-01-01') <> private.sampling_seed('2026-02-01'))::text);
  perform pg_temp.cfg('{sampling,random_rate_percent}', '100'::jsonb);
  v_t := pg_temp.finish(v_fin, 'symptom_review');
  perform pg_temp.cfg('{sampling,random_rate_percent}', '0'::jsonb);
  v_old := (abs(hashtextextended(v_t::text || ':' || private.lagos_month(now())::text, 0)) % 1000000) / 10000.0;
  perform pg_temp.ck('the stored draw is the keyed draw, not the old public formula', 'true/true',
    (select (sample_draw = private.sampling_draw(v_t, private.lagos_month(now()), 'random'))::text || '/' || (sample_draw is distinct from v_old)::text from public.clinical_audits where task_id = v_t));
  perform pg_temp.ck('...and it is a number between 0 and 100', 'true', (select (sample_draw >= 0 and sample_draw < 100)::text from public.clinical_audits where task_id = v_t));
  perform pg_temp.ck('draws differ by salt, so the floor choice is not the sample draw', 'true', (private.sampling_draw(v_t, private.lagos_month(now()), 'random') <> private.sampling_draw(v_t, private.lagos_month(now()), 'floor'))::text);
  -- stratified floor: c1 and c2 complete three tasks each and are not audited by the sample; each gets exactly one from the floor
  foreach v_c in array array[pg_temp.f('c1'), pg_temp.f('c2')] loop
    for v_i in 1..3 loop perform pg_temp.finish(v_c, 'symptom_review'); end loop;
  end loop;
  perform pg_temp.ck('c1 and c2 have no audit before the floor runs', '0', (select count(*)::text from public.clinical_audits where clinician_id in (pg_temp.f('c1'), pg_temp.f('c2'))));
  v_made := private.audit_floor_top_up(private.lagos_month(now()));
  perform pg_temp.ck('the floor gives every clinician exactly one', '1/1', (select count(*)::text from public.clinical_audits where clinician_id = pg_temp.f('c1') and reason = 'floor_top_up') || '/' || (select count(*)::text from public.clinical_audits where clinician_id = pg_temp.f('c2') and reason = 'floor_top_up'));
  perform pg_temp.ck('...and running it again adds nothing', '0', private.audit_floor_top_up(private.lagos_month(now()))::text);
  -- the catch-up: tasks 'other' finished last month have no audit. Under version 1 the sweep tops last month up only in the first 7 days.
  for v_i in 1..3 loop
    v_t := pg_temp.finish(v_oth, 'symptom_review');
    perform pg_temp.backdate(v_t, 'completed_at = (date_trunc(''month'', now() at time zone ''Africa/Lagos'') - interval ''10 days'') at time zone ''Africa/Lagos''');
  end loop;
  perform pg_temp.ck('fixture: other''s tasks completed last month', '3', (select count(*)::text from public.clinical_tasks where claimed_by = v_oth and private.lagos_month(completed_at) = v_prev));
  v_sw := private.quality_audit_sweep();
  perform pg_temp.ck('version 1: last month''s floor is only filled in the first 7 days of this month (day ' || v_day || ')', case when v_day <= 7 then '1' else '0' end,
    (select count(*)::text from public.clinical_audits where clinician_id = v_oth and audit_month = v_prev));
end $$;

-- 5. Signing version 2 (done here as the chief medical officer does it) and the governed-config guard -----------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_oth uuid := pg_temp.f('other');
begin
  -- a draft nobody used can still be tuned: the proof pins the days so the catch-up does not depend on today's date
  update public.quality_config set rules = jsonb_set(jsonb_set(jsonb_set(rules, '{sampling,floor_catchup_until_day}', '31'), '{sampling,floor_current_month_from_day}', '1'), '{sampling,scribe_assisted_rate_percent}', '100') where version = 3;
  perform pg_temp.ck('the CMO signs version 2', 'ok', pg_temp.try_as(v_cmo, 'select public.sign_quality_config(3)'));
  perform pg_temp.ck('...it is active, signed and v1 is off', '3/true/false', (select (select version from public.quality_config where is_active)::text || '/' || (select (approved_at is not null)::text from public.quality_config where version = 3) || '/' || (select is_active::text from public.quality_config where version = 2)));
  perform pg_temp.ck('...signing again is refused', 'ERR:that version is already signed', pg_temp.q_as(v_cmo, 'select public.sign_quality_config(3)'));
  perform pg_temp.ck('a signed version cannot be edited', '23514', pg_temp.try_sql($q$update public.quality_config set rules = jsonb_set(rules, '{sampling,random_rate_percent}', '99') where version = 3$q$));
  perform pg_temp.ck('...nor its signature removed', '23514', pg_temp.try_sql($q$update public.quality_config set approved_at = null where version = 3$q$));
  perform pg_temp.ck('the activation guard: the older version 1 can no longer be switched back on', '23514', pg_temp.try_sql($q$update public.quality_config set is_active = true where version = 2$q$));
  -- the signed v2 samples 10 percent at random; the checks below choose which tasks are audited, so the random part is switched off (test-only edit through cfg)
  perform pg_temp.cfg('{sampling,random_rate_percent}', '0'::jsonb);
  perform pg_temp.ck('version 1 rules are exactly as they were (never edited)', 'true', (select (rules -> 'form' ->> 'version' = '1' and not rules ? 'second_review')::text from public.quality_config where version = 2));
  -- the catch-up now fills last month later in the month (day pinned to 31 above)
  perform private.quality_audit_sweep();
  perform pg_temp.ck('version 2: the sweep fills last month''s floor later in the month', '1/floor_top_up', (select count(*)::text || '/' || min(reason) from public.clinical_audits where clinician_id = v_oth and audit_month = private.lagos_month(now() - interval '1 month')));
  perform pg_temp.ck('...and running the sweep again adds nothing', '1', (select count(*)::text from public.clinical_audits where clinician_id = v_oth and audit_month = private.lagos_month(now() - interval '1 month')));
end $$;

-- 6. Version 2 form: phase comments, avoidability, the scribe sample ------------------------------------------------
do $$
declare
  v_cmo uuid := pg_temp.f('cmo'); v_fin uuid := pg_temp.f('fin'); v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); v_cmo2 uuid := pg_temp.f('cmo2');
  v_t uuid; v_a uuid; v_rev uuid; v_res text; v_j jsonb; v_consent uuid; v_staff uuid; v_got uuid; v_r text;
  v_safe jsonb := '{"identity_and_consent_confirmed":true,"red_flags_recognised_and_acted_on":true,"decision_within_competence_and_protocol":true,"no_unsigned_treatment_change":true,"safety_netting_and_follow_up_given":true,"escalated_when_needed":true}';
  v_q4 jsonb := '{"history_adequate":4,"reasoning_documented":4,"communication_clear":4,"plan_appropriate":4,"patient_questions_answered":4,"documentation_timely":4}';
  v_q1 jsonb := '{"history_adequate":1,"reasoning_documented":1,"communication_clear":1,"plan_appropriate":1,"patient_questions_answered":1,"documentation_timely":1}';
begin
  v_t := pg_temp.finish(v_fin, 'symptom_review');
  v_a := (pg_temp.q_as(v_cmo, format('select public.request_clinical_audit(%L)', v_t)))::uuid;
  perform pg_temp.ck('a new audit is under version 2 of the config and form', '3/2', (select config_version || '/' || form_version from public.clinical_audits where id = v_a));
  select reviewer_id into v_rev from public.clinical_audits where id = v_a;
  perform pg_temp.opn(v_rev, v_a);
  perform pg_temp.ck('a concern without an avoidability rating is refused', 'ERR:rate how avoidable the problem was', pg_temp.sub(v_rev, v_a, v_safe, v_q1, 'Reasoning was not recorded and the plan was thin.'));
  perform pg_temp.ck('an unknown avoidability rating is refused', 'ERR:unknown avoidability rating', pg_temp.sub(v_rev, v_a, v_safe, v_q1, 'Reasoning was not recorded and the plan was thin.', $x$, null, 'maybe'$x$));
  perform pg_temp.ck('an unknown phase is refused', 'ERR:unknown phase triage', pg_temp.sub(v_rev, v_a, v_safe, v_q1, 'Reasoning was not recorded and the plan was thin.', $x$, '{"triage":"x"}'::jsonb, 'possibly_avoidable'$x$));
  perform pg_temp.ck('a phase comment that is not text is refused', 'true', (pg_temp.sub(v_rev, v_a, v_safe, v_q1, 'Reasoning was not recorded and the plan was thin.', $x$, '{"assessment":4}'::jsonb, 'possibly_avoidable'$x$) like 'ERR:%')::text);
  v_res := pg_temp.sub(v_rev, v_a, v_safe, v_q1, 'Reasoning was not recorded and the plan was thin.', $x$, '{"assessment":"History was brief.","decision":"Plan not justified.","action":"","documentation":"Thin."}'::jsonb, 'probably_avoidable'$x$);
  perform pg_temp.ck('a full v2 submission is accepted', 'significant_concerns', pg_temp.jv(v_res, 'outcome'));
  perform pg_temp.ck('...the phase comments (empty ones dropped) and the avoidability are stored', 'probably_avoidable/3', (select avoidability || '/' || (select count(*) from jsonb_object_keys(phase_comments))::text from public.clinical_audits where id = v_a));
  -- a satisfactory audit needs no avoidability
  v_t := pg_temp.finish(v_fin, 'symptom_review');
  v_a := (pg_temp.q_as(v_cmo, format('select public.request_clinical_audit(%L)', v_t)))::uuid;
  select reviewer_id into v_rev from public.clinical_audits where id = v_a;
  perform pg_temp.opn(v_rev, v_a);
  perform pg_temp.ck('a satisfactory v2 audit needs no avoidability rating', 'satisfactory', pg_temp.jv(pg_temp.sub(v_rev, v_a, v_safe, v_q4, ''), 'outcome'));

  -- the AI scribe sample: a note drafted by the scribe for this patient by this clinician during the work
  perform pg_temp.clear_queue();
  v_t := pg_temp.mktask(v_pat, 'symptom_review');
  v_got := pg_temp.next_task(v_fin);
  perform pg_temp.ck('fixture: fin claimed the scribe task', v_t::text, v_got::text);
  v_staff := pg_temp.staff_of(v_fin);
  -- the S23 attribution triggers need a live consultation; the fixture rows are written with them off (this proof tests the audit, not the scribe)
  alter table public.scribe_consents disable trigger user;
  alter table public.clinical_encounter_notes disable trigger user;
  insert into public.scribe_consents (organisation_id, patient_id, clinician_staff_id, clinician_profile_id, granted, language)
    values (v_org, v_pat, v_staff, v_fin, true, 'en-NG') returning id into v_consent;
  insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, authored_by_staff, authored_by_profile, reason_for_encounter, history, assessment, plan, scribe_consent_id)
    values (v_org, v_pat, 'async_consult', v_staff, v_fin, 'Headache for three days', 'No vomiting, no vision change.', 'Likely tension headache', 'Fluids and review in a week', v_consent);
  perform private.apply_task_transition(v_t, 'completed', 'clinician', v_fin, null, null, null, '{"code":"closed_for_proof","note":"done"}'::jsonb);
  v_r := 'ok';
  perform pg_temp.ck('fixture: the scribe task completes', 'ok', v_r);
  perform pg_temp.ck('the scribe link finds the note by patient, author and time', 'true', (private.task_scribe_note(v_t) is not null)::text);
  v_a := pg_temp.audit_of(v_t);
  perform pg_temp.ck('Q3: a scribe-assisted note is sampled (rate 100 in this proof) and flagged', 'scribe_sample/true', (select reason || '/' || scribe_assisted from public.clinical_audits where id = v_a));
  select reviewer_id into v_rev from public.clinical_audits where id = v_a;
  v_res := pg_temp.opn(v_rev, v_a);
  perform pg_temp.ck('fixture: the reviewer opens the scribe audit', 'true', (v_res not like 'ERR:%')::text);
  v_j := v_res::jsonb;
  perform pg_temp.ck('...the case file includes the scribe-drafted note', 'true/Likely tension headache', (v_j -> 'scribe_note' ->> 'scribe_drafted') || '/' || (v_j -> 'scribe_note' ->> 'assessment'));
  perform pg_temp.ck('...it must be scored for omission and invented content', 'ERR:this note was drafted by the scribe: score every scribe item and no others', pg_temp.sub(v_rev, v_a, v_safe, v_q4, ''));
  perform pg_temp.ck('...a partial scribe score is refused', 'ERR:this note was drafted by the scribe: score every scribe item and no others', pg_temp.sub(v_rev, v_a, v_safe, v_q4, '', $x$, null, null, '{"no_invented_content":true}'::jsonb$x$));
  v_res := pg_temp.sub(v_rev, v_a, v_safe, v_q4, '', $x$, null, null, '{"no_clinically_relevant_omission":false,"no_invented_content":true}'::jsonb$x$);
  perform pg_temp.ck('an omission is recorded separately and does not change the score', 'satisfactory/100.0', pg_temp.jv(v_res, 'outcome') || '/' || trim_scale(pg_temp.jv(v_res, 'total_score')::numeric)::text || '.0');
  perform pg_temp.ck('...the summary counts it', '1/1/0', (pg_temp.q_as(v_cmo, 'select public.scribe_audit_summary()')::jsonb ->> 'audited') || '/' || (pg_temp.q_as(v_cmo, 'select public.scribe_audit_summary()')::jsonb ->> 'omission_found') || '/' || (pg_temp.q_as(v_cmo, 'select public.scribe_audit_summary()')::jsonb ->> 'invented_content_found'));
  perform pg_temp.ck('a clinician cannot read the scribe summary', 'ERR:only the clinical lead can see this', pg_temp.q_as(v_fin, 'select public.scribe_audit_summary()'));
  -- invented content is a critical miss and needs the second review
  perform pg_temp.clear_queue();
  v_t := pg_temp.mktask(v_pat, 'symptom_review');
  perform pg_temp.next_task(v_fin);
  insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, authored_by_staff, authored_by_profile, reason_for_encounter, scribe_consent_id)
    values (v_org, v_pat, 'async_consult', v_staff, v_fin, 'Cough for a week', v_consent);
  alter table public.scribe_consents enable trigger user;
  alter table public.clinical_encounter_notes enable trigger user;
  perform private.apply_task_transition(v_t, 'completed', 'clinician', v_fin, null, null, null, '{"code":"closed_for_proof","note":"done"}'::jsonb);
  v_a := pg_temp.audit_of(v_t);
  select reviewer_id into v_rev from public.clinical_audits where id = v_a;
  perform pg_temp.opn(v_rev, v_a);
  v_res := pg_temp.sub(v_rev, v_a, v_safe, v_q4, 'The note records an examination that was not done.', $x$, null, 'definitely_avoidable', '{"no_clinically_relevant_omission":true,"no_invented_content":false}'::jsonb$x$);
  perform pg_temp.ck('invented scribe content is a critical miss that needs a second review', 'unsafe/true', case when v_res like 'ERR:%' then v_res else (v_res::jsonb ->> 'outcome') || '/' || (v_res::jsonb ->> 'needs_second_review') end);
end $$;

-- 7. Q7: hand-backs. The exempt reasons are not counted; a failed check is retried by the sweep ------------------------------
do $$
declare
  v_c1 uuid := pg_temp.f('c1'); v_c2 uuid := pg_temp.f('c2'); v_org uuid := pg_temp.f('org'); v_task uuid; v_i integer; v_sw jsonb;
begin
  select id into v_task from public.clinical_tasks where claimed_by = v_c1 limit 1;
  for v_i in 1..5 loop
    insert into public.task_handbacks (organisation_id, task_id, clinician_id, reason_code, is_test) values (v_org, v_task, v_c1, 'technical_problem', true);
    insert into public.task_handbacks (organisation_id, task_id, clinician_id, reason_code, is_test) values (v_org, v_task, v_c1, 'conflict_of_interest', true);
  end loop;
  perform pg_temp.ck('ten exempt hand-backs (technical problem, conflict of interest) open no review', '0', (select count(*)::text from public.handback_reviews where clinician_id = v_c1));
  for v_i in 1..4 loop
    insert into public.task_handbacks (organisation_id, task_id, clinician_id, reason_code, is_test) values (v_org, v_task, v_c1, 'outside_competence', true);
  end loop;
  perform pg_temp.ck('four countable hand-backs open one review', '1', (select count(*)::text from public.handback_reviews where clinician_id = v_c1 and state = 'open'));
  perform pg_temp.ck('...whose breakdown leaves the exempt reasons out', 'true', (select (reasons ? 'outside_competence' and not reasons ? 'technical_problem' and handbacks = 4)::text from public.handback_reviews where clinician_id = v_c1 and state = 'open'));
  -- the trigger failed (simulated by switching it off): nothing opened; the sweep retries
  alter table public.task_handbacks disable trigger task_handbacks_review;
  for v_i in 1..4 loop
    insert into public.task_handbacks (organisation_id, task_id, clinician_id, reason_code, is_test) values (v_org, v_task, v_c2, 'outside_competence', true);
  end loop;
  alter table public.task_handbacks enable trigger task_handbacks_review;
  perform pg_temp.ck('a hand-back review the trigger missed does not exist yet', '0', (select count(*)::text from public.handback_reviews where clinician_id = v_c2));
  v_sw := private.quality_audit_sweep();
  perform pg_temp.ck('the daily sweep retries it and opens the review', '1', (select count(*)::text from public.handback_reviews where clinician_id = v_c2 and state = 'open'));
  perform pg_temp.ck('...reporting how many it opened', 'true', ((v_sw ->> 'handback_reviews_opened')::integer >= 1)::text);
  perform private.quality_audit_sweep();
  perform pg_temp.ck('...and the retry is idempotent (still one open review)', '1', (select count(*)::text from public.handback_reviews where clinician_id = v_c2 and state = 'open'));
  perform pg_temp.try_as(pg_temp.f('cmo'), format('select public.close_handback_review(%L, %L, %L)', (select id from public.handback_reviews where clinician_id = v_c2 and state = 'open'), 'no_action', 'looked at it, nothing to do'));
  perform private.quality_audit_sweep();
  perform pg_temp.ck('a review the lead closed is not reopened by the daily retry', '0', (select count(*)::text from public.handback_reviews where clinician_id = v_c2 and state = 'open'));
end $$;

-- 8. Q2: speak-up v2 ---------------------------------------------------------------------------------------------------
do $$
declare
  v_cmo uuid := pg_temp.f('cmo'); v_cmo2 uuid := pg_temp.f('cmo2'); v_fin uuid := pg_temp.f('fin'); v_oth uuid := pg_temp.f('other'); v_adm uuid := pg_temp.f('admin'); v_adm2 uuid := pg_temp.f('admin2');
  v_rdr uuid := pg_temp.f('rdr'); v_ind uuid := pg_temp.f('indep'); v_ind2 uuid := pg_temp.f('indep2'); v_org uuid := pg_temp.f('org');
  v_id uuid; v_std uuid; v_cm uuid; v_about uuid; v_n integer; v_before bigint; v_code text; v_anon uuid; v_ex uuid;
  v_text text := 'zebrafish quartz handover problem on the night shift for the whole team';
  v_text2 text := 'marmalade lantern conduct issue involving the clinical lead this month';
  v_text3 text := 'pineapple harbour anonymous worry about a repeated shortcut on nights';
  v_fin_ops uuid := pg_temp.mkuser(pg_temp.f('org'), 'financeops', 'finance');
begin
  -- 8a. no admin reader
  perform pg_temp.ck('a named backup reader cannot be an admin account (clinician kind)', 'ERR:that person was not found', pg_temp.q_as(v_cmo, format('select public.add_safety_concern_backup_reader(%L)', v_adm)));
  perform pg_temp.ck('...nor an independent one', 'ERR:an admin account cannot be a safety concern reader', pg_temp.q_as(v_cmo, format('select public.add_safety_concern_backup_reader(%L, null, %L)', v_adm, 'independent')));
  perform pg_temp.ck('...nor by a direct row (trigger)', '23514', pg_temp.try_sql(format('insert into public.safety_concern_readers (organisation_id, profile_id, is_test) values (%L, %L, true)', v_org, v_adm2)));
  perform pg_temp.ck('an operations-type account cannot be an independent reader either (allow-list, not "not admin")', 'ERR:only an ordinary clinician or outside-person account can be a safety concern reader',
    pg_temp.q_as(v_cmo, format('select public.add_safety_concern_backup_reader(%L, null, %L)', v_fin_ops, 'independent')));
  perform pg_temp.ck('...nor by a direct row', '23514', pg_temp.try_sql(format('insert into public.safety_concern_readers (organisation_id, profile_id, kind, is_test) values (%L, %L, %L, true)', v_org, v_fin_ops, 'independent')));
  perform pg_temp.ck('a clinician reader can be named by the lead', 'ok', pg_temp.try_as(v_cmo, format('select public.add_safety_concern_backup_reader(%L, %L)', v_rdr, 'the named senior colleague')));
  perform pg_temp.ck('...a clinician cannot name one', 'ERR:only the clinical lead can name a backup reader', pg_temp.q_as(v_oth, format('select public.add_safety_concern_backup_reader(%L)', v_oth)));
  perform pg_temp.ck('...a lead cannot name themselves or the other lead', 'ERR:the clinical lead cannot name themselves or another lead as a reader', pg_temp.q_as(v_cmo, format('select public.add_safety_concern_backup_reader(%L, null, %L)', v_cmo2, 'independent')));
  -- a later role change to admin switches the reader off
  update public.profiles set role = 'admin' where id = v_rdr;
  perform pg_temp.ck('a role change to admin deactivates that person''s reader row', 'false', (select active::text from public.safety_concern_readers where profile_id = v_rdr));
  -- ...and even if that trigger were bypassed, the reader check itself refuses an admin account
  update public.safety_concern_readers set active = true where profile_id = v_rdr and false;   -- (the guard trigger forbids re-activating an admin row; see the next check)
  perform pg_temp.ck('...an admin row cannot be switched back on', '23514', pg_temp.try_sql(format('update public.safety_concern_readers set active = true where profile_id = %L', v_rdr)));
  update public.profiles set role = 'clinician' where id = v_rdr;
  update public.safety_concern_readers set active = true where profile_id = v_rdr;
  alter table public.safety_concern_readers disable trigger safety_concern_readers_no_admin;
  alter table public.profiles disable trigger profiles_role_admin_drops_reader;
  update public.profiles set role = 'admin' where id = v_rdr;
  perform pg_temp.ck('fixture: a stray active admin reader row exists (both guards bypassed)', 'true', (select active::text from public.safety_concern_readers where profile_id = v_rdr));
  alter table public.safety_concern_readers enable trigger safety_concern_readers_no_admin;
  alter table public.profiles enable trigger profiles_role_admin_drops_reader;
  v_std := (pg_temp.q_as(v_fin, format('select public.raise_safety_concern(%L, %L, %L)', 'patient_safety', 'high', v_text)))::uuid;
  perform pg_temp.setf('c_std', v_std);
  update public.safety_concerns set escalated_at = now() where id = v_std;
  perform pg_temp.ck('defence in depth: even a stray active admin row reads nothing', '0', pg_temp.q_as(v_rdr, format('select count(*) from public.safety_concerns where id = %L', v_std)));
  perform pg_temp.ck('...and is not a reader by status', 'false', (pg_temp.q_as(v_rdr, 'select public.my_reader_status()')::jsonb ->> 'is_reader'));
  update public.safety_concern_readers set active = false where profile_id = v_rdr;
  update public.profiles set role = 'clinician' where id = v_rdr;
  update public.safety_concerns set escalated_at = null where id = v_std;

  -- 8b. an external independent reader
  perform pg_temp.ck('the lead names an external independent reader (no clinician login)', 'ok', pg_temp.try_as(v_cmo, format('select public.add_safety_concern_backup_reader(%L, %L, %L)', v_ind, 'external person', 'independent')));
  perform pg_temp.ck('...who is a reader of the independent kind', 'true/true', (pg_temp.q_as(v_ind, 'select public.my_reader_status()')::jsonb ->> 'is_reader') || '/' || (pg_temp.q_as(v_ind, 'select public.my_reader_status()')::jsonb ->> 'is_independent'));
  perform pg_temp.ck('...and sees only their own reader row', '1', pg_temp.q_as(v_ind, 'select count(*) from public.safety_concern_readers'));
  perform pg_temp.ck('a standard concern that is not escalated is not theirs', '0', pg_temp.q_as(v_ind, format('select count(*) from public.safety_concerns where id = %L', v_std)));
  update public.safety_concerns set escalated_at = now() where id = v_std;
  perform pg_temp.ck('...once escalated, readers of either kind can read it', '1', pg_temp.q_as(v_ind, format('select count(*) from public.safety_concerns where id = %L', v_std)));

  -- 8c. the lead's own concern, and a concern about the lead, go to the independent reader and never the lead
  select count(*) into v_before from public.notifications where recipient_id = v_cmo2;
  v_cm := (pg_temp.q_as(v_cmo, format('select public.raise_safety_concern(%L, %L, %L)', 'system_or_process', 'medium', v_text2)))::uuid;
  perform pg_temp.ck('a concern raised by the lead is routed to the independent reader only', 'independent_only', (select routing from public.safety_concerns where id = v_cm));
  perform pg_temp.ck('...the other lead cannot read it', '0', pg_temp.q_as(v_cmo2, format('select count(*) from public.safety_concerns where id = %L', v_cm)));
  perform pg_temp.ck('...nor an admin account nor a colleague', '0/0', pg_temp.q_as(v_adm, format('select count(*) from public.safety_concerns where id = %L', v_cm)) || '/' || pg_temp.q_as(v_fin, format('select count(*) from public.safety_concerns where id = %L', v_cm)));
  perform pg_temp.ck('...the independent reader can', '1', pg_temp.q_as(v_ind, format('select count(*) from public.safety_concerns where id = %L', v_cm)));
  perform pg_temp.ck('...and its messages', 'true', (pg_temp.q_as(v_ind, format('select count(*) from public.safety_concern_messages where concern_id = %L', v_cm))::integer >= 1)::text);
  perform pg_temp.ck('...the other lead is not even told (no new notice)', v_before::text, (select count(*)::text from public.notifications where recipient_id = v_cmo2));
  perform pg_temp.ck('...the independent reader was told, in neutral words', 'true',
    (select (count(*) >= 1 and bool_and(payload::text not ilike '%marmalade%' and payload::text not ilike '%conduct%'))::text from public.notifications where recipient_id = v_ind and payload ->> 'subject' = 'A new item needs your attention'));
  perform pg_temp.ck('...the other lead''s inbox does not list it', '[]', (select coalesce(jsonb_path_query_array(pg_temp.q_as(v_cmo2, 'select public.safety_concern_inbox()')::jsonb, '$[*] ? (@.routing == "independent_only")')::text, 'x')));
  perform pg_temp.ck('...the other lead cannot act on it', 'ERR:concern not found', pg_temp.q_as(v_cmo2, format('select public.acknowledge_safety_concern(%L)', v_cm)));
  perform pg_temp.ck('...the independent reader acknowledges it', 'ok', pg_temp.try_as(v_ind, format('select public.acknowledge_safety_concern(%L)', v_cm)));
  perform pg_temp.ck('...and the lead who raised it is told (their own concern)', 'true', (pg_temp.q_as(v_cmo, 'select jsonb_array_length(public.my_safety_concerns())')::integer >= 1)::text);

  v_about := (pg_temp.q_as(v_fin, format('select public.raise_safety_concern(%L, %L, %L, null, null, true)', 'colleague_conduct', 'high', v_text2 || ' again')))::uuid;
  perform pg_temp.ck('a concern marked "about the lead" is independent-only too', 'independent_only', (select routing from public.safety_concerns where id = v_about));
  perform pg_temp.ck('...neither lead can read or act on it', '0/0/ERR:concern not found', pg_temp.q_as(v_cmo, format('select count(*) from public.safety_concerns where id = %L', v_about)) || '/' || pg_temp.q_as(v_cmo2, format('select count(*) from public.safety_concerns where id = %L', v_about)) || '/' || pg_temp.q_as(v_cmo, format('select public.respond_to_safety_concern(%L, %L)', v_about, 'I will handle this myself and close it today.')));
  perform pg_temp.ck('...the independent reader responds and the raiser sees the reply', 'ok', pg_temp.try_as(v_ind, format('select public.respond_to_safety_concern(%L, %L)', v_about, 'Thank you. I am looking at this independently of the lead.')));
  perform pg_temp.ck('...and the raiser reads that reply', 'true', (pg_temp.q_as(v_fin, 'select public.my_safety_concerns()')::text like '%independently of the lead%')::text);
    perform pg_temp.ck('the last independent reader cannot be removed while such a concern is open', 'ERR:an open concern needs this independent reader; name another independent reader first', pg_temp.q_as(v_cmo, format('select public.remove_safety_concern_backup_reader(%L)', v_ind)));
  perform pg_temp.ck('...with a second independent reader named, one can be removed', 'ok', pg_temp.try_as(v_cmo, format('select public.add_safety_concern_backup_reader(%L, null, %L)', v_ind2, 'independent')));
  perform pg_temp.ck('...removal now works', 'ok', pg_temp.try_as(v_cmo, format('select public.remove_safety_concern_backup_reader(%L)', v_ind)));
  perform pg_temp.ck('...and a removed independent reader sees nothing', '0', pg_temp.q_as(v_ind, 'select count(*) from public.safety_concerns'));
  -- 8d. a retaliation review follows the concern's route
  perform private.note_adverse_action(v_fin, 'status_suspended', 'proof-ref-1');
  perform pg_temp.ck('a retaliation review for someone who spoke up about the lead is independent-only', 'independent_only', (select routing from public.retaliation_reviews where clinician_id = v_fin and trigger_ref = 'proof-ref-1'));
  perform pg_temp.ck('...the lead cannot see it', '0', pg_temp.q_as(v_cmo, 'select count(*) from public.retaliation_reviews'));
  perform pg_temp.ck('...nor open the queue contents', '[]', pg_temp.q_as(v_cmo, 'select public.retaliation_review_queue()'));
  perform pg_temp.ck('...nor close it', 'ERR:not available', pg_temp.q_as(v_cmo, format('select public.close_retaliation_review(%L, %L, %L)', (select id from public.retaliation_reviews where trigger_ref = 'proof-ref-1'), 'no_link', 'A long enough note about this.')));
  perform pg_temp.ck('...the independent reader sees and closes it', '1/ok', pg_temp.q_as(v_ind2, 'select count(*) from public.retaliation_reviews') || '/' || pg_temp.try_as(v_ind2, format('select public.close_retaliation_review(%L, %L, %L)', (select id from public.retaliation_reviews where trigger_ref = 'proof-ref-1'), 'no_link', 'Checked with the raiser, no link found.')));
end $$;

-- 9. Q2: anonymous intake, status tracking, detriment check-ins, the board report ---------------------------------------------
do $$
declare
  v_cmo uuid := pg_temp.f('cmo'); v_cmo2 uuid := pg_temp.f('cmo2'); v_fin uuid := pg_temp.f('fin'); v_oth uuid := pg_temp.f('other'); v_adm uuid := pg_temp.f('admin');
  v_ind2 uuid := pg_temp.f('indep2'); v_org uuid := pg_temp.f('org'); v_std uuid := pg_temp.f('c_std');
  v_code text; v_anon uuid; v_audit_before bigint; v_ev_before bigint; v_n integer; v_chk uuid; v_sw jsonb; v_notes_before bigint; v_i integer; v_msg text; v_rid uuid;
  v_text3 text := 'pineapple harbour anonymous worry about a repeated shortcut on nights';
begin
  select count(*) into v_audit_before from public.audit_log;
  select count(*) into v_ev_before from public.domain_events;
  v_code := pg_temp.q_as(v_fin, format('select public.raise_anonymous_safety_concern(%L, %L, %L)', 'patient_safety', 'high', v_text3));
  perform pg_temp.ck('an anonymous concern returns a one-time follow-up code', 'true', (v_code ~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$')::text);
  select id into v_anon from public.safety_concerns where anonymous order by created_at desc limit 1;
  perform pg_temp.ck('...no raiser id is stored', 'true/true', (select (raised_by is null)::text || '/' || (anonymous)::text from public.safety_concerns where id = v_anon));
  perform pg_temp.ck('...only a hash of the code is stored, never the code', 'true', (select (follow_up_code_hash <> replace(v_code, '-', '') and length(follow_up_code_hash) = 64)::text from public.safety_concerns where id = v_anon));
  perform pg_temp.ck('...the messages carry no author', '0', (select count(*)::text from public.safety_concern_messages where concern_id = v_anon and author_id is not null));
  perform pg_temp.ck('...raising it wrote no audit_log row and no domain event', '0/0', ((select count(*) from public.audit_log) - v_audit_before)::text || '/' || ((select count(*) from public.domain_events) - v_ev_before)::text);
  perform pg_temp.ck('...the lead''s notice does not name the raiser or the words', 'true',
    (select (count(*) >= 1 and bool_and(payload::text not like '%' || v_fin::text || '%' and payload::text not ilike '%pineapple%'))::text from public.notifications where recipient_id = v_cmo and payload ->> 'subject' = 'A new item needs your attention' and created_at > now() - interval '1 minute'));
  perform pg_temp.ck('the raiser cannot read it through the table (nothing links it to them)', '0', pg_temp.q_as(v_fin, 'select count(*) from public.safety_concerns where anonymous'));
  perform pg_temp.ck('a colleague and an admin account cannot read it', '0/0', pg_temp.q_as(v_oth, 'select count(*) from public.safety_concerns where anonymous') || '/' || pg_temp.q_as(v_adm, 'select count(*) from public.safety_concerns where anonymous'));
  perform pg_temp.ck('the lead reads it, with no name', 'null/true', (select coalesce(jsonb_path_query_first(pg_temp.q_as(v_cmo, 'select public.safety_concern_inbox()')::jsonb, '$[*] ? (@.anonymous == true).raised_by_name')::text, 'x') || '/' || 'true'));
  perform pg_temp.ck('anon cannot call the anonymous functions', 'false/false', has_function_privilege('anon', 'public.raise_anonymous_safety_concern(text, text, text, boolean)', 'EXECUTE')::text || '/' || has_function_privilege('anon', 'public.anonymous_concern_status(text)', 'EXECUTE')::text);
  -- the way back is the code
  perform pg_temp.ck('the code gives the status', 'new', (pg_temp.q_as(v_oth, format('select public.anonymous_concern_status(%L)', v_code))::jsonb ->> 'state'));
  perform pg_temp.ck('...whatever its case or dashes', 'new', (pg_temp.q_as(v_fin, format('select public.anonymous_concern_status(%L)', lower(replace(v_code, '-', ' '))))::jsonb ->> 'state'));
  perform pg_temp.ck('a wrong code finds nothing', 'ERR:that code was not found', pg_temp.q_as(v_fin, format('select public.anonymous_concern_status(%L)', '0000-0000-0000-0000')));
  perform pg_temp.ck('the raiser adds to it with the code', 'ok', pg_temp.try_as(v_fin, format('select public.add_to_anonymous_concern(%L, %L)', v_code, 'One more detail about the shortcut.')));
  perform pg_temp.ck('the lead acknowledges and responds', 'ok', pg_temp.try_as(v_cmo, format('select public.acknowledge_safety_concern(%L)', v_anon)));
  perform pg_temp.ck('...responding does not fail for a raiser with no id', 'ok', pg_temp.try_as(v_cmo, format('select public.respond_to_safety_concern(%L, %L)', v_anon, 'Thank you, we are looking into the shortcut on nights.')));
  v_msg := pg_temp.q_as(v_fin, format('select public.anonymous_concern_status(%L)', v_code));
  perform pg_temp.ck('...and the status shows the reply to whoever holds the code', 'responded/true', (v_msg::jsonb ->> 'state') || '/' || (v_msg like '%looking into the shortcut%')::text);
  -- the per-organisation daily cap on routine anonymous concerns; high or immediate ones are never refused
  for v_i in 1..10 loop v_msg := pg_temp.q_as(v_fin, format('select public.raise_anonymous_safety_concern(%L, %L, %L)', 'something_else', 'low', 'filler anonymous concern number ' || v_i || ' for the cap')); end loop;
  perform pg_temp.ck('after ten routine anonymous concerns in a day the next routine one is slowed', 'true', (pg_temp.q_as(v_fin, format('select public.raise_anonymous_safety_concern(%L, %L, %L)', 'something_else', 'low', 'one routine concern too many today')) like 'ERR:many anonymous%')::text);
  perform pg_temp.ck('...but a high one still goes through', 'true', (pg_temp.q_as(v_fin, format('select public.raise_anonymous_safety_concern(%L, %L, %L)', 'patient_safety', 'high', 'a serious worry that cannot wait today')) !~ '^ERR')::text);

  -- check-ins at 30 and 90 days (inert until the signed configuration carries checkin_days; this proof runs with version 2 active)
  update public.safety_concerns set created_at = now() - interval '31 days' where id = v_std;
  update public.safety_concerns set created_at = now() - interval '31 days' where id = v_anon;
  select count(*) into v_notes_before from public.notifications where recipient_id = v_fin and payload ->> 'subject' = 'A quick check-in';
  v_sw := private.safety_concern_sweep();
  perform pg_temp.ck('no check-in is sent for a concern raised before the configuration took effect (no burst on signing)', '0', (select count(*)::text from public.safety_concern_checkins where concern_id = v_std));
  -- move the effective date back (test-only edit, guard off for the one update) so the proof can exercise the windows
  alter table public.quality_config disable trigger quality_config_guard;
  update public.quality_config set effective_from = '2026-01-01' where is_active;
  alter table public.quality_config enable trigger quality_config_guard;
  v_sw := private.safety_concern_sweep();
  perform pg_temp.ck('a 30-day check-in is created for a concern 31 days old', '1', (select count(*)::text from public.safety_concern_checkins where concern_id = v_std and window_days = 30));
  perform pg_temp.ck('...not yet the 90-day one', '0', (select count(*)::text from public.safety_concern_checkins where concern_id = v_std and window_days = 90));
  perform pg_temp.ck('the raiser got it in-app and by email, in neutral words', 'true/true',
    (select (count(*) filter (where channel = 'in_app') = 1 and count(*) filter (where channel = 'email') = 1)::text from public.notifications where recipient_id = v_fin and payload ->> 'subject' = 'A quick check-in' and created_at > now() - interval '1 minute')
    || '/' || (select (bool_and(payload::text not ilike '%zebrafish%' and payload::text not ilike '%handover%' and payload ->> 'message' not ilike '%concern%' and payload ->> 'message' not ilike '%safety%'))::text from public.notifications where recipient_id = v_fin and payload ->> 'subject' = 'A quick check-in'));
  perform pg_temp.ck('...an anonymous concern gets a check-in row and no notice (nobody to send it to)', '1/0', (select count(*)::text from public.safety_concern_checkins where concern_id = v_anon and window_days = 30) || '/' || ((select count(*) from public.notifications where payload ->> 'subject' = 'A quick check-in' and recipient_id is null)::text));
  perform private.safety_concern_sweep();
  perform pg_temp.ck('...the sweep is idempotent', '1', (select count(*)::text from public.safety_concern_checkins where concern_id = v_std and window_days = 30));
  update public.safety_concerns set created_at = now() - interval '91 days' where id = v_std;
  perform private.safety_concern_sweep();
  perform pg_temp.ck('at 91 days the 90-day check-in follows', '1', (select count(*)::text from public.safety_concern_checkins where concern_id = v_std and window_days = 90));
  select id into v_chk from public.safety_concern_checkins where concern_id = v_std and window_days = 30;
  perform pg_temp.ck('the raiser sees the check-in on their status', 'true', (pg_temp.q_as(v_fin, 'select public.my_safety_concerns()')::text like '%"window_days": 30%')::text);
  perform pg_temp.ck('someone else cannot answer it', 'ERR:check-in not found', pg_temp.q_as(v_oth, format('select public.answer_concern_checkin(%L, %L)', v_chk, 'fine')));
  perform pg_temp.ck('an unknown answer is refused', 'ERR:answer fine or problem', pg_temp.q_as(v_fin, format('select public.answer_concern_checkin(%L, %L)', v_chk, 'maybe')));
  perform pg_temp.ck('the raiser answers "fine"', 'ok', pg_temp.try_as(v_fin, format('select public.answer_concern_checkin(%L, %L)', v_chk, 'fine')));
  perform pg_temp.ck('...once only', 'ERR:this check-in was already answered', pg_temp.q_as(v_fin, format('select public.answer_concern_checkin(%L, %L)', v_chk, 'fine')));
  select id into v_chk from public.safety_concern_checkins where concern_id = v_std and window_days = 90;
  perform pg_temp.ck('answering "problem" is accepted', 'ok', pg_temp.try_as(v_fin, format('select public.answer_concern_checkin(%L, %L, %L)', v_chk, 'problem', 'My shifts were cut after I spoke up.')));
  perform pg_temp.ck('...and opens a retaliation review for the lead', '1/standard',
    (select count(*)::text || '/' || coalesce(min(routing), '') from public.retaliation_reviews where clinician_id = v_fin and trigger_kind = 'raiser_reported'));
  perform pg_temp.ck('...and the answer reaches the reader in the concern thread', 'true', (pg_temp.q_as(v_cmo, 'select public.safety_concern_inbox()')::text like '%My shifts were cut%')::text);
  perform pg_temp.ck('...and not an audit_log row, a domain event or a notice with those words', '0/0/0',
    (select count(*)::text from public.audit_log where event::text like '%My shifts were cut%') || '/' || (select count(*)::text from public.domain_events where payload::text like '%My shifts were cut%')
    || '/' || (select count(*)::text from public.notifications where payload::text like '%My shifts were cut%'));
  -- the anonymous way: the code answers a check-in; a "problem" cannot open a review about nobody, but reaches the lead
  select id into v_chk from public.safety_concern_checkins where concern_id = v_anon and window_days = 30;
  perform pg_temp.ck('an anonymous raiser answers a check-in with the code', 'ok', pg_temp.try_as(v_oth, format('select public.answer_concern_checkin(%L, %L, %L, %L)', v_chk, 'problem', 'Colleagues have stopped talking to me.', v_code)));
  perform pg_temp.ck('...a wrong code does not', 'ERR:that code was not found', pg_temp.q_as(v_oth, format('select public.answer_concern_checkin(%L, %L, %L, %L)', v_chk, 'fine', null, '1111-1111-1111-1111')));

  -- the board report: counts only
  v_msg := pg_temp.q_as(v_cmo, 'select public.safety_concern_board_report()');
  perform pg_temp.ck('the lead''s board report counts the concerns the lead may know of', (select count(*)::text from public.safety_concerns where organisation_id = v_org and is_test and routing = 'standard'), (v_msg::jsonb ->> 'total'));
  perform pg_temp.ck('...by state, adding up to the total', 'true', (select (((v_msg::jsonb -> 'by_state' ->> 'new')::int + (v_msg::jsonb -> 'by_state' ->> 'acknowledged')::int + (v_msg::jsonb -> 'by_state' ->> 'responded')::int + (v_msg::jsonb -> 'by_state' ->> 'closed')::int) = (v_msg::jsonb ->> 'total')::int)::text));
  perform pg_temp.ck('...and by age bucket', 'true', (v_msg::jsonb -> 'open_by_age_days' ? 'over_90')::text);
  perform pg_temp.ck('...with no concern words, names or ids in it', '0', (select count(*)::text from (values ('zebrafish'), ('marmalade'), ('pineapple'), (v_std::text), (v_fin::text), ('night'), ('handover')) w(x) where v_msg ilike '%' || x || '%'));
  perform pg_temp.ck('a clinician and an admin account are refused the report', 'ERR:not available/ERR:not available', pg_temp.q_as(v_oth, 'select public.safety_concern_board_report()') || '/' || pg_temp.q_as(v_adm, 'select public.safety_concern_board_report()'));
  perform pg_temp.ck('an independent reader may read it', 'true', (pg_temp.q_as(v_ind2, 'select public.safety_concern_board_report()') !~ '^ERR')::text);
  perform pg_temp.ck('anon cannot', 'false', has_function_privilege('anon', 'public.safety_concern_board_report()', 'EXECUTE')::text);
end $$;


-- 9b. Q2 follow-ups from review: reader validity, the board report and the lead, the last independent reader, reminders ----------------
do $$
declare
  v_cmo uuid := pg_temp.f('cmo'); v_fin uuid := pg_temp.f('fin'); v_rdr uuid := pg_temp.mkdoc(pg_temp.f('org'), 'rdr3', 'senior_medical_officer', 'contracted', '{}', pg_temp.f('admin')); v_ind2 uuid := pg_temp.f('indep2'); v_c1 uuid := pg_temp.f('c1');
  v_org uuid := pg_temp.f('org'); v_std uuid := pg_temp.f('c_std'); v_x uuid; v_n_ind integer; v_lead_total text; v_ind_total text;
  v_text4 text := 'kumquat signal about the clinical lead handling of a rota change last week';
begin
  -- a clinician reader who stops working stops reading
  perform pg_temp.ck('a clinician reader is named', 'ok', pg_temp.try_as(v_cmo, format('select public.add_safety_concern_backup_reader(%L, %L)', v_rdr, 'senior colleague')));
  update public.safety_concerns set escalated_at = now() where id = v_std;
  perform pg_temp.ck('...and reads an escalated concern while working', '1', pg_temp.q_as(v_rdr, format('select count(*) from public.safety_concerns where id = %L', v_std)));
  perform private.suspend_clinician_internal(pg_temp.staff_of(v_rdr), 'proof suspension of a reader', null);
  perform pg_temp.ck('...but not once suspended (even though the row is still active)', '0', pg_temp.q_as(v_rdr, format('select count(*) from public.safety_concerns where id = %L', v_std)));
  perform pg_temp.ck('...and is no longer a reader by status', 'false', (pg_temp.q_as(v_rdr, 'select public.my_reader_status()')::jsonb ->> 'is_reader'));

  -- the board report leaves independent-only concerns out for the lead and counts them for the independent reader
  v_lead_total := (pg_temp.q_as(v_cmo, 'select public.safety_concern_board_report()')::jsonb ->> 'total');
  v_ind_total := (pg_temp.q_as(v_ind2, 'select public.safety_concern_board_report()')::jsonb ->> 'total');
  perform pg_temp.ck('the lead''s board report does not count concerns by or about the lead', (select count(*)::text from public.safety_concerns where organisation_id = v_org and is_test and routing = 'independent_only'),
    (v_ind_total::int - v_lead_total::int)::text);

  -- the last independent reader cannot be turned into a clinician reader while an independent-only concern is open
  perform pg_temp.ck('a second independent reader is named', 'ok', pg_temp.try_as(v_cmo, format('select public.add_safety_concern_backup_reader(%L, null, %L)', v_c1, 'independent')));
  perform pg_temp.ck('...so the first can be removed', 'ok', pg_temp.try_as(v_cmo, format('select public.remove_safety_concern_backup_reader(%L)', v_ind2)));
  perform pg_temp.ck('...but the last cannot be re-named as a clinician reader', 'ERR:an open concern needs this independent reader; name another independent reader first',
    pg_temp.q_as(v_cmo, format('select public.add_safety_concern_backup_reader(%L, null, %L)', v_c1, 'clinician')));

  -- a reminder for an independent-only concern does not hide the later "needs a response" notice
  v_x := (pg_temp.q_as(v_fin, format('select public.raise_safety_concern(%L, %L, %L, null, null, true)', 'colleague_conduct', 'medium', v_text4)))::uuid;
  update public.safety_concerns set acknowledge_due_at = now() - interval '1 hour' where id = v_x;
  perform private.safety_concern_sweep();
  perform pg_temp.ck('the overdue reminder is recorded on its own marker', 'true/true', (select (independent_reminded_at is not null)::text || '/' || (respond_overdue_notified_at is null)::text from public.safety_concerns where id = v_x));
  update public.safety_concerns set respond_due_at = now() - interval '1 hour' where id = v_x;
  perform private.safety_concern_sweep();
  perform pg_temp.ck('...so the later response notice still goes out', 'true', (select (respond_overdue_notified_at is not null)::text from public.safety_concerns where id = v_x));

  -- no independent reader at all: raising an independent-only concern makes the gap visible at once, without its words
  update public.safety_concern_readers set active = false where kind = 'independent';
  update public.ops_incidents set status = 'resolved' where external_reference = 'clinical_safety_overdue' and status not in ('resolved', 'closed');
  perform pg_temp.q_as(v_fin, format('select public.raise_safety_concern(%L, %L, %L, null, null, true)', 'colleague_conduct', 'medium', v_text4 || ' again'));
  perform pg_temp.ck('a neutral incident is opened at once when nobody may read it', '1/true', (select count(*)::text || '/' || bool_and(summary not ilike '%kumquat%')::text from public.ops_incidents where external_reference = 'clinical_safety_overdue' and status not in ('resolved', 'closed')));
end $$;

-- 10. Q2: leaks. Operations and admin accounts read nothing; no view, export function, event, log or incident names a concern ----
do $$
declare
  v_adm uuid := pg_temp.f('admin'); v_adm2 uuid := pg_temp.f('admin2'); u text; v_t text; v_list text;
begin
  foreach u in array array['admin', 'admin2'] loop
    foreach v_t in array array['safety_concerns', 'safety_concern_messages', 'safety_concern_readers', 'safety_concern_checkins', 'retaliation_reviews'] loop
      perform pg_temp.ck(u || ' reads zero rows of ' || v_t, '0', pg_temp.q_as(pg_temp.f(u), format('select count(*) from public.%I', v_t)));
    end loop;
    perform pg_temp.ck(u || ': empty inbox, refused report, not a reader', '[]/ERR:not available/false', pg_temp.q_as(pg_temp.f(u), 'select public.safety_concern_inbox()') || '/' || pg_temp.q_as(pg_temp.f(u), 'select public.safety_concern_board_report()') || '/' || (pg_temp.q_as(pg_temp.f(u), 'select public.my_reader_status()')::jsonb ->> 'is_reader'));
  end loop;
  perform pg_temp.ck('no view or materialised view reads a concern table', '0', (
    select count(*)::text from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class c on c.oid = r.ev_class
     where d.refobjid in ('public.safety_concerns'::regclass, 'public.safety_concern_messages'::regclass, 'public.safety_concern_readers'::regclass, 'public.safety_concern_checkins'::regclass, 'public.retaliation_reviews'::regclass)
       and c.relkind in ('v', 'm') and d.classid = 'pg_rewrite'::regclass));
  -- the only public functions that touch a concern table are the speak-up functions themselves (a new export function would have to be added here on purpose)
  select string_agg(p.proname, ',' order by p.proname) into v_list from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~* '(safety_concerns|safety_concern_messages|safety_concern_checkins|safety_concern_readers|retaliation_reviews)'
     and p.proname not in ('raise_safety_concern', 'raise_anonymous_safety_concern', 'my_safety_concerns', 'safety_concern_inbox', 'acknowledge_safety_concern', 'respond_to_safety_concern',
                           'add_to_safety_concern', 'close_safety_concern', 'open_incident_for_concern', 'add_safety_concern_backup_reader', 'remove_safety_concern_backup_reader',
                           'retaliation_review_queue', 'close_retaliation_review', 'anonymous_concern_status', 'add_to_anonymous_concern', 'answer_concern_checkin',
                           'safety_concern_board_report', 'my_reader_status');
  perform pg_temp.ck('no other public function reads or exports concerns', '', coalesce(v_list, ''));
  perform pg_temp.ck('no domain event, audit_log row, notice or incident carries a concern''s words or ids', '0/0/0/0',
    (select count(*)::text from public.domain_events where payload::text ~* 'zebrafish|marmalade|pineapple|kumquat' or event_type like 'safety_concern%')
    || '/' || (select count(*)::text from public.audit_log where event::text ~* 'zebrafish|marmalade|pineapple|kumquat' or action like 'safety_concern%')
    || '/' || (select count(*)::text from public.notifications where payload::text ~* 'zebrafish|marmalade|pineapple|quartz|lantern|kumquat')
    || '/' || (select count(*)::text from public.ops_incidents where (title || ' ' || summary) ~* 'zebrafish|marmalade|pineapple|kumquat'));
  perform pg_temp.ck('every anonymous-concern function is closed to anon and the concern tables to direct writes', 'false/false',
    (has_table_privilege('authenticated', 'public.safety_concerns', 'INSERT') or has_table_privilege('authenticated', 'public.safety_concern_checkins', 'UPDATE'))::text || '/' || has_table_privilege('anon', 'public.safety_concern_checkins', 'SELECT')::text);
end $$;

-- 11. Q6: licences. Notices, the proof deadline, shift exclusion, the nightly net, missing dates, grace, evidence --------------------
create function pg_temp.mkrota(p_org uuid, p_start timestamptz, p_end timestamptz, p_primary uuid, p_backup uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test) values (p_org, p_start, p_end, p_primary, p_backup, true) returning id into v;
  perform set_config('tarragon.lead_write', 'off', true);
  return v;
end $f$;

do $$
declare
  v_org uuid := pg_temp.f('org'); v_adm uuid := pg_temp.f('admin'); v_cmo uuid := pg_temp.f('cmo'); v_cmo2 uuid := pg_temp.f('cmo2'); v_c1 uuid := pg_temp.f('c1'); v_c2 uuid := pg_temp.f('c2');
  v_rdr uuid := pg_temp.f('rdr'); v_oth uuid := pg_temp.f('other'); v_fin uuid := pg_temp.f('fin'); r record; v_n integer; v_s1 uuid; v_s2 uuid; v_rota uuid; v_rota2 uuid; v_sw jsonb;
  v_today date := (now() at time zone 'Africa/Lagos')::date; v_dead date; v_end date; v_res text; v_blk integer;
begin
  -- 11a. the guard: version 3 turns "a missing date is ineligible" on; it cannot be activated while an active clinician has no date
  perform pg_temp.ck('credentialing_config v4 exists inactive', 'false', (select is_active::text from public.credentialing_config where version = 4));
  perform pg_temp.ck('...v4 carries the 90/30/7/0 notices and the 15 December proof deadline', '[90, 30, 7, 0]/12-15',
    (select (rules -> 'notice_windows_days')::text || '/' || (rules -> 'renewal_cycle' ->> 'proof_deadline_month') || '-' || (rules -> 'renewal_cycle' ->> 'proof_deadline_day') from public.credentialing_config where version = 4));
  perform pg_temp.ck('the legacy no-date rows block the switch (nobody is stranded)', '23514',
    pg_temp.try_sql($q$update public.credentialing_config set is_active = false where is_active; update public.credentialing_config set is_active = true where version = 4$q$));
  perform pg_temp.ck('signing is refused while an active clinician has no licence date', 'true', (pg_temp.q_as(v_cmo, 'select public.sign_credentialing_config(4)') like 'ERR:record the licence expiry date%')::text);
  update public.clinical_staff set license_expires_at = now() + interval '400 days' where is_test and license_expires_at is null;
  perform pg_temp.ck('only the chief medical officer can sign a credentialing version', 'ERR:only the chief medical officer can sign the credentialing rules', pg_temp.q_as(v_oth, 'select public.sign_credentialing_config(4)'));
  perform pg_temp.ck('...and anon cannot', 'false', has_function_privilege('anon', 'public.sign_credentialing_config(integer)', 'EXECUTE')::text);
  perform pg_temp.ck('the CMO signs version 4 once dates are recorded', 'ok', pg_temp.try_as(v_cmo, 'select public.sign_credentialing_config(4)'));
  perform pg_temp.ck('...it is signed and in force, the older version off', 'true/true/false', (select (approved_at is not null)::text || '/' || is_active::text from public.credentialing_config where version = 4) || '/' || (select is_active::text from public.credentialing_config where version = 3));
  perform pg_temp.ck('...signing it again is refused', 'ERR:that version is already signed', pg_temp.q_as(v_cmo, 'select public.sign_credentialing_config(4)'));
  perform pg_temp.ck('with dates recorded, version 4 can be switched on (in this proof only)', '4', (select version::text from public.credentialing_config where is_active));

  -- 11b. a missing licence date is ineligible, shows as a blocker, and the nightly net removes the clinician
  v_s1 := pg_temp.staff_of(v_oth);
  perform pg_temp.ck('a dated clinician is eligible', 'true', private.clinician_is_eligible(v_oth)::text);
  update public.clinical_staff set license_expires_at = null where id = v_s1;
  perform pg_temp.ck('a missing licence date is ineligible once the configuration says so', 'false', private.clinician_is_eligible(v_oth)::text);
  perform pg_temp.ck('...and the clinician sees why', 'true', (pg_temp.q_as(v_oth, 'select public.my_credential_status()')::jsonb -> 'blockers' ? 'licence_date_missing')::text);
  v_sw := private.remove_ineligible_from_work();
  perform pg_temp.ck('...the nightly net clears their rota hours', '0', pg_temp.live_blocks(v_oth));
  update public.clinical_staff set license_expires_at = now() + interval '400 days' where id = v_s1;
  perform pg_temp.ck('...recording a date makes them eligible again', 'true', private.clinician_is_eligible(v_oth)::text);

  -- 11c. notices at 90/30/7/0 days
  v_s1 := pg_temp.staff_of(v_c1); v_s2 := pg_temp.staff_of(v_c2);
  update public.clinical_staff set license_expires_at = now() + interval '6 days' where id = v_s1;
  perform private.credential_expiry_sweep();
  perform pg_temp.ck('six days out, the 7-day notice is the one recorded', '1', (select count(*)::text from public.credential_expiry_notices where clinical_staff_id = v_s1 and kind = 'licence' and window_days = 7 and was_sent));
  perform pg_temp.ck('...the clinician was told once, in app and by email', 'true', (select (count(*) filter (where channel = 'in_app') = 1 and count(*) filter (where channel = 'email') = 1)::text from public.notifications where recipient_id = v_c1 and template = 'credential_notice' and payload ->> 'kind' = 'licence'));
  perform private.credential_expiry_sweep();
  perform pg_temp.ck('...and the sweep does not repeat it', '2', (select count(*)::text from public.notifications where recipient_id = v_c1 and template = 'credential_notice' and payload ->> 'kind' = 'licence'));
  update public.clinical_staff set license_expires_at = now() + interval '45 days' where id = v_s2;
  perform private.credential_expiry_sweep();
  perform pg_temp.ck('45 days out, the 90-day window is the one in force', '1', (select count(*)::text from public.credential_expiry_notices where clinical_staff_id = v_s2 and kind = 'licence' and window_days = 90 and was_sent));
  update public.clinical_staff set license_expires_at = now() + interval '400 days' where id in (v_s1, v_s2);

  -- 11d. the proof-of-renewal deadline (pinned to yesterday for the proof; the real value is 15 December)
  v_dead := v_today - 1; v_end := least(v_today + 30, make_date(extract(year from v_today)::int, 12, 31));
  if extract(doy from v_today) > 2 and v_end > v_today then
    update public.credentialing_config set rules = jsonb_set(rules, '{renewal_cycle}', jsonb_build_object('cycle_end_month', extract(month from v_end)::int, 'cycle_end_day', extract(day from v_end)::int,
        'proof_deadline_month', extract(month from v_dead)::int, 'proof_deadline_day', extract(day from v_dead)::int)) where version = 4;
    update public.clinical_staff set license_expires_at = (v_today + 3)::timestamptz + interval '12 hours' where id = v_s2;
    perform private.credential_expiry_sweep();
    perform pg_temp.ck('past the proof deadline, a licence still ending with the cycle is flagged once (clinician and reviewers)', '1',
      (select count(*)::text from public.credential_expiry_notices where clinical_staff_id = v_s2 and kind = 'licence' and window_days = -1));
    perform pg_temp.ck('...the clinician got a plain request, the admin reviewer was told', 'true/true',
      (select (count(*) >= 1)::text from public.notifications where recipient_id = v_c2 and payload ->> 'subject' = 'Your licence renewal proof is due') || '/' ||
      (select (count(*) >= 1)::text from public.notifications where recipient_id = v_adm and payload ->> 'subject' = 'Clinician renewal proof overdue'));
    perform private.credential_expiry_sweep();
    perform pg_temp.ck('...and it is not repeated', '1', (select count(*)::text from public.credential_expiry_notices where clinical_staff_id = v_s2 and kind = 'licence' and window_days = -1));
    perform pg_temp.ck('a clinician who already renewed past the cycle is not flagged', '0', (select count(*)::text from public.credential_expiry_notices where clinical_staff_id = v_s1 and kind = 'licence' and window_days = -1));
  else
    perform pg_temp.ck('(proof deadline checks skipped: too close to the new year to pin the cycle)', 'x', 'x');
  end if;
  update public.clinical_staff set license_expires_at = now() + interval '400 days' where id in (v_s1, v_s2);

  -- 11e. availability and the rota exclude shifts that start after the cover ends
  update public.clinical_staff set license_expires_at = now() + interval '2 days' where id = v_s1;
  perform pg_temp.ck('a block that starts after the licence ends is refused', '22023',
    pg_temp.try_sql(format('insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test) values (%L, %L, now() + interval ''5 days'', now() + interval ''5 days 4 hours'', ''queue'', true)', v_org, v_c1)));
  perform pg_temp.ck('...one that starts while the licence is valid is accepted', 'ok',
    pg_temp.try_sql(format('insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test) values (%L, %L, now() + interval ''1 day'', now() + interval ''1 day 4 hours'', ''queue'', true)', v_org, v_c1)));
  -- ...and a block accepted while cover was valid is cancelled by the nightly net once the cover is cut short
  update public.clinical_staff set license_expires_at = now() + interval '400 days' where id = v_s1;
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test) values (v_org, v_c1, now() + interval '4 days', now() + interval '4 days 4 hours', 'queue', true);
  select count(*) into v_blk from public.availability_blocks where clinician_id = v_c1 and state <> 'cancelled' and starts_at > now();
  update public.clinical_staff set license_expires_at = now() + interval '2 days' where id = v_s1;
  v_rota := pg_temp.mkrota(v_org, now() + interval '5 days', now() + interval '5 days 8 hours', v_cmo, v_c1);
  v_rota2 := pg_temp.mkrota(v_org, now() + interval '6 days', now() + interval '6 days 8 hours', v_c1, v_cmo2);
  v_sw := private.remove_ineligible_from_work();
  perform pg_temp.ck('the nightly net cancels future blocks that start after expiry (and keeps the earlier ones)', 'true', (
    select (count(*) filter (where state <> 'cancelled' and starts_at > now() + interval '3 days') = 0 and count(*) filter (where state <> 'cancelled' and starts_at < now() + interval '3 days' and starts_at > now()) >= 1)::text
      from public.availability_blocks where clinician_id = v_c1));
  perform pg_temp.ck('...a backup slot after expiry is stripped (the primary stays)', 'true/', (select (primary_clinician_id = v_cmo)::text || '/' || coalesce(backup_clinician_id::text, '') from public.on_call_rota where id = v_rota));
  perform pg_temp.ck('...a primary slot after expiry passes to the eligible backup', v_cmo2::text, (select primary_clinician_id::text from public.on_call_rota where id = v_rota2));
  perform pg_temp.ck('...the clinician is told in plain words', 'true', (select (count(*) >= 1 and bool_and(payload ->> 'message' ilike '%licence or indemnity ends before they start%'))::text from public.notifications where recipient_id = v_c1 and payload ->> 'subject' = 'Some future shifts were removed'));
  perform pg_temp.ck('...the result reports what it trimmed', 'true', ((v_sw -> 'shifts_trimmed' ->> 'rota_rows_changed')::int >= 2)::text);
  update public.clinical_staff set license_expires_at = now() + interval '400 days' where id = v_s1;

  -- 11f. a rota-only clinician (on the rota, no claim, no block) is inside the nightly net
  v_rota := pg_temp.mkrota(v_org, now() - interval '1 hour', now() + interval '7 hours', v_rdr, v_oth);
  perform pg_temp.ck('fixture: rdr has no claim and no live block', '0/0', (select count(*)::text from public.task_claims where clinician_id = v_rdr and ended_at is null) || '/' || pg_temp.live_blocks(v_rdr));
  update public.clinical_staff set license_expires_at = now() - interval '3 days' where profile_id = v_rdr;
  v_sw := private.remove_ineligible_from_work();
  perform pg_temp.ck('a rota-only clinician whose licence has lapsed is taken off the rota overnight', v_oth::text, (select primary_clinician_id::text from public.on_call_rota where id = v_rota));
  perform pg_temp.ck('...and counted as removed', 'true', ((v_sw ->> 'removed')::int >= 1)::text);

  -- 11g. grace: the chief medical officer only, 1 to 14 days, never self-granted
  perform pg_temp.ck('an admin account cannot grant grace', 'ERR:only the chief medical officer can grant a grace period', pg_temp.q_as(v_adm, format('select public.grant_credential_grace(%L, %L, 5, %L)', pg_temp.staff_of(v_rdr), 'licence', 'portal outage, evidence on file')));
  perform pg_temp.ck('a clinician cannot', 'ERR:only the chief medical officer can grant a grace period', pg_temp.q_as(v_oth, format('select public.grant_credential_grace(%L, %L, 5, %L)', pg_temp.staff_of(v_rdr), 'licence', 'portal outage, evidence on file')));
  perform pg_temp.ck('the chief medical officer cannot grant themselves grace', 'ERR:you cannot grant yourself a grace period', pg_temp.q_as(v_cmo, format('select public.grant_credential_grace(%L, %L, 5, %L)', pg_temp.staff_of(v_cmo), 'licence', 'portal outage, evidence on file')));
  perform pg_temp.ck('15 days is too long', 'true', (pg_temp.q_as(v_cmo, format('select public.grant_credential_grace(%L, %L, 15, %L)', pg_temp.staff_of(v_rdr), 'licence', 'portal outage, evidence on file')) like 'ERR:a grace period is between 1 and 14%')::text);
  perform pg_temp.ck('0 days is too short', 'true', (pg_temp.q_as(v_cmo, format('select public.grant_credential_grace(%L, %L, 0, %L)', pg_temp.staff_of(v_rdr), 'licence', 'portal outage, evidence on file')) like 'ERR:a grace period is between%')::text);
  perform pg_temp.ck('the chief medical officer grants 5 days to another clinician', 'ok', pg_temp.try_as(v_cmo, format('select public.grant_credential_grace(%L, %L, 5, %L)', pg_temp.staff_of(v_rdr), 'licence', 'portal outage, evidence on file')));
  perform pg_temp.ck('a direct insert longer than 14 days is refused by the table', '23514', pg_temp.try_sql(format('insert into public.credential_grace_periods (organisation_id, clinical_staff_id, kind, ends_at, reason, granted_by, is_test) values (%L, %L, ''licence'', now() + interval ''30 days'', ''a long enough reason'', %L, true)', v_org, pg_temp.staff_of(v_rdr), v_cmo)));
  perform pg_temp.ck('...and so is a direct self-grant', '42501', pg_temp.try_sql(format('insert into public.credential_grace_periods (organisation_id, clinical_staff_id, kind, ends_at, reason, granted_by, is_test) values (%L, %L, ''licence'', now() + interval ''3 days'', ''a long enough reason'', %L, true)', v_org, pg_temp.staff_of(v_rdr), v_rdr)));
  perform pg_temp.ck('the grace period made rdr eligible again', 'true', private.clinician_is_eligible(v_rdr)::text);

  -- 11h. evidence of each verification: source, checker, time
  perform pg_temp.ck('a verification records its source, the checker and the time', 'ok', pg_temp.try_as(v_adm, format('select public.record_credential_verification(%L, %L, %L, %L, now() + interval ''400 days'')', v_s1, 'licence', 'mdcn_register_lookup', 'folio checked on the register')));
  perform pg_temp.ck('...the row names the checker', 'mdcn_register_lookup/true/true', (select evidence_source || '/' || (checked_by = v_adm)::text || '/' || (checked_at > now() - interval '1 minute')::text from public.credential_verifications where clinical_staff_id = v_s1 order by checked_at desc limit 1));
  perform pg_temp.ck('...a date that differs from the record is flagged', 'false', (pg_temp.q_as(v_adm, format('select public.record_credential_verification(%L, %L, %L, null, now() + interval ''10 days'')', v_s1, 'licence', 'other'))::jsonb ->> 'matches_stored_date'));
  perform pg_temp.ck('an unknown source is refused', 'ERR:unknown evidence source', pg_temp.q_as(v_adm, format('select public.record_credential_verification(%L, %L, %L)', v_s1, 'licence', 'a friend told me')));
  perform pg_temp.ck('a clinician cannot record a verification', 'ERR:not allowed', pg_temp.q_as(v_oth, format('select public.record_credential_verification(%L, %L, %L)', v_s1, 'licence', 'other')));
  perform pg_temp.ck('nobody verifies their own credential', 'ERR:you cannot verify your own credential', pg_temp.q_as(v_cmo, format('select public.record_credential_verification(%L, %L, %L)', pg_temp.staff_of(v_cmo), 'licence', 'other')));
  perform pg_temp.ck('verifications are append only', '23514/23514', pg_temp.try_sql(format('update public.credential_verifications set evidence_source = %L', 'other')) || '/' || pg_temp.try_sql('delete from public.credential_verifications'));
  perform pg_temp.ck('the clinician reads their own verification rows, a colleague none', 'true/0', (pg_temp.q_as(v_c1, 'select count(*) from public.credential_verifications')::integer >= 1)::text || '/' || pg_temp.q_as(v_oth, 'select count(*) from public.credential_verifications'));
  perform pg_temp.ck('anon cannot record or read', 'false/false', has_function_privilege('anon', 'public.record_credential_verification(uuid, text, text, text, timestamptz)', 'EXECUTE')::text || '/' || has_table_privilege('anon', 'public.credential_verifications', 'SELECT')::text);
end $$;

-- 12. SABOTAGE: each guard removed in turn; the check that depends on it must flip ----------------------------------------------
do $$
declare
  v_fin uuid := pg_temp.f('fin'); v_cmo uuid := pg_temp.f('cmo'); v_c1 uuid := pg_temp.f('c1'); v_org uuid := pg_temp.f('org'); v_adm uuid := pg_temp.f('admin');
  v_t uuid; v_a uuid; v_rev uuid; v_id uuid; v_res text; v_oth uuid := pg_temp.f('other');
  v_safe jsonb := '{"identity_and_consent_confirmed":true,"red_flags_recognised_and_acted_on":true,"decision_within_competence_and_protocol":true,"no_unsigned_treatment_change":true,"safety_netting_and_follow_up_given":true,"escalated_when_needed":true}';
  v_q4 jsonb := '{"history_adequate":4,"reasoning_documented":4,"communication_clear":4,"plan_appropriate":4,"patient_questions_answered":4,"documentation_timely":4}';
begin
  -- (a) the reader check opened to everyone: an admin account would read an independent-only concern
  create or replace function private.concern_visible(p_routing text, p_escalated timestamptz, p_org uuid) returns boolean language sql stable security definer set search_path = '' as 'select true';
  insert into results values ('sabotaged', 'an admin account reads no independent-only concern', '0', pg_temp.q_as(v_adm, $q$select count(*) from public.safety_concerns where routing = 'independent_only'$q$));
  -- (b) the keyed draw replaced by the old public formula
  create or replace function private.sampling_draw(p_task uuid, p_month date, p_salt text) returns numeric language sql stable security definer set search_path = ''
    as 'select (abs(hashtextextended(p_task::text || '':'' || p_month::text, 0)) % 1000000) / 10000.0';
  v_id := gen_random_uuid();
  insert into results values ('sabotaged', 'the draw cannot be recomputed from public inputs', 'false',
    ((abs(hashtextextended(v_id::text || ':' || private.lagos_month(now())::text, 0)) % 1000000) / 10000.0 = private.sampling_draw(v_id, private.lagos_month(now()), 'random'))::text);
  -- (c) the config guard switched off: a used version could be edited
  alter table public.quality_config disable trigger quality_config_guard;
  insert into results values ('sabotaged', 'a used or signed quality_config version cannot be edited', '23514',
    pg_temp.try_sql($q$update public.quality_config set rules = jsonb_set(rules, '{sampling,random_rate_percent}', '77') where version = 3$q$));
  -- (d) the date check ignoring dates: a block after expiry would be accepted
  update public.clinical_staff set license_expires_at = now() + interval '2 days' where profile_id = v_c1;
  create or replace function private.credential_dates_ok(p_profile uuid, p_at timestamptz) returns boolean language sql stable security definer set search_path = '' as 'select true';
  insert into results values ('sabotaged', 'a block that starts after the licence ends is refused', '22023',
    pg_temp.try_sql(format('insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test) values (%L, %L, now() + interval ''9 days'', now() + interval ''9 days 4 hours'', ''queue'', true)', v_org, v_c1)));
  -- (e) the open gate bypassed by a fabricated opening row
  perform pg_temp.cfg('{sampling,random_rate_percent}', '0'::jsonb);
  perform pg_temp.mkblock(v_org, v_oth);
  v_t := pg_temp.finish(v_oth, 'symptom_review');
  v_a := (pg_temp.q_as(v_cmo, format('select public.request_clinical_audit(%L)', v_t)))::uuid;
  select reviewer_id into v_rev from public.clinical_audits where id = v_a;
  insert into public.clinical_audit_case_opens (organisation_id, audit_id, reader_id, role, is_test) values (v_org, v_a, v_rev, 'first', true);
  v_res := pg_temp.sub(v_rev, v_a, v_safe, v_q4, '');
  insert into results values ('sabotaged', 'a score cannot be submitted before the case file was opened', 'ERR:open the case file before you submit the audit', v_res);
  -- (f) an admin reader allowed back in
  alter table public.safety_concern_readers disable trigger safety_concern_readers_no_admin;
  insert into results values ('sabotaged', 'an admin account cannot be a safety concern reader', '23514',
    pg_temp.try_sql(format('insert into public.safety_concern_readers (organisation_id, profile_id, is_test) values (%L, %L, true)', v_org, v_adm)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S20 v2 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 6 then
    raise exception 'VACUOUS TEST: only % of 6 sabotages changed a check (%)', v_caught,
      (select string_agg(check_name || ' => ' || expected || ' / ' || coalesce(actual, 'null'), '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed: the runner treats any FAIL verdict as a failed proof.

rollback;
