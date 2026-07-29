-- M3 exit test (spec §20): "200 synthetic readings captured offline,
-- synced, duplicates surfaced not merged." Run m1_fixture.sql and
-- m2_exit_test.sql (or at least its L3-confirmation block) first.
--
-- Note on scope, stated plainly: this proves the SYNC/DEDUP/CONSENT
-- backend that the spec's exit test is actually about. It does NOT stand
-- in for a real apps/screening Expo client (offline local queue, capture
-- screens, BP rest-interval timer, on-device result card) -- that UI has
-- not been built. See the README for the honest status.

do $$
declare
  v_event_a uuid := 'c0000000-0000-0000-0000-00000000000a';
  v_event_b uuid := 'c0000000-0000-0000-0000-00000000000b';
  v_n int;
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111104','role','authenticated')::text, true);
  set local role authenticated;

  insert into screening_events (id, organisation_id, name, held_on, operator_profile_id, participants_expected)
  values (v_event_a, '22222222-2222-2222-2222-222222222201', 'M3 fixture event A (main)', current_date, '11111111-1111-1111-1111-111111111104', 20)
  on conflict (id) do nothing;

  insert into screening_events (id, organisation_id, name, held_on, operator_profile_id, participants_expected)
  values (v_event_b, '22222222-2222-2222-2222-222222222201', 'M3 fixture event B (small, for suppression)', current_date, '11111111-1111-1111-1111-111111111104', 3)
  on conflict (id) do nothing;

  -- Capture 20 participants for event A via the real RPC, consent-first.
  for i in 1..20 loop
    perform private.capture_screening_participant(
      v_event_a, 'P' || i, 'Fixture Participant ' || i,
      (date '1980-01-01' + (i || ' days')::interval)::date, 'female', '+23480000' || lpad(i::text, 4, '0')
    );
  end loop;

  select count(*) into v_n from screening_participants where screening_event_id = v_event_a;
  if v_n <> 20 then raise exception 'FAIL M3: expected 20 captured participants for event A, got %', v_n; end if;
  raise notice 'PASS M3a: 20 participants captured via capture_screening_participant, consent-first';

  -- Capture 3 participants for event B (below min_cohort_size=15).
  for i in 1..3 loop
    perform private.capture_screening_participant(
      v_event_b, 'B' || i, 'Fixture Small Event Participant ' || i,
      (date '1990-01-01' + (i || ' days')::interval)::date, 'male', null
    );
  end loop;

  reset role;
end $$;

-- 200 synthetic readings, synced.
do $$
declare
  v_event_a uuid := 'c0000000-0000-0000-0000-00000000000a';
  v_payload jsonb;
  v_inserted int;
  v_reading_count int;
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111104','role','authenticated')::text, true);
  set local role authenticated;

  select jsonb_agg(
    jsonb_build_object(
      'temp_ref', 'P' || p.n,
      'type', 'bp',
      'systolic', 118 + p.n,
      'diastolic', 78,
      'unit', 'mmHg',
      'taken_at', (timestamptz '2026-07-29 08:00:00+01' - (p.n || ' minutes')::interval - (r.n || ' seconds')::interval)::text
    )
  ) into v_payload
  from generate_series(1, 20) p(n)
  cross join generate_series(1, 10) r(n);

  select count(*) into v_inserted
  from private.sync_screening_readings(v_event_a, v_payload)
  where status = 'inserted';

  if v_inserted <> 200 then raise exception 'FAIL M3: expected 200 inserted readings, got %', v_inserted; end if;
  raise notice 'PASS M3b: 200 synthetic readings synced and inserted';

  -- Verify as postgres, not as coordinator_a: these synthetic patients
  -- have no enrolment/queue link yet, so coordinator_a's OWN RLS
  -- visibility into their readings is legitimately zero at this point --
  -- that's a fact about coordinator_a's read access, not about whether
  -- the rows exist. Checking existence needs an RLS-bypassing read.
  reset role;
  select count(*) into v_reading_count from readings where screening_event_id = v_event_a;
  if v_reading_count <> 200 then raise exception 'FAIL M3: readings table has % rows for event A, expected 200', v_reading_count; end if;
  raise notice 'PASS M3c: readings table genuinely holds 200 rows (not just RPC-reported)';
end $$;

