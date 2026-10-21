-- S26b proof: entitlement and refund hardening and the refund reversal hook (migration *_s26b_entitlement_and_refund_hardening.sql).
-- One rolled-back transaction. Proves:
--   1. Config: reminders at 30, 7, 1; 7 days of grace; 14 day cooling off; the public policy answer; anon refused.
--   2. Reminders: one row per step, each step sends once; a missed day sends one message not several; a short pack and a Membership are
--      not reminded; the channel is the one private.patient_reminder_channel() picks; nothing renews.
--   3. Grace: an ended pack is 'grace' with days left and a code to renew; past the window it is expired; a Membership has none;
--      consume_entitlement refuses an ended pack (no doctor time).
--   4. Refund machine: cooling-off window; decline needs a reason shown to the patient but kept out of the notification; a message and
--      an event at each step; claim before send; a failed provider call lands in failed (never stuck, never completed); an admin retry
--      returns it to the queue; approved can no longer jump to completed; a replayed result changes nothing.
--   5. Reversal: a consultation share already in the ledger gets ONE negative adjustment, old lines untouched, idempotent, pro rata on a
--      part refund, unlinked lines untouched, the ledger stays append only; the unrecognised deferred revenue is released once.
--   6. Reconcile: verdict table, record_refund_reconcile raises one incident per mismatch, delays are flagged, service functions refuse
--      anon and authenticated.
--   7. SABOTAGE: the reminder step rows removed (a duplicate message appears), the verdict function made to say 'matched' (a mismatch
--      goes unseen), the refund state machine emptied, and the table-wide SELECT put back on refunds. Each check must flip.
begin;

alter table public.catalog_items drop constraint catalog_items_only_membership_sellable;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
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
-- the service role, as the cron routes and the edge function call
create function pg_temp.svc() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
end $f$;
create function pg_temp.svc_off() returns void language plpgsql as
$f$ begin perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
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
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's26b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S26b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
-- a paid order with its success payment and an entitlement
create function pg_temp.mkorder(p_org uuid, p_buyer uuid, p_item uuid, p_price uuid, p_amount bigint, p_paid_days_ago int, p_test boolean default true) returns uuid
language plpgsql as $f$
declare o uuid := gen_random_uuid();
begin
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, p_org, p_buyer, p_buyer, p_item, p_price, p_amount, 0, p_amount, 'paid', now() - make_interval(days => p_paid_days_ago), 'tho_s26b_' || replace(o::text, '-', ''), p_test);
  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, total_kobo, status, source, is_test)
  values (p_org, o, 'paystack', 'tho_s26b_' || replace(o::text, '-', ''), p_amount, p_amount, 'success', 'return', p_test);
  return o;
end $f$;
create function pg_temp.mkent(p_org uuid, p_patient uuid, p_order uuid, p_kind text, p_start_days int, p_end_days int) returns uuid
language plpgsql as $f$
declare e uuid := gen_random_uuid();
begin
  insert into public.entitlements (id, organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test)
  values (e, p_org, p_patient, p_order, p_kind, now() + make_interval(days => p_start_days), now() + make_interval(days => p_end_days), 3,
          case when now() + make_interval(days => p_end_days) <= now() then 'expired' else 'active' end, true);
  return e;
end $f$;
create function pg_temp.notifs(p_patient uuid, p_template text) returns bigint language sql as
$$ select count(*) from public.notifications where recipient_id = p_patient and template = p_template $$;
create function pg_temp.steps(p_ent uuid) returns text language sql as
$$ select coalesce(string_agg(step_days || ':' || outcome, ',' order by step_days desc), '') from public.entitlement_reminder_steps where entitlement_id = p_ent $$;
create function pg_temp.evs(p_refund uuid) returns text language sql as
$$ select coalesce(string_agg(step, ',' order by created_at, id), '') from public.refund_status_events where refund_id = p_refund $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_pat2 uuid; v_pat3 uuid; v_doc uuid; v_doc_emp uuid;
  v_pack uuid := gen_random_uuid(); v_pack_price uuid := gen_random_uuid();
  v_mem uuid := gen_random_uuid(); v_mem_price uuid := gen_random_uuid();
  v_one uuid := gen_random_uuid(); v_one_price uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then raise exception 'no organisation: cannot run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_pat3 := pg_temp.mkuser(v_org, 'patient3', 'patient');
  v_doc := pg_temp.mkuser(v_org, 'doctor', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_doc, 'S26b doctor', 'MDCN', 'S26B-' || substr(v_doc::text, 1, 8), true, 'active', now(), v_admin,
          'senior_medical_officer', 'contracted', 2, true, v_admin, true);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('pat2', v_pat2); perform pg_temp.setf('pat3', v_pat3); perform pg_temp.setf('doc', v_doc);

  insert into public.catalog_items (id, organisation_id, code, kind, name_key, description_key, duration_days, uses, active) values
    (v_pack, v_org, 's26b_pack', 'care_pack', 's26b.pack.name', 's26b.pack.desc', 90, null, true),
    (v_mem,  v_org, 's26b_member', 'membership', 's26b.member.name', 's26b.member.desc', 365, null, true),
    (v_one,  v_org, 's26b_single', 'consultation', 's26b.single.name', 's26b.single.desc', null, 1, true);
  insert into public.prices (id, organisation_id, catalog_item_id, amount_kobo, components) values
    (v_pack_price, v_org, v_pack, 500000, '{}'), (v_mem_price, v_org, v_mem, 10000000, '{}'), (v_one_price, v_org, v_one, 500000, '{}');
  perform pg_temp.setf('pack', v_pack); perform pg_temp.setf('pack_price', v_pack_price);
  perform pg_temp.setf('mem', v_mem); perform pg_temp.setf('mem_price', v_mem_price);
  perform pg_temp.setf('one', v_one); perform pg_temp.setf('one_price', v_one_price);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Config
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_pol jsonb;
begin
  perform pg_temp.ck('config: reminder steps are 30, 7, 1 (longest first)', '{30,7,1}', private.entitlement_reminder_steps()::text);
  perform pg_temp.ck('config: grace is 7 days', '7', private.entitlement_grace_days()::text);
  perform pg_temp.ck('config: cooling off is 14 days', '14', private.order_refund_cooling_off_days()::text);
  v_pol := public.entitlement_policy_public();
  perform pg_temp.ck('config: the public answer carries the Membership window too', '21', v_pol ->> 'membership_window_days');
  perform pg_temp.ck('config: the public answer carries the answer time', '3', v_pol ->> 'decision_sla_days');
  perform pg_temp.ck('config: a signed-in person can ask for the policy', 'ok', pg_temp.try_as(pg_temp.f('pat'), 'select public.entitlement_policy_public()'));
  perform pg_temp.ck('config: anon cannot', 'false', has_function_privilege('anon', 'public.entitlement_policy_public()', 'EXECUTE')::text);
  perform pg_temp.ck('config: the config table is not readable by a patient', '42501', pg_temp.try_as(pg_temp.f('pat'), 'select * from public.entitlement_policy_config'));
  perform pg_temp.ck('config: only one active row per kind', '23505',
    pg_temp.try_sql($q$insert into public.entitlement_policy_config (kind, version, is_active, effective_from, rules) values ('lifecycle', 2, true, current_date, '{}'::jsonb)$q$));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. Reminders
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2'); v_pat3 uuid := pg_temp.f('pat3');
  o1 uuid; e1 uuid; o2 uuid; e2 uuid; o3 uuid; e3 uuid; o4 uuid; e4 uuid; o5 uuid; e5 uuid;
  n1 int; n2 int; ends_before timestamptz; ch_expected text; ch_seen text;
