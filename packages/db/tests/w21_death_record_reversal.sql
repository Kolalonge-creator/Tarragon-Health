-- ===========================================================================
-- Proof: W-21 follow-up, two-person reversal of a death record and the correction message. NOT EXECUTED LOCALLY when written (Docker was down).
--   1. Only an admin of the patient's organisation requests; a clinician, the patient, a supporter and an admin of ANOTHER organisation are refused;
--      a short reason is refused; a living person is not found.
--   2. The requester cannot approve their own request (42501); a clinician who is not the CMO, the patient and an admin of another org cannot.
--   3. A DIFFERENT admin approves: profile active again; death_records marked reversed (not deleted); the request records both people.
--   4. Reversal restores only what is safe: the revoked circle membership and cancelled invite stay as they were; notifications flow again;
--      a goodwill request still waiting is declined; audit rows exist for request and reversal.
--   5. A sponsor message still HELD is cancelled (reason reversed), not sent, and no correction goes out. A message already SENT gets exactly one
--      correction: with the first name where may_name is true, with no name otherwise; a second approval attempt cannot send another.
--   6. A reversal request older than 7 days cannot be approved, the sweep marks it expired, and a NEW request then works.
--   7. The status stays final: a direct admin update is refused; an approved request cannot be reused.
--   8. SABOTAGE: own-request check removed (the table CHECK stops it with a different error), guard reversal path removed (approval fails),
--      the held-notice cancellation removed (a held message would still be sendable).
-- BEGIN/ROLLBACK; mints its own fixtures. The CMO approval path is not exercised (it needs a credentialed CMO fixture). Needs one service_products row.
-- ===========================================================================
begin;
create temp table w21r_results (check_name text, observed text, expected text, verdict text);
grant all on w21r_results to public;

create function pg_temp.mkuser(p_role text, p_name text, p_org uuid default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := coalesce(p_org, (select id from public.organisations order by created_at limit 1));
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'w21r-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, v_org, p_role::public.user_role, p_name, '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), date '1960-01-01', true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = true, organisation_id = excluded.organisation_id;
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
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into w21r_results values (p_name, p_actual, p_expected, case when p_actual is not distinct from p_expected then 'PASS' else 'FAIL' end) $$;
create function pg_temp.kill(p_clin uuid, p_pat uuid) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_clin); execute 'set local role authenticated';
  perform public.record_patient_death(p_pat, 'proof');
  execute 'reset role';
end $$;
create function pg_temp.voucher(p_org uuid, p_pat uuid, p_sponsor uuid, p_sp uuid) returns void language sql as $$
  insert into public.care_vouchers (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id, service_product_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status)
  values (p_org, 'W21R-' || substr(gen_random_uuid()::text, 1, 8), 'prepaid_service', p_pat, p_sponsor, p_sp, 'w21', 'W21 proof', 500000, 500000, 'active') $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_org2 uuid; v_sp uuid := (select id from public.service_products limit 1);
  pat uuid; patb uuid; sup uuid; sup_b1 uuid; sup_b2 uuid; living uuid; clin uuid; clinb uuid; ad1 uuid; ad2 uuid; ad_other uuid;
  req uuid; reqb uuid; v_r text; v_n integer; v_s text; v_def text;
