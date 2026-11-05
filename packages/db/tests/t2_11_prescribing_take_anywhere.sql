-- ===========================================================================
-- Proof: *_t2_11_prescribing_take_anywhere.sql (founder decision T2-11, 2026-11-04).
--
-- With ZERO partner pharmacies (every partner switched off inside this transaction):
--   A. the prescribing master's conditions name no partner pharmacy, keep the cmo role, and the migration did not switch it on;
--   B. with the master on, a real senior doctor tied to a real patient signs a prescription through public.prescribe_medication;
--      the patient reads it (rx number, verification code, QR token) in her own session, and anyone (anon) verifies it with
--      public.verify_prescription_public: status active, the prescriber's MDCN credential shown;
--   C. partner collection is still refused without a partner: private.pharmacy_collection_on() is false, the patient's pharmacy list
--      refuses with 55000, and public.partner_pharmacy_collection_available() says false;
--   D. the safety rules are untouched: an untied/junior clinician is refused, a controlled medicine is refused;
--   E. with the master OFF a real signing is still refused (prescribing_guard_off).
-- SABOTAGE: partner readiness replaced by `true` reopens partner collection with zero partners (so check C discriminates); the old
-- partner-pharmacy conditions put back make the master unsatisfiable with zero partners (so check A discriminates).
-- BEGIN/ROLLBACK; own fixtures.
-- ===========================================================================
begin;

create temp table results (kind text, check_name text, expected text, observed text) on commit drop;
grant all on results to authenticated, anon;

create function pg_temp.try_as(p_uid uuid, p_role text, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role) else json_build_object('sub', p_uid, 'role', p_role) end::text, true);
  execute format('set local role %I', p_role);
  begin execute p_sql into v; exception when others then v := 'ERR:' || sqlstate || ':' || sqlerrm; end;
  execute 'reset role';
  return v;
end $f$;
grant execute on function pg_temp.try_as(uuid, text, text) to authenticated, anon;

create function pg_temp.master(p_on boolean) returns void language plpgsql as $f$
begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
  select 'prescribing_enabled', case when p_on then 'switched_on' else 'switched_off' end, p.id, 'cmo', 'T2-11 proof', '[]'::jsonb from public.profiles p order by p.created_at limit 1;
  update public.go_live_guards
     set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then (select id from public.profiles order by created_at limit 1) end,
         change_note = case when p_on then 'T2-11 proof' end
   where key = 'prescribing_enabled';
end $f$;

create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to authenticated, anon;

do $$
declare
  v_org uuid; v_pat uuid := gen_random_uuid(); v_smo uuid := gen_random_uuid(); v_junior uuid := gen_random_uuid();
begin
  if exists (select 1 from public.go_live_guards where key = 'prescribing_enabled' and is_on) then
    raise exception 'control failure: prescribing_enabled is already on in this database, the off checks would prove nothing';
  end if;
  select id into v_org from public.organisations order by created_at limit 1;
  -- zero partner pharmacies, whatever the database holds
  alter table public.pharmacy_partners disable trigger user;
  update public.pharmacy_partners set is_active = false where is_active;
  alter table public.pharmacy_partners enable trigger user;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 't211-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_pat, v_smo, v_junior]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth) values
    (v_pat,    v_org, 'patient',   'Take Anywhere Patient', '+2348058881101', '1980-05-01'),
    (v_smo,    v_org, 'clinician', 'Take Anywhere SMO',     '+2348058881102', null),
    (v_junior, v_org, 'clinician', 'Take Anywhere Untied',  '+2348058881103', null)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, is_test = false;
  update public.profiles set is_test = false where id in (v_pat, v_smo, v_junior);
  insert into public.patient_allergies (organisation_id, patient_id, allergen, source) values (v_org, v_pat, 'proof-allergen-none', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org, v_smo,    'Take Anywhere SMO',    true, now(), 'senior_medical_officer', 'MDCN', 'T211-4471', 'Probe', 'T211-1', now() + interval '1 year'),
    (v_org, v_junior, 'Take Anywhere Untied', true, now(), 'senior_medical_officer', 'MDCN', 'T211-4472', 'Probe', 'T211-2', now() + interval '1 year');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_smo, now()) on conflict (patient_id) do update set clinician_id = v_smo;
  insert into fx values ('org', v_org), ('pat', v_pat), ('smo', v_smo), ('junior', v_junior);
end $$;

-- A. the master's conditions ---------------------------------------------------------------------------------------------------------
insert into results values
  ('real', 'A1 zero choosable partner pharmacies in this transaction', '0',
    (select count(*)::text from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id where private.pharmacy_location_choosable(pp.id, l.id))),
  ('real', 'A2 the master names no partner pharmacy condition', 'clinical_lead_signoff,clinical_safety_case_current,prescriber_registration_verified',
    (select string_agg(c ->> 'code', ',' order by c ->> 'code') from jsonb_array_elements(private.go_live_conditions('prescribing_enabled', null)) c)),
  ('real', 'A3 with zero partners the prescriber condition is met (a verified senior doctor exists)', 'true',
    (select c ->> 'met' from jsonb_array_elements(private.go_live_conditions('prescribing_enabled', null)) c where c ->> 'code' = 'prescriber_registration_verified')),
  ('real', 'A4 still a CMO master, still off after the migration', 'cmo|master|false',
    (select switch_role || '|' || kind || '|' || is_on::text from public.go_live_guards where key = 'prescribing_enabled'));

