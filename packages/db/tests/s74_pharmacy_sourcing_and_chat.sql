-- S74 proof: pharmacy verified sourcing, per-supply NAFDAC number, and the in-app pharmacist <-> patient chat
-- (migration 20261007161321_s74_pharmacy_sourcing_chat_and_clinic_slots.sql, sections A and B; spec 21.2).
-- INV-07 (a notice never carries the words), INV-10 (a read is audited), no table grant to anyone for the chat tables.
-- One rolled-back transaction. Every role is a simulated signed-in session (JWT claims + role authenticated) or the anon role. Sections:
--   A. Shape: RLS on, no table grant to anon or authenticated, anon has no EXECUTE on any new function, signed-in roles do, the private helpers are closed.
--   B. Verified sourcing: who may declare (the pharmacy only), who may verify and clear (an admin only), the gate OPENS for them,
--      a new declaration withdraws a verification, a lapsed review date is not verified, the patient-safe boolean, the two list views.
--   C. The per-supply NAFDAC number: only the owning pharmacy, only its own supply, valid format, written once (also against a direct UPDATE).
--   D. The chat: who can send (the patient on their own prescription, the pharmacy it was sent to), who is refused, the gate OPENS for each,
--      the patient opens the conversation, closed / invalid / over-limit, reads, unread, the moved prescription ends the old pharmacy's access.
--   E. Privacy: no table access for any role, append only, a notice and an audit row never carry the words.
--   F. SABOTAGE: five protections removed one by one (append-only trigger, chat-open test, write-once trigger, admin test, table grant + policy);
--      every one must flip its check, so the proof is shown to discriminate.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table txt(k text primary key, v text) on commit drop;
grant all on txt to public;

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
-- run one statement as a signed-in user; the first column of its one row, or ERR:<sqlstate>
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
-- a void/uuid function call as a signed-in user: 'ok' when it ran, else ERR:<sqlstate>
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
  values (v, 's74c-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S74c ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
-- a prescription already with a pharmacy; inserted with triggers off (the fixture is history, not a live transition)
create function pg_temp.mkrx(p_org uuid, p_pat uuid, p_doc uuid, p_partner uuid, p_state text) returns uuid language plpgsql as
$f$ declare v_rx uuid;
begin
  set local session_replication_role = replica;
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test, pharmacy_partner_id, sent_at)
  values (p_org, p_pat, jsonb_build_array(jsonb_build_object('drug_name', 'Proofdrug', 'dose', '5 mg', 'quantity', '30 tablets')), p_state::public.prescription_state,
          p_doc, now() - interval '2 days', true, p_partner, now() - interval '1 day') returning id into v_rx;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, quantity, repeats_allowed, source, is_active, prescription_id)
  values (p_org, p_pat, 'Proofdrug', '5 mg', '30 tablets', 0, 'clinician', true, v_rx);
  set local session_replication_role = origin;
  return v_rx;
end $f$;
-- a pharmacy supply row (source pharmacy) for a prescription, created p_days_ago days ago
create function pg_temp.mkdispense(p_org uuid, p_pat uuid, p_rx uuid, p_days_ago integer) returns uuid language plpgsql as
$f$ declare v uuid; v_med uuid;
begin
  select id into v_med from public.medications where prescription_id = p_rx limit 1;
  set local session_replication_role = replica;
  insert into public.pharmacy_order_dispenses (organisation_id, patient_id, drug_name, quantity, source, medication_id, created_at)
  values (p_org, p_pat, 'Proofdrug', '30 tablets', 'pharmacy', v_med, now() - make_interval(days => p_days_ago)) returning id into v;
  set local session_replication_role = origin;
  return v;
end $f$;