begin
  -- a 90 day pack now 25 days from its end: inside the 30 day step only
  o1 := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 65);
  e1 := pg_temp.mkent(v_org, v_pat, o1, 'care_pack', -65, 25);
  perform pg_temp.setf('e1', e1);
  select ends_at into ends_before from public.entitlements where id = e1;

  n1 := private.queue_entitlement_expiry_reminders();
  n2 := private.queue_entitlement_expiry_reminders();
  perform pg_temp.ck('reminders: the 30 day step sends once, a rerun sends nothing', '1/0', n1 || '/' || n2);
  perform pg_temp.ck('reminders: that step is recorded as sent', '30:sent', pg_temp.steps(e1));
  perform pg_temp.ck('reminders: one message to the patient', '1', pg_temp.notifs(v_pat, 'entitlement_expiring_soon')::text);

  update public.entitlements set ends_at = now() + interval '5 days' where id = e1;
  n1 := private.queue_entitlement_expiry_reminders();
  n2 := private.queue_entitlement_expiry_reminders();
  perform pg_temp.ck('reminders: the 7 day step sends once more', '1/0', n1 || '/' || n2);
  perform pg_temp.ck('reminders: steps so far', '30:sent,7:sent', pg_temp.steps(e1));

  update public.entitlements set ends_at = now() + interval '20 hours' where id = e1;
  n1 := private.queue_entitlement_expiry_reminders();
  n2 := private.queue_entitlement_expiry_reminders();
  perform pg_temp.ck('reminders: the 1 day step sends once more', '1/0', n1 || '/' || n2);
  perform pg_temp.ck('reminders: all three steps, one message each', '30:sent,7:sent,1:sent/3', pg_temp.steps(e1) || '/' || pg_temp.notifs(v_pat, 'entitlement_expiring_soon'));
  perform pg_temp.ck('reminders: a reminder never extends or renews', 'active/true',
    (select state from public.entitlements where id = e1) || '/' || ((select ends_at from public.entitlements where id = e1) < ends_before)::text);
  perform pg_temp.ck('reminders: the payload carries the entitlement and the date but names no service (INV-07)', 'true/true',
    (select (payload ? 'entitlement_id' and payload ? 'ends_at' and not payload ? 'kind' and not payload ? 'name')::text
       from public.notifications where recipient_id = v_pat and template = 'entitlement_expiring_soon' order by created_at limit 1) || '/' ||
    (not exists (select 1 from public.notification_template_locales where template_key = 'entitlement_expiring_soon'
                  and (body ilike '%{{kind}}%' or subject ilike '%{{kind}}%' or body ilike '%lab panel%' or body ilike '%consultation%' or subject ilike '%lab panel%')))::text);

  -- a missed run: first seen 20 hours before the end sends ONE message (the 1 day step), and the longer steps are marked, not sent
  o2 := pg_temp.mkorder(v_org, v_pat2, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 80);
  e2 := pg_temp.mkent(v_org, v_pat2, o2, 'care_pack', -80, 0);
  update public.entitlements set ends_at = now() + interval '20 hours', state = 'active' where id = e2;
  n1 := private.queue_entitlement_expiry_reminders();
  perform pg_temp.ck('reminders: a missed run sends one message, not three', '1/1', n1 || '/' || pg_temp.notifs(v_pat2, 'entitlement_expiring_soon'));
  perform pg_temp.ck('reminders: the longer steps are marked skipped', '30:skipped_overlap,7:skipped_overlap,1:sent', pg_temp.steps(e2));

  -- a pack shorter than the step would be reminded the day it was bought
  o3 := pg_temp.mkorder(v_org, v_pat3, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 0);
  e3 := pg_temp.mkent(v_org, v_pat3, o3, 'care_pack', 0, 5);
  n1 := private.queue_entitlement_expiry_reminders();
  perform pg_temp.ck('reminders: a 5 day pack is not reminded the day it is bought', '0/30:skipped_overlap,7:skipped_short', pg_temp.notifs(v_pat3, 'entitlement_expiring_soon') || '/' || pg_temp.steps(e3));

  -- a Membership and an employer seat have their own rules
  o4 := pg_temp.mkorder(v_org, v_pat3, pg_temp.f('mem'), pg_temp.f('mem_price'), 10000000, 340);
  e4 := pg_temp.mkent(v_org, v_pat3, o4, 'membership', -340, 3);
  n1 := private.queue_entitlement_expiry_reminders();
  perform pg_temp.ck('reminders: a Membership is not reminded here', '', pg_temp.steps(e4));

  -- the channel is the one private.patient_reminder_channel() chooses (email when preferred), never a hard-coded one
  update public.profiles set notification_channel_preference = 'email' where id = v_pat;
  o5 := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 70);
  e5 := pg_temp.mkent(v_org, v_pat, o5, 'care_pack', -70, 0);
  update public.entitlements set ends_at = now() + interval '20 days', state = 'active' where id = e5;
  n1 := private.queue_entitlement_expiry_reminders();
  ch_expected := private.patient_reminder_channel(v_pat)::text;
  select channel::text into ch_seen from public.notifications
   where recipient_id = v_pat and template = 'entitlement_expiring_soon' and payload ->> 'entitlement_id' = e5::text;
  perform pg_temp.ck('reminders: the channel is the one the patient chose (email)', 'email/email', ch_expected || '/' || coalesce(ch_seen, 'none'));
  perform pg_temp.ck('reminders: a patient with no preference gets the in-app inbox', 'in_app',
    (select channel::text from public.notifications where recipient_id = v_pat2 and template = 'entitlement_expiring_soon' limit 1));
  perform pg_temp.ck('reminders: the service wrapper refuses a signed-in patient', '42501', pg_temp.try_as(v_pat, 'select public.service_run_entitlement_reminders()'));
  perform pg_temp.svc();
  perform pg_temp.ck('reminders: the service wrapper runs for the service role', 'ok', pg_temp.try_sql('select public.service_run_entitlement_reminders()'));
  perform pg_temp.svc_off();
end $$;

-- one entitlement that cannot be reminded must not stop the others. A channel chooser that refuses ONE patient stands in for the fault
-- (a function is swapped inside this rolled-back transaction, so no table lock is taken that a live worker could deadlock on).
do $$
declare
  v_org uuid := pg_temp.f('org'); bad uuid; good uuid; o_bad uuid; e_bad uuid; o_good uuid; e_good uuid; n int; v_def text;
