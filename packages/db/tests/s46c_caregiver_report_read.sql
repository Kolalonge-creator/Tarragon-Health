-- S46c proof: a caregiver or guardian reads a dependant's SIGNED yearly Health Report by access category (migration
-- *_s46c_caregiver_read_of_signed_report.sql). One rolled-back transaction, simulated sessions (set role authenticated + JWT claims).
-- Proves, each with a control that the gate OPENS where it must and a refusal where it must not:
--   1. Category scoping, written fresh: vitals opens blood pressure, weight and devices only; labs opens lab values, trends and non-reproductive screening
--      only; both open the risk band; reproductive screening needs an EXPLICIT reproductive_health row; the screening questionnaires need an EXPLICIT
--      medical_history row; the doctor's free-text summary is returned only when nothing was withheld.
--   2. The manage bypass of a dependent account stands for the everyday categories only: it never opens reproductive or mental health content.
--   3. Adolescents (10 to 17): even with the explicit categories, reproductive and mental health sections stay closed until the young person's own waiver
--      exists for that domain; with the waiver they open (control).
--   4. Hand-over at 18: a guardian of a minor_child who has turned 18 reads nothing unless a COMPLETED hand-over names them as kept (a guardian not kept
--      reads nothing; a hand-over not completed reads nothing; with no hand-over table at all the answer is nothing). A kept guardian reads (control).
--   5. Refusals that all look the same (P0002 not found): no grant, a grant with no category, a messaging-only grant, an expired grant, a stranger, the
--      patient themself on this route, a Care Circle supporter (the circle has no report permission), a draft, a patient with no signed report.
--   6. Sensitive serology never: an analyte that looks like a blood-borne virus test is dropped even when it is present in a stored report.
--   7. Only the latest SIGNED version is returned; a superseded one never; anon has no execute; every successful read leaves one care access log line and
--      a refusal leaves none; the list function shows only what the read would allow.
--   8. SABOTAGE: the scope function opened to everyone, and the sensitive-code filter removed; the matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_age integer default 45) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's46cg-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'Kemi ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => p_age, days => 20))::date, 'female', true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
-- a dependent minor_child account
create function pg_temp.mkchild(p_label text, p_age integer) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  v := pg_temp.mkuser(pg_temp.f('org'), p_label, 'patient', p_age);
  update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child' where id = v;
  return v;
