-- Proof (S60, spec 12.12): the monthly accuracy audit.
--
--   1. The monthly job writes a report only for an organisation with completed non-test reviews, for the previous month. The first
--      report is the BASELINE; the next month's is not. A run twice returns the same report (the baseline is never rewritten).
--   2. The numbers are right: overall matched / under-triaged / over-triaged counts against hand-built cases, a Wilson interval that
--      contains the rate, and the known value for 5 of 10 (0.2366 to 0.7634).
--   3. Test accounts are excluded (INV-13) unless an admin or the CMO deliberately includes them, and that report is marked.
--   4. Small cells are suppressed (counts and rates become null) AND the smallest remaining cell of that dimension is suppressed too,
--      so a suppressed cell cannot be recovered by subtraction.
--   5. A report is aggregate only (no patient id anywhere in it), cannot be marked publishable, and cannot be edited or deleted.
--   6. Access: an admin and the CMO read it; a patient, an ordinary clinician and anon do not. run_symptom_accuracy_audit_now refuses
--      everyone else and refuses the current (unfinished) month.
--   SABOTAGE: (a) the minimum cell size lowered to 5, the 7-case cell must stop being suppressed; (b) the publishable CHECK dropped,
--   a publishable report must then be insertable; (c) the immutability trigger dropped, an edit must then succeed.
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception.
begin;

