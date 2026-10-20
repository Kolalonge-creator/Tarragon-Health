-- S46d proof: completion of the yearly Health Report (migration *_s46d_health_report_completion.sql). One rolled-back transaction, simulated sessions.
-- Proves:
--   1. sign_serology_rule_threshold: only the active Chief Medical Officer can confirm the anti-HBs threshold (a doctor, a stranger and anon are refused),
--      it confirms the ACTIVE rule only, and it writes an audit line. Before it, private.anti_hbs_threshold_confirmed() is false; after, true.
--   2. membership_annual panel v3 = v2 plus anti_hbs: one active version, 19 analytes, anti_hbs optional / addOn / orderedBy clinician / not sensitive,
--      a result without it is not "incomplete" while a missing required analyte still is, a positive anti-HBs is not a sensitive positive, no screen type
--      or price row for it exists (never patient-orderable, never priced here), and v2 keeps its analytes.
--   3. Report settings v3 exists, is UNSIGNED and inactive, carries the retest block; v2 is untouched.
--   4. Share link for the signed report: create_record_share refuses 'health_report' with no report, with only a draft, and accepts it once a report is
--      signed; the public door returns the LATEST SIGNED version only, with the heart risk band, questionnaires, reproductive screening, risk priorities,
--      the doctor's free text and the summary counts removed, and anything that looks like a blood-borne test dropped (INV-04) while ordinary content stays
--      (control); a PIN link shows nothing until the PIN is given; a revoked link returns nothing; a share without the section carries no report; a Care
--      Circle supporter reads no report and nobody can run the body builder directly; anon cannot create a share.
--   5. SABOTAGE: the body builder returning the unfiltered report, the sensitive-code filter removed, the signer check removed; the matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table tx(k text primary key, v text) on commit drop;
grant all on tx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.anon_q(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_age integer default 45) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's46d-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'S46d ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => p_age, days => 20))::date, 'female', true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician', 40);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by,
      doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S46d ' || p_label, 'MDCN', 'S46D-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
          p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
          case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true);
  return v;
end $f$;
-- a report for a patient, inserted as the table owner with the guard triggers off (the signing flow is proven in s46_ and s46c_report_signoff_task); the
-- guard is off on purpose so a stored report can carry material it would normally refuse, to prove the share body still leaves it out.
create function pg_temp.report_row(p_patient uuid, p_year integer, p_version integer, p_composed jsonb, p_status text default 'signed') returns uuid language plpgsql as
$f$ declare v uuid; v_staff uuid; v_cfg uuid;
begin
  select id into v_staff from public.clinical_staff where profile_id = pg_temp.f('doc');
  select id into v_cfg from public.health_report_config_versions order by version desc limit 1;
  alter table public.health_reports disable trigger "00_minor_dependant_scope";
  alter table public.health_reports disable trigger health_reports_guard;
  insert into public.health_reports (organisation_id, patient_id, year, version, status, config_version_id, inputs, composed, priorities, summary_text, summary_source,
        signed_by, signed_at, signer_name, signer_registration, source, is_test)
  values (pg_temp.f('org'), p_patient, p_year, p_version, p_status, v_cfg, '{}'::jsonb, p_composed, '[]'::jsonb,
          case when p_status in ('signed', 'superseded') then 'Your blood pressure held steady this year. DOCTORNOTE' end,
          case when p_status in ('signed', 'superseded') then 'clinician' end,
          case when p_status in ('signed', 'superseded') then v_staff end, case when p_status in ('signed', 'superseded') then now() end,
          case when p_status in ('signed', 'superseded') then 'Dr Test' end, case when p_status in ('signed', 'superseded') then 'MDCN-1' end, 'system', true)
  returning id into v;
  alter table public.health_reports enable trigger health_reports_guard;
  alter table public.health_reports enable trigger "00_minor_dependant_scope";
  return v;
