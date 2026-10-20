-- S07y proof: "home cuff vs clinic cuff" (migration *_s07y_home_cuff_vs_clinic_check.sql).
-- One rolled-back transaction. Proves:
--  * the configuration ships unsigned and inactive, only the Chief Medical Officer can sign it, both guards are born off;
--  * the SQL rules agree with the TypeScript rules on every case in the parity block below (packages/clinical/src/cuff-check.test.ts runs the same block);
--  * a same-visit pair can be entered only by an active clinician tied to the patient, is stored whatever the guard says, and a REAL patient gets no flag and no task
--    while the guard is off or the rule is unsigned;
--  * with the rule signed and the guard on, a consistent difference in ONE direction raises ONE routine task per direction, inconsistent / mixed / too few pairs raise none;
--  * a home-log pair is made from a clinic reading and the patient's own home readings around it, and only when at least the minimum number lie in the window;
--  * the pairs, flags and task are clinician-only (no patient, anon, untied clinician or coordinator read), hold no value in the task, write nothing a home reading writes, and
--    nothing reaches the patient's notifications or audit view;
--  * the only patient-visible fact (cuff_visit_prompt_open) is identical for flagged and unflagged patients and needs the CMO's wording attestation;
--  * a failure inside the rule never loses the clinician's data and opens an incident rather than passing silently.
-- SABOTAGE: (1) the share gate removed; (2) the tie check removed from the pair function; (3) the boundary made exclusive; (4) the one-visit-one-pair exclusion removed. All four must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's07y-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S07y ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid language plpgsql as
$f$ declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S07y ' || p_label, 'MDCN', 'S07Y-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  return v;
end $f$;

-- run one statement as a user; the first column as text, or 'ERR <sqlstate>'
create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.as_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;

-- a same-visit pair entered by user u: clinic cs/cd, own os/od, p_day_offset days ago at 11:00 UTC
create function pg_temp.pair(p_uid uuid, p_pat uuid, p_cs int, p_cd int, p_os int, p_od int, p_day_offset int) returns text language sql as
$$ select pg_temp.as_user(p_uid, format('select public.record_cuff_check_pair(%L, %s, %s, %s, %s, ((current_date - %s)::text || '' 11:00:00+00'')::timestamptz, ''Proof cuff'')::text', p_pat, p_cs, p_cd, p_os, p_od, p_day_offset)) $$;
create function pg_temp.clinic(p_uid uuid, p_pat uuid, p_sys int, p_dia int, p_day_offset int) returns text language sql as
$$ select pg_temp.as_user(p_uid, format('select public.record_clinic_bp_reading(%L, %s, %s, ((current_date - %s)::text || '' 11:00:00+00'')::timestamptz)::text', p_pat, p_sys, p_dia, p_day_offset)) $$;
create function pg_temp.flags(p_pat uuid) returns text language sql as
$$ select coalesce(string_agg(kind, ',' order by created_at, kind), 'none') from public.cuff_check_flags where patient_id = p_pat $$;
create function pg_temp.ctasks(p_pat uuid) returns text language sql as
$$ select count(*)::text from public.clinical_tasks where patient_id = p_pat and type = 'cuff_check_review' $$;
create function pg_temp.npairs(p_pat uuid) returns text language sql as
$$ select count(*)::text from public.cuff_check_pairs where patient_id = p_pat $$;
create function pg_temp.nclinic(p_pat uuid) returns text language sql as
$$ select count(*)::text from public.clinic_bp_readings where patient_id = p_pat $$;
create function pg_temp.nincidents() returns text language sql as
$$ select count(*)::text from public.ops_incidents where external_reference = 'cuff_check_rule' and status not in ('resolved', 'closed') $$;
create function pg_temp.pairinfo(p_pat uuid) returns text language sql as
$$ select coalesce(string_agg(source || '|' || d_systolic || '|' || d_diastolic || '|' || own_readings, ';' order by created_at), 'none') from public.cuff_check_pairs where patient_id = p_pat $$;
create function pg_temp.guard_on(p_key text) returns text language sql as
$$ select is_on::text from public.go_live_guards where key = p_key $$;
create function pg_temp.config_ok() returns text language sql as
$$ select ((select is_active and approved_by is not null from public.cuff_check_rules where version = 1) and private.cuff_check_config() is not null)::text $$;
-- one home reading (device) at 08:00 UTC
create function pg_temp.home1(p_pat uuid, p_org uuid, p_day_offset int, p_sys int, p_dia int) returns void language sql as
$$ insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, position, arm)
   values (p_org, p_pat, 'blood_pressure', p_sys, p_dia, ((current_date - p_day_offset)::text || ' 08:00:00+00')::timestamptz, 'device', 'seated', 'left') $$;
-- two home readings (device) at 08:00 and 12:00 UTC on a day d days ago
create function pg_temp.home2(p_pat uuid, p_org uuid, p_day_offset int, p_sys int, p_dia int) returns void language plpgsql as
$f$ declare t text;
begin
  foreach t in array array['08:00:00', '12:00:00'] loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, position, arm)
    values (p_org, p_pat, 'blood_pressure', p_sys, p_dia, ((current_date - p_day_offset)::text || ' ' || t || '+00')::timestamptz, 'device', 'seated', 'left');
  end loop;
end $f$;

