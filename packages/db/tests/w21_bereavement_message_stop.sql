-- ===========================================================================
-- Proof: W-21 bereavement message-stop. NOT EXECUTED LOCALLY when written (Docker was down); CI replay is the first run.
--   1. WHO may record: the patient, a supporter, a stranger, an unrelated clinician and a clinician or admin of ANOTHER organisation are refused
--      (42501); a clinician with a care relationship records in one step (basis clinician_confirmed) and the CMO route needs no tie.
--   2. NEXT OF KIN is two steps: an admin requests (evidence required), nothing changes; the requester cannot confirm; an admin of another
--      organisation cannot confirm; a DIFFERENT admin confirms and only then is the profile deceased, basis next_of_kin_verified, evidence kept.
--      A request older than 7 days cannot be confirmed, the sweep marks it expired, and a NEW request then works.
--   3. The status is not writable by the patient or by anyone else directly; basis, recorder and evidence are in death_records, not on profiles,
--      and a supporter cannot read death_records.
--   4. Cascade: circle memberships revoked, pending invites cancelled, supporter view refused; goodwill requests only for UNDELIVERED items
--      (an active voucher yes, a redeemed voucher no), with the basis stored, and no money moved.
--   5. Sponsor message is HELD, not sent, in the death transaction (send_after = recorded_at + 48h); the sweep before the time sends nothing;
--      after the time it sends exactly one empty-payload in-app message and a second sweep adds none; a held message whose record no longer
--      stands is cancelled by the sweep, not sent.
--   6. Notifications to the deceased: a reminder and a referral prompt are stored as status suppressed (the id is returned); SAFETY notices
--      still land pending: priority critical, a security.* template, a named emergency template. A living person is unchanged.
--   7. Sponsor reports skip the deceased: queue_sponsor_monthly_reports (with a living-beneficiary control that is still queued),
--      queue_sponsor_quiet_nudges source filter and notify_sponsors_care_reviewed.
--   8. SABOTAGE: org check removed (cross-org clinician would record), two-step bypass (own-confirm check removed fails on the table CHECK
--      with a different error), safety exemption removed (a critical notice is suppressed), hold bypass (message sent at once).
-- BEGIN/ROLLBACK; mints its own fixtures. Needs one service_products row.
-- ===========================================================================
begin;
create temp table w21_results (check_name text, observed text, expected text, verdict text);
grant all on w21_results to public;

