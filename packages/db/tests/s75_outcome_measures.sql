-- ===========================================================================
-- Proof: 20261007160003_s75_outcome_measures_hba1c_weight_phq9_gad7.sql (S75 track D, CMO decision S-5; INV-10, INV-12, INV-13, INV-16).
--
--   1. DORMANT UNTIL ACTIVATED: outcome_config v3 is inserted inactive and the active row is still v2; the measure job writes nothing and the
--      measure reports refuse while v3 is inactive. The proof activates v3 only inside this transaction.
--   2. HbA1c: exact values, change from baseline, the 7.0 percent line (7.0 itself is not below), the care-plan target, a baseline outside
--      the window is missing (stored as insufficient, never "not reached"), a unit that is not percent is ignored.
--   3. Weight: exact percent change, the 5 percent line (exactly 5.00 counts), adults only, a reading waiting for validation is not used.
--   4. PHQ-9 and GAD-7: total scores only; response is a fall of 50 percent or more (exactly 50 counts); remission is below 5; a baseline
--      under 5 is not applicable; no follow-up is insufficient. Item answers (item 9) are never read: no function in the path names them.
--   5. Test accounts are in no report and no analytics row (INV-13). Cells under the minimum, and a small cell next to a large one, are withheld.
--   6. Append-only, config_version recorded (INV-16), idempotent.
--   7. ROLE MATRIX. Aggregate reports: admin, analyst and the CMO yes; a clinician, a patient, every sponsor role (hmo_admin,
--      corporate_admin, ngo_admin, payer_admin, provider_org_staff) and anon refused. Mental health row access: only the patient themself
--      (any other signed-in role reads zero rows); the audited clinician function needs a real tie, a reason and an active clinician.
--   8. No view, analytics object or sponsor function references the mental health table.
--   9. BP at day 180: exact figures from S38's own snapshots; day 90 is unchanged; the BP rules are not touched.
--  10. SABOTAGE: the analyst gate opened to everyone (a sponsor then reads the report), a permissive policy added to the mental health table
--      (a sponsor then reads rows), the test-account filter dropped from the analytics view, the append-only trigger dropped, and a function that
--      reads item answers (the scan must catch it); every one of these checks must flip.
--
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;

create temp table results (check_name text, expected text, actual text, verdict text);
grant all on results to public;
create temp table fx (k text primary key, v uuid);
grant all on fx to public;

create function pg_temp.chk(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_name, p_expected, p_actual, case when p_expected is not distinct from p_actual then 'PASS' else 'FAIL' end) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a statement as a user; 'ok' or the SQLSTATE
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a query returning one jsonb as a user; the jsonb, or {"err": sqlstate}
create function pg_temp.json_as(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := jsonb_build_object('err', sqlstate); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.count_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;

-- Lagos noon on a date
create function pg_temp.at_day(d date) returns timestamptz language sql as $$ select (d::timestamp + interval '12 hours') at time zone 'Africa/Lagos' $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Africa/Lagos')::date $$;

create function pg_temp.mkuser(p_label text, p_role text, p_test boolean default false, p_dob date default null) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's75-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, v_org, p_role::public.user_role, 'S75 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          coalesce(p_dob, (current_date - interval '45 years')::date), p_test)
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone;
  return v;
end $f$;

-- a member who joined 220 days ago (so every day, 180 included, has closed with its grace), plus any rows the caller adds
create function pg_temp.mkmember(p_label text, p_test boolean default false, p_dob date default null) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_label, 'patient', p_test, p_dob); v_org uuid := (select organisation_id from public.profiles where id = v);
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at) values (v_org, v, 'purchase', pg_temp.at_day(pg_temp.today() - 220));
  return v;
end $f$;
create function pg_temp.anchor() returns date language sql as $$ select pg_temp.today() - 220 $$;
create function pg_temp.lab(p uuid, p_value numeric, p_offset integer, p_unit text default 'percent') returns void language sql as
$$ insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
   values ((select organisation_id from public.profiles where id = p), p, 'hba1c', p_value, p_unit, pg_temp.at_day(pg_temp.anchor() + p_offset)) $$;
create function pg_temp.wt(p uuid, p_kg numeric, p_offset integer) returns void language sql as
$$ insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
   values ((select organisation_id from public.profiles where id = p), p, 'weight', p_kg, pg_temp.at_day(pg_temp.anchor() + p_offset), 'manual') $$;
create function pg_temp.screen(p uuid, p_instr text, p_score integer, p_offset integer, p_items jsonb default '{}'::jsonb) returns void language sql as
$$ insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, item_responses, created_at)
   values ((select organisation_id from public.profiles where id = p), p, p_instr, p_score, 'minimal', p_items, pg_temp.at_day(pg_temp.anchor() + p_offset)) $$;
create function pg_temp.row_of(p_table text, p uuid, p_measure text, p_day integer) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  if p_table = 'm' then
    select to_jsonb(s) into r from public.outcome_measure_snapshots s where patient_id = p and measure_code = p_measure and day = p_day;
  else
    select to_jsonb(s) into r from public.outcome_mh_snapshots s where patient_id = p and instrument = p_measure and day = p_day;
  end if;
  return r;
end $f$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 0. Fixtures
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  admin_ uuid; analyst_ uuid; cmo_ uuid; clin_ uuid; clin2_ uuid; pat_ uuid;
  hmo_ uuid; corp_ uuid; ngo_ uuid; payer_ uuid; prov_ uuid;
  h1 uuid; h2 uuid; h3 uuid; h4 uuid; h5 uuid; h6 uuid; ht uuid;
  w1 uuid; w2 uuid; w3 uuid; w4 uuid; w5 uuid; wt_ uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m6 uuid; m7 uuid; m8 uuid; mt uuid;
  b uuid; i integer;
