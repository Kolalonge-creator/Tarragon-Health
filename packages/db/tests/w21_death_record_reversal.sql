-- ===========================================================================
-- Proof: W-21 follow-up, two-person reversal of a death record. NOT EXECUTED LOCALLY when written (Docker was down).
--   1. Only an admin can request; a clinician, the patient and a stranger are refused; a short reason is refused; a living person is not found.
--   2. The requester cannot approve their own request (42501). A clinician who is not the CMO cannot approve. Nothing changed yet.
--   3. A DIFFERENT admin approves: the profile is active again with the death fields cleared; the request is approved with both names.
--   4. Reversal restores only what is safe: the revoked circle membership and the cancelled invite stay as they were; notifications flow again;
--      a goodwill request still waiting is declined; sponsor-notice records are cleared; audit rows exist for request and reversal.
--   5. Everyone else still cannot change the status (a direct admin update is refused) and an already-reversed request cannot be reused.
--   6. SABOTAGE: with the own-request check removed from the function the table CHECK still stops it but with a different error (the 42501
--      check flips); with the guard's reversal path removed the approval fails.
-- BEGIN/ROLLBACK; mints its own fixtures. The CMO approval path is not exercised here (it needs a credentialed CMO fixture).
-- ===========================================================================
begin;
create temp table w21r_results (check_name text, observed text, expected text, verdict text);
grant all on w21r_results to public;

create function pg_temp.mkuser(p_role text, p_name text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'w21r-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, v_org, p_role::public.user_role, p_name, '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), date '1960-01-01', true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = true;
  return v;
end $$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.as_user(p_uid); execute 'set local role authenticated';
  begin execute p_sql; execute 'reset role'; return 'ok';
  exception when others then execute 'reset role'; return sqlstate; end;
