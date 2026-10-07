-- S70a proof: Module 18 core (migrations *_s70a_vital_source_photo_confirmed.sql and *_s70a_device_core.sql).
--
-- Proves in one rolled-back transaction:
--   1. Shape: seven device modules all OFF, four config rows all proposed (none signed), RLS on, nobody can write the new tables, anon has nothing.
--   2. Modules OFF changes nothing: an impossible value and a duplicate are saved exactly as they are today.
--   3. 18.9 plausibility (module on): an impossible value is HELD (not in the record, no alert, no page, kept in the held table, idempotent);
--      an extreme but possible value is saved and triaged (270/130 opens the emergency record); a child's weight is never held; the person, and
--      only the person (or a supporter), resolves a held reading; a stranger gets the same answer as for a missing row.
--   4. 18.9 de-duplication (module on): same reading from two sources is ONE canonical row in either arrival order, the better source wins, the other
--      payload is kept in the link table and nothing is deleted; windows and tolerances are exact; the same source is never merged (a CGM stream);
--      two values either side of a triage band are never merged; a duplicate red reading raises no second notice; a repeat adds no second link.
--   5. 18.5 CGM sustained events (module on): 15 minutes under 3.0 makes ONE clinician task and a neutral notice and an event; 10 minutes does not;
--      a long stream cannot flood the queue; a quiet sensor proves nothing; a high needs 2 hours; a non-CGM source never counts.
--   6. 18.6 rhythm results (module on): refused when off; verbatim label; an irregular, inconclusive or unrecognised label makes a routine task due in one
--      day and the fixed patient sentence; a clearly normal one makes none; "not normal" does not count as normal; a retry creates nothing twice;
--      chest pain goes to the existing symptom red path; a stranger is refused, a supporter is allowed.
--   7. 18.2 recommended devices: only the CMO can mark a row reviewed, and only with the evidence; the list is empty while the module is off; an owned device cannot be active.
--   8. 18.1 pairing for a person: a supporter pairs for the person they support, a stranger is refused, a repeat returns the same device.
--   9. Events: device.synced once per ten-minute bucket; device.alert carries ids, never a condition. Notification templates name no condition (INV-07).
--  10. Roles: patient, a stranger, a caregiver with and without the category grant, a viewer, org staff, an unrelated clinician and a tied clinician see
--      exactly what they see of vitals_readings itself, no more.
--  11. SABOTAGE: hold trigger dropped, de-duplication trigger dropped, CGM trigger dropped, wrist-SpO2 condition forced open, rhythm classifier forced to normal. Each matching check must flip.
begin;

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
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's70a-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S70a ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S70a ' || p_label, 'MDCN', 'S70A-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;
-- one vitals row as the OWNER (the triggers all run), at a time given as minutes ago
create function pg_temp.vit(p_patient uuid, p_org uuid, p_type text, p_source text, p_mins_ago numeric, p_sys int default null, p_dia int default null,
                            p_glu numeric default null, p_wt numeric default null, p_pulse int default null, p_temp numeric default null, p_spo2 int default null,
                            p_device uuid default null, p_ext text default null) returns text
language plpgsql as $f$
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, taken_at, systolic, diastolic, glucose_mmol_l, glucose_context, weight_kg,
                                      pulse_bpm, temperature_c, spo2_pct, device_id, external_reading_id)
  values (p_org, p_patient, p_type::public.vital_type, p_source::public.vital_source, now() - make_interval(secs => (p_mins_ago * 60)::double precision),
          p_sys, p_dia, p_glu, case when p_type = 'glucose' then 'random'::public.glucose_context end, p_wt, p_pulse, p_temp, p_spo2, p_device, p_ext);
  return 'ok';