end $f$;
-- a grant: level, categories (text[] of care_access_category), optional expiry
create function pg_temp.grant_to(p_patient uuid, p_grantee uuid, p_level text, p_cats text[], p_expires timestamptz default null) returns uuid language plpgsql as
$f$ declare v uuid; c text;
begin
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, expires_at)
  values (p_patient, p_grantee, p_level::public.profile_access_level, p_patient, case when p_expires > now() then p_expires end) returning id into v;
  if p_expires <= now() then update public.profile_access set created_at = p_expires - interval '1 day', expires_at = p_expires where id = v; end if;
  -- the category trigger demands the patient as the acting user (no role switch: the insert itself is the owner's)
  perform set_config('request.jwt.claims', json_build_object('sub', p_patient)::text, true);
  foreach c in array coalesce(p_cats, '{}') loop
    insert into public.profile_access_categories (profile_access_id, category) values (v, c::public.care_access_category);
  end loop;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;
-- a signed report for a patient (inserted as the table owner: the signing flow is proven in s46_ and s46c_report_signoff_task)
create function pg_temp.signed_report(p_patient uuid, p_year integer, p_version integer, p_composed jsonb, p_status text default 'signed') returns uuid language plpgsql as
$f$ declare v uuid; v_staff uuid; v_cfg uuid;
begin
  select id into v_staff from public.clinical_staff where profile_id = pg_temp.f('doc');
  select id into v_cfg from public.health_report_config_versions order by version desc limit 1;
  insert into public.health_reports (organisation_id, patient_id, year, version, status, config_version_id, inputs, composed, priorities, summary_text, summary_source,
        signed_by, signed_at, signer_name, signer_registration, source, is_test)
  values (pg_temp.f('org'), p_patient, p_year, p_version, p_status, v_cfg, '{}'::jsonb, p_composed, '[]'::jsonb,
          case when p_status in ('signed', 'superseded') then 'Your blood pressure held steady this year.' end,
          case when p_status in ('signed', 'superseded') then 'clinician' end,
          case when p_status in ('signed', 'superseded') then v_staff end, case when p_status in ('signed', 'superseded') then now() end,
          case when p_status in ('signed', 'superseded') then 'Dr Test' end, case when p_status in ('signed', 'superseded') then 'MDCN-1' end, 'system', true)
  returning id into v;
  return v;
end $f$;
create function pg_temp.report_of(p_g uuid, p_patient uuid) returns jsonb language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.q_as(p_g, format('select public.caregiver_health_report(%L)::text', p_patient));
  if r like 'ERR:%' then return jsonb_build_object('error', substr(r, 5)); end if;
  return r::jsonb;
end $f$;
create function pg_temp.kinds(j jsonb) returns text language sql as
$$ select coalesce((select string_agg(x ->> 'kind', ',' order by x ->> 'kind') from jsonb_array_elements(j -> 'composed' -> 'items') x), '') $$;
create function pg_temp.nz(j jsonb, p_key text) returns text language sql as
$$ select jsonb_array_length(coalesce(j -> 'composed' -> p_key, '[]'::jsonb))::text $$;

-- the stored report every patient below shares
create function pg_temp.full_composed() returns jsonb language sql as
$$ select '{"schema":1,"year":2026,
 "items":[
  {"id":"bp","kind":"bp","code":"bp","state":"on_target","value":120,"value2":80,"readingCount":5},
  {"id":"lab:alt","kind":"lab","code":"alt","state":"needs_attention","value":70,"readingCount":1},
  {"id":"screening:cervical_smear","kind":"screening","code":"cervical_smear","state":"needs_attention","value":null,"readingCount":0}],
 "priorities":[
  {"id":"bp","category":"bp","action":"report.priority.bp.action","why":"report.priority.bp.why","whoHelps":"report.who.care_team","when":"within 4 weeks"},
  {"id":"screening:cervical_smear","category":"screening","action":"report.priority.screening.action","why":"report.priority.screening.why","whoHelps":"report.who.care_team","when":"within 3 months"},
  {"id":"risk","category":"risk","action":"report.priority.risk.action","why":"report.priority.risk.why","whoHelps":"report.who.care_team","when":"within 3 months"}],
 "alsoWorthKnowing":[],
 "summary":{"key":"report.summary.default"},
 "risk":{"state":"assessed","tier":"moderate"},
 "screening":{"done":[{"code":"cervical_smear","on":"2026-03-01","reproductive":true},{"code":"fit","on":"2026-02-01","reproductive":false}],"due":[]},
 "trends":[{"code":"alt","unitMixed":false,"points":[{"at":"2026-01-01","value":60,"unit":"U/L"}]}],
 "questionnaires":[{"type":"phq9","level":"mild","at":"2026-04-01"}],
 "devices":{"manual":5,"device":0,"wearable":0},
 "weight":{"latestKg":70,"latestAt":"2026-05-01","count":2},
 "statementKey":"report.statement.not_rule_out","statementApprovedByCmo":false,"minBpReadings":3}'::jsonb $$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_doc uuid; adult uuid; yr integer := extract(year from now())::integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  perform pg_temp.setf('doc', v_doc);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by,
      doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_doc, 'S46c doc', 'MDCN', 'S46CG-1', true, 'active', now(), v_admin, 'medical_officer', 'contracted', 1, true, v_admin, true);

  -- an adult patient with a signed report, and one grantee per category pattern
  adult := pg_temp.mkuser(v_org, 'adult', 'patient');
  perform pg_temp.setf('adult', adult);
  perform pg_temp.signed_report(adult, yr, 1, pg_temp.full_composed());
  perform pg_temp.setf('g_vit',  pg_temp.mkuser(v_org, 'gvit', 'patient'));
  perform pg_temp.setf('g_lab',  pg_temp.mkuser(v_org, 'glab', 'patient'));
  perform pg_temp.setf('g_vl',   pg_temp.mkuser(v_org, 'gvl', 'patient'));
  perform pg_temp.setf('g_rep',  pg_temp.mkuser(v_org, 'grep', 'patient'));
  perform pg_temp.setf('g_mh',   pg_temp.mkuser(v_org, 'gmh', 'patient'));
  perform pg_temp.setf('g_full', pg_temp.mkuser(v_org, 'gfull', 'patient'));
  perform pg_temp.setf('g_none', pg_temp.mkuser(v_org, 'gnone', 'patient'));
  perform pg_temp.setf('g_msg',  pg_temp.mkuser(v_org, 'gmsg', 'patient'));
  perform pg_temp.setf('g_exp',  pg_temp.mkuser(v_org, 'gexp', 'patient'));
  perform pg_temp.setf('g_str',  pg_temp.mkuser(v_org, 'gstr', 'patient'));
  perform pg_temp.setf('g_circ', pg_temp.mkuser(v_org, 'gcirc', 'patient'));
  perform pg_temp.grant_to(adult, pg_temp.f('g_vit'), 'view', array['vitals_readings']);
  perform pg_temp.grant_to(adult, pg_temp.f('g_lab'), 'view', array['labs_results']);
  perform pg_temp.grant_to(adult, pg_temp.f('g_vl'),  'view', array['vitals_readings', 'labs_results']);
  perform pg_temp.grant_to(adult, pg_temp.f('g_rep'), 'view', array['vitals_readings', 'labs_results', 'reproductive_health']);
  perform pg_temp.grant_to(adult, pg_temp.f('g_mh'),  'view', array['vitals_readings', 'labs_results', 'medical_history']);
  perform pg_temp.grant_to(adult, pg_temp.f('g_full'), 'view', array['vitals_readings', 'labs_results', 'reproductive_health', 'medical_history']);
  perform pg_temp.grant_to(adult, pg_temp.f('g_none'), 'view', array[]::text[]);
  perform pg_temp.grant_to(adult, pg_temp.f('g_msg'), 'view', array['messaging']);
  perform pg_temp.grant_to(adult, pg_temp.f('g_exp'), 'view', array['vitals_readings', 'labs_results'], now() - interval '1 day');
  -- a Care Circle supporter with every circle permission, and a profile_access grant of NOTHING for the report
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, state, expires_at, is_test)
  values (v_org, adult, pg_temp.f('g_circ'), 'daughter', array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'pay_for_care'], 'active', now() + interval '30 days', true);
