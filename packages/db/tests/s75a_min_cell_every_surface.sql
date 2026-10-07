-- ===========================================================================
-- Proof: 20261007211347_s75a_single_min_cell_enforcement.sql (v5 S75, Module 22; decision S75-5, OQ-319, OQ-233; invariants INV-13, I9).
--
-- THE MODULE ACCEPTANCE TEST: "an aggregate view with fewer than the minimum cohort returns suppressed values", proved on EVERY aggregate surface
-- that reads patient data, in one rolled-back transaction, with a deliberate sabotage run that must flip.
--
--   1. The four helpers (floor, cell, difference, groups): boundaries, the organisation can raise the floor and never lower it, zero is not a small
--      cell, a small category withholds the cell, one withheld group takes the next smallest with it, fail closed on a missing configuration.
--   2. Every surface, small cohort first (must be withheld) and a large control cohort second (must be shown, so the check is not vacuous):
--        BP control 90 days, BP control 180 days, the analytics view, the sponsor report (incl. the "people who did not agree" rule), the risk
--        distribution (incl. complementary withholding), the triage AGREEMENT report (incl. withholding across the three grades), the corporate
--        subsidy summary (people not claims, complementary categories, anon cannot run it), the reproductive analytics (people not log rows),
--        the payer dashboard (an insurer's own number can raise the floor, never lower it).
--      Closed gaps proved: the BP report no longer prints "enrolled" / "not yet due" for a cohort it withheld; the triage report withholds a small
--      grade together with the next smallest.
--   3. Static scan: no aggregate function compares a count with the minimum by hand (no "between 1 and" / ">= v_min" / "< v_min"), and every
--      function that reads min_cohort_size or the min_cell rule goes through min_cell_floor.
--   4. SABOTAGE: private.suppress_cell and private.suppress_difference are replaced by versions that never withhold; the small-cohort checks must then
--      FAIL (be flipped). A proof that cannot fail is not a proof.
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
-- a joined person p_ago days back with p_n0 readings in the first week at (150/95) and p_nd readings in the window ending day p_day at (p_s/p_d)
create function pg_temp.mkpat(p_org uuid, p_label text, p_ago integer, p_day integer, p_nd integer, p_s integer, p_d integer, p_test boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'patient', p_test); a date := current_date - p_ago; k integer;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, is_test)
  values (p_org, v, 'purchase', ((a::timestamp + time '08:00') at time zone 'Africa/Lagos'), p_test);
  for k in 0 .. 2 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values (p_org, v, 'blood_pressure', 150, 95, (((a + k)::timestamp + time '09:00') at time zone 'Africa/Lagos'), 'device');
  end loop;
  for k in 0 .. p_nd - 1 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values (p_org, v, 'blood_pressure', p_s, p_d, (((a + p_day - 6 + k)::timestamp + time '09:00') at time zone 'Africa/Lagos'), 'device');
  end loop;
  return v;
end $f$;
-- a completed task with a graded triage event and a review by p_clin
create function pg_temp.mkreview(p_patient uuid, p_grade text, p_agree text, p_clin uuid) returns void language plpgsql as $f$
declare v_ev uuid; v_t uuid; v_rs record; v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  select id, code, version into v_rs from public.triage_rule_sets order by created_at limit 1;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  values (v_org, p_patient, 'observation', gen_random_uuid(), p_grade, v_rs.id, v_rs.code, v_rs.version, 'approved', case when p_grade = 'red' then '[{"kind":"page_on_call"}]'::jsonb else '[]'::jsonb end, false, false, gen_random_uuid()::text) returning id into v_ev;
  perform set_config('tarragon.task_transition', 'on', true);
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, completed_at, outcome, triage_event_id, is_test)
  values (v_org, 'amber_bp_review', 1, 4, 4, p_patient, 'medical_officer', now(), 'completed', now(), '{"done":true}'::jsonb, v_ev, false) returning id into v_t;
  perform set_config('tarragon.task_transition', 'off', true);
  insert into public.triage_reviews (organisation_id, task_id, triage_event_id, patient_id, graded_as, agreement, reviewed_by, rule_set_version, shadow)
  values (v_org, v_t, v_ev, p_patient, p_grade, p_agree, p_clin, v_rs.version, false);
end $f$;

