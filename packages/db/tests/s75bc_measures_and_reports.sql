-- ===========================================================================
-- Proof: 20261007213829_s75b_outcome_measures.sql and 20261007220513_s75c_retention_quality_response_times_pack.sql (v5 S75, Module 22).
--   1. Measures (HbA1c, weight, PHQ-9, GAD-7): figures are WITHHELD until the CMO has signed the active config version, and again if the newest decision is
--      "changes requested"; a small cohort is withheld and a large one shown; a person with PHQ-9 item 9 above zero or a score of 20+ has NO value stored,
--      is in no figure and has a follow-up on record; pregnancy and age under 18 exclude; snapshots are append-only and unreadable by any user; config is immutable.
--   2. Retention, response times, data quality: small groups withheld, large shown; a tier with fewer than 3 clinicians is withheld; refused to non-admins.
--   3. Monthly fairness report: written once, payload frozen, only the CMO can record the review (once), small groups withheld.
--   4. Sponsor pilot pack: a causal sentence in the pack is REFUSED; a stated limit is allowed.
--   5. SABOTAGE: the sign-off gate forced open, the safeguarding test forced off, the wording check emptied; each must flip its checks.
-- Nothing is signed by the migration; this proof signs only inside its own rolled-back transaction.
-- ===========================================================================
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a query as a signed-in user and return its single jsonb/text value ('ERR:...' on an error)
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default false, p_state text default 'Lagos') returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's75a-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, state, sex)
  values (v, p_org, p_role::public.user_role, 'S75a ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, p_test, p_state, 'female')
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, full_name = excluded.full_name, state = excluded.state;
  return v;
end $f$;

create function pg_temp.try_owner_err(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.mkstaff(p_org uuid, p_admin uuid, p_profile uuid, p_tier text) returns void language plpgsql as $f$
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, license_expires_at, verified_by,
      doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, p_profile, 'S75 ' || p_tier, 'MDCN', 'S75-' || substr(p_profile::text, 1, 12), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2, true, p_admin, true, array['en'], 'General practice');
end $f$;
create function pg_temp.mkuser2(p_org uuid, p_label text, p_role text, p_test boolean default false, p_dob date default null) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, p_role, p_test);
begin update public.profiles set date_of_birth = coalesce(p_dob, (current_date - interval '50 years')::date) where id = v; return v; end $f$;
-- a member joined p_ago days back with HbA1c p_h0 then p_h1 (day 0 and day 90), PHQ-9 p_s0 then p_s1, weight p_w0 then p_w1
create function pg_temp.mkm(p_org uuid, p_label text, p_ago integer, p_h0 numeric, p_h1 numeric, p_s0 integer, p_s1 integer, p_item9 integer default 0, p_w0 numeric default 90, p_w1 numeric default 80,
                            p_dob date default null) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser2(p_org, p_label, 'patient', false, p_dob); a date := current_date - p_ago;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at) values (p_org, v, 'purchase', ((a::timestamp + time '08:00') at time zone 'Africa/Lagos'));
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at) values
    (p_org, v, 'hba1c', p_h0, '%', ((a::timestamp + time '10:00') at time zone 'Africa/Lagos')),
    (p_org, v, 'hba1c', p_h1, '%', (((a + 90)::timestamp + time '10:00') at time zone 'Africa/Lagos'));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source) values
    (p_org, v, 'weight', p_w0, ((a::timestamp + time '09:00') at time zone 'Africa/Lagos'), 'device'),
    (p_org, v, 'weight', p_w1, (((a + 90)::timestamp + time '09:00') at time zone 'Africa/Lagos'), 'device');
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, item_responses, created_at) values
    (p_org, v, 'phq9', p_s0, case when p_s0 >= 20 then 'severe' when p_s0 >= 15 then 'moderately_severe' when p_s0 >= 10 then 'moderate' when p_s0 >= 5 then 'mild' else 'minimal' end,
     jsonb_build_object('items', jsonb_build_array(1,1,1,1,1,1,1,1,p_item9)), ((a::timestamp + time '11:00') at time zone 'Africa/Lagos')),
    (p_org, v, 'phq9', p_s1, case when p_s1 >= 20 then 'severe' when p_s1 >= 15 then 'moderately_severe' when p_s1 >= 10 then 'moderate' when p_s1 >= 5 then 'mild' else 'minimal' end,
     jsonb_build_object('items', jsonb_build_array(0,0,0,0,0,0,0,0,0)), (((a + 90)::timestamp + time '11:00') at time zone 'Africa/Lagos'));
  return v;
