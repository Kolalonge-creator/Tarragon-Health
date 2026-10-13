-- S07x proof: the seven-day home BP programme, the clinician-only pattern flag, clinic readings and the v4 draft rule set
-- (migrations *_s07x_home_bp_programme.sql and *_s07x_bp_care_triage_v4_draft.sql).
-- One rolled-back transaction. Proves:
--  * the configuration ships unsigned and inactive, only the Chief Medical Officer can sign it, the guards are born off;
--  * a home check is refused while the configuration is unsigned or (for a real patient) the guard is off; with both open it records a complete
--    protocol average once, makes ONE routine care-team task that holds no reading, and refuses an incomplete protocol ("not enough readings yet");
--  * the SQL rules agree with the TypeScript rules on every case in the parity block below (packages/clinical/src/home-bp.test.ts runs the same block);
--  * a clinic reading can be entered only by a clinician tied to the patient, is invisible to the patient, and fires NOTHING that a home reading fires
--    (no vitals row, no alert, no emergency, no observation event, no notification, no new vital_source value);
--  * the white-coat and masked rule raises one routine task per pair, clinician-only, never for a treated patient (white-coat), pregnancy or an adult under 18,
--    and nothing while its guard is off;
--  * the v4 draft differs from v3 only in BP-A7, v3 is still the approved set, and the server context carries the medicines fact.
-- SABOTAGE: (1) the completeness gate lowered to one reading; (2) the white-coat rule allowed for a treated patient. Both must flip.
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
  values (v, 's07x-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S07x ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid language plpgsql as
$f$ declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S07x ' || p_label, 'MDCN', 'S07X-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
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

-- twelve readings over three Lagos days starting on p_start, every reading p_sys/p_dia, inserted as device readings with explicit times
create function pg_temp.seed12(p_pat uuid, p_org uuid, p_start date, p_sys int, p_dia int) returns void language plpgsql as
$f$ declare d int; t text;
begin
  for d in 0..2 loop
    foreach t in array array['06:00:00', '06:01:30', '18:00:00', '18:01:30'] loop
      insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, position, arm)
      values (p_org, p_pat, 'blood_pressure', p_sys, p_dia, ((p_start + d)::text || ' ' || t || '+00')::timestamptz, 'device', 'seated', 'left');
    end loop;
  end loop;
end $f$;