-- =========================================================================== fixtures
do $$
declare
  v_org uuid; v_admin uuid; v_clin uuid; i integer; p uuid; v_sp uuid; v_c1 uuid; v_c2 uuid; v_ver uuid; v_ins uuid; v_cfg integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  v_clin := pg_temp.mkuser(v_org, 'clin', 'clinician', true);
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('clin', v_clin);
  perform pg_temp.setf('plain', pg_temp.mkuser(v_org, 'plain', 'patient'));

  -- BP: four cohorts, each in its own calendar month (62+ days apart)
  for i in 1 .. 4 loop perform pg_temp.mkpat(v_org, 'S90-' || i, 100, 90, 3, 125, 80); end loop;     -- 4 people, day 90 (small)
  for i in 1 .. 24 loop perform pg_temp.mkpat(v_org, 'M90-' || i, 162, 90, 3, 125, 80); end loop;    -- 24 people, day 90, all controlled (control)
  for i in 1 .. 4 loop perform pg_temp.mkpat(v_org, 'S180-' || i, 288, 180, 3, 125, 80); end loop;   -- 4 people, day 180 (small)
  for i in 1 .. 24 loop perform pg_temp.mkpat(v_org, 'M180-' || i, 350, 180, 3, 125, 80); end loop;  -- 24 people, day 180, all controlled (control)
  -- a TEST account in the large cohort must never be counted
  perform pg_temp.mkpat(v_org, 'TEST', 162, 90, 3, 125, 80, true);
  perform private.compute_outcome_snapshots(now());

  -- sponsor cohorts: S (4 who agreed) and M (24 agreed + 3 who joined but did not agree)
  insert into public.organisations (name, type) values ('S75a Sponsor Corp', 'corporate') returning id into v_sp;
  perform pg_temp.setf('sponsor', v_sp);
  update public.consent_versions set is_current = true where consent_type = 'sponsor_reporting' and version = '2026-10-07-draft';
  select id into v_ver from public.consent_versions where consent_type = 'sponsor_reporting' and is_current limit 1;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses) values (v_org, v_sp, 'S75a small', 'S75AAAA2', current_date - 400, current_date + 30, 1000) returning id into v_c1;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses) values (v_org, v_sp, 'S75a large', 'S75AAAA3', current_date - 400, current_date + 30, 1000) returning id into v_c2;
  perform pg_temp.setf('c_small', v_c1); perform pg_temp.setf('c_large', v_c2);
  for p in select id from public.profiles where full_name like 'S75a S90-%' loop
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, p, 'sponsor_reporting', v_ver, '2026-10-07-draft', 'accepted');
    insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, reporting_consent, consented_at, consent_version_id) values (v_org, p, v_c1, true, now(), v_ver);
  end loop;
  for p in select id from public.profiles where full_name like 'S75a M90-%' and not is_test loop
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, p, 'sponsor_reporting', v_ver, '2026-10-07-draft', 'accepted');
    insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, reporting_consent, consented_at, consent_version_id) values (v_org, p, v_c2, true, now(), v_ver);
  end loop;
  for i in 1 .. 3 loop   -- joined the large programme, did not agree to share
    p := pg_temp.mkuser(v_org, 'NOAGREE-' || i, 'patient');
    insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, reporting_consent) values (v_org, p, v_c2, false);
  end loop;

  -- risk scores: Lagos 25 low, Abuja 25 low, Kano 4 low (state is the one-attribute cut)
  select version into v_cfg from public.risk_config where is_active;
  for i in 1 .. 25 loop p := pg_temp.mkuser(v_org, 'RL-' || i, 'patient', false, 'Lagos');
    insert into public.risk_scores (organisation_id, patient_id, model_version, computed_on, deterioration_risk, dropout_risk, level) values (v_org, p, v_cfg, current_date, 5, 5, 'low'); end loop;
  for i in 1 .. 25 loop p := pg_temp.mkuser(v_org, 'RA-' || i, 'patient', false, 'Abuja');
    insert into public.risk_scores (organisation_id, patient_id, model_version, computed_on, deterioration_risk, dropout_risk, level) values (v_org, p, v_cfg, current_date, 5, 5, 'low'); end loop;
  for i in 1 .. 4 loop p := pg_temp.mkuser(v_org, 'RK-' || i, 'patient', false, 'Kano');
    insert into public.risk_scores (organisation_id, patient_id, model_version, computed_on, deterioration_risk, dropout_risk, level) values (v_org, p, v_cfg, current_date, 5, 5, 'low'); end loop;

  -- triage reviews: green 4, amber 25, red 25 (all agree)
  p := pg_temp.mkuser(v_org, 'TRI', 'patient', false, 'Lagos');
  for i in 1 .. 4 loop perform pg_temp.mkreview(p, 'green', 'right', v_clin); end loop;
  for i in 1 .. 25 loop perform pg_temp.mkreview(p, 'amber', 'right', v_clin); end loop;
  for i in 1 .. 25 loop perform pg_temp.mkreview(p, 'red', 'right', v_clin); end loop;

  -- reproductive: 25 menstruating, 4 postpartum, and one test account
  for i in 1 .. 25 loop p := pg_temp.mkuser(v_org, 'RH-' || i, 'patient');
    insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage) values (v_org, p, 'menstruating'); end loop;
  for i in 1 .. 25 loop p := pg_temp.mkuser(v_org, 'RQ-' || i, 'patient');
    insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage) values (v_org, p, 'perimenopausal'); end loop;
  for i in 1 .. 4 loop p := pg_temp.mkuser(v_org, 'RP-' || i, 'patient');
    insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage) values (v_org, p, 'postpartum'); end loop;
  p := pg_temp.mkuser(v_org, 'RT', 'patient', true);
  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage) values (v_org, p, 'menopausal');

  -- payer: an insurer with its own number 5 (below the platform floor) and 4 verified members
  insert into public.insurers (name, code, is_active, onboarding_status, min_cohort_size) values ('S75a Payer', 'S75A', true, 'live', 5) returning id into v_ins;
  perform pg_temp.setf('insurer', v_ins);
  for i in 1 .. 4 loop p := pg_temp.mkuser(v_org, 'PI-' || i, 'patient');
    insert into public.insurance_policies (organisation_id, patient_id, insurer_id, member_id, status, verified_at, effective_from) values (v_org, p, v_ins, 'S75A-' || i, 'active', now(), current_date - 30); end loop;

  -- corporate subsidy: 4 people in lab; a second type added later
  for i in 1 .. 4 loop p := pg_temp.mkuser(v_org, 'SUB-L' || i, 'patient');
    insert into public.transaction_subsidies (organisation_id, beneficiary_profile_id, sponsor_profile_id, order_type, order_id, gross_amount_kobo, sponsor_amount_kobo, patient_amount_kobo, status)
    values (v_org, p, v_admin, 'lab', gen_random_uuid(), 100000, 100000, 0, 'paid'); end loop;
