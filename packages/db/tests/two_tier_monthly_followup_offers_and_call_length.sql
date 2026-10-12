-- Two-tier items 3 and 4 proof (migrations *_two_tier_followup_data_model_and_config, *_two_tier_followup_entitlement_call_length_precall,
-- *_two_tier_doctor_offered_followup_slots). Decisions D4, C5, C8 (docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md).
--
--   A. Config: call_length v1 and offers v1 are active; a Member's membership creates 12 monthly entitlements.
--   B. Offers: a tied doctor offers 2 to 6 times; refused for a non-Member, an untied doctor, a care coordinator, a patient, anon;
--      refused outside the confirmed bookable hours, on leave, over another booking, too soon, with too few or too many times, and
--      for a second open offer; the Member sees their offer and a stranger sees nothing; staff have no direct table read.
--   C. Pick: the Member's pick runs the live hold and confirm: appointment confirmed and waived (no paid credit), the encounter exists
--      with the planned length and the config version (INV-16), the entitlement is booked, the other times are released, a second pick
--      books nothing. First pick wins in a bulk offer and the loser's same time is marked taken. Expired and withdrawn offers cannot be picked.
--   D. Entitlement life: cancelled in time returns the month, a late cancel consumes it, a completed call consumes it, a month that passes
--      lapses with a nudge that is never SMS, and the worklist lists it for the lead doctor and the care coordinator but not a stranger.
--   E. Tiered length: 15 routine (10 allowed), 20 for a condition, 20 for an abnormal or held result inside 90 days (not 100 days),
--      20 for the yearly results call; a 20 minute call cannot be shortened; the grid and bounds in slot_is_open.
--   F. Extension and longer request: only the assigned doctor extends, capped; the calendar clash is reported; the Member can ask for longer.
--   G. Pre-call summary: only the assigned doctor, through the audited summary, one extra audit row, vitals trend and results since.
--   H. Grants: anon has no execute on anything new; the private helpers are not executable by authenticated; staff cannot write the tables.
--   SABOTAGE: the clash check, the completion trigger, the call length rule, the waived payment, and the extras audit are each broken in turn;
--   the matching check must flip every time.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table tm(k text primary key, v timestamptz) on commit drop;
grant all on tm to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.t(p text) returns timestamptz language sql as $$ select v from tm where k = p $$;
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
create function pg_temp.j(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := jsonb_build_object('err', sqlstate, 'msg', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_auth_write(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ff-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'Proof ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone,
    date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_label text, p_admin uuid, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'Proof ' || p_label, 'MDCN', 'TT-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, (case when p_tier = 'care_coordinator' then 'employed' else 'contracted' end)::public.staff_employment_type, 2, true, p_admin, true);
  return v;
end $f$;
-- a Member: a profile, an active membership (the trigger makes the 12 months), a lead assignment to the given doctor
create function pg_temp.mkmember(p_org uuid, p_label text, p_admin uuid, p_lead uuid, p_member boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'patient');
begin
  if p_member then
    insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, granted_by, grant_reason, is_test)
    values (p_org, v, 'granted', 'active', now() - interval '1 day', p_admin, 'two tier proof fixture membership', true);
  end if;
  set local session_replication_role = replica;
  insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, is_test)
  values (p_org, v, p_lead, 'active', 'admin', 1, true);
  set local session_replication_role = origin;
  return v;
end $f$;
-- offer as a doctor: minutes after the day's 09:00 for each time
create function pg_temp.offer(p_doc uuid, p_patient uuid, p_offsets integer[], p_kind text default 'monthly', p_minutes integer default null) returns jsonb
language plpgsql as $f$
declare v_arr text;
begin
  select 'array[' || string_agg(format('%L::timestamptz', pg_temp.t('v0') + (o * interval '1 minute')), ',') || ']::timestamptz[]'
    into v_arr from unnest(p_offsets) o;
  return pg_temp.j(p_doc, format('select public.offer_followup_slots(%L, %s, %L, %s)', p_patient, v_arr, p_kind, coalesce(p_minutes::text, 'null')));
end $f$;
create function pg_temp.audit_rows(p_patient uuid, p_actor uuid, p_section text) returns integer language sql as
$$ select count(*)::integer from public.audit_log where subject_patient_id = p_patient and actor_id = p_actor and action = 'staff.chart_read'
     and event -> 'sections' ? p_section $$;
create function pg_temp.ent_state(p_patient uuid) returns text language sql as
$$ select state || '/' || coalesce(consumed_reason, '-') from public.member_followup_entitlements
    where patient_id = p_patient and month_index = 1 $$;

-- 0. Fixtures ------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_admin uuid; v_d uuid; v_d2 uuid; v_c uuid; v0 timestamptz;
  v_pm uuid; v_pm2 uuid; v_pm3 uuid; v_pm4 uuid; v_pm5 uuid; v_pm6 uuid; v_pm7 uuid; v_pm8 uuid; v_pc uuid; v_pa uuid; v_po uuid; v_px uuid; v_pn uuid;
  v_lab uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_d := pg_temp.mkstaff(v_org, 'doc', v_admin, 'senior_medical_officer');
  v_d2 := pg_temp.mkstaff(v_org, 'doc2', v_admin, 'senior_medical_officer');
  v_c := pg_temp.mkstaff(v_org, 'coord', v_admin, 'care_coordinator');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('d', v_d); perform pg_temp.setf('d2', v_d2); perform pg_temp.setf('c', v_c);

  -- tomorrow 09:00 in Lagos; the doctor's confirmed bookable block runs 09:00 to 15:00
  v0 := (date_trunc('day', now() at time zone 'Africa/Lagos') + interval '1 day 9 hours') at time zone 'Africa/Lagos';
  insert into tm values ('v0', v0);
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, confirmed_by, confirmed_at, is_test)
  values (v_org, v_d, v0, v0 + interval '6 hours', 'bookable_consultations', 'confirmed', v_admin, now(), true);

  v_pm := pg_temp.mkmember(v_org, 'pm', v_admin, v_d);   v_pm2 := pg_temp.mkmember(v_org, 'pm2', v_admin, v_d);
  v_pm3 := pg_temp.mkmember(v_org, 'pm3', v_admin, v_d); v_pm4 := pg_temp.mkmember(v_org, 'pm4', v_admin, v_d);
  v_pm5 := pg_temp.mkmember(v_org, 'pm5', v_admin, v_d); v_pm6 := pg_temp.mkmember(v_org, 'pm6', v_admin, v_d);
  v_pm7 := pg_temp.mkmember(v_org, 'pm7', v_admin, v_d); v_pm8 := pg_temp.mkmember(v_org, 'pm8', v_admin, v_d);
  v_pc := pg_temp.mkmember(v_org, 'pc', v_admin, v_d);   v_pa := pg_temp.mkmember(v_org, 'pa', v_admin, v_d);
  v_po := pg_temp.mkmember(v_org, 'po', v_admin, v_d);
  v_px := pg_temp.mkmember(v_org, 'px', v_admin, v_d2);  v_pn := pg_temp.mkmember(v_org, 'pn', v_admin, v_d, false);
  perform pg_temp.setf('pm', v_pm); perform pg_temp.setf('pm2', v_pm2); perform pg_temp.setf('pm3', v_pm3); perform pg_temp.setf('pm4', v_pm4);
  perform pg_temp.setf('pm5', v_pm5); perform pg_temp.setf('pm6', v_pm6); perform pg_temp.setf('pm7', v_pm7); perform pg_temp.setf('pm8', v_pm8);
  perform pg_temp.setf('pc', v_pc); perform pg_temp.setf('pa', v_pa); perform pg_temp.setf('po', v_po);
  perform pg_temp.setf('px', v_px); perform pg_temp.setf('pn', v_pn);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at)
  values (v_org, v_pm5, v_d, v_c, now());

  -- a condition for pc; an abnormal result 30 days ago for pa; one 100 days ago for po
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status) values (v_org, v_pc, 'Proof condition', 'active');
  set local session_replication_role = replica;
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, received_at, release_state, release_reason, released_at, is_test)
  values (v_org, v_pa, 'api', 'partner', now() - interval '30 days', 'released', 'proof', now(), true) returning id into v_lab;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, is_test)
  values (v_lab, v_org, v_pa, 'proof_a', 9.9, 'u', 'high', true);
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, received_at, release_state, release_reason, released_at, is_test)
  values (v_org, v_po, 'api', 'partner', now() - interval '100 days', 'released', 'proof', now(), true) returning id into v_lab;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, is_test)
  values (v_lab, v_org, v_po, 'proof_a', 9.9, 'u', 'high', true);
  -- pm4's data for the pre-call summary: a reading 3 days ago and one 40 days ago, a result 5 days ago and one 50 days ago
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_pm4, 'blood_pressure', 140, 90, now() - interval '3 days', 'manual'),
         (v_org, v_pm4, 'blood_pressure', 120, 80, now() - interval '40 days', 'manual');
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, received_at, release_state, release_reason, released_at, is_test)
  values (v_org, v_pm4, 'api', 'partner', now() - interval '5 days', 'released', 'proof', now(), true),
         (v_org, v_pm4, 'api', 'partner', now() - interval '50 days', 'released', 'proof', now(), true);
  set local session_replication_role = origin;

  -- the doctor's other bookings: a 30 minute booking at 11:00, and leave from 11:30 to 12:30
  insert into public.appointments (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status, payment_status)
  values (v_org, v_px, v_d, 'gp', 'in_person', v0 + interval '120 minutes', v0 + interval '150 minutes', 'confirmed', 'not_required');
  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (v_org, v_d, 'leave', v0 + interval '150 minutes', v0 + interval '210 minutes', 'proof leave');
