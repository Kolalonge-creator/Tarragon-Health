-- Proof: the two-minute upload-check sweep proves its call with a one-time code, not a copied secret
-- (migration 20261105184327_upload_check_kick_one_time_codes.sql, security audit 2026-11-05 M-4/L-4).
--
--   1. With no app_base_url in Vault the kick does nothing (a local or CI database never calls out).
--   2. With an address and a file waiting, the kick makes exactly one code and queues one POST to the sweep route that
--      carries that code and no Authorization header (no secret leaves the database).
--   3. With nothing waiting, the kick makes no code and no call.
--   4. The code is accepted once; a second use, an unknown code and a code over ten minutes old are refused.
--   5. A signed-in user cannot spend codes. Three unanswered calls in an hour open one ops incident, not one per kick.
--   6. SABOTAGE: a consume that ignores used_at accepts the same code twice, so check 4 discriminates.
-- Everything runs in one transaction and is rolled back.
begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
grant all on results to public;

-- Start from a known state inside this transaction: no codes, no waiting files, no request queue entries for the route.
delete from private.client_upload_check_kicks;
update private.client_upload_checks set status = 'clean' where status in ('pending', 'checking', 'error');
delete from vault.secrets where name = 'app_base_url';

create or replace function pg_temp.route_calls() returns integer language sql as $$
  select count(*)::integer from net.http_request_queue where url like '%/api/cron/verify-client-uploads'
$$;
create temp table baseline as select pg_temp.route_calls() as n;

-- A waiting file.
insert into storage.objects (bucket_id, name, owner_id, version)
values ('meal-photos', gen_random_uuid()::text || '/kick-probe.jpg', gen_random_uuid()::text, 'v1');

-- 1. No address: nothing happens.
select private.kick_client_upload_checks();
insert into results values
  ('no app address: no code made', '0', (select count(*)::text from private.client_upload_check_kicks)),
  ('no app address: no call queued', '0', (select (pg_temp.route_calls() - n)::text from baseline));

-- 2. With an address: one code, one call carrying it, and no Authorization header.
select vault.create_secret('https://app.example.test/', 'app_base_url');
select private.kick_client_upload_checks();
insert into results values
  ('one code made', '1', (select count(*)::text from private.client_upload_check_kicks)),
  ('one call queued', '1', (select (pg_temp.route_calls() - n)::text from baseline)),
  ('the call carries the code',
   'true',
   (select (q.headers ->> 'x-upload-check-kick' = (select code::text from private.client_upload_check_kicks limit 1))::text
    from net.http_request_queue q where q.url = 'https://app.example.test/api/cron/verify-client-uploads' order by q.id desc limit 1)),
  ('the call carries no secret',
   'false',
   (select (q.headers ? 'Authorization')::text
    from net.http_request_queue q where q.url = 'https://app.example.test/api/cron/verify-client-uploads' order by q.id desc limit 1));

-- 3. Nothing waiting: no new code.
update private.client_upload_checks set status = 'clean' where status = 'pending';
select private.kick_client_upload_checks();
insert into results values ('nothing waiting: no new code', '1', (select count(*)::text from private.client_upload_check_kicks));

-- 4. Spend once only, within ten minutes.
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
insert into results values
  ('a fresh code is accepted', 'true', public.consume_client_upload_check_kick((select code from private.client_upload_check_kicks limit 1))::text);
insert into results values
  ('the same code is refused the second time', 'false', public.consume_client_upload_check_kick((select code from private.client_upload_check_kicks limit 1))::text),
  ('an unknown code is refused', 'false', public.consume_client_upload_check_kick(gen_random_uuid())::text);
insert into private.client_upload_check_kicks (code, created_at) values ('00000000-0000-4000-8000-000000000011', now() - interval '11 minutes');
insert into results values
  ('a code over ten minutes old is refused', 'false', public.consume_client_upload_check_kick('00000000-0000-4000-8000-000000000011')::text);

-- 5. A signed-in user cannot spend codes.
insert into private.client_upload_check_kicks (code) values ('00000000-0000-4000-8000-000000000022');
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform public.consume_client_upload_check_kick('00000000-0000-4000-8000-000000000022');
  insert into results values ('a signed-in user cannot spend a code', 'refused', 'allowed');
exception when insufficient_privilege then
  insert into results values ('a signed-in user cannot spend a code', 'refused', 'refused');
end $$;
reset role;

-- 5b. Unanswered calls are raised on the ops desk: three unspent codes older than ten minutes open one incident.
reset role;
delete from private.client_upload_check_kicks;
insert into private.client_upload_check_kicks (created_at) select now() - interval '20 minutes' from generate_series(1, 3);
update private.client_upload_checks set status = 'clean' where status = 'pending';
select private.kick_client_upload_checks();
insert into results values
  ('three unanswered calls open one ops incident', '1',
   (select count(*)::text from public.ops_incidents
    where external_reference = 'upload-check-sweep-unanswered:' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24')));
select private.kick_client_upload_checks();
insert into results values
  ('a second kick in the same hour does not duplicate it', '1',
   (select count(*)::text from public.ops_incidents
    where external_reference = 'upload-check-sweep-unanswered:' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24')));

-- 6. Sabotage: ignore used_at, and the same code is accepted twice.
insert into private.client_upload_check_kicks (code) values ('00000000-0000-4000-8000-000000000033');
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
create or replace function public.consume_client_upload_check_kick(p_code uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.client_upload_check_kicks set used_at = now() where code = p_code and created_at > now() - interval '10 minutes';
  return found;
end;
$$;
insert into results values
  ('SABOTAGE: without the used check a code works twice', 'true',
   (public.consume_client_upload_check_kick('00000000-0000-4000-8000-000000000033')
    and public.consume_client_upload_check_kick('00000000-0000-4000-8000-000000000033'))::text);
select set_config('request.jwt.claims', null, true);

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as outcome from results;

do $$
declare v_fail text;
begin
  select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', '; ') into v_fail
  from results where expected is distinct from actual;
  if v_fail is not null then
    raise exception 'upload_check_kick_one_time_codes FAILED: %', v_fail;
  end if;
  if (select count(*) from results) <> 15 then
    raise exception 'upload_check_kick_one_time_codes: expected 15 checks, got %', (select count(*) from results);
  end if;
end $$;

rollback;