end $f$;
create function pg_temp.full_composed() returns jsonb language sql as
$$ select '{"schema":1,"year":2026,"templateSummary":"TEMPLATESUMMARY","clinicianNote":"SECRETNOTE","weight":{"latestKg":70,"count":2},
 "items":[
  {"id":"bp","kind":"bp","code":"blood_pressure","state":"needs_attention","value":152,"value2":96,"readingCount":14,"readingDays":6,"target":{"low":null,"high":140,"high2":90,"source":"higher_risk"}},
  {"id":"lab:alt","kind":"lab","code":"alt","state":"needs_attention","value":70,"readingCount":1},
  {"id":"lab:hbv_dna","kind":"lab","code":"hbv_dna","state":"needs_attention","value":3,"readingCount":1},
  {"id":"lab:hbsag","kind":"lab","code":"hbsag","state":"needs_attention","value":1,"readingCount":1},
  {"id":"lab:anti_hbs","kind":"lab","code":"anti_hbs","state":"on_target","value":1,"readingCount":1},
  {"id":"screening:cervical_smear","kind":"screening","code":"cervical_smear","state":"not_checked","value":null,"readingCount":0}],
 "priorities":[
  {"id":"bp","category":"bp","action":"report.priority.bp.action","why":"report.priority.bp.why","whoHelps":"report.who.care_team","when":"within 4 weeks"},
  {"id":"screening:cervical_smear","category":"screening","action":"report.priority.screening.action","why":"report.priority.screening.why","whoHelps":"report.who.care_team","when":"within 3 months"},
  {"id":"lab:hbv_dna","category":"lab","action":"report.priority.lab.action","why":"report.priority.lab.why","whoHelps":"report.who.care_team","when":"within 4 weeks"},
  {"id":"risk","category":"risk","action":"report.priority.risk.action","why":"report.priority.risk.why","whoHelps":"report.who.care_team","when":"within 3 months"}],
 "alsoWorthKnowing":[{"id":"risk","category":"risk","action":"a","why":"b","whoHelps":"c","when":"d"}],
 "summary":{"key":"report.summary.default","params":{"onTarget":1,"needsAttention":3,"notMeasured":1}},
 "risk":{"state":"assessed","tier":"high","bandCode":"10to20","basedOn":{"smoking":true}},
 "screening":{"done":[{"code":"cervical_smear","on":"2026-03-01","reproductive":true},{"code":"fit","on":"2026-02-01","reproductive":false}],"due":[{"code":"hep_b","dueOn":"2026-01-01","status":"overdue","reproductive":false}]},
 "trends":[{"code":"alt","unitMixed":false,"points":[{"at":"2025-01-01","value":60,"unit":"U/L"},{"at":"2026-01-01","value":70,"unit":"U/L"}]},
           {"code":"hiv_screen","unitMixed":false,"points":[{"at":"2025-01-01","value":1,"unit":null},{"at":"2026-01-01","value":1,"unit":null}]}],
 "questionnaires":[{"type":"phq9","level":"mild","at":"2026-04-01"}],
 "devices":{"manual":5,"device":0,"wearable":0},"midYearRetestMonths":6,
 "statementKey":"report.statement.not_rule_out","statementApprovedByCmo":false,"minBpReadings":12,"minBpDays":3}'::jsonb $$;
create function pg_temp.shared_report(p_token text, p_pin text default null) returns jsonb language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.anon_q(format('select public.record_share_by_token(%L, %L)::text', p_token, p_pin));
  if r is null or r like 'ERR:%' then return null; end if;
  return r::jsonb;
end $f$;
create function pg_temp.mkshare(p_uid uuid, p_sections text, p_pin boolean default false) returns jsonb language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.q_as(p_uid, format('select public.create_record_share(%L::text[], 24, %L::boolean, false)::text', p_sections, p_pin));
  if r like 'ERR:%' then return jsonb_build_object('error', substr(r, 5)); end if;
  return r::jsonb;
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.setf('nodraft', pg_temp.mkuser(v_org, 'nodraft', 'patient'));
  perform pg_temp.setf('supporter', pg_temp.mkuser(v_org, 'supporter', 'patient'));
  perform pg_temp.setf('stranger', pg_temp.mkuser(v_org, 'stranger', 'patient'));
end $$;