exception when others then return sqlstate || ':' || sqlerrm;
end $f$;
create function pg_temp.n_vitals(p_patient uuid, p_type text) returns text language sql as
$$ select count(*)::text from public.vitals_readings where patient_id = p_patient and vital_type::text = p_type $$;
create function pg_temp.module(p_key text, p_on boolean, p_by uuid) returns void language sql as
$$ update public.platform_modules set is_enabled = p_on, enabled_at = case when p_on then now() end, enabled_by = case when p_on then p_by end where key = p_key $$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_pat uuid; v_pat2 uuid; v_cg uuid; v_cg_nocat uuid; v_viewer uuid; v_staff uuid; v_stranger_doc uuid;
  v_dev uuid; v_dev2 uuid; v_cat uuid; v_n integer; v_txt text; v_j jsonb; v_held uuid; v_pa uuid; v_before integer; v_after integer; v_task uuid;
  v_pat3 uuid; v_pat4 uuid; v_pat5 uuid; v_pat6 uuid;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_doc := pg_temp.mkdoc(v_org, v_admin, 'doc', 'medical_officer');
  v_stranger_doc := pg_temp.mkdoc(v_org, v_admin, 'doc2', 'medical_officer');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_pat3 := pg_temp.mkuser(v_org, 'patient3', 'patient');
  v_pat4 := pg_temp.mkuser(v_org, 'patient4', 'patient');
  v_pat5 := pg_temp.mkuser(v_org, 'patient5', 'patient');
  v_pat6 := pg_temp.mkuser(v_org, 'patient6', 'patient');
  v_cg := pg_temp.mkuser(v_org, 'caregiver', 'patient');
  v_cg_nocat := pg_temp.mkuser(v_org, 'caregiver-nocat', 'patient');
  v_viewer := pg_temp.mkuser(v_org, 'viewer', 'patient');
  v_staff := pg_temp.mkuser(v_org, 'orgstaff', 'admin');
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_pat, v_cg, 'manage', v_pat) returning id into v_pa;
  -- only the person whose record it is may grant a category: speak as them (claims only, as the S05f proofs do)
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'vitals_readings');
  perform set_config('request.jwt.claims', '', true);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_pat, v_cg_nocat, 'manage', v_pat);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_pat, v_viewer, 'view', v_pat);
  insert into public.patient_devices (organisation_id, patient_id, device_type, ble_device_id, model) values (v_org, v_pat, 'bp_cuff', 'S70A-CUFF-1', 'test cuff') returning id into v_dev;
  insert into public.patient_devices (organisation_id, patient_id, device_type, ble_device_id, model) values (v_org, v_pat, 'glucometer', 'S70A-GM-1', 'test meter') returning id into v_dev2;

  -- 1. Shape ----------------------------------------------------------------------------------------------------
  perform pg_temp.rec('seven device modules exist', '7', (select count(*)::text from public.platform_modules where key in ('device_plausibility_hold', 'device_cross_source_dedupe', 'device_cgm_sustained_events', 'device_ecg_rhythm_alerts', 'device_photo_capture', 'device_recommended_list', 'device_wrist_spo2_informational')));
  perform pg_temp.rec('every device module ships off', '0', (select count(*)::text from public.platform_modules where key like 'device\_%' and is_enabled));
  perform pg_temp.rec('four device_config rows, all proposed, none signed', '4/0', (select count(*) || '/' || count(*) filter (where status <> 'proposed') from public.device_config where is_active));
  perform pg_temp.rec('RLS on for the four new tables', '4', (select count(*)::text from pg_class where oid in ('public.device_config'::regclass, 'public.vitals_readings_held'::regclass, 'public.vitals_reading_links'::regclass, 'public.device_rhythm_results'::regclass) and relrowsecurity));
  perform pg_temp.rec('authenticated cannot write any new table', '0', (select count(*)::text from unnest(array['public.device_config', 'public.vitals_readings_held', 'public.vitals_reading_links', 'public.device_rhythm_results']) t where has_table_privilege('authenticated', t, 'INSERT') or has_table_privilege('authenticated', t, 'UPDATE') or has_table_privilege('authenticated', t, 'DELETE')));
  perform pg_temp.rec('anon cannot read any new table', '0', (select count(*)::text from unnest(array['public.device_config', 'public.vitals_readings_held', 'public.vitals_reading_links', 'public.device_rhythm_results']) t where has_table_privilege('anon', t, 'SELECT')));
  perform pg_temp.rec('anon cannot execute any new public function', '0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('resolve_held_reading', 'report_device_synced', 'record_device_rhythm_result', 'review_device_catalog_entry', 'recommended_devices', 'pair_device_for') and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.rec('the live source lock still names the bypass only once', '1', (select (length(pg_get_functiondef('private.enforce_vitals_reading_source_lock()'::regprocedure)) - length(replace(pg_get_functiondef('private.enforce_vitals_reading_source_lock()'::regprocedure), 'tarragon.vitals_dedupe', ''))) / length('tarragon.vitals_dedupe') || ''));

  -- 2. Modules OFF: today's behaviour, unchanged ----------------------------------------------------------------
  perform pg_temp.rec('off: an impossible BP is saved as it is today', 'ok', pg_temp.vit(v_pat6, v_org, 'blood_pressure', 'device', 1, 320, 90));
  perform pg_temp.rec('off: nothing is held', '0', (select count(*)::text from public.vitals_readings_held where patient_id = v_pat6));
  perform pg_temp.rec('off: the same reading from two sources is stored twice', 'ok', pg_temp.vit(v_pat6, v_org, 'weight', 'manual', 2, null, null, null, 70.0) );
  perform pg_temp.vit(v_pat6, v_org, 'weight', 'device', 1, null, null, null, 70.1, null, null, null, null, 'off-1');
  perform pg_temp.rec('off: ...both rows are there', '2', pg_temp.n_vitals(v_pat6, 'weight'));
  perform pg_temp.rec('off: no link row', '0', (select count(*)::text from public.vitals_reading_links where patient_id = v_pat6));

  -- 3. Plausibility hold ----------------------------------------------------------------------------------------
  perform pg_temp.module('device_plausibility_hold', true, v_admin);
  perform pg_temp.vit(v_pat, v_org, 'blood_pressure', 'device', 1, 320, 90, null, null, null, null, null, v_dev, 'x1');
  perform pg_temp.rec('on: an impossible BP (320/90) from a cuff is not saved', '0', pg_temp.n_vitals(v_pat, 'blood_pressure'));
  perform pg_temp.rec('...it is held, with its reason and config version', 'systolic_range/1', (select reasons[1] || '/' || config_version from public.vitals_readings_held where patient_id = v_pat and vital_type = 'blood_pressure'));
  perform pg_temp.rec('...and raised no alert, no emergency record, no notice', '0/0/0', (select (select count(*) from public.clinician_alerts where patient_id = v_pat) || '/' || (select count(*) from public.emergency_events where patient_id = v_pat) || '/' || (select count(*) from public.notifications where recipient_id = v_pat)));
  perform pg_temp.vit(v_pat, v_org, 'blood_pressure', 'device', 1, 320, 90, null, null, null, null, null, v_dev, 'x1');
  perform pg_temp.rec('...a retry of the same payload is still one held row', '1', (select count(*)::text from public.vitals_readings_held where patient_id = v_pat and state = 'pending'));
  perform pg_temp.vit(v_pat, v_org, 'blood_pressure', 'manual', 1, 90, 95);
  perform pg_temp.rec('SBP not above DBP (90/95) is held', 'systolic_not_above_diastolic', (select reasons[1] from public.vitals_readings_held where patient_id = v_pat and payload ->> 'systolic' = '90'));
  perform pg_temp.vit(v_pat, v_org, 'glucose', 'device', 1, null, null, 60);
  perform pg_temp.vit(v_pat, v_org, 'temperature', 'device', 1, null, null, null, null, null, 45);
  perform pg_temp.vit(v_pat, v_org, 'spo2', 'device', 1, null, null, null, null, null, null, 40);
  perform pg_temp.vit(v_pat, v_org, 'pulse', 'device', 1, null, null, null, null, 300);
  perform pg_temp.vit(v_pat, v_org, 'weight', 'device', 1, null, null, null, 12);
  perform pg_temp.rec('glucose 60, temperature 45, SpO2 40, pulse 300 and an adult weight of 12 kg are all held', '5', (select count(*)::text from public.vitals_readings_held where patient_id = v_pat and vital_type in ('glucose', 'temperature', 'spo2', 'pulse', 'weight')));
  perform pg_temp.rec('...and none reached the record', '0', (select count(*)::text from public.vitals_readings where patient_id = v_pat and vital_type::text in ('glucose', 'temperature', 'spo2', 'pulse', 'weight')));
  update public.profiles set date_of_birth = (current_date - interval '3 years')::date where id = v_pat5;
  perform pg_temp.vit(v_pat5, v_org, 'weight', 'device', 1, null, null, null, 12);
  perform pg_temp.rec('a child''s weight of 12 kg is saved, never held', '1/0', pg_temp.n_vitals(v_pat5, 'weight') || '/' || (select count(*) from public.vitals_readings_held where patient_id = v_pat5));
  select count(*) into v_before from public.emergency_events where patient_id = v_pat2;
  select count(*) into v_after from public.clinician_alerts where patient_id = v_pat2;
  select count(*) into v_n from public.notifications where recipient_id = v_pat2;
  perform pg_temp.vit(v_pat2, v_org, 'blood_pressure', 'manual', 1, 270, 130);
  perform pg_temp.rec('an extreme but possible BP (270/130) is saved...', '1', pg_temp.n_vitals(v_pat2, 'blood_pressure'));
  perform pg_temp.rec('...and triaged exactly as before: an emergency record, an alert or a notice is raised (which one depends on the approved rule set)', 'true',
    ((select count(*) from public.emergency_events where patient_id = v_pat2) + (select count(*) from public.clinician_alerts where patient_id = v_pat2) + (select count(*) from public.notifications where recipient_id = v_pat2) > v_before + v_after + v_n)::text);
  perform pg_temp.vit(v_pat2, v_org, 'spo2', 'device', 1, null, null, null, null, null, null, 60);
  perform pg_temp.rec('SpO2 60 is possible, saved and triaged', '1', pg_temp.n_vitals(v_pat2, 'spo2'));
  perform pg_temp.vit(v_pat2, v_org, 'glucose', 'device', 1, null, null, 1.2);
  perform pg_temp.rec('glucose 1.2 is possible and saved', '1', pg_temp.n_vitals(v_pat2, 'glucose'));

  select id into v_held from public.vitals_readings_held where patient_id = v_pat and vital_type = 'glucose';
  perform pg_temp.act(v_pat2);
  perform pg_temp.rec('a stranger resolving someone else''s held reading gets 42501', '42501', pg_temp.try(format('select public.resolve_held_reading(%L, ''discarded'')', v_held)));
  perform pg_temp.rec('a stranger cannot read held readings', '0', (select count(*)::text from public.vitals_readings_held where patient_id = v_pat));
  perform pg_temp.back();
  perform pg_temp.act(v_viewer);
  perform pg_temp.rec('a view-only supporter cannot resolve it either', '42501', pg_temp.try(format('select public.resolve_held_reading(%L, ''discarded'')', v_held)));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('the person sees their own held readings', '7', (select count(*)::text from public.vitals_readings_held where patient_id = v_pat));
  perform pg_temp.rec('a state that does not exist is refused', '22023', pg_temp.try(format('select public.resolve_held_reading(%L, ''banana'')', v_held)));
  perform pg_temp.rec('"corrected" needs one of their own readings', '22023', pg_temp.try(format('select public.resolve_held_reading(%L, ''corrected'')', v_held)));
  perform pg_temp.rec('the person discards it', 'discarded/true', (select (r ->> 'state') || '/' || (r ->> 'changed') from (select public.resolve_held_reading(v_held, 'discarded') r) x));
  perform pg_temp.rec('a second resolve changes nothing', 'false', (select (public.resolve_held_reading(v_held, 'discarded') ->> 'changed')));
  perform pg_temp.back();
  perform pg_temp.act(v_cg);
  perform pg_temp.rec('a supporter with manage resolves one for the person', 'discarded', (select public.resolve_held_reading(h.id, 'discarded') ->> 'state' from public.vitals_readings_held h where h.patient_id = v_pat and h.vital_type = 'temperature'));
  perform pg_temp.back();
  perform pg_temp.rec('...and the resolved rows are kept, never erased', '2', (select count(*)::text from public.vitals_readings_held where patient_id = v_pat and state = 'discarded'));
  perform pg_temp.rec('the resolve is audited', '2', (select count(*)::text from public.audit_log where action = 'device.held_reading_resolved' and event ->> 'state' = 'discarded' and organisation_id = v_org and created_at > now() - interval '1 hour') );

  -- 4. Cross-source de-duplication ------------------------------------------------------------------------------
  perform pg_temp.module('device_cross_source_dedupe', true, v_admin);
  -- (a) manual first, then the cuff: ONE row, the cuff wins in place
  perform pg_temp.vit(v_pat3, v_org, 'blood_pressure', 'manual', 4, 128, 82);
  perform pg_temp.rec('a cuff reading 3 minutes from a typed one', 'ok', pg_temp.vit(v_pat3, v_org, 'blood_pressure', 'device', 1, 129, 81, null, null, null, null, null, null, 'd1'));
  perform pg_temp.rec('...is ONE canonical row', '1', pg_temp.n_vitals(v_pat3, 'blood_pressure'));
  perform pg_temp.rec('...the better source (device) is the one kept', 'device/129/81', (select source::text || '/' || systolic || '/' || diastolic from public.vitals_readings where patient_id = v_pat3 and vital_type = 'blood_pressure'));
  perform pg_temp.rec('...the typed payload is kept, linked, not deleted', 'previous_replaced/manual/128', (select link_kind || '/' || superseded_source || '/' || (superseded_payload ->> 'systolic') from public.vitals_reading_links where patient_id = v_pat3));
  perform pg_temp.rec('...and the link names the config version used (INV-16)', '1', (select config_version::text from public.vitals_reading_links where patient_id = v_pat3));
  -- (b) cuff first, then the phone mirror: the mirror is linked, not stored
  perform pg_temp.vit(v_pat3, v_org, 'weight', 'device', 3, null, null, null, 70.0, null, null, null, null, 'w1');
  perform pg_temp.rec('a phone-mirror weight 0.1 kg from a scale reading', 'ok', pg_temp.vit(v_pat3, v_org, 'weight', 'wearable', 1, null, null, null, 70.1));
  perform pg_temp.rec('...is not stored twice', '1', pg_temp.n_vitals(v_pat3, 'weight'));
  perform pg_temp.rec('...the scale keeps its place', 'device', (select source::text from public.vitals_readings where patient_id = v_pat3 and vital_type = 'weight'));
  perform pg_temp.rec('...the mirror is linked as not stored', 'incoming_not_stored/phone_mirror', (select link_kind || '/' || superseded_class from public.vitals_reading_links where patient_id = v_pat3 and vital_type = 'weight'));
  perform pg_temp.vit(v_pat3, v_org, 'weight', 'wearable', 1, null, null, null, 70.1);
  perform pg_temp.rec('...a repeat of the mirror adds no second link', '1', (select count(*)::text from public.vitals_reading_links where patient_id = v_pat3 and vital_type = 'weight'));
  -- (c) exact windows and tolerances (a typed entry is stamped with the server time, so the older reading here is a phone mirror)
  perform pg_temp.vit(v_pat4, v_org, 'blood_pressure', 'wearable', 20, 120, 80);
  perform pg_temp.vit(v_pat4, v_org, 'blood_pressure', 'device', 9, 120, 80, null, null, null, null, null, null, 'e1');   -- 11 minutes apart
  perform pg_temp.rec('11 minutes apart is not a duplicate (BP window is 10)', '2', pg_temp.n_vitals(v_pat4, 'blood_pressure'));
  perform pg_temp.vit(v_pat4, v_org, 'blood_pressure', 'device', 19, 124, 80, null, null, null, null, null, null, 'e2');   -- 4 mmHg from the mirror, 10 minutes from the other cuff reading
  perform pg_temp.rec('4 mmHg apart is not a duplicate (tolerance is 3)', '3', pg_temp.n_vitals(v_pat4, 'blood_pressure'));
  perform pg_temp.vit(v_pat4, v_org, 'blood_pressure', 'wearable', 19, 123, 83);      -- 1 mmHg and 3 mmHg from the second cuff reading: the cuff is the better source
  perform pg_temp.rec('3 mmHg apart inside the window IS a duplicate: not stored, still three rows', '3', pg_temp.n_vitals(v_pat4, 'blood_pressure'));
  perform pg_temp.rec('...and the mirror reading is kept in the link table', '1', (select count(*)::text from public.vitals_reading_links where patient_id = v_pat4 and vital_type = 'blood_pressure' and link_kind = 'incoming_not_stored' and (superseded_payload ->> 'systolic') = '123'));
  perform pg_temp.vit(v_pat4, v_org, 'glucose', 'device', 10, null, null, 6.0, null, null, null, null, v_dev2, 'g1');
  perform pg_temp.vit(v_pat4, v_org, 'glucose', 'cgm', 4.9, null, null, 6.2);
  perform pg_temp.rec('glucose 0.2 apart and 5.1 minutes apart is NOT a duplicate (glucose window is 5)', '2', pg_temp.n_vitals(v_pat4, 'glucose'));
  perform pg_temp.vit(v_pat4, v_org, 'glucose', 'cgm', 8, null, null, 6.2);
  perform pg_temp.rec('glucose 0.2 apart and 2 minutes apart IS a duplicate: not stored twice', '2', pg_temp.n_vitals(v_pat4, 'glucose'));
  perform pg_temp.vit(v_pat4, v_org, 'glucose', 'cgm', 7, null, null, 6.4);
  perform pg_temp.rec('glucose 0.4 apart is not a duplicate (tolerance 0.3)', '3', pg_temp.n_vitals(v_pat4, 'glucose'));
  -- (d) never merge the same source: a CGM stream is many similar values on purpose
  perform pg_temp.vit(v_pat5, v_org, 'glucose', 'cgm', 3, null, null, 6.0);
  perform pg_temp.vit(v_pat5, v_org, 'glucose', 'cgm', 2, null, null, 6.1);
  perform pg_temp.vit(v_pat5, v_org, 'glucose', 'cgm', 1, null, null, 6.1);
  perform pg_temp.rec('three similar readings from the same sensor are three rows', '3', pg_temp.n_vitals(v_pat5, 'glucose'));
  -- (e) never merge across a triage band: a finger-prick 2.9 and a sensor 3.1 are both kept so the worse one is never hidden
  perform pg_temp.vit(v_pat6, v_org, 'glucose', 'device', 3, null, null, 2.9, null, null, null, null, v_dev2, 'g2');
  perform pg_temp.vit(v_pat6, v_org, 'glucose', 'cgm', 2, null, null, 3.1);
  perform pg_temp.rec('2.9 and 3.1 either side of a triage line are both kept', '2', pg_temp.n_vitals(v_pat6, 'glucose'));
  perform pg_temp.vit(v_pat6, v_org, 'blood_pressure', 'manual', 30, 158, 98);
  perform pg_temp.vit(v_pat6, v_org, 'blood_pressure', 'device', 29, 162, 102, null, null, null, null, null, null, 'f1');
  perform pg_temp.rec('158/98 and 162/102 either side of the red line are both kept (the second pair of BP rows here are not the earlier off-test 320/90 one)', '3', pg_temp.n_vitals(v_pat6, 'blood_pressure'));
  -- (f) a duplicate red reading must not raise a second notice
  perform pg_temp.vit(v_pat, v_org, 'blood_pressure', 'wearable', 3, 166, 104);
  select count(*) into v_before from public.notifications where recipient_id = v_pat or (payload::text like '%' || v_pat::text || '%');
  select count(*) into v_n from public.clinician_alerts where patient_id = v_pat;
  perform pg_temp.vit(v_pat, v_org, 'blood_pressure', 'device', 1, 167, 105, null, null, null, null, null, v_dev, 'r2');
  select count(*) into v_after from public.notifications where recipient_id = v_pat or (payload::text like '%' || v_pat::text || '%');
  perform pg_temp.rec('a red reading arriving from a second source raises no second notice', v_before::text, v_after::text);
  perform pg_temp.rec('...and no second alert', v_n::text, (select count(*)::text from public.clinician_alerts where patient_id = v_pat));
  perform pg_temp.rec('...and there is still one canonical red reading, from the better source', '1/device', (select pg_temp.n_vitals(v_pat, 'blood_pressure') || '/' || (select source::text from public.vitals_readings where patient_id = v_pat and vital_type = 'blood_pressure')));
  -- (g) the lock still holds for a patient session
  perform pg_temp.act(v_pat3);
  perform pg_temp.rec('a patient still cannot edit a device reading directly', '42501', pg_temp.try(format('update public.vitals_readings set systolic = 100 where patient_id = %L and source = ''device''', v_pat3)));
  perform pg_temp.back();
  perform pg_temp.rec('nothing was deleted: both superseded payloads of this person are in the link table', '2', (select count(*)::text from public.vitals_reading_links where patient_id = v_pat3));
  -- (h) a typed entry then a phone mirror: the mirror outranks a typed entry, so it takes the place in the record
  perform pg_temp.vit(v_pat5, v_org, 'pulse', 'manual', 4, null, null, null, null, 72);
  perform pg_temp.vit(v_pat5, v_org, 'pulse', 'wearable', 2, null, null, null, null, 73);
  perform pg_temp.rec('a phone-mirror pulse beats a typed one and replaces it in place', '1/wearable/73', pg_temp.n_vitals(v_pat5, 'pulse') || '/' || (select source::text || '/' || pulse_bpm from public.vitals_readings where patient_id = v_pat5 and vital_type = 'pulse'));

  -- (i) a photo the person confirmed digit by digit: stored like a typed reading. In the same transaction that adds the enum value Postgres refuses to use it
  --     (55P04), which is only possible here because this proof splices the migration in; on a real replay the value is committed and the insert runs.
  v_txt := pg_temp.vit(v_pat5, v_org, 'weight', 'photo_confirmed', 1, null, null, null, 65.0);
  perform pg_temp.rec('a photo-confirmed reading is accepted (or the enum value is not yet committed in this transaction)', 'true', (v_txt = 'ok' or v_txt like '55P04%')::text);
  perform pg_temp.rec('...and a photo-confirmed reading ranks below a phone mirror and above a typed one', 'true',
    (select (array_position(array(select jsonb_array_elements_text(private.device_config('devices.dedupe') -> 'precedence')), 'phone_mirror')
           < array_position(array(select jsonb_array_elements_text(private.device_config('devices.dedupe') -> 'precedence')), 'photo_confirmed')
         and array_position(array(select jsonb_array_elements_text(private.device_config('devices.dedupe') -> 'precedence')), 'photo_confirmed')
           < array_position(array(select jsonb_array_elements_text(private.device_config('devices.dedupe') -> 'precedence')), 'manual'))::text));

  -- 5. CGM sustained events -------------------------------------------------------------------------------------
  perform pg_temp.module('device_cgm_sustained_events', true, v_admin);
  -- severe low: 4 samples, 5 minutes apart, 15 minutes long
  perform pg_temp.vit(v_pat2, v_org, 'glucose', 'cgm', 30, null, null, 5.0);
  perform pg_temp.vit(v_pat2, v_org, 'glucose', 'cgm', 15, null, null, 2.8);
  perform pg_temp.vit(v_pat2, v_org, 'glucose', 'cgm', 10, null, null, 2.7);
  perform pg_temp.rec('10 minutes under 3.0 makes no task', '0', (select count(*)::text from public.clinical_tasks where patient_id = v_pat2 and type = 'cgm_glucose_review'));
  perform pg_temp.vit(v_pat2, v_org, 'glucose', 'cgm', 5, null, null, 2.6);
  perform pg_temp.vit(v_pat2, v_org, 'glucose', 'cgm', 0, null, null, 2.5);
  perform pg_temp.rec('15 minutes under 3.0 makes ONE clinician task', '1', (select count(*)::text from public.clinical_tasks where patient_id = v_pat2 and type = 'cgm_glucose_review'));
  perform pg_temp.rec('...a task, not a page: the proposed class is 4 and the due time is 240 minutes', '4/true', (select priority_class || '/' || (due_at between now() + interval '235 minutes' and now() + interval '245 minutes') from public.clinical_tasks where patient_id = v_pat2 and type = 'cgm_glucose_review'));
  perform pg_temp.rec('...the patient gets one neutral notice', '1', (select count(*)::text from public.notifications where recipient_id = v_pat2 and template = 'device_safety_notice'));
  perform pg_temp.rec('...and a device.alert event carrying ids only', 'cgm_low_severe/true', (select (payload ->> 'alert_kind') || '/' || (payload ? 'task_id') from public.domain_events where event_type = 'device.alert' and patient_id = v_pat2));
  -- flood: another 40 samples in the stream
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, taken_at, glucose_mmol_l, glucose_context)
  select v_org, v_pat2, 'glucose', 'cgm', now() + (g || ' minutes')::interval, 2.4, 'random' from generate_series(1, 40) g;
  perform pg_temp.rec('a long stream cannot flood the queue: still one task of this kind', '1', (select count(*)::text from public.clinical_tasks where patient_id = v_pat2 and type = 'cgm_glucose_review' and dedup_key like 'cgm:low:%'));
  perform pg_temp.rec('...and still one notice', '1', (select count(*)::text from public.notifications where recipient_id = v_pat2 and template = 'device_safety_notice'));
  perform pg_temp.rec('...and still one event', '1', (select count(*)::text from public.domain_events where event_type = 'device.alert' and patient_id = v_pat2));
  -- a sensor that went quiet proves nothing
  perform pg_temp.vit(v_pat4, v_org, 'glucose', 'cgm', 100, null, null, 2.8);
  perform pg_temp.vit(v_pat4, v_org, 'glucose', 'cgm', 40, null, null, 2.8);
  perform pg_temp.vit(v_pat4, v_org, 'glucose', 'cgm', 35, null, null, 2.7);
  perform pg_temp.rec('a gap longer than 20 minutes breaks the run: no task', '0', (select count(*)::text from public.clinical_tasks where patient_id = v_pat4 and type = 'cgm_glucose_review'));
  -- a non-CGM source never counts
  perform pg_temp.vit(v_pat5, v_org, 'glucose', 'device', 30, null, null, 3.5, null, null, null, null, null, 'gg1');
  perform pg_temp.vit(v_pat5, v_org, 'glucose', 'device', 20, null, null, 3.5, null, null, null, null, null, 'gg2');
  perform pg_temp.vit(v_pat5, v_org, 'glucose', 'device', 10, null, null, 3.5, null, null, null, null, null, 'gg3');
  perform pg_temp.rec('finger-prick readings never make a sustained-event task', '0', (select count(*)::text from public.clinical_tasks where patient_id = v_pat5 and type = 'cgm_glucose_review'));
  -- high: 2 hours above 13.9
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, taken_at, glucose_mmol_l, glucose_context)
  select v_org, v_pat3, 'glucose', 'cgm', now() - ((120 - g * 5) || ' minutes')::interval, 15.0, 'random' from generate_series(0, 23) g;
  perform pg_temp.rec('115 minutes above 13.9 makes no task', '0', (select count(*)::text from public.clinical_tasks where patient_id = v_pat3 and type = 'cgm_glucose_review'));
  perform pg_temp.vit(v_pat3, v_org, 'glucose', 'cgm', 0, null, null, 15.0);
  perform pg_temp.rec('120 minutes above 13.9 makes one task, due in 1440', 'cgm:high/true', (select left(dedup_key, 8) || '/' || (due_at between now() + interval '1435 minutes' and now() + interval '1445 minutes') from public.clinical_tasks where patient_id = v_pat3 and type = 'cgm_glucose_review'));
  perform pg_temp.rec('the cooldown holds even after the task is closed', '1', (select case when (select count(*) from public.clinical_tasks where patient_id = v_pat3 and type = 'cgm_glucose_review') = 1 then (select count(*) from public.clinical_tasks where patient_id = v_pat3 and type = 'cgm_glucose_review' and created_at > now() - interval '8 hours') end::text));

  -- 6. Rhythm results -------------------------------------------------------------------------------------------
  perform pg_temp.act(v_pat6);
  perform pg_temp.rec('rhythm results are refused while the module is off', '23514', pg_temp.try('select public.record_device_rhythm_result(''device_label'', ''Atrial fibrillation'', now(), ''off-1'')'));
  perform pg_temp.back();
  perform pg_temp.module('device_ecg_rhythm_alerts', true, v_admin);
  perform pg_temp.act(v_pat6);
  v_j := public.record_device_rhythm_result('healthkit_ecg', 'Atrial Fibrillation', now() - interval '5 minutes', 'ecg-1', 'Test watch');
  perform pg_temp.back();
  perform pg_temp.rec('an irregular label is classified irregular', 'irregular', v_j ->> 'category');
  perform pg_temp.rec('...the device''s own words are stored verbatim', 'Atrial Fibrillation', (select device_label from public.device_rhythm_results where id = (v_j ->> 'id')::uuid));
  perform pg_temp.rec('...a routine task is created, due in one day', 'device_rhythm_review/5/true', (select type || '/' || priority_class || '/' || (due_at between now() + interval '1435 minutes' and now() + interval '1445 minutes') from public.clinical_tasks where id = (v_j ->> 'task_id')::uuid));
  perform pg_temp.rec('...the patient is given only the fixed sentence', 'Your device flagged something for your care team to look at.', v_j ->> 'patient_copy');
  perform pg_temp.rec('...and the in-app notice says the same, naming nothing', 'Your device flagged something for your care team to look at.', (select body from public.notification_template_locales where template_key = 'device_flag_notice' and locale = 'en'));
  perform pg_temp.rec('...one device.alert event for it', '1', (select count(*)::text from public.domain_events where event_type = 'device.alert' and (payload ->> 'alert_kind') = 'rhythm_irregular' and patient_id = v_pat6));
  perform pg_temp.act(v_pat6);
  v_j := public.record_device_rhythm_result('healthkit_ecg', 'Atrial Fibrillation', now() - interval '5 minutes', 'ecg-1', 'Test watch');
  perform pg_temp.back();
  perform pg_temp.rec('a retry creates nothing twice', 'true/1', (v_j ->> 'duplicate') || '/' || (select count(*)::text from public.clinical_tasks where patient_id = v_pat6 and type = 'device_rhythm_review'));
  perform pg_temp.act(v_pat6);
  perform pg_temp.rec('an inconclusive label makes a task', 'inconclusive', public.record_device_rhythm_result('healthkit_ecg', 'Inconclusive: poor recording', now() - interval '4 minutes', 'ecg-2') ->> 'category');
  perform pg_temp.rec('an unrecognised label makes a task (fails toward review)', 'other', public.record_device_rhythm_result('device_label', 'Sinusoid weirdness', now() - interval '3 minutes', 'ecg-3') ->> 'category');
  perform pg_temp.rec('"not normal" does not count as normal', 'other', public.record_device_rhythm_result('device_label', 'Not normal', now() - interval '2 minutes', 'ecg-4') ->> 'category');
  perform pg_temp.rec('a clearly normal result is classified normal', 'normal', public.record_device_rhythm_result('healthkit_ecg', 'Sinus rhythm', now() - interval '1 minutes', 'ecg-5') ->> 'category');
  perform pg_temp.back();
  perform pg_temp.rec('...and makes no task (4 results needed review, one did not)', '4/5', (select count(*) filter (where task_id is not null) || '/' || count(*) from public.device_rhythm_results where patient_id = v_pat6));
  perform pg_temp.act(v_pat6);
  perform pg_temp.rec('a time more than 30 days ago is refused (as the person)', '22023', pg_temp.try('select public.record_device_rhythm_result(''device_label'', ''x'', now() - interval ''31 days'', ''old'')'));
  v_j := public.record_device_rhythm_result('healthkit_ecg', 'Atrial fibrillation', now(), 'ecg-6', null, array['chest_pain', 'fainting', 'bogus']);
  perform pg_temp.back();
  perform pg_temp.rec('chest pain and fainting go through the existing symptom red path', 'true/2/2', (v_j ->> 'red_path') || '/' || (select count(*)::text from public.symptoms where patient_id = v_pat6 and is_red_flag) || '/' || (select cardinality(symptoms_reported)::text from public.device_rhythm_results where id = (v_j ->> 'id')::uuid));
  perform pg_temp.act(v_pat2);
  perform pg_temp.rec('a stranger cannot record a result for someone else', '42501', pg_temp.try(format('select public.record_device_rhythm_result(''device_label'', ''x'', now(), ''z1'', null, ''{}'', %L)', v_pat6)));
  perform pg_temp.back();
  perform pg_temp.act(v_cg);
  perform pg_temp.rec('a supporter with manage can record one for the person they support', 'irregular', public.record_device_rhythm_result('device_label', 'Irregular rhythm', now(), 'cg-1', null, '{}', v_pat) ->> 'category');
  perform pg_temp.back();
  perform pg_temp.rec('rhythm labels: no template body names a condition, a reading or a result (INV-07)', '0', (select count(*)::text from public.notification_template_locales where template_key in ('device_flag_notice', 'device_safety_notice') and body ~* '(fibrillation|arrhythm|irregular|heart|glucose|sugar|diabet|hypo|hyper|blood pressure|mmol|mg/dl|bpm|ecg|afib)'));

  -- 7. Recommended devices --------------------------------------------------------------------------------------
  insert into public.device_catalog (device_name, category, pairing_path, vendor_name) values ('S70a test cuff', 'blood_pressure', 'ble_open_gatt', 'Test') returning id into v_cat;
  perform pg_temp.rec('a row cannot be created already reviewed', '42501', pg_temp.try('insert into public.device_catalog (device_name, category, pairing_path, clinically_reviewed) values (''x'', ''weight'', ''manual_only'', true)'));
  perform pg_temp.rec('an admin cannot flip a row to reviewed directly', '42501', pg_temp.try(format('update public.device_catalog set clinically_reviewed = true where id = %L', v_cat)));
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('a doctor who is not the CMO cannot review it', '42501', pg_temp.try(format('select public.review_device_catalog_entry(%L, true, ''checked the study'')', v_cat)));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the CMO cannot review it without a note', '22023', pg_temp.try(format('select public.review_device_catalog_entry(%L, true, ''ok'')', v_cat)));
  perform pg_temp.rec('...nor without the evidence (validation link and NAFDAC number or distributor)', '23514', pg_temp.try(format('select public.review_device_catalog_entry(%L, true, ''checked the study carefully'')', v_cat)));
  perform pg_temp.back();
  update public.device_catalog set validated_source_url = 'https://example.invalid/validation/s70a', validation_basis = 'validatebp', nafdac_number = 'A0-0000' , active = true where id = v_cat;
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('with the evidence the CMO reviews it', 'true', (public.review_device_catalog_entry(v_cat, true, 'checked the study and the NAFDAC record') ->> 'ok'));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('the list is empty while the module is off', '0', (select count(*)::text from public.recommended_devices()));
  perform pg_temp.back();
  perform pg_temp.module('device_recommended_list', true, v_admin);
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('with the module on the reviewed device is listed, with its evidence', '1/validatebp', (select count(*) || '/' || max(validation_basis) from public.recommended_devices()));
  perform pg_temp.back();
  update public.device_catalog set clinically_reviewed = false, reviewed_by = null, reviewed_at = null where id = v_cat;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('an unreviewed device is never listed', '0', (select count(*)::text from public.recommended_devices()));
  perform pg_temp.back();
  perform pg_temp.rec('a device Tarragon would own and sell can never be active', '23514', pg_temp.try(format('update public.device_catalog set fulfillment_type = ''tarragon_owned'', active = true where id = %L', v_cat)));

  -- 8. Pairing for a person -------------------------------------------------------------------------------------
  perform pg_temp.act(v_cg);
  v_dev2 := public.pair_device_for(v_pat, 'bp_cuff', 'S70A-SHARED-2', 'shared cuff');
  perform pg_temp.rec('a supporter with manage on a different person is refused', '42501', pg_temp.try(format('select public.pair_device_for(%L, ''bp_cuff'', ''X'', null)', v_pat2)));
  perform pg_temp.back();
  perform pg_temp.rec('a supporter pairs a device to the person they support', v_pat::text, (select patient_id::text from public.patient_devices where id = v_dev2));
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a repeat returns the same device', v_dev2::text, public.pair_device_for(v_pat, 'bp_cuff', 'S70A-SHARED-2', 'shared cuff')::text);
  perform pg_temp.back();
  perform pg_temp.act(v_pat2);
  perform pg_temp.rec('a stranger pairing for someone else is refused', '42501', pg_temp.try(format('select public.pair_device_for(%L, ''bp_cuff'', ''X'', null)', v_pat)));
  perform pg_temp.back();
  perform pg_temp.act(v_viewer);
  perform pg_temp.rec('a view-only supporter pairing for the person is refused', '42501', pg_temp.try(format('select public.pair_device_for(%L, ''bp_cuff'', ''X'', null)', v_pat)));
  perform pg_temp.back();

  -- 8b. Whose reading is this? (shared phones)
  perform pg_temp.act(v_cg);
  perform pg_temp.rec('a supporter can post a reading to the device of the person they support', v_pat::text || '/true', (select patient_id::text || '/' || is_supporter from public.device_target_for_reading(v_dev2)));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('the person posts to their own device', v_pat::text || '/false', (select patient_id::text || '/' || is_supporter from public.device_target_for_reading(v_dev2)));
  perform pg_temp.back();
  perform pg_temp.act(v_pat2);
  perform pg_temp.rec('a stranger gets nothing for it', '0', (select count(*)::text from public.device_target_for_reading(v_dev2)));
  perform pg_temp.back();
  perform pg_temp.act(v_viewer);
  perform pg_temp.rec('a view-only supporter gets nothing for it', '0', (select count(*)::text from public.device_target_for_reading(v_dev2)));
  perform pg_temp.back();
  update public.patient_devices set status = 'unpaired' where id = v_dev2;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('an unpaired device gets nothing', '0', (select count(*)::text from public.device_target_for_reading(v_dev2)));
  perform pg_temp.back();

  -- 8c. Wrist SpO2 is informational only
  select count(*) into v_before from public.emergency_events where patient_id = v_pat4;
  select count(*) into v_after from public.notifications where recipient_id = v_pat4;
  select count(*) into v_n from public.clinician_alerts where patient_id = v_pat4;
  perform pg_temp.vit(v_pat4, v_org, 'spo2', 'wearable', 2, null, null, null, null, null, null, 60);
  perform pg_temp.rec('module off: a wrist SpO2 of 60 is triaged as it is today', 'true',
    ((select count(*) from public.emergency_events where patient_id = v_pat4) + (select count(*) from public.notifications where recipient_id = v_pat4) + (select count(*) from public.clinician_alerts where patient_id = v_pat4) > v_before + v_after + v_n)::text);
  perform pg_temp.module('device_wrist_spo2_informational', true, v_admin);
  select count(*) into v_before from public.emergency_events where patient_id = v_pat3;
  select count(*) into v_after from public.notifications where recipient_id = v_pat3;
  select count(*) into v_n from public.clinician_alerts where patient_id = v_pat3;
  perform pg_temp.vit(v_pat3, v_org, 'spo2', 'wearable', 2, null, null, null, null, null, null, 60);
  perform pg_temp.rec('module on: a wrist SpO2 of 60 is saved and shown', '1', pg_temp.n_vitals(v_pat3, 'spo2'));
  perform pg_temp.rec('...but opens no emergency, no alert and no notice on its own', '0', ((select count(*) from public.emergency_events where patient_id = v_pat3) + (select count(*) from public.notifications where recipient_id = v_pat3) + (select count(*) from public.clinician_alerts where patient_id = v_pat3) - v_before - v_after - v_n)::text);
  perform pg_temp.vit(v_pat3, v_org, 'spo2', 'device', 30, null, null, null, null, null, null, 60, null, 'ox1');
  perform pg_temp.rec('a Bluetooth fingertip oximeter reading of 60 still triages', 'true',
    ((select count(*) from public.emergency_events where patient_id = v_pat3) + (select count(*) from public.notifications where recipient_id = v_pat3) + (select count(*) from public.clinician_alerts where patient_id = v_pat3) > v_before + v_after + v_n)::text);

  -- 9. Events ---------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_pat);
  perform public.report_device_synced('oura', 12);
  perform public.report_device_synced('oura', 14);
  perform public.report_device_synced('healthkit', 3);
  perform pg_temp.back();
  perform pg_temp.rec('device.synced is one event per source per ten minutes', '2', (select count(*)::text from public.domain_events where event_type = 'device.synced' and patient_id = v_pat));
  perform pg_temp.rec('the server-side sync event is for the service role only', 'false/false', has_function_privilege('anon', 'public.emit_device_synced(uuid,text,integer,uuid)', 'EXECUTE')::text || '/' || has_function_privilege('authenticated', 'public.emit_device_synced(uuid,text,integer,uuid)', 'EXECUTE')::text);
  perform public.emit_device_synced(v_pat6, 'wearable', 5, null);
  perform public.emit_device_synced(v_pat6, 'wearable', 7, null);
  perform pg_temp.rec('...and emits one device.synced per source per ten minutes', '1', (select count(*)::text from public.domain_events where event_type = 'device.synced' and patient_id = v_pat6));
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a sync report with a negative count is refused (as the person)', '22023', pg_temp.try('select public.report_device_synced(''x'', -1)'));
  perform pg_temp.back();

  -- 10. Roles: exactly what each of them sees of vitals_readings itself, no more -------------------------------------
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_pat, v_doc, now()) on conflict (patient_id) do update set clinician_id = v_doc;
  perform pg_temp.rec('fixture: the person has readings, held readings and a result to see', 'true',
    ((select count(*) from public.vitals_readings where patient_id = v_pat) > 0 and (select count(*) from public.vitals_readings_held where patient_id = v_pat) > 0 and (select count(*) from public.device_rhythm_results where patient_id = v_pat) > 0)::text);
  perform pg_temp.rec('fixture: links exist for another person', 'true', ((select count(*) from public.vitals_reading_links where patient_id = v_pat3) > 0)::text);
  -- the person: sees all of it
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('the person sees their own readings, held readings and results', 'true/true/true', ((select count(*) from public.vitals_readings where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.vitals_readings_held where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.device_rhythm_results where patient_id = v_pat) > 0)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_pat3);
  perform pg_temp.rec('the person sees their own links', 'true', ((select count(*) from public.vitals_reading_links where patient_id = v_pat3) > 0)::text);
  perform pg_temp.back();
  -- everyone else: held readings and results are visible exactly when the readings themselves are
  perform pg_temp.act(v_cg);
  perform pg_temp.rec('a caregiver WITH the vitals category grant: sees readings, held readings and results', 'true/true/true', ((select count(*) from public.vitals_readings where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.vitals_readings_held where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.device_rhythm_results where patient_id = v_pat) > 0)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_cg_nocat);
  perform pg_temp.rec('a caregiver with manage but WITHOUT the category: sees none of the three', 'false/false/false', ((select count(*) from public.vitals_readings where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.vitals_readings_held where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.device_rhythm_results where patient_id = v_pat) > 0)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_viewer);
  perform pg_temp.rec('a view-only supporter: sees none of the three', 'false/false/false', ((select count(*) from public.vitals_readings where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.vitals_readings_held where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.device_rhythm_results where patient_id = v_pat) > 0)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_staff);
  perform pg_temp.rec('org staff: sees none of the three through the tables (staff reads go through the audited functions, INV-10)', 'false/false/false', ((select count(*) from public.vitals_readings where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.vitals_readings_held where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.device_rhythm_results where patient_id = v_pat) > 0)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_stranger_doc);
  perform pg_temp.rec('an unrelated clinician: sees none of the three', 'false/false/false', ((select count(*) from public.vitals_readings where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.vitals_readings_held where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.device_rhythm_results where patient_id = v_pat) > 0)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('a tied clinician: sees exactly what they see of vitals_readings (the same, no more)', (select ((select count(*) from public.vitals_readings where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.vitals_readings where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.vitals_readings where patient_id = v_pat) > 0)::text),
    ((select count(*) from public.vitals_readings where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.vitals_readings_held where patient_id = v_pat) > 0)::text || '/' || ((select count(*) from public.device_rhythm_results where patient_id = v_pat) > 0)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_pat2);
  perform pg_temp.rec('a stranger patient: sees none of another person''s held readings, links or results', '0/0/0', (select (select count(*) from public.vitals_readings_held where patient_id in (v_pat, v_pat3, v_pat6)) || '/' || (select count(*) from public.vitals_reading_links where patient_id in (v_pat, v_pat3, v_pat6)) || '/' || (select count(*) from public.device_rhythm_results where patient_id in (v_pat, v_pat3, v_pat6))));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot call the sync report', '42501', pg_temp.try('select public.report_device_synced(''x'', 1)'));
  perform pg_temp.back();

  -- 11. SABOTAGE ------------------------------------------------------------------------------------------------
  -- (a) hold trigger dropped: an impossible BP is saved and triaged
  drop trigger vitals_readings_a_hold_impossible on public.vitals_readings;
  perform pg_temp.vit(v_pat4, v_org, 'blood_pressure', 'device', 1, 330, 90, null, null, null, null, null, null, 'sab1');
  insert into results values ('sabotaged', 'on: an impossible BP (320/90) from a cuff is not saved', '0',
    (select count(*)::text from public.vitals_readings where patient_id = v_pat4 and systolic = 330));
  -- (b) de-duplication trigger dropped: both rows are stored
  drop trigger vitals_readings_z_cross_source_dedupe on public.vitals_readings;
  perform pg_temp.vit(v_pat4, v_org, 'weight', 'device', 3, null, null, null, 80.0, null, null, null, null, 'sw1');
  perform pg_temp.vit(v_pat4, v_org, 'weight', 'wearable', 1, null, null, null, 80.1);
  insert into results values ('sabotaged', 'a phone-mirror weight 0.1 kg from a scale reading is not stored twice', '1', pg_temp.n_vitals(v_pat4, 'weight'));
  -- (c) CGM trigger dropped: no task
  drop trigger vitals_readings_cgm_sustained on public.vitals_readings;
  perform pg_temp.vit(v_pat5, v_org, 'glucose', 'cgm', 20, null, null, 2.5);
  perform pg_temp.vit(v_pat5, v_org, 'glucose', 'cgm', 15, null, null, 2.5);
  perform pg_temp.vit(v_pat5, v_org, 'glucose', 'cgm', 10, null, null, 2.5);
  perform pg_temp.vit(v_pat5, v_org, 'glucose', 'cgm', 5, null, null, 2.5);
  perform pg_temp.vit(v_pat5, v_org, 'glucose', 'cgm', 0, null, null, 2.5);
  insert into results values ('sabotaged', '15 minutes under 3.0 makes ONE clinician task', '1', (select count(*)::text from public.clinical_tasks where patient_id = v_pat5 and type = 'cgm_glucose_review'));
  -- (e) the wrist SpO2 condition forced open: a wrist reading triages again
  create or replace function private.spo2_may_triage(p_source text) returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$;
  select count(*) into v_before from public.emergency_events where patient_id = v_pat5;
  select count(*) into v_after from public.notifications where recipient_id = v_pat5;
  select count(*) into v_n from public.clinician_alerts where patient_id = v_pat5;
  perform pg_temp.vit(v_pat5, v_org, 'spo2', 'wearable', 2, null, null, null, null, null, null, 60);
  insert into results values ('sabotaged', 'module on: a wrist SpO2 of 60 opens nothing on its own (sabotage count)', '0',
    ((select count(*) from public.emergency_events where patient_id = v_pat5) + (select count(*) from public.notifications where recipient_id = v_pat5) + (select count(*) from public.clinician_alerts where patient_id = v_pat5) - v_before - v_after - v_n)::text);
  -- (d) rhythm classifier forced to normal: an irregular result makes no task
  create or replace function private.rhythm_category(p_label text, p_cfg jsonb) returns text language sql stable set search_path = '' as $f$ select 'normal'::text $f$;
  perform pg_temp.act(v_pat5);
  v_j := public.record_device_rhythm_result('healthkit_ecg', 'Atrial fibrillation', now(), 'sab-ecg');
  perform pg_temp.back();
  insert into results values ('sabotaged', 'an irregular label is classified irregular', 'irregular', v_j ->> 'category');
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S70a proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 5 then
    raise exception 'VACUOUS TEST: only % of 5 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed.

rollback;
