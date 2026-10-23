-- ===========================================================================
-- Proof: 20261023175612_wp3_cascade_of_care_and_selection_panel.sql (WP3; INV-10, INV-13, INV-16, invariant I9; S75a single minimum-cell rule).
--
--   1. DORMANT UNTIL SIGNED: the seeded config is inactive and unsigned; with nothing signed every cascade and the pack's cascade and panel say
--      "awaiting_cmo_signature" and show no number. Only the Chief Medical Officer signs (an admin, a clinician, a patient are refused); a signed
--      config cannot be edited, re-signed, or inserted active.
--   2. THE CASCADE (hypertension, diabetes): enrolled -> screened -> diagnosed -> on treatment -> controlled, counted from real tables, exact numbers
--      for a fixture. Test accounts, minors and pregnant members are left out. People on treatment whose control cannot be read are UNKNOWN (kept in
--      the figure), never uncontrolled and never dropped. A stage whose difference from its parent is 1 to minimum-1 people is withheld.
--      A programme under the minimum is withheld whole.
--   3. THE SELECTION PANEL: who is in the figures against other Members; the "joined but did not agree" comparison is internal only (the sponsor
--      pack says not_shown_to_sponsors); the intent-to-treat view counts everyone who joined, shows missing as missing and splits the people whose
--      membership ended from those still a Member; the fixed descriptive-not-causal note is present; the eligible roster is "not available".
--   4. ROLES: admin and CMO can read; a clinician, a patient, sponsor staff and anon cannot (42501 / no execute). No clinician appears as a key.
--   5. PACK: the sponsor pack carries both, passes the causal-wording check, and the wording check still refuses a causal claim.
--   6. SCANS: no hand-written minimum comparison, every new function has an explicit search_path, none is executable by anon.
--   6b. REVIEW FIXES: the 7-day control window ends on the report day (readings 85 days old but controlled are UNKNOWN); only a valid reading, or one that
--      waits only for a missing arm or position, counts (an empty flag list does not make a reading usable); the cascade and the panel run with no
--      temporary table (stable functions); the sponsor audience carries neither attribute comparison.
--   7. SABOTAGE: suppress_cell / suppress_difference replaced by versions that never withhold; the withheld checks must FLIP. A proof that cannot fail
--      is not a proof.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. The platform minimum is lowered to 3 on the active outcome_config under test.
-- ===========================================================================
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sk(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
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
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
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
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;

create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Africa/Lagos')::date $$;
create function pg_temp.at_day(d date, h integer default 9) returns timestamptz language sql as $$ select (d::timestamp + make_interval(hours => h)) at time zone 'Africa/Lagos' $$;
create function pg_temp.a0() returns date language sql as $$ select pg_temp.today() - 200 $$;

create function pg_temp.mkuser(p_label text, p_role text, p_dob date default null, p_sex text default 'female', p_test boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'wp3-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, sex)
  values (v, v_org, p_role::public.user_role, 'WP3 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          coalesce(p_dob, (current_date - interval '50 years')::date), p_test, p_sex::public.sex)
  on conflict (id) do update set role = excluded.role, is_active = true, is_test = excluded.is_test, phone = excluded.phone, sex = excluded.sex, full_name = excluded.full_name, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
-- a Member who joined p_ago days back through p_source
create function pg_temp.mkmember(p_label text, p_ago integer default 200, p_source text default 'purchase', p_dob date default null, p_sex text default 'female', p_test boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_label, 'patient', p_dob, p_sex, p_test); v_org uuid := (select organisation_id from public.profiles where id = v);
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, is_test) values (v_org, v, p_source, pg_temp.at_day(pg_temp.today() - p_ago, 8), p_test);
  return v;
end $f$;
create function pg_temp.bp(p uuid, p_days_ago integer, p_s integer, p_d integer, p_n integer default 3) returns void language plpgsql as
$f$ begin
  for k in 0 .. p_n - 1 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values ((select organisation_id from public.profiles where id = p), p, 'blood_pressure', p_s, p_d, pg_temp.at_day(pg_temp.today() - p_days_ago + k, 9), 'device');
  end loop;
end $f$;
create function pg_temp.bpv(p uuid, p_days_ago integer, p_s integer, p_d integer, p_n integer, p_status text, p_flags text[]) returns void language plpgsql as
$f$ begin
  set local session_replication_role = replica;   -- the validation trigger would overwrite the status and flags we want to fix
  for k in 0 .. p_n - 1 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, validation_status, validation_flags)
    values ((select organisation_id from public.profiles where id = p), p, 'blood_pressure', p_s, p_d, pg_temp.at_day(pg_temp.today() - p_days_ago + k, 9), 'device', p_status::public.vitals_validation_status, p_flags);
  end loop;
  set local session_replication_role = origin;
end $f$;
create function pg_temp.plan(p uuid, p_cond text, p_med boolean) returns void language plpgsql as
$f$ declare v_org uuid := (select organisation_id from public.profiles where id = p); v_cp uuid;
begin
  insert into public.care_plans (organisation_id, patient_id, condition, status) values (v_org, p, p_cond::public.care_plan_condition, 'active') returning id into v_cp;
  if p_med is not null then
    insert into public.medications (organisation_id, patient_id, care_plan_id, drug_name, is_active) values (v_org, p, v_cp, 'WP3 medicine', p_med);
  end if;
end $f$;
create function pg_temp.hba(p uuid, p_value numeric, p_days_ago integer) returns void language sql as
$$ insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
   values ((select organisation_id from public.profiles where id = p), p, 'hba1c', p_value, 'percent', pg_temp.at_day(pg_temp.today() - p_days_ago)) $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 0. Fixtures
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_sp uuid; v_ver uuid; v_ph uuid; v_pd uuid; v_ps uuid; p uuid; i integer; a date := pg_temp.a0(); v_cmo uuid;
begin
  perform pg_temp.setf('admin', pg_temp.mkuser('admin', 'admin'));
  perform pg_temp.setf('clin', pg_temp.mkuser('clin', 'clinician'));
  perform pg_temp.setf('patient', pg_temp.mkuser('patient', 'patient'));
  v_cmo := pg_temp.mkuser('cmo', 'clinician');
  perform pg_temp.setf('cmo', v_cmo);

  set local session_replication_role = replica;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, status, doctor_tier, languages, license_verified_at, license_expires_at, specialty, indemnity_exempt, indemnity_exempt_by)
  values (v_org, v_cmo, 'WP3 CMO', true, true, 'active', 'chief_medical_officer', array['en'], now() - interval '3 days', now() + interval '1 year', 'General practice', true, pg_temp.f('admin'));
  perform pg_temp.setf('sponsor_staff', pg_temp.mkuser('sponsor-staff', 'corporate_admin'));
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '3') where is_active;
  set local session_replication_role = origin;

  -- the sponsor's own floor is lowered to 3 for the fixture (the table check is dropped inside this rolled-back transaction only)
  alter table public.organisations drop constraint organisations_min_cohort_size_check;
  insert into public.organisations (name, type, min_cohort_size) values ('WP3 Sponsor Corp', 'corporate', 3) returning id into v_sp;
  update public.profiles set organisation_id = v_sp where id = pg_temp.f('sponsor_staff');
  update public.consent_versions set is_current = true where consent_type = 'sponsor_reporting' and version = '2026-10-07-draft';
  select id into v_ver from public.consent_versions where consent_type = 'sponsor_reporting' and is_current limit 1;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses) values (v_org, v_sp, 'WP3 hypertension programme', 'WP3AAAA2', current_date - 400, current_date + 30, 100) returning id into v_ph;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses) values (v_org, v_sp, 'WP3 diabetes programme', 'WP3AAAA3', current_date - 400, current_date + 30, 100) returning id into v_pd;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses) values (v_org, v_sp, 'WP3 tiny programme', 'WP3AAAA4', current_date - 400, current_date + 30, 100) returning id into v_ps;
  perform pg_temp.setf('ph', v_ph); perform pg_temp.setf('pd', v_pd); perform pg_temp.setf('ps', v_ps);

  -- HYPERTENSION programme: 18 adult Members who agreed (H1..H18), anchor 200 days ago, in one calendar month.
  --   H1-H5 treated and controlled (recent 125/80); H6-H8 treated and uncontrolled (recent 150/95); H9-H11 treated, only old readings (control unknown);
  --   H12-H14 diagnosed, medicine stopped (not on treatment); H15-H17 no diagnosis but a reading; H18 nothing.
  for i in 1 .. 18 loop
    p := pg_temp.mkmember('H' || i, 200, case when i in (4, 5, 6) then 'voucher' else 'purchase' end, null, case when i % 2 = 0 then 'male' else 'female' end);
    perform pg_temp.setf('H' || i, p);
    if i <= 17 then perform pg_temp.bp(p, 200, case when i <= 5 then 125 when i between 12 and 14 then 165 else 150 end, case when i <= 5 then 80 when i between 12 and 14 then 105 else 95 end); end if;  -- baseline week
    if i <= 14 then perform pg_temp.plan(p, 'hypertension', case when i <= 11 then true else false end); end if;
    if i <= 5 then perform pg_temp.bp(p, 3, 125, 80); perform pg_temp.bp(p, 112, 125, 80); end if;       -- recent, and the day-90 window (a0+88..90)
    if i between 6 and 8 then perform pg_temp.bp(p, 3, 150, 95); perform pg_temp.bp(p, 112, 150, 95); end if;
    insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, reporting_consent, consented_at, consent_version_id) values (v_org, p, v_ph, true, now(), v_ver);
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, p, 'sponsor_reporting', v_ver, '2026-10-07-draft', 'accepted');
  end loop;
  -- H9-H11: the membership ended (they dropped out)
  update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'WP3 fixture: ended' where patient_id in (pg_temp.f('H9'), pg_temp.f('H10'), pg_temp.f('H11'));
  -- not counted: a child, a pregnant adult (both agreed, diagnosed, treated, controlled) and a test account (not in any programme)
  p := pg_temp.mkmember('X-child', 200);
  set local session_replication_role = replica;
  update public.profiles set date_of_birth = (current_date - interval '10 years')::date where id = p;   -- registration is adults only; a child can only arrive as a dependent
  set local session_replication_role = origin;
  perform pg_temp.plan(p, 'hypertension', true); perform pg_temp.bp(p, 3, 120, 75);
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, reporting_consent, consented_at, consent_version_id) values (v_org, p, v_ph, true, now(), v_ver);
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, p, 'sponsor_reporting', v_ver, '2026-10-07-draft', 'accepted');
  p := pg_temp.mkmember('X-pregnant', 200);
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, p, true);
  perform pg_temp.plan(p, 'hypertension', true); perform pg_temp.bp(p, 3, 120, 75);
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, reporting_consent, consented_at, consent_version_id) values (v_org, p, v_ph, true, now(), v_ver);
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, p, 'sponsor_reporting', v_ver, '2026-10-07-draft', 'accepted');
  p := pg_temp.mkmember('X-test', 200, 'purchase', null, 'female', true);
  perform pg_temp.plan(p, 'hypertension', true); perform pg_temp.bp(p, 3, 120, 75);
  perform pg_temp.setf('xtest', p);
  -- joined the hypertension programme but did not agree to share (4): internal comparison only
  for i in 1 .. 4 loop
    p := pg_temp.mkmember('NA' || i, 200, 'employer', null, 'male');
    insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, reporting_consent) values (v_org, p, v_ph, false);
  end loop;

  -- DIABETES programme: 10 Members who agreed. D1-D4 HbA1c 6.5 (controlled), D5-D7 HbA1c 8.5 (uncontrolled), D8-D10 no result (control unknown, not screened)
  for i in 1 .. 10 loop
    p := pg_temp.mkmember('D' || i, 200);
    perform pg_temp.setf('D' || i, p);
    perform pg_temp.plan(p, 'diabetes', true);
    if i <= 4 then perform pg_temp.hba(p, 6.5, 10); elsif i <= 7 then perform pg_temp.hba(p, 8.5, 10); end if;
    insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, reporting_consent, consented_at, consent_version_id) values (v_org, p, v_pd, true, now(), v_ver);
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, p, 'sponsor_reporting', v_ver, '2026-10-07-draft', 'accepted');
  end loop;

  -- TINY programme: 2 Members who agreed (under the minimum of 3)
  for i in 1 .. 2 loop
    p := pg_temp.mkmember('T' || i, 200);
    perform pg_temp.plan(p, 'hypertension', true); perform pg_temp.bp(p, 3, 125, 80);
    insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, reporting_consent, consented_at, consent_version_id) values (v_org, p, v_ps, true, now(), v_ver);
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, p, 'sponsor_reporting', v_ver, '2026-10-07-draft', 'accepted');
  end loop;

  -- THE REVIEW CASES (not in any programme): each is diagnosed and on a medicine, and each is judged on the readings alone.
  --   O1 three controlled readings, 85 days old (the old rule anchored the window on the person's own last reading and called this controlled)
  --   O2 three recent controlled readings, status requires_validation with an EMPTY flag list (an empty list is a subset of everything: not usable)
  --   O3 three recent controlled readings, requires_validation ONLY for insufficient_context (usable)
  --   O4 three recent controlled readings, requires_validation for sudden_change (not usable)
  --   O5 two recent controlled readings (fewer than the minimum of 3 in the window)
  --   O6 three recent readings at 150/95 (uncontrolled: the control)
  --   O7 three recent controlled readings, requires_validation for insufficient_context AND sudden_change (not usable)
  for i in 1 .. 7 loop
    p := pg_temp.mkmember('O' || i, 200);
    perform pg_temp.setf('O' || i, p);
    perform pg_temp.plan(p, 'hypertension', true);
  end loop;
  perform pg_temp.bp(pg_temp.f('O1'), 85, 125, 80);
  perform pg_temp.bpv(pg_temp.f('O2'), 3, 125, 80, 3, 'requires_validation', '{}'::text[]);
  perform pg_temp.bpv(pg_temp.f('O3'), 3, 125, 80, 3, 'requires_validation', array['insufficient_context']);
  perform pg_temp.bpv(pg_temp.f('O4'), 3, 125, 80, 3, 'requires_validation', array['sudden_change']);
  perform pg_temp.bp(pg_temp.f('O5'), 2, 125, 80, 2);
  perform pg_temp.bp(pg_temp.f('O6'), 3, 150, 95);
  perform pg_temp.bpv(pg_temp.f('O7'), 3, 125, 80, 3, 'requires_validation', array['insufficient_context', 'sudden_change']);

  perform private.compute_outcome_snapshots(now());
end $$;

-- state of one review case after the cascade: screened / control_state ('-' when not on treatment)
create function pg_temp.case_of(p_label text) returns text language sql as
$$ select r.screened::text || '/' || coalesce(r.control_state, '-') from private.cascade_people('hypertension', private.cascade_config(), array[pg_temp.f(p_label)], null, null) r $$;

create function pg_temp.review_cases(p_phase text) returns void language plpgsql as
$f$ begin
  perform pg_temp.sk(p_phase, '2n readings 85 days old, all controlled: the member is UNKNOWN, not controlled (window ends on the report day)', 'true/unknown', pg_temp.case_of('O1'));
  perform pg_temp.sk(p_phase, '2o requires_validation with an EMPTY flag list is not usable: not screened, control unknown', 'false/unknown', pg_temp.case_of('O2'));
  perform pg_temp.sk(p_phase, '2p requires_validation ONLY for insufficient_context is usable: screened and controlled', 'true/controlled', pg_temp.case_of('O3'));
  perform pg_temp.sk(p_phase, '2q requires_validation for sudden_change is not usable: not screened, control unknown', 'false/unknown', pg_temp.case_of('O4'));
  perform pg_temp.sk(p_phase, '2r two readings in the last 7 days (fewer than the minimum 3): control unknown', 'true/unknown', pg_temp.case_of('O5'));
  perform pg_temp.sk(p_phase, '2s three recent readings at 150/95: uncontrolled (control case, so the checks above are not vacuous)', 'true/uncontrolled', pg_temp.case_of('O6'));
  perform pg_temp.sk(p_phase, '2t insufficient_context together with another flag is not usable', 'false/unknown', pg_temp.case_of('O7'));
end $f$;

create function pg_temp.members(p_prefix text) returns uuid[] language sql as
$$ select coalesce(array_agg(id order by full_name), '{}') from public.profiles where full_name ~ ('^WP3 ' || p_prefix || '[0-9]+$') $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Dormant until signed
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  perform pg_temp.ck('1a the seeded config is unsigned and inactive', 'false/false/1', (select is_active::text || '/' || (approved_at is not null)::text || '/' || count(*)::text from public.outcome_cascade_config group by is_active, approved_at));
  r := pg_temp.q_as(pg_temp.f('admin'), $q$ select public.cascade_of_care_report('hypertension')::text $q$)::jsonb;
  perform pg_temp.ck('1b unsigned: the report withholds everything', 'true/awaiting_cmo_signature', coalesce(r ->> 'withheld', 'null') || '/' || coalesce(r ->> 'reason', 'null'));
  perform pg_temp.ck('1c unsigned: the report carries no total', 'false', (r ? 'total')::text);
  r := pg_temp.q_as(pg_temp.f('admin'), format($q$ select public.sponsor_pilot_pack(%L)::text $q$, pg_temp.f('ph')))::jsonb;
  perform pg_temp.ck('1d unsigned: the pack withholds the cascade', 'true', (r #> '{pack,cascade_of_care,hypertension,withheld}')::text);
  perform pg_temp.ck('1e unsigned: the pack withholds the selection panel', 'awaiting_cmo_signature', r #>> '{pack,selection_panel,reason}');
  perform pg_temp.ck('1f an admin cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('admin'), $q$ select public.sign_outcome_cascade_config(1)::text $q$));
  perform pg_temp.ck('1g a clinician who is not the CMO cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('clin'), $q$ select public.sign_outcome_cascade_config(1)::text $q$));
  perform pg_temp.ck('1h a patient cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('patient'), $q$ select public.sign_outcome_cascade_config(1)::text $q$));
  perform pg_temp.ck('1i anon cannot sign', '42501', pg_temp.try_anon($q$ select public.sign_outcome_cascade_config(1) $q$));
  perform pg_temp.ck('1j a config cannot be created active or signed', '42501', pg_temp.try($q$ insert into public.outcome_cascade_config (version, is_active, effective_from, config, approved_at) values (2, false, current_date, '{}', now()) $q$));
  perform pg_temp.ck('1k the CMO signs', '', coalesce(pg_temp.q_as(pg_temp.f('cmo'), $q$ select public.sign_outcome_cascade_config(1)::text $q$), 'null'));
  perform pg_temp.ck('1l it is now active and signed by the CMO', 'true/true', (select is_active::text || '/' || (approved_by = pg_temp.f('cmo'))::text from public.outcome_cascade_config where version = 1));
  perform pg_temp.ck('1m signing again is refused', 'ERR:23514', pg_temp.q_as(pg_temp.f('cmo'), $q$ select public.sign_outcome_cascade_config(1)::text $q$));
  perform pg_temp.ck('1n a signed config cannot be edited', '23514', pg_temp.try($q$ update public.outcome_cascade_config set config = config || '{"x":1}'::jsonb where version = 1 $q$));
  perform pg_temp.ck('1o a signed config cannot be deleted', '23514', pg_temp.try($q$ delete from public.outcome_cascade_config where version = 1 $q$));
  perform pg_temp.ck('1p the signature is audited', '1', (select count(*)::text from public.audit_log where action = 'outcome_cascade_config.signed' and actor_id = pg_temp.f('cmo')));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2 to 5. The checks that the sabotage run repeats (phase real, then sabotaged)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.surfaces(p_phase text) returns void language plpgsql as
$f$
declare
  r jsonb; st jsonb; stage jsonb; ph uuid[] := pg_temp.members('H'); pd uuid[] := pg_temp.members('D'); tiny uuid[] := pg_temp.members('T');
  ph_ids uuid[]; v_i jsonb;
begin
  -- the 18 Members of the hypertension programme, plus the child and the pregnant adult who agreed too
  select array_agg(pc.patient_id) into ph_ids from public.profile_cohorts pc where pc.cohort_id = pg_temp.f('ph') and pc.reporting_consent;
  r := private.cascade_aggregate('hypertension', ph_ids, null, null, null);
  st := r -> 'total' -> 'stages';
  perform pg_temp.sk(p_phase, '2a hypertension: enrolled counts the 18 adults (not the child, not the pregnant adult)', '18', (st -> 0 ->> 'n'));
  perform pg_temp.sk(p_phase, '2b hypertension: screened is 17 but 18 - 17 = 1 is a small difference, so it is withheld', 'true/small_difference', coalesce(st -> 1 ->> 'suppressed', 'null') || '/' || coalesce(st -> 1 ->> 'reason', 'null'));
  perform pg_temp.sk(p_phase, '2c hypertension: diagnosed 14 of 18', '14', st -> 2 ->> 'n');
  perform pg_temp.sk(p_phase, '2d hypertension: on a recorded medicine 11 (3 diagnosed people whose medicine stopped are not)', '11', st -> 3 ->> 'n');
  perform pg_temp.sk(p_phase, '2e hypertension: controlled 5, a share of those on treatment', '5/45.5', (st -> 4 ->> 'n') || '/' || (st -> 4 ->> 'pct_of_step'));
  perform pg_temp.sk(p_phase, '2f hypertension: control among treated is 5 controlled, 3 uncontrolled, 3 unknown (missing kept, not dropped)', '5/3/3',
    (select string_agg(x ->> 'n', '/' order by case x ->> 'key' when 'controlled' then 1 when 'uncontrolled' then 2 else 3 end) from jsonb_array_elements(r -> 'total' -> 'control_among_treated') x));
  perform pg_temp.sk(p_phase, '2g the report states what it cannot give', 'Population screening coverage', r #>> '{not_available,0,item}');
  perform pg_temp.sk(p_phase, '2h the report says it is not a population', 'true', (r ->> 'note' ~ 'not of a population')::text);

  r := private.cascade_aggregate('diabetes', pd, null, null, null);
  st := r -> 'total' -> 'stages';
  perform pg_temp.sk(p_phase, '2i diabetes: 10 enrolled, 7 screened, 10 diagnosed, 10 on a medicine, 4 controlled', '10/7/10/10/4',
    (st -> 0 ->> 'n') || '/' || (st -> 1 ->> 'n') || '/' || (st -> 2 ->> 'n') || '/' || (st -> 3 ->> 'n') || '/' || (st -> 4 ->> 'n'));
  perform pg_temp.sk(p_phase, '2j diabetes: 4 controlled, 3 uncontrolled, 3 unknown (no HbA1c in 180 days)', '4/3/3',
    (select string_agg(x ->> 'n', '/' order by case x ->> 'key' when 'controlled' then 1 when 'uncontrolled' then 2 else 3 end) from jsonb_array_elements(r -> 'total' -> 'control_among_treated') x));

  r := private.cascade_aggregate('hypertension', tiny, null, null, null);
  perform pg_temp.sk(p_phase, '2k a programme under the minimum (2 people) is withheld whole', 'true/under_minimum', coalesce(r #>> '{total,suppressed}', 'null') || '/' || coalesce(r #>> '{total,reason}', 'null'));

  -- the public wrapper reads every Member (no programme): a test account must not be counted
  perform pg_temp.sk(p_phase, '2l a test account is never in the cascade', '0', (select count(*)::text from private.cascade_people('hypertension', private.cascade_config(), array[pg_temp.f('xtest')], null, null)));
  perform pg_temp.sk(p_phase, '2m a child and a pregnant adult are never in the cascade', '0', (select count(*)::text from private.cascade_people('hypertension', private.cascade_config(), (select array_agg(id) from public.profiles where full_name in ('WP3 X-child', 'WP3 X-pregnant')), null, null)));

  -- the panel, sponsor audience
  r := private.selection_panel_build(pg_temp.f('ph'), null, null, false, null);
  perform pg_temp.sk(p_phase, '3a the panel counts the 18 who are in the figures', '18', r #>> '{who_is_in_the_figures,in_figures}');
  perform pg_temp.sk(p_phase, '3b sponsor audience: NEITHER attribute comparison is shown', 'not_shown_to_sponsors/not_shown_to_sponsors', (r #>> '{comparisons,in_figures_vs_joined_not_agreed,reason}') || '/' || (r #>> '{comparisons,in_figures_vs_other_members,reason}'));
  perform pg_temp.sk(p_phase, '3b2 sponsor audience: no attribute or category appears anywhere in the panel', 'false', (r::text ~ '"attributes"|"categories"|"age_band"')::text);
  perform pg_temp.sk(p_phase, '3c the eligible roster is stated as not available', 'false', r #>> '{eligible_roster,available}');
  perform pg_temp.sk(p_phase, '3d the fixed descriptive-not-causal note is present', 'true', (r ->> 'note' ~ '^These comparisons are descriptive, not causal')::text);
  perform pg_temp.sk(p_phase, '3e seats are named as seats, not eligible people', 'true', (r #>> '{seats,note}' ~ 'not a count of the people who were eligible')::text);
  v_i := r -> 'intent_to_treat_and_completers' -> 'day_90';
  perform pg_temp.sk(p_phase, '3f intent to treat day 90: everyone who joined = 18, all 18 due', '18/18', (v_i #>> '{everyone_who_joined,n}') || '/' || (v_i #>> '{intent_to_treat,n}'));
  perform pg_temp.sk(p_phase, '3g intent to treat day 90: 5 controlled, 3 uncontrolled, 10 with no usable reading (missing shown, not dropped)', '5/3/10', (v_i #>> '{intent_to_treat,controlled}') || '/' || (v_i #>> '{intent_to_treat,uncontrolled}') || '/' || (v_i #>> '{intent_to_treat,insufficient_data}'));
  perform pg_temp.sk(p_phase, '3h strict rate counts missing as not controlled (27.8) beside the completers rate (62.5)', '27.8/62.5', (v_i #>> '{intent_to_treat,rate_strict_pct}') || '/' || (v_i #>> '{completers_only,rate_pct}'));
  perform pg_temp.sk(p_phase, '3i missing is split: 3 whose membership ended, 7 still a Member', '3/7',
    (select max(x ->> 'n') filter (where x ->> 'key' = 'membership_ended') || '/' || max(x ->> 'n') filter (where x ->> 'key' = 'still_a_member_no_reading') from jsonb_array_elements(v_i -> 'missing_split') x));
  perform pg_temp.sk(p_phase, '3j day 180: nobody has a reading in the window, so all 18 are missing and the completers rate is not given', '0/18/null',
    (r #>> '{intent_to_treat_and_completers,day_180,intent_to_treat,controlled}') || '/' || (r #>> '{intent_to_treat_and_completers,day_180,intent_to_treat,insufficient_data}') || '/' || coalesce(r #>> '{intent_to_treat_and_completers,day_180,completers_only,rate_pct}', 'null'));
  -- internal audience: both comparisons are given
  r := private.selection_panel_build(pg_temp.f('ph'), null, null, true, null);
  perform pg_temp.sk(p_phase, '3k internal audience: the comparison with people who did not agree is given (18 against 4)', '18/4',
    (r #>> '{comparisons,in_figures_vs_joined_not_agreed,result,group_a_total}') || '/' || (r #>> '{comparisons,in_figures_vs_joined_not_agreed,result,group_b_total}'));
  perform pg_temp.sk(p_phase, '3k2 internal audience: the comparison with other Members is given (18 against more than 3)', 'true',
    ((r #>> '{comparisons,in_figures_vs_other_members,result,group_a_total}')::integer = 18 and (r #>> '{comparisons,in_figures_vs_other_members,result,group_b_total}')::integer >= 3)::text);
end
$f$;

select pg_temp.surfaces('real');
select pg_temp.review_cases('real');

do $$
declare r jsonb; v_keys text; v_bad text;
begin
  -- 3l a category in the panel: sex among the 18 (9 female, 9 male), both shown, as numbers and shares (internal audience: the sponsor pack has no attribute comparison)
  r := private.selection_panel_build(pg_temp.f('ph'), null, null, true, null);
  perform pg_temp.ck('3l panel: sex among those in the figures is 9 and 9', '9/9',
    (select string_agg(c #>> '{group_a,n}', '/' order by c ->> 'category') from jsonb_array_elements(r #> '{comparisons,in_figures_vs_other_members,result,attributes}') a, jsonb_array_elements(a -> 'categories') c where a ->> 'attribute' = 'sex'));
  perform pg_temp.ck('3m panel: how people joined among those in the figures (15 purchase, 3 voucher)', '15/3',
    (select string_agg(c #>> '{group_a,n}', '/' order by c ->> 'category') from jsonb_array_elements(r #> '{comparisons,in_figures_vs_other_members,result,attributes}') a, jsonb_array_elements(a -> 'categories') c where a ->> 'attribute' = 'channel'));
  perform pg_temp.ck('3n panel: baseline blood pressure band includes the people with no baseline average (missing shown as a category)', 'true',
    exists (select 1 from jsonb_array_elements(r #> '{comparisons,in_figures_vs_other_members,result,attributes}') a, jsonb_array_elements(a -> 'categories') c where a ->> 'attribute' = 'baseline_bp' and c ->> 'category' = 'no baseline average')::text);

  -- 4. roles
  perform pg_temp.ck('4a admin reads the hypertension cascade', 'ok', case when (pg_temp.q_as(pg_temp.f('admin'), $q$ select public.cascade_of_care_report('hypertension')::text $q$)::jsonb) ? 'total' then 'ok' else 'no' end);
  perform pg_temp.ck('4b the CMO reads the diabetes cascade', 'ok', case when (pg_temp.q_as(pg_temp.f('cmo'), $q$ select public.cascade_of_care_report('diabetes')::text $q$)::jsonb) ? 'total' then 'ok' else 'no' end);
  perform pg_temp.ck('4c a clinician who is not the CMO is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('clin'), $q$ select public.cascade_of_care_report('hypertension')::text $q$));
  perform pg_temp.ck('4d a patient is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('patient'), $q$ select public.cascade_of_care_report('hypertension')::text $q$));
  perform pg_temp.ck('4e sponsor staff (aggregate-only institutions) are refused the cascade', 'ERR:42501', pg_temp.q_as(pg_temp.f('sponsor_staff'), $q$ select public.cascade_of_care_report('hypertension')::text $q$));
  perform pg_temp.ck('4f sponsor staff are refused the selection panel', 'ERR:42501', pg_temp.q_as(pg_temp.f('sponsor_staff'), format($q$ select public.selection_panel_report(%L)::text $q$, pg_temp.f('ph'))));
  perform pg_temp.ck('4g a patient is refused the selection panel', 'ERR:42501', pg_temp.q_as(pg_temp.f('patient'), format($q$ select public.selection_panel_report(%L)::text $q$, pg_temp.f('ph'))));
  perform pg_temp.ck('4h anon cannot run either report', '42501/42501', pg_temp.try_anon($q$ select public.cascade_of_care_report('hypertension') $q$) || '/' || pg_temp.try_anon(format($q$ select public.selection_panel_report(%L) $q$, pg_temp.f('ph'))));
  perform pg_temp.ck('4i an unknown condition is refused', 'ERR:22023', pg_temp.q_as(pg_temp.f('admin'), $q$ select public.cascade_of_care_report('asthma')::text $q$));
  perform pg_temp.ck('4j admin reads the internal panel, which includes the did-not-agree comparison', 'internal', (pg_temp.q_as(pg_temp.f('admin'), format($q$ select public.selection_panel_report(%L)::text $q$, pg_temp.f('ph')))::jsonb) ->> 'audience');
  perform pg_temp.ck('4k each report read is audited', '3/1', (select count(*) filter (where action = 'outcomes.cascade_report')::text || '/' || count(*) filter (where action = 'outcomes.selection_panel')::text from public.audit_log where actor_id in (pg_temp.f('admin'), pg_temp.f('cmo')) and action in ('outcomes.cascade_report', 'outcomes.selection_panel')) );

  -- 5. no clinician anywhere: no key names a clinician, doctor, tier or assignee, in the panel, the cascade or the pack
  r := pg_temp.q_as(pg_temp.f('admin'), format($q$ select public.sponsor_pilot_pack(%L)::text $q$, pg_temp.f('ph')))::jsonb;
  perform pg_temp.ck('5a the pack is issued and its wording check passed', 'true/true', (r ->> 'ok') || '/' || (r #>> '{wording_check,passed}'));
  perform pg_temp.ck('5b the pack carries the cascade for both conditions', 'true/true', (r #> '{pack,cascade_of_care,hypertension,total,stages}' is not null)::text || '/' || (r #> '{pack,cascade_of_care,diabetes,total,stages}' is not null)::text);
  perform pg_temp.ck('5c the pack carries the selection panel at the sponsor audience', 'sponsor', r #>> '{pack,selection_panel,audience}');
  select string_agg(distinct k, ', ') into v_keys from (select (regexp_matches(r::text, '"([a-z_0-9]*(clinician|doctor|tier|assigned|reviewer|claimed)[a-z_0-9]*)"\s*:', 'g'))[1] k) q;
  perform pg_temp.ck('5d no key in the pack names a clinician', 'none', coalesce(v_keys, 'none'));
  perform pg_temp.ck('5e the pack never lists a person or an id', 'none', case when r::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then 'a uuid appears' else 'none' end);
  perform pg_temp.ck('5f the pack carries no attribute comparison at all, neither with people who declined nor with other Members', 'false', (r::text ~ '"attributes"|"categories"|"group_b_is"')::text);
  perform pg_temp.ck('5g a causal claim is still refused by the wording check', '1', cardinality(private.causal_wording_hits('The programme caused the fall in blood pressure.'))::text);
  perform pg_temp.ck('5h the fixed note is allowed because it states a limit', '0', cardinality(private.causal_wording_hits(private.cascade_config() #>> '{selection_panel,note}'))::text);
  perform pg_temp.ck('5i the pack for the tiny programme withholds the cascade and the panel', 'under_minimum/under_minimum',
    (pg_temp.q_as(pg_temp.f('admin'), format($q$ select public.sponsor_pilot_pack(%L)::text $q$, pg_temp.f('ps')))::jsonb) #>> '{pack,cascade_of_care,reason}' || '/' || ((pg_temp.q_as(pg_temp.f('admin'), format($q$ select public.sponsor_pilot_pack(%L)::text $q$, pg_temp.f('ps')))::jsonb) #>> '{pack,selection_panel,reason}'));
end $$;

-- 6. scans
do $$
begin
  perform pg_temp.ck('2u wp3_reading_usable: valid is usable', 'true', private.wp3_reading_usable('valid', '{}'::text[])::text);
  perform pg_temp.ck('2v wp3_reading_usable: requires_validation with no flags is NOT usable', 'false', private.wp3_reading_usable('requires_validation', '{}'::text[])::text);
  perform pg_temp.ck('2w wp3_reading_usable: requires_validation with a null flag list is NOT usable', 'false', private.wp3_reading_usable('requires_validation', null)::text);
  perform pg_temp.ck('2x wp3_reading_usable: only insufficient_context is usable', 'true/false', private.wp3_reading_usable('requires_validation', array['insufficient_context'])::text || '/' || private.wp3_reading_usable('requires_validation', array['insufficient_context', 'duplicate_entry'])::text);
  -- 6f/6g: no temporary table anywhere in the new code, and the report functions are STABLE, so they run in a read-only transaction
  perform pg_temp.ck('6f no new function creates a temporary table', 'none',
    coalesce((select string_agg(p.proname, ', ') from pg_proc p where p.pronamespace = 'private'::regnamespace and (p.proname like 'cascade\_%' or p.proname like 'selection\_%' or p.proname like 'wp3\_%') and p.prosrc ~* '(create +(global +|local +)?temp(orary)? +table|pg_temp\.)'), 'none'));
  perform pg_temp.ck('6g the cascade and panel builders are STABLE', 'none',
    coalesce((select string_agg(p.proname, ', ') from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('cascade_people', 'cascade_aggregate', 'cascade_stages_json', 'selection_attrs', 'selection_compare', 'selection_itt', 'selection_panel_build') and p.provolatile <> 's'), 'none'));
  -- 6h the sponsor pack differs from S75c only by the cascade and selection additions: every S75c key is still there
  perform pg_temp.ck('6h the pack keeps every S75c key', 'true',
    (select bool_and(k in (select jsonb_object_keys((pg_temp.q_as(pg_temp.f('admin'), format($q$ select public.sponsor_pilot_pack(%L)::text $q$, pg_temp.f('ph')))::jsonb) -> 'pack')))
       from unnest(array['cover', 'evaluation_design', 'caveat', 'group_figures', 'retention_and_engagement', 'clinical_measures', 'not_a_causal_claim']) k)::text);
end $$;

do $$
declare v_hand text; v_nosp text; v_anon text; v_fns text[] := array['private.cascade_people', 'private.cascade_stages_json', 'private.cascade_aggregate', 'private.selection_attrs', 'private.selection_compare', 'private.selection_itt', 'private.selection_panel_build', 'private.cascade_config', 'public.cascade_of_care_report', 'public.selection_panel_report', 'public.sign_outcome_cascade_config'];
begin
  select string_agg(s, ', ') into v_hand from unnest(v_fns) s
   where exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and p.prosrc ~* '(between 1 and|>= *v_min\M|< *v_min\M|< *p_min\M|>= *p_min\M|min_cohort_size *[<>])');
  perform pg_temp.ck('6a no new function compares a count with the minimum by hand', 'none', coalesce(v_hand, 'none'));
  select string_agg(s, ', ') into v_nosp from unnest(v_fns) s
   where exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and not (coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']));
  perform pg_temp.ck('6b every new function sets an explicit empty search_path', 'none', coalesce(v_nosp, 'none'));
  select string_agg(s, ', ') into v_anon from unnest(v_fns) s
   where exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and has_function_privilege('anon', p.oid, 'EXECUTE'));
  perform pg_temp.ck('6c anon can execute none of them', 'none', coalesce(v_anon, 'none'));
  perform pg_temp.ck('6d the private ones are not executable by a signed-in user', 'none',
    coalesce((select string_agg(s, ', ') from unnest(v_fns) s where s like 'private.%' and exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and has_function_privilege('authenticated', p.oid, 'EXECUTE'))), 'none'));
  perform pg_temp.ck('6e no new function names a clinician column', 'none',
    coalesce((select string_agg(s, ', ') from unnest(v_fns) s where exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and p.prosrc ~* '(responsible_clinician|assigned_clinician|claimed_by|clinical_staff|doctor_tier)' and s not in ('public.sign_outcome_cascade_config'))), 'none'));
end $$;

-- 7a. SABOTAGE of the review fixes: (i) the window is widened to 100 days, so 85-day-old readings count again (2n must flip); (ii) the usable-reading rule is the
--     old looser form, so an empty flag list counts again (2o must flip); (iii) any requires_validation reading counts (2q and 2t must flip as well)
set local session_replication_role = replica;
update public.outcome_cascade_config set config = jsonb_set(config, '{hypertension,control_window_days}', '100') where version = 1;
set local session_replication_role = origin;
select pg_temp.review_cases('sabotaged-window');
set local session_replication_role = replica;
update public.outcome_cascade_config set config = jsonb_set(config, '{hypertension,control_window_days}', '7') where version = 1;
set local session_replication_role = origin;
create or replace function private.wp3_reading_usable(p_status public.vitals_validation_status, p_flags text[]) returns boolean
language sql immutable set search_path = '' as $$ select p_status = 'valid' or coalesce(p_flags, '{}'::text[]) <@ array['insufficient_context']::text[] $$;
select pg_temp.review_cases('sabotaged-flags');
create or replace function private.wp3_reading_usable(p_status public.vitals_validation_status, p_flags text[]) returns boolean
language sql immutable set search_path = '' as $$ select true $$;
select pg_temp.review_cases('sabotaged-any');
create or replace function private.wp3_reading_usable(p_status public.vitals_validation_status, p_flags text[]) returns boolean
language sql immutable set search_path = '' as $$ select p_status = 'valid' or (p_status = 'requires_validation' and cardinality(coalesce(p_flags, '{}'::text[])) > 0 and p_flags <@ array['insufficient_context']::text[]) $$;

-- 7. SABOTAGE: the helpers stop withholding; the withheld checks must flip
create or replace function private.suppress_cell(p_n bigint, p_categories bigint[] default null, p_min integer default null) returns text
language sql stable security definer set search_path = '' as $$ select case when p_n > 0 then null::text else 'under_minimum' end $$;
create or replace function private.suppress_difference(p_whole bigint, p_part bigint, p_min integer default null) returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;
select pg_temp.surfaces('sabotaged');

do $$
declare v_bad integer; v_flipped integer; v_names text;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'WP3 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  -- 2b (small difference) and 2k (tiny programme) must flip when the helpers never withhold
  select count(*), string_agg(check_name, '; ') into v_flipped, v_names from results s
   where s.phase = 'sabotaged' and s.expected is distinct from s.actual and s.check_name ~ '^(2b|2k)';
  if v_flipped < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 withheld checks (%)', v_flipped, v_names; end if;
  select count(*) into v_flipped from results s where s.phase = 'sabotaged-window' and s.expected is distinct from s.actual and s.check_name ~ '^2n';
  if v_flipped < 1 then raise exception 'VACUOUS TEST: widening the window did not flip 2n'; end if;
  select count(*) into v_flipped from results s where s.phase = 'sabotaged-flags' and s.expected is distinct from s.actual and s.check_name ~ '^2o';
  if v_flipped < 1 then raise exception 'VACUOUS TEST: the old looser rule did not flip 2o (empty flag list)'; end if;
  select count(*), string_agg(check_name, '; ') into v_flipped, v_names from results s where s.phase = 'sabotaged-any' and s.expected is distinct from s.actual and s.check_name ~ '^(2o|2q|2t)';
  if v_flipped < 3 then raise exception 'VACUOUS TEST: counting every reading flipped % of 3 flag checks (%)', v_flipped, v_names; end if;
end $$;

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
select 'SABOTAGE ' || check_name as check_name, expected, actual, case when expected is distinct from actual then 'PASS' else 'FAIL' end as result
  from results where (phase = 'sabotaged' and check_name ~ '^(2b|2k)') or (phase = 'sabotaged-window' and check_name ~ '^2n') or (phase = 'sabotaged-flags' and check_name ~ '^2o') or (phase = 'sabotaged-any' and check_name ~ '^(2o|2q|2t)') order by check_name;

rollback;
