-- S74 proof: the clinic booking-calendar contract (migration 20261007161321_s74_pharmacy_sourcing_chat_and_clinic_slots.sql, section C; spec 21.3).
-- Slots and reservations only: no clinical content, dormant under the provider_org_platform module and the per-organisation is_operational switch.
-- One rolled-back transaction. Every role is a simulated signed-in session (JWT claims + role authenticated) or the anon role. Sections:
--   A. Shape: RLS on, no table grant to anon or authenticated, anon has no EXECUTE on any new function, the reservation table holds no clinical column.
--   B. Dormancy: with the module off, or the clinic not operational, the clinic's own staff are refused, nothing is listed, nothing can be held.
--   C. Who manages the calendar: the clinic's own seats yes, another clinic's seat no, a seat without calendar rights no, patient / clinician /
--      pharmacist / anon no, an inactive seat no; the gate OPENS for the right ones; slot shape rules; closing.
--   D. The reservation lifecycle: hold (patient only), capacity, expiry frees the place, confirm (own reservation only, notice names nothing),
--      cancel (own only), a closed slot cannot be booked or confirmed, the module turned off stops a confirm, one live reservation per patient and slot.
--   E. What each role sees: the patient's own reservations only, the roster for the clinic's own staff only (audited), no clinical column anywhere.
--   F. Privacy of the tables: no role reads or writes them directly.
--   G. SABOTAGE: the calendar-staff test forced true, the bookable test forced true, a table grant plus an open policy, the one-live-reservation
--      index dropped, and the confirm guard for a closed slot removed; every one must flip its check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.r(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.anon_q(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.call_as(p_uid uuid, p_call text) returns text language sql as
$$ select pg_temp.q_as(p_uid, 'select ''ok'' from (select ' || p_call || ') x') $$;
create function pg_temp.call_anon(p_call text) returns text language sql as
$$ select pg_temp.anon_q('select ''ok'' from (select ' || p_call || ') x') $$;
create function pg_temp.count_as(p_uid uuid, p_from text) returns text language sql as
$$ select pg_temp.q_as(p_uid, 'select count(*)::text from ' || p_from) $$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.val(p_sql text) returns text language plpgsql volatile as $f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's74s-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S74s ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
-- a clinic: an organisation of type provider_org, its provider_organisations row (operational or not), one location and one service
create function pg_temp.mkclinic(p_label text, p_operational boolean) returns uuid language plpgsql as
$f$ declare v_org uuid; v_po uuid; v_loc uuid; v_svc uuid;
begin
  insert into public.organisations (name, type) values ('S74s ' || p_label, 'provider_org') returning id into v_org;
  insert into public.provider_organisations (organisation_id, org_type, legal_name, onboarding_status, is_operational, activated_at)
  values (v_org, 'clinic', 'S74s ' || p_label || ' Ltd', (case when p_operational then 'active' else 'configuring' end)::public.provider_org_onboarding_status, p_operational, case when p_operational then now() end) returning id into v_po;
  insert into public.provider_org_locations (organisation_id, name) values (v_org, p_label || ' main') returning id into v_loc;
  insert into public.provider_org_services (organisation_id, name) values (v_org, p_label || ' consult') returning id into v_svc;
  perform pg_temp.setf('org_' || p_label, v_org); perform pg_temp.setf('po_' || p_label, v_po); perform pg_temp.setf('loc_' || p_label, v_loc); perform pg_temp.setf('svc_' || p_label, v_svc);
  return v_po;
end $f$;
create function pg_temp.seat(p_org uuid, p_user uuid, p_role text, p_active boolean default true) returns void language sql as
$$ insert into public.provider_org_members (organisation_id, profile_id, org_role, is_active) values (p_org, p_user, p_role::public.provider_org_role, p_active) $$;
create function pg_temp.slot_arg(p_clinic text, p_hours integer, p_cap integer) returns text language sql as
$$ select format('public.clinic_publish_slot(%L, now() + make_interval(hours => %s), now() + make_interval(hours => %s + 1), %s, %L)', pg_temp.f('po_' || p_clinic), p_hours, p_hours, p_cap, pg_temp.f('loc_' || p_clinic)) $$;

create function pg_temp.mkslot(p_user uuid, p_clinic text, p_hours integer, p_cap integer) returns uuid language sql as
$$ select pg_temp.q_as(p_user, 'select ' || pg_temp.slot_arg(p_clinic, p_hours, p_cap) || '::text')::uuid $$;

-- Fixtures ----------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations where type <> 'provider_org' order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', false); perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('clin', pg_temp.mkuser(v_org, 'clin', 'clinician'));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  perform pg_temp.setf('pat3', pg_temp.mkuser(v_org, 'pat3', 'patient'));
  perform pg_temp.setf('pharm', pg_temp.mkuser(v_org, 'pharm', 'pharmacist'));
  perform pg_temp.mkclinic('A', true); perform pg_temp.mkclinic('B', true); perform pg_temp.mkclinic('C', false);
  -- seats: A has a receptionist, an owner, a finance manager (no calendar right), an inactive receptionist; B has a receptionist; C (not operational) has a receptionist
  perform pg_temp.setf('recA', pg_temp.mkuser(v_org, 'recA', 'provider_org_staff', false)); perform pg_temp.seat(pg_temp.f('org_A'), pg_temp.f('recA'), 'receptionist');
  perform pg_temp.setf('ownA', pg_temp.mkuser(v_org, 'ownA', 'provider_org_staff', false)); perform pg_temp.seat(pg_temp.f('org_A'), pg_temp.f('ownA'), 'owner');
  perform pg_temp.setf('finA', pg_temp.mkuser(v_org, 'finA', 'provider_org_staff', false)); perform pg_temp.seat(pg_temp.f('org_A'), pg_temp.f('finA'), 'finance_manager');
  perform pg_temp.setf('offA', pg_temp.mkuser(v_org, 'offA', 'provider_org_staff', false)); perform pg_temp.seat(pg_temp.f('org_A'), pg_temp.f('offA'), 'receptionist', false);
  perform pg_temp.setf('recB', pg_temp.mkuser(v_org, 'recB', 'provider_org_staff', false)); perform pg_temp.seat(pg_temp.f('org_B'), pg_temp.f('recB'), 'receptionist');
  perform pg_temp.setf('recC', pg_temp.mkuser(v_org, 'recC', 'provider_org_staff', false)); perform pg_temp.seat(pg_temp.f('org_C'), pg_temp.f('recC'), 'receptionist');
  -- a test-account receptionist at clinic A, to prove a test calendar never reaches a patient
  perform pg_temp.setf('tstA', pg_temp.mkuser(v_org, 'tstA', 'provider_org_staff', true)); perform pg_temp.seat(pg_temp.f('org_A'), pg_temp.f('tstA'), 'receptionist');
  -- the module is off by default; this proof turns it on later, and checks the off state first
  update public.platform_modules set is_enabled = false, enabled_at = null, enabled_by = null where key = 'provider_org_platform';
end $$;

-- A. Shape ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_fns text[] := array['public.clinic_publish_slot(uuid,timestamptz,timestamptz,integer,uuid,uuid)', 'public.clinic_close_slot(uuid)', 'public.list_clinic_slots(uuid,timestamptz,timestamptz)',
    'public.patient_hold_clinic_slot(uuid)', 'public.patient_confirm_clinic_reservation(uuid)', 'public.patient_cancel_clinic_reservation(uuid)',
    'public.patient_my_clinic_reservations()', 'public.clinic_slot_roster(uuid)'];
begin
  perform pg_temp.r('A1 RLS is on for both tables', '2',
    (select count(*)::text from pg_class where oid in ('public.clinic_booking_slots'::regclass, 'public.clinic_slot_reservations'::regclass) and relrowsecurity));
  perform pg_temp.r('A2 no signed-in role and not anon holds any table privilege on them', '0',
    (select count(*)::text from unnest(array['clinic_booking_slots', 'clinic_slot_reservations']) x, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
      where has_table_privilege('authenticated', 'public.' || x, p) or has_table_privilege('anon', 'public.' || x, p)));
  perform pg_temp.r('A3 anon cannot execute any of the eight public functions', '0', (select count(*)::text from unnest(v_fns) f where has_function_privilege('anon', f::regprocedure, 'EXECUTE')));
  perform pg_temp.r('A4 a signed-in role can execute all eight (the gate is in the function)', '8', (select count(*)::text from unnest(v_fns) f where has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')));
  perform pg_temp.r('A5 PUBLIC holds no execute on any of them (the anon inheritance route is shut)', '0',
    (select count(*)::text from unnest(v_fns) f join pg_proc p on p.oid = f::regprocedure where exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)));
  perform pg_temp.r('A6 the bookable test is closed to both roles; the calendar-staff test is closed to anon', 'false|false|false',
    has_function_privilege('anon', 'private.clinic_bookable(uuid)'::regprocedure, 'EXECUTE')::text || '|' || has_function_privilege('authenticated', 'private.clinic_bookable(uuid)'::regprocedure, 'EXECUTE')::text || '|' ||
    has_function_privilege('anon', 'private.clinic_calendar_staff(uuid)'::regprocedure, 'EXECUTE')::text);
  perform pg_temp.r('A7 the reservation table holds no reason, symptom, note or clinical column', 'cancelled_at,confirmed_at,created_at,hold_expires_at,id,is_test,organisation_id,patient_id,slot_id,state',
    (select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'clinic_slot_reservations'));
  perform pg_temp.r('A8 the roster returns only the reservation, patient number, name and state', 'reservation_id,patient_number,patient_name,state',
    (select string_agg(p.parameter_name, ',' order by p.ordinal_position) from information_schema.parameters p join information_schema.routines r on r.specific_name = p.specific_name
      where r.routine_schema = 'public' and r.routine_name = 'clinic_slot_roster' and p.parameter_mode = 'OUT'));
  perform pg_temp.r('A9 the confirmation notice template is in-app only, and the reservation table is in the S39d registry', '1|1',
    (select count(*)::text from public.notification_templates where key = 'clinic_booking_confirmed' and default_channels = array['in_app']::public.notification_channel[]) || '|' ||
    (select count(*)::text from public.data_registry where table_name = 'clinic_slot_reservations'));
end $$;

-- B. Dormancy ------------------------------------------------------------------------------------------------------------------------
do $$
declare recA uuid := pg_temp.f('recA'); recC uuid := pg_temp.f('recC'); adm uuid := pg_temp.f('admin'); pat uuid := pg_temp.f('pat'); v_slot uuid;
begin
  perform pg_temp.r('B1 the module starts off', 'false', (select coalesce((select is_enabled from public.platform_modules where key = 'provider_org_platform'), false))::text);
  perform pg_temp.r('B2 with the module off, even the clinic''s own receptionist is refused', 'ERR:42501', pg_temp.call_as(recA, pg_temp.slot_arg('A', 48, 1)));
  -- an admin may always manage a calendar (so it can be set up before go-live)
  v_slot := pg_temp.q_as(adm, 'select ' || pg_temp.slot_arg('A', 30, 2) || '::text')::uuid;
  perform pg_temp.setf('slotDormant', v_slot);
  perform pg_temp.r('B3 an admin can set a calendar up before go-live', 'true', (select (count(*) = 1)::text from public.clinic_booking_slots where id = v_slot));
  perform pg_temp.r('B4 ...but a patient sees nothing while the module is off', '0', pg_temp.count_as(pat, format('public.list_clinic_slots(%L)', pg_temp.f('po_A'))));
  perform pg_temp.r('B5 ...and cannot hold it (clinic_not_bookable)', 'ERR:55000', pg_temp.call_as(pat, format('public.patient_hold_clinic_slot(%L)', v_slot)));
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = adm, activation_note = 'S74s proof' where key = 'provider_org_platform';
  perform pg_temp.r('B6 with the module on but the clinic not operational, its receptionist is still refused', 'ERR:42501', pg_temp.call_as(recC, pg_temp.slot_arg('C', 48, 1)));
  -- an admin sets a slot up at the non-operational clinic; a patient still cannot see or hold it
  v_slot := pg_temp.q_as(adm, 'select ' || pg_temp.slot_arg('C', 50, 2) || '::text')::uuid; perform pg_temp.setf('slotC', v_slot);
  perform pg_temp.r('B7 a non-operational clinic offers nothing to a patient, and a hold on it is refused', '0|ERR:55000',
    pg_temp.count_as(pat, format('public.list_clinic_slots(%L)', pg_temp.f('po_C'))) || '|' || pg_temp.call_as(pat, format('public.patient_hold_clinic_slot(%L)', v_slot)));
  perform pg_temp.r('B8 with both on, the dormant-time slot is offered (the gate opens)', '1', pg_temp.count_as(pat, format('public.list_clinic_slots(%L)', pg_temp.f('po_A'))));
end $$;

-- C. Who manages the calendar ---------------------------------------------------------------------------------------------------------
do $$
declare recA uuid := pg_temp.f('recA'); ownA uuid := pg_temp.f('ownA'); finA uuid := pg_temp.f('finA'); offA uuid := pg_temp.f('offA'); recB uuid := pg_temp.f('recB');
  pat uuid := pg_temp.f('pat'); clin uuid := pg_temp.f('clin'); ph uuid := pg_temp.f('pharm'); adm uuid := pg_temp.f('admin'); tstA uuid := pg_temp.f('tstA');
  v_slot uuid; v_poA uuid := pg_temp.f('po_A');
begin
  perform pg_temp.r('C1 the clinic''s receptionist publishes a slot (the gate opens)', 'true',
    (select (pg_temp.q_as(recA, 'select ' || pg_temp.slot_arg('A', 60, 1) || '::text')::uuid is not null)::text));
  perform pg_temp.r('C2 the clinic''s owner seat publishes too', 'ok', pg_temp.call_as(ownA, pg_temp.slot_arg('A', 62, 1)));
  perform pg_temp.r('C3 another clinic''s receptionist cannot publish for this clinic', 'ERR:42501', pg_temp.call_as(recB, pg_temp.slot_arg('A', 64, 1)));
  perform pg_temp.r('C4 a seat without calendar rights (finance manager) cannot', 'ERR:42501', pg_temp.call_as(finA, pg_temp.slot_arg('A', 66, 1)));
  perform pg_temp.r('C5 an inactive seat cannot', 'ERR:42501', pg_temp.call_as(offA, pg_temp.slot_arg('A', 68, 1)));
  perform pg_temp.r('C6 a patient, a clinician and a pharmacist cannot', 'ERR:42501|ERR:42501|ERR:42501',
    pg_temp.call_as(pat, pg_temp.slot_arg('A', 70, 1)) || '|' || pg_temp.call_as(clin, pg_temp.slot_arg('A', 70, 1)) || '|' || pg_temp.call_as(ph, pg_temp.slot_arg('A', 70, 1)));
  perform pg_temp.r('C7 anon cannot', 'ERR:42501', pg_temp.call_anon(pg_temp.slot_arg('A', 72, 1)));
  perform pg_temp.r('C8 an unknown clinic is not found', 'ERR:42501', pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, now() + interval ''3 days'', now() + interval ''3 days 1 hour'')', gen_random_uuid())));
  perform pg_temp.r('C9 none of the refused attempts wrote a slot', '3', (select count(*)::text from public.clinic_booking_slots where clinic_partner_id = v_poA));
  -- shape rules
  perform pg_temp.r('C10 a slot in the past is refused', 'ERR:22023', pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, now() - interval ''1 hour'', now() + interval ''1 hour'')', v_poA)));
  perform pg_temp.r('C11 an end before the start, and a slot over eight hours, are refused', 'ERR:23514|ERR:23514',
    pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, now() + interval ''5 days'', now() + interval ''5 days'' - interval ''1 hour'')', v_poA)) || '|' ||
    pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, now() + interval ''5 days'', now() + interval ''5 days 9 hours'')', v_poA)));
  perform pg_temp.r('C12 a capacity of 0 or 51 is refused', 'ERR:23514|ERR:23514',
    pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, now() + interval ''6 days'', now() + interval ''6 days 1 hour'', 0)', v_poA)) || '|' ||
    pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, now() + interval ''6 days'', now() + interval ''6 days 1 hour'', 51)', v_poA)));
  perform pg_temp.r('C13 a location or service of another clinic is refused; the clinic''s own are accepted', 'ERR:22023|ERR:22023|ok',
    pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, now() + interval ''7 days'', now() + interval ''7 days 1 hour'', 1, %L)', v_poA, pg_temp.f('loc_B'))) || '|' ||
    pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, now() + interval ''7 days'', now() + interval ''7 days 1 hour'', 1, null, %L)', v_poA, pg_temp.f('svc_B'))) || '|' ||
    pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, now() + interval ''7 days'', now() + interval ''7 days 1 hour'', 1, %L, %L)', v_poA, pg_temp.f('loc_A'), pg_temp.f('svc_A'))));
  perform pg_temp.r('C14 the same clinic, location and start time cannot be published twice', 'ERR:23505',
    pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, %L::timestamptz, %L::timestamptz + interval ''1 hour'', 1, %L)', v_poA,
      (select starts_at from public.clinic_booking_slots where clinic_partner_id = v_poA and location_id = pg_temp.f('loc_A') limit 1),
      (select starts_at from public.clinic_booking_slots where clinic_partner_id = v_poA and location_id = pg_temp.f('loc_A') limit 1), pg_temp.f('loc_A'))));
  v_slot := pg_temp.mkslot(tstA, 'A', 80, 1);
  perform pg_temp.r('C15 a slot made by a test account carries the test mark, and is never offered to a patient', 'true|0',
    (select is_test::text from public.clinic_booking_slots where id = v_slot) || '|' ||
    pg_temp.q_as(pat, format('select count(*)::text from public.list_clinic_slots(%L) where slot_id = %L', v_poA, v_slot)));
  perform pg_temp.r('C16 a real slot is offered to a patient, with the places left', '1',
    pg_temp.q_as(pat, format('select min(places_left)::text from public.list_clinic_slots(%L) where starts_at between now() + interval ''59 hours'' and now() + interval ''61 hours''', v_poA)));
  -- closing
  v_slot := pg_temp.mkslot(recA, 'A', 90, 1);
  perform pg_temp.r('C17 another clinic''s receptionist, a patient, a clinician and anon cannot close it', 'ERR:42501|ERR:42501|ERR:42501|ERR:42501',
    pg_temp.call_as(recB, format('public.clinic_close_slot(%L)', v_slot)) || '|' || pg_temp.call_as(pat, format('public.clinic_close_slot(%L)', v_slot)) || '|' ||
    pg_temp.call_as(clin, format('public.clinic_close_slot(%L)', v_slot)) || '|' || pg_temp.call_anon(format('public.clinic_close_slot(%L)', v_slot)));
  perform pg_temp.r('C18 it is still open after those refusals', 'open', (select state from public.clinic_booking_slots where id = v_slot));
  perform pg_temp.r('C19 the clinic''s own receptionist closes it (the gate opens) and it leaves the patient list', 'ok|closed|0',
    pg_temp.call_as(recA, format('public.clinic_close_slot(%L)', v_slot)) || '|' || pg_temp.val(format('select state from public.clinic_booking_slots where id = %L', v_slot)) || '|' ||
    pg_temp.q_as(pat, format('select count(*)::text from public.list_clinic_slots(%L) where slot_id = %L', v_poA, v_slot)));
  perform pg_temp.r('C20 an unknown slot is not found', 'ERR:42501', pg_temp.call_as(recA, format('public.clinic_close_slot(%L)', gen_random_uuid())));