end $$;

-- 1. Category scoping on an adult patient's grants -------------------------------------------------------------------------------
do $$
declare adult uuid := pg_temp.f('adult'); j jsonb;
begin
  j := pg_temp.report_of(pg_temp.f('g_vit'), adult);
  perform pg_temp.ck('vitals only: only the blood pressure item', 'bp', pg_temp.kinds(j));
  perform pg_temp.ck('vitals only: weight and devices are shared', 'true,5', ((j -> 'composed' -> 'weight' ->> 'count') is not null)::text || ',' || (j -> 'composed' -> 'devices' ->> 'manual'));
  perform pg_temp.ck('vitals only: no trends, no screening, no questionnaires, no risk band', '0,0,0,not_assessed',
    pg_temp.nz(j, 'trends') || ',' || jsonb_array_length(j -> 'composed' -> 'screening' -> 'done')::text || ',' || pg_temp.nz(j, 'questionnaires') || ',' || (j -> 'composed' -> 'risk' ->> 'state') );
  perform pg_temp.ck('vitals only: the doctor''s summary is withheld', 'true,null', (j ->> 'summary_withheld') || ',' || coalesce(j ->> 'summary_text', 'null'));
  perform pg_temp.ck('vitals only: only the blood pressure priority', 'bp', (select string_agg(x ->> 'id', ',') from jsonb_array_elements(j -> 'composed' -> 'priorities') x));
  perform pg_temp.ck('vitals only: the withheld list names labs, trends, screening and risk', 'true',
    ((j -> 'withheld') @> '["labs","trends","screening","risk"]'::jsonb)::text);

  j := pg_temp.report_of(pg_temp.f('g_lab'), adult);
  perform pg_temp.ck('labs only: the lab item and the non-reproductive screening done, not the reproductive one', 'lab',
    pg_temp.kinds(j));
  perform pg_temp.ck('labs only: screening done is fit only', 'fit', (select string_agg(x ->> 'code', ',') from jsonb_array_elements(j -> 'composed' -> 'screening' -> 'done') x));
  perform pg_temp.ck('labs only: trends shared, weight and devices not', '1,true,0',
    pg_temp.nz(j, 'trends') || ',' || (j -> 'composed' -> 'weight' = 'null'::jsonb)::text || ',' || (j -> 'composed' -> 'devices' ->> 'manual'));
  perform pg_temp.ck('labs only: no blood pressure priority or risk priority, no reproductive screening priority', '0', jsonb_array_length(j -> 'composed' -> 'priorities')::text);

  j := pg_temp.report_of(pg_temp.f('g_vl'), adult);
  perform pg_temp.ck('vitals and labs: bp and lab items, no reproductive screening item', 'bp,lab', pg_temp.kinds(j));
  perform pg_temp.ck('vitals and labs: the risk band is shared (needs both)', 'assessed', j -> 'composed' -> 'risk' ->> 'state');
  perform pg_temp.ck('vitals and labs: bp and risk priorities, the reproductive screening priority is dropped', 'bp,risk', (select string_agg(x ->> 'id', ',' order by x ->> 'id') from jsonb_array_elements(j -> 'composed' -> 'priorities') x));
  perform pg_temp.ck('vitals and labs: reproductive screening and questionnaires never appear without their own category', '0,0',
    (select count(*)::text from jsonb_array_elements(j -> 'composed' -> 'screening' -> 'done') x where (x ->> 'reproductive')::boolean) || ',' || pg_temp.nz(j, 'questionnaires'));
  perform pg_temp.ck('vitals and labs: the summary is withheld because reproductive and questionnaire content was dropped', 'true', (j ->> 'summary_withheld'));

  j := pg_temp.report_of(pg_temp.f('g_rep'), adult);
  perform pg_temp.ck('explicit reproductive_health opens the reproductive screening (control: the gate opens)', 'bp,lab,screening', pg_temp.kinds(j));
  perform pg_temp.ck('...and its priority', '3', jsonb_array_length(j -> 'composed' -> 'priorities')::text);
  perform pg_temp.ck('...but not the questionnaires', '0', pg_temp.nz(j, 'questionnaires'));

  j := pg_temp.report_of(pg_temp.f('g_mh'), adult);
  perform pg_temp.ck('explicit medical_history opens the questionnaires (control)', '1', pg_temp.nz(j, 'questionnaires'));
  perform pg_temp.ck('...but not the reproductive screening', 'bp,lab', pg_temp.kinds(j));

  j := pg_temp.report_of(pg_temp.f('g_full'), adult);
  perform pg_temp.ck('every category: the whole report, nothing withheld, summary returned (control)', 'bp,lab,screening,1,false,Your blood pressure held steady this year.',
    pg_temp.kinds(j) || ',' || pg_temp.nz(j, 'questionnaires') || ',' || (j ->> 'summary_withheld') || ',' || (j ->> 'summary_text'));
  perform pg_temp.ck('the report carries the signer and no draft text', 'true',
    ((j ->> 'signer_name') = 'Dr Test' and (j ->> 'signer_registration') = 'MDCN-1' and not (j ? 'ai_draft'))::text);
