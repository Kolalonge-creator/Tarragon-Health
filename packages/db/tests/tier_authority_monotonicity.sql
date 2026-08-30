-- Tarragon Health
-- Clinical authority must be MONOTONIC across the doctor tier ladder:
--   authority(tier N) is a SUBSET of authority(tier N+1)
-- A higher tier can always do everything a lower tier can. It simply has more
-- on top. Founder requirement 2026-08-01, prompted by a real violation:
-- private.can_confirm_medication_refill was written as `doctor_tier = 'tier_1'`
-- (an equality, i.e. a fence) rather than a minimum (a floor), so a senior
-- doctor covering a shift with no Medical Officer on duty could not confirm a
-- routine refill. Fixed by 20260801093117_refill_confirm_any_clinical_tier.sql.
--
-- Updated 2026-08-31 for the 3-tier collapse (medical_officer/
-- senior_medical_officer/chief_medical_officer, is_clinical_director
-- retired) — only the tier literal list and the probe's insert columns
-- changed; the discovery/monotonicity/care_coordinator logic is untouched
-- and re-validates automatically against whatever tier set exists.
--
-- WHY THIS TEST DISCOVERS GATES DYNAMICALLY rather than listing them:
-- the point is to stop the NEXT gate someone writes from reintroducing a
-- fence. A hardcoded list would only ever prove the gates that existed the day
-- it was written. Any private-schema function taking a single org uuid,
-- returning boolean, whose body mentions doctor_tier, is picked up
-- automatically -- which is the shape every tier gate in this codebase already
-- has (has_prescribing_authority, can_confirm_medication_refill, and
-- can_handle_emergency_escalation once the parked doctor/clinician merge
-- lands).
--
-- Cases:
--   1. Gate discovery is non-empty (the test is not vacuously passing)
--   2. The matrix genuinely discriminates -- at least one gate denies at least
--      one clinical tier. Without this, a hypothetical "everyone can do
--      everything" system would pass case 3 trivially and prove nothing.
--   3. MONOTONICITY: no gate allows a lower tier while denying a higher one
--   4. care_coordinator is denied by EVERY gate (CLAUDE.md standing rule: a
--      Care Coordinator never gains write access to medications, escalation
--      resolution or protocol signing -- it is a doctor_tier enum value but is
--      explicitly non-clinical)
--   5. The full matrix, printed for inspection
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: revert
-- can_confirm_medication_refill to `doctor_tier = 'tier_1'` and re-run. Case 3
-- must FAIL, naming that gate with tier_1=allowed / tier_2=denied.
--
-- Note the probe row carries indemnity fields and employment_type =
-- 'contracted': the DB enforces current indemnity cover before a Chief
-- Medical Officer, or a contracted Senior Medical Officer, may be active, so
-- a probe without them (or one left 'employed') could not legally reach the
-- senior tiers.
--
-- Run: npx supabase db query --linked -f packages/db/tests/tier_authority_monotonicity.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table tier_authority_matrix (
  tier text, tier_rank int, gate text, allowed boolean
) on commit drop;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org        uuid := '00000000-0000-0000-0000-000000000001';
  v_profile    uuid;
  v_staff_id   uuid;
  v_tiers      text[] := array[
                  'medical_officer','senior_medical_officer','chief_medical_officer'
                ];
  v_tier       text;
  v_rank       int := 0;
  v_gate       record;
  v_allowed    boolean;
  v_gate_count int;
