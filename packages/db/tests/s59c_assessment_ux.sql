-- S59c proof: follow-up check-back after a symptom check, and the signed-config table behind the assessment experience (migration *_s59c_assessment_ux.sql).
--
-- Proves in one rolled-back transaction:
--   1. Born closed: four draft configs, none signed or active, stored in their draft form; the sweep does nothing without a signed `checkback` config.
--   2. Signing: only the CMO signs (a clinician, a patient and anon are refused); a signed version cannot be signed twice, edited, or inserted
--      already signed; the active read adds the signature from the row's own columns (the stored JSON stays the draft form); a malformed
--      checkback config is refused by the table; an older version cannot be re-activated after a newer one is signed.
--   3. Scheduling: only a self-care or routine result gets a follow-up, at the configured delay (48 and 24 hours); urgent and emergency results
--      never do; idempotent; an assessment whose window has passed is not followed up; closed for that patient (INV-14) schedules nothing;
--      the sweep backfills a missing row.
--   4. The sweep: nothing opens early; an open follow-up has one neutral in-app notice carrying only its id and the patient's own channel beside it;
--      the notice window helper holds a night notice to 07:00 Lagos; closed means not opened; one reminder only; expiry raises nothing;
--      a later urgent or emergency check cancels it.
--   5. Answering: own follow-up only; every input validated; a newly ticked sign must come from the pathway's own vocabulary; the decision table
--      (12 cases) including worse, a new sign, the floor re-run, same before and after the nudge time; ONE alert carrying the original summary
--      (and never a pregnancy answer); Free plans get the guidance and no alert while an emergency still opens the emergency path; answering twice
--      returns the stored result and raises nothing more; a late answer after expiry still escalates; ids-only events.
--   6. Access: the patient reads own rows only; there is no staff table policy; the audited clinician read is tied, refuses a coordinator, writes an
--      audit row for every read and refusal; anon has no execute on anything.
--   7. SABOTAGE: the scheduling trigger dropped, the escalation helper emptied, the table policy widened, the immutability trigger dropped, the
--      guard check emptied, the sweep granted to signed-in users, the tie check emptied and the superseded guard dropped each flip a check.
begin;

alter table public.profiles disable trigger profiles_01_enforce_adult_registration;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
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
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claims', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's59c-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S59c ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, case when p_tier = 'care_coordinator' then 'care_coordinator' else 'clinician' end);
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S59c ' || p_label, 'MDCN', 'S59c-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;
-- a completed self-care, routine, urgent or emergency check. The headache pathway of the signed protocol v1 (its vocabulary is what a follow-up may tick).
create function pg_temp.assess(p_org uuid, p_patient uuid, p_category text, p_hours_ago integer default 0) returns uuid language plpgsql as
$f$ declare v uuid; begin
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen,
     category, clinician_review_required, safety_net_message_key, rationale, created_at)
  values (p_org, p_patient, 'headache', (select min(version) from public.triage_protocols),
          '{"presentingComplaintKey":"headache","onset":"gradual","severity":4,"associatedSymptoms":["nausea_vomiting"],"triggers":[],"relevantHistory":["pregnant"],"measurements":{}}'::jsonb,
          '[]', '{}', p_category::public.triage_category, false, 'headache.self_mild', 'S59c proof', now() - make_interval(hours => p_hours_ago))
  returning id into v;
  return v;
end $f$;
-- an open follow-up inserted directly (the scheduling trigger is proven separately), for the decision matrix
create function pg_temp.mkcb(p_org uuid, p_patient uuid, p_category text, p_hours_ago integer, p_state text default 'open') returns uuid language plpgsql as
$f$ declare a uuid; v uuid; begin
  a := pg_temp.assess(p_org, p_patient, p_category, p_hours_ago);
  delete from public.symptom_checkbacks where assessment_id = a;
  insert into public.symptom_checkbacks (organisation_id, assessment_id, patient_id, config_id, category, due_at, state, opened_at, is_test)
  values (p_org, a, p_patient, (select id from public.symptom_ux_config where kind = 'checkback' and is_active), p_category::public.triage_category, now() - interval '1 hour', p_state,
          case when p_state in ('open', 'expired') then now() end, true)
  returning id into v;
  return v;
end $f$;
create function pg_temp.alerts_for(p_patient uuid) returns text language sql as
$$ select count(*)::text from public.clinician_alerts where patient_id = p_patient $$;
create function pg_temp.emergencies_for(p_patient uuid) returns text language sql as
$$ select count(*)::text from public.emergency_events where patient_id = p_patient $$;
create function pg_temp.n_cb(p_assessment uuid) returns text language sql as
$$ select count(*)::text from public.symptom_checkbacks where assessment_id = p_assessment $$;
-- answer as the patient
create function pg_temp.ans(p_patient uuid, p_cb uuid, p_progress text, p_signs text[] default '{}', p_floor text default null, p_care text default null) returns jsonb language plpgsql as
$f$ declare v jsonb; begin
  perform pg_temp.act(p_patient);
  v := public.answer_symptom_checkback(p_cb, p_progress, p_care, p_signs, p_floor);
  perform pg_temp.back();
  return v;