end $$;

-- D. The reservation lifecycle ---------------------------------------------------------------------------------------------------------
do $$
declare recA uuid := pg_temp.f('recA'); pat uuid := pg_temp.f('pat'); pat2 uuid := pg_temp.f('pat2'); pat3 uuid := pg_temp.f('pat3');
  clin uuid := pg_temp.f('clin'); ph uuid := pg_temp.f('pharm'); adm uuid := pg_temp.f('admin'); v_poA uuid := pg_temp.f('po_A');
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; r1 uuid; r2 uuid; r3 uuid; r4 uuid;
begin
  s1 := pg_temp.mkslot(recA, 'A', 100, 1); s2 := pg_temp.mkslot(recA, 'A', 102, 2); s3 := pg_temp.mkslot(recA, 'A', 104, 2); s4 := pg_temp.mkslot(recA, 'A', 106, 1);
  perform pg_temp.setf('s1', s1); perform pg_temp.setf('s2', s2); perform pg_temp.setf('s3', s3);
  -- only a patient can hold
  perform pg_temp.r('D1 a clinician, a pharmacist, a clinic seat, an admin and anon cannot hold a place', 'ERR:42501|ERR:42501|ERR:42501|ERR:42501|ERR:42501',
    pg_temp.call_as(clin, format('public.patient_hold_clinic_slot(%L)', s1)) || '|' || pg_temp.call_as(ph, format('public.patient_hold_clinic_slot(%L)', s1)) || '|' ||
    pg_temp.call_as(recA, format('public.patient_hold_clinic_slot(%L)', s1)) || '|' || pg_temp.call_as(adm, format('public.patient_hold_clinic_slot(%L)', s1)) || '|' ||
    pg_temp.call_anon(format('public.patient_hold_clinic_slot(%L)', s1)));
  r1 := pg_temp.q_as(pat, format('select public.patient_hold_clinic_slot(%L)::text', s1))::uuid; perform pg_temp.setf('r1', r1);
  perform pg_temp.r('D2 a patient holds the last place of a one-place slot (the gate opens): held, expiring in about ten minutes', 'held|true',
    (select state || '|' || (hold_expires_at between now() + interval '9 minutes' and now() + interval '11 minutes')::text from public.clinic_slot_reservations where id = r1));
  perform pg_temp.r('D3 a second patient cannot take it (slot_full), nor can the same patient twice', 'ERR:22023|ERR:22023',
    pg_temp.call_as(pat2, format('public.patient_hold_clinic_slot(%L)', s1)) || '|' || pg_temp.call_as(pat, format('public.patient_hold_clinic_slot(%L)', s1)));
  perform pg_temp.r('D4 the held place is no longer offered', '0', pg_temp.q_as(pat2, format('select count(*)::text from public.list_clinic_slots(%L) where slot_id = %L', v_poA, s1)));
  perform pg_temp.r('D5 a two-place slot takes two patients and refuses a third', 'ok|ok|ERR:22023',
    pg_temp.call_as(pat, format('public.patient_hold_clinic_slot(%L)', s2)) || '|' || pg_temp.call_as(pat2, format('public.patient_hold_clinic_slot(%L)', s2)) || '|' ||
    pg_temp.call_as(pat3, format('public.patient_hold_clinic_slot(%L)', s2)));
  -- an expired hold frees the place
  update public.clinic_slot_reservations set hold_expires_at = now() - interval '1 minute' where id = r1;
  perform pg_temp.r('D6 an expired hold can no longer be confirmed', 'ERR:22023', pg_temp.call_as(pat, format('public.patient_confirm_clinic_reservation(%L)', r1)));
  perform pg_temp.r('D7 an expired hold frees the place: it is offered again and another patient can take it', '1|ok',
    pg_temp.q_as(pat2, format('select count(*)::text from public.list_clinic_slots(%L) where slot_id = %L', v_poA, s1)) || '|' || pg_temp.call_as(pat2, format('public.patient_hold_clinic_slot(%L)', s1)));
  perform pg_temp.r('D8 the expired hold is still stored as held, and the roster lists only the live one', 'held|1',
    (select state from public.clinic_slot_reservations where id = r1) || '|' || pg_temp.q_as(recA, format('select count(*)::text from public.clinic_slot_roster(%L)', s1)));
  -- confirm
  r2 := (select id from public.clinic_slot_reservations where slot_id = s1 and patient_id = pat2 and state = 'held'); perform pg_temp.setf('r2', r2);
  perform pg_temp.r('D9 another patient cannot confirm it, nor a clinician or anon', 'ERR:42501|ERR:42501|ERR:42501',
    pg_temp.call_as(pat3, format('public.patient_confirm_clinic_reservation(%L)', r2)) || '|' || pg_temp.call_as(clin, format('public.patient_confirm_clinic_reservation(%L)', r2)) || '|' ||
    pg_temp.call_anon(format('public.patient_confirm_clinic_reservation(%L)', r2)));
  perform pg_temp.r('D10 the patient confirms their own (the gate opens): confirmed, hold cleared', 'ok|confirmed|true',
    pg_temp.call_as(pat2, format('public.patient_confirm_clinic_reservation(%L)', r2)) || '|' ||
    pg_temp.val(format($v$select state || '|' || (hold_expires_at is null and confirmed_at is not null)::text from public.clinic_slot_reservations where id = %L$v$, r2)));
  perform pg_temp.r('D11 confirming twice is refused', 'ERR:22023', pg_temp.call_as(pat2, format('public.patient_confirm_clinic_reservation(%L)', r2)));
  perform pg_temp.r('D12 the confirmation notice reached that patient, names no clinic reason and carries no payload', '1|0',
    (select count(*)::text from public.notifications where template = 'clinic_booking_confirmed' and recipient_id = pat2) || '|' ||
    (select count(*)::text from public.notifications where template = 'clinic_booking_confirmed' and payload <> '{}'::jsonb));
  perform pg_temp.r('D13 a confirmed place still counts: the one-place slot stays full', 'ERR:22023', pg_temp.call_as(pat3, format('public.patient_hold_clinic_slot(%L)', s1)));
  -- cancel
  perform pg_temp.r('D14 another patient, a clinician and anon cannot cancel it', 'ERR:42501|ERR:42501|ERR:42501',
    pg_temp.call_as(pat3, format('public.patient_cancel_clinic_reservation(%L)', r2)) || '|' || pg_temp.call_as(clin, format('public.patient_cancel_clinic_reservation(%L)', r2)) || '|' ||
    pg_temp.call_anon(format('public.patient_cancel_clinic_reservation(%L)', r2)));
  perform pg_temp.r('D15 the patient cancels their own (the gate opens): the place is free again', 'ok|cancelled|1',
    pg_temp.call_as(pat2, format('public.patient_cancel_clinic_reservation(%L)', r2)) || '|' || pg_temp.val(format('select state from public.clinic_slot_reservations where id = %L', r2)) || '|' ||
    pg_temp.q_as(pat3, format('select count(*)::text from public.list_clinic_slots(%L) where slot_id = %L', v_poA, s1)));
  perform pg_temp.r('D16 cancelling a cancelled place is refused', 'ERR:42501', pg_temp.call_as(pat2, format('public.patient_cancel_clinic_reservation(%L)', r2)));
  -- closed / past slot
  perform pg_temp.call_as(recA, format('public.clinic_close_slot(%L)', s3));
  perform pg_temp.r('D17 a closed slot cannot be held', 'ERR:22023', pg_temp.call_as(pat, format('public.patient_hold_clinic_slot(%L)', s3)));
  update public.clinic_booking_slots set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = s4;
  perform pg_temp.r('D18 a slot that has started cannot be held', 'ERR:22023', pg_temp.call_as(pat, format('public.patient_hold_clinic_slot(%L)', s4)));
  perform pg_temp.r('D19 a hold on a slot that does not exist is refused', 'ERR:22023', pg_temp.call_as(pat, format('public.patient_hold_clinic_slot(%L)', gen_random_uuid())));
  -- a clinic that closes a slot while a patient holds it: the patient cannot confirm into a closed slot
  s3 := pg_temp.mkslot(recA, 'A', 103, 3); r3 := pg_temp.q_as(pat3, format('select public.patient_hold_clinic_slot(%L)::text', s3))::uuid;
  update public.clinic_booking_slots set state = 'closed' where id = s3;   -- closed behind the hold's back (the close function now cancels it; this isolates the confirm guard)
  perform pg_temp.r('D20 a hold on a slot the clinic then closes cannot be confirmed (slot_not_available)', 'ERR:22023', pg_temp.call_as(pat3, format('public.patient_confirm_clinic_reservation(%L)', r3)));
  -- module turned off between hold and confirm
  r4 := pg_temp.q_as(pat3, format('select public.patient_hold_clinic_slot(%L)::text', pg_temp.mkslot(recA, 'A', 110, 3)))::uuid;
  update public.platform_modules set is_enabled = false, enabled_at = null, enabled_by = null where key = 'provider_org_platform';
  perform pg_temp.r('D21 if the module is switched off between hold and confirm, the confirm is refused (clinic_not_bookable)', 'ERR:55000', pg_temp.call_as(pat3, format('public.patient_confirm_clinic_reservation(%L)', r4)));
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = adm, activation_note = 'S74s proof' where key = 'provider_org_platform';
  perform pg_temp.r('D22 ...and works again when it is back on', 'ok', pg_temp.call_as(pat3, format('public.patient_confirm_clinic_reservation(%L)', r4)));
  perform pg_temp.setf('r4', r4);
  -- a clinic suspended from new work (S74 quality) cannot be booked
  insert into public.partner_work_status (partner_kind, partner_id, state, reason_codes, suspended_at) values ('clinic', v_poA, 'suspended', array['licence_expired'], now());
  perform pg_temp.r('D23 a clinic suspended from new work is not offered and cannot be held, but a place already confirmed stands', '0|ERR:55000|confirmed',
    pg_temp.q_as(pat, format('select count(*)::text from public.list_clinic_slots(%L)', v_poA)) || '|' || pg_temp.call_as(pat, format('public.patient_hold_clinic_slot(%L)', pg_temp.mkslot(adm, 'A', 112, 3))) || '|' ||
    (select state from public.clinic_slot_reservations where id = r4));
  delete from public.partner_work_status where partner_kind = 'clinic' and partner_id = v_poA;
  -- one live reservation per patient and slot is also a table rule
  perform pg_temp.r('D24 the table itself refuses a second live reservation for the same patient and slot', '23505',
    pg_temp.try_sql(format('insert into public.clinic_slot_reservations (slot_id, organisation_id, patient_id, state, hold_expires_at) select slot_id, organisation_id, patient_id, ''held'', now() + interval ''5 minutes'' from public.clinic_slot_reservations where id = %L', r4)));
  perform pg_temp.r('D25 ...and a held reservation without an expiry', '23514',
    pg_temp.try_sql(format('insert into public.clinic_slot_reservations (slot_id, organisation_id, patient_id, state) select slot_id, organisation_id, %L, ''held'' from public.clinic_slot_reservations where id = %L', pat, r4)));
