-- ===========================================================================
-- Verification: the contract behind the analytics console's refusal guard
-- (apps/web/src/lib/analytics/answer.ts).
--
-- Every analytics RPC answers a caller who is not an analyst with an EMPTY
-- answer instead of an error, and the dashboards' Zod schemas turn an empty
-- object into a full set of zeros, so a refused call used to read as a healthy
-- "nothing yet". answer.ts now rejects exactly `{}` before parsing. That is
-- only safe, and only effective, while two things stay true of every RPC that
-- answers with an object:
--
--   1. a refused caller gets exactly `{}`, and
--   2. an authorised caller NEVER gets `{}` (every one is built with
--      jsonb_build_object, so it always has keys).
--
-- Break (1) and the guard goes quietly blind: an RPC that starts refusing with
-- `{"total": 0}` sails through as a genuine zero. Break (2) and the guard
-- starts rejecting real answers. Neither would fail any other test, which is
-- why this exists. It was measured by hand against the live database on
-- 2026-10-30 (32 object RPCs, all consistent); this makes it standing.
--
-- Discovery is live from pg_proc rather than a hardcoded list, so a new
-- analytics RPC is covered the day it is added. The filter is: in public,
-- returns jsonb, is a function, is STABLE or IMMUTABLE (a writer is VOLATILE,
-- which keeps analytics_upsert_* and analytics_log_patient_access out),
-- and takes no required arguments. A canary fails if discovery goes stale.
-- The three diagnostic_* RPCs are named explicitly because they are consumed
-- by the same hooks but do not share the prefix.
--
-- Only RPCs whose AUTHORISED answer is an object are checked. About
-- seventeen return an array, and for those a refusal (`[]`) is identical to a
-- genuinely empty result, which nothing on the client can tell apart; that
-- limit is documented in answer.ts and is not asserted here.
--
-- Known exception, held in an explicit list so it cannot widen silently:
--   analytics_audit_log refuses with the page shell { total: 0, rows: [] },
--   which is indistinguishable from an empty audit window. The complete fix
--   is for it to raise, which is a database change of its own. The exception
--   list is itself checked: if the RPC is ever changed to refuse with `{}`,
--   this fails and says to take it off the list.
--
-- Sabotage (the test must be able to fail): two misbehaving RPCs are created
-- inside the transaction and must each be named by the check. One refuses
-- with a non-empty shell; one answers an authorised caller with `{}`.
--
-- Wrapped in BEGIN/ROLLBACK; leaves the database exactly as found.
-- ===========================================================================

begin;

create temporary table ac_fixture(k text primary key, v uuid) on commit drop;

-- A fresh organisation and one fresh account per role, self-built so this runs
-- on a clean `supabase db reset` as well as on the live project.
do $$
declare
  v_org uuid;
  r     record;
