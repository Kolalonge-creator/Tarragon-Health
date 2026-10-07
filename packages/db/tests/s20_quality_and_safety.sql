-- S20 proof: quality and safety (migration *_s20_quality_and_safety.sql). Spec 7.8, 9.1, 9.5; safety case 16.
--
-- Proves in one rolled-back transaction:
--   1. Grants: nothing for anon or PUBLIC; no direct writes; private helpers not callable by signed-in users.
--   2. Sampling: every red event and titration audited, a stored replayable draw for the random sample (rate 0, 100 and 10
--      percent), the per-clinician monthly floor, never a self-audit.
--   3. Scheduling an audit can never block a task completion; the failure is logged.
--   4. Scoring: the shared cases (packages/queue/fixtures/audit-scoring-cases.json, also run through Jest) through the real
--      submit_clinical_audit(); a failed safety item is unsafe whatever the score.
--   5. Reviewer rules, the logged case file (INV-10), reliability, events with ids only, who can see an audit.
--   6. Tier 1: every task audited until the count is met, the lead told once, nothing promoted, extensions.
--   7. Hand-back review: S17's threshold opens one review; the lead decides; nothing is sanctioned.
--   8. The speak-up route: admin accounts (ops) see nothing; no event or audit_log row names a concern; neutral notices;
--      overdue escalation; backup readers; a lead's own concern; neutral incidents.
--   9. Retaliation review for an adverse action against someone who spoke up (a person's decision, not the expiry sweep).
--  10. SAFETY CASE 16: an expired licence leaves the queue and the rota overnight (claims released, rota cleared, offers
--      returned, an event for S18's lead reassignment); a missing date or a grace period removes nobody.
--  11. SABOTAGE: removal turned off; the case 16 check must flip.
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
-- run a statement as a user; returns 'ok' or the error message (the message is the stable queue_* code)
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a scalar query as a user; returns the value as text, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
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
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S20 ' || p_label, 'MDCN', 'S17-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
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
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
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
  v_r := pg_temp.try_as(p_uid, format('select public.queue_complete(%L, %L::jsonb)', v_t, '{"note":"done"}'));
  if v_r <> 'ok' then raise exception 'finish: queue_complete failed: %', v_r; end if;
  return v_t;
end $f$;
create function pg_temp.audit_of(p_task uuid) returns uuid language sql as $$ select id from public.clinical_audits where task_id = p_task and state <> 'cancelled' $$;
-- change one config value inside this rolled-back transaction
create function pg_temp.cfg(p_path text[], p_value jsonb) returns void language sql as
$$ update public.quality_config set rules = jsonb_set(rules, p_path, p_value) where is_active $$;
create function pg_temp.live_blocks(p_uid uuid) returns text language sql as
$$ select count(*)::text from public.availability_blocks where clinician_id = p_uid and state <> 'cancelled' and ends_at > now() $$;

-- audit-cases-begin
create temp table audit_cases_json on commit drop as select $cases${
  "form": {
    "safety_items": [
      "s1",
      "s2"
    ],
    "quality_items": [
      "q1",
      "q2",
      "q3",
      "q4"
    ],
    "quality_max": 4
  },
  "rules": {
    "satisfactory_min": 85,
    "minor_concerns_min": 70,
    "rationale_min_chars": 20
  },
  "cases": [
    {
      "name": "all safe, full marks",
      "safety": {
        "s1": true,
        "s2": true
      },
      "quality": {
        "q1": 4,
        "q2": 4,
        "q3": 4,
        "q4": 4
      },
      "rationale": "",
      "expect": {
        "outcome": "satisfactory",
        "score": 100,
        "critical": false
      }
    },
    {
      "name": "satisfactory just above the line",
      "safety": {
        "s1": true,
        "s2": true
      },
      "quality": {
        "q1": 4,
        "q2": 4,
        "q3": 4,
        "q4": 2
      },
      "rationale": "",
      "expect": {
        "outcome": "satisfactory",
        "score": 87.5,
        "critical": false
      }
    },
    {
      "name": "81.25 is minor concerns, not satisfactory",
      "safety": {
        "s1": true,
        "s2": true
      },
      "quality": {
        "q1": 4,
        "q2": 3,
        "q3": 3,
        "q4": 3
      },
      "rationale": "One history element was missing from the note.",
      "expect": {
        "outcome": "minor_concerns",
        "score": 81.3,
        "critical": false
      }
    },
    {
      "name": "minor concerns with a reason",
      "safety": {
        "s1": true,
        "s2": true
      },
      "quality": {
        "q1": 3,
        "q2": 3,
        "q3": 3,
        "q4": 3
      },
      "rationale": "Documentation was thin on the second visit.",
      "expect": {
        "outcome": "minor_concerns",
        "score": 75,
        "critical": false
      }
    },
    {
      "name": "minor concerns without a reason is refused",
      "safety": {
        "s1": true,
        "s2": true
      },
      "quality": {
        "q1": 3,
        "q2": 3,
        "q3": 3,
        "q4": 3
      },
      "rationale": "too short",
      "expect": {
        "error": "rationale_too_short"
      }
    },
    {
      "name": "significant concerns",
      "safety": {
        "s1": true,
        "s2": true
      },
      "quality": {
        "q1": 2,
        "q2": 2,
        "q3": 2,
        "q4": 2
      },
      "rationale": "Plan did not follow the protocol steps.",
      "expect": {
        "outcome": "significant_concerns",
        "score": 50,
        "critical": false
      }
    },
    {
      "name": "a failed safety item is unsafe whatever the quality score",
      "safety": {
        "s1": true,
        "s2": false
      },
      "quality": {
        "q1": 4,
        "q2": 4,
        "q3": 4,
        "q4": 4
      },
      "rationale": "Red flag was not acted on at the time.",
      "expect": {
        "outcome": "unsafe",
        "score": 100,
        "critical": true
      }
    },
    {
      "name": "unsafe still needs a reason",
      "safety": {
        "s1": false,
        "s2": true
      },
      "quality": {
        "q1": 4,
        "q2": 4,
        "q3": 4,
        "q4": 4
      },
      "rationale": "",
      "expect": {
        "error": "rationale_too_short"
      }
    },
    {
      "name": "a missing item is refused",
      "safety": {
        "s1": true,
        "s2": true
      },
      "quality": {
        "q1": 4,
        "q2": 4,
        "q3": 4
      },
      "rationale": "",
      "expect": {
        "error": "form_items_mismatch"
      }
    },
    {
      "name": "an extra item is refused",
      "safety": {
        "s1": true,
        "s2": true,
        "s3": true
      },
      "quality": {
        "q1": 4,
        "q2": 4,
        "q3": 4,
        "q4": 4
      },
      "rationale": "",
      "expect": {
        "error": "form_items_mismatch"
      }
    },
    {
      "name": "a safety item that is not true or false is refused",
      "safety": {
        "s1": "yes",
        "s2": true
      },
      "quality": {
        "q1": 4,
        "q2": 4,
        "q3": 4,
        "q4": 4
      },
      "rationale": "",
      "expect": {
        "error": "safety_item_not_boolean"
      }
    },
    {
      "name": "a score above the maximum is refused",
      "safety": {
        "s1": true,
        "s2": true
      },
      "quality": {
        "q1": 5,
        "q2": 4,
        "q3": 4,
        "q4": 4
      },
      "rationale": "",
      "expect": {
        "error": "quality_item_out_of_range"
      }
    },
    {
      "name": "a negative score is refused",
      "safety": {
        "s1": true,
        "s2": true
      },
      "quality": {
        "q1": -1,
        "q2": 4,
        "q3": 4,
        "q4": 4
      },
      "rationale": "",
      "expect": {
        "error": "quality_item_out_of_range"
      }
    },
    {
      "name": "a fractional score is refused",
      "safety": {
        "s1": true,
        "s2": true
      },
      "quality": {
        "q1": 3.5,
        "q2": 4,
        "q3": 4,
        "q4": 4
      },
      "rationale": "",
      "expect": {
        "error": "quality_item_out_of_range"
      }
    },
    {
      "name": "a score that is not a number is refused",
      "safety": {
        "s1": true,
        "s2": true
      },
      "quality": {
        "q1": "4",
        "q2": 4,
        "q3": 4,
        "q4": 4
      },
      "rationale": "",
      "expect": {
        "error": "quality_item_out_of_range"
      }
    }
  ]
}$cases$::jsonb as j;
-- audit-cases-end

-- 0. Fixtures ------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  -- only the fixture clinicians may be offered work (a live employed doctor would otherwise be pushed it); rolled back with everything else
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{hypertension,adult_general,result_review,prescribing,on_call}', v_admin));
  perform pg_temp.setf('fin', pg_temp.mkdoc(v_org, 'fin', 'senior_medical_officer', 'contracted', '{hypertension,adult_general,result_review,prescribing,on_call}', v_admin));
  perform pg_temp.setf('t1', pg_temp.mkdoc(v_org, 't1', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_admin));
  perform pg_temp.setf('other', pg_temp.mkdoc(v_org, 'other', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_admin));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.mkblock(v_org, pg_temp.f('cmo'));
  perform pg_temp.mkblock(v_org, pg_temp.f('fin'));
  perform pg_temp.mkblock(v_org, pg_temp.f('t1'));
  perform pg_temp.mkblock(v_org, pg_temp.f('other'));
  -- sampling is off unless a check turns it on, so each check controls exactly which tasks are audited
  perform pg_temp.cfg('{sampling,random_rate_percent}', '0'::jsonb);
end $$;

-- 1. Grants: nothing for anon or PUBLIC, no direct writes, private helpers not callable -------------------------------
do $$
begin
  perform pg_temp.ck('anon cannot read safety_concerns', 'false', has_table_privilege('anon', 'public.safety_concerns', 'SELECT')::text);
  perform pg_temp.ck('signed-in users cannot write safety_concerns directly', 'false', (has_table_privilege('authenticated', 'public.safety_concerns', 'INSERT') or has_table_privilege('authenticated', 'public.safety_concerns', 'UPDATE'))::text);
  perform pg_temp.ck('signed-in users cannot write clinical_audits directly', 'false', (has_table_privilege('authenticated', 'public.clinical_audits', 'INSERT') or has_table_privilege('authenticated', 'public.clinical_audits', 'UPDATE') or has_table_privilege('authenticated', 'public.clinical_audits', 'DELETE'))::text);
  perform pg_temp.ck('anon cannot raise a concern', 'false', has_function_privilege('anon', 'public.raise_safety_concern(text, text, text, text, uuid)', 'EXECUTE')::text);
  perform pg_temp.ck('PUBLIC cannot submit an audit', 'false', has_function_privilege('anon', 'public.submit_clinical_audit(uuid, jsonb, jsonb, text)', 'EXECUTE')::text);
  perform pg_temp.ck('removal is not callable by signed-in users', 'false', has_function_privilege('authenticated', 'private.remove_clinician_from_work(uuid, text)', 'EXECUTE')::text);
  perform pg_temp.ck('the nightly job is not callable by signed-in users', 'false', has_function_privilege('authenticated', 'private.remove_ineligible_from_work()', 'EXECUTE')::text);
  perform pg_temp.ck('audit creation is not callable by signed-in users', 'false', has_function_privilege('authenticated', 'private.create_audit(uuid, text, numeric)', 'EXECUTE')::text);
end $$;

-- 2. Sampling ------------------------------------------------------------------------------------------------------
do $$
declare v_t uuid; v_a uuid; v_i integer; v_draw numeric; v_rows text; v_cmo uuid := pg_temp.f('cmo');
begin
  -- every red event is audited, and never by the clinician who did it
  v_t := pg_temp.finish(pg_temp.f('fin'), 'red_event_unacknowledged');
  v_a := pg_temp.audit_of(v_t);
  perform pg_temp.ck('a red event is audited', 'red_event', (select reason from public.clinical_audits where id = v_a));
  perform pg_temp.ck('...and assigned to the clinical lead, not the clinician', v_cmo::text, (select reviewer_id::text from public.clinical_audits where id = v_a));
  perform pg_temp.ck('...with the config and form version recorded (INV-16)', '1/1', (select config_version || '/' || form_version from public.clinical_audits where id = v_a));
  perform pg_temp.ck('...and an audit assigned event with ids only', 'true',
    (select (count(*) = 1 and bool_and(payload ? 'audit_id' and not payload ? 'description'))::text from public.domain_events where event_type = 'clinical_audit.assigned' and payload ->> 'audit_id' = v_a::text));
  -- every titration
  v_t := pg_temp.finish(pg_temp.f('fin'), 'titration_signoff');
  perform pg_temp.ck('a titration is audited', 'titration', (select reason from public.clinical_audits where task_id = v_t));
  -- the random sample: rate 0 audits nothing, rate 100 audits everything, and the stored draw explains the choice
  v_t := pg_temp.finish(pg_temp.f('fin'), 'symptom_review');
  perform pg_temp.ck('rate 0: an ordinary task is not audited', '0', (select count(*)::text from public.clinical_audits where task_id = v_t));
  perform pg_temp.cfg('{sampling,random_rate_percent}', '100'::jsonb);
  v_t := pg_temp.finish(pg_temp.f('fin'), 'symptom_review');
  perform pg_temp.ck('rate 100: an ordinary task is audited as a random sample', 'random_sample', (select reason from public.clinical_audits where task_id = v_t));
  perform pg_temp.ck('...and the draw is stored and replayable', 'true',
    (select (sample_draw is not null and sample_draw = (abs(hashtextextended(v_t::text || ':' || private.lagos_month(now())::text, 0)) % 1000000) / 10000.0)::text from public.clinical_audits where task_id = v_t));
  -- at the real 10 percent, an audit exists exactly when the draw is under 10
  perform pg_temp.cfg('{sampling,random_rate_percent}', '10'::jsonb);
  v_rows := '';
  for v_i in 1..12 loop
    v_t := pg_temp.finish(pg_temp.f('other'), 'symptom_review');
    v_draw := (abs(hashtextextended(v_t::text || ':' || private.lagos_month(now())::text, 0)) % 1000000) / 10000.0;
    if (select count(*) from public.clinical_audits where task_id = v_t) <> (case when v_draw < 10 then 1 else 0 end) then v_rows := v_rows || v_t::text || ' '; end if;
  end loop;
  perform pg_temp.ck('at 10 percent an audit exists exactly when the draw is under 10 (12 tasks)', '', v_rows);
  perform pg_temp.cfg('{sampling,random_rate_percent}', '0'::jsonb);
  -- the monthly floor: a clinician with enough completed tasks and no audit gets one, once
  perform pg_temp.ck('t1 starts with no audits this month', '0', (select count(*)::text from public.clinical_audits where clinician_id = pg_temp.f('t1')));
  perform pg_temp.cfg('{tier1,audited_task_count}', '0'::jsonb);
  perform pg_temp.finish(pg_temp.f('t1'), 'symptom_review');
  perform pg_temp.finish(pg_temp.f('t1'), 'symptom_review');
  perform pg_temp.finish(pg_temp.f('t1'), 'symptom_review');
  perform pg_temp.cfg('{tier1,audited_task_count}', '20'::jsonb);
  perform private.audit_floor_top_up(private.lagos_month(now()));
  perform pg_temp.ck('three unaudited tasks, so the floor adds exactly one audit for t1', '1', (select count(*)::text from public.clinical_audits where clinician_id = pg_temp.f('t1') and state <> 'cancelled'));
  perform pg_temp.ck('...and running it again adds nothing', '0', private.audit_floor_top_up(private.lagos_month(now()))::text);
  perform pg_temp.ck('...marked as a floor top-up', 'floor_top_up', (select reason from public.clinical_audits where clinician_id = pg_temp.f('t1') and state <> 'cancelled' order by created_at desc limit 1));
end $$;

-- 3. Scheduling can never block a completion ---------------------------------------------------------------------------
do $$
declare v_t uuid; v_before integer; v_real jsonb;
begin
  select rules into v_real from public.quality_config where is_active;
  -- a broken form in the config makes the audit insert fail (form_version is required)
  update public.quality_config set rules = jsonb_set(jsonb_set(rules, '{form}', 'null'::jsonb), '{sampling,random_rate_percent}', '100'::jsonb) where is_active;
  select count(*) into v_before from public.audit_log where action = 'clinical_audit.schedule_error';
  v_t := pg_temp.finish(pg_temp.f('fin'), 'symptom_review');
  perform pg_temp.ck('the task still completes when audit scheduling fails', 'completed', pg_temp.state_of(v_t));
  perform pg_temp.ck('...and the failure is logged for the nightly sweep', '1', ((select count(*) from public.audit_log where action = 'clinical_audit.schedule_error') - v_before)::text);
  update public.quality_config set rules = v_real where is_active;
end $$;

-- 4. The shared scoring cases (also run through the pure TypeScript model in Jest) ------------------------------------
do $$
declare
  j jsonb; c jsonb; v_t uuid; v_a uuid; v_res text; v_exp text; v_err text; n integer := 0; v_real jsonb;
begin
  select cj.j into j from audit_cases_json cj;
  select rules into v_real from public.quality_config where is_active;
  update public.quality_config set rules = rules || jsonb_build_object('form', (j -> 'form') || '{"version":1}'::jsonb, 'outcomes', j -> 'rules') where is_active;
  for c in select jsonb_array_elements(j -> 'cases') loop
    n := n + 1;
    v_t := pg_temp.finish(pg_temp.f('fin'), 'symptom_review');
    v_a := (pg_temp.q_as(pg_temp.f('cmo'), format('select public.request_clinical_audit(%L)', v_t)))::uuid;
    v_res := pg_temp.q_as(pg_temp.f('cmo'), format('select public.submit_clinical_audit(%L, %L::jsonb, %L::jsonb, %L)', v_a, c -> 'safety', c -> 'quality', c ->> 'rationale'));
    if (c -> 'expect') ? 'error' then
      v_err := c -> 'expect' ->> 'error';
      v_exp := case v_err when 'form_items_mismatch' then '%every item and no others%' when 'safety_item_not_boolean' then '%must be true or false%'
                          when 'quality_item_out_of_range' then '%whole number from 0 to%' when 'rationale_too_short' then '%written reason%' end;
      perform pg_temp.ck('case ' || n || ': ' || (c ->> 'name'), 'refused: ' || v_err, case when v_res like 'ERR:' || v_exp then 'refused: ' || v_err else v_res end);
    else
      perform pg_temp.ck('case ' || n || ': ' || (c ->> 'name'), (c -> 'expect' ->> 'outcome') || '/' || (c -> 'expect' ->> 'score') || '/' || (c -> 'expect' ->> 'critical'),
        case when v_res like 'ERR:%' then v_res else (v_res::jsonb ->> 'outcome') || '/' || trim_scale((v_res::jsonb ->> 'total_score')::numeric)::text || '/' || (v_res::jsonb ->> 'critical_miss') end);
    end if;
  end loop;
  update public.quality_config set rules = v_real where is_active;   -- the real form and bands back for everything that follows
end $$;

-- 5. Assignment, no self-audit, the logged case file, results, visibility ---------------------------------------------
do $$
declare
  v_cmo uuid := pg_temp.f('cmo'); v_fin uuid := pg_temp.f('fin'); v_oth uuid := pg_temp.f('other'); v_adm uuid := pg_temp.f('admin');
  v_t uuid; v_a uuid; v_score_before numeric; v_cmo2 uuid; v_res text; v_rev uuid;
  v_safe jsonb := '{"identity_and_consent_confirmed":true,"red_flags_recognised_and_acted_on":true,"decision_within_competence_and_protocol":true,"no_unsigned_treatment_change":true,"safety_netting_and_follow_up_given":true,"escalated_when_needed":true}';
  v_q4 jsonb := '{"history_adequate":4,"reasoning_documented":4,"communication_clear":4,"plan_appropriate":4,"patient_questions_answered":4,"documentation_timely":4}';
  v_q1 jsonb := '{"history_adequate":1,"reasoning_documented":1,"communication_clear":1,"plan_appropriate":1,"patient_questions_answered":1,"documentation_timely":1}';
begin
  -- the lead's own task has no other reviewer: it waits, unassigned, and the lead can never review it
  perform pg_temp.cfg('{sampling,random_rate_percent}', '100'::jsonb);
  v_t := pg_temp.finish(v_cmo, 'symptom_review');
  perform pg_temp.cfg('{sampling,random_rate_percent}', '0'::jsonb);
  v_a := pg_temp.audit_of(v_t);
  perform pg_temp.ck('a lead''s own task is unassigned when nobody else can review it', 'unassigned', (select state from public.clinical_audits where id = v_a));
  perform pg_temp.ck('the lead cannot open their own case file', 'ERR:you cannot audit your own work', pg_temp.q_as(v_cmo, format('select public.audit_case_file(%L)', v_a)));
  perform pg_temp.ck('the lead cannot submit their own audit', 'ERR:you cannot audit your own work', pg_temp.q_as(v_cmo, format('select public.submit_clinical_audit(%L, %L::jsonb, %L::jsonb, %L)', v_a, v_safe, v_q4, '')));
  perform pg_temp.ck('the lead cannot reassign it to themselves', 'ERR:the reviewer cannot be the audited clinician', pg_temp.q_as(v_cmo, format('select public.reassign_clinical_audit(%L, %L)', v_a, v_cmo)));
  perform pg_temp.ck('the database itself refuses a self-audit (check constraint)', '23514', pg_temp.try_sql(format('update public.clinical_audits set reviewer_id = clinician_id, state = %L where id = %L', 'assigned', v_a)));
  -- a second reviewer arrives; the nightly sweep assigns it
  v_cmo2 := pg_temp.mkdoc(pg_temp.f('org'), 'cmo2', 'chief_medical_officer', 'contracted', '{}', v_adm);
  perform pg_temp.setf('cmo2', v_cmo2);
  perform private.quality_audit_sweep();
  perform pg_temp.ck('the sweep assigns it to the new reviewer', v_cmo2::text, (select reviewer_id::text from public.clinical_audits where id = v_a));

  -- a clinician and an admin account can do nothing with audits
  v_t := pg_temp.finish(v_fin, 'symptom_review');
  v_a := (pg_temp.q_as(v_cmo, format('select public.request_clinical_audit(%L)', v_t)))::uuid;
  select reviewer_id into v_rev from public.clinical_audits where id = v_a;
  perform pg_temp.ck('a clinician cannot open a case file', 'ERR:only the clinical lead can open an audit case file', pg_temp.q_as(v_oth, format('select public.audit_case_file(%L)', v_a)));
  perform pg_temp.ck('an admin account cannot open a case file', 'ERR:only the clinical lead can open an audit case file', pg_temp.q_as(v_adm, format('select public.audit_case_file(%L)', v_a)));
  perform pg_temp.ck('a clinician cannot request an audit', 'ERR:only the clinical lead can request an audit', pg_temp.q_as(v_oth, format('select public.request_clinical_audit(%L)', v_t)));
  perform pg_temp.ck('the audit queue is for the lead only', 'ERR:only the clinical lead can see the audit queue', pg_temp.q_as(v_oth, 'select public.clinical_audit_queue()'));
  perform pg_temp.ck('a draft audit is invisible to an admin account', '0', pg_temp.q_as(v_adm, 'select count(*) from public.clinical_audits'));
  perform pg_temp.ck('a draft audit is invisible to the audited clinician', '0', pg_temp.q_as(v_fin, format('select count(*) from public.clinical_audits where id = %L', v_a)));
  perform pg_temp.ck('a draft audit is invisible to a colleague', '0', pg_temp.q_as(v_oth, 'select count(*) from public.clinical_audits'));

  -- INV-10: the case file is read by the assigned reviewer only, and the read is written to the audit log
  perform pg_temp.ck('a lead who is not the assigned reviewer cannot read it', 'ERR:this audit is assigned to another reviewer',
    pg_temp.q_as(case when v_rev = v_cmo then v_cmo2 else v_cmo end, format('select public.audit_case_file(%L)', v_a)));
  v_res := pg_temp.q_as(v_rev, format('select public.audit_case_file(%L)', v_a));
  perform pg_temp.ck('the assigned reviewer reads the case file', 'true', ((v_res::jsonb -> 'task' ->> 'outcome') is not null)::text);
  perform pg_temp.ck('...and that read is in the audit log with the patient', '1', (select count(*)::text from public.audit_log where action = 'clinical_audit.case_file_read' and entity_id = v_t and event ->> 'patient_id' = pg_temp.f('pat')::text));

  -- submitting: result, reliability, events, visibility afterwards
  select reliability_score into v_score_before from public.clinical_staff where profile_id = v_fin;
  v_res := pg_temp.q_as(v_rev, format('select public.submit_clinical_audit(%L, %L::jsonb, %L::jsonb, %L)', v_a, v_safe, v_q1, 'Reasoning was not recorded and the plan was thin.'));
  perform pg_temp.ck('a poor audit is significant concerns', 'significant_concerns', v_res::jsonb ->> 'outcome');
  perform pg_temp.ck('an audit_result reliability event was written', '1', (select count(*)::text from public.clinician_reliability_events where task_id = v_t and kind = 'audit_result'));
  perform pg_temp.ck('...and it lowered the advisory reliability score', 'true', ((select reliability_score from public.clinical_staff where profile_id = v_fin) < v_score_before)::text);
  perform pg_temp.ck('a concern-found event carries ids only', 'true',
    (select (count(*) = 1 and bool_and(payload ? 'audit_id' and payload ? 'outcome' and not payload ? 'rationale'))::text from public.domain_events where event_type = 'clinical_audit.concern_found' and payload ->> 'audit_id' = v_a::text));
  perform pg_temp.ck('a significant finding opens a follow-up for the lead', 'true', (select followup_needed::text from public.clinical_audits where id = v_a));
  perform pg_temp.ck('the audited clinician sees the submitted audit', '1', pg_temp.q_as(v_fin, format('select count(*) from public.clinical_audits where id = %L', v_a)));
  perform pg_temp.ck('a colleague still does not', '0', pg_temp.q_as(v_oth, format('select count(*) from public.clinical_audits where id = %L', v_a)));
  perform pg_temp.ck('an admin account still does not', '0', pg_temp.q_as(v_adm, format('select count(*) from public.clinical_audits where id = %L', v_a)));
  perform pg_temp.ck('the notice to the clinician is neutral', 'true',
    (select (payload ->> 'message' not ilike '%significant%' and payload ->> 'message' not ilike '%concern%' and payload ->> 'message' not ilike '%unsafe%')::text
       from public.notifications where recipient_id = v_fin and payload ->> 'subject' = 'An audit of your work is complete' order by created_at desc limit 1));
  perform pg_temp.ck('a submitted audit cannot be changed, even by the owner', '23514', pg_temp.try_sql(format('update public.clinical_audits set outcome = %L where id = %L', 'satisfactory', v_a)));
  perform pg_temp.ck('...including its scores and critical_miss', '23514', pg_temp.try_sql(format('update public.clinical_audits set critical_miss = false, safety_results = %L::jsonb where id = %L', '{}', v_a)));
  perform pg_temp.ck('...but the follow-up note can still be recorded', 'ok', pg_temp.try_sql(format('update public.clinical_audits set followup_note = %L where id = %L', 'x', v_a)));
  perform pg_temp.ck('...and cannot be deleted', '23514', pg_temp.try_sql(format('delete from public.clinical_audits where id = %L', v_a)));
  perform pg_temp.ck('it cannot be submitted twice', 'ERR:this audit is already submitted', pg_temp.q_as(v_rev, format('select public.submit_clinical_audit(%L, %L::jsonb, %L::jsonb, %L)', v_a, v_safe, v_q4, '')));
  perform pg_temp.ck('the follow-up needs a real note', 'ERR:say what was done, in at least 20 characters', pg_temp.q_as(v_cmo, format('select public.close_audit_followup(%L, %L)', v_a, 'ok')));
  perform pg_temp.ck('the lead can close the follow-up with a note', 'ok', pg_temp.try_as(v_cmo, format('select public.close_audit_followup(%L, %L)', v_a, 'Spoke with the clinician and agreed a plan.')));
  perform pg_temp.ck('the lead sees the queue', 'true', (pg_temp.q_as(v_cmo, 'select jsonb_array_length(public.clinical_audit_queue())')::integer > 0)::text);
  -- an unsafe audit (a failed safety item) is flagged whatever the score
  v_t := pg_temp.finish(v_fin, 'symptom_review');
  v_a := (pg_temp.q_as(v_cmo, format('select public.request_clinical_audit(%L)', v_t)))::uuid;
  select reviewer_id into v_rev from public.clinical_audits where id = v_a;
  v_res := pg_temp.q_as(v_rev, format('select public.submit_clinical_audit(%L, %L::jsonb, %L::jsonb, %L)', v_a, jsonb_set(v_safe, '{escalated_when_needed}', 'false'), v_q4, 'A needed escalation was not made.'));
  perform pg_temp.ck('a failed safety item is unsafe even with top quality scores', 'unsafe/true', (v_res::jsonb ->> 'outcome') || '/' || (v_res::jsonb ->> 'critical_miss'));
end $$;

-- 6. Tier 1: every task audited until the count is met; the lead is told, nothing is promoted -----------------------------
do $$
declare
  v_t1 uuid := pg_temp.f('t1'); v_cmo uuid := pg_temp.f('cmo2'); v_s uuid := pg_temp.staff_of(pg_temp.f('t1')); v_t uuid; v_a uuid; v_i integer; v_before integer; v_notes bigint;
  v_safe jsonb := '{"identity_and_consent_confirmed":true,"red_flags_recognised_and_acted_on":true,"decision_within_competence_and_protocol":true,"no_unsigned_treatment_change":true,"safety_netting_and_follow_up_given":true,"escalated_when_needed":true}';
  v_q4 jsonb := '{"history_adequate":4,"reasoning_documented":4,"communication_clear":4,"plan_appropriate":4,"patient_questions_answered":4,"documentation_timely":4}';
begin
  perform pg_temp.ck('t1 is a level 1 clinician', '1', (select credentialing_level::text from public.clinical_staff where id = v_s));
  -- the earlier floor top-up audit does not count toward tier 1 unless t1 was level 1 (it was), so measure from here
  select count(*) into v_before from public.clinical_audits where clinician_id = v_t1 and counts_toward_tier1 and state <> 'cancelled';
  perform pg_temp.cfg('{tier1,audited_task_count}', (v_before + 2)::text::jsonb);
  for v_i in 1..2 loop
    v_t := pg_temp.finish(v_t1, 'symptom_review');
    v_a := pg_temp.audit_of(v_t);
    perform pg_temp.ck('level 1 task ' || v_i || ' is audited as a first task and counts', 'first_tasks/true', (select reason || '/' || counts_toward_tier1 from public.clinical_audits where id = v_a));
    perform pg_temp.ck('...assigned to a lead who is not t1', 'true', (select (reviewer_id is not null and reviewer_id <> v_t1)::text from public.clinical_audits where id = v_a));
    perform pg_temp.try_as((select reviewer_id from public.clinical_audits where id = v_a), format('select public.submit_clinical_audit(%L, %L::jsonb, %L::jsonb, %L)', v_a, v_safe, v_q4, ''));
  end loop;
  -- the floor-created audit is unsubmitted, so the count of submitted audits is still short: submit it as well
  for v_a in select id from public.clinical_audits where clinician_id = v_t1 and counts_toward_tier1 and state = 'assigned' loop
    perform pg_temp.try_as((select reviewer_id from public.clinical_audits where id = v_a), format('select public.submit_clinical_audit(%L, %L::jsonb, %L::jsonb, %L)', v_a, v_safe, v_q4, ''));
  end loop;
  perform pg_temp.ck('the lead is told once the count is met', '1', (select count(*)::text from public.domain_events where event_type = 'clinician.tier1_audits_complete' and payload ->> 'clinical_staff_id' = v_s::text));
  perform pg_temp.ck('...and the clinician is still level 1 (nothing promotes automatically)', '1', (select credentialing_level::text from public.clinical_staff where id = v_s));
  v_t := pg_temp.finish(v_t1, 'symptom_review');
  perform pg_temp.ck('past the count, an ordinary level 1 task falls back to sampling', '0', (select count(*)::text from public.clinical_audits where task_id = v_t));
  -- a counted audit past the target must not tell the lead again
  v_notes := (select count(*) from public.notifications where recipient_id = v_cmo and payload ->> 'subject' = 'A clinician met the audited task count');
  perform pg_temp.cfg('{sampling,random_rate_percent}', '100'::jsonb);
  v_t := pg_temp.finish(v_t1, 'symptom_review');
  perform pg_temp.cfg('{sampling,random_rate_percent}', '0'::jsonb);
  v_a := pg_temp.audit_of(v_t);
  perform pg_temp.try_as((select reviewer_id from public.clinical_audits where id = v_a), format('select public.submit_clinical_audit(%L, %L::jsonb, %L::jsonb, %L)', v_a, v_safe, v_q4, ''));
  perform pg_temp.ck('a further counted audit past the target does not notify the lead again', v_notes::text,
    (select count(*)::text from public.notifications where recipient_id = v_cmo and payload ->> 'subject' = 'A clinician met the audited task count'));
  perform pg_temp.ck('a clinician cannot extend a count', 'ERR:only the clinical lead can extend the audited count', pg_temp.q_as(pg_temp.f('other'), format('select public.extend_tier1_audits(%L, 3, %L)', v_s, 'needs more oversight')));
  perform pg_temp.ck('an extension needs a real reason', 'true', (pg_temp.q_as(v_cmo, format('select public.extend_tier1_audits(%L, 3, %L)', v_s, 'short')) like 'ERR:%')::text);
  perform pg_temp.ck('the lead extends the count by two', 'ok', pg_temp.try_as(v_cmo, format('select public.extend_tier1_audits(%L, 2, %L)', v_s, 'needs more audited tasks first')));
  v_t := pg_temp.finish(v_t1, 'symptom_review');
  perform pg_temp.ck('after an extension the next task is audited again', 'first_tasks', (select reason from public.clinical_audits where task_id = v_t));
  perform pg_temp.ck('t1 sees their own progress', (v_before + 4)::text, (pg_temp.q_as(v_t1, 'select public.tier1_audit_progress()')::jsonb ->> 'target'));
  perform pg_temp.ck('a colleague cannot see t1''s progress', 'ERR:you can only see your own progress', pg_temp.q_as(pg_temp.f('other'), format('select public.tier1_audit_progress(%L)', v_s)));
  perform pg_temp.cfg('{tier1,audited_task_count}', '20'::jsonb);
end $$;

-- 7. Hand-back review: S17's threshold opens one review, the lead decides, nothing is sanctioned ---------------------
do $$
declare v_u uuid := pg_temp.f('other'); v_cmo uuid := pg_temp.f('cmo'); v_i integer; v_t uuid; v_r uuid; v_hb text;
begin
  for v_i in 1..4 loop
    perform pg_temp.clear_queue();
    v_t := pg_temp.mktask(pg_temp.f('pat'), 'symptom_review');
    if pg_temp.next_task(v_u) is distinct from v_t then raise exception 'handback fixture: expected the new task, got %', pg_temp.next_outcome(v_u); end if;
    v_hb := pg_temp.try_as(v_u, format('select public.queue_handback(%L, %L, %L)', v_t, 'technical_problem', null));
    perform pg_temp.ck('hand-back ' || v_i || ' is accepted', 'ok', v_hb);
    perform pg_temp.ck('after hand-back ' || v_i || ', open reviews', case when v_i <= 3 then '0' else '1' end, (select count(*)::text from public.handback_reviews where clinician_id = v_u and state = 'open'));
  end loop;
  perform pg_temp.clear_queue();
  v_t := pg_temp.mktask(pg_temp.f('pat'), 'symptom_review');
  perform pg_temp.next_task(v_u);
  perform pg_temp.try_as(v_u, format('select public.queue_handback(%L, %L, %L)', v_t, 'technical_problem', null));
  perform pg_temp.ck('a fifth hand-back does not open a second review', '1', (select count(*)::text from public.handback_reviews where clinician_id = v_u and state = 'open'));
  select id into v_r from public.handback_reviews where clinician_id = v_u and state = 'open';
  perform pg_temp.ck('the review records the reason breakdown', 'true', ((select (reasons ->> 'technical_problem')::integer >= 4 from public.handback_reviews where id = v_r))::text);
  perform pg_temp.ck('the lead was told, in neutral words', 'true',
    (select (count(*) >= 1 and bool_and(payload ->> 'message' not ilike '%technical%'))::text from public.notifications where recipient_id = v_cmo and payload ->> 'subject' = 'A hand-back pattern needs review'));
  perform pg_temp.ck('a clinician cannot read the reviews', '0', pg_temp.q_as(v_u, 'select count(*) from public.handback_reviews'));
  perform pg_temp.ck('an admin account cannot read the reviews', '0', pg_temp.q_as(pg_temp.f('admin'), 'select count(*) from public.handback_reviews'));
  perform pg_temp.ck('the lead can', 'true', (pg_temp.q_as(v_cmo, 'select count(*) from public.handback_reviews')::integer >= 1)::text);
  perform pg_temp.ck('a clinician cannot close it', 'ERR:only the clinical lead can close a hand-back review', pg_temp.q_as(v_u, format('select public.close_handback_review(%L, %L, %L)', v_r, 'no_action', 'looked at it, nothing to do')));
  perform pg_temp.ck('an unknown outcome is refused', 'ERR:unknown outcome', pg_temp.q_as(v_cmo, format('select public.close_handback_review(%L, %L, %L)', v_r, 'suspend', 'looked at it, nothing to do')));
  perform pg_temp.ck('a note is required', 'ERR:add a note of at least 10 characters', pg_temp.q_as(v_cmo, format('select public.close_handback_review(%L, %L, %L)', v_r, 'no_action', 'ok')));
  perform pg_temp.ck('the lead closes it', 'ok', pg_temp.try_as(v_cmo, format('select public.close_handback_review(%L, %L, %L)', v_r, 'capacity_issue', 'Network was down all week in their area.')));
  perform pg_temp.ck('closing it leaves the clinician active and eligible', 'active/true', (select status::text || '/' || private.clinician_is_eligible(v_u) from public.clinical_staff where profile_id = v_u));
  perform pg_temp.ck('it cannot be closed twice', 'ERR:there is no open review with that id', pg_temp.q_as(v_cmo, format('select public.close_handback_review(%L, %L, %L)', v_r, 'no_action', 'looked at it, nothing to do')));
end $$;

-- 8. The speak-up route ---------------------------------------------------------------------------------------------
do $$
declare
  v_c1 uuid := pg_temp.f('fin'); v_oth uuid := pg_temp.f('other'); v_cmo uuid := pg_temp.f('cmo'); v_adm uuid := pg_temp.f('admin'); v_pat uuid := pg_temp.f('pat');
  v_id uuid; v_id2 uuid; v_id3 uuid; v_imm uuid; v_lead uuid; v_inc uuid; v_back uuid; v_text text := 'The protocol step for repeat readings is unclear to the whole team on nights.';
begin
  perform pg_temp.ck('a patient cannot raise a concern here', 'ERR:only clinicians can raise a safety concern here', pg_temp.q_as(v_pat, format('select public.raise_safety_concern(%L, %L, %L)', 'patient_safety', 'high', v_text)));
  perform pg_temp.ck('a short description is refused', 'true', (pg_temp.q_as(v_c1, format('select public.raise_safety_concern(%L, %L, %L)', 'patient_safety', 'high', 'too short')) like 'ERR:%')::text);
  perform pg_temp.ck('an unknown category is refused', 'true', (pg_temp.q_as(v_c1, format('select public.raise_safety_concern(%L, %L, %L)', 'gossip', 'high', v_text)) like 'ERR:%')::text);
  perform pg_temp.ck('a task the clinician did not work on is refused', 'ERR:that task is not one you worked on', pg_temp.q_as(v_c1, format('select public.raise_safety_concern(%L, %L, %L, %L, %L)', 'patient_safety', 'high', v_text, 'queue', gen_random_uuid())));
  v_id := pg_temp.q_as(v_c1, format('select public.raise_safety_concern(%L, %L, %L, %L)', 'patient_safety', 'high', v_text, 'task view'))::uuid;
  perform pg_temp.ck('a clinician raises a concern', 'new', (select state from public.safety_concerns where id = v_id));
  perform pg_temp.ck('the clocks are set from config (48 hours, 14 days)', 'true',
    (select (acknowledge_due_at between now() + interval '47 hours' and now() + interval '49 hours' and respond_due_at between now() + interval '13 days' and now() + interval '15 days')::text from public.safety_concerns where id = v_id));
  v_imm := pg_temp.q_as(v_c1, format('select public.raise_safety_concern(%L, %L, %L)', 'patient_safety', 'immediate', v_text))::uuid;
  perform pg_temp.ck('an immediate concern is acknowledged sooner', 'true', (select (acknowledge_due_at < now() + interval '5 hours')::text from public.safety_concerns where id = v_imm));
  -- who can see it
  perform pg_temp.ck('the person who raised it sees it', '2', pg_temp.q_as(v_c1, 'select count(*) from public.safety_concerns'));
  perform pg_temp.ck('a colleague sees nothing', '0', pg_temp.q_as(v_oth, 'select count(*) from public.safety_concerns'));
  perform pg_temp.ck('an ADMIN ACCOUNT (operations) sees nothing in the table', '0', pg_temp.q_as(v_adm, 'select count(*) from public.safety_concerns'));
  perform pg_temp.ck('...nothing in the messages', '0', pg_temp.q_as(v_adm, 'select count(*) from public.safety_concern_messages'));
  perform pg_temp.ck('...nothing in the inbox function', '[]', pg_temp.q_as(v_adm, 'select public.safety_concern_inbox()'));
  perform pg_temp.ck('...and cannot acknowledge it', 'ERR:concern not found', pg_temp.q_as(v_adm, format('select public.acknowledge_safety_concern(%L)', v_id)));
  perform pg_temp.ck('a patient sees nothing', '0', pg_temp.q_as(v_pat, 'select count(*) from public.safety_concerns'));
  perform pg_temp.ck('anon is refused', '42501', pg_temp.try_anon('select count(*) from public.safety_concerns'));
  perform pg_temp.ck('the clinical lead sees both, with the text', 'true',
    (pg_temp.q_as(v_cmo, 'select (select count(*) from public.safety_concerns) = 2 and public.safety_concern_inbox()::text like ''%repeat readings%''') = 'true')::text);
  -- nothing readable by operations mentions it
  perform pg_temp.ck('no domain event mentions the concern', '0', (select count(*)::text from public.domain_events where payload::text like '%' || v_id::text || '%' or event_type like 'safety_concern%'));
  perform pg_temp.ck('no audit_log row mentions the concern', '0', (select count(*)::text from public.audit_log where entity_id = v_id or event::text like '%' || v_id::text || '%'));
  perform pg_temp.ck('the lead''s notice is neutral (no text, category, severity or id)', 'true',
    (select (payload ->> 'message' not ilike '%protocol%' and payload ->> 'message' not ilike '%patient_safety%' and payload ->> 'message' not ilike '%high%' and payload::text not like '%' || v_id::text || '%')::text
       from public.notifications where recipient_id = v_cmo and payload ->> 'subject' = 'A new item needs your attention' order by created_at desc limit 1));
  -- the lead's actions
  perform pg_temp.ck('a colleague cannot acknowledge it', 'ERR:concern not found', pg_temp.q_as(v_oth, format('select public.acknowledge_safety_concern(%L)', v_id)));
  perform pg_temp.try_as(v_cmo, format('select public.acknowledge_safety_concern(%L)', v_id));
  perform pg_temp.ck('the lead acknowledges it', 'acknowledged', (select state from public.safety_concerns where id = v_id));
  perform pg_temp.ck('closing before responding is refused', 'ERR:respond to the person who raised it before closing', pg_temp.q_as(v_cmo, format('select public.close_safety_concern(%L, %L)', v_id, 'we looked at this and changed the guide')));
  perform pg_temp.ck('a response needs words', 'ERR:write a response of at least 20 characters', pg_temp.q_as(v_cmo, format('select public.respond_to_safety_concern(%L, %L)', v_id, 'ok')));
  perform pg_temp.try_as(v_cmo, format('select public.respond_to_safety_concern(%L, %L)', v_id, 'Thank you. We are rewriting that step this week.'));
  perform pg_temp.ck('the person who raised it can read the reply', 'true', (pg_temp.q_as(v_c1, 'select public.my_safety_concerns()::text') like '%rewriting that step%')::text);
  perform pg_temp.ck('...and add to it', 'ok', pg_temp.try_as(v_c1, format('select public.add_to_safety_concern(%L, %L)', v_id, 'One more detail from last night.')));
  perform pg_temp.ck('a colleague cannot add to it', 'ERR:concern not found', pg_temp.q_as(v_oth, format('select public.add_to_safety_concern(%L, %L)', v_id, 'I am not the one who raised it.')));
  perform pg_temp.ck('the lead closes it', 'ok', pg_temp.try_as(v_cmo, format('select public.close_safety_concern(%L, %L)', v_id, 'The guide was rewritten and the team briefed on it.')));
  perform pg_temp.ck('a closed concern cannot take more notes', 'ERR:this concern is closed; raise a new one', pg_temp.q_as(v_c1, format('select public.add_to_safety_concern(%L, %L)', v_id, 'Anything else here please.')));
  perform pg_temp.ck('its messages cannot be edited', '23514', pg_temp.try_sql(format('update public.safety_concern_messages set body = %L where concern_id = %L', 'x', v_id)));
  -- an incident follows the incident process, with fixed neutral words
  v_id2 := pg_temp.q_as(v_c1, format('select public.raise_safety_concern(%L, %L, %L)', 'clinical_practice', 'high', v_text))::uuid;
  v_inc := pg_temp.q_as(v_cmo, format('select public.open_incident_for_concern(%L, %L)', v_id2, 'sev2'))::uuid;
  perform pg_temp.ck('the lead opens an incident for it', 'true', (select (incident_id = v_inc)::text from public.safety_concerns where id = v_id2));
  perform pg_temp.ck('the incident says nothing of the concern', 'true', (select (summary not ilike '%protocol%' and title not ilike '%protocol%' and summary not like '%' || v_id2::text || '%')::text from public.ops_incidents where id = v_inc));
  perform pg_temp.ck('a second request returns the same incident', v_inc::text, pg_temp.q_as(v_cmo, format('select public.open_incident_for_concern(%L, %L)', v_id2, 'sev2')));
  -- overdue: no acknowledgement in time reaches the backup readers; with none named, a neutral incident makes the gap visible
  v_id3 := pg_temp.q_as(v_oth, format('select public.raise_safety_concern(%L, %L, %L)', 'colleague_conduct', 'medium', v_text))::uuid;
  update public.safety_concerns set acknowledge_due_at = now() - interval '1 hour' where id = v_id3;
  perform private.safety_concern_sweep();
  perform pg_temp.ck('an overdue concern is escalated', 'true', (select (escalated_at is not null)::text from public.safety_concerns where id = v_id3));
  perform pg_temp.ck('...and with no backup reader a neutral incident is opened', 'true',
    (select (count(*) >= 1 and bool_and(summary not ilike '%protocol%' and summary not ilike '%conduct%'))::text from public.ops_incidents where external_reference = 'clinical_safety_overdue'));
  -- a named backup reader sees escalated concerns, and only those
  v_back := pg_temp.mkuser(pg_temp.f('org'), 'backup', 'admin');
  perform pg_temp.ck('only the lead can name a backup reader', 'ERR:only the clinical lead can name a backup reader', pg_temp.q_as(v_oth, format('select public.add_safety_concern_backup_reader(%L)', v_back)));
  perform pg_temp.ck('an admin account cannot name itself a reader', 'ERR:only the clinical lead can name a backup reader', pg_temp.q_as(v_back, format('select public.add_safety_concern_backup_reader(%L)', v_back)));
  perform pg_temp.ck('before being named, the backup person sees nothing', '0', pg_temp.q_as(v_back, 'select count(*) from public.safety_concerns'));
  perform pg_temp.try_as(v_cmo, format('select public.add_safety_concern_backup_reader(%L, %L)', v_back, 'the founder'));
  perform pg_temp.ck('the backup reader sees the escalated concern', '1', pg_temp.q_as(v_back, 'select count(*) from public.safety_concerns'));
  perform pg_temp.ck('...but not one that was not escalated', '0', pg_temp.q_as(v_back, format('select count(*) from public.safety_concerns where id = %L', v_id2)));
  perform pg_temp.ck('...and can respond to it', 'ok', pg_temp.try_as(v_back, format('select public.respond_to_safety_concern(%L, %L)', v_id3, 'We have received this and will look at it today.')));
  perform pg_temp.try_as(v_cmo, format('select public.remove_safety_concern_backup_reader(%L)', v_back));
  perform pg_temp.ck('a removed reader sees nothing again', '0', pg_temp.q_as(v_back, 'select count(*) from public.safety_concerns'));
  -- a concern raised by the lead goes straight to the backup route
  v_lead := pg_temp.q_as(v_cmo, format('select public.raise_safety_concern(%L, %L, %L)', 'system_or_process', 'low', v_text))::uuid;
  perform pg_temp.ck('a lead''s own concern is escalated at once', 'true', (select (escalated_at is not null)::text from public.safety_concerns where id = v_lead));
  -- the response clock: a concern nobody answered in time tells the lead once
  update public.safety_concerns set respond_due_at = now() - interval '1 hour' where id = v_id2;
  perform private.safety_concern_sweep();
  perform private.safety_concern_sweep();
  perform pg_temp.ck('a late response is flagged exactly once', '1', (select count(*)::text from public.safety_concerns where id = v_id2 and respond_overdue_notified_at is not null));
end $$;

-- 8b. Hardening found in review: the rate cap, who may be a backup reader, and other organisations -------------------
do $$
declare
  v_cmo uuid := pg_temp.f('cmo'); v_org uuid := pg_temp.f('org'); v_adm uuid := pg_temp.f('admin'); v_pat uuid := pg_temp.f('pat');
  v_rl uuid; v_i integer; v_org2 uuid; v_c2 uuid; v_text text := 'The handover sheet is missing a field for allergies at night.'; v_a uuid; v_conc uuid;
begin
  v_rl := pg_temp.mkdoc(v_org, 'rl', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_adm);
  for v_i in 1..10 loop
    perform pg_temp.try_as(v_rl, format('select public.raise_safety_concern(%L, %L, %L)', 'system_or_process', 'low', v_text));
  end loop;
  perform pg_temp.ck('an eleventh routine concern in a day is refused, honestly', 'ERR:you have raised many concerns today; please speak to the clinical lead directly, or mark it high or immediate if it cannot wait',
    pg_temp.q_as(v_rl, format('select public.raise_safety_concern(%L, %L, %L)', 'system_or_process', 'low', v_text)));
  perform pg_temp.ck('...but a high one is never refused', 'true', (pg_temp.q_as(v_rl, format('select public.raise_safety_concern(%L, %L, %L)', 'patient_safety', 'high', v_text)) ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.ck('a patient cannot be named a backup reader', 'ERR:that person was not found', pg_temp.q_as(v_cmo, format('select public.add_safety_concern_backup_reader(%L)', v_pat)));
  -- another organisation's lead sees and can do nothing here
  insert into public.organisations (name, type) select 'S20 other organisation', type from public.organisations where id = v_org returning id into v_org2;
  v_c2 := pg_temp.mkdoc(v_org2, 'cmo_other_org', 'chief_medical_officer', 'contracted', '{}', v_adm);
  update public.profiles set organisation_id = v_org2 where id = v_c2;   -- the sign-up trigger puts new users in the default organisation
  perform pg_temp.ck('the other lead is in the other organisation', v_org2::text, (select organisation_id::text from public.profiles where id = v_c2));
  v_conc := (select id from public.safety_concerns order by created_at limit 1);
  v_a := (select id from public.clinical_audits limit 1);
  perform pg_temp.ck('another organisation''s lead sees no safety concerns', '0', pg_temp.q_as(v_c2, 'select count(*) from public.safety_concerns'));
  perform pg_temp.ck('...no inbox', '[]', pg_temp.q_as(v_c2, 'select public.safety_concern_inbox()'));
  perform pg_temp.ck('...cannot acknowledge one', 'ERR:concern not found', pg_temp.q_as(v_c2, format('select public.acknowledge_safety_concern(%L)', v_conc)));
  perform pg_temp.ck('...sees no audits', '0', pg_temp.q_as(v_c2, 'select count(*) from public.clinical_audits'));
  perform pg_temp.ck('...an empty audit queue', '[]', pg_temp.q_as(v_c2, 'select public.clinical_audit_queue()'));
  perform pg_temp.ck('...cannot open a case file', 'ERR:audit not found', pg_temp.q_as(v_c2, format('select public.audit_case_file(%L)', v_a)));
  perform pg_temp.ck('...sees no hand-back reviews', '0', pg_temp.q_as(v_c2, 'select count(*) from public.handback_reviews'));
  perform pg_temp.ck('...sees no retaliation reviews', '[]', pg_temp.q_as(v_c2, 'select public.retaliation_review_queue()'));
end $$;

-- 9. Retaliation review: an adverse action against someone who spoke up goes to the lead -----------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_oth uuid := pg_temp.f('other'); v_org uuid := pg_temp.f('org'); v_adm uuid := pg_temp.f('admin');
  v_a uuid; v_b uuid; v_c uuid; v_r uuid; v_r1 text;
begin
  v_a := pg_temp.mkdoc(v_org, 'ret_a', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_adm);   -- spoke up
  v_b := pg_temp.mkdoc(v_org, 'ret_b', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_adm);   -- did not
  v_c := pg_temp.mkdoc(v_org, 'ret_c', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_adm);   -- spoke up, suspended by the expiry sweep
  perform pg_temp.try_as(v_a, format('select public.raise_safety_concern(%L, %L, %L)', 'patient_safety', 'low', 'The night handover note does not say who is on call for emergencies.'));
  perform pg_temp.try_as(v_c, format('select public.raise_safety_concern(%L, %L, %L)', 'patient_safety', 'low', 'The night handover note does not say who is on call for emergencies.'));
  v_r1 := pg_temp.try_as(v_cmo, format('select public.suspend_clinician(%L, %L)', pg_temp.staff_of(v_b), 'Proof: paperwork incomplete this week.'));
  perform pg_temp.ck('a person who did not speak up: a suspension creates no review', 'ok/0', v_r1 || '/' || (select count(*)::text from public.retaliation_reviews where clinician_id = v_b));
  v_r1 := pg_temp.try_as(v_cmo, format('select public.suspend_clinician(%L, %L)', pg_temp.staff_of(v_a), 'Proof: paperwork incomplete this week.'));
  perform pg_temp.ck('a person who spoke up: a human suspension opens a review', 'ok/1', v_r1 || '/' || (select count(*)::text from public.retaliation_reviews where clinician_id = v_a and state = 'open'));
  perform private.suspend_clinician_internal(pg_temp.staff_of(v_c), 'Your MDCN practising licence expired on proof date.', null);
  perform pg_temp.ck('the expiry sweep (no signed-in user) is not a person''s decision: no review', '0', (select count(*)::text from public.retaliation_reviews where clinician_id = v_c));
  perform pg_temp.ck('an admin account cannot see the reviews', '0', pg_temp.q_as(v_adm, 'select count(*) from public.retaliation_reviews'));
  perform pg_temp.ck('a colleague cannot see the reviews', '0', pg_temp.q_as(v_oth, 'select count(*) from public.retaliation_reviews'));
  perform pg_temp.ck('the lead sees it', '1', pg_temp.q_as(v_cmo, 'select jsonb_array_length(public.retaliation_review_queue())'));
  perform pg_temp.ck('an admin account cannot use the queue function', 'ERR:not available', pg_temp.q_as(v_adm, 'select public.retaliation_review_queue()'));
  select id into v_r from public.retaliation_reviews where clinician_id = v_a;
  perform pg_temp.ck('closing needs an outcome from the list', 'ERR:unknown outcome', pg_temp.q_as(v_cmo, format('select public.close_retaliation_review(%L, %L, %L)', v_r, 'fine', 'looked into it and found nothing')));
  perform pg_temp.ck('the lead closes it with a note', 'ok', pg_temp.try_as(v_cmo, format('select public.close_retaliation_review(%L, %L, %L)', v_r, 'no_link', 'The suspension was for missing paperwork only.')));
end $$;

-- 10. Safety case 16: a clinician with an expired licence is removed from the queue and the rota overnight --------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_adm uuid := pg_temp.f('admin'); v_cmo uuid := pg_temp.f('cmo');
  x uuid; y uuid; z uuid; w uuid; g uuid; t uuid; v_xs uuid; v_res jsonb; v_claimed uuid;
begin
  x := pg_temp.mkdoc(v_org, 'x', 'senior_medical_officer', 'contracted', '{hypertension,adult_general,on_call}', v_adm);
  y := pg_temp.mkdoc(v_org, 'y', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_adm);
  z := pg_temp.mkdoc(v_org, 'z', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_adm);
  w := pg_temp.mkdoc(v_org, 'w', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_adm);
  g := pg_temp.mkdoc(v_org, 'g', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_adm);
  perform pg_temp.setf('x', x); perform pg_temp.setf('y', y); perform pg_temp.setf('z', z); perform pg_temp.setf('w', w); perform pg_temp.setf('g', g);
  v_xs := pg_temp.staff_of(x);
  perform pg_temp.mkblock(v_org, x); perform pg_temp.mkblock(v_org, y); perform pg_temp.mkblock(v_org, z); perform pg_temp.mkblock(v_org, w); perform pg_temp.mkblock(v_org, g);
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
    values (v_org, x, now() + interval '3 hours', now() + interval '9 hours', 'on_call', true), (v_org, x, now() + interval '1 day', now() + interval '1 day 4 hours', 'bookable_consultations', true);

  -- X holds a live claim and three future rota entries
  perform pg_temp.clear_queue();
  t := pg_temp.mktask(pg_temp.f('pat'), 'symptom_review');
  v_claimed := pg_temp.next_task(x);
  perform pg_temp.setf('case16_task', t);
  perform pg_temp.ck('X claims the task', 't', case when v_claimed = t then 't' else 'f' end);
  perform pg_temp.ck('X has three live rota entries', '3', pg_temp.live_blocks(x));

  -- the licence expires; S15's nightly sweep suspends, and X leaves the queue and rota
  update public.clinical_staff set license_expires_at = now() - interval '2 days' where id = v_xs;
  perform pg_temp.ck('X is still active before the sweep', 'active', (select status::text from public.clinical_staff where id = v_xs));
  perform private.credential_expiry_sweep();
  perform pg_temp.ck('the sweep suspends X', 'suspended', (select status::text from public.clinical_staff where id = v_xs));
  perform pg_temp.ck('X''s claim was released (task back in the queue, not closed)', 'open', pg_temp.state_of(t));
  perform pg_temp.ck('X holds no live claim', '0', (select count(*)::text from public.task_claims where clinician_id = x and ended_at is null));
  perform pg_temp.ck('all three of X''s rota entries are cancelled', '0', pg_temp.live_blocks(x));
  perform pg_temp.ck('X is no longer eligible', 'false', private.clinician_is_eligible(x)::text);
  perform pg_temp.ck('X cannot take work', 'true', (pg_temp.next_outcome(x) <> 'claimed')::text);
  perform pg_temp.ck('X is told nothing clinical: the removal is audited', '1', (select count(*)::text from public.audit_log where action = 'clinician.removed_from_work' and entity_id = v_xs));
  perform pg_temp.ck('a removal event asks S18 to reassign the lead patients unless S18 already did', (to_regprocedure('private.lead_on_clinician_removed(uuid)') is null)::text,
    (select (count(*) >= 1 and bool_and((payload ->> 'lead_reassignment_required')::boolean))::text from public.domain_events where event_type = 'clinician.removed_from_work' and payload ->> 'clinical_staff_id' = v_xs::text));
  perform pg_temp.ck('the released task goes to the next clinician', 'true', (pg_temp.next_task(y) = t)::text);

  -- the nightly safety net: expired but not yet suspended (the sweep has not run), still holding a claim and rota entries
  perform pg_temp.clear_queue();
  t := pg_temp.mktask(pg_temp.f('pat'), 'symptom_review');
  perform pg_temp.next_task(z);
  update public.clinical_staff set license_expires_at = now() - interval '1 day' where profile_id = z;
  perform pg_temp.ck('Z still holds a block and a claim and is active', '1/1/active', pg_temp.live_blocks(z) || '/' || (select count(*)::text from public.task_claims where clinician_id = z and ended_at is null) || '/' || (select status::text from public.clinical_staff where profile_id = z));
  v_res := private.remove_ineligible_from_work();
  perform pg_temp.ck('the nightly job removes Z from the rota', '0', pg_temp.live_blocks(z));
  perform pg_temp.ck('...and releases Z''s claim', 'open', pg_temp.state_of(t));
  perform pg_temp.ck('...and reports what it did', 'true', ((v_res ->> 'removed')::integer >= 1 and (v_res ->> 'errors')::integer = 0)::text);
  perform pg_temp.ck('a second run finds nothing more to do for Z', '0', (private.remove_ineligible_from_work() ->> 'removed'));

  -- a missing date never removes anyone (S15 rule); neither does an audited grace period
  perform pg_temp.ck('W has no licence date and keeps the rota', '1', pg_temp.live_blocks(w));
  update public.clinical_staff set license_expires_at = now() - interval '3 days' where profile_id = g;
  perform pg_temp.ck('a grace period can be granted by the lead', 'ok', pg_temp.try_as(v_cmo, format('select public.grant_credential_grace(%L, %L, 7, %L)', pg_temp.staff_of(g), 'licence', 'Renewal is with the council this week.')));
  perform private.remove_ineligible_from_work();
  perform pg_temp.ck('W (no date) was not removed', '1', pg_temp.live_blocks(w));
  perform pg_temp.ck('G (expired, inside a grace period) was not removed', '1', pg_temp.live_blocks(g));
  perform pg_temp.ck('an unprivileged user cannot run the job', 'true', (pg_temp.try_as(pg_temp.f('other'), 'select private.remove_ineligible_from_work()') <> 'ok')::text);

  -- a clinician offered work is released too (offered_to_lead goes back to the pool)
  perform pg_temp.clear_queue();
  t := pg_temp.mktask(pg_temp.f('pat'), 'symptom_review');
  perform set_config('tarragon.task_transition', 'on', true);
  update public.clinical_tasks set state = 'offered_to_lead', delivery_path = 'push', pushed_to = w, lead_window_ends_at = now() + interval '1 hour' where id = t;
  perform set_config('tarragon.task_transition', 'off', true);
  update public.clinical_staff set status = 'offboarded', active = false where profile_id = w;
  perform pg_temp.ck('a task offered to a clinician who leaves goes back to the pool', 'open', pg_temp.state_of(t));
  perform pg_temp.ck('...and their rota is cleared at once, not at night', '0', pg_temp.live_blocks(w));
end $$;

-- 10b. When S18 is present its lead reassignment runs inside the removal (here a stand-in that records the call)
create temp table s18_calls(staff uuid) on commit drop;
grant all on s18_calls to public;
-- S18 defines the real entry point; keep its definition so it can be put back after the stand-in has recorded the call
create temp table s18_real(def text) on commit drop;
grant all on s18_real to public;
insert into s18_real select pg_get_functiondef(to_regprocedure('private.lead_on_clinician_removed(uuid)')) where to_regprocedure('private.lead_on_clinician_removed(uuid)') is not null;
create or replace function private.lead_on_clinician_removed(p_staff uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$ begin insert into s18_calls values (p_staff); return jsonb_build_object('leads_moved', 0); end $$;
do $$
declare v uuid; v_org uuid := pg_temp.f('org'); v_adm uuid := pg_temp.f('admin'); v_s uuid;
begin
  v := pg_temp.mkdoc(v_org, 's18', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_adm);
  v_s := pg_temp.staff_of(v);
  perform pg_temp.mkblock(v_org, v);
  update public.clinical_staff set license_expires_at = now() - interval '2 days' where id = v_s;
  perform private.remove_ineligible_from_work();
  perform pg_temp.ck('with S18 present, the nightly removal also reassigns the leads', '1', (select count(*)::text from s18_calls where staff = v_s));
  perform pg_temp.ck('...and the event no longer says reassignment is outstanding', 'false', (select (payload ->> 'lead_reassignment_required') from public.domain_events where event_type = 'clinician.removed_from_work' and payload ->> 'clinical_staff_id' = v_s::text order by occurred_at desc limit 1));
end $$;
do $$ declare v_def text; begin
  select def into v_def from s18_real;
  if v_def is null then drop function private.lead_on_clinician_removed(uuid); else execute v_def; end if;
end $$;

-- 10c. A removal failure must never block the suspension itself
create or replace function private.remove_clinician_from_work(p_profile uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'proof: removal failed'; end $$;
do $$
declare v uuid; v_org uuid := pg_temp.f('org'); v_adm uuid := pg_temp.f('admin'); v_s uuid;
begin
  v := pg_temp.mkdoc(v_org, 'blocked', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_adm);
  v_s := pg_temp.staff_of(v);
  perform private.suspend_clinician_internal(v_s, 'Your MDCN practising licence expired on proof date.', null);
  perform pg_temp.ck('the suspension goes through even when the removal step fails', 'suspended', (select status::text from public.clinical_staff where id = v_s));
  perform pg_temp.ck('...the failure is logged', '1', (select count(*)::text from public.audit_log where action = 'clinician.removal_error' and entity_id = v_s));
  perform pg_temp.ck('...and an incident makes it visible', 'true', (select (count(*) >= 1)::text from public.ops_incidents where external_reference = 'removal_sweep' and status not in ('resolved', 'closed')));
end $$;

-- 11. SABOTAGE: removal turned off; the case 16 check must flip --------------------------------------------------------
create or replace function private.remove_clinician_from_work(p_profile uuid, p_reason text) returns jsonb
language sql security definer set search_path = '' as $$ select '{}'::jsonb $$;

do $$
declare v uuid; v_org uuid := pg_temp.f('org'); v_adm uuid := pg_temp.f('admin');
begin
  v := pg_temp.mkdoc(v_org, 'sab', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_adm);
  perform pg_temp.mkblock(v_org, v);
  update public.clinical_staff set license_expires_at = now() - interval '5 days' where profile_id = v;
  perform private.remove_ineligible_from_work();
  insert into results values ('sabotaged', 'an expired clinician''s rota is cleared overnight', '0', pg_temp.live_blocks(v));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S20 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then
    raise exception 'VACUOUS TEST: turning removal off did not change the case 16 check';
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged row is asserted to FAIL inside the DO block above. It is deliberately not printed: the runner
-- treats any FAIL verdict in the output as a failed proof.

rollback;