end $$;

-- E. What each role sees -----------------------------------------------------------------------------------------------------------------
do $$
declare recA uuid := pg_temp.f('recA'); recB uuid := pg_temp.f('recB'); pat uuid := pg_temp.f('pat'); pat2 uuid := pg_temp.f('pat2'); pat3 uuid := pg_temp.f('pat3');
  clin uuid := pg_temp.f('clin'); ph uuid := pg_temp.f('pharm'); adm uuid := pg_temp.f('admin'); s5 uuid; r5 uuid; r6 uuid;
begin
  perform pg_temp.r('E1 a patient lists only their own reservations (counts differ per patient); a clinician and a clinic seat have none', 'true|true|0|0',
    (select (pg_temp.count_as(pat, 'public.patient_my_clinic_reservations()')::int = (select count(*) from public.clinic_slot_reservations where patient_id = pat))::text) || '|' ||
    (select (pg_temp.count_as(pat3, 'public.patient_my_clinic_reservations()')::int = (select count(*) from public.clinic_slot_reservations where patient_id = pat3))::text) || '|' ||
    pg_temp.count_as(clin, 'public.patient_my_clinic_reservations()') || '|' || pg_temp.count_as(recA, 'public.patient_my_clinic_reservations()'));
  perform pg_temp.r('E2 anon cannot list reservations', 'ERR:42501', pg_temp.anon_q('select count(*)::text from public.patient_my_clinic_reservations()'));
  -- roster: a fresh slot with one confirmed, one held, one cancelled
  s5 := pg_temp.mkslot(recA, 'A', 120, 4);
  r5 := pg_temp.q_as(pat, format('select public.patient_hold_clinic_slot(%L)::text', s5))::uuid; perform pg_temp.call_as(pat, format('public.patient_confirm_clinic_reservation(%L)', r5));
  perform pg_temp.call_as(pat2, format('public.patient_hold_clinic_slot(%L)', s5));
  r6 := pg_temp.q_as(pat3, format('select public.patient_hold_clinic_slot(%L)::text', s5))::uuid; perform pg_temp.call_as(pat3, format('public.patient_cancel_clinic_reservation(%L)', r6));
  perform pg_temp.r('E3 the clinic''s receptionist sees who is coming: the confirmed and the held place, not the cancelled one, with name and number', '2|true|true',
    pg_temp.count_as(recA, format('public.clinic_slot_roster(%L)', s5)) || '|' ||
    pg_temp.q_as(recA, format('select (bool_and(patient_number is not null) and bool_and(patient_name like ''S74s %%''))::text from public.clinic_slot_roster(%L)', s5)) || '|' ||
    pg_temp.q_as(recA, format('select (count(*) filter (where state = ''confirmed'') = 1 and count(*) filter (where state = ''held'') = 1)::text from public.clinic_slot_roster(%L)', s5)));
  update public.clinic_slot_reservations set hold_expires_at = now() - interval '1 minute' where slot_id = s5 and patient_id = pat2;
  perform pg_temp.r('E4 an expired hold drops off the roster', '1', pg_temp.count_as(recA, format('public.clinic_slot_roster(%L)', s5)));
  perform pg_temp.r('E5 an admin can read the roster', '1', pg_temp.count_as(adm, format('public.clinic_slot_roster(%L)', s5)));
  perform pg_temp.r('E6 another clinic''s receptionist, a patient (even one on the slot), a clinician, a pharmacist and anon cannot read it', 'ERR:42501|ERR:42501|ERR:42501|ERR:42501|ERR:42501',
    pg_temp.count_as(recB, format('public.clinic_slot_roster(%L)', s5)) || '|' || pg_temp.count_as(pat, format('public.clinic_slot_roster(%L)', s5)) || '|' ||
    pg_temp.count_as(clin, format('public.clinic_slot_roster(%L)', s5)) || '|' || pg_temp.count_as(ph, format('public.clinic_slot_roster(%L)', s5)) || '|' ||
    pg_temp.anon_q(format('select count(*)::text from public.clinic_slot_roster(%L)', s5)));
  perform pg_temp.r('E7 each roster read is audited, and the audit row holds no name or number', 'true|0',
    (select (count(*) >= 4)::text from public.audit_log where action = 'clinic.roster_read') || '|' ||
    (select count(*)::text from public.audit_log where action = 'clinic.roster_read' and (event::text ilike '%S74s%' or event::text ilike '%+234%')));
  perform pg_temp.r('E8 the confirmation audit rows exist and carry no payload', 'true', (select (count(*) >= 2 and bool_and(event = '{}'::jsonb))::text from public.audit_log where action = 'clinic.reservation_confirmed'));