end $$;

-- A. Config and entitlements ---------------------------------------------------------------------------------------
do $$
declare v_scratch uuid;
begin
  perform pg_temp.ck('A1 call_length v1 is the one active row', '1', (select version::text from public.followup_config where kind = 'call_length' and is_active));
  perform pg_temp.ck('A2 offers v1 is the one active row', '1', (select version::text from public.followup_config where kind = 'offers' and is_active));
  perform pg_temp.ck('A3 a Member gets 12 monthly entitlements', '12', (select count(*)::text from public.member_followup_entitlements where patient_id = pg_temp.f('pm')));
  perform pg_temp.ck('A4 month 1 starts at the membership start', 'true', (select (e.period_start = m.starts_at)::text
      from public.member_followup_entitlements e join public.patient_memberships m on m.id = e.membership_id
     where e.patient_id = pg_temp.f('pm') and e.month_index = 1));
  perform pg_temp.ck('A5 a non-Member has no entitlements', '0', (select count(*)::text from public.member_followup_entitlements where patient_id = pg_temp.f('pn')));
  v_scratch := pg_temp.mkmember(pg_temp.f('org'), 'scratch', pg_temp.f('admin'), pg_temp.f('d'));
  update public.patient_memberships set state = 'ended', ended_at = now(), ended_by = pg_temp.f('admin'), end_reason = 'proof ended membership'
   where patient_id = v_scratch;
  perform pg_temp.ck('A6 ending the membership voids the unused months', '0|12', (select count(*) filter (where state = 'available')::text || '|' || count(*) filter (where state = 'voided')::text
      from public.member_followup_entitlements where patient_id = v_scratch));
end $$;

