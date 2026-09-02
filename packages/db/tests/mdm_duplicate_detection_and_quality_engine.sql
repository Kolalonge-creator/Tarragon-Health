-- Tarragon Health — MDM duplicate-patient detection + data quality
-- engine verification (spec §34.4/§34.14).
--
-- Covers: mdm_duplicate_patient_detection.sql,
-- mdm_duplicate_detection_service_role_cron.sql,
-- mdm_data_quality_engine.sql.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/mdm_duplicate_detection_and_quality_engine.sql
--
-- Run inside a transaction that is always rolled back — nothing here
-- should ever be committed.

begin;

do $$
declare
  v_sim_related   numeric;
  v_sim_unrelated numeric;
  v_open_before   integer;
  v_open_after    integer;
  -- A real admin account, same convention as packages/db/tests/
  -- blood_profile_provenance.sql's fixture-org clinician lookup — the
  -- review/resolve RPCs' admin gate must be exercised as a real admin,
  -- not as postgres (auth.uid() is null in a plain migration/test
  -- context, which is itself covered separately by the service-role
  -- cron migration).
  v_admin uuid;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_admin is null then
    raise notice 'SKIP: no admin account available for the admin-gated checks';
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- 1. The name-similarity threshold calibration this migration's own
  -- header documents: a realistic nickname/abbreviation duplicate clears
  -- 0.3, two unrelated names score exactly 0.
  -- ---------------------------------------------------------------------
  v_sim_related := extensions.similarity(
    private.normalise_term('John Chukwuemeka Okafor'),
    private.normalise_term('Jon C. Okafor')
  );
  v_sim_unrelated := extensions.similarity(
    private.normalise_term('Chidinma Eze'),
    private.normalise_term('Ngozi Adeyemi')
  );
  if v_sim_related < 0.3 then
    raise exception 'FAIL 1: "John Chukwuemeka Okafor" vs "Jon C. Okafor" should clear the 0.3 threshold (got %)', v_sim_related;
  end if;
  if v_sim_unrelated >= 0.3 then
    raise exception 'FAIL 1: two unrelated names should not clear the 0.3 threshold (got %)', v_sim_unrelated;
  end if;
  raise notice 'PASS 1: name-similarity threshold calibration holds (related=%, unrelated=%)', v_sim_related, v_sim_unrelated;

  -- ---------------------------------------------------------------------
  -- 2. The detector runs cleanly end to end against real data (it is
  -- read-mostly on profiles/auth.users and only upserts pending
  -- candidates, so this is safe to run for real inside the rolled-back
  -- transaction).
  -- ---------------------------------------------------------------------
  perform private.detect_patient_match_candidates();
  raise notice 'PASS 2: private.detect_patient_match_candidates() runs without error';

  -- ---------------------------------------------------------------------
  -- 3/5. review_patient_match_candidate / resolve_data_quality_finding
  -- both reject setting status back to their un-reviewed default (that
  -- is the default, not a decision) — exercised as a real admin so the
  -- admin gate itself does not mask this check.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.review_patient_match_candidate(gen_random_uuid(), 'pending', null);
    raise exception 'FAIL 3: review_patient_match_candidate accepted status=pending';
  exception
    when others then
      if sqlerrm not like '%cannot set a review decision back to pending%' then
        raise exception 'FAIL 3: unexpected error: %', sqlerrm;
      end if;
  end;
  raise notice 'PASS 3: review_patient_match_candidate rejects status=pending';

  begin
    perform public.resolve_data_quality_finding(gen_random_uuid(), 'open', null);
    raise exception 'FAIL 5: resolve_data_quality_finding accepted status=open';
  exception
    when others then
      if sqlerrm not like '%cannot set a resolution back to open%' then
        raise exception 'FAIL 5: unexpected error: %', sqlerrm;
      end if;
  end;
  raise notice 'PASS 5: resolve_data_quality_finding rejects status=open';

  reset role;

  -- ---------------------------------------------------------------------
  -- 4. The data quality scanner runs cleanly.
  -- ---------------------------------------------------------------------
  select count(*) into v_open_before from public.data_quality_findings where status = 'open';
  perform private.run_data_quality_scan();
  select count(*) into v_open_after from public.data_quality_findings where status = 'open';
  raise notice 'PASS 4: private.run_data_quality_scan() runs without error (open findings: % -> %)', v_open_before, v_open_after;

  -- ---------------------------------------------------------------------
  -- 6. anon must never reach any of this.
  -- ---------------------------------------------------------------------
  if has_function_privilege('anon', 'public.run_patient_duplicate_detection()', 'EXECUTE')
    or has_function_privilege('anon', 'public.run_data_quality_scan()', 'EXECUTE')
    or has_table_privilege('anon', 'public.patient_match_candidates', 'SELECT')
    or has_table_privilege('anon', 'public.data_quality_findings', 'SELECT')
  then
    raise exception 'FAIL 6: anon holds access to duplicate-detection or data-quality tables/functions it should not';
  end if;
  raise notice 'PASS 6: anon has no access to duplicate-detection or data-quality tables/functions';

  raise notice 'ALL MDM DUPLICATE DETECTION + DATA QUALITY ENGINE CHECKS PASSED';
end $$;

rollback;