-- Resubmit a subset as an exact duplicate sync retry.
do $$
declare
  v_event_a uuid := 'c0000000-0000-0000-0000-00000000000a';
  v_payload jsonb;
  v_dup_count int;
  v_reading_count int;
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111104','role','authenticated')::text, true);
  set local role authenticated;

  select jsonb_agg(
    jsonb_build_object(
      'temp_ref', 'P' || p.n,
      'type', 'bp',
      'systolic', 118 + p.n,
      'diastolic', 78,
      'unit', 'mmHg',
      'taken_at', (timestamptz '2026-07-29 08:00:00+01' - (p.n || ' minutes')::interval - (r.n || ' seconds')::interval)::text
    )
  ) into v_payload
  from generate_series(1, 2) p(n)   -- participants P1 and P2
  cross join generate_series(1, 10) r(n);  -- all 10 of their readings, identical to the first sync

  select count(*) into v_dup_count
  from private.sync_screening_readings(v_event_a, v_payload)
  where status = 'duplicate_surfaced';

  if v_dup_count <> 20 then raise exception 'FAIL M3: expected 20 rows surfaced as duplicate_surfaced, got %', v_dup_count; end if;
  raise notice 'PASS M3d: exact-duplicate resync correctly surfaced (20 rows), not silently accepted';

  reset role; -- see M3c's note: verify existence bypassing coordinator_a's own RLS visibility
  select count(*) into v_reading_count from readings where screening_event_id = v_event_a;
  if v_reading_count <> 200 then raise exception 'FAIL M3: readings count changed to % after duplicate resync, should stay 200 (no merge, no double-insert)', v_reading_count; end if;
  raise notice 'PASS M3e: duplicate resync did not change the stored row count (never silently merged)';
end $$;

-- unresolved_participant path: a reading for a temp_ref that was never captured.
do $$
declare
  v_event_a uuid := 'c0000000-0000-0000-0000-00000000000a';
  v_status text;
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111104','role','authenticated')::text, true);
  set local role authenticated;

  select status into v_status
  from private.sync_screening_readings(
    v_event_a,
    jsonb_build_array(jsonb_build_object('temp_ref', 'NONEXISTENT-TEMP-REF', 'type', 'bp', 'systolic', 120, 'diastolic', 80, 'unit', 'mmHg', 'taken_at', now()::text))
  );

  if v_status <> 'unresolved_participant' then raise exception 'FAIL M3: expected unresolved_participant, got %', v_status; end if;
  raise notice 'PASS M3f: a reading for an unknown temp_ref is surfaced (unresolved_participant), never dropped silently';

  reset role;
end $$;

-- Consent-before-measurement: direct INSERT bypassing the sync RPC.
-- Uses its OWN screening_events row (not event A) so this extra
-- participant doesn't pollute event A's denominator in the aggregate
-- report test below.
do $$
declare
  v_event_c uuid := 'c0000000-0000-0000-0000-00000000000c';
  v_no_consent_patient uuid;
begin
  reset role;
  insert into screening_events (id, organisation_id, name, held_on, operator_profile_id)
  values (v_event_c, '22222222-2222-2222-2222-222222222201', 'M3 fixture event C (consent-rejection only)', current_date, '11111111-1111-1111-1111-111111111104')
  on conflict (id) do nothing;

  -- a participant row with consented=false, created directly (not via the
  -- real capture RPC, which always sets consented=true) specifically to
  -- exercise the rejection path.
  insert into patients (profile_id, date_of_birth, sex_at_birth)
  values (null, '1975-01-01', 'male')
  returning id into v_no_consent_patient;

  insert into screening_participants (screening_event_id, patient_id, temp_ref, full_name, consented)
  values (v_event_c, v_no_consent_patient, 'NOCONSENT-1', 'Fixture Non-Consenting Participant', false);

  begin
    insert into readings (patient_id, type, systolic, diastolic, unit, taken_at, source, source_detail, screening_event_id)
    values (v_no_consent_patient, 'bp', 130, 85, 'mmHg', now(), 'screening_day', v_event_c::text, v_event_c);
    raise exception 'FAIL M3: reading for a non-consenting participant was NOT rejected';
  exception
    when others then
      if sqlerrm like '%has not consented%' then
        raise notice 'PASS M3g: measurement for a non-consenting participant correctly rejected (%)', sqlerrm;
      else
        raise;
      end if;
  end;

  -- and: a reading with no screening_participants row at all.
  begin
    insert into readings (patient_id, type, systolic, diastolic, unit, taken_at, source, source_detail, screening_event_id)
    values ('33333333-3333-3333-3333-333333333301', 'bp', 130, 85, 'mmHg', now(), 'screening_day', v_event_c::text, v_event_c);
    raise exception 'FAIL M3: reading with no screening_participants row at all was NOT rejected';
  exception
    when others then
      if sqlerrm like '%no screening_participants row%' then
        raise notice 'PASS M3h: measurement with no participant record at all correctly rejected (%)', sqlerrm;
      else
        raise;
      end if;
  end;
end $$;