-- B. Offers ----------------------------------------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  -- refusals
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pn'), array[0, 30]);
  perform pg_temp.ck('B1 a non-Member is refused', 'true', (r ->> 'msg' like '%not a Member%')::text);
  r := pg_temp.offer(pg_temp.f('d2'), pg_temp.f('pm'), array[0, 30]);
  perform pg_temp.ck('B2 an untied doctor is refused', 'true', (r ->> 'msg' like '%not one of your patients%')::text);
  r := pg_temp.offer(pg_temp.f('c'), pg_temp.f('pm'), array[0, 30]);
  perform pg_temp.ck('B3 a care coordinator is refused', '42501', r ->> 'err');
  r := pg_temp.offer(pg_temp.f('pm'), pg_temp.f('pm'), array[0, 30]);
  perform pg_temp.ck('B4 a patient is refused', '42501', r ->> 'err');
  perform pg_temp.ck('B5 anon cannot call offer', '42501', pg_temp.try_anon(format('select public.offer_followup_slots(%L, array[now()], ''monthly'', null)', pg_temp.f('pm'))));
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm'), array[0]);
  perform pg_temp.ck('B6 one time is too few', 'true', (r ->> 'msg' like 'offer between 2 and 6%')::text);
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm'), array[0, 15, 30, 45, 60, 75, 90]);
  perform pg_temp.ck('B7 seven times is too many', 'true', (r ->> 'msg' like 'offer between 2 and 6%')::text);
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm'), array[0, 420]);
  perform pg_temp.ck('B8 a time outside the confirmed hours is refused', 'true', (r ->> 'msg' like '%not inside your confirmed bookable hours%')::text);
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm'), array[0, 150]);
  perform pg_temp.ck('B9 a time on leave is refused', 'true', (r ->> 'msg' like '%not inside your confirmed bookable hours%')::text);
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm'), array[0, 120]);
  perform pg_temp.ck('B10 a time over another booking is refused', 'true', (r ->> 'msg' like '%overlaps another booking%')::text);
  r := pg_temp.j(pg_temp.f('d'), format('select public.offer_followup_slots(%L, array[now() + interval ''30 minutes'', now() + interval ''40 minutes''], ''monthly'', null)', pg_temp.f('pm')));
  perform pg_temp.ck('B11 a time too soon is refused', 'true', (r ->> 'msg' like '%too soon%')::text);
  perform pg_temp.ck('B12 a refused offer leaves no offer behind', '0', (select count(*)::text from public.followup_offers where patient_id = pg_temp.f('pm')));

  -- a good offer for pm: 09:00, 09:30, 10:00
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm'), array[0, 30, 60]);
  perform pg_temp.setf('offer_pm', (r ->> 'offer_id')::uuid);
  perform pg_temp.ck('B13 a tied doctor offers three times to a Member', 'offered|15|3', (r ->> 'status') || '|' || (r ->> 'minutes') || '|' || (r ->> 'slots'));
  perform pg_temp.ck('B14 the offer records the call basis and both config versions', 'standard|1|1', (select call_basis || '|' || call_config_version || '|' || followups_config_version
      from public.followup_offers where id = pg_temp.f('offer_pm')));
  perform pg_temp.ck('B15 each slot is the planned length', '15', (select distinct (extract(epoch from ends_at - starts_at) / 60)::int::text from public.followup_offer_slots where offer_id = pg_temp.f('offer_pm')));
  perform pg_temp.ck('B16 the offer expires before the last time', 'true', (select (expires_at < pg_temp.t('v0') + interval '60 minutes')::text from public.followup_offers where id = pg_temp.f('offer_pm')));
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm'), array[0, 30]);
  perform pg_temp.ck('B17 a second open offer for the same Member is refused', 'true', (r ->> 'msg' like '%already an open offer%')::text);
  perform pg_temp.ck('B18 the Member was told, neutrally, in app or push (never SMS or email)', 'true', (exists (
    select 1 from public.notifications where recipient_id = pg_temp.f('pm') and template = 'followup_times_offered' and channel::text in ('in_app', 'push')))::text);

  -- visibility
  r := pg_temp.j(pg_temp.f('pm'), 'select public.my_followups(null)');
  perform pg_temp.ck('B19 the Member sees one offer with three open times', '1|3', jsonb_array_length(r -> 'offers')::text || '|' || jsonb_array_length(r -> 'offers' -> 0 -> 'slots')::text);
  perform pg_temp.ck('B20 the Member sees 12 months remaining and this month', '12|1', (r -> 'entitlement' ->> 'remaining') || '|' || (r -> 'entitlement' -> 'current' ->> 'month_index'));
  r := pg_temp.j(pg_temp.f('pm2'), format('select public.my_followups(%L)', pg_temp.f('pm')));
  perform pg_temp.ck('B21 another Member (no caregiver permission) sees nothing of it', '0', jsonb_array_length(r -> 'offers')::text);
  perform pg_temp.ck('B22 another Member reads none of its rows directly', '0', pg_temp.q_as(pg_temp.f('pm2'), 'select count(*)::text from public.followup_offers'));
  perform pg_temp.ck('B23 the Member reads their own offer row', '1', pg_temp.q_as(pg_temp.f('pm'), 'select count(*)::text from public.followup_offers'));
  perform pg_temp.ck('B24 the doctor has no direct table read (functions only)', '0', pg_temp.q_as(pg_temp.f('d'), 'select count(*)::text from public.followup_offers'));
  r := pg_temp.j(pg_temp.f('d'), 'select public.my_followup_offers_sent()');
  perform pg_temp.ck('B25 the doctor lists their own open offer with the first name', '1|Proof', (select count(*)::text || '|' || min(x ->> 'first_name') from jsonb_array_elements(r) x where x ->> 'status' = 'open'));
  r := pg_temp.j(pg_temp.f('d2'), 'select public.my_followup_offers_sent()');
  perform pg_temp.ck('B26 another doctor lists none of them', '0', jsonb_array_length(r)::text);
  perform pg_temp.ck('B27 listing is audited once per Member per day', '1', pg_temp.audit_rows(pg_temp.f('pm'), pg_temp.f('d'), 'followup_offers')::text);
  perform pg_temp.j(pg_temp.f('d'), 'select public.my_followup_offers_sent()');
  perform pg_temp.ck('B28 listing again the same day adds no second audit row', '1', pg_temp.audit_rows(pg_temp.f('pm'), pg_temp.f('d'), 'followup_offers')::text);
end $$;

