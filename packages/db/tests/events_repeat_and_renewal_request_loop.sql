-- Tarragon Health: a patient asks for a repeat or a renewal and the answer gets back to them (2026-10-30)
--
-- E9 of the events harness. medication_repeat_requests.sql proves the approval RULES (eligibility gate, who may approve).
-- prescription_amended_and_expiring_notices.sql proves the prescribed, amended and expiring notices. This one proves the loop
-- between them, read from each person's own seat:
--
--   1  repeat request    the patient asks; their own doctor sees it in the request list; another patient does not
--   2  decision          the doctor approves (stamped with who and when); the patient reads the outcome on their own row; a
--                        denial carries its reason and the patient can read that reason
--   3  renewal request   same loop for a renewal: the patient asks, the doctor sees it, a doctor decides, a care coordinator
--                        cannot, and the decision is stamped
--   4  what is NOT told  records, as asserted facts, which of these steps queue a notification today, so a change (a notice added,
--                        or one removed by accident) is a visible edit to this file and not a silent drift
--
-- Fixtures built here, wrapped in BEGIN/ROLLBACK, raises on failure.
-- Run: psql "$DATABASE_URL" -f packages/db/tests/events_repeat_and_renewal_request_loop.sql

begin;

create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
grant execute on function pg_temp.f(text), pg_temp.act(uuid), pg_temp.back(), pg_temp.q_as(uuid, text) to public;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ev9-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'EV9 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, case when p_tier = 'care_coordinator' then 'care_coordinator' else 'clinician' end);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'EV9 ' || p_label, 'MDCN', 'EV9-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true);
  return v;
