-- ===========================================================================
-- Proof: 20261028061453_d3_bp_control_by_medicine_adjustment.sql (D3: hypertension control split by whether a doctor adjusted the medicine; WP3 cascade snapshot;
-- S75a single minimum-cell rule; invariant I9).
--
--   1. DORMANT UNTIL SIGNED: the seeded config is inactive and unsigned; until the CMO signs it the report says awaiting_cmo_signature, and until the CMO has
--      signed the cascade definitions too it says cascade_not_signed; neither shows a number. Only the Chief Medical Officer signs (an admin, a clinician, a
--      patient, anon are refused); a signed config cannot be edited, re-signed, deleted or inserted active.
--   2. THE SPLIT: exact numbers for a fixture. An amendment by a clinician and a confirmed plan change inside the window count as adjusted; an amendment older
--      than the window, a plan change that was only signed (not confirmed by the person) and a person with no change do not. People diagnosed but not on a
--      recorded medicine are a separate figure and in neither group; people on a medicine with no usable readings in the last 7 days are control unknown inside
--      their group, never dropped, never controlled.
--   3. THE ONE MINIMUM-CELL RULE: a month with a small adjusted group withholds it together with its neighbour; the treated total is withheld while a group is;
--      a group of zero is shown as zero.
--   4. ROLES: admin and CMO can read; a clinician who is not the CMO, a patient and anon cannot. No person, clinician or drug appears in the output. Audited.
--   5. SCANS: no clinician column in any function body; no hand-written minimum comparison; explicit search_path; anon cannot execute.
--   6. SABOTAGE: the window widened (the older amendment is then adjusted); "adjusted" made true for everyone; the withholding helpers made to never withhold.
--      The checks that depend on each must flip. A proof that cannot fail is not a proof.
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
create function pg_temp.j_as(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := jsonb_build_object('err', sqlstate); end;
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

create function pg_temp.mkuser(p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'd3-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, sex)
  values (v, v_org, p_role::public.user_role, 'D3 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, false, 'female')
  on conflict (id) do update set role = excluded.role, is_active = true, is_test = excluded.is_test, phone = excluded.phone, sex = excluded.sex, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkmember(p_label text, p_ago integer) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_label, 'patient'); v_org uuid := (select organisation_id from public.profiles where id = v);
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, is_test) values (v_org, v, 'purchase', pg_temp.at_day(pg_temp.today() - p_ago, 8), false);
  return v;
end $f$;
create function pg_temp.bp(p uuid, p_days_ago integer, p_s integer, p_d integer, p_n integer default 3) returns void language plpgsql as
$f$ begin
  for k in 0 .. p_n - 1 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values ((select organisation_id from public.profiles where id = p), p, 'blood_pressure', p_s, p_d, pg_temp.at_day(pg_temp.today() - p_days_ago + k, 9), 'device');
  end loop;
end $f$;
-- diagnosed (an active hypertension care plan); p_med = true puts a current medicine on it, false a stopped one
create function pg_temp.plan(p uuid, p_med boolean) returns void language plpgsql as
$f$ declare v_org uuid := (select organisation_id from public.profiles where id = p); v_cp uuid;
begin
  insert into public.care_plans (organisation_id, patient_id, condition, status) values (v_org, p, 'hypertension', 'active') returning id into v_cp;
  insert into public.medications (organisation_id, patient_id, care_plan_id, drug_name, is_active) values (v_org, p, v_cp, 'D3 medicine', p_med);
end $f$;
-- a clinician amended the medicine p_ago days back: the old row is superseded, a new version is written by a clinician
create function pg_temp.amend(p uuid, p_ago integer) returns void language plpgsql as
$f$ declare v_org uuid := (select organisation_id from public.profiles where id = p); v_cp uuid; v_old uuid;
begin
  select id into v_cp from public.care_plans where patient_id = p and condition = 'hypertension' limit 1;
  select id into v_old from public.medications where patient_id = p and care_plan_id = v_cp order by created_at limit 1;
  set local session_replication_role = replica;
  update public.medications set is_active = false, superseded_at = pg_temp.at_day(pg_temp.today() - p_ago) where id = v_old;
  insert into public.medications (organisation_id, patient_id, care_plan_id, drug_name, is_active, version, previous_version_id, amendment_reason, created_at)
  values (v_org, p, v_cp, 'D3 medicine v2', true, 2, v_old, 'D3 dose change', pg_temp.at_day(pg_temp.today() - p_ago));
  set local session_replication_role = origin;
end $f$;
-- a signed medication plan change; p_state confirmed = the person confirmed and it was applied p_ago days back
create function pg_temp.plan_change(p uuid, p_ago integer, p_state text, p_action text default 'change') returns void language plpgsql as
$f$ declare v_org uuid := (select organisation_id from public.profiles where id = p); v_cp uuid;
begin
  select id into v_cp from public.care_plans where patient_id = p and condition = 'hypertension' limit 1;
  set local session_replication_role = replica;
  insert into public.care_plan_changes (organisation_id, patient_id, care_plan_id, kind, proposed_by, proposal, rationale, patient_summary, state,
                                        signed_by, signed_at, patient_confirmed_at, applied_at)
  values (v_org, p, v_cp, 'medication', 'clinician', jsonb_build_object('action', p_action), 'D3 fixture', 'D3 fixture summary', p_state,
          pg_temp.f('admin'), pg_temp.at_day(pg_temp.today() - p_ago),
          case when p_state = 'confirmed' then pg_temp.at_day(pg_temp.today() - p_ago) end,
          case when p_state = 'confirmed' then pg_temp.at_day(pg_temp.today() - p_ago) end);
  set local session_replication_role = origin;
end $f$;
create function pg_temp.grp(p_report jsonb, p_key text, p_field text) returns text language sql as
$$ select p_report #>> array[p_key, p_field] $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 0. Fixtures (hypertension; the main group joined 200 days ago, the small month group 100 days ago)
--   A1-A3  amended 10 days ago, controlled (recent 125/80)        -> adjusted, controlled
--   B1-B3  confirmed plan change 20 days ago, uncontrolled        -> adjusted, uncontrolled
--   C1-C3  amended 120 days ago (outside the 90 day window)       -> not adjusted, controlled
--   D1-D3  nothing changed, controlled                            -> not adjusted, controlled
--   E1-E3  nothing changed, uncontrolled                          -> not adjusted, uncontrolled
--   F1-F3  nothing changed, only old readings                     -> not adjusted, control unknown
--   G1-G3  plan change only SIGNED (not confirmed), uncontrolled  -> not adjusted, uncontrolled
--   H1-H4  diagnosed, medicine stopped                            -> not on a recorded medicine (neither group)
--   Y1-Y2  (joined 100 days ago) amended 5 days ago, controlled   -> adjusted, controlled        } their own month
--   Y3-Y5  (joined 100 days ago) nothing changed, controlled      -> not adjusted, controlled    }
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_cmo uuid; p uuid; i integer;
begin
  perform pg_temp.setf('admin', pg_temp.mkuser('admin', 'admin'));
  perform pg_temp.setf('clin', pg_temp.mkuser('clin', 'clinician'));
  perform pg_temp.setf('patient', pg_temp.mkuser('patient', 'patient'));
  v_cmo := pg_temp.mkuser('cmo', 'clinician');
  perform pg_temp.setf('cmo', v_cmo);
  set local session_replication_role = replica;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, status, doctor_tier, languages, license_verified_at, license_expires_at, specialty, indemnity_exempt, indemnity_exempt_by)
  values (v_org, v_cmo, 'D3 CMO', true, true, 'active', 'chief_medical_officer', array['en'], now() - interval '3 days', now() + interval '1 year', 'General practice', true, pg_temp.f('admin'));
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '3') where is_active;
  set local session_replication_role = origin;

  for i in 1 .. 3 loop
    p := pg_temp.mkmember('A' || i, 200); perform pg_temp.plan(p, true); perform pg_temp.bp(p, 3, 125, 80); perform pg_temp.amend(p, 10);
    p := pg_temp.mkmember('B' || i, 200); perform pg_temp.plan(p, true); perform pg_temp.bp(p, 3, 150, 95); perform pg_temp.plan_change(p, 20, 'confirmed');
    p := pg_temp.mkmember('C' || i, 200); perform pg_temp.plan(p, true); perform pg_temp.bp(p, 3, 125, 80); perform pg_temp.amend(p, 120);
    p := pg_temp.mkmember('D' || i, 200); perform pg_temp.plan(p, true); perform pg_temp.bp(p, 3, 125, 80);
    p := pg_temp.mkmember('E' || i, 200); perform pg_temp.plan(p, true); perform pg_temp.bp(p, 3, 150, 95);
    p := pg_temp.mkmember('F' || i, 200); perform pg_temp.plan(p, true); perform pg_temp.bp(p, 85, 125, 80);
    p := pg_temp.mkmember('G' || i, 200); perform pg_temp.plan(p, true); perform pg_temp.bp(p, 3, 150, 95); perform pg_temp.plan_change(p, 15, 'signed');
  end loop;
  for i in 1 .. 4 loop p := pg_temp.mkmember('H' || i, 200); perform pg_temp.plan(p, false); perform pg_temp.bp(p, 3, 125, 80); end loop;
  for i in 1 .. 2 loop p := pg_temp.mkmember('Y' || i, 100); perform pg_temp.plan(p, true); perform pg_temp.bp(p, 3, 125, 80); perform pg_temp.amend(p, 5); end loop;
  for i in 3 .. 5 loop p := pg_temp.mkmember('Y' || i, 100); perform pg_temp.plan(p, true); perform pg_temp.bp(p, 3, 125, 80); end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Dormant until signed, and who signs
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('1a the seeded config is version 1, inactive and unsigned', '1|false|false',
    (select version::text || '|' || is_active::text || '|' || (approved_at is not null)::text from public.outcome_adjustment_config order by version limit 1));
  perform pg_temp.ck('1b an admin gets awaiting_cmo_signature and no figure', 'awaiting_cmo_signature|false',
    coalesce(pg_temp.j_as(pg_temp.f('admin'), $q$ select public.bp_control_by_adjustment_report() $q$) ->> 'reason', 'x') || '|' ||
    (pg_temp.j_as(pg_temp.f('admin'), $q$ select public.bp_control_by_adjustment_report() $q$) ? 'adjusted')::text);
  perform pg_temp.ck('1c an admin cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('admin'), $q$ select public.sign_outcome_adjustment_config(1)::text $q$));
  perform pg_temp.ck('1d a clinician who is not the CMO cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('clin'), $q$ select public.sign_outcome_adjustment_config(1)::text $q$));
  perform pg_temp.ck('1e a patient cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('patient'), $q$ select public.sign_outcome_adjustment_config(1)::text $q$));
  perform pg_temp.ck('1f anon cannot sign', '42501', pg_temp.try_anon($q$ select public.sign_outcome_adjustment_config(1) $q$));
  perform pg_temp.ck('1g a new config cannot be inserted active', '42501',
    pg_temp.try($q$ insert into public.outcome_adjustment_config (version, is_active, effective_from, config) values (2, true, current_date, '{}'::jsonb) $q$));
  perform pg_temp.ck('1h the CMO signs', '', coalesce(pg_temp.q_as(pg_temp.f('cmo'), $q$ select public.sign_outcome_adjustment_config(1)::text $q$), 'null'));
  perform pg_temp.ck('1i signed, active, approved by the CMO', 'true|true',
    (select is_active::text || '|' || (approved_by = pg_temp.f('cmo'))::text from public.outcome_adjustment_config where version = 1));
  perform pg_temp.ck('1j signing again is refused', 'ERR:23514', pg_temp.q_as(pg_temp.f('cmo'), $q$ select public.sign_outcome_adjustment_config(1)::text $q$));
  perform pg_temp.ck('1k a signed config cannot be edited', '23514', pg_temp.try($q$ update public.outcome_adjustment_config set config = '{}'::jsonb where version = 1 $q$));
  perform pg_temp.ck('1l a version is never deleted', '23514', pg_temp.try($q$ delete from public.outcome_adjustment_config where version = 1 $q$));
  perform pg_temp.ck('1m with this signed but the cascade definitions not, the report says cascade_not_signed and shows no figure', 'cascade_not_signed|false',
    coalesce(pg_temp.j_as(pg_temp.f('admin'), $q$ select public.bp_control_by_adjustment_report() $q$) ->> 'reason', 'x') || '|' ||
    (pg_temp.j_as(pg_temp.f('admin'), $q$ select public.bp_control_by_adjustment_report() $q$) ? 'adjusted')::text);
  -- the CMO signs the cascade definitions too; signing runs the nightly snapshot once
  perform pg_temp.ck('1n the CMO signs the cascade definitions (the snapshot runs)', '', coalesce(pg_temp.q_as(pg_temp.f('cmo'), $q$ select public.sign_outcome_cascade_config(1)::text $q$), 'null'));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. The split, and 3. the minimum-cell rule
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.figures(p_phase text) returns void language plpgsql as
$f$
declare
  r jsonb := pg_temp.j_as(pg_temp.f('admin'), $q$ select public.bp_control_by_adjustment_report() $q$);
  c jsonb := pg_temp.j_as(pg_temp.f('cmo'), $q$ select public.bp_control_by_adjustment_report() $q$);
  y jsonb := pg_temp.j_as(pg_temp.f('admin'), format($q$ select public.bp_control_by_adjustment_report(%L::date, %L::date) $q$, pg_temp.today() - 100, pg_temp.today() - 100));
begin
  perform pg_temp.sk(p_phase, '2a adjusted: 8 people (A, B, Y1, Y2), 5 controlled, 3 uncontrolled, none unknown', '8|5|3|0',
    (r #>> '{adjusted,n}') || '|' || (r #>> '{adjusted,controlled}') || '|' || (r #>> '{adjusted,uncontrolled}') || '|' || (r #>> '{adjusted,control_unknown}'));
  perform pg_temp.sk(p_phase, '2b not adjusted: 18 people (C, D, E, F, G, Y3 to Y5), 9 controlled, 6 uncontrolled, 3 unknown', '18|9|6|3',
    (r #>> '{not_adjusted,n}') || '|' || (r #>> '{not_adjusted,controlled}') || '|' || (r #>> '{not_adjusted,uncontrolled}') || '|' || (r #>> '{not_adjusted,control_unknown}'));
  perform pg_temp.sk(p_phase, '2c an amendment 120 days ago is outside the 90 day window (C is not adjusted): adjusted holds exactly the 8', '8', r #>> '{adjusted,n}');
  perform pg_temp.sk(p_phase, '2d a plan change that was only signed, not confirmed by the person, does not count (G): uncontrolled not adjusted is 6 = E + G', '6', r #>> '{not_adjusted,uncontrolled}');
  perform pg_temp.sk(p_phase, '2e rates: adjusted 62.5 strict, not adjusted 50.0 strict, 60.0 among those with a reading, 16.7 missing', '62.5|50.0|60.0|16.7',
    (r #>> '{adjusted,rate_strict_pct}') || '|' || (r #>> '{not_adjusted,rate_strict_pct}') || '|' || (r #>> '{not_adjusted,rate_among_known_pct}') || '|' || (r #>> '{not_adjusted,missing_pct}'));
  perform pg_temp.sk(p_phase, '2f the total on a recorded medicine is shown when both groups are, and is their sum', '26', r #>> '{on_recorded_medicine,n}');
  perform pg_temp.sk(p_phase, '2g people diagnosed but not on a recorded medicine are their own figure (H1 to H4), in neither group', '4|false',
    (r #>> '{not_on_recorded_medicine,n}') || '|' || (r #>> '{not_on_recorded_medicine,suppressed}'));
  perform pg_temp.sk(p_phase, '2h the CMO reads the same figures', '8|18', (c #>> '{adjusted,n}') || '|' || (c #>> '{not_adjusted,n}'));
  perform pg_temp.sk(p_phase, '2i the definition, the window and the as-at day come with the figures', '90|true',
    (r ->> 'window_days') || '|' || ((r ->> 'as_at') = pg_temp.today()::text)::text);
  perform pg_temp.sk(p_phase, '2j the limitation line says the people not on a medicine and those with no readings are shown separately, and the fixed note is present', 'true|true|none|true',
    ((r ->> 'limitations') ~ 'not on a recorded medicine are shown separately')::text || '|' || ((r ->> 'note') ~ 'descriptive, not causal')::text || '|' || (r ->> 'comparison_group') || '|' || (r ->> 'not_a_causal_claim'));
  -- the small month: 2 adjusted (a small cell) and 3 not adjusted
  perform pg_temp.sk(p_phase, '3a a month with 2 adjusted people withholds that group (under the minimum)', 'true', coalesce(y #>> '{adjusted,suppressed}', 'null'));
  perform pg_temp.sk(p_phase, '3b ...and withholds its neighbour too, so the small group cannot be got by subtraction', 'true', coalesce(y #>> '{not_adjusted,suppressed}', 'null'));
  perform pg_temp.sk(p_phase, '3c ...and the total on a medicine is withheld while a group is', 'true|a_group_is_withheld', coalesce(y #>> '{on_recorded_medicine,suppressed}', 'null') || '|' || coalesce(y #>> '{on_recorded_medicine,reason}', 'null'));
  perform pg_temp.sk(p_phase, '3d a figure of zero (nobody diagnosed without a medicine in that month) is shown as zero, not withheld', '0|false',
    coalesce(y #>> '{not_on_recorded_medicine,n}', 'null') || '|' || coalesce(y #>> '{not_on_recorded_medicine,suppressed}', 'null'));
  perform pg_temp.sk(p_phase, '3e withheld figures carry no number', 'false', (y #> '{adjusted}' ? 'controlled')::text);
end $f$;
select pg_temp.figures('real');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. Roles, the output, the audit trail
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('4a a clinician who is not the CMO is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('clin'), $q$ select public.bp_control_by_adjustment_report()::text $q$));
  perform pg_temp.ck('4b a patient is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('patient'), $q$ select public.bp_control_by_adjustment_report()::text $q$));
  perform pg_temp.ck('4c anon cannot execute', 'false', has_function_privilege('anon', 'public.bp_control_by_adjustment_report(date,date)', 'EXECUTE')::text);
  perform pg_temp.ck('4d no person, clinician or drug appears in the output (no id-shaped text, no drug name)', 'false',
    (pg_temp.j_as(pg_temp.f('admin'), $q$ select public.bp_control_by_adjustment_report() $q$)::text ~* '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|D3 medicine)')::text);
  perform pg_temp.ck('4e the report is audited with the admin as the actor', 'true',
    (exists (select 1 from public.audit_log where action = 'outcomes.bp_control_by_adjustment_report' and actor_id = pg_temp.f('admin')))::text);
  perform pg_temp.ck('4f the config table is not readable by a patient or a non-CMO clinician', '0|0',
    coalesce(pg_temp.q_as(pg_temp.f('patient'), 'select count(*)::text from public.outcome_adjustment_config'), 'null') || '|' ||
    coalesce(pg_temp.q_as(pg_temp.f('clin'), 'select count(*)::text from public.outcome_adjustment_config'), 'null'));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Scans
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_fns text[] := array['private.hypertension_medicine_adjusted', 'private.adjustment_group_json', 'private.adjustment_config', 'public.bp_control_by_adjustment_report', 'public.sign_outcome_adjustment_config', 'private.outcome_adjustment_config_guard'];
        v_clin text; v_hand text; v_nosp text; v_anon text;
begin
  select string_agg(s, ', ') into v_clin from unnest(v_fns) s
   where exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and p.prosrc ~* '(responsible_clinician|assigned_clinician|claimed_by|clinical_staff|doctor_tier|proposed_by_user|signed_by|rejected_by)');
  perform pg_temp.ck('5a no clinician column is read by any function added here', 'none', coalesce(v_clin, 'none'));
  select string_agg(s, ', ') into v_hand from unnest(v_fns) s
   where exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and p.prosrc ~* '(between 1 and|>= *v_min\M|< *v_min\M|< *p_min\M|>= *p_min\M|min_cohort_size *[<>])');
  perform pg_temp.ck('5b no hand-written minimum comparison', 'none', coalesce(v_hand, 'none'));
  select string_agg(s, ', ') into v_nosp from unnest(v_fns) s
   where not exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and p.proconfig is not null and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  perform pg_temp.ck('5c every function sets an explicit search_path', 'none', coalesce(v_nosp, 'none'));
  select string_agg(s, ', ') into v_anon from unnest(v_fns) s
   where exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and has_function_privilege('anon', p.oid, 'EXECUTE'));
  perform pg_temp.ck('5d anon can execute none of them', 'none', coalesce(v_anon, 'none'));
  perform pg_temp.ck('5e the report reads the cascade snapshot and a person-level table is not exposed: no new table holds a patient id', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'outcome_adjustment_config' and column_name = 'patient_id'));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. SABOTAGE
-- ---------------------------------------------------------------------------------------------------------------------------------
-- (i) the window widened to 150 days: the 120 day old amendment becomes "adjusted", so 2a, 2b and 2c must flip
set local session_replication_role = replica;
update public.outcome_adjustment_config set config = jsonb_set(config, '{adjustment_window_days}', '150') where version = 1;
set local session_replication_role = origin;
select pg_temp.figures('sabotaged-window');
set local session_replication_role = replica;
update public.outcome_adjustment_config set config = jsonb_set(config, '{adjustment_window_days}', '90') where version = 1;
set local session_replication_role = origin;

-- (ii) "adjusted" true for everyone: 2a and 2b must flip
create or replace function private.hypertension_medicine_adjusted(p_patient uuid, p_cfg jsonb, p_on date) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;
select pg_temp.figures('sabotaged-all');

-- (iii) the withholding helpers never withhold: 3a, 3b and 3c must flip
create or replace function private.suppress_cell(p_n bigint, p_categories bigint[] default null, p_min integer default null) returns text
language sql stable security definer set search_path = '' as $$ select null::text $$;
create or replace function private.suppress_groups(p_groups jsonb, p_min integer default null) returns jsonb
language sql stable security definer set search_path = ''
as $$ select coalesce(jsonb_agg(g || jsonb_build_object('suppressed', false, 'reason', null)), '[]'::jsonb) from jsonb_array_elements(p_groups) g $$;
select pg_temp.figures('sabotaged-cell');

do $$
declare v_bad integer; v_flipped integer; v_names text;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'D3 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*), string_agg(check_name, '; ') into v_flipped, v_names from results s
   where s.phase = 'sabotaged-window' and s.expected is distinct from s.actual and s.check_name ~ '^2(a|b|c)';
  if v_flipped < 3 then raise exception 'VACUOUS TEST: widening the window flipped % of 3 checks (%)', v_flipped, v_names; end if;
  select count(*), string_agg(check_name, '; ') into v_flipped, v_names from results s
   where s.phase = 'sabotaged-all' and s.expected is distinct from s.actual and s.check_name ~ '^2(a|b)';
  if v_flipped < 2 then raise exception 'VACUOUS TEST: treating everyone as adjusted flipped % of 2 checks (%)', v_flipped, v_names; end if;
  select count(*), string_agg(check_name, '; ') into v_flipped, v_names from results s
   where s.phase = 'sabotaged-cell' and s.expected is distinct from s.actual and s.check_name ~ '^3(a|b|c)';
  if v_flipped < 3 then raise exception 'VACUOUS TEST: helpers that never withhold flipped % of 3 small-cell checks (%)', v_flipped, v_names; end if;
end $$;

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
select 'SABOTAGE ' || check_name as check_name, expected, actual, case when expected is distinct from actual then 'PASS' else 'FAIL' end as result
  from results where (phase = 'sabotaged-window' and check_name ~ '^2(a|b|c)') or (phase = 'sabotaged-all' and check_name ~ '^2(a|b)') or (phase = 'sabotaged-cell' and check_name ~ '^3(a|b|c)') order by check_name;

rollback;
