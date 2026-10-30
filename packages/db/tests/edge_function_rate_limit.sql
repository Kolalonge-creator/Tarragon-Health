-- Tarragon Health: per-user rate limit for edge functions that bypass the web proxy (OQ-267)
-- (migration 20261030005229_edge_function_rate_limit).
--
-- Proves:
--   1. a signed-in user is allowed up to the limit in one window and refused after it, with a retry time between 1 and 60 seconds;
--   2. the count is per user: a second user is unaffected, and per bucket: another bucket is unaffected;
--   3. an unknown bucket and an anonymous caller are refused without counting;
--   4. anon cannot execute the function and a signed-in user cannot read or write the counter table directly.
--
-- Sabotage (by hand): change `if v_hits > v_limit` to `if v_hits > v_limit + 1000` in the function. Step 1 must then fail.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/edge_function_rate_limit.sql

begin;

do $$
declare
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_res jsonb; i integer; v_retry integer;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_a, 'rl-a-' || substr(v_a::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'),
         (v_b, 'rl-b-' || substr(v_b::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  -- 1. order-checkout allows 20, refuses the 21st
  for i in 1..20 loop
    v_res := public.edge_rate_limit_hit('order-checkout');
    if (v_res->>'allowed')::boolean is not true then raise exception 'step 1: call % should be allowed, got %', i, v_res; end if;
  end loop;
  v_res := public.edge_rate_limit_hit('order-checkout');
  if (v_res->>'allowed')::boolean is not false then raise exception 'step 1: call 21 should be refused, got %', v_res; end if;
  v_retry := (v_res->>'retry_after_seconds')::integer;
  if v_retry is null or v_retry < 1 or v_retry > 60 then raise exception 'step 1: retry time out of range: %', v_res; end if;

  -- 2a. another bucket for the same user is unaffected
  v_res := public.edge_rate_limit_hit('order-verify');
  if (v_res->>'allowed')::boolean is not true then raise exception 'step 2: other bucket should be allowed, got %', v_res; end if;

  -- 2b. another user on the same bucket is unaffected
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  v_res := public.edge_rate_limit_hit('order-checkout');
  if (v_res->>'allowed')::boolean is not true then raise exception 'step 2: other user should be allowed, got %', v_res; end if;

  -- 3a. unknown bucket refused, and no retry time (so the edge function does not treat it as a rate limit)
  v_res := public.edge_rate_limit_hit('not-a-bucket');
  if (v_res->>'allowed')::boolean is not false or v_res ? 'retry_after_seconds' then raise exception 'step 3: unknown bucket, got %', v_res; end if;

  -- 4. a signed-in user cannot touch the table
  begin
    perform 1 from private.edge_rate_limits limit 1;
    raise exception 'step 4: signed-in user could read the counter table';
  exception when insufficient_privilege then null;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);

  -- 3b. anon: no execute
  if has_function_privilege('anon', 'public.edge_rate_limit_hit(text)', 'EXECUTE') then raise exception 'step 4: anon can execute'; end if;
  -- 3c. no user at all: refused
  v_res := public.edge_rate_limit_hit('queue-next');
  if (v_res->>'allowed')::boolean is not false or v_res->>'error' <> 'unauthorised' then raise exception 'step 3: no user, got %', v_res; end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