-- E. master off: a real signing is refused -----------------------------------------------------------------------------------------
insert into results values ('real', 'E1 master off: a real doctor cannot sign for a real patient', 'prescribing_guard_off',
  (select regexp_replace(pg_temp.try_as((select v from fx where k = 'smo'), 'authenticated',
     format($q$select public.prescribe_medication(%L, 'Amlodipine', '5 mg', 'once a day', p_route => 'oral', p_duration_days => 30, p_quantity => '30 tablets')::text$q$, (select v from fx where k = 'pat'))),
     '^ERR:[0-9A-Z]{5}:', '')));

-- B. master on, zero partners: sign, read, verify ------------------------------------------------------------------------------------
select pg_temp.master(true);
do $$
declare v_id text;
begin
  v_id := pg_temp.try_as((select v from fx where k = 'smo'), 'authenticated',
    format($q$select public.prescribe_medication(%L, 'Amlodipine', '5 mg', 'once a day', p_route => 'oral', p_duration_days => 30, p_quantity => '30 tablets', p_allergies_confirmed => true)::text$q$,
           (select v from fx where k = 'pat')));
  if v_id like 'ERR:%' then raise exception 'FAIL: B0 signing with the master on and zero partners was refused: %', v_id; end if;
  insert into fx values ('med', v_id::uuid);
end $$;

insert into results values
  ('real', 'B1 the signed prescription row exists and is signed', 'signed',
    (select rx.state::text from public.medications m join public.prescriptions rx on rx.id = m.prescription_id where m.id = (select v from fx where k = 'med'))),
  ('real', 'B2 the patient reads her prescription, with rx number, verification code and QR token', 'true',
    pg_temp.try_as((select v from fx where k = 'pat'), 'authenticated',
      format($q$select (rx_number is not null and verification_code is not null and public_token ~ '^[0-9a-f]{64}$' and source = 'clinician' and is_active)::text from public.medications where id = %L$q$,
             (select v from fx where k = 'med')))),
  ('real', 'B3 anyone verifies it from the QR token: active, Amlodipine, prescriber credential shown', 'active|Amlodipine|MDCN T211-4471',
    pg_temp.try_as(null, 'anon',
      format($q$select status || '|' || drug_name || '|' || coalesce(prescriber_credential, 'none') from public.verify_prescription_public(%L)$q$,
             (select public_token from public.medications where id = (select v from fx where k = 'med'))))),
  ('real', 'B4 the prescriber shows as licence-verified in the directory the PDF reads', 'true',
    pg_temp.try_as((select v from fx where k = 'pat'), 'authenticated',
      format($q$select license_verified::text from public.clinical_staff_directory where profile_id = %L$q$, (select v from fx where k = 'smo'))));

-- C. partner collection is still refused without a partner --------------------------------------------------------------------------
insert into results values
  ('real', 'C1 pharmacy collection is off with the master on and zero partners', 'false', private.pharmacy_collection_on()::text),
  ('real', 'C2 the patient asking for partner pharmacies is refused', 'ERR:55000',
    left(pg_temp.try_as((select v from fx where k = 'pat'), 'authenticated',
      format($q$select count(*)::text from public.patient_collection_pharmacies((select prescription_id from public.medications where id = %L))$q$, (select v from fx where k = 'med'))), 9)),
  ('real', 'C3 the app is told no partner collection exists', 'false',
    pg_temp.try_as((select v from fx where k = 'pat'), 'authenticated', 'select public.partner_pharmacy_collection_available()::text')),
  ('real', 'C4 anon cannot ask', 'ERR:42501', left(pg_temp.try_as(null, 'anon', 'select public.partner_pharmacy_collection_available()::text'), 9));

-- D. safety rules untouched ---------------------------------------------------------------------------------------------------------
insert into results values
  ('real', 'D1 an untied doctor is still refused', 'ERR:42501',
    left(pg_temp.try_as((select v from fx where k = 'junior'), 'authenticated',
      format($q$select public.prescribe_medication(%L, 'Lisinopril', '10 mg', 'once a day', p_duration_days => 30, p_quantity => '30 tablets', p_allergies_confirmed => true)::text$q$, (select v from fx where k = 'pat'))), 9)),
  ('real', 'D2 a controlled medicine is still refused', 'true',
    (pg_temp.try_as((select v from fx where k = 'smo'), 'authenticated',
      format($q$select public.prescribe_medication(%L, 'Tramadol', '50 mg', 'twice a day', p_duration_days => 5, p_quantity => '10 capsules', p_allergies_confirmed => true)::text$q$, (select v from fx where k = 'pat'))) like 'ERR:%')::text);

-- SABOTAGE 1: readiness replaced by true reopens partner collection with zero partners --------------------------------------------
create or replace function private.pharmacy_partner_collection_ready() returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$;
insert into results values ('sabotage', 'S1 without the partner readiness check, collection opens with zero partners (C1 discriminates)', 'true', private.pharmacy_collection_on()::text);

-- SABOTAGE 2: the old partner-pharmacy conditions make the master unsatisfiable with zero partners ---------------------------------
insert into results values ('sabotage', 'S2 the pre-T2-11 conditions (via the wrapped chain) are not met with zero partners (A2 discriminates)', 'false',
  (select bool_and((c ->> 'met')::boolean)::text from jsonb_array_elements(private.go_live_conditions_s71('prescribing_enabled', null)) c
    where c ->> 'source' = 'data'));

select kind, check_name, expected, observed, case when expected = observed then 'PASS' else 'FAIL' end as verdict from results order by kind, check_name;

do $$
declare v_bad text;
begin
  select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(observed, 'NULL'), '; ') into v_bad from results where expected is distinct from observed;
  if v_bad is not null then raise exception 'T2-11 proof FAILED: %', v_bad; end if;
  if (select count(*) from results where kind = 'sabotage') < 2 then raise exception 'VACUOUS TEST: the sabotage steps did not run'; end if;
end $$;

rollback;