create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.scalar(p_sql text) returns text language plpgsql as
$f$ declare v text; begin execute p_sql into v; return v; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date default null, p_sex text default 'female', p_state text default 'Lagos') returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's60a-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language, sex, state)
  values (v, p_org, p_role::public.user_role, 'S60 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          coalesce(p_dob, (current_date - interval '45 years')::date), true, 'en', p_sex::public.sex, p_state)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name, sex = excluded.sex, state = excluded.state;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S60 ' || p_label, 'MDCN', 'S60A-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;
-- n completed reviews for one patient inside the month starting p_month_start: p_match matched, p_under under-triaged (checker less urgent), the rest over-triaged
create function pg_temp.cohort(p_org uuid, p_patient uuid, p_clinician uuid, p_month_start date, p_n integer, p_match integer, p_under integer, p_review_is_test boolean default false)
returns void language plpgsql as $f$
declare
  i integer;
  v_cat text; v_clin text; v_a uuid;
begin
  for i in 1 .. p_n loop
    if i <= p_match then v_cat := 'urgent'; v_clin := 'urgent';
    elsif i <= p_match + p_under then v_cat := 'routine'; v_clin := 'urgent';
    else v_cat := 'urgent'; v_clin := 'routine'; end if;
    insert into public.symptom_triage_assessments
      (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen,
       category, clinician_review_required, safety_net_message_key, rationale)
    values (p_org, p_patient, 'headache', (select min(version) from public.triage_protocols), '{}', '[]', '{}', v_cat::public.triage_category, false, 'routine', 'S60 audit proof')
    returning id into v_a;
    insert into public.symptom_reviews
      (organisation_id, assessment_id, patient_id, status, recorded_by, protocol_version, clinician_id, final_diagnosis_code, clinician_category, agrees, patient_message, reviewed_at, is_test)
    values (p_org, v_a, p_patient, 'completed', p_patient, (select min(version) from public.triage_protocols), p_clinician, 'G43.9', v_clin::public.triage_category,
            (v_cat = v_clin), 'Your care team reviewed this check.', p_month_start + interval '10 days' + (i || ' minutes')::interval, p_review_is_test);
  end loop;
end $f$;

-- S59b: this proof uses children as fixtures (age bands, a carer's check for a child). The age gate itself is proven in s59b_children_members_and_closed_staff_read.sql, so it is switched off here (inside the rolled-back transaction only).
alter table public.symptom_triage_assessments disable trigger symptom_triage_assessments_01_age_gate;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid;
  v_lagos uuid; v_edo uuid; v_kano uuid; v_testp uuid;
  v_m1 date := (date_trunc('month', now()) - interval '1 month')::date;
  v_m2 date := (date_trunc('month', now()) - interval '2 month')::date;
  v_r1 uuid; v_r1b uuid; v_r2 uuid; v_rt uuid; v_rep public.symptom_accuracy_reports%rowtype; v_c jsonb; v_cell jsonb; v_n integer; v_r text; v_w numeric[];
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  if not exists (select 1 from public.triage_protocols) then raise exception 'fixture: need a triage_protocols row'; end if;
  -- an EMPTY month is recorded but is never the baseline: it must not satisfy the go-live condition (and must not use up the baseline)
  v_rt := private.run_symptom_accuracy_audit(v_org, (date_trunc('month', now()) - interval '6 month')::date, false, null);
  if (select is_baseline from public.symptom_accuracy_reports where id = v_rt) or (select reviewed_total from public.symptom_accuracy_reports where id = v_rt) <> 0 then
    raise exception 'FAIL 1g: an empty month became the baseline';
  end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkstaff(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_doc := pg_temp.mkstaff(v_org, v_admin, 'doctor', 'medical_officer');
  -- three groups of patients: Lagos adult female (12 reviews), Edo older male (11), Kano child male (7: below the minimum of 10)
  v_lagos := pg_temp.mkuser(v_org, 'lagos', 'patient', (current_date - interval '30 years')::date, 'female', 'Lagos');
  v_edo   := pg_temp.mkuser(v_org, 'edo', 'patient', (current_date - interval '70 years')::date, 'male', 'Edo');
  v_kano  := pg_temp.mkuser(v_org, 'kano', 'patient', (current_date - interval '8 years')::date, 'male', 'Kano');
  v_testp := pg_temp.mkuser(v_org, 'testacct', 'patient', null, 'female', 'Lagos');

  -- month 1: lagos 12 (9 match, 2 under, 1 over), edo 11 (10 match, 0 under, 1 over), kano 7 (4 match, 3 under); one test-account review as well
  perform pg_temp.cohort(v_org, v_lagos, v_doc, v_m1, 12, 9, 2);
  perform pg_temp.cohort(v_org, v_edo, v_doc, v_m1, 11, 10, 0);
  perform pg_temp.cohort(v_org, v_kano, v_doc, v_m1, 7, 4, 3);
  perform pg_temp.cohort(v_org, v_testp, v_doc, v_m1, 2, 2, 0, true);
  -- the patients become real accounts now that their assessments exist (the checker is closed for real patients)
  update public.profiles set is_test = false where id in (v_lagos, v_edo, v_kano);

  -- 1. the monthly job writes for the previous month, once; the first report is the baseline
  if private.run_symptom_accuracy_audit_monthly() < 1 then raise exception 'FAIL 1a: the monthly job produced no report for an organisation with reviews'; end if;
  select * into v_rep from public.symptom_accuracy_reports where organisation_id = v_org and period_start = v_m1 and not includes_test_accounts;
  if v_rep.id is null then raise exception 'FAIL 1b: no report for the previous month'; end if;
  if not v_rep.is_baseline then raise exception 'FAIL 1c: the first report with data is not marked as the baseline (an earlier empty month must not take it)'; end if;
  v_r1 := v_rep.id;
  if private.run_symptom_accuracy_audit(v_org, v_m1, false, null) <> v_r1 then raise exception 'FAIL 1d: a second run made a different report'; end if;
  if (select count(*) from public.symptom_accuracy_reports where organisation_id = v_org and period_start = v_m1) <> 1 then raise exception 'FAIL 1e: a second run duplicated the report'; end if;

  -- 2. the numbers (30 reviewed by real accounts: 23 matched, 5 under, 2 over; test account excluded)
  if v_rep.reviewed_total <> 30 then raise exception 'FAIL 2a: reviewed_total % (expected 30, the test-account reviews excluded)', v_rep.reviewed_total; end if;
  select c into v_cell from jsonb_array_elements(v_rep.cells) c where c ->> 'dimension' = 'overall';
  if (v_cell ->> 'n')::int <> 30 or (v_cell ->> 'matched')::int <> 23 or (v_cell ->> 'under')::int <> 5 or (v_cell ->> 'over')::int <> 2 then
    raise exception 'FAIL 2b: overall cell wrong: %', v_cell;
  end if;
  if not ((v_cell ->> 'match_low')::numeric < (v_cell ->> 'match_rate')::numeric and (v_cell ->> 'match_rate')::numeric < (v_cell ->> 'match_high')::numeric) then
    raise exception 'FAIL 2c: the interval does not bracket the rate: %', v_cell;
  end if;
  v_w := private.wilson_interval(5, 10, 0.95);
  if v_w <> array[0.2366, 0.7634] then raise exception 'FAIL 2d: wilson(5,10) = %', v_w; end if;

  -- 3. test accounts: excluded above; a deliberate include makes a separate, marked report
  v_rt := private.run_symptom_accuracy_audit(v_org, v_m1, true, v_admin);
  if v_rt = v_r1 then raise exception 'FAIL 3a: the include-test report replaced the real one'; end if;
  select * into v_rep from public.symptom_accuracy_reports where id = v_rt;
  if not v_rep.includes_test_accounts or v_rep.reviewed_total <> 32 then raise exception 'FAIL 3b: include-test report wrong (% reviewed, flag %)', v_rep.reviewed_total, v_rep.includes_test_accounts; end if;

  -- 4. suppression: region Kano has 7 (< 10): suppressed with no counts; Edo (11, the smallest remaining) is suppressed with it; Lagos shows
  select * into v_rep from public.symptom_accuracy_reports where id = v_r1;
  select c into v_cell from jsonb_array_elements(v_rep.cells) c where c ->> 'dimension' = 'region' and c ->> 'group' = 'Kano';
  if not (v_cell ->> 'suppressed')::boolean or v_cell ? 'n' or v_cell ? 'match_rate' then raise exception 'FAIL 4a: the 7-case cell is not suppressed or leaks: %', v_cell; end if;
  select c into v_cell from jsonb_array_elements(v_rep.cells) c where c ->> 'dimension' = 'region' and c ->> 'group' = 'Edo';
  if not (v_cell ->> 'suppressed')::boolean then raise exception 'FAIL 4b: no complementary suppression, Kano is recoverable by subtraction'; end if;
  select c into v_cell from jsonb_array_elements(v_rep.cells) c where c ->> 'dimension' = 'region' and c ->> 'group' = 'Lagos';
  if (v_cell ->> 'suppressed')::boolean or (v_cell ->> 'n')::int <> 12 then raise exception 'FAIL 4c: the large cell should show: %', v_cell; end if;
  select c into v_cell from jsonb_array_elements(v_rep.cells) c where c ->> 'dimension' = 'age_band' and c ->> 'group' = '5-17';
  if not (v_cell ->> 'suppressed')::boolean then raise exception 'FAIL 4d: the age band 5-17 (7 cases) is not suppressed'; end if;

  -- 5. aggregate only; never publishable; permanent
  if v_rep.cells::text ~* ('(' || v_lagos || '|' || v_edo || '|' || v_kano || '|' || v_doc || ')') then raise exception 'FAIL 5a: a person id is inside a report'; end if;
  if pg_temp.try(format($q$insert into public.symptom_accuracy_reports (organisation_id, period_start, period_end, config_version, is_baseline, reviewed_total, cells, publishable)
       values (%L, '2020-01-01', '2020-02-01', 1, false, 0, '[]', true)$q$, v_org)) <> '23514' then
    raise exception 'FAIL 5b: a publishable report could be inserted';
  end if;
  if pg_temp.try(format('update public.symptom_accuracy_reports set reviewed_total = 1 where id = %L', v_r1)) <> '42501' then raise exception 'FAIL 5c: a report could be edited'; end if;
  if pg_temp.try(format('delete from public.symptom_accuracy_reports where id = %L', v_r1)) <> '42501' then raise exception 'FAIL 5d: a report could be deleted'; end if;

  -- 6. access
  perform pg_temp.act(v_admin);
  if pg_temp.scalar('select count(id) from public.symptom_accuracy_reports')::int < 1 then raise exception 'FAIL 6a: the admin cannot read reports'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  if pg_temp.scalar('select count(id) from public.symptom_accuracy_reports')::int < 1 then raise exception 'FAIL 6b: the CMO cannot read reports'; end if;
  perform pg_temp.back();
  foreach v_r in array array['patient', 'doctor'] loop
    perform pg_temp.act(case v_r when 'patient' then v_lagos else v_doc end);
    if pg_temp.scalar('select count(id) from public.symptom_accuracy_reports') <> '0' then raise exception 'FAIL 6c: % can read an accuracy report', v_r; end if;
    if pg_temp.try('select public.run_symptom_accuracy_audit_now(date ''2025-01-01'')') <> '42501' then raise exception 'FAIL 6d: % can run the audit', v_r; end if;
    perform pg_temp.back();
  end loop;
  perform pg_temp.act_anon();
  if pg_temp.try('select count(id) from public.symptom_accuracy_reports') <> '42501' then raise exception 'FAIL 6e: anon can read reports'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  if pg_temp.try(format('select public.run_symptom_accuracy_audit_now(%L)', date_trunc('month', now())::date)) <> '22023' then raise exception 'FAIL 6f: an unfinished month was accepted'; end if;
  if pg_temp.try(format('select public.run_symptom_accuracy_audit_now(%L)', v_m1)) <> 'ok' then raise exception 'FAIL 6g: the admin could not run the audit for a finished month'; end if;
  perform pg_temp.back();
  if (select count(*) from public.symptom_accuracy_reports where organisation_id = v_org and period_start = v_m1 and not includes_test_accounts) <> 1 then
    raise exception 'FAIL 6h: the admin run duplicated the report';
  end if;

  -- month 2 is not the baseline (the checker is closed for real accounts, so flip them to test while their assessments are written)
  update public.profiles set is_test = true where id in (v_lagos, v_edo, v_kano);
  perform pg_temp.cohort(v_org, v_lagos, v_doc, v_m2, 12, 9, 2);
  update public.profiles set is_test = false where id in (v_lagos, v_edo, v_kano);
  v_r2 := private.run_symptom_accuracy_audit(v_org, v_m2, false, v_admin);
  if (select is_baseline from public.symptom_accuracy_reports where id = v_r2) then raise exception 'FAIL 1f: the second report is also marked baseline'; end if;
  -- (the baseline is the earliest GENERATED report, month 1 was generated first)

  -- SABOTAGE (a): lower the minimum cell size to 5 and audit a month where Kano has 7: the cell must now show
  update public.profiles set is_test = true where id in (v_lagos, v_edo, v_kano);
  perform pg_temp.cohort(v_org, v_kano, v_doc, (date_trunc('month', now()) - interval '3 month')::date, 7, 4, 3);
  perform pg_temp.cohort(v_org, v_edo, v_doc, (date_trunc('month', now()) - interval '3 month')::date, 11, 10, 0);
  perform pg_temp.cohort(v_org, v_lagos, v_doc, (date_trunc('month', now()) - interval '3 month')::date, 12, 9, 2);
  update public.profiles set is_test = false where id in (v_lagos, v_edo, v_kano);
  update public.symptom_accuracy_config set config = jsonb_set(config, '{min_cell_size}', '5') where is_active;
  v_rt := private.run_symptom_accuracy_audit(v_org, (date_trunc('month', now()) - interval '3 month')::date, false, v_admin);
  select c into v_cell from public.symptom_accuracy_reports r, jsonb_array_elements(r.cells) c where r.id = v_rt and c ->> 'dimension' = 'region' and c ->> 'group' = 'Kano';
  if (v_cell ->> 'suppressed')::boolean then raise exception 'VACUOUS TEST (a): with the minimum lowered to 5 the 7-case cell was still suppressed'; end if;
  update public.symptom_accuracy_config set config = jsonb_set(config, '{min_cell_size}', '10') where is_active;
  -- SABOTAGE (b): drop the publishable CHECK
  alter table public.symptom_accuracy_reports drop constraint symptom_accuracy_reports_publishable_check;
  if pg_temp.try(format($q$insert into public.symptom_accuracy_reports (organisation_id, period_start, period_end, config_version, is_baseline, reviewed_total, cells, publishable)
       values (%L, '2020-01-01', '2020-02-01', 1, false, 0, '[]', true)$q$, v_org)) <> 'ok' then
    raise exception 'VACUOUS TEST (b): with the CHECK dropped a publishable report was still refused';
  end if;
  -- SABOTAGE (c): drop the immutability trigger
  drop trigger symptom_accuracy_reports_00_immutable on public.symptom_accuracy_reports;
  if pg_temp.try(format('update public.symptom_accuracy_reports set reviewed_total = 1 where id = %L', v_r1)) <> 'ok' then
    raise exception 'VACUOUS TEST (c): with the trigger dropped a report was still refused';
  end if;

  raise notice 'PASS: accuracy audit: baseline once, correct counts and intervals, test accounts excluded, small and complementary cells suppressed, never publishable, permanent, role matrix';
end $$;

rollback;