-- C. Pick ---------------------------------------------------------------------------------------------------------
do $$
declare r jsonb; v_slot uuid; v_appt uuid; v_enc uuid;
begin
  select id into v_slot from public.followup_offer_slots where offer_id = pg_temp.f('offer_pm') and starts_at = pg_temp.t('v0') + interval '30 minutes';
  perform pg_temp.setf('slot_pm', v_slot);
  r := pg_temp.j(pg_temp.f('pm2'), format('select public.pick_followup_slot(%L, false)', v_slot));
  perform pg_temp.ck('C1 another person cannot pick', '42501', r ->> 'err');
  r := pg_temp.j(pg_temp.f('pm'), format('select public.pick_followup_slot(%L, false)', v_slot));
  perform pg_temp.ck('C2 the Member picks a time and it books', 'booked|15', (r ->> 'status') || '|' || (r ->> 'minutes'));
  v_appt := (r ->> 'appointment_id')::uuid; v_enc := (r ->> 'encounter_id')::uuid;
  perform pg_temp.setf('appt_pm', v_appt);
  perform pg_temp.ck('C3 the appointment is confirmed and waived (no paid credit)', 'confirmed|waived|telemedicine', (select status::text || '|' || payment_status::text || '|' || appointment_type::text from public.appointments where id = v_appt));
  perform pg_temp.ck('C4 it is the picked time for the planned length', 'true', (select (scheduled_for = pg_temp.t('v0') + interval '30 minutes' and ends_at = scheduled_for + interval '15 minutes')::text from public.appointments where id = v_appt));
  perform pg_temp.ck('C5 the encounter exists with the planned length, basis and config version (INV-16)', '15|standard|1|false', (select planned_minutes || '|' || call_length_basis || '|' || call_length_config_version || '|' || longer_requested from public.encounters where id = v_enc));
  perform pg_temp.ck('C6 the month is booked against the appointment', 'booked', (select state from public.member_followup_entitlements where patient_id = pg_temp.f('pm') and month_index = 1));
  perform pg_temp.ck('C7 the offer is picked and the other two times are released', 'picked|1 picked|2 released', (select o.status || '|' || (select count(*) from public.followup_offer_slots s where s.offer_id = o.id and s.state = 'picked') || ' picked|' || (select count(*) from public.followup_offer_slots s where s.offer_id = o.id and s.state = 'released') || ' released' from public.followup_offers o where o.id = pg_temp.f('offer_pm')));
  perform pg_temp.ck('C8 no paid consultation credit was spent', '0', (select count(*)::text from public.service_purchases where redeemed_entity_type = 'appointment' and redeemed_entity_id = v_appt));
  perform pg_temp.ck('C9 the doctor was told, and the Member got the live booking confirmation', '1|1', (select count(*) filter (where template = 'followup_slot_picked' and recipient_id = pg_temp.f('d'))::text || '|' || count(*) filter (where template = 'appointment_booking_confirmation' and recipient_id = pg_temp.f('pm'))::text from public.notifications));
  r := pg_temp.j(pg_temp.f('pm'), format('select public.pick_followup_slot(%L, false)', (select id from public.followup_offer_slots where offer_id = pg_temp.f('offer_pm') and state = 'released' limit 1)));
  perform pg_temp.ck('C10 a second pick books nothing', '1|picked', (select count(*)::text from public.appointments where patient_id = pg_temp.f('pm') and appointment_type = 'telemedicine') || '|' || (r ->> 'status'));
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm'), array[200, 215]);
  perform pg_temp.ck('C11 a Member with the month booked cannot be offered another', 'true', (r ->> 'msg' like '%already booked%')::text);

  -- the live hold is a 10 minute hold: a direct check on the config the pick passes down
  perform pg_temp.ck('C12 the pick uses the live 10 minute hold (config)', '10', (private.followup_setting('offers') ->> 'holdMinutes'));

  -- cancel in time returns the month; the booking can be offered again
  r := pg_temp.j(pg_temp.f('pm'), format('select to_jsonb(public.cancel_appointment(%L, ''proof''))', v_appt));
  perform pg_temp.ck('C13 cancelled in time: the appointment is cancelled', 'patient_cancelled', r ->> 'status');
  perform pg_temp.ck('C14 cancelled in time: the month is available again', 'available/-', pg_temp.ent_state(pg_temp.f('pm')));
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm'), array[0, 30]);
  perform pg_temp.setf('offer_pm_b', (r ->> 'offer_id')::uuid);
  perform pg_temp.ck('C15 the freed month can be offered again', 'offered', r ->> 'status');
  r := pg_temp.j(pg_temp.f('pm'), format('select public.pick_followup_slot(%L, false)', (select id from public.followup_offer_slots where offer_id = pg_temp.f('offer_pm_b') order by starts_at limit 1)));
  perform pg_temp.ck('C16 and picked again', 'booked', r ->> 'status');
  -- late cancel: the call is within the 2 hour cancel window
  update public.appointments set scheduled_for = now() + interval '1 hour', ends_at = now() + interval '1 hour 15 minutes' where id = (r ->> 'appointment_id')::uuid;
  perform pg_temp.j(pg_temp.f('pm'), format('select to_jsonb(public.cancel_appointment(%L, ''proof late''))', (r ->> 'appointment_id')::uuid));
  perform pg_temp.ck('C17 a late cancel consumes the month', 'consumed/late_cancel', pg_temp.ent_state(pg_temp.f('pm')));
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm'), array[0, 30]);
  perform pg_temp.ck('C18 a consumed month cannot be offered again', 'true', (r ->> 'msg' like '%already done%')::text);
end $$;