end $$;

-- 2. Refusals (one answer for all of them) -----------------------------------------------------------------------------------------
do $$
declare adult uuid := pg_temp.f('adult'); yr integer := extract(year from now())::integer; draft_pat uuid; nosign uuid;
begin
  perform pg_temp.ck('no category on the grant: not found', 'P0002', pg_temp.report_of(pg_temp.f('g_none'), adult) ->> 'error');
  perform pg_temp.ck('a messaging-only grant: not found', 'P0002', pg_temp.report_of(pg_temp.f('g_msg'), adult) ->> 'error');
  perform pg_temp.ck('an expired grant: not found', 'P0002', pg_temp.report_of(pg_temp.f('g_exp'), adult) ->> 'error');
  perform pg_temp.ck('a stranger with no grant: not found', 'P0002', pg_temp.report_of(pg_temp.f('g_str'), adult) ->> 'error');
  perform pg_temp.ck('a Care Circle supporter holding every circle permission: not found (the circle has no report permission)', 'P0002', pg_temp.report_of(pg_temp.f('g_circ'), adult) ->> 'error');
  perform pg_temp.ck('the patient on this route: not found (they use their own page)', 'P0002', pg_temp.report_of(adult, adult) ->> 'error');
  perform pg_temp.ck('anon: no execute', '42501', pg_temp.try_anon(format('select public.caregiver_health_report(%L)', adult)));
  perform pg_temp.ck('anon: no execute on the list', '42501', pg_temp.try_anon('select * from public.caregiver_report_list()'));
  -- a draft only
  draft_pat := pg_temp.mkuser(pg_temp.f('org'), 'draftpat', 'patient');
  perform pg_temp.signed_report(draft_pat, yr, 1, pg_temp.full_composed(), 'pending_signature');
  perform pg_temp.grant_to(draft_pat, pg_temp.f('g_full'), 'view', array['vitals_readings', 'labs_results']);
  perform pg_temp.ck('a draft is never returned', 'P0002', pg_temp.report_of(pg_temp.f('g_full'), draft_pat) ->> 'error');
  -- a patient with a grant and no report at all
  nosign := pg_temp.mkuser(pg_temp.f('org'), 'nosign', 'patient');
  perform pg_temp.grant_to(nosign, pg_temp.f('g_full'), 'view', array['vitals_readings']);
  perform pg_temp.ck('a grant on a patient with no signed report: not found', 'P0002', pg_temp.report_of(pg_temp.f('g_full'), nosign) ->> 'error');
  -- the patient''s own table is still closed to a caregiver
  perform pg_temp.ck('the table itself stays closed to a caregiver', '0', pg_temp.q_as(pg_temp.f('g_full'), 'select count(*)::text from public.health_reports'));