end $f$;
create function pg_temp.sign(p_cmo uuid, p_kind text, p_version integer) returns void language plpgsql as
$f$ begin
  perform pg_temp.act(p_cmo);
  perform public.sign_symptom_ux_config(p_kind, p_version);
  perform pg_temp.back();
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_tied uuid; v_untied uuid; v_coord uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p7 uuid; p8 uuid; pm uuid; stranger uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; a6 uuid; a7 uuid; a8 uuid; a_old uuid; a_g uuid; a_none uuid; a_aud uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; c7 uuid; c8 uuid; cm uuid;
  v_out jsonb; v_res text; v_cfg uuid; v_rules jsonb; v_n integer; v_before integer; v_def text;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkstaff(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_tied := pg_temp.mkstaff(v_org, v_admin, 'tied', 'senior_medical_officer');
  v_untied := pg_temp.mkstaff(v_org, v_admin, 'untied', 'senior_medical_officer');
  v_coord := pg_temp.mkstaff(v_org, v_admin, 'coordinator', 'care_coordinator');
  p1 := pg_temp.mkuser(v_org, 'p1', 'patient'); p2 := pg_temp.mkuser(v_org, 'p2', 'patient'); p3 := pg_temp.mkuser(v_org, 'p3', 'patient');
  p4 := pg_temp.mkuser(v_org, 'p4', 'patient'); p5 := pg_temp.mkuser(v_org, 'p5', 'patient'); p6 := pg_temp.mkuser(v_org, 'p6', 'patient');
  p7 := pg_temp.mkuser(v_org, 'p7', 'patient'); p8 := pg_temp.mkuser(v_org, 'p8', 'patient'); pm := pg_temp.mkuser(v_org, 'matrix', 'patient');
  stranger := pg_temp.mkuser(v_org, 'stranger', 'patient');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, p1, v_tied);

  -- 1. Born closed ------------------------------------------------------------------------------------------------
  perform pg_temp.rec('four draft configs are seeded, none signed, none active', '4/0/0',
    (select count(*)::text || '/' || count(*) filter (where is_active)::text || '/' || count(*) filter (where approved_at is not null)::text from public.symptom_ux_config));
  perform pg_temp.rec('every seed is stored in its draft form (status draft, no sign-off)', 'true',
    (select bool_and(rules ->> 'status' = 'draft' and jsonb_typeof(rules -> 'clinical_sign_off') = 'null')::text from public.symptom_ux_config));
  perform pg_temp.rec('the symptom checker guard is off', 'false', (select is_on::text from public.go_live_guards where key = 'symptom_checker_enabled'));
  v_out := private.symptom_checkback_sweep();
  perform pg_temp.rec('the sweep does nothing without a signed config', 'false/0/0/0',
    (v_out ->> 'config_signed') || '/' || (v_out ->> 'backfilled') || '/' || (v_out ->> 'opened') || '/' || (v_out ->> 'errors'));
  a1 := pg_temp.assess(v_org, p1, 'self_management');
  perform pg_temp.rec('an unsigned config schedules nothing', '0', pg_temp.n_cb(a1));
  perform pg_temp.act(p1);
  v_out := public.symptom_ux_active_config('checkback');
  perform pg_temp.back();
  perform pg_temp.rec('no active config is readable while unsigned', 'null', coalesce(v_out::text, 'null'));

  -- 2. Signing ---------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_tied);
  perform pg_temp.rec('a senior doctor who is not the CMO cannot sign', '42501', pg_temp.try('select public.sign_symptom_ux_config(''checkback'', 1)'));
  perform pg_temp.back();
  perform pg_temp.act(p1);
  perform pg_temp.rec('a patient cannot sign', '42501', pg_temp.try('select public.sign_symptom_ux_config(''checkback'', 1)'));
  perform pg_temp.rec('a patient reads none of the config table directly', '0', (select count(*)::text from public.symptom_ux_config));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot sign or read the active config', '42501/42501',
    pg_temp.try('select public.sign_symptom_ux_config(''checkback'', 1)') || '/' || pg_temp.try('select public.symptom_ux_active_config(''checkback'')'));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the CMO sees the config table', 'true', ((select count(*) from public.symptom_ux_config) >= 4)::text);
  perform pg_temp.rec('an unknown version is refused', 'P0002', pg_temp.try('select public.sign_symptom_ux_config(''checkback'', 99)'));
  perform pg_temp.rec('an unknown kind is refused', 'P0002', pg_temp.try('select public.sign_symptom_ux_config(''nonsense'', 1)'));
  perform public.sign_symptom_ux_config('checkback', 1);
  perform pg_temp.rec('a version cannot be signed twice', '23514', pg_temp.try('select public.sign_symptom_ux_config(''checkback'', 1)'));
  perform pg_temp.back();
  perform pg_temp.rec('signing made that kind active with a named signer', 'true/true',
    (select (is_active)::text || '/' || (approved_by = v_cmo)::text from public.symptom_ux_config where kind = 'checkback' and version = 1));
  perform pg_temp.act(p1);
  v_out := public.symptom_ux_active_config('checkback');
  perform pg_temp.back();
  perform pg_temp.rec('the active read adds the signature from the row columns', 'signed_off/S59c cmo/true',
    (v_out ->> 'status') || '/' || (v_out #>> '{clinical_sign_off,by}') || '/' || ((v_out #>> '{clinical_sign_off,at}') ~ '^\d{4}-\d{2}-\d{2}$')::text);
  perform pg_temp.rec('the stored JSON is still the draft form', 'draft/null',
    (select rules ->> 'status' || '/' || jsonb_typeof(rules -> 'clinical_sign_off') from public.symptom_ux_config where kind = 'checkback' and version = 1));
  perform pg_temp.rec('the other three kinds are still unsigned', '0',
    (select count(*)::text from public.symptom_ux_config where kind <> 'checkback' and (is_active or approved_at is not null)));
  perform pg_temp.rec('a signed config cannot be edited', '23514', pg_temp.try('update public.symptom_ux_config set rules = jsonb_set(rules, ''{max_nudges}'', ''0'') where kind = ''checkback'' and version = 1'));
  perform pg_temp.rec('a version cannot be deleted', '23514', pg_temp.try('delete from public.symptom_ux_config where kind = ''checkback'' and version = 1'));
  perform pg_temp.rec('a new version cannot be created already active', '42501',
    pg_temp.try('insert into public.symptom_ux_config (kind, version, is_active, effective_from, rules) select kind, 2, true, current_date, jsonb_set(rules, ''{version}'', ''2'') from public.symptom_ux_config where kind = ''describe'' and version = 1'));
  perform pg_temp.rec('a new version cannot be created already signed in its JSON', '23514',
    pg_temp.try('insert into public.symptom_ux_config (kind, version, effective_from, rules) select kind, 2, current_date, jsonb_set(jsonb_set(rules, ''{version}'', ''2''), ''{status}'', ''"signed_off"'') from public.symptom_ux_config where kind = ''describe'' and version = 1'));
  perform pg_temp.rec('a malformed checkback config is refused by the table (two reminders)', '23514',
    pg_temp.try('insert into public.symptom_ux_config (kind, version, effective_from, rules) select kind, 2, current_date, jsonb_set(jsonb_set(rules, ''{version}'', ''2''), ''{max_nudges}'', ''3'') from public.symptom_ux_config where kind = ''checkback'' and version = 1'));
  perform pg_temp.rec('a checkback config with an empty notification window is refused', '23514',
    pg_temp.try('insert into public.symptom_ux_config (kind, version, effective_from, rules) select kind, 2, current_date, jsonb_set(jsonb_set(rules, ''{version}'', ''2''), ''{notification_window,end_hour}'', ''7'') from public.symptom_ux_config where kind = ''checkback'' and version = 1'));
  perform pg_temp.rec('a safety net config with a long phone number is refused', '23514',
    pg_temp.try('insert into public.symptom_ux_config (kind, version, effective_from, rules) select kind, 2, current_date, jsonb_set(jsonb_set(rules, ''{version}'', ''2''), ''{emergency_number}'', ''{"value":"08031234567","confirmed":true}'') from public.symptom_ux_config where kind = ''safety_net'' and version = 1'));
  perform pg_temp.rec('a rules version that differs from the row version is refused', '23514',
    pg_temp.try('insert into public.symptom_ux_config (kind, version, effective_from, rules) select kind, 5, current_date, rules from public.symptom_ux_config where kind = ''describe'' and version = 1'));

  -- 3. Scheduling (signed config) -------------------------------------------------------------------------------
  a1 := pg_temp.assess(v_org, p1, 'self_management');
  a2 := pg_temp.assess(v_org, p1, 'routine');
  a3 := pg_temp.assess(v_org, p1, 'emergency');
  perform pg_temp.rec('a self-care result gets a follow-up', '1', pg_temp.n_cb(a1));
  perform pg_temp.rec('a routine result gets a follow-up', '1', pg_temp.n_cb(a2));
  perform pg_temp.rec('an emergency result never does (it raised an emergency event)', '0', pg_temp.n_cb(a3));
  perform pg_temp.rec('due 48 hours after a self-care check and 24 after a routine one', '48/24',
    (select (extract(epoch from (k.due_at - a.created_at)) / 3600)::integer::text from public.symptom_checkbacks k join public.symptom_triage_assessments a on a.id = k.assessment_id where a.id = a1) || '/'
    || (select (extract(epoch from (k.due_at - a.created_at)) / 3600)::integer::text from public.symptom_checkbacks k join public.symptom_triage_assessments a on a.id = k.assessment_id where a.id = a2));
  perform pg_temp.rec('each row records the config version it was made under and starts scheduled', 'true/scheduled',
    (select (config_id = (select id from public.symptom_ux_config where kind = 'checkback' and is_active))::text || '/' || state from public.symptom_checkbacks where assessment_id = a1));
  perform private.schedule_symptom_checkback(a1);
  perform pg_temp.rec('a second schedule call adds nothing (idempotent)', '1', pg_temp.n_cb(a1));
  a4 := pg_temp.assess(v_org, p1, 'urgent');
  perform pg_temp.rec('an urgent result never gets a follow-up (a human is already involved)', '0', pg_temp.n_cb(a4));
  a_old := pg_temp.assess(v_org, p1, 'self_management', 24 * 5);
  perform pg_temp.rec('a check whose whole window has passed is not followed up', '0', pg_temp.n_cb(a_old));
  -- closed for that patient: the same check for a person who is not a test account while the guard is off
  a_g := pg_temp.assess(v_org, p7, 'self_management');
  delete from public.symptom_checkbacks where assessment_id = a_g;
  update public.profiles set is_test = false where id = p7;
  perform private.schedule_symptom_checkback(a_g);
  perform pg_temp.rec('closed for that patient (INV-14): nothing is scheduled', '0', pg_temp.n_cb(a_g));
  update public.profiles set is_test = true where id = p7;
  perform private.schedule_symptom_checkback(a_g);
  perform pg_temp.rec('open for a test account: scheduled', '1', pg_temp.n_cb(a_g));
  -- backfill
  delete from public.symptom_checkbacks where assessment_id = a2;
  v_out := private.symptom_checkback_sweep();
  perform pg_temp.rec('the sweep backfills an assessment that has no row', '1/true', pg_temp.n_cb(a2) || '/' || ((v_out ->> 'backfilled')::int >= 1)::text);
  perform pg_temp.rec('the sweep did not backfill an urgent, emergency or old check', '0/0/0', pg_temp.n_cb(a3) || '/' || pg_temp.n_cb(a4) || '/' || pg_temp.n_cb(a_old));

  -- 4. The sweep -------------------------------------------------------------------------------------------------
  a5 := pg_temp.assess(v_org, p2, 'self_management');
  c2 := (select id from public.symptom_checkbacks where assessment_id = a5);
  v_out := private.symptom_checkback_sweep();
  perform pg_temp.rec('nothing opens before its due time', 'scheduled', (select state from public.symptom_checkbacks where id = c2));
  update public.symptom_checkbacks set due_at = now() - interval '1 hour' where id = c2;
  perform private.symptom_checkback_sweep();
  perform pg_temp.rec('a due follow-up becomes open', 'open', (select state from public.symptom_checkbacks where id = c2));
  perform pg_temp.rec('it has one neutral in-app notice carrying only its id', '1/non_clinical/true',
    (select count(*)::text || '/' || min(content_class::text) || '/' || bool_and(payload = jsonb_build_object('checkback_id', c2))::text
       from public.notifications where recipient_id = p2 and template = 'symptom_checkback_due' and channel = 'in_app'));
  perform private.symptom_checkback_sweep();
  perform pg_temp.rec('a second sweep adds no second notice', '1', (select count(*)::text from public.notifications where recipient_id = p2 and template = 'symptom_checkback_due'));
  perform pg_temp.rec('the sent event carries ids only', 'true/1',
    (select (count(*) = 1)::text || '/' || min((select count(*) from jsonb_object_keys(payload)))::text from public.domain_events where event_type = 'symptom_checkback.sent' and patient_id = p2));
  perform pg_temp.rec('the notice copy names no symptom, result or person', '0',
    (select count(*)::text from public.notification_template_locales where template_key like 'symptom_checkback_%' and (coalesce(subject, '') || body) ~* 'symptom|result|pain|headache|diagnos|worse|chest|breath'));
  perform pg_temp.rec('no em dash in the notice copy', '0',
    (select count(*)::text from public.notification_template_locales where template_key like 'symptom_checkback_%' and (coalesce(subject, '') || body) like '%' || chr(8212) || '%'));
  -- closed for the patient: not opened
  a6 := pg_temp.assess(v_org, p3, 'routine');
  c3 := (select id from public.symptom_checkbacks where assessment_id = a6);
  update public.symptom_checkbacks set due_at = now() - interval '1 hour' where id = c3;
  update public.profiles set is_test = false where id = p3;
  perform private.symptom_checkback_sweep();
  perform pg_temp.rec('closed for that patient: the sweep does not open it', 'scheduled', (select state from public.symptom_checkbacks where id = c3));
  update public.profiles set is_test = true where id = p3;
  perform private.symptom_checkback_sweep();
  perform pg_temp.rec('open again: it opens', 'open', (select state from public.symptom_checkbacks where id = c3));
  -- the patient's own channel
  update public.profiles set notification_channel_preference = 'email' where id = p4;
  a7 := pg_temp.assess(v_org, p4, 'routine');
  c4 := (select id from public.symptom_checkbacks where assessment_id = a7);
  update public.symptom_checkbacks set due_at = now() - interval '1 hour' where id = c4;
  perform private.symptom_checkback_sweep();
  perform pg_temp.rec('an email-preferring patient gets the email and the in-app item beside it', 'email,in_app',
    (select string_agg(channel::text, ',' order by channel::text) from public.notifications where recipient_id = p4 and template = 'symptom_checkback_due'));
  -- the notice window
  perform pg_temp.rec('a 22:30 Lagos notice is held to 07:00 next morning', '2026-10-18 07:00',
    to_char(private.symptom_checkback_send_after('2026-10-17 22:30:00+01', 7, 21) at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'));
  perform pg_temp.rec('a 03:00 notice is held to 07:00 the same day', '2026-10-18 07:00',
    to_char(private.symptom_checkback_send_after('2026-10-18 03:00:00+01', 7, 21) at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'));
  perform pg_temp.rec('a midday notice is not held and 21:00 is outside the window', 'null/2026-10-18 07:00',
    coalesce(to_char(private.symptom_checkback_send_after('2026-10-17 12:00:00+01', 7, 21) at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'), 'null') || '/'
    || to_char(private.symptom_checkback_send_after('2026-10-17 21:00:00+01', 7, 21) at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'));
  -- one reminder only
  perform pg_temp.rec('no reminder before the reminder time', '0', (select nudge_count::text from public.symptom_checkbacks where id = c2));
  update public.symptom_checkbacks set opened_at = now() - interval '13 hours' where id = c2;
  perform private.symptom_checkback_sweep();
  perform private.symptom_checkback_sweep();
  perform pg_temp.rec('exactly one reminder however often the sweep runs', '1/1',
    (select nudge_count::text from public.symptom_checkbacks where id = c2) || '/' || (select count(*)::text from public.notifications where recipient_id = p2 and template = 'symptom_checkback_nudge' and channel = 'in_app'));
  perform pg_temp.rec('the reminder carries only the id', 'true',
    (select bool_and(payload = jsonb_build_object('checkback_id', c2))::text from public.notifications where recipient_id = p2 and template = 'symptom_checkback_nudge'));
  -- expiry
  update public.symptom_checkbacks set opened_at = now() - interval '49 hours' where id = c2;
  perform private.symptom_checkback_sweep();
  perform pg_temp.rec('after the window it expires', 'expired', (select state from public.symptom_checkbacks where id = c2));
  perform pg_temp.rec('silence raises no alert and no emergency', '0/0', pg_temp.alerts_for(p2) || '/' || pg_temp.emergencies_for(p2));
  perform pg_temp.rec('no unsent notice survives expiry', '0',
    (select count(*)::text from public.notifications where recipient_id = p2 and status = 'pending' and template in ('symptom_checkback_due', 'symptom_checkback_nudge')));
  -- a later urgent check by the same person cancels what is pending
  a8 := pg_temp.assess(v_org, p5, 'self_management', 2);
  c5 := (select id from public.symptom_checkbacks where assessment_id = a8);
  perform pg_temp.assess(v_org, p5, 'urgent');
  perform private.symptom_checkback_sweep();
  perform pg_temp.rec('a later urgent check cancels the follow-up', 'cancelled/superseded_by_later_check',
    (select state || '/' || cancel_reason from public.symptom_checkbacks where id = c5));

  -- 5. Answering ------------------------------------------------------------------------------------------------
  c6 := pg_temp.mkcb(v_org, p6, 'routine', 30);
  perform pg_temp.act(stranger);
  perform pg_temp.rec('another patient cannot answer it', 'P0002', pg_temp.try(format('select public.answer_symptom_checkback(%L, ''better'', null, ''{}''::text[], null)', c6)));
  perform pg_temp.back();
  perform pg_temp.act(v_tied);
  perform pg_temp.rec('a clinician cannot answer for the patient', 'P0002', pg_temp.try(format('select public.answer_symptom_checkback(%L, ''better'', null, ''{}''::text[], null)', c6)));
  perform pg_temp.back();
  perform pg_temp.act(p6);
  perform pg_temp.rec('a missing or unknown progress answer is refused', '22023/22023',
    pg_temp.try(format('select public.answer_symptom_checkback(%L, null, null, ''{}''::text[], null)', c6)) || '/' || pg_temp.try(format('select public.answer_symptom_checkback(%L, ''fine'', null, ''{}''::text[], null)', c6)));
  perform pg_temp.rec('an unknown care answer is refused', '22023', pg_temp.try(format('select public.answer_symptom_checkback(%L, ''better'', ''yes'', ''{}''::text[], null)', c6)));
  perform pg_temp.rec('an unknown floor category is refused', '22023', pg_temp.try(format('select public.answer_symptom_checkback(%L, ''better'', null, ''{}''::text[], ''routine'')', c6)));
  perform pg_temp.rec('a sign outside the pathway vocabulary is refused (nothing free-form reaches an alert)', '22023',
    pg_temp.try(format('select public.answer_symptom_checkback(%L, ''better'', null, array[''chest_pain''], null)', c6)));
  perform pg_temp.rec('more than ten signs are refused', '22023',
    pg_temp.try(format('select public.answer_symptom_checkback(%L, ''better'', null, array[''a'',''b'',''c'',''d'',''e'',''f'',''g'',''h'',''i'',''j'',''k''], null)', c6)));
  perform pg_temp.back();
  perform pg_temp.rec('refused answers changed nothing', 'open', (select state from public.symptom_checkbacks where id = c6));

  -- the plan includes doctor time (forced for the first half of the matrix)
  create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql as $s$ select true $s$;

  -- better: closes, raises nothing
  v_out := pg_temp.ans(p6, c6, 'better', '{}', null, 'saw_clinician');
  perform pg_temp.rec('better with nothing new closes', 'close/false/false', (v_out ->> 'action') || '/' || (v_out ->> 'escalated') || '/' || (v_out ->> 'alert_raised'));
  perform pg_temp.rec('a safe answer raises no alert and no emergency', '0/0', pg_temp.alerts_for(p6) || '/' || pg_temp.emergencies_for(p6));
  perform pg_temp.rec('the outcome is stored for the accuracy audit', 'answered/better/saw_clinician/close/true/true',
    (select state || '/' || progress || '/' || care_received || '/' || action || '/' || (answered_at is not null)::text || '/' || (hours_since_check between 29.9 and 31)::text from public.symptom_checkbacks where id = c6));
  v_out := pg_temp.ans(p6, c6, 'worse', '{}', 'emergency');
  perform pg_temp.rec('answering twice returns the stored result and changes nothing', 'close/true/0/0',
    (v_out ->> 'action') || '/' || (v_out ->> 'repeat') || '/' || pg_temp.alerts_for(p6) || '/' || pg_temp.emergencies_for(p6));
  perform pg_temp.rec('the answered event carries ids only', 'true',
    (select bool_and((select count(*) from jsonb_object_keys(payload)) = 1 and payload ? 'checkback_id')::text from public.domain_events where event_type = 'symptom_checkback.answered' and patient_id = p6));
  perform pg_temp.rec('an answer withdraws any unsent notice', '0',
    (select count(*)::text from public.notifications where recipient_id = p6 and status = 'pending' and template in ('symptom_checkback_due', 'symptom_checkback_nudge')));

  -- worse: ONE alert carrying the original summary
  cm := pg_temp.mkcb(v_org, pm, 'self_management', 10);
  v_out := pg_temp.ans(pm, cm, 'worse');
  perform pg_temp.rec('worse escalates and raises exactly one alert and no emergency', 'escalate/true/true/1/0',
    (v_out ->> 'action') || '/' || (v_out ->> 'escalated') || '/' || (v_out ->> 'alert_raised') || '/' || pg_temp.alerts_for(pm) || '/' || pg_temp.emergencies_for(pm));
  perform pg_temp.rec('the alert is urgent, a symptom escalation, and carries the original summary', 'urgent_escalation/symptom_escalation/true',
    (select level::text || '/' || type_code::text || '/' || (detail like '%Headache%' and detail like '%Answered: worse%' and detail like '%ticked: nausea_vomiting%' and detail like '%onset gradual%') ::text
       from public.clinician_alerts where patient_id = pm));
  perform pg_temp.rec('the alert never carries a pregnancy answer', 'false',
    (select (detail ilike '%pregnan%')::text from public.clinician_alerts where patient_id = pm));
  perform pg_temp.rec('the row links the alert and is marked escalated', 'true/true',
    (select (alert_id is not null)::text || '/' || escalated::text from public.symptom_checkbacks where id = cm));

  -- the decision matrix (12 cases, each on its own follow-up)
  declare
    t record; cx uuid; v_p uuid; v_actual text;
  begin
    for t in
      select * from (values
        (1, 'self_management', 10, 'better', '{}'::text[], null::text, 'close'),
        (2, 'self_management', 10, 'better', '{}', 'urgent', 'escalate'),
        (3, 'self_management', 10, 'better', '{}', 'emergency', 'emergency'),
        (4, 'self_management', 10, 'same', '{}', null, 'keep_watching'),
        (5, 'self_management', 80, 'same', '{}', null, 'book'),
        (6, 'routine', 30, 'same', '{}', null, 'book'),
        (7, 'routine', 10, 'same', '{}', null, 'keep_watching'),
        (8, 'routine', 10, 'same', '{visual_disturbance}', null, 'escalate'),
        (9, 'routine', 10, 'worse', '{}', null, 'escalate'),
        (10, 'routine', 10, 'worse', '{}', 'emergency', 'emergency'),
        (11, 'routine', 10, 'better', '{visual_disturbance}', null, 'escalate'),
        (12, 'routine', 30, 'same', '{}', 'urgent', 'escalate')
      ) as x(n, cat, hrs, prog, signs, floor_cat, expected)
    loop
      v_p := pg_temp.mkuser(v_org, 'matrix' || t.n, 'patient');
      cx := pg_temp.mkcb(v_org, v_p, t.cat, t.hrs);
      v_actual := pg_temp.ans(v_p, cx, t.prog, t.signs, t.floor_cat) ->> 'action';
      perform pg_temp.rec('decision table case ' || lpad(t.n::text, 2, '0') || ' (' || t.cat || ', ' || t.hrs || 'h, ' || t.prog || ', signs ' || t.signs::text || ', floor ' || coalesce(t.floor_cat, 'none') || ')', t.expected, v_actual);
    end loop;
  end;

  -- a newly ticked sign, stored sorted and without repeats
  c7 := pg_temp.mkcb(v_org, p7, 'routine', 5);
  v_out := pg_temp.ans(p7, c7, 'better', array['fever', 'visual_disturbance', 'visual_disturbance']);
  perform pg_temp.rec('a new sign escalates even when the person says better, and is stored sorted without repeats', 'escalate/{fever,visual_disturbance}',
    (v_out ->> 'action') || '/' || (select new_signs::text from public.symptom_checkbacks where id = c7));

  -- emergency: the existing path, exactly one alert in total
  c8 := pg_temp.mkcb(v_org, p8, 'routine', 5);
  v_out := pg_temp.ans(p8, c8, 'worse', array['confusion'], 'emergency');
  perform pg_temp.rec('the floor saying emergency opens the emergency path: one event, one alert', 'emergency/true/1/1',
    (v_out ->> 'action') || '/' || (v_out ->> 'emergency') || '/' || pg_temp.emergencies_for(p8) || '/' || pg_temp.alerts_for(p8));
  perform pg_temp.rec('the emergency event is the existing path (source symptom_triage, active) and the row records it', 'symptom_triage/active/true',
    (select e.source::text || '/' || e.status::text || '/' || (k.emergency_event_id = e.id)::text from public.emergency_events e join public.symptom_checkbacks k on k.id = c8 where e.patient_id = p8));

  -- a plan without doctor time: guidance on screen, no alert, but an emergency still opens the emergency path
  create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql as $s$ select false $s$;
  declare pf uuid := pg_temp.mkuser(v_org, 'free', 'patient'); cf uuid; cf2 uuid;
  begin
    cf := pg_temp.mkcb(v_org, pf, 'routine', 5);
    v_out := pg_temp.ans(pf, cf, 'worse');
    perform pg_temp.rec('without doctor time worse escalates on screen and raises no alert', 'escalate/false/false/0',
      (v_out ->> 'action') || '/' || (v_out ->> 'alert_raised') || '/' || (v_out ->> 'doctor_access') || '/' || pg_temp.alerts_for(pf));
    cf2 := pg_temp.mkcb(v_org, pf, 'routine', 5);
    v_out := pg_temp.ans(pf, cf2, 'better', '{}', 'emergency');
    -- (whether the platform's own emergency trigger also pages for this plan is its rule, proven elsewhere; what matters here is that the emergency event exists)
    perform pg_temp.rec('without doctor time an emergency still opens the emergency path', 'emergency/1',
      (v_out ->> 'action') || '/' || pg_temp.emergencies_for(pf));
  end;
  create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql as $s$ select true $s$;

  -- a late answer after expiry is still taken, and still escalates
  declare pl uuid := pg_temp.mkuser(v_org, 'late', 'patient'); cl uuid;
  begin
    cl := pg_temp.mkcb(v_org, pl, 'routine', 60, 'expired');
    v_out := pg_temp.ans(pl, cl, 'worse');
    perform pg_temp.rec('a late answer after expiry is still taken and still escalates', 'escalate/1',
      (v_out ->> 'action') || '/' || pg_temp.alerts_for(pl));
  end;
  -- cancelled and not-yet-open follow-ups cannot be answered
  declare pc uuid := pg_temp.mkuser(v_org, 'cancelled', 'patient'); cc uuid; cs uuid;
  begin
    cc := pg_temp.mkcb(v_org, pc, 'routine', 5);
    update public.symptom_checkbacks set state = 'cancelled', cancelled_at = now(), cancel_reason = 'proof' where id = cc;
    cs := pg_temp.mkcb(v_org, pc, 'routine', 5, 'scheduled');
    perform pg_temp.act(pc);
    perform pg_temp.rec('a cancelled follow-up cannot be answered (its own code)', '55000', pg_temp.try(format('select public.answer_symptom_checkback(%L, ''better'', null, ''{}''::text[], null)', cc)));
    perform pg_temp.rec('a follow-up that has not opened cannot be answered', '55000', pg_temp.try(format('select public.answer_symptom_checkback(%L, ''better'', null, ''{}''::text[], null)', cs)));
    perform pg_temp.back();
  end;
  -- closed for the patient: refused
  declare pg uuid := pg_temp.mkuser(v_org, 'closed', 'patient'); cg uuid;
  begin
    cg := pg_temp.mkcb(v_org, pg, 'routine', 5);
    update public.profiles set is_test = false where id = pg;
    perform pg_temp.act(pg);
    perform pg_temp.rec('closed for that patient (INV-14): the answer is refused', '42501', pg_temp.try(format('select public.answer_symptom_checkback(%L, ''better'', null, ''{}''::text[], null)', cg)));
    perform pg_temp.back();
  end;

  -- 6. Access -----------------------------------------------------------------------------------------------------
  perform pg_temp.act(pm);
  perform pg_temp.rec('the patient reads own rows', 'true', ((select count(*) from public.symptom_checkbacks) >= 1)::text);
  perform pg_temp.rec('the patient reads only own rows', '0', (select count(*)::text from public.symptom_checkbacks where patient_id <> pm));
  perform pg_temp.rec('the patient cannot write the table', '42501/42501', pg_temp.try(format('update public.symptom_checkbacks set state = ''open'' where id = %L', cm)) || '/' || pg_temp.try(format('delete from public.symptom_checkbacks where id = %L', cm)));
  v_out := public.my_symptom_checkback(cm);
  perform pg_temp.back();
  perform pg_temp.rec('the patient reads their own follow-up with the original answers and the pathway vocabulary', 'Headache/true/true',
    (v_out ->> 'complaint_label') || '/' || ((v_out -> 'sign_vocabulary') ? 'confusion')::text || '/' || ((v_out #>> '{capture,onset}') = 'gradual')::text);
  perform pg_temp.act(stranger);
  perform pg_temp.rec('another patient reads none of it', '0/P0002', (select count(*)::text from public.symptom_checkbacks) || '/' || pg_temp.try(format('select public.my_symptom_checkback(%L)', cm)));
  perform pg_temp.back();
  perform pg_temp.act(v_tied);
  perform pg_temp.rec('staff have no table policy: even the tied clinician reads none directly', '0', (select count(*)::text from public.symptom_checkbacks));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot call the patient or clinician functions', '42501/42501/42501',
    pg_temp.try(format('select public.answer_symptom_checkback(%L, ''better'', null, ''{}''::text[], null)', cm)) || '/' || pg_temp.try(format('select public.my_symptom_checkback(%L)', cm))
    || '/' || pg_temp.try(format('select public.read_symptom_checkback_audited(%L, ''reading for the proof'')', a1)));
  perform pg_temp.back();
  -- the audited clinician read: tied, reason required, coordinator refused, every read and refusal audited
  -- a fresh patient whose answer raised nothing, so no alert can have been routed to the "untied" clinician (an open alert is itself a tie)
  declare pa uuid := pg_temp.mkuser(v_org, 'audited', 'patient'); ca uuid; j jsonb;
  begin
    ca := pg_temp.mkcb(v_org, pa, 'routine', 30);
    perform pg_temp.ans(pa, ca, 'better', '{}', null, 'not_yet');
    a_aud := (select assessment_id from public.symptom_checkbacks where id = ca);
    a_none := pg_temp.assess(v_org, pa, 'self_management', 120);
    -- the tie under test is the care team assignment; the untied clinician has no assignment, no alert, no appointment and no task for this patient
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, pa, v_tied);
    perform pg_temp.act(v_untied);
    j := public.read_symptom_checkback_audited(a_aud, 'checking without a tie (proof)');
    perform pg_temp.back();
    perform pg_temp.rec('an untied clinician is denied', 'denied', j ->> 'status');
    perform pg_temp.rec('the denial is audited', '1',
      (select count(*)::text from public.audit_log where actor_id = v_untied and action = 'staff.chart_read' and subject_patient_id = pa and result = 'denied'));
    perform pg_temp.act(v_coord);
    perform pg_temp.rec('a care coordinator is refused', '42501', pg_temp.try(format('select public.read_symptom_checkback_audited(%L, ''coordinator reading (proof)'')', a_aud)));
    perform pg_temp.back();
    perform pg_temp.act(pa);
    perform pg_temp.rec('the patient cannot use the clinician read', '42501', pg_temp.try(format('select public.read_symptom_checkback_audited(%L, ''patient reading (proof)'')', a_aud)));
    perform pg_temp.back();
    perform pg_temp.act(v_tied);
    perform pg_temp.rec('a short reason is refused', '22023', pg_temp.try(format('select public.read_symptom_checkback_audited(%L, ''short'')', a_aud)));
    j := public.read_symptom_checkback_audited(a_aud, 'reviewing a follow-up (proof)');
    perform pg_temp.back();
    perform pg_temp.rec('the tied clinician reads the outcome', 'ok/better/close/false/not_yet',
      (j ->> 'status') || '/' || (j #>> '{checkback,progress}') || '/' || (j #>> '{checkback,action}') || '/' || (j #>> '{checkback,escalated}') || '/' || (j #>> '{checkback,care_received}'));
    perform pg_temp.rec('the read is audited with its reason', '1',
      (select count(*)::text from public.audit_log where actor_id = v_tied and action = 'staff.chart_read' and subject_patient_id = pa and result = 'success' and reason = 'reviewing a follow-up (proof)'));
    perform pg_temp.act(v_tied);
    perform pg_temp.rec('an assessment with no follow-up reads as none', 'none',
      public.read_symptom_checkback_audited(a_none, 'reading a check with no follow-up (proof)') ->> 'status');
    perform pg_temp.back();
  end;
  perform pg_temp.rec('no function the feature adds is executable by anon', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ((n.nspname = 'public' and p.proname in ('answer_symptom_checkback', 'my_symptom_checkback', 'read_symptom_checkback_audited', 'sign_symptom_ux_config', 'symptom_ux_active_config'))
          or (n.nspname = 'private' and p.proname in ('symptom_checkback_sweep', 'schedule_symptom_checkback', 'symptom_triage_assessments_schedule_checkback', 'symptom_ux_active', 'symptom_ux_signed_json',
                                                       'symptom_checkback_send_after', 'symptom_checkback_open_incident', 'symptom_checkback_emit', 'symptom_ux_rules_valid')))
        and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.rec('signed-in users cannot run the sweep or the scheduler', 'false/false',
    has_function_privilege('authenticated', 'private.symptom_checkback_sweep()', 'EXECUTE')::text || '/' || has_function_privilege('authenticated', 'private.schedule_symptom_checkback(uuid)', 'EXECUTE')::text);
  perform pg_temp.rec('the table is registered in the data registry and in the export', '1/1',
    (select count(*)::text from public.data_registry where table_name = 'symptom_checkbacks') || '/' || (select count(*)::text from public.data_registry where table_name = 'symptom_checkbacks' and in_export));
  perform pg_temp.rec('the sweep is scheduled and the trigger is in place', '1/1',
    (select count(*)::text from cron.job where jobname = 'symptom-checkback-sweep') || '/'
    || (select count(*)::text from pg_trigger where tgrelid = 'public.symptom_triage_assessments'::regclass and tgname = 'symptom_triage_assessments_90_schedule_checkback'));
  perform pg_temp.rec('the superseded-version guard is on the config table (counted here, not in governed_config_supersede_guard.sql)', '1',
    (select count(*)::text from pg_trigger where tgname = 'symptom_ux_config_refuse_superseded' and not tgisinternal and tgrelid = 'public.symptom_ux_config'::regclass));
  perform pg_temp.rec('the checker guard is still off after all of this', 'false', (select is_on::text from public.go_live_guards where key = 'symptom_checker_enabled'));
  perform pg_temp.rec('the describe, explainer and safety net configs are still unsigned', '0',
    (select count(*)::text from public.symptom_ux_config where kind <> 'checkback' and (is_active or approved_at is not null)));

  -- 2b. Supersession (after the rest, so the checkback config in force above is unchanged while it is used). The new draft is inserted as
  -- the table owner: the CMO's session has no insert privilege on purpose, a new version arrives by migration.
  insert into public.symptom_ux_config (kind, version, effective_from, rules)
  select kind, 2, current_date, jsonb_set(rules, '{version}', '2') from public.symptom_ux_config where kind = 'checkback' and version = 1;
  perform pg_temp.sign(v_cmo, 'checkback', 2);
  perform pg_temp.rec('a newer version of a kind can be signed and replaces the live one', 'false/true',
    (select (is_active)::text from public.symptom_ux_config where kind = 'checkback' and version = 1) || '/' || (select (is_active)::text from public.symptom_ux_config where kind = 'checkback' and version = 2));
  perform pg_temp.rec('an older signed version cannot be re-activated once a newer one is signed', '23514',
    pg_temp.try('update public.symptom_ux_config set is_active = true where kind = ''checkback'' and version = 1'));
  perform pg_temp.rec('the follow-ups made under the older version keep pointing at it', 'true',
    (select (count(*) > 0)::text from public.symptom_checkbacks k join public.symptom_ux_config c on c.id = k.config_id where c.kind = 'checkback' and c.version = 1));
  -- the other three kinds sign and are served the same way (the apps compare their bundled copy with what is served here)
  perform pg_temp.sign(v_cmo, 'describe', 1);
  perform pg_temp.sign(v_cmo, 'explainer', 1);
  perform pg_temp.sign(v_cmo, 'safety_net', 1);
  v_rules := (select rules - 'status' - 'clinical_sign_off' from public.symptom_ux_config where kind = 'safety_net' and version = 1);
  perform pg_temp.act(p1);
  perform pg_temp.rec('describe, explainer and safety net are each served signed once the CMO signs them, and the served copy equals the seed apart from the signature', 'signed_off/signed_off/signed_off/true',
    (public.symptom_ux_active_config('describe') ->> 'status') || '/' || (public.symptom_ux_active_config('explainer') ->> 'status') || '/' || (public.symptom_ux_active_config('safety_net') ->> 'status') || '/'
    || ((public.symptom_ux_active_config('safety_net') - 'status' - 'clinical_sign_off') = v_rules)::text);
  perform pg_temp.back();
  perform pg_temp.rec('signing the emergency number as unconfirmed leaves it unconfirmed (only a new version can confirm it)', 'false',
    (select (rules #>> '{emergency_number,confirmed}') from public.symptom_ux_config where kind = 'safety_net' and version = 1));

  -- 6b. Failure is loud and never takes anything else down ---------------------------------------------------------
  -- (a) scheduling fails: the assessment is still recorded, the failure is written down and an incident is opened
  v_def := pg_get_functiondef('private.schedule_symptom_checkback(uuid)'::regprocedure);
  create or replace function private.schedule_symptom_checkback(p_assessment uuid) returns integer language plpgsql as $s$ begin raise exception 'boom (proof)'; end $s$;
  declare pf1 uuid := pg_temp.mkuser(v_org, 'fail-sched', 'patient'); af1 uuid;
  begin
    af1 := pg_temp.assess(v_org, pf1, 'self_management');
    perform pg_temp.rec('a failure to schedule never fails the assessment', '1', (select count(*)::text from public.symptom_triage_assessments where id = af1));
    perform pg_temp.rec('the failure is written down with its reason and the assessment id', '1',
      (select count(*)::text from public.audit_log where action = 'symptom_checkback.error_schedule' and entity_id = af1 and event ->> 'error' like 'boom%'));
    perform pg_temp.rec('and an incident is opened for it (loud, sev3)', '1',
      (select count(*)::text from public.ops_incidents where external_reference = 'symptom_checkbacks' and severity::text = 'sev3' and status::text not in ('resolved', 'closed')));
  end;
  execute v_def;
  perform pg_temp.rec('the scheduler is back as it was', 'true', (position('go_live_open_patient' in pg_get_functiondef('private.schedule_symptom_checkback(uuid)'::regprocedure)) > 0)::text);
  -- (b) opening fails for one follow-up: counted, audited, an incident is open, and the row waits for the next sweep instead of being lost
  v_def := pg_get_functiondef('private.symptom_checkback_send_after(timestamptz,integer,integer)'::regprocedure);
  declare pf2 uuid := pg_temp.mkuser(v_org, 'fail-open', 'patient'); af2 uuid; cf2 uuid;
  begin
    af2 := pg_temp.assess(v_org, pf2, 'self_management');
    cf2 := (select id from public.symptom_checkbacks where assessment_id = af2);
    update public.symptom_checkbacks set due_at = now() - interval '1 hour' where id = cf2;
    create or replace function private.symptom_checkback_send_after(p_at timestamptz, p_start integer, p_end integer) returns timestamptz language plpgsql as $s$ begin raise exception 'boom (proof)'; end $s$;
    v_out := private.symptom_checkback_sweep();
    perform pg_temp.rec('a failure while opening is counted by the sweep', 'true', ((v_out ->> 'errors')::int >= 1)::text);
    perform pg_temp.rec('it is audited against the follow-up', '1', (select count(*)::text from public.audit_log where action = 'symptom_checkback.error_open' and entity_id = cf2));
    perform pg_temp.rec('the follow-up is not lost: it is still scheduled, with no half-sent notice', 'scheduled/0',
      (select state from public.symptom_checkbacks where id = cf2) || '/' || (select count(*)::text from public.notifications where recipient_id = pf2));
    execute v_def;
    perform private.symptom_checkback_sweep();
    perform pg_temp.rec('after the fault is fixed the next sweep opens it', 'open', (select state from public.symptom_checkbacks where id = cf2));
  end;
  -- (c) an event-bus failure never undoes an answer: it is audited and opens an incident
  v_def := pg_get_functiondef('private.emit_domain_event(text,uuid,jsonb,text,uuid,text,uuid,text,integer,uuid,timestamptz)'::regprocedure);
  create or replace function private.emit_domain_event(p_event_type text, p_organisation_id uuid, p_payload jsonb, p_idempotency_key text, p_patient_id uuid default null, p_aggregate_type text default null,
    p_aggregate_id uuid default null, p_priority text default 'normal', p_version integer default null, p_causation_id uuid default null, p_occurred_at timestamptz default null)
    returns uuid language plpgsql as $s$ begin raise exception 'bus down (proof)'; end $s$;
  declare pf3 uuid := pg_temp.mkuser(v_org, 'fail-bus', 'patient'); cf3 uuid;
  begin
    cf3 := pg_temp.mkcb(v_org, pf3, 'routine', 10);
    v_out := pg_temp.ans(pf3, cf3, 'better');
    perform pg_temp.rec('an event-bus failure does not undo the answer', 'close/answered', (v_out ->> 'action') || '/' || (select state from public.symptom_checkbacks where id = cf3));
    perform pg_temp.rec('it is audited', '1', (select count(*)::text from public.audit_log where action = 'symptom_checkback.error_event' and entity_id = cf3));
  end;
  execute v_def;

  -- (d) review fixes: the database derives the floor itself, a lone "same" is not the end, a stale follow-up is not opened, the in-app notice is not held
  declare
    pfl uuid := pg_temp.mkuser(v_org, 'floor', 'patient'); cfl uuid; cfl2 uuid;
    psm uuid := pg_temp.mkuser(v_org, 'same2', 'patient'); csm uuid; csm2 uuid; v_r2 record;
    pto uuid := pg_temp.mkuser(v_org, 'tooold', 'patient'); cto uuid; ato uuid;
  begin
    -- a direct caller sending NO floor and an emergency-grade sign: the database reads the signed protocol and still opens the emergency path
    cfl := pg_temp.mkcb(v_org, pfl, 'routine', 5);
    v_out := pg_temp.ans(pfl, cfl, 'better', array['vision_loss']);
    perform pg_temp.rec('a client that sends no floor cannot lower an emergency-grade sign (database-derived floor)', 'emergency/1',
      (v_out ->> 'action') || '/' || pg_temp.emergencies_for(pfl));
    perform pg_temp.rec('the stored floor is the derived one', 'emergency', (select floor_category from public.symptom_checkbacks where id = cfl));
    -- a smaller floor sent by the client does not lower it either
    cfl2 := pg_temp.mkcb(v_org, pfl, 'routine', 5);
    v_out := pg_temp.ans(pfl, cfl2, 'better', array['confusion'], 'urgent');
    perform pg_temp.rec('a smaller floor from the client is overridden by the database one', 'emergency', v_out ->> 'action');
    -- "same" before the nudge time schedules exactly one more check, and that one never schedules another
    csm := pg_temp.mkcb(v_org, psm, 'routine', 5);
    v_out := pg_temp.ans(psm, csm, 'same');
    select * into v_r2 from public.symptom_checkbacks where patient_id = psm and round = 2;
    perform pg_temp.rec('"same" earlier than the nudge time keeps watching and schedules the second check', 'keep_watching/scheduled/true',
      (v_out ->> 'action') || '/' || coalesce(v_r2.state, 'none') || '/' || (v_out ->> 'next_check_at' is not null)::text);
    perform pg_temp.rec('the second check is due at the nudge time, not before', 'true',
      (v_r2.due_at >= (select created_at from public.symptom_triage_assessments where id = v_r2.assessment_id) + interval '24 hours' - interval '1 minute')::text);
    update public.symptom_checkbacks set state = 'open', opened_at = now(), due_at = now() - interval '1 hour' where id = v_r2.id;
    csm2 := v_r2.id;
    v_out := pg_temp.ans(psm, csm2, 'same');
    perform pg_temp.rec('the second check, answered "same" early again, adds no third check', '2', (select count(*)::text from public.symptom_checkbacks where patient_id = psm));
    -- a follow-up that was never opened and is now long past its window is cancelled, not opened
    ato := pg_temp.assess(v_org, pto, 'routine', 10);
    delete from public.symptom_checkbacks where assessment_id = ato;
    insert into public.symptom_checkbacks (organisation_id, assessment_id, patient_id, config_id, category, due_at, is_test)
    values (v_org, ato, pto, (select id from public.symptom_ux_config where kind = 'checkback' and is_active), 'routine', now() - interval '100 hours', true) returning id into cto;
    perform private.symptom_checkback_sweep();
    perform pg_temp.rec('a follow-up past its whole window is cancelled as too old and never opened', 'cancelled/too_old',
      (select state || '/' || coalesce(cancel_reason, 'none') from public.symptom_checkbacks where id = cto));
    perform pg_temp.rec('and no notice was made for it', '0', (select count(*)::text from public.notifications where recipient_id = pto and template like 'symptom_checkback_%'));
    perform pg_temp.rec('the in-app notices are never held back by the quiet window', '0',
      (select count(*)::text from public.notifications where template like 'symptom_checkback_%' and channel = 'in_app' and send_after is not null));
    perform pg_temp.act(pfl);
    v_out := public.my_symptom_checkback(cfl2);
    perform pg_temp.back();
    perform pg_temp.rec('the patient read says whether an alert was raised and whether doctor access applies', 'true/true',
      ((v_out -> 'outcome') ? 'alert_raised')::text || '/' || ((v_out -> 'outcome') ? 'doctor_access')::text);
  end;

  -- (e) OQ-S59c-05: danger wording in the describe box records only the FACT on the emergency path, once per session, loud on failure
  declare
    pdd uuid := pg_temp.mkuser(v_org, 'dd', 'patient'); s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); v_a jsonb; v_b jsonb; v_c jsonb;
    pfr uuid := pg_temp.mkuser(v_org, 'dd-free', 'patient'); pcl uuid := pg_temp.mkuser(v_org, 'dd-closed', 'patient'); pbad uuid := pg_temp.mkuser(v_org, 'dd-fail', 'patient');
  begin
    perform pg_temp.act(pdd);
    v_a := public.record_describe_danger(s1, 'self_harm');
    v_b := public.record_describe_danger(s1, 'self_harm');
    v_c := v_a;
    perform pg_temp.back();
    perform pg_temp.rec('danger wording records the fact once', 'true/false/true/1',
      (v_a ->> 'recorded') || '/' || (v_a ->> 'repeat') || '/' || (v_b ->> 'repeat') || '/' || pg_temp.emergencies_for(pdd));
    perform pg_temp.act(pdd);
    v_b := public.record_describe_danger(s2, 'danger');
    perform pg_temp.back();
    perform pg_temp.rec('RATE LIMIT: a second session key inside the window raises no new event and no new page (a user cannot mint keys to page again)', '1/1/true',
      pg_temp.emergencies_for(pdd) || '/' || pg_temp.alerts_for(pdd) || '/' || (v_b ->> 'repeat'));
    perform pg_temp.rec('RATE LIMIT: the repeat says what the first one did (a clinician was paged)', 'true', v_b ->> 'doctor_alerted');
    -- once the window has passed a new session is a new event
    -- (audit_log is append-only, so the aged record is INSERTED with a past created_at as a privileged fixture, never updated)
    declare pold uuid := pg_temp.mkuser(v_org, 'dd-old', 'patient'); pnew uuid := pg_temp.mkuser(v_org, 'dd-recent', 'patient');
    begin
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, created_at)
      values (v_org, pold, 'symptom_describe.danger', 'emergency_event', gen_random_uuid(), jsonb_build_object('session', gen_random_uuid(), 'category', 'danger', 'doctor_alerted', true), now() - interval '31 minutes');
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, created_at)
      values (v_org, pnew, 'symptom_describe.danger', 'emergency_event', gen_random_uuid(), jsonb_build_object('session', gen_random_uuid(), 'category', 'danger', 'doctor_alerted', true), now() - interval '5 minutes');
      perform pg_temp.act(pold);
      v_b := public.record_describe_danger(gen_random_uuid(), 'danger');
      perform pg_temp.back();
      perform pg_temp.rec('after the window a new session records a new event', '1/false', pg_temp.emergencies_for(pold) || '/' || (v_b ->> 'repeat'));
      perform pg_temp.act(pnew);
      v_b := public.record_describe_danger(gen_random_uuid(), 'danger');
      perform pg_temp.back();
      perform pg_temp.rec('inside the window (5 minutes) a new session is a repeat and raises nothing', '0/true', pg_temp.emergencies_for(pnew) || '/' || (v_b ->> 'repeat'));
    end;
    perform pg_temp.rec('the lookup is served by the partial index', '1', (select count(*)::text from pg_indexes where indexname = 'audit_log_describe_danger_idx'));
    perform pg_temp.rec('CONTACTS: the event switches the emergency-contact notice off (a typed phrase never messages anyone outside the care team)', 'true',
      (select bool_and(suppress_contact_notify)::text from public.emergency_events where patient_id = pdd));
    perform pg_temp.rec('a plan with doctor time: the care team really was paged', 'true/1', (v_c ->> 'doctor_alerted') || '/' || pg_temp.alerts_for(pdd));
    perform pg_temp.rec('the event row is the existing path and carries the coarse code only', 'symptom_triage/active/true',
      (select e.source::text || '/' || e.status::text || '/' || (e.trigger_detail like '%self_harm%' and e.trigger_detail like '%No text was kept%')::text
         from public.emergency_events e where e.patient_id = pdd and e.trigger_detail like '%self_harm%'));
    perform pg_temp.rec('the audit record holds only the session key, the code and whether a doctor was paged', 'category,doctor_alerted,session',
      (select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(event) k from public.audit_log where action = 'symptom_describe.danger' and actor_id = pdd) x));
    -- no plan check: the emergency path runs on a plan without doctor time as well
    create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql as $s$ select false $s$;
    perform pg_temp.act(pfr);
    v_a := public.record_describe_danger(gen_random_uuid(), 'danger');
    perform pg_temp.back();
    create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql as $s$ select true $s$;
    perform pg_temp.rec('without doctor time the emergency event is still recorded', 'true/1', (v_a ->> 'recorded') || '/' || pg_temp.emergencies_for(pfr));
    perform pg_temp.rec('PLANS: without doctor time nobody is paged and the answer says so (no care-team promise)', 'false/0',
      (v_a ->> 'doctor_alerted') || '/' || pg_temp.alerts_for(pfr));
    perform pg_temp.rec('PLANS: and the Free guidance record path is the existing one (event has no clinician alert)', 'true',
      (select (clinician_alert_id is null)::text from public.emergency_events where patient_id = pfr));
    -- closed means closed
    update public.profiles set is_test = false where id = pcl;
    perform pg_temp.act(pcl);
    v_a := public.record_describe_danger(gen_random_uuid(), 'danger');
    perform pg_temp.back();
    update public.profiles set is_test = true where id = pcl;
    perform pg_temp.rec('closed for that patient: nothing is recorded and nothing is promised', 'false/closed/0', (v_a ->> 'recorded') || '/' || (v_a ->> 'reason') || '/' || pg_temp.emergencies_for(pcl));
    -- bad input and callers
    perform pg_temp.act(pdd);
    perform pg_temp.rec('a free-text category is refused (only the two codes exist)', '22023', pg_temp.try(format('select public.record_describe_danger(%L, ''my chest hurts'')', gen_random_uuid())));
    perform pg_temp.back();
    perform pg_temp.rec('signed-out callers are refused', '42501', pg_temp.try(format('select public.record_describe_danger(%L, ''danger'')', gen_random_uuid())));
    perform pg_temp.rec('anon cannot run it', 'false', has_function_privilege('anon', 'public.record_describe_danger(uuid,text)', 'EXECUTE')::text);
    -- the event cannot be recorded: the answer says so, it is audited, an incident is open, and nothing is thrown at the screen
    create function pg_temp.dd_boom() returns trigger language plpgsql as $t$ begin raise exception 'cannot record (proof)'; end $t$;
    create trigger dd_boom before insert on public.emergency_events for each row execute function pg_temp.dd_boom();
    perform pg_temp.act(pbad);
    v_a := public.record_describe_danger(gen_random_uuid(), 'danger');
    perform pg_temp.back();
    drop trigger dd_boom on public.emergency_events;
    perform pg_temp.rec('when the event cannot be recorded the answer is recorded=false and nothing is thrown', 'false/error/0', (v_a ->> 'recorded') || '/' || (v_a ->> 'reason') || '/' || pg_temp.emergencies_for(pbad));
    perform pg_temp.rec('that failure is audited without any text', '1',
      (select count(*)::text from public.audit_log where action = 'symptom_describe.error' and actor_id = pbad and event ->> 'error' like 'cannot record%'));
    perform pg_temp.rec('and an incident is open for it (sev3)', '1',
      (select count(*)::text from public.ops_incidents where external_reference = 'symptom_checkbacks' and severity::text = 'sev3' and status::text not in ('resolved', 'closed') and summary like '%symptom_describe.error%'));
  end;

  -- 7. SABOTAGE ---------------------------------------------------------------------------------------------------
  -- (a) the scheduling trigger is dropped: a new self-care check gets no follow-up
  drop trigger symptom_triage_assessments_90_schedule_checkback on public.symptom_triage_assessments;
  declare ps uuid := pg_temp.mkuser(v_org, 'sab-a', 'patient'); asb uuid;
  begin
    asb := pg_temp.assess(v_org, ps, 'self_management');
    insert into results values ('sabotaged', 'a self-care check gets a follow-up', '1', pg_temp.n_cb(asb));
  end;
  -- (b) the escalation helper is emptied: worse no longer raises the alert
  create or replace function private.raise_clinician_alert(p_organisation_id uuid, p_patient_id uuid, p_level public.alert_level, p_title text, p_detail text, p_category public.alert_category, p_type_code public.alert_type_code)
    returns uuid language sql as $s$ select null::uuid $s$;
  declare ps uuid := pg_temp.mkuser(v_org, 'sab-b', 'patient'); cs uuid;
  begin
    cs := pg_temp.mkcb(v_org, ps, 'routine', 10);
    perform pg_temp.ans(ps, cs, 'worse');
    insert into results values ('sabotaged', 'worse raises exactly one alert', '1', pg_temp.alerts_for(ps));
  end;
  -- (c) the table policy is widened: a stranger now reads other people's follow-ups
  drop policy symptom_checkbacks_patient_read on public.symptom_checkbacks;
  create policy symptom_checkbacks_patient_read on public.symptom_checkbacks for select to authenticated using (true);
  perform pg_temp.act(stranger);
  insert into results values ('sabotaged', 'another patient reads none of it (table)', '0', (select count(*)::text from public.symptom_checkbacks));
  perform pg_temp.back();
  -- (d) the immutability trigger is dropped: a signed config can now be edited
  drop trigger symptom_ux_config_guard on public.symptom_ux_config;
  insert into results values ('sabotaged', 'a signed config cannot be edited', '23514', pg_temp.try('update public.symptom_ux_config set rules = jsonb_set(rules, ''{max_nudges}'', ''0'') where kind = ''checkback'' and version = 1'));
  -- (e) the guard check is emptied: a closed patient is now scheduled
  create or replace function private.go_live_open_patient(p_key text, p_patient uuid) returns boolean language sql as $s$ select true $s$;
  declare pr uuid := pg_temp.mkuser(v_org, 'sab-e', 'patient'); ae uuid;
  begin
    ae := pg_temp.assess(v_org, pr, 'self_management');
    delete from public.symptom_checkbacks where assessment_id = ae;
    update public.profiles set is_test = false where id = pr;
    perform private.schedule_symptom_checkback(ae);
    insert into results values ('sabotaged', 'closed for that patient: nothing is scheduled', '0', pg_temp.n_cb(ae));
  end;
  -- (f) the sweep is granted to signed-in users
  grant execute on function private.symptom_checkback_sweep() to authenticated;
  insert into results values ('sabotaged', 'signed-in users cannot run the sweep', 'false', has_function_privilege('authenticated', 'private.symptom_checkback_sweep()', 'EXECUTE')::text);
  -- (g) the tie check is emptied: an untied clinician now reads
  create or replace function private.can_staff_read_clinical(p_patient uuid, p_category public.care_access_category) returns boolean language sql as $s$ select true $s$;
  perform pg_temp.act(v_untied);
  insert into results values ('sabotaged', 'an untied clinician is denied', 'denied', public.read_symptom_checkback_audited(a_aud, 'sabotage read (proof)') ->> 'status');
  perform pg_temp.back();
  -- (h) the superseded guard is dropped: an older version can now be re-activated (the newer one is switched off first so the one-active index does not interfere)
  drop trigger symptom_ux_config_refuse_superseded on public.symptom_ux_config;
  update public.symptom_ux_config set is_active = false where kind = 'checkback' and version = 2;
  insert into results values ('sabotaged', 'an older signed version cannot be re-activated once a newer one is signed', '23514',
    pg_temp.try('update public.symptom_ux_config set is_active = true where kind = ''checkback'' and version = 1'));
  -- (i) the database floor is emptied: an emergency-grade sign with no client floor is no longer an emergency
  create or replace function private.symptom_red_flag_floor(p_protocol integer, p_complaint text, p_capture jsonb, p_extra_symptoms text[]) returns text
    language sql as $s$ select null::text $s$;
  declare pi uuid := pg_temp.mkuser(v_org, 'sab-i', 'patient'); ci uuid;
  begin
    ci := pg_temp.mkcb(v_org, pi, 'routine', 5);
    insert into results values ('sabotaged', 'a client that sends no floor cannot lower an emergency-grade sign (database-derived floor)', 'emergency/1',
      (pg_temp.ans(pi, ci, 'better', array['vision_loss']) ->> 'action') || '/' || pg_temp.emergencies_for(pi));
  end;
  -- (j) the too-old step is broken (its reason is renamed in the sweep body): the stale-row check no longer sees the expected outcome
  declare v_sw text := pg_get_functiondef('private.symptom_checkback_sweep()'::regprocedure); pj uuid := pg_temp.mkuser(v_org, 'sab-j', 'patient'); aj uuid; cj uuid;
  begin
    execute replace(v_sw, '''too_old''', '''sabotaged_reason''');
    aj := pg_temp.assess(v_org, pj, 'routine', 10);
    delete from public.symptom_checkbacks where assessment_id = aj;
    insert into public.symptom_checkbacks (organisation_id, assessment_id, patient_id, config_id, category, due_at, is_test)
    values (v_org, aj, pj, (select id from public.symptom_ux_config where kind = 'checkback' and is_active), 'routine', now() - interval '100 hours', true) returning id into cj;
    perform private.symptom_checkback_sweep();
    insert into results values ('sabotaged', 'a follow-up past its whole window is cancelled as too old and never opened', 'cancelled/too_old',
      (select state || '/' || coalesce(cancel_reason, 'none') from public.symptom_checkbacks where id = cj));
  end;
  -- (k) the repeat check is removed altogether: the same session now records two events
  execute replace(pg_get_functiondef('public.record_describe_danger(uuid,text)'::regprocedure), 'if found then', 'if found and false then');
  declare pk uuid := pg_temp.mkuser(v_org, 'sab-k', 'patient'); sk uuid := gen_random_uuid();
  begin
    perform pg_temp.act(pk);
    perform public.record_describe_danger(sk, 'danger');
    perform public.record_describe_danger(sk, 'danger');
    perform pg_temp.back();
    insert into results values ('sabotaged', 'danger wording records the fact once', '1', pg_temp.emergencies_for(pk));
  end;
  -- (l) the contact-notice switch is removed from the insert: the event would message the person's emergency contact
  execute replace(pg_get_functiondef('public.record_describe_danger(uuid,text)'::regprocedure), '''active'', true)', '''active'', false)');
  declare pl2 uuid := pg_temp.mkuser(v_org, 'sab-l', 'patient');
  begin
    perform pg_temp.act(pl2);
    perform public.record_describe_danger(gen_random_uuid(), 'self_harm');
    perform pg_temp.back();
    insert into results values ('sabotaged', 'CONTACTS: the event switches the emergency-contact notice off (a typed phrase never messages anyone outside the care team)', 'true',
      (select bool_and(suppress_contact_notify)::text from public.emergency_events where patient_id = pl2));
  end;
  -- (m) the rate-limit window is removed (the session check stays): a second key now pages again
  execute replace(replace(pg_get_functiondef('public.record_describe_danger(uuid,text)'::regprocedure), 'if found and false then', 'if found then'),
                  'or a.created_at > now() - make_interval(mins => v_gap)', 'or false');
  declare pm2 uuid := pg_temp.mkuser(v_org, 'sab-m', 'patient');
  begin
    perform pg_temp.act(pm2);
    perform public.record_describe_danger(gen_random_uuid(), 'danger');
    perform public.record_describe_danger(gen_random_uuid(), 'danger');
    perform pg_temp.back();
    insert into results values ('sabotaged', 'RATE LIMIT: a second session key inside the window raises no new event and no new page (a user cannot mint keys to page again)', '1/1/true',
      pg_temp.emergencies_for(pm2) || '/' || pg_temp.alerts_for(pm2) || '/true');
  end;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S59c proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 13 then
    raise exception 'VACUOUS TEST: expected all thirteen sabotage runs to change a check, only % did (unchanged: %)', v_caught,
      (select string_agg(check_name || ' => ' || coalesce(actual, 'null'), '; ') from results where phase = 'sabotaged' and expected is not distinct from actual);
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to differ inside the DO block above. They are deliberately not printed: the runner treats any FAIL verdict in the output as a failed proof.

rollback;