begin
  admin_ := pg_temp.mkuser('admin', 'admin'); analyst_ := pg_temp.mkuser('analyst', 'analyst');
  cmo_ := pg_temp.mkuser('cmo', 'clinician'); clin_ := pg_temp.mkuser('clin', 'clinician'); clin2_ := pg_temp.mkuser('clin2', 'clinician');
  pat_ := pg_temp.mkuser('stranger', 'patient');
  hmo_ := pg_temp.mkuser('hmo', 'hmo_admin'); corp_ := pg_temp.mkuser('corp', 'corporate_admin'); ngo_ := pg_temp.mkuser('ngo', 'ngo_admin');
  payer_ := pg_temp.mkuser('payer', 'payer_admin'); prov_ := pg_temp.mkuser('prov', 'provider_org_staff');
  perform pg_temp.setf('admin', admin_); perform pg_temp.setf('analyst', analyst_); perform pg_temp.setf('cmo', cmo_); perform pg_temp.setf('clin', clin_);
  perform pg_temp.setf('clin2', clin2_); perform pg_temp.setf('stranger', pat_); perform pg_temp.setf('hmo', hmo_); perform pg_temp.setf('corp', corp_);
  perform pg_temp.setf('ngo', ngo_); perform pg_temp.setf('payer', payer_); perform pg_temp.setf('prov', prov_);

  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  select v_org, x.p, 'S75 ' || x.l, 'MDCN', 'S75-' || x.l || '-' || substr(x.p::text, 1, 8), true, 'active', now(), admin_, x.tier::public.doctor_tier, 'contracted', 2, true, admin_, true
    from (values (cmo_, 'cmo', 'chief_medical_officer'), (clin_, 'clin', 'senior_medical_officer'), (clin2_, 'clin2', 'senior_medical_officer')) x(p, l, tier);

  set local session_replication_role = replica;

  -- HbA1c. H1: 9.2 before joining, 6.8 at day 90, 7.4 at day 180 with a care-plan target of 7.5. H2: 8.0 then 7.5, nothing at day 180.
  -- H3: a baseline 120 days before joining (outside the window), 6.5 at day 90. H4: a target row only. H5: a result in the wrong unit.
  -- H6: exactly 7.0 at day 90 (not below 7.0). HT: a test account with H1's data.
  h1 := pg_temp.mkmember('h1'); perform pg_temp.lab(h1, 9.2, -10); perform pg_temp.lab(h1, 6.8, 92); perform pg_temp.lab(h1, 7.4, 175);
  insert into public.patient_glucose_targets (organisation_id, patient_id, category, hba1c_target_percent) values (v_org, h1, 'standard', 7.5);
  h2 := pg_temp.mkmember('h2'); perform pg_temp.lab(h2, 8.0, 3); perform pg_temp.lab(h2, 7.5, 80);
  h3 := pg_temp.mkmember('h3'); perform pg_temp.lab(h3, 8.5, -120); perform pg_temp.lab(h3, 6.5, 90);
  h4 := pg_temp.mkmember('h4'); insert into public.patient_glucose_targets (organisation_id, patient_id, category) values (v_org, h4, 'standard');
  h5 := pg_temp.mkmember('h5'); perform pg_temp.lab(h5, 48, 1, 'mmol/mol');
  h6 := pg_temp.mkmember('h6'); perform pg_temp.lab(h6, 8.0, 0); perform pg_temp.lab(h6, 7.0, 90);
  ht := pg_temp.mkmember('ht', true); perform pg_temp.lab(ht, 9.2, -10); perform pg_temp.lab(ht, 6.8, 92);

  -- Weight. W1: 100 then 98 (day 30), 94 (day 90), 93 (day 180). W2: 80 then 79. W3: a child. W4: 90 then a day-90 reading waiting for validation.
  -- W5: 100 then exactly 95. WT: a test account.
  w1 := pg_temp.mkmember('w1'); perform pg_temp.wt(w1, 100, 1); perform pg_temp.wt(w1, 98, 31); perform pg_temp.wt(w1, 94, 90); perform pg_temp.wt(w1, 93, 181);
  w2 := pg_temp.mkmember('w2'); perform pg_temp.wt(w2, 80, 0); perform pg_temp.wt(w2, 79, 95);
  w3 := pg_temp.mkmember('w3', false, (current_date - interval '10 years')::date); perform pg_temp.wt(w3, 30, 1); perform pg_temp.wt(w3, 33, 90);
  w4 := pg_temp.mkmember('w4'); perform pg_temp.wt(w4, 90, 2); perform pg_temp.wt(w4, 80, 90);
  update public.vitals_readings set validation_status = 'requires_validation', validation_flags = array['sudden_change'] where patient_id = w4 and weight_kg = 80;
  w5 := pg_temp.mkmember('w5'); perform pg_temp.wt(w5, 100, 1); perform pg_temp.wt(w5, 95, 90);
  wt_ := pg_temp.mkmember('wt', true); perform pg_temp.wt(wt_, 100, 1); perform pg_temp.wt(wt_, 90, 90);

  -- PHQ-9 and GAD-7 (total scores; M3's baseline also carries an item 9 answer that nothing may read).
  m1 := pg_temp.mkmember('m1'); perform pg_temp.screen(m1, 'phq9', 15, 2); perform pg_temp.screen(m1, 'phq9', 12, 30); perform pg_temp.screen(m1, 'phq9', 6, 90); perform pg_temp.screen(m1, 'phq9', 3, 180);
  perform pg_temp.screen(m1, 'gad7', 10, 1); perform pg_temp.screen(m1, 'gad7', 8, 90);
  m2 := pg_temp.mkmember('m2'); perform pg_temp.screen(m2, 'phq9', 4, 1); perform pg_temp.screen(m2, 'phq9', 2, 90);
  m3 := pg_temp.mkmember('m3'); perform pg_temp.screen(m3, 'phq9', 20, 1, '{"9": 3}'::jsonb); perform pg_temp.screen(m3, 'phq9', 10, 90);
  m4 := pg_temp.mkmember('m4'); perform pg_temp.screen(m4, 'phq9', 12, 1);
  m5 := pg_temp.mkmember('m5'); perform pg_temp.screen(m5, 'phq9', 12, 1); perform pg_temp.screen(m5, 'phq9', 4, 90);
  m6 := pg_temp.mkmember('m6'); perform pg_temp.screen(m6, 'phq9', 12, 1); perform pg_temp.screen(m6, 'phq9', 11, 90);
  m7 := pg_temp.mkmember('m7'); perform pg_temp.screen(m7, 'phq9', 12, 2);
  m8 := pg_temp.mkmember('m8'); perform pg_temp.screen(m8, 'phq9', 14, 1); perform pg_temp.screen(m8, 'phq9', 13, 90);
  mt := pg_temp.mkmember('mt', true); perform pg_temp.screen(mt, 'phq9', 20, 1); perform pg_temp.screen(mt, 'phq9', 4, 90);

  -- BP snapshots S38 would have written (config v2): day 0 and day 180. B1 uncontrolled then controlled; B2 uncontrolled twice; B3 controlled twice;
  -- B4 insufficient at 180; B5 uncontrolled then insufficient; B6 uncontrolled twice; BT a test account.
  for i in 1..7 loop
    b := pg_temp.mkmember('b' || i, i = 7);
    perform pg_temp.setf('b' || i, b);
    insert into public.outcome_snapshots (organisation_id, patient_id, pathway_code, day, anchor_date, window_start, window_end, bp_avg_7d_sys, bp_avg_7d_dia, bp_readings_7d,
        bp_status, controlled, target_sys, target_dia, target_source, config_version, is_test)
    select v_org, b, 'bp', d.day, pg_temp.anchor(), pg_temp.anchor() + d.day, pg_temp.anchor() + d.day + 6,
           case when st = 'insufficient_data' then null else case when st = 'controlled' then 128 else 158 end end,
           case when st = 'insufficient_data' then null else case when st = 'controlled' then 80 else 98 end end,
           case when st = 'insufficient_data' then 1 else 5 end, st,
           case st when 'controlled' then true when 'uncontrolled' then false else null end, 140, 90, 'default', 2, i = 7
      from (values (0), (180)) d(day),
           lateral (select case
             when i = 1 and d.day = 0 then 'uncontrolled' when i = 1 then 'controlled'
             when i = 2 then 'uncontrolled'
             when i = 3 then 'controlled'
             when i = 4 and d.day = 0 then 'controlled' when i = 4 then 'insufficient_data'
             when i = 5 and d.day = 0 then 'uncontrolled' when i = 5 then 'insufficient_data'
             when i = 6 then 'uncontrolled'
             else 'controlled' end as st) s;
  end loop;

  perform pg_temp.setf('h1', h1); perform pg_temp.setf('h2', h2); perform pg_temp.setf('h3', h3); perform pg_temp.setf('h4', h4);
  perform pg_temp.setf('h5', h5); perform pg_temp.setf('h6', h6); perform pg_temp.setf('ht', ht);
  perform pg_temp.setf('w1', w1); perform pg_temp.setf('w2', w2); perform pg_temp.setf('w3', w3); perform pg_temp.setf('w4', w4); perform pg_temp.setf('w5', w5); perform pg_temp.setf('wt', wt_);
  perform pg_temp.setf('m1', m1); perform pg_temp.setf('m2', m2); perform pg_temp.setf('m3', m3); perform pg_temp.setf('m4', m4); perform pg_temp.setf('m5', m5);
  perform pg_temp.setf('m6', m6); perform pg_temp.setf('m7', m7); perform pg_temp.setf('m8', m8); perform pg_temp.setf('mt', mt);
  set local session_replication_role = origin;

  -- the tie: clin_ is on the care team of M1 and M3; clin2_ is tied to nobody
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, m1, clin_, now()), (v_org, m3, clin_, now());
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Dormant until activated
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_n integer; v_cnt integer;
begin
  perform pg_temp.chk('1a v3 is inserted inactive and unsigned-by-code; the active row is still v2',
    'false|2', (select is_active::text from public.outcome_config where version = 3) || '|' || (select version::text from public.outcome_config where is_active));
  perform pg_temp.chk('1a2 v3 carries the measures block and v2 does not', 'true|false',
    (select (config ? 'measures')::text from public.outcome_config where version = 3) || '|' || (select (config ? 'measures')::text from public.outcome_config where version = 2));
  perform pg_temp.chk('1a3 v3 is v2 plus the measures block: every S38 rule (days, windows, grace, target, min cells) is identical, so activating it changes no BP rule',
    'true', ((select config - 'measures' - 'bp_report_days' from public.outcome_config where version = 3) = (select config from public.outcome_config where version = 2))::text);
  v_n := private.compute_outcome_measure_snapshots(now());
  select (select count(*) from public.outcome_measure_snapshots) + (select count(*) from public.outcome_mh_snapshots) into v_cnt;
  perform pg_temp.chk('1b the job writes nothing while v3 is inactive', '0/0', v_n || '/' || v_cnt);
  perform pg_temp.chk('1c the measure report refuses while v3 is inactive (22023)', '22023', pg_temp.try_as(pg_temp.f('admin'), $q$ select public.outcome_measures_report('hba1c', 90) $q$));
  perform pg_temp.chk('1d the mental health report refuses while v3 is inactive (22023)', '22023', pg_temp.try_as(pg_temp.f('admin'), $q$ select public.mental_health_outcome_report('phq9', 90) $q$));