end $$;

-- 3. The list ----------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('the list shows the person a caregiver may read (first name only)', 'Kemi',
    pg_temp.q_as(pg_temp.f('g_full'), format('select first_name from public.caregiver_report_list() where patient_id = %L', pg_temp.f('adult'))));
  perform pg_temp.ck('the list does not show someone the read would refuse (no category)', '0',
    pg_temp.q_as(pg_temp.f('g_none'), 'select count(*)::text from public.caregiver_report_list()'));
  perform pg_temp.ck('the list does not show the circle supporter anything', '0',
    pg_temp.q_as(pg_temp.f('g_circ'), 'select count(*)::text from public.caregiver_report_list()'));
end $$;

-- 4. Dependent accounts: the manage bypass and the adolescent gate ------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); yr integer := extract(year from now())::integer; c8 uuid; c12 uuid; gm uuid; ga uuid; j jsonb; v_hold uuid;
begin
  c8 := pg_temp.mkchild('c8', 8);
  gm := pg_temp.mkuser(v_org, 'gmgr', 'patient');
  perform pg_temp.signed_report(c8, yr, 1, pg_temp.full_composed());
  perform pg_temp.grant_to(c8, gm, 'manage', array[]::text[]);
  j := pg_temp.report_of(gm, c8);
  perform pg_temp.ck('a parent with the manage grant of an 8 year old reads the everyday sections', 'bp,lab', pg_temp.kinds(j));
  perform pg_temp.ck('...but the manage bypass never opens reproductive screening or questionnaires', '0,0',
    (select count(*)::text from jsonb_array_elements(j -> 'composed' -> 'screening' -> 'done') x where (x ->> 'reproductive')::boolean) || ',' || pg_temp.nz(j, 'questionnaires'));
  perform pg_temp.ck('...and the summary is withheld', 'true', j ->> 'summary_withheld');

  -- an adolescent: explicit categories are not enough without the young person's own waiver
  c12 := pg_temp.mkchild('c12', 12);
  ga := pg_temp.mkuser(v_org, 'gadol', 'patient');
  perform pg_temp.signed_report(c12, yr, 1, pg_temp.full_composed());
  perform pg_temp.grant_to(c12, ga, 'view', array['vitals_readings', 'labs_results', 'reproductive_health', 'medical_history']);
  j := pg_temp.report_of(ga, c12);
  perform pg_temp.ck('a guardian of a 12 year old with the explicit categories and NO waiver: reproductive and mental health stay closed', 'bp,lab,0',
    pg_temp.kinds(j) || ',' || pg_temp.nz(j, 'questionnaires'));
  insert into public.adolescent_confidentiality_waivers (organisation_id, patient_id, grantee_user_id, domain) values (v_org, c12, ga, 'sexual_reproductive_health');
  j := pg_temp.report_of(ga, c12);
  perform pg_temp.ck('CONTROL: with the young person''s reproductive waiver the reproductive screening opens', 'bp,lab,screening', pg_temp.kinds(j));
  perform pg_temp.ck('...the mental health questionnaires are still closed (a different domain)', '0', pg_temp.nz(j, 'questionnaires'));
  insert into public.adolescent_confidentiality_waivers (organisation_id, patient_id, grantee_user_id, domain) values (v_org, c12, ga, 'mental_health');
  perform pg_temp.ck('CONTROL: with the mental health waiver the questionnaires open', '1', pg_temp.nz(pg_temp.report_of(ga, c12), 'questionnaires'));
  update public.adolescent_confidentiality_waivers set revoked_at = now() where patient_id = c12 and domain = 'sexual_reproductive_health';
  perform pg_temp.ck('revoking the reproductive waiver closes it again', 'bp,lab', pg_temp.kinds(pg_temp.report_of(ga, c12)));