-- Suppression: event B (3 participants, below min_cohort_size=15).
do $$
declare
  v_event_b uuid := 'c0000000-0000-0000-0000-00000000000b';
  v_report jsonb;
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111104','role','authenticated')::text, true);
  set local role authenticated;

  select private.screening_event_aggregate_report(v_event_b) into v_report;

  if (v_report ->> 'suppressed')::boolean is not true then
    raise exception 'FAIL M3: expected event B (3 participants) to be suppressed, got %', v_report;
  end if;
  raise notice 'PASS M3i: small-cohort event correctly suppressed below min_cohort_size, got %', v_report;

  reset role;
end $$;

-- Full aggregate report on event A (20 participants, above threshold),
-- with manually-seeded triage_classifications standing in for the M5
-- pipeline that doesn't exist yet.
do $$
declare
  v_event_a uuid := 'c0000000-0000-0000-0000-00000000000a';
  v_report jsonb;
  v_reading_id uuid;
  v_patient_id uuid;
  i int;
begin
  reset role;

  -- classify participants 1-3's first reading as urgent (severe range),
  -- 4-6 as needs_review, the rest stable -- proving the band tally, not
  -- asserting anything about real clinical prevalence.
  for i in 1..20 loop
    select r.id, r.patient_id into v_reading_id, v_patient_id
    from readings r
    join screening_participants sp on sp.patient_id = r.patient_id and sp.screening_event_id = v_event_a
    where sp.temp_ref = 'P' || i and r.screening_event_id = v_event_a
    order by r.taken_at asc
    limit 1;

    insert into triage_classifications (patient_id, reading_id, classification, protocol_config_id, rule_fired)
    values (
      v_patient_id, v_reading_id,
      (case when i <= 3 then 'urgent' when i <= 6 then 'needs_review' else 'stable' end)::triage_class,
      '55555555-5555-5555-5555-555555555501',
      'm3_fixture_seed'
    );
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111104','role','authenticated')::text, true);
  set local role authenticated;

  select private.screening_event_aggregate_report(v_event_a) into v_report;

  if (v_report ->> 'suppressed')::boolean is not false then raise exception 'FAIL M3: event A incorrectly suppressed, got %', v_report; end if;
  if (v_report ->> 'denominator')::int <> 20 then raise exception 'FAIL M3: denominator wrong, got %', v_report; end if;
  if (v_report -> 'prevalence_bands' ->> 'urgent')::int <> 3 then raise exception 'FAIL M3: urgent band wrong, got %', v_report; end if;
  if (v_report -> 'prevalence_bands' ->> 'needs_review')::int <> 3 then raise exception 'FAIL M3: needs_review band wrong, got %', v_report; end if;
  if (v_report -> 'prevalence_bands' ->> 'stable')::int <> 14 then raise exception 'FAIL M3: stable band wrong, got %', v_report; end if;
  if (v_report ->> 'severe_range_count')::int <> 3 then raise exception 'FAIL M3: severe_range_count wrong, got %', v_report; end if;
  if (v_report ->> 'previously_undiagnosed_count')::int <> 20 then raise exception 'FAIL M3: previously_undiagnosed_count wrong (all 20 are fresh captures, none previously enrolled), got %', v_report; end if;
  raise notice 'PASS M3j: full aggregate report correct: %', v_report;

  reset role;
end $$;

-- Attach-rate: enrol participant P1's patient, confirm auto-stamp + rate.
do $$
declare
  v_event_a uuid := 'c0000000-0000-0000-0000-00000000000a';
  v_patient_id uuid;
  v_converted_to uuid;
  v_converted_at timestamptz;
  v_rate jsonb;
begin
  reset role;

  select patient_id into v_patient_id
  from screening_participants where screening_event_id = v_event_a and temp_ref = 'P1';

  insert into enrolments (patient_id, programme_code, organisation_id, status, started_at)
  values (v_patient_id, 'control', '22222222-2222-2222-2222-222222222201', 'active', now())
  returning id into v_converted_to;

  select converted_to_enrolment_id, converted_at into v_converted_to, v_converted_at
  from screening_participants where screening_event_id = v_event_a and temp_ref = 'P1';

  if v_converted_to is null or v_converted_at is null then
    raise exception 'FAIL M3: converted_to_enrolment_id/converted_at were not auto-stamped on enrolment activation';
  end if;
  raise notice 'PASS M3k: converted_to_enrolment_id/converted_at auto-stamped on enrolment activation';

  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111104','role','authenticated')::text, true);
  set local role authenticated;

  select private.screening_event_attach_rate(v_event_a) into v_rate;
  if (v_rate ->> 'converted_within_30_days')::int <> 1 then
    raise exception 'FAIL M3: expected 1 conversion within 30 days, got %', v_rate;
  end if;
  raise notice 'PASS M3l: attach-rate report reflects the conversion: %', v_rate;

  reset role;
end $$;

select 'M3_EXIT_TEST_RESULT' as label, 'PASS' as result;
