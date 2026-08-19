-- ===========================================================================
-- Verification: lpe_content_blocks_read (tightened in
-- 20260810034122_gate_lpe_content_blocks_read_on_review_status.sql) actually
-- discriminates on clinician_reviewed, not just that its policy text looks
-- right.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Same pattern as packages/db/tests/scoped_access_roles_rls.sql:
-- set_config('request.jwt.claims', ...) + `set local role authenticated`
-- simulates a real client session — running as the connecting superuser
-- would silently bypass RLS via table ownership.
--
-- Wrapped in BEGIN/ROLLBACK — always leaves the database exactly as it found
-- it, including the deliberate mid-test UPDATE.
--
-- Three checks, not one: a bare "patient sees 0 rows" proves nothing on its
-- own (could mean the policy works, or could mean it's broken in a way that
-- hides everything from everyone, including what should be visible). This
-- sabotages the fixture on purpose — flips exactly one row to reviewed mid-
-- transaction — to prove the policy actually discriminates: 0 visible, then
-- exactly 1, then (as admin) all of them.
-- ===========================================================================

begin;

do $$
declare
  v_admin uuid;
  v_patient uuid;
  v_test_key text := 'htn.diet.less_salt_cooking';
  v_count bigint;
  v_total bigint;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select id into v_patient from public.profiles where role = 'patient' limit 1;

  if v_admin is null or v_patient is null then
    raise exception 'fixture missing: need at least one admin and one patient profile to run this test';
  end if;

  select count(*) into v_total from public.lpe_content_blocks;
  if v_total = 0 then
    raise exception 'control failure: lpe_content_blocks is empty, this test proves nothing';
  end if;

  -- Control: as a real patient session, count should equal the number of
  -- already-reviewed rows (0 at the time this test was written, but not
  -- hardcoded — some rows may be reviewed for real by the time this runs).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.lpe_content_blocks;
  reset role;

  declare
    v_expected_before bigint;
  begin
    select count(*) into v_expected_before from public.lpe_content_blocks where clinician_reviewed = true;
    if v_count <> v_expected_before then
      raise exception 'FAIL: patient sees % rows, expected % (count of already-reviewed rows)', v_count, v_expected_before;
    end if;
    raise notice 'PASS: patient session sees exactly the reviewed-row count (%)', v_count;
  end;

  -- Sabotage: flip exactly one currently-unreviewed row to reviewed. As the
  -- superuser connection (RLS write policy requires admin), not inside the
  -- simulated patient session.
  if not exists (select 1 from public.lpe_content_blocks where key = v_test_key and clinician_reviewed = false) then
    raise exception 'fixture assumption broken: % is not currently unreviewed, pick a different test key', v_test_key;
  end if;
  update public.lpe_content_blocks set clinician_reviewed = true where key = v_test_key;

  -- Same patient session again: must now see exactly one more row than before.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.lpe_content_blocks;
  reset role;
  if v_count <> v_total - (select count(*) from public.lpe_content_blocks where clinician_reviewed = false) then
    raise exception 'FAIL: patient count did not increase by exactly 1 after reviewing exactly 1 row (policy is not discriminating)';
  end if;
  raise notice 'PASS: patient session count increased by exactly 1 after 1 row was reviewed (got %)', v_count;

  -- Admin session: sees everything regardless of review status.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.lpe_content_blocks;
  reset role;
  if v_count <> v_total then
    raise exception 'FAIL: admin sees % rows, expected % (all rows regardless of review status)', v_count, v_total;
  end if;
  raise notice 'PASS: admin session sees all % rows regardless of review status', v_count;
end $$;

rollback;