end $$;

-- F. Privacy of the tables ---------------------------------------------------------------------------------------------------------------
do $$
declare recA uuid := pg_temp.f('recA'); pat uuid := pg_temp.f('pat'); clin uuid := pg_temp.f('clin'); adm uuid := pg_temp.f('admin');
begin
  perform pg_temp.r('F1 no role reads the slot or reservation tables directly (patient, clinic seat, clinician, admin)', 'ERR:42501|ERR:42501|ERR:42501|ERR:42501',
    pg_temp.count_as(pat, 'public.clinic_slot_reservations') || '|' || pg_temp.count_as(recA, 'public.clinic_booking_slots') || '|' || pg_temp.count_as(clin, 'public.clinic_slot_reservations') || '|' || pg_temp.count_as(adm, 'public.clinic_booking_slots'));
  perform pg_temp.r('F2 anon reads neither', 'ERR:42501|ERR:42501', pg_temp.anon_q('select count(*)::text from public.clinic_booking_slots') || '|' || pg_temp.anon_q('select count(*)::text from public.clinic_slot_reservations'));
  perform pg_temp.r('F3 nobody writes them directly (patient reservation, clinic seat slot)', 'ERR:42501|ERR:42501',
    pg_temp.q_as(pat, format('update public.clinic_slot_reservations set state = ''confirmed'' where patient_id = %L', pat)) || '|' ||
    pg_temp.q_as(recA, 'update public.clinic_booking_slots set capacity = 50'));
