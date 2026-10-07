-- S64 proof: consultation gaps (migrations *_s64a_pharmacist_appointment_type.sql and *_s64b_consultation_gaps.sql).
--
-- Proves in one rolled-back transaction:
--   1. care_role: a dietitian cannot sit on a doctor tier (so auto-assignment, prescribing and signing never reach one).
--   2. Per-item booking (Q23): a dietitian visit is refused while its product is unpriced; once priced, only a dietitian can be booked
--      for it and a doctor visit only with a doctor; a paid dietitian visit gets its encounter; the listing is empty while unpriced.
--   3. Booking filters and the licence display (Q19): specialty, language and sex filter the listing; the MDCN number and its
--      checked-on date appear only when a credential check is on record.
--   4. Terms before payment: my_booking_terms gives price, cancel window and refund basis 'credit' (never cash, OQ-133); an
--      unpriced type says so; an unknown type answers null; anon is refused.
--   5. Manual intake (15.3): a stranger cannot write one; a draft has no summary and the clinician sees nothing of it; send writes
--      the summary; the assigned clinician reads it and the read is audited; another clinician is refused; a sent intake cannot be
--      changed by anyone (not even the owner role); a symptom-checker row must cite its source.
--   6. Scribe sign-off (15.4): an AI-drafted note cannot be signed until the allergy and medicine lines are confirmed; confirmation is
--      refused for an untied doctor and for a note with no AI draft; any edit of the text clears it; an unchanged save does not; a note
--      without the scribe signs as before (the no-scribe path loses nothing).
--   7. Referral facility (15.6): a directory entry or typed text, never both; only an active listing; only the people who may work on
--      the referral; refused once signed.
--   8. Reminders: the 7 day milestone is sent for a visit booked 7 or more days ahead and not for a short-lead booking; the reminder
--      carries the confirm and cancel replies.
--   9. 15.5 delivery: a patient sees no draft note, no draft prescription and no proposed care plan change; only signed ones.
--  10. SABOTAGE: with the sign gate trigger disabled an unreviewed AI note signs; with the clear-on-edit trigger disabled an edit keeps
--      the confirmation; with the intake guard disabled a sent intake changes; with the product check removed a dietitian visit can be held
--      while unpriced. Each must flip, or the proof is vacuous.
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
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claims', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date, p_sex text default null) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's64-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, sex)
  values (v, p_org, p_role::public.user_role, 'S64 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), p_dob, true, p_sex::public.sex)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth,
    full_name = excluded.full_name, sex = excluded.sex;
  return v;
end $f$;
create function pg_temp.mkcredit(p_patient uuid, p_code text) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo, purchased_at)
  select pr.organisation_id, p_patient, sp.id, 'active', sp.price_kobo, 'NGN', 0, now()
    from public.profiles pr, public.service_products sp
   where pr.id = p_patient and sp.code = p_code
  returning id into v;
  return v;
end $f$;
create function pg_temp.open_time(p_clin uuid, p_start timestamptz) returns void language plpgsql as
$f$ declare v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_clin;
  if not exists (select 1 from public.availability_blocks where clinician_id = p_clin and kind = 'bookable_consultations' and state = 'confirmed' and is_test
                  and starts_at <= p_start and ends_at >= p_start + interval '30 minutes') then
    insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
    values (v_org, p_clin, p_start, p_start + interval '2 hours', 'bookable_consultations', 'confirmed', true);
  end if;
end $f$;
-- hold and confirm as the patient; returns the appointment id
create function pg_temp.book(p_patient uuid, p_clinician uuid, p_type text, p_start timestamptz) returns uuid language plpgsql as
$f$ declare v_org uuid; v_id uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  perform pg_temp.open_time(p_clinician, p_start);
  perform pg_temp.act(p_patient);
  select id into v_id from public.hold_appointment_slot(v_org, p_clinician, p_type::public.appointment_type, 'telemedicine', p_start, p_start + interval '30 minutes');
  perform public.confirm_appointment_booking(v_id);
  perform pg_temp.back();
  return v_id;
end $f$;
create function pg_temp.hold_state(p_patient uuid, p_clinician uuid, p_type text, p_start timestamptz) returns text language plpgsql as
$f$ declare v_org uuid; v text;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  perform pg_temp.open_time(p_clinician, p_start);
  perform pg_temp.act(p_patient);
  v := pg_temp.try(format('select public.hold_appointment_slot(%L, %L, %L::public.appointment_type, ''telemedicine'', %L, %L)',
                          v_org, p_clinician, p_type, p_start, p_start + interval '30 minutes'));
  perform pg_temp.back();
  return v;