-- C. the parity cases (also run by packages/clinical/src/cuff-check.test.ts through the TypeScript rules) -----------------------------------
create temp table parity(doc jsonb) on commit drop;
grant all on parity to public;
-- parity-begin
insert into parity values ($json${
 "classify": [
  {"name": "no difference", "ds": 0, "dd": 0, "expect": "agree"},
  {"name": "just under both thresholds", "ds": 9, "dd": 4, "expect": "agree"},
  {"name": "just under both thresholds, negative", "ds": -9, "dd": -4, "expect": "agree"},
  {"name": "systolic exactly at the threshold is higher", "ds": 10, "dd": 0, "expect": "home_higher"},
  {"name": "diastolic exactly at the threshold is higher", "ds": 0, "dd": 5, "expect": "home_higher"},
  {"name": "systolic exactly at the negative threshold is lower", "ds": -10, "dd": 0, "expect": "home_lower"},
  {"name": "diastolic exactly at the negative threshold is lower", "ds": 0, "dd": -5, "expect": "home_lower"},
  {"name": "one number higher, the other lower is mixed", "ds": 10, "dd": -5, "expect": "mixed"},
  {"name": "the other mixed way", "ds": -12, "dd": 6, "expect": "mixed"}
 ],
 "homeMean": [
  {"name": "no home readings", "clinicAt": "2026-10-10T10:00:00Z", "readings": [], "expect": null},
  {"name": "one reading is too few", "clinicAt": "2026-10-10T10:00:00Z", "readings": [{"s": 140, "d": 90, "at": "2026-10-10T08:00:00Z"}], "expect": null},
  {"name": "two readings near the visit", "clinicAt": "2026-10-10T10:00:00Z", "readings": [{"s": 130, "d": 80, "at": "2026-10-10T08:00:00Z"}, {"s": 134, "d": 84, "at": "2026-10-10T13:00:00Z"}], "expect": {"systolic": 132, "diastolic": 82, "count": 2}},
  {"name": "a reading just outside the window is ignored, one exactly on the edge is kept", "clinicAt": "2026-10-10T10:00:00Z", "readings": [{"s": 200, "d": 120, "at": "2026-10-09T09:59:59Z"}, {"s": 140, "d": 90, "at": "2026-10-09T10:00:00Z"}, {"s": 150, "d": 94, "at": "2026-10-11T10:00:00Z"}], "expect": {"systolic": 145, "diastolic": 92, "count": 2}},
  {"name": "a half rounds up", "clinicAt": "2026-10-10T10:00:00Z", "readings": [{"s": 131, "d": 80, "at": "2026-10-10T09:00:00Z"}, {"s": 132, "d": 81, "at": "2026-10-10T11:00:00Z"}], "expect": {"systolic": 132, "diastolic": 81, "count": 2}},
  {"name": "three readings", "clinicAt": "2026-10-10T10:00:00Z", "readings": [{"s": 140, "d": 90, "at": "2026-10-10T06:00:00Z"}, {"s": 142, "d": 92, "at": "2026-10-10T10:00:00Z"}, {"s": 141, "d": 91, "at": "2026-10-10T18:00:00Z"}], "expect": {"systolic": 141, "diastolic": 91, "count": 3}},
  {"name": "only far readings", "clinicAt": "2026-10-10T10:00:00Z", "readings": [{"s": 140, "d": 90, "at": "2026-10-01T06:00:00Z"}, {"s": 142, "d": 92, "at": "2026-10-20T10:00:00Z"}], "expect": null}
 ],
 "check": [
  {"name": "no pairs", "now": "2026-10-20T00:00:00Z", "pairs": [], "expect": {"kind": null, "pairsUsed": 0, "matching": 0}},
  {"name": "two pairs are too few even when both are off", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-10T10:00:00Z", "ds": 15, "dd": 8}, {"at": "2026-10-12T10:00:00Z", "ds": 14, "dd": 7}], "expect": {"kind": null, "pairsUsed": 2, "matching": 0}},
  {"name": "three pairs, all higher", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-10T10:00:00Z", "ds": 15, "dd": 8}, {"at": "2026-10-12T10:00:00Z", "ds": 14, "dd": 7}, {"at": "2026-10-14T10:00:00Z", "ds": 11, "dd": 2}], "expect": {"kind": "home_higher", "pairsUsed": 3, "matching": 3}},
  {"name": "three pairs, all lower", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-10T10:00:00Z", "ds": -15, "dd": -8}, {"at": "2026-10-12T10:00:00Z", "ds": -10, "dd": 0}, {"at": "2026-10-14T10:00:00Z", "ds": -2, "dd": -6}], "expect": {"kind": "home_lower", "pairsUsed": 3, "matching": 3}},
  {"name": "three pairs, two higher and one agrees", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-10T10:00:00Z", "ds": 15, "dd": 8}, {"at": "2026-10-12T10:00:00Z", "ds": 14, "dd": 7}, {"at": "2026-10-14T10:00:00Z", "ds": 1, "dd": 1}], "expect": {"kind": null, "pairsUsed": 3, "matching": 0}},
  {"name": "five pairs, four higher (80 percent)", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-06T10:00:00Z", "ds": 12, "dd": 6}, {"at": "2026-10-08T10:00:00Z", "ds": 13, "dd": 6}, {"at": "2026-10-10T10:00:00Z", "ds": 0, "dd": 0}, {"at": "2026-10-12T10:00:00Z", "ds": 14, "dd": 7}, {"at": "2026-10-14T10:00:00Z", "ds": 11, "dd": 5}], "expect": {"kind": "home_higher", "pairsUsed": 5, "matching": 4}},
  {"name": "five pairs, three higher (60 percent) is not enough", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-06T10:00:00Z", "ds": 12, "dd": 6}, {"at": "2026-10-08T10:00:00Z", "ds": 0, "dd": 0}, {"at": "2026-10-10T10:00:00Z", "ds": 0, "dd": 0}, {"at": "2026-10-12T10:00:00Z", "ds": 14, "dd": 7}, {"at": "2026-10-14T10:00:00Z", "ds": 11, "dd": 5}], "expect": {"kind": null, "pairsUsed": 5, "matching": 0}},
  {"name": "four pairs, three higher is exactly 75 percent", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-08T10:00:00Z", "ds": 12, "dd": 6}, {"at": "2026-10-10T10:00:00Z", "ds": 0, "dd": 0}, {"at": "2026-10-12T10:00:00Z", "ds": 14, "dd": 7}, {"at": "2026-10-14T10:00:00Z", "ds": 11, "dd": 5}], "expect": {"kind": "home_higher", "pairsUsed": 4, "matching": 3}},
  {"name": "four pairs, three higher and one lower: the higher direction still carries it", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-08T10:00:00Z", "ds": 12, "dd": 6}, {"at": "2026-10-10T10:00:00Z", "ds": -12, "dd": -6}, {"at": "2026-10-12T10:00:00Z", "ds": 14, "dd": 7}, {"at": "2026-10-14T10:00:00Z", "ds": 11, "dd": 5}], "expect": {"kind": "home_higher", "pairsUsed": 4, "matching": 3}},
  {"name": "alternating directions raise nothing", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-08T10:00:00Z", "ds": 12, "dd": 6}, {"at": "2026-10-10T10:00:00Z", "ds": -12, "dd": -6}, {"at": "2026-10-12T10:00:00Z", "ds": 14, "dd": 7}, {"at": "2026-10-14T10:00:00Z", "ds": -11, "dd": -5}], "expect": {"kind": null, "pairsUsed": 4, "matching": 0}},
  {"name": "only the newest five pairs count", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-01T10:00:00Z", "ds": 12, "dd": 6}, {"at": "2026-10-06T10:00:00Z", "ds": 12, "dd": 6}, {"at": "2026-10-08T10:00:00Z", "ds": 0, "dd": 0}, {"at": "2026-10-10T10:00:00Z", "ds": 0, "dd": 0}, {"at": "2026-10-12T10:00:00Z", "ds": 14, "dd": 7}, {"at": "2026-10-14T10:00:00Z", "ds": 11, "dd": 5}], "expect": {"kind": null, "pairsUsed": 5, "matching": 0}},
  {"name": "a pair older than the look-back is ignored", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2025-09-01T10:00:00Z", "ds": 15, "dd": 8}, {"at": "2026-10-10T10:00:00Z", "ds": 14, "dd": 7}, {"at": "2026-10-12T10:00:00Z", "ds": 12, "dd": 6}], "expect": {"kind": null, "pairsUsed": 2, "matching": 0}},
  {"name": "a pair exactly 365 days old is still inside the look-back", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2025-10-20T00:00:00Z", "ds": 15, "dd": 8}, {"at": "2026-10-10T10:00:00Z", "ds": 14, "dd": 7}, {"at": "2026-10-12T10:00:00Z", "ds": 12, "dd": 6}], "expect": {"kind": "home_higher", "pairsUsed": 3, "matching": 3}},
  {"name": "a pair in the future is ignored", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-25T10:00:00Z", "ds": 15, "dd": 8}, {"at": "2026-10-10T10:00:00Z", "ds": 14, "dd": 7}, {"at": "2026-10-12T10:00:00Z", "ds": 12, "dd": 6}], "expect": {"kind": null, "pairsUsed": 2, "matching": 0}},
  {"name": "mixed pairs count as neither direction", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-10T10:00:00Z", "ds": 12, "dd": -6}, {"at": "2026-10-12T10:00:00Z", "ds": -12, "dd": 6}, {"at": "2026-10-14T10:00:00Z", "ds": 11, "dd": -5}], "expect": {"kind": null, "pairsUsed": 3, "matching": 0}},
  {"name": "five pairs, four lower", "now": "2026-10-20T00:00:00Z", "pairs": [{"at": "2026-10-06T10:00:00Z", "ds": -12, "dd": -6}, {"at": "2026-10-08T10:00:00Z", "ds": -13, "dd": -6}, {"at": "2026-10-10T10:00:00Z", "ds": 0, "dd": 0}, {"at": "2026-10-12T10:00:00Z", "ds": -14, "dd": -7}, {"at": "2026-10-14T10:00:00Z", "ds": -11, "dd": -5}], "expect": {"kind": "home_lower", "pairsUsed": 5, "matching": 4}}
 ]
}$json$);
-- parity-end

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_c1 uuid; v_c2 uuid; v_co uuid; v_k text;
  v_cfg jsonb := (select config from public.cuff_check_rules where version = 1);
  c jsonb; r jsonb; v_i int := 0; v_exp jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin'); perform pg_temp.setf('admin', v_admin);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin); perform pg_temp.setf('cmo', v_cmo);
  v_c1 := pg_temp.mkdoc(v_org, 'tied smo', 'senior_medical_officer', v_admin); perform pg_temp.setf('c1', v_c1);
  v_c2 := pg_temp.mkdoc(v_org, 'untied smo', 'senior_medical_officer', v_admin); perform pg_temp.setf('c2', v_c2);
  v_co := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator'); perform pg_temp.setf('co', v_co);
  -- test patients p, p2, p3, p4, p5, p6, p7; q (another test patient); r is a REAL patient (is_test false)
  foreach v_k in array array['p', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'q'] loop
    perform pg_temp.setf(v_k, pg_temp.mkuser(v_org, 'patient ' || v_k, 'patient'));
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, pg_temp.f(v_k), v_c1, v_co, now());
  end loop;
  perform pg_temp.setf('r', pg_temp.mkuser(v_org, 'real patient', 'patient', false));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, pg_temp.f('r'), v_c1, v_co, now());

  -- A. the seed, the signature, the guards ---------------------------------------------------------------------------------------
  perform pg_temp.ck('real', 'S1 the seed configuration ships unsigned and inactive', 'true',
    (select (not is_active and approved_by is null and approved_at is null)::text from public.cuff_check_rules where version = 1));
  perform pg_temp.ck('real', 'S2 nothing reads an unsigned configuration', 'null', coalesce(private.cuff_check_config()::text, 'null'));
  perform pg_temp.ck('real', 'S3 both guards exist, are off, and are the CMO''s switch', 'off|off|cmo|cmo',
    (select string_agg(case when is_on then 'on' else 'off' end, '|' order by key) || '|' || string_agg(switch_role, '|' order by key) from public.go_live_guards where key in ('cuff_check_flag', 'cuff_visit_prompt')));
  perform pg_temp.ck('real', 'S4 the rule guard says the configuration is unmet and the attestation is unmet', 'false|false',
    (private.go_live_conditions('cuff_check_flag', v_org) -> 0 ->> 'met') || '|' || (private.go_live_conditions('cuff_check_flag', v_org) -> 2 ->> 'met'));
  perform pg_temp.ck('real', 'S5 anon cannot call the clinician, the sign or the prompt function', 'false|false|false',
    has_function_privilege('anon', 'public.record_cuff_check_pair(uuid,integer,integer,integer,integer,timestamptz,text)', 'EXECUTE')::text || '|' ||
    has_function_privilege('anon', 'public.sign_cuff_check_rules(uuid)', 'EXECUTE')::text || '|' || has_function_privilege('anon', 'public.cuff_visit_prompt_open()', 'EXECUTE')::text);
  perform pg_temp.ck('real', 'S6 a signed-in user cannot call the rule or its helpers directly', 'false|false|false|false|false',
    has_function_privilege('authenticated', 'private.evaluate_cuff_check(uuid)', 'EXECUTE')::text || '|' || has_function_privilege('authenticated', 'private.cuff_check_pair_from_clinic(uuid)', 'EXECUTE')::text || '|' ||
    has_function_privilege('authenticated', 'private.cuff_check_kind(jsonb,timestamptz,jsonb)', 'EXECUTE')::text || '|' || has_function_privilege('authenticated', 'private.cuff_home_mean(jsonb,timestamptz,jsonb)', 'EXECUTE')::text || '|' ||
    has_function_privilege('authenticated', 'private.cuff_pair_class(integer,integer,jsonb)', 'EXECUTE')::text);
  perform pg_temp.ck('real', 'S7 no patient policy exists: the only policies are the staff read policies, and no PUBLIC or anon privilege is held', '2|0',
    (select count(*) from pg_policies where schemaname = 'public' and tablename in ('cuff_check_pairs', 'cuff_check_flags') and policyname like '%\_read')::text || '|' ||
    (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('cuff_check_pairs', 'cuff_check_flags', 'cuff_check_rules') and grantee in ('PUBLIC', 'anon')));
  perform pg_temp.ck('real', 'S8 both new tables are registered for tied staff reads and for the data registry', '2|2',
    (select count(*) from public.staff_read_scope where table_name in ('cuff_check_pairs', 'cuff_check_flags') and mode = 'tied') || '|' ||
    (select count(*) from public.data_registry where table_name in ('cuff_check_pairs', 'cuff_check_flags')));
  perform pg_temp.ck('real', 'S9 the never-activate-an-older-signed-version guard is on the new governed table', '1',
    (select count(*)::text from pg_trigger where tgname = 'refuse_superseded_activation' and not tgisinternal and tgrelid = 'public.cuff_check_rules'::regclass));
  perform pg_temp.ck('real', 'S10 the task type is a routine class 8 task that exists', '8|true',
    (select priority_class::text || '|' || creatable::text from public.task_types where code = 'cuff_check_review'));

  -- B. parity, SQL side ---------------------------------------------------------------------------------------------------------
  for c in select x from jsonb_array_elements((select doc -> 'classify' from parity)) x loop
    v_i := v_i + 1;
    perform pg_temp.ck('real', 'PC' || v_i || ' ' || (c ->> 'name'), c ->> 'expect', private.cuff_pair_class((c ->> 'ds')::int, (c ->> 'dd')::int, v_cfg));
  end loop;
  v_i := 0;
  for c in select x from jsonb_array_elements((select doc -> 'homeMean' from parity)) x loop
    v_i := v_i + 1;
    r := private.cuff_home_mean(c -> 'readings', (c ->> 'clinicAt')::timestamptz, v_cfg);
    perform pg_temp.ck('real', 'PH' || v_i || ' ' || (c ->> 'name'), coalesce((c -> 'expect')::text, 'null'), coalesce(r::text, 'null'));
  end loop;
  v_i := 0;
  for c in select x from jsonb_array_elements((select doc -> 'check' from parity)) x loop
    v_i := v_i + 1;
    r := private.cuff_check_kind(c -> 'pairs', (c ->> 'now')::timestamptz, v_cfg);
    perform pg_temp.ck('real', 'PK' || v_i || ' ' || (c ->> 'name'), (c -> 'expect')::text, r::text);
  end loop;
  perform pg_temp.ck('real', 'PS the parity block is not trivially small', 'true',
    ((select jsonb_array_length(doc -> 'classify') >= 8 and jsonb_array_length(doc -> 'homeMean') >= 6 and jsonb_array_length(doc -> 'check') >= 14 from parity))::text);
end $$;

-- C. unsigned rule, guard off: pairs are stored, nothing is raised -----------------------------------------------------------------------
select pg_temp.ck('real', 'C1 three same-visit pairs, all higher, entered for a REAL patient while the rule is unsigned and the guard off: stored, no flag, no task', '3|none|0',
  (case when (pg_temp.pair(pg_temp.f('c1'), pg_temp.f('r'), 128, 78, 142, 90, 30) !~ '^ERR' and pg_temp.pair(pg_temp.f('c1'), pg_temp.f('r'), 130, 80, 144, 92, 20) !~ '^ERR'
              and pg_temp.pair(pg_temp.f('c1'), pg_temp.f('r'), 126, 78, 140, 88, 10) !~ '^ERR') then pg_temp.npairs(pg_temp.f('r')) else 'ERR' end)
  || '|' || pg_temp.flags(pg_temp.f('r')) || '|' || pg_temp.ctasks(pg_temp.f('r')));
select pg_temp.ck('real', 'C2 a clinic reading with home readings around it makes no home-log pair for a REAL patient while the guard is off', '3',
  (select case when pg_temp.clinic(pg_temp.f('c1'), pg_temp.f('r'), 128, 78, 5) !~ '^ERR' then pg_temp.npairs(pg_temp.f('r')) else 'ERR' end));

-- D. who may enter a pair --------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'D1 only a clinician tied to the patient can record a pair', 'ERR 42501|ERR 42501|ERR 42501|ERR 42501',
  pg_temp.pair(pg_temp.f('c2'), pg_temp.f('p'), 128, 78, 142, 90, 2) || '|' || pg_temp.pair(pg_temp.f('co'), pg_temp.f('p'), 128, 78, 142, 90, 2) || '|' ||
  pg_temp.pair(pg_temp.f('p'), pg_temp.f('p'), 128, 78, 142, 90, 2) ||
  '|' || pg_temp.as_anon(format('select public.record_cuff_check_pair(%L, 128, 78, 142, 90, now() - interval ''1 hour'')::text', pg_temp.f('p'))));
select pg_temp.ck('real', 'D2 an implausible, inverted, future, very old or over-long-label pair is refused', 'ERR 22023|ERR 22023|ERR 22023|ERR 22023|ERR 22023|ERR 22023',
  pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p'), 300, 100, 142, 90, 2) || '|' || pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p'), 128, 78, 142, 150, 2) || '|' ||
  pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p'), 128, 78, 142, 90, -2) || '|' || pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p'), 128, 78, 142, 90, 400) || '|' ||
  pg_temp.as_user(pg_temp.f('c1'), format('select public.record_cuff_check_pair(%L, 128, 78, 142, 90, now() - interval ''1 hour'', %L)::text', pg_temp.f('p'), repeat('x', 81))) || '|' ||
  pg_temp.as_user(pg_temp.f('c1'), format('select public.record_cuff_check_pair(%L, 128, 78, null, 90, now() - interval ''1 hour'')::text', pg_temp.f('p'))));
select pg_temp.ck('real', 'D3 nothing was stored for the refused calls', '0', pg_temp.npairs(pg_temp.f('p')));

-- E. the signature --------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'G1 a non-CMO cannot sign', 'ERR P0001',
  pg_temp.as_user(pg_temp.f('c1'), format('select public.sign_cuff_check_rules(%L)::text', (select id from public.cuff_check_rules where version = 1))));
select pg_temp.ck('real', 'G2 the CMO signs', 'ok',
  (select case when o ~ '^ERR' then o else 'ok' end from (select pg_temp.as_user(pg_temp.f('cmo'), format('select public.sign_cuff_check_rules(%L)::text', (select id from public.cuff_check_rules where version = 1))) o) z));
select pg_temp.ck('real', 'G2b ...and it is the one active, signed configuration', 'true', pg_temp.config_ok());
create temp table signed_at on commit drop as select approved_at, approved_by from public.cuff_check_rules where version = 1;
select pg_temp.ck('real', 'G3 signing the same version again is refused and the original signature is untouched', 'ERR P0001|true',
  pg_temp.as_user(pg_temp.f('cmo'), format('select public.sign_cuff_check_rules(%L)::text', (select id from public.cuff_check_rules where version = 1))) || '|' ||
  ((select approved_at = (select approved_at from signed_at) and approved_by = (select approved_by from signed_at) from public.cuff_check_rules where version = 1))::text);
insert into public.cuff_check_rules (version, config, notes) values (2, '{"pairing": {}}'::jsonb, 'proof: a draft missing the values the rule reads');
select pg_temp.ck('real', 'G4 a draft missing a value the rule reads cannot be signed, and version 1 stays active', 'ERR P0001|1',
  pg_temp.as_user(pg_temp.f('cmo'), format('select public.sign_cuff_check_rules(%L)::text', (select id from public.cuff_check_rules where version = 2))) || '|' ||
  (select version from public.cuff_check_rules where is_active)::text);
insert into public.cuff_check_rules (version, config, notes) values
  (3, jsonb_set(jsonb_set((select config from public.cuff_check_rules where version = 1), '{consistency,minPairs}', '4'), '{consistency,maxPairs}', '3'), 'proof: maxPairs below minPairs'),
  (4, jsonb_set((select config from public.cuff_check_rules where version = 1), '{consistency,minSharePercent}', '120'), 'proof: share over 100'),
  (5, jsonb_set((select config from public.cuff_check_rules where version = 1), '{difference,systolic}', '"ten"'), 'proof: a word where a number belongs'),
  (6, jsonb_set((select config from public.cuff_check_rules where version = 1), '{difference,systolic}', '0'), 'proof: a zero threshold'),
  (7, jsonb_set((select config from public.cuff_check_rules where version = 1), '{pairing,windowHours}', '24.5'), 'proof: a fraction of an hour');
select pg_temp.ck('real', 'G4b drafts with an impossible pair count, a share over 100, a word, a zero threshold or a fraction cannot be signed; version 1 stays active', 'ERR P0001|ERR P0001|ERR P0001|ERR P0001|ERR P0001|1',
  pg_temp.as_user(pg_temp.f('cmo'), format('select public.sign_cuff_check_rules(%L)::text', (select id from public.cuff_check_rules where version = 3))) || '|' ||
  pg_temp.as_user(pg_temp.f('cmo'), format('select public.sign_cuff_check_rules(%L)::text', (select id from public.cuff_check_rules where version = 4))) || '|' ||
  pg_temp.as_user(pg_temp.f('cmo'), format('select public.sign_cuff_check_rules(%L)::text', (select id from public.cuff_check_rules where version = 5))) || '|' ||
  pg_temp.as_user(pg_temp.f('cmo'), format('select public.sign_cuff_check_rules(%L)::text', (select id from public.cuff_check_rules where version = 6))) || '|' ||
  pg_temp.as_user(pg_temp.f('cmo'), format('select public.sign_cuff_check_rules(%L)::text', (select id from public.cuff_check_rules where version = 7))) || '|' ||
  (select version from public.cuff_check_rules where is_active)::text);
select pg_temp.ck('real', 'G4c the thresholds are readable by staff and not by a patient or anon', '1|0|ERR 42501',
  pg_temp.as_user(pg_temp.f('c2'), 'select count(*)::text from public.cuff_check_rules where version = 1') || '|' ||
  pg_temp.as_user(pg_temp.f('r'), 'select count(*)::text from public.cuff_check_rules') || '|' ||
  pg_temp.as_anon('select count(*)::text from public.cuff_check_rules'));
select pg_temp.ck('real', 'G5 the rule guard now reads the configuration as signed (the attestation is still unmet)', 'true|false',
  (private.go_live_conditions('cuff_check_flag', pg_temp.f('org')) -> 0 ->> 'met') || '|' || (private.go_live_conditions('cuff_check_flag', pg_temp.f('org')) -> 2 ->> 'met'));

-- with the rule signed and the guard still OFF a REAL patient still gets nothing, whatever the pairs say
select pg_temp.ck('real', 'G6 signed rule, guard off: a fourth pair for the REAL patient is stored; still no flag and no task', '4|none|0',
  (case when pg_temp.pair(pg_temp.f('c1'), pg_temp.f('r'), 128, 78, 142, 90, 3) !~ '^ERR' then pg_temp.npairs(pg_temp.f('r')) else 'ERR' end) || '|' || pg_temp.flags(pg_temp.f('r')) || '|' || pg_temp.ctasks(pg_temp.f('r')));

-- F. switching the guard on ---------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'F1 the rule guard cannot be switched on before the clinician-only attestation is recorded', 'refused',
  (select case when o ~ '^ERR' then 'refused' else o end from (select pg_temp.as_user(pg_temp.f('cmo'), 'select public.set_go_live_guard(''cuff_check_flag'', true, ''S07y proof'')::text') o) z));
select pg_temp.ck('real', 'F2 the CMO records the clinician-only attestation', 'ok',
  (select case when o ~ '^ERR' then o else 'ok' end from (select pg_temp.as_user(pg_temp.f('cmo'), 'select public.attest_go_live_condition(''cuff_check_flag'', ''flag_is_clinician_only'', true, ''S07y proof: no patient screen, notification or export shows the flag'')::text') o) z));
select pg_temp.ck('real', 'F3 the CMO switches the guard on (its data conditions are met)', 'ok',
  (select case when o ~ '^ERR' then o else 'ok' end from (select pg_temp.as_user(pg_temp.f('cmo'), 'select public.set_go_live_guard(''cuff_check_flag'', true, ''S07y proof'')::text') o) z));
select pg_temp.ck('real', 'F4 ...and the guard is on', 'true', pg_temp.guard_on('cuff_check_flag'));

create temp table snap on commit drop as
select 'vitals' k, count(*) n from public.vitals_readings where patient_id = pg_temp.f('r')
union all select 'alerts', count(*) from public.clinician_alerts where patient_id = pg_temp.f('r')
union all select 'emergency', count(*) from public.emergency_events where patient_id = pg_temp.f('r')
union all select 'events', count(*) from public.domain_events where patient_id = pg_temp.f('r') and event_type = 'observation.recorded'
union all select 'notifications', count(*) from public.notifications where recipient_id = pg_temp.f('r');
grant all on snap to public;

-- G. the rule, end to end ------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'R1 with the guard on, the REAL patient''s next pair brings the pair count to 5 and raises ONE home_higher flag and ONE routine task', 'true|5|home_higher|1',
  (pg_temp.pair(pg_temp.f('c1'), pg_temp.f('r'), 130, 80, 143, 91, 1) !~ '^ERR')::text || '|' || pg_temp.npairs(pg_temp.f('r')) || '|' || pg_temp.flags(pg_temp.f('r')) || '|' || pg_temp.ctasks(pg_temp.f('r')));
select pg_temp.ck('real', 'R2 a further pair in the same direction while the task is open adds no second flag and no second task', 'true|home_higher|1',
  (pg_temp.pair(pg_temp.f('c1'), pg_temp.f('r'), 130, 80, 146, 93, 0) !~ '^ERR')::text || '|' || pg_temp.flags(pg_temp.f('r')) || '|' || pg_temp.ctasks(pg_temp.f('r')));
select pg_temp.ck('real', 'R3 the pairs fired nothing a home reading fires: no vitals row, alert, emergency, observation event or notification', '0|0|0|0|0',
  ((select count(*) from public.vitals_readings where patient_id = pg_temp.f('r')) - (select n from snap where k = 'vitals')) || '|' ||
  ((select count(*) from public.clinician_alerts where patient_id = pg_temp.f('r')) - (select n from snap where k = 'alerts')) || '|' ||
  ((select count(*) from public.emergency_events where patient_id = pg_temp.f('r')) - (select n from snap where k = 'emergency')) || '|' ||
  ((select count(*) from public.domain_events where patient_id = pg_temp.f('r') and event_type = 'observation.recorded') - (select n from snap where k = 'events')) || '|' ||
  ((select count(*) from public.notifications where recipient_id = pg_temp.f('r')) - (select n from snap where k = 'notifications')));
select pg_temp.ck('real', 'R4 the task is an ordinary routine task; no reading, direction or label is stored on it', 'true',
  (select (not (to_jsonb(t) ?| array['systolic', 'diastolic', 'kind', 'band', 'value', 'reading', 'device_label']) and t.dedup_key = 'cuff_check:' || t.patient_id and t.priority_class = 8)::text
     from public.clinical_tasks t where t.patient_id = pg_temp.f('r') and t.type = 'cuff_check_review' limit 1));
select pg_temp.ck('real', 'R5 the pair keeps the device label and the own-minus-clinic differences', 'Proof cuff|14|12',
  (select device_label || '|' || d_systolic || '|' || d_diastolic from public.cuff_check_pairs where patient_id = pg_temp.f('r') and clinic_systolic = 128 and own_systolic = 142 and measured_at::date = current_date - 30 limit 1));

-- lower direction (p2), mixed directions (p3), too few (p4)
select pg_temp.ck('real', 'R6 three lower pairs raise one home_lower flag', 'home_lower|1',
  (case when pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p2'), 150, 92, 136, 84, 30) !~ '^ERR' and pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p2'), 146, 90, 134, 82, 20) !~ '^ERR'
              and pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p2'), 148, 90, 133, 84, 10) !~ '^ERR' then pg_temp.flags(pg_temp.f('p2')) else 'ERR' end) || '|' || pg_temp.ctasks(pg_temp.f('p2')));
select pg_temp.ck('real', 'R7 alternating higher and lower pairs raise nothing', 'none|0',
  (case when pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p3'), 128, 78, 142, 90, 40) !~ '^ERR' and pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p3'), 142, 90, 128, 78, 30) !~ '^ERR'
              and pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p3'), 128, 78, 142, 90, 20) !~ '^ERR' and pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p3'), 142, 90, 128, 78, 10) !~ '^ERR'
         then pg_temp.flags(pg_temp.f('p3')) else 'ERR' end) || '|' || pg_temp.ctasks(pg_temp.f('p3')));