-- C. the parity cases (also run by packages/clinical/src/home-bp.test.ts through the TypeScript rules) ---------------------------------
create temp table parity(doc jsonb) on commit drop;
grant all on parity to public;
-- parity-begin
insert into parity values ($json${"assess":[{"name":"no readings","start":"2026-10-01","readings":[],"expect":{"readings":0,"days":0,"complete":false,"systolic":null,"diastolic":null,"band":null}},{"name":"12 readings over 3 days, all 120/80: complete, within target","start":"2026-10-01","readings":[{"s":120,"d":80,"at":"2026-10-01T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-01T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-03T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-03T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-03T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-03T18:01:30Z"}],"expect":{"readings":12,"days":3,"complete":true,"systolic":120,"diastolic":80,"band":"borderline"}},{"name":"11 readings over 3 days: not enough readings","start":"2026-10-01","readings":[{"s":120,"d":80,"at":"2026-10-01T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-01T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-03T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-03T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-03T18:00:00Z"}],"expect":{"readings":11,"days":3,"complete":false,"systolic":null,"diastolic":null,"band":null}},{"name":"12 readings over only 2 days: not enough days","start":"2026-10-01","readings":[{"s":120,"d":80,"at":"2026-10-01T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-01T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T08:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T08:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T20:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T20:01:30Z"}],"expect":{"readings":12,"days":2,"complete":false,"systolic":null,"diastolic":null,"band":null}},{"name":"mean 136/84: above the home level on systolic","start":"2026-10-01","readings":[{"s":136,"d":84,"at":"2026-10-01T06:00:00Z"},{"s":136,"d":84,"at":"2026-10-01T06:01:30Z"},{"s":136,"d":84,"at":"2026-10-01T18:00:00Z"},{"s":136,"d":84,"at":"2026-10-01T18:01:30Z"},{"s":136,"d":84,"at":"2026-10-02T06:00:00Z"},{"s":136,"d":84,"at":"2026-10-02T06:01:30Z"},{"s":136,"d":84,"at":"2026-10-02T18:00:00Z"},{"s":136,"d":84,"at":"2026-10-02T18:01:30Z"},{"s":136,"d":84,"at":"2026-10-03T06:00:00Z"},{"s":136,"d":84,"at":"2026-10-03T06:01:30Z"},{"s":136,"d":84,"at":"2026-10-03T18:00:00Z"},{"s":136,"d":84,"at":"2026-10-03T18:01:30Z"}],"expect":{"readings":12,"days":3,"complete":true,"systolic":136,"diastolic":84,"band":"above_home_level"}},{"name":"mean 120/86: above the home level on diastolic alone","start":"2026-10-01","readings":[{"s":120,"d":86,"at":"2026-10-01T06:00:00Z"},{"s":120,"d":86,"at":"2026-10-01T06:01:30Z"},{"s":120,"d":86,"at":"2026-10-01T18:00:00Z"},{"s":120,"d":86,"at":"2026-10-01T18:01:30Z"},{"s":120,"d":86,"at":"2026-10-02T06:00:00Z"},{"s":120,"d":86,"at":"2026-10-02T06:01:30Z"},{"s":120,"d":86,"at":"2026-10-02T18:00:00Z"},{"s":120,"d":86,"at":"2026-10-02T18:01:30Z"},{"s":120,"d":86,"at":"2026-10-03T06:00:00Z"},{"s":120,"d":86,"at":"2026-10-03T06:01:30Z"},{"s":120,"d":86,"at":"2026-10-03T18:00:00Z"},{"s":120,"d":86,"at":"2026-10-03T18:01:30Z"}],"expect":{"readings":12,"days":3,"complete":true,"systolic":120,"diastolic":86,"band":"above_home_level"}},{"name":"mean 130/80 exactly: borderline","start":"2026-10-01","readings":[{"s":130,"d":80,"at":"2026-10-01T06:00:00Z"},{"s":130,"d":80,"at":"2026-10-01T06:01:30Z"},{"s":130,"d":80,"at":"2026-10-01T18:00:00Z"},{"s":130,"d":80,"at":"2026-10-01T18:01:30Z"},{"s":130,"d":80,"at":"2026-10-02T06:00:00Z"},{"s":130,"d":80,"at":"2026-10-02T06:01:30Z"},{"s":130,"d":80,"at":"2026-10-02T18:00:00Z"},{"s":130,"d":80,"at":"2026-10-02T18:01:30Z"},{"s":130,"d":80,"at":"2026-10-03T06:00:00Z"},{"s":130,"d":80,"at":"2026-10-03T06:01:30Z"},{"s":130,"d":80,"at":"2026-10-03T18:00:00Z"},{"s":130,"d":80,"at":"2026-10-03T18:01:30Z"}],"expect":{"readings":12,"days":3,"complete":true,"systolic":130,"diastolic":80,"band":"borderline"}},{"name":"mean 134/84: borderline","start":"2026-10-01","readings":[{"s":134,"d":84,"at":"2026-10-01T06:00:00Z"},{"s":134,"d":84,"at":"2026-10-01T06:01:30Z"},{"s":134,"d":84,"at":"2026-10-01T18:00:00Z"},{"s":134,"d":84,"at":"2026-10-01T18:01:30Z"},{"s":134,"d":84,"at":"2026-10-02T06:00:00Z"},{"s":134,"d":84,"at":"2026-10-02T06:01:30Z"},{"s":134,"d":84,"at":"2026-10-02T18:00:00Z"},{"s":134,"d":84,"at":"2026-10-02T18:01:30Z"},{"s":134,"d":84,"at":"2026-10-03T06:00:00Z"},{"s":134,"d":84,"at":"2026-10-03T06:01:30Z"},{"s":134,"d":84,"at":"2026-10-03T18:00:00Z"},{"s":134,"d":84,"at":"2026-10-03T18:01:30Z"}],"expect":{"readings":12,"days":3,"complete":true,"systolic":134,"diastolic":84,"band":"borderline"}},{"name":"mean 129/79: within target","start":"2026-10-01","readings":[{"s":129,"d":79,"at":"2026-10-01T06:00:00Z"},{"s":129,"d":79,"at":"2026-10-01T06:01:30Z"},{"s":129,"d":79,"at":"2026-10-01T18:00:00Z"},{"s":129,"d":79,"at":"2026-10-01T18:01:30Z"},{"s":129,"d":79,"at":"2026-10-02T06:00:00Z"},{"s":129,"d":79,"at":"2026-10-02T06:01:30Z"},{"s":129,"d":79,"at":"2026-10-02T18:00:00Z"},{"s":129,"d":79,"at":"2026-10-02T18:01:30Z"},{"s":129,"d":79,"at":"2026-10-03T06:00:00Z"},{"s":129,"d":79,"at":"2026-10-03T06:01:30Z"},{"s":129,"d":79,"at":"2026-10-03T18:00:00Z"},{"s":129,"d":79,"at":"2026-10-03T18:01:30Z"}],"expect":{"readings":12,"days":3,"complete":true,"systolic":129,"diastolic":79,"band":"within_home_target"}},{"name":"mean 134.5 systolic rounds up to 135: above the home level","start":"2026-10-01","readings":[{"s":134,"d":80,"at":"2026-10-01T06:00:00Z"},{"s":135,"d":80,"at":"2026-10-01T06:01:30Z"},{"s":134,"d":80,"at":"2026-10-01T18:00:00Z"},{"s":135,"d":80,"at":"2026-10-01T18:01:30Z"},{"s":134,"d":80,"at":"2026-10-02T06:00:00Z"},{"s":135,"d":80,"at":"2026-10-02T06:01:30Z"},{"s":134,"d":80,"at":"2026-10-02T18:00:00Z"},{"s":135,"d":80,"at":"2026-10-02T18:01:30Z"},{"s":134,"d":80,"at":"2026-10-03T06:00:00Z"},{"s":135,"d":80,"at":"2026-10-03T06:01:30Z"},{"s":134,"d":80,"at":"2026-10-03T18:00:00Z"},{"s":135,"d":80,"at":"2026-10-03T18:01:30Z"}],"expect":{"readings":12,"days":3,"complete":true,"systolic":135,"diastolic":80,"band":"above_home_level"}},{"name":"a reading 30 seconds after the previous one is the same measurement: not counted","start":"2026-10-01","readings":[{"s":120,"d":80,"at":"2026-10-01T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-01T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-03T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-03T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-03T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-03T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-01T06:00:30Z"}],"expect":{"readings":12,"days":3,"complete":true,"systolic":120,"diastolic":80,"band":"borderline"}},{"name":"11 readings plus one 40 seconds after the previous: still 11","start":"2026-10-01","readings":[{"s":120,"d":80,"at":"2026-10-01T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-01T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-03T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-03T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-03T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-03T18:00:40Z"}],"expect":{"readings":11,"days":3,"complete":false,"systolic":null,"diastolic":null,"band":null}},{"name":"exactly 60 seconds apart: both counted","start":"2026-10-01","readings":[{"s":120,"d":80,"at":"2026-10-01T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T06:01:00Z"}],"expect":{"readings":2,"days":1,"complete":false,"systolic":null,"diastolic":null,"band":null}},{"name":"readings on day 8 and the day before the start are ignored","start":"2026-10-01","readings":[{"s":120,"d":80,"at":"2026-10-01T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-01T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-02T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-03T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-03T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-03T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-03T18:01:30Z"},{"s":200,"d":120,"at":"2026-10-08T06:00:00Z"},{"s":200,"d":120,"at":"2026-09-30T06:00:00Z"}],"expect":{"readings":12,"days":3,"complete":true,"systolic":120,"diastolic":80,"band":"borderline"}},{"name":"23:30 UTC is 00:30 the next Lagos day: 12 readings over 3 Lagos days","start":"2026-10-01","readings":[{"s":120,"d":80,"at":"2026-10-01T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T06:01:30Z"},{"s":120,"d":80,"at":"2026-10-01T18:00:00Z"},{"s":120,"d":80,"at":"2026-10-01T18:01:30Z"},{"s":120,"d":80,"at":"2026-10-01T23:30:00Z"},{"s":120,"d":80,"at":"2026-10-01T23:32:00Z"},{"s":120,"d":80,"at":"2026-10-02T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-02T06:02:00Z"},{"s":120,"d":80,"at":"2026-10-02T23:30:00Z"},{"s":120,"d":80,"at":"2026-10-02T23:32:00Z"},{"s":120,"d":80,"at":"2026-10-03T06:00:00Z"},{"s":120,"d":80,"at":"2026-10-03T06:02:00Z"}],"expect":{"readings":12,"days":3,"complete":true,"systolic":120,"diastolic":80,"band":"borderline"}},{"name":"23:30 UTC on day 7 is Lagos day 8: outside the window","start":"2026-10-01","readings":[{"s":150,"d":95,"at":"2026-10-07T23:30:00Z"}],"expect":{"readings":0,"days":0,"complete":false,"systolic":null,"diastolic":null,"band":null}}],"pattern":[{"name":"masked, untreated: clinic 126/78, home 138/86","clinic":{"s":126,"d":78,"at":"2026-10-12T11:00:00Z"},"home":{"s":138,"d":86,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":"masked"},{"name":"masked uncontrolled, treated","clinic":{"s":126,"d":78,"at":"2026-10-12T11:00:00Z"},"home":{"s":138,"d":86,"end":"2026-10-10T22:59:59Z"},"treated":true,"pregnant":false,"age":45,"expect":"masked_uncontrolled"},{"name":"white-coat, untreated: clinic 152/96, home 126/78","clinic":{"s":152,"d":96,"at":"2026-10-12T11:00:00Z"},"home":{"s":126,"d":78,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":"white_coat"},{"name":"white-coat is never raised for a treated patient","clinic":{"s":152,"d":96,"at":"2026-10-12T11:00:00Z"},"home":{"s":126,"d":78,"end":"2026-10-10T22:59:59Z"},"treated":true,"pregnant":false,"age":45,"expect":null},{"name":"clinic raised and home above: neither pattern","clinic":{"s":152,"d":96,"at":"2026-10-12T11:00:00Z"},"home":{"s":138,"d":86,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":null},{"name":"clinic and home both within: nothing","clinic":{"s":126,"d":78,"at":"2026-10-12T11:00:00Z"},"home":{"s":126,"d":78,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":null},{"name":"clinic 140/89 is raised on systolic; home within: white-coat","clinic":{"s":140,"d":89,"at":"2026-10-12T11:00:00Z"},"home":{"s":126,"d":78,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":"white_coat"},{"name":"clinic 139/90 is raised on diastolic; home within: white-coat","clinic":{"s":139,"d":90,"at":"2026-10-12T11:00:00Z"},"home":{"s":126,"d":78,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":"white_coat"},{"name":"clinic 139/89 is below 140/90; home above on diastolic 85: masked","clinic":{"s":139,"d":89,"at":"2026-10-12T11:00:00Z"},"home":{"s":120,"d":85,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":"masked"},{"name":"home exactly 135/84 is above: masked","clinic":{"s":120,"d":80,"at":"2026-10-12T11:00:00Z"},"home":{"s":135,"d":84,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":"masked"},{"name":"home 134/84 is below: no masked pattern","clinic":{"s":120,"d":80,"at":"2026-10-12T11:00:00Z"},"home":{"s":134,"d":84,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":null},{"name":"pregnancy: the rule does not apply","clinic":{"s":126,"d":78,"at":"2026-10-12T11:00:00Z"},"home":{"s":138,"d":86,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":true,"age":30,"expect":null},{"name":"under 18: the rule does not apply","clinic":{"s":126,"d":78,"at":"2026-10-12T11:00:00Z"},"home":{"s":138,"d":86,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":17,"expect":null},{"name":"exactly 18 is an adult","clinic":{"s":126,"d":78,"at":"2026-10-12T11:00:00Z"},"home":{"s":138,"d":86,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":18,"expect":"masked"},{"name":"unknown age is still evaluated","clinic":{"s":126,"d":78,"at":"2026-10-12T11:00:00Z"},"home":{"s":138,"d":86,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":null,"expect":"masked"},{"name":"clinic reading far more than 30 days after the home average: no pattern","clinic":{"s":126,"d":78,"at":"2026-11-15T11:00:00Z"},"home":{"s":138,"d":86,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":null},{"name":"clinic reading exactly 30 days after the end of the home window: still inside","clinic":{"s":126,"d":78,"at":"2026-11-09T22:59:59Z"},"home":{"s":138,"d":86,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":"masked"},{"name":"clinic reading 30 days before: inside","clinic":{"s":126,"d":78,"at":"2026-09-10T22:59:59Z"},"home":{"s":138,"d":86,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":"masked"},{"name":"clinic reading one second beyond 30 days: outside","clinic":{"s":126,"d":78,"at":"2026-11-10T00:00:00Z"},"home":{"s":138,"d":86,"end":"2026-10-10T22:59:59Z"},"treated":false,"pregnant":false,"age":45,"expect":null}]}$json$::jsonb);
-- parity-end

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_c1 uuid; v_c2 uuid; v_co uuid; v_p uuid; v_pr uuid; v_q uuid;
  v_cfg jsonb := (select config from public.home_bp_programme_signoffs where version = 1);
  c jsonb; r jsonb; v_i int := 0; v_k text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin'); perform pg_temp.setf('admin', v_admin);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin); perform pg_temp.setf('cmo', v_cmo);
  v_c1 := pg_temp.mkdoc(v_org, 'tied smo', 'senior_medical_officer', v_admin); perform pg_temp.setf('c1', v_c1);
  v_c2 := pg_temp.mkdoc(v_org, 'untied smo', 'senior_medical_officer', v_admin); perform pg_temp.setf('c2', v_c2);
  v_co := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator'); perform pg_temp.setf('co', v_co);
  -- patients: p (test), p2 (test, takes BP medicines), p3 (test, untreated), p4 (test, treated), r (a REAL patient, is_test false), q (another patient)
  foreach v_k in array array['p', 'p2', 'p3', 'p4', 'p5', 'p6', 'q'] loop
    perform pg_temp.setf(v_k, pg_temp.mkuser(v_org, 'patient ' || v_k, 'patient'));
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at)
    values (v_org, pg_temp.f(v_k), v_c1, v_co, now());
  end loop;
  v_pr := pg_temp.mkuser(v_org, 'real patient', 'patient', false); perform pg_temp.setf('r', v_pr);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_pr, v_c1, v_co, now());
  -- p2 and p4 take a blood pressure medicine (an active medicine whose indication says so)
  foreach v_k in array array['p2', 'p4'] loop
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, indication)
    values (v_org, pg_temp.f(v_k), case when v_k = 'p2' then 'Amlodipine' else 'S07x proof medicine' end, '5 mg', 'once daily', true,
            case when v_k = 'p4' then 'High blood pressure (hypertension)' end);
  end loop;

  -- A. the seed, the signature, the guards ---------------------------------------------------------------------------------------
  perform pg_temp.ck('real', 'S1 the seed configuration ships unsigned and inactive', 'true',
    (select (not is_active and approved_by is null)::text from public.home_bp_programme_signoffs where version = 1));
  perform pg_temp.ck('real', 'S2 nothing reads an unsigned configuration', 'null', coalesce(private.home_bp_config()::text, 'null'));
  perform pg_temp.ck('real', 'S3 both guards exist, are off, and are the CMO''s switch', 'off|off|cmo|cmo',
    (select string_agg(case when is_on then 'on' else 'off' end, '|' order by key) || '|' || string_agg(switch_role, '|' order by key) from public.go_live_guards where key in ('home_bp_programme', 'bp_pattern_flag')));
  perform pg_temp.ck('real', 'S4 the guard conditions say the configuration is unmet', 'false',
    (select (private.go_live_conditions('home_bp_programme', v_org) -> 0 ->> 'met') from (select 1) x));
  perform pg_temp.ck('real', 'S5 anon cannot call the patient or the clinician function', 'false|false',
    has_function_privilege('anon', 'public.complete_home_bp_check(date)', 'EXECUTE')::text || '|' || has_function_privilege('anon', 'public.record_clinic_bp_reading(uuid,integer,integer,timestamptz,text)', 'EXECUTE')::text);
  perform pg_temp.ck('real', 'S6 a signed-in user cannot call the pattern rule or the assess functions directly', 'false|false|false',
    has_function_privilege('authenticated', 'private.evaluate_bp_pattern(uuid)', 'EXECUTE')::text || '|' || has_function_privilege('authenticated', 'private.home_bp_assess(uuid,date,jsonb)', 'EXECUTE')::text
    || '|' || has_function_privilege('authenticated', 'private.bp_pattern_kind(int,int,timestamptz,int,int,timestamptz,boolean,boolean,int,jsonb)', 'EXECUTE')::text);

  -- B. parity, SQL side ---------------------------------------------------------------------------------------------------------
  for c in select x from jsonb_array_elements((select doc -> 'assess' from parity)) x loop
    v_i := v_i + 1;
    r := private.home_bp_assess_readings(c -> 'readings', (c ->> 'start')::date, v_cfg);
    perform pg_temp.ck('real', 'PA' || v_i || ' ' || (c ->> 'name'), (c -> 'expect')::text,
      jsonb_build_object('readings', r -> 'readings', 'days', r -> 'days', 'complete', r -> 'complete', 'systolic', r -> 'systolic', 'diastolic', r -> 'diastolic', 'band', r -> 'band')::text);
  end loop;
  v_i := 0;
  for c in select x from jsonb_array_elements((select doc -> 'pattern' from parity)) x loop
    v_i := v_i + 1;
    perform pg_temp.ck('real', 'PP' || v_i || ' ' || (c ->> 'name'), coalesce(c ->> 'expect', 'null'),
      coalesce(private.bp_pattern_kind((c -> 'clinic' ->> 's')::int, (c -> 'clinic' ->> 'd')::int, (c -> 'clinic' ->> 'at')::timestamptz,
        (c -> 'home' ->> 's')::int, (c -> 'home' ->> 'd')::int, (c -> 'home' ->> 'end')::timestamptz,
        (c ->> 'treated')::boolean, (c ->> 'pregnant')::boolean, (c ->> 'age')::int, v_cfg), 'null'));
  end loop;
end $$;

-- the unsigned configuration refuses a home check (even for a test patient: the guard passes test accounts, the signature does not)
select pg_temp.ck('real', 'G1 an unsigned configuration refuses a home check', 'ERR 55000',
  pg_temp.as_user(pg_temp.f('p'), format('select public.complete_home_bp_check(%L)::text', (now() at time zone 'Africa/Lagos')::date - 9)));
select pg_temp.ck('real', 'G2 a non-CMO cannot sign', 'ERR P0001',
  pg_temp.as_user(pg_temp.f('c1'), format('select public.sign_home_bp_programme(%L)::text', (select id from public.home_bp_programme_signoffs where version = 1))));
select pg_temp.ck('real', 'G3 the CMO signs; it becomes the one active signed configuration', 'ok',
  (select case when o ~ '^ERR' then o else 'ok' end from (select pg_temp.as_user(pg_temp.f('cmo'), format('select public.sign_home_bp_programme(%L)::text', (select id from public.home_bp_programme_signoffs where version = 1))) o) z));
select pg_temp.ck('real', 'G3b ...and it is the one active, signed configuration', 'true',
  ((select is_active and approved_by is not null from public.home_bp_programme_signoffs where version = 1) and private.home_bp_config() is not null)::text);
create temp table signed_at on commit drop as select approved_at, approved_by from public.home_bp_programme_signoffs where version = 1;
select pg_temp.ck('real', 'G6 signing the same version again is refused and the original signature is untouched', 'ERR P0001|true',
  pg_temp.as_user(pg_temp.f('cmo'), format('select public.sign_home_bp_programme(%L)::text', (select id from public.home_bp_programme_signoffs where version = 1))) || '|' ||
  ((select approved_at = (select approved_at from signed_at) and approved_by = (select approved_by from signed_at) from public.home_bp_programme_signoffs where version = 1))::text);
insert into public.home_bp_programme_signoffs (version, config, notes) values (2, '{"protocol": {}}'::jsonb, 'proof: a draft missing the values the programme reads');
select pg_temp.ck('real', 'G7 a draft missing a value the programme reads cannot be signed, and version 1 stays active', 'ERR P0001|1',
  pg_temp.as_user(pg_temp.f('cmo'), format('select public.sign_home_bp_programme(%L)::text', (select id from public.home_bp_programme_signoffs where version = 2))) || '|' ||
  (select version from public.home_bp_programme_signoffs where is_active)::text);
select pg_temp.ck('real', 'G4 the guard conditions now say the configuration is signed', 'true',
  (private.go_live_conditions('home_bp_programme', pg_temp.f('org')) -> 0 ->> 'met'));
-- a real patient is refused while the guard is off, even with the configuration signed
select pg_temp.ck('real', 'G5 a real patient is refused while the guard is off', 'ERR 55000',
  pg_temp.as_user(pg_temp.f('r'), format('select public.complete_home_bp_check(%L)::text', (now() at time zone 'Africa/Lagos')::date - 9)));

-- C. a home check ------------------------------------------------------------------------------------------------------------------
-- window: starts 9 Lagos days ago, ends 3 days ago; readings sit on the first three days
do $$
declare v_start date := (now() at time zone 'Africa/Lagos')::date - 9; v_org uuid := pg_temp.f('org'); v_p uuid := pg_temp.f('p'); v_out text;
begin
  perform pg_temp.setf('dummy', v_p);
  -- three readings: not enough
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, position, arm)
  select v_org, v_p, 'blood_pressure', 138, 86, ((v_start + g)::text || ' 06:00:00+00')::timestamptz, 'device', 'seated', 'left' from generate_series(0, 2) g;
  v_out := pg_temp.as_user(v_p, format('select public.complete_home_bp_check(%L)::text', v_start));
  perform pg_temp.ck('real', 'H1 three readings: not enough readings yet, nothing recorded', 'false|0|0',
    (v_out::jsonb ->> 'complete')::boolean::text || '|' || (select count(*) from public.home_bp_checks where patient_id = v_p) || '|' ||
    (select count(*) from public.clinical_tasks where patient_id = v_p and type = 'home_bp_check_review'));
end $$;
select pg_temp.ck('real', 'H1b the not-enough answer says how many readings and days were counted', '3|3',
  (select (x ->> 'readings') || '|' || (x ->> 'days') from (select pg_temp.as_user(pg_temp.f('p'), format('select public.complete_home_bp_check(%L)::text', (now() at time zone 'Africa/Lagos')::date - 9))::jsonb x) y));

-- replace the three with a full protocol: 12 readings, 3 days, mean 138/86
delete from public.vitals_readings where patient_id = pg_temp.f('p');
select pg_temp.seed12(pg_temp.f('p'), pg_temp.f('org'), (now() at time zone 'Africa/Lagos')::date - 9, 138, 86);
create temp table snap on commit drop as
select 'alerts' k, count(*) n from public.clinician_alerts where patient_id = pg_temp.f('p')
union all select 'emergency', count(*) from public.emergency_events where patient_id = pg_temp.f('p')
union all select 'notifications', count(*) from public.notifications where recipient_id = pg_temp.f('p');
grant all on snap to public;

select pg_temp.ck('real', 'H2 twelve readings over three days record a complete average above the home level', 'true|above_home_level|138|86|12|3',
  (select (x ->> 'complete')::boolean::text || '|' || (x ->> 'band') || '|' || (x ->> 'systolic') || '|' || (x ->> 'diastolic') || '|' || (x ->> 'readings') || '|' || (x ->> 'days')
     from (select pg_temp.as_user(pg_temp.f('p'), format('select public.complete_home_bp_check(%L)::text', (now() at time zone 'Africa/Lagos')::date - 9))::jsonb x) y));
select pg_temp.ck('real', 'H3 exactly one check row and one routine task (class 8) were made', '1|1|8',
  (select count(*) from public.home_bp_checks where patient_id = pg_temp.f('p')) || '|' ||
  (select count(*) from public.clinical_tasks where patient_id = pg_temp.f('p') and type = 'home_bp_check_review') || '|' ||
  (select coalesce(max(priority_class), 0) from public.clinical_tasks where patient_id = pg_temp.f('p') and type = 'home_bp_check_review'));
select pg_temp.ck('real', 'H4 calling again is idempotent: same row, no second task', 'true|1|1',
  (select (x ->> 'alreadyRecorded')::boolean::text from (select pg_temp.as_user(pg_temp.f('p'), format('select public.complete_home_bp_check(%L)::text', (now() at time zone 'Africa/Lagos')::date - 9))::jsonb x) y)
  || '|' || (select count(*) from public.home_bp_checks where patient_id = pg_temp.f('p')) || '|' ||
  (select count(*) from public.clinical_tasks where patient_id = pg_temp.f('p') and type = 'home_bp_check_review'));
select pg_temp.ck('real', 'O1 a window that overlaps a recorded one is answered with the earlier record: no second check, no second task', 'true|1|1',
  (select (x ->> 'alreadyRecorded')::boolean::text from (select pg_temp.as_user(pg_temp.f('p'), format('select public.complete_home_bp_check(%L)::text', (now() at time zone 'Africa/Lagos')::date - 8))::jsonb x) y)
  || '|' || (select count(*) from public.home_bp_checks where patient_id = pg_temp.f('p')) || '|' ||
  (select count(*) from public.clinical_tasks where patient_id = pg_temp.f('p') and type = 'home_bp_check_review'));
select pg_temp.ck('real', 'H5 the task is an ordinary routine task; no reading, band or condition is stored on it', 'true',
  (select (not (to_jsonb(t) ?| array['systolic', 'diastolic', 'band', 'value', 'reading']) and t.dedup_key like 'home_bp_check:%')::text from public.clinical_tasks t where t.patient_id = pg_temp.f('p') and t.type = 'home_bp_check_review' limit 1));
select pg_temp.ck('real', 'H6 the check raised no alert, no emergency and no notification of its own', '0|0|0',
  ((select count(*) from public.clinician_alerts where patient_id = pg_temp.f('p')) - (select n from snap where k = 'alerts')) || '|' ||
  ((select count(*) from public.emergency_events where patient_id = pg_temp.f('p')) - (select n from snap where k = 'emergency')) || '|' ||
  ((select count(*) from public.notifications where recipient_id = pg_temp.f('p')) - (select n from snap where k = 'notifications')));
-- who can read the check
select pg_temp.ck('real', 'H7 the patient reads her own check; another patient, anon, an untied clinician and a coordinator read none; the tied clinician reads it', '1|0|ERR 42501|0|0|1',
  pg_temp.as_user(pg_temp.f('p'), 'select count(*)::text from public.home_bp_checks') || '|' ||
  pg_temp.as_user(pg_temp.f('q'), 'select count(*)::text from public.home_bp_checks') || '|' ||
  pg_temp.as_anon('select count(*)::text from public.home_bp_checks') || '|' ||
  pg_temp.as_user(pg_temp.f('c2'), 'select count(*)::text from public.home_bp_checks') || '|' ||
  pg_temp.as_user(pg_temp.f('co'), 'select count(*)::text from public.home_bp_checks') || '|' ||
  pg_temp.as_user(pg_temp.f('c1'), 'select count(*)::text from public.home_bp_checks'));

select pg_temp.ck('real', 'H8 nobody can write the table directly, and the append-only trigger is enabled', 'ERR 42501|ERR 42501|ERR 42501|true',
  pg_temp.as_user(pg_temp.f('p'), format('insert into public.home_bp_checks (organisation_id, patient_id, window_start, window_end, readings, days, mean_systolic, mean_diastolic, band, config_version) values (%L, %L, current_date, current_date, 12, 3, 120, 80, ''within_home_target'', 1)', pg_temp.f('org'), pg_temp.f('p'))) || '|' ||
  pg_temp.as_user(pg_temp.f('c1'), 'update public.home_bp_checks set band = ''within_home_target''') || '|' ||
  pg_temp.as_user(pg_temp.f('p'), 'delete from public.home_bp_checks') || '|' ||
  exists (select 1 from pg_trigger where tgrelid = 'public.home_bp_checks'::regclass and tgname = 'home_bp_checks_no_change' and tgenabled = 'O')::text);

create function pg_temp.rec(p_uid uuid, p_pat uuid, p_sys int, p_dia int, p_day_offset int) returns text language sql as
$$ select pg_temp.as_user(p_uid, format('select public.record_clinic_bp_reading(%L, %s, %s, ((current_date - %s)::text || '' 11:00:00+00'')::timestamptz)::text', p_pat, p_sys, p_dia, p_day_offset)) $$;
create function pg_temp.chk(p_uid uuid) returns text language sql as
$$ select pg_temp.as_user(p_uid, format('select public.complete_home_bp_check(%L)::text', (now() at time zone 'Africa/Lagos')::date - 9)) $$;
create function pg_temp.flags(p_pat uuid) returns text language sql as
$$ select coalesce(string_agg(kind || ':' || treated::text, ',' order by created_at), 'none') from public.bp_pattern_flags where patient_id = p_pat $$;
create function pg_temp.ptasks(p_pat uuid) returns text language sql as
$$ select count(*)::text from public.clinical_tasks where patient_id = p_pat and type = 'bp_pattern_review' $$;

-- D. clinic readings --------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'D1 only a clinician tied to the patient can record a clinic reading', 'ERR 42501|ERR 42501|ERR 42501|ERR 42501',
  pg_temp.rec(pg_temp.f('c2'), pg_temp.f('p'), 126, 78, 2) || '|' || pg_temp.rec(pg_temp.f('co'), pg_temp.f('p'), 126, 78, 2) || '|' ||
  pg_temp.rec(pg_temp.f('p'), pg_temp.f('p'), 126, 78, 2) || '|' ||
  pg_temp.as_anon(format('select public.record_clinic_bp_reading(%L, 126, 78, now() - interval ''1 hour'')::text', pg_temp.f('p'))));
select pg_temp.ck('real', 'D2 an implausible, inverted, future or very old reading is refused', 'ERR 22023|ERR 22023|ERR 22023|ERR 22023',
  pg_temp.rec(pg_temp.f('c1'), pg_temp.f('p'), 300, 100, 2) || '|' || pg_temp.rec(pg_temp.f('c1'), pg_temp.f('p'), 100, 110, 2) || '|' ||
  pg_temp.rec(pg_temp.f('c1'), pg_temp.f('p'), 126, 78, -2) || '|' || pg_temp.rec(pg_temp.f('c1'), pg_temp.f('p'), 126, 78, 400));

-- the pattern guard is OFF; a REAL patient (r) proves it stays shut. r has a complete check on record (inserted by the owner for the proof).
insert into public.home_bp_checks (organisation_id, patient_id, window_start, window_end, readings, days, mean_systolic, mean_diastolic, band, config_version, is_test)
select pg_temp.f('org'), pg_temp.f('r'), d - 6, d, 12, 3, 138, 86, 'above_home_level', 1, false from (select (now() at time zone 'Africa/Lagos')::date - 3 as d) x;
select pg_temp.ck('real', 'D3 with the pattern guard off, a clinic reading is stored for a real patient and raises no flag and no task', 'true|none|0',
  (pg_temp.rec(pg_temp.f('c1'), pg_temp.f('r'), 126, 78, 2) !~ '^ERR')::text || '|' || pg_temp.flags(pg_temp.f('r')) || '|' || pg_temp.ptasks(pg_temp.f('r')));
select pg_temp.ck('real', 'D4 the clinic reading is invisible to the patient and to anon; the tied clinician reads it; the untied clinician does not', '0|ERR 42501|1|0',
  pg_temp.as_user(pg_temp.f('r'), 'select count(*)::text from public.clinic_bp_readings') || '|' || pg_temp.as_anon('select count(*)::text from public.clinic_bp_readings') || '|' ||
  pg_temp.as_user(pg_temp.f('c1'), format('select count(*)::text from public.clinic_bp_readings where patient_id = %L', pg_temp.f('r'))) || '|' ||
  pg_temp.as_user(pg_temp.f('c2'), format('select count(*)::text from public.clinic_bp_readings where patient_id = %L', pg_temp.f('r'))));

-- the other test patients complete a check each (windows end 3 days ago, so a clinic reading the day after is the nearest and deterministic)
select pg_temp.seed12(pg_temp.f('p2'), pg_temp.f('org'), (now() at time zone 'Africa/Lagos')::date - 9, 138, 86);
select pg_temp.seed12(pg_temp.f('p3'), pg_temp.f('org'), (now() at time zone 'Africa/Lagos')::date - 9, 126, 78);
select pg_temp.seed12(pg_temp.f('p4'), pg_temp.f('org'), (now() at time zone 'Africa/Lagos')::date - 9, 126, 78);
select pg_temp.ck('real', 'D5pre the pattern guard cannot be switched on before the clinician-only attestation is recorded', 'refused',
  (select case when o ~ '^ERR' then 'refused' else o end from (select pg_temp.as_user(pg_temp.f('cmo'), 'select public.set_go_live_guard(''bp_pattern_flag'', true, ''S07x proof'')::text') o) z));
select pg_temp.ck('real', 'D5a the CMO records the clinician-only attestation', 'ok',
  (select case when o ~ '^ERR' then o else 'ok' end from (select pg_temp.as_user(pg_temp.f('cmo'), 'select public.attest_go_live_condition(''bp_pattern_flag'', ''pattern_is_clinician_only'', true, ''S07x proof: no patient screen, notification or export shows the flag'')::text') o) z));
select pg_temp.ck('real', 'D5 the CMO switches the pattern guard on (its data conditions are met)', 'ok',
  (select case when o ~ '^ERR' then o else 'ok' end from (select pg_temp.as_user(pg_temp.f('cmo'), 'select public.set_go_live_guard(''bp_pattern_flag'', true, ''S07x proof'')::text') o) z));
select pg_temp.ck('real', 'D5b ...and the guard is on', 'true', (select is_on from public.go_live_guards where key = 'bp_pattern_flag')::text);
select pg_temp.ck('real', 'D6 the three other patients complete their checks', 'true|true|true',
  (pg_temp.chk(pg_temp.f('p2')) !~ '^ERR')::text || '|' || (pg_temp.chk(pg_temp.f('p3')) !~ '^ERR')::text || '|' || (pg_temp.chk(pg_temp.f('p4')) !~ '^ERR')::text);

-- early send: 12 readings on days 1 to 3 of a window that has not finished; the record ends today, not on a day that has not happened
select pg_temp.seed12(pg_temp.f('p6'), pg_temp.f('org'), (now() at time zone 'Africa/Lagos')::date - 2, 126, 78);
select pg_temp.ck('real', 'E1 a check sent on day 3 is accepted', 'true',
  (pg_temp.as_user(pg_temp.f('p6'), format('select public.complete_home_bp_check(%L)::text', (now() at time zone 'Africa/Lagos')::date - 2)) !~ '^ERR')::text);
select pg_temp.ck('real', 'E1b ...and the record ends today, not on a day that has not happened', 'true',
  ((select window_end = (now() at time zone 'Africa/Lagos')::date from public.home_bp_checks where patient_id = pg_temp.f('p6')))::text);

create temp table snap2 on commit drop as
select 'vitals' k, count(*) n from public.vitals_readings where patient_id = pg_temp.f('p')
union all select 'alerts', count(*) from public.clinician_alerts where patient_id = pg_temp.f('p')
union all select 'emergency', count(*) from public.emergency_events where patient_id = pg_temp.f('p')
union all select 'events', count(*) from public.domain_events where patient_id = pg_temp.f('p') and event_type = 'observation.recorded'
union all select 'notifications', count(*) from public.notifications where recipient_id = pg_temp.f('p');
grant all on snap2 to public;

-- E. the pattern rule, end to end --------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'P1 p (untreated, home 138/86, clinic 126/78) gets one masked flag and one routine task', 'true|masked:false|1',
  (pg_temp.rec(pg_temp.f('c1'), pg_temp.f('p'), 126, 78, 2) !~ '^ERR')::text || '|' || pg_temp.flags(pg_temp.f('p')) || '|' || pg_temp.ptasks(pg_temp.f('p')));
select pg_temp.ck('real', 'P2 a second, farther clinic reading does not raise a second flag for the same check', 'true|masked:false|1',
  (pg_temp.rec(pg_temp.f('c1'), pg_temp.f('p'), 152, 96, 1) !~ '^ERR')::text || '|' || pg_temp.flags(pg_temp.f('p')) || '|' || pg_temp.ptasks(pg_temp.f('p')));
select pg_temp.ck('real', 'P3 the clinic readings fired nothing a home reading fires: no vitals row, alert, emergency, observation event or notification', '0|0|0|0|0',
  ((select count(*) from public.vitals_readings where patient_id = pg_temp.f('p')) - (select n from snap2 where k = 'vitals')) || '|' ||
  ((select count(*) from public.clinician_alerts where patient_id = pg_temp.f('p')) - (select n from snap2 where k = 'alerts')) || '|' ||
  ((select count(*) from public.emergency_events where patient_id = pg_temp.f('p')) - (select n from snap2 where k = 'emergency')) || '|' ||
  ((select count(*) from public.domain_events where patient_id = pg_temp.f('p') and event_type = 'observation.recorded') - (select n from snap2 where k = 'events')) || '|' ||
  ((select count(*) from public.notifications where recipient_id = pg_temp.f('p')) - (select n from snap2 where k = 'notifications')));
select pg_temp.ck('real', 'P4 vital_source has no clinic value and no vitals_readings trigger mentions one', '0|0',
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'vital_source' and e.enumlabel ilike '%clinic%') || '|' ||
  (select count(*) from pg_trigger g where g.tgrelid = 'public.vitals_readings'::regclass and not g.tgisinternal and pg_get_triggerdef(g.oid) ilike '%clinic%'));
select pg_temp.ck('real', 'P5 p2 (treated, home 138/86, clinic 126/78) gets masked_uncontrolled', 'true|masked_uncontrolled:true',
  (pg_temp.rec(pg_temp.f('c1'), pg_temp.f('p2'), 126, 78, 2) !~ '^ERR')::text || '|' || pg_temp.flags(pg_temp.f('p2')));
select pg_temp.ck('real', 'P6 p3 (untreated, home 126/78, clinic 152/96) gets white_coat', 'true|white_coat:false',
  (pg_temp.rec(pg_temp.f('c1'), pg_temp.f('p3'), 152, 96, 2) !~ '^ERR')::text || '|' || pg_temp.flags(pg_temp.f('p3')));
select pg_temp.ck('real', 'P7 p4 (treated, home 126/78, clinic 152/96) gets NO white-coat flag and no task', 'true|none|0',
  (pg_temp.rec(pg_temp.f('c1'), pg_temp.f('p4'), 152, 96, 2) !~ '^ERR')::text || '|' || pg_temp.flags(pg_temp.f('p4')) || '|' || pg_temp.ptasks(pg_temp.f('p4')));
select pg_temp.ck('real', 'P8 the flag is clinician-only: the patient and anon read none, the tied clinician reads it, the untied one does not', '0|ERR 42501|1|0',
  pg_temp.as_user(pg_temp.f('p'), 'select count(*)::text from public.bp_pattern_flags') || '|' || pg_temp.as_anon('select count(*)::text from public.bp_pattern_flags') || '|' ||
  pg_temp.as_user(pg_temp.f('c1'), format('select count(*)::text from public.bp_pattern_flags where patient_id = %L', pg_temp.f('p'))) || '|' ||
  pg_temp.as_user(pg_temp.f('c2'), format('select count(*)::text from public.bp_pattern_flags where patient_id = %L', pg_temp.f('p'))));
select pg_temp.ck('real', 'P9 the pattern task holds no reading or pattern word, and the patient got no notification for it', 'true|0',
  (select (not (to_jsonb(t)::text ~* '(masked|white)') and t.dedup_key like 'bp_pattern:%')::text from public.clinical_tasks t where t.patient_id = pg_temp.f('p') and t.type = 'bp_pattern_review' limit 1)
  || '|' || ((select count(*) from public.notifications where recipient_id = pg_temp.f('p')) - (select n from snap2 where k = 'notifications')));
select pg_temp.ck('real', 'P10 both new tables are registered for tied staff reads and for the data registry', '3|3',
  (select count(*) from public.staff_read_scope where table_name in ('home_bp_checks', 'clinic_bp_readings', 'bp_pattern_flags')) || '|' ||
  (select count(*) from public.data_registry where table_name in ('home_bp_checks', 'clinic_bp_readings', 'bp_pattern_flags')));

-- F. the v4 draft and the server context ---------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'V1 v3 is still the approved set; v4 is a draft; v4 differs from v3 only in the version and BP-A7', 'approved|draft|true|1',
  (select status from public.triage_rule_sets where code = 'bp_care_triage' and version = 3) || '|' ||
  (select status from public.triage_rule_sets where code = 'bp_care_triage' and version = 4) || '|' ||
  ((select (rules #- '{rules}' #- '{version}') from public.triage_rule_sets where code = 'bp_care_triage' and version = 4)
    = (select (rules #- '{rules}' #- '{version}') from public.triage_rule_sets where code = 'bp_care_triage' and version = 3))::text || '|' ||
  (select count(*) from jsonb_array_elements((select rules -> 'rules' from public.triage_rule_sets where code = 'bp_care_triage' and version = 4)) r
     where r::text <> (select x::text from jsonb_array_elements((select rules -> 'rules' from public.triage_rule_sets where code = 'bp_care_triage' and version = 3)) x where x ->> 'id' = r ->> 'id')));
do $$
declare v_t uuid; v_u uuid; v_ctx_t jsonb; v_ctx_u jsonb;
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, position, arm)
  values (pg_temp.f('org'), pg_temp.f('p4'), 'blood_pressure', 85, 55, now(), 'device', 'seated', 'left') returning id into v_t;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, position, arm)
  values (pg_temp.f('org'), pg_temp.f('p3'), 'blood_pressure', 85, 55, now(), 'device', 'seated', 'left') returning id into v_u;
  v_ctx_t := public.triage_context_for_observation(v_t);
  v_ctx_u := public.triage_context_for_observation(v_u);
  perform pg_temp.ck('real', 'V2 the server context says whether the patient takes BP medicines (treated true, untreated false)', 'true|false',
    (v_ctx_t -> 'input' ->> 'onBpMedicines') || '|' || (v_ctx_u -> 'input' ->> 'onBpMedicines'));
end $$;

select pg_temp.ck('real', 'A1 the patient can read no audit entry about a pattern flag, and none was written', '0|0',
  pg_temp.as_user(pg_temp.f('p'), 'select count(*)::text from public.audit_log where action like ''bp_pattern%'' or event::text ~* ''(masked|white_coat)''') || '|' ||
  (select count(*) from public.audit_log where action like 'bp_pattern%' or event::text ~* '(masked|white_coat)'));

-- a failure in the pattern rule must not roll back the clinician's reading, and must open an incident rather than pass silently
select pg_temp.seed12(pg_temp.f('p5'), pg_temp.f('org'), (now() at time zone 'Africa/Lagos')::date - 9, 126, 78);
select pg_temp.ck('real', 'F0 p5 completes a check', 'true', (pg_temp.chk(pg_temp.f('p5')) !~ '^ERR')::text);
update public.task_types set is_active = false where code = 'bp_pattern_review';
select pg_temp.ck('real', 'F1 with the pattern task type unavailable, the clinician''s call still succeeds', 'true',
  (pg_temp.rec(pg_temp.f('c1'), pg_temp.f('p5'), 152, 96, 2) !~ '^ERR')::text);
select pg_temp.ck('real', 'F2 ...the clinic reading is saved, no flag exists, and one incident is open', '1|none|1',
  (select count(*) from public.clinic_bp_readings where patient_id = pg_temp.f('p5')) || '|' || pg_temp.flags(pg_temp.f('p5')) || '|' ||
  (select count(*) from public.ops_incidents where external_reference = 'home_bp_pattern_rule' and status not in ('resolved', 'closed')));
update public.task_types set is_active = true where code = 'bp_pattern_review';

-- SABOTAGE 1: the completeness gate lowered to one reading. The three-reading case must now come out complete.
do $$
declare v_def text; v_out jsonb; v_cfg jsonb := (select config from public.home_bp_programme_signoffs where version = 1);
begin
  select pg_get_functiondef('private.home_bp_assess_readings(jsonb, date, jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, '(c.p ->> ''minReadings'')::int', '1');
  execute v_def;
  v_out := private.home_bp_assess_readings('[{"s":138,"d":86,"at":"2026-10-01T06:00:00Z"},{"s":138,"d":86,"at":"2026-10-02T06:00:00Z"},{"s":138,"d":86,"at":"2026-10-03T06:00:00Z"}]'::jsonb, '2026-10-01', v_cfg);
  insert into results values ('sabotaged', 'SABOTAGE: a lowered completeness gate calls three readings complete', 'false', (v_out ->> 'complete'));
end $$;
-- SABOTAGE 2: the white-coat rule allowed for a treated patient. The treated case must now flag.
do $$
declare v_def text; v_out text; v_cfg jsonb := (select config from public.home_bp_programme_signoffs where version = 1);
begin
  select pg_get_functiondef('private.bp_pattern_kind(int, int, timestamptz, int, int, timestamptz, boolean, boolean, int, jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, 'and not p_treated then', 'then');
  execute v_def;
  v_out := coalesce(private.bp_pattern_kind(152, 96, now(), 126, 78, now(), true, false, 45, v_cfg), 'none');
  insert into results values ('sabotaged', 'SABOTAGE: white-coat allowed for a treated patient', 'none', v_out);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S07x proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: a sabotage did not flip (% of 2)', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