begin
  -- A profile with no existing clinical_staff row, so the probe insert cannot
  -- collide with the founder's real Clinical Director record.
  select p.id into v_profile
  from public.profiles p
  where p.organisation_id = v_org
    and not exists (
      select 1 from public.clinical_staff cs where cs.profile_id = p.id
    )
  limit 1;

  if v_profile is null then
    raise exception 'No spare profile in org % to use as a probe', v_org;
  end if;

  insert into public.clinical_staff (
    organisation_id, profile_id, full_name, active, license_verified_at,
    employment_type,
    indemnity_insurer, indemnity_policy_number, indemnity_expires_at
  )
  values (
    v_org, v_profile, 'Tier Monotonicity Probe', true, now(),
    'contracted',
    'Probe Indemnity Ltd', 'PROBE-MONOTONICITY', now() + interval '1 year'
  )
  returning id into v_staff_id;

  foreach v_tier in array v_tiers loop
    v_rank := v_rank + 1;
    update public.clinical_staff
       set doctor_tier = v_tier::public.doctor_tier
     where id = v_staff_id;

    for v_gate in
      select n.nspname || '.' || p.proname as fqn, p.proname as nm
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.prokind = 'f'
        and p.pronargs = 1
        and p.proargtypes[0] = 'uuid'::regtype
        and p.prorettype = 'boolean'::regtype
        and pg_get_functiondef(p.oid) like '%doctor_tier%'
      order by 1
    loop
      perform set_config(
        'request.jwt.claims',
        json_build_object('sub', v_profile, 'role', 'authenticated')::text,
        true
      );
      execute format('select %s($1)', v_gate.fqn) into v_allowed using v_org;
      perform set_config('request.jwt.claims', '', true);

      insert into tier_authority_matrix
        values (v_tier, v_rank, v_gate.nm, v_allowed);
    end loop;
  end loop;

  -- Control: a Care Coordinator must be refused by every gate.
  update public.clinical_staff
     set doctor_tier = 'care_coordinator'
   where id = v_staff_id;

  for v_gate in
    select n.nspname || '.' || p.proname as fqn, p.proname as nm
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.prokind = 'f'
      and p.pronargs = 1
      and p.proargtypes[0] = 'uuid'::regtype
      and p.prorettype = 'boolean'::regtype
      and pg_get_functiondef(p.oid) like '%doctor_tier%'
    order by 1
  loop
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_profile, 'role', 'authenticated')::text,
      true
    );
    execute format('select %s($1)', v_gate.fqn) into v_allowed using v_org;
    perform set_config('request.jwt.claims', '', true);

    insert into tier_authority_matrix
      values ('care_coordinator', 0, v_gate.nm, v_allowed);
  end loop;

  select count(distinct gate) into v_gate_count from tier_authority_matrix;

  insert into test_result values (
    1,
    'gate discovery is non-empty',
    case when v_gate_count > 0 then 'PASS' else 'FAIL' end,
    v_gate_count || ' tier gate(s) discovered'
  );
end $$;

-- Case 2 -- the matrix must actually discriminate. If every gate allowed every
-- tier, case 3 would pass while proving nothing at all.
insert into test_result
select
  2,
  'matrix discriminates (some gate denies some clinical tier)',
  case when count(*) > 0 then 'PASS' else 'FAIL (vacuous)' end,
  coalesce(string_agg(gate || ' denies ' || tier, '; '), 'nothing denied anywhere')
from tier_authority_matrix
where tier_rank > 0 and not allowed;

-- Case 3 -- the invariant itself.
insert into test_result
select
  3,
  'MONOTONIC: authority(tier N) subset of authority(tier N+1)',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  coalesce(
    string_agg(
      lo.gate || ': ' || lo.tier || '=allowed but ' || hi.tier || '=denied',
      '; '
    ),
    'no violations'
  )
from tier_authority_matrix lo
join tier_authority_matrix hi
  on hi.gate = lo.gate
 and hi.tier_rank > lo.tier_rank
where lo.tier_rank > 0
  and lo.allowed
  and not hi.allowed;

-- Case 4 -- Care Coordinator stays non-clinical.
insert into test_result
select
  4,
  'care_coordinator denied by every gate',
  case when count(*) filter (where allowed) = 0 then 'PASS' else 'FAIL' end,
  coalesce(
    string_agg(gate || '=' || allowed::text, '; ' order by gate),
    'no gates evaluated'
  )
from tier_authority_matrix
where tier = 'care_coordinator';

-- Case 5 -- named regression: this is the one real behaviour change from the
-- 3-tier collapse (old tier_2, 3+ years experience, could prescribe; the new
-- medical_officer it merged into cannot -- only senior_medical_officer+ can).
-- Worth a named assertion rather than relying solely on the generic
-- monotonicity/discrimination sweep above, since it is a deliberate,
-- founder-confirmed capability change, not a bug the sweep should catch.
insert into test_result
select
  5,
  'medical_officer is denied by has_prescribing_authority',
  case when bool_and(not allowed) then 'PASS' else 'FAIL' end,
  coalesce(string_agg(gate || '=' || allowed::text, '; '), 'no rows')
from tier_authority_matrix
where tier = 'medical_officer' and gate = 'has_prescribing_authority';

-- One combined result set: the CLI prints only the final select, so the
-- verdicts and the supporting matrix are unioned rather than emitted
-- separately (a second select would silently swallow the first).
select line from (
  select
    case_num as sort_a, 0 as sort_b,
    'CASE ' || case_num || ' [' || outcome || '] ' || label ||
      case when detail = '' then '' else ' -- ' || detail end as line
  from test_result

  union all

  select
    99, 1,
    'MATRIX ' || rpad(gate, 32) ||
      ' mo=' || max(allowed::int) filter (where tier = 'medical_officer') ||
      ' smo=' || max(allowed::int) filter (where tier = 'senior_medical_officer') ||
      ' cmo=' || max(allowed::int) filter (where tier = 'chief_medical_officer') ||
      ' coord=' || max(allowed::int) filter (where tier = 'care_coordinator')
  from tier_authority_matrix
  group by gate
) x
order by sort_a, sort_b, line;

rollback;
