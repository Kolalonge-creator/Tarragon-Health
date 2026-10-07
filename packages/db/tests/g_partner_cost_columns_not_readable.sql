-- Track G, spec 8.16 / OQ-320: "Clinicians never see what Tarragon earns or pays." Standing proof that what Tarragon pays a partner
-- (lab_orders / pharmacy_orders .partner_cost_kobo, .partner_cost_breakdown) and what a refund costs it (lab_order_refunds /
-- pharmacy_order_refunds .partner_portion_kobo, .margin_portion_kobo) are not readable by ANY signed-in role (no admin view exists:
-- nothing reads them from a client), while every other column stays readable, every writer still works, and no SECURITY DEFINER
-- function hands the cost back to a non-finance caller.
-- Migration: 20261007190500_g_partner_cost_and_refund_margin_columns_off_the_authenticated_surface.sql
--
-- Roles proved: patient (owner), a second patient, clinician, pharmacist, lab_partner, lab_liaison, analyst, corporate_admin,
-- hmo_admin, finance (with and without commissions.view), admin, anon.
-- Sabotage: inside the same rolled-back transaction the old table-wide SELECT grant is put back; the refusals must then flip to
-- leaks, or this script raises "VACUOUS TEST".
begin;

create function pg_temp.probe(p_uid uuid, p_role text, p_sql text) returns text
language plpgsql as $f$
declare v_n bigint;
begin
  if p_uid is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  else
    perform set_config('request.jwt.claims', '', true);
  end if;
  execute format('set local role %I', p_role);
  begin
    execute 'select count(*) from (' || p_sql || ') q' into v_n;
    reset role;
    return 'rows:' || v_n;
  exception
    when insufficient_privilege then reset role; return 'denied';
    when undefined_column then reset role; return 'nocolumn';
  end;
end $f$;

create temp table t_results (check_name text, observed text, expected text, verdict text) on commit drop;

