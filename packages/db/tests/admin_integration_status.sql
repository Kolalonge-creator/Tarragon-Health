-- ===========================================================================
-- Proof: public.admin_integration_status(), the superadmin integrations centre reader
-- (docs/design/SUPERADMIN-CONSOLE.md, phase 2d).
--
-- Adds known provider activity and measures the DIFFERENCE it makes (existing data cannot make it pass or fail):
--   1. SMS: a Termii send counts as ok, a Termii failure as failed; a rate-limited attempt and a mock send count as
--      neither (rate limiting is our rule, the mock is not the provider);
--   2. ClamAV: clean and infected verdicts count as ok (the scanner answered), 'unavailable' as failed;
--   3. Zoom webhooks: a processed event counts as ok, a rejected signature as bad;
--   4. the answer carries counts and timestamps only: no key holds error text;
--   5. a patient session is refused with 42501; SABOTAGE: with the admin gate removed (this transaction only) the
--      patient gets through, so check 5 discriminates.
-- BEGIN/ROLLBACK: leaves the database as found.
-- ===========================================================================

begin;

create temporary table is_fixture(k text primary key, v uuid) on commit drop;
create temporary table is_read(k text primary key, j jsonb) on commit drop;
create temporary table is_result(check_name text, observed text, expected text, verdict text) on commit drop;

do $$
declare
  v_org uuid;
  r record;
begin
  insert into public.organisations (name, type) values ('Integration Status Proof Org', 'clinic') returning id into v_org;
  insert into is_fixture values ('org', v_org);
  for r in select * from (values ('admin', 'admin'), ('patient', 'patient')) t(k, role_name) loop
    insert into is_fixture values (r.k, gen_random_uuid());
    insert into auth.users (id, email) values ((select v from is_fixture where k = r.k), format('integrationproof.%s@example.com', r.k));
    insert into public.profiles (id, organisation_id, role, full_name)
    values ((select v from is_fixture where k = r.k), v_org, r.role_name::public.user_role, format('Integration Proof %s', r.k))
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  end loop;
end $$;

create function pg_temp.read_as(p_who text) returns jsonb language plpgsql as $f$
declare v_out jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select f.v from is_fixture f where f.k = p_who)::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.admin_integration_status();
  reset role;
  return v_out;
end $f$;

insert into is_read values ('before', pg_temp.read_as('admin'));

do $$
declare
  v_org uuid := (select v from is_fixture where k = 'org');
  v_hash text := repeat('a', 64);
begin
  insert into public.sms_delivery_log (purpose, phone_hash, provider, status, attempts)
  values ('auth_otp', v_hash, 'termii', 'sent', 1),
         ('auth_otp', v_hash, 'termii', 'failed', 1),
         ('auth_otp', v_hash, 'termii', 'rate_limited', 1),
         ('auth_otp', v_hash, 'mock', 'sent', 1);
  insert into public.upload_scan_verdicts (organisation_id, content_sha256, verdict, signature, channel)
  values (v_org, repeat('b', 64), 'clean', null, 'upload'),
         (v_org, repeat('c', 64), 'infected', 'Eicar-Test-Signature', 'upload'),
         (v_org, repeat('d', 64), 'unavailable', null, 'upload');
  insert into public.provider_events (provider, event_type, idempotency_key, content_sha256, signature_verified, status, raw_body)
  values ('zoom', 'meeting.ended', 'integrationproof-ok', repeat('e', 64), true, 'processed', '{}'),
         ('zoom', 'meeting.ended', 'integrationproof-bad', repeat('f', 64), false, 'rejected', '{}');
end $$;

insert into is_read values ('after', pg_temp.read_as('admin'));

insert into is_result
select c.name, c.observed::text, c.expected::text, case when c.observed = c.expected then 'PASS' else 'FAIL' end
from (
  select 'sms ok: one Termii send (mock and rate-limited left out)' name,
         (a.j->'sms'->>'ok_7d')::int - (b.j->'sms'->>'ok_7d')::int observed, 1 expected from is_read a, is_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'sms failed: one Termii failure', (a.j->'sms'->>'failed_7d')::int - (b.j->'sms'->>'failed_7d')::int, 1 from is_read a, is_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'clamav ok: clean and infected both mean the scanner answered', (a.j->'clamav'->>'ok_7d')::int - (b.j->'clamav'->>'ok_7d')::int, 2 from is_read a, is_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'clamav failed: unavailable', (a.j->'clamav'->>'failed_7d')::int - (b.j->'clamav'->>'failed_7d')::int, 1 from is_read a, is_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'zoom webhooks ok', (a.j->'zoom'->>'webhooks_ok_7d')::int - (b.j->'zoom'->>'webhooks_ok_7d')::int, 1 from is_read a, is_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'zoom webhooks bad (rejected signature)', (a.j->'zoom'->>'webhooks_bad_7d')::int - (b.j->'zoom'->>'webhooks_bad_7d')::int, 1 from is_read a, is_read b where a.k = 'after' and b.k = 'before'
  union all
  -- No key anywhere in the answer may carry error text, a message, a payload or a secret.
  select 'counts and timestamps only: no error, message, payload or secret keys',
         (select count(*)::int from is_read r, jsonb_each(r.j) p, jsonb_object_keys(case when jsonb_typeof(p.value) = 'object' then p.value else '{}'::jsonb end) inner_key
           where r.k = 'after' and inner_key ~ '(error|message|payload|secret|raw|phone|email)'), 0
) c;

do $$
declare v_state text := 'none';
begin
  begin
    perform pg_temp.read_as('patient');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
  end;
  insert into is_result values ('patient session refused with 42501', v_state, '42501', case when v_state = '42501' then 'PASS' else 'FAIL' end);
end $$;

-- SABOTAGE: an ungated copy (this transaction only) lets the patient through.
do $$
declare
  v_def text := pg_get_functiondef('public.admin_integration_status()'::regprocedure);
  v_state text := 'none';
begin
  execute replace(v_def, 'if not private.is_admin() then', 'if false then');
  begin
    perform pg_temp.read_as('patient');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
  end;
  insert into is_result values ('SABOTAGE: ungated function lets the patient in', v_state, 'none', case when v_state = 'none' then 'PASS' else 'FAIL' end);
end $$;

do $$
begin
  if exists (select 1 from is_result where verdict <> 'PASS') then
    raise exception 'admin_integration_status proof failed: %', (select string_agg(check_name || ' observed=' || observed || ' expected=' || expected, '; ') from is_result where verdict <> 'PASS');
  end if;
end $$;

select check_name, observed, expected, verdict from is_result order by check_name;

rollback;