end $f$;
create function pg_temp.try_msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
-- the open slots as a given patient sees them
create function pg_temp.slots_for(p_patient uuid, p_from timestamptz, p_to timestamptz, p_lang text, p_sex text, p_specialty text, p_role text) returns jsonb language plpgsql as
$f$ declare v jsonb;
begin
  perform pg_temp.act(p_patient);
  select public.list_bookable_consult_slots(p_from, p_to, p_lang, p_sex, p_patient, p_specialty, p_role) into v;
  perform pg_temp.back();
  return v;
end $f$;
-- how many of those slots belong to one clinician
create function pg_temp.slots_of(p_json jsonb, p_clin uuid) returns integer language sql as
$$ select count(*)::integer from jsonb_array_elements(p_json) x where (x ->> 'clinician_id')::uuid = p_clin $$;
-- reads a referral's facility columns as the owner (the acting clinician's RLS may not show a draft)
create function pg_temp.ref_facility(p_ref uuid, p_fac uuid) returns text language sql security definer as
$$ select coalesce((facility_id = p_fac)::text, 'null') || '/' || coalesce(facility_id::text, 'null') || '/' || coalesce(facility_name_text, 'null') from public.specialist_referrals where id = p_ref $$;
create function pg_temp.count_slots(p_patient uuid, p_from timestamptz, p_to timestamptz, p_args text) returns integer language plpgsql as
$f$ declare v jsonb;
begin
  perform pg_temp.act(p_patient);
  execute format('select public.list_bookable_consult_slots(%L, %L%s)', p_from, p_to, p_args) into v;
  perform pg_temp.back();
  return jsonb_array_length(v);
end $f$;

