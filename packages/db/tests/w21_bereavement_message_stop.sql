-- ===========================================================================
-- Proof: W-21 bereavement message-stop. NOT EXECUTED LOCALLY when written (Docker was down); CI replay is the first run.
--   1. A patient cannot set their own profile_status (guard refuses), nor can a supporter or stranger call record_patient_death.
--   2. A clinician records the death: profile_status deceased, deceased_at/by/basis set. Calling again is a no-op ("already").
--   3. The status cannot be undone in-app, even by the recording path's own user.
--   4. The person's circle is revoked (as patient and as supporter) and a pending invite is cancelled; the supporter's view is refused.
--   5. Each sponsor (voucher purchaser, circle pay_for_care supporter) gets exactly ONE sponsor_bereavement notification; a replay adds none.
--   6. A goodwill_refund_requests row exists for the unexpired voucher, state needs_finance; no refund or order row was created.
--   7. A notification inserted for the deceased person (a renewal reminder, a referral prompt) is dropped and logged; one for a living
--      person is kept.
--   8. queue_sponsor_monthly_reports queues nothing for a deceased beneficiary.
--   9. SABOTAGE: with the notifications stop trigger dropped a reminder reaches the deceased person (check 7 would FAIL); with the
--      cascade trigger dropped the circle stays active (check 4 would FAIL).
-- BEGIN/ROLLBACK; mints its own fixtures. Needs one row in service_products.
-- ===========================================================================
begin;
create temp table w21_results (check_name text, observed text, expected text, verdict text);
grant all on w21_results to public;

