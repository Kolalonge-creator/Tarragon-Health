-- ============================================================================
-- Regression test — private.handle_lpe_red_flag() must persist a clinician_alerts
-- row for every fired amber/red/emergency lifestyle red flag.
--
-- Guards against the 20260719122000 bug (fixed by 20260720120000): the severity→
-- alert_level map referenced dead enum literals ('doctor_escalation'/'nurse_review'),
-- so any non-emergency flag raised "invalid input value for enum alert_level" at
-- runtime and rolled back the lpe_red_flag_events INSERT together with its
-- escalation alert — the very safety guarantee this path exists to provide.
--
-- Style: rolled-back live-DB transaction (this project's DB-verification convention;
-- no pgTAP harness is configured). Run against a populated database, e.g.:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/lpe_red_flag_alert_level_test.sql
-- A clean exit with the "PASS" notices means every severity mapped to a live enum
-- value and produced exactly one clinician_alerts row. Any regression aborts the txn.
-- ============================================================================

begin;

do $$
declare
  v_org      uuid;
  v_patient  uuid;
  v_flag     uuid;
  v_alert    uuid;
  v_level    public.alert_level;
  v_before   bigint;
  v_after    bigint;
begin
  -- Use any existing org that already has a patient profile (rolled back at the end).
  select o.id, p.id
    into v_org, v_patient
    from public.organisations o
    join public.profiles p on p.organisation_id = o.id
   where p.role = 'patient'
   limit 1;

  if v_org is null then
    raise exception 'test setup: no organisation with a patient profile found — cannot exercise the trigger';
  end if;

  -- --- amber -> clinician_review -------------------------------------------
  select count(*) into v_before from public.clinician_alerts where organisation_id = v_org;

  insert into public.lpe_red_flag_events
    (organisation_id, patient_id, rule_key, severity, escalation_level, action)
  values (v_org, v_patient, 'test.amber', 'amber', 2, 'same_day_review')
  returning id, clinician_alert_id into v_flag, v_alert;

  if v_alert is null then
    raise exception 'amber flag did not create a clinician_alerts row (clinician_alert_id is null)';
  end if;

  select count(*) into v_after from public.clinician_alerts where organisation_id = v_org;
  if v_after <> v_before + 1 then
    raise exception 'amber flag: expected exactly 1 new clinician_alerts row, got %', v_after - v_before;
  end if;

  select level into v_level from public.clinician_alerts where id = v_alert;
  if v_level <> 'clinician_review' then
    raise exception 'amber flag mapped to alert_level %, expected clinician_review', v_level;
  end if;
  raise notice 'PASS: amber -> clinician_review (alert %)', v_alert;

  -- --- red -> urgent_escalation ---------------------------------------------
  insert into public.lpe_red_flag_events
    (organisation_id, patient_id, rule_key, severity, escalation_level, action)
  values (v_org, v_patient, 'test.red', 'red', 3, 'page_oncall')
  returning clinician_alert_id into v_alert;

  select level into v_level from public.clinician_alerts where id = v_alert;
  if v_level is distinct from 'urgent_escalation' then
    raise exception 'red flag mapped to alert_level %, expected urgent_escalation', v_level;
  end if;
  raise notice 'PASS: red -> urgent_escalation (alert %)', v_alert;

  -- --- emergency -> emergency (already correct pre-fix; kept as a guard) -----
  insert into public.lpe_red_flag_events
    (organisation_id, patient_id, rule_key, severity, escalation_level, action)
  values (v_org, v_patient, 'test.emergency', 'emergency', 4, 'refer')
  returning clinician_alert_id into v_alert;

  select level into v_level from public.clinician_alerts where id = v_alert;
  if v_level is distinct from 'emergency' then
    raise exception 'emergency flag mapped to alert_level %, expected emergency', v_level;
  end if;
  raise notice 'PASS: emergency -> emergency (alert %)', v_alert;

  raise notice 'ALL PASS — every lifestyle red-flag severity persisted a clinician_alerts row.';
end $$;

rollback;