end $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  pat uuid; sup uuid; living uuid; clin uuid; ad1 uuid; ad2 uuid; req uuid; v_r text; v_n integer; v_s text; v_def text;
begin
  pat := pg_temp.mkuser('patient', 'W21R Patient'); sup := pg_temp.mkuser('patient', 'W21R Sponsor'); living := pg_temp.mkuser('patient', 'W21R Living');
  clin := pg_temp.mkuser('clinician', 'W21R Clinician'); ad1 := pg_temp.mkuser('admin', 'W21R Admin One'); ad2 := pg_temp.mkuser('admin', 'W21R Admin Two');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, pat, sup, 'daughter', array['pay_for_care', 'appointments'], now() + interval '60 days', true);
  insert into public.care_circle_invites (organisation_id, patient_id, invitee_kind, invitee_hash, invitee_hint, relationship, permissions, grant_days, token_hash, expires_at, is_test)
  values (v_org, pat, 'email', repeat('a', 64), 'x', 'son', array['appointments'], 30, repeat('d', 64), now() + interval '3 days', true);
  perform pg_temp.as_user(clin); execute 'set local role authenticated';
  perform public.record_patient_death(pat, 'clinician_confirmed');
  execute 'reset role';
  insert into public.goodwill_refund_requests (organisation_id, beneficiary_profile_id, payer_profile_id, source_kind, source_id, amount_kobo)
  values (v_org, pat, sup, 'order', gen_random_uuid(), 1000);

  -- 1 who may request
  v_r := pg_temp.try_as(clin, format('select public.request_death_record_reversal(%L, %L)', pat, 'a long enough reason for the proof'));
  insert into w21r_results values ('1a a clinician cannot request', v_r, '42501', case when v_r = '42501' then 'PASS' else 'FAIL' end);
  v_r := pg_temp.try_as(pat, format('select public.request_death_record_reversal(%L, %L)', pat, 'a long enough reason for the proof'));
  insert into w21r_results values ('1b the patient cannot request', v_r, '42501', case when v_r = '42501' then 'PASS' else 'FAIL' end);
  v_r := pg_temp.try_as(ad1, format('select public.request_death_record_reversal(%L, %L)', pat, 'too short'));
  insert into w21r_results values ('1c a short reason is refused', v_r, '22023', case when v_r = '22023' then 'PASS' else 'FAIL' end);
  v_r := pg_temp.try_as(ad1, format('select public.request_death_record_reversal(%L, %L)', living, 'a long enough reason for the proof'));
  insert into w21r_results values ('1d a living person is not found', v_r, 'P0002', case when v_r = 'P0002' then 'PASS' else 'FAIL' end);

  perform pg_temp.as_user(ad1); execute 'set local role authenticated';
  req := public.request_death_record_reversal(pat, 'recorded against the wrong person, confirmed with the family');
  execute 'reset role';
  insert into w21r_results values ('1e an admin can request', (req is not null)::text, 'true', case when req is not null then 'PASS' else 'FAIL' end);

  -- 2 one person is not enough
  v_r := pg_temp.try_as(ad1, format('select public.approve_death_record_reversal(%L)', req));
  insert into w21r_results values ('2a the requester cannot approve their own request', v_r, '42501', case when v_r = '42501' then 'PASS' else 'FAIL' end);
  v_r := pg_temp.try_as(clin, format('select public.approve_death_record_reversal(%L)', req));
  insert into w21r_results values ('2b a clinician who is not the CMO cannot approve', v_r, '42501', case when v_r = '42501' then 'PASS' else 'FAIL' end);
  v_r := pg_temp.try_as(pat, format('select public.approve_death_record_reversal(%L)', req));
  insert into w21r_results values ('2c the patient cannot approve', v_r, '42501', case when v_r = '42501' then 'PASS' else 'FAIL' end);
  select profile_status into v_s from public.profiles where id = pat;
  insert into w21r_results values ('2d still deceased', v_s, 'deceased', case when v_s = 'deceased' then 'PASS' else 'FAIL' end);

  -- 5 nobody else can change the status
  v_r := pg_temp.try_as(ad2, format('update public.profiles set profile_status = %L, deceased_at = null, deceased_basis = null, deceased_recorded_by = null where id = %L', 'active', pat));
  insert into w21r_results values ('5a a direct admin update is refused', v_r, '42501', case when v_r = '42501' then 'PASS' else 'FAIL' end);

  -- 3 a different admin approves
  perform pg_temp.as_user(ad2); execute 'set local role authenticated';
  perform public.approve_death_record_reversal(req);
  execute 'reset role';
  select profile_status || '/' || (deceased_at is null)::text || '/' || (deceased_basis is null)::text || '/' || (deceased_recorded_by is null)::text into v_s from public.profiles where id = pat;
  insert into w21r_results values ('3a the profile is active again, death fields cleared', v_s, 'active/true/true/true', case when v_s = 'active/true/true/true' then 'PASS' else 'FAIL' end);
  select state || '/' || (approved_by = ad2)::text || '/' || (requested_by = ad1)::text into v_s from public.death_record_reversals where id = req;
  insert into w21r_results values ('3b the request records both people', v_s, 'approved/true/true', case when v_s = 'approved/true/true' then 'PASS' else 'FAIL' end);

  -- 4 only what is safe
  select count(*) into v_n from public.care_circle_members where patient_id = pat and state = 'active';
  insert into w21r_results values ('4a the circle stays revoked', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.care_circle_invites where patient_id = pat and state = 'pending';
  insert into w21r_results values ('4b cancelled invites stay cancelled', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload) values (v_org, pat, 'in_app', 'pending', 'entitlement_expiring_soon', '{}');
  select count(*) into v_n from public.notifications where recipient_id = pat and template = 'entitlement_expiring_soon';
  insert into w21r_results values ('4c notifications flow again', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.goodwill_refund_requests where beneficiary_profile_id = pat and state = 'needs_finance';
  insert into w21r_results values ('4d no goodwill request is left waiting for finance', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.bereavement_sponsor_notices where beneficiary_profile_id = pat;
  insert into w21r_results values ('4e sponsor-notice records cleared', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.audit_log where action in ('bereavement.reversal_requested', 'bereavement.reversed') and subject_patient_id = pat;
  insert into w21r_results values ('4f request and reversal are audited', v_n::text, '2', case when v_n = 2 then 'PASS' else 'FAIL' end);
  v_r := pg_temp.try_as(ad2, format('select public.approve_death_record_reversal(%L)', req));
  insert into w21r_results values ('5b an approved request cannot be reused', v_r, 'P0002', case when v_r = 'P0002' then 'PASS' else 'FAIL' end);

  -- 6 SABOTAGE: remove the function's own-request check; the table CHECK still stops it, but not with the function's error
  perform pg_temp.as_user(clin); execute 'set local role authenticated';
  perform public.record_patient_death(pat, 'clinician_confirmed');
  execute 'reset role';
  perform pg_temp.as_user(ad1); execute 'set local role authenticated';
  req := public.request_death_record_reversal(pat, 'a second request for the sabotage step of the proof');
  execute 'reset role';
  v_def := pg_get_functiondef('public.approve_death_record_reversal(uuid)'::regprocedure);
  execute replace(v_def, 'if r.requested_by = v_uid then raise exception ''reversal_not_authorised'' using errcode = ''42501''; end if;', '');
  v_r := pg_temp.try_as(ad1, format('select public.approve_death_record_reversal(%L)', req));
  insert into w21r_results values ('6a SABOTAGE: without the function check the own-request approval fails with a different error (2a would FAIL)', v_r, '23514', case when v_r = '23514' then 'PASS' else 'FAIL' end);
  v_def := pg_get_functiondef('private.guard_profile_status()'::regprocedure);
  execute replace(v_def, 'coalesce(current_setting(''tarragon.w21_reversal_path'', true), '''') = ''on''', 'false');
  v_r := pg_temp.try_as(ad2, format('select public.approve_death_record_reversal(%L)', req));
  insert into w21r_results values ('6b SABOTAGE: without the guard reversal path the approval cannot restore (3a would FAIL)', v_r, '42501', case when v_r = '42501' then 'PASS' else 'FAIL' end);
end $$;

select * from w21r_results order by check_name;
do $$ begin
  if exists (select 1 from w21r_results where verdict = 'FAIL') then raise exception 'W-21 reversal proof: % check(s) FAILED', (select count(*) from w21r_results where verdict = 'FAIL'); end if;
end $$;
rollback;