do $$
declare
  v_org uuid;
  v_patient uuid := gen_random_uuid(); v_patient2 uuid := gen_random_uuid(); v_clin uuid := gen_random_uuid();
  v_clin2 uuid := gen_random_uuid(); v_pharm uuid := gen_random_uuid(); v_labp uuid := gen_random_uuid();
  v_liaison uuid := gen_random_uuid(); v_analyst uuid := gen_random_uuid(); v_corp uuid := gen_random_uuid();
  v_hmo uuid := gen_random_uuid(); v_fin uuid := gen_random_uuid(); v_fin2 uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid();
  v_lab uuid; v_partner uuid; v_bundle uuid; v_med uuid;
  v_lorder uuid; v_lorder2 uuid; v_porder uuid; v_porder2 uuid; v_lref uuid; v_pref uuid;
  v_cost bigint; v_pcost bigint;
  r text; uid uuid; n bigint; s text; res jsonb; sel text;
  cols constant text[] := array['partner_cost_kobo', 'partner_cost_breakdown'];
  rcols constant text[] := array['partner_portion_kobo', 'margin_portion_kobo'];
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then raise exception 'SETUP: need an organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    select u, 'g-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_patient, v_patient2, v_clin, v_clin2, v_pharm, v_labp, v_liaison, v_analyst, v_corp, v_hmo, v_fin, v_fin2, v_admin]) u;
  update public.profiles set organisation_id = v_org, role = 'patient', is_test = true where id in (v_patient, v_patient2);
  update public.profiles set organisation_id = v_org, role = 'clinician', is_test = true where id in (v_clin, v_clin2);
  update public.profiles set organisation_id = v_org, role = 'lab_liaison', is_test = true where id = v_liaison;
  update public.profiles set organisation_id = v_org, role = 'analyst', is_test = true where id = v_analyst;
  update public.profiles set organisation_id = v_org, role = 'corporate_admin', is_test = true where id = v_corp;
  update public.profiles set organisation_id = v_org, role = 'hmo_admin', is_test = true where id = v_hmo;
  update public.profiles set organisation_id = v_org, role = 'finance', is_test = true where id in (v_fin, v_fin2);
  update public.profiles set organisation_id = v_org, role = 'admin', is_test = true where id = v_admin;

  insert into public.lab_providers (name, is_active) values ('G Test Lab', false) returning id into v_lab;
  insert into public.pharmacy_partners (name, is_active) values ('G Test Pharmacy', false) returning id into v_partner;
  update public.profiles set organisation_id = v_org, role = 'pharmacist', pharmacy_partner_id = v_partner, is_test = true where id = v_pharm;
  update public.profiles set organisation_id = v_org, role = 'lab_partner', lab_provider_id = v_lab, is_test = true where id = v_labp;

  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_fin, 'commissions.view', v_admin);
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_clin2, 'commissions.view', v_admin);

  -- fixtures with a REAL partner cost (inserted as the table owner, which is how the pricing triggers write it)
  insert into public.panel_bundles (code, name, price_kobo, test_codes, guidance_only)
    values ('G_TEST_BUNDLE', 'G Test Bundle', 22750000, array['G_TEST_CODE'], false) returning id into v_bundle;
  -- The pricing and origin triggers refuse a hand-set cost and a bundle with no price on file; the fixture needs a known cost, so
  -- the INSERTs run with triggers off (session_replication_role = replica), exactly as an owner-run backfill would.
  set local session_replication_role = replica;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin, investigation_tier,
                                 fulfilment, provider_id, partner_cost_kobo, partner_cost_provider_id, partner_cost_breakdown, transmission)
    values (v_org, v_patient, v_bundle, 'payment_confirmed', 22750000, 'patient_initiated', 1, 'partner', v_lab, 18980000, v_lab,
            '[{"code":"g_test","cost_kobo":18980000}]'::jsonb, 'queued')
    returning id into v_lorder;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin, investigation_tier,
                                 fulfilment, provider_id, partner_cost_kobo, partner_cost_provider_id, transmission)
    values (v_org, v_patient, v_bundle, 'payment_confirmed', 22750000, 'patient_initiated', 1, 'partner', v_lab, 18980000, v_lab, 'queued')
    returning id into v_lorder2;
  select partner_cost_kobo into v_cost from public.lab_orders where id = v_lorder;
  insert into t_results values ('S fixture: the lab order really carries a partner cost', coalesce(v_cost::text, 'null'), '>0',
    null);
  update t_results set observed = case when v_cost > 0 then '>0' else 'zero-or-null:' || coalesce(v_cost::text, 'null') end where check_name like 'S fixture: the lab%';

  insert into public.medications (organisation_id, patient_id, drug_name, source, is_active)
    values (v_org, v_patient, 'G Test Amlodipine 5mg', 'clinician', true);
  insert into public.pharmacy_orders (organisation_id, patient_id, pharmacy_partner_id, items, total_kobo, status,
                                      origin, partner_cost_kobo, partner_cost_provider_id, partner_cost_breakdown)
    values (v_org, v_patient, v_partner,
            jsonb_build_array(jsonb_build_object('drug_name', 'G Test Amlodipine 5mg', 'price_kobo', 150000, 'quantity', 1)),
            150000, 'pending_payment', 'patient_initiated', 90000, v_partner, '[{"cost_kobo":90000}]'::jsonb)
    returning id into v_porder;
  insert into public.pharmacy_orders (organisation_id, patient_id, pharmacy_partner_id, items, total_kobo, status,
                                      origin, partner_cost_kobo, partner_cost_provider_id)
    values (v_org, v_patient, v_partner,
            jsonb_build_array(jsonb_build_object('drug_name', 'G Test Amlodipine 5mg', 'price_kobo', 150000, 'quantity', 1)),
            150000, 'pending_payment', 'patient_initiated', 90000, v_partner)
    returning id into v_porder2;
  select partner_cost_kobo into v_pcost from public.pharmacy_orders where id = v_porder;
  insert into t_results values ('S fixture: the pharmacy order really carries a partner cost', case when v_pcost > 0 then '>0' else 'zero-or-null' end, '>0', null);

  set local session_replication_role = origin;
  insert into public.lab_order_refunds (organisation_id, lab_order_id, reason, refund_total_kobo, partner_portion_kobo, margin_portion_kobo, requested_by)
    select v_org, v_lorder, reason, 1000, 600, 400, v_clin from public.lab_refund_policies limit 1 returning id into v_lref;
  insert into public.pharmacy_order_refunds (organisation_id, pharmacy_order_id, reason, refund_total_kobo, partner_portion_kobo, margin_portion_kobo, requested_by)
    select v_org, v_porder, reason, 1000, 600, 400, v_clin from public.pharmacy_refund_policies limit 1 returning id into v_pref;

  -- A. NOBODY reads a withheld column: every non-owner role, including admin, finance with commissions.view and the order's own patient
  foreach r in array array['patient', 'patient2', 'clinician', 'clinician2', 'pharmacist', 'lab_partner', 'lab_liaison', 'analyst',
                           'corporate_admin', 'hmo_admin', 'finance', 'finance_view', 'admin'] loop
    uid := case r when 'patient' then v_patient when 'patient2' then v_patient2 when 'clinician' then v_clin when 'clinician2' then v_clin2
                  when 'pharmacist' then v_pharm when 'lab_partner' then v_labp when 'lab_liaison' then v_liaison when 'analyst' then v_analyst
                  when 'corporate_admin' then v_corp when 'hmo_admin' then v_hmo when 'finance' then v_fin2 when 'finance_view' then v_fin
                  else v_admin end;
    foreach s in array array['lab_orders', 'pharmacy_orders'] loop
      foreach sel in array cols loop
        insert into t_results select 'A ' || r || ' refused ' || s || '.' || sel,
          pg_temp.probe(uid, 'authenticated', format('select %I from public.%I', sel, s)), 'denied', null;
      end loop;
    end loop;
    foreach s in array array['lab_order_refunds', 'pharmacy_order_refunds'] loop
      foreach sel in array rcols loop
        insert into t_results select 'A ' || r || ' refused ' || s || '.' || sel,
          pg_temp.probe(uid, 'authenticated', format('select %I from public.%I', sel, s)), 'denied', null;
      end loop;
    end loop;
  end loop;
  foreach s in array array['lab_orders', 'pharmacy_orders', 'lab_order_refunds', 'pharmacy_order_refunds'] loop
    insert into t_results select 'A select * on ' || s || ' fails loudly for the patient', pg_temp.probe(v_patient, 'authenticated', 'select * from public.' || s), 'denied', null;
    insert into t_results select 'A select * on ' || s || ' fails loudly for the clinician', pg_temp.probe(v_clin, 'authenticated', 'select * from public.' || s), 'denied', null;
    insert into t_results select 'A anon refused ' || s, pg_temp.probe(null, 'anon', 'select id from public.' || s), 'denied', null;
  end loop;
  -- a partner cost cannot be inferred through an embed or a filter either
  insert into t_results select 'A a filter on the withheld column is refused (patient)',
    pg_temp.probe(v_patient, 'authenticated', 'select id from public.lab_orders where partner_cost_kobo > 0'), 'denied', null;
  insert into t_results select 'A an order-by on the withheld column is refused (clinician)',
    pg_temp.probe(v_clin, 'authenticated', 'select id from public.pharmacy_orders order by partner_cost_kobo'), 'denied', null;

  -- B. every other column stays readable, and RLS still scopes the rows
  insert into t_results select 'B patient reads own lab order (every safe column)', pg_temp.probe(v_patient, 'authenticated',
    format('select id, organisation_id, patient_id, provider_id, panel_bundle_id, status, total_kobo, payable_kobo, fulfilment, transmission, partner_cost_provider_id, order_number, voucher_covered_kobo, subscriber_discount_kobo from public.lab_orders where id = %L', v_lorder)), 'rows:1', null;
  insert into t_results select 'B clinician reads the org lab order', pg_temp.probe(v_clin, 'authenticated',
    format('select id, status, total_kobo, partner_cost_provider_id from public.lab_orders where id = %L', v_lorder)), 'rows:1', null;
  insert into t_results select 'B another patient still sees no lab order (RLS intact)', pg_temp.probe(v_patient2, 'authenticated',
    format('select id, status from public.lab_orders where id = %L', v_lorder)), 'rows:0', null;
  insert into t_results select 'B patient reads own pharmacy order (every safe column)', pg_temp.probe(v_patient, 'authenticated',
    format('select id, status, total_kobo, payable_kobo, items, pharmacy_partner_id, partner_cost_provider_id, refund_status, refund_amount_kobo, confirmed_price_kobo from public.pharmacy_orders where id = %L', v_porder)), 'rows:1', null;
  insert into t_results select 'B clinician reads the org pharmacy order', pg_temp.probe(v_clin, 'authenticated',
    format('select id, status, total_kobo, partner_cost_provider_id from public.pharmacy_orders where id = %L', v_porder)), 'rows:1', null;
  insert into t_results select 'B another patient still sees no pharmacy order (RLS intact)', pg_temp.probe(v_patient2, 'authenticated',
    format('select id from public.pharmacy_orders where id = %L', v_porder)), 'rows:0', null;
  insert into t_results select 'B patient reads own lab refund without the split', pg_temp.probe(v_patient, 'authenticated',
    format('select id, reason, status, refund_total_kobo, detail, requested_at, paid_at from public.lab_order_refunds where id = %L', v_lref)), 'rows:1', null;
  insert into t_results select 'B patient reads own pharmacy refund without the split', pg_temp.probe(v_patient, 'authenticated',
    format('select id, reason, status, refund_total_kobo, detail from public.pharmacy_order_refunds where id = %L', v_pref)), 'rows:1', null;
  insert into t_results select 'B clinician reads the org refunds without the split', pg_temp.probe(v_clin, 'authenticated',
    format('select id, status, refund_total_kobo, journal_entry_id from public.lab_order_refunds where id = %L', v_lref)), 'rows:1', null;
  insert into t_results select 'B another patient sees no refund (RLS intact)', pg_temp.probe(v_patient2, 'authenticated',
    format('select id from public.lab_order_refunds where id = %L', v_lref)), 'rows:0', null;
  insert into t_results select 'B patient_care_gaps (security invoker over lab_orders) still readable', pg_temp.probe(v_patient, 'authenticated',
    'select gap_type from public.patient_care_gaps'), 'rows:0', null;
  insert into t_results select 'B lab_orders_awaiting_transmission readable for the clinician (id only)', pg_temp.probe(v_clin, 'authenticated',
    'select id, laboratory, hours_since_payment from public.lab_orders_awaiting_transmission'), 'rows:2', null;
  insert into t_results select 'B lab_orders_awaiting_transmission no longer has a partner_cost_kobo column', pg_temp.probe(v_clin, 'authenticated',
    'select partner_cost_kobo from public.lab_orders_awaiting_transmission'), 'nocolumn', null;
  insert into t_results select 'B anon cannot read lab_orders_awaiting_transmission', pg_temp.probe(null, 'anon',
    'select id from public.lab_orders_awaiting_transmission'), 'denied', null;

  -- C. writers still work (no RETURNING of the withheld columns)
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.lab_orders set clinical_indication = 'g proof' where id = v_lorder;
  get diagnostics n = row_count;
  reset role;
  insert into t_results values ('C clinician UPDATE on lab_orders still works', 'rows:' || n, 'rows:1', null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.pharmacy_orders set cancellation_reason = 'g proof' where id = v_porder;
  get diagnostics n = row_count;
  reset role;
  insert into t_results values ('C clinician UPDATE on pharmacy_orders still works', 'rows:' || n, 'rows:1', null);
  insert into t_results select 'C the writes landed and the cost is untouched',
    (select 'rows:' || count(*) from public.lab_orders where id = v_lorder and clinical_indication = 'g proof' and partner_cost_kobo = v_cost), 'rows:1', null;

  -- D. refund requests: the cost split only comes back to admin or a commissions.view holder (a care-team member); never the clinician
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.request_lab_order_refund(v_lorder2, (select reason from public.lab_refund_policies where refunds_in_full limit 1));
  reset role;
  insert into t_results values ('D clinician refund request still succeeds', coalesce(res ->> 'ok', 'null'), 'true', null);
  insert into t_results values ('D clinician response has no tarragon_loss_kobo', case when res ? 'tarragon_loss_kobo' then 'present' else 'absent' end, 'absent', null);
  insert into t_results values ('D clinician response has no released_from_liability_kobo', case when res ? 'released_from_liability_kobo' then 'present' else 'absent' end, 'absent', null);
  insert into t_results values ('D clinician response has no policy note', case when res ? 'policy' then 'present' else 'absent' end, 'absent', null);
  insert into t_results values ('D clinician response still carries refund_kobo', case when res ? 'refund_kobo' and res ? 'refund_id' then 'present' else 'absent' end, 'present', null);
  insert into t_results select 'D the refund row still recorded the real split (as owner)',
    (select 'rows:' || count(*) from public.lab_order_refunds where id = (res ->> 'refund_id')::uuid and partner_portion_kobo + margin_portion_kobo = refund_total_kobo and partner_portion_kobo > 0), 'rows:1', null;

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.request_pharmacy_order_refund(v_porder2, (select reason from public.pharmacy_refund_policies where refunds_in_full limit 1));
  reset role;
  insert into t_results values ('D commissions.view holder gets the pharmacy cost split', case when res ? 'tarragon_loss_kobo' and res ? 'released_from_liability_kobo' then 'present' else 'absent' end, 'present', null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.request_pharmacy_order_refund(v_porder, (select reason from public.pharmacy_refund_policies where refunds_in_full limit 1));
  reset role;
  insert into t_results values ('D admin gets the pharmacy cost split', case when res ? 'tarragon_loss_kobo' then 'present' else 'absent' end, 'present', null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.request_pharmacy_order_refund(v_porder2, (select reason from public.pharmacy_refund_policies where refunds_in_full limit 1));
  reset role;
  insert into t_results values ('D clinician pharmacy refund response has no cost split', case when res ? 'tarragon_loss_kobo' or res ? 'released_from_liability_kobo' or res ? 'policy' then 'present' else 'absent' end, 'absent', null);

  -- E. the three functions no longer hand back a row; none is callable by anon
  insert into t_results select 'E request_lab_order_partner_visit returns void',
    pg_get_function_result('public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day)'::regprocedure), 'void', null;
  insert into t_results select 'E set_lab_order_facility returns void', pg_get_function_result('public.set_lab_order_facility(uuid, uuid)'::regprocedure), 'void', null;
  insert into t_results select 'E assign_home_phlebotomist returns void',
    pg_get_function_result('public.assign_home_phlebotomist(uuid, uuid, text, text, timestamp with time zone)'::regprocedure), 'void', null;
  insert into t_results select 'E no SECURITY DEFINER function returns one of the four row types',
    (select 'rows:' || count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname in ('public', 'private') and p.prosecdef
        and p.prorettype in ('public.lab_orders'::regtype, 'public.pharmacy_orders'::regtype, 'public.lab_order_refunds'::regtype, 'public.pharmacy_order_refunds'::regtype)), 'rows:0', null;
  insert into t_results select 'E anon cannot execute any of the five',
    (select 'rows:' || count(*) from unnest(array[
        'public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day)',
        'public.set_lab_order_facility(uuid, uuid)',
        'public.assign_home_phlebotomist(uuid, uuid, text, text, timestamp with time zone)',
        'public.request_lab_order_refund(uuid, public.lab_refund_reason, bigint, text)',
        'public.request_pharmacy_order_refund(uuid, public.pharmacy_refund_reason, bigint, text)']) f
      where has_function_privilege('anon', f::regprocedure, 'EXECUTE')), 'rows:0', null;

  -- F. the grant covers every non-withheld column (a later migration adding a column must also grant it), and no Realtime leak
  insert into t_results select 'F every non-withheld column of the four tables is granted',
    (select 'rows:' || count(*) from pg_attribute a
      where a.attrelid in ('public.lab_orders'::regclass, 'public.pharmacy_orders'::regclass, 'public.lab_order_refunds'::regclass, 'public.pharmacy_order_refunds'::regclass)
        and a.attnum > 0 and not a.attisdropped
        and a.attname not in ('partner_cost_kobo', 'partner_cost_breakdown', 'partner_portion_kobo', 'margin_portion_kobo')
        and not has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')), 'rows:0', null;
  insert into t_results select 'F none of the four tables is published to Realtime',
    (select 'rows:' || count(*) from pg_publication_tables where schemaname = 'public'
       and tablename in ('lab_orders', 'pharmacy_orders', 'lab_order_refunds', 'pharmacy_order_refunds')), 'rows:0', null;
  alter table public.lab_orders add column g_probe_col int;
  insert into t_results select 'F SABOTAGE a newly added column is ungranted and detected',
    (select 'rows:' || count(*) from pg_attribute a
      where a.attrelid = 'public.lab_orders'::regclass and a.attname = 'g_probe_col'
        and not has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')), 'rows:1', null;

  -- G. SABOTAGE: put the table-wide SELECT grant back; the refusals must flip to leaks
  grant select on public.lab_orders, public.pharmacy_orders, public.lab_order_refunds, public.pharmacy_order_refunds to authenticated;
  insert into t_results select 'G SABOTAGE patient reads lab_orders.partner_cost_kobo again (must leak)', pg_temp.probe(v_patient, 'authenticated', 'select partner_cost_kobo from public.lab_orders'), 'leak', null;
  insert into t_results select 'G SABOTAGE patient reads lab_orders.partner_cost_breakdown again (must leak)', pg_temp.probe(v_patient, 'authenticated', 'select partner_cost_breakdown from public.lab_orders'), 'leak', null;
  insert into t_results select 'G SABOTAGE clinician reads pharmacy_orders.partner_cost_kobo again (must leak)', pg_temp.probe(v_clin, 'authenticated', 'select partner_cost_kobo from public.pharmacy_orders'), 'leak', null;
  insert into t_results select 'G SABOTAGE patient reads lab_order_refunds.margin_portion_kobo again (must leak)', pg_temp.probe(v_patient, 'authenticated', 'select margin_portion_kobo from public.lab_order_refunds'), 'leak', null;
  insert into t_results select 'G SABOTAGE patient reads pharmacy_order_refunds.partner_portion_kobo again (must leak)', pg_temp.probe(v_patient, 'authenticated', 'select partner_portion_kobo from public.pharmacy_order_refunds'), 'leak', null;
end $$;

update t_results set verdict = case when check_name ~ '^[FG] SABOTAGE' then case when observed ~ '^rows:[1-9]' then 'PASS' else 'FAIL' end
  when observed = expected then 'PASS' else 'FAIL' end;

do $$
declare v_bad text; v_vacuous int;
begin
  select string_agg(check_name || ' => ' || observed, '; ') into v_bad from t_results where verdict = 'FAIL' and check_name !~ '^[FG] SABOTAGE';
  if v_bad is not null then raise exception 'HOLE OPEN: %', v_bad; end if;
  select count(*) into v_vacuous from t_results where check_name ~ '^[FG] SABOTAGE' and verdict = 'FAIL';
  if v_vacuous > 0 then raise exception 'VACUOUS TEST: sabotage did not reproduce the leak (% checks)', v_vacuous; end if;
end $$;

select check_name, observed, expected, verdict from t_results order by check_name;

rollback;