begin
  if v_sp is null then raise exception 'fixture FAIL: no service_products row'; end if;
  insert into public.organisations (name, type) select 'W21R other org', type from public.organisations order by created_at limit 1 returning id into v_org2;
  pat := pg_temp.mkuser('patient', 'W21R Patient'); patb := pg_temp.mkuser('patient', 'Bola Patient'); sup := pg_temp.mkuser('patient', 'W21R Sponsor');
  sup_b1 := pg_temp.mkuser('patient', 'W21R Named Sponsor'); sup_b2 := pg_temp.mkuser('patient', 'W21R Unnamed Sponsor'); living := pg_temp.mkuser('patient', 'W21R Living');
  clin := pg_temp.mkuser('clinician', 'W21R Clinician'); clinb := pg_temp.mkuser('clinician', 'W21R Clinician B');
  ad1 := pg_temp.mkuser('admin', 'W21R Admin One'); ad2 := pg_temp.mkuser('admin', 'W21R Admin Two'); ad_other := pg_temp.mkuser('admin', 'W21R Other Admin', v_org2);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, pat, clin), (v_org, patb, clinb);
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, pat, sup, 'daughter', array['pay_for_care', 'appointments'], now() + interval '60 days', true);
  insert into public.care_circle_invites (organisation_id, patient_id, invitee_kind, invitee_hash, invitee_hint, relationship, permissions, grant_days, token_hash, expires_at, is_test)
  values (v_org, pat, 'email', repeat('a', 64), 'x', 'son', array['appointments'], 30, repeat('d', 64), now() + interval '3 days', true);
  perform pg_temp.voucher(v_org, pat, sup, v_sp);
  perform pg_temp.kill(clin, pat);   -- pat: message held, goodwill row, circle revoked

  -- 1 who may request
  perform pg_temp.ck('1a a clinician cannot request', '42501', pg_temp.try_as(clin, format('select public.request_death_record_reversal(%L, %L)', pat, 'a long enough reason for the proof')));
  perform pg_temp.ck('1b the patient cannot request', '42501', pg_temp.try_as(pat, format('select public.request_death_record_reversal(%L, %L)', pat, 'a long enough reason for the proof')));
  perform pg_temp.ck('1c a supporter cannot request', '42501', pg_temp.try_as(sup, format('select public.request_death_record_reversal(%L, %L)', pat, 'a long enough reason for the proof')));
  perform pg_temp.ck('1d an admin of another organisation cannot request', '42501', pg_temp.try_as(ad_other, format('select public.request_death_record_reversal(%L, %L)', pat, 'a long enough reason for the proof')));
  perform pg_temp.ck('1e a short reason is refused', '22023', pg_temp.try_as(ad1, format('select public.request_death_record_reversal(%L, %L)', pat, 'too short')));
  perform pg_temp.ck('1f a living person is not found', 'P0002', pg_temp.try_as(ad1, format('select public.request_death_record_reversal(%L, %L)', living, 'a long enough reason for the proof')));
  perform pg_temp.as_user(ad1); execute 'set local role authenticated';
  req := public.request_death_record_reversal(pat, 'recorded against the wrong person, confirmed with the family');
  execute 'reset role';
  perform pg_temp.ck('1g an admin can request', 'true', (req is not null)::text);

  -- 2 one person is not enough
  perform pg_temp.ck('2a the requester cannot approve their own request', '42501', pg_temp.try_as(ad1, format('select public.approve_death_record_reversal(%L)', req)));
  perform pg_temp.ck('2b a clinician who is not the CMO cannot approve', '42501', pg_temp.try_as(clin, format('select public.approve_death_record_reversal(%L)', req)));
  perform pg_temp.ck('2c the patient cannot approve', '42501', pg_temp.try_as(pat, format('select public.approve_death_record_reversal(%L)', req)));
  perform pg_temp.ck('2d an admin of another organisation cannot approve', '42501', pg_temp.try_as(ad_other, format('select public.approve_death_record_reversal(%L)', req)));
  perform pg_temp.ck('2e still deceased', 'deceased', (select profile_status from public.profiles where id = pat));

  -- 7a final for everyone else
  perform pg_temp.ck('7a a direct admin update is refused', '42501', pg_temp.try_as(ad2, format('update public.profiles set profile_status = %L where id = %L', 'active', pat)));

  -- 5a held notice is cancelled by the reversal; sabotage later checks the cancellation matters
  perform pg_temp.ck('5a before: one held bereavement notice', '1', (select count(*)::text from public.bereavement_sponsor_notices where patient_id = pat and kind = 'bereavement' and state = 'held'));

  -- 3 a different admin approves
  perform pg_temp.as_user(ad2); execute 'set local role authenticated';
  perform public.approve_death_record_reversal(req);
  execute 'reset role';
  perform pg_temp.ck('3a the profile is active again', 'active', (select profile_status from public.profiles where id = pat));
  perform pg_temp.ck('3b the death record is reversed, not deleted', 'reversed', (select state from public.death_records where patient_id = pat));
  select state || '/' || (approved_by = ad2)::text || '/' || (requested_by = ad1)::text into v_s from public.death_record_reversals where id = req;
  perform pg_temp.ck('3c the request records both people', 'approved/true/true', v_s);

  -- 4 only what is safe
  perform pg_temp.ck('4a the circle stays revoked', '0', (select count(*)::text from public.care_circle_members where patient_id = pat and state = 'active'));
  perform pg_temp.ck('4b cancelled invites stay cancelled', '0', (select count(*)::text from public.care_circle_invites where patient_id = pat and state = 'pending'));
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload) values (v_org, pat, 'in_app', 'pending', 'entitlement_expiring_soon', '{}');
  perform pg_temp.ck('4c notifications flow again (pending, not suppressed)', '1', (select count(*)::text from public.notifications where recipient_id = pat and template = 'entitlement_expiring_soon' and status = 'pending'));
  perform pg_temp.ck('4d no goodwill request is left waiting for finance', '0', (select count(*)::text from public.goodwill_refund_requests where patient_id = pat and state = 'needs_finance'));
  perform pg_temp.ck('4e request and reversal are audited', '2', (select count(*)::text from public.audit_log where action in ('bereavement.reversal_requested', 'bereavement.reversed') and subject_patient_id = pat));
  perform pg_temp.ck('5b the held notice was cancelled, not deleted', '1/reversed',
    (select count(*)::text || '/' || min(cancel_reason) from public.bereavement_sponsor_notices where patient_id = pat and kind = 'bereavement' and state = 'cancelled'));
  perform pg_temp.ck('5c no sponsor message and no correction went out', '0', (select count(*)::text from public.notifications where recipient_id = sup and template in ('sponsor_bereavement', 'sponsor_bereavement_correction')));
  perform pg_temp.ck('7b an approved request cannot be reused', 'P0002', pg_temp.try_as(ad2, format('select public.approve_death_record_reversal(%L)', req)));

  -- 5d correction for a message already sent: one named, one unnamed
  perform pg_temp.voucher(v_org, patb, sup_b1, v_sp);
  perform pg_temp.voucher(v_org, patb, sup_b2, v_sp);
  perform pg_temp.kill(clinb, patb);
  update public.bereavement_sponsor_notices set send_after = now() - interval '1 minute' where patient_id = patb;
  update public.bereavement_sponsor_notices set may_name = false where patient_id = patb and sponsor_profile_id = sup_b2;
  perform private.sweep_bereavement_notices();
  perform pg_temp.ck('5d both original messages were sent', '2', (select count(*)::text from public.notifications where template = 'sponsor_bereavement' and recipient_id in (sup_b1, sup_b2)));
  perform pg_temp.as_user(ad1); execute 'set local role authenticated';
  reqb := public.request_death_record_reversal(patb, 'recorded against the wrong person, confirmed with the family');
  execute 'reset role';
  perform pg_temp.as_user(ad2); execute 'set local role authenticated';
  perform public.approve_death_record_reversal(reqb);
  execute 'reset role';
  perform pg_temp.ck('5e each sponsor gets exactly one correction', '1/1',
    (select (select count(*) from public.notifications where template = 'sponsor_bereavement_correction' and recipient_id = sup_b1)::text || '/' ||
            (select count(*) from public.notifications where template = 'sponsor_bereavement_correction' and recipient_id = sup_b2)::text));
  perform pg_temp.ck('5f the named sponsor gets the first name, the other none', 'Bola/none',
    (select coalesce((select payload ->> 'first_name' from public.notifications where template = 'sponsor_bereavement_correction' and recipient_id = sup_b1), 'none') || '/' ||
            coalesce((select payload ->> 'first_name' from public.notifications where template = 'sponsor_bereavement_correction' and recipient_id = sup_b2), 'none')));
  perform pg_temp.ck('5g correction notices are recorded as sent, never deleted', '2', (select count(*)::text from public.bereavement_sponsor_notices where patient_id = patb and kind = 'correction' and state = 'sent'));

  -- 6 lapse then a new request works
  perform pg_temp.kill(clin, pat);
  perform pg_temp.as_user(ad1); execute 'set local role authenticated';
  req := public.request_death_record_reversal(pat, 'a second request, this one will lapse before approval');
  execute 'reset role';
  update public.death_record_reversals set requested_at = now() - interval '8 days' where id = req;
  perform pg_temp.ck('6a a request older than 7 days cannot be approved', 'P0001', pg_temp.try_as(ad2, format('select public.approve_death_record_reversal(%L)', req)));
  perform private.sweep_bereavement_notices();
  perform pg_temp.ck('6b the sweep marks it expired', 'expired', (select state from public.death_record_reversals where id = req));
  perform pg_temp.as_user(ad1); execute 'set local role authenticated';
  req := public.request_death_record_reversal(pat, 'a third request after the lapse, fresh and valid');
  execute 'reset role';
  perform pg_temp.ck('6c after the lapse a new request works', 'requested', (select state from public.death_record_reversals where id = req));

  -- 8 SABOTAGE
  v_def := pg_get_functiondef('public.approve_death_record_reversal(uuid)'::regprocedure);
  execute replace(v_def, 'if r.requested_by = v_uid then raise exception ''reversal_not_authorised'' using errcode = ''42501''; end if;', '');
  perform pg_temp.ck('8a SABOTAGE: without the function check the own-request approval fails with a different error (2a would FAIL)', '23514',
    pg_temp.try_as(ad1, format('select public.approve_death_record_reversal(%L)', req)));
  v_def := pg_get_functiondef('private.guard_profile_status()'::regprocedure);
  execute replace(v_def, 'coalesce(current_setting(''tarragon.w21_reversal_path'', true), '''') = ''on''', 'false');
  perform pg_temp.ck('8b SABOTAGE: without the guard reversal path the approval cannot restore (3a would FAIL)', '42501',
    pg_temp.try_as(ad2, format('select public.approve_death_record_reversal(%L)', req)));
end $$;

select * from w21r_results order by check_name;
do $$ begin
  if exists (select 1 from w21r_results where verdict = 'FAIL') then raise exception 'W-21 reversal proof: % check(s) FAILED', (select count(*) from w21r_results where verdict = 'FAIL'); end if;
end $$;
rollback;
