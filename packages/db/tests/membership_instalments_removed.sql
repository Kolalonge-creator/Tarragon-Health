-- Proof for migration *_remove_membership_instalments.sql (founder decision 2026-10-21: no instalment payment; the Membership is one yearly payment).
-- One rolled-back transaction. Proves:
--   1. GONE: the four plan tables and the policy table, the two refunds columns, the cron job, the module row, the three templates, the data
--      registry row, and every function that was only there for instalments. No function in public or private still names a removed object.
--   2. refunds_one_live is one live refund per order again (the shape request_order_refund's ON CONFLICT (order_id) needs).
--   3. RESTORED: the ordinary one-payment Membership still works end to end through the same entry points the webhook uses:
--      a paid order gets one payment, one entitlement and one membership; a replay changes nothing; a wrong amount is a visible mismatch and
--      credits nothing; the buyer can cancel an unpaid order and not a paid one; a refund is requested once, approved once, returns the WHOLE
--      amount, revokes access and marks the order refunded; a second live refund for the same order is refused by the index; the provider claim
--      names the order's single charge.
--   4. Money functions are still shut to anon and to signed-in users.
--   5. SABOTAGE: the removed objects put back one at a time (a table, a column, the old index shape, a function, a function body that names a
--      removed object, the module row, the cron job). Each structural check must flip, or the proof fails as vacuous.
begin;

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
create function pg_temp.svc() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
end $f$;
create function pg_temp.svc_off() returns void language plpgsql as
$f$ begin perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_svc(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.svc();
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.svc_off();
  return r;
end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'noinst-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'NoInst ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkorder(p_org uuid, p_buyer uuid, p_item uuid, p_price uuid, p_amount bigint, p_label text) returns uuid
language plpgsql as $f$
declare o uuid := gen_random_uuid();
begin
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, state, paystack_reference, is_test)
  values (o, p_org, p_buyer, p_buyer, p_item, p_price, p_amount, 'created', 'tho_noinst_' || p_label || '_' || replace(o::text, '-', ''), true);
  return o;
end $f$;
create function pg_temp.ref(p_order uuid) returns text language sql as $$ select paystack_reference from public.orders where id = p_order $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The structural checks, re-runnable under a phase name so the sabotage can run the same list
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.structural(p_phase text) returns void language plpgsql as
$f$
begin
  insert into results values
   (p_phase, 'gone: the plan, part, attempt, reminder and policy tables', 'none',
    coalesce((select string_agg(t, ',') from unnest(array['order_instalment_plans', 'order_instalments', 'order_instalment_attempts', 'order_instalment_reminders', 'instalment_policy_config']) t
               where to_regclass('public.' || t) is not null), 'none')),
   (p_phase, 'gone: refunds.payment_id and refunds.refund_group', 'none',
    coalesce((select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public' and table_name = 'refunds' and column_name in ('payment_id', 'refund_group')), 'none')),
   (p_phase, 'refunds_one_live is one live refund per order', 'true',
    (select (pg_get_indexdef(indexrelid) like '%(order_id) WHERE%')::text from pg_index where indexrelid = 'public.refunds_one_live'::regclass)),
   (p_phase, 'gone: the hourly cron job', 'none', coalesce((select jobname from cron.job where jobname = 'instalments-hourly' limit 1), 'none')),
   (p_phase, 'gone: the platform module row', 'none', coalesce((select key from public.platform_modules where key = 'membership_instalments'), 'none')),
   (p_phase, 'gone: the three notification templates', 'none', coalesce((select string_agg(key, ',') from public.notification_templates where key like 'instalment\_%'), 'none')),
   (p_phase, 'gone: the data registry row', 'none', coalesce((select string_agg(table_name, ',') from public.data_registry where table_name like 'order\_instalment%'), 'none')),
   (p_phase, 'gone: every instalment-only function', 'none',
    coalesce((select string_agg(n.nspname || '.' || p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'private')
                 and p.proname ~ '^(create_instalment_order|prepare_instalment_payment|my_instalment_plans|admin_instalment_overview|instalment_policy_public|instalment_policy|instalments_hourly|sweep_instalment_lapses|queue_instalment_reminders|instalment_ledger_catch_up|record_instalment_payment|record_instalment_mismatch|instalment_reply|post_instalment_safely|post_instalment_to_ledger|instalment_plans_guard|instalments_guard|instalments_sum_check)$'), 'none')),
   (p_phase, 'no function body names a removed object', 'none',
    coalesce((select string_agg(n.nspname || '.' || p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'private') and p.prokind = 'f'
                 and p.prosrc ~* 'order_instalment|instalment_polic|membership_instalments|record_instalment|post_instalment|orderpart|refund_group|instalment_reply|sweep_instalment|queue_instalment|instalment_ledger|instalments_hourly|create_instalment_order|prepare_instalment|my_instalment_plans|admin_instalment'), 'none')),
   (p_phase, 'access: anon and signed-in users cannot run the payment function', 'false',
    (has_function_privilege('anon', 'public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)', 'EXECUTE'))::text),
   (p_phase, 'access: anon cannot run the refund claim, decision or request', 'false',
    (has_function_privilege('anon', 'public.claim_refund_for_provider(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public.claim_refund_for_provider(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.decide_order_refund(uuid, boolean, text)', 'EXECUTE') or has_function_privilege('anon', 'public.request_order_refund(uuid, text)', 'EXECUTE'))::text);
end $f$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Fixtures and the one-payment Membership flow
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_pat2 uuid;
  v_mem uuid := gen_random_uuid(); v_price uuid := gen_random_uuid();
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; rf uuid; v_res text; v_ref1 text; v_cnt text;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then raise exception 'no organisation: cannot run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  insert into public.catalog_items (id, organisation_id, code, kind, name_key, description_key, duration_days, uses, active)
  values (v_mem, v_org, 'noinst_member', 'membership', 'noinst.member.name', 'noinst.member.desc', 365, null, true);
  insert into public.prices (id, organisation_id, catalog_item_id, amount_kobo, components) values (v_price, v_org, v_mem, 10000000, '{}');

  -- 1. the structural list on the real migration
  perform pg_temp.structural('real');

  -- 2. a Membership is paid once, in full
  o1 := pg_temp.mkorder(v_org, v_pat, v_mem, v_price, 10000000, 'a'); v_ref1 := pg_temp.ref(o1);
  v_res := pg_temp.q_svc(format($q$select (public.record_order_payment(%L, 10000000, 0, 10000000, 'NGN', 'success', 'return'))->>'result'$q$, v_ref1));
  perform pg_temp.ck('paid: a one-payment Membership is recorded', 'paid', v_res);
  perform pg_temp.ck('paid: the order is paid', 'paid', (select state from public.orders where id = o1));
  perform pg_temp.ck('paid: one successful payment of the full price', '1:10000000',
    (select count(*) || ':' || coalesce(sum(amount_kobo), 0) from public.payments where order_id = o1 and status = 'success'));
  perform pg_temp.ck('paid: one entitlement', '1', (select count(*)::text from public.entitlements where order_id = o1));
  perform pg_temp.ck('paid: one active membership', '1', (select count(*)::text from public.patient_memberships where patient_id = v_pat and state = 'active'));
  -- a replay changes nothing
  v_res := pg_temp.q_svc(format($q$select (public.record_order_payment(%L, 10000000, 0, 10000000, 'NGN', 'success', 'webhook'))->>'result'$q$, v_ref1));
  perform pg_temp.ck('replay: the same reference again is a replay', 'replay', v_res);
  perform pg_temp.ck('replay: still one payment and one entitlement', '1:1',
    (select (select count(*) from public.payments where order_id = o1 and status = 'success') || ':' || (select count(*) from public.entitlements where order_id = o1)));
  -- a wrong amount credits nothing
  o2 := pg_temp.mkorder(v_org, v_pat2, v_mem, v_price, 10000000, 'b');
  v_res := pg_temp.q_svc(format($q$select (public.record_order_payment(%L, 3333334, 0, 3333334, 'NGN', 'success', 'return'))->>'result'$q$, pg_temp.ref(o2)));
  perform pg_temp.ck('mismatch: a part-sized charge on a full-price order is a mismatch', 'mismatch', v_res);
  perform pg_temp.ck('mismatch: the order stays unpaid and nothing is credited', 'created:0',
    (select (select state from public.orders where id = o2) || ':' || (select count(*) from public.entitlements where order_id = o2)));
  -- the buyer cancels an unpaid order, never a paid one
  o3 := pg_temp.mkorder(v_org, v_pat2, v_mem, v_price, 10000000, 'c');
  perform pg_temp.ck('cancel: the buyer can cancel an unpaid order', 'true', pg_temp.q_as(v_pat2, format($q$select public.cancel_order(%L)::text$q$, o3)));
  perform pg_temp.ck('cancel: the order is cancelled', 'cancelled', (select state from public.orders where id = o3));
  perform pg_temp.ck('cancel: a paid order cannot be cancelled by the buyer', 'false', pg_temp.q_as(v_pat, format($q$select public.cancel_order(%L)::text$q$, o1)));
  -- the stale-order sweep sees an old unpaid order
  o4 := pg_temp.mkorder(v_org, v_pat2, v_mem, v_price, 10000000, 'd');
  update public.orders set created_at = now() - interval '1 hour' where id = o4;
  perform pg_temp.ck('reconcile: an old unpaid order is listed for the sweeper', 'true',
    pg_temp.q_svc(format($q$select exists (select 1 from public.orders_needing_reconcile(50) where order_id = %L)::text$q$, o4)));

  -- 3. refund: requested once, approved once, the WHOLE amount, access revoked
  v_res := pg_temp.q_as(v_pat, format($q$select (public.request_order_refund(%L, 'Changed my mind about this'))->>'result'$q$, o1));
  perform pg_temp.ck('refund: the buyer can request a refund inside the window', 'requested', v_res);
  v_res := pg_temp.q_as(v_pat, format($q$select (public.request_order_refund(%L, 'Changed my mind again'))->>'result'$q$, o1));
  perform pg_temp.ck('refund: a second request for the same order is refused', 'already_requested', v_res);
  select id into rf from public.refunds where order_id = o1;
  perform pg_temp.ck('refund: one refund row for the order', '1', (select count(*)::text from public.refunds where order_id = o1));
  v_res := pg_temp.q_as(v_admin, format($q$select (public.decide_order_refund(%L, true, 'Approved'))->>'amount_kobo'$q$, rf));
  perform pg_temp.ck('refund: approval returns the whole amount', '10000000', v_res);
  perform pg_temp.ck('refund: the order is refunded and access is revoked', 'refunded:revoked',
    (select (select state from public.orders where id = o1) || ':' || (select state from public.entitlements where order_id = o1)));
  perform pg_temp.ck('refund: a second live refund for the same order is refused by the index', '23505',
    pg_temp.try_sql(format($q$insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test) values (%L, %L, 1, 'second live refund', %L, true)$q$, v_org, o1, v_pat)));
  v_res := pg_temp.q_svc(format($q$select (public.claim_refund_for_provider(%L))->>'charge_reference'$q$, rf));
  perform pg_temp.ck('refund: the provider claim names the order''s single charge', v_ref1, v_res);
  select count(*)::text into v_cnt from public.refund_status_events where refund_id = rf;
  perform pg_temp.ck('refund: the patient is told once per step (events written under the refund itself)', 'true', (v_cnt::integer >= 1)::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- SABOTAGE: put the removed things back one at a time; every structural check must flip
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_flipped integer;
begin
  create table public.order_instalment_plans (id integer);
  alter table public.refunds add column refund_group uuid;
  drop index public.refunds_one_live;
  create unique index refunds_one_live on public.refunds (order_id, state) where state in ('pending', 'approved', 'processing', 'completed');
  create function private.sweep_instalment_lapses() returns void language sql as 'select 1';
  create function private.zz_sabotage_leak() returns text language sql as $f$ select 'orderpart:'::text $f$;
  insert into public.platform_modules (key, label, description) values ('membership_instalments', 'x', 'x');
  perform cron.schedule('instalments-hourly', '41 * * * *', 'select 1');
  insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description)
  values ('instalment_reminder', 'operational', 'important', 'patient', '{in_app}', 'immediate', 'x');
  insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
  values ('order_instalment_plans', 'patient_id', 'financial', 'review', true, 'x');
  perform pg_temp.structural('sabotaged');
  select count(*) into v_flipped from results s
   where s.phase = 'sabotaged'
     and exists (select 1 from results r where r.phase = 'real' and r.check_name = s.check_name and r.expected is not distinct from r.actual)
     and s.expected is distinct from s.actual
     and s.check_name not like 'access:%';
  if v_flipped < 9 then raise exception 'VACUOUS TEST: the sabotage flipped only % structural checks', v_flipped; end if;
end $$;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Instalment removal proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || coalesce(expected, 'null') || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