end $$;

-- 5. Hand-over at 18 --------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); yr integer := extract(year from now())::integer; y19 uuid; g1 uuid; g2 uuid;
begin
  -- S42's table is not on this stack; a stand-in with the same columns is made for the proof when it is absent (rolled back with everything else)
  if to_regclass('public.dependant_handovers') is null then
    create table public.dependant_handovers (patient_id uuid primary key, state text not null, guardians_kept uuid[] not null default '{}');
    grant select on public.dependant_handovers to authenticated;
  end if;
  y19 := pg_temp.mkchild('y19', 19);
  g1 := pg_temp.mkuser(v_org, 'gh1', 'patient');
  g2 := pg_temp.mkuser(v_org, 'gh2', 'patient');
  perform pg_temp.signed_report(y19, yr, 1, pg_temp.full_composed());
  perform pg_temp.grant_to(y19, g1, 'view', array['vitals_readings', 'labs_results']);
  perform pg_temp.grant_to(y19, g2, 'view', array['vitals_readings', 'labs_results']);
  perform pg_temp.ck('turned 18 and no completed hand-over: the guardian reads nothing', 'P0002', pg_temp.report_of(g1, y19) ->> 'error');
  insert into public.dependant_handovers (patient_id, state, guardians_kept) values (y19, 'due', array[g1]);
  perform pg_temp.ck('a hand-over that is only due (not completed): still nothing', 'P0002', pg_temp.report_of(g1, y19) ->> 'error');
  update public.dependant_handovers set state = 'completed' where patient_id = y19;
  perform pg_temp.ck('CONTROL: completed and the young person kept this guardian: they read', 'bp,lab', pg_temp.kinds(pg_temp.report_of(g1, y19)));
  perform pg_temp.ck('completed but this guardian was not kept: nothing', 'P0002', pg_temp.report_of(g2, y19) ->> 'error');
  perform pg_temp.ck('the list follows the same rule (kept guardian sees the person, the other does not)', '1,0',
    pg_temp.q_as(g1, 'select count(*)::text from public.caregiver_report_list()') || ',' || pg_temp.q_as(g2, 'select count(*)::text from public.caregiver_report_list()'));
  -- a table that is not there at all means nothing, never everything
  alter table public.dependant_handovers rename to dependant_handovers_held;
  perform pg_temp.ck('with no hand-over table at all the answer is nothing', 'P0002', pg_temp.report_of(g1, y19) ->> 'error');
  alter table public.dependant_handovers_held rename to dependant_handovers;
end $$;

