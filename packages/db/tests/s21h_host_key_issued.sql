-- S21h proof: the record of a clinician's Zoom host key being issued (migration *_s21h_host_key_issued_audit_event.sql).
--
-- Proves in one rolled-back transaction:
--   1. The server-only recorder accepts 'host_key_issued' and the event is stored for the clinician with an EMPTY payload, even when a key
--      or a name is passed in (the payload whitelist drops everything but ids and small numbers).
--   2. Nobody signed in can write it: not the clinician, not the patient, not anon (the recorder is service_role only), and the app-session
--      recorder (report_encounter_event) refuses the kind; the table has no direct insert for a signed-in user.
--   3. An unknown consultation is refused.
--   4. SABOTAGE: with the recorder reverted to its old list of kinds, issuing a host key can no longer be recorded.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.try_msg(p_sql text) returns text language plpgsql as
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
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.act_service() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's21-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S21 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), p_dob, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
-- one unredeemed consultation credit for a patient (a fixture: what a paid checkout leaves behind)
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
-- the clinician's confirmed bookable time (OQ-124): booking is only possible from it
create function pg_temp.open_time(p_clin uuid, p_start timestamptz) returns void language plpgsql as
$f$ declare v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_clin;
  if not exists (select 1 from public.availability_blocks where clinician_id = p_clin and kind = 'bookable_consultations' and state = 'confirmed' and is_test
                  and starts_at <= p_start and ends_at >= p_start + interval '30 minutes') then
    insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
    values (v_org, p_clin, p_start, p_start + interval '2 hours', 'bookable_consultations', 'confirmed', true);  -- 2 hours: S18's minimum block
  end if;
end $f$;
-- hold and confirm as the patient; returns the appointment id
create function pg_temp.book(p_patient uuid, p_clinician uuid, p_start timestamptz) returns uuid language plpgsql as
$f$ declare v_org uuid; v_id uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  perform pg_temp.open_time(p_clinician, p_start);
  perform pg_temp.act(p_patient);
  select id into v_id from public.hold_appointment_slot(v_org, p_clinician, 'telemedicine', 'telemedicine', p_start, p_start + interval '30 minutes');
  perform public.confirm_appointment_booking(v_id);
  perform pg_temp.back();
  return v_id;
end $f$;
-- the server records a join (as the service role); returns the consultation's status afterwards
create function pg_temp.join_as(p_enc uuid, p_role text) returns text language plpgsql as
$f$ declare v text;
begin
  perform pg_temp.act_service();
  select status into v from public.service_record_join(p_enc, p_role);
  perform pg_temp.back();
  return v;
end $f$;
create function pg_temp.credit_redeemed(p_purchase uuid) returns text language sql as
$$ select (redeemed_at is not null)::text from public.service_purchases where id = p_purchase $$;
-- how many credits are currently spent on this appointment (a credit freed earlier can be picked again, so check by target)
create function pg_temp.credits_on(p_appt uuid) returns text language sql as
$$ select count(*)::text from public.service_purchases where redeemed_entity_type = 'appointment' and redeemed_entity_id = p_appt $$;