end $f$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_pat uuid; v_med uuid; v_doc uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists, the core migrations did not run'; end if;
  insert into fx values ('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  insert into fx values ('admin', v_admin);
  v_doc := pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin);
  insert into fx values ('doc', v_doc);
  insert into fx values ('stranger', pg_temp.mkdoc(v_org, 'stranger', 'senior_medical_officer', v_admin));
  insert into fx values ('coord', pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', v_admin));
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  insert into fx values ('pat', v_pat), ('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_pat, v_doc);

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, repeats_allowed)
  values (v_org, v_pat, 'EV9 Repeat Drug', '5mg', 'daily', 'clinician', true, 3) returning id into v_med;
  insert into fx values ('med', v_med);
end $$;

-- ================================================================ 1 repeat request
do $$
declare v_req uuid; v_r text;
begin
  v_r := pg_temp.q_as(pg_temp.f('pat'), format(
    $q$insert into public.medication_repeat_requests (organisation_id, patient_id, medication_id) values (%L, %L, %L) returning id::text$q$,
    pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('med')));
  if v_r like 'ERR:%' then raise exception 'FAIL 1: the patient could not ask for a repeat: %', v_r; end if;
  v_req := v_r::uuid;
  insert into fx values ('req', v_req);

  if pg_temp.q_as(pg_temp.f('doc'), format('select count(*)::text from public.medication_repeat_requests where id = %L and status = ''pending''', v_req)) <> '1' then
    raise exception 'FAIL 1: the patient''s own doctor cannot see the pending request';
  end if;
  if pg_temp.q_as(pg_temp.f('pat'), format('select count(*)::text from public.medication_repeat_requests where id = %L', v_req)) <> '1' then
    raise exception 'FAIL 1: the patient cannot see their own request';
  end if;
  if pg_temp.q_as(pg_temp.f('pat2'), format('select count(*)::text from public.medication_repeat_requests where id = %L', v_req)) <> '0' then
    raise exception 'FAIL 1: another patient can see this request';
  end if;
  -- a patient cannot ask on someone else's behalf
  v_r := pg_temp.q_as(pg_temp.f('pat2'), format(
    $q$insert into public.medication_repeat_requests (organisation_id, patient_id, medication_id) values (%L, %L, %L) returning id::text$q$,
    pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('med')));
  if v_r not like 'ERR:%' then raise exception 'FAIL 1: a patient created a repeat request for another patient'; end if;
end $$;

-- ================================================================ 2 decision
do $$
declare v_req uuid := pg_temp.f('req'); v_r text; v_med2 uuid; v_req2 uuid;
begin
  v_r := pg_temp.q_as(pg_temp.f('pat'), format($q$update public.medication_repeat_requests set status = 'approved' where id = %L returning status::text$q$, v_req));
  if v_r is not null and v_r not like 'ERR:%' then raise exception 'FAIL 2: a patient approved their own repeat request'; end if;
  if (select status::text from public.medication_repeat_requests where id = v_req) <> 'pending' then
    raise exception 'FAIL 2: the patient changed the status of their own request';
  end if;

  v_r := pg_temp.q_as(pg_temp.f('doc'), format($q$update public.medication_repeat_requests set status = 'approved' where id = %L returning status::text$q$, v_req));
  if v_r is distinct from 'approved' then raise exception 'FAIL 2: the patient''s own doctor could not approve: %', v_r; end if;
  if not exists (select 1 from public.medication_repeat_requests r join public.clinical_staff cs on cs.id = r.reviewed_by
                  where r.id = v_req and cs.profile_id = pg_temp.f('doc') and r.reviewed_at is not null) then
    raise exception 'FAIL 2: the approval was not stamped with the doctor and the time';
  end if;
  if pg_temp.q_as(pg_temp.f('pat'), format('select status::text from public.medication_repeat_requests where id = %L', v_req)) <> 'approved' then
    raise exception 'FAIL 2: the patient cannot read the outcome of their own request';
  end if;

  -- a denial needs a reason, and the patient can read it
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, repeats_allowed)
  values (pg_temp.f('org'), pg_temp.f('pat'), 'EV9 Denied Drug', '10mg', 'daily', 'clinician', true, 2) returning id into v_med2;
  v_r := pg_temp.q_as(pg_temp.f('pat'), format(
    $q$insert into public.medication_repeat_requests (organisation_id, patient_id, medication_id) values (%L, %L, %L) returning id::text$q$,
    pg_temp.f('org'), pg_temp.f('pat'), v_med2));
  if v_r like 'ERR:%' then raise exception 'FAIL 2: second request failed: %', v_r; end if;
  v_req2 := v_r::uuid;
  v_r := pg_temp.q_as(pg_temp.f('doc'), format($q$update public.medication_repeat_requests set status = 'denied' where id = %L returning status::text$q$, v_req2));
  if v_r not like 'ERR:%reason%' then raise exception 'FAIL 2: a denial with no reason was accepted (got %)', v_r; end if;
  v_r := pg_temp.q_as(pg_temp.f('doc'), format($q$update public.medication_repeat_requests set status = 'denied', denial_reason = 'Needs a review first' where id = %L returning status::text$q$, v_req2));
  if v_r is distinct from 'denied' then raise exception 'FAIL 2: a denial with a reason was refused: %', v_r; end if;
  if pg_temp.q_as(pg_temp.f('pat'), format('select denial_reason from public.medication_repeat_requests where id = %L', v_req2)) is distinct from 'Needs a review first' then
    raise exception 'FAIL 2: the patient cannot read why their request was denied';
  end if;
  -- decided once
  v_r := pg_temp.q_as(pg_temp.f('doc'), format($q$update public.medication_repeat_requests set status = 'approved' where id = %L returning status::text$q$, v_req2));
  if v_r not like 'ERR:%already been reviewed%' then raise exception 'FAIL 2: a decided request was decided again (got %)', v_r; end if;
end $$;