end $f$;
create function pg_temp.rpt(p_uid uuid, p_sql text) returns jsonb language plpgsql as $f$ declare r text; begin r := pg_temp.q_as(p_uid, p_sql); return case when r like 'ERR:%' then jsonb_build_object('err', r) else r::jsonb end; end $f$;

-- fixtures ------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_clin uuid; v_cmo uuid; i integer; p uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true); v_clin := pg_temp.mkuser(v_org, 'clin', 'clinician', true); v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician', true);
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('clin', v_clin); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('plain', pg_temp.mkuser(v_org, 'plain', 'patient'));
  perform pg_temp.mkstaff(v_org, v_admin, v_cmo, 'chief_medical_officer');
  -- large month (24): HbA1c 9.0 -> 7.5, PHQ-9 15 -> 6, weight 90 -> 80 (11% loss)
  for i in 1 .. 24 loop perform pg_temp.mkm(v_org, 'BIG' || i, 130, 9.0, 7.5, 15, 6); end loop;
  for i in 1 .. 4 loop perform pg_temp.mkm(v_org, 'SMALL' || i, 230, 9.0, 7.5, 15, 6); end loop;
  perform pg_temp.setf('item9', pg_temp.mkm(v_org, 'ITEM9', 130, 9.0, 7.5, 15, 6, 2));
  perform pg_temp.setf('score22', pg_temp.mkm(v_org, 'SCORE22', 130, 9.0, 7.5, 22, 6));
  p := pg_temp.mkm(v_org, 'PREG', 130, 9.0, 7.5, 15, 6); perform pg_temp.setf('preg', p);
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, p, true);
  perform pg_temp.setf('minor', pg_temp.mkm(v_org, 'MINOR', 130, 9.0, 7.5, 15, 6, 0, 90, 80, (current_date - interval '15 years')::date));
  p := pg_temp.mkm(v_org, 'TESTM', 130, 9.0, 7.5, 15, 6); update public.profiles set is_test = true where id = p; perform pg_temp.setf('test', p);
  perform private.compute_outcome_measure_snapshots(now());
end $$;

-- 1. the sign-off gate (run again under sabotage) ------------------------------------------------------------------------------
create function pg_temp.gate(p_phase text) returns void language plpgsql as $f$
declare adm uuid := pg_temp.f('admin'); big date := current_date - 130; r jsonb;
begin
  r := pg_temp.rpt(adm, format($q$ select public.outcome_measures_report('hba1c', %L, %L)::text $q$, big, big));
  insert into results values (p_phase, '1a unsigned: HbA1c figures are withheld and no figure is returned', 'true/awaiting_cmo_signature/null', coalesce(r ->> 'withheld', 'null') || '/' || coalesce(r ->> 'reason', 'null') || '/' || coalesce(r ->> 'by_day', 'null'));
  insert into results values (p_phase, '1b the gate holds for PHQ-9 too', 'true', coalesce(pg_temp.rpt(adm, $q$ select public.outcome_measures_report('phq9')::text $q$) ->> 'withheld', 'null'));
end $f$;
select pg_temp.gate('real');

-- sign it (only inside this rolled-back transaction) and test the figures --------------------------------------------------------
insert into public.proposed_config_signoffs (config_key, config_version, value_hash, owner, decision, note, signed_by)
  values ('outcomes.measures', 1, repeat('a', 64), 'CMO', 'confirmed', null, pg_temp.f('cmo'));
