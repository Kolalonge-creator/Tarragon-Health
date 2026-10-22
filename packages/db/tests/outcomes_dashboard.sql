-- Proof (migration *_outcomes_dashboard.sql): the honest outcomes dashboard.
--
--   1. ACCESS. Only a super admin or the active Chief Medical Officer can run, read or export. A patient, an ordinary doctor, a care coordinator,
--      a corporate admin, an HMO admin, an NGO admin, an analyst, a finance user and anon are all refused (42501). The report table has no grant
--      at all (even the admin cannot select from it), the per-person working sets are not executable, and an admin of another organisation sees
--      none of this organisation's reports. Reads and exports are written to the audit log.
--   2. THREE PANELS, NEVER ONE SCORE. The report has exactly the panels engagement, outcomes and comparison, no key anywhere is a score, index or
--      composite, no person id is inside, and no sentence in it reads as a causal claim.
--   3. EXCLUSIONS. Test accounts and people with no known age are left out of every count; points from rules that can touch protected areas
--      (screening) are left out of points; screenings of a sensitive, reproductive or unknown kind are left out of screenings; blood pressure
--      readings are left out of the engagement that defines the comparison groups (a low-engagement group who log blood pressure a lot stays "low").
--   4. NUMBERS. Counts, the blood pressure control rates, the Wilson intervals, the mean systolic change and BOTH difference-in-differences
--      estimates equal an independent recomputation from the fixture rows.
--   5. SUPPRESSION. A group under the minimum is withheld with no count; when exactly one group is withheld the next smallest is withheld with it
--      (so it cannot be recovered by subtraction); the difference-in-differences is then unavailable, never half-computed; a cohort with a small
--      category is withheld whole.
--   6. HELD BACK. When fewer people than the floor have newly become due since the last report, the outcome cutoff stays at the last report's
--      cutoff, so two stored reports cannot be subtracted to expose them.
--   7. RECORD. One report per month per organisation (a second run returns the same one), the first one with data is the baseline (an empty
--      organisation is recorded but is never a baseline), a report cannot be changed, deleted, or marked publishable, and the monthly job is loud:
--      a failure writes audit_log and opens one incident.
--   8. STATIC. No function in this build compares a count with the minimum by hand, and none names a mental health, reproductive health or
--      cycle table.
--   SABOTAGE (each must flip its check): (a) the minimum lowered, the withheld group must show; (b) the test-account flag cleared, the count must grow;
--   (c) blood pressure allowed into engagement, the low group must move band; (d) the held-back difference rule neutered, the report must not be held;
--   (e) the publishable CHECK dropped; (f) the immutability trigger dropped; (g) the admin gate opened for everybody, a patient must get in.
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception.
begin;

create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.scalar(p_sql text) returns text language plpgsql as
$f$ declare v text; begin execute p_sql into v; return v; end $f$;
-- one call as a user, returning the sqlstate or 'ok'
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text; begin perform pg_temp.act(p_uid); r := pg_temp.try(p_sql); perform pg_temp.back(); return r; end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text; begin perform pg_temp.act_anon(); r := pg_temp.try(p_sql); perform pg_temp.back(); return r; end $f$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default false, p_dob date default null) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'outd-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'OUTD ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          coalesce(p_dob, (current_date - interval '50 years')::date), p_test)
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, full_name = excluded.full_name,
                                 date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'OUTD ' || p_label, 'MDCN', 'OUTD-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;

-- fixture group labels, so the expected numbers are recomputed from the rows and never typed in
create temp table fxg (patient uuid primary key, org uuid, grp text, j integer) on commit drop;
grant all on fxg to public;

-- A blood pressure snapshot with every real constraint satisfied (controlled when the status says so; no average when insufficient).
create function pg_temp.mksnap(p_org uuid, p_patient uuid, p_test boolean, p_day integer, p_anchor date, p_status text, p_sys numeric, p_adh integer) returns void
language plpgsql as $f$
begin
  insert into public.outcome_snapshots (organisation_id, patient_id, pathway_code, day, anchor_date, window_start, window_end, bp_avg_7d_sys, bp_avg_7d_dia, bp_readings_7d,
      bp_status, controlled, target_sys, target_dia, target_source, adherence_pct, adherence_status, config_version, is_test)
  values (p_org, p_patient, 'bp', p_day, p_anchor,
      case when p_day = 0 then p_anchor else p_anchor + p_day - 6 end, case when p_day = 0 then p_anchor + 6 else p_anchor + p_day end,
      case when p_status = 'insufficient_data' then null else p_sys end, case when p_status = 'insufficient_data' then null else 85 end, case when p_status = 'insufficient_data' then 1 else 5 end,
      p_status, case p_status when 'controlled' then true when 'uncontrolled' then false end, 140, 90, 'default', p_adh, case when p_adh is null then 'no_doses' else 'ok' end,
      (select version from public.outcome_config where is_active), p_test);
end $f$;

