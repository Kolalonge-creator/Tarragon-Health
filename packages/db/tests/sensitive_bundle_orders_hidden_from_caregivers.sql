-- OQ-S98-7 proof: a caregiver or guardian cannot read the order of a SENSITIVE bundle, and cannot reach it through any other door.
-- (migration *_hide_sensitive_bundle_orders_from_caregivers.sql). One rolled-back transaction. Proves, with simulated sessions:
--   1. lab_orders: a caregiver holding the view_results permission and a caregiver holding the labs_results category each see the ORDINARY order
--      and NOT the sensitive-bundle order (HIV). The patient, an organisation admin and an emergency-access reader still see both. A stranger sees none.
--   2. The other doors that carry the same order: lab_specimens (lab_order_id, specimen_number), patient_timeline (the lab_completed event with the
--      order number), care_vouchers (panel_bundle_id) and the patient_care_gaps view (awaiting_result gap). The caregiver sees the ordinary row
--      and not the sensitive one in each; the owner still sees both; a non-lab timeline event is still visible (control).
--   3. Already closed before this change (asserted so they cannot regress): lab_order_test_status, lab_result_documents, lab_order_refunds,
--      lab_result_consult_requests are patient/staff only, so a caregiver sees nothing.
--   4. The sensitive predicate is the one S98b uses: bundles whose test_codes include a screen_types row flagged sensitive.
--      Also: the lab_abnormal timeline event and the screening_results row that carry the order id, a facility rating and a lab location review
--      that point at the order (a caregiver holding book_appointments), and a mixed reproductive + HIV bundle voucher.
--   5. SABOTAGE: the seven policies are put back to their pre-migration text and the caregiver checks are re-run; each must flip.
-- A result row with NO lab_order_id and lab_analyte_readings follow the separate sensitive-result rules and are deliberately not asserted here.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
-- run one scalar query as a signed-in user; the session is reset afterwards so a leftover JWT cannot leak into later fixtures
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
-- 'yes' when the user can read the row with this id in this table or view
create function pg_temp.sees(p_uid uuid, p_rel text, p_key text, p_id uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select case when exists (select 1 from %s where %I = %L) then ''yes'' else ''no'' end', p_rel, p_key, p_id)) $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'oqs987-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'OQS987 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => 45, days => 30))::date, 'female'::public.sex, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true,
     phone = excluded.phone, date_of_birth = excluded.date_of_birth, sex = excluded.sex;
  return v;
end $f$;

-- Fixtures ----------------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_org_b uuid := gen_random_uuid();
  p uuid; cv uuid; cc uuid; cr uuid; cm uuid; adm uuid; em uuid; x uuid; a3 uuid; b_repro uuid; b_mixed uuid; v_fac uuid; v_loc uuid; ru uuid;
  b_plain uuid; b_sens uuid; o_plain uuid; o_sens uuid; a1 uuid; a2 uuid; r1 uuid; r2 uuid;
begin
  if not exists (select 1 from public.organisations where id = v_org) then raise exception 'default organisation missing'; end if;
  insert into public.organisations (id, name, type) values (v_org_b, 'OQS987 Org B', 'direct_consumer');
  p := pg_temp.mkuser(v_org, 'patient', 'patient');
  cv := pg_temp.mkuser(v_org, 'caregiver-view-results', 'patient');
  cc := pg_temp.mkuser(v_org, 'caregiver-category', 'patient');
  cr := pg_temp.mkuser(v_org, 'caregiver-repro', 'patient');
  cm := pg_temp.mkuser(v_org, 'caregiver-manage', 'patient');
  adm := pg_temp.mkuser(v_org, 'admin', 'admin');
  em := pg_temp.mkuser(v_org_b, 'emergency', 'clinician');
  x := pg_temp.mkuser(v_org, 'stranger', 'patient');
  perform pg_temp.setf('p', p); perform pg_temp.setf('cv', cv); perform pg_temp.setf('cc', cc); perform pg_temp.setf('adm', adm);
  perform pg_temp.setf('em', em); perform pg_temp.setf('x', x); perform pg_temp.setf('cr', cr); perform pg_temp.setf('cm', cm);

  -- the caregiver holding the view_results PERMISSION (clinical_access grant narrowed to that one permission)
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
  values (p, cv, 'view', p, true, array['view_results']::public.caregiver_permission[]);
  -- the consent flag is forced off on insert and can only be switched on by the record owner, so do it as the patient
  perform set_config('request.jwt.claims', json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p::text, true);
  update public.profile_access set clinical_access = true, permissions = array['view_results']::public.caregiver_permission[]
   where profile_id = p and grantee_user_id = cv;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  -- the caregiver holding the labs_results and medical_history CATEGORIES
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
  values (p, cc, 'view', p, false, null) returning id into a2;
  -- only the record owner may set categories, so do it as the patient through the real RPC
  perform set_config('request.jwt.claims', json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p::text, true);
  set local role authenticated;
  perform public.set_care_access_categories(a2, array['labs_results', 'medical_history']::public.care_access_category[]);
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  -- a caregiver the patient explicitly granted reproductive_health (and medical_history) to
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
  values (p, cr, 'view', p, false, null) returning id into a3;
  perform set_config('request.jwt.claims', json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p::text, true);
  set local role authenticated;
  perform public.set_care_access_categories(a3, array['reproductive_health', 'medical_history']::public.care_access_category[]);
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  -- a caregiver with a manage grant (can_act_for), for the book_appointments paths
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (p, cm, 'manage', p);
  -- an emergency-access reader from another organisation
  insert into public.emergency_record_access_grants (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
  values (em, v_org_b, p, v_org, 'OQ-S98-7 proof fixture', now() + interval '1 hour');

  select id into b_plain from public.panel_bundles where code = 'single_ferritin';
  select id into b_sens from public.panel_bundles where code = 'single_hiv';
  if b_plain is null or b_sens is null then raise exception 'fixture bundles missing'; end if;
  perform pg_temp.setf('b_plain', b_plain); perform pg_temp.setf('b_sens', b_sens);

  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, origin, fulfilment, total_kobo, ordered_at)
  values (v_org, p, b_plain, 'ordered', 'patient_initiated', 'self_arranged', 0, now() - interval '30 days') returning id into o_plain;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, origin, fulfilment, total_kobo, ordered_at)
  values (v_org, p, b_sens, 'ordered', 'patient_initiated', 'self_arranged', 0, now() - interval '30 days') returning id into o_sens;
  perform pg_temp.setf('o_plain', o_plain); perform pg_temp.setf('o_sens', o_sens);

  insert into public.lab_specimens (organisation_id, lab_order_id, patient_id) values (v_org, o_plain, p) returning id into r1;
  insert into public.lab_specimens (organisation_id, lab_order_id, patient_id) values (v_org, o_sens, p) returning id into r2;
  perform pg_temp.setf('sp_plain', r1); perform pg_temp.setf('sp_sens', r2);

  -- timeline: the same event the lab-order trigger writes, for both orders, plus an unrelated event (control)
  perform private.record_timeline_event(v_org, p, 'lab_completed', 'lab_orders', o_plain, 'Lab results ready', 'Order plain', now(), null, '{}'::jsonb);
  perform private.record_timeline_event(v_org, p, 'lab_completed', 'lab_orders', o_sens, 'Lab results ready', 'Order sensitive', now(), null, '{}'::jsonb);
  perform pg_temp.setf('tl_plain', (select id from public.patient_timeline where patient_id = p and source_id = o_plain));
  perform pg_temp.setf('tl_sens', (select id from public.patient_timeline where patient_id = p and source_id = o_sens));

  insert into public.care_vouchers (organisation_id, beneficiary_profile_id, purchaser_profile_id, panel_bundle_id, sku_code, sku_name, kind, face_value_kobo, amount_paid_kobo, voucher_number, status)
  values (v_org, p, p, b_plain, 'OQS987-PLAIN', 'Plain', 'prepaid_service', 1000, 1000, 'OQS987-V1', 'active') returning id into a1;
  perform pg_temp.setf('v_plain', a1);
  insert into public.care_vouchers (organisation_id, beneficiary_profile_id, purchaser_profile_id, panel_bundle_id, sku_code, sku_name, kind, face_value_kobo, amount_paid_kobo, voucher_number, status)
  values (v_org, p, p, b_sens, 'OQS987-SENS', 'Sens', 'prepaid_service', 1000, 1000, 'OQS987-V2', 'active') returning id into a1;
  perform pg_temp.setf('v_sens', a1);
  select id into b_repro from public.panel_bundles where code = 'single_cervical_smear';
  insert into public.care_vouchers (organisation_id, beneficiary_profile_id, purchaser_profile_id, panel_bundle_id, sku_code, sku_name, kind, face_value_kobo, amount_paid_kobo, voucher_number, status)
  values (v_org, p, p, b_repro, 'OQS987-REPRO', 'Repro', 'prepaid_service', 1000, 1000, 'OQS987-V3', 'active') returning id into a1;
  perform pg_temp.setf('v_repro', a1);
  -- a MIXED bundle: reproductive (cervical smear) and HIV together
  insert into public.panel_bundles (code, name, price_kobo, test_codes) values ('OQS987-MIXED', 'OQS987 mixed', 1000, array['cervical_smear', 'hiv']) returning id into b_mixed;
  perform pg_temp.setf('b_mixed', b_mixed);
  insert into public.care_vouchers (organisation_id, beneficiary_profile_id, purchaser_profile_id, panel_bundle_id, sku_code, sku_name, kind, face_value_kobo, amount_paid_kobo, voucher_number, status)
  values (v_org, p, p, b_mixed, 'OQS987-MIX', 'Mixed', 'prepaid_service', 1000, 1000, 'OQS987-V4', 'active') returning id into a1;
  perform pg_temp.setf('v_mixed', a1);

  -- screening results that belong to each order, plus one abnormal result per order (the trigger writes the lab_abnormal timeline event)
  insert into public.screening_results (organisation_id, patient_id, lab_order_id, result_status) values (v_org, p, o_plain, 'normal') returning id into ru;
  perform pg_temp.setf('sr_plain', ru);
  insert into public.screening_results (organisation_id, patient_id, lab_order_id, result_status) values (v_org, p, o_sens, 'normal') returning id into ru;
  perform pg_temp.setf('sr_sens', ru);
  insert into public.screening_results (organisation_id, patient_id, lab_order_id, result_status, result_summary) values (v_org, p, o_plain, 'abnormal', 'plain abnormal') returning id into ru;
  perform pg_temp.setf('sr_abn_plain', ru);
  insert into public.screening_results (organisation_id, patient_id, lab_order_id, result_status, result_summary) values (v_org, p, o_sens, 'abnormal', 'sensitive abnormal') returning id into ru;
  perform pg_temp.setf('sr_abn_sens', ru);
  perform pg_temp.setf('tl_abn_plain', (select id from public.patient_timeline where patient_id = p and source_table = 'screening_results' and source_id = pg_temp.f('sr_abn_plain')));
  perform pg_temp.setf('tl_abn_sens', (select id from public.patient_timeline where patient_id = p and source_table = 'screening_results' and source_id = pg_temp.f('sr_abn_sens')));
  if pg_temp.f('tl_abn_sens') is null then raise exception 'fixture: the lab_abnormal timeline event was not written'; end if;

  -- a facility rating and a lab location review that point at each order
  select id into v_fac from public.facilities limit 1;
  select id into v_loc from public.lab_provider_locations limit 1;
  if v_fac is null or v_loc is null then raise exception 'fixture: need one facility and one lab location'; end if;
  insert into public.facility_ratings (organisation_id, patient_id, facility_id, lab_order_id, rating, respond_by) values (v_org, p, v_fac, o_plain, 5, now() + interval '1 day') returning id into ru;
  perform pg_temp.setf('fr_plain', ru);
  insert into public.facility_ratings (organisation_id, patient_id, facility_id, lab_order_id, rating, respond_by) values (v_org, p, v_fac, o_sens, 5, now() + interval '1 day') returning id into ru;
  perform pg_temp.setf('fr_sens', ru);
  insert into public.lab_location_reviews (organisation_id, patient_id, lab_order_id, location_id, rating) values (v_org, p, o_plain, v_loc, 5) returning id into ru;
  perform pg_temp.setf('lr_plain', ru);
  insert into public.lab_location_reviews (organisation_id, patient_id, lab_order_id, location_id, rating) values (v_org, p, o_sens, v_loc, 5) returning id into ru;
  perform pg_temp.setf('lr_sens', ru);