begin
  bad := pg_temp.mkuser(v_org, 'badrem', 'patient'); good := pg_temp.mkuser(v_org, 'goodrem', 'patient');
  o_bad := pg_temp.mkorder(v_org, bad, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 70);
  e_bad := pg_temp.mkent(v_org, bad, o_bad, 'care_pack', -70, 20);
  o_good := pg_temp.mkorder(v_org, good, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 70);
  e_good := pg_temp.mkent(v_org, good, o_good, 'care_pack', -70, 20);
  v_def := pg_get_functiondef('private.patient_reminder_channel(uuid, boolean)'::regprocedure);
  execute format($fmt$
    create or replace function private.patient_reminder_channel(p_recipient uuid, p_allow_email boolean default true)
    returns public.notification_channel language plpgsql stable security definer set search_path = '' as $b$
    begin
      if p_recipient = %L::uuid then raise exception 's26b boom'; end if;
      return 'in_app'::public.notification_channel;
    end $b$ $fmt$, bad);
  n := private.queue_entitlement_expiry_reminders();
  perform pg_temp.ck('reminders: one failing entitlement does not stop the others', '1/0',
    pg_temp.notifs(good, 'entitlement_expiring_soon') || '/' || pg_temp.notifs(bad, 'entitlement_expiring_soon'));
  perform pg_temp.ck('reminders: the failure is raised once, not swallowed', '1',
    (select count(*) from public.ops_incidents where external_reference = 'entitlement-reminder:' || e_bad)::text);
  perform pg_temp.ck('reminders: the failed entitlement has no step claimed, so it is retried', '', pg_temp.steps(e_bad));
  execute v_def;   -- the real chooser back
  n := private.queue_entitlement_expiry_reminders();
  perform pg_temp.ck('reminders: once the fault is gone the next run reminds it', '1', pg_temp.notifs(bad, 'entitlement_expiring_soon')::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. Grace
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2');
  o_g uuid; e_g uuid; o_x uuid; e_x uuid; o_m uuid; e_m uuid; o_a uuid; e_a uuid; o_r uuid; e_r uuid;
  j jsonb; row_g jsonb; row_x jsonb; row_m jsonb; row_r jsonb; r jsonb;
begin
  -- these belong to a fresh patient so the reminders above do not interfere
  v_pat := pg_temp.mkuser(v_org, 'grace', 'patient'); perform pg_temp.setf('grace', v_pat);
  o_g := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 92);
  e_g := pg_temp.mkent(v_org, v_pat, o_g, 'care_pack', -92, -2);
  o_x := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 98);
  e_x := pg_temp.mkent(v_org, v_pat, o_x, 'care_pack', -98, -8);
  o_m := pg_temp.mkorder(v_org, v_pat, pg_temp.f('mem'), pg_temp.f('mem_price'), 10000000, 366);
  e_m := pg_temp.mkent(v_org, v_pat, o_m, 'membership', -366, -1);
  o_a := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 10);
  e_a := pg_temp.mkent(v_org, v_pat, o_a, 'care_pack', -10, 80);
  o_r := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 91);
  e_r := pg_temp.mkent(v_org, v_pat, o_r, 'care_pack', -91, -1);
  update public.entitlements set state = 'revoked' where id = e_r;
  perform pg_temp.setf('e_g', e_g); perform pg_temp.setf('e_a', e_a);

  perform pg_temp.act(v_pat);
  j := public.my_entitlements();
  perform pg_temp.back();
  select x into row_g from jsonb_array_elements(j) x where (x ->> 'id')::uuid = e_g;
  select x into row_x from jsonb_array_elements(j) x where (x ->> 'id')::uuid = e_x;
  select x into row_m from jsonb_array_elements(j) x where (x ->> 'id')::uuid = e_m;
  select x into row_r from jsonb_array_elements(j) x where (x ->> 'id')::uuid = e_r;

  perform pg_temp.ck('grace: a pack that ended 2 days ago is in grace', 'grace', row_g ->> 'phase');
  perform pg_temp.ck('grace: with 5 days left and the code to renew', '5/s26b_pack', (row_g ->> 'grace_days_left') || '/' || (row_g ->> 'item_code'));
  perform pg_temp.ck('grace: its state is still expired', 'expired', row_g ->> 'state');
  perform pg_temp.ck('grace: 8 days after the end it is only expired', 'expired/', (row_x ->> 'phase') || '/' || coalesce(row_x ->> 'grace_days_left', ''));
  perform pg_temp.ck('grace: a Membership has no grace here (it has its own)', 'expired', row_m ->> 'phase');
  perform pg_temp.ck('grace: a revoked pack never gets grace', 'revoked', row_r ->> 'phase');
  perform pg_temp.ck('grace: an active pack is active', 'active',
    (select x ->> 'phase' from jsonb_array_elements(j) x where (x ->> 'id')::uuid = e_a));

  -- no doctor time in grace: the only consumption door refuses anything that is not active
  perform pg_temp.svc();
  r := public.consume_entitlement(e_g);
  perform pg_temp.ck('grace: consuming an ended pack is refused', 'not_active', r ->> 'result');
  perform pg_temp.ck('grace: nothing was used', '3', (select remaining_uses::text from public.entitlements where id = e_g));
  r := public.consume_entitlement(e_a);
  perform pg_temp.ck('grace: an active pack can still be used', 'consumed', r ->> 'result');
  perform pg_temp.svc_off();
  -- the window is the config's, not a constant: with 1 day of grace the pack that ended 2 days ago is plainly expired
  update public.entitlement_policy_config set rules = jsonb_set(rules, '{grace_days}', '1') where kind = 'lifecycle' and is_active;
  perform pg_temp.act(v_pat);
  j := public.my_entitlements();
  perform pg_temp.back();
  perform pg_temp.ck('grace: the window follows the config', 'expired',
    (select x ->> 'phase' from jsonb_array_elements(j) x where (x ->> 'id')::uuid = e_g));
  update public.entitlement_policy_config set rules = jsonb_set(rules, '{grace_days}', '7') where kind = 'lifecycle' and is_active;
end $$;

create function pg_temp.notif_for(p_refund uuid, p_template text) returns bigint language sql as
$$ select count(*) from public.notifications where template = p_template and payload ->> 'refund_id' = p_refund::text $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. The refund machine, end to end, with a failed provider call
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc');
  oa uuid; ea uuid; ob uuid; om_in uuid; om_out uuid; r jsonb; r1 uuid; r2 uuid; v_sched uuid; enc1 uuid; enc2 uuid; l1 uuid; l2 uuid;
  v_md5_l1 text; v_md5_l2 text; v_count bigint; v_sum bigint; v_calc jsonb; n_ev bigint; n_notif bigint; v_linked boolean;