select pg_temp.ck('real', 'R8 two off pairs and one that agrees raise nothing', 'none|0',
  (case when pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p4'), 128, 78, 142, 90, 30) !~ '^ERR' and pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p4'), 130, 80, 144, 92, 20) !~ '^ERR'
              and pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p4'), 126, 78, 127, 79, 10) !~ '^ERR' then pg_temp.flags(pg_temp.f('p4')) else 'ERR' end) || '|' || pg_temp.ctasks(pg_temp.f('p4')));

-- H. home-log pairs from a clinic reading ----------------------------------------------------------------------------------------------------
select pg_temp.home2(pg_temp.f('p5'), pg_temp.f('org'), 60, 140, 88);
select pg_temp.home2(pg_temp.f('p5'), pg_temp.f('org'), 40, 142, 90);
select pg_temp.home2(pg_temp.f('p5'), pg_temp.f('org'), 20, 141, 89);
select pg_temp.ck('real', 'H1 the first clinic reading with two home readings around it makes ONE home-log pair (own mean minus clinic, 2 readings)', 'true|home_log|12|10|2',
  (pg_temp.clinic(pg_temp.f('c1'), pg_temp.f('p5'), 128, 78, 60) !~ '^ERR')::text || '|' || pg_temp.pairinfo(pg_temp.f('p5')));