end $$;

-- H. Hardening (migration 20261023213957): no duplicate slot without a location, closing cancels and tells, no cancelling a confirmed place after the start ----------
do $$
declare recA uuid := pg_temp.f('recA'); recB uuid := pg_temp.f('recB'); pat uuid := pg_temp.f('pat'); pat2 uuid := pg_temp.f('pat2'); pat3 uuid := pg_temp.f('pat3');
  clin uuid := pg_temp.f('clin'); v_poA uuid := pg_temp.f('po_A'); v_poB uuid := pg_temp.f('po_B'); sh uuid; sp uuid; ra uuid; rb uuid; rc uuid; rs uuid; rh uuid; v_def text; v_t timestamptz;
begin
  -- 1. a slot with no location cannot be published twice
  v_t := now() + interval '200 hours';
  perform pg_temp.r('H1 a slot with no location is published once; the same start again is refused (23505); another clinic may use that start', 'ok|ERR:23505|ok',
    pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, %L::timestamptz, %L::timestamptz)', v_poA, v_t, v_t + interval '1 hour')) || '|' ||
    pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, %L::timestamptz, %L::timestamptz)', v_poA, v_t, v_t + interval '1 hour')) || '|' ||
    pg_temp.call_as(recB, format('public.clinic_publish_slot(%L, %L::timestamptz, %L::timestamptz)', v_poB, v_t, v_t + interval '1 hour')));
  perform pg_temp.r('H2 a located slot and a no-location slot at one start can both exist', 'ok',
    pg_temp.call_as(recA, format('public.clinic_publish_slot(%L, %L::timestamptz, %L::timestamptz, 1, %L)', v_poA, v_t, v_t + interval '1 hour', pg_temp.f('loc_A'))));

  -- 2. closing a slot cancels the places and tells each patient once
  sh := pg_temp.mkslot(recA, 'A', 210, 4);
  ra := pg_temp.q_as(pat, format('select public.patient_hold_clinic_slot(%L)::text', sh))::uuid; perform pg_temp.call_as(pat, format('public.patient_confirm_clinic_reservation(%L)', ra));
  rb := pg_temp.q_as(pat2, format('select public.patient_hold_clinic_slot(%L)::text', sh))::uuid;
  rc := pg_temp.q_as(pat3, format('select public.patient_hold_clinic_slot(%L)::text', sh))::uuid; perform pg_temp.call_as(pat3, format('public.patient_cancel_clinic_reservation(%L)', rc));
  perform pg_temp.r('H3 before closing: one confirmed, one held, one already cancelled', 'confirmed,held,cancelled',
    pg_temp.val(format('select string_agg(state, '','' order by array_position(array[''confirmed'',''held'',''cancelled''], state)) from public.clinic_slot_reservations where slot_id = %L', sh)));
  perform pg_temp.r('H4 another clinic''s receptionist and a patient cannot close it, and nothing changes', 'ERR:42501|ERR:42501|2',
    pg_temp.call_as(recB, format('public.clinic_close_slot(%L)', sh)) || '|' || pg_temp.call_as(pat, format('public.clinic_close_slot(%L)', sh)) || '|' ||
    pg_temp.val(format('select count(*)::text from public.clinic_slot_reservations where slot_id = %L and state in (''held'', ''confirmed'')', sh)));
  perform pg_temp.r('H5 the clinic closes it (the gate opens): every live place is cancelled, the roster is empty, the slot is closed', 'ok|cancelled,cancelled,cancelled|0|closed',
    pg_temp.call_as(recA, format('public.clinic_close_slot(%L)', sh)) || '|' ||
    pg_temp.val(format('select string_agg(state, '','') from public.clinic_slot_reservations where slot_id = %L', sh)) || '|' ||
    pg_temp.count_as(recA, format('public.clinic_slot_roster(%L)', sh)) || '|' ||
    pg_temp.val(format('select state from public.clinic_booking_slots where id = %L', sh)));
  perform pg_temp.r('H6 each patient who lost a live place has one in-app notice with no payload; the one who had already cancelled has none', '1|1|0|0',
    (select count(*)::text from public.notifications where template = 'clinic_booking_cancelled_by_clinic' and recipient_id = pat and payload = '{}'::jsonb) || '|' ||
    (select count(*)::text from public.notifications where template = 'clinic_booking_cancelled_by_clinic' and recipient_id = pat2 and payload = '{}'::jsonb) || '|' ||
    (select count(*)::text from public.notifications where template = 'clinic_booking_cancelled_by_clinic' and recipient_id = pat3) || '|' ||
    (select count(*)::text from public.notifications where template = 'clinic_booking_cancelled_by_clinic' and channel <> 'in_app'));
  perform pg_temp.r('H7 closing again does nothing and tells nobody twice', 'ok|2',
    pg_temp.call_as(recA, format('public.clinic_close_slot(%L)', sh)) || '|' || (select count(*)::text from public.notifications where template = 'clinic_booking_cancelled_by_clinic'));
  perform pg_temp.r('H8 the closing is audited with the count and no patient detail', '1|2',
    (select count(*)::text from public.audit_log where action = 'clinic.slot_closed' and entity_id = sh) || '|' ||
    (select (event ->> 'reservations_cancelled') from public.audit_log where action = 'clinic.slot_closed' and entity_id = sh));
  perform pg_temp.r('H9 the cancelled patient can place a new hold on another slot straight away', 'ok', pg_temp.call_as(pat, format('public.patient_hold_clinic_slot(%L)', pg_temp.mkslot(recA, 'A', 212, 2))));
  -- a notice that cannot be written never blocks the close
  sp := pg_temp.mkslot(recA, 'A', 214, 2);
  rh := pg_temp.q_as(pat2, format('select public.patient_hold_clinic_slot(%L)::text', sp))::uuid;
  v_def := pg_get_functiondef('private.rx_notify(uuid,uuid,text)'::regprocedure);
  create or replace function private.rx_notify(p_recipient uuid, p_org uuid, p_template text) returns void language plpgsql security definer set search_path = '' as $f$ begin raise exception 'notice store down'; end $f$;
  perform pg_temp.r('H10 if the notice cannot be written the close still succeeds and the place is still cancelled', 'ok|cancelled',
    pg_temp.call_as(recA, format('public.clinic_close_slot(%L)', sp)) || '|' || pg_temp.val(format('select state from public.clinic_slot_reservations where id = %L', rh)));
  execute v_def;

  -- 3. a confirmed place cannot be cancelled once the slot has started
  sp := pg_temp.mkslot(recA, 'A', 216, 4);
  rs := pg_temp.q_as(pat, format('select public.patient_hold_clinic_slot(%L)::text', sp))::uuid; perform pg_temp.call_as(pat, format('public.patient_confirm_clinic_reservation(%L)', rs));
  rh := pg_temp.q_as(pat2, format('select public.patient_hold_clinic_slot(%L)::text', sp))::uuid;
  perform pg_temp.r('H11 before the start a confirmed place can still be cancelled by its owner (control: a second place on another slot)', 'ok',
    pg_temp.call_as(pat3, format('public.patient_cancel_clinic_reservation(%L)', pg_temp.q_as(pat3, format('select public.patient_hold_clinic_slot(%L)::text', pg_temp.mkslot(recA, 'A', 218, 2))))));
  update public.clinic_booking_slots set starts_at = now() - interval '30 minutes', ends_at = now() + interval '30 minutes' where id = sp;
  perform pg_temp.r('H12 once the slot has started the confirmed place cannot be cancelled (slot_already_started) and stays confirmed', 'ERR:22023|confirmed',
    pg_temp.call_as(pat, format('public.patient_cancel_clinic_reservation(%L)', rs)) || '|' || pg_temp.val(format('select state from public.clinic_slot_reservations where id = %L', rs)));
  perform pg_temp.r('H13 another patient and anon are still refused as not found', 'ERR:42501|ERR:42501',
    pg_temp.call_as(pat3, format('public.patient_cancel_clinic_reservation(%L)', rs)) || '|' || pg_temp.call_anon(format('public.patient_cancel_clinic_reservation(%L)', rs)));
  perform pg_temp.r('H14 an unconfirmed hold on a started slot can still be released by its owner', 'ok|cancelled',
    pg_temp.call_as(pat2, format('public.patient_cancel_clinic_reservation(%L)', rh)) || '|' || pg_temp.val(format('select state from public.clinic_slot_reservations where id = %L', rh)));
