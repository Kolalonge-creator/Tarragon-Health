-- S37 proof: go-live guards (INV-14) and PROPOSED-config sign-off (migration *_s37_go_live_guards.sql).
--
-- Proves in one rolled-back transaction:
--   1. Shape: eight guards (seven from S37 plus symptom_checker_enabled from F1), all off; RLS on; nobody but the functions can write any of the four tables; anon has no
--      access and no execute; the reader is closed for an unknown key.
--   2. A guard cannot be changed directly, by ANY role including the table owner that runs migrations; the logs are
--      append-only for the owner too.
--   3. The switch: a patient, anon, a non-CMO clinician, the wrong role for the guard, a missing note and an unmet
--      condition are all refused; an attestation can only be written for a condition the data cannot see; with every
--      condition met the right person switches it on, the log records who and why, and a bare update is still refused.
--      Switching off is always allowed and is logged; a repeat is a no-op.
--   4. The real condition set for clinical_operations_enabled (approved protocol, approved rule set, an active tier 2
--      clinician): each missing piece blocks the switch; with all three it switches on.
--   5. The wiring: with the guard off a real patient cannot hold a consultation and a real encounter room is neither
--      joinable nor described; a test patient with a test clinician still can (so test accounts exercise the flow);
--      with the guard on a real booking gets past the guard and a hold made earlier can be confirmed; switching it off
--      closes confirmation again. The scribe start check follows scribe_enabled.
--   6. PROPOSED-config sign-off: only the value's owner records it, a bad hash is refused, the newest decision wins, and
--      the record is append-only.
--   7. SABOTAGE: with the reader forced open a real patient gets through; with the guard trigger dropped the owner can
--      switch a guard on directly. Both matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
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
  -- clear the session claims too: a leftover sub makes auth.uid() non-null and the is_test guard then treats the owner as a person
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.act_service() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's37-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S37 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  if not p_test then update public.profiles set is_test = false where id = v; end if;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S37 ' || p_label, 'MDCN', 'S37-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      true, p_admin, true, array['en'], 'General practice')
  returning id into v_staff;
  return v;
end $f$;
create function pg_temp.mkcredit(p_patient uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo, purchased_at)
  select pr.organisation_id, p_patient, sp.id, 'active', sp.price_kobo, 'NGN', 0, now()
    from public.profiles pr, public.service_products sp
   where pr.id = p_patient and sp.code = 'video_visit_credit'
  returning id into v;
  return v;