select pg_temp.ck('real', 'H2 the pair points back at the clinic reading', 'true',
  (select (clinic_reading_id = (select id from public.clinic_bp_readings where patient_id = pg_temp.f('p5') limit 1))::text from public.cuff_check_pairs where patient_id = pg_temp.f('p5') limit 1));
select pg_temp.ck('real', 'H3 two more clinic readings with home readings make a home_higher flag', 'true|3|home_higher|1',
  (pg_temp.clinic(pg_temp.f('c1'), pg_temp.f('p5'), 130, 80, 40) !~ '^ERR' and pg_temp.clinic(pg_temp.f('c1'), pg_temp.f('p5'), 129, 79, 20) !~ '^ERR')::text || '|' ||
  pg_temp.npairs(pg_temp.f('p5')) || '|' || pg_temp.flags(pg_temp.f('p5')) || '|' || pg_temp.ctasks(pg_temp.f('p5')));
select pg_temp.home1(pg_temp.f('p6'), pg_temp.f('org'), 50, 140, 88);
select pg_temp.ck('real', 'H4 a clinic reading with only one home reading in the window makes no pair', 'true|0',
  (pg_temp.clinic(pg_temp.f('c1'), pg_temp.f('p6'), 128, 78, 50) !~ '^ERR')::text || '|' || pg_temp.npairs(pg_temp.f('p6')));