end $$;

-- the CMO act, done here inside the transaction only
update public.outcome_config set is_active = false where version = 2;
update public.outcome_config set is_active = true where version = 3;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. Compute under v3
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_n integer; v_n2 integer; r jsonb;
begin
  v_n := private.compute_outcome_measure_snapshots(now());
  v_n2 := private.compute_outcome_measure_snapshots(now());
  perform pg_temp.chk('2a the job writes rows under v3 and a second run writes none', 'true/0', (v_n > 0)::text || '/' || v_n2);
  perform pg_temp.chk('2b every row records config_version 3 (INV-16)', '0', (select (
      (select count(*) from public.outcome_measure_snapshots where config_version <> 3) + (select count(*) from public.outcome_mh_snapshots where config_version <> 3)))::text);

  -- HbA1c
  r := pg_temp.row_of('m', pg_temp.f('h1'), 'hba1c', 0);
  perform pg_temp.chk('2c H1 day 0: baseline 9.2, a baseline row, goal not reached (9.2 is over 7.5)', '9.20/baseline/not_reached', (r ->> 'value') || '/' || (r ->> 'change_status') || '/' || (r ->> 'goal_status'));
  r := pg_temp.row_of('m', pg_temp.f('h1'), 'hba1c', 90);
  perform pg_temp.chk('2d H1 day 90: 6.80, change -2.40, goal reached, baseline kept', '6.80/-2.40/reached/9.20', (r ->> 'value') || '/' || (r ->> 'change_abs') || '/' || (r ->> 'goal_status') || '/' || (r ->> 'baseline_value'));
  r := pg_temp.row_of('m', pg_temp.f('h1'), 'hba1c', 180);
  perform pg_temp.chk('2e H1 day 180: 7.4 is not under 7.0 but is at her care-plan target 7.5: reached, source care_plan', '7.40/reached/care_plan/7.5', (r ->> 'value') || '/' || (r ->> 'goal_status') || '/' || (r ->> 'target_source') || '/' || (r ->> 'target_value'));
  r := pg_temp.row_of('m', pg_temp.f('h2'), 'hba1c', 90);
  perform pg_temp.chk('2f H2 day 90: 7.5 with no target is not under 7.0: not reached, change -0.50, guideline source', 'not_reached/-0.50/guideline', (r ->> 'goal_status') || '/' || (r ->> 'change_abs') || '/' || (r ->> 'target_source'));
  r := pg_temp.row_of('m', pg_temp.f('h2'), 'hba1c', 180);
  perform pg_temp.chk('2g H2 day 180: no result: insufficient, never "not reached"', 'insufficient_data/insufficient_data/', (r ->> 'goal_status') || '/' || (r ->> 'change_status') || '/' || coalesce(r ->> 'value', ''));
  r := pg_temp.row_of('m', pg_temp.f('h3'), 'hba1c', 0);
  perform pg_temp.chk('2h H3 day 0: a baseline 120 days before joining is outside the 90-day window: insufficient', 'insufficient_data', r ->> 'change_status');
  r := pg_temp.row_of('m', pg_temp.f('h3'), 'hba1c', 90);
  perform pg_temp.chk('2i H3 day 90: 6.5 reached the goal but with no baseline the change is insufficient', 'reached/insufficient_data', (r ->> 'goal_status') || '/' || (r ->> 'change_status'));
  r := pg_temp.row_of('m', pg_temp.f('h4'), 'hba1c', 90);
  perform pg_temp.chk('2j H4 (target row only, no result): in the measure, all insufficient', 'insufficient_data/insufficient_data', (r ->> 'goal_status') || '/' || (r ->> 'change_status'));
  r := pg_temp.row_of('m', pg_temp.f('h5'), 'hba1c', 0);
  perform pg_temp.chk('2k H5: a result in mmol/mol is not used as a percentage', 'insufficient_data', r ->> 'change_status');
  r := pg_temp.row_of('m', pg_temp.f('h6'), 'hba1c', 90);
  perform pg_temp.chk('2l H6: exactly 7.0 is not below 7.0', 'not_reached/-1.00', (r ->> 'goal_status') || '/' || (r ->> 'change_abs'));
  perform pg_temp.chk('2m no day-30 HbA1c row exists (the config lists 0, 90, 180)', '0', (select count(*) from public.outcome_measure_snapshots where measure_code = 'hba1c' and day = 30)::text);

  -- weight
  r := pg_temp.row_of('m', pg_temp.f('w1'), 'weight', 30);
  perform pg_temp.chk('2n W1 day 30: 98 from 100 is -2.00 percent: not reached', '-2.00/not_reached', (r ->> 'change_pct') || '/' || (r ->> 'goal_status'));
  r := pg_temp.row_of('m', pg_temp.f('w1'), 'weight', 90);
  perform pg_temp.chk('2o W1 day 90: 94 from 100 is -6.00 percent and -6.00 kg: reached', '-6.00/-6.00/reached', (r ->> 'change_pct') || '/' || (r ->> 'change_abs') || '/' || (r ->> 'goal_status'));
  r := pg_temp.row_of('m', pg_temp.f('w2'), 'weight', 90);
  perform pg_temp.chk('2p W2 day 90: 79 from 80 is -1.25 percent: not reached', '-1.25/not_reached', (r ->> 'change_pct') || '/' || (r ->> 'goal_status'));
  perform pg_temp.chk('2q W3 (a child) has no weight rows at all', '0', (select count(*) from public.outcome_measure_snapshots where patient_id = pg_temp.f('w3'))::text);
  r := pg_temp.row_of('m', pg_temp.f('w4'), 'weight', 90);
  perform pg_temp.chk('2r W4: the day-90 reading is waiting for validation and is not used: insufficient', 'insufficient_data/insufficient_data', (r ->> 'goal_status') || '/' || (r ->> 'change_status'));
  r := pg_temp.row_of('m', pg_temp.f('w5'), 'weight', 90);
  perform pg_temp.chk('2s W5: exactly -5.00 percent counts as reached', '-5.00/reached', (r ->> 'change_pct') || '/' || (r ->> 'goal_status'));
  r := pg_temp.row_of('m', pg_temp.f('w1'), 'weight', 0);
  perform pg_temp.chk('2t weight day 0 is a baseline row with no goal to judge', 'baseline/not_applicable/100.00', (r ->> 'change_status') || '/' || (r ->> 'goal_status') || '/' || (r ->> 'baseline_value'));

  -- never "not reached" without a value to judge
  perform pg_temp.chk('2u no row says not_reached while having no value, in either direction', '0',
    (select count(*) from public.outcome_measure_snapshots where value is null and goal_status in ('reached', 'not_reached'))::text);

  -- mental health
  r := pg_temp.row_of('h', pg_temp.f('m1'), 'phq9', 90);
  perform pg_temp.chk('2w M1 PHQ-9 day 90: 15 to 6 is a 60 percent fall: response; 6 is not below 5: not remitted; change -9', 'response/not_remitted/-9', (r ->> 'response_status') || '/' || (r ->> 'remission_status') || '/' || (r ->> 'change'));
  r := pg_temp.row_of('h', pg_temp.f('m1'), 'phq9', 180);
  perform pg_temp.chk('2x M1 PHQ-9 day 180: 3 is a response and a remission', 'response/remitted', (r ->> 'response_status') || '/' || (r ->> 'remission_status'));
  r := pg_temp.row_of('h', pg_temp.f('m1'), 'phq9', 30);
  perform pg_temp.chk('2y M1 PHQ-9 day 30: 12 from 15 is a 20 percent fall: no response', 'no_response/not_remitted', (r ->> 'response_status') || '/' || (r ->> 'remission_status'));
  r := pg_temp.row_of('h', pg_temp.f('m1'), 'gad7', 90);
  perform pg_temp.chk('2z M1 GAD-7 day 90: 10 to 8 is a 20 percent fall: no response, not remitted', 'no_response/not_remitted', (r ->> 'response_status') || '/' || (r ->> 'remission_status'));
  r := pg_temp.row_of('h', pg_temp.f('m2'), 'phq9', 90);
  perform pg_temp.chk('2za M2: a baseline of 4 is under 5: neither response nor remission applies', 'not_applicable/not_applicable', (r ->> 'response_status') || '/' || (r ->> 'remission_status'));
  r := pg_temp.row_of('h', pg_temp.f('m3'), 'phq9', 90);
  perform pg_temp.chk('2zb M3: 20 to 10 is exactly a 50 percent fall: response (item answers were never read)', 'response/not_remitted', (r ->> 'response_status') || '/' || (r ->> 'remission_status'));
  r := pg_temp.row_of('h', pg_temp.f('m4'), 'phq9', 90);
  perform pg_temp.chk('2zc M4: no follow-up score: insufficient, not "no response"', 'insufficient_data/insufficient_data', (r ->> 'response_status') || '/' || (r ->> 'remission_status'));
  r := pg_temp.row_of('h', pg_temp.f('m5'), 'phq9', 90);
  perform pg_temp.chk('2zd M5: 12 to 4: response and remission', 'response/remitted', (r ->> 'response_status') || '/' || (r ->> 'remission_status'));
  perform pg_temp.chk('2ze the mental health table has no column for an item answer or a crisis flag', '0',
    (select count(*) from information_schema.columns where table_name = 'outcome_mh_snapshots' and column_name ~* 'item|crisis|response_json|answer')::text);