do $$
declare
  v_org uuid;
  v_admin uuid; v_docA uuid; v_adult uuid;
  v_cr1 uuid; v_a1 uuid; v_e1 uuid;
  v_start timestamptz := date_trunc('hour', now()) + interval '3 days' + interval '9 hours';
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;

  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', (current_date - interval '45 years')::date);
  v_docA := pg_temp.mkuser(v_org, 'doctor-a', 'clinician', (current_date - interval '40 years')::date);
  v_adult := pg_temp.mkuser(v_org, 'adult', 'patient', (current_date - interval '45 years')::date);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, languages, license_verified_at, license_expires_at, specialty, indemnity_exempt, indemnity_exempt_by, doctor_tier)
  values (v_org, v_docA, 'S21 doctor-a', true, true, array['en', 'pcm'], now() - interval '10 days', now() + interval '1 year', 'General practice', true, v_admin, 'senior_medical_officer');
  update public.consultation_policy_config set config = config || '{"bookingLeadMinutes":5,"bookingHorizonDays":21}'::jsonb where is_active;

  v_cr1 := pg_temp.mkcredit(v_adult);
  v_a1 := pg_temp.book(v_adult, v_docA, v_start);
  select id into v_e1 from public.encounters where appointment_id = v_a1;

  -- 1. The server records it ----------------------------------------------------------------------------------
  perform pg_temp.act_service();
  perform pg_temp.rec('the server can record that a host key was issued', 'ok', pg_temp.try(format('select public.service_record_encounter_event(%L, ''host_key_issued'', ''clinician'', ''{}'')', v_e1)));
  perform pg_temp.back();
  perform pg_temp.rec('...stored as a clinician event with an empty payload', 'clinician/{}/1',
    (select actor_role || '/' || payload::text || '/' || count(*)::text from public.encounter_events where encounter_id = v_e1 and kind = 'host_key_issued' group by actor_role, payload));
  perform pg_temp.act_service();
  perform public.service_record_encounter_event(v_e1, 'host_key_issued', 'clinician', '{"zak":"SECRET-KEY","full_name":"Dr Nobody","reason_code":"join"}'::jsonb);
  perform pg_temp.back();
  perform pg_temp.rec('a key or a name passed in by mistake is never stored (only ids and small numbers survive the whitelist)', 'false/false',
    (select (payload::text like '%SECRET%')::text || '/' || (payload::text like '%Nobody%')::text from public.encounter_events where encounter_id = v_e1 and kind = 'host_key_issued' order by created_at desc, id limit 1));

  -- 2. Nobody signed in can write it --------------------------------------------------------------------------
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('the clinician cannot record it through the server function', '42501', pg_temp.try(format('select public.service_record_encounter_event(%L, ''host_key_issued'', ''clinician'', ''{}'')', v_e1)));
  perform pg_temp.rec('...nor through the app-session recorder', '22023', pg_temp.try(format('select public.report_encounter_event(%L, ''host_key_issued'')', v_e1)));
  perform pg_temp.rec('...nor by writing the table directly', '42501',
    pg_temp.try(format('insert into public.encounter_events (organisation_id, encounter_id, kind, actor_role) values (%L, %L, ''host_key_issued'', ''clinician'')', v_org, v_e1)));
  perform pg_temp.back();
  perform pg_temp.act(v_adult);
  perform pg_temp.rec('the patient cannot record it', '42501', pg_temp.try(format('select public.service_record_encounter_event(%L, ''host_key_issued'', ''clinician'', ''{}'')', v_e1)));
  perform pg_temp.rec('...nor through the app-session recorder', '22023', pg_temp.try(format('select public.report_encounter_event(%L, ''host_key_issued'')', v_e1)));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot record it', '42501', pg_temp.try(format('select public.service_record_encounter_event(%L, ''host_key_issued'', ''clinician'', ''{}'')', v_e1)));
  perform pg_temp.back();

  -- 3. An unknown consultation --------------------------------------------------------------------------------
  perform pg_temp.act_service();
  perform pg_temp.rec('an unknown consultation is refused', 'P0002', pg_temp.try(format('select public.service_record_encounter_event(%L, ''host_key_issued'', ''clinician'', ''{}'')', gen_random_uuid())));
  perform pg_temp.back();

  -- 4. SABOTAGE: the recorder goes back to its old list of kinds ----------------------------------------------
  create or replace function public.service_record_encounter_event(p_encounter uuid, p_kind text, p_actor_role text, p_payload jsonb default '{}'::jsonb)
  returns void language plpgsql security definer set search_path to '' as $f$
  begin
    if p_actor_role not in ('patient', 'clinician', 'system') then raise exception 'unknown actor role' using errcode = '22023'; end if;
    if p_kind not in ('left', 'quality', 'mode_changed', 'fallback_offered', 'phone_requested', 'phone_connected', 'reconnect_grace_started', 'room_created') then
      raise exception 'that event cannot be recorded here' using errcode = '22023';
    end if;
    perform private.log_encounter_event(p_encounter, p_kind, null, p_actor_role, private.clean_encounter_payload(p_payload));
  end; $f$;
  perform pg_temp.act_service();
  insert into results values ('sabotaged', 'the server can record that a host key was issued', 'ok', pg_temp.try(format('select public.service_record_encounter_event(%L, ''host_key_issued'', ''clinician'', ''{}'')', v_e1)));
  perform pg_temp.back();
  if (select count(*) from results where phase = 'sabotaged' and expected <> actual) < 1 then
    raise exception 'VACUOUS TEST: the sabotaged recorder still accepted the event';
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to FAIL inside the DO block above. They are deliberately not printed: the runner
-- treats any FAIL verdict in the output as a failed proof.

rollback;