-- 1. The anti-HBs threshold ------------------------------------------------------------------------------------------------------
do $$
declare v_rule uuid; v_before text; v_after text; n_audit integer;
begin
  select id into v_rule from public.serology_rule_versions where status = 'active';
  perform pg_temp.ck('exactly one active serology rule', '1', (select count(*)::text from public.serology_rule_versions where status = 'active'));
  v_before := private.anti_hbs_threshold_confirmed()::text;
  perform pg_temp.ck('before: the threshold is not confirmed', 'false', v_before);
  perform pg_temp.ck('a senior doctor cannot confirm it', 'true', (pg_temp.q_as(pg_temp.f('doc'), format('select public.sign_serology_rule_threshold(%L)::text', v_rule)) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('a patient cannot confirm it', 'true', (pg_temp.q_as(pg_temp.f('stranger'), format('select public.sign_serology_rule_threshold(%L)::text', v_rule)) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('anon cannot execute it', 'false', has_function_privilege('anon', 'public.sign_serology_rule_threshold(uuid)', 'EXECUTE')::text);
  perform pg_temp.ck('still not confirmed after the refusals', 'false', private.anti_hbs_threshold_confirmed()::text);
  perform pg_temp.ck('the CMO refuses a rule that is not the active one', 'true',
    (pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_serology_rule_threshold(%L)::text', (select id from public.serology_rule_versions where status = 'legacy' limit 1))) like 'ERR:%')::text);
  select count(*) into n_audit from public.audit_log where action = 'serology_rule_threshold.signed';
  perform pg_temp.ck('...nor can a doctor hide behind an unknown id', 'true', (pg_temp.q_as(pg_temp.f('doc'), format('select public.sign_serology_rule_threshold(%L)::text', gen_random_uuid())) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('the CMO confirms it', v_rule::text, pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_serology_rule_threshold(%L)::text', v_rule)));
  v_after := private.anti_hbs_threshold_confirmed()::text;
  perform pg_temp.ck('after: the threshold is confirmed', 'true', v_after);
  perform pg_temp.ck('a second confirmation changes nothing and writes no second audit line', '1',
    (pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_serology_rule_threshold(%L)::text', v_rule)) is not null and ((select count(*) from public.audit_log where action = 'serology_rule_threshold.signed') - n_audit = 1))::text);
  perform pg_temp.ck('an audit line was written', '1', ((select count(*) from public.audit_log where action = 'serology_rule_threshold.signed') - n_audit)::text);
end $$;

-- 2. The panel add-on -----------------------------------------------------------------------------------------------------------
do $$
declare v3 public.lab_panel_versions%rowtype; a jsonb; r jsonb;
begin
  select * into v3 from public.lab_panel_versions where panel_code = 'membership_annual' and is_active;
  perform pg_temp.ck('the active panel version is 3', '3', v3.version::text);
  perform pg_temp.ck('one active panel version', '1', (select count(*)::text from public.lab_panel_versions where is_active));
  perform pg_temp.ck('19 analytes', '19', jsonb_array_length(v3.analytes)::text);
  select x into a from jsonb_array_elements(v3.analytes) x where x ->> 'code' = 'anti_hbs';
  perform pg_temp.ck('anti_hbs is qualitative, optional, an add-on, ordered by the clinician',
    'qualitative,true,true,clinician', (a ->> 'kind') || ',' || (a ->> 'optional') || ',' || (a ->> 'addOn') || ',' || (a ->> 'orderedBy'));
  perform pg_temp.ck('anti_hbs is not marked sensitive (a positive means protected)', 'null', coalesce(a ->> 'sensitive', 'null'));
  perform pg_temp.ck('v2 keeps 18 analytes and is inactive', '18,false',
    (select jsonb_array_length(analytes)::text || ',' || is_active::text from public.lab_panel_versions where panel_code = 'membership_annual' and version = 2));
  perform pg_temp.ck('HIV, HBsAg and anti-HCV stay required', '0',
    (select count(*)::text from jsonb_array_elements(v3.analytes) x where x ->> 'code' in ('hiv_screen', 'hbsag', 'hcv_ab') and coalesce((x ->> 'optional')::boolean, false)));
  r := private.classify_lab_result(v3.id, '[]'::jsonb, null);
  perform pg_temp.ck('an empty submission is missing the required analytes but NOT anti_hbs', 'true,false',
    ((r -> 'missing') @> '"hbsag"'::jsonb)::text || ',' || ((r -> 'missing') @> '"anti_hbs"'::jsonb)::text);
  r := private.classify_lab_result(v3.id, '[{"analyte_code":"anti_hbs","value_text":"positive"}]'::jsonb, null);
  perform pg_temp.ck('a positive anti-HBs is not a sensitive positive', 'false', (r -> 'items' -> 0 ->> 'sensitive_positive'));
  perform pg_temp.ck('a positive anti-HBs does not use the sensitive-disclosure state', 'true', ((r ->> 'release_state') <> 'clinician_disclosure_required')::text);
  r := private.classify_lab_result(v3.id, '[{"analyte_code":"anti_hbs","value_text":"negative"}]'::jsonb, null);
  perform pg_temp.ck('a NEGATIVE anti-HBs is held for a clinician (holdForReview), never auto-released', 'awaiting_review', r ->> 'release_state');
  -- one draft where a signed active sign-off existed to copy (production); none on a fresh database, which has no signed sign-off
  perform pg_temp.ck('a draft lab sign-off exists for the CMO, unsigned and not active (where a signed one existed)',
    (case when exists (select 1 from public.lab_panel_signoffs where is_active and approved_by is not null) then '1' else '0' end),
    (select count(*)::text from public.lab_panel_signoffs where not is_active and approved_by is null and notes like 'S46d:%'));
  perform pg_temp.ck('no screen type exists for anti-HBs, so a patient cannot order or be priced for it', 'false', exists (select 1 from public.screen_types where code = 'anti_hbs')::text);
end $$;

-- 3. Report settings v3 ----------------------------------------------------------------------------------------------------------
do $$
declare v3 public.health_report_config_versions%rowtype;
begin
  select * into v3 from public.health_report_config_versions where version = 3;
  perform pg_temp.ck('settings v3 exists, unsigned and inactive', 'false,false', (v3.approved_by is not null)::text || ',' || v3.is_active::text);
  perform pg_temp.ck('settings v3 carries the retest block', '12,4,6', (v3.config -> 'retest' ->> 'offValueWeeks') || ',' || (v3.config -> 'retest' ->> 'bpWeeks') || ',' || (v3.config -> 'retest' ->> 'midYearMonths'));
  perform pg_temp.ck('settings v2 has no retest block', 'false', (select (config ? 'retest')::text from public.health_report_config_versions where version = 2));
  perform pg_temp.ck('v3 keeps the v2 numbers', '12', v3.config ->> 'minBpReadings');
end $$;

-- 4. The share link --------------------------------------------------------------------------------------------------------------
do $$
declare pat uuid := pg_temp.f('pat'); nd uuid := pg_temp.f('nodraft'); yr integer := extract(year from now())::integer;
        s jsonb; tok text; b jsonb; txt text; s2 jsonb; s3 jsonb; s4 jsonb;
begin
  -- no report at all, and a draft only: refused
  perform pg_temp.ck('no report: the section is refused', 'true', ((pg_temp.mkshare(nd, '{health_report}') ->> 'error') like '%no signed yearly report%')::text);
  perform pg_temp.report_row(nd, yr, 1, pg_temp.full_composed(), 'pending_signature');
  perform pg_temp.ck('a draft only: the section is refused', 'true', ((pg_temp.mkshare(nd, '{health_report}') ->> 'error') like '%no signed yearly report%')::text);
  perform pg_temp.ck('anon cannot create a share', 'true', (pg_temp.anon_q(format('select public.create_record_share(%L::text[], 24, false, false)::text', '{health_report}')) like 'ERR:%')::text);

  -- a superseded v1 and a signed v2, then a newer draft v3: the link shows v2
  perform pg_temp.report_row(pat, yr, 1, pg_temp.full_composed(), 'superseded');
  perform pg_temp.report_row(pat, yr, 2, pg_temp.full_composed(), 'signed');
  perform pg_temp.report_row(pat, yr, 3, pg_temp.full_composed(), 'pending_signature');
  s := pg_temp.mkshare(pat, '{health_report,vitals}');
  perform pg_temp.ck('a signed report: the share is created', 'true', (s ->> 'token' is not null)::text);
  tok := s ->> 'token';
  b := pg_temp.shared_report(tok);
  perform pg_temp.ck('the public door returns the report', 'ok', b ->> 'status');
  perform pg_temp.ck('the LATEST SIGNED version only (not the superseded, not the draft)', '2', b -> 'health_report' ->> 'version');
  perform pg_temp.ck('signed by a named clinician with a registration', 'Dr Test,MDCN-1', (b -> 'health_report' ->> 'signer_name') || ',' || (b -> 'health_report' ->> 'signer_registration'));
  txt := (b -> 'health_report')::text;
  perform pg_temp.ck('the heart risk band is removed', 'not_assessed', b -> 'health_report' -> 'composed' -> 'risk' ->> 'state');
  perform pg_temp.ck('the questionnaires are removed', '0', jsonb_array_length(b -> 'health_report' -> 'composed' -> 'questionnaires')::text);
  perform pg_temp.ck('reproductive screening is removed', 'false', (txt like '%cervical_smear%')::text);
  perform pg_temp.ck('a risk priority is removed (both lists)', 'false', (txt like '%"category": "risk"%' or txt like '%"category":"risk"%')::text);
  perform pg_temp.ck('the doctor''s free text and the summary counts are not in the link', 'false', (txt like '%DOCTORNOTE%' or txt like '%TEMPLATESUMMARY%' or txt like '%needsAttention%')::text);
  perform pg_temp.ck('a whitelist: a field nobody listed (a clinician note, the weight) is not in the link', 'false', (txt like '%SECRETNOTE%' or txt like '%latestKg%')::text);
  perform pg_temp.ck('INV-04: nothing that looks like a blood-borne test is in the link (items, priorities, trends, screening)', 'false', (txt ~* 'hbv|hbs|hiv|hepat|hcv|hep_b')::text);
  perform pg_temp.ck('the reason for a lower blood pressure target is not revealed', 'false', (txt like '%higher_risk%')::text);
  perform pg_temp.ck('control: the ordinary lab item, the trend and the blood pressure are there', 'true,true,true',
    ((b -> 'health_report' -> 'composed' -> 'items') @> '[{"code":"alt"}]'::jsonb)::text || ',' || ((b -> 'health_report' -> 'composed' -> 'trends') @> '[{"code":"alt"}]'::jsonb)::text
    || ',' || ((b -> 'health_report' -> 'composed' -> 'items') @> '[{"id":"bp"}]'::jsonb)::text);
  perform pg_temp.ck('control: the non-reproductive screening is there and the retest line survives', 'true,6',
    ((b -> 'health_report' -> 'composed' -> 'screening' -> 'done') @> '[{"code":"fit"}]'::jsonb)::text || ',' || (b -> 'health_report' -> 'composed' ->> 'midYearRetestMonths'));

  -- a link limited to a date window never carries the yearly report (it cannot be trimmed; the window is the patient's limit on what a stranger sees)
  s4 := pg_temp.mkshare(pat, '{health_report,vitals}');
  update public.record_shares set window_days = 30 where token = s4 ->> 'token';
  perform pg_temp.ck('a link with a date window carries no yearly report', 'false', (pg_temp.shared_report(s4 ->> 'token') ? 'health_report')::text);

  -- a share without the section carries no report
  s2 := pg_temp.mkshare(pat, '{vitals}');
  perform pg_temp.ck('a share without the section carries no report', 'false', (pg_temp.shared_report(s2 ->> 'token') ? 'health_report')::text);

  -- a PIN link shows nothing until the PIN is given
  s3 := pg_temp.mkshare(pat, '{health_report}', true);
  perform pg_temp.ck('a PIN link shows no report without the PIN', 'pin_required', pg_temp.shared_report(s3 ->> 'token') ->> 'status');
  perform pg_temp.ck('...and no report key at all', 'false', (pg_temp.shared_report(s3 ->> 'token') ? 'health_report')::text);
  perform pg_temp.ck('...with the PIN it opens', 'true', ((pg_temp.shared_report(s3 ->> 'token', s3 ->> 'pin') -> 'health_report' ->> 'version') = '2')::text);

  -- revoke
  perform pg_temp.q_as(pat, format('select public.revoke_record_share(%L)::text', s ->> 'id'));
  perform pg_temp.ck('a revoked link returns nothing', 'true', (pg_temp.shared_report(tok) is null)::text);

  -- nobody else
  perform pg_temp.ck('a Care Circle supporter reads no report row', '0', pg_temp.q_as(pg_temp.f('supporter'), format('select count(*)::text from public.health_reports where patient_id = %L', pat)));
  perform pg_temp.ck('a supporter cannot make a share of someone else''s report (they have none of their own)', 'true', ((pg_temp.mkshare(pg_temp.f('supporter'), '{health_report}') ->> 'error') like '%no signed yearly report%')::text);
  perform pg_temp.ck('nobody can run the body builder directly', 'false,false',
    has_function_privilege('anon', 'private.health_report_share_body(uuid)', 'EXECUTE')::text || ',' || has_function_privilege('authenticated', 'private.health_report_share_body(uuid)', 'EXECUTE')::text);
  perform pg_temp.ck('the door stays anon-executable', 'true', has_function_privilege('anon', 'public.record_share_by_token(text,text,text)', 'EXECUTE')::text);
  perform pg_temp.setf('tok_ok', pat);
  insert into tx values ('tok', tok) on conflict (k) do update set v = excluded.v;
  insert into tx values ('tok2', (pg_temp.mkshare(pat, '{health_report}') ->> 'token')) on conflict (k) do update set v = excluded.v;
end $$;

-- 5. SABOTAGE -------------------------------------------------------------------------------------------------------------------------
-- A: the body builder returns the unfiltered report. The filtered-content checks must flip.
do $$
declare b jsonb; txt text;
begin
  create or replace function private.health_report_share_body(p_patient uuid) returns jsonb language sql stable security definer set search_path = ''
    as $f$ select jsonb_build_object('year', r.year, 'version', r.version, 'signed_at', r.signed_at, 'signer_name', r.signer_name, 'signer_registration', r.signer_registration, 'composed', r.composed)
           from public.health_reports r where r.patient_id = p_patient and r.status = 'signed' order by r.year desc, r.version desc limit 1 $f$;
  b := pg_temp.shared_report((select v from tx where k = 'tok2'));
  txt := (b -> 'health_report')::text;
  insert into results values ('sabotaged', 'the heart risk band is removed', 'not_assessed', b -> 'health_report' -> 'composed' -> 'risk' ->> 'state');
  insert into results values ('sabotaged', 'reproductive screening is removed', 'false', (txt like '%cervical_smear%')::text);
  insert into results values ('sabotaged', 'INV-04: nothing that looks like a blood-borne test is in the link (items, priorities, trends, screening)', 'false', (txt ~* 'hbv|hbs|hiv|hepat|hcv|hep_b')::text);
  insert into results values ('sabotaged', 'the doctor''s free text and the summary counts are not in the link', 'false', (txt like '%TEMPLATESUMMARY%')::text);
end $$;
-- B: the sensitive-code filter removed from the real builder (restore the real body first by recreating from the migration is not possible in a proof, so
-- this sabotages the shared filter the real builder calls and rebuilds a builder that uses it)
do $$
declare b jsonb;
begin
  create or replace function private.report_excluded_code(p_code text) returns boolean language sql immutable set search_path = '' as $f$ select false $f$;
  create or replace function private.health_report_share_body(p_patient uuid) returns jsonb language sql stable security definer set search_path = ''
    as $f$ select jsonb_build_object('composed', jsonb_build_object('items', coalesce((select jsonb_agg(x) from public.health_reports r, jsonb_array_elements(r.composed -> 'items') x
             where r.patient_id = p_patient and r.status = 'signed' and not private.report_excluded_code(x ->> 'code')), '[]'::jsonb))) $f$;
  b := pg_temp.shared_report((select v from tx where k = 'tok2'));
  insert into results values ('sabotaged', 'INV-04: the code filter drops hbv_dna from the link', 'false', ((b -> 'health_report')::text ~* 'hbv')::text);
end $$;
-- C: the signer check removed: a senior doctor can then confirm the threshold
do $$
begin
  create or replace function public.sign_serology_rule_threshold(p_id uuid) returns uuid language plpgsql security definer set search_path = ''
    as $f$ begin return p_id; end $f$;
  insert into results values ('sabotaged', 'a patient cannot confirm it', 'true', (pg_temp.q_as(pg_temp.f('stranger'), format('select public.sign_serology_rule_threshold(%L)::text', gen_random_uuid())) like 'ERR:not authorised%')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S46d proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 6 then raise exception 'VACUOUS TEST: the sabotage flipped % of 6 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;
