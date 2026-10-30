-- Tarragon Health: a lab order from request to a rejected sample, end to end (2026-10-30)
--
-- E8 of the events harness. s27_lab_results_release.sql already proves result entry and release from every seat. This one
-- proves the part around it, from the patient's and the staff member's seat:
--
--   1  order requested      the patient gets one notice per channel, the email goes to their own address
--   2  payment confirmed    the patient is told, the lab is emailed at the contact on file (and nobody is emailed when there
--                           is no contact), and a specimen is waiting for collection
--   3  specimen rejected    only the lab that owns the specimen can reject it; the specimen is closed with its reason, a chained
--                           replacement is waiting, the patient is told in the app, and the Chief Medical Officer (and no other
--                           doctor) is told in the app
--   4  order sample_rejected the older order-level path: a reason is required, the patient is told, an operational alert is
--                           raised for the care team and the rejection is audited
--   5  deliverable          every push or email these events queue can be rendered by the sender (the E7 check)
--
-- E8_TS_RENDERED: lab_order_requested_patient, lab_order_patient_confirmation, lab_order_lab_alert, lab_sample_rejected
-- E8_IN_APP: lab_order_requested_patient, lab_order_patient_confirmation, lab_specimen_rejected_recollection_needed, lab_specimen_rejected_recollection_needed_staff, lab_sample_rejected
--
-- packages/notifications/src/events-delivery-renderable.test.ts proves the E8_TS_RENDERED templates render from the sender's code
-- map; apps/web/src/lib/notifications/events-lab-describe.test.ts proves every E8_IN_APP template has its own bell wording rather
-- than the generic "You have an update".
--
-- Fixtures built here, wrapped in BEGIN/ROLLBACK, raises on failure.
-- Run: psql "$DATABASE_URL" -f packages/db/tests/events_lab_order_to_specimen_notices.sql

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
  values (v, 'ev8-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'EV8 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'EV8 ' || p_label, 'MDCN', 'EV8-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true);
  return v;
end $f$;
create function pg_temp.mkorder(p_org uuid, p_pat uuid, p_provider uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.lab_orders (organisation_id, patient_id, provider_id, fulfilment, status, origin, ordered_by, clinical_indication)
  values (p_org, p_pat, p_provider, 'partner', 'pending_payment', 'clinically_triggered',
          (select id from public.clinical_staff where profile_id = pg_temp.f('doc')), 'EV8 proof order')
  returning id into v;
  return v;
end $f$;
create function pg_temp.n(p_template text, p_channel text, p_order text) returns integer language sql as
$$ select count(*)::integer from public.notifications
    where template = p_template and channel::text = p_channel and payload->>'order_number' = p_order $$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_lab_a uuid; v_lab_b uuid; v_lab_c uuid; v_pat uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists, the core migrations did not run'; end if;
  insert into fx values ('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  insert into fx values ('admin', v_admin);

  insert into public.lab_providers (name, is_active, contact_email) values ('EV8 Lab A', false, 'ev8-lab-a@example.invalid') returning id into v_lab_a;
  insert into public.lab_providers (name, is_active) values ('EV8 Lab B', false) returning id into v_lab_b;
  insert into public.lab_providers (name, is_active) values ('EV8 Lab C no contact', false) returning id into v_lab_c;
  insert into fx values ('provA', v_lab_a), ('provB', v_lab_b), ('provC', v_lab_c);

  insert into fx values ('labA', pg_temp.mkuser(v_org, 'labA', 'lab_partner')), ('labB', pg_temp.mkuser(v_org, 'labB', 'lab_partner'));
  update public.profiles set lab_provider_id = v_lab_a where id = pg_temp.f('labA');
  update public.profiles set lab_provider_id = v_lab_b where id = pg_temp.f('labB');

  insert into fx values ('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin));
  insert into fx values ('other_doc', pg_temp.mkdoc(v_org, 'other-doc', 'senior_medical_officer', v_admin));
  insert into fx values ('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  insert into fx values ('coord', pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', v_admin));
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  insert into fx values ('pat', v_pat);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_pat, pg_temp.f('doc'));
end $$;

-- ================================================================ 1 order requested
do $$
declare v_o uuid; v_num text;
begin
  v_o := pg_temp.mkorder(pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('provA'));
  select order_number into v_num from public.lab_orders where id = v_o;
  insert into fx values ('order', v_o);
  if v_num is null then raise exception 'FAIL 1: the order got no order number, its notices cannot be matched'; end if;

  if pg_temp.n('lab_order_requested_patient', 'email', v_num) <> 1 then
    raise exception 'FAIL 1: the patient got % request emails, expected 1', pg_temp.n('lab_order_requested_patient', 'email', v_num);
  end if;
  if not exists (select 1 from public.notifications n join auth.users u on u.id = n.recipient_id
                  where n.template = 'lab_order_requested_patient' and n.channel = 'email' and n.payload->>'order_number' = v_num
                    and n.recipient_id = pg_temp.f('pat') and n.payload->>'to_email' = u.email) then
    raise exception 'FAIL 1: the request email is not addressed to the patient''s own address';
  end if;
  -- on the patient's own channel too (no push subscription and no email preference here, so the app inbox)
  if (select count(*) from public.notifications
       where template = 'lab_order_requested_patient' and channel <> 'email' and payload->>'order_number' = v_num
         and recipient_id = pg_temp.f('pat')) <> 1 then
    raise exception 'FAIL 1: the patient did not get exactly one request notice on their own channel';
  end if;
end $$;

-- ================================================================ 2 payment confirmed
do $$
declare v_o uuid := pg_temp.f('order'); v_num text; v_c uuid; v_num_c text;
begin
  select order_number into v_num from public.lab_orders where id = v_o;
  if pg_temp.n('lab_order_lab_alert', 'email', v_num) <> 0 then raise exception 'FAIL 2: the lab was told before payment'; end if;

  update public.lab_orders set status = 'payment_confirmed', payment_confirmed_at = now() where id = v_o;

  if pg_temp.n('lab_order_patient_confirmation', 'email', v_num) <> 1 then
    raise exception 'FAIL 2: the patient got % confirmation emails, expected 1', pg_temp.n('lab_order_patient_confirmation', 'email', v_num);
  end if;
  if pg_temp.n('lab_order_patient_confirmation', 'in_app', v_num) <> 1 then
    raise exception 'FAIL 2: the patient has % confirmations in the app, expected 1', pg_temp.n('lab_order_patient_confirmation', 'in_app', v_num);
  end if;
  if pg_temp.n('lab_order_lab_alert', 'email', v_num) <> 1 then
    raise exception 'FAIL 2: the lab got % alert emails, expected 1', pg_temp.n('lab_order_lab_alert', 'email', v_num);
  end if;
  if not exists (select 1 from public.notifications
                  where template = 'lab_order_lab_alert' and channel = 'email' and payload->>'order_number' = v_num
                    and payload->>'to_email' = 'ev8-lab-a@example.invalid') then
    raise exception 'FAIL 2: the lab alert is not addressed to the contact on file';
  end if;
  if not exists (select 1 from public.lab_specimens where lab_order_id = v_o and status = 'pending_collection' and recollection_of is null) then
    raise exception 'FAIL 2: no specimen is waiting for collection';
  end if;

  -- a lab with no contact on file is not emailed at an empty address
  v_c := pg_temp.mkorder(pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('provC'));
  select order_number into v_num_c from public.lab_orders where id = v_c;
  update public.lab_orders set status = 'payment_confirmed', payment_confirmed_at = now() where id = v_c;
  if exists (select 1 from public.notifications where template = 'lab_order_lab_alert' and payload->>'order_number' = v_num_c) then
    raise exception 'FAIL 2: a lab alert was queued for a lab with no contact on file';
  end if;
  if pg_temp.n('lab_order_patient_confirmation', 'email', v_num_c) <> 1 then
    raise exception 'FAIL 2: the patient was not told when the lab has no contact';
  end if;
end $$;

-- ================================================================ 3 specimen rejected
do $$
declare v_o uuid := pg_temp.f('order'); v_spec uuid; v_new uuid; v_r text;
begin
  select id into v_spec from public.lab_specimens where lab_order_id = v_o and recollection_of is null;

  v_r := pg_temp.q_as(pg_temp.f('labB'), format($q$select (public.lab_partner_reject_specimen(%L, 'damaged_specimen', 'not mine'))::text$q$, v_spec));
  if v_r not like 'ERR:%not authorized for this specimen%' then
    raise exception 'FAIL 3: another lab could reject this lab''s specimen (got %)', v_r;
  end if;
  if (select status::text from public.lab_specimens where id = v_spec) = 'rejected' then
    raise exception 'FAIL 3: the specimen was rejected by a lab that does not own it';
  end if;

  v_r := pg_temp.q_as(pg_temp.f('labA'), format($q$select (public.lab_partner_update_specimen_status(%L, 'received'))::text$q$, v_spec));
  if v_r like 'ERR:%' then raise exception 'FAIL 3: the owning lab could not receive its specimen: %', v_r; end if;
  v_r := pg_temp.q_as(pg_temp.f('labA'), format($q$select (public.lab_partner_reject_specimen(%L, 'damaged_specimen', 'cracked tube'))::text$q$, v_spec));
  if v_r like 'ERR:%' then raise exception 'FAIL 3: the owning lab could not reject its specimen: %', v_r; end if;

  if not exists (select 1 from public.lab_specimens where id = v_spec and status = 'rejected' and rejection_reason = 'damaged_specimen') then
    raise exception 'FAIL 3: the rejected specimen was not closed with its reason';
  end if;
  select id into v_new from public.lab_specimens where recollection_of = v_spec;
  if v_new is null then raise exception 'FAIL 3: no replacement specimen was created'; end if;
  if (select status::text from public.lab_specimens where id = v_new) <> 'pending_collection' then
    raise exception 'FAIL 3: the replacement specimen is not waiting for collection';
  end if;

  if (select count(*) from public.notifications where template = 'lab_specimen_rejected_recollection_needed'
       and recipient_id = pg_temp.f('pat') and channel = 'in_app' and created_at >= now() - interval '1 hour'
       and payload->>'specimen_number' = (select specimen_number from public.lab_specimens where id = v_spec)) <> 1 then
    raise exception 'FAIL 3: the patient was not told once, in the app, that a new sample is needed';
  end if;
  if not exists (select 1 from public.notifications where template = 'lab_specimen_rejected_recollection_needed_staff'
                  and recipient_id = pg_temp.f('cmo') and channel = 'in_app'
                  and payload->>'order_id' = v_o::text) then
    raise exception 'FAIL 3: the Chief Medical Officer was not told';
  end if;
  if exists (select 1 from public.notifications where template = 'lab_specimen_rejected_recollection_needed_staff'
              and recipient_id in (pg_temp.f('doc'), pg_temp.f('other_doc')) and payload->>'order_id' = v_o::text) then
    raise exception 'FAIL 3: a doctor who is not the Chief Medical Officer was sent the staff notice';
  end if;

end $$;

-- ================================================================ 4 the order-level sample_rejected path
do $$
declare v_o uuid; v_num text; v_before int; v_alert record;
begin
  v_o := pg_temp.mkorder(pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('provA'));
  select order_number into v_num from public.lab_orders where id = v_o;
  update public.lab_orders set status = 'payment_confirmed', payment_confirmed_at = now() where id = v_o;
  update public.lab_orders set status = 'sample_collected' where id = v_o;
  insert into fx values ('order2', v_o);

  begin
    update public.lab_orders set status = 'sample_rejected' where id = v_o;
    raise exception 'FAIL 4: an order was marked sample_rejected with no reason';
  exception when sqlstate '22023' then null;
  end;

  update public.profiles set notification_channel_preference = 'email' where id = pg_temp.f('pat');
  select count(*) into v_before from public.clinician_alerts where patient_id = pg_temp.f('pat') and type_code = 'laboratory_failure';
  update public.lab_orders set status = 'sample_rejected', rejection_reason = 'Label did not match the request' where id = v_o;

  if (select count(*) from public.notifications where template = 'lab_sample_rejected' and recipient_id = pg_temp.f('pat')
       and payload->>'order_number' = v_num and channel = 'in_app') <> 1 then
    raise exception 'FAIL 4: the patient was not told once, in the app';
  end if;
  if (select count(*) from public.notifications where template = 'lab_sample_rejected' and recipient_id = pg_temp.f('pat')
       and payload->>'order_number' = v_num and channel = 'email') <> 1 then
    raise exception 'FAIL 4: the patient who prefers email was not sent exactly one email';
  end if;
  select * into v_alert from public.clinician_alerts
   where patient_id = pg_temp.f('pat') and type_code = 'laboratory_failure' order by created_at desc limit 1;
  if v_alert.id is null or (select count(*) from public.clinician_alerts where patient_id = pg_temp.f('pat') and type_code = 'laboratory_failure') <> v_before + 1 then
    raise exception 'FAIL 4: no operational alert was raised for the care team';
  end if;
  -- the active alert rule for laboratory_failure owns it at the care coordinator tier (logistics, not a clinical judgement)
  if v_alert.responsible_clinician_id is distinct from (select id from public.clinical_staff where profile_id = pg_temp.f('coord')) then
    raise exception 'FAIL 4: the alert was not routed to the care coordinator who owns lab logistics';
  end if;
  if pg_temp.q_as(pg_temp.f('doc'), format('select count(*)::text from public.clinician_alerts where id = %L', v_alert.id)) <> '1' then
    raise exception 'FAIL 4: the patient''s doctor cannot see the alert';
  end if;
  if not exists (select 1 from public.audit_log where action = 'lab_order.sample_rejected' and entity_id = v_o) then
    raise exception 'FAIL 4: the rejection was not audited';
  end if;

  -- frozen once recorded
  update public.lab_orders set rejection_reason = 'changed afterwards' where id = v_o;
  if (select rejection_reason from public.lab_orders where id = v_o) <> 'Label did not match the request' then
    raise exception 'FAIL 4: the recorded rejection reason was changed afterwards';
  end if;
end $$;

-- ================================================================ 5 every push or email can be rendered
do $$
declare
  v_ts_rendered text[] := array['lab_order_requested_patient', 'lab_order_patient_confirmation', 'lab_order_lab_alert', 'lab_sample_rejected'];
  r record; v_bad text := ''; v_n int;
begin
  select count(*) into v_n from public.notifications
   where channel <> 'in_app' and template = any (v_ts_rendered) and organisation_id = pg_temp.f('org') and created_at >= now() - interval '1 hour';
  if v_n = 0 then raise exception 'FAIL setup: the events queued no push or email, the check below would pass having checked nothing'; end if;

  for r in
    select distinct n.template, n.channel::text as channel
      from public.notifications n
     where n.channel <> 'in_app' and n.organisation_id = pg_temp.f('org') and n.created_at >= now() - interval '1 hour'
       and (n.template like 'lab_order%' or n.template like 'lab_sample%' or n.template like 'lab_specimen%')
  loop
    if r.template = any (v_ts_rendered) then continue; end if;
    if exists (select 1 from public.notification_template_locales l
                where l.template_key = r.template and l.channel::text = r.channel and l.locale = 'en' and l.is_active) then continue; end if;
    v_bad := v_bad || format(' %s/%s', r.template, r.channel);
  end loop;
  if v_bad <> '' then
    raise exception 'FAIL 5: the sender has nothing to render these queued rows with, so they fail as "unknown template":%', v_bad;
  end if;
end $$;

rollback;

select 'events_lab_order_to_specimen_notices: ok' as result;