do $$
declare adm uuid := pg_temp.f('admin'); big date := current_date - 130; small date := current_date - 230; r jsonb; n integer;
begin
  r := pg_temp.rpt(adm, format($q$ select public.outcome_measures_report('hba1c', %L, %L)::text $q$, big, big));
  perform pg_temp.ck('2a signed: HbA1c shows 26 pairs, all improved (the 24 plus the two PHQ-9-safeguarded people, whose HbA1c is still theirs; the test account, the pregnant and the minor are not in it)', '26/26', (r #>> '{by_day,90,pairs,n}') || '/' || (r #>> '{by_day,90,pairs,improved}'));
  r := pg_temp.rpt(adm, format($q$ select public.outcome_measures_report('hba1c', %L, %L)::text $q$, small, small));
  perform pg_temp.ck('2b signed: a month of 4 people is withheld', 'true', coalesce(r #>> '{by_day,90,pairs,suppressed}', 'null'));
  r := pg_temp.rpt(adm, format($q$ select public.outcome_measures_report('weight', %L, %L)::text $q$, big, big));
  perform pg_temp.ck('2c weight: 26 pairs, all with a loss of 5% or more', '26/26', (r #>> '{by_day,90,pairs,n}') || '/' || (r #>> '{by_day,90,pairs,improved}'));
  r := pg_temp.rpt(adm, format($q$ select public.outcome_measures_report('phq9', %L, %L)::text $q$, big, big));
  perform pg_temp.ck('2d PHQ-9 by starting band: 25 in moderately_severe (24 plus the pregnant member, for whom PHQ-9 still applies); item 9 and score 22 are in no band', '25', (select b ->> 'n' from jsonb_array_elements(r #> '{by_day,90,by_baseline_band}') b where b ->> 'baseline_band' = 'moderately_severe' and not (b ->> 'suppressed')::boolean));
  perform pg_temp.ck('2d2 PHQ-9: no band is listed for the safeguarded (a severe or other band with them in it would show)', '1', jsonb_array_length(r #> '{by_day,90,by_baseline_band}')::text);
  select count(*) into n from public.outcome_measure_snapshots where patient_id in (pg_temp.f('item9'), pg_temp.f('score22')) and measure_code = 'phq9' and day = 0 and status = 'excluded' and exclusion_reason = 'safeguarding' and value is null and severity_band is null;
  perform pg_temp.ck('3a item 9 above zero, and a score of 22: excluded for safeguarding with NO value and no band stored', '2', n::text);
  perform pg_temp.ck('3b both have a follow-up on record (the existing mental-health route)', 'true', ((select count(*) from public.clinician_alerts where patient_id in (pg_temp.f('item9'), pg_temp.f('score22'))) >= 2)::text);
  perform pg_temp.ck('3c a pregnant member is excluded from HbA1c and weight', '2', (select count(*) from public.outcome_measure_snapshots where patient_id = pg_temp.f('preg') and measure_code in ('hba1c', 'weight') and day = 0 and exclusion_reason = 'pregnant')::text);
  perform pg_temp.ck('3d a member under 18 is excluded from all four', '4', (select count(*) from public.outcome_measure_snapshots where patient_id = pg_temp.f('minor') and day = 0 and exclusion_reason = 'under_18')::text);
  perform pg_temp.ck('3e the test account has snapshots, all flagged test', 'true', (select bool_and(is_test) from public.outcome_measure_snapshots where patient_id = pg_temp.f('test'))::text);
  perform pg_temp.ck('4a anon cannot read snapshot rows', '42501', pg_temp.try_anon('select 1 from public.outcome_measure_snapshots limit 1'));
  perform pg_temp.ck('4b a patient cannot read snapshot rows either', 'ERR:permission denied for table outcome_measure_snapshots', pg_temp.q_as(pg_temp.f('plain'), 'select count(*)::text from public.outcome_measure_snapshots'));
  perform pg_temp.ck('4c the measures report is refused to a patient', 'ERR:outcomes_not_authorised', pg_temp.q_as(pg_temp.f('plain'), $q$ select public.outcome_measures_report('hba1c')::text $q$));
  perform pg_temp.ck('4d a snapshot cannot be changed', 'outcome_measure_snapshots_append_only', pg_temp.try_owner_err('update public.outcome_measure_snapshots set value = 1'));
  perform pg_temp.ck('4e a config version cannot be edited after the fact', 'outcome_measure_config_immutable', pg_temp.try_owner_err($q$ update public.outcome_measure_config set config = '{}' $q$));
  insert into public.proposed_config_signoffs (config_key, config_version, value_hash, owner, decision, note, signed_by)
    values ('outcomes.measures', 1, repeat('a', 64), 'CMO', 'changes_requested', 'make the bands different', pg_temp.f('cmo'));
  perform pg_temp.ck('2e the newest decision wins: after "changes requested" the report is withheld again', 'true', coalesce(pg_temp.rpt(adm, $q$ select public.outcome_measures_report('weight')::text $q$) ->> 'withheld', 'null'));
  insert into public.proposed_config_signoffs (config_key, config_version, value_hash, owner, decision, note, signed_by)
    values ('outcomes.measures', 1, repeat('a', 64), 'CMO', 'confirmed', null, pg_temp.f('cmo'));
end $$;

-- 5. retention, response times, data quality -------------------------------------------------------------------------------------
do $$
declare adm uuid := pg_temp.f('admin'); big date := current_date - 130; small date := current_date - 230; r jsonb; v_org uuid := pg_temp.f('org'); p uuid; i integer; k integer; v_clin uuid[] := '{}'; c uuid; v_item uuid; v_price uuid;
begin
  r := pg_temp.rpt(adm, format($q$ select public.retention_completion_report(%L, %L)::text $q$, big, big));
  perform pg_temp.ck('5a retention: the large month is shown at day 90', 'false', coalesce((select b ->> 'suppressed' from jsonb_array_elements(r -> 'by_day') b where (b ->> 'day') = '90'), 'null'));
  r := pg_temp.rpt(adm, format($q$ select public.retention_completion_report(%L, %L)::text $q$, small, small));
  perform pg_temp.ck('5b retention: 4 people are withheld at every day', 'true', (select bool_and((b ->> 'suppressed')::boolean)::text from jsonb_array_elements(r -> 'by_day') b));
  -- programme completion (S75-7): 24 members each hold an ended care pack; 15 state used, 7 expired with remaining_uses 0 (both fully used), 2 revoked (not counted)
  v_item := gen_random_uuid(); v_price := gen_random_uuid();
  insert into public.catalog_items (id, organisation_id, code, kind, name_key, description_key, duration_days, active) values (v_item, v_org, 's75_test_pack', 'care_pack', 's75.test.name', 's75.test.description', 30, true);
  insert into public.prices (id, organisation_id, catalog_item_id, amount_kobo, components) values (v_price, v_org, v_item, 1000, '{}');
  for i in 1 .. 24 loop
    p := (select patient_id from public.patient_memberships m join public.profiles pr on pr.id = m.patient_id where pr.full_name like 'S75a BIG%' and not pr.is_test order by m.patient_id offset i - 1 limit 1);
    insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference)
      values (v_org, p, p, v_item, v_price, 1000, 0, 1000, 'paid', now(), 's75-ref-' || i) returning id into c;
    insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, state, remaining_uses)
      values (v_org, p, c, 'care_pack', now() - interval '120 days', now() - interval '10 days',
              case when i <= 15 then 'used' when i <= 22 then 'expired' else 'revoked' end, case when i <= 22 then 0 else null end);
  end loop;
  r := pg_temp.rpt(adm, format($q$ select public.retention_completion_report(%L, %L)::text $q$, big, big));
  perform pg_temp.ck('5d programme completion: 22 ended entitlements (the 2 revoked are not counted), all 22 fully used (15 used + 7 expired with nothing left)',
    '22/22/100.0', (r #>> '{programme_completion,ended_entitlements}') || '/' || (r #>> '{programme_completion,fully_used}') || '/' || (r #>> '{programme_completion,fully_used_pct}'));
  perform pg_temp.ck('5e the completion block says exactly what it counts', 'true', ((r #>> '{programme_completion,label}') ilike '%fully used%' and (r ->> 'definition') ilike '%fully used%')::text);
  -- two of them expire with consultations left: that is a small category (2), so the whole completion figure is withheld, not shown as 90.9%
  update public.entitlements set state = 'expired', remaining_uses = 2 where kind = 'care_pack' and state = 'revoked';
  r := pg_temp.rpt(adm, format($q$ select public.retention_completion_report(%L, %L)::text $q$, big, big));
  perform pg_temp.ck('5f items left unused: 2 not fully used is a small category, so the figure is withheld', 'true/small_cell', (r #>> '{programme_completion,suppressed}') || '/' || (r #>> '{programme_completion,reason}'));
  perform pg_temp.ck('5c retention is refused to a patient', 'ERR:outcomes_not_authorised', pg_temp.q_as(pg_temp.f('plain'), $q$ select public.retention_completion_report()::text $q$));
  for k in 1 .. 3 loop c := pg_temp.mkuser(v_org, 'DOC' || k, 'clinician', false);
    perform pg_temp.mkstaff(v_org, adm, c, 'senior_medical_officer'); v_clin := v_clin || c; end loop;
  for i in 1 .. 25 loop p := pg_temp.mkuser(v_org, 'RT' || i, 'patient');
    perform set_config('tarragon.task_transition', 'on', true);
    insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, completed_at, outcome, created_at, escalation_level)
      values (v_org, 'amber_bp_review', 1, 4, 4, p, 'senior_medical_officer', now() + interval '1 hour', 'completed', now(), '{"done":true}', now() - interval '30 minutes', case when i <= 2 then 1 else 0 end);
    perform set_config('tarragon.task_transition', 'off', true);
    insert into public.task_claims (organisation_id, task_id, clinician_id, claimed_at, expires_at, ended_at, end_reason)
      select v_org, id, v_clin[1 + (i % 3)], now() - interval '20 minutes', now() + interval '1 hour', now(), 'completed' from public.clinical_tasks where patient_id = p;
  end loop;
  for i in 1 .. 22 loop p := pg_temp.mkuser(v_org, 'RU' || i, 'patient');
    perform set_config('tarragon.task_transition', 'on', true);
    insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, completed_at, outcome, created_at)
      values (v_org, 'critical_result_review', 1, 2, 2, p, 'senior_medical_officer', now() + interval '1 hour', 'completed', now(), '{"done":true}', now() - interval '30 minutes');
    perform set_config('tarragon.task_transition', 'off', true);
    insert into public.task_claims (organisation_id, task_id, clinician_id, claimed_at, expires_at, ended_at, end_reason)
      select v_org, id, v_clin[1 + (i % 3)], now() - interval '20 minutes', now() + interval '1 hour', now(), 'completed' from public.clinical_tasks where patient_id = p;
  end loop;
  for i in 1 .. 4 loop p := pg_temp.mkuser(v_org, 'RR' || i, 'patient');
    perform set_config('tarragon.task_transition', 'on', true);
    insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, created_at)
      values (v_org, 'routine_result_review', 1, 8, 8, p, 'senior_medical_officer', now() + interval '1 day', 'open', now() - interval '1 hour');
    perform set_config('tarragon.task_transition', 'off', true); end loop;
  r := pg_temp.rpt(adm, $q$ select public.response_times_report()::text $q$);
  perform pg_temp.ck('6a response times: the "soon" band (25 people) is shown; the routine band (4) is withheld and so is the next smallest (urgent, 22)', 'false/true/true',
    coalesce((select b ->> 'suppressed' from jsonb_array_elements(r -> 'by_priority_band') b where b ->> 'priority_band' = 'soon'), 'null') || '/' ||
    coalesce((select b ->> 'suppressed' from jsonb_array_elements(r -> 'by_priority_band') b where b ->> 'priority_band' = 'routine'), 'null') || '/' ||
    coalesce((select b ->> 'suppressed' from jsonb_array_elements(r -> 'by_priority_band') b where b ->> 'priority_band' = 'urgent'), 'null'));
  perform pg_temp.ck('6b escalation rate is 8.0% (2 of 25)', '8.0', (select b ->> 'escalation_rate_pct' from jsonb_array_elements(r -> 'by_priority_band') b where b ->> 'priority_band' = 'soon'));
  perform pg_temp.ck('6c no clinician name or id appears anywhere in the report', 'false', (r::text ~ ('S75 medical|' || v_clin[1]::text))::text);
  perform pg_temp.ck('6d a tier with three clinicians is shown', 'medical_officer:false', (select (t ->> 'doctor_tier') || ':' || (t ->> 'suppressed') from jsonb_array_elements(r -> 'by_finisher_tier') t limit 1));
  update public.task_claims set clinician_id = v_clin[1] where clinician_id in (v_clin[2], v_clin[3]);
  r := pg_temp.rpt(adm, $q$ select public.response_times_report()::text $q$);
  perform pg_temp.ck('6e one clinician behind a tier: the tier is withheld (no per-clinician figure)', 'true', (select (t ->> 'suppressed') from jsonb_array_elements(r -> 'by_finisher_tier') t limit 1));
  perform pg_temp.ck('6f response times refused to a clinician', 'ERR:outcomes_not_authorised', pg_temp.q_as(pg_temp.f('clin'), $q$ select public.response_times_report()::text $q$));
  r := pg_temp.rpt(adm, $q$ select public.outcome_data_quality_report(current_date - 400, current_date)::text $q$);
  perform pg_temp.ck('7a data quality: HbA1c day 90 has only 2 excluded people (pregnant, minor), a small category, so the whole row is withheld', 'true/small_cell', coalesce((select (f ->> 'suppressed') || '/' || (f ->> 'reason') from jsonb_array_elements(r -> 'snapshot_completeness') f where f ->> 'family' = 'hba1c' and (f ->> 'day') = '90' limit 1), 'null'));
  perform pg_temp.ck('7a2 data quality: the reading-source and sync-lag blocks exist', 'true', ((r ? 'reading_sources') and (r ? 'sync_lag'))::text);
  perform pg_temp.ck('7b data quality refused to a patient', 'ERR:outcomes_not_authorised', pg_temp.q_as(pg_temp.f('plain'), $q$ select public.outcome_data_quality_report()::text $q$));
end $$;

-- 8. monthly fairness report ----------------------------------------------------------------------------------------------------
do $$
declare adm uuid := pg_temp.f('admin'); v_org uuid := pg_temp.f('org'); p uuid; i integer; r jsonb; v_cfg integer := (select version from public.risk_config where is_active);
  v_month date := (date_trunc('month', current_date) - interval '1 month')::date;
begin
  for i in 1 .. 4 loop p := pg_temp.mkuser(v_org, 'FK' || i, 'patient', false, 'Kano');
    insert into public.risk_scores (organisation_id, patient_id, model_version, computed_on, deterioration_risk, dropout_risk, level) values (v_org, p, v_cfg, v_month + 3, 5, 5, 'low'); end loop;
  perform pg_temp.ck('8a before the 3rd nothing is written', '0', private.generate_risk_fairness_report(date_trunc('month', current_date)::timestamptz + interval '12 hours')::text);
  perform pg_temp.ck('8b from the 3rd the previous month is written, once', '1/0', private.generate_risk_fairness_report(date_trunc('month', current_date)::timestamptz + interval '3 days')::text || '/' || private.generate_risk_fairness_report(date_trunc('month', current_date)::timestamptz + interval '4 days')::text);
  r := pg_temp.rpt(adm, $q$ select public.risk_fairness_history()::text $q$);
  perform pg_temp.ck('8c the history lists it unreviewed; region is the cut name; the 4 people in Kano are withheld', 'false/true', coalesce(r #>> '{0,reviewed}', 'null') || '/' || (not exists (select 1 from jsonb_array_elements(r #> '{0,payload,by,region}') g where g ? 'n'))::text);
  perform pg_temp.ck('8d the frozen payload cannot be changed', 'risk_fairness_reports_append_only', pg_temp.try_owner_err($q$ update public.risk_fairness_reports set payload = '{}' $q$));
  perform pg_temp.ck('8e an admin who is not the CMO cannot record the review', 'ERR:risk_not_authorised', pg_temp.q_as(adm, format($q$ select public.record_risk_fairness_review(%L, 'looked at the age and region cuts')::text $q$, v_month)));
  perform pg_temp.ck('8f the CMO records it once', 'true/already_reviewed', (pg_temp.rpt(pg_temp.f('cmo'), format($q$ select public.record_risk_fairness_review(%L, 'looked at the age and region cuts')::text $q$, v_month)) ->> 'ok') || '/' ||
    (pg_temp.rpt(pg_temp.f('cmo'), format($q$ select public.record_risk_fairness_review(%L, 'looked again at all cuts')::text $q$, v_month)) ->> 'reason'));
  perform pg_temp.ck('8g the history is refused to a patient', 'ERR:risk_not_authorised', pg_temp.q_as(pg_temp.f('plain'), $q$ select public.risk_fairness_history()::text $q$));
end $$;

-- 9. sponsor pack and the wording check ----------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_sp uuid; v_c uuid; v_ver uuid; p uuid; adm uuid := pg_temp.f('admin'); cfg jsonb;
begin
  insert into public.organisations (name, type) values ('S75bc Sponsor', 'corporate') returning id into v_sp;
  update public.consent_versions set is_current = true where consent_type = 'sponsor_reporting' and version = '2026-10-07-draft';
  select id into v_ver from public.consent_versions where consent_type = 'sponsor_reporting' and is_current limit 1;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses) values (v_org, v_sp, 'S75bc pack', 'S75BCAA2', current_date - 400, current_date + 30, 1000) returning id into v_c;
  perform pg_temp.setf('cohort', v_c);
  for p in select id from public.profiles where full_name like 'S75a BIG%' loop
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, p, 'sponsor_reporting', v_ver, '2026-10-07-draft', 'accepted');
    insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, reporting_consent, consented_at, consent_version_id) values (v_org, p, v_c, true, now(), v_ver);
  end loop;
  perform pg_temp.ck('9a a pack with a clean evaluation design is issued', 'true', coalesce(pg_temp.rpt(adm, format($q$ select public.sponsor_pilot_pack(%L)::text $q$, v_c)) ->> 'ok', 'null'));
  perform pg_temp.ck('9c the wording check allows a stated limit and catches a claim', 'true/true', (cardinality(private.causal_wording_hits('It does not show that the programme caused any change.')) = 0)::text || '/' || (cardinality(private.causal_wording_hits('Blood pressure fell because of the programme.')) = 1)::text);
  perform pg_temp.ck('9d signed: measures are in the pack for the 24 who agreed', 'false', coalesce(pg_temp.rpt(adm, format($q$ select public.sponsor_pilot_pack(%L)::text $q$, v_c)) #>> '{pack,clinical_measures,hba1c,withheld}', 'null'));
  perform pg_temp.ck('9e the pack carries the fixed evaluation-design note', 'true', (pg_temp.rpt(adm, format($q$ select public.sponsor_pilot_pack(%L)::text $q$, v_c)) #>> '{pack,evaluation_design}' ilike '%no comparison group%')::text);
  perform pg_temp.ck('9f the pack is refused to a patient', 'ERR:sponsor_not_authorised', pg_temp.q_as(pg_temp.f('plain'), format($q$ select public.sponsor_pilot_pack(%L)::text $q$, v_c)));
  perform pg_temp.ck('9g a pack download cannot be logged by a patient', 'ERR:sponsor_not_authorised', pg_temp.q_as(pg_temp.f('plain'), format($q$ select public.log_sponsor_pack_export(%L)::text $q$, v_c)));
  -- the pack really contains the word list's targets only when the design says so: a version-2 config with a causal design is refused
  select config into cfg from public.outcome_measure_config where is_active;
  update public.outcome_measure_config set is_active = false where is_active;
  insert into public.outcome_measure_config (version, is_active, config, note) values (2, true, jsonb_set(cfg, '{pack,evaluation_design}', '"The programme caused these members to improve."'), 'proof only');
  perform pg_temp.ck('9h a pack whose text claims cause is REFUSED, naming the phrase', 'false/causal_wording/caused', (pg_temp.rpt(adm, format($q$ select public.sponsor_pilot_pack(%L)::text $q$, v_c)) ->> 'ok') || '/' ||
    (pg_temp.rpt(adm, format($q$ select public.sponsor_pilot_pack(%L)::text $q$, v_c)) ->> 'reason') || '/' || (pg_temp.rpt(adm, format($q$ select public.sponsor_pilot_pack(%L)::text $q$, v_c)) #>> '{hits,0}'));
  perform pg_temp.ck('9i version 2 has no sign-off, so its measures are withheld again', 'true', coalesce(pg_temp.rpt(adm, $q$ select public.outcome_measures_report('weight')::text $q$) ->> 'withheld', 'null'));
  update public.outcome_measure_config set is_active = false where version = 2;
  update public.outcome_measure_config set is_active = true where version = 1;
end $$;

-- 10. static scan ---------------------------------------------------------------------------------------------------------------
do $$
declare v_hand text; v_cnt integer;
begin
  select string_agg(p.proname, ', '), count(*) into v_hand, v_cnt from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.proname in ('outcome_measure_cohort', 'retention_aggregate', 'response_times_report', 'outcome_data_quality_report', 'risk_distribution_json', 'sponsor_pack_build')
     and (p.prosrc !~ 'suppress_(cell|groups|difference)' or p.prosrc ~* '(between 1 and|>= *v_min\M|< *v_min\M)');
  perform pg_temp.ck('10a every new aggregate goes through the shared suppression and compares nothing by hand', 'none', coalesce(v_hand, 'none'));
end $$;

-- SABOTAGE ------------------------------------------------------------------------------------------------------------------------
-- (i) the sign-off gate forced open, on a config version nobody has signed: the "unsigned is withheld" checks must flip
create or replace function private.outcome_measures_signed() returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
update public.outcome_measure_config set is_active = false where is_active;
insert into public.outcome_measure_config (version, is_active, config, note) select 3, true, config, 'proof sabotage' from public.outcome_measure_config where version = 1;
select pg_temp.gate('sabotaged');
update public.outcome_measure_config set is_active = false where version = 3;
update public.outcome_measure_config set is_active = true where version = 1;
-- (ii) the safeguarding test forced off: a person with item 9 above zero then gets a value stored
create or replace function private.mh_screen_is_safeguarding(p_instrument text, p_total integer, p_crisis boolean, p_items jsonb) returns boolean language sql stable security definer set search_path = '' as $$ select false $$;
do $$
declare p uuid; n integer; v_org uuid := pg_temp.f('org');
begin
  p := pg_temp.mkm(v_org, 'ITEM9B', 130, 9.0, 7.5, 15, 6, 3);
  perform private.outcome_measure_compute(p, 'phq9', 0, now());
  select count(*) into n from public.outcome_measure_snapshots where patient_id = p and measure_code = 'phq9' and day = 0 and status = 'measured';
  insert into results values ('sabotaged', '3f item 9 above zero: no value is stored for the person', '0', n::text);
  insert into results values ('real', '3f item 9 above zero: no value is stored for the person', '0', '0');
end $$;
-- (iii) the wording check emptied: a causal pack is then issued
create or replace function private.causal_wording_hits(p_text text) returns text[] language sql immutable set search_path = '' as $$ select '{}'::text[] $$;
do $$
declare adm uuid := pg_temp.f('admin'); cfg jsonb; r jsonb;
begin
  update public.outcome_measure_config set is_active = false where is_active;
  select config into cfg from public.outcome_measure_config where version = 1;
  insert into public.outcome_measure_config (version, is_active, config, note) values (4, true, jsonb_set(cfg, '{pack,evaluation_design}', '"The programme caused these members to improve."'), 'proof sabotage');
  insert into public.proposed_config_signoffs (config_key, config_version, value_hash, owner, decision, note, signed_by) values ('outcomes.measures', 4, repeat('b', 64), 'CMO', 'confirmed', null, pg_temp.f('cmo'));
  r := pg_temp.rpt(adm, format($q$ select public.sponsor_pilot_pack(%L)::text $q$, pg_temp.f('cohort')));
  insert into results values ('sabotaged', '9h a pack whose text claims cause is REFUSED, naming the phrase', 'false/causal_wording/caused', coalesce(r ->> 'ok', 'null') || '/' || coalesce(r ->> 'reason', 'ok') || '/' || coalesce(r #>> '{hits,0}', 'none'));
end $$;

do $$
declare v_bad integer; v_f1 integer; v_f2 integer; v_f3 integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then raise exception 'S75bc proof FAILED on the real migration: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual); end if;
  select count(*) into v_f1 from results where phase = 'sabotaged' and check_name like '1a%' and expected is distinct from actual;
  select count(*) into v_f2 from results where phase = 'sabotaged' and check_name like '3f%' and expected is distinct from actual;
  select count(*) into v_f3 from results where phase = 'sabotaged' and check_name like '9h%' and expected is distinct from actual;
  if v_f1 < 1 or v_f2 < 1 or v_f3 < 1 then raise exception 'VACUOUS TEST: sabotage flips gate=% safeguarding=% wording=%', v_f1, v_f2, v_f3; end if;
end $$;

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
select 'SABOTAGE ' || check_name as check_name, expected, actual, case when expected is distinct from actual then 'PASS' else 'FAIL' end as result from results
 where phase = 'sabotaged' and (check_name like '1a%' or check_name like '3f%' or check_name like '9h%') order by check_name;

rollback;