-- A joined, hypertensive (and diabetic) adult in group p_grp (high / mid / low engagement), index p_j within the group, due at day 90 before month p_m.
--   baseline: controlled one time in four. Day 90: high 70 percent controlled, mid 50, low 40 (p_insuf makes the first p_insuf of the group unmeasured at day 90).
--   HbA1c change: high -1.2, mid -0.7, low -0.3 (plus a small spread). Engagement: meals on 40 / 20 / 5 distinct days after joining; the low group
--   also logs blood pressure on 12 other days (that must NOT lift them out of "low"). Points: high and mid earn, low does not.
create function pg_temp.mkpat(p_org uuid, p_label text, p_test boolean, p_grp text, p_j integer, p_m date, p_insuf integer default 0, p_dm boolean default true) returns uuid
language plpgsql as $f$
declare
  v uuid := pg_temp.mkuser(p_org, p_label, 'patient', p_test);
  a date := p_m - 150;
  s0 text := case when p_j % 4 = 0 then 'controlled' else 'uncontrolled' end;
  s90 text;
  k integer;
  n_meals integer := case p_grp when 'high' then 40 when 'mid' then 20 else 5 end;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, is_test)
  values (p_org, v, 'purchase', ((a::timestamp + time '08:00') at time zone 'Africa/Lagos'), p_test);
  insert into public.care_plans (organisation_id, patient_id, condition, status) values (p_org, v, 'hypertension', 'active');
  if p_dm then insert into public.care_plans (organisation_id, patient_id, condition, status) values (p_org, v, 'diabetes', 'active'); end if;
  s90 := case when p_j <= p_insuf then 'insufficient_data'
              when p_grp = 'high' then case when p_j % 10 < 7 then 'controlled' else 'uncontrolled' end
              when p_grp = 'mid'  then case when p_j % 10 < 5 then 'controlled' else 'uncontrolled' end
              else case when p_j % 10 < 4 then 'controlled' else 'uncontrolled' end end;
  perform pg_temp.mksnap(p_org, v, p_test, 0, a, s0, case s0 when 'controlled' then 136 - p_j % 3 else 150 + p_j % 7 end, null);
  perform pg_temp.mksnap(p_org, v, p_test, 90, a, s90,
    case s90 when 'controlled' then (case p_grp when 'high' then 128 else 134 end) - p_j % 5 else (case p_grp when 'high' then 144 else 148 end) - p_j % 5 end, 70 + p_j % 25);
  if p_dm then
    insert into public.outcome_measure_snapshots (organisation_id, patient_id, measure_code, day, anchor_date, baseline_value, baseline_date, value, value_date, change_abs,
        goal_status, change_status, config_version, is_test)
    values (p_org, v, 'hba1c', 90, a, 8.0, a, 8.0 + (case p_grp when 'high' then -1.2 when 'mid' then -0.7 else -0.3 end + (p_j % 4) * 0.1), a + 90,
        (case p_grp when 'high' then -1.2 when 'mid' then -0.7 else -0.3 end + (p_j % 4) * 0.1), case when p_j % 3 = 0 then 'reached' else 'not_reached' end, 'measured',
        (select version from public.outcome_config where is_active), p_test);
  end if;
  for k in 1 .. n_meals loop
    insert into public.nutrition_log_entries (organisation_id, patient_id, logged_at, meal_type, description)
    values (p_org, v, (((a + k)::timestamp + time '12:00') at time zone 'Africa/Lagos'), 'lunch', 'outcomes proof');
  end loop;
  if p_grp = 'low' then
    for k in 20 .. 31 loop
      insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
      values (p_org, v, 'blood_pressure', 130, 82, (((a + k)::timestamp + time '09:00') at time zone 'Africa/Lagos'), 'device');
    end loop;
  end if;
  if p_grp <> 'low' then
    insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, rule_code, created_at)
    values (p_org, v, 10, 10, 'meal_logged', 'meal_logged', (((a + 5)::timestamp + time '10:00') at time zone 'Africa/Lagos'));
  end if;
  if p_grp = 'low' and p_j <= 6 then
    -- a screening award must not turn a person into a points earner (rules that can touch protected areas are left out of every points figure)
    insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, rule_code, created_at)
    values (p_org, v, 40, 40, 'screening_done', 'screening_done', (((a + 6)::timestamp + time '10:00') at time zone 'Africa/Lagos'));
  end if;
  insert into fxg values (v, p_org, case when p_test then 'test' else p_grp end, p_j);
  return v;
end $f$;

do $$
declare
  v_orgA uuid; v_orgB uuid; v_orgC uuid; v_orgE uuid;
  v_m date := (date_trunc('month', now() at time zone 'Africa/Lagos') - interval '1 month')::date;
  v_m1 date := (date_trunc('month', now() at time zone 'Africa/Lagos'))::date;
  v_m2 date := (date_trunc('month', now() at time zone 'Africa/Lagos') + interval '1 month')::date;
  v_m3 date := (date_trunc('month', now() at time zone 'Africa/Lagos') + interval '2 month')::date;
  v_adminA uuid; v_adminB uuid; v_cmoA uuid; v_doc uuid; v_cc uuid; v_corp uuid; v_hmo uuid; v_ngo uuid; v_ana uuid; v_fin uuid; v_pat uuid; v_id uuid;
  i integer; v_p uuid; v_rep jsonb; v_cell jsonb; v_x jsonb; v_y jsonb; v_n integer; v_s text; v_def text; v_cut date; v_ok boolean;
  v_exp_ctl numeric; v_exp_sys numeric; v_exp_hb numeric; v_c integer; v_nn integer; v_w numeric[]; v_sd numeric; v_cnt integer;
  v_ids text; r record; v_res text;
