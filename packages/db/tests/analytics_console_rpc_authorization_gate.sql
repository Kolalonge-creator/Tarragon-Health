-- ===========================================================================
-- Verification: every RPC behind the Platform Analytics & Audit Console
-- (apps/web/src/app/(dashboard)/analytics/, gated in its layout.tsx to the
-- `analyst`/`admin` roles) actually enforces that gate at the database level,
-- not just in the page layout.
--
-- Why this exists: as of 2026-09-14 the console had ~55 SECURITY DEFINER RPCs
-- (analytics_*, get_geo_health_aggregates, public_service_coverage). Reading
-- their LIVE definitions (not migration files — see CLAUDE.md's standing
-- lesson on why that distinction matters) confirmed 54 of the 55 call
-- private.is_analyst() somewhere in their body. But only ONE of the 55
-- (analytics_business_summary) had ever been exercised by a test, and even
-- that was a single positive-path proof ("an analyst session gets an
-- answer") — nothing had ever proven the negative: that a patient,
-- clinician, or unauthenticated caller is actually refused. A gate nobody
-- has ever tried to open from the wrong side is a gate you are hoping works,
-- not one you know works.
--
-- Two independent layers of proof per function, deliberately not relying on
-- just one:
--
--   Layer 1 (structural, from live pg_get_functiondef): the function body
--   contains an is_analyst()/is_admin() guard, and that guard's first
--   occurrence comes BEFORE the function's first reference to any
--   public-schema table — i.e. the check actually gates data access rather
--   than merely being present somewhere unreachable or too late. This layer
--   is what actually caught the real finding below.
--
--   Layer 2 (behavioural, simulated sessions): an analyst/admin session must
--   never be refused by its own console's RPCs; a patient/clinician/
--   anonymous session must either be refused outright (raises with SQLSTATE
--   42501, or a message matching "not author...") or — the majority pattern
--   in this codebase, an early `return '{}'::jsonb` / zero-row style guard —
--   get byte-identical output across all three unauthorized sessions, which
--   a per-caller data leak could not produce by coincidence.
--
-- Deliberately NOT hardcoding the ~55 function names: this test discovers
-- its target set live from pg_proc at run time, so it keeps covering the
-- real surface as the console grows. A canary assertion guards against the
-- discovery query itself going quietly stale.
--
-- FINDING, closed by this same pass: public_service_coverage() is the one
-- function with NO is_analyst()/is_admin() guard at all. Read live, it
-- returns only state-level service-availability flags from service_regions
-- (lab/pharmacy/specialist/home_visit/delivery booleans per region) — no
-- patient or org data — so this is intentional (it's the "public_" prefix,
-- not an "analytics_" one), not an oversight. It is verified openly-readable
-- here, with its shape asserted to stay boring, rather than silently
-- excluded — and its lack of a gate is also what proves Layer 1's structural
-- check actually discriminates rather than passing vacuously (see the
-- 'sabotage control' assertion below).
--
-- Scope boundary: this proves the AUTHORIZATION gate on each function, not
-- the functional correctness of what it returns under adversarial input —
-- dummy arguments are type-valid but semantically arbitrary (null uuids,
-- now(), etc.), so a non-42501 error from bad-but-permitted input is treated
-- the same as a clean success for the allow-path: both mean the caller got
-- PAST the gate, which is the only thing under test there.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor. Wrapped in
-- BEGIN/ROLLBACK — verification only, leaves the database exactly as found.
-- ===========================================================================

begin;

create temporary table gate_fixture(k text primary key, v uuid) on commit drop;
create temporary table gate_result(
  function_name text,
  role          text,
  detail        text,
  verdict       text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures: a fresh organisation plus one fresh account per role under test,
-- all self-built rather than borrowed from whatever happens to already exist
-- — this is what lets the script run on both the live project and a clean
-- `supabase db reset` in CI (packages/db/tests/ci.excluded's own header
-- explains why a script that instead does `select ... limit 1` and raises
-- when it finds nothing belongs in the excluded backlog, not the manifest).
-- --------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  r     record;
begin
  insert into public.organisations (name, type)
  values ('Analytics Gate Test Org', 'clinic')
  returning id into v_org;

  for r in select * from (values
      ('patient'),('clinician'),('analyst'),('admin')
    ) as t(role_name)
  loop
    insert into gate_fixture(k, v) values (r.role_name, gen_random_uuid());

    insert into auth.users (id, email)
    values ((select v from gate_fixture where k = r.role_name),
            format('analyticsgatetest.%s@example.com', r.role_name));

    insert into public.profiles (id, organisation_id, role, full_name)
    values ((select v from gate_fixture where k = r.role_name),
            v_org, r.role_name::public.user_role,
            format('Analytics Gate Test %s', r.role_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id,
          role            = excluded.role,
          full_name       = excluded.full_name;
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- Layer 1 — structural: does the guard exist, and does it precede data
-- access, in every discovered function's live body?
-- --------------------------------------------------------------------------
do $$
declare
  v_fn       record;
  v_body     text;
  v_exec     text;
  v_gate_pos int;
  v_data_pos int;
  v_fn_count integer;
begin
  select count(*) into v_fn_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'analytics_%' or p.proname = 'get_geo_health_aggregates');

  if v_fn_count < 50 then
    raise exception
      'CANARY FAILED: only % functions match analytics_%%/get_geo_health_aggregates — '
      'the discovery pattern in this test may no longer match the console''s real RPC '
      'surface (expected ~55 as of 2026-09-14); update the pattern before trusting the '
      'rest of this run', v_fn_count;
  end if;

  -- Sabotage control: public_service_coverage() is the one known function
  -- with no gate at all. If Layer 1 didn't flag it as gateless, Layer 1
  -- would be passing vacuously for everything else too.
  select split_part(pg_get_functiondef(p.oid), '$function$', 2) into v_body
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'public_service_coverage';

  if position('is_analyst(' in v_body) <> 0 or position('is_admin(' in v_body) <> 0 then
    raise exception
      'SABOTAGE CONTROL FAILED: public_service_coverage() now appears to reference an '
      'is_analyst()/is_admin() guard — either it has been gated (update the exemption '
      'in this file) or Layer 1''s structural check is broken and cannot be trusted for '
      'anything else this test claims to prove';
  end if;

  for v_fn in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'analytics_%' or p.proname = 'get_geo_health_aggregates')
    order by p.proname
  loop
    v_body := split_part(pg_get_functiondef(v_fn.oid), '$function$', 2);

    -- Only the executable body counts for "precedes data access" — a
    -- DECLARE-section %rowtype/type reference (e.g. "fi
    -- public.platform_finance_inputs%rowtype;") mentions a public-schema
    -- object textually before the gate but touches no data, and must not
    -- be misread as a leak. \mbegin\M finds the start of the executable
    -- block; every target here is LANGUAGE plpgsql (verified separately),
    -- so this always matches.
    v_exec := substring(v_body from '\mbegin\M.*');

    v_gate_pos := position('is_analyst(' in v_exec);
    if v_gate_pos = 0 then
      v_gate_pos := position('is_admin(' in v_exec);
    end if;
    v_data_pos := position(' public.' in v_exec);

    insert into gate_result values (v_fn.proname, 'structural', 'guard precedes data access',
      case when v_gate_pos > 0 and (v_data_pos = 0 or v_gate_pos < v_data_pos)
           then 'PASS' else 'FAIL' end);

    if v_gate_pos = 0 then
      raise exception
        'NO GATE: public.%() has no is_analyst()/is_admin() reference in its live body — '
        'it is reachable by any authenticated caller', v_fn.proname;
    end if;
    if v_data_pos <> 0 and v_gate_pos > v_data_pos then
      raise exception
        'GATE TOO LATE: public.%() references a public-schema table before its '
        'is_analyst()/is_admin() check — data may be touched before authorisation is '
        'verified', v_fn.proname;
    end if;
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- Layer 2 — behavioural: probe every discovered function under simulated
-- sessions with type-valid dummy arguments built from its own signature.
-- --------------------------------------------------------------------------
do $$
declare
  v_fn          record;
  v_role        text;
  v_session     text;
  v_args        text;
  v_sqlstate    text;
  v_message     text;
  v_denied      boolean;
  v_text        text;
  v_deny_texts  text[];
  v_deny_role   text;
begin
  for v_fn in
    select p.oid, p.proname, p.proretset,
           (
             select string_agg(
               case
                 when format_type(t, null) ~* 'uuid'      then 'null::uuid'
                 when format_type(t, null) ~* 'text'      then 'null::text'
                 when format_type(t, null) ~* 'timestamp' then 'now()'
                 when format_type(t, null) ~* 'date'      then 'current_date'
                 when format_type(t, null) ~* 'int'       then '1'
                 when format_type(t, null) ~* 'numeric'   then '0'
                 when format_type(t, null) ~* 'bool'      then 'false'
                 else 'null'
               end, ', ' order by ord
             )
             from unnest(p.proargtypes::oid[]) with ordinality as u(t, ord)
           ) as dummy_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'analytics_%' or p.proname = 'get_geo_health_aggregates')
    order by p.proname
  loop
    v_args := coalesce(v_fn.dummy_args, '');

    -- Allow-path: analyst/admin must never be refused by their own console.
    foreach v_role in array array['analyst','admin']
    loop
      perform set_config('request.jwt.claims',
        json_build_object(
          'sub', (select v from gate_fixture where k = v_role)::text,
          'role', 'authenticated'
        )::text, true);
      set local role authenticated;

      v_denied := false;
      begin
        if v_fn.proretset then
          execute format('select count(*)::text from public.%I(%s)', v_fn.proname, v_args) into v_text;
        else
          execute format('select (public.%I(%s))::text', v_fn.proname, v_args) into v_text;
        end if;
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
        v_denied := (v_sqlstate = '42501' or v_message ilike '%not author%');
      end;
      reset role;

      insert into gate_result values
        (v_fn.proname, v_role, 'own console role must be let through',
         case when v_denied then 'FAIL' else 'PASS' end);

      if v_denied then
        raise exception
          'BROKEN: public.%(%) refused a % session — the console''s own role is locked '
          'out of its own report', v_fn.proname, v_args, v_role;
      end if;
    end loop;

    -- get_geo_health_aggregates has a known, unambiguous empty contract for
    -- a denied caller (zero rows) — check that directly rather than via
    -- text-equality, since "0 rows" needs no cross-session comparison to be
    -- meaningful.
    if v_fn.proname = 'get_geo_health_aggregates' then
      foreach v_deny_role in array array['patient','clinician']
      loop
        perform set_config('request.jwt.claims',
          json_build_object(
            'sub', (select v from gate_fixture where k = v_deny_role)::text,
            'role', 'authenticated'
          )::text, true);
        set local role authenticated;
        execute format('select count(*)::text from public.%I(%s)', v_fn.proname, v_args) into v_text;
        reset role;

        insert into gate_result values
          (v_fn.proname, v_deny_role, 'zero rows for a denied caller',
           case when v_text = '0' then 'PASS' else 'FAIL' end);
        if v_text <> '0' then
          raise exception 'LEAK: get_geo_health_aggregates() returned % rows for a % session',
            v_text, v_deny_role;
        end if;
      end loop;
      continue;
    end if;

    -- Deny-path for the rest: patient / clinician / anon. Either the call
    -- raises with a recognisable authorisation error, or — the majority
    -- pattern — all three unauthorized sessions get byte-identical output,
    -- which per-caller real data could not produce by coincidence.
    v_deny_texts := array[]::text[];
    foreach v_session in array array['patient','clinician','anon']
    loop
      if v_session = 'anon' then
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        set local role anon;
      else
        perform set_config('request.jwt.claims',
          json_build_object(
            'sub', (select v from gate_fixture where k = v_session)::text,
            'role', 'authenticated'
          )::text, true);
        set local role authenticated;
      end if;

      v_denied := false;
      v_text := null;
      begin
        execute format('select (public.%I(%s))::text', v_fn.proname, v_args) into v_text;
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
        v_denied := (v_sqlstate = '42501' or v_message ilike '%not author%');
      end;
      reset role;

      if v_denied then
        insert into gate_result values (v_fn.proname, v_session, 'refused outright', 'PASS');
      else
        v_deny_texts := v_deny_texts || v_text;
        insert into gate_result values
          (v_fn.proname, v_session, 'cross-session check pending', 'PENDING');
      end if;
    end loop;

    if array_length(v_deny_texts, 1) is not null then
      -- At least one of the three didn't raise — every one of those that
      -- didn't raise must have returned the exact same thing, or one of
      -- them saw something the others didn't.
      if (select count(distinct x) from unnest(v_deny_texts) as x) > 1 then
        raise exception
          'LEAK: public.%(%) returned DIFFERING output across unauthorized sessions — '
          'a fixed denial value cannot differ per caller: %', v_fn.proname, v_args, v_deny_texts;
      end if;

      update gate_result
      set detail = 'identical non-error output across deny sessions', verdict = 'PASS'
      where function_name = v_fn.proname and role in ('patient','clinician','anon')
        and verdict = 'PENDING';
    end if;
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- public_service_coverage(): the one deliberate exception carved out above.
-- Every session, including anon, must succeed — and the shape must stay
-- boring (region / service-availability flags only, never a patient or org
-- column), so a future edit that quietly adds a real field to it gets caught
-- here rather than assumed safe forever because "it's the public one".
-- --------------------------------------------------------------------------
do $$
declare
  v_session text;
  v_res     jsonb;
begin
  foreach v_session in array array['anon','patient','analyst']
  loop
    if v_session = 'anon' then
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      set local role anon;
    else
      perform set_config('request.jwt.claims',
        json_build_object(
          'sub', (select v from gate_fixture where k = v_session)::text,
          'role', 'authenticated'
        )::text, true);
      set local role authenticated;
    end if;

    select public.public_service_coverage() into v_res;
    reset role;

    insert into gate_result values
      ('public_service_coverage', v_session, 'openly readable by design',
       case when v_res is not null then 'PASS' else 'FAIL' end);

    if v_res is null then
      raise exception
        'public_service_coverage() returned null for a % session — expected it to stay '
        'openly readable', v_session;
    end if;

    if v_res::text ~* 'patient_id|organisation_id|full_name|diagnos' then
      raise exception
        'LEAK: public_service_coverage() response shape changed to include something '
        'that looks like patient/org data — % session got: %', v_session, v_res;
    end if;
  end loop;
end $$;

select function_name, role, detail, verdict
from gate_result
order by (verdict <> 'PASS') desc, function_name, role;

rollback;