-- ================================================================ 3 renewal request
-- Who may ask depends on membership (private.enforce_prescription_renewal_entitlement_or_credit): someone who is not a Member needs a
-- paid renewal credit, a Member's own request is closed because renewals are reviewed at the monthly call, and a service job (not a
-- doctor directly) raises it for the Member on that route.
do $$
declare v_r text; v_ren uuid;
begin
  v_r := pg_temp.q_as(pg_temp.f('pat'), format(
    $q$insert into public.prescription_renewal_requests (organisation_id, patient_id, medication_id, patient_note) values (%L, %L, %L, 'Running low') returning id::text$q$,
    pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('med')));
  if v_r not like 'ERR:%part of Membership%' then
    raise exception 'FAIL 3: a patient with no membership and no renewal credit was not sent to Membership (got %)', v_r;
  end if;

  insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
  values (pg_temp.f('org'), pg_temp.f('pat'), 'granted', 'active', pg_temp.f('admin'), 'EV9 proof membership for the renewal loop', true);

  v_r := pg_temp.q_as(pg_temp.f('pat'), format(
    $q$insert into public.prescription_renewal_requests (organisation_id, patient_id, medication_id, patient_note) values (%L, %L, %L, 'Running low') returning id::text$q$,
    pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('med')));
  if v_r not like 'ERR:%monthly call%' then
    raise exception 'FAIL 3: a Member''s own renewal request was not closed in favour of the monthly review (got %)', v_r;
  end if;

  -- Row security lets only the patient insert, so a doctor cannot raise one directly either: for a Member the row can only come from a
  -- service job, which writes as the system (the trigger allows any writer that is not the patient).
  v_r := pg_temp.q_as(pg_temp.f('doc'), format(
    $q$insert into public.prescription_renewal_requests (organisation_id, patient_id, medication_id, patient_note) values (%L, %L, %L, 'x') returning id::text$q$,
    pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('med')));
  if v_r not like 'ERR:%row-level security%' then
    raise exception 'FAIL 3: a doctor inserted a renewal request directly (got %)', v_r;
  end if;
  insert into public.prescription_renewal_requests (organisation_id, patient_id, medication_id, patient_note)
  values (pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('med'), 'Raised by a service job at the monthly review') returning id into v_ren;
  insert into fx values ('ren', v_ren);

  if pg_temp.q_as(pg_temp.f('pat'), format('select count(*)::text from public.prescription_renewal_requests where id = %L', v_ren)) <> '1' then
    raise exception 'FAIL 3: the Member cannot see the renewal raised for them';
  end if;
  if pg_temp.q_as(pg_temp.f('pat2'), format('select count(*)::text from public.prescription_renewal_requests where id = %L', v_ren)) <> '0' then
    raise exception 'FAIL 3: another patient can see this renewal request';
  end if;

  v_r := pg_temp.q_as(pg_temp.f('coord'), format($q$update public.prescription_renewal_requests set status = 'approved' where id = %L returning status::text$q$, v_ren));
  if v_r is not null and v_r not like 'ERR:%' then raise exception 'FAIL 3: a care coordinator decided a renewal request'; end if;
  if (select status::text from public.prescription_renewal_requests where id = v_ren) <> 'submitted' then
    raise exception 'FAIL 3: a care coordinator changed a renewal request';
  end if;

  v_r := pg_temp.q_as(pg_temp.f('doc'), format($q$update public.prescription_renewal_requests set status = 'approved', doctor_note = 'Continue' where id = %L returning status::text$q$, v_ren));
  if v_r is distinct from 'approved' then raise exception 'FAIL 3: the doctor could not approve the renewal: %', v_r; end if;
  if not exists (select 1 from public.prescription_renewal_requests r join public.clinical_staff cs on cs.id = r.reviewed_by
                  where r.id = v_ren and cs.profile_id = pg_temp.f('doc') and r.reviewed_at is not null) then
    raise exception 'FAIL 3: the renewal decision was not stamped with the doctor and the time';
  end if;
  if pg_temp.q_as(pg_temp.f('pat'), format('select status::text from public.prescription_renewal_requests where id = %L', v_ren)) <> 'approved' then
    raise exception 'FAIL 3: the Member cannot read the outcome of their renewal request';
  end if;
end $$;

-- ================================================================ 4 what is not told, as asserted facts
-- Today a request and its decision queue NO notification to anyone: the doctor finds the request on their worklist and the patient
-- finds the answer on opening the app. This asserts that, so that adding a notice (good) or losing one by accident is a visible edit
-- to this file. If a notice is added on purpose, change these two checks to assert it arrives once and add its template to the E7 and
-- E8 style renderability checks.
do $$
declare v_n int;
begin
  select count(*) into v_n from public.notifications
   where organisation_id = pg_temp.f('org') and created_at >= now() - interval '1 hour'
     and (payload->>'medication_id' in (pg_temp.f('med')::text) or recipient_id in (pg_temp.f('doc'), pg_temp.f('pat')))
     and template ~ '(repeat|renewal|refill_request)';
  if v_n <> 0 then
    raise exception 'FAIL 4: % notification(s) now exist for a repeat or renewal step. Good if on purpose: update section 4 and prove they can be rendered.', v_n;
  end if;
end $$;

rollback;

select 'events_repeat_and_renewal_request_loop: ok' as result;