select pg_temp.ck('real', 'H5 a clinic reading with NO home readings makes no pair and the clinician''s readings are still saved', 'true|0|2',
  (pg_temp.clinic(pg_temp.f('c1'), pg_temp.f('p6'), 128, 78, 100) !~ '^ERR')::text || '|' || pg_temp.npairs(pg_temp.f('p6')) || '|' || pg_temp.nclinic(pg_temp.f('p6')));

-- I. who can read what ------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'V1 the patient, another patient, anon, an untied clinician and a coordinator read no pair or flag; the tied clinician reads them', '0|0|ERR 42501|0|0|6',
  pg_temp.as_user(pg_temp.f('r'), 'select count(*)::text from public.cuff_check_pairs') || '|' ||
  pg_temp.as_user(pg_temp.f('q'), 'select count(*)::text from public.cuff_check_pairs') || '|' ||
  pg_temp.as_anon('select count(*)::text from public.cuff_check_pairs') || '|' ||
  pg_temp.as_user(pg_temp.f('c2'), 'select count(*)::text from public.cuff_check_pairs') || '|' ||
  pg_temp.as_user(pg_temp.f('co'), 'select count(*)::text from public.cuff_check_flags') || '|' ||
  pg_temp.as_user(pg_temp.f('c1'), format('select count(*)::text from public.cuff_check_pairs where patient_id = %L', pg_temp.f('r'))));