-- Fixtures ----------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_ph uuid; v_ph2 uuid; v_pat uuid; v_doc uuid; v_rx uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('admin', pg_temp.mkuser(v_org, 'admin', 'admin', false));
  perform pg_temp.setf('clin', pg_temp.mkuser(v_org, 'clin', 'clinician'));
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient'); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  v_doc := pg_temp.f('clin');
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status, license_expires_at, nafdac_source_attested_at)
  values ('S74c Pharmacy A', true, now(), now(), 'activated', now() + interval '200 days', now()) returning id into v_ph;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status, license_expires_at, nafdac_source_attested_at)
  values ('S74c Pharmacy B', true, now(), now(), 'activated', now() + interval '200 days', now()) returning id into v_ph2;
  perform pg_temp.setf('phA', v_ph); perform pg_temp.setf('phB', v_ph2);
  perform pg_temp.setf('phAu', pg_temp.mkuser(v_org, 'phAu', 'pharmacist')); update public.profiles set pharmacy_partner_id = v_ph where id = pg_temp.f('phAu');
  perform pg_temp.setf('phBu', pg_temp.mkuser(v_org, 'phBu', 'pharmacist')); update public.profiles set pharmacy_partner_id = v_ph2 where id = pg_temp.f('phBu');
  perform pg_temp.setf('phAoff', pg_temp.mkuser(v_org, 'phAoff', 'pharmacist')); update public.profiles set pharmacy_partner_id = v_ph, is_active = false where id = pg_temp.f('phAoff');
  -- prescriptions: rxA sent to A for pat; rxB sent to B for pat2; rxL (for the daily limit) sent to A; rxN sent to A, no thread yet
  perform pg_temp.setf('rxA', pg_temp.mkrx(v_org, v_pat, v_doc, v_ph, 'sent'));
  perform pg_temp.setf('rxB', pg_temp.mkrx(v_org, pg_temp.f('pat2'), v_doc, v_ph2, 'sent'));
  perform pg_temp.setf('rxL', pg_temp.mkrx(v_org, v_pat, v_doc, v_ph, 'sent'));
  perform pg_temp.setf('rxN', pg_temp.mkrx(v_org, v_pat, v_doc, v_ph, 'sent'));
  perform pg_temp.setf('rxSigned', pg_temp.mkrx(v_org, v_pat, v_doc, v_ph, 'signed'));
  -- dispensed ones: recent (chat open), old (chat closed)
  v_rx := pg_temp.mkrx(v_org, v_pat, v_doc, v_ph, 'dispensed'); perform pg_temp.setf('rxRecent', v_rx);
  perform pg_temp.setf('dRecent', pg_temp.mkdispense(v_org, v_pat, v_rx, 3));
  v_rx := pg_temp.mkrx(v_org, v_pat, v_doc, v_ph, 'dispensed'); perform pg_temp.setf('rxOld', v_rx);
  perform pg_temp.setf('dOld', pg_temp.mkdispense(v_org, v_pat, v_rx, 40));
  -- supplies to record a NAFDAC number against: dA (pharmacy A's), dB (pharmacy B's), dP (recorded by the patient, not the pharmacy)
  perform pg_temp.setf('dA', pg_temp.mkdispense(v_org, v_pat, pg_temp.f('rxA'), 1));
  perform pg_temp.setf('dB', pg_temp.mkdispense(v_org, pg_temp.f('pat2'), pg_temp.f('rxB'), 1));
  select id into v_rx from public.medications where prescription_id = pg_temp.f('rxN') limit 1;
  set local session_replication_role = replica;
  insert into public.pharmacy_order_dispenses (organisation_id, patient_id, drug_name, quantity, source, medication_id)
  values (v_org, v_pat, 'Proofdrug', '30 tablets', 'patient', v_rx) returning id into v_rx;
  set local session_replication_role = origin;
  perform pg_temp.setf('dP', v_rx);
end $$;

-- A. Shape ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_fns text[] := array[
    'public.pharmacist_declare_sourcing(text)', 'public.verify_pharmacy_sourcing(uuid,text,integer)', 'public.clear_pharmacy_sourcing(uuid,text)',
    'public.pharmacy_sourcing_verified(uuid)', 'public.pharmacist_record_dispense_sourcing(uuid,text,text)', 'public.pharmacist_my_sourcing()', 'public.admin_pharmacy_sourcing()',
    'public.patient_send_pharmacy_message(uuid,text)', 'public.pharmacist_send_message(uuid,text)', 'public.patient_pharmacy_conversation(uuid)',
    'public.pharmacist_conversation(uuid)', 'public.pharmacist_conversation_list()'];