-- C2. Bulk, first pick wins, expiry, withdrawal ------------------------------------------------------------------------
do $$
declare r jsonb; v_s uuid; v_o2 uuid; v_o3 uuid; v_slot3 uuid;
begin
  r := pg_temp.j(pg_temp.f('d'), format($q$select public.offer_followup_slots_bulk(array[%L, %L, %L, %L]::uuid[],
      array[%L::timestamptz, %L::timestamptz, %L::timestamptz], 'monthly')$q$,
      pg_temp.f('pm2'), pg_temp.f('pm3'), pg_temp.f('pn'), pg_temp.f('px'),
      pg_temp.t('v0') + interval '60 minutes', pg_temp.t('v0') + interval '75 minutes', pg_temp.t('v0') + interval '90 minutes'));
  perform pg_temp.ck('D1 bulk: two Members offered', '2', r ->> 'offered');
  perform pg_temp.ck('D2 bulk: the non-Member and the untied Member are refused with a reason, the rest not blocked', '2',
    (select count(*)::text from jsonb_array_elements(r -> 'results') x where x ->> 'status' = 'refused' and (x ->> 'reason') is not null));
  v_o2 := (select (x ->> 'offer_id')::uuid from jsonb_array_elements(r -> 'results') x where (x ->> 'patient_id')::uuid = pg_temp.f('pm2'));
  v_o3 := (select (x ->> 'offer_id')::uuid from jsonb_array_elements(r -> 'results') x where (x ->> 'patient_id')::uuid = pg_temp.f('pm3'));
  perform pg_temp.setf('o2', v_o2); perform pg_temp.setf('o3', v_o3);
  r := pg_temp.j(pg_temp.f('d'), format('select public.offer_followup_slots_bulk(array[%L]::uuid[], array[now()], ''monthly'')', pg_temp.f('pm4')));
  perform pg_temp.ck('D3 bulk with a bad time list reports per person, not a crash', 'refused', r -> 'results' -> 0 ->> 'status');

  -- pm2 picks 10:00 and asks for a longer call
  select id into v_s from public.followup_offer_slots where offer_id = v_o2 and starts_at = pg_temp.t('v0') + interval '60 minutes';
  r := pg_temp.j(pg_temp.f('pm2'), format('select public.pick_followup_slot(%L, true)', v_s));
  perform pg_temp.ck('D4 first pick wins', 'booked', r ->> 'status');
  perform pg_temp.ck('D5 asking for a longer call at booking is flagged on the encounter', 'true', (select longer_requested::text from public.encounters where id = (r ->> 'encounter_id')::uuid));
  perform pg_temp.ck('D6 the loser''s same time is marked taken', 'taken', (select state from public.followup_offer_slots where offer_id = v_o3 and starts_at = pg_temp.t('v0') + interval '60 minutes'));
  r := pg_temp.j(pg_temp.f('pm3'), 'select public.my_followups(null)');
  perform pg_temp.ck('D7 the loser still sees the two other times', '2', jsonb_array_length(r -> 'offers' -> 0 -> 'slots')::text);
  select id into v_slot3 from public.followup_offer_slots where offer_id = v_o3 and starts_at = pg_temp.t('v0') + interval '60 minutes';
  r := pg_temp.j(pg_temp.f('pm3'), format('select public.pick_followup_slot(%L, false)', v_slot3));
  perform pg_temp.ck('D8 picking the taken time books nothing', 'unavailable', r ->> 'status');
  perform pg_temp.ck('D9 and the Member still has no appointment', '0', (select count(*)::text from public.appointments where patient_id = pg_temp.f('pm3')));

  -- expiry: an old offer cannot be picked; the sweep closes the rest
  update public.followup_offers set expires_at = now() - interval '1 minute' where id = v_o3;
  r := pg_temp.j(pg_temp.f('pm3'), format('select public.pick_followup_slot(%L, false)', (select id from public.followup_offer_slots where offer_id = v_o3 and state = 'offered' limit 1)));
  perform pg_temp.ck('D10 an expired offer cannot be picked', 'expired', r ->> 'status');
  perform pg_temp.ck('D11 and its times are closed', '0', (select count(*)::text from public.followup_offer_slots where offer_id = v_o3 and state = 'offered'));
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm6'), array[240, 255]);
  update public.followup_offers set expires_at = now() - interval '1 minute' where id = (r ->> 'offer_id')::uuid;
  perform private.sweep_followups();
  perform pg_temp.ck('D12 the sweep expires an offer past its time', 'expired', (select status from public.followup_offers where id = (r ->> 'offer_id')::uuid));

  -- withdrawal
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm7'), array[240, 255]);
  perform pg_temp.setf('o7', (r ->> 'offer_id')::uuid);
  perform pg_temp.ck('D13 another doctor cannot withdraw it', '42501', pg_temp.j(pg_temp.f('d2'), format('select public.withdraw_followup_offer(%L)', pg_temp.f('o7'))) ->> 'err');
  perform pg_temp.ck('D14 the doctor withdraws it', 'withdrawn', pg_temp.j(pg_temp.f('d'), format('select public.withdraw_followup_offer(%L)', pg_temp.f('o7'))) ->> 'status');
  perform pg_temp.ck('D15 its times are withdrawn', '0', (select count(*)::text from public.followup_offer_slots where offer_id = pg_temp.f('o7') and state = 'offered'));
  r := pg_temp.j(pg_temp.f('pm7'), format('select public.pick_followup_slot(%L, false)', (select id from public.followup_offer_slots where offer_id = pg_temp.f('o7') limit 1)));
  perform pg_temp.ck('D16 a withdrawn offer cannot be picked', 'withdrawn', r ->> 'status');
  perform pg_temp.ck('D17 the Member was told the times changed', '1', (select count(*)::text from public.notifications where recipient_id = pg_temp.f('pm7') and template = 'followup_offer_withdrawn'));
end $$;

-- D. Completion consumes, a missed month lapses and is nudged, the worklist ---------------------------------------------
do $$
declare r jsonb; v_o uuid; v_appt uuid; v_enc uuid; v_n integer;
begin
  -- pm4 books 12:30 and the call completes
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm4'), array[210, 225]);
  v_o := (r ->> 'offer_id')::uuid;
  r := pg_temp.j(pg_temp.f('pm4'), format('select public.pick_followup_slot(%L, false)', (select id from public.followup_offer_slots where offer_id = v_o order by starts_at limit 1)));
  v_appt := (r ->> 'appointment_id')::uuid; v_enc := (r ->> 'encounter_id')::uuid;
  perform pg_temp.setf('appt_pm4', v_appt); perform pg_temp.setf('enc_pm4', v_enc);
  perform pg_temp.ck('E1 pm4 booked 12:30', 'booked', r ->> 'status');
  -- F and G run on this encounter before it completes (below); the completion check is done last in this block

  -- a month that passes with none booked: pm5
  update public.member_followup_entitlements set period_start = now() - interval '40 days', period_end = now() - interval '10 days'
   where patient_id = pg_temp.f('pm5') and month_index = 1;
  perform private.sweep_followups();
  perform pg_temp.ck('E2 a month with none booked lapses', 'lapsed', (select state from public.member_followup_entitlements where patient_id = pg_temp.f('pm5') and month_index = 1));
  perform pg_temp.ck('E3 the Member is nudged, never by SMS', '1|true', (select count(*)::text || '|' || bool_and(channel::text in ('in_app', 'push', 'email'))::text from public.notifications where recipient_id = pg_temp.f('pm5') and template = 'followup_month_missed'));
  r := pg_temp.j(pg_temp.f('d'), 'select public.followups_due_worklist()');
  perform pg_temp.ck('E4 the lead doctor''s worklist lists the missed month first', 'missed', r -> 0 ->> 'kind');
  perform pg_temp.ck('E5 and a Member whose month is open with nothing offered is due', 'true', (exists (select 1 from jsonb_array_elements(r) x where (x ->> 'patient_id')::uuid = pg_temp.f('pc') and x ->> 'kind' = 'due'))::text);
  perform pg_temp.ck('E6 a Member whose month is already booked is not on the due list', 'false', (exists (select 1 from jsonb_array_elements(r) x where (x ->> 'patient_id')::uuid = pg_temp.f('pm2')))::text);
  perform pg_temp.ck('E7 the care coordinator sees only the patient she is assigned to', '1|' || pg_temp.f('pm5')::text,
    (select jsonb_array_length(pg_temp.j(pg_temp.f('c'), 'select public.followups_due_worklist()'))::text || '|' || (pg_temp.j(pg_temp.f('c'), 'select public.followups_due_worklist()') -> 0 ->> 'patient_id')));
  perform pg_temp.ck('E8 a doctor sees only their own patients (not the first doctor''s)', '1|' || pg_temp.f('px')::text,
    (select jsonb_array_length(pg_temp.j(pg_temp.f('d2'), 'select public.followups_due_worklist()'))::text || '|' || (pg_temp.j(pg_temp.f('d2'), 'select public.followups_due_worklist()') -> 0 ->> 'patient_id')));
  perform pg_temp.ck('E9 a patient is refused', '42501', pg_temp.j(pg_temp.f('pm'), 'select public.followups_due_worklist()') ->> 'err');
  perform pg_temp.j(pg_temp.f('d'), 'select public.followups_due_worklist()');
  perform pg_temp.ck('E10 the worklist read is audited once per Member per day', '1', pg_temp.audit_rows(pg_temp.f('pm5'), pg_temp.f('d'), 'followup_worklist')::text);
  perform pg_temp.ck('E11 no stockpile: the lapsed month is not carried into the next one', 'lapsed|available|0', (select string_agg(state, '|' order by month_index) from public.member_followup_entitlements where patient_id = pg_temp.f('pm5') and month_index in (1, 2)) || '|' || (select count(*) from public.member_followup_entitlements where patient_id = pg_temp.f('pm5') and state = 'available' and month_index = 1)::text || '');
