-- S72 proof (OQ-431): the Access Fund and payment-link expiry functions are scheduled, and running them expires what it should and nothing else.
-- Migration 20261023180147_s72_schedule_expiry_functions.sql. One rolled-back transaction. Sections:
--   A. The two pg_cron jobs exist once each, are active, and call the private cores (no session needed).
--   B. Seeded rows of every state: running the scheduled command lapses only the unmatched pledge past its date, expires only the unused grant past its
--      date (closing only its own programme), expires only the open payment link past its date; everything else is byte-for-byte untouched.
--   C. Running again changes nothing (idempotent), and the migration's own re-run does not duplicate a job.
--   D. Who may call what: the public functions still refuse a patient and anon, still run for an admin and the service role; the cores are closed to both roles.
--   E. SABOTAGE: jobs unscheduled, the core made a no-op, the core made to expire everything; each must flip its check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.r(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.q_as(p_uid uuid, p_role text, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  execute format('set local role %I', p_role);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's72x-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S72x ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
-- the command a cron job runs, executed with no session at all (exactly as pg_cron does)
create function pg_temp.run_job(p_name text) returns text language plpgsql as
$f$ declare v_cmd text; r text;
begin
  select command into v_cmd from cron.job where jobname = p_name;
  if v_cmd is null then return 'no job'; end if;
  execute v_cmd;
  return 'ran';
end $f$;
-- seed one of every state; p_tag keeps references unique
create function pg_temp.seed(p_tag text) returns void language plpgsql as
$f$ declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_item uuid; v_prog uuid; v_i integer;
begin
  select id into v_item from public.catalog_items order by created_at limit 1;
  set local session_replication_role = replica;
  -- donations: unmatched pledge past its date (to lapse), live pledge, received (past date), cancelled (past date)
  insert into public.donations (organisation_id, reference, amount_kobo, state, pledge_expires_at, bank_reference, received_at) values
    (v_org, 'CAF-' || rpad(p_tag, 6, 'X') || 'P1', 100000, 'pledged', now() - interval '1 hour', null, null),
    (v_org, 'CAF-' || rpad(p_tag, 6, 'X') || 'P2', 100000, 'pledged', now() + interval '3 days', null, null),
    (v_org, 'CAF-' || rpad(p_tag, 6, 'X') || 'R1', 100000, 'received', now() - interval '9 days', 'TRF-' || p_tag, now() - interval '10 days'),
    (v_org, 'CAF-' || rpad(p_tag, 6, 'X') || 'C1', 100000, 'cancelled', now() - interval '9 days', null, null);
  -- grants: each has its own programme. G1 approved+past+no reservation (expires, programme closes); G2 approved+past but a reservation is open (stays);
  -- G3 approved+future (stays); G4 used+past (stays)
  for v_i in 1..4 loop
    insert into public.sponsor_programmes (organisation_id, sponsor_org_id, name, item_codes, share_percent, budget_kobo, eligibility, valid_from, valid_to, status)
    values (v_org, v_org, 'S72x grant ' || p_tag || v_i, array['proof_item'], 100, 100000, 'access_grant', current_date - 30, current_date + 30, 'active') returning id into v_prog;
    perform pg_temp.setf('prog' || p_tag || v_i, v_prog);
    insert into public.access_fund_grants (organisation_id, patient_id, item_code, ceiling_kobo, criterion_key, decision_note, status, expires_at, programme_id, order_id, used_kobo, approved_at)
    values (v_org, v_pat, lower('proof_' || p_tag || v_i), 100000, 'care_cost_is_a_barrier', 'S72x proof grant ' || p_tag || v_i,
            case v_i when 4 then 'used' else 'approved' end,
            case v_i when 3 then now() + interval '5 days' else now() - interval '1 hour' end,
            v_prog, case v_i when 4 then gen_random_uuid() end, case v_i when 4 then 100000 end, now() - interval '20 days');
  end loop;
  insert into public.sponsor_reservations (organisation_id, programme_id, order_id, beneficiary_id, amount_kobo, state)
  values (v_org, pg_temp.f('prog' || p_tag || '2'), gen_random_uuid(), v_pat, 100000, 'reserved');
  -- payment links: open past (to expire), open live, pending_payment past, paid past, cancelled past
  insert into public.payment_requests (organisation_id, requester_id, beneficiary_id, catalog_item_id, code_hash, status, expires_at, order_id, paid_at, cancelled_at) values
    (v_org, v_pat, v_pat, v_item, md5(p_tag || 'a') || md5(p_tag || 'b'), 'open', now() - interval '1 hour', null, null, null),
    (v_org, v_pat, v_pat, v_item, md5(p_tag || 'c') || md5(p_tag || 'd'), 'open', now() + interval '3 days', null, null, null),
    (v_org, v_pat, v_pat, v_item, md5(p_tag || 'e') || md5(p_tag || 'f'), 'pending_payment', now() - interval '1 hour', gen_random_uuid(), null, null),
    (v_org, v_pat, v_pat, v_item, md5(p_tag || 'g') || md5(p_tag || 'h'), 'paid', now() - interval '1 hour', null, now() - interval '2 hours', null),
    (v_org, v_pat, v_pat, v_item, md5(p_tag || 'i') || md5(p_tag || 'j'), 'cancelled', now() - interval '1 hour', null, null, now() - interval '2 hours');
  set local session_replication_role = origin;
end $f$;
create function pg_temp.don(p_tag text) returns text language sql as
$$ select string_agg(right(reference, 2) || ':' || state, ',' order by array_position(array['P1','P2','R1','C1'], right(reference, 2))) from public.donations where reference like 'CAF-' || rpad(p_tag, 6, 'X') || '%' $$;
create function pg_temp.gr(p_tag text) returns text language sql as
$$ select string_agg(right(decision_note, 1) || ':' || status, ',' order by decision_note) from public.access_fund_grants where decision_note like 'S72x proof grant ' || p_tag || '%' $$;
create function pg_temp.prg(p_tag text) returns text language sql as
$$ select string_agg(right(name, 1) || ':' || status, ',' order by name) from public.sponsor_programmes where name like 'S72x grant ' || p_tag || '%' $$;
create function pg_temp.req(p_tag text) returns text language sql as
$$ select string_agg(r.status, ',' order by h.ord) from unnest(array[md5(p_tag || 'a') || md5(p_tag || 'b'), md5(p_tag || 'c') || md5(p_tag || 'd'), md5(p_tag || 'e') || md5(p_tag || 'f'),
     md5(p_tag || 'g') || md5(p_tag || 'h'), md5(p_tag || 'i') || md5(p_tag || 'j')]) with ordinality h(hash, ord) join public.payment_requests r on r.code_hash = h.hash $$;

do $$
declare v_org uuid;
begin
  select id into v_org from public.organisations where type <> 'provider_org' order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('admin', pg_temp.mkuser(v_org, 'admin', 'admin', false));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
end $$;

-- A. The jobs ------------------------------------------------------------------------------------------------------------------------
select pg_temp.r('A1 both jobs exist exactly once and are active', '1|1|true|true',
  (select count(*) filter (where jobname = 'expire-access-fund')::text || '|' || count(*) filter (where jobname = 'expire-payment-requests')::text || '|' ||
          bool_and(active)::text || '|' || (count(*) = 2)::text from cron.job where jobname in ('expire-access-fund', 'expire-payment-requests')));
select pg_temp.r('A2 each runs its private core (not the admin-gated public function, which pg_cron could never pass)', 'select private.expire_access_fund_core()|select private.expire_payment_requests_core()',
  (select string_agg(command, '|' order by jobname) from cron.job where jobname in ('expire-access-fund', 'expire-payment-requests')));
select pg_temp.r('A3 hourly, at minutes that do not collide with the other expiry jobs', '27 * * * *|33 * * * *',
  (select string_agg(schedule, '|' order by jobname) from cron.job where jobname in ('expire-access-fund', 'expire-payment-requests')));

-- B. What running them does ------------------------------------------------------------------------------------------------------------
select pg_temp.seed('A1');
select pg_temp.r('B1 before the run every seeded row is in its starting state', 'P1:pledged,P2:pledged,R1:received,C1:cancelled|1:approved,2:approved,3:approved,4:used|1:active,2:active,3:active,4:active|open,open,pending_payment,paid,cancelled',
  pg_temp.don('A1') || '|' || pg_temp.gr('A1') || '|' || pg_temp.prg('A1') || '|' || pg_temp.req('A1'));
select pg_temp.r('B2 the scheduled command runs with no session', 'ran|ran', pg_temp.run_job('expire-access-fund') || '|' || pg_temp.run_job('expire-payment-requests'));
select pg_temp.r('B3 only the unmatched pledge past its date lapsed; the live pledge, the received and the cancelled gift are untouched', 'P1:lapsed,P2:pledged,R1:received,C1:cancelled', pg_temp.don('A1'));
select pg_temp.r('B4 only the unused grant past its date expired: the one with an open reservation, the future one and the used one are untouched', '1:expired,2:approved,3:approved,4:used', pg_temp.gr('A1'));
select pg_temp.r('B5 only that grant''s own programme closed', '1:closed,2:active,3:active,4:active', pg_temp.prg('A1'));
select pg_temp.r('B6 only the open link past its date expired; live, pending-payment, paid and cancelled links keep their status', 'expired,open,pending_payment,paid,cancelled', pg_temp.req('A1'));
select pg_temp.r('B7 the paid link still has its paid time and the cancelled one its cancelled time (nothing else was rewritten)', '1|1',
  (select count(*)::text from public.payment_requests where code_hash = md5('A1g') || md5('A1h') and paid_at is not null) || '|' ||
  (select count(*)::text from public.payment_requests where code_hash = md5('A1i') || md5('A1j') and cancelled_at is not null));

-- C. Idempotent ----------------------------------------------------------------------------------------------------------------------------
select pg_temp.r('C1 a second run changes nothing and the counts are zero', '0|0|0',
  (private.expire_access_fund_core() ->> 'pledges_lapsed') || '|' || (private.expire_access_fund_core() ->> 'grants_expired') || '|' || private.expire_payment_requests_core()::text);
do $$
begin
  perform cron.unschedule(jobname) from cron.job where jobname in ('expire-access-fund', 'expire-payment-requests');
  perform cron.schedule('expire-access-fund', '27 * * * *', $c$select private.expire_access_fund_core()$c$);
  perform cron.schedule('expire-payment-requests', '33 * * * *', $c$select private.expire_payment_requests_core()$c$);
  perform cron.unschedule(jobname) from cron.job where jobname in ('expire-access-fund', 'expire-payment-requests');
  perform cron.schedule('expire-access-fund', '27 * * * *', $c$select private.expire_access_fund_core()$c$);
  perform cron.schedule('expire-payment-requests', '33 * * * *', $c$select private.expire_payment_requests_core()$c$);
end $$;
select pg_temp.r('C2 re-running the migration''s scheduling block twice leaves one job each, not two', '1|1',
  (select count(*) filter (where jobname = 'expire-access-fund')::text || '|' || count(*) filter (where jobname = 'expire-payment-requests')::text from cron.job));

-- D. Who may call what -----------------------------------------------------------------------------------------------------------------
select pg_temp.seed('A2');
select pg_temp.r('D1 a patient and anon are refused by the public functions (the check is unchanged)', 'ERR:42501|ERR:42501|ERR:42501|ERR:42501',
  pg_temp.q_as(pg_temp.f('pat'), 'authenticated', 'select public.expire_access_fund()::text') || '|' || pg_temp.q_as(pg_temp.f('pat'), 'authenticated', 'select public.expire_payment_requests()::text') || '|' ||
  pg_temp.q_as(null, 'anon', 'select public.expire_access_fund()::text') || '|' || pg_temp.q_as(null, 'anon', 'select public.expire_payment_requests()::text'));
select pg_temp.r('D2 nothing was expired by the refused calls', 'P1:pledged,P2:pledged,R1:received,C1:cancelled', pg_temp.don('A2'));
select pg_temp.r('D3 an admin runs both (the gate opens) and gets the counts: one pledge lapsed, one link expired', '1|1',
  (pg_temp.q_as(pg_temp.f('admin'), 'authenticated', 'select (public.expire_access_fund() ->> ''pledges_lapsed'')')) || '|' ||
  (pg_temp.q_as(pg_temp.f('admin'), 'authenticated', 'select public.expire_payment_requests()::text')));
select pg_temp.r('D3b ...and the admin run really changed the rows', 'P1:lapsed,P2:pledged,R1:received,C1:cancelled|expired,open,pending_payment,paid,cancelled', pg_temp.don('A2') || '|' || pg_temp.req('A2'));
select pg_temp.seed('A3');
select pg_temp.r('D4 the service role runs both', '1|1',
  (pg_temp.q_as(null, 'service_role', 'select (public.expire_access_fund() ->> ''pledges_lapsed'')')) || '|' || (pg_temp.q_as(null, 'service_role', 'select public.expire_payment_requests()::text')));
select pg_temp.r('D5 the cores are closed to both signed-in roles and anon', '0',
  (select count(*)::text from unnest(array['private.expire_access_fund_core()', 'private.expire_payment_requests_core()']) f
     where has_function_privilege('anon', f::regprocedure, 'EXECUTE') or has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')));
select pg_temp.r('D6 anon has no execute on either public function; PUBLIC holds none', '0',
  (select count(*)::text from unnest(array['public.expire_access_fund()', 'public.expire_payment_requests()']) f join pg_proc p on p.oid = f::regprocedure
     where has_function_privilege('anon', p.oid, 'EXECUTE') or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)));

-- E. SABOTAGE -----------------------------------------------------------------------------------------------------------------------------
-- (a) a job unscheduled: it is no longer there
select cron.unschedule('expire-payment-requests');
select pg_temp.sab('the payment-link expiry job is still scheduled', '1', (select count(*)::text from cron.job where jobname = 'expire-payment-requests'));
-- (b) the core made a no-op: an old pledge is not lapsed
create or replace function private.expire_access_fund_core() returns jsonb language sql security definer set search_path = '' as $$ select '{}'::jsonb $$;
select pg_temp.seed('A4');
select pg_temp.run_job('expire-access-fund');
select pg_temp.sab('the old pledge is still lapsed by the scheduled run', 'P1:lapsed,P2:pledged,R1:received,C1:cancelled', pg_temp.don('A4'));
-- (c) the core made to expire everything: the live pledge is lapsed too
create or replace function private.expire_access_fund_core() returns jsonb language plpgsql security definer set search_path = '' as $$
begin update public.donations set state = 'lapsed' where state = 'pledged'; return '{}'::jsonb; end $$;
select pg_temp.seed('A5');
select pg_temp.run_job('expire-access-fund');
select pg_temp.sab('the live pledge is still left alone by the scheduled run', 'P1:lapsed,P2:pledged,R1:received,C1:cancelled', pg_temp.don('A5'));

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S72 expiry schedule proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