begin
  oa := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 5);
  ea := pg_temp.mkent(v_org, v_pat, oa, 'care_pack', -5, 85);
  ob := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 20);
  om_in := pg_temp.mkorder(v_org, v_pat, pg_temp.f('mem'), pg_temp.f('mem_price'), 10000000, 18);
  om_out := pg_temp.mkorder(v_org, v_pat, pg_temp.f('mem'), pg_temp.f('mem_price'), 10000000, 25);
  perform pg_temp.setf('oa', oa); perform pg_temp.setf('ea', ea);

  -- the cooling-off window: 14 days for a pack, the Membership's own 21 for a Membership
  perform pg_temp.act(v_pat);
  r := public.request_order_refund(ob, 'Changed my mind about this');
  perform pg_temp.ck('refund: a pack paid 20 days ago is outside the 14 day window', 'outside_refund_window/14', (r ->> 'result') || '/' || (r ->> 'window_days'));
  r := public.request_order_refund(om_out, 'Changed my mind about this');
  perform pg_temp.ck('refund: a Membership paid 25 days ago is outside its 21 day window', 'outside_refund_window/21', (r ->> 'result') || '/' || (r ->> 'window_days'));
  r := public.request_order_refund(om_in, 'Changed my mind about this');
  perform pg_temp.ck('refund: a Membership paid 18 days ago is inside its window', 'requested', r ->> 'result');
  r := public.request_order_refund(oa, 'Changed my mind about this');
  perform pg_temp.back();
  perform pg_temp.ck('refund: a pack paid 5 days ago can be requested, and the answer time comes back', 'requested/3', (r ->> 'result') || '/' || (r ->> 'decision_sla_days'));
  r1 := (r ->> 'refund_id')::uuid;
  perform pg_temp.ck('refund: the first step and its message exist', 'requested/1', pg_temp.evs(r1) || '/' || pg_temp.notif_for(r1, 'order_refund_requested'));
  perform pg_temp.ck('refund: the request message carries the answer time', '3',
    (select payload ->> 'sla_days' from public.notifications where template = 'order_refund_requested' and payload ->> 'refund_id' = r1::text));
  perform pg_temp.ck('refund: asking twice is the same request', 'already_requested',
    pg_temp.q_as(v_pat, format($q$select (public.request_order_refund(%L, 'Changed my mind again'))->>'result'$q$, oa)));

  -- decline: a reason the patient can read, kept out of the notification
  perform pg_temp.act(v_admin);
  r := public.decide_order_refund(r1, false, null);
  perform pg_temp.ck('refund: declining with no reason is refused', 'reason_needed', r ->> 'result');
  r := public.decide_order_refund(r1, false, 'No');
  perform pg_temp.ck('refund: a one word reason is refused', 'reason_needed', r ->> 'result');
  r := public.decide_order_refund(r1, false, 'Outside the stated window');
  perform pg_temp.back();
  perform pg_temp.ck('refund: declining with a reason works', 'rejected', r ->> 'result');
  perform pg_temp.ck('refund: the patient can read the reason on the refund', 'Outside the stated window',
    pg_temp.q_as(v_pat, format($q$select decision_note from public.refunds where id = %L$q$, r1)));
  perform pg_temp.ck('refund: steps after a decline', 'requested,declined', pg_temp.evs(r1));
  perform pg_temp.ck('refund: the decline message goes out', '1', pg_temp.notif_for(r1, 'order_refund_declined')::text);
  perform pg_temp.ck('refund: ...and does NOT carry the reason (INV-07)', 'false',
    (select (bool_or(payload::text ilike '%Outside%'))::text from public.notifications where template = 'order_refund_declined' and payload ->> 'refund_id' = r1::text));
  perform pg_temp.ck('refund: a declined order is untouched', 'paid/active',
    (select state from public.orders where id = oa) || '/' || (select state from public.entitlements where id = ea));

  -- asking again after a decline is allowed (a declined refund is not live)
  perform pg_temp.act(v_pat);
  r := public.request_order_refund(oa, 'I would like to ask again please');
  perform pg_temp.back();
  perform pg_temp.ck('refund: a second request after a decline is accepted', 'requested', r ->> 'result');
  r2 := (r ->> 'refund_id')::uuid;
  perform pg_temp.setf('r2', r2);

  -- a consultation share already earned against this order (linked), and one that is not linked
  perform set_config('tarragon.fee_write', 'on', true);
  insert into public.fee_schedules (organisation_id, version, items)
  values (v_org, 901, '{"task_types":{},"on_call_shift_fee_kobo":0,"lead_fee_per_patient_month_kobo":0,"pilot_minimum_per_declared_hour_kobo":0,"consultation_share_pct":{"video":50,"audio":50,"phone":50}}'::jsonb)
  returning id into v_sched;
  perform set_config('tarragon.fee_write', 'off', true);
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, is_test)
  values (v_org, v_pat, v_doc, 'video', 'scheduled', now(), 1, true) returning id into enc1;
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, is_test)
  values (v_org, v_pat, v_doc, 'video', 'scheduled', now(), 1, true) returning id into enc2;
  l1 := private.ledger_insert(v_org, v_doc, 'consultation', 'encounter', enc1, 300000, v_sched, '{"basis":"test"}'::jsonb, now() - interval '2 days', true);
  l2 := private.ledger_insert(v_org, v_doc, 'consultation', 'encounter', enc2, 100000, v_sched, '{"basis":"test"}'::jsonb, now() - interval '2 days', true);
  perform pg_temp.ck('reversal: a patient cannot link an encounter to an order', '42501', pg_temp.try_as(v_pat, format($q$select public.link_order_encounter(%L, %L)$q$, oa, enc1)));
  perform pg_temp.svc();
  v_linked := public.link_order_encounter(oa, enc1);
  perform pg_temp.svc_off();
  perform pg_temp.ck('reversal: the service role links one encounter to the order', 'true', v_linked::text);
  select md5(to_jsonb(x)::text) into v_md5_l1 from public.earnings_ledger x where id = l1;
  select md5(to_jsonb(x)::text) into v_md5_l2 from public.earnings_ledger x where id = l2;
  perform pg_temp.setf('l1', l1); perform pg_temp.setf('l2', l2); perform pg_temp.setf('enc1', enc1); perform pg_temp.setf('sched', v_sched);

  -- approve
  perform pg_temp.act(v_admin);
  r := public.decide_order_refund(r2, true, 'Approved');
  perform pg_temp.back();
  perform pg_temp.ck('refund: approval revokes the entitlement and refunds the order', 'approved/revoked/refunded',
    (r ->> 'result') || '/' || (select state from public.entitlements where id = ea) || '/' || (select state from public.orders where id = oa));
  perform pg_temp.ck('refund: steps after approval', 'requested,approved', pg_temp.evs(r2));
  perform pg_temp.ck('refund: the approval message says how long the bank takes', '5 to 10',
    (select payload ->> 'bank_days' from public.notifications where template = 'order_refund_approved' and payload ->> 'refund_id' = r2::text));
  perform pg_temp.ck('refund: approved cannot jump to completed (the S26 bug)', 'P0001',
    pg_temp.try_sql(format($q$update public.refunds set state = 'completed' where id = %L$q$, r2)));

  -- claim before send
  perform pg_temp.svc();
  r := public.claim_refund_for_provider(r2);
  perform pg_temp.ck('refund: the first claim wins', 'claimed/tho_s26b_' || replace(oa::text, '-', ''), (r ->> 'result') || '/' || (r ->> 'charge_reference'));
  perform pg_temp.ck('refund: the second claim is refused', 'not_claimable', public.claim_refund_for_provider(r2) ->> 'result');
  perform pg_temp.svc_off();
  perform pg_temp.ck('refund: claimed means processing with one attempt', 'processing/1', (select state || '/' || attempts from public.refunds where id = r2));

  -- the provider call fails
  perform pg_temp.svc();
  r := public.record_refund_provider_result(r2, false, '', '{"error":"boom","error_code":"provider_error"}'::jsonb);
  perform pg_temp.ck('refund: a failed provider call lands in failed', 'failed', r ->> 'result');
  perform pg_temp.ck('refund: a replayed result on a failed refund changes nothing', 'replay',
    public.record_refund_provider_result(r2, true, 'X', '{}'::jsonb) ->> 'result');
  perform pg_temp.svc_off();
  perform pg_temp.ck('refund: failed has a short code and no reversal has run', 'failed/provider_error/true/true',
    (select state || '/' || last_error_code || '/' || (gl_released_at is null)::text || '/' || (earnings_reversed_at is null)::text from public.refunds where id = r2));
  perform pg_temp.ck('refund: the patient is told it is taking longer', '1', pg_temp.notif_for(r2, 'order_refund_problem')::text);
  perform pg_temp.ck('refund: the clinician share is NOT reversed for money that has not moved', '0',
    (select count(*) from public.earnings_ledger where kind = 'adjustment' and calculation ->> 'corrects' = l1::text)::text);

  -- an admin sends it back; a patient cannot
  perform pg_temp.ck('refund: a patient cannot retry', '42501', pg_temp.try_as(v_pat, format($q$select public.retry_failed_refund(%L)$q$, r2)));
  perform pg_temp.act(v_admin);
  r := public.retry_failed_refund(r2);
  perform pg_temp.back();
  perform pg_temp.ck('refund: the admin retry puts it back in the queue', 'requeued/approved', (r ->> 'result') || '/' || (select state from public.refunds where id = r2));
  perform pg_temp.svc();
  r := public.claim_refund_for_provider(r2);
  perform pg_temp.svc_off();
  perform pg_temp.ck('refund: the second attempt is counted', 'claimed/2', (r ->> 'result') || '/' || (select attempts from public.refunds where id = r2));

  -- success
  perform pg_temp.svc();
  r := public.record_refund_provider_result(r2, true, 'PSK-REFUND-1', '{"status":"pending"}'::jsonb);
  perform pg_temp.svc_off();
  perform pg_temp.ck('refund: success completes it', 'completed', r ->> 'result');
  perform pg_temp.ck('refund: with the provider reference and a completion time', 'PSK-REFUND-1/true',
    (select provider_reference || '/' || (completed_at is not null)::text from public.refunds where id = r2));
  perform pg_temp.ck('refund: every step is on the timeline, in order', 'requested,approved,sending,problem,retrying,sending,completed', pg_temp.evs(r2));
  perform pg_temp.ck('refund: the sent message names the amount in naira', 'NGN 5,000.00',
    (select payload ->> 'amount' from public.notifications where template = 'order_refund_completed' and payload ->> 'refund_id' = r2::text));
  select count(*) into n_ev from public.refund_status_events where refund_id = r2;
  select count(*) into n_notif from public.notifications where template = 'order_refund_completed' and payload ->> 'refund_id' = r2::text;
  perform pg_temp.svc();
  r := public.record_refund_provider_result(r2, true, 'PSK-REFUND-1', '{}'::jsonb);
  perform pg_temp.svc_off();
  perform pg_temp.ck('refund: recording success twice changes nothing', 'replay/true',
    (r ->> 'result') || '/' || ((select count(*) from public.refund_status_events where refund_id = r2) = n_ev
      and (select count(*) from public.notifications where template = 'order_refund_completed' and payload ->> 'refund_id' = r2::text) = n_notif)::text);
  perform pg_temp.act(v_admin);
  perform pg_temp.ck('refund: a completed refund cannot be retried', 'not_failed', public.retry_failed_refund(r2) ->> 'result');
  perform pg_temp.back();

  -- reversal: one negative line, the old lines untouched, the unlinked share untouched
  select count(*), coalesce(sum(amount_kobo), 0) into v_count, v_sum from public.earnings_ledger where kind = 'adjustment' and calculation ->> 'corrects' = l1::text;
  perform pg_temp.ck('reversal: exactly one adjustment for the linked consultation share', '1/-300000', v_count || '/' || v_sum);
  select calculation into v_calc from public.earnings_ledger where kind = 'adjustment' and calculation ->> 'corrects' = l1::text;
  perform pg_temp.ck('reversal: it records the refund, the order and the amount', 'true/true/300000',
    ((v_calc ->> 'refund_id') = r2::text)::text || '/' || ((v_calc ->> 'order_id') = oa::text)::text || '/' || (v_calc ->> 'reversal_kobo'));
  perform pg_temp.ck('reversal: the original consultation line is byte for byte unchanged', 'true',
    (md5((select to_jsonb(x)::text from public.earnings_ledger x where id = l1)) = v_md5_l1)::text);
  perform pg_temp.ck('reversal: the unlinked consultation share is untouched', '0/true',
    (select count(*) from public.earnings_ledger where kind = 'adjustment' and calculation ->> 'corrects' = l2::text)::text || '/' ||
    (md5((select to_jsonb(x)::text from public.earnings_ledger x where id = l2)) = v_md5_l2)::text);
  perform pg_temp.ck('reversal: inside the rescan window the stamp stays empty, so a late share is still caught', 'true', (select (earnings_reversed_at is null)::text from public.refunds where id = r2));

  -- idempotence: force the hook to run again and again
  update public.refunds set earnings_reversed_at = null, gl_released_at = null where id = r2;
  perform private.complete_refund_side_effects(r2);
  perform private.complete_refund_side_effects(r2);
  perform pg_temp.svc();
  perform public.service_run_refund_catch_up();
  perform pg_temp.svc_off();
  perform pg_temp.ck('reversal: running the hook three more times posts nothing more', '1',
    (select count(*) from public.earnings_ledger where kind = 'adjustment' and calculation ->> 'corrects' = l1::text)::text);
  perform pg_temp.ck('reversal: an adjustment line cannot be changed', '23514',
    pg_temp.try_sql(format($q$update public.earnings_ledger set amount_kobo = 0 where kind = 'adjustment' and calculation ->> 'corrects' = %L$q$, l1::text)));
  perform pg_temp.ck('reversal: nor deleted', '23514',
    pg_temp.try_sql(format($q$delete from public.earnings_ledger where kind = 'adjustment' and calculation ->> 'corrects' = %L$q$, l1::text)));
  perform pg_temp.ck('reversal: nor the line it corrects', '23514', pg_temp.try_sql(format($q$update public.earnings_ledger set amount_kobo = 1 where id = %L$q$, l1)));

  -- a share linked AFTER the refund completed (the doctor finishes the visit later) is reversed at once
  declare
    enc3 uuid; enc4 uuid; l3 uuid; l4 uuid;
  begin
    insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, is_test)
    values (v_org, v_pat, v_doc, 'video', 'scheduled', now(), 1, true) returning id into enc3;
    l3 := private.ledger_insert(v_org, v_doc, 'consultation', 'encounter', enc3, 100000, v_sched, '{}'::jsonb, now(), true);
    perform pg_temp.svc();
    perform public.link_order_encounter(oa, enc3);
    perform pg_temp.svc_off();
    perform pg_temp.ck('reversal: a share linked after the refund completed is reversed at once', '-100000',
      coalesce((select amount_kobo::text from public.earnings_ledger where kind = 'adjustment' and calculation ->> 'corrects' = l3::text), 'none'));
    -- linked first, the consultation line posted later: the catch-up finds it
    insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, is_test)
    values (v_org, v_pat, v_doc, 'video', 'scheduled', now(), 1, true) returning id into enc4;
    insert into public.order_encounter_links (encounter_id, order_id) values (enc4, oa);
    l4 := private.ledger_insert(v_org, v_doc, 'consultation', 'encounter', enc4, 80000, v_sched, '{}'::jsonb, now(), true);
    perform pg_temp.svc();
    perform public.service_run_refund_catch_up();
    perform pg_temp.svc_off();
    perform pg_temp.ck('reversal: a share posted after the refund completed is caught by the catch-up', '-80000',
      coalesce((select amount_kobo::text from public.earnings_ledger where kind = 'adjustment' and calculation ->> 'corrects' = l4::text), 'none'));
    -- once the rescan window has passed the stamp is set and the scan stops
    update public.refunds set completed_at = now() - interval '61 days' where id = r2;
    perform private.complete_refund_side_effects(r2);
    perform pg_temp.ck('reversal: after the rescan window the stamp is set', 'true', (select (earnings_reversed_at is not null)::text from public.refunds where id = r2));
  end;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. A part refund is pro rata and capped; the unrecognised deferred revenue is released once
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_doc uuid := pg_temp.f('doc'); v_pat uuid := pg_temp.mkuser(pg_temp.f('org'), 'gl', 'patient');
  o uuid; e uuid; enc uuid; l uuid; rf uuid; v_sched uuid := pg_temp.f('sched'); v_entry uuid; v_entry2 uuid; v_d numeric; v_c numeric; v_n bigint; ok_inc bigint;
  o_imm uuid; rf_imm uuid; sch public.revenue_recognition_schedules%rowtype;