end $$;

-- G. SABOTAGE ------------------------------------------------------------------------------------------------------------------------
-- (a) the calendar-staff test forced true: a patient publishes a slot
create or replace function private.clinic_calendar_staff(p_clinic uuid) returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
select pg_temp.sab('a patient is still refused publishing a slot', 'ERR:42501', pg_temp.call_as(pg_temp.f('pat'), pg_temp.slot_arg('A', 140, 1)));
-- (b) the bookable test forced true: the non-operational clinic can be booked
create or replace function private.clinic_bookable(p_clinic uuid) returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
select pg_temp.sab('a non-operational clinic still refuses a hold', 'ERR:55000', pg_temp.call_as(pg_temp.f('pat2'), format('public.patient_hold_clinic_slot(%L)', pg_temp.f('slotC'))));
-- (c) a table grant plus an open policy: a clinician reads every reservation
grant select on public.clinic_slot_reservations to authenticated;
create policy sabotage_open on public.clinic_slot_reservations for select to authenticated using (true);
select pg_temp.sab('a clinician still cannot read the reservation table', 'ERR:42501', pg_temp.count_as(pg_temp.f('clin'), 'public.clinic_slot_reservations'));
-- (d) the one-live-reservation index dropped: the same patient can hold the same slot twice
drop index public.clinic_slot_reservations_one_live;
select pg_temp.sab('the table still refuses a second live reservation for one patient and slot', '23505',
  pg_temp.try_sql(format('insert into public.clinic_slot_reservations (slot_id, organisation_id, patient_id, state, hold_expires_at) select slot_id, organisation_id, patient_id, ''held'', now() + interval ''5 minutes'' from public.clinic_slot_reservations where id = %L', pg_temp.f('r4'))));