end $f$;
create function pg_temp.open_time(p_clin uuid, p_start timestamptz) returns void language plpgsql as
$f$ declare v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_clin;
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
  values (v_org, p_clin, p_start, p_start + interval '2 hours', 'bookable_consultations', 'confirmed', true);
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_smo uuid; v_pat uuid; v_real uuid; v_realdoc uuid; v_tp uuid; v_td uuid;
  v_start timestamptz := date_trunc('hour', now()) + interval '3 days' + interval '9 hours';
  v_appt uuid; v_enc uuid; v_tp2 uuid; v_req uuid; v_txt text; v_view jsonb; v_status jsonb; v_cr uuid; v_n integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;   -- deterministic: no real tier 2 clinician counts
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_smo := pg_temp.mkdoc(v_org, v_admin, 'smo', 'senior_medical_officer');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  -- deterministic start whatever production holds today: no approved blood pressure rule set and no approved hypertension protocol
  update public.triage_rule_sets set status = 'retired' where code = 'bp_care_triage' and status = 'approved';
  update public.protocols set status = 'retired' where status = 'approved' and code ~ '^(htn|hypertension)';
  update public.consultation_policy_config set config = config || '{"bookingLeadMinutes":5,"bookingHorizonDays":21}'::jsonb where is_active;

  -- 1. Shape ----------------------------------------------------------------------------------------------------
  perform pg_temp.rec('eight guards exist (F1 added symptom_checker_enabled)', '8', (select count(*)::text from public.go_live_guards));
  perform pg_temp.rec('every guard ships off', '0', (select count(*)::text from public.go_live_guards where is_on));
  perform pg_temp.rec('RLS is on for all four tables', '4', (select count(*)::text from pg_class where oid in ('public.go_live_guards'::regclass, 'public.go_live_guard_log'::regclass, 'public.go_live_attestations'::regclass, 'public.proposed_config_signoffs'::regclass) and relrowsecurity));
  perform pg_temp.rec('authenticated cannot write any of the four tables', '0',
    (select count(*)::text from unnest(array['public.go_live_guards', 'public.go_live_guard_log', 'public.go_live_attestations', 'public.proposed_config_signoffs']) t
      where has_table_privilege('authenticated', t, 'INSERT') or has_table_privilege('authenticated', t, 'UPDATE') or has_table_privilege('authenticated', t, 'DELETE')));
  perform pg_temp.rec('anon cannot read any of the four tables', '0',
    (select count(*)::text from unnest(array['public.go_live_guards', 'public.go_live_guard_log', 'public.go_live_attestations', 'public.proposed_config_signoffs']) t where has_table_privilege('anon', t, 'SELECT')));
  perform pg_temp.rec('anon cannot execute any new public function', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('set_go_live_guard', 'attest_go_live_condition', 'go_live_guard_status', 'go_live_guard_is_open', 'record_proposed_config_signoff', 'proposed_config_signoffs_current')
        and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.rec('anon cannot execute the private reader', 'false', has_function_privilege('anon', 'private.go_live_open(text,uuid,uuid)', 'EXECUTE')::text);
  perform pg_temp.rec('an unknown guard reads closed', 'false', private.go_live_open('no_such_guard')::text);
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a signed-in person can read the guards', '8', (select count(*)::text from public.go_live_guards));
  perform pg_temp.back();

  -- 2. No direct change, by anyone ------------------------------------------------------------------------------
  perform pg_temp.rec('the table owner cannot switch a guard on directly', '42501', pg_temp.try('update public.go_live_guards set is_on = true where key = ''payouts_enabled'''));
  perform pg_temp.rec('the table owner cannot edit a guard note directly', '42501', pg_temp.try('update public.go_live_guards set change_note = ''x'' where key = ''payouts_enabled'''));
  perform pg_temp.rec('the table owner cannot delete a guard', '42501', pg_temp.try('delete from public.go_live_guards where key = ''payouts_enabled'''));
  perform pg_temp.rec('the table owner cannot truncate the guards', '42501', pg_temp.try('truncate public.go_live_guards cascade'));
  perform pg_temp.rec('a guard cannot be created switched on', '42501',
    pg_temp.try(format('insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, is_on, changed_at, changed_by, change_note) values (''born_on'', ''x'', ''x'', ''x'', ''admin'', true, now(), %L, ''x'')', v_admin)));
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin session cannot update the guard table', '42501', pg_temp.try('update public.go_live_guards set is_on = true where key = ''payouts_enabled'''));
  perform pg_temp.rec('...nor insert into the log', '42501', pg_temp.try(format('insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note) values (''payouts_enabled'', ''switched_on'', %L, ''admin'', ''x'')', v_admin)));
  perform pg_temp.back();
  perform pg_temp.rec('the guard still reads off', 'false', private.go_live_open('payouts_enabled')::text);

  -- 3. The switch -----------------------------------------------------------------------------------------------
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a patient cannot switch a guard', '42501', pg_temp.try('select public.set_go_live_guard(''payouts_enabled'', true, ''let me'')'));
  perform pg_temp.rec('a patient cannot read the dashboard', '42501', pg_temp.try('select public.go_live_guard_status()'));
  perform pg_temp.rec('a patient cannot read the log', '0', (select count(*)::text from public.go_live_guard_log));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot switch a guard', '42501', pg_temp.try('select public.set_go_live_guard(''payouts_enabled'', true, ''let me'')'));
  perform pg_temp.back();
  perform pg_temp.act(v_smo);
  perform pg_temp.rec('a clinician who is not the CMO cannot switch a guard', '42501', pg_temp.try('select public.set_go_live_guard(''payouts_enabled'', true, ''let me'')'));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the CMO cannot switch on an admin guard', '42501', pg_temp.try('select public.set_go_live_guard(''payouts_enabled'', true, ''my turn'')'));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot switch on the CMO guard (prescribing)', '42501', pg_temp.try('select public.set_go_live_guard(''prescribing_enabled'', true, ''my turn'')'));
  perform pg_temp.rec('an unknown guard is refused', '22023', pg_temp.try('select public.set_go_live_guard(''nope'', true, ''x'')'));
  perform pg_temp.rec('switching on needs a note', '22023', pg_temp.try('select public.set_go_live_guard(''payouts_enabled'', true, '' '')'));
  v_txt := pg_temp.msg('select public.set_go_live_guard(''payouts_enabled'', true, ''ready'')');
  perform pg_temp.rec('an unmet condition blocks the switch and names what is missing', 'true',
    (v_txt like '22023:%not yet met%A fee schedule is approved%Paystack transfers are configured%')::text);
  perform pg_temp.rec('a condition read from the data cannot be attested', '22023',
    pg_temp.try('select public.attest_go_live_condition(''prescribing_enabled'', ''pharmacy_partner_active'', true, ''I promise there is one'')'));
  perform pg_temp.rec('an attestation needs a sentence', '22023', pg_temp.try('select public.attest_go_live_condition(''payouts_enabled'', ''fee_schedule_approved'', true, ''ok'')'));
  perform pg_temp.rec('an unknown condition code is refused', '22023', pg_temp.try('select public.attest_go_live_condition(''payouts_enabled'', ''made_up'', true, ''I checked this one'')'));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a patient cannot attest', '42501', pg_temp.try('select public.attest_go_live_condition(''payouts_enabled'', ''fee_schedule_approved'', true, ''I checked this one'')'));
  perform pg_temp.back();
  perform pg_temp.rec('nothing was attested yet', '0', (select count(*)::text from public.go_live_attestations));
  perform pg_temp.rec('the guard is still off', 'false', private.go_live_open('payouts_enabled')::text);

  perform pg_temp.act(v_admin);
  perform public.attest_go_live_condition('payouts_enabled', 'fee_schedule_approved', true, 'Fee schedule v1 approved by the founder in the console.');
  perform pg_temp.rec('one of two conditions met still blocks the switch', '22023', pg_temp.try('select public.set_go_live_guard(''payouts_enabled'', true, ''ready'')'));
  perform public.attest_go_live_condition('payouts_enabled', 'paystack_transfers_configured', true, 'Transfers enabled on the Paystack account, test transfer sent.');
  v_status := public.go_live_guard_status();
  perform pg_temp.rec('the dashboard now shows payouts all met', 'true',
    (select (g ->> 'all_met')::text from jsonb_array_elements(v_status) g where g ->> 'key' = 'payouts_enabled'));
  perform pg_temp.rec('...and the dashboard lists eight guards', '8', jsonb_array_length(v_status)::text);
  perform pg_temp.rec('the real switch works with every condition met', 'true',
    (public.set_go_live_guard('payouts_enabled', true, 'Stage 1 complete, fee schedule approved.') ->> 'changed'));
  perform pg_temp.back();
  perform pg_temp.rec('the guard is on', 'true', private.go_live_open('payouts_enabled')::text);
  perform pg_temp.rec('...recording who, when and why', 'true',
    (select (changed_by = v_admin and changed_at is not null and change_note = 'Stage 1 complete, fee schedule approved.')::text from public.go_live_guards where key = 'payouts_enabled'));
  perform pg_temp.rec('the log has the switch and the conditions as they stood', '1/true',
    (select count(*)::text || '/' || bool_and(jsonb_array_length(conditions) = 2 and actor_role = 'admin')::text from public.go_live_guard_log where guard_key = 'payouts_enabled' and action = 'switched_on'));
  perform pg_temp.rec('a bare update by the owner is still refused while it is on', '42501', pg_temp.try('update public.go_live_guards set is_on = false where key = ''payouts_enabled'''));
  perform pg_temp.rec('the log cannot be edited by the owner', '42501', pg_temp.try('update public.go_live_guard_log set note = ''x'''));
  perform pg_temp.rec('...deleted from', '42501', pg_temp.try('delete from public.go_live_guard_log'));
  perform pg_temp.rec('...or truncated', '42501', pg_temp.try('truncate public.go_live_guard_log'));
  perform pg_temp.rec('an attestation cannot be edited or deleted by the owner', '42501/42501',
    pg_temp.try('update public.go_live_attestations set met = false') || '/' || pg_temp.try('delete from public.go_live_attestations'));
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('switching on again is a no-op and writes no log row', 'false/1',
    (public.set_go_live_guard('payouts_enabled', true, 'again') ->> 'changed') || '/' || (select count(*)::text from public.go_live_guard_log where guard_key = 'payouts_enabled'));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the CMO can always switch an admin guard off, with no note', 'true',
    (public.set_go_live_guard('payouts_enabled', false) ->> 'changed'));
  perform pg_temp.back();
  perform pg_temp.rec('it reads closed again and the stop is logged with the CMO', 'false/cmo',
    private.go_live_open('payouts_enabled')::text || '/' || (select actor_role from public.go_live_guard_log where guard_key = 'payouts_enabled' and action = 'switched_off'));
  perform pg_temp.act(v_admin);
  perform public.attest_go_live_condition('payouts_enabled', 'paystack_transfers_configured', false, 'The Paystack transfer approval was withdrawn.');
  perform pg_temp.rec('a withdrawn attestation blocks switching on again', '22023', pg_temp.try('select public.set_go_live_guard(''payouts_enabled'', true, ''retry'')'));
  perform pg_temp.back();

  -- 4. The real conditions of clinical_operations_enabled ---------------------------------------------------------
  perform pg_temp.act(v_admin);
  v_txt := pg_temp.msg('select public.set_go_live_guard(''clinical_operations_enabled'', true, ''go'')');
  perform pg_temp.rec('with no protocol, rule set or tier 2 clinician the switch names all three', 'true',
    (v_txt like '22023:%hypertension protocol%triage rule set%tier 2 clinician%')::text);
  perform pg_temp.back();
  insert into public.protocols (code, version, status, definition, approved_by, approved_at)
  values ('htn_hearts_ng', 9001, 'approved', '{"code":"htn_hearts_ng","version":9001}'::jsonb, v_cmo, now());
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('the evaluator reads the real protocol code (htn_hearts_ng) as an approved hypertension protocol', 'true',
    (select (c ->> 'met')::text from jsonb_array_elements(private.go_live_conditions('clinical_operations_enabled', v_org)) c where c ->> 'code' = 'hypertension_protocol_approved'));
  perform pg_temp.rec('a protocol alone is not enough', '22023', pg_temp.try('select public.set_go_live_guard(''clinical_operations_enabled'', true, ''go'')'));
  perform pg_temp.back();
  update public.triage_rule_sets set status = 'retired' where code = 'bp_care_triage' and status = 'approved';
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at)
  values ('bp_care_triage', 9001, 'approved', '{"code":"bp_care_triage","version":9001,"rules":[]}'::jsonb, v_cmo, now());
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('a protocol and a rule set but no tier 2 clinician is still not enough', '22023', pg_temp.try('select public.set_go_live_guard(''clinical_operations_enabled'', true, ''go'')'));
  perform pg_temp.back();
  update public.clinical_staff set is_test = false where profile_id = v_smo;   -- the first real tier 2 clinician (fixture)
  perform pg_temp.act(v_admin);
  -- S37b: with protocol, rule set and a real clinician all met, no recorded safety case still blocks the switch
  perform pg_temp.rec('safety case missing: the switch is refused although every data condition is met', '22023',
    pg_temp.try('select public.set_go_live_guard(''clinical_operations_enabled'', true, ''Proof: no safety case recorded yet.'')'));
  perform pg_temp.rec('safety case: an admin who is not the CMO cannot record it', '42501',
    pg_temp.try('select public.attest_go_live_condition(''clinical_operations_enabled'', ''clinical_safety_case_current'', true, ''Proof safety case SC-1 v1 signed by the safety officer.'')'));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('safety case: a vague note is refused', '22023',
    pg_temp.try('select public.attest_go_live_condition(''clinical_operations_enabled'', ''clinical_safety_case_current'', true, ''checked it okay'')'));
  perform public.attest_go_live_condition('clinical_operations_enabled', 'clinical_safety_case_current', true, 'Proof safety case SC-1 v1 signed by the safety officer.');
  perform public.attest_go_live_condition('prescribing_enabled', 'clinical_safety_case_current', true, 'Proof safety case SC-1 v1 signed by the safety officer.');
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('prescribing: every other condition aside, the CMO-recorded safety case is now met for it', 'true',
    (select (c ->> 'met')::text from jsonb_array_elements(private.go_live_conditions('prescribing_enabled', v_org)) c where c ->> 'code' = 'clinical_safety_case_current'));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('a test clinician never counts toward the condition (control: the real one now does)', 'true',
    (select (g ->> 'all_met')::text from jsonb_array_elements(public.go_live_guard_status()) g where g ->> 'key' = 'clinical_operations_enabled'));
  perform pg_temp.back();

  -- 5. The wiring ---------------------------------------------------------------------------------------------
  v_real := pg_temp.mkuser(v_org, 'real-patient', 'patient', false);
  v_realdoc := v_smo;                                       -- non-test profile too (below)
  update public.profiles set is_test = false where id = v_smo;
  v_tp := pg_temp.mkuser(v_org, 'test-patient', 'patient');
  v_td := pg_temp.mkdoc(v_org, v_admin, 'test-doc', 'senior_medical_officer');
  perform pg_temp.open_time(v_td, v_start);
  perform pg_temp.open_time(v_realdoc, v_start);

  update public.availability_blocks set is_test = false where clinician_id = v_realdoc;
  -- guard off, real pair: refused with the guard's own message
  perform pg_temp.act(v_real);
  v_txt := pg_temp.msg(format('select public.hold_appointment_slot(%L, %L, ''telemedicine'', ''telemedicine'', %L, %L)', v_org, v_realdoc, v_start, v_start + interval '30 minutes'));
  perform pg_temp.rec('guard off: a real patient cannot hold a consultation', 'P0001:consultations are not open yet', v_txt);
  v_txt := pg_temp.msg(format('select public.hold_appointment_slot(%L, %L, ''result_interpretation'', ''telemedicine'', %L, %L)', v_org, v_realdoc, v_start, v_start + interval '30 minutes'));
  perform pg_temp.rec('guard off: nor a result-interpretation consultation', 'P0001:consultations are not open yet', v_txt);
  perform pg_temp.rec('guard off: the client check says closed', 'false', public.go_live_guard_is_open('clinical_operations_enabled')::text);
  perform pg_temp.back();
  perform pg_temp.rec('guard off: nothing was held for the real patient', '0', (select count(*)::text from public.appointments where patient_id = v_real));
  -- a different appointment type is not touched by this guard
  perform pg_temp.act(v_real);
  v_txt := pg_temp.msg(format('select public.hold_appointment_slot(%L, %L, ''gp'', ''telemedicine'', %L, %L)', v_org, v_realdoc, v_start, v_start + interval '30 minutes'));
  perform pg_temp.rec('guard off: any appointment booked as a remote consultation is blocked, not only the two consultation types', 'P0001:consultations are not open yet', v_txt);
  v_txt := pg_temp.msg(format('select public.hold_appointment_slot(%L, %L, ''gp'', ''in_person'', %L, %L)', v_org, v_realdoc, v_start, v_start + interval '30 minutes'));
  perform pg_temp.rec('guard off: an in-person appointment is not touched by it', 'true', (v_txt not like '%consultations are not open yet%')::text);
  perform pg_temp.back();

  -- guard off, test pair: passes the guard, so the flow can be exercised with test accounts
  perform pg_temp.mkcredit(v_tp);
  perform pg_temp.act(v_tp);
  select id into v_appt from public.hold_appointment_slot(v_org, v_td, 'telemedicine', 'telemedicine', v_start, v_start + interval '30 minutes');
  perform pg_temp.rec('guard off: a test patient with a test clinician can hold a consultation', '1', (select count(*)::text from public.appointments where id = v_appt));
  perform pg_temp.rec('guard off: ...and the client check says open for a test account', 'true', public.go_live_guard_is_open('clinical_operations_enabled')::text);
  perform pg_temp.back();
  perform pg_temp.rec('a real patient with a test clinician is NOT a test pair', 'false', private.go_live_open('clinical_operations_enabled', v_real, v_td)::text);
  perform pg_temp.rec('a test patient with a real clinician is NOT a test pair', 'false', private.go_live_open('clinical_operations_enabled', v_tp, v_realdoc)::text);
  perform pg_temp.rec('a test pair needs both ids given', 'false', private.go_live_open('clinical_operations_enabled', v_tp, null)::text);

  -- a hold made while it was open cannot be confirmed once the people on it are real and the guard is off
  update public.profiles set is_test = false where id in (v_tp, v_td);
  update public.availability_blocks set is_test = false where clinician_id in (v_td, v_realdoc);
  update public.clinical_staff set is_test = false where profile_id = v_td;
  update public.availability_blocks set is_test = false where clinician_id = v_realdoc;
  perform pg_temp.act(v_tp);
  v_txt := pg_temp.msg(format('select public.confirm_appointment_booking(%L)', v_appt));
  perform pg_temp.rec('guard off: a real hold cannot be confirmed, and no credit is spent', 'P0001:consultations are not open yet/0',
    v_txt || '/' || (select count(*)::text from public.service_purchases where redeemed_entity_type = 'appointment' and redeemed_entity_id = v_appt));
  perform pg_temp.back();

  -- turn the guard on through the real switch (all three conditions are met from section 4)
  perform pg_temp.act(v_admin);
  perform public.set_go_live_guard('clinical_operations_enabled', true, 'Proof: protocol and rule set approved, a tier 2 clinician is active.');
  perform pg_temp.back();
  perform pg_temp.rec('the clinical operations guard is on', 'true', private.go_live_open('clinical_operations_enabled')::text);
  perform pg_temp.act(v_tp);
  perform pg_temp.rec('guard on: the client check says open', 'true', public.go_live_guard_is_open('clinical_operations_enabled')::text);
  v_txt := pg_temp.msg(format('select public.confirm_appointment_booking(%L)', v_appt));
  perform pg_temp.rec('guard on: the hold is confirmed with the credit', 'ok/confirmed',
    v_txt || '/' || (select status::text from public.appointments where id = v_appt));
  perform pg_temp.back();
  select id into v_enc from public.encounters where appointment_id = v_appt;
  perform pg_temp.rec('guard on: the confirmed booking has an encounter', '1', (select count(*)::text from public.encounters where id = v_enc));
  perform pg_temp.act(v_real);
  v_txt := pg_temp.msg(format('select public.hold_appointment_slot(%L, %L, ''telemedicine'', ''telemedicine'', %L, %L)', v_org, v_realdoc, v_start, v_start + interval '30 minutes'));
  perform pg_temp.rec('guard on: a real patient gets past the guard (any other answer is fine)', 'true', (v_txt not like '%consultations are not open yet%')::text);
  perform pg_temp.back();

  -- the room
  v_view := public.service_get_encounter_room(v_enc);
  perform pg_temp.rec('guard on: the room view says open and carries the room stub', 'true/true',
    (v_view ->> 'go_live_open') || '/' || ((v_view -> 'room') <> 'null'::jsonb)::text);
  perform pg_temp.act(v_admin);
  perform public.set_go_live_guard('clinical_operations_enabled', false, 'Proof: stop.');
  perform pg_temp.back();
  v_view := public.service_get_encounter_room(v_enc);
  perform pg_temp.rec('guard off again: the room is not described, not joinable, and says so', 'false/false/null',
    (v_view ->> 'go_live_open') || '/' || (v_view ->> 'joinable') || '/' || coalesce(v_view -> 'room' #>> '{}', 'null'));
  perform pg_temp.act(v_tp);
  perform pg_temp.rec('guard off again: a confirmed real booking cannot be re-confirmed or new ones held', 'true',
    (pg_temp.msg(format('select public.hold_appointment_slot(%L, %L, ''telemedicine'', ''telemedicine'', %L, %L)', v_org, v_td, v_start + interval '1 hour', v_start + interval '90 minutes')) like 'P0001:consultations are not open yet')::text);
  perform pg_temp.back();

  -- the older video-visit request path: nothing is requested while closed; a test patient still can (stops at the missing slot)
  perform pg_temp.act(v_tp);
  perform pg_temp.rec('guard off: a real patient cannot create a video visit request', 'P0001',
    pg_temp.try(format('insert into public.video_visit_requests (organisation_id, patient_id, slot_id) values (%L, %L, %L)', v_org, v_tp, gen_random_uuid())));
  perform pg_temp.back();
  v_tp2 := pg_temp.mkuser(v_org, 'test-patient-2', 'patient');
  perform pg_temp.act(v_tp2);
  perform pg_temp.rec('guard off: a test patient gets past the guard (and stops at the missing slot)', '23503',
    pg_temp.try(format('insert into public.video_visit_requests (organisation_id, patient_id, slot_id) values (%L, %L, %L)', v_org, v_tp2, gen_random_uuid())));
  perform pg_temp.back();
  perform pg_temp.rec('the request trigger is in place', '1', (select count(*)::text from pg_trigger where tgrelid = 'public.video_visit_requests'::regclass and tgname = 'video_visit_requests_go_live_guard'));
  -- accepting: a request made earlier (fixture: the insert trigger is disabled just for this row) cannot be accepted while closed;
  -- once open, the same call gets past the guard (and stops at the missing slot)
  alter table public.video_visit_requests disable trigger video_visit_requests_go_live_guard;
  insert into public.video_visit_requests (organisation_id, patient_id, status) values (v_org, v_tp, 'payment_confirmed') returning id into v_req;
  alter table public.video_visit_requests enable trigger video_visit_requests_go_live_guard;
  perform pg_temp.act(v_td);
  perform pg_temp.rec('guard off: a clinician cannot accept a request for a real patient', 'P0001:consultations are not open yet',
    pg_temp.msg(format('select public.accept_video_visit_request(%L)', v_req)));
  perform pg_temp.back();
  perform pg_temp.act(v_admin); perform public.set_go_live_guard('clinical_operations_enabled', true, 'Proof: open again.'); perform pg_temp.back();
  perform pg_temp.act(v_td);
  perform pg_temp.rec('guard on: the same call gets past the guard (and stops at the request not being ready)', 'true',
    (pg_temp.msg(format('select public.accept_video_visit_request(%L)', v_req)) like 'P0001:this request is not awaiting acceptance%')::text);
  perform pg_temp.back();
  perform pg_temp.act(v_admin); perform public.set_go_live_guard('clinical_operations_enabled', false, 'Proof: closed again.'); perform pg_temp.back();

  -- the scribe: a live consultation with a granted consent starts only while scribe_enabled is on (real pair)
  update public.encounters set status = 'in_progress', started_at = now() where id = v_enc;
  v_view := public.service_get_encounter_room(v_enc);
  perform pg_temp.rec('guard off: a consultation already in progress is not ended by the switch-off', 'true/false',
    (v_view ->> 'go_live_open') || '/' || (v_view ->> 'joinable' is null)::text);
  perform pg_temp.act(v_tp);
  perform public.open_scribe_prompt(v_enc);
  perform pg_temp.rec('scribe off: a patient cannot allow the scribe', 'P0001', pg_temp.try(format('select public.record_scribe_consent(%L, true)', v_enc)));
  perform pg_temp.rec('scribe off: ...but can always decline', 'ok', pg_temp.try(format('select public.record_scribe_consent(%L, false)', v_enc)));
  perform pg_temp.back();
  update public.consultation_scribe_consents set granted = true where encounter_id = v_enc;   -- fixture: an answer given while the scribe was on
  perform pg_temp.act(v_td);
  perform pg_temp.rec('scribe off: consent granted and the consultation live, but the scribe may not start', 'false', public.scribe_may_start(v_enc)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_td);
  perform pg_temp.rec('scribe off: the scribe-draft path cannot start, a new consent is refused for a real pair', 'P0001',
    pg_temp.try(format('insert into public.scribe_consents (patient_id, granted, language) values (%L, true, ''en-NG'')', v_tp)));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform public.attest_go_live_condition('scribe_enabled', 'clinical_safety_case_current', true, 'Proof safety case SC-1 v1 signed by the safety officer.');
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform public.attest_go_live_condition('scribe_enabled', 'con001_legal_review_recorded', true, 'Counsel reviewed CON-001 on the proof date.');
  perform public.attest_go_live_condition('scribe_enabled', 'speech_provider_configured', true, 'The speech provider key is set and a test file transcribed.');
  perform public.set_go_live_guard('scribe_enabled', true, 'Proof: legal review recorded and speech provider configured.');
  perform pg_temp.back();
  perform pg_temp.act(v_td);
  perform pg_temp.rec('scribe on: the same consultation may now start the scribe', 'true', public.scribe_may_start(v_enc)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_tp);
  perform pg_temp.rec('scribe on: a patient can now allow it', 'ok', pg_temp.try(format('select public.record_scribe_consent(%L, true)', v_enc)));
  perform pg_temp.back();
  perform pg_temp.act(v_td);
  perform pg_temp.rec('scribe on: a new consent gets past the guard (any other answer is fine)', 'true',
    (pg_temp.try(format('insert into public.scribe_consents (patient_id, granted, language) values (%L, true, ''en-NG'')', v_tp)) <> 'P0001')::text);
  perform pg_temp.back();

  -- 6. PROPOSED-config sign-off -----------------------------------------------------------------------------------
  -- the function is for the server only: no signed-in session, whoever they are, can call it
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('a signed-in admin cannot call the sign-off function directly', '42501',
    pg_temp.try(format('select public.record_proposed_config_signoff(%L, ''fees.care_pack'', 1, %L, ''Founder'', ''confirmed'')', v_admin, repeat('c', 64))));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('...nor the CMO', '42501',
    pg_temp.try(format('select public.record_proposed_config_signoff(%L, ''paging.escalation_minutes'', 1, %L, ''CMO'', ''confirmed'')', v_cmo, repeat('a', 64))));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('...nor anon', '42501',
    pg_temp.try(format('select public.record_proposed_config_signoff(%L, ''paging.escalation_minutes'', 1, %L, ''CMO'', ''confirmed'')', v_cmo, repeat('a', 64))));
  perform pg_temp.back();
  -- the server (service role) names the signer; the database checks the signer is the owner's role
  perform pg_temp.act_service();
  perform pg_temp.rec('a patient cannot be named as the signer', '42501',
    pg_temp.try(format('select public.record_proposed_config_signoff(%L, ''paging.escalation_minutes'', 1, %L, ''CMO'', ''confirmed'')', v_pat, repeat('a', 64))));
  perform pg_temp.rec('no signer named is refused', '42501',
    pg_temp.try(format('select public.record_proposed_config_signoff(null, ''paging.escalation_minutes'', 1, %L, ''CMO'', ''confirmed'')', repeat('a', 64))));
  perform pg_temp.rec('a clinician who is not the CMO cannot confirm a CMO value', '42501',
    pg_temp.try(format('select public.record_proposed_config_signoff(%L, ''paging.escalation_minutes'', 1, %L, ''CMO'', ''confirmed'')', v_td, repeat('a', 64))));
  perform pg_temp.rec('the founder cannot confirm a CMO value', '42501',
    pg_temp.try(format('select public.record_proposed_config_signoff(%L, ''paging.escalation_minutes'', 1, %L, ''CMO'', ''confirmed'')', v_admin, repeat('a', 64))));
  perform pg_temp.rec('the CMO cannot confirm a founder value', '42501',
    pg_temp.try(format('select public.record_proposed_config_signoff(%L, ''fees.care_pack'', 1, %L, ''Founder'', ''confirmed'')', v_cmo, repeat('c', 64))));
  perform pg_temp.rec('a value that needs counsel needs a note saying who advised', '22023',
    pg_temp.try(format('select public.record_proposed_config_signoff(%L, ''retention.transcript'', 1, %L, ''Founder and counsel'', ''confirmed'')', v_admin, repeat('b', 64))));
  perform pg_temp.rec('a hash that is not a sha-256 is refused', '23514',
    pg_temp.try(format('select public.record_proposed_config_signoff(%L, ''paging.escalation_minutes'', 1, ''abc'', ''Founder'', ''confirmed'')', v_admin)));
  perform pg_temp.rec('asking for a change needs a note', '22023',
    pg_temp.try(format('select public.record_proposed_config_signoff(%L, ''paging.escalation_minutes'', 1, %L, ''CMO'', ''changes_requested'')', v_cmo, repeat('a', 64))));
  perform public.record_proposed_config_signoff(v_admin, 'fees.care_pack', 1, repeat('c', 64), 'Founder', 'confirmed', 'Price confirmed.');
  perform public.record_proposed_config_signoff(v_cmo, 'paging.escalation_minutes', 1, repeat('a', 64), 'CMO', 'confirmed', null);
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the CMO confirms their own value', 'confirmed',
    (select e ->> 'decision' from jsonb_array_elements(public.proposed_config_signoffs_current()) e where e ->> 'key' = 'paging.escalation_minutes'));
  perform pg_temp.back();
  perform pg_temp.act_service();
  perform public.record_proposed_config_signoff(v_cmo, 'paging.escalation_minutes', 1, repeat('a', 64), 'CMO', 'changes_requested', 'Make the second step 8 minutes.');
  perform public.record_proposed_config_signoff(v_cmo, 'paging.escalation_minutes', 2, repeat('d', 64), 'CMO', 'confirmed', null);
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the newest decision wins', 'changes_requested',
    (select e ->> 'decision' from jsonb_array_elements(public.proposed_config_signoffs_current()) e where e ->> 'key' = 'paging.escalation_minutes' and (e ->> 'version')::int = 1));
  perform pg_temp.rec('another version is its own record', '2', (select count(*)::text from jsonb_array_elements(public.proposed_config_signoffs_current()) e where e ->> 'key' = 'paging.escalation_minutes'));
  perform pg_temp.back();
  perform pg_temp.rec('...but every decision is kept', '3', (select count(*)::text from public.proposed_config_signoffs where config_key = 'paging.escalation_minutes'));
  perform pg_temp.rec('the signer on the audit trail is the person named', '1',
    (select count(*)::text from public.audit_log where action = 'proposed_config.confirmed' and actor_id = v_admin));
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a patient cannot read the sign-offs', '0', (select count(*)::text from public.proposed_config_signoffs));
  perform pg_temp.back();
  perform pg_temp.rec('a sign-off cannot be edited or deleted, even by the owner', '42501/42501',
    pg_temp.try('update public.proposed_config_signoffs set decision = ''confirmed''') || '/' || pg_temp.try('delete from public.proposed_config_signoffs'));
  perform pg_temp.rec('nothing is seeded: no sign-off exists that this proof did not write', '0',
    (select count(*)::text from public.proposed_config_signoffs where signed_by not in (v_cmo, v_admin)));

  -- every condition the dashboard shows as recorded by a person can actually be recorded (the attestable list matches the conditions)
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('every attestation condition the dashboard lists can be attested', '0',
    (select count(*)::text from jsonb_array_elements(public.go_live_guard_status()) g, jsonb_array_elements(g -> 'conditions') c
      where c ->> 'source' = 'attestation' and c ->> 'code' <> 'clinical_safety_case_current'
        and pg_temp.try(format('select public.attest_go_live_condition(%L, %L, true, ''Proof: checked by the proof.'')', g ->> 'key', c ->> 'code')) <> 'ok'));
  perform pg_temp.back();
  -- A condition that cannot be evaluated is unmet, never an error: the stop button and the dashboard survive a broken query
  create or replace function private.go_live_conditions(p_key text, p_org uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $f$
    begin raise exception 'simulated broken condition query'; end $f$;
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('a broken condition query does not blank the dashboard', '8', jsonb_array_length(public.go_live_guard_status())::text);
  perform pg_temp.rec('...every guard then reads as not satisfied', '8', (select count(*)::text from jsonb_array_elements(public.go_live_guard_status()) g where not (g ->> 'all_met')::boolean));
  perform pg_temp.rec('...and the stop button still works (scribe_enabled is on here)', 'true', (public.set_go_live_guard('scribe_enabled', false, 'Proof: stop under a broken evaluator.') ->> 'changed'));
  perform pg_temp.rec('...and no scribe consent is left open after the scribe is switched off', '0', (select count(*)::text from public.scribe_consents where granted and revoked_at is null));
  perform pg_temp.rec('...and the patient''s in-app allow on the open consultation went back to unanswered', 'null',
    coalesce((select granted::text from public.consultation_scribe_consents where encounter_id = v_enc), 'null'));
  perform pg_temp.rec('...but switching on is refused, fail closed', '22023', pg_temp.try('select public.set_go_live_guard(''payouts_enabled'', true, ''go'')'));
  perform pg_temp.back();

  -- 7. SABOTAGE -------------------------------------------------------------------------------------------------
  -- (a) the reader forced open: a real patient must now get through, so the guard-closed check flips
  create or replace function private.go_live_open(p_key text, p_patient uuid default null, p_clinician uuid default null)
    returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$;
  perform pg_temp.act(v_real);
  insert into results values ('sabotaged', 'guard off: a real patient cannot hold a consultation', 'P0001:consultations are not open yet',
    pg_temp.msg(format('select public.hold_appointment_slot(%L, %L, ''telemedicine'', ''telemedicine'', %L, %L)', v_org, v_realdoc, v_start + interval '2 days', v_start + interval '2 days 30 minutes')));
  perform pg_temp.back();
  -- (b) the guard trigger dropped: the owner can switch a guard on with a bare update, so the refusal flips
  drop trigger go_live_guards_guard on public.go_live_guards;
  insert into results values ('sabotaged', 'the table owner cannot switch a guard on directly', '42501',
    pg_temp.try(format('update public.go_live_guards set is_on = true, changed_at = now(), changed_by = %L, change_note = ''forced'' where key = ''public_signup_enabled''', v_admin)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S37 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed.

rollback;