end $$;

-- E. Tiered call length -----------------------------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  perform pg_temp.ck('F1 routine: 15 minutes, standard', '15|standard', (private.call_length_for(pg_temp.f('pm8')) ->> 'minutes') || '|' || (private.call_length_for(pg_temp.f('pm8')) ->> 'basis'));
  perform pg_temp.ck('F2 a condition on the problem list: 20 minutes', '20|longer_by_need', (private.call_length_for(pg_temp.f('pc')) ->> 'minutes') || '|' || (private.call_length_for(pg_temp.f('pc')) ->> 'basis'));
  perform pg_temp.ck('F3 an abnormal result 30 days ago: 20 minutes', '20', private.call_length_for(pg_temp.f('pa')) ->> 'minutes');
  perform pg_temp.ck('F4 an abnormal result 100 days ago (outside the 90 days): 15', '15', private.call_length_for(pg_temp.f('po')) ->> 'minutes');
  perform pg_temp.ck('F5 the yearly results call: 20', '20|yearly_results', (private.call_length_for(pg_temp.f('pm8'), 'yearly_results') ->> 'minutes') || '|' || (private.call_length_for(pg_temp.f('pm8'), 'yearly_results') ->> 'basis'));
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pc'), array[240, 270]);
  perform pg_temp.ck('F6 an offer for a Member with a condition is 20 minutes', 'offered|20', (r ->> 'status') || '|' || (r ->> 'minutes'));
  perform pg_temp.ck('F7 and the clinician-visible basis is coarse (no reason)', 'longer_by_need', (select call_basis from public.followup_offers where id = (r ->> 'offer_id')::uuid));
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pa'), array[300, 330], 'monthly', 15);
  perform pg_temp.ck('F8 a 20 minute call cannot be shortened', 'true', (r ->> 'msg' like '%cannot be shortened%')::text);
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm8'), array[300, 330], 'monthly', 10);
  perform pg_temp.ck('F9 a routine call may be shortened to 10', 'offered|10', (r ->> 'status') || '|' || (r ->> 'minutes'));
  perform pg_temp.ck('F10 the 10 minute slots are 10 minutes long', '10', (select distinct (extract(epoch from ends_at - starts_at) / 60)::int::text from public.followup_offer_slots where offer_id = (r ->> 'offer_id')::uuid));
  perform pg_temp.j(pg_temp.f('d'), format('select public.withdraw_followup_offer(%L)', (r ->> 'offer_id')::uuid));
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm8'), array[300, 330], 'monthly', 9);
  perform pg_temp.ck('F11 a routine call below 10 is refused', 'true', (r ->> 'msg' like '%cannot be shortened%')::text);
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm8'), array[300, 330], 'yearly_results');
  perform pg_temp.ck('F12 the yearly results call is offered at 20', 'offered|20', (r ->> 'status') || '|' || (r ->> 'minutes'));
  perform pg_temp.j(pg_temp.f('d'), format('select public.withdraw_followup_offer(%L)', (r ->> 'offer_id')::uuid));

  -- the slot rule: 10, 15, 20, 30 on the 5 minute grid are open; 5, 7 and 35 are not
  perform pg_temp.ck('F13 slot_is_open accepts 10, 15, 20 and 30 minutes', 'true|true|true|true', (
    private.slot_is_open(pg_temp.f('d'), pg_temp.f('pm8'), pg_temp.t('v0') + interval '300 minutes', pg_temp.t('v0') + interval '310 minutes'))::text || '|' ||
    (private.slot_is_open(pg_temp.f('d'), pg_temp.f('pm8'), pg_temp.t('v0') + interval '300 minutes', pg_temp.t('v0') + interval '315 minutes'))::text || '|' ||
    (private.slot_is_open(pg_temp.f('d'), pg_temp.f('pm8'), pg_temp.t('v0') + interval '300 minutes', pg_temp.t('v0') + interval '320 minutes'))::text || '|' ||
    (private.slot_is_open(pg_temp.f('d'), pg_temp.f('pm8'), pg_temp.t('v0') + interval '300 minutes', pg_temp.t('v0') + interval '330 minutes'))::text);
  perform pg_temp.ck('F14 slot_is_open refuses 5, 7 and 35 minutes and an off-grid start', 'false|false|false|false', (
    private.slot_is_open(pg_temp.f('d'), pg_temp.f('pm8'), pg_temp.t('v0') + interval '300 minutes', pg_temp.t('v0') + interval '305 minutes'))::text || '|' ||
    (private.slot_is_open(pg_temp.f('d'), pg_temp.f('pm8'), pg_temp.t('v0') + interval '300 minutes', pg_temp.t('v0') + interval '307 minutes'))::text || '|' ||
    (private.slot_is_open(pg_temp.f('d'), pg_temp.f('pm8'), pg_temp.t('v0') + interval '300 minutes', pg_temp.t('v0') + interval '335 minutes'))::text || '|' ||
    (private.slot_is_open(pg_temp.f('d'), pg_temp.f('pm8'), pg_temp.t('v0') + interval '302 minutes', pg_temp.t('v0') + interval '317 minutes'))::text);
end $$;