-- 6. Sensitive serology never; versions; audit ------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); yr integer := extract(year from now())::integer; sens uuid; v1 uuid; v2 uuid; ver uuid; g uuid := pg_temp.f('g_full'); j jsonb; n_before integer; n_after integer;
begin
  -- a stored report that (against the honesty guard) holds a virus-looking analyte: the filter still drops it
  sens := pg_temp.mkuser(v_org, 'sens', 'patient');
  alter table public.health_reports disable trigger health_reports_guard;
  perform pg_temp.signed_report(sens, yr, 1, jsonb_set(pg_temp.full_composed(), '{items}', (pg_temp.full_composed() -> 'items') || '[{"id":"lab:hbv_dna","kind":"lab","code":"hbv_dna","state":"needs_attention","value":3,"readingCount":1}]'::jsonb));
  alter table public.health_reports enable trigger health_reports_guard;
  perform pg_temp.grant_to(sens, g, 'view', array['vitals_readings', 'labs_results', 'reproductive_health', 'medical_history']);
  j := pg_temp.report_of(g, sens);
  perform pg_temp.ck('INV-04: a virus-looking analyte in a stored report is never returned to a caregiver', 'false', (j::text ~* 'hbv|hbs|hiv|hepat|hcv')::text);
  perform pg_temp.ck('...while the ordinary lab value is', 'true', (j -> 'composed' -> 'items' @> '[{"code":"alt"}]'::jsonb)::text);

  -- versions: latest signed only
  ver := pg_temp.mkuser(v_org, 'ver', 'patient');
  v1 := pg_temp.signed_report(ver, yr, 1, pg_temp.full_composed(), 'superseded');
  v2 := pg_temp.signed_report(ver, yr, 2, pg_temp.full_composed(), 'signed');
  perform pg_temp.signed_report(ver, yr, 3, pg_temp.full_composed(), 'pending_signature');
  perform pg_temp.grant_to(ver, g, 'view', array['vitals_readings']);
  perform pg_temp.ck('only the latest SIGNED version is returned (not the superseded, not the draft)', '2', (pg_temp.report_of(g, ver) ->> 'version'));

  -- audit: a successful read leaves a line on the patient''s care access log; a refusal leaves none
  select count(*) into n_before from public.care_access_events where patient_id = ver and scope = 'health_summary' and metadata ->> 'kind' = 'yearly_report';
  perform pg_temp.report_of(pg_temp.f('g_str'), ver);
  select count(*) into n_after from public.care_access_events where patient_id = ver and scope = 'health_summary' and metadata ->> 'kind' = 'yearly_report';
  perform pg_temp.ck('a refused read leaves no care access line', '0', (n_after - n_before)::text);
  select count(*) into n_before from public.care_access_events where patient_id = pg_temp.f('adult') and scope = 'health_summary' and metadata ->> 'kind' = 'yearly_report' and actor_profile_id = g;
  perform pg_temp.report_of(g, pg_temp.f('adult'));
  select count(*) into n_after from public.care_access_events where patient_id = pg_temp.f('adult') and scope = 'health_summary' and metadata ->> 'kind' = 'yearly_report' and actor_profile_id = g;
  perform pg_temp.ck('a successful read leaves a care access line for the patient (collapsed to one per hour)', 'true', (n_after >= 1)::text);
end $$;

-- 7. SABOTAGE -------------------------------------------------------------------------------------------------------------------------
-- A: the scope function opened to everyone. The stranger, the grant with no category and the circle supporter must then read.
do $$
begin
  create or replace function private.report_caregiver_scope(p_patient uuid, p_grantee uuid) returns jsonb language sql stable security definer set search_path = ''
    as $f$ select jsonb_build_object('allowed', true, 'vitals', true, 'labs', true, 'reproductive', true, 'mental', true) $f$;
  insert into results values ('sabotaged', 'a stranger with no grant: not found', 'P0002', pg_temp.report_of(pg_temp.f('g_str'), pg_temp.f('adult')) ->> 'error');
  insert into results values ('sabotaged', 'no category on the grant: not found', 'P0002', pg_temp.report_of(pg_temp.f('g_none'), pg_temp.f('adult')) ->> 'error');
  insert into results values ('sabotaged', 'a Care Circle supporter holding every circle permission: not found (the circle has no report permission)', 'P0002', pg_temp.report_of(pg_temp.f('g_circ'), pg_temp.f('adult')) ->> 'error');
  insert into results values ('sabotaged', 'vitals only: only the blood pressure item', 'bp', pg_temp.kinds(pg_temp.report_of(pg_temp.f('g_vit'), pg_temp.f('adult'))));
end $$;
-- B: the sensitive-code filter removed
do $$
declare sens uuid;
begin
  create or replace function private.report_excluded_code(p_code text) returns boolean language sql immutable set search_path = '' as $f$ select false $f$;
  select patient_id into sens from public.health_reports where composed::text like '%hbv_dna%' limit 1;
  insert into results values ('sabotaged', 'INV-04: a virus-looking analyte in a stored report is never returned to a caregiver', 'false',
    (pg_temp.report_of(pg_temp.f('g_full'), sens)::text ~* 'hbv')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S46c caregiver proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 5 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;