begin
  insert into public.organisations (name, type) values ('OUTD proof A', 'clinic') returning id into v_orgA;
  insert into public.organisations (name, type) values ('OUTD proof B', 'clinic') returning id into v_orgB;
  insert into public.organisations (name, type) values ('OUTD proof C (empty)', 'clinic') returning id into v_orgC;
  insert into public.organisations (name, type) values ('OUTD proof E (fails)', 'clinic') returning id into v_orgE;

  v_adminA := pg_temp.mkuser(v_orgA, 'adminA', 'admin');
  v_adminB := pg_temp.mkuser(v_orgB, 'adminB', 'admin');
  v_cmoA := pg_temp.mkstaff(v_orgA, v_adminA, 'cmoA', 'chief_medical_officer');
  v_doc := pg_temp.mkstaff(v_orgA, v_adminA, 'doctorA', 'senior_medical_officer');
  v_cc := pg_temp.mkuser(v_orgA, 'coordA', 'care_coordinator');
  v_corp := pg_temp.mkuser(v_orgA, 'corpA', 'corporate_admin');
  v_hmo := pg_temp.mkuser(v_orgA, 'hmoA', 'hmo_admin');
  v_ngo := pg_temp.mkuser(v_orgA, 'ngoA', 'ngo_admin');
  v_ana := pg_temp.mkuser(v_orgA, 'analystA', 'analyst');
  v_fin := pg_temp.mkuser(v_orgA, 'financeA', 'finance');
  v_pat := pg_temp.mkuser(v_orgA, 'patientA', 'patient');

  -- screen types: one ordinary, one ordinary-looking but a protected pattern (reproductive), one marked sensitive in the catalogue
  insert into public.screen_types (code, name) values ('zz_outd_ok', 'Outcomes proof ordinary') on conflict (code) do nothing;
  insert into public.screen_types (code, name) values ('zz_outd_cervic', 'Outcomes proof protected pattern') on conflict (code) do nothing;
  insert into public.screen_types (code, name, sensitive) values ('zz_outd_sens', 'Outcomes proof sensitive', true) on conflict (code) do nothing;

  -- ORG A (rich): 36 + 36 + 36 hypertensive and diabetic adults, all measured at both ends; plus 5 test accounts and 2 people with no known age
  for i in 1 .. 36 loop perform pg_temp.mkpat(v_orgA, 'a-high-' || i, false, 'high', i, v_m); end loop;
  for i in 1 .. 36 loop perform pg_temp.mkpat(v_orgA, 'a-mid-' || i, false, 'mid', i, v_m); end loop;
  for i in 1 .. 36 loop perform pg_temp.mkpat(v_orgA, 'a-low-' || i, false, 'low', i, v_m); end loop;
  for i in 1 .. 5 loop perform pg_temp.mkpat(v_orgA, 'a-test-' || i, true, 'low', i, v_m); end loop;
  for i in 1 .. 2 loop
    v_p := pg_temp.mkpat(v_orgA, 'a-noage-' || i, false, 'high', 100 + i, v_m);
    update public.profiles set date_of_birth = null where id = v_p;
    delete from fxg where patient = v_p;
  end loop;

  -- ORG B (poor): high 40 (3 unmeasured at day 90: a small category), low 40, mid 12 (under the group minimum)
  for i in 1 .. 40 loop perform pg_temp.mkpat(v_orgB, 'b-high-' || i, false, 'high', i, v_m, 3); end loop;
  for i in 1 .. 40 loop perform pg_temp.mkpat(v_orgB, 'b-low-' || i, false, 'low', i, v_m); end loop;
  for i in 1 .. 12 loop perform pg_temp.mkpat(v_orgB, 'b-mid-' || i, false, 'mid', i, v_m); end loop;

  -- ORG E: one real person with a snapshot and no report yet (the failing-job test)
  perform pg_temp.mkpat(v_orgE, 'e-one', false, 'high', 1, v_m);

  -- Panel 1 and the review / escalation figures for ORG A, inside the report month v_m
  for r in select patient, j from fxg where org = v_orgA and grp in ('high', 'mid', 'low') and j <= 30 order by grp, j limit 30 loop
    insert into public.nutrition_log_entries (organisation_id, patient_id, logged_at, meal_type, description)
    select v_orgA, r.patient, (((v_m + d)::timestamp + time '12:00') at time zone 'Africa/Lagos'), 'lunch', 'outcomes proof month' from generate_series(1, 3) d;
    insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, rule_code, created_at)
    values (v_orgA, r.patient, 10, 10, 'meal_logged', 'meal_logged', (((v_m + 4)::timestamp + time '10:00') at time zone 'Africa/Lagos'));
  end loop;
  -- screening_done points in the month must not be counted in points_issued; test accounts' activity must not be counted at all
  insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, rule_code, created_at)
  select v_orgA, patient, 40, 40, 'screening_done', 'screening_done', (((v_m + 6)::timestamp + time '10:00') at time zone 'Africa/Lagos') from fxg where org = v_orgA and j <= 5 and grp <> 'test' limit 5;
  insert into public.nutrition_log_entries (organisation_id, patient_id, logged_at, meal_type, description)
  select v_orgA, patient, (((v_m + 2)::timestamp + time '12:00') at time zone 'Africa/Lagos'), 'lunch', 'test account' from fxg where org = v_orgA and grp = 'test';
  insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, rule_code, created_at)
  select v_orgA, patient, 10, 10, 'meal_logged', 'meal_logged', (((v_m + 4)::timestamp + time '10:00') at time zone 'Africa/Lagos') from fxg where org = v_orgA and grp = 'test';
  -- screenings in the month: 25 ordinary (counted), 25 reproductive pattern, 25 catalogue-sensitive, 25 with no known type (none counted)
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, created_at)
  select v_orgA, patient, 'normal', 'zz_outd_ok', (((v_m + 8)::timestamp + time '09:00') at time zone 'Africa/Lagos') from fxg where org = v_orgA and grp <> 'test' order by patient limit 25;
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, created_at)
  select v_orgA, patient, 'normal', 'zz_outd_cervic', (((v_m + 8)::timestamp + time '09:00') at time zone 'Africa/Lagos') from fxg where org = v_orgA and grp <> 'test' order by patient limit 25;
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, created_at)
  select v_orgA, patient, 'normal', 'zz_outd_sens', (((v_m + 8)::timestamp + time '09:00') at time zone 'Africa/Lagos') from fxg where org = v_orgA and grp <> 'test' order by patient limit 25;
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, created_at)
  select v_orgA, patient, 'normal', null, (((v_m + 8)::timestamp + time '09:00') at time zone 'Africa/Lagos') from fxg where org = v_orgA and grp <> 'test' order by patient limit 25;
  -- abnormal ordinary results for 25 people (they raise an alert; nobody has acknowledged one), and abnormal protected ones that must not count
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, created_at)
  select v_orgA, patient, 'abnormal', 'zz_outd_ok', (((v_m + 9)::timestamp + time '09:00') at time zone 'Africa/Lagos') from fxg where org = v_orgA and grp <> 'test' order by patient limit 25;
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, created_at)
  select v_orgA, patient, 'abnormal', 'zz_outd_sens', (((v_m + 9)::timestamp + time '09:00') at time zone 'Africa/Lagos') from fxg where org = v_orgA and grp <> 'test' order by patient desc limit 25;
  insert into public.escalations (organisation_id, patient_id, reason)
  select v_orgA, patient, 'outcomes proof' from fxg where org = v_orgA and grp <> 'test' order by patient limit 30;

  ------------------------------------------------------------------------------------------------------------------------------------
  -- 1. ACCESS (before any report exists, the refusals are about the door, not the data)
  ------------------------------------------------------------------------------------------------------------------------------------
  foreach v_s in array array['patient', 'doctor', 'care_coordinator', 'corporate_admin', 'hmo_admin', 'ngo_admin', 'analyst', 'finance'] loop
    v_id := case v_s when 'patient' then v_pat when 'doctor' then v_doc when 'care_coordinator' then v_cc when 'corporate_admin' then v_corp
                     when 'hmo_admin' then v_hmo when 'ngo_admin' then v_ngo when 'analyst' then v_ana else v_fin end;
    if pg_temp.try_as(v_id, format('select public.run_outcomes_dashboard_now(%L)', v_m)) <> '42501' then raise exception 'FAIL 1a: % can run the dashboard', v_s; end if;
    if pg_temp.try_as(v_id, 'select public.read_outcomes_dashboard(12)') <> '42501' then raise exception 'FAIL 1b: % can read the dashboard', v_s; end if;
    if pg_temp.try_as(v_id, 'select public.log_outcomes_dashboard_export()') <> '42501' then raise exception 'FAIL 1c: % can log an export', v_s; end if;
    if pg_temp.try_as(v_id, 'select count(*) from public.outcomes_dashboard_reports') <> '42501' then raise exception 'FAIL 1d: % can select the reports table', v_s; end if;
  end loop;
  if pg_temp.try_anon(format('select public.run_outcomes_dashboard_now(%L)', v_m)) <> '42501' then raise exception 'FAIL 1e: anon can run the dashboard'; end if;
  if pg_temp.try_anon('select public.read_outcomes_dashboard(12)') <> '42501' then raise exception 'FAIL 1f: anon can read the dashboard'; end if;
  if pg_temp.try_anon('select count(*) from public.outcomes_dashboard_reports') <> '42501' then raise exception 'FAIL 1g: anon can select the reports table'; end if;
  -- not even the admin or the CMO has a table grant; and the working sets and the builder are not executable by anyone signed in
  if pg_temp.try_as(v_adminA, 'select count(*) from public.outcomes_dashboard_reports') <> '42501' then raise exception 'FAIL 1h: the admin can select the reports table directly (the audited door is bypassable)'; end if;
  if pg_temp.try_as(v_cmoA, 'select count(*) from public.outcomes_dashboard_reports') <> '42501' then raise exception 'FAIL 1i: the CMO can select the reports table directly'; end if;
  if pg_temp.try_as(v_adminA, format('select * from private.outcomes_dash_people(%L, 90, current_date, ''{}''::jsonb)', v_orgA)) <> '42501' then raise exception 'FAIL 1j: the per-person working set is executable'; end if;
  if pg_temp.try_as(v_adminA, format('select private.run_outcomes_dashboard(%L, %L, null)', v_orgA, v_m)) <> '42501' then raise exception 'FAIL 1k: the builder is executable'; end if;
  -- the unfinished month is refused (22023), and a finished one is accepted for the super admin
  if pg_temp.try_as(v_adminA, format('select public.run_outcomes_dashboard_now(%L)', v_m1)) <> '22023' then raise exception 'FAIL 1l: an unfinished month was accepted'; end if;

  ------------------------------------------------------------------------------------------------------------------------------------
  -- 7a. THE MONTHLY JOB IS LOUD: with no active config every organisation with data fails, and it is said out loud
  ------------------------------------------------------------------------------------------------------------------------------------
  update public.outcomes_dashboard_config set is_active = false where is_active;
  if private.run_outcomes_dashboard_monthly() <> 0 then raise exception 'FAIL 7a: the monthly job reported success with no active config'; end if;
  select count(*) into v_cnt from public.audit_log where action = 'outcomes_dashboard.error' and organisation_id in (v_orgA, v_orgB, v_orgE);
  if v_cnt < 3 then raise exception 'FAIL 7b: only % failures were written to audit_log (expected one per organisation with data)', v_cnt; end if;
  if not exists (select 1 from public.ops_incidents where external_reference = 'outcomes-dashboard-failing' and status not in ('resolved', 'closed')) then
    raise exception 'FAIL 7c: a failing monthly job opened no incident';
  end if;
  if exists (select 1 from public.outcomes_dashboard_reports where organisation_id in (v_orgA, v_orgB, v_orgE)) then raise exception 'FAIL 7d: a failed run left a report behind'; end if;
  update public.outcomes_dashboard_config set is_active = true where version = 1;

  -- the real run: every organisation with data gets last month's report once
  if private.run_outcomes_dashboard_monthly() < 3 then raise exception 'FAIL 7e: the monthly job did not report the three organisations with data'; end if;
  if (select count(*) from public.outcomes_dashboard_reports where organisation_id in (v_orgA, v_orgB, v_orgE) and period_start = v_m) <> 3 then
    raise exception 'FAIL 7f: expected one report per organisation with data for last month';
  end if;
  if exists (select 1 from public.outcomes_dashboard_reports where organisation_id = v_orgC) then raise exception 'FAIL 7g: an organisation with no data got a report from the scheduled job'; end if;
  -- a second run changes nothing; running by hand returns the same report
  v_id := (select id from public.outcomes_dashboard_reports where organisation_id = v_orgA and period_start = v_m);
  perform private.run_outcomes_dashboard_monthly();
  if (select count(*) from public.outcomes_dashboard_reports where organisation_id = v_orgA and period_start = v_m) <> 1 then raise exception 'FAIL 7h: a second run duplicated the report'; end if;
  if private.run_outcomes_dashboard(v_orgA, v_m, null) <> v_id then raise exception 'FAIL 7i: a second run made a different report'; end if;
  -- baseline: the first with data. An empty organisation is recorded by hand but never becomes a baseline.
  if not (select is_baseline and has_data from public.outcomes_dashboard_reports where id = v_id) then raise exception 'FAIL 7j: the first report with data is not the baseline'; end if;
  v_id := private.run_outcomes_dashboard(v_orgC, v_m, null);
  if (select is_baseline or has_data from public.outcomes_dashboard_reports where id = v_id) then raise exception 'FAIL 7k: an empty organisation became a baseline'; end if;

  select report into v_rep from public.outcomes_dashboard_reports where organisation_id = v_orgA and period_start = v_m;

  ------------------------------------------------------------------------------------------------------------------------------------
  -- 1 (continued). who can read: the super admin and the CMO; the other organisation's admin sees none of A
  ------------------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_adminA);
  v_x := public.read_outcomes_dashboard(12);
  perform pg_temp.back();
  if jsonb_array_length(v_x) <> 1 or (v_x -> 0 ->> 'period_start')::date <> v_m then raise exception 'FAIL 1m: the admin did not read exactly last month''s report: %', jsonb_array_length(v_x); end if;
  if (v_x -> 0 ->> 'publishable')::boolean then raise exception 'FAIL 1n: a report is publishable'; end if;
  perform pg_temp.act(v_cmoA);
  v_y := public.read_outcomes_dashboard(12);
  perform pg_temp.back();
  if jsonb_array_length(v_y) <> 1 then raise exception 'FAIL 1o: the CMO could not read the report'; end if;
  perform pg_temp.act(v_adminB);
  v_y := public.read_outcomes_dashboard(12);
  perform pg_temp.back();
  if v_y::text like '%' || (v_x -> 0 ->> 'id') || '%' or jsonb_array_length(v_y) <> 1 then raise exception 'FAIL 1p: an admin of another organisation can see organisation A''s report'; end if;
  perform pg_temp.act(v_adminA);
  perform public.log_outcomes_dashboard_export();
  perform pg_temp.back();
  if not exists (select 1 from public.audit_log where action = 'outcomes_dashboard.read' and actor_id = v_adminA) then raise exception 'FAIL 1q: a read was not audited'; end if;
  if not exists (select 1 from public.audit_log where action = 'outcomes_dashboard.export' and actor_id = v_adminA) then raise exception 'FAIL 1r: an export was not audited'; end if;

  ------------------------------------------------------------------------------------------------------------------------------------
  -- 2. THREE PANELS, NEVER ONE SCORE; aggregate only; no causal wording
  ------------------------------------------------------------------------------------------------------------------------------------
  if (select array_agg(k order by k) from jsonb_object_keys(v_rep -> 'panels') k) <> array['comparison', 'engagement', 'outcomes'] then
    raise exception 'FAIL 2a: the panels are %', (select array_agg(k) from jsonb_object_keys(v_rep -> 'panels') k);
  end if;
  if exists (select 1 from jsonb_path_query(v_rep, 'strict $.**') x where jsonb_typeof(x) = 'object' and exists (select 1 from jsonb_object_keys(x) k where k ~* '(score|index|composite|blend|overall_rating|impact)')) then
    raise exception 'FAIL 2b: a key in the report is a score, index or composite';
  end if;
  select string_agg(patient::text, '|') into v_ids from fxg;
  if v_rep::text ~* v_ids or v_rep::text ~* 'patient_id|subject_key' then raise exception 'FAIL 2c: a person id is inside the report'; end if;
  if cardinality(private.causal_wording_hits(private.json_text(v_rep))) > 0 then raise exception 'FAIL 2d: the report carries causal wording: %', private.causal_wording_hits(private.json_text(v_rep)); end if;
  if not (v_rep ->> 'not_a_causal_claim')::boolean or not (v_rep ->> 'internal_only')::boolean or not (v_rep #>> '{panels,comparison,association_not_proof}')::boolean then
    raise exception 'FAIL 2e: the report does not say it is internal, not a causal claim, and an association';
  end if;

  ------------------------------------------------------------------------------------------------------------------------------------
  -- 3. EXCLUSIONS, and 4. NUMBERS: Panel 1 (engagement)
  ------------------------------------------------------------------------------------------------------------------------------------
  v_cell := v_rep #> '{panels,engagement}';
  if (v_cell #>> '{active_people,suppressed}')::boolean or (v_cell #>> '{active_people,people}')::integer <> 30 then
    raise exception 'FAIL 3a: active people should be 30 (the five test accounts left out), got %', v_cell -> 'active_people';
  end if;
  if (v_cell #>> '{active_logging_days,person_days}')::integer <> 90 or (v_cell #>> '{active_logging_days,mean_per_active_person}')::numeric <> 3.0 then
    raise exception 'FAIL 3b: logging days wrong: %', v_cell -> 'active_logging_days';
  end if;
  if (v_cell #>> '{points_issued,points}')::integer <> 300 or (v_cell #>> '{points_issued,earners}')::integer <> 30 then
    raise exception 'FAIL 3c: points issued should be 300 from 30 people (screening awards and test accounts left out): %', v_cell -> 'points_issued';
  end if;
  -- 25 normal and 25 abnormal ordinary results for the same 25 people; the reproductive, sensitive and unknown kinds are left out
  if (v_cell #>> '{screenings_done,count}')::integer <> 50 or (v_cell #>> '{screenings_done,people}')::integer <> 25 then
    raise exception 'FAIL 3d: screenings done should be 50 results from 25 people (reproductive, sensitive and unknown kinds left out): %', v_cell -> 'screenings_done';
  end if;
  if (v_cell #>> '{by_cohort,0,cohort}') <> to_char(date_trunc('month', (v_m - 150)::timestamp), 'YYYY-MM') then raise exception 'FAIL 3e: the joining cohort label is wrong: %', v_cell -> 'by_cohort'; end if;
  -- an activity cell with too few people is withheld with no count
  if (v_cell #>> '{lessons_completed,suppressed}')::boolean is not true or v_cell #> '{lessons_completed}' ? 'count' then raise exception 'FAIL 3f: a cell with no people behind it is not withheld cleanly: %', v_cell -> 'lessons_completed'; end if;

  ------------------------------------------------------------------------------------------------------------------------------------
  -- 4. NUMBERS: Panel 2 (outcomes) against an independent recomputation
  ------------------------------------------------------------------------------------------------------------------------------------
  v_cell := v_rep #> '{panels,outcomes,hypertension,0}';
  select count(*), count(*) filter (where d.bp_status = 'controlled'), count(*) filter (where d.bp_status = 'uncontrolled')
    into v_nn, v_c, v_cnt from fxg g join public.outcome_snapshots d on d.patient_id = g.patient and d.day = 90 and d.pathway_code = 'bp' where g.org = v_orgA and g.grp <> 'test';
  if v_nn <> 108 or (v_cell #>> '{due,n}')::integer <> 108 or (v_cell #>> '{due,controlled}')::integer <> v_c or (v_cell #>> '{due,uncontrolled}')::integer <> v_cnt then
    raise exception 'FAIL 4a: blood pressure control counts differ from the fixture (expected n 108 controlled % uncontrolled %): %', v_c, v_cnt, v_cell -> 'due';
  end if;
  v_w := private.wilson_interval(v_c, 108, 0.95);
  if (v_cell #>> '{strict_rate_interval,low}')::numeric <> v_w[1] or (v_cell #>> '{strict_rate_interval,high}')::numeric <> v_w[2] then raise exception 'FAIL 4b: the interval is not the Wilson interval'; end if;
  select avg(d.bp_avg_7d_sys - z.bp_avg_7d_sys), stddev_samp(d.bp_avg_7d_sys - z.bp_avg_7d_sys) into v_exp_sys, v_sd
    from fxg g join public.outcome_snapshots d on d.patient_id = g.patient and d.day = 90 and d.pathway_code = 'bp'
               join public.outcome_snapshots z on z.patient_id = g.patient and z.day = 0 and z.pathway_code = 'bp' where g.org = v_orgA and g.grp <> 'test';
  if abs((v_cell #>> '{systolic_change,mean}')::numeric - round(v_exp_sys, 2)) > 0.011 or (v_cell #>> '{systolic_change,n}')::integer <> 108 then
    raise exception 'FAIL 4c: the mean systolic change is % (expected %)', v_cell -> 'systolic_change', round(v_exp_sys, 2);
  end if;
  v_cell := v_rep #> '{panels,outcomes,diabetes,0}';
  if (v_cell #>> '{hba1c_change,n}')::integer <> 108 or (v_cell #>> '{hba1c_change,mean}')::numeric >= 0 then raise exception 'FAIL 4d: the HbA1c block is wrong: %', v_cell -> 'hba1c_change'; end if;
  -- the day 180 block has nobody due: withheld, with no count
  if not (v_rep #>> '{panels,outcomes,hypertension,1,due,suppressed}')::boolean then raise exception 'FAIL 4e: day 180 with nobody due is not withheld'; end if;
  -- time to first review: 25 ordinary abnormal results, none acknowledged yet; the protected ones are not counted
  v_cell := v_rep #> '{panels,outcomes,time_to_first_review}';
  if (v_cell ->> 'suppressed')::boolean or (v_cell ->> 'people')::integer <> 25 or (v_cell ->> 'waiting_for_first_review')::integer <> 25 or (v_cell ->> 'reviewed')::integer <> 0 then
    raise exception 'FAIL 4f: time to first review wrong (expected 25 waiting): %', v_cell;
  end if;
  v_cell := v_rep #> '{panels,outcomes,escalations,0}';
  if (v_cell ->> 'status') <> 'open' or (v_cell ->> 'people')::integer <> 30 then raise exception 'FAIL 4g: escalations wrong: %', v_cell; end if;

  ------------------------------------------------------------------------------------------------------------------------------------
  -- 4. NUMBERS: Panel 3 (comparison): both estimates equal the recomputation from the fixture
  ------------------------------------------------------------------------------------------------------------------------------------
  -- by engagement, high versus low; the change in "controlled" per person is (controlled at day 90) - (controlled at day 0), among people measured at both ends
  select avg(y) filter (where grp = 'high') - avg(y) filter (where grp = 'low'), avg(ds) filter (where grp = 'high') - avg(ds) filter (where grp = 'low')
    into v_exp_ctl, v_exp_sys from (
      select g.grp, (d.bp_status = 'controlled')::integer - (z.bp_status = 'controlled')::integer as y, d.bp_avg_7d_sys - z.bp_avg_7d_sys as ds
        from fxg g join public.outcome_snapshots d on d.patient_id = g.patient and d.day = 90 and d.pathway_code = 'bp'
                   join public.outcome_snapshots z on z.patient_id = g.patient and z.day = 0 and z.pathway_code = 'bp'
       where g.org = v_orgA and g.grp in ('high', 'low')) t;
  v_x := v_rep #> '{panels,comparison,cohorts,hypertension,engagement,difference_in_differences}';
  if not (v_x #>> '{control,available}')::boolean then raise exception 'FAIL 4h: the control estimate is not available with 36 per group: %', v_x; end if;
  if abs((v_x #>> '{control,difference}')::numeric - v_exp_ctl) > 0.0011 or abs((v_x #>> '{systolic,difference}')::numeric - v_exp_sys) > 0.0011 then
    raise exception 'FAIL 4i: difference in differences %, expected control % and systolic %', v_x, v_exp_ctl, v_exp_sys;
  end if;
  if not ((v_x #>> '{control,low}')::numeric < (v_x #>> '{control,difference}')::numeric and (v_x #>> '{control,difference}')::numeric < (v_x #>> '{control,high}')::numeric) then
    raise exception 'FAIL 4j: the interval does not bracket the estimate';
  end if;
  -- by points, earners (high + mid) versus non-earners (low, even though six of them hold a screening award)
  select avg(y) filter (where grp in ('high', 'mid')) - avg(y) filter (where grp = 'low') into v_exp_hb from (
      select g.grp, (d.bp_status = 'controlled')::integer - (z.bp_status = 'controlled')::integer as y
        from fxg g join public.outcome_snapshots d on d.patient_id = g.patient and d.day = 90 and d.pathway_code = 'bp'
                   join public.outcome_snapshots z on z.patient_id = g.patient and z.day = 0 and z.pathway_code = 'bp' where g.org = v_orgA and g.grp in ('high', 'mid', 'low')) t;
  v_x := v_rep #> '{panels,comparison,cohorts,hypertension,points,difference_in_differences}';
  if not (v_x #>> '{control,available}')::boolean or abs((v_x #>> '{control,difference}')::numeric - v_exp_hb) > 0.0011 then raise exception 'FAIL 4k: points comparison % (expected %)', v_x, v_exp_hb; end if;
  select count(*) into v_cnt from jsonb_array_elements(v_rep #> '{panels,comparison,cohorts,hypertension,points,groups}') g where (g ->> 'group') = 'non_earners' and (g ->> 'people_measured_at_both_ends')::integer = 36;
  if v_cnt <> 1 then raise exception 'FAIL 4l: a screening award made someone a points earner, or the earner split is wrong'; end if;
  -- HbA1c, high versus low
  select avg(change_abs) filter (where grp = 'high') - avg(change_abs) filter (where grp = 'low') into v_exp_hb
    from fxg g join public.outcome_measure_snapshots h on h.patient_id = g.patient and h.measure_code = 'hba1c' and h.day = 90 where g.org = v_orgA and g.grp in ('high', 'low');
  v_x := v_rep #> '{panels,comparison,cohorts,diabetes,engagement,difference_in_differences,hba1c}';
  if not (v_x ->> 'available')::boolean or abs((v_x ->> 'difference')::numeric - v_exp_hb) > 0.0011 then raise exception 'FAIL 4m: HbA1c difference in differences % (expected %)', v_x, v_exp_hb; end if;
  -- the pre-period is the same people's day 0, and blood pressure readings are said to be left out of engagement
  if (v_rep #>> '{panels,comparison,pre_period}') <> 'day_0_same_people' or not (v_rep #>> '{panels,comparison,engagement_excludes_blood_pressure_readings}')::boolean then raise exception 'FAIL 4n: the comparison does not state its pre-period and BP exclusion'; end if;
  -- the low group logged blood pressure on 12 extra days and must still be "low" (36 of them, all in the low band)
  select count(*) into v_cnt from jsonb_array_elements(v_rep #> '{panels,comparison,cohorts,hypertension,engagement,groups}') g where (g ->> 'group') = 'low' and (g ->> 'people_measured_at_both_ends')::integer = 36;
  if v_cnt <> 1 then raise exception 'FAIL 3g: blood pressure logging lifted the low group out of "low"'; end if;

  ------------------------------------------------------------------------------------------------------------------------------------
  -- 5. SUPPRESSION (organisation B): a small cohort is withheld whole; one withheld group takes its neighbour with it; no estimate is then shown
  ------------------------------------------------------------------------------------------------------------------------------------
  select report into v_rep from public.outcomes_dashboard_reports where organisation_id = v_orgB and period_start = v_m;
  v_cell := v_rep #> '{panels,outcomes,hypertension,0,due}';
  if not (v_cell ->> 'suppressed')::boolean or (v_cell ->> 'reason') <> 'small_cell' or v_cell ? 'controlled' or v_cell ? 'uncontrolled' or v_cell ? 'rate_strict_pct' then
    raise exception 'FAIL 5a: a cohort with a small category (3 unmeasured) is not withheld whole: %', v_cell;
  end if;
  v_x := v_rep #> '{panels,comparison,cohorts,hypertension,engagement}';
  select g into v_cell from jsonb_array_elements(v_x -> 'groups') g where g ->> 'group' = 'mid';
  if not (v_cell ->> 'suppressed')::boolean or (v_cell ->> 'reason') <> 'under_minimum' or v_cell ? 'people_measured_at_both_ends' or v_cell ? 'controlled_after_pct' then
    raise exception 'FAIL 5b: the 12-person group is not withheld cleanly: %', v_cell;
  end if;
  select g into v_cell from jsonb_array_elements(v_x -> 'groups') g where g ->> 'group' = 'high';
  if not (v_cell ->> 'suppressed')::boolean or (v_cell ->> 'reason') <> 'complementary' then raise exception 'FAIL 5c: no complementary suppression, the withheld group can be recovered by subtraction: %', v_cell; end if;
  if (v_x #>> '{difference_in_differences,control,available}')::boolean or (v_x #>> '{difference_in_differences,systolic,available}')::boolean then raise exception 'FAIL 5d: an estimate was computed from a withheld group'; end if;
  -- the points split in B (earners 52, non-earners 40) is large enough on both sides and is shown
  if not (v_rep #>> '{panels,comparison,cohorts,hypertension,points,difference_in_differences,control,available}')::boolean then raise exception 'FAIL 5e: the points comparison in B should be available'; end if;
  -- the diabetes comparison in B is also computed per group (HbA1c: 40/40/12, the same neighbour rule)
  select g into v_cell from jsonb_array_elements(v_rep #> '{panels,comparison,cohorts,diabetes,engagement,groups}') g where g ->> 'group' = 'high';
  if not (v_cell ->> 'suppressed')::boolean then raise exception 'FAIL 5f: the HbA1c groups did not apply the neighbour rule'; end if;
  -- no figure in a withheld cell: scan every withheld object for a number
  if exists (select 1 from jsonb_path_query(v_rep, '$.** ? (@.suppressed == true)') s where s ?| array['n', 'count', 'people', 'mean', 'difference', 'controlled', 'reached']
             and not (s ->> 'reason' in ('small_cell') and s ? 'n')) then
    raise exception 'FAIL 5g: a withheld cell carries a figure';
  end if;

  ------------------------------------------------------------------------------------------------------------------------------------
  -- 6. HELD BACK (organisation A): ten people newly due since last month are fewer than the floor, so the cutoff does not move
  ------------------------------------------------------------------------------------------------------------------------------------
  for i in 1 .. 10 loop
    v_p := pg_temp.mkuser(v_orgA, 'late-' || i, 'patient');
    insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, is_test)
      values (v_orgA, v_p, 'purchase', (((v_m1 - 85)::timestamp + time '08:00') at time zone 'Africa/Lagos'), false);
    insert into public.care_plans (organisation_id, patient_id, condition, status) values (v_orgA, v_p, 'hypertension', 'active');
    -- anchor so that the day-90 window closes five days into the current month
    insert into public.outcome_snapshots (organisation_id, patient_id, pathway_code, day, anchor_date, window_start, window_end, bp_avg_7d_sys, bp_avg_7d_dia, bp_readings_7d,
        bp_status, controlled, target_sys, target_dia, target_source, adherence_status, config_version, is_test)
      values (v_orgA, v_p, 'bp', 90, v_m1 + 5 - 90, v_m1 - 1, v_m1 + 5, 130, 80, 5, 'controlled', true, 140, 90, 'default', 'no_doses', (select version from public.outcome_config where is_active), false);
  end loop;
  v_id := private.run_outcomes_dashboard(v_orgA, v_m1, null);
  select held_back, data_cutoff into v_ok, v_cut from public.outcomes_dashboard_reports where id = v_id;
  if not v_ok or v_cut <> (v_m1 - 1) then raise exception 'FAIL 6a: ten newly due people did not hold the report back (held %, cutoff %)', v_ok, v_cut; end if;
  if (select report #>> '{panels,outcomes,hypertension,0,due,n}' from public.outcomes_dashboard_reports where id = v_id)::integer <> 108 then
    raise exception 'FAIL 6b: a held-back report counted the newly due people';
  end if;

  ------------------------------------------------------------------------------------------------------------------------------------
  -- 7b. THE RECORD: aggregate-only, never publishable, permanent
  ------------------------------------------------------------------------------------------------------------------------------------
  v_id := (select id from public.outcomes_dashboard_reports where organisation_id = v_orgA and period_start = v_m);
  if pg_temp.try(format($q$insert into public.outcomes_dashboard_reports (organisation_id, period_start, period_end, data_cutoff, config_version, has_data, is_baseline, report, publishable)
       values (%L, '2020-01-01', '2020-02-01', '2020-01-31', 1, false, false, '{}', true)$q$, v_orgA)) <> '23514' then raise exception 'FAIL 7l: a publishable report could be inserted'; end if;
  if pg_temp.try(format($q$insert into public.outcomes_dashboard_reports (organisation_id, period_start, period_end, data_cutoff, config_version, has_data, is_baseline, report, internal_only)
       values (%L, '2020-01-01', '2020-02-01', '2020-01-31', 1, false, false, '{}', false)$q$, v_orgA)) <> '23514' then raise exception 'FAIL 7m: a report not marked internal could be inserted'; end if;
  if pg_temp.try(format('update public.outcomes_dashboard_reports set has_data = false where id = %L', v_id)) <> '42501' then raise exception 'FAIL 7n: a report could be edited'; end if;
  if pg_temp.try(format('delete from public.outcomes_dashboard_reports where id = %L', v_id)) <> '42501' then raise exception 'FAIL 7o: a report could be deleted'; end if;
  if pg_temp.try_as(v_adminA, format('select public.run_outcomes_dashboard_now(%L)', v_m)) <> 'ok' then raise exception 'FAIL 7p: the super admin could not run a finished month'; end if;
  if (select count(*) from public.outcomes_dashboard_reports where organisation_id = v_orgA and period_start = v_m) <> 1 then raise exception 'FAIL 7q: the admin run duplicated the report'; end if;

  ------------------------------------------------------------------------------------------------------------------------------------
  -- 8. STATIC: nobody compares a count with the minimum by hand; nobody reads a protected table
  ------------------------------------------------------------------------------------------------------------------------------------
  if exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
               and (p.proname like 'outcomes_dash%' or p.proname like '%outcomes_dashboard%')
               and p.prosrc ~* '(between 1 and|>= *v_min\M|< *v_min\M|< *v_floor\M|>= *v_floor\M|< *v_thr\M|>= *v_thr\M|min_cohort_size|outcome_rule\(''min_cell)') then
    raise exception 'FAIL 8a: a dashboard function compares a count with the minimum by hand or reads the minimum itself: %',
      (select string_agg(p.proname, ', ') from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and (p.proname like 'outcomes_dash%' or p.proname like '%outcomes_dashboard%')
         and p.prosrc ~* '(between 1 and|>= *v_min\M|< *v_min\M|< *v_floor\M|>= *v_floor\M|< *v_thr\M|>= *v_thr\M|min_cohort_size|outcome_rule\(''min_cell)');
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
               and (p.proname like 'outcomes_dash%' or p.proname like '%outcomes_dashboard%')
               and p.prosrc ~* '(mental_health_screens|outcome_mh_snapshots|phq|gad7|menstrual_|reproductive_health_profiles|patient_pregnancy|patient_postnatal|contraception|fertility_)') then
    raise exception 'FAIL 8b: a dashboard function names a protected-category table';
  end if;
  if not exists (select 1 from pg_proc p where p.proname = 'outcomes_dash_engagement' and p.prosrc ~ 'suppress_(cell|groups)|min_cell_floor') then raise exception 'FAIL 8c: the engagement panel does not use the shared minimum rule'; end if;

  ------------------------------------------------------------------------------------------------------------------------------------
  -- SABOTAGE: each fix is undone once; the check that depends on it must flip
  ------------------------------------------------------------------------------------------------------------------------------------
  -- (a) the minimum lowered to 5: org B's 12-person group must now show (and the neighbour must no longer be taken with it)
  update public.outcome_config set config = config || jsonb_build_object('min_cell', 5, 'min_cell_cross', 5) where is_active;
  update public.outcomes_dashboard_config set config = jsonb_set(config, '{comparison,min_per_group}', '5') where is_active;
  v_x := (private.outcomes_dash_comparison(v_orgB, v_m1 - 1, private.outcomes_dash_cfg())) #> '{cohorts,hypertension,engagement,groups}';
  select g into v_cell from jsonb_array_elements(v_x) g where g ->> 'group' = 'mid';
  if (v_cell ->> 'suppressed')::boolean then raise exception 'VACUOUS TEST (a): with the minimum lowered to 5 the 12-person group was still withheld'; end if;
  update public.outcome_config set config = config || jsonb_build_object('min_cell', 20, 'min_cell_cross', 30) where is_active;
  update public.outcomes_dashboard_config set config = jsonb_set(config, '{comparison,min_per_group}', '30') where is_active;

  -- (b) the test accounts counted as real: organisation A's due cohort must grow from 108
  alter table public.outcome_snapshots disable trigger outcome_snapshots_append_only;
  update public.profiles set is_test = false where id in (select patient from fxg where org = v_orgA and grp = 'test');
  update public.outcome_snapshots set is_test = false where patient_id in (select patient from fxg where org = v_orgA and grp = 'test');
  if (select count(*) from private.outcomes_dash_due(v_orgA, 90, v_m1 - 1, private.outcomes_dash_cfg())) <= 108 then raise exception 'VACUOUS TEST (b): clearing the test flag did not change the count'; end if;
  update public.profiles set is_test = true where id in (select patient from fxg where org = v_orgA and grp = 'test');
  update public.outcome_snapshots set is_test = true where patient_id in (select patient from fxg where org = v_orgA and grp = 'test');
  alter table public.outcome_snapshots enable trigger outcome_snapshots_append_only;

  -- (c) blood pressure allowed into engagement: the 36 low-group people (12 extra days each) must leave "low"
  select count(*) into v_cnt from private.outcomes_dash_people(v_orgA, 90, v_m1 - 1, private.outcomes_dash_cfg()) where active_days * 30.0 / 90 <= 4;
  v_c := v_cnt;
  select count(*) into v_cnt from private.outcomes_dash_people(v_orgA, 90, v_m1 - 1, jsonb_set(private.outcomes_dash_cfg(), '{comparison,exclude_blood_pressure_from_engagement}', 'false')) where active_days * 30.0 / 90 <= 4;
  if v_cnt >= v_c then raise exception 'VACUOUS TEST (c): letting blood pressure count did not move anyone out of the low band (% vs %)', v_cnt, v_c; end if;

  -- (d) the held-back difference rule neutered: the next month's report (still ten newly due) must NOT be held back
  v_def := pg_get_functiondef('private.suppress_difference(bigint,bigint,integer)'::regprocedure);
  execute 'create or replace function private.suppress_difference(p_whole bigint, p_part bigint, p_min integer default null) returns boolean language sql as ''select false''';
  v_id := private.run_outcomes_dashboard(v_orgA, v_m2, null);
  execute v_def;
  if (select held_back from public.outcomes_dashboard_reports where id = v_id) then raise exception 'VACUOUS TEST (d): with the difference rule neutered the report was still held back'; end if;

  -- (e) the publishable CHECK dropped
  alter table public.outcomes_dashboard_reports drop constraint outcomes_dashboard_reports_publishable_check;
  if pg_temp.try(format($q$insert into public.outcomes_dashboard_reports (organisation_id, period_start, period_end, data_cutoff, config_version, has_data, is_baseline, report, publishable)
       values (%L, '2020-01-01', '2020-02-01', '2020-01-31', 1, false, false, '{}', true)$q$, v_orgA)) <> 'ok' then raise exception 'VACUOUS TEST (e): with the CHECK dropped a publishable report was still refused'; end if;
  -- (f) the immutability trigger dropped
  drop trigger outcomes_dashboard_reports_00_immutable on public.outcomes_dashboard_reports;
  if pg_temp.try(format('update public.outcomes_dashboard_reports set has_data = false where id = %L', v_id)) <> 'ok' then raise exception 'VACUOUS TEST (f): with the trigger dropped a report was still refused'; end if;

  -- (g) the admin gate opened for everybody: a patient must get in
  execute 'create or replace function private.is_admin() returns boolean language sql stable as ''select true''';
  if pg_temp.try_as(v_pat, 'select public.read_outcomes_dashboard(1)') <> 'ok' then raise exception 'VACUOUS TEST (g): with the admin gate opened a patient was still refused'; end if;

  raise notice 'PASS: outcomes dashboard: role matrix and audited doors, three separate panels, exclusions, numbers equal the recomputation, suppression with neighbours, held-back cutoff, loud monthly job, permanent record, static scans';
end $$;

rollback;