-- F. Extension and longer request -------------------------------------------------------------------------------------
do $$
declare r jsonb; v_end timestamptz; v_enc uuid := pg_temp.f('enc_pm4'); v_appt uuid := pg_temp.f('appt_pm4');
begin
  perform pg_temp.ck('G1 another doctor cannot extend', '42501', pg_temp.j(pg_temp.f('d2'), format('select public.extend_encounter_call(%L, 5)', v_enc)) ->> 'err');
  perform pg_temp.ck('G2 the patient cannot extend', '42501', pg_temp.j(pg_temp.f('pm4'), format('select public.extend_encounter_call(%L, 5)', v_enc)) ->> 'err');
  select ends_at into v_end from public.appointments where id = v_appt;
  r := pg_temp.j(pg_temp.f('d'), format('select public.extend_encounter_call(%L, 5)', v_enc));
  perform pg_temp.ck('G3 the assigned doctor extends by 5', '5|false', (r ->> 'extended_minutes') || '|' || (r ->> 'calendar_conflict'));
  perform pg_temp.ck('G4 the calendar moves with it', 'true', (select (ends_at = v_end + interval '5 minutes')::text from public.appointments where id = v_appt));
  -- the doctor's next booking starts when this one now ends
  insert into public.appointments (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status, payment_status)
  select organisation_id, pg_temp.f('px'), clinician_id, 'gp', 'in_person', ends_at, ends_at + interval '15 minutes', 'confirmed', 'not_required' from public.appointments where id = v_appt;
  r := pg_temp.j(pg_temp.f('d'), format('select public.extend_encounter_call(%L, 5)', v_enc));
  perform pg_temp.ck('G5 a clash with the next booking is reported, the call is not cut off', '10|true', (r ->> 'extended_minutes') || '|' || (r ->> 'calendar_conflict'));
  perform pg_temp.ck('G6 the cap holds in total', 'true', (pg_temp.j(pg_temp.f('d'), format('select public.extend_encounter_call(%L, 10)', v_enc)) ->> 'msg' like '%at most 15 minutes in total%')::text);
  perform pg_temp.ck('G7 a 3 minute extension is refused', 'P0001', pg_temp.j(pg_temp.f('d'), format('select public.extend_encounter_call(%L, 3)', v_enc)) ->> 'err');
  perform pg_temp.ck('G8 the extension is on the encounter event log', '2', (select count(*)::text from public.encounter_events where encounter_id = v_enc and kind = 'call_extended'));
  -- the Member asks for longer after booking
  perform pg_temp.ck('G9 a stranger cannot ask', '42501', pg_temp.j(pg_temp.f('pm'), format('select public.request_longer_call(%L)', v_enc)) ->> 'err');
  perform pg_temp.ck('G10 the Member asks for a longer call', 'true', pg_temp.j(pg_temp.f('pm4'), format('select public.request_longer_call(%L)', v_enc)) ->> 'longer_requested');
  perform pg_temp.ck('G11 the flag is on the encounter and the offer', 'true|true', (select e.longer_requested::text || '|' || o.longer_requested::text from public.encounters e join public.followup_offers o on o.appointment_id = e.appointment_id where e.id = v_enc));
end $$;

-- G. Pre-call summary ------------------------------------------------------------------------------------------------
do $$
declare r jsonb; v_enc uuid := pg_temp.f('enc_pm4'); v_pat uuid := pg_temp.f('pm4');
begin
  r := pg_temp.j(pg_temp.f('d'), format('select public.precall_summary(%L)', v_enc));
  perform pg_temp.ck('H1 the assigned doctor gets the pre-call summary', 'true', (r ->> 'status' in ('ok', 'partial'))::text);
  perform pg_temp.ck('H2 one audit row for the summary itself and one for the extras', '1|1', pg_temp.audit_rows(v_pat, pg_temp.f('d'), 'summary')::text || '|' || pg_temp.audit_rows(v_pat, pg_temp.f('d'), 'precall_extras')::text);
  perform pg_temp.ck('H3 vitals trend covers only readings since the window (one, not the 40 day old one)', '1', (select (x ->> 'readings') from jsonb_array_elements(r -> 'vitals_trend') x limit 1));
  perform pg_temp.ck('H4 results since: the 5 day old one, not the 50 day old one', '1', jsonb_array_length(r -> 'results_since')::text);
  perform pg_temp.ck('H5 medicines, adherence and open tasks are present as sections', 'true', (r -> 'summary' ? 'medications' and r ? 'open_tasks' and r ? 'medicines_started_since' and r ? 'medicine_changes_since')::text);
  perform pg_temp.ck('H6 the encounter facts: planned length, extension, longer requested', '15|10|true', (r -> 'encounter' ->> 'planned_minutes') || '|' || (r -> 'encounter' ->> 'extended_minutes') || '|' || (r -> 'encounter' ->> 'longer_requested'));
  perform pg_temp.ck('H7 another doctor is refused', '42501', pg_temp.j(pg_temp.f('d2'), format('select public.precall_summary(%L)', v_enc)) ->> 'err');
  perform pg_temp.ck('H8 the patient is refused', '42501', pg_temp.j(v_pat, format('select public.precall_summary(%L)', v_enc)) ->> 'err');
  perform pg_temp.ck('H9 anon is refused', '42501', pg_temp.try_anon(format('select public.precall_summary(%L)', v_enc)));

  -- completion: the call completes and consumes the month
  perform pg_temp.j(pg_temp.f('d'), format('select to_jsonb(public.advance_appointment_status(%L, ''completed''))', pg_temp.f('appt_pm4')));
  perform pg_temp.ck('H11 a completed call consumes the month', 'consumed/completed', pg_temp.ent_state(v_pat));
  perform pg_temp.ck('H12 and the pre-call summary closes once the call is over', 'P0001', pg_temp.j(pg_temp.f('d'), format('select public.precall_summary(%L)', v_enc)) ->> 'err');
end $$;