begin
  -- pro rata: a 500,000 order, a 250,000 refund, a 300,001 share => floor(300001 * 250000 / 500000) = 150000
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 3);
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, is_test)
  values (v_org, v_pat, v_doc, 'video', 'scheduled', now(), 1, true) returning id into enc;
  l := private.ledger_insert(v_org, v_doc, 'consultation', 'encounter', enc, 300001, v_sched, '{}'::jsonb, now(), true);
  insert into public.order_encounter_links (encounter_id, order_id) values (enc, o);
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test) values (v_org, o, 250000, 'Part refund for the proof', v_pat, true) returning id into rf;
  update public.refunds set state = 'approved', decided_by = v_admin, decided_at = now() where id = rf;
  update public.refunds set state = 'processing' where id = rf;
  update public.refunds set state = 'completed', completed_at = now() where id = rf;
  perform private.complete_refund_side_effects(rf);
  perform pg_temp.ck('reversal: a part refund reverses the share pro rata, rounded down', '-150000',
    (select amount_kobo::text from public.earnings_ledger where kind = 'adjustment' and calculation ->> 'corrects' = l::text));

  -- the GL: a deferred order that was posted, part recognised, schedule cancelled by the refund
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 3);
  v_entry := private.post_order_to_ledger(o, true);
  perform pg_temp.ck('gl: the order was posted with a recognition schedule', 'true/true', (v_entry is not null)::text || '/' ||
    exists (select 1 from public.revenue_recognition_schedules where source_kind = 'order' and source_id = o)::text);
  update public.revenue_recognition_schedules set recognized_minor = 200000 where source_kind = 'order' and source_id = o;
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test) values (v_org, o, 500000, 'Full refund for the GL proof', v_pat, true) returning id into rf;
  update public.refunds set state = 'approved', decided_by = v_admin, decided_at = now() where id = rf;
  update public.orders set state = 'refunded' where id = o;   -- the S25b trigger cancels the schedule
  update public.refunds set state = 'processing' where id = rf;
  update public.refunds set state = 'completed', completed_at = now() where id = rf;
  perform private.complete_refund_side_effects(rf);
  select e.id into v_entry from public.finance_journal_entries e where e.source = 'adjustment' and e.source_ref = 'refund_deferred_release:' || rf;
  perform pg_temp.ck('gl: the unrecognised 300,000 is released from deferred revenue', 'true/300000/300000',
    (v_entry is not null)::text || '/' ||
    coalesce((select sum(debit_minor)::text from public.finance_journal_lines where entry_id = v_entry and account_code = '2000'), 'none') || '/' ||
    coalesce((select sum(credit_minor)::text from public.finance_journal_lines where entry_id = v_entry and account_code = '4900'), 'none'));
  perform pg_temp.ck('gl: the entry balances', 'true', (select (sum(debit_minor) = sum(credit_minor))::text from public.finance_journal_lines where entry_id = v_entry));
  perform pg_temp.ck('gl: the refund remembers it was released', 'true', (select (gl_released_at is not null)::text from public.refunds where id = rf));
  update public.refunds set gl_released_at = null where id = rf;
  perform private.complete_refund_side_effects(rf);
  perform pg_temp.ck('gl: running it again posts no second entry', '1',
    (select count(*) from public.finance_journal_entries where source = 'adjustment' and source_ref = 'refund_deferred_release:' || rf)::text);

  -- a point-of-sale order has no schedule, so nothing deferred is released, and the refund is still marked done
  o_imm := pg_temp.mkorder(v_org, v_pat, pg_temp.f('one'), pg_temp.f('one_price'), 500000, 2);
  perform private.post_order_to_ledger(o_imm, true);
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test) values (v_org, o_imm, 500000, 'Immediate order refund proof', v_pat, true) returning id into rf_imm;
  update public.refunds set state = 'approved', decided_by = v_admin, decided_at = now() where id = rf_imm;
  update public.refunds set state = 'processing' where id = rf_imm;
  update public.refunds set state = 'completed', completed_at = now() where id = rf_imm;
  perform private.complete_refund_side_effects(rf_imm);
  perform pg_temp.ck('gl: a point-of-sale order releases nothing and is still marked done', '0/true',
    (select count(*) from public.finance_journal_entries where source_ref = 'refund_deferred_release:' || rf_imm)::text || '/' ||
    (select (gl_released_at is not null)::text from public.refunds where id = rf_imm));

  -- a closed accounting period must not lose the release silently: an incident is raised, the stamp stays empty, the catch-up fixes it
  update public.refunds set gl_released_at = null where id = rf;
  delete from public.finance_journal_entries where source = 'adjustment' and source_ref = 'refund_deferred_release:' || rf;
  update public.finance_periods set status = 'closed' where period_month = date_trunc('month', (now() at time zone 'Africa/Lagos')::date)::date;
  perform private.complete_refund_side_effects(rf);
  perform pg_temp.ck('gl: a closed period raises an incident and leaves the stamp empty', '1/true',
    (select count(*) from public.ops_incidents where external_reference = 'refund-gl:' || rf and status not in ('resolved', 'closed'))::text || '/' ||
    (select (gl_released_at is null)::text from public.refunds where id = rf));
  update public.finance_periods set status = 'open' where period_month = date_trunc('month', (now() at time zone 'Africa/Lagos')::date)::date;
  perform pg_temp.svc();
  perform public.service_run_refund_catch_up();
  perform pg_temp.svc_off();
  perform pg_temp.ck('gl: once the period is open the catch-up releases it', 'true/1',
    (select (gl_released_at is not null)::text from public.refunds where id = rf) || '/' ||
    (select count(*) from public.finance_journal_entries where source = 'adjustment' and source_ref = 'refund_deferred_release:' || rf)::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. Reconciliation, delays, access
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.mkdone(p_org uuid, p_admin uuid, p_buyer uuid, p_order uuid, p_amount bigint, p_state text) returns uuid
language plpgsql as $f$
declare rf uuid;
begin
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test)
  values (p_org, p_order, p_amount, 'Proof refund fixture', p_buyer, false) returning id into rf;
  update public.refunds set state = 'approved', decided_by = p_admin, decided_at = now() where id = rf;
  if p_state in ('processing', 'completed', 'failed') then
    update public.refunds set state = 'processing', processing_started_at = now(), attempts = 1 where id = rf;
  end if;
  if p_state = 'completed' then update public.refunds set state = 'completed', completed_at = now(), provider_reference = 'PSK-' || rf where id = rf; end if;
  if p_state = 'failed' then update public.refunds set state = 'failed', last_error_code = 'provider_error' where id = rf; end if;
  return rf;