-- (e) the confirm path without its closed-slot check (the original body): a closed slot can be confirmed again
create or replace function public.patient_confirm_clinic_reservation(p_reservation uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); r public.clinic_slot_reservations%rowtype; s public.clinic_booking_slots%rowtype;
begin
  select * into r from public.clinic_slot_reservations where id = p_reservation and patient_id = v_uid for update;
  if not found then raise exception 'Reservation not found' using errcode = '42501'; end if;
  select * into s from public.clinic_booking_slots where id = r.slot_id for update;
  if r.state <> 'held' or r.hold_expires_at <= now() then raise exception 'hold_expired' using errcode = '22023'; end if;
  update public.clinic_slot_reservations set state = 'confirmed', confirmed_at = now(), hold_expires_at = null where id = r.id;
end $$;
do $$
declare v_s uuid; v_r uuid;
begin
  v_s := pg_temp.mkslot(pg_temp.f('recA'), 'A', 150, 3);
  v_r := pg_temp.q_as(pg_temp.f('pat'), format('select public.patient_hold_clinic_slot(%L)::text', v_s))::uuid;
  update public.clinic_booking_slots set state = 'closed' where id = v_s;
  perform pg_temp.sab('a hold on a closed slot is still refused at confirm', 'ERR:22023', pg_temp.call_as(pg_temp.f('pat'), format('public.patient_confirm_clinic_reservation(%L)', v_r)));