do $$
declare
  v_org uuid;
  v_admin uuid; v_docA uuid; v_docB uuid; v_diet uuid;
  v_pat uuid; v_pat2 uuid; v_stranger uuid;
  v_start timestamptz := date_trunc('hour', now()) + interval '3 days' + interval '9 hours';
  v_a_diet uuid; v_a_doc uuid; v_a_doc2 uuid; v_enc_doc uuid; v_enc_diet uuid;
  v_res text; v_json jsonb; v_summary text;
  v_n0 uuid; v_n1 uuid; v_n2 uuid; v_n3 uuid; v_c1 uuid; v_c3 uuid; v_fac uuid; v_fac2 uuid; v_ref uuid; v_staff_a uuid;
  v_cnt integer; v_ts timestamptz;
  v_pc uuid; v_pcu uuid; v_n4 uuid; v_c4 uuid; v_a_short uuid; v_ids jsonb;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;

  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', (current_date - interval '45 years')::date);
  v_docA := pg_temp.mkuser(v_org, 'doctor-a', 'clinician', (current_date - interval '40 years')::date, 'female');
  v_docB := pg_temp.mkuser(v_org, 'doctor-b', 'clinician', (current_date - interval '40 years')::date, 'male');
  v_diet := pg_temp.mkuser(v_org, 'dietitian', 'clinician', (current_date - interval '35 years')::date, 'female');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient', (current_date - interval '45 years')::date);
  v_pat2 := pg_temp.mkuser(v_org, 'patient-2', 'patient', (current_date - interval '30 years')::date);
  v_stranger := pg_temp.mkuser(v_org, 'stranger', 'patient', (current_date - interval '33 years')::date);

  update public.consultation_policy_config set config = config || '{"bookingLeadMinutes":5,"bookingHorizonDays":21}'::jsonb where is_active;

  -- doctor A: a recorded MDCN check; doctor B: none. The dietitian sits on the care_coordinator tier (the only tier a non-doctor role may hold).
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, languages, license_verified_at, license_expires_at, specialty,
                                     indemnity_exempt, indemnity_exempt_by, credential_type, credential_number, credential_verified_at, credential_verified_by, doctor_tier)
  values (v_org, v_docA, 'S64 doctor-a', true, true, array['en', 'fr'], now() - interval '10 days', now() + interval '1 year', 'General practice', true, v_admin,
          'MDCN', 'MDCN/S64-A', now() - interval '5 days', v_admin, 'senior_medical_officer'),
         (v_org, v_docB, 'S64 doctor-b', true, true, array['en'], now() - interval '3 days', now() + interval '1 year', 'Cardiology', true, v_admin,
          null, null, null, null, 'senior_medical_officer');

  -- ===== 1. care_role =====
  perform pg_temp.rec('a dietitian on a doctor tier is refused (23514)', '23514',
    pg_temp.try(format('insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, license_verified_at, care_role, doctor_tier)
                        values (%L, %L, ''S64 diet'', true, true, now(), ''dietitian'', ''senior_medical_officer'')', v_org, v_diet)));
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, languages, license_verified_at, license_expires_at, specialty, care_role, doctor_tier)
  values (v_org, v_diet, 'S64 dietitian', true, true, array['en'], now() - interval '2 days', now() + interval '1 year', 'Nutrition', 'dietitian', 'care_coordinator');
  perform pg_temp.rec('a dietitian on the care_coordinator tier is accepted', '1',
    (select count(*)::text from public.clinical_staff where profile_id = v_diet and care_role = 'dietitian'));

  -- ===== 4a. terms before anything is priced =====
  perform pg_temp.act(v_pat);
  select public.my_booking_terms('dietitian') into v_json;
  perform pg_temp.back();
  perform pg_temp.rec('unpriced dietitian visit: terms say it is not bookable and show no price', 'false/null',
    (v_json ->> 'bookable') || '/' || coalesce(v_json ->> 'price_kobo', 'null'));

  -- ===== 2a. unpriced: refused, and nothing is listed =====
  perform pg_temp.open_time(v_diet, v_start);
  perform pg_temp.rec('dietitian visit refused while the product is inactive and unpriced (P0001)', 'P0001', pg_temp.hold_state(v_pat, v_diet, 'dietitian', v_start));
  perform pg_temp.rec('the dietitian listing is empty while unpriced', '0',
    pg_temp.count_slots(v_pat, v_start - interval '1 hour', v_start + interval '2 days', ', null, null, null, null, ''dietitian''')::text);

  -- price it (owner action in this rolled-back transaction; in production the founder sets the price)
  update public.service_products set price_kobo = 500000, is_active = true where code = 'dietitian_consult_credit';

  -- ===== 4b. terms =====
  perform pg_temp.act(v_pat);
  select public.my_booking_terms('dietitian') into v_json;
  perform pg_temp.rec('priced dietitian visit: bookable at 500000 kobo, refund basis credit', 'true/500000/credit',
    (v_json ->> 'bookable') || '/' || (v_json ->> 'price_kobo') || '/' || (v_json ->> 'refund_basis'));
  select public.my_booking_terms('telemedicine') into v_json;
  perform pg_temp.rec('doctor visit terms: NGN 10,000, 2 hour window, credit basis', '1000000/2/credit',
    (v_json ->> 'price_kobo') || '/' || (v_json ->> 'cancel_window_hours') || '/' || (v_json ->> 'refund_basis'));
  perform pg_temp.rec('an unknown type answers null', 'null', coalesce((select public.my_booking_terms('bogus'))::text, 'null'));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot read terms', '42501', pg_temp.try('select public.my_booking_terms(''telemedicine'')'));
  perform pg_temp.back();

  -- ===== 2b. role matching and listing =====
  perform pg_temp.open_time(v_docA, v_start);
  perform pg_temp.open_time(v_docB, v_start);
  v_json := pg_temp.slots_for(v_pat, v_start - interval '1 hour', v_start + interval '3 hours', null, null, null, 'dietitian');
  perform pg_temp.rec('the dietitian listing now shows the dietitian, and neither doctor', 'true/0/0',
    (pg_temp.slots_of(v_json, v_diet) > 0)::text || '/' || pg_temp.slots_of(v_json, v_docA)::text || '/' || pg_temp.slots_of(v_json, v_docB)::text);
  v_json := pg_temp.slots_for(v_pat, v_start - interval '1 hour', v_start + interval '3 hours', null, null, null, 'doctor');
  perform pg_temp.rec('the doctor listing never shows the dietitian', '0', pg_temp.slots_of(v_json, v_diet)::text);
  perform pg_temp.rec('a dietitian visit with a doctor is refused (P0001)', 'P0001', pg_temp.hold_state(v_pat, v_docA, 'dietitian', v_start));
  perform pg_temp.rec('a doctor visit with the dietitian is refused (P0001)', 'P0001', pg_temp.hold_state(v_pat, v_diet, 'telemedicine', v_start));

  -- ===== 3. filters and licence display =====
  v_json := pg_temp.slots_for(v_pat, v_start - interval '1 hour', v_start + interval '3 hours', null, null, 'cardiology', 'doctor');
  perform pg_temp.rec('specialty filter: cardiology shows doctor B only', 'false/true', (pg_temp.slots_of(v_json, v_docA) > 0)::text || '/' || (pg_temp.slots_of(v_json, v_docB) > 0)::text);
  v_json := pg_temp.slots_for(v_pat, v_start - interval '1 hour', v_start + interval '3 hours', null, 'female', null, 'doctor');
  perform pg_temp.rec('sex filter: female shows doctor A only', 'true/false', (pg_temp.slots_of(v_json, v_docA) > 0)::text || '/' || (pg_temp.slots_of(v_json, v_docB) > 0)::text);
  v_json := pg_temp.slots_for(v_pat, v_start - interval '1 hour', v_start + interval '3 hours', 'fr', null, null, 'doctor');
  perform pg_temp.rec('language filter: fr shows doctor A only', 'true/false', (pg_temp.slots_of(v_json, v_docA) > 0)::text || '/' || (pg_temp.slots_of(v_json, v_docB) > 0)::text);
  v_json := pg_temp.slots_for(v_pat, v_start - interval '1 hour', v_start + interval '3 hours', null, null, null, 'doctor');
  select (x ->> 'mdcn_number') || '/' || ((x ->> 'licence_checked_on') is not null)::text into v_res
    from jsonb_array_elements(v_json) x where (x ->> 'clinician_id')::uuid = v_docA limit 1;
  perform pg_temp.rec('MDCN number shown with its checked-on date when a check is on record', 'MDCN/S64-A/true', v_res);
  select coalesce(x ->> 'mdcn_number', 'null') || '/' || coalesce(x ->> 'licence_checked_on', 'null') into v_res
    from jsonb_array_elements(v_json) x where (x ->> 'clinician_id')::uuid = v_docB limit 1;
  perform pg_temp.rec('no MDCN number and no date when no check is on record (null-gated)', 'null/null', v_res);

  -- ===== 2c. a paid dietitian visit becomes a consultation with an encounter =====
  perform pg_temp.mkcredit(v_pat, 'dietitian_consult_credit');
  v_a_diet := pg_temp.book(v_pat, v_diet, 'dietitian', v_start + interval '30 minutes');
  perform pg_temp.rec('a dietitian visit paid with its credit is confirmed and has an encounter', 'confirmed/paid/1',
    (select a.status::text || '/' || a.payment_status::text || '/' || (select count(*)::text from public.encounters e where e.appointment_id = a.id)
       from public.appointments a where a.id = v_a_diet));

  -- ===== 5. intake =====
  perform pg_temp.mkcredit(v_pat, 'video_visit_credit');
  v_a_doc := pg_temp.book(v_pat, v_docA, 'telemedicine', v_start + interval '60 minutes');
  select id into v_enc_doc from public.encounters where appointment_id = v_a_doc;

  perform pg_temp.act(v_stranger);
  perform pg_temp.rec('a stranger cannot save an intake for someone else''s visit (42501)', '42501',
    pg_temp.try(format('select public.save_consultation_intake_draft(%L, ''x'', ''today'', ''{}''::jsonb)', v_a_doc)));
  perform pg_temp.back();

  perform pg_temp.act(v_pat);
  perform public.save_consultation_intake_draft(v_a_doc, 'Headaches in the evening', null, '{"allergies":"None known"}'::jsonb);
  perform pg_temp.rec('sending an intake without a duration is refused (P0001)', 'P0001', pg_temp.try(format('select public.send_consultation_intake(%L)', v_a_doc)));
  perform pg_temp.rec('an answer key outside the fixed set is refused (22023)', '22023',
    pg_temp.try(format('select public.save_consultation_intake_draft(%L, ''x'', ''today'', ''{"diagnosis":"y"}''::jsonb)', v_a_doc)));
  perform public.save_consultation_intake_draft(v_a_doc, 'Headaches in the evening', 'few_days', '{"allergies":"None known","main_worry":"My blood pressure"}'::jsonb);
  perform pg_temp.back();

  perform pg_temp.rec('a draft has no summary', 'draft/null',
    (select i.state || '/' || coalesce(i.summary, 'null') from public.consultation_intakes i where i.appointment_id = v_a_doc));

  perform pg_temp.act(v_docA);
  select coalesce(public.clinician_consultation_intake(v_enc_doc)::text, 'null') into v_res;
  perform pg_temp.back();
  perform pg_temp.rec('the clinician sees nothing of a draft intake', 'null', v_res);

  perform pg_temp.act(v_pat);
  select public.send_consultation_intake(v_a_doc) into v_summary;
  perform pg_temp.back();
  perform pg_temp.rec('send writes a plain-code summary from the patient''s own words', 'true',
    (v_summary like 'Reason for the visit: Headaches in the evening%' and v_summary like '%For how long: a few days%' and v_summary like '%Allergies: None known%')::text);
  perform pg_temp.rec('the stored row is sent with the summary and a send time', 'sent/true',
    (select i.state || '/' || (i.summary is not null and i.sent_at is not null)::text from public.consultation_intakes i where i.appointment_id = v_a_doc));

  select count(*) into v_cnt from public.audit_log where action = 'consultation_intake.clinician_read' and subject_patient_id = v_pat;
  perform pg_temp.act(v_docA);
  select public.clinician_consultation_intake(v_enc_doc) into v_json;
  perform pg_temp.back();
  perform pg_temp.rec('the assigned clinician reads the sent intake', 'true', ((v_json ->> 'summary') = v_summary)::text);
  perform pg_temp.rec('that read is audited exactly once', '1',
    ((select count(*) from public.audit_log where action = 'consultation_intake.clinician_read' and subject_patient_id = v_pat) - v_cnt)::text);

  perform pg_temp.act(v_docB);
  perform pg_temp.rec('another clinician is refused (42501)', '42501', pg_temp.try(format('select public.clinician_consultation_intake(%L)', v_enc_doc)));
  perform pg_temp.back();

  perform pg_temp.act(v_stranger);
  select count(*)::text into v_res from public.consultation_intakes;
  perform pg_temp.back();
  perform pg_temp.rec('a stranger reads no intake rows', '0', v_res);
  perform pg_temp.act(v_pat);
  select count(*)::text into v_res from public.consultation_intakes;
  perform pg_temp.rec('the patient reads their own', '1', v_res);
  perform pg_temp.rec('the patient cannot update the table directly (42501)', '42501', pg_temp.try('update public.consultation_intakes set reason = ''edited'''));
  perform pg_temp.rec('the patient cannot save again after sending (P0001)', 'P0001',
    pg_temp.try(format('select public.save_consultation_intake_draft(%L, ''new'', ''today'', ''{}''::jsonb)', v_a_doc)));
  perform pg_temp.back();
  perform pg_temp.rec('even the owner role cannot change a sent intake (42501)', '42501',
    pg_temp.try(format('update public.consultation_intakes set reason = ''edited'' where appointment_id = %L', v_a_doc)));
  perform pg_temp.rec('a symptom-checker row must cite its source (23514)', '23514',
    pg_temp.try(format('insert into public.consultation_intakes (organisation_id, patient_id, appointment_id, source) values (%L, %L, %L, ''symptom_checker'')', v_org, v_pat, v_a_diet)));
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot call the intake functions', '42501', pg_temp.try(format('select public.send_consultation_intake(%L)', v_a_doc)));
  perform pg_temp.back();

  -- ===== 8. reminders =====
  -- two visits for patient 2, both 6 days away when the job runs: one was booked 11 days ahead (long lead), one just now (short lead)
  perform pg_temp.mkcredit(v_pat2, 'video_visit_credit');
  perform pg_temp.mkcredit(v_pat2, 'video_visit_credit');
  v_a_doc2 := pg_temp.book(v_pat2, v_docB, 'telemedicine', v_start + interval '5 days');
  v_a_short := pg_temp.book(v_pat2, v_docB, 'telemedicine', v_start + interval '5 days' + interval '60 minutes');
  update public.appointments set created_at = now() - interval '5 days', scheduled_for = now() + interval '165 hours', ends_at = now() + interval '165 hours 30 minutes'
   where id = v_a_doc2;
  update public.appointments set scheduled_for = now() + interval '167 hours' + interval '30 minutes', ends_at = now() + interval '168 hours'
   where id = v_a_short;
  -- a long-ago booking that is now only 2 hours away (what the first run after a deploy or a cron outage would see)
  update public.appointments set created_at = now() - interval '30 days', scheduled_for = now() + interval '2 hours', ends_at = now() + interval '2 hours 30 minutes'
   where id = v_a_diet;
  perform private.queue_appointment_reminders();
  perform pg_temp.rec('the 7 day reminder is sent for the visit booked 7 or more days ahead', '1',
    (select count(*)::text from public.appointment_reminder_sends where appointment_id = v_a_doc2 and milestone = '7d'));
  perform pg_temp.rec('and not for a visit booked long ago that is now only hours away (no stale reminder after a deploy)', '0',
    (select count(*)::text from public.appointment_reminder_sends where appointment_id = v_a_diet and milestone = '7d'));
  perform pg_temp.rec('and not for the short-lead booking', '0',
    (select count(*)::text from public.appointment_reminder_sends where appointment_id = v_a_short and milestone = '7d'));
  perform pg_temp.rec('the reminder offers the confirm and cancel replies and names no clinical term', 'true/true/false',
    (select (n.response_options @> '[{"value":"confirm"}]'::jsonb)::text || '/' || (n.response_options @> '[{"value":"cancel"}]'::jsonb)::text || '/' ||
            (n.payload::text ~* '(diabet|hyperten|pressure|result|glucose|cancer|hiv|pregnan)')::text
       from public.notifications n where n.template = 'appointment_reminder' and n.payload ->> 'appointment_id' = v_a_doc2::text and n.payload ->> 'milestone' = '7d' limit 1));
  perform private.queue_appointment_reminders();
  perform pg_temp.rec('running the job again sends nothing twice', '1',
    (select count(*)::text from public.appointment_reminder_sends where appointment_id = v_a_doc2 and milestone = '7d'));

  -- ===== 6. scribe sign-off =====
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_docA, now()) on conflict (patient_id) do update set clinician_id = v_docA;
  perform pg_temp.act(v_docA);
  select public.create_encounter_note(v_pat, 'phone', 'S64 no scribe') into v_n0;
  select public.create_encounter_note(v_pat, 'phone', 'S64 ai note') into v_n1;
  select public.create_encounter_note(v_pat, 'phone', 'S64 plain draft') into v_n2;
  select public.create_encounter_note(v_pat, 'phone', 'S64 ai note 3') into v_n3;
  select public.create_encounter_note(v_pat, 'phone', 'S64 ai note 4') into v_n4;
  perform pg_temp.back();

  -- consent rows written the way s23c writes them (S21g needs the patient's in-app answer for a live consultation; this proof is about the sign gate)
  execute 'alter table public.scribe_consents disable trigger scribe_consents_require_patient_answer';
  perform pg_temp.act(v_docA);
  insert into public.scribe_consents (patient_id, encounter_note_id, granted, language) values (v_pat, v_n1, true, 'en-NG') returning id into v_c1;
  insert into public.scribe_consents (patient_id, encounter_note_id, granted, language) values (v_pat, v_n3, true, 'en-NG') returning id into v_c3;
  insert into public.scribe_consents (patient_id, encounter_note_id, granted, language) values (v_pat, v_n4, true, 'en-NG') returning id into v_c4;
  perform pg_temp.back();
  execute 'alter table public.scribe_consents enable trigger scribe_consents_require_patient_answer';

  -- the no-scribe path: a note with no AI draft signs exactly as before
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('a note written without the scribe signs with no review step', 'ok',
    pg_temp.try(format('select public.finalize_encounter_note(%L, ''reassurance'', true)', v_n0)));
  perform pg_temp.rec('confirming safety lines on a note with no AI draft is refused (P0001)', 'P0001',
    pg_temp.try(format('select public.confirm_scribe_safety_lines(%L)', v_n2)));
  perform public.attach_scribe_draft_to_note(v_n1, v_c1, 'Rest and drink water.', 'en-NG');
  perform public.update_encounter_note_draft(v_n1, '{"plan":"Start amlodipine 5 mg daily","history":"No known allergies"}'::jsonb);
  select pg_temp.try_msg(format('select public.finalize_encounter_note(%L, ''reassurance'', true)', v_n1)) into v_res;
  perform pg_temp.back();
  perform pg_temp.rec('an AI-drafted note cannot be signed before the safety lines are confirmed (42501, says why)', '42501/true',
    left(v_res, 5) || '/' || (v_res like '%allergy and medicine%')::text);
  perform pg_temp.act(v_docB);
  perform pg_temp.rec('an untied doctor cannot confirm the lines (42501)', '42501', pg_temp.try(format('select public.confirm_scribe_safety_lines(%L)', v_n1)));
  perform pg_temp.back();
  perform pg_temp.act(v_docA);
  perform public.confirm_scribe_safety_lines(v_n1);
  perform pg_temp.back();
  perform pg_temp.rec('after confirming, the review is recorded with who and when', 'true',
    (select (safety_lines_reviewed_at is not null and safety_lines_reviewed_by = v_docA)::text from public.clinical_encounter_notes where id = v_n1));
  perform pg_temp.rec('and the confirmation is in the audit log', '1',
    (select count(*)::text from public.audit_log where action = 'scribe.safety_lines_reviewed' and event ->> 'note_id' = v_n1::text));
  perform pg_temp.act(v_docA);
  perform public.update_encounter_note_draft(v_n1, '{"plan":"Start amlodipine 10 mg daily"}'::jsonb);
  perform pg_temp.back();
  perform pg_temp.rec('editing the text clears the confirmation', 'null',
    (select coalesce(safety_lines_reviewed_at::text, 'null') from public.clinical_encounter_notes where id = v_n1));
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('so the edited note cannot be signed (42501)', '42501', pg_temp.try(format('select public.finalize_encounter_note(%L, ''reassurance'', true)', v_n1)));
  perform public.confirm_scribe_safety_lines(v_n1);
  perform pg_temp.rec('confirmed again, it signs', 'ok', pg_temp.try(format('select public.finalize_encounter_note(%L, ''reassurance'', true)', v_n1)));
  perform pg_temp.rec('a signed note cannot have its lines confirmed again (42501)', '42501', pg_temp.try(format('select public.confirm_scribe_safety_lines(%L)', v_n1)));
  perform pg_temp.back();

  -- an unchanged save does not clear it
  perform pg_temp.act(v_docA);
  perform public.attach_scribe_draft_to_note(v_n3, v_c3, 'Rest.', 'en-NG');
  perform public.update_encounter_note_draft(v_n3, '{"plan":"Rest"}'::jsonb);
  perform public.confirm_scribe_safety_lines(v_n3);
  perform public.update_encounter_note_draft(v_n3, '{"plan":"Rest"}'::jsonb);
  perform pg_temp.back();
  perform pg_temp.rec('a save that changes nothing keeps the confirmation', 'true',
    (select (safety_lines_reviewed_at is not null)::text from public.clinical_encounter_notes where id = v_n3));

  -- ===== 7. referral facility =====
  select id into v_staff_a from public.clinical_staff where profile_id = v_docA;
  perform pg_temp.act(v_docA);
  select public.create_specialist_referral(v_pat, 'cardiology', 'clinician_initiated', 'routine', 'S64 proof', null, '{}'::jsonb, true) into v_ref;  -- a draft is unsigned; submitting it signs it
  perform pg_temp.back();
  insert into public.facilities (name, type, state, city) values ('S64 Heart Centre', 'hospital', 'Lagos', 'Ikeja') returning id into v_fac;
  insert into public.facilities (name, type, state, city, is_active) values ('S64 Closed Clinic', 'hospital', 'Lagos', 'Ikeja', false) returning id into v_fac2;
  perform pg_temp.act(v_docA);
  perform public.set_referral_facility(v_ref, v_fac, null);
  perform pg_temp.rec('a directory facility is stored', 'true/' || v_fac || '/null', pg_temp.ref_facility(v_ref, v_fac));
  perform pg_temp.rec('a directory entry and typed text together are refused (22023)', '22023',
    pg_temp.try(format('select public.set_referral_facility(%L, %L, ''Typed'')', v_ref, v_fac)));
  perform pg_temp.rec('an unknown facility is refused (P0002)', 'P0002', pg_temp.try(format('select public.set_referral_facility(%L, %L, null)', v_ref, gen_random_uuid())));
  perform pg_temp.rec('an inactive listing is refused (P0002)', 'P0002', pg_temp.try(format('select public.set_referral_facility(%L, %L, null)', v_ref, v_fac2)));
  perform public.set_referral_facility(v_ref, null, '  Mercy Clinic  ');
  perform pg_temp.rec('typed text is the fallback and clears the directory link', 'null/null/Mercy Clinic', pg_temp.ref_facility(v_ref, v_fac));
  perform pg_temp.back();
  perform pg_temp.rec('the table refuses both forms at once (23514)', '23514',
    pg_temp.try(format('update public.specialist_referrals set facility_id = %L, facility_name_text = ''x'' where id = %L', v_fac, v_ref)));
  perform pg_temp.act(v_docB);
  perform pg_temp.rec('a clinician who may not work on the referral is refused (42501)', '42501', pg_temp.try(format('select public.set_referral_facility(%L, %L, null)', v_ref, v_fac)));
  perform pg_temp.back();
  perform pg_temp.act(v_stranger);
  perform pg_temp.rec('a patient cannot set it (42501)', '42501', pg_temp.try(format('select public.set_referral_facility(%L, %L, null)', v_ref, v_fac)));
  perform pg_temp.back();
  perform pg_temp.act(v_docA);
  perform public.submit_draft_referral(v_ref, now());  -- submitting signs the referral (stamp trigger)
  perform pg_temp.back();
  perform pg_temp.rec('submitting the referral signs it', 'true', (select (signed_at is not null)::text from public.specialist_referrals where id = v_ref));
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('a signed referral cannot be changed (42501)', '42501', pg_temp.try(format('select public.set_referral_facility(%L, %L, null)', v_ref, v_fac)));
  perform pg_temp.back();

  -- ===== 9. delivery to the patient: signed only =====
  perform pg_temp.act(v_pat);
  select public.my_note_index() into v_json;
  select coalesce(jsonb_agg(x ->> 'id'), '[]'::jsonb) into v_ids from jsonb_array_elements(v_json) x;
  perform pg_temp.rec('the patient''s note index shows the signed note and no draft', 'true/false',
    (v_ids ? v_n1::text)::text || '/' || (v_ids ? v_n2::text)::text);
  select coalesce(jsonb_agg(x ->> 'id'), '[]'::jsonb) into v_ids from jsonb_array_elements(public.my_released_notes()) x;
  perform pg_temp.rec('my_released_notes never contains a draft', 'false/false', (v_ids ? v_n2::text)::text || '/' || (v_ids ? v_n3::text)::text);
  perform pg_temp.back();
  insert into public.prescriptions (organisation_id, patient_id) values (v_org, v_pat);
  insert into public.care_plan_changes (organisation_id, patient_id, kind, proposed_by, proposal, rationale)
  values (v_org, v_pat, 'target', 'clinician', '{"target_ranges":{}}'::jsonb, 'S64 proof');
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('the patient sees no draft prescription', '0', (select count(*)::text from public.prescriptions));
  perform pg_temp.rec('the patient sees no proposed care plan change', '0', (select jsonb_array_length(public.my_care_plan_changes())::text));
  perform pg_temp.back();

  -- ===== 10. SABOTAGE: each guard removed must let the bad thing through =====
  execute 'alter table public.clinical_encounter_notes disable trigger clinical_encounter_notes_scribe_safety_gate';
  perform pg_temp.act(v_docA);
  perform public.update_encounter_note_draft(v_n3, '{"plan":"Rest more"}'::jsonb);  -- the edit clears the confirmation
  perform pg_temp.rec('SABOTAGE sign gate off: an unreviewed AI note signs (so the real test discriminates)', 'ok',
    pg_temp.try(format('select public.finalize_encounter_note(%L, ''reassurance'', true)', v_n3)));
  perform pg_temp.back();
  execute 'alter table public.clinical_encounter_notes enable trigger clinical_encounter_notes_scribe_safety_gate';

  perform pg_temp.act(v_docA);
  perform public.attach_scribe_draft_to_note(v_n4, v_c4, 'Rest.', 'en-NG');
  perform public.confirm_scribe_safety_lines(v_n4);
  perform pg_temp.back();
  execute 'alter table public.clinical_encounter_notes disable trigger clinical_encounter_notes_clear_safety_review';
  perform pg_temp.act(v_docA);
  perform public.update_encounter_note_draft(v_n4, '{"plan":"Metformin 500 mg twice daily"}'::jsonb);
  perform pg_temp.back();
  perform pg_temp.rec('SABOTAGE clear-on-edit off: an edit keeps the confirmation', 'true',
    (select (safety_lines_reviewed_at is not null)::text from public.clinical_encounter_notes where id = v_n4));
  execute 'alter table public.clinical_encounter_notes enable trigger clinical_encounter_notes_clear_safety_review';

  execute 'alter table public.consultation_intakes disable trigger consultation_intakes_guard';
  update public.consultation_intakes set reason = 'edited by sabotage' where appointment_id = v_a_doc;
  perform pg_temp.rec('SABOTAGE intake guard off: a sent intake changes', 'edited by sabotage',
    (select reason from public.consultation_intakes where appointment_id = v_a_doc));
  execute 'alter table public.consultation_intakes enable trigger consultation_intakes_guard';

  update public.service_products set price_kobo = 0, is_active = false where code = 'pharmacist_consult_credit';
  v_pcu := pg_temp.mkuser(v_org, 'pharmacist', 'clinician', (current_date - interval '36 years')::date, 'male');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, languages, license_verified_at, license_expires_at, care_role, doctor_tier)
  values (v_org, v_pcu, 'S64 pharmacist', true, true, array['en'], now() - interval '1 day', now() + interval '1 year', 'pharmacist', 'care_coordinator');
  v_pc := v_pcu;
  perform pg_temp.rec('a pharmacist visit is refused while its product is unpriced (P0001)', 'P0001', pg_temp.hold_state(v_pat2, v_pc, 'pharmacist', v_start + interval '8 days'));
  update public.service_products set price_kobo = 300000, is_active = true where code = 'pharmacist_consult_credit';
  perform pg_temp.rec('SABOTAGE product check satisfied: the same pharmacist visit now holds (so the refusal above was the product check)', 'ok',
    pg_temp.hold_state(v_pat2, v_pc, 'pharmacist', v_start + interval '8 days'));

  -- ===== verdict =====
  if exists (select 1 from results where expected is distinct from actual) then
    raise exception 'S64 proof FAILED: %', (select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', E'\n') from results where expected is distinct from actual);
  end if;
  raise notice 'S64 consultation gaps: % checks PASSED', (select count(*) from results);
end $$;

select check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict from results order by 1;

rollback;