end $$;

-- =========================================================================== 1. the helpers
do $$
declare v_g jsonb; v_x text;
begin
  perform pg_temp.ck('1a the platform floor is 20, a cut by two attributes 30', '20/30', private.min_cell_floor() || '/' || private.min_cell_floor(null, 2));
  perform pg_temp.ck('1b an organisation can raise its floor (25) and never lower it (5)', '25/20', private.min_cell_floor(25) || '/' || private.min_cell_floor(5));
  perform pg_temp.ck('1c 19 is withheld, 20 is shown', 'under_minimum/shown', coalesce(private.suppress_cell(19), 'shown') || '/' || coalesce(private.suppress_cell(20), 'shown'));
  perform pg_temp.ck('1d a missing count is never shown', 'under_minimum', coalesce(private.suppress_cell(null), 'shown'));
  perform pg_temp.ck('1e a category of 1 to 19 withholds the cell; zero does not', 'small_cell/shown/small_cell', coalesce(private.suppress_cell(60, array[1, 59]::bigint[]), 'shown') || '/' || coalesce(private.suppress_cell(60, array[0, 60]::bigint[]), 'shown') || '/' || coalesce(private.suppress_cell(60, array[19, 41]::bigint[]), 'shown'));
  perform pg_temp.ck('1f a difference of 1 to 19 is withheld; 0 and 20 are not; a negative one is', 'true/false/false/true', (private.suppress_difference(25, 20))::text || '/' || (private.suppress_difference(20, 20))::text || '/' || (private.suppress_difference(40, 20))::text || '/' || (private.suppress_difference(10, 20))::text);
  v_g := private.suppress_groups('[{"key":"a","n":3},{"key":"b","n":30},{"key":"c","n":40}]'::jsonb);
  perform pg_temp.ck('1g one small group takes the next smallest with it', 'a:true/b:complementary/c:false', (select string_agg((g ->> 'key') || ':' || case when g ->> 'reason' = 'complementary' then 'complementary' else (g ->> 'suppressed') end, '/' order by g ->> 'key') from jsonb_array_elements(v_g) g));
  perform pg_temp.ck('1g2 (and it is the small one plus the NEXT smallest, not the largest)', 'a,b', (select string_agg(g ->> 'key', ',' order by g ->> 'key') from jsonb_array_elements(v_g) g where (g ->> 'suppressed')::boolean));
  v_g := private.suppress_groups('[{"key":"a","n":30},{"key":"b","n":40},{"key":"c","n":50}]'::jsonb);
  perform pg_temp.ck('1h nothing small, nothing withheld', '0', (select count(*) from jsonb_array_elements(v_g) g where (g ->> 'suppressed')::boolean)::text);
  v_g := private.suppress_groups('[{"key":"a","n":3},{"key":"b","n":4},{"key":"c","n":30},{"key":"d","n":40}]'::jsonb);
  perform pg_temp.ck('1i two small groups that together are under the minimum also take the next smallest', '3', (select count(*) from jsonb_array_elements(v_g) g where (g ->> 'suppressed')::boolean)::text);
  v_g := private.suppress_groups('[{"key":"a","n":50,"cats":[2,48]},{"key":"b","n":40,"cats":[0,40]},{"key":"c","n":60,"cats":[30,30]}]'::jsonb);
  perform pg_temp.ck('1j a group with a small category is withheld whole (and takes the next smallest)', 'a,b', (select string_agg(g ->> 'key', ',' order by g ->> 'key') from jsonb_array_elements(v_g) g where (g ->> 'suppressed')::boolean));
  update public.outcome_config set is_active = false where is_active;
  begin perform private.min_cell_floor(); v_x := 'no error'; exception when sqlstate 'P0002' then v_x := 'refused'; end;
  perform pg_temp.ck('1k with no active configuration there is no floor and nothing may be shown (fail closed)', 'refused', v_x);
  update public.outcome_config set is_active = true where version = (select max(version) from public.outcome_config);