select pg_temp.ck('real', 'V2 the flag table is the same: the patient reads none, the tied clinician reads the real patient''s', '0|1',
  pg_temp.as_user(pg_temp.f('r'), 'select count(*)::text from public.cuff_check_flags') || '|' ||
  pg_temp.as_user(pg_temp.f('c1'), format('select count(*)::text from public.cuff_check_flags where patient_id = %L', pg_temp.f('r'))));
select pg_temp.ck('real', 'V3 nobody can write the tables directly, and the append-only triggers are enabled', 'ERR 42501|ERR 42501|ERR 42501|ERR 42501|2',
  pg_temp.as_user(pg_temp.f('c1'), format('insert into public.cuff_check_pairs (organisation_id, patient_id, source, clinic_systolic, clinic_diastolic, own_systolic, own_diastolic, d_systolic, d_diastolic, measured_at) values (%L, %L, ''same_visit'', 120, 80, 130, 85, 10, 5, now())', pg_temp.f('org'), pg_temp.f('p'))) || '|' ||
  pg_temp.as_user(pg_temp.f('c1'), 'update public.cuff_check_pairs set own_systolic = 100') || '|' ||
  pg_temp.as_user(pg_temp.f('c1'), 'delete from public.cuff_check_flags') || '|' ||
  pg_temp.as_user(pg_temp.f('r'), format('insert into public.cuff_check_flags (organisation_id, patient_id, kind, pairs_used, matching, latest_pair_id, config_version) values (%L, %L, ''home_higher'', 3, 3, %L, 1)', pg_temp.f('org'), pg_temp.f('r'), (select id from public.cuff_check_pairs limit 1))) || '|' ||
  (select count(*) from pg_trigger where tgrelid in ('public.cuff_check_pairs'::regclass, 'public.cuff_check_flags'::regclass) and tgname like '%\_no\_change' and tgenabled = 'O'));
