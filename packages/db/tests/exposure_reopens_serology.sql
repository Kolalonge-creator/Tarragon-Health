-- "Once, ever" that can be reopened when something changes.
--
-- The tier promises blood group, genotype and hepatitis B and C are done once
-- and never charged for again. Two of those are facts about a body and the
-- promise is literally true. The other two are a statement about a point in
-- time, and this file proves the platform now treats them differently:
--   * an immutable fact is never reopened by anything;
--   * hepatitis serology IS reopened by a reported exposure;
--   * but never sold before the window period, when a negative result would
--     be a false reassurance the patient paid for;
--   * and an exposure emergency never messages the patient's family.
--
-- Run inside a single transaction and ROLLED BACK. Every negative is paired
-- with a positive control.
--
-- To re-run:
--   npx supabase db query --linked -f packages/db/tests/exposure_reopens_serology.sql

begin;

create temporary table test_results (case_name text, passed boolean, detail text) on commit drop;

do $$
declare
  v_p     uuid := gen_random_uuid();  -- was: 'bb707ae8-1d0b-49c2-b990-1950de601db4'
  v_org   uuid := '00000000-0000-0000-0000-000000000001';
  v_basics text[] := array['blood_group', 'sickle_cell_genotype', 'hep_b', 'hep_c'];
  v_d     text[];
  v_ex    jsonb;
  v_rep   uuid;
  v_ev    uuid;
  v_before int;
  v_res   jsonb;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_p, 'exposure-reopens-serology-test-patient@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Exposure Reopens Serology Test Patient'
    where id = v_p;

  delete from public.screening_results where patient_id = v_p and screen_type_code = any(v_basics);
  delete from public.patient_exposure_reports where patient_id = v_p;

  -- Everything already done: the tier's promise, working.
  insert into public.screening_results (organisation_id, patient_id, screen_type_code, result_status)
  values (v_org, v_p, 'blood_group', 'normal'), (v_org, v_p, 'sickle_cell_genotype', 'normal'),
         (v_org, v_p, 'hep_b', 'normal'), (v_org, v_p, 'hep_c', 'normal');

  v_d := private.patient_delivered_test_codes(v_p, v_org, v_basics);
  insert into test_results select 'e1_nothing_in_know_your_basics_is_repurchased',
    coalesce(array_length(v_d, 1), 0) = 0, array_to_string(v_d, ',');

  -- -----------------------------------------------------------------------
  -- A fresh exposure. Reopened, but far too early to test.
  -- -----------------------------------------------------------------------
  v_res := public.report_exposure(v_p, 'needlestick_or_sharps', current_date - 2, 'used needle at work');

  insert into test_results select 'e2_a_fresh_high_risk_exposure_is_urgent',
    (v_res ->> 'urgent')::boolean and (v_res ->> 'emergency_event_id') is not null,
    v_res ->> 'guidance';

  v_ex := private.compute_screening_order_exclusions(v_p, v_org, v_basics);
  insert into test_results select 'e3_hepatitis_is_reopened_but_inside_its_window',
    exists (select 1 from jsonb_array_elements(v_ex) e
             where e ->> 'item_code' = 'hep_b' and e ->> 'reason' like 'within_window_period:%'),
    (select e ->> 'reason' from jsonb_array_elements(v_ex) e where e ->> 'item_code' = 'hep_b');

  v_d := private.patient_delivered_test_codes(v_p, v_org, v_basics);
  insert into test_results select 'e4_and_is_therefore_not_billed_today',
    not (v_d && array['hep_b', 'hep_c']), array_to_string(v_d, ',');

  -- The whole point of the split: no exposure changes a blood group.
  insert into test_results select 'e5_an_immutable_fact_is_never_reopened',
    exists (select 1 from jsonb_array_elements(v_ex) e
             where e ->> 'item_code' = 'blood_group' and e ->> 'reason' = 'lifetime_once_on_file')
    and (select not reopens_on_exposure from public.screen_types where code = 'blood_group'),
    null;

  -- The re-test is already on the patient's ordinary calendar, dated for when
  -- it can answer — not hidden in a separate list.
  insert into test_results select 'e6_the_retest_is_scheduled_for_when_it_can_answer',
    exists (select 1 from public.screening_schedules ss
             join public.screen_types st on st.id = ss.screen_type_id
            where ss.patient_id = v_p and st.code = 'hep_b'
              and ss.status = 'pending'
              and ss.due_date = current_date - 2 + 42),
    (select ss.due_date::text from public.screening_schedules ss
       join public.screen_types st on st.id = ss.screen_type_id
      where ss.patient_id = v_p and st.code = 'hep_b' and ss.status = 'pending' limit 1);

  -- -----------------------------------------------------------------------
  -- Past the window: now it is genuinely due, and billable.
  -- -----------------------------------------------------------------------
  update public.patient_exposure_reports set occurred_on = current_date - 90
   where patient_id = v_p and status = 'open';

  v_d := private.patient_delivered_test_codes(v_p, v_org, v_basics);
  insert into test_results select 'e7_past_the_window_the_retest_is_due_and_billable',
    v_d @> array['hep_b', 'hep_c'] and not (v_d && array['blood_group', 'sickle_cell_genotype']),
    array_to_string(v_d, ',');

  -- -----------------------------------------------------------------------
  -- An old exposure is not an emergency, and an unknown date is not either.
  -- -----------------------------------------------------------------------
  delete from public.patient_exposure_reports where patient_id = v_p;
  v_res := public.report_exposure(v_p, 'needlestick_or_sharps', current_date - 200, 'years-old injury');
  insert into test_results select 'e8_control_an_old_exposure_is_not_an_emergency',
    not (v_res ->> 'urgent')::boolean, v_res ->> 'urgent';

  v_res := public.report_exposure(v_p, 'needlestick_or_sharps', null, 'cannot remember when');
  insert into test_results select 'e9_an_unknown_date_goes_to_a_human_not_an_alarm',
    not (v_res ->> 'urgent')::boolean and (v_res ->> 'routes_to_human')::boolean,
    v_res ->> 'guidance';

  -- -----------------------------------------------------------------------
  -- Confidentiality: reporting an exposure must never message a relative.
  -- -----------------------------------------------------------------------
  update public.profiles
     set emergency_contact_phone = '+2348030000999', emergency_contact_consent = true,
         emergency_contact_name = 'Test Contact'
   where id = v_p;

  insert into public.emergency_events
    (organisation_id, patient_id, source, trigger_detail, suppress_contact_notify, created_at)
  values (v_org, v_p, 'exposure_report', 'reported exposure', true, now() - interval '20 minutes')
  returning id into v_ev;

  select count(*) into v_before
    from public.notifications where recipient_id = v_p and template = 'emergency_contact_alert';
  perform private.notify_unacknowledged_emergencies();

  insert into test_results select 'e10_an_exposure_emergency_never_messages_the_family',
    (select count(*) from public.notifications
      where recipient_id = v_p and template = 'emergency_contact_alert') = v_before
    and (select contact_notified_at is null from public.emergency_events where id = v_ev),
    null;

  -- Positive control: the same event without suppression DOES notify. Without
  -- this, e10 would pass just as happily against a cron that never runs.
  update public.emergency_events set suppress_contact_notify = false where id = v_ev;
  perform private.notify_unacknowledged_emergencies();

  insert into test_results select 'e10_control_an_ordinary_emergency_still_does',
    (select count(*) from public.notifications
      where recipient_id = v_p and template = 'emergency_contact_alert') > v_before, null;
end $$;

select case_name, passed, detail from test_results order by case_name;
select count(*) filter (where not passed) as failures, count(*) as total from test_results;

rollback;