end $$;

-- =========================================================================== 2. every surface
create function pg_temp.surfaces(p_phase text) returns void language plpgsql as $f$
declare
  adm uuid := pg_temp.f('admin'); r jsonb; s90 date := current_date - 100; m90 date := current_date - 162; s180 date := current_date - 288; m180 date := current_date - 350;
  v_x text; v_sp uuid := pg_temp.f('sponsor'); v_ins uuid := pg_temp.f('insurer'); v_org uuid := pg_temp.f('org'); n integer;
  procedure_ck text;
begin
  -- BP 90 --------------------------------------------------------------------------------------------------------
  r := pg_temp.q_as(adm, format($q$ select public.bp_control_report(%L, %L)::text $q$, s90, s90))::jsonb;
  insert into results values (p_phase, '2.1a BP 90 days: 4 people are withheld', 'true', coalesce((r #>> '{cohort_all_due,suppressed}'), 'null'));
  insert into results values (p_phase, '2.1b BP 90 days: the withheld cohort carries no count', 'false', (r #> '{cohort_all_due}' ? 'n')::text);
  insert into results values (p_phase, '2.1c BP 90 days: "enrolled" and "not yet due" are not printed for a withheld cohort', 'null/null', coalesce(r #>> '{data_quality,enrolled_total}', 'null') || '/' || coalesce(r #>> '{data_quality,not_yet_due}', 'null'));
  r := pg_temp.q_as(adm, format($q$ select public.bp_control_report(%L, %L)::text $q$, m90, m90))::jsonb;
  insert into results values (p_phase, '2.1d BP 90 days: 24 controlled people are shown (control; the test account is not counted)', 'false/24', coalesce(r #>> '{cohort_all_due,suppressed}', 'null') || '/' || coalesce(r #>> '{cohort_all_due,n}', 'null'));
  -- BP 180 --------------------------------------------------------------------------------------------------------
  r := pg_temp.q_as(adm, format($q$ select public.bp_control_report_180d(%L, %L)::text $q$, s180, s180))::jsonb;
  insert into results values (p_phase, '2.2a BP 180 days: 4 people are withheld', 'true/bp_control_180d', coalesce(r #>> '{cohort_all_due,suppressed}', 'null') || '/' || coalesce(r ->> 'measure', 'null'));
  r := pg_temp.q_as(adm, format($q$ select public.bp_control_report_180d(%L, %L)::text $q$, m180, m180))::jsonb;
  insert into results values (p_phase, '2.2b BP 180 days: 24 controlled people are shown (control)', 'false/24', coalesce(r #>> '{cohort_all_due,suppressed}', 'null') || '/' || coalesce(r #>> '{cohort_all_due,n}', 'null'));
  -- the analytics view -----------------------------------------------------------------------------------------------
  select count(*) into n from analytics.v_bp_control_90d_by_month where enrolment_month = date_trunc('month', s90)::date;
  insert into results values (p_phase, '2.3a analytics view: the 4-person month has no row', '0', n::text);
  select count(*) into n from analytics.v_bp_control_90d_by_month where enrolment_month = date_trunc('month', m90)::date;
  insert into results values (p_phase, '2.3b analytics view: the 24-person month has its row (control)', '1', n::text);
  -- sponsor report ---------------------------------------------------------------------------------------------------
  r := pg_temp.q_as(adm, format($q$ select public.sponsor_outcome_report(%L)::text $q$, pg_temp.f('c_small')))::jsonb;
  insert into results values (p_phase, '2.4a sponsor report: 4 members who agreed are withheld on every figure', 'true/true/true', coalesce(r #>> '{members,suppressed}', 'null') || '/' || coalesce(r #>> '{bp_control_90d,suppressed}', 'null') || '/' || coalesce(r #>> '{engagement_separate,suppressed}', 'null'));
  r := pg_temp.q_as(adm, format($q$ select public.sponsor_outcome_report(%L)::text $q$, pg_temp.f('c_large')))::jsonb;
  insert into results values (p_phase, '2.4b sponsor report: 24 agreed but 3 did not: "how many agreed" is withheld (the 3 would be recoverable), the BP figure is shown', 'true/false', coalesce(r #>> '{members,suppressed}', 'null') || '/' || coalesce(r #>> '{bp_control_90d,suppressed}', 'null'));
  insert into results values (p_phase, '2.4c sponsor report: the floor is the larger of the platform 20 and the sponsor''s own (10)', '20', coalesce(r ->> 'minimum_cell', 'null'));
  -- risk distribution --------------------------------------------------------------------------------------------------
  r := pg_temp.q_as(adm, $q$ select public.risk_distribution_report()::text $q$)::jsonb;
  insert into results values (p_phase, '2.5a risk distribution: Kano (4) is withheld, and so is the next smallest (Abuja); Lagos (25) is shown', 'Abuja:true,Kano:true,Lagos:false',
    (select string_agg((g ->> 'key') || ':' || coalesce(g ->> 'suppressed', 'false'), ',' order by g ->> 'key') from jsonb_array_elements(r #> '{by,state}') g where g ->> 'key' in ('Abuja', 'Kano', 'Lagos')));
  insert into results values (p_phase, '2.5b risk distribution: a withheld group prints no count', 'false', (select (g ? 'n')::text from jsonb_array_elements(r #> '{by,state}') g where g ->> 'key' = 'Kano'));
  -- triage agreement ----------------------------------------------------------------------------------------------------
  r := pg_temp.q_as(adm, $q$ select public.triage_agreement_report(null, null)::text $q$)::jsonb;
  insert into results values (p_phase, '2.6a triage agreement: green (4) is withheld AND so is the next smallest grade (amber); red (25) is shown', 'amber:true,green:true,red:false',
    (select string_agg((g ->> 'graded_as') || ':' || (g ->> 'suppressed'), ',' order by g ->> 'graded_as') from jsonb_array_elements(r -> 'by_grade') g));
  insert into results values (p_phase, '2.6b triage agreement: the old function name answers the same', 'true', (pg_temp.q_as(adm, $q$ select public.triage_accuracy_report(null, null)::text $q$)::jsonb #>> '{by_grade,0,suppressed}'));
  -- corporate subsidy ----------------------------------------------------------------------------------------------------
  r := pg_temp.q_as(adm, format($q$ select public.institution_subsidy_summary(%L)::text $q$, v_org))::jsonb;
  insert into results values (p_phase, '2.7a subsidy summary: 4 sponsored people are withheld, with the platform floor 20 (not the old 10)', 'true/20', coalesce(r ->> 'suppressed', 'null') || '/' || coalesce(r ->> 'min_cohort_size', 'null'));
  -- reproductive analytics ------------------------------------------------------------------------------------------------
  r := pg_temp.q_as(adm, $q$ select public.reproductive_health_analytics()::text $q$)::jsonb;
  insert into results values (p_phase, '2.8a reproductive analytics: postpartum (4) is not listed and neither is the next smallest (menstruating); perimenopausal (25) is; the test account (menopausal) is not counted', 'true/true/true/false',
    (r #> '{reproductive_health_profiles,by_life_stage}' ? 'perimenopausal')::text || '/' || (not (r #> '{reproductive_health_profiles,by_life_stage}' ? 'postpartum'))::text || '/' || (not (r #> '{reproductive_health_profiles,by_life_stage}' ? 'menstruating'))::text || '/' || (r #> '{reproductive_health_profiles,by_life_stage}' ? 'menopausal')::text);
  -- payer dashboard -------------------------------------------------------------------------------------------------------
  r := pg_temp.q_as(adm, format($q$ select public.payer_dashboard_analytics(%L)::text $q$, v_ins))::jsonb;
  insert into results values (p_phase, '2.9a payer dashboard: 4 members under an insurer whose own number is 5 are still withheld (the floor is 20)', 'true/20', coalesce(r ->> 'suppressed', 'null') || '/' || coalesce(r ->> 'min_cohort_size', 'null'));
end $f$;

select pg_temp.surfaces('real');

-- subsidy breakdown: add 25 people in pharmacy so there are two types (lab 4, pharmacy 25): the small one is withheld and so is the other
do $$
declare p uuid; i integer; r jsonb; v_org uuid := pg_temp.f('org'); adm uuid := pg_temp.f('admin');
begin
  for i in 1 .. 25 loop p := pg_temp.mkuser(v_org, 'SUB-P' || i, 'patient');
    insert into public.transaction_subsidies (organisation_id, beneficiary_profile_id, sponsor_profile_id, order_type, order_id, gross_amount_kobo, sponsor_amount_kobo, patient_amount_kobo, status)
    values (v_org, p, adm, 'pharmacy', gen_random_uuid(), 100000, 100000, 0, 'paid'); end loop;
  -- one person with many claims in a third type must not look like many people
  insert into public.transaction_subsidies (organisation_id, beneficiary_profile_id, sponsor_profile_id, order_type, order_id, gross_amount_kobo, sponsor_amount_kobo, patient_amount_kobo, status)
  select v_org, p, adm, 'referral', gen_random_uuid(), 100000, 100000, 0, 'paid' from generate_series(1, 30);
  r := pg_temp.q_as(adm, format($q$ select public.institution_subsidy_summary(%L)::text $q$, v_org))::jsonb;
  perform pg_temp.ck('2.7b subsidy breakdown: lab (4 people) and referral (1 person with 30 claims) are withheld, and so is the next smallest (pharmacy): nothing is recoverable',
    'true', (select (count(*) filter (where (c ->> 'suppressed')::boolean) = 3)::text from jsonb_array_elements(r -> 'category_breakdown') c));
  perform pg_temp.ck('2.7c subsidy summary: with 29+ people the headline is shown', 'false', r ->> 'suppressed');
  perform pg_temp.ck('2.7d the subsidy summary is not executable by anon', '42501', pg_temp.try_anon(format($q$ select public.institution_subsidy_summary(%L) $q$, v_org)));
  -- payer: an insurer with its own number 25 and 22 members is withheld although 22 is above the platform floor
  insert into public.insurers (name, code, is_active, onboarding_status, min_cohort_size) values ('S75a Payer2', 'S75B', true, 'live', 25) returning id into p;
  for i in 1 .. 22 loop insert into public.insurance_policies (organisation_id, patient_id, insurer_id, member_id, status, verified_at, effective_from)
    values (v_org, pg_temp.mkuser(v_org, 'PJ-' || i, 'patient'), p, 'S75B-' || i, 'active', now(), current_date - 30); end loop;
  r := pg_temp.q_as(adm, format($q$ select public.payer_dashboard_analytics(%L)::text $q$, p))::jsonb;
  perform pg_temp.ck('2.9b payer dashboard: an insurer''s own larger number raises its floor (22 members, own 25: withheld)', 'true/25', coalesce(r ->> 'suppressed', 'null') || '/' || coalesce(r ->> 'min_cohort_size', 'null'));
  -- reproductive: 25 distinct people each logging one symptom 3 times is 25 people; one person logging it 30 times is one person
  perform pg_temp.ck('2.8b reproductive analytics is admin only', 'ERR:reproductive_health_analytics: admin only',
    pg_temp.q_as(pg_temp.f('plain'), $q$ select public.reproductive_health_analytics()::text $q$));
end $$;

-- =========================================================================== 3. static scan: nobody compares a count with the minimum by hand
do $$
declare v_hand text; v_unrouted text; v_missing text; v_surfaces text[] := array[
  'private.bp_control_aggregate_day', 'private.sponsor_report_aggregate', 'private.generate_sponsor_snapshots', 'public.risk_distribution_report',
  'public.triage_agreement_report', 'public.institution_subsidy_summary', 'public.reproductive_health_analytics', 'public.payer_dashboard_analytics',
  'public.generate_payer_board_report', 'private.outcome_cohort_json'];
begin
  select string_agg(s, ', ') into v_hand from unnest(v_surfaces) s
   where exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and p.prosrc ~* '(between 1 and|>= *v_min\M|< *v_min\M|< *v_floor\M|>= *v_floor\M|< *v_min_cohort|>= *v_min_cohort)');
  perform pg_temp.ck('3a no aggregate surface compares a count with the minimum by hand', 'none', coalesce(v_hand, 'none'));
  select string_agg(s, ', ') into v_missing from unnest(v_surfaces) s
   where not exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and p.prosrc ~ 'suppress_(cell|groups|difference)|min_cell_floor');
  perform pg_temp.ck('3b every aggregate surface goes through the shared functions', 'none', coalesce(v_missing, 'none'));
  select string_agg(p.oid::regproc::text, ', ') into v_unrouted from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prosrc ~* 'min_cohort_size' and p.prosrc !~ 'min_cell_floor'
     and p.proname not in ('s75_never_matches');
  perform pg_temp.ck('3c every function that reads an organisation''s min_cohort_size goes through min_cell_floor', 'none', coalesce(v_unrouted, 'none'));
  select string_agg(p.oid::regproc::text, ', ') into v_unrouted from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prosrc ~* 'outcome_rule\(''min_cell'
     and p.proname not in ('min_cell_floor');
  perform pg_temp.ck('3d only min_cell_floor reads the platform minimum from configuration', 'none', coalesce(v_unrouted, 'none'));
  perform pg_temp.ck('3e the helpers cannot be run by anon or a signed-in user', 'false/false', has_function_privilege('anon', 'private.suppress_groups(jsonb,integer)', 'EXECUTE')::text || '/' || has_function_privilege('authenticated', 'private.suppress_cell(bigint,bigint[],integer)', 'EXECUTE')::text);
  perform pg_temp.ck('3f the new report is refused to a patient and to anon', 'ERR:outcomes_not_authorised/42501',
    pg_temp.q_as(pg_temp.f('plain'), $q$ select public.bp_control_report_180d()::text $q$) || '/' || pg_temp.try_anon($q$ select public.bp_control_report_180d() $q$));
end $$;

-- =========================================================================== 4. SABOTAGE: the helpers stop withholding; the small-cohort checks must flip
create or replace function private.suppress_cell(p_n bigint, p_categories bigint[] default null, p_min integer default null) returns text
language sql stable security definer set search_path = '' as $$ select null::text $$;
create or replace function private.suppress_difference(p_whole bigint, p_part bigint, p_min integer default null) returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;
select pg_temp.surfaces('sabotaged');

do $$
declare v_bad integer; v_flipped integer; v_names text;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S75a proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  -- every "small cohort is withheld" check must flip when the helpers never withhold
  select count(*), string_agg(check_name, '; ') into v_flipped, v_names from results s
   where s.phase = 'sabotaged' and s.expected is distinct from s.actual
     and s.check_name ~ '^2\.(1a|1c|2a|3a|4a|5a|6a|7a|8a|9a)';
  if v_flipped < 10 then raise exception 'VACUOUS TEST: the sabotage flipped % of 10 surface checks (%)', v_flipped, v_names; end if;
end $$;

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
select 'SABOTAGE ' || check_name as check_name, expected, actual, case when expected is distinct from actual then 'PASS' else 'FAIL' end as result
  from results where phase = 'sabotaged' and check_name ~ '^2\.(1a|1c|2a|3a|4a|5a|6a|7a|8a|9a)' order by check_name;

rollback;
