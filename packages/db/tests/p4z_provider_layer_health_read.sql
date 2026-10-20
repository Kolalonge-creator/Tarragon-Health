-- P4z proof: provider layer health read (migration *_p4z_provider_layer_health_read.sql). One rolled-back transaction. Proves: only an admin
-- or the CMO may read it; an old unprocessed webhook, a dead one, an open breaker, an old reconciliation break and a failed payout posting each
-- appear with a reason and move the status to "needs a look"; a flood of rejected deliveries is shown but never judged; every limit comes from
-- the existing providers.layer config; nothing sensitive is in the reply. SABOTAGE: the limit made enormous, and the role check removed.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- one statement as a user: first column on success, otherwise the error message (the migration raises coded messages)
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; r := coalesce(r, 'ok'); exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.jq(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$ declare t text := pg_temp.q_as(p_uid, p_sql);
begin
  if t like 'ERR:%' then raise exception 'fixture call failed: % (%)', t, left(p_sql, 80); end if;
  return t::jsonb;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'p4y-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'P4y ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;

create function pg_temp.hj(p_uid uuid) returns jsonb language plpgsql as
$f$ declare t text := pg_temp.q_as(p_uid, 'select public.provider_layer_health()::text');
begin
  if t like 'ERR:%' then raise exception '%', t; end if;
  return t::jsonb;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_doc uuid; v_cmo uuid; b jsonb; a jsonb; v_n integer; v_reasons integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin1', 'admin');
  v_doc := pg_temp.mkuser(v_org, 'clinician1', 'clinician');
  v_cmo := pg_temp.mkuser(v_org, 'cmo1', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_cmo, 'P4z cmo', 'MDCN', 'P4z-cmo-' || substr(v_cmo::text, 1, 8), true, 'active', now(), v_admin,
      'chief_medical_officer'::public.doctor_tier, 'employed'::public.staff_employment_type, 2, true, v_admin, true);

  -- 0. Who may read it --------------------------------------------------------------------------------
  perform pg_temp.ck('a clinician who is not the CMO is refused', 'ERR:provider_health_not_authorised', pg_temp.q_as(v_doc, 'select public.provider_layer_health()::text'));
  perform pg_temp.ck('anon cannot run it', 'false', has_function_privilege('anon', 'public.provider_layer_health()', 'EXECUTE')::text);
  b := pg_temp.hj(v_admin);
  perform pg_temp.ck('the CMO reads the same shape as an admin', 'true', ((pg_temp.hj(v_cmo)) ?& array['status', 'reasons', 'inbox', 'breakers', 'reconciliation', 'payout_postings'])::text);
  v_reasons := jsonb_array_length(b -> 'reasons');

  set local session_replication_role = replica;
  -- 1. A webhook that has waited longer than a retry can take: nothing is draining the inbox ---------------
  insert into public.provider_events (provider, event_type, idempotency_key, raw_body, content_sha256, signature_verified, status, received_at, next_attempt_at)
  values ('zoom', 'meeting.ended', 'p4z-old-' || gen_random_uuid(), '{}', repeat('a', 64), true, 'received', now() - interval '2 days', now() - interval '2 days');
  set local session_replication_role = origin;
  a := pg_temp.hj(v_admin);
  perform pg_temp.ck('an old unprocessed event counts as waiting too long', '1', ((a #>> '{inbox,waiting_too_long}')::integer - (b #>> '{inbox,waiting_too_long}')::integer)::text);
  perform pg_temp.ck('and the status needs a look with a reason that names the drain', 'attention|true', (a ->> 'status') || '|' || ((a ->> 'reasons') like '%draining the inbox%')::text);
  perform pg_temp.ck('the oldest open event is at least two days old', 'true', ((a #>> '{inbox,oldest_open_seconds}')::integer >= 172800)::text);
  perform pg_temp.ck('the stale limit is the config backoff plus lease (3720 seconds), not a number of its own', '3720', (a #>> '{inbox,stale_after_seconds}'));

  -- 2. A dead event ---------------------------------------------------------------------------------
  set local session_replication_role = replica;
  insert into public.provider_events (provider, event_type, idempotency_key, raw_body, content_sha256, signature_verified, status, received_at, attempt_count)
  values ('paystack', 'charge.success', 'p4z-dead-' || gen_random_uuid(), '{}', repeat('b', 64), true, 'dead', now() - interval '1 hour', 8);
  set local session_replication_role = origin;
  b := a; a := pg_temp.hj(v_admin);
  perform pg_temp.ck('a dead event is counted', '1', ((a #>> '{inbox,dead}')::integer - (b #>> '{inbox,dead}')::integer)::text);

  -- 3. A flood of forged deliveries is shown but never judged -------------------------------------------------
  set local session_replication_role = replica;
  for v_n in 1..5 loop
    insert into public.provider_events (provider, event_type, idempotency_key, raw_body, content_sha256, signature_verified, status, received_at)
    values ('resend', 'unparseable', 'p4z-rej-' || v_n || gen_random_uuid(), '{}', repeat('c', 64), false, 'rejected', now() - interval '1 hour');
  end loop;
  set local session_replication_role = origin;
  b := a; a := pg_temp.hj(v_admin);
  perform pg_temp.ck('rejected deliveries in the last day are shown', '5', ((a #>> '{inbox,rejected_24h}')::integer - (b #>> '{inbox,rejected_24h}')::integer)::text);
  perform pg_temp.ck('and add no reason and do not count as waiting', 'true', ((jsonb_array_length(a -> 'reasons') = jsonb_array_length(b -> 'reasons')) and (a #>> '{inbox,waiting_too_long}') = (b #>> '{inbox,waiting_too_long}'))::text);

  -- 4. An open circuit breaker -----------------------------------------------------------------------------
  b := a;
  insert into public.provider_health (provider, operation, state, consecutive_failures, opened_at) values ('paystack', 'proof_probe', 'open', 5, now())
    on conflict (provider, operation) do update set state = 'open';
  a := pg_temp.hj(v_admin);
  perform pg_temp.ck('an open breaker is counted with a reason', '1|true', ((a #>> '{breakers,open}')::integer - (b #>> '{breakers,open}')::integer)::text || '|' || ((a ->> 'reasons') like '%circuit breaker%')::text);

  -- 5. A reconciliation break older than the limit ---------------------------------------------------------
  b := a;
  insert into public.reconciliation_breaks (provider_reference, break_type, status, first_seen_at) values ('p4z-old-break', 'missing_in_ledger', 'open', now() - interval '5 days');
  insert into public.reconciliation_breaks (provider_reference, break_type, status, first_seen_at) values ('p4z-new-break', 'missing_in_ledger', 'open', now() - interval '1 hour');
  a := pg_temp.hj(v_admin);
  perform pg_temp.ck('two open breaks are counted but only the old one is over the limit', '2|1', ((a #>> '{reconciliation,open_breaks}')::integer - (b #>> '{reconciliation,open_breaks}')::integer)::text || '|' || ((a #>> '{reconciliation,older_than_limit}')::integer - (b #>> '{reconciliation,older_than_limit}')::integer)::text);
  perform pg_temp.ck('the limit shown is the config 72 hours', '72', (a #>> '{reconciliation,limit_hours}'));

  -- 6. A payout ledger posting that failed -----------------------------------------------------------------------
  b := a;
  set local session_replication_role = replica;
  insert into public.payout_gl_postings (payout_id, attempt, kind, status, amount_kobo, error) values (gen_random_uuid(), 1, 'sent', 'failed', 100000, 'p4z fixture');
  set local session_replication_role = origin;
  a := pg_temp.hj(v_admin);
  perform pg_temp.ck('a failed payout posting is counted with a reason', '1|true', ((a #>> '{payout_postings,failed}')::integer - (b #>> '{payout_postings,failed}')::integer)::text || '|' || ((a ->> 'reasons') like '%payout ledger posting%')::text);
  perform pg_temp.ck('no body, email or patient anywhere in the reply', 'false', ((a::text) ~* '(raw_body|@|patient)')::text);

  -- 7. SABOTAGE: the staleness test removed -> the old event must stop counting ----------------------------------
  create or replace function private.provider_layer_setting(p_group text, p_key text) returns jsonb language sql stable security definer set search_path = ''
    as $s$ select case when p_key = 'backoffMaxSeconds' then to_jsonb(99999999) else (select rules -> p_group -> p_key from public.provider_layer_config where is_active) end $s$;
  insert into results values ('sabotaged', 'an old unprocessed event counts as waiting too long (limit made enormous)', '1',
    (((pg_temp.hj(v_admin)) #>> '{inbox,waiting_too_long}')::integer - (b #>> '{inbox,waiting_too_long}')::integer)::text);
  -- 7b. SABOTAGE: role check removed (function recreated without it) -> a plain clinician must now be able to read
  drop function public.provider_layer_health();
  create function public.provider_layer_health() returns jsonb language sql stable security definer set search_path = '' as $s$ select '{}'::jsonb $s$;
  grant execute on function public.provider_layer_health() to authenticated;
  insert into results values ('sabotaged', 'a clinician who is not the CMO is refused (role check removed)', 'ERR:provider_health_not_authorised', pg_temp.q_as(v_doc, 'select public.provider_layer_health()::text'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'P4z proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: expected both sabotages to fail their checks, only % did', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