end $$;

-- (f) the old plain unique rule: two no-location slots at one start can be published again
alter table public.clinic_booking_slots drop constraint clinic_booking_slots_one_per_start;
alter table public.clinic_booking_slots add constraint clinic_booking_slots_old_unique unique (clinic_partner_id, location_id, starts_at);
select pg_temp.call_as(pg_temp.f('recA'), format('public.clinic_publish_slot(%L, now() + interval ''300 hours'', now() + interval ''301 hours'')', pg_temp.f('po_A')));
select pg_temp.sab('a second no-location slot at one start is still refused', 'ERR:23505',
  pg_temp.call_as(pg_temp.f('recA'), format('public.clinic_publish_slot(%L, now() + interval ''300 hours'', now() + interval ''301 hours'')', pg_temp.f('po_A'))));
-- (g) the old close (no cancelling): the confirmed place survives the close
create or replace function public.clinic_close_slot(p_slot uuid) returns void language plpgsql security definer set search_path = '' as $f$
declare s public.clinic_booking_slots%rowtype;
begin
  select * into s from public.clinic_booking_slots where id = p_slot for update;
  if not found or not private.clinic_calendar_staff(s.clinic_partner_id) then raise exception 'Slot not found' using errcode = '42501'; end if;
  update public.clinic_booking_slots set state = 'closed' where id = p_slot;
end $f$;
do $$
declare v_s uuid; v_r uuid;
begin
  v_s := pg_temp.mkslot(pg_temp.f('recA'), 'A', 320, 3);
  v_r := pg_temp.q_as(pg_temp.f('pat'), format('select public.patient_hold_clinic_slot(%L)::text', v_s))::uuid;
  perform pg_temp.call_as(pg_temp.f('recA'), format('public.clinic_close_slot(%L)', v_s));
  perform pg_temp.sab('closing a slot still cancels a held place', 'cancelled', pg_temp.val(format('select state from public.clinic_slot_reservations where id = %L', v_r)));
end $$;
-- (h) the old cancel: a confirmed place can be cancelled after the start
create or replace function public.patient_cancel_clinic_reservation(p_reservation uuid) returns void language plpgsql security definer set search_path = '' as $f$
begin
  update public.clinic_slot_reservations set state = 'cancelled', cancelled_at = now(), hold_expires_at = null
   where id = p_reservation and patient_id = (select auth.uid()) and state in ('held', 'confirmed');
  if not found then raise exception 'Reservation not found' using errcode = '42501'; end if;
end $f$;
do $$
declare v_s uuid; v_r uuid;
begin
  v_s := pg_temp.mkslot(pg_temp.f('recA'), 'A', 330, 3);
  v_r := pg_temp.q_as(pg_temp.f('pat'), format('select public.patient_hold_clinic_slot(%L)::text', v_s))::uuid;
  perform pg_temp.call_as(pg_temp.f('pat'), format('public.patient_confirm_clinic_reservation(%L)', v_r));
  update public.clinic_booking_slots set starts_at = now() - interval '31 minutes', ends_at = now() + interval '30 minutes' where id = v_s;
  perform pg_temp.sab('a started slot still refuses cancelling a confirmed place', 'ERR:22023', pg_temp.call_as(pg_temp.f('pat'), format('public.patient_cancel_clinic_reservation(%L)', v_r)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S74 clinic slot contract proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 8 then raise exception 'VACUOUS TEST: the sabotage flipped % of 8 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