create function pg_temp.mkuser(p_role text, p_name text, p_org uuid default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := coalesce(p_org, (select id from public.organisations order by created_at limit 1));
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'w21-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
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
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.as_user(p_uid); execute 'set local role authenticated';
  begin execute p_sql into r; execute 'reset role'; return r;
  exception when others then execute 'reset role'; return 'ERR:' || sqlstate; end;
end $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into w21_results values (p_name, p_actual, p_expected, case when p_actual is not distinct from p_expected then 'PASS' else 'FAIL' end) $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_org2 uuid; v_sp uuid := (select id from public.service_products limit 1);
  pat uuid; pat2 uuid; pat3 uuid; sup_v uuid; sup_c uuid; stranger uuid; clin uuid; clin_untied uuid; clin_other uuid; adm1 uuid; adm2 uuid; adm_other uuid;
  living uuid; v_voucher uuid; v_voucher2 uuid; req uuid; v_n integer; v_s text; v_id uuid; v_rec uuid; v_def text; v_json jsonb;
begin
  if v_sp is null then raise exception 'fixture FAIL: no service_products row'; end if;
  insert into public.organisations (name, type) select 'W21 other org', type from public.organisations order by created_at limit 1 returning id into v_org2;
  pat := pg_temp.mkuser('patient', 'W21 Patient'); pat2 := pg_temp.mkuser('patient', 'W21 Patient Two'); pat3 := pg_temp.mkuser('patient', 'W21 Patient Three');
  sup_v := pg_temp.mkuser('patient', 'W21 Voucher Sponsor'); sup_c := pg_temp.mkuser('patient', 'W21 Circle Sponsor'); stranger := pg_temp.mkuser('patient', 'W21 Stranger');
  clin := pg_temp.mkuser('clinician', 'W21 Clinician'); clin_untied := pg_temp.mkuser('clinician', 'W21 Untied Clinician');
  clin_other := pg_temp.mkuser('clinician', 'W21 Other Org Clinician', v_org2);
  adm1 := pg_temp.mkuser('admin', 'W21 Admin One'); adm2 := pg_temp.mkuser('admin', 'W21 Admin Two'); adm_other := pg_temp.mkuser('admin', 'W21 Other Org Admin', v_org2);
  living := pg_temp.mkuser('patient', 'W21 Living');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, pat, clin);

  insert into public.care_vouchers (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id, service_product_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status)
  values (v_org, 'W21A-' || substr(gen_random_uuid()::text, 1, 8), 'prepaid_service', pat, sup_v, v_sp, 'w21', 'W21 proof', 500000, 500000, 'active') returning id into v_voucher;
  insert into public.care_vouchers (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id, service_product_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status, redeemed_at, redeemed_order_id)
  values (v_org, 'W21B-' || substr(gen_random_uuid()::text, 1, 8), 'prepaid_service', pat, sup_v, v_sp, 'w21', 'W21 used', 300000, 300000, 'redeemed', now(), gen_random_uuid()) returning id into v_voucher2;
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test) values
    (v_org, pat, sup_c, 'daughter', array['pay_for_care', 'appointments'], now() + interval '60 days', true),
    (v_org, living, pat, 'friend', array['appointments'], now() + interval '60 days', true);
  insert into public.care_circle_invites (organisation_id, patient_id, invitee_kind, invitee_hash, invitee_hint, relationship, permissions, grant_days, token_hash, expires_at, is_test)
  values (v_org, pat, 'email', repeat('a', 64), 'x', 'son', array['appointments'], 30, repeat('e', 64), now() + interval '3 days', true);

  -- 1 who may record
  perform pg_temp.ck('1a the patient cannot', '42501', pg_temp.try_as(pat, format('select public.record_patient_death(%L)', pat)));
  perform pg_temp.ck('1b a supporter cannot', '42501', pg_temp.try_as(sup_c, format('select public.record_patient_death(%L)', pat)));
  perform pg_temp.ck('1c a stranger cannot', '42501', pg_temp.try_as(stranger, format('select public.record_patient_death(%L)', pat)));
  perform pg_temp.ck('1d a clinician with no relationship cannot', '42501', pg_temp.try_as(clin_untied, format('select public.record_patient_death(%L)', pat)));
  perform pg_temp.ck('1e a clinician of another organisation cannot', '42501', pg_temp.try_as(clin_other, format('select public.record_patient_death(%L)', pat)));
  perform pg_temp.ck('1f an admin cannot use the one-step path', '42501', pg_temp.try_as(adm1, format('select public.record_patient_death(%L)', pat)));
  perform pg_temp.ck('1g nothing changed', 'active', (select profile_status from public.profiles where id = pat));

  -- 2 next of kin is two steps
  perform pg_temp.ck('2a an admin of another organisation cannot request', '42501', pg_temp.try_as(adm_other, format('select public.request_patient_death(%L, %L)', pat2, 'family statement ref 1')));
  perform pg_temp.ck('2b evidence is required', '22023', pg_temp.try_as(adm1, format('select public.request_patient_death(%L, %L)', pat2, 'x')));
  perform pg_temp.as_user(adm1); execute 'set local role authenticated';
  req := public.request_patient_death(pat2, 'family statement ref 1');
  execute 'reset role';
  perform pg_temp.ck('2c a request alone changes nothing', 'active', (select profile_status from public.profiles where id = pat2));
  perform pg_temp.ck('2d the requester cannot confirm', '42501', pg_temp.try_as(adm1, format('select public.confirm_patient_death(%L)', req)));
  perform pg_temp.ck('2e an admin of another organisation cannot confirm', '42501', pg_temp.try_as(adm_other, format('select public.confirm_patient_death(%L)', req)));
  perform pg_temp.ck('2f a clinician who is not the CMO cannot confirm', '42501', pg_temp.try_as(clin, format('select public.confirm_patient_death(%L)', req)));
  perform pg_temp.as_user(adm2); execute 'set local role authenticated';
  v_json := public.confirm_patient_death(req);
  execute 'reset role';
  select p.profile_status || '/' || dr.basis || '/' || dr.evidence_reference || '/' || (dr.recorded_by = adm1)::text || '/' || (dr.confirmed_by = adm2)::text into v_s
    from public.profiles p join public.death_records dr on dr.patient_id = p.id where p.id = pat2;
  perform pg_temp.ck('2g a different admin confirms: deceased, basis and evidence kept', 'deceased/next_of_kin_verified/family statement ref 1/true/true', v_s);
  -- lapse then a new request works
  perform pg_temp.as_user(adm1); execute 'set local role authenticated';
  req := public.request_patient_death(pat3, 'family statement ref 2');
  execute 'reset role';
  update public.death_record_requests set requested_at = now() - interval '8 days' where id = req;
  perform pg_temp.ck('2h a request older than 7 days cannot be confirmed', 'P0001', pg_temp.try_as(adm2, format('select public.confirm_patient_death(%L)', req)));
  perform private.sweep_bereavement_notices();
  perform pg_temp.ck('2i the sweep marks it expired', 'expired', (select state from public.death_record_requests where id = req));
  perform pg_temp.as_user(adm1); execute 'set local role authenticated';
  req := public.request_patient_death(pat3, 'family statement ref 3');
  execute 'reset role';
  perform pg_temp.ck('2j after the lapse a new request works', 'requested', (select state from public.death_record_requests where id = req));

  -- 3 the status is not directly writable; restricted detail
  perform pg_temp.ck('3a a patient cannot set their own status', '42501', pg_temp.try_as(pat, format('update public.profiles set profile_status = %L where id = %L', 'deceased', pat)));
  perform pg_temp.ck('3b an admin cannot set it directly', '42501', pg_temp.try_as(adm1, format('update public.profiles set profile_status = %L where id = %L', 'deceased', pat)));

  -- clinician path (tied)
  perform pg_temp.as_user(clin); execute 'set local role authenticated';
  v_json := public.record_patient_death(pat, 'told by the family at the visit');
  execute 'reset role';
  perform pg_temp.ck('1h a tied clinician records in one step', 'deceased/clinician_confirmed', (select p.profile_status || '/' || dr.basis from public.profiles p join public.death_records dr on dr.patient_id = p.id where p.id = pat));
  perform pg_temp.ck('3c a supporter cannot read death_records', '0', pg_temp.q_as(sup_c, 'select count(*)::text from public.death_records'));
  perform pg_temp.ck('3d an admin of the organisation can', '1', pg_temp.q_as(adm1, format('select count(*)::text from public.death_records where patient_id = %L', pat)));
  perform pg_temp.ck('3e an admin of another organisation cannot', '0', pg_temp.q_as(adm_other, format('select count(*)::text from public.death_records where patient_id = %L', pat)));

  -- 4 cascade
  perform pg_temp.ck('4a circle memberships revoked', '0', (select count(*)::text from public.care_circle_members where (patient_id = pat or supporter_id = pat) and state = 'active'));
  perform pg_temp.ck('4b pending invites cancelled', '0', (select count(*)::text from public.care_circle_invites where patient_id = pat and state = 'pending'));
  perform pg_temp.ck('4c the supporter view is refused', 'P0002', pg_temp.try_as(sup_c, format('select public.circle_supporter_view(%L)', pat)));
  perform pg_temp.ck('4d goodwill request for the undelivered voucher only, with its basis', '1/unused_voucher',
    (select count(*)::text || '/' || coalesce(min(basis), '') from public.goodwill_refund_requests where patient_id = pat and source_id = v_voucher));
  perform pg_temp.ck('4e none for the redeemed voucher', '0', (select count(*)::text from public.goodwill_refund_requests where source_id = v_voucher2));
  perform pg_temp.ck('4f the voucher itself is untouched', 'active', (select status::text from public.care_vouchers where id = v_voucher));

  -- 5 the sponsor message is held
  perform pg_temp.ck('5a no sponsor message was sent in the death transaction', '0', (select count(*)::text from public.notifications where template = 'sponsor_bereavement' and recipient_id in (sup_v, sup_c)));
  perform pg_temp.ck('5b two held notices with send_after about 48h out', '2',
    (select count(*)::text from public.bereavement_sponsor_notices n join public.death_records dr on dr.id = n.death_record_id
      where n.patient_id = pat and n.kind = 'bereavement' and n.state = 'held' and n.send_after between dr.recorded_at + interval '47 hours' and dr.recorded_at + interval '49 hours'));
  perform private.sweep_bereavement_notices();
  perform pg_temp.ck('5c a sweep before the time sends nothing', '0', (select count(*)::text from public.notifications where template = 'sponsor_bereavement' and recipient_id in (sup_v, sup_c)));
  update public.bereavement_sponsor_notices set send_after = now() - interval '1 minute' where patient_id = pat;
  perform private.sweep_bereavement_notices();
  perform private.sweep_bereavement_notices();
  perform pg_temp.ck('5d after the time exactly one message each, empty payload, in-app', '2',
    (select count(*)::text from public.notifications where template = 'sponsor_bereavement' and recipient_id in (sup_v, sup_c) and payload = '{}'::jsonb and channel = 'in_app'));
  perform pg_temp.ck('5e the notices are marked sent', '2', (select count(*)::text from public.bereavement_sponsor_notices where patient_id = pat and kind = 'bereavement' and state = 'sent'));

  -- 6 notifications to the deceased
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload) values (v_org, pat, 'in_app', 'pending', 'entitlement_expiring_soon', '{}') returning id into v_id;
  perform pg_temp.ck('6a a reminder is kept but suppressed, and the id is returned', 'suppressed/true',
    (select status::text || '/' || (v_id is not null)::text from public.notifications where id = v_id));
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload) values (v_org, pat, 'in_app', 'pending', 'referral_prompt', '{}') returning id into v_id;
  perform pg_temp.ck('6b a referral prompt is suppressed', 'suppressed', (select status::text from public.notifications where id = v_id));
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, priority) values (v_org, pat, 'in_app', 'pending', 'critical_result_follow_up', '{}', 'critical') returning id into v_id;
  perform pg_temp.ck('6c a critical-priority notice still lands pending', 'pending', (select status::text from public.notifications where id = v_id));
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload) values (v_org, pat, 'in_app', 'pending', 'security.new_device_signin', '{}') returning id into v_id;
  perform pg_temp.ck('6d a security notice still lands pending', 'pending', (select status::text from public.notifications where id = v_id));
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload) values (v_org, pat, 'in_app', 'pending', 'emergency_followup', '{}') returning id into v_id;
  perform pg_temp.ck('6e a named emergency template still lands pending', 'pending', (select status::text from public.notifications where id = v_id));
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload) values (v_org, living, 'in_app', 'pending', 'entitlement_expiring_soon', '{}') returning id into v_id;
  perform pg_temp.ck('6f a living person is unchanged', 'pending', (select status::text from public.notifications where id = v_id));

  -- 7 sponsor reports skip the deceased; a living beneficiary is still reported (control)
  delete from public.notifications where template = 'sponsor_monthly_report' and recipient_id in (sup_v, sup_c);
  insert into public.care_vouchers (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id, service_product_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status)
  values (v_org, 'W21C-' || substr(gen_random_uuid()::text, 1, 8), 'prepaid_service', living, sup_c, v_sp, 'w21', 'W21 living', 100000, 100000, 'active');
  perform private.queue_sponsor_monthly_reports();
  perform pg_temp.ck('7a no monthly report about the deceased', '0', (select count(*)::text from public.notifications where template = 'sponsor_monthly_report' and recipient_id = sup_v));
  perform pg_temp.ck('7b the living beneficiary is still reported (control)', '2', (select count(*)::text from public.notifications where template = 'sponsor_monthly_report' and recipient_id = sup_c));
  perform pg_temp.ck('7c the quiet-nudge and care-reviewed sources filter on the status', 'true',
    (pg_get_functiondef('private.queue_sponsor_quiet_nudges()'::regprocedure) like '%profile_status = ''active''%'
     and pg_get_functiondef('private.notify_sponsors_care_reviewed()'::regprocedure) like '%profile_is_deceased(new.patient_id)%')::text);

  -- 8 SABOTAGE
  v_def := pg_get_functiondef('public.record_patient_death(uuid,text)'::regprocedure);
  v_def := replace(v_def, 'or v_caller_org <> v_patient_org', 'or false');
  v_def := replace(v_def, 'or not (private.clinician_has_patient_access(p_patient) or private.is_cmo_user(v_uid))', 'or false');
  execute v_def;
  perform pg_temp.ck('8a SABOTAGE: without the organisation and relationship checks a clinician of another org records (1e would FAIL)', 'ok',
    pg_temp.try_as(clin_other, format('select public.record_patient_death(%L)', living)));
  v_def := pg_get_functiondef('private.notifications_bereavement_stop()'::regprocedure);
  execute replace(v_def, 'new.priority = ''critical'' or ', 'false or ');
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, priority) values (v_org, pat, 'in_app', 'pending', 'critical_result_follow_up', '{}', 'critical') returning id into v_id;
  perform pg_temp.ck('8b SABOTAGE: without the safety exemption a critical notice is suppressed (6c would FAIL)', 'suppressed', (select status::text from public.notifications where id = v_id));
  v_def := pg_get_functiondef('public.confirm_patient_death(uuid)'::regprocedure);
  execute replace(v_def, 'or r.requested_by = v_uid', 'or false');
  perform pg_temp.as_user(adm1); execute 'set local role authenticated';
  req := public.request_patient_death(living, 'sabotage evidence ref');
  execute 'reset role';
  perform pg_temp.ck('8c SABOTAGE: without the function check the table CHECK still stops own-confirm but with a different error (2d would FAIL)', '23514',
    pg_temp.try_as(adm1, format('select public.confirm_patient_death(%L)', req)));
end $$;

select * from w21_results order by check_name;
do $$ begin
  if exists (select 1 from w21_results where verdict = 'FAIL') then raise exception 'W-21 proof: % check(s) FAILED', (select count(*) from w21_results where verdict = 'FAIL'); end if;
end $$;
rollback;
