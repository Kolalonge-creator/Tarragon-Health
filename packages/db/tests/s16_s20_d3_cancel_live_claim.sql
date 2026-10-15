-- S16-S20 defect D3 proof (migration *_s16_s20_d3_cancel_ends_live_claim.sql).
--
-- Before the fix, cancelling a CLAIMED task left the clinician's claim live: with a cap of 1 the clinician was told
-- "already claimed" for the cancelled task on every call, and the expiry sweep tried a transition that does not exist,
-- rolled back and opened a sev1 incident each run.
--
-- Proves, in one rolled-back transaction:
--   1. Cancelling a claimed task ends the live claim (end_reason cancelled) and frees the clinician: queue_next hands
--      out the next task instead of the cancelled one.
--   2. Completing through the generic transition path also ends a live claim (lab release and PoC close tasks this way).
--   3. A stale claim left by any other path (a live claim on a cancelled task) is ended by queue_next, and by the
--      expiry sweep with no sev1 incident and no error.
--   4. The recovery statement in the migration is idempotent in spirit: nothing is left live on a non-claimed task.
--   5. SABOTAGE: the helper that ends the claim is replaced by a no-op; the first check must flip.
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
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'd3-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'D3 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_comps text[], p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'D3 ' || p_label, 'MDCN', 'D3-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
  values (p_org, v, now() - interval '1 minute', now() + interval '2 hours', 'queue', true);
  return v;
end $f$;
create function pg_temp.live_claims(p_task uuid) returns text language sql as
$$ select count(*)::text from public.task_claims where task_id = p_task and ended_at is null $$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_a uuid; v_p uuid; v_p2 uuid; t1 uuid; t2 uuid; r jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', '{}', v_admin);
  v_a := pg_temp.mkdoc(v_org, 'A', 'senior_medical_officer', '{hypertension,adult_general}', v_admin);
  v_p := pg_temp.mkuser(v_org, 'p1', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient');
  perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('A', v_a);

  -- 1. cancel a claimed task ---------------------------------------------------------------------------------------
  t1 := private.create_clinical_task(v_p, 'amber_bp_review');
  r := pg_temp.next_as(v_a);
  perform pg_temp.rec('A claims the first task', t1::text, r -> 'task' ->> 'id');
  perform pg_temp.rec('...and holds one live claim', '1', pg_temp.live_claims(t1));
  perform pg_temp.rec('the clinical lead can cancel a claimed task', 'ok',
    pg_temp.try_as(v_cmo, format('select public.cancel_clinical_task(%L, %L)', t1, 'D3 proof: cancelled while claimed')));
  perform pg_temp.rec('cancelling ended the live claim', '0', pg_temp.live_claims(t1));
  perform pg_temp.rec('...recorded as cancelled', 'cancelled',
    (select end_reason from public.task_claims where task_id = t1 order by claimed_at desc limit 1));
  t2 := private.create_clinical_task(v_p2, 'amber_bp_review');
  r := pg_temp.next_as(v_a);
  perform pg_temp.rec('the clinician is not stuck: next hands out the new task', t2::text, r -> 'task' ->> 'id');
  perform pg_temp.rec('...and it is not flagged as an old claim', 'false', r ->> 'already_claimed');

  -- 2. a generic completion also ends a live claim ---------------------------------------------------------------------
  perform private.apply_task_transition(t2, 'completed', 'clinician', v_a, 'done by another path', null, null, '{"code":"x"}'::jsonb);
  perform pg_temp.rec('a task completed by the generic transition holds no live claim', '0', pg_temp.live_claims(t2));

  -- 3. a stale claim left behind by any other path --------------------------------------------------------------------
  -- recreate the pre-fix state: a live claim row on a cancelled task
  insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test) values (v_org, t1, v_a, now() + interval '30 minutes', true);
  perform pg_temp.rec('fixture: a stale claim exists on the cancelled task', '1', pg_temp.live_claims(t1));
  r := pg_temp.next_as(v_a);
  perform pg_temp.rec('queue_next never returns a cancelled task as already claimed', 'false', coalesce(r ->> 'already_claimed', 'null'));
  perform pg_temp.rec('...and it ended the stale claim', '0', pg_temp.live_claims(t1));
  perform pg_temp.rec('...and said so plainly (nothing eligible)', 'none_eligible', r ->> 'reason');

  insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test) values (v_org, t1, v_a, now() - interval '1 minute', true);
  delete from public.ops_incidents where external_reference = 'queue_claim_expiry';
  r := private.expire_task_claims();
  perform pg_temp.rec('the expiry sweep ends the stale claim without error', '0', (r ->> 'errors'));
  perform pg_temp.rec('...counts it as stale', '1', (r ->> 'stale_ended'));
  perform pg_temp.rec('...opens no sev1 incident', '0', (select count(*)::text from public.ops_incidents where external_reference = 'queue_claim_expiry'));
  perform pg_temp.rec('...and writes no error row', '0', (select count(*)::text from public.audit_log where action = 'queue_expiry.error' and entity_id = t1));
  perform pg_temp.rec('...and no reliability penalty for the clinician', '0',
    (select count(*)::text from public.clinician_reliability_events where task_id = t1 and kind = 'claim_expired'));

  -- 4. nothing live on a task that is not claimed anywhere in this transaction -------------------------------------------
  perform pg_temp.rec('no live claim sits on an unclaimed task', '0', (select count(*)::text from public.task_claims k join public.clinical_tasks ct on ct.id = k.task_id
                                                                          where k.ended_at is null and ct.state <> 'claimed'));
  -- the real-claim path still works end to end after the fix
  perform pg_temp.setf('t3', private.create_clinical_task(v_p, 'amber_bp_review'));
  r := pg_temp.next_as(v_a);
  perform pg_temp.rec('a normal claim is still made', pg_temp.f('t3')::text, r -> 'task' ->> 'id');
end $$;

-- 5. SABOTAGE: the helper that ends a claim does nothing; cancelling a claimed task must leave the claim live ----------------
-- (queue_next and the sweep also heal a stale claim, so this checks the first layer on its own with a direct read.)
create or replace function private.end_task_claim(p_task uuid, p_to public.clinical_task_state) returns integer
language sql security definer set search_path = '' as $$ select 0 $$;

do $$
declare v_a uuid := pg_temp.f('A'); v_p uuid; t uuid; v_org uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  -- release A's live claim on t3 first, so the sabotaged scenario starts clean
  update public.task_claims set ended_at = now(), end_reason = 'cancelled' where clinician_id = v_a and ended_at is null;
  update public.clinical_tasks set state = state where false;
  select patient_id into v_p from public.clinical_tasks where id = pg_temp.f('t3');
  perform private.apply_task_transition(pg_temp.f('t3'), 'open', 'system', null, 'sabotage reset');
  t := pg_temp.f('t3');
  perform pg_temp.next_as(v_a);
  perform private.apply_task_transition(t, 'cancelled', 'lead', null, 'D3 sabotage: cancelled while claimed');
  insert into results values ('sabotaged', 'cancelling a claimed task ended the claim', '0', pg_temp.live_claims(t));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'D3 proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then
    raise exception 'VACUOUS TEST: removing the claim-ending helper did not change the D3 check';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