end $f$;

do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_pat uuid := pg_temp.mkuser(pg_temp.f('org'), 'rec', 'patient'); v_other uuid := pg_temp.f('pat2');
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; o7 uuid; rf1 uuid; rf2 uuid; rf3 uuid; rf4 uuid; rf5 uuid; rf6 uuid; rf7 uuid; v text; n bigint; j jsonb; r jsonb;
begin
  -- the verdict table (pure)
  perform pg_temp.ck('verdict: completed here, processed there, same amount', 'matched', private.refund_reconcile_verdict('completed', 'processed', 100, 100));
  perform pg_temp.ck('verdict: completed here, still pending there is fine', 'matched', private.refund_reconcile_verdict('completed', 'pending', 100, 100));
  perform pg_temp.ck('verdict: a different amount is a mismatch', 'mismatch', private.refund_reconcile_verdict('completed', 'processed', 100, 90));
  perform pg_temp.ck('verdict: completed here, nothing there', 'not_found', private.refund_reconcile_verdict('completed', 'not_found', 100, null));
  perform pg_temp.ck('verdict: failed here, nothing there is right', 'matched', private.refund_reconcile_verdict('failed', 'not_found', 100, null));
  perform pg_temp.ck('verdict: failed here but processed there is a mismatch', 'mismatch', private.refund_reconcile_verdict('failed', 'processed', 100, 100));
  perform pg_temp.ck('verdict: failed here and failed there is consistent', 'matched', private.refund_reconcile_verdict('failed', 'failed', 100, 100));
  perform pg_temp.ck('verdict: processing here, failed there is a mismatch', 'mismatch', private.refund_reconcile_verdict('processing', 'failed', 100, 100));

  o1 := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 3, false);
  o2 := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 3, false);
  o3 := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 3, false);
  o4 := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 3, false);
  o5 := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 3, false);
  rf1 := pg_temp.mkdone(v_org, v_admin, v_pat, o1, 500000, 'completed');
  rf2 := pg_temp.mkdone(v_org, v_admin, v_pat, o2, 500000, 'completed');
  rf3 := pg_temp.mkdone(v_org, v_admin, v_pat, o3, 500000, 'failed');
  perform pg_temp.setf('rf1', rf1); perform pg_temp.setf('rf2', rf2); perform pg_temp.setf('rf3', rf3);

  perform pg_temp.svc();
  select count(*) into n from public.refunds_needing_reconcile(100) x where x.id in (rf1, rf2, rf3);
  perform pg_temp.ck('reconcile: the unchecked non-test refunds are listed', '3', n::text);
  perform pg_temp.ck('reconcile: a test refund is never listed', '0', (select count(*) from public.refunds_needing_reconcile(500) x where x.id = pg_temp.f('r2'))::text);
  perform pg_temp.ck('reconcile: the listing carries the charge reference to ask Paystack about', 'tho_s26b_' || replace(o1::text, '-', ''),
    (select x.charge_reference from public.refunds_needing_reconcile(100) x where x.id = rf1));

  v := public.record_refund_reconcile(rf1, 'processed', 500000);
  perform pg_temp.ck('reconcile: a matching refund is matched', 'matched/matched/0', v || '/' || (select provider_status from public.refunds where id = rf1) ||
    '/' || (select count(*) from public.ops_incidents where external_reference = 'refund-mismatch:' || rf1)::text);
  perform pg_temp.ck('reconcile: and is not asked about again', '0', (select count(*) from public.refunds_needing_reconcile(100) x where x.id = rf1)::text);

  v := public.record_refund_reconcile(rf2, 'processed', 400000);
  perform pg_temp.ck('reconcile: a different amount is a mismatch with one incident', 'mismatch/1', v || '/' || (select count(*) from public.ops_incidents
    where external_reference = 'refund-mismatch:' || rf2 and status not in ('resolved', 'closed'))::text);
  v := public.record_refund_reconcile(rf2, 'processed', 400000);
  perform pg_temp.ck('reconcile: asking again does not add a second open incident', '1', (select count(*) from public.ops_incidents
    where external_reference = 'refund-mismatch:' || rf2 and status not in ('resolved', 'closed'))::text);
  perform pg_temp.ck('reconcile: a mismatch is asked about again next week', '1', (select count(*) from public.refunds_needing_reconcile(100) x where x.id = rf2)::text);

  v := public.record_refund_reconcile(rf3, 'processed', 500000);
  perform pg_temp.ck('reconcile: a refund we think failed but Paystack paid is a mismatch', 'mismatch', v);
  perform pg_temp.svc_off();
  perform pg_temp.act(v_admin);
  r := public.retry_failed_refund(rf3);
  perform pg_temp.back();
  perform pg_temp.ck('reconcile: ...and it cannot be retried until a person looks (no double refund)', 'provider_mismatch', r ->> 'result');

  -- delays
  rf4 := pg_temp.mkdone(v_org, v_admin, v_pat, o4, 500000, 'processing');
  update public.refunds set processing_started_at = now() - interval '3 hours' where id = rf4;
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test, created_at)
  values (v_org, o5, 500000, 'Waiting too long for an answer', v_pat, false, now() - interval '4 days') returning id into rf5;
  perform pg_temp.svc();
  n := public.service_flag_refund_delays();
  perform pg_temp.svc_off();
  perform pg_temp.ck('delays: a refund stuck mid-send for 3 hours is flagged', '1', (select count(*) from public.ops_incidents where external_reference = 'refund-delay:' || rf4)::text);
  perform pg_temp.ck('delays: a request unanswered past the 3 day answer time is flagged', '1', (select count(*) from public.ops_incidents where external_reference = 'refund-delay:' || rf5)::text);
  perform pg_temp.ck('delays: a fresh completed refund is not', '0', (select count(*) from public.ops_incidents where external_reference = 'refund-delay:' || rf1)::text);

  -- the admin's list of what to act on, and settling a refund stuck mid-send
  o6 := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 3, false);
  o7 := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 3, false);
  rf6 := pg_temp.mkdone(v_org, v_admin, v_pat, o6, 500000, 'processing');
  update public.refunds set processing_started_at = now() - interval '3 hours' where id = rf6;
  rf7 := pg_temp.mkdone(v_org, v_admin, v_pat, o7, 500000, 'processing');
  perform pg_temp.act(v_admin);
  j := public.admin_refund_ops();
  perform pg_temp.back();
  perform pg_temp.ck('ops: the failed refund is listed with its error code', 'true', (select (x ->> 'last_error_code' = 'provider_error')::text from jsonb_array_elements(j -> 'failed') x where (x ->> 'id')::uuid = rf3));
  perform pg_temp.ck('ops: only the refund stuck past the window is listed as stuck', 'true/false',
    exists (select 1 from jsonb_array_elements(j -> 'stuck') x where (x ->> 'id')::uuid = rf6)::text || '/' ||
    exists (select 1 from jsonb_array_elements(j -> 'stuck') x where (x ->> 'id')::uuid = rf7)::text);
  perform pg_temp.ck('ops: a patient cannot read the list', '42501', pg_temp.try_as(v_pat, 'select public.admin_refund_ops()'));
  perform pg_temp.ck('ops: a patient cannot settle a refund', '42501', pg_temp.try_as(v_pat, format($q$select public.admin_settle_processing_refund(%L, true)$q$, rf6)));
  perform pg_temp.act(v_admin);
  r := public.admin_settle_processing_refund(rf7, true, 'X');
  v := r ->> 'result';
  j := public.admin_settle_processing_refund(rf6, false);
  r := public.admin_settle_processing_refund(rf4, true, 'PSK-HAND-1');
  perform pg_temp.back();
  -- (the operational columns are read here as the owner: a signed-in person cannot read them, which is the point)
  perform pg_temp.ck('ops: a refund still inside the window cannot be settled yet', 'too_soon', v);
  perform pg_temp.ck('ops: Paystack did not send it: the refund fails and can be retried', 'failed/failed/settled_not_sent',
    (j ->> 'result') || '/' || (select state from public.refunds where id = rf6) || '/' || (select last_error_code from public.refunds where id = rf6));
  perform pg_temp.ck('ops: Paystack sent it: the refund completes with the reference', 'completed/completed/PSK-HAND-1',
    (r ->> 'result') || '/' || (select state from public.refunds where id = rf4) || '/' || (select provider_reference from public.refunds where id = rf4));
  perform pg_temp.ck('ops: and finance is reminded to post the cash entry', '1', (select count(*) from public.ops_incidents where external_reference = 'refund-cash-post:' || rf4)::text);
  perform pg_temp.act(v_admin);
  perform pg_temp.ck('ops: a settled refund cannot be settled again', 'not_processing', public.admin_settle_processing_refund(rf4, true) ->> 'result');
  perform pg_temp.back();

  -- cash posting failure raised by the sweep
  perform pg_temp.svc();
  perform public.service_refund_incident(rf1, 'period closed');
  perform pg_temp.svc_off();
  perform pg_temp.ck('incident: a failed cash posting is raised, not dropped', '1', (select count(*) from public.ops_incidents where external_reference = 'refund-cash-post:' || rf1)::text);

  -- access
  perform pg_temp.ck('access: a signed-in patient cannot claim a refund', '42501', pg_temp.try_as(v_pat, format($q$select public.claim_refund_for_provider(%L)$q$, rf4)));
  perform pg_temp.ck('access: nor record a result', '42501', pg_temp.try_as(v_pat, format($q$select public.record_refund_provider_result(%L, true, 'x', '{}'::jsonb)$q$, rf4)));
  perform pg_temp.ck('access: nor list refunds to reconcile', '42501', pg_temp.try_as(v_pat, 'select * from public.refunds_needing_reconcile(10)'));
  perform pg_temp.ck('access: nor record a reconcile verdict', '42501', pg_temp.try_as(v_pat, format($q$select public.record_refund_reconcile(%L, 'processed', 1)$q$, rf4)));
  perform pg_temp.ck('access: nor flag delays or run the catch-up', '42501/42501', pg_temp.try_as(v_pat, 'select public.service_flag_refund_delays()') || '/' ||
    pg_temp.try_as(v_pat, 'select public.service_run_refund_catch_up()'));
  perform pg_temp.ck('access: a patient cannot read the provider response column', '42501', pg_temp.try_as(v_pat, 'select provider_response from public.refunds limit 1'));
  perform pg_temp.ck('access: nor the retry counters, the error code, or the reconcile verdict', '42501/42501/42501',
    pg_temp.try_as(v_pat, 'select last_error_code from public.refunds limit 1') || '/' || pg_temp.try_as(v_pat, 'select attempts from public.refunds limit 1') || '/' ||
    pg_temp.try_as(v_pat, 'select provider_status from public.refunds limit 1'));
  perform pg_temp.ck('access: select * on refunds is refused for a patient', '42501', pg_temp.try_as(v_pat, 'select * from public.refunds limit 1'));
  perform pg_temp.ck('access: the columns the refund screen needs are readable', 'ok', pg_temp.try_as(v_pat, 'select id, state, decision_note, amount_kobo, completed_at from public.refunds limit 1'));
  perform pg_temp.ck('access: a patient cannot write the timeline', '42501', pg_temp.try_as(v_pat, format($q$insert into public.refund_status_events (refund_id, organisation_id, step) values (%L, %L, 'completed')$q$, rf4, v_org)));
  perform pg_temp.ck('access: a patient reads the timeline of their own refund', 'true', (pg_temp.q_as(v_pat, format($q$select (count(*) > 0)::text from public.refund_status_events where refund_id = %L$q$, rf4))));
  perform pg_temp.ck('access: another patient sees none of it', '0', pg_temp.q_as(v_other, format($q$select count(*)::text from public.refund_status_events where refund_id = %L$q$, rf4)));
  perform pg_temp.ck('access: the admin of the organisation sees it', 'true', pg_temp.q_as(v_admin, format($q$select (count(*) > 0)::text from public.refund_status_events where refund_id = %L$q$, rf4)));
  perform pg_temp.ck('access: a patient cannot read the reminder step table directly', '42501', pg_temp.try_as(v_pat, 'select * from public.entitlement_reminder_steps'));
  perform pg_temp.ck('access: nor the encounter links', '42501', pg_temp.try_as(v_pat, 'select * from public.order_encounter_links'));
  perform pg_temp.ck('access: anon holds no service function', 'false/false/false/false',
    has_function_privilege('anon', 'public.claim_refund_for_provider(uuid)', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.record_refund_reconcile(uuid, text, bigint)', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.service_run_refund_catch_up()', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.retry_failed_refund(uuid)', 'EXECUTE')::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. SABOTAGE: each safeguard removed in turn; the check that guards it must flip
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_admin uuid := pg_temp.f('admin'); e1 uuid := pg_temp.f('e1');
  before_n bigint; after_n bigint; v text; o uuid; rf uuid; before_inc bigint;
begin
  -- (a) reminders: with the step rows gone the same step is sent again (so the real check watches the rows, not nothing)
  before_n := pg_temp.notifs(v_pat, 'entitlement_expiring_soon');
  delete from public.entitlement_reminder_steps where entitlement_id = e1;
  perform private.queue_entitlement_expiry_reminders();
  after_n := pg_temp.notifs(v_pat, 'entitlement_expiring_soon');
  insert into results values ('sabotaged', 'reminders: a step is never sent twice', 'no new message',
    case when after_n > before_n then 'a duplicate message' else 'no new message' end);

  -- (b) reconcile: a verdict function that always says matched hides a mismatch
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 3, false);
  rf := pg_temp.mkdone(v_org, v_admin, v_pat, o, 500000, 'completed');
  create or replace function private.refund_reconcile_verdict(p_state text, p_provider_status text, p_ours bigint, p_theirs bigint) returns text
  language sql immutable set search_path = '' as $f$ select 'matched'::text $f$;
  perform pg_temp.svc();
  select count(*) into before_inc from public.ops_incidents where external_reference = 'refund-mismatch:' || rf;
  v := public.record_refund_reconcile(rf, 'processed', 1);
  perform pg_temp.svc_off();
  insert into results values ('sabotaged', 'reconcile: a mismatch raises an incident', 'one incident',
    case when (select count(*) from public.ops_incidents where external_reference = 'refund-mismatch:' || rf) > before_inc then 'one incident' else 'no incident' end);

  -- (d) the column grant: with the table-wide SELECT back, a patient can read the provider's raw response
  grant select on public.refunds to authenticated;
  insert into results values ('sabotaged', 'access: a patient cannot read the provider response', 'refused',
    case when pg_temp.try_as(v_pat, 'select provider_response from public.refunds limit 1') = 'ok' then 'readable' else 'refused' end);

  -- (c) the state machine: with the trigger function emptied, approved -> completed goes through (the S26 bug)
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('pack'), pg_temp.f('pack_price'), 500000, 3, false);
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test) values (v_org, o, 500000, 'Sabotage fixture refund', v_pat, true) returning id into rf;
  update public.refunds set state = 'approved', decided_by = v_admin, decided_at = now() where id = rf;
  create or replace function private.refunds_state_machine() returns trigger language plpgsql set search_path = '' as $f$ begin return new; end $f$;
  insert into results values ('sabotaged', 'refund: approved cannot jump to completed', 'refused',
    case when pg_temp.try_sql(format($q$update public.refunds set state = 'completed' where id = %L$q$, rf)) = 'ok' then 'allowed' else 'refused' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S26b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