begin
  perform pg_temp.r('A1 RLS is on for the three chat tables', '3',
    (select count(*)::text from pg_class where oid in ('public.pharmacy_chat_config'::regclass, 'public.pharmacy_threads'::regclass, 'public.pharmacy_messages'::regclass) and relrowsecurity));
  perform pg_temp.r('A2 no signed-in role and not anon holds any table privilege on them', '0',
    (select count(*)::text from unnest(array['pharmacy_chat_config', 'pharmacy_threads', 'pharmacy_messages']) x, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
      where has_table_privilege('authenticated', 'public.' || x, p) or has_table_privilege('anon', 'public.' || x, p)));
  perform pg_temp.r('A3 anon cannot execute any of the twelve new public functions', '0',
    (select count(*)::text from unnest(v_fns) f where has_function_privilege('anon', f::regprocedure, 'EXECUTE')));
  perform pg_temp.r('A4 a signed-in role can execute all twelve (the gate is in the function, not the grant)', '12',
    (select count(*)::text from unnest(v_fns) f where has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')));
  perform pg_temp.r('A5 PUBLIC holds no execute on any of them (the anon inheritance route is shut)', '0',
    (select count(*)::text from unnest(v_fns) f join pg_proc p on p.oid = f::regprocedure where exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)));
  perform pg_temp.r('A6 the private helpers (send, open test, setting reader, dispense guard) are closed to both roles', '0',
    (select count(*)::text from unnest(array['private.pharmacy_chat_send(uuid,text,text)', 'private.pharmacy_chat_open(uuid,uuid)', 'private.pharmacy_chat_setting(text)', 'private.guard_dispense_sourcing()']) f
      where has_function_privilege('anon', f::regprocedure, 'EXECUTE') or has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')));
  perform pg_temp.r('A7 one active chat configuration, version 1, with its three rules', '1|1|1000|20|14',
    (select count(*)::text || '|' || max(version)::text || '|' || max((rules ->> 'max_body_chars')) || '|' || max((rules ->> 'max_per_sender_per_day')) || '|' || max((rules ->> 'open_days_after_supply'))
       from public.pharmacy_chat_config where is_active));
  perform pg_temp.r('A8 the two chat notice templates are in-app only and the patient-keyed thread table is in the S39d registry', '2|1',
    (select count(*)::text from public.notification_templates where key in ('pharmacy_message_patient', 'pharmacy_message_pharmacy') and default_channels = array['in_app']::public.notification_channel[])
    || '|' || (select count(*)::text from public.data_registry where table_name = 'pharmacy_threads'));
end $$;

-- B. Verified sourcing -----------------------------------------------------------------------------------------------------------------
do $$
declare phA uuid := pg_temp.f('phA'); phB uuid := pg_temp.f('phB'); a uuid := pg_temp.f('phAu'); b uuid := pg_temp.f('phBu'); pat uuid := pg_temp.f('pat');
  clin uuid := pg_temp.f('clin'); adm uuid := pg_temp.f('admin'); v_stmt text := 'We buy only from NAFDAC registered distributors: Emzor and May and Baker, with invoices.';
begin
  -- declare: the pharmacy only
  perform pg_temp.r('B1 a statement that is too short is refused', 'ERR:22023', pg_temp.call_as(a, 'public.pharmacist_declare_sourcing(''too short'')'));
  perform pg_temp.r('B2 a patient cannot declare a pharmacy''s sources', 'ERR:42501', pg_temp.call_as(pat, format('public.pharmacist_declare_sourcing(%L)', v_stmt)));
  perform pg_temp.r('B3 a clinician cannot', 'ERR:42501', pg_temp.call_as(clin, format('public.pharmacist_declare_sourcing(%L)', v_stmt)));
  perform pg_temp.r('B4 an admin cannot declare on a pharmacy''s behalf', 'ERR:42501', pg_temp.call_as(adm, format('public.pharmacist_declare_sourcing(%L)', v_stmt)));
  perform pg_temp.r('B5 anon cannot', 'ERR:42501', pg_temp.call_anon(format('public.pharmacist_declare_sourcing(%L)', v_stmt)));
  perform pg_temp.r('B6 a pharmacist whose login is switched off cannot', 'ERR:42501', pg_temp.call_as(pg_temp.f('phAoff'), format('public.pharmacist_declare_sourcing(%L)', v_stmt)));
  perform pg_temp.r('B7 the pharmacy''s own pharmacist can (the gate opens)', 'ok', pg_temp.call_as(a, format('public.pharmacist_declare_sourcing(%L)', v_stmt)));
  perform pg_temp.r('B8 it landed on pharmacy A only, with the declarer recorded', 'true|true|true',
    (select (sourcing_declared_by = a)::text || '|' || (sourcing_statement = v_stmt)::text || '|' || (sourcing_verified_at is null)::text from public.pharmacy_partners where id = phA)
    || '' );
  perform pg_temp.r('B9 pharmacy B is untouched', 'null', (select coalesce(sourcing_statement, 'null') from public.pharmacy_partners where id = phB));

  -- verify: an admin only
  perform pg_temp.r('B10 the pharmacy cannot verify itself', 'ERR:42501', pg_temp.call_as(a, format('public.verify_pharmacy_sourcing(%L, %L)', phA, 'I checked all of my own invoices today')));
  perform pg_temp.r('B11 another pharmacy cannot verify it', 'ERR:42501', pg_temp.call_as(b, format('public.verify_pharmacy_sourcing(%L, %L)', phA, 'I checked all of my own invoices today')));
  perform pg_temp.r('B12 a patient cannot', 'ERR:42501', pg_temp.call_as(pat, format('public.verify_pharmacy_sourcing(%L, %L)', phA, 'I checked all of the invoices today')));
  perform pg_temp.r('B13 a clinician cannot', 'ERR:42501', pg_temp.call_as(clin, format('public.verify_pharmacy_sourcing(%L, %L)', phA, 'I checked all of the invoices today')));
  perform pg_temp.r('B14 anon cannot', 'ERR:42501', pg_temp.call_anon(format('public.verify_pharmacy_sourcing(%L, %L)', phA, 'I checked all of the invoices today')));
  perform pg_temp.r('B15 an admin must write what was checked (20 characters)', 'ERR:22023', pg_temp.call_as(adm, format('public.verify_pharmacy_sourcing(%L, %L)', phA, 'looks fine')));
  perform pg_temp.r('B16 the review period is 1 to 24 months', 'ERR:22023|ERR:22023',
    pg_temp.call_as(adm, format('public.verify_pharmacy_sourcing(%L, %L, 0)', phA, 'Checked the invoices against the register')) || '|' ||
    pg_temp.call_as(adm, format('public.verify_pharmacy_sourcing(%L, %L, 25)', phA, 'Checked the invoices against the register')));
  perform pg_temp.r('B17 a pharmacy that has not declared cannot be verified', 'ERR:22023', pg_temp.call_as(adm, format('public.verify_pharmacy_sourcing(%L, %L)', phB, 'Checked the invoices against the register')));
  perform pg_temp.r('B18 an admin can verify a declared pharmacy (the gate opens)', 'ok', pg_temp.call_as(adm, format('public.verify_pharmacy_sourcing(%L, %L, 6)', phA, 'Checked three invoices against the NAFDAC register')));
  perform pg_temp.r('B19 the verification names the admin, the note, and a review date about six months out', 'true|true|true',
    (select (sourcing_verified_by = adm)::text || '|' || (sourcing_note like 'Checked three%')::text || '|' || (sourcing_review_due_at between now() + interval '5 months' and now() + interval '7 months')::text
       from public.pharmacy_partners where id = phA));

  -- the patient-safe boolean
  perform pg_temp.r('B20 a patient sees the check as standing for A and not for B', 'true|false',
    pg_temp.q_as(pat, format('select public.pharmacy_sourcing_verified(%L)::text', phA)) || '|' || pg_temp.q_as(pat, format('select public.pharmacy_sourcing_verified(%L)::text', phB)));
  perform pg_temp.r('B21 anon cannot ask', 'ERR:42501', pg_temp.anon_q(format('select public.pharmacy_sourcing_verified(%L)::text', phA)));
  update public.pharmacy_partners set sourcing_review_due_at = now() - interval '1 day' where id = phA;
  perform pg_temp.r('B22 a check past its review date does not stand (patient, and the pharmacy''s own view)', 'false|false',
    pg_temp.q_as(pat, format('select public.pharmacy_sourcing_verified(%L)::text', phA)) || '|' || pg_temp.q_as(a, 'select is_verified::text from public.pharmacist_my_sourcing()'));
  update public.pharmacy_partners set sourcing_review_due_at = now() + interval '5 months' where id = phA;
  perform pg_temp.r('B23 ...and stands again when the date is in the future', 'true', pg_temp.q_as(pat, format('select public.pharmacy_sourcing_verified(%L)::text', phA)));
  perform pg_temp.r('B24 the table refuses a verified row that was never declared', '23514',
    pg_temp.try_sql(format('update public.pharmacy_partners set sourcing_declared_at = null where id = %L', phA)));

  -- views
  perform pg_temp.r('B25 the pharmacy sees its own sourcing, not another pharmacy''s', 'true|null',
    pg_temp.q_as(a, 'select (statement like ''We buy only%'')::text from public.pharmacist_my_sourcing()') || '|' || coalesce(pg_temp.q_as(b, 'select statement from public.pharmacist_my_sourcing()'), 'null'));
  perform pg_temp.r('B26 a patient and a clinician have no pharmacy, so see no rows', '0|0',
    pg_temp.count_as(pat, 'public.pharmacist_my_sourcing()') || '|' || pg_temp.count_as(clin, 'public.pharmacist_my_sourcing()'));
  perform pg_temp.r('B27 the admin list shows every pharmacy; the others see nothing', '1|0|0|0|0',
    (select (count(*) >= 2)::int::text from public.pharmacy_partners) || '|' || pg_temp.count_as(a, 'public.admin_pharmacy_sourcing()') || '|' || pg_temp.count_as(pat, 'public.admin_pharmacy_sourcing()')
      || '|' || pg_temp.count_as(clin, 'public.admin_pharmacy_sourcing()') || '|' ||
      coalesce(case when pg_temp.anon_q('select count(*)::text from public.admin_pharmacy_sourcing()') like 'ERR:%' then '0' end, '1'));
  perform pg_temp.r('B28 the admin list does return rows to an admin', 'true', pg_temp.q_as(adm, 'select (count(*) >= 2)::text from public.admin_pharmacy_sourcing()'));

  -- a new declaration withdraws the verification; clearing is an admin act with a reason
  perform pg_temp.r('B29 a new declaration withdraws a standing verification', 'ok|true|false',
    pg_temp.call_as(a, 'public.pharmacist_declare_sourcing(''We now also buy from Fidson Healthcare, with invoices on file.'')') || '|' ||
    pg_temp.val(format($v$select (sourcing_verified_at is null and sourcing_note is null)::text from public.pharmacy_partners where id = %L$v$, phA)) || '|' ||
    pg_temp.q_as(pat, format('select public.pharmacy_sourcing_verified(%L)::text', phA)));
  perform pg_temp.call_as(adm, format('public.verify_pharmacy_sourcing(%L, %L)', phA, 'Checked the new supplier invoices against the register'));
  perform pg_temp.r('B30 only an admin can clear a check, with a reason of 20 characters', 'ERR:42501|ERR:42501|ERR:42501|ERR:22023',
    pg_temp.call_as(a, format('public.clear_pharmacy_sourcing(%L, %L)', phA, 'I would like this removed please now')) || '|' ||
    pg_temp.call_as(pat, format('public.clear_pharmacy_sourcing(%L, %L)', phA, 'I would like this removed please now')) || '|' ||
    pg_temp.call_anon(format('public.clear_pharmacy_sourcing(%L, %L)', phA, 'I would like this removed please now')) || '|' ||
    pg_temp.call_as(adm, format('public.clear_pharmacy_sourcing(%L, %L)', phA, 'short')));
  perform pg_temp.r('B31 an admin can clear it (the gate opens) and it no longer stands', 'ok|false',
    pg_temp.call_as(adm, format('public.clear_pharmacy_sourcing(%L, %L)', phA, 'The distributor invoices did not match the register')) || '|' ||
    pg_temp.q_as(pat, format('select public.pharmacy_sourcing_verified(%L)::text', phA)));
  perform pg_temp.r('B32 declaring, verifying and clearing are each in the audit log, without the statement', '2|1|0',
    (select count(*)::text from public.audit_log where action = 'pharmacy.sourcing_declared' and entity_id = phA) || '|' ||
    (select count(*)::text from public.audit_log where action = 'pharmacy.sourcing_cleared' and entity_id = phA) || '|' ||
    (select count(*)::text from public.audit_log where action like 'pharmacy.sourcing_%' and event::text ilike '%Fidson%'));
end $$;

-- C. The per-supply NAFDAC number ------------------------------------------------------------------------------------------------------
do $$
declare a uuid := pg_temp.f('phAu'); b uuid := pg_temp.f('phBu'); pat uuid := pg_temp.f('pat'); clin uuid := pg_temp.f('clin'); adm uuid := pg_temp.f('admin');
  dA uuid := pg_temp.f('dA'); dP uuid := pg_temp.f('dP');
begin
  perform pg_temp.r('C1 another pharmacy cannot record sourcing on this supply', 'ERR:42501', pg_temp.call_as(b, format('public.pharmacist_record_dispense_sourcing(%L, ''A4-1234'', ''Emzor'')', dA)));
  perform pg_temp.r('C2 a patient, a clinician and an admin cannot', 'ERR:42501|ERR:42501|ERR:42501',
    pg_temp.call_as(pat, format('public.pharmacist_record_dispense_sourcing(%L, ''A4-1234'', ''Emzor'')', dA)) || '|' ||
    pg_temp.call_as(clin, format('public.pharmacist_record_dispense_sourcing(%L, ''A4-1234'', ''Emzor'')', dA)) || '|' ||
    pg_temp.call_as(adm, format('public.pharmacist_record_dispense_sourcing(%L, ''A4-1234'', ''Emzor'')', dA)));
  perform pg_temp.r('C3 anon cannot', 'ERR:42501', pg_temp.call_anon(format('public.pharmacist_record_dispense_sourcing(%L, ''A4-1234'', ''Emzor'')', dA)));
  perform pg_temp.r('C4 a supply the patient recorded themselves is not the pharmacy''s to annotate', 'ERR:42501', pg_temp.call_as(a, format('public.pharmacist_record_dispense_sourcing(%L, ''A4-1234'', ''Emzor'')', dP)));
  perform pg_temp.r('C5 a made-up supply id is not found', 'ERR:42501', pg_temp.call_as(a, format('public.pharmacist_record_dispense_sourcing(%L, ''A4-1234'', ''Emzor'')', gen_random_uuid())));
  perform pg_temp.r('C6 a malformed NAFDAC number is refused (four shapes)', 'ERR:22023|ERR:22023|ERR:22023|ERR:22023',
    pg_temp.call_as(a, format('public.pharmacist_record_dispense_sourcing(%L, ''1234'', ''Emzor'')', dA)) || '|' ||
    pg_temp.call_as(a, format('public.pharmacist_record_dispense_sourcing(%L, ''ABCD-1234'', ''Emzor'')', dA)) || '|' ||
    pg_temp.call_as(a, format('public.pharmacist_record_dispense_sourcing(%L, ''A4-12'', ''Emzor'')', dA)) || '|' ||
    pg_temp.call_as(a, format('public.pharmacist_record_dispense_sourcing(%L, '''', ''Emzor'')', dA)));
  perform pg_temp.r('C7 a missing or one-letter supplier is refused', 'ERR:22023|ERR:22023',
    pg_temp.call_as(a, format('public.pharmacist_record_dispense_sourcing(%L, ''A4-1234'', ''E'')', dA)) || '|' || pg_temp.call_as(a, format('public.pharmacist_record_dispense_sourcing(%L, ''A4-1234'', null)', dA)));
  perform pg_temp.r('C8 nothing was written by any refusal', '0', (select count(*)::text from public.pharmacy_order_dispenses where id = dA and (product_nafdac_reg_no is not null or supplier_name is not null or sourcing_recorded_at is not null)));
  perform pg_temp.r('C9 the owning pharmacy records it, in lower case, and it is stored upper case (the gate opens)', 'ok|A4-1234|Emzor Pharma|true',
    pg_temp.call_as(a, format('public.pharmacist_record_dispense_sourcing(%L, ''a4-1234'', '' Emzor Pharma '')', dA)) || '|' ||
    pg_temp.val(format($v$select product_nafdac_reg_no || '|' || supplier_name || '|' || (sourcing_recorded_at is not null)::text from public.pharmacy_order_dispenses where id = %L$v$, dA)));
  perform pg_temp.r('C10 it cannot be recorded a second time', 'ERR:22023', pg_temp.call_as(a, format('public.pharmacist_record_dispense_sourcing(%L, ''B5-9999'', ''Other'')', dA)));
  perform pg_temp.r('C11 even the table owner''s direct UPDATE cannot overwrite it (the write-once trigger)', '42501',
    pg_temp.try_sql(format('update public.pharmacy_order_dispenses set product_nafdac_reg_no = ''B5-9999'' where id = %L', dA)));
  perform pg_temp.r('C12 ...nor the supplier or the time', '42501|42501',
    pg_temp.try_sql(format('update public.pharmacy_order_dispenses set supplier_name = ''Someone else'' where id = %L', dA)) || '|' ||
    pg_temp.try_sql(format('update public.pharmacy_order_dispenses set sourcing_recorded_at = now() + interval ''1 hour'' where id = %L', dA)));
  perform pg_temp.r('C13 an unrelated column on the same row can still change', 'ok', pg_temp.try_sql(format('update public.pharmacy_order_dispenses set quantity = ''28 tablets'' where id = %L', dA)));
  perform pg_temp.r('C14 the table refuses a number with no time, or a time with no number', '23514|23514',
    pg_temp.try_sql(format('update public.pharmacy_order_dispenses set product_nafdac_reg_no = ''C1-1111'' where id = %L', dP)) || '|' ||
    pg_temp.try_sql(format('update public.pharmacy_order_dispenses set sourcing_recorded_at = now() where id = %L', dP)));
  perform pg_temp.r('C15 the table refuses a malformed number written directly', '23514', pg_temp.try_sql(format('update public.pharmacy_order_dispenses set product_nafdac_reg_no = ''bad'', sourcing_recorded_at = now() where id = %L', dP)));
  perform pg_temp.r('C16 the recording is audited with the pharmacy, not the number', '1|0',
    (select count(*)::text from public.audit_log where action = 'pharmacy.dispense_sourcing_recorded' and entity_id = dA) || '|' ||
    (select count(*)::text from public.audit_log where action = 'pharmacy.dispense_sourcing_recorded' and event::text like '%A4-1234%'));
end $$;

-- D. The chat --------------------------------------------------------------------------------------------------------------------------
do $$
declare a uuid := pg_temp.f('phAu'); b uuid := pg_temp.f('phBu'); pat uuid := pg_temp.f('pat'); pat2 uuid := pg_temp.f('pat2'); clin uuid := pg_temp.f('clin'); adm uuid := pg_temp.f('admin');
  rxA uuid := pg_temp.f('rxA'); rxN uuid := pg_temp.f('rxN'); rxL uuid := pg_temp.f('rxL'); i integer; v_res text;
begin
  -- the patient opens the conversation; the pharmacy only answers
  perform pg_temp.r('D1 the pharmacy cannot start a conversation the patient has not opened', 'ERR:22023', pg_temp.call_as(a, format('public.pharmacist_send_message(%L, ''Hello, your medicine is ready'')', rxN)));
  perform pg_temp.r('D2 the patient''s own prescription: the patient sends (the gate opens)', 'ok', pg_temp.call_as(pat, format('public.patient_send_pharmacy_message(%L, ''Is my amlodipine ready to collect?'')', rxA)));
  perform pg_temp.r('D3 one thread was made for the prescription and pharmacy, linked to the right patient', '1|true',
    (select count(*)::text || '|' || bool_and(patient_id = pat and pharmacy_partner_id = pg_temp.f('phA'))::text from public.pharmacy_threads where prescription_id = rxA));
  perform pg_temp.r('D4 the pharmacy it was sent to answers (the gate opens)', 'ok', pg_temp.call_as(a, format('public.pharmacist_send_message(%L, ''Yes, it is ready from 9am'')', rxA)));
  -- refused senders on rxA
  perform pg_temp.r('D5 another patient cannot write in this patient''s thread', 'ERR:42501', pg_temp.call_as(pat2, format('public.patient_send_pharmacy_message(%L, ''I am not the owner'')', rxA)));
  perform pg_temp.r('D6 another pharmacy cannot write in it', 'ERR:42501', pg_temp.call_as(b, format('public.pharmacist_send_message(%L, ''I am not the pharmacy'')', rxA)));
  perform pg_temp.r('D7 a pharmacist cannot use the patient entry point, a patient cannot use the pharmacist one', 'ERR:42501|ERR:42501',
    pg_temp.call_as(a, format('public.patient_send_pharmacy_message(%L, ''x'')', rxA)) || '|' || pg_temp.call_as(pat, format('public.pharmacist_send_message(%L, ''x'')', rxA)));
  perform pg_temp.r('D8 a clinician and an admin can send neither way', 'ERR:42501|ERR:42501|ERR:42501|ERR:42501',
    pg_temp.call_as(clin, format('public.patient_send_pharmacy_message(%L, ''x'')', rxA)) || '|' || pg_temp.call_as(clin, format('public.pharmacist_send_message(%L, ''x'')', rxA)) || '|' ||
    pg_temp.call_as(adm, format('public.patient_send_pharmacy_message(%L, ''x'')', rxA)) || '|' || pg_temp.call_as(adm, format('public.pharmacist_send_message(%L, ''x'')', rxA)));
  perform pg_temp.r('D9 anon can send neither way', 'ERR:42501|ERR:42501',
    pg_temp.call_anon(format('public.patient_send_pharmacy_message(%L, ''x'')', rxA)) || '|' || pg_temp.call_anon(format('public.pharmacist_send_message(%L, ''x'')', rxA)));
  perform pg_temp.r('D10 a pharmacist whose login is off cannot answer', 'ERR:42501', pg_temp.call_as(pg_temp.f('phAoff'), format('public.pharmacist_send_message(%L, ''x'')', rxA)));
  perform pg_temp.r('D11 an unknown prescription is not found', 'ERR:42501', pg_temp.call_as(pat, format('public.patient_send_pharmacy_message(%L, ''x'')', gen_random_uuid())));
  perform pg_temp.r('D12 only the two real messages exist so far', '2', (select count(*)::text from public.pharmacy_messages m join public.pharmacy_threads t on t.id = m.thread_id where t.prescription_id = rxA));
  -- body rules
  perform pg_temp.r('D13 an empty or all-space message is refused', 'ERR:22023|ERR:22023',
    pg_temp.call_as(pat, format('public.patient_send_pharmacy_message(%L, '''')', rxA)) || '|' || pg_temp.call_as(pat, format('public.patient_send_pharmacy_message(%L, ''    '')', rxA)));
  perform pg_temp.r('D14 1001 characters is refused, 1000 is accepted', 'ERR:22023|ok',
    pg_temp.call_as(pat, format('public.patient_send_pharmacy_message(%L, %L)', rxA, repeat('x', 1001))) || '|' || pg_temp.call_as(pat, format('public.patient_send_pharmacy_message(%L, %L)', rxA, repeat('y', 1000))));
  -- open / closed
  perform pg_temp.r('D15 a prescription not yet sent (still signed) has no open chat', 'ERR:22023', pg_temp.call_as(pat, format('public.patient_send_pharmacy_message(%L, ''hello'')', pg_temp.f('rxSigned'))));
  perform pg_temp.r('D16 a supply made 3 days ago keeps the chat open', 'ok', pg_temp.call_as(pat, format('public.patient_send_pharmacy_message(%L, ''Thank you, one question about the dose'')', pg_temp.f('rxRecent'))));
  perform pg_temp.r('D17 a supply made 40 days ago has closed it', 'ERR:22023', pg_temp.call_as(pat, format('public.patient_send_pharmacy_message(%L, ''Can I ask something?'')', pg_temp.f('rxOld'))));
  -- daily limit of 20 per sender, per thread
  for i in 1..20 loop
    v_res := pg_temp.call_as(pat, format('public.patient_send_pharmacy_message(%L, %L)', rxL, 'limit message ' || i));
    exit when v_res <> 'ok';
  end loop;
  perform pg_temp.r('D18 twenty messages in a day are accepted and the twenty-first is not', 'ok|ERR:22023',
    v_res || '|' || pg_temp.call_as(pat, format('public.patient_send_pharmacy_message(%L, ''the twenty-first'')', rxL)));
  perform pg_temp.r('D19 the limit is per sender: the pharmacy can still answer', 'ok', pg_temp.call_as(a, format('public.pharmacist_send_message(%L, ''Noted, all fine'')', rxL)));
  -- reads
  perform pg_temp.r('D20 the patient reads their own conversation (3 messages, open)', '3|true', pg_temp.q_as(pat, format('select count(*)::text || ''|'' || bool_and(is_open)::text from public.patient_pharmacy_conversation(%L)', rxA)));
  perform pg_temp.r('D21 the pharmacy it was sent to reads it (same 3)', '3', pg_temp.count_as(a, format('public.pharmacist_conversation(%L)', rxA)));
  perform pg_temp.r('D22 another patient reads nothing of it', '0', pg_temp.count_as(pat2, format('public.patient_pharmacy_conversation(%L)', rxA)));
  perform pg_temp.r('D23 another pharmacy reads nothing of it', '0', pg_temp.count_as(b, format('public.pharmacist_conversation(%L)', rxA)));
  perform pg_temp.r('D24 a clinician and an admin have no pharmacy and no read path', 'ERR:42501|ERR:42501|0|0',
    pg_temp.count_as(clin, format('public.pharmacist_conversation(%L)', rxA)) || '|' || pg_temp.count_as(adm, format('public.pharmacist_conversation(%L)', rxA)) || '|' ||
    pg_temp.count_as(clin, format('public.patient_pharmacy_conversation(%L)', rxA)) || '|' || pg_temp.count_as(adm, format('public.patient_pharmacy_conversation(%L)', rxA)));
  perform pg_temp.r('D25 anon reads nothing', 'ERR:42501|ERR:42501',
    pg_temp.anon_q(format('select count(*)::text from public.patient_pharmacy_conversation(%L)', rxA)) || '|' || pg_temp.anon_q(format('select count(*)::text from public.pharmacist_conversation(%L)', rxA)));
  -- unread and the inbox
  perform pg_temp.call_as(pat, format('public.patient_send_pharmacy_message(%L, ''One more thing about collection'')', rxA));
  -- now() is frozen inside one transaction, so move the pharmacy's last read an hour back to stand for time passing
  update public.pharmacy_threads set pharmacy_read_at = now() - interval '1 hour' where prescription_id = rxA;
  perform pg_temp.r('D26 the pharmacy''s inbox shows the thread unread, with no words and no medicine', 'true|prescription_id,last_message_at,unread,is_open',
    pg_temp.q_as(a, format('select bool_or(unread)::text from public.pharmacist_conversation_list() where prescription_id = %L', rxA)) || '|' ||
    (select string_agg(p.parameter_name, ',' order by p.ordinal_position) from information_schema.parameters p join information_schema.routines r on r.specific_name = p.specific_name
      where r.routine_schema = 'public' and r.routine_name = 'pharmacist_conversation_list' and p.parameter_mode = 'OUT'));
  perform pg_temp.r('D27 reading it returns all 4 messages', '4', pg_temp.count_as(a, format('public.pharmacist_conversation(%L)', rxA)));
  perform pg_temp.r('D28 ...so the inbox shows it read', 'false', pg_temp.q_as(a, format('select bool_or(unread)::text from public.pharmacist_conversation_list() where prescription_id = %L', rxA)));
  perform pg_temp.r('D29 another pharmacy''s inbox does not list it; nor does a patient''s', '0|0',
    pg_temp.count_as(b, format('public.pharmacist_conversation_list() where prescription_id = %L', rxA)) || '|' || pg_temp.count_as(pat, 'public.pharmacist_conversation_list()'));
  -- the prescription moves
  update public.prescriptions set pharmacy_partner_id = pg_temp.f('phB') where id = rxA;
  perform pg_temp.r('D30 a patient who moves the prescription to another pharmacy ends the old pharmacy''s read and write access', '0|ERR:42501|0',
    pg_temp.count_as(a, format('public.pharmacist_conversation(%L)', rxA)) || '|' || pg_temp.call_as(a, format('public.pharmacist_send_message(%L, ''still here?'')', rxA)) || '|' ||
    pg_temp.count_as(a, format('public.pharmacist_conversation_list() where prescription_id = %L', rxA)));
  perform pg_temp.r('D31 the new pharmacy does not inherit the old thread''s words', '0', pg_temp.count_as(b, format('public.pharmacist_conversation(%L)', rxA)));
  update public.prescriptions set pharmacy_partner_id = pg_temp.f('phA') where id = rxA;
end $$;

-- E. Privacy -------------------------------------------------------------------------------------------------------------------------
do $$
declare a uuid := pg_temp.f('phAu'); pat uuid := pg_temp.f('pat'); clin uuid := pg_temp.f('clin'); adm uuid := pg_temp.f('admin');
begin
  perform pg_temp.r('E1 no signed-in role can read the message or thread tables directly (patient, pharmacist, clinician, admin)', 'ERR:42501|ERR:42501|ERR:42501|ERR:42501',
    pg_temp.count_as(pat, 'public.pharmacy_messages') || '|' || pg_temp.count_as(a, 'public.pharmacy_messages') || '|' || pg_temp.count_as(clin, 'public.pharmacy_threads') || '|' || pg_temp.count_as(adm, 'public.pharmacy_threads'));
  perform pg_temp.r('E2 nor insert one directly', 'ERR:42501|ERR:42501',
    pg_temp.q_as(pat, format('insert into public.pharmacy_messages (thread_id, organisation_id, sender_kind, sender_id, body) select id, organisation_id, ''patient'', %L, ''forged'' from public.pharmacy_threads limit 1', pat)) || '|' ||
    pg_temp.q_as(a, format('insert into public.pharmacy_messages (thread_id, organisation_id, sender_kind, sender_id, body) select id, organisation_id, ''pharmacist'', %L, ''forged'' from public.pharmacy_threads limit 1', a)));
  perform pg_temp.r('E3 anon cannot read them either', 'ERR:42501', pg_temp.anon_q('select count(*)::text from public.pharmacy_messages'));
  perform pg_temp.r('E4 a message is never edited (even by the table owner)', '42501', pg_temp.try_sql($q$update public.pharmacy_messages set body = 'edited'$q$));
  perform pg_temp.r('E5 ...never deleted', '42501', pg_temp.try_sql('delete from public.pharmacy_messages'));
  perform pg_temp.r('E6 ...never truncated', '42501', pg_temp.try_sql('truncate public.pharmacy_messages'));
  perform pg_temp.r('E7 a notice about a message names nothing: the pharmacy''s pharmacist got one, the patient got one, and no notice payload carries any message words', 'true|true|0',
    (select (count(*) >= 1)::text from public.notifications where template = 'pharmacy_message_pharmacy' and recipient_id = a) || '|' ||
    (select (count(*) >= 1)::text from public.notifications where template = 'pharmacy_message_patient' and recipient_id = pat) || '|' ||
    (select count(*)::text from public.notifications where template in ('pharmacy_message_pharmacy', 'pharmacy_message_patient') and payload <> '{}'::jsonb));
  perform pg_temp.r('E8 the pharmacist whose login is off, and the other pharmacy''s pharmacist, got no notice about this pharmacy''s patient', '0',
    (select count(*)::text from public.notifications where template = 'pharmacy_message_pharmacy' and recipient_id in (pg_temp.f('phAoff'), pg_temp.f('phBu'))));
  perform pg_temp.r('E9 the audit log records the fact of a message and of a read, never the words', 'true|true|0',
    (select (count(*) >= 5)::text from public.audit_log where action = 'pharmacy.message_sent') || '|' ||
    (select (count(*) >= 3)::text from public.audit_log where action = 'pharmacy.thread_read') || '|' ||
    (select count(*)::text from public.audit_log where action like 'pharmacy.%' and (event::text ilike '%amlodipine%' or event::text ilike '%collect%' or event::text ilike '%ready%')));
  perform pg_temp.r('E10 a test patient''s messages are marked test (so they count for nothing)', 'true',
    (select bool_and(m.is_test)::text from public.pharmacy_messages m join public.pharmacy_threads t on t.id = m.thread_id where t.patient_id = pat));
end $$;

-- F. SABOTAGE ------------------------------------------------------------------------------------------------------------------------
-- (a) the append-only trigger dropped: a message can be edited again
drop trigger pharmacy_messages_append_only on public.pharmacy_messages;
select pg_temp.sab('a message is still refused an edit', '42501', pg_temp.try_sql($$update public.pharmacy_messages set body = 'edited by sabotage'$$));
-- (b) the open-conversation test forced true: a chat on an old supply is open again
create or replace function private.pharmacy_chat_open(p_prescription uuid, p_partner uuid) returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
select pg_temp.sab('an old supply''s chat is still closed', 'ERR:22023', pg_temp.call_as(pg_temp.f('pat'), format('public.patient_send_pharmacy_message(%L, ''sabotage'')', pg_temp.f('rxOld'))));
-- (c) the write-once trigger dropped: a recorded NAFDAC number can be overwritten
drop trigger pharmacy_order_dispenses_sourcing_once on public.pharmacy_order_dispenses;
select pg_temp.sab('a recorded NAFDAC number still cannot be overwritten', '42501',
  pg_temp.try_sql(format('update public.pharmacy_order_dispenses set product_nafdac_reg_no = ''Z9-9999'' where id = %L', pg_temp.f('dA'))));
-- (d) the admin test forced true: a patient can verify a pharmacy
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
select pg_temp.sab('a patient is still refused verifying a pharmacy', 'ERR:42501',
  pg_temp.call_as(pg_temp.f('pat'), format('public.verify_pharmacy_sourcing(%L, %L)', pg_temp.f('phA'), 'A patient pretending to check the invoices')));
-- (e) a table grant plus an open policy: a clinician can read every message
grant select on public.pharmacy_messages to authenticated;
create policy sabotage_open on public.pharmacy_messages for select to authenticated using (true);
select pg_temp.sab('a clinician still cannot read the message table', 'ERR:42501', pg_temp.count_as(pg_temp.f('clin'), 'public.pharmacy_messages'));

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S74 pharmacy sourcing and chat proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 5 then raise exception 'VACUOUS TEST: the sabotage flipped % of 5 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