begin
  insert into public.organisations (name, type)
  values ('Analytics Answer Contract Org', 'clinic')
  returning id into v_org;

  for r in select * from (values ('patient'), ('analyst')) as t(role_name)
  loop
    insert into ac_fixture(k, v) values (r.role_name, gen_random_uuid());

    insert into auth.users (id, email)
    values ((select v from ac_fixture where k = r.role_name),
            format('analyticsanswercontract.%s@example.com', r.role_name));

    insert into public.profiles (id, organisation_id, role, full_name)
    values ((select v from ac_fixture where k = r.role_name),
            v_org, r.role_name::public.user_role,
            format('Analytics Answer Contract %s', r.role_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id,
          role            = excluded.role,
          full_name       = excluded.full_name;
  end loop;
end $$;

-- What a signed-in user with this id is told by a zero-argument RPC.
create function pg_temp.answer_as(p_uid uuid, p_rpc text) returns jsonb
language plpgsql as $f$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute format('select to_jsonb(public.%I())', p_rpc) into v;
  reset role;
  return v;
end $f$;

-- Every RPC that breaks the contract, as "name: what is wrong". Empty means
-- the contract holds. p_exceptions are skipped (see the header).
create function pg_temp.contract_breaks(p_exceptions text[]) returns text[]
language plpgsql as $f$
declare
  r         record;
  v_analyst jsonb;
  v_patient jsonb;
  v_breaks  text[] := '{}';
  v_a       uuid := (select v from ac_fixture where k = 'analyst');
  v_p       uuid := (select v from ac_fixture where k = 'patient');
begin
  for r in
    select p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and p.prorettype = 'jsonb'::regtype
      and p.provolatile in ('s', 'i')
      and p.pronargs = p.pronargdefaults
      and (p.proname like 'analytics\_%'
           or p.proname in ('diagnostic_governance_analytics',
                            'diagnostic_pathway_analytics',
                            'diagnostic_safety_dashboard'))
    order by p.proname
  loop
    begin
      v_analyst := pg_temp.answer_as(v_a, r.proname);
    exception when others then
      v_breaks := v_breaks || (r.proname || ': the analyst call raised: ' || left(sqlerrm, 60));
      continue;
    end;

    -- Arrays and scalars are out of scope (see the header).
    if v_analyst is null or jsonb_typeof(v_analyst) <> 'object' then
      continue;
    end if;
    if r.proname = any (p_exceptions) then
      continue;
    end if;

    if v_analyst = '{}'::jsonb then
      v_breaks := v_breaks || (r.proname || ': authorised answer is {}');
      continue;
    end if;

    v_patient := pg_temp.answer_as(v_p, r.proname);
    if v_patient is distinct from '{}'::jsonb then
      v_breaks := v_breaks || (r.proname || ': refused answer is not {}');
    end if;
  end loop;

  return v_breaks;
end $f$;

do $$
declare
  v_breaks     text[];
  v_exceptions text[] := array['analytics_audit_log'];
  v_found      int;
  v_shell      jsonb;
begin
  -- 0. Canary: discovery must still be finding the console's RPCs.
  select count(*) into v_found
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prokind = 'f'
    and p.prorettype = 'jsonb'::regtype
    and p.provolatile in ('s', 'i')
    and p.pronargs = p.pronargdefaults
    and (p.proname like 'analytics\_%'
         or p.proname in ('diagnostic_governance_analytics',
                          'diagnostic_pathway_analytics',
                          'diagnostic_safety_dashboard'));
  if v_found < 30 then
    raise exception 'FAIL: only % analytics RPCs were discovered (expected at least 30); the discovery filter has gone stale', v_found;
  end if;

  -- 1. The contract holds for every RPC found.
  v_breaks := pg_temp.contract_breaks(v_exceptions);
  if cardinality(v_breaks) > 0 then
    raise exception 'FAIL: the analytics refusal contract is broken, so lib/analytics/answer.ts no longer protects: %',
      array_to_string(v_breaks, '; ');
  end if;

  -- 2. The exception list is honest: audit_log really does refuse with a shell
  --    that is not `{}`. If it ever starts refusing with `{}` it belongs back
  --    under the contract and this must say so.
  v_shell := pg_temp.answer_as((select v from ac_fixture where k = 'patient'), 'analytics_audit_log');
  if v_shell is not distinct from '{}'::jsonb then
    raise exception 'FAIL: analytics_audit_log now refuses with {}; remove it from the exception list so it is covered by the guard';
  end if;

  -- 3. Sabotage A: an RPC that refuses with a non-empty shell must be named.
  create function public.analytics_zz_contract_shell() returns jsonb
  language plpgsql stable security definer set search_path = '' as $f$
  begin
    if not private.is_analyst() then
      return jsonb_build_object('total', 0);
    end if;
    return jsonb_build_object('total', 1);
  end $f$;
  grant execute on function public.analytics_zz_contract_shell() to authenticated;

  v_breaks := pg_temp.contract_breaks(v_exceptions);
  if not ('analytics_zz_contract_shell: refused answer is not {}' = any (v_breaks)) then
    raise exception 'SABOTAGE FAILED (A): an RPC refusing with a non-empty shell was not caught; got %', v_breaks;
  end if;
  drop function public.analytics_zz_contract_shell();

  -- 4. Sabotage B: an RPC that answers an authorised caller with `{}` must be named.
  create function public.analytics_zz_contract_blank() returns jsonb
  language plpgsql stable security definer set search_path = '' as $f$
  begin
    return '{}'::jsonb;
  end $f$;
  grant execute on function public.analytics_zz_contract_blank() to authenticated;

  v_breaks := pg_temp.contract_breaks(v_exceptions);
  if not ('analytics_zz_contract_blank: authorised answer is {}' = any (v_breaks)) then
    raise exception 'SABOTAGE FAILED (B): an RPC answering an authorised caller with {} was not caught; got %', v_breaks;
  end if;
  drop function public.analytics_zz_contract_blank();

  -- 5. And with both gone, the contract holds again (the sabotage cleaned up).
  v_breaks := pg_temp.contract_breaks(v_exceptions);
  if cardinality(v_breaks) > 0 then
    raise exception 'FAIL: contract broken after the sabotage was removed: %', array_to_string(v_breaks, '; ');
  end if;

  raise notice 'ALL CHECKS PASSED (% RPCs discovered)', v_found;
end $$;

rollback;