end $$;

do $$
begin
-- 4. the predicate -----------------------------------------------------------------------------------------------------------------------------------
perform pg_temp.ck('predicate: HIV bundle is sensitive', 'true', private.lab_bundle_is_sensitive(pg_temp.f('b_sens'))::text);
perform pg_temp.ck('predicate: ferritin bundle is not sensitive', 'false', private.lab_bundle_is_sensitive(pg_temp.f('b_plain'))::text);
perform pg_temp.ck('predicate: null bundle is not sensitive (an order with no bundle stays visible)', 'false', private.lab_bundle_is_sensitive(null)::text);
perform pg_temp.ck('predicate: matches the S98b definition for every active bundle', '0',
  (select count(*)::text from public.panel_bundles b
    where private.lab_bundle_is_sensitive(b.id) is distinct from exists (select 1 from public.screen_types st where st.sensitive and st.code = any (b.test_codes))));
perform pg_temp.ck('helpers are not callable by anon', 'false',
  (has_function_privilege('anon', 'private.lab_bundle_is_sensitive(uuid)', 'EXECUTE') or has_function_privilege('anon', 'private.lab_order_is_sensitive(uuid)', 'EXECUTE'))::text);

-- 1. lab_orders ---------------------------------------------------------------------------------------------------------------------------------------
perform pg_temp.ck('lab_orders: view_results caregiver sees the ordinary order', 'yes', pg_temp.sees(pg_temp.f('cv'), 'public.lab_orders', 'id', pg_temp.f('o_plain')));
perform pg_temp.ck('lab_orders: view_results caregiver does NOT see the sensitive order', 'no', pg_temp.sees(pg_temp.f('cv'), 'public.lab_orders', 'id', pg_temp.f('o_sens')));
perform pg_temp.ck('lab_orders: category caregiver sees the ordinary order', 'yes', pg_temp.sees(pg_temp.f('cc'), 'public.lab_orders', 'id', pg_temp.f('o_plain')));
perform pg_temp.ck('lab_orders: category caregiver does NOT see the sensitive order', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.lab_orders', 'id', pg_temp.f('o_sens')));
perform pg_temp.ck('lab_orders: the order number of the sensitive order is not readable by the caregiver', '0',
  pg_temp.q_as(pg_temp.f('cv'), format('select count(*)::text from public.lab_orders where patient_id = %L and order_number is not null and id = %L', pg_temp.f('p'), pg_temp.f('o_sens'))));
perform pg_temp.ck('lab_orders: the caregiver sees exactly one of the patient''s two orders', '1',
  pg_temp.q_as(pg_temp.f('cv'), format('select count(*)::text from public.lab_orders where patient_id = %L', pg_temp.f('p'))));
perform pg_temp.ck('lab_orders: patient sees the ordinary order', 'yes', pg_temp.sees(pg_temp.f('p'), 'public.lab_orders', 'id', pg_temp.f('o_plain')));
perform pg_temp.ck('lab_orders: patient sees the sensitive order', 'yes', pg_temp.sees(pg_temp.f('p'), 'public.lab_orders', 'id', pg_temp.f('o_sens')));
perform pg_temp.ck('lab_orders: organisation staff sees the sensitive order', 'yes', pg_temp.sees(pg_temp.f('adm'), 'public.lab_orders', 'id', pg_temp.f('o_sens')));
perform pg_temp.ck('lab_orders: emergency-access reader still sees the sensitive order (unchanged)', 'yes', pg_temp.sees(pg_temp.f('em'), 'public.lab_orders', 'id', pg_temp.f('o_sens')));
perform pg_temp.ck('lab_orders: emergency-access reader still sees the ordinary order (unchanged)', 'yes', pg_temp.sees(pg_temp.f('em'), 'public.lab_orders', 'id', pg_temp.f('o_plain')));
perform pg_temp.ck('lab_orders: a stranger sees neither', 'no', pg_temp.sees(pg_temp.f('x'), 'public.lab_orders', 'id', pg_temp.f('o_plain')));

-- 2. the other doors ----------------------------------------------------------------------------------------------------------------------------------
perform pg_temp.ck('lab_specimens: category caregiver sees the ordinary specimen', 'yes', pg_temp.sees(pg_temp.f('cc'), 'public.lab_specimens', 'id', pg_temp.f('sp_plain')));
perform pg_temp.ck('lab_specimens: category caregiver does NOT see the sensitive specimen', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.lab_specimens', 'id', pg_temp.f('sp_sens')));
perform pg_temp.ck('lab_specimens: view_results-only caregiver sees neither (control, unchanged)', 'no', pg_temp.sees(pg_temp.f('cv'), 'public.lab_specimens', 'id', pg_temp.f('sp_plain')));
perform pg_temp.ck('lab_specimens: patient sees the sensitive specimen', 'yes', pg_temp.sees(pg_temp.f('p'), 'public.lab_specimens', 'id', pg_temp.f('sp_sens')));
perform pg_temp.ck('lab_specimens: staff sees the sensitive specimen', 'yes', pg_temp.sees(pg_temp.f('adm'), 'public.lab_specimens', 'id', pg_temp.f('sp_sens')));
perform pg_temp.ck('patient_timeline: category caregiver sees the ordinary lab event', 'yes', pg_temp.sees(pg_temp.f('cc'), 'public.patient_timeline', 'id', pg_temp.f('tl_plain')));
perform pg_temp.ck('patient_timeline: category caregiver does NOT see the sensitive lab event', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.patient_timeline', 'id', pg_temp.f('tl_sens')));
perform pg_temp.ck('patient_timeline: patient sees the sensitive lab event', 'yes', pg_temp.sees(pg_temp.f('p'), 'public.patient_timeline', 'id', pg_temp.f('tl_sens')));
perform pg_temp.ck('patient_timeline: emergency-access reader still sees the sensitive lab event (unchanged)', 'yes', pg_temp.sees(pg_temp.f('em'), 'public.patient_timeline', 'id', pg_temp.f('tl_sens')));
perform pg_temp.ck('care_vouchers: category caregiver sees the ordinary voucher', 'yes', pg_temp.sees(pg_temp.f('cc'), 'public.care_vouchers', 'id', pg_temp.f('v_plain')));
perform pg_temp.ck('care_vouchers: category caregiver does NOT see the sensitive-bundle voucher', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.care_vouchers', 'id', pg_temp.f('v_sens')));
perform pg_temp.ck('care_vouchers: category caregiver (no reproductive grant) does NOT see the cervical-bundle voucher (unchanged)', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.care_vouchers', 'id', pg_temp.f('v_repro')));
perform pg_temp.ck('care_vouchers: an explicit reproductive_health grant still unlocks the cervical-bundle voucher (reproductive rules untouched)', 'yes', pg_temp.sees(pg_temp.f('cr'), 'public.care_vouchers', 'id', pg_temp.f('v_repro')));
perform pg_temp.ck('care_vouchers: that reproductive_health caregiver does NOT see the HIV-bundle voucher', 'no', pg_temp.sees(pg_temp.f('cr'), 'public.care_vouchers', 'id', pg_temp.f('v_sens')));
perform pg_temp.ck('care_vouchers: the beneficiary still sees the sensitive-bundle voucher', 'yes', pg_temp.sees(pg_temp.f('p'), 'public.care_vouchers', 'id', pg_temp.f('v_sens')));
perform pg_temp.ck('patient_care_gaps: caregiver sees the awaiting_result gap for the ordinary order', '1',
  pg_temp.q_as(pg_temp.f('cv'), format('select count(*)::text from public.patient_care_gaps where gap_type = ''awaiting_result'' and (detail ->> ''lab_order_id'')::uuid = %L', pg_temp.f('o_plain'))));
perform pg_temp.ck('patient_care_gaps: caregiver sees NO awaiting_result gap for the sensitive order', '0',
  pg_temp.q_as(pg_temp.f('cv'), format('select count(*)::text from public.patient_care_gaps where gap_type = ''awaiting_result'' and (detail ->> ''lab_order_id'')::uuid = %L', pg_temp.f('o_sens'))));
perform pg_temp.ck('patient_care_gaps: staff sees the sensitive order gap (control)', '1',
  pg_temp.q_as(pg_temp.f('adm'), format('select count(*)::text from public.patient_care_gaps where gap_type = ''awaiting_result'' and (detail ->> ''lab_order_id'')::uuid = %L', pg_temp.f('o_sens'))));

-- 3. already closed: patient or staff only -----------------------------------------------------------------------------------------------------------
perform pg_temp.ck('care_vouchers: the reproductive_health caregiver does NOT see the MIXED reproductive + HIV bundle voucher', 'no', pg_temp.sees(pg_temp.f('cr'), 'public.care_vouchers', 'id', pg_temp.f('v_mixed')));
perform pg_temp.ck('care_vouchers: the beneficiary still sees the mixed-bundle voucher', 'yes', pg_temp.sees(pg_temp.f('p'), 'public.care_vouchers', 'id', pg_temp.f('v_mixed')));
perform pg_temp.ck('care_voucher_category and the reproductive code list agree for every bundle (so the helper cannot drift)', '0',
  (select count(*)::text from public.panel_bundles b
    where (private.care_voucher_category(b.id) = 'reproductive_health')
          is distinct from (b.test_codes && array['cervical_smear', 'clinical_breast_exam', 'breast_imaging', 'prostate_ultrasound', 'psa']::text[])));
perform pg_temp.ck('patient_timeline: category caregiver sees the ordinary lab_abnormal event', 'yes', pg_temp.sees(pg_temp.f('cc'), 'public.patient_timeline', 'id', pg_temp.f('tl_abn_plain')));
perform pg_temp.ck('patient_timeline: category caregiver does NOT see the sensitive lab_abnormal event (it carries the order id and the result summary)', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.patient_timeline', 'id', pg_temp.f('tl_abn_sens')));
perform pg_temp.ck('patient_timeline: patient sees the sensitive lab_abnormal event', 'yes', pg_temp.sees(pg_temp.f('p'), 'public.patient_timeline', 'id', pg_temp.f('tl_abn_sens')));
perform pg_temp.ck('patient_timeline: emergency-access reader still sees the sensitive lab_abnormal event (unchanged)', 'yes', pg_temp.sees(pg_temp.f('em'), 'public.patient_timeline', 'id', pg_temp.f('tl_abn_sens')));
perform pg_temp.ck('screening_results: view_results caregiver sees the result of the ordinary order', 'yes', pg_temp.sees(pg_temp.f('cv'), 'public.screening_results', 'id', pg_temp.f('sr_plain')));
perform pg_temp.ck('screening_results: view_results caregiver does NOT see the result of the sensitive order', 'no', pg_temp.sees(pg_temp.f('cv'), 'public.screening_results', 'id', pg_temp.f('sr_sens')));
perform pg_temp.ck('screening_results: category caregiver sees the result of the ordinary order', 'yes', pg_temp.sees(pg_temp.f('cc'), 'public.screening_results', 'id', pg_temp.f('sr_plain')));
perform pg_temp.ck('screening_results: category caregiver does NOT see the result of the sensitive order', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.screening_results', 'id', pg_temp.f('sr_sens')));
perform pg_temp.ck('screening_results: patient sees the result of the sensitive order', 'yes', pg_temp.sees(pg_temp.f('p'), 'public.screening_results', 'id', pg_temp.f('sr_sens')));
perform pg_temp.ck('screening_results: emergency-access reader still sees the result of the sensitive order (unchanged)', 'yes', pg_temp.sees(pg_temp.f('em'), 'public.screening_results', 'id', pg_temp.f('sr_sens')));
perform pg_temp.ck('facility_ratings: book_appointments caregiver sees the rating for the ordinary order', 'yes', pg_temp.sees(pg_temp.f('cm'), 'public.facility_ratings', 'id', pg_temp.f('fr_plain')));
perform pg_temp.ck('facility_ratings: book_appointments caregiver does NOT see the rating for the sensitive order', 'no', pg_temp.sees(pg_temp.f('cm'), 'public.facility_ratings', 'id', pg_temp.f('fr_sens')));
perform pg_temp.ck('facility_ratings: patient sees the rating for the sensitive order', 'yes', pg_temp.sees(pg_temp.f('p'), 'public.facility_ratings', 'id', pg_temp.f('fr_sens')));
perform pg_temp.ck('lab_location_reviews: book_appointments caregiver sees the review for the ordinary order', 'yes', pg_temp.sees(pg_temp.f('cm'), 'public.lab_location_reviews', 'id', pg_temp.f('lr_plain')));
perform pg_temp.ck('lab_location_reviews: book_appointments caregiver does NOT see the review for the sensitive order', 'no', pg_temp.sees(pg_temp.f('cm'), 'public.lab_location_reviews', 'id', pg_temp.f('lr_sens')));
perform pg_temp.ck('lab_location_reviews: patient sees the review for the sensitive order', 'yes', pg_temp.sees(pg_temp.f('p'), 'public.lab_location_reviews', 'id', pg_temp.f('lr_sens')));
perform pg_temp.ck('lab_location_reviews: staff sees the review for the sensitive order', 'yes', pg_temp.sees(pg_temp.f('adm'), 'public.lab_location_reviews', 'id', pg_temp.f('lr_sens')));
perform pg_temp.ck('already closed (structural): no caregiver, support-view or category helper appears in any SELECT/ALL policy of lab_order_test_status, lab_result_documents, lab_order_refunds, lab_result_consult_requests, lab_turnaround_alerts, partner_statement_lines', '0',
  (select count(*)::text from pg_policies
    where schemaname = 'public' and tablename in ('lab_order_test_status', 'lab_result_documents', 'lab_order_refunds', 'lab_result_consult_requests', 'lab_turnaround_alerts', 'partner_statement_lines')
      and cmd in ('SELECT', 'ALL')
      and (qual ilike '%can_read_clinical%' or qual ilike '%can_act_for%' or qual ilike '%profile_access%' or qual ilike '%view_results%' or qual ilike '%can_support_view%')));
end $$;

-- 5. Sabotage: put the four policies back to their pre-migration text ------------------------------------------------------------------------------
do $$
begin
  drop policy lab_orders_select on public.lab_orders;
  create policy lab_orders_select on public.lab_orders for select to authenticated using (
    patient_id = (select auth.uid()) or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category)
    or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission));
  drop policy lab_specimens_select on public.lab_specimens;
  create policy lab_specimens_select on public.lab_specimens for select to authenticated using (
    patient_id = (select auth.uid()) or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
    or (provider_id is not null and provider_id = private.lab_partner_provider()));
  drop policy patient_timeline_select on public.patient_timeline;
  create policy patient_timeline_select on public.patient_timeline for select to authenticated using (
    patient_id = (select auth.uid())
    or private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category)
    or private.can_read_clinical(patient_id, event_category)
    or private.has_emergency_access(patient_id, event_category));
  drop policy care_vouchers_select on public.care_vouchers;
  create policy care_vouchers_select on public.care_vouchers for select to authenticated using (
    beneficiary_profile_id = (select auth.uid()) or purchaser_profile_id = (select auth.uid()) or private.is_org_staff(organisation_id)
    or private.can_read_clinical(beneficiary_profile_id, private.care_voucher_category(panel_bundle_id)));
  drop policy screening_results_select on public.screening_results;
  create policy screening_results_select on public.screening_results for select to authenticated using (
    private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category)
    or ((not private.patient_result_blocked(screen_type_code, result_status)) and (patient_id = (select auth.uid())
        or private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
        or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission))));
  drop policy facility_ratings_own on public.facility_ratings;
  create policy facility_ratings_own on public.facility_ratings for select to authenticated using (
    patient_id = (select auth.uid()) or private.can_act_for(patient_id, 'book_appointments'::public.caregiver_permission));
  drop policy lab_location_reviews_select on public.lab_location_reviews;
  create policy lab_location_reviews_select on public.lab_location_reviews for select to authenticated using (
    patient_id = (select auth.uid()) or private.can_act_for(patient_id, 'book_appointments'::public.caregiver_permission)
    or private.is_org_staff(organisation_id) or private.is_admin());
end $$;

do $$
begin
perform pg_temp.sab('sabotaged lab_orders: view_results caregiver sees the sensitive order', 'no', pg_temp.sees(pg_temp.f('cv'), 'public.lab_orders', 'id', pg_temp.f('o_sens')));
perform pg_temp.sab('sabotaged lab_orders: category caregiver sees the sensitive order', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.lab_orders', 'id', pg_temp.f('o_sens')));
perform pg_temp.sab('sabotaged lab_specimens: category caregiver sees the sensitive specimen', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.lab_specimens', 'id', pg_temp.f('sp_sens')));
perform pg_temp.sab('sabotaged patient_timeline: category caregiver sees the sensitive lab event', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.patient_timeline', 'id', pg_temp.f('tl_sens')));
perform pg_temp.sab('sabotaged care_vouchers: category caregiver sees the sensitive-bundle voucher', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.care_vouchers', 'id', pg_temp.f('v_sens')));
perform pg_temp.sab('sabotaged patient_timeline: category caregiver sees the sensitive lab_abnormal event', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.patient_timeline', 'id', pg_temp.f('tl_abn_sens')));
perform pg_temp.sab('sabotaged screening_results: category caregiver sees the result of the sensitive order', 'no', pg_temp.sees(pg_temp.f('cc'), 'public.screening_results', 'id', pg_temp.f('sr_sens')));
perform pg_temp.sab('sabotaged screening_results: view_results caregiver sees the result of the sensitive order', 'no', pg_temp.sees(pg_temp.f('cv'), 'public.screening_results', 'id', pg_temp.f('sr_sens')));
perform pg_temp.sab('sabotaged facility_ratings: caregiver sees the rating for the sensitive order', 'no', pg_temp.sees(pg_temp.f('cm'), 'public.facility_ratings', 'id', pg_temp.f('fr_sens')));
perform pg_temp.sab('sabotaged lab_location_reviews: caregiver sees the review for the sensitive order', 'no', pg_temp.sees(pg_temp.f('cm'), 'public.lab_location_reviews', 'id', pg_temp.f('lr_sens')));
perform pg_temp.sab('sabotaged care_vouchers: reproductive_health caregiver sees the mixed-bundle voucher', 'no', pg_temp.sees(pg_temp.f('cr'), 'public.care_vouchers', 'id', pg_temp.f('v_mixed')));
perform pg_temp.sab('sabotaged patient_care_gaps: caregiver sees the sensitive order gap', '0',
  pg_temp.q_as(pg_temp.f('cv'), format('select count(*)::text from public.patient_care_gaps where gap_type = ''awaiting_result'' and (detail ->> ''lab_order_id'')::uuid = %L', pg_temp.f('o_sens'))));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'OQ-S98-7 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 12 then raise exception 'VACUOUS TEST: the sabotage flipped % of 12 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above (they must) and are deliberately not printed: a printed sabotage row reads as FAIL to the runner.

rollback;