create function pg_temp.mkuser(p_role text, p_name text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'w21-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
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
  v_sp uuid := (select id from public.service_products limit 1);
  pat uuid; sup_v uuid; sup_c uuid; stranger uuid; clin uuid; adm uuid; living uuid;
  v_r text; v_n integer; v_def text; v_voucher uuid; v_inv_hash text := repeat('c', 64);
  v_status text; v_json jsonb; pat2 uuid;
begin
  if v_sp is null then raise exception 'fixture FAIL: no service_products row'; end if;
  pat := pg_temp.mkuser('patient', 'W21 Patient'); sup_v := pg_temp.mkuser('patient', 'W21 Voucher Sponsor'); sup_c := pg_temp.mkuser('patient', 'W21 Circle Sponsor');
  stranger := pg_temp.mkuser('patient', 'W21 Stranger'); clin := pg_temp.mkuser('clinician', 'W21 Clinician'); adm := pg_temp.mkuser('admin', 'W21 Admin');
  living := pg_temp.mkuser('patient', 'W21 Living');

  insert into public.care_vouchers (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id, service_product_id, sku_code, sku_name,
                                    face_value_kobo, amount_paid_kobo, status)
  values (v_org, 'W21-' || substr(gen_random_uuid()::text, 1, 8), 'prepaid_service', pat, sup_v, v_sp, 'w21', 'W21 proof', 500000, 500000, 'active')
  returning id into v_voucher;
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test) values
    (v_org, pat, sup_c, 'daughter', array['pay_for_care', 'appointments'], now() + interval '60 days', true),
    (v_org, living, pat, 'friend', array['appointments'], now() + interval '60 days', true);
  insert into public.care_circle_invites (organisation_id, patient_id, invitee_kind, invitee_hash, invitee_hint, relationship, permissions, grant_days, token_hash, expires_at, is_test)
  values (v_org, pat, 'email', repeat('a', 64), 'x', 'son', array['appointments'], 30, v_inv_hash, now() + interval '3 days', true);

  -- 1 who may not
  v_r := pg_temp.try_as(pat, format('update public.profiles set profile_status = %L, deceased_at = now() where id = %L', 'deceased', pat));
  insert into w21_results values ('1a a patient cannot set their own status', v_r, '42501', case when v_r = '42501' then 'PASS' else 'FAIL' end);
  v_r := pg_temp.try_as(sup_c, format('select public.record_patient_death(%L, %L)', pat, 'clinician_confirmed'));
  insert into w21_results values ('1b a supporter cannot record', v_r, '42501', case when v_r = '42501' then 'PASS' else 'FAIL' end);
  v_r := pg_temp.try_as(stranger, format('select public.record_patient_death(%L, %L)', pat, 'next_of_kin_verified'));
  insert into w21_results values ('1c a stranger cannot record', v_r, '42501', case when v_r = '42501' then 'PASS' else 'FAIL' end);
  v_r := pg_temp.try_as(adm, format('select public.record_patient_death(%L, %L)', pat, 'clinician_confirmed'));
  insert into w21_results values ('1d an admin cannot claim a clinician basis', v_r, '42501', case when v_r = '42501' then 'PASS' else 'FAIL' end);
  select profile_status into v_status from public.profiles where id = pat;
  insert into w21_results values ('1e nothing changed', v_status, 'active', case when v_status = 'active' then 'PASS' else 'FAIL' end);

  -- 2 clinician records
  perform pg_temp.as_user(clin); execute 'set local role authenticated';
  v_json := public.record_patient_death(pat, 'clinician_confirmed');
  execute 'reset role';
  select profile_status || '/' || (deceased_at is not null)::text || '/' || coalesce(deceased_basis, '') || '/' || (deceased_recorded_by = clin)::text into v_status from public.profiles where id = pat;
  insert into w21_results values ('2a clinician records the death', v_status, 'deceased/true/clinician_confirmed/true', case when v_status = 'deceased/true/clinician_confirmed/true' then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(clin); execute 'set local role authenticated';
  v_json := public.record_patient_death(pat, 'clinician_confirmed');
  execute 'reset role';
  insert into w21_results values ('2b a second call is a no-op', v_json ->> 'already', 'true', case when v_json ->> 'already' = 'true' then 'PASS' else 'FAIL' end);

  -- 3 final
  v_r := pg_temp.try_as(clin, format('update public.profiles set profile_status = %L where id = %L', 'active', pat));
  insert into w21_results values ('3 the status cannot be undone', v_r, '42501', case when v_r = '42501' then 'PASS' else 'FAIL' end);

  -- 4 circle stopped
  select count(*) into v_n from public.care_circle_members where (patient_id = pat or supporter_id = pat) and state = 'active';
  insert into w21_results values ('4a every circle membership of the person is revoked', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.care_circle_invites where patient_id = pat and state = 'pending';
  insert into w21_results values ('4b pending invites are cancelled', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  v_r := pg_temp.try_as(sup_c, format('select public.circle_supporter_view(%L)', pat));
  insert into w21_results values ('4c the supporter view is refused', v_r, 'P0002', case when v_r = 'P0002' then 'PASS' else 'FAIL' end);

  -- 5 one message each
  select count(*) into v_n from public.notifications where template = 'sponsor_bereavement' and recipient_id in (sup_v, sup_c);
  insert into w21_results values ('5a two sponsors, two messages', v_n::text, '2', case when v_n = 2 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.notifications where template = 'sponsor_bereavement' and recipient_id = sup_v and payload = '{}'::jsonb and channel = 'in_app';
  insert into w21_results values ('5b one in-app message with an empty payload (no name, no amount)', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);

  -- 6 goodwill hook, no money moved
  select count(*) into v_n from public.goodwill_refund_requests where beneficiary_profile_id = pat and payer_profile_id = sup_v and source_id = v_voucher and state = 'needs_finance' and amount_kobo = 500000;
  insert into w21_results values ('6a goodwill request for the unexpired voucher', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.care_vouchers where id = v_voucher and status = 'active';
  insert into w21_results values ('6b the voucher itself is untouched (no money moved)', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);

  -- 7 notifications to the deceased are dropped, to the living kept
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (v_org, pat, 'in_app', 'pending', 'entitlement_expiring_soon', '{}'), (v_org, pat, 'in_app', 'pending', 'referral_prompt', '{}');
  select count(*) into v_n from public.notifications where recipient_id = pat and template in ('entitlement_expiring_soon', 'referral_prompt');
  insert into w21_results values ('7a reminders and prompts to the deceased are dropped', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.audit_log where action = 'bereavement.notification_suppressed' and subject_patient_id = pat;
  insert into w21_results values ('7b each drop is logged', v_n::text, '2', case when v_n = 2 then 'PASS' else 'FAIL' end);
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (v_org, living, 'in_app', 'pending', 'entitlement_expiring_soon', '{}');
  select count(*) into v_n from public.notifications where recipient_id = living and template = 'entitlement_expiring_soon';
  insert into w21_results values ('7c a living person still gets theirs', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);

  -- 8 monthly report skips the deceased beneficiary
  delete from public.notifications where template = 'sponsor_monthly_report' and recipient_id = sup_v;
  perform private.queue_sponsor_monthly_reports();
  select count(*) into v_n from public.notifications where template = 'sponsor_monthly_report' and recipient_id = sup_v;
  insert into w21_results values ('8 no monthly report about a deceased beneficiary', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);

  -- 9 SABOTAGE
  drop trigger notifications_00_bereavement_stop on public.notifications;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload) values (v_org, pat, 'in_app', 'pending', 'entitlement_expiring_soon', '{}');
  select count(*) into v_n from public.notifications where recipient_id = pat and template = 'entitlement_expiring_soon';
  insert into w21_results values ('9a SABOTAGE: without the stop trigger a reminder reaches the deceased (7a would FAIL)', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  drop trigger profiles_zz_on_patient_deceased on public.profiles;
  pat2 := pg_temp.mkuser('patient', 'W21 Patient Two');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, pat2, sup_c, 'daughter', array['appointments'], now() + interval '60 days', true);
  perform pg_temp.as_user(clin); execute 'set local role authenticated';
  perform public.record_patient_death(pat2, 'clinician_confirmed');
  execute 'reset role';
  select count(*) into v_n from public.care_circle_members where patient_id = pat2 and state = 'active';
  insert into w21_results values ('9b SABOTAGE: without the cascade trigger the circle stays active (4a would FAIL)', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
end $$;

select * from w21_results order by check_name;
do $$ begin
  if exists (select 1 from w21_results where verdict = 'FAIL') then raise exception 'W-21 proof: % check(s) FAILED', (select count(*) from w21_results where verdict = 'FAIL'); end if;
end $$;
rollback;