do $$
declare v_a text; v_b text;
begin
  begin update public.cuff_check_pairs set own_systolic = 100; v_a := 'changed'; exception when others then v_a := 'ERR ' || sqlstate; end;
  begin delete from public.cuff_check_flags; v_b := 'changed'; exception when others then v_b := 'ERR ' || sqlstate; end;
  perform pg_temp.ck('real', 'V4 even the owner cannot change or delete a pair or a flag (append-only)', 'ERR 42501|ERR 42501', v_a || '|' || v_b);
end $$;

-- J. nothing about a flag reaches the patient --------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'J1 the patient can read no audit entry about a pair, and the flag wrote none', '0|0',
  pg_temp.as_user(pg_temp.f('r'), 'select count(*)::text from public.audit_log where action like ''cuff_check%''') || '|' ||
  (select count(*) from public.audit_log where action like 'cuff_check_flag%'));

-- K. the one thing a patient can learn: the neutral line is open or not, the same for every patient ---------------------------------------------
select pg_temp.setf('r2', pg_temp.mkuser(pg_temp.f('org'), 'real patient unflagged', 'patient', false));
select pg_temp.ck('real', 'K1 the prompt is closed for a real patient and for a test patient before the wording is attested; anon cannot ask', 'false|false|ERR 42501',
  pg_temp.as_user(pg_temp.f('r'), 'select public.cuff_visit_prompt_open()::text') || '|' || pg_temp.as_user(pg_temp.f('p'), 'select public.cuff_visit_prompt_open()::text') || '|' ||
  pg_temp.as_anon('select public.cuff_visit_prompt_open()::text'));
select pg_temp.ck('real', 'K2 the prompt guard cannot be switched on before the wording attestation', 'refused',
  (select case when o ~ '^ERR' then 'refused' else o end from (select pg_temp.as_user(pg_temp.f('cmo'), 'select public.set_go_live_guard(''cuff_visit_prompt'', true, ''S07y proof'')::text') o) z));
select pg_temp.ck('real', 'K3 an admin who is not the CMO is not asked to attest here, and the CMO can: attested but guard off keeps a real patient out, and a test patient in', 'ok|false|true',
  (select case when o ~ '^ERR' then o else 'ok' end from (select pg_temp.as_user(pg_temp.f('cmo'), 'select public.attest_go_live_condition(''cuff_visit_prompt'', ''visit_prompt_wording_signed'', true, ''S07y proof: the neutral line was read in full'')::text') o) z) || '|' ||
  pg_temp.as_user(pg_temp.f('r'), 'select public.cuff_visit_prompt_open()::text') || '|' || pg_temp.as_user(pg_temp.f('p'), 'select public.cuff_visit_prompt_open()::text'));
select pg_temp.ck('real', 'K4 the CMO switches the prompt guard on; the answer is the same for a flagged and an unflagged real patient', 'ok|true|true',
  (select case when o ~ '^ERR' then o else 'ok' end from (select pg_temp.as_user(pg_temp.f('cmo'), 'select public.set_go_live_guard(''cuff_visit_prompt'', true, ''S07y proof'')::text') o) z) || '|' ||
  pg_temp.as_user(pg_temp.f('r'), 'select public.cuff_visit_prompt_open()::text') || '|' || pg_temp.as_user(pg_temp.f('r2'), 'select public.cuff_visit_prompt_open()::text'));
