-- S21 proof: encounters, consultation rooms and events, scribe consent, adult-only booking, policy-driven cancellation,
-- no-show handling (migration *_s21_encounters_consultations.sql).
--
-- Proves in one rolled-back transaction:
--   1. Seed: policy v1 active (2 hour window, 18 and over), the consultation price is NGN 10,000, five S21 event types.
--   2. Adults only (OQ-129): a 15 year old and a patient with no date of birth are refused a remote booking
--      (fail closed); an adult books, confirms with a credit, and gets an encounter and a room stub.
--   3. The room: recording cannot be turned on; no join URL column exists; events are append only.
--   4. Access (INV-12): the patient and the assigned clinician read the encounter; a stranger, another clinician read
--      nothing; a patient never reads the room reference; no direct writes; anon cannot execute anything.
--   5. Scribe consent (INV-11, OQ-38): only the patient can ask or answer; scribe_may_start is true only for the assigned
--      clinician while the consultation is live and consent is granted; a withdrawal turns it off and is logged.
--   6. The live path: join events move scheduled to waiting to in progress, a mode change counts one fallback step
--      and keeps only whitelisted keys, completion closes the appointment and emits the event.
--   7. Cancellation (OQ-127): in time returns the credit, late keeps it, a clinician cancel always returns it.
--   8. No-shows: too early is refused, a clinician no-show returns the credit, a patient no-show keeps it.
--   8b. Service functions: only service_role can call them; the join window; the room opens once; events keep only whitelisted keys.
--   9. SABOTAGE: with the adult gate trigger dropped, with the adult check emptied, a minor gets through; with the room lookup
--      granted to signed-in users, a patient can call it; with the older booking path's adult gate dropped, a minor gets through.
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
  v_admin uuid; v_docA uuid; v_docB uuid;
  v_adult uuid; v_minor uuid; v_nodob uuid; v_stranger uuid; v_adult2 uuid; v_adult3 uuid; v_adult4 uuid;
  v_cr1 uuid; v_cr2 uuid; v_cr3 uuid; v_cr4 uuid; v_cr5 uuid; v_cr6 uuid;
  v_a10 uuid; v_a11 uuid; v_a12 uuid; v_a13 uuid; v_a14 uuid; v_a15 uuid; v_e10 uuid; v_e12 uuid; v_e13 uuid; v_e14 uuid; v_e15 uuid;
  v_a7 uuid; v_a8 uuid; v_e7 uuid; v_e8 uuid; v_room jsonb; v_a9 uuid; v_e9 uuid; v_view jsonb;
  v_a1 uuid; v_a2 uuid; v_a3 uuid; v_a4 uuid; v_a5 uuid; v_a6 uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_e4 uuid; v_e5 uuid; v_e6 uuid;
  v_start timestamptz := date_trunc('hour', now()) + interval '3 days' + interval '9 hours';
  v_res text;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;

  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', (current_date - interval '45 years')::date);
  v_docA := pg_temp.mkuser(v_org, 'doctor-a', 'clinician', (current_date - interval '40 years')::date);
  v_docB := pg_temp.mkuser(v_org, 'doctor-b', 'clinician', (current_date - interval '40 years')::date);
  v_adult := pg_temp.mkuser(v_org, 'adult', 'patient', (current_date - interval '45 years')::date);
  v_adult2 := pg_temp.mkuser(v_org, 'adult-2', 'patient', (current_date - interval '30 years')::date);
  v_adult3 := pg_temp.mkuser(v_org, 'adult-3', 'patient', (current_date - interval '35 years')::date);
  v_adult4 := pg_temp.mkuser(v_org, 'adult-4', 'patient', (current_date - interval '50 years')::date);
  v_minor := pg_temp.mkuser(v_org, 'minor', 'patient', (current_date - interval '15 years')::date);
  v_nodob := pg_temp.mkuser(v_org, 'no-dob', 'patient', null);
  v_stranger := pg_temp.mkuser(v_org, 'stranger', 'patient', (current_date - interval '33 years')::date);

  -- 1. Seed ---------------------------------------------------------------------------------------------------
  perform pg_temp.rec('policy v1 is the one active policy', '1', (select count(*)::text from public.consultation_policy_config where is_active and version = 1));
  perform pg_temp.rec('the policy has a 2 hour window and a minimum age of 18', '2/18',
    (select (config ->> 'cancelWindowHours') || '/' || (config ->> 'minAgeYears') from public.consultation_policy_config where is_active));
  perform pg_temp.rec('a consultation costs NGN 10,000 (1,000,000 kobo, OQ-130)', '1000000', (select price_kobo::text from public.service_products where code = 'video_visit_credit'));
  perform pg_temp.rec('five S21 encounter event types exist', '5', (select count(*)::text from public.event_types where owner_section = 'S21' and event_type like 'encounter.%'));

  -- 2. Adults only --------------------------------------------------------------------------------------------
  perform pg_temp.act(v_minor);
  perform pg_temp.rec('a 15 year old cannot hold a remote consultation', 'P0001',
    pg_temp.try(format('select public.hold_appointment_slot(%L, %L, ''telemedicine'', ''telemedicine'', %L, %L)', v_org, v_docA, v_start, v_start + interval '30 minutes')));
  perform pg_temp.back();
  perform pg_temp.act(v_nodob);
  perform pg_temp.rec('a patient with no date of birth cannot hold one (fail closed)', 'P0001',
    pg_temp.try(format('select public.hold_appointment_slot(%L, %L, ''telemedicine'', ''telemedicine'', %L, %L)', v_org, v_docA, v_start, v_start + interval '30 minutes')));
  perform pg_temp.back();
  perform pg_temp.rec('nothing was held for either of them', '0',
    (select count(*)::text from public.appointments where patient_id in (v_minor, v_nodob)));

  v_cr1 := pg_temp.mkcredit(v_adult);
  v_a1 := pg_temp.book(v_adult, v_docA, v_start);
  perform pg_temp.rec('control: an adult books and the booking is confirmed with the credit', 'confirmed/paid',
    (select status::text || '/' || payment_status::text from public.appointments where id = v_a1));
  select id into v_e1 from public.encounters where appointment_id = v_a1;
  perform pg_temp.rec('confirming created exactly one encounter', '1', (select count(*)::text from public.encounters where appointment_id = v_a1));
  perform pg_temp.rec('the encounter is a video consultation for the clinician, on policy v1, marked test', 'video/true/1/true',
    (select type || '/' || (clinician_id = v_docA)::text || '/' || policy_version::text || '/' || is_test::text from public.encounters where id = v_e1));
  perform pg_temp.rec('the encounter points at the credit that paid for it', 'true', (select (service_purchase_id = v_cr1)::text from public.encounters where id = v_e1));
  perform pg_temp.rec('a room stub exists and recording is off', '1/false', (select count(*)::text || '/' || bool_or(recording_enabled)::text from public.encounter_rooms where encounter_id = v_e1));
  perform pg_temp.rec('encounter.scheduled was emitted once', '1', (select count(*)::text from public.domain_events where event_type = 'encounter.scheduled' and aggregate_id = v_e1));

  -- 3. The room -----------------------------------------------------------------------------------------------
  perform pg_temp.rec('recording cannot be switched on', '23514', pg_temp.try(format('update public.encounter_rooms set recording_enabled = true where encounter_id = %L', v_e1)));
  perform pg_temp.rec('no encounter column holds a join or host URL', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name in ('encounters', 'encounter_rooms', 'encounter_events', 'scribe_consents') and column_name ~ 'url'));
  perform pg_temp.rec('an event cannot be edited', '23514', pg_temp.try(format('update public.encounter_events set kind = ''left'' where encounter_id = %L', v_e1)));
  perform pg_temp.rec('an event cannot be deleted', '23514', pg_temp.try(format('delete from public.encounter_events where encounter_id = %L', v_e1)));
  perform pg_temp.rec('one encounter per appointment', '23505',
    pg_temp.try(format('insert into public.encounters (organisation_id, patient_id, type, scheduled_at, appointment_id, policy_version) values (%L, %L, ''video'', now(), %L, 1)', v_org, v_adult, v_a1)));

  -- 4. Access -------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_adult);
  perform pg_temp.rec('the patient reads their own encounter', '1', (select count(*)::text from public.encounters where id = v_e1));
  perform pg_temp.rec('...and its events', 'true', (select (count(*) >= 1)::text from public.encounter_events where encounter_id = v_e1));
  perform pg_temp.rec('...but never the provider room reference', '0', (select count(*)::text from public.encounter_rooms where encounter_id = v_e1));
  perform pg_temp.rec('a patient cannot insert an encounter directly', '42501',
    pg_temp.try(format('insert into public.encounters (organisation_id, patient_id, type, scheduled_at, policy_version) values (%L, %L, ''video'', now(), 1)', v_org, v_adult)));
  perform pg_temp.rec('a patient cannot edit a scribe consent row directly', '42501', pg_temp.try(format('update public.scribe_consents set granted = true where encounter_id = %L', v_e1)));
  perform pg_temp.rec('a patient cannot delete an event', '42501', pg_temp.try(format('delete from public.encounter_events where encounter_id = %L', v_e1)));
  perform pg_temp.back();
  perform pg_temp.act(v_stranger);
  perform pg_temp.rec('a stranger reads no encounter', '0', (select count(*)::text from public.encounters where id = v_e1));
  perform pg_temp.rec('...no event', '0', (select count(*)::text from public.encounter_events where encounter_id = v_e1));
  perform pg_temp.rec('...and cannot report an event', '42501', pg_temp.try(format('select public.report_encounter_event(%L, ''joined'')', v_e1)));
  perform pg_temp.back();
  perform pg_temp.act(v_docB);
  perform pg_temp.rec('another clinician reads no encounter (INV-12)', '0', (select count(*)::text from public.encounters where id = v_e1));
  perform pg_temp.back();
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('the assigned clinician reads it', '1', (select count(*)::text from public.encounters where id = v_e1));
  perform pg_temp.rec('...and the room reference', '1', (select count(*)::text from public.encounter_rooms where encounter_id = v_e1));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('admin reads it', '1', (select count(*)::text from public.encounters where id = v_e1));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot read encounters', '42501', pg_temp.try('select count(*) from public.encounters'));
  perform pg_temp.back();

  -- 5. Scribe consent -----------------------------------------------------------------------------------------
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('a clinician cannot answer the consent prompt for the patient', '42501', pg_temp.try(format('select public.record_scribe_consent(%L, true)', v_e1)));
  perform pg_temp.rec('...nor open it', '42501', pg_temp.try(format('select public.open_scribe_prompt(%L)', v_e1)));
  perform pg_temp.rec('scribe may not start with no answer', 'false', public.scribe_may_start(v_e1)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_stranger);
  perform pg_temp.rec('a stranger cannot open the prompt', '42501', pg_temp.try(format('select public.open_scribe_prompt(%L)', v_e1)));
  perform pg_temp.back();
  perform pg_temp.act(v_adult);
  perform pg_temp.rec('the patient is asked: a row exists, unanswered', 'null/true', (select coalesce(granted::text, 'null') || '/' || (asked_at is not null)::text from public.open_scribe_prompt(v_e1)));
  perform pg_temp.rec('the patient grants', 'true', (select granted::text from public.record_scribe_consent(v_e1, true)));
  perform pg_temp.rec('a null answer is refused', '22023', pg_temp.try(format('select public.record_scribe_consent(%L, null)', v_e1)));
  perform pg_temp.back();
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('granted but the consultation is not live yet: scribe may not start', 'false', public.scribe_may_start(v_e1)::text);
  perform pg_temp.back();

  -- 6. The live path ------------------------------------------------------------------------------------------
  perform pg_temp.act(v_adult);
  perform pg_temp.rec('an unknown event kind cannot be reported', '22023', pg_temp.try(format('select public.report_encounter_event(%L, ''completed'')', v_e1)));
  perform pg_temp.rec('a person cannot report their own join (only the server records it)', '22023', pg_temp.try(format('select public.report_encounter_event(%L, ''joined'')', v_e1)));
  perform pg_temp.rec('...nor put the consultation on the phone from the app', '22023', pg_temp.try(format('select public.report_encounter_event(%L, ''mode_changed'', ''{"mode":"phone"}'')', v_e1)));
  perform pg_temp.back();
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('a clinician cannot report their own join either', '22023', pg_temp.try(format('select public.report_encounter_event(%L, ''joined'')', v_e1)));
  perform pg_temp.back();
  perform pg_temp.act_service();
  perform pg_temp.rec('the server refuses a join outside the window (this one is 3 days away)', 'P0001', pg_temp.try(format('select public.service_record_join(%L, ''patient'')', v_e1)));
  perform pg_temp.rec('...and an unknown role', '22023', pg_temp.try(format('select public.service_record_join(%L, ''admin'')', v_e1)));
  perform pg_temp.back();
  update public.encounters set scheduled_at = now() + interval '5 minutes' where id = v_e1;  -- fixture: bring it inside the window
  perform pg_temp.rec('the patient joins: waiting', 'waiting', pg_temp.join_as(v_e1, 'patient'));
  v_res := pg_temp.join_as(v_e1, 'clinician');
  perform pg_temp.rec('the clinician joins: in progress, start stamped', 'in_progress/true',
    v_res || '/' || (select (started_at is not null)::text from public.encounters where id = v_e1));
  perform pg_temp.rec('the appointment follows', 'in_progress', (select status::text from public.appointments where id = v_a1));
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('scribe may now start for the assigned clinician', 'true', public.scribe_may_start(v_e1)::text);
  perform pg_temp.back();
  perform pg_temp.rec('encounter.started was emitted once', '1', (select count(*)::text from public.domain_events where event_type = 'encounter.started' and aggregate_id = v_e1));
  perform pg_temp.act(v_adult);
  perform pg_temp.rec('the patient cannot ask for the scribe', 'false', public.scribe_may_start(v_e1)::text);
  perform pg_temp.rec('a bad mode is refused', '22023', pg_temp.try(format('select public.report_encounter_event(%L, ''mode_changed'', ''{"mode":"hologram"}'')', v_e1)));
  perform pg_temp.rec('dropping to audio only counts one fallback step', 'audio_only/1',
    (select final_media_mode || '/' || fallback_steps::text from public.report_encounter_event(v_e1, 'mode_changed', '{"mode":"audio_only","bitrate_kbps":60,"full_name":"Should Not Be Kept"}'::jsonb)));
  perform pg_temp.rec('only whitelisted keys are stored (no name)', 'false',
    (select (payload ? 'full_name')::text from public.encounter_events where encounter_id = v_e1 and kind = 'mode_changed' order by created_at desc limit 1));
  perform pg_temp.rec('the bitrate was kept', '60', (select payload ->> 'bitrate_kbps' from public.encounter_events where encounter_id = v_e1 and kind = 'mode_changed' order by created_at desc limit 1));
  perform pg_temp.rec('the patient withdraws scribe consent', 'false', (select granted::text from public.record_scribe_consent(v_e1, false)));
  perform pg_temp.back();
  perform pg_temp.rec('the withdrawal is logged once', '1', (select count(*)::text from public.encounter_events where encounter_id = v_e1 and kind = 'scribe_consent_changed'));
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('after withdrawal scribe may not start', 'false', public.scribe_may_start(v_e1)::text);
  perform pg_temp.back();
  perform pg_temp.rec('encounter.fallback was emitted', '1', (select count(*)::text from public.domain_events where event_type = 'encounter.fallback' and aggregate_id = v_e1));
  perform pg_temp.act(v_adult);
  perform pg_temp.rec('a patient cannot complete a consultation', '42501', pg_temp.try(format('select public.complete_encounter(%L)', v_e1)));
  perform pg_temp.back();
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('the clinician completes it', 'completed/true', (select status || '/' || (ended_at is not null)::text from public.complete_encounter(v_e1)));
  perform pg_temp.back();
  perform pg_temp.rec('the appointment is completed', 'completed', (select status::text from public.appointments where id = v_a1));
  perform pg_temp.rec('encounter.completed was emitted once', '1', (select count(*)::text from public.domain_events where event_type = 'encounter.completed' and aggregate_id = v_e1));
  perform pg_temp.act(v_adult);
  perform pg_temp.rec('a finished consultation takes no more events', 'P0001', pg_temp.try(format('select public.report_encounter_event(%L, ''left'')', v_e1)));
  perform pg_temp.back();

  -- 7. Cancellation -------------------------------------------------------------------------------------------
  v_cr2 := pg_temp.mkcredit(v_adult2);
  v_a2 := pg_temp.book(v_adult2, v_docA, v_start + interval '1 day');
  perform pg_temp.rec('the credit is spent when the booking is confirmed', 'true', pg_temp.credit_redeemed(v_cr2));
  perform pg_temp.act(v_adult2);
  perform pg_temp.rec('a patient cancelling 3 days ahead gets the credit back (status)', 'patient_cancelled/refunded', (select status::text || '/' || payment_status::text from public.cancel_appointment(v_a2, 'plans changed')));
  perform pg_temp.back();
  perform pg_temp.rec('...the credit is free to use again', 'false', pg_temp.credit_redeemed(v_cr2));
  perform pg_temp.rec('...the encounter is cancelled', 'cancelled', (select status from public.encounters where appointment_id = v_a2));
  perform pg_temp.rec('...and a credit_returned event was logged', '1', (select count(*)::text from public.encounter_events ev join public.encounters en on en.id = ev.encounter_id where en.appointment_id = v_a2 and ev.kind = 'credit_returned'));

  v_cr3 := pg_temp.mkcredit(v_adult3);
  v_a3 := pg_temp.book(v_adult3, v_docB, now() + interval '1 hour');
  perform pg_temp.act(v_adult3);
  perform pg_temp.rec('a patient cancelling 1 hour ahead keeps the credit spent', 'patient_cancelled/paid', (select status::text || '/' || payment_status::text from public.cancel_appointment(v_a3, 'running late')));
  perform pg_temp.back();
  perform pg_temp.rec('...the credit stays redeemed', 'true', pg_temp.credit_redeemed(v_cr3));

  v_cr4 := pg_temp.mkcredit(v_adult4);
  v_a4 := pg_temp.book(v_adult4, v_docB, now() + interval '90 minutes');
  perform pg_temp.act(v_docB);
  perform pg_temp.rec('a clinician cancelling 90 minutes ahead returns the credit', 'provider_cancelled/refunded', (select status::text || '/' || payment_status::text from public.cancel_appointment(v_a4, 'unwell')));
  perform pg_temp.back();
  perform pg_temp.rec('...the credit is free again', 'false', pg_temp.credit_redeemed(v_cr4));
  perform pg_temp.rec('cancelling twice is refused', 'P0001', pg_temp.try(format('select public.cancel_appointment(%L)', v_a4)));

  -- 8. No-shows -----------------------------------------------------------------------------------------------
  v_cr5 := pg_temp.mkcredit(v_adult2);
  v_a5 := pg_temp.book(v_adult2, v_docA, v_start + interval '2 days');
  select id into v_e5 from public.encounters where appointment_id = v_a5;
  perform pg_temp.rec('the booking spent one credit', '1', pg_temp.credits_on(v_a5));
  perform pg_temp.act(v_adult2);
  perform pg_temp.rec('reporting a clinician no-show before the wait is refused', 'P0001', pg_temp.try(format('select public.mark_encounter_no_show(%L)', v_e5)));
  perform pg_temp.back();
  update public.encounters set scheduled_at = now() - interval '30 minutes' where id = v_e5;
  perform pg_temp.act(v_adult2);
  perform pg_temp.rec('after the wait the patient reports a clinician no-show', 'no_show_clinician', (select status from public.mark_encounter_no_show(v_e5)));
  perform pg_temp.back();
  perform pg_temp.rec('...the credit is returned', '0', pg_temp.credits_on(v_a5));
  perform pg_temp.rec('...the appointment is cancelled by the provider side', 'provider_cancelled', (select status::text from public.appointments where id = v_a5));
  perform pg_temp.rec('encounter.no_show was emitted', '1', (select count(*)::text from public.domain_events where event_type = 'encounter.no_show' and aggregate_id = v_e5));
  perform pg_temp.rec('a clinician no-show tells the patient, with the credit back, and nothing else', '1/true',
    (select count(*)::text || '/' || bool_and((payload ->> 'credit_returned') = 'true' and (select count(*) from jsonb_object_keys(payload)) = 2)::text from public.notifications where recipient_id = v_adult2 and template = 'consult_missed' and payload ->> 'encounter_id' = v_e5::text));

  v_cr6 := pg_temp.mkcredit(v_adult4);
  v_a6 := pg_temp.book(v_adult4, v_docA, v_start + interval '2 days' + interval '2 hours');
  select id into v_e6 from public.encounters where appointment_id = v_a6;
  update public.encounters set scheduled_at = now() - interval '30 minutes' where id = v_e6;
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('the clinician marks a patient no-show after the wait', 'no_show_patient', (select status from public.mark_encounter_no_show(v_e6)));
  perform pg_temp.back();
  perform pg_temp.rec('...the credit stays spent', '1', pg_temp.credits_on(v_a6));
  perform pg_temp.rec('...the appointment is a no-show', 'no_show', (select status::text from public.appointments where id = v_a6));
  perform pg_temp.rec('a patient no-show tells the patient, credit not returned', '1/true',
    (select count(*)::text || '/' || bool_and((payload ->> 'credit_returned') = 'false')::text from public.notifications where recipient_id = v_adult4 and template = 'consult_missed' and payload ->> 'encounter_id' = v_e6::text));

  -- 8b. Service functions (part 2): the join window, open the room once, record events -------------------------
  perform pg_temp.mkcredit(v_adult);
  v_a7 := pg_temp.book(v_adult, v_docA, now() + interval '10 minutes');
  select id into v_e7 from public.encounters where appointment_id = v_a7;
  perform pg_temp.mkcredit(v_adult3);
  v_a8 := pg_temp.book(v_adult3, v_docA, v_start + interval '7 days');
  select id into v_e8 from public.encounters where appointment_id = v_a8;

  perform pg_temp.rec('the clinician opens the room first: waiting', 'waiting', pg_temp.join_as(v_e7, 'clinician'));
  perform pg_temp.rec('...and joining again does not repeat the notice', 'waiting', pg_temp.join_as(v_e7, 'clinician'));
  perform pg_temp.rec('the patient got one neutral room-open notice, in app, no SMS', '1/true',
    (select count(*)::text || '/' || bool_and(channel::text <> 'sms' and content_class = 'non_clinical')::text from public.notifications where recipient_id = v_adult and template = 'consult_join_ready' and payload ->> 'encounter_id' = v_e7::text));
  perform pg_temp.rec('the notice carries only the encounter id', 'encounter_id', (select string_agg(k, ',') from public.notifications n, jsonb_object_keys(n.payload) k where n.recipient_id = v_adult and n.template = 'consult_join_ready' and n.payload ->> 'encounter_id' = v_e7::text));
  perform pg_temp.rec('a patient who joined first got no room-open notice for that visit', '0',
    (select count(*)::text from public.notifications where template = 'consult_join_ready' and payload ->> 'encounter_id' = v_e1::text));

  perform pg_temp.act(v_adult);
  perform pg_temp.rec('a signed-in patient cannot call the room lookup', '42501', pg_temp.try(format('select public.service_get_encounter_room(%L)', v_e7)));
  perform pg_temp.rec('...nor open a room', '42501', pg_temp.try(format('select public.service_open_encounter_room(%L, ''mock'', ''room_x'', now() + interval ''1 hour'')', v_e7)));
  perform pg_temp.rec('...nor record a service event', '42501', pg_temp.try(format('select public.service_record_encounter_event(%L, ''phone_connected'', ''system'')', v_e7)));
  perform pg_temp.back();
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('a clinician cannot call them either', '42501', pg_temp.try(format('select public.service_get_encounter_room(%L)', v_e7)));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot call them', '42501', pg_temp.try(format('select public.service_get_encounter_room(%L)', v_e7)));
  perform pg_temp.back();

  perform pg_temp.act_service();
  perform pg_temp.rec('a consultation starting in 10 minutes is joinable, with no room yet', 'true/true',
    (public.service_get_encounter_room(v_e7) ->> 'joinable') || '/' || ((public.service_get_encounter_room(v_e7) -> 'room' ->> 'provider_room_id') is null)::text);
  perform pg_temp.rec('one starting in 7 days is not joinable yet', 'false', public.service_get_encounter_room(v_e8) ->> 'joinable');
  perform pg_temp.rec('a completed consultation is not joinable', 'false', public.service_get_encounter_room(v_e1) ->> 'joinable');
  perform pg_temp.rec('a cancelled one is not joinable', 'false', public.service_get_encounter_room((select id from public.encounters where appointment_id = v_a2)) ->> 'joinable');
  perform pg_temp.rec('an unknown encounter answers null', 'true', (public.service_get_encounter_room(gen_random_uuid()) is null)::text);
  perform pg_temp.rec('the lookup never carries a join or host URL', 'false', (public.service_get_encounter_room(v_e7)::text ~ 'https?://')::text);
  v_room := public.service_open_encounter_room(v_e7, 'mock', 'room_first', now() + interval '40 minutes');
  perform pg_temp.rec('the first call opens the room', 'true/room_first/open', (v_room ->> 'created') || '/' || (v_room ->> 'provider_room_id') || '/' || (v_room ->> 'state'));
  v_room := public.service_open_encounter_room(v_e7, 'mock', 'room_second', now() + interval '40 minutes');
  perform pg_temp.rec('a second call returns the first room and says it did not create one', 'false/room_first', (v_room ->> 'created') || '/' || (v_room ->> 'provider_room_id'));
  perform pg_temp.rec('an unknown provider is refused', '22023', pg_temp.try(format('select public.service_open_encounter_room(%L, ''bogus'', ''r'', now())', v_e8)));
  perform pg_temp.rec('an empty room id is refused', '22023', pg_temp.try(format('select public.service_open_encounter_room(%L, ''zoom'', '''', now())', v_e8)));
  perform pg_temp.rec('opening a room for no encounter is refused', 'P0002', pg_temp.try(format('select public.service_open_encounter_room(%L, ''zoom'', ''r'', now())', gen_random_uuid())));
  perform public.service_record_encounter_event(v_e7, 'phone_connected', 'system', '{"mode":"phone","full_name":"Nope","bitrate_kbps":0}'::jsonb);
  perform pg_temp.rec('a service event is logged with only the whitelisted keys', 'phone/false',
    (select (payload ->> 'mode') || '/' || (payload ? 'full_name')::text from public.encounter_events where encounter_id = v_e7 and kind = 'phone_connected'));
  perform pg_temp.rec('a join cannot be written as a plain service event', '22023', pg_temp.try(format('select public.service_record_encounter_event(%L, ''joined'', ''system'')', v_e7)));
  perform pg_temp.rec('a service event cannot be a completion', '22023', pg_temp.try(format('select public.service_record_encounter_event(%L, ''completed'', ''system'')', v_e7)));
  perform pg_temp.rec('...nor have an unknown actor', '22023', pg_temp.try(format('select public.service_record_encounter_event(%L, ''left'', ''admin'')', v_e7)));
  perform pg_temp.rec('...nor target an unknown encounter', 'P0002', pg_temp.try(format('select public.service_record_encounter_event(%L, ''left'', ''system'')', gen_random_uuid())));
  perform pg_temp.back();

  -- 8c. Read functions (part 3): the room view and the two lists ---------------------------------------------------
  perform pg_temp.mkcredit(v_adult2);
  v_a9 := pg_temp.book(v_adult2, v_docB, now() + interval '3 hours');
  select id into v_e9 from public.encounters where appointment_id = v_a9;

  perform pg_temp.act(v_adult);
  v_view := public.consultation_room_view(v_e7);
  perform pg_temp.rec('the patient sees their role, the join window open, and the scribe not yet asked', 'patient/true/false',
    (v_view ->> 'role') || '/' || (v_view ->> 'joinable') || '/' || (v_view -> 'scribe' ->> 'asked'));
  perform pg_temp.rec('...and that the clinician is already in', 'true/false', (v_view ->> 'clinician_joined') || '/' || (v_view ->> 'patient_joined'));
  perform pg_temp.rec('...but cannot report the clinician absent yet', 'false', v_view ->> 'can_report_clinician_absent');
  perform pg_temp.rec('the patient is not told the older consultation id', 'true', ((v_view -> 'video_consultation_id') = 'null'::jsonb)::text);
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('the clinician is, so the notes screen stays reachable', 'true', ((public.consultation_room_view(v_e7) ->> 'video_consultation_id')::uuid = (select video_consultation_id from public.encounters where id = v_e7))::text);
  perform pg_temp.back();
  perform pg_temp.act(v_adult);
  perform pg_temp.rec('a stranger-owned consultation answers null', 'true', (public.consultation_room_view(v_e9) is null)::text);
  perform pg_temp.rec('an unknown id answers null, the same as a stranger', 'true', (public.consultation_room_view(gen_random_uuid()) is null)::text);
  perform pg_temp.rec('the view carries no join or host URL', 'false', (v_view::text ~ 'https?://')::text);
  perform pg_temp.rec('upcoming lists the patient''s one coming consultation and not the finished or cancelled ones', '1',
    (select count(*)::text from jsonb_array_elements(public.my_upcoming_encounters()) x
      where (x ->> 'encounter_id')::uuid in (v_e1, v_e7, v_e8, (select id from public.encounters where appointment_id = v_a2))));
  perform pg_temp.back();
  perform pg_temp.act(v_stranger);
  perform pg_temp.rec('a stranger''s upcoming list is empty', '0', jsonb_array_length(public.my_upcoming_encounters())::text);
  perform pg_temp.rec('a stranger cannot view the room', 'true', (public.consultation_room_view(v_e7) is null)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_docB);
  perform pg_temp.rec('another clinician cannot view the room', 'true', (public.consultation_room_view(v_e7) is null)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_adult2);
  perform pg_temp.rec('a patient cannot view someone else''s room', 'true', (public.consultation_room_view(v_e7) is null)::text);
  perform pg_temp.back();

  -- nobody has joined e9, so move its start time 30 minutes into the past (a fixture, as the no-show checks above do)
  update public.encounters set scheduled_at = now() - interval '30 minutes' where id = v_e9;
  perform pg_temp.act(v_adult2);
  perform pg_temp.rec('after the wait the patient can report the clinician absent', 'true/false',
    (public.consultation_room_view(v_e9) ->> 'can_report_clinician_absent') || '/' || (public.consultation_room_view(v_e9) ->> 'can_report_patient_absent'));
  perform pg_temp.back();
  perform pg_temp.act(v_docB);
  perform pg_temp.rec('...and the clinician can mark the patient absent, not the reverse', 'true/false',
    (public.consultation_room_view(v_e9) ->> 'can_report_patient_absent') || '/' || (public.consultation_room_view(v_e9) ->> 'can_report_clinician_absent'));
  perform pg_temp.back();
  perform pg_temp.join_as(v_e9, 'clinician');
  perform pg_temp.act(v_adult2);
  perform pg_temp.rec('once the clinician has joined, "nobody came" is no longer offered', 'false', public.consultation_room_view(v_e9) ->> 'can_report_clinician_absent');
  perform pg_temp.back();

  perform pg_temp.act(v_docA);
  perform pg_temp.rec('the clinician''s list holds their own consultation today, with a first name only', 'true/S21/false',
    (select (count(*) = 1)::text || '/' || max(x ->> 'patient_first_name') || '/' || bool_or((x ? 'full_name') or (x ? 'phone'))::text
       from jsonb_array_elements(public.my_clinician_encounters()) x where (x ->> 'encounter_id')::uuid = v_e7));
  perform pg_temp.rec('...and not a consultation 7 days out', '0',
    (select count(*)::text from jsonb_array_elements(public.my_clinician_encounters()) x where (x ->> 'encounter_id')::uuid = v_e8));
  perform pg_temp.rec('...and none of another clinician''s', '0',
    (select count(*)::text from jsonb_array_elements(public.my_clinician_encounters()) x where (x ->> 'encounter_id')::uuid = v_e9));
  perform pg_temp.rec('a wider range reaches the later one', '1',
    (select count(*)::text from jsonb_array_elements(public.my_clinician_encounters(now(), now() + interval '12 days')) x where (x ->> 'encounter_id')::uuid = v_e8));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot call the read functions', '42501', pg_temp.try('select public.my_upcoming_encounters()'));
  perform pg_temp.back();

  -- 8d. Encounter, credit and legacy row stay in step; server-only phone mode; the older booking path -----------------
  -- a paid consultation that is rescheduled keeps its credit and gets a fresh room; the old room stops
  perform pg_temp.mkcredit(v_adult4);
  v_a10 := pg_temp.book(v_adult4, v_docB, v_start + interval '9 days');
  select id into v_e10 from public.encounters where appointment_id = v_a10;
  perform pg_temp.open_time(v_docB, v_start + interval '10 days');
  perform pg_temp.act(v_adult4);
  perform pg_temp.rec('a consultation cannot be moved to time that is not open', 'P0001',
    pg_temp.try(format('select public.reschedule_appointment(%L, %L, %L)', v_a10, v_start + interval '11 days', v_start + interval '11 days' + interval '30 minutes')));
  select id into v_a11 from public.reschedule_appointment(v_a10, v_start + interval '10 days', v_start + interval '10 days' + interval '30 minutes');
  perform pg_temp.back();
  perform pg_temp.rec('a paid consultation stays confirmed and paid when it is moved', 'confirmed/paid', (select status::text || '/' || payment_status::text from public.appointments where id = v_a11));
  perform pg_temp.rec('the old booking is rescheduled', 'rescheduled', (select status::text from public.appointments where id = v_a10));
  perform pg_temp.rec('the credit moved with it', '0/1', pg_temp.credits_on(v_a10) || '/' || pg_temp.credits_on(v_a11));
  perform pg_temp.rec('the old encounter is cancelled and the new booking has exactly one', 'cancelled/1',
    (select status from public.encounters where id = v_e10) || '/' || (select count(*)::text from public.encounters where appointment_id = v_a11));
  perform pg_temp.rec('the new encounter has a room stub and the consultation row travelled with it', '1/true',
    (select count(*)::text from public.encounter_rooms r join public.encounters en on en.id = r.encounter_id where en.appointment_id = v_a11) || '/' ||
    (select (a.video_consultation_id is not null and a.video_consultation_id = en.video_consultation_id)::text from public.appointments a join public.encounters en on en.appointment_id = a.id where a.id = v_a11));
  update public.encounters set scheduled_at = now() - interval '30 minutes' where id = v_e10;  -- fixture: the old time has passed
  perform pg_temp.act(v_adult4);
  perform pg_temp.rec('reporting the old room as a no-show is refused (the free-credit trick)', 'P0001', pg_temp.try(format('select public.mark_encounter_no_show(%L)', v_e10)));
  perform pg_temp.back();
  perform pg_temp.rec('...and the credit is still spent on the booking that stands', '1', pg_temp.credits_on(v_a11));
  perform pg_temp.act_service();
  perform pg_temp.rec('the old room cannot be joined', 'P0001', pg_temp.try(format('select public.service_record_join(%L, ''patient'')', v_e10)));
  perform pg_temp.back();

  -- a provider's leave gives the credit back, cancels the encounter and leaves no live room
  perform pg_temp.mkcredit(v_adult3);
  v_a12 := pg_temp.book(v_adult3, v_docB, v_start + interval '12 days');
  select id into v_e12 from public.encounters where appointment_id = v_a12;
  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (v_org, v_docB, 'leave', v_start + interval '12 days' - interval '1 hour', v_start + interval '12 days' + interval '2 hours', 'proof');
  perform pg_temp.rec('a provider leave cancels the booking and gives the credit back', 'provider_cancelled/refunded/0',
    (select status::text || '/' || payment_status::text from public.appointments where id = v_a12) || '/' || pg_temp.credits_on(v_a12));
  perform pg_temp.rec('...and cancels the encounter', 'cancelled', (select status from public.encounters where id = v_e12));
  perform pg_temp.act_service();
  perform pg_temp.rec('...so nobody can join it', 'false', public.service_get_encounter_room(v_e12) ->> 'joinable');
  perform pg_temp.back();

  -- staff moving the appointment through the older screens moves the consultation with it
  perform pg_temp.mkcredit(v_adult);
  v_a13 := pg_temp.book(v_adult, v_docB, now() + interval '4 hours');
  select id into v_e13 from public.encounters where appointment_id = v_a13;
  perform pg_temp.act(v_admin);
  perform public.advance_appointment_status(v_a13, 'no_show', 'clinician_no_show');
  perform pg_temp.back();
  perform pg_temp.rec('staff marking a clinician no-show moves the encounter and returns the credit', 'no_show_clinician/refunded/0',
    (select status from public.encounters where id = v_e13) || '/' || (select payment_status::text from public.appointments where id = v_a13) || '/' || pg_temp.credits_on(v_a13));
  perform pg_temp.mkcredit(v_adult);
  v_a14 := pg_temp.book(v_adult, v_docB, now() + interval '5 hours');
  select id into v_e14 from public.encounters where appointment_id = v_a14;
  perform pg_temp.act(v_admin);
  perform public.advance_appointment_status(v_a14, 'completed');
  perform pg_temp.back();
  perform pg_temp.rec('staff completing the appointment completes the encounter', 'completed', (select status from public.encounters where id = v_e14));

  -- only the server puts a consultation on the phone, and only once
  perform pg_temp.act_service();
  perform public.service_set_phone_mode(v_e7);
  perform public.service_set_phone_mode(v_e7);
  perform pg_temp.back();
  perform pg_temp.rec('the server puts a consultation on the phone, counted once', 'phone/1', (select final_media_mode || '/' || fallback_steps::text from public.encounters where id = v_e7));
  perform pg_temp.rec('encounter.fallback was emitted for it', 'true', ((select count(*) from public.domain_events where event_type = 'encounter.fallback' and aggregate_id = v_e7) >= 1)::text);
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('a clinician cannot call it', '42501', pg_temp.try(format('select public.service_set_phone_mode(%L)', v_e7)));
  perform pg_temp.back();

  -- the no-show wait fails closed when no policy is active
  perform pg_temp.mkcredit(v_adult2);
  v_a15 := pg_temp.book(v_adult2, v_docB, now() + interval '7 hours');
  select id into v_e15 from public.encounters where appointment_id = v_a15;
  update public.encounters set scheduled_at = now() - interval '30 minutes' where id = v_e15;
  update public.consultation_policy_config set is_active = false;
  perform pg_temp.act(v_adult2);
  perform pg_temp.rec('with no active policy a no-show cannot be marked', 'P0001', pg_temp.try(format('select public.mark_encounter_no_show(%L)', v_e15)));
  perform pg_temp.back();
  perform pg_temp.act_service();
  perform pg_temp.rec('...nor a join recorded', 'P0001', pg_temp.try(format('select public.service_record_join(%L, ''patient'')', v_e15)));
  perform pg_temp.back();
  update public.consultation_policy_config set is_active = true where version = 1;

  -- the adults-only rule covers the older video-visit booking path too, however the row is made
  perform pg_temp.rec('the older video-visit path refuses a minor', 'P0001',
    pg_temp.try(format('insert into public.video_visit_requests (organisation_id, patient_id, slot_id) values (%L, %L, %L)', v_org, v_minor, gen_random_uuid())));
  perform pg_temp.rec('...and a patient with no date of birth', 'P0001',
    pg_temp.try(format('insert into public.video_visit_requests (organisation_id, patient_id, slot_id) values (%L, %L, %L)', v_org, v_nodob, gen_random_uuid())));
  perform pg_temp.rec('...but an adult gets past the age check (and stops at the missing slot)', '23503',
    pg_temp.try(format('insert into public.video_visit_requests (organisation_id, patient_id, slot_id) values (%L, %L, %L)', v_org, v_adult, gen_random_uuid())));

  -- 8e. Booking comes from confirmed bookable time, and the listing shows exactly that ---------------------------------
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, languages, license_verified_at, license_expires_at, specialty, indemnity_exempt, indemnity_exempt_by)
  values (v_org, v_docA, 'S21 doctor-a', true, true, array['en', 'pcm'], now() - interval '10 days', now() + interval '1 year', 'General practice', true, v_admin),
         (v_org, v_docB, 'S21 doctor-b', true, true, array['en'], now() - interval '3 days', now() + interval '1 year', 'General practice', true, v_admin);
  perform pg_temp.act(v_adult);
  perform pg_temp.rec('a consultation cannot be held at a time no block opens', 'P0001',
    pg_temp.try(format('select public.hold_appointment_slot(%L, %L, ''telemedicine'', ''telemedicine'', %L, %L)', v_org, v_docA, v_start + interval '20 days', v_start + interval '20 days' + interval '30 minutes')));
  perform pg_temp.back();
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
  values (v_org, v_docA, v_start + interval '20 days', v_start + interval '20 days' + interval '2 hours', 'bookable_consultations', 'declared', true);
  perform pg_temp.act(v_adult);
  perform pg_temp.rec('...nor from a block that is only declared, not confirmed', 'P0001',
    pg_temp.try(format('select public.hold_appointment_slot(%L, %L, ''telemedicine'', ''telemedicine'', %L, %L)', v_org, v_docA, v_start + interval '20 days', v_start + interval '20 days' + interval '30 minutes')));
  perform pg_temp.back();
  update public.availability_blocks set state = 'cancelled' where clinician_id = v_docA and state = 'declared' and starts_at = v_start + interval '20 days';

  -- a confirmed 2 hour block 5 days out gives four 30 minute slots
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
  values (v_org, v_docA, v_start + interval '5 days', v_start + interval '5 days' + interval '2 hours', 'bookable_consultations', 'confirmed', true);
  perform pg_temp.act(v_adult);
  perform pg_temp.rec('the listing shows the four open slots with the clinician and a current licence', '4/General practice/true',
    (select count(*)::text || '/' || max(x ->> 'specialty') || '/' || bool_and((x ->> 'licence_current')::boolean)::text
       from jsonb_array_elements(public.list_bookable_consult_slots(v_start + interval '5 days' - interval '1 hour', v_start + interval '6 days')) x where (x ->> 'clinician_id')::uuid = v_docA));
  perform pg_temp.rec('a language filter keeps only clinicians who speak it', '4/0',
    (select count(*)::text from jsonb_array_elements(public.list_bookable_consult_slots(v_start + interval '5 days' - interval '1 hour', v_start + interval '6 days', 'pcm')) x where (x ->> 'clinician_id')::uuid = v_docA)
    || '/' || (select count(*)::text from jsonb_array_elements(public.list_bookable_consult_slots(v_start + interval '5 days' - interval '1 hour', v_start + interval '6 days', 'yo')) x where (x ->> 'clinician_id')::uuid = v_docA));
  perform pg_temp.rec('the listing carries no phone number, link or email', 'false',
    (public.list_bookable_consult_slots(v_start + interval '5 days' - interval '1 hour', v_start + interval '6 days')::text ~ '(https?://|@|\+234)')::text);
  perform pg_temp.back();
  -- one slot is taken: it leaves the list, the others stay
  perform pg_temp.mkcredit(v_adult);
  perform pg_temp.book(v_adult, v_docA, v_start + interval '5 days' + interval '30 minutes');
  perform pg_temp.act(v_adult2);
  perform pg_temp.rec('a booked slot leaves the list and the others stay', '3/false',
    (select count(*)::text from jsonb_array_elements(public.list_bookable_consult_slots(v_start + interval '5 days' - interval '1 hour', v_start + interval '6 days')) x where (x ->> 'clinician_id')::uuid = v_docA)
    || '/' || (select bool_or((x ->> 'slot_start')::timestamptz = v_start + interval '5 days' + interval '30 minutes')::text from jsonb_array_elements(public.list_bookable_consult_slots(v_start + interval '5 days' - interval '1 hour', v_start + interval '6 days')) x where (x ->> 'clinician_id')::uuid = v_docA));
  perform pg_temp.back();
  -- leave removes the slots it covers; a patient the clinician has a conflict with sees none of that clinician's time
  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (v_org, v_docA, 'blocked', v_start + interval '5 days' + interval '60 minutes', v_start + interval '5 days' + interval '90 minutes', 'proof');
  perform pg_temp.act(v_adult2);
  perform pg_temp.rec('time off removes the slot it covers', '2',
    (select count(*)::text from jsonb_array_elements(public.list_bookable_consult_slots(v_start + interval '5 days' - interval '1 hour', v_start + interval '6 days')) x where (x ->> 'clinician_id')::uuid = v_docA));
  perform pg_temp.back();
  insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source, status, declared_by)
  select v_org, v_docA, v_adult2, 'proof conflict', 'self_declared', 'pending_review', v_docA;
  perform pg_temp.act(v_adult2);
  perform pg_temp.rec('a declared conflict hides that clinician from that patient only', '0',
    (select count(*)::text from jsonb_array_elements(public.list_bookable_consult_slots(v_start + interval '5 days' - interval '1 hour', v_start + interval '6 days')) x where (x ->> 'clinician_id')::uuid = v_docA));
  perform pg_temp.back();
  perform pg_temp.act(v_adult3);
  perform pg_temp.rec('...while another patient still sees the rest', '2',
    (select count(*)::text from jsonb_array_elements(public.list_bookable_consult_slots(v_start + interval '5 days' - interval '1 hour', v_start + interval '6 days')) x where (x ->> 'clinician_id')::uuid = v_docA));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot list slots', '42501', pg_temp.try('select public.list_bookable_consult_slots()'));
  perform pg_temp.back();
  -- test and real time are kept apart (INV-13): a real (non-test) block is invisible to a test patient, and cannot be booked by one
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
  values (v_org, v_docB, v_start + interval '6 days', v_start + interval '6 days' + interval '2 hours', 'bookable_consultations', 'confirmed', false);
  perform pg_temp.act(v_adult3);
  perform pg_temp.rec('a test patient sees no real clinician time', '0',
    (select count(*)::text from jsonb_array_elements(public.list_bookable_consult_slots(v_start + interval '6 days' - interval '1 hour', v_start + interval '7 days')) x where (x ->> 'clinician_id')::uuid = v_docB));
  perform pg_temp.rec('...and cannot hold it either', 'P0001',
    pg_temp.try(format('select public.hold_appointment_slot(%L, %L, ''telemedicine'', ''telemedicine'', %L, %L)', v_org, v_docB, v_start + interval '6 days', v_start + interval '6 days' + interval '30 minutes')));
  perform pg_temp.back();

  -- 9. Grants -------------------------------------------------------------------------------------------------
  perform pg_temp.rec('anon cannot run any consultation function', '0',
    (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('report_encounter_event', 'complete_encounter', 'mark_encounter_no_show', 'open_scribe_prompt', 'record_scribe_consent', 'scribe_may_start', 'my_consultation_rule', 'service_get_encounter_room', 'service_open_encounter_room', 'service_record_encounter_event', 'consultation_room_view', 'my_upcoming_encounters', 'my_clinician_encounters')
       and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.rec('authenticated cannot run the private helpers', '0',
    (select count(*)::text from pg_proc p where p.pronamespace = 'private'::regnamespace
       and p.proname in ('ensure_encounter_for_appointment', 'return_consultation_credit', 'log_encounter_event', 'assert_adult_for_consultation', 'patient_age_years')
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')));
  perform pg_temp.rec('every S21 table has row level security', '0',
    (select count(*)::text from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and c.relname in ('encounters', 'encounter_rooms', 'encounter_events', 'scribe_consents', 'consultation_policy_config') and not c.relrowsecurity));
  perform pg_temp.act(v_adult);
  perform pg_temp.rec('a patient sees the rule and the price before paying', '1000000/2/18',
    (select (r ->> 'price_kobo') || '/' || (r ->> 'cancel_window_hours') || '/' || (r ->> 'min_age_years') from (select public.my_consultation_rule() as r) x));
  perform pg_temp.back();

  -- 10. SABOTAGE ----------------------------------------------------------------------------------------------
  -- (a) the adult gate trigger on encounters is dropped: a minor's encounter row must now insert
  drop trigger encounters_adult_gate on public.encounters;
  insert into results values ('sabotaged', 'an encounter for a minor is refused', 'P0001',
    pg_temp.try(format('insert into public.encounters (organisation_id, patient_id, type, scheduled_at, policy_version) values (%L, %L, ''video'', now() + interval ''5 days'', 1)', v_org, v_minor)));
  -- (b) the adult check is emptied: a minor can now hold a booking
  create or replace function private.assert_adult_for_consultation(p_patient uuid) returns void language plpgsql as $s$ begin null; end $s$;
  perform pg_temp.act(v_minor);
  insert into results values ('sabotaged', 'a minor cannot hold a remote consultation', 'P0001',
    pg_temp.try(format('select public.hold_appointment_slot(%L, %L, ''telemedicine'', ''telemedicine'', %L, %L)', v_org, v_docA, v_start + interval '5 days' + interval '90 minutes', v_start + interval '5 days' + interval '2 hours')));  -- an open, confirmed slot, so only the age rule can refuse it
  perform pg_temp.back();
  -- (c) the room lookup is granted to signed-in users: a patient can now call it
  grant execute on function public.service_get_encounter_room(uuid) to authenticated;
  perform pg_temp.act(v_adult);
  insert into results values ('sabotaged', 'a signed-in patient cannot call the room lookup', '42501',
    pg_temp.try(format('select public.service_get_encounter_room(%L)', v_e7)));
  perform pg_temp.back();
  -- (d) the older booking path loses its adult gate: a minor now reaches the slot check instead of being refused
  drop trigger video_visit_requests_adult_gate on public.video_visit_requests;
  insert into results values ('sabotaged', 'the older video-visit path refuses a minor', 'P0001',
    pg_temp.try(format('insert into public.video_visit_requests (organisation_id, patient_id, slot_id) values (%L, %L, %L)', v_org, v_minor, gen_random_uuid())));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S21 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then
    raise exception 'VACUOUS TEST: expected all four sabotage runs to change a check, only % did', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to FAIL inside the DO block above. They are deliberately not printed: the runner
-- treats any FAIL verdict in the output as a failed proof.

rollback;