end $$;

-- 2v, properly: the trigger refuses
do $$
begin
  begin
    update public.outcome_measure_snapshots set change_status = 'baseline' where id = (select id from public.outcome_measure_snapshots limit 1);
    perform pg_temp.chk('2v append-only: an update of a measure snapshot is refused', 'outcome_snapshots_append_only', 'updated');
  exception when others then
    perform pg_temp.chk('2v append-only: an update of a measure snapshot is refused', 'outcome_snapshots_append_only', sqlerrm);
  end;
  begin
    update public.outcome_mh_snapshots set change = 0 where id = (select id from public.outcome_mh_snapshots limit 1);
    perform pg_temp.chk('2v2 append-only: an update of a mental health snapshot is refused', 'outcome_snapshots_append_only', 'updated');
  exception when others then
    perform pg_temp.chk('2v2 append-only: an update of a mental health snapshot is refused', 'outcome_snapshots_append_only', sqlerrm);
  end;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. Reports: exact numbers with a small minimum (set inside this transaction), then the real minimum of 20
-- ---------------------------------------------------------------------------------------------------------------------------------
update public.outcome_config set config = jsonb_set(config, '{min_cell}', '2') where version = 3;

do $$
declare r jsonb; a uuid := pg_temp.f('admin');
begin
  r := pg_temp.json_as(a, $q$ select public.outcome_measures_report('hba1c', 90) $q$);
  perform pg_temp.chk('3a HbA1c day 90 (test account left out): 6 people, 2 reached, 2 not, 2 no result', '6/2/2/2', (r #>> '{cohort_all_due,n}') || '/' || (r #>> '{cohort_all_due,reached}') || '/' || (r #>> '{cohort_all_due,not_reached}') || '/' || (r #>> '{cohort_all_due,insufficient_data}'));
  perform pg_temp.chk('3b rates: strict 33.3, among those with a result 50.0, missing 33.3', '33.3/50.0/33.3', (r #>> '{cohort_all_due,rate_strict_pct}') || '/' || (r #>> '{cohort_all_due,rate_among_measured_pct}') || '/' || (r #>> '{cohort_all_due,missing_pct}'));
  perform pg_temp.chk('3c mean change among the 3 with both ends: (-2.4 - 0.5 - 1.0) / 3 = -1.30 percentage points', '3/-1.30', (r #>> '{change_among_measured,n}') || '/' || (r #>> '{change_among_measured,mean_change_percentage_points}'));
  perform pg_temp.chk('3d the report says there is no comparison group and makes no causal claim', 'none/true', (r ->> 'comparison_group') || '/' || (r ->> 'not_a_causal_claim'));
  r := pg_temp.json_as(a, $q$ select public.outcome_measures_report('weight', 90) $q$);
  perform pg_temp.chk('3e weight day 90: a group of 1 next to larger ones is withheld as a small cell', 'true/small_cell', (r #>> '{cohort_all_due,suppressed}') || '/' || (r #>> '{cohort_all_due,reason}'));
  perform pg_temp.chk('3f weight change among measured: 3 people, mean (-6 - 1.25 - 5) / 3 = -4.1 percent', '3/-4.1', (r #>> '{change_among_measured,n}') || '/' || (r #>> '{change_among_measured,mean_change_percent}'));
  r := pg_temp.json_as(a, $q$ select public.outcome_measures_report('hba1c', 30) $q$);
  perform pg_temp.chk('3g a day the config does not list for the measure is refused (22023)', '22023', r ->> 'err');
  r := pg_temp.json_as(a, $q$ select public.outcome_measures_report('phq9', 90) $q$);
  perform pg_temp.chk('3h the measure report cannot be asked for a mental health measure (22023)', '22023', r ->> 'err');
  perform pg_temp.chk('3i every report call is audited', 'true', ((select count(*) from public.audit_log where action = 'outcomes.measure_report' and actor_id = pg_temp.f('admin')) >= 2)::text);
end $$;
update public.outcome_config set config = jsonb_set(config, '{min_cell}', '20') where version = 3;
do $$
declare r jsonb;
begin
  r := pg_temp.json_as(pg_temp.f('admin'), $q$ select public.outcome_measures_report('hba1c', 90) $q$);
  perform pg_temp.chk('3j at the real minimum of 20 the same six people show nothing but "under the minimum"', 'true/under_minimum/20', (r #>> '{cohort_all_due,suppressed}') || '/' || (r #>> '{cohort_all_due,reason}') || '/' || (r ->> 'minimum_cell'));
  perform pg_temp.chk('3k and the change figure is withheld too', 'true', r #>> '{change_among_measured,suppressed}');
end $$;
update public.outcome_config set config = jsonb_set(config, '{min_cell}', '2') where version = 3;

-- mental health aggregate (admin, analyst or CMO), small minimum
do $$
declare r jsonb;
begin
  r := pg_temp.json_as(pg_temp.f('analyst'), $q$ select public.mental_health_outcome_report('phq9', 90) $q$);
  perform pg_temp.chk('3l PHQ-9 day 90 response: 7 people (the baseline-under-5 person and the test account are out), 3 responded, 2 did not, 2 no score', '7/3/2/2',
    (r #>> '{response,n}') || '/' || (r #>> '{response,reached}') || '/' || (r #>> '{response,not_reached}') || '/' || (r #>> '{response,insufficient_data}'));
  perform pg_temp.chk('3m response rates 42.9 strict, 60.0 among those with a score, 28.6 missing', '42.9/60.0/28.6', (r #>> '{response,rate_strict_pct}') || '/' || (r #>> '{response,rate_among_measured_pct}') || '/' || (r #>> '{response,missing_pct}'));
  perform pg_temp.chk('3n remission: only one person remitted, a group of 1 is withheld', 'true/small_cell', (r #>> '{remission,suppressed}') || '/' || (r #>> '{remission,reason}'));
  r := pg_temp.json_as(pg_temp.f('cmo'), $q$ select public.mental_health_outcome_report('phq9', 0) $q$);
  perform pg_temp.chk('3o day 0 is not an outcome day for mental health (22023)', '22023', r ->> 'err');
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. Test accounts (INV-13) and the analytics view
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.chk('4a test accounts do get rows, flagged is_test (so the filters have something to filter)', 'true/true/true',
    ((select count(*) from public.outcome_measure_snapshots where patient_id = pg_temp.f('ht') and is_test) > 0)::text || '/' ||
    ((select count(*) from public.outcome_measure_snapshots where patient_id = pg_temp.f('wt') and is_test) > 0)::text || '/' ||
    ((select count(*) from public.outcome_mh_snapshots where patient_id = pg_temp.f('mt') and is_test) > 0)::text);
  perform pg_temp.chk('4b the analytics view has no test account and no patient id column', '0/0',
    (select count(*) from analytics.v_outcome_measure_snapshots v join analytics.subjects s on s.subject_key = v.subject_key
       where s.patient_id in (pg_temp.f('ht'), pg_temp.f('wt')))::text || '/' ||
    (select count(*) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_outcome_measure_snapshots' and column_name in ('patient_id', 'anchor_date'))::text);
  perform pg_temp.chk('4c the analytics view carries HbA1c and weight and nothing else', 'hba1c,weight',
    (select string_agg(distinct measure_code, ',' order by measure_code) from analytics.v_outcome_measure_snapshots));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. ROLE MATRIX
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_q text := $q$ select public.outcome_measures_report('hba1c', 90) $q$;
  v_mh text := $q$ select public.mental_health_outcome_report('phq9', 90) $q$;
  v_bp text := $q$ select public.bp_control_report_day(180) $q$;
  r text;
begin
  -- aggregate reports: who may run them
  perform pg_temp.chk('5a measure report: admin, analyst and the CMO may', 'ok/ok/ok', pg_temp.try_as(pg_temp.f('admin'), v_q) || '/' || pg_temp.try_as(pg_temp.f('analyst'), v_q) || '/' || pg_temp.try_as(pg_temp.f('cmo'), v_q));
  perform pg_temp.chk('5b measure report refused: clinician, patient', '42501/42501', pg_temp.try_as(pg_temp.f('clin'), v_q) || '/' || pg_temp.try_as(pg_temp.f('stranger'), v_q));
  perform pg_temp.chk('5c measure report refused: hmo_admin, corporate_admin, ngo_admin, payer_admin, provider_org_staff', '42501/42501/42501/42501/42501',
    pg_temp.try_as(pg_temp.f('hmo'), v_q) || '/' || pg_temp.try_as(pg_temp.f('corp'), v_q) || '/' || pg_temp.try_as(pg_temp.f('ngo'), v_q) || '/' || pg_temp.try_as(pg_temp.f('payer'), v_q) || '/' || pg_temp.try_as(pg_temp.f('prov'), v_q));
  perform pg_temp.chk('5d measure report refused: anon (no execute privilege)', '42501', pg_temp.try_anon(v_q));
  perform pg_temp.chk('5e mental health report: admin, analyst and the CMO may', 'ok/ok/ok', pg_temp.try_as(pg_temp.f('admin'), v_mh) || '/' || pg_temp.try_as(pg_temp.f('analyst'), v_mh) || '/' || pg_temp.try_as(pg_temp.f('cmo'), v_mh));
  perform pg_temp.chk('5f mental health report refused: clinician, patient', '42501/42501', pg_temp.try_as(pg_temp.f('clin'), v_mh) || '/' || pg_temp.try_as(pg_temp.f('stranger'), v_mh));
  perform pg_temp.chk('5g mental health report refused to EVERY sponsor role', '42501/42501/42501/42501/42501',
    pg_temp.try_as(pg_temp.f('hmo'), v_mh) || '/' || pg_temp.try_as(pg_temp.f('corp'), v_mh) || '/' || pg_temp.try_as(pg_temp.f('ngo'), v_mh) || '/' || pg_temp.try_as(pg_temp.f('payer'), v_mh) || '/' || pg_temp.try_as(pg_temp.f('prov'), v_mh));
  perform pg_temp.chk('5h mental health report refused: anon', '42501', pg_temp.try_anon(v_mh));
  perform pg_temp.chk('5i BP day-180 report: admin and the CMO may; analyst, clinician, patient and the sponsor roles may not', 'ok/ok/42501/42501/42501/42501/42501/42501/42501/42501',
    pg_temp.try_as(pg_temp.f('admin'), v_bp) || '/' || pg_temp.try_as(pg_temp.f('cmo'), v_bp) || '/' || pg_temp.try_as(pg_temp.f('analyst'), v_bp) || '/' || pg_temp.try_as(pg_temp.f('clin'), v_bp) || '/' ||
    pg_temp.try_as(pg_temp.f('stranger'), v_bp) || '/' || pg_temp.try_as(pg_temp.f('hmo'), v_bp) || '/' || pg_temp.try_as(pg_temp.f('corp'), v_bp) || '/' || pg_temp.try_as(pg_temp.f('ngo'), v_bp) || '/' ||
    pg_temp.try_as(pg_temp.f('payer'), v_bp) || '/' || pg_temp.try_as(pg_temp.f('prov'), v_bp));
  perform pg_temp.chk('5j BP day-180 report refused: anon', '42501', pg_temp.try_anon(v_bp));


  -- row access to the mental health table
  perform pg_temp.chk('5k the patient reads their own mental health snapshots by row (4 PHQ-9 + 4 GAD-7 days)', '8', pg_temp.count_as(pg_temp.f('m1'), $q$ select count(*) from public.outcome_mh_snapshots $q$));
  perform pg_temp.chk('5l ...and another patient, a tied clinician, an admin, an analyst, the CMO and every sponsor role read ZERO rows by table',
    '0/0/0/0/0/0/0/0/0/0',
    pg_temp.count_as(pg_temp.f('stranger'), $q$ select count(*) from public.outcome_mh_snapshots $q$) || '/' || pg_temp.count_as(pg_temp.f('clin'), $q$ select count(*) from public.outcome_mh_snapshots $q$) || '/' ||
    pg_temp.count_as(pg_temp.f('admin'), $q$ select count(*) from public.outcome_mh_snapshots $q$) || '/' || pg_temp.count_as(pg_temp.f('analyst'), $q$ select count(*) from public.outcome_mh_snapshots $q$) || '/' ||
    pg_temp.count_as(pg_temp.f('cmo'), $q$ select count(*) from public.outcome_mh_snapshots $q$) || '/' || pg_temp.count_as(pg_temp.f('hmo'), $q$ select count(*) from public.outcome_mh_snapshots $q$) || '/' ||
    pg_temp.count_as(pg_temp.f('corp'), $q$ select count(*) from public.outcome_mh_snapshots $q$) || '/' || pg_temp.count_as(pg_temp.f('ngo'), $q$ select count(*) from public.outcome_mh_snapshots $q$) || '/' ||
    pg_temp.count_as(pg_temp.f('payer'), $q$ select count(*) from public.outcome_mh_snapshots $q$) || '/' || pg_temp.count_as(pg_temp.f('prov'), $q$ select count(*) from public.outcome_mh_snapshots $q$));
  perform pg_temp.chk('5m anon cannot read the table', '42501', pg_temp.try_anon($q$ select count(*) from public.outcome_mh_snapshots $q$));
  perform pg_temp.chk('5n nobody can write to it as a user (patient delete, admin insert)', '42501/42501',
    pg_temp.try_as(pg_temp.f('m1'), $q$ delete from public.outcome_mh_snapshots $q$) || '/' ||
    pg_temp.try_as(pg_temp.f('admin'), $q$ insert into public.outcome_mh_snapshots (organisation_id, patient_id, instrument, day, anchor_date, response_status, remission_status, config_version) select organisation_id, id, 'phq9', 1, current_date, 'not_applicable', 'not_applicable', 3 from public.profiles limit 1 $q$));
  perform pg_temp.chk('5o my_mental_health_outcomes returns my rows only', '8/0',
    jsonb_array_length(pg_temp.json_as(pg_temp.f('m1'), $q$ select public.my_mental_health_outcomes() $q$))::text || '/' ||
    jsonb_array_length(pg_temp.json_as(pg_temp.f('stranger'), $q$ select public.my_mental_health_outcomes() $q$))::text);
  perform pg_temp.chk('5p the measure snapshot table is also own-rows-only: a sponsor, an admin and a stranger read zero HbA1c/weight rows by table', '0/0/0',
    pg_temp.count_as(pg_temp.f('hmo'), $q$ select count(*) from public.outcome_measure_snapshots $q$) || '/' || pg_temp.count_as(pg_temp.f('admin'), $q$ select count(*) from public.outcome_measure_snapshots $q$) || '/' ||
    pg_temp.count_as(pg_temp.f('stranger'), $q$ select count(*) from public.outcome_measure_snapshots $q$));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. The audited clinician read of one patient's mental health outcomes
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare r jsonb; v_n integer; m1 uuid := pg_temp.f('m1');
  v_q text := format($q$ select public.clinician_mental_health_outcomes(%L, 'Reviewing progress at day 90') $q$, pg_temp.f('m1'));
begin
  r := pg_temp.json_as(pg_temp.f('clin'), v_q);
  perform pg_temp.chk('6a a clinician with a real tie reads the 8 rows', 'ok/8', (r ->> 'status') || '/' || jsonb_array_length(r -> 'rows'));
  select count(*) into v_n from public.audit_log where subject_patient_id = m1 and actor_id = pg_temp.f('clin') and action = 'staff.chart_read' and result = 'success' and event -> 'sections' ? 'mental_health_outcomes';
  perform pg_temp.chk('6b exactly one success audit row, with the reason (INV-10)', '1/Reviewing progress at day 90', v_n || '/' ||
    (select event ->> 'reason' from public.audit_log where subject_patient_id = m1 and actor_id = pg_temp.f('clin') and event -> 'sections' ? 'mental_health_outcomes' limit 1));
  r := pg_temp.json_as(pg_temp.f('clin2'), v_q);
  perform pg_temp.chk('6c a clinician with no tie is denied and sees no rows', 'denied/false', (r ->> 'status') || '/' || (r ? 'rows')::text);
  select count(*) into v_n from public.audit_log where subject_patient_id = m1 and actor_id = pg_temp.f('clin2') and result = 'denied' and event -> 'sections' ? 'mental_health_outcomes';
  perform pg_temp.chk('6d the denial is audited too', '1', v_n::text);
  r := pg_temp.json_as(pg_temp.f('cmo'), v_q);
  perform pg_temp.chk('6e the CMO is not tied by rank: with no tie, denied', 'denied', r ->> 'status');
  r := pg_temp.json_as(pg_temp.f('clin'), format($q$ select public.clinician_mental_health_outcomes(%L, 'short') $q$, m1));
  perform pg_temp.chk('6f a short reason is refused (22023)', '22023', r ->> 'err');
  r := pg_temp.json_as(pg_temp.f('clin'), format($q$ select public.clinician_mental_health_outcomes(%L, 'Reviewing progress at day 90') $q$, pg_temp.f('m2')));
  perform pg_temp.chk('6g the tied clinician reads only the patients they are tied to (M2: denied)', 'denied', r ->> 'status');
  perform pg_temp.chk('6h refused outright (42501): admin, analyst, patient, the patient themself, every sponsor role',
    '42501/42501/42501/42501/42501/42501/42501/42501/42501',
    (pg_temp.json_as(pg_temp.f('admin'), v_q) ->> 'err') || '/' || (pg_temp.json_as(pg_temp.f('analyst'), v_q) ->> 'err') || '/' || (pg_temp.json_as(pg_temp.f('stranger'), v_q) ->> 'err') || '/' ||
    (pg_temp.json_as(pg_temp.f('m1'), v_q) ->> 'err') || '/' || (pg_temp.json_as(pg_temp.f('hmo'), v_q) ->> 'err') || '/' || (pg_temp.json_as(pg_temp.f('corp'), v_q) ->> 'err') || '/' ||
    (pg_temp.json_as(pg_temp.f('ngo'), v_q) ->> 'err') || '/' || (pg_temp.json_as(pg_temp.f('payer'), v_q) ->> 'err') || '/' || (pg_temp.json_as(pg_temp.f('prov'), v_q) ->> 'err'));
  perform pg_temp.chk('6i anon cannot run the clinician read', '42501', pg_temp.try_anon(v_q));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. Nothing a sponsor can reach touches the mental health table; no function reads an item answer
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.mh_functions() returns text language sql as $$
  select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosrc ~ 'outcome_mh_snapshots' and n.nspname in ('public', 'private', 'analytics') $$;
create function pg_temp.item_readers() returns integer language sql as $$
  select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and (p.proname ~ '^(s75_|outcome_mh|outcome_measure|my_mental_health|clinician_mental_health|mental_health_outcome|compute_outcome_measure)')
     and p.prosrc ~* 'item_responses|crisis_flagged' $$;
do $$
begin
  perform pg_temp.chk('7a exactly these functions name the mental health snapshot table', 'private.compute_outcome_measure_snapshots,private.outcome_mh_compute,public.clinician_mental_health_outcomes,public.mental_health_outcome_report,public.my_mental_health_outcomes', pg_temp.mh_functions());
  perform pg_temp.chk('7b no view or materialised view in any schema is built on the mental health table (analytics included)', '0',
    ((select count(*) from pg_views where definition ~ 'outcome_mh_snapshots') + (select count(*) from pg_matviews where definition ~ 'outcome_mh_snapshots'))::text);
  perform pg_temp.chk('7c no sponsor, corporate, payer, hmo, ngo, employer or provider-organisation function names a mental health outcome object', '0',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname ~* '(sponsor|corporate|payer|hmo|ngo|employer|provider_org|wellbeing_cohort)'
        and p.prosrc ~* '(outcome_mh_snapshots|mental_health_outcome|clinician_mental_health|s75_mh_nearest|outcome_mh_compute)')::text);
  perform pg_temp.chk('7d the sponsor report path reads neither new snapshot table', '0',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname ~* '(sponsor|v_bp_cohort)' and p.prosrc ~* '(outcome_mh_snapshots|outcome_measure_snapshots)')::text);
  perform pg_temp.chk('7e no function in the new path reads item answers or the crisis flag (PHQ-9 item 9 follows the red pathway)', '0', pg_temp.item_readers()::text);
  perform pg_temp.chk('7f the analytics layer exposes HbA1c and weight only: no analytics relation names a mental health table or the screens', '0',
    (select count(*) from pg_views where schemaname = 'analytics' and definition ~* '(outcome_mh_snapshots|mental_health_screens)')::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. BP at day 180 (S38's own snapshots), day 90 unchanged
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare r jsonb; r90 jsonb; r90b jsonb;
begin
  r := pg_temp.json_as(pg_temp.f('admin'), $q$ select public.bp_control_report_day(180) $q$);
  perform pg_temp.chk('8a day 180: 6 people (the test account is left out): 2 controlled, 2 not, 2 no reading', '6/2/2/2',
    (r #>> '{cohort_all_due,n}') || '/' || (r #>> '{cohort_all_due,controlled}') || '/' || (r #>> '{cohort_all_due,uncontrolled}') || '/' || (r #>> '{cohort_all_due,insufficient_data}'));
  perform pg_temp.chk('8b strict 33.3, among measured 50.0, missing 33.3', '33.3/50.0/33.3', (r #>> '{cohort_all_due,rate_strict_pct}') || '/' || (r #>> '{cohort_all_due,rate_among_measured_pct}') || '/' || (r #>> '{cohort_all_due,missing_pct}'));
  perform pg_temp.chk('8c change among the 4 measured at both ends: -7.5 over -4.5 mmHg', '4/-7.5/-4.5', (r #>> '{change_among_measured,n}') || '/' || (r #>> '{change_among_measured,mean_systolic_change}') || '/' || (r #>> '{change_among_measured,mean_diastolic_change}'));
  perform pg_temp.chk('8d the people who started above target: withheld because one category is a small cell', 'true', r #>> '{cohort_baseline_uncontrolled,suppressed}');
  perform pg_temp.chk('8e no comparison group, no causal claim, measure code', 'none/true/bp_control_180d', (r ->> 'comparison_group') || '/' || (r ->> 'not_a_causal_claim') || '/' || (r ->> 'measure'));
  r90 := pg_temp.json_as(pg_temp.f('admin'), $q$ select public.bp_control_report_day(90) $q$);
  r90b := pg_temp.json_as(pg_temp.f('admin'), $q$ select public.bp_control_report() $q$);
  perform pg_temp.chk('8f day 90 through the new door is the S38 report unchanged', 'true/bp_control_90d', ((r90 - 'generated_at') = (r90b - 'generated_at'))::text || '/' || (r90 ->> 'measure'));
  perform pg_temp.chk('8g any other day is refused (22023)', '22023', pg_temp.json_as(pg_temp.f('admin'), $q$ select public.bp_control_report_day(30) $q$) ->> 'err');
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. SABOTAGE: each protection removed in turn; the matching check must flip
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_def text; v_n integer; r jsonb;
begin
  -- 9a the analyst gate opened to everyone: a sponsor then reads the report (5c would FAIL)
  v_def := pg_get_functiondef('private.s75_is_outcome_analyst()'::regprocedure);
  create or replace function private.s75_is_outcome_analyst() returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$;
  perform pg_temp.chk('9a SABOTAGE: with the analyst gate opened a sponsor runs the measure report (5c would FAIL)', 'ok',
    pg_temp.try_as(pg_temp.f('hmo'), $q$ select public.outcome_measures_report('hba1c', 90) $q$));
  perform pg_temp.chk('9b SABOTAGE: ...and the mental health report (5g would FAIL)', 'ok', pg_temp.try_as(pg_temp.f('hmo'), $q$ select public.mental_health_outcome_report('phq9', 90) $q$));
  execute v_def;

  -- 9c a permissive policy on the mental health table: a sponsor then reads rows (5l would FAIL)
  create policy s75_sabotage_open on public.outcome_mh_snapshots for select to authenticated using (true);
  perform pg_temp.chk('9c SABOTAGE: with an open policy a sponsor reads mental health rows by table (5l would FAIL)', 'true',
    (pg_temp.count_as(pg_temp.f('hmo'), $q$ select count(*) from public.outcome_mh_snapshots $q$)::integer > 0)::text);
  drop policy s75_sabotage_open on public.outcome_mh_snapshots;
  perform pg_temp.chk('9d the policy is gone again: zero rows for the sponsor', '0', pg_temp.count_as(pg_temp.f('hmo'), $q$ select count(*) from public.outcome_mh_snapshots $q$));

  -- 9e the test-account filter dropped from the analytics view (4b would FAIL)
  create or replace view analytics.v_outcome_measure_snapshots with (security_invoker = off) as
    select sub.subject_key, s.organisation_id, s.measure_code, s.day, date_trunc('month', s.anchor_date)::date as enrolment_month,
           s.baseline_value, s.value, s.change_abs, s.change_pct, s.goal_status, s.change_status, s.target_source, s.config_version, s.computed_at::date as computed_on
      from public.outcome_measure_snapshots s join analytics.subjects sub on sub.patient_id = s.patient_id;
  select count(*) into v_n from analytics.v_outcome_measure_snapshots v join analytics.subjects s on s.subject_key = v.subject_key where s.patient_id in (pg_temp.f('ht'), pg_temp.f('wt'));
  perform pg_temp.chk('9e SABOTAGE: without the is_test filter the test accounts appear in the analytics view (4b would FAIL)', 'true', (v_n > 0)::text);

  -- 9f the append-only trigger dropped: history can be rewritten (2v would FAIL)
  drop trigger outcome_mh_snapshots_append_only on public.outcome_mh_snapshots;
  update public.outcome_mh_snapshots set change = 99 where patient_id = pg_temp.f('m1') and instrument = 'phq9' and day = 90;
  perform pg_temp.chk('9f SABOTAGE: without the trigger a mental health snapshot is rewritten (2v2 would FAIL)', '99',
    (select change::text from public.outcome_mh_snapshots where patient_id = pg_temp.f('m1') and instrument = 'phq9' and day = 90));

  -- 9g a mental health reader that reads item answers: the scan must catch it (7e would FAIL)
  create or replace function private.s75_mh_nearest(p_patient uuid, p_instrument text, p_lo date, p_hi date, p_centre date, p_max integer, out val integer, out on_date date)
    language sql stable security definer set search_path = ''
    as $f$ select (s.item_responses ->> '9')::integer, (s.created_at at time zone 'Africa/Lagos')::date from public.mental_health_screens s where s.patient_id = p_patient limit 1 $f$;
  perform pg_temp.chk('9g SABOTAGE: a reader of item answers is caught by the scan (7e would FAIL)', '1', pg_temp.item_readers()::text);

  -- 9h the dormant guard: activate nothing and the job writes nothing (1b); sabotage by making the job ignore the version check
  select pg_get_functiondef('private.s75_measures_version()'::regprocedure) into v_def;
  update public.outcome_config set is_active = false where version = 3;
  update public.outcome_config set is_active = true where version = 2;
  perform pg_temp.chk('9h with v2 active again the measure job writes nothing (1b holds)', '0', private.compute_outcome_measure_snapshots(now() + interval '400 days')::text);
  r := pg_temp.json_as(pg_temp.f('admin'), $q$ select public.outcome_measures_report('hba1c', 90) $q$);
  perform pg_temp.chk('9i ...and the measure report refuses again (22023)', '22023', r ->> 'err');
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 10. Verdict
-- ---------------------------------------------------------------------------------------------------------------------------------
select check_name, expected, actual, verdict from results order by check_name;
do $$
begin
  if exists (select 1 from results where verdict = 'FAIL') then
    raise exception 'S75 proof: % check(s) FAILED: %', (select count(*) from results where verdict = 'FAIL'),
      (select string_agg(check_name, '; ') from results where verdict = 'FAIL');
  end if;
end $$;
rollback;