select pg_temp.ck('real', 'K5 r has a flag, r2 has none, and the prompt function body reads no pair or flag table', 'true|false|false',
  (exists (select 1 from public.cuff_check_flags where patient_id = pg_temp.f('r')))::text || '|' || (exists (select 1 from public.cuff_check_flags where patient_id = pg_temp.f('r2')))::text || '|' ||
  (pg_get_functiondef('public.cuff_visit_prompt_open()'::regprocedure) ~* 'cuff_check_(pairs|flags)')::text);

-- L. a failure inside the rule never loses the clinician's data and is never silent -----------------------------------------------------------------
update public.task_types set is_active = false where code = 'cuff_check_review';
select pg_temp.ck('real', 'L1 with the review task type unavailable, the third pair is still saved, no flag exists, and one incident is open', 'true|3|none|1',
  (case when pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p7'), 128, 78, 142, 90, 30) !~ '^ERR' and pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p7'), 130, 80, 144, 92, 20) !~ '^ERR'
         then (pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p7'), 126, 78, 140, 88, 10) !~ '^ERR')::text else 'false' end) || '|' ||
  pg_temp.npairs(pg_temp.f('p7')) || '|' || pg_temp.flags(pg_temp.f('p7')) || '|' || pg_temp.nincidents());
update public.task_types set is_active = true where code = 'cuff_check_review';
select pg_temp.ck('real', 'L2 once the task type is back, the next pair raises the flag (nothing was lost)', 'true|home_higher',
  (pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p7'), 127, 77, 141, 89, 5) !~ '^ERR')::text || '|' || pg_temp.flags(pg_temp.f('p7')));

-- M. one visit is one pair ----------------------------------------------------------------------------------------------------------------------
select pg_temp.setf('p8', pg_temp.mkuser(pg_temp.f('org'), 'patient p8', 'patient'));
insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (pg_temp.f('org'), pg_temp.f('p8'), pg_temp.f('c1'), pg_temp.f('co'), now());
select pg_temp.ck('real', 'M1 submitting the same pair twice (a double click) stores ONE pair and answers with the same id', 'true|1',
  (pg_temp.pair(pg_temp.f('c1'), pg_temp.f('q'), 128, 78, 142, 90, 6) = pg_temp.pair(pg_temp.f('c1'), pg_temp.f('q'), 128, 78, 142, 90, 6))::text || '|' || pg_temp.npairs(pg_temp.f('q')));
select pg_temp.home2(pg_temp.f('p8'), pg_temp.f('org'), 90, 140, 88);
select pg_temp.home2(pg_temp.f('p8'), pg_temp.f('org'), 70, 141, 89);
select pg_temp.ck('real', 'M2 two clinic readings with home readings make two home-log pairs', 'true|2',
  (pg_temp.clinic(pg_temp.f('c1'), pg_temp.f('p8'), 128, 78, 90) !~ '^ERR' and pg_temp.clinic(pg_temp.f('c1'), pg_temp.f('p8'), 128, 78, 70) !~ '^ERR')::text || '|' || pg_temp.npairs(pg_temp.f('p8')));
select pg_temp.ck('real', 'M3 a same-visit pair for the same visit as a home-log pair is NOT counted twice: three stored pairs, two visits, no flag', 'true|3|none|0',
  (pg_temp.pair(pg_temp.f('c1'), pg_temp.f('p8'), 128, 78, 141, 90, 70) !~ '^ERR')::text || '|' || pg_temp.npairs(pg_temp.f('p8')) || '|' || pg_temp.flags(pg_temp.f('p8')) || '|' || pg_temp.ctasks(pg_temp.f('p8')));

-- SABOTAGE 1: the share gate removed. Three higher pairs out of five (60 percent) must now flag.
do $$
declare v_def text; v_out jsonb; v_cfg jsonb := (select config from public.cuff_check_rules where version = 1);
begin
  select pg_get_functiondef('private.cuff_check_kind(jsonb, timestamptz, jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, 'agg.hi * 100 >= c.sh * agg.n', 'true');
  execute v_def;
  v_out := private.cuff_check_kind((select x -> 'pairs' from parity, jsonb_array_elements(doc -> 'check') x where x ->> 'name' like 'five pairs, three higher%'),
                                   '2026-10-20T00:00:00Z', v_cfg);
  insert into results values ('sabotaged', 'SABOTAGE 1: without the share gate three of five is called consistent', 'null', coalesce(v_out ->> 'kind', 'null'));
end $$;
-- SABOTAGE 2: the tie check removed from the pair function. An untied clinician must now be able to record a pair.
do $$
declare v_def text; v_out text;
begin
  select pg_get_functiondef('public.record_cuff_check_pair(uuid, integer, integer, integer, integer, timestamptz, text)'::regprocedure) into v_def;
  v_def := replace(v_def, 'if not private.staff_may_write(', 'if false and not private.staff_may_write(');
  execute v_def;
  v_out := pg_temp.pair(pg_temp.f('c2'), pg_temp.f('q'), 128, 78, 142, 90, 2);
  insert into results values ('sabotaged', 'SABOTAGE 2: without the tie check an untied clinician records a pair', 'ERR 42501', case when v_out ~ '^ERR' then v_out else 'recorded' end);
end $$;
-- SABOTAGE 3: the boundary made exclusive. A difference of exactly the threshold must now read as agreeing.
do $$
declare v_def text; v_cfg jsonb := (select config from public.cuff_check_rules where version = 1);
begin
  select pg_get_functiondef('private.cuff_pair_class(integer, integer, jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, '>= (p_cfg', '> (p_cfg');
  execute v_def;
  insert into results values ('sabotaged', 'SABOTAGE 3: an exclusive boundary reads exactly-at-threshold as agreeing', 'home_higher', private.cuff_pair_class(10, 0, v_cfg));
end $$;

-- SABOTAGE 4: the one-visit-one-pair exclusion removed. The visit above would now count twice and raise the flag.
do $$
declare v_def text; v_out uuid;
begin
  select pg_get_functiondef('private.evaluate_cuff_check(uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, 'not (p.source = ''home_log'' and exists (', 'not (false and exists (');
  execute v_def;
  v_out := private.evaluate_cuff_check(pg_temp.f('p8'));
  insert into results values ('sabotaged', 'SABOTAGE 4: without the exclusion one visit counts twice and raises a flag', 'none', case when v_out is null then 'none' else 'flagged' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S07y proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: a sabotage did not flip (% of 4)', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