-- H. Grants ---------------------------------------------------------------------------------------------------------
do $$
declare f text; v_bad text := '';
begin
  foreach f in array array[
    'public.offer_followup_slots(uuid,timestamptz[],text,integer)', 'public.offer_followup_slots_bulk(uuid[],timestamptz[],text)',
    'public.withdraw_followup_offer(uuid)', 'public.my_followups(uuid)', 'public.my_followup_offers_sent()', 'public.pick_followup_slot(uuid,boolean)',
    'public.extend_encounter_call(uuid,integer)', 'public.request_longer_call(uuid)', 'public.precall_summary(uuid)', 'public.followups_due_worklist()'] loop
    if has_function_privilege('anon', f::regprocedure, 'EXECUTE') then v_bad := v_bad || f || ' anon; '; end if;
    if not has_function_privilege('authenticated', f::regprocedure, 'EXECUTE') then v_bad := v_bad || f || ' not authenticated; '; end if;
  end loop;
  perform pg_temp.ck('I1 anon cannot execute any new public function; authenticated can', '', v_bad);
  v_bad := '';
  foreach f in array array[
    'private.create_followup_offer(uuid,uuid,timestamptz[],text,integer)', 'private.call_length_for(uuid,text)', 'private.sweep_followups()',
    'private.ensure_followup_entitlements(uuid)', 'private.followup_slot_clash(uuid,timestamptz,timestamptz)', 'private.followup_setting(text)',
    'private.require_offering_doctor()', 'private.followup_audit_once(uuid,text,text)'] loop
    if has_function_privilege('authenticated', f::regprocedure, 'EXECUTE') or has_function_privilege('anon', f::regprocedure, 'EXECUTE') then v_bad := v_bad || f || '; '; end if;
  end loop;
  perform pg_temp.ck('I2 the private helpers are not executable by authenticated or anon', '', v_bad);
  perform pg_temp.ck('I3 nobody but the functions can write the tables (no insert, update or delete grant for authenticated)', '',
    (select coalesce(string_agg(t || ' ' || p, '; '), '') from unnest(array['followup_offers', 'followup_offer_slots', 'member_followup_entitlements', 'followup_config']) t,
            unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
      where has_table_privilege('authenticated', 'public.' || t, p)));
  perform pg_temp.ck('I3b a doctor and a Member really are refused a write', '42501|42501|42501',
    pg_temp.try_auth_write(pg_temp.f('d'), 'update public.member_followup_entitlements set state = ''consumed''') || '|' ||
    pg_temp.try_auth_write(pg_temp.f('pm'), 'delete from public.followup_offer_slots') || '|' ||
    pg_temp.try_auth_write(pg_temp.f('d'), 'insert into public.followup_config (kind, version, config) values (''offers'', 99, ''{}'')'));
  perform pg_temp.ck('I4 anon reads none of the tables', '42501|42501|42501|42501',
    pg_temp.try_anon('select 1 from public.followup_offers limit 1') || '|' || pg_temp.try_anon('select 1 from public.followup_offer_slots limit 1') || '|' ||
    pg_temp.try_anon('select 1 from public.member_followup_entitlements limit 1') || '|' || pg_temp.try_anon('select 1 from public.followup_config limit 1'));
end $$;

-- SABOTAGE -----------------------------------------------------------------------------------------------------------
-- Each break is applied, the same check is run again and must come out different, then the original is put back.
do $$
declare v_def text; v_orig text; r jsonb; v_o uuid; v_s uuid;
begin
  -- 1. the clash check removed: an offer over another booking would go through
  v_orig := pg_get_functiondef('private.followup_slot_clash(uuid,timestamptz,timestamptz)'::regprocedure);
  v_def := replace(v_orig, 'select exists (', 'select false and exists (');
  if v_def = v_orig then raise exception 'SABOTAGE 1 not applied'; end if;
  execute v_def;
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pa'), array[0, 120]);
  insert into results values ('sabotaged', 'B10 an offer over another booking is refused', 'refused', case when r ->> 'msg' like '%overlaps another booking%' then 'refused' else coalesce(r ->> 'status', 'err:' || (r ->> 'msg')) end);
  if r ->> 'offer_id' is not null then update public.followup_offers set status = 'withdrawn', closed_at = now() where id = (r ->> 'offer_id')::uuid; end if;
  execute v_orig;

  -- 2. the completion trigger dropped: a completed call would leave the month booked
  drop trigger appointments_followup_entitlement_status on public.appointments;
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('pm8'), array[300, 330]);
  v_o := (r ->> 'offer_id')::uuid;
  select id into v_s from public.followup_offer_slots where offer_id = v_o order by starts_at limit 1;
  r := pg_temp.j(pg_temp.f('pm8'), format('select public.pick_followup_slot(%L, false)', v_s));
  update public.appointments set status = 'completed', completed_at = now() where id = (r ->> 'appointment_id')::uuid;
  insert into results values ('sabotaged', 'H11 a completed call consumes the month', 'consumed/completed', pg_temp.ent_state(pg_temp.f('pm8')));
  create trigger appointments_followup_entitlement_status after update of status on public.appointments
    for each row execute function private.followup_entitlement_follows_appointment();

  -- 3. the call length rule always routine: a Member with a condition would get 15
  v_orig := pg_get_functiondef('private.call_length_for(uuid,text)'::regprocedure);
  v_def := replace(v_orig, 'if v_need then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 3 not applied'; end if;
  execute v_def;
  insert into results values ('sabotaged', 'F2 a condition on the problem list: 20 minutes', '20', private.call_length_for(pg_temp.f('pc')) ->> 'minutes');
  execute v_orig;

  -- 4. the waived payment removed: the booking would not confirm without a paid credit
  v_orig := pg_get_functiondef('public.pick_followup_slot(uuid,boolean)'::regprocedure);
  v_def := replace(v_orig, 'update public.appointments set payment_status = ''waived'' where id = v_appt.id;', '');
  if v_def = v_orig then raise exception 'SABOTAGE 4 not applied'; end if;
  execute v_def;
  r := pg_temp.offer(pg_temp.f('d'), pg_temp.f('po'), array[330, 345]);
  select id into v_s from public.followup_offer_slots where offer_id = (r ->> 'offer_id')::uuid order by starts_at limit 1;
  r := pg_temp.j(pg_temp.f('po'), format('select public.pick_followup_slot(%L, false)', v_s));
  insert into results values ('sabotaged', 'C3 the appointment is confirmed and waived (no paid credit)', 'confirmed',
    coalesce((select status::text from public.appointments where id = (r ->> 'appointment_id')::uuid), 'err:' || coalesce(r ->> 'msg', r ->> 'status')));
  execute v_orig;

  -- 5. the extras audit removed: the pre-call extras would be an unaudited read
  v_orig := pg_get_functiondef('public.precall_summary(uuid)'::regprocedure);
  v_def := replace(v_orig, 'perform private.s35_audit_read(e.patient_id, array[''precall_extras''], ''Pre-call summary for a scheduled follow-up call'', ''success'');', '');
  if v_def = v_orig then raise exception 'SABOTAGE 5 not applied'; end if;
  execute v_def;
  -- a fresh encounter for the check: pm2's booked call, on which the extras audit has not run
  perform pg_temp.j(pg_temp.f('d'), format('select public.precall_summary(%L)', (select id from public.encounters where patient_id = pg_temp.f('pm2') limit 1)));
  insert into results values ('sabotaged', 'H2 the extras are audited', '1', pg_temp.audit_rows(pg_temp.f('pm2'), pg_temp.f('d'), 'precall_extras')::text);
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'two-tier follow-up proof FAILED on the real migrations: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 5 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 5 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

-- the broken versions: every row below is a check that the sabotage made give a DIFFERENT answer, which is what a working test does
select phase, check_name, expected, actual, case when expected <> actual then 'CAUGHT' else 'MISSED' end as result
from results where phase = 'sabotaged' order by check_name;

rollback;
