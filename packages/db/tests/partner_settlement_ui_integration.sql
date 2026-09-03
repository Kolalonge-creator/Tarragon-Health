-- §91.11 provider settlement statement — integration proof for the new
-- /finance/partner-settlements UI, in one rolled-back transaction.
--
-- No new schema here: the reconciliation engine itself (partner_statements/
-- partner_statement_lines, match_partner_statement, approve_partner_statement)
-- already existed live, fully built, from
-- 20260821192256_partner_billing_reconcile_settle_refund.sql — found mid-
-- Phase-11 of the §91 payments/billing gap closure, after the original plan
-- (a new generate_partner_settlement_statement RPC) turned out to be
-- redundant. This test proves the NEW UI's exact query/RPC-call shapes work
-- against the real, pre-existing schema and RLS, and pins a real gotcha hit
-- while writing it: private.set_lab_order_computed_price is a BEFORE INSERT
-- trigger that silently overwrites whatever partner_cost_breakdown/
-- partner_cost_kobo you insert with the REAL per-test breakdown for the
-- order's bundle+provider — the same "read the computed value back, don't
-- trust what you inserted" lesson as Phase 1's finance_unified_ledger test.
--
-- Since exactly one real Synlab order has ever existed and it has never
-- reached payment_confirmed (confirmed live 2026-08-30), this necessarily
-- uses a synthetic order, dated 2020 so match_partner_statement's own
-- period-scoped "not_delivered" sweep can't pick up unrelated real orders
-- from concurrent activity elsewhere on this shared project.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/partner_settlement_ui_integration.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive.

begin;

create temp table _checks (n serial, msg text) on commit drop;
grant insert, select on _checks to authenticated;
grant usage, select on sequence _checks_n_seq to authenticated;

do $$
declare
  c_org constant uuid := '00000000-0000-0000-0000-000000000001';
  c_bundle constant uuid := '598ca582-41a5-4548-81ce-8a6eb86bd12d';
  c_synlab constant uuid := 'd8d35107-4664-4191-8cf5-463ba746b332';
  v_stranger constant uuid := '3bb0a97c-3cd5-49e7-ba74-23b1b37b9510';
  v_admin uuid;
  v_patient uuid;
  v_lab_order uuid;
  v_breakdown jsonb;
  v_real_cost bigint;
  v_statement_id uuid;
  v_res jsonb;
  v_row record;
  v_elem jsonb;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = c_org limit 1;
  if v_admin is null or v_patient is null then
    raise exception 'fixture QA profiles missing — is the seeded QA account set restored?';
  end if;

  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, fulfilment, origin, panel_bundle_id,
     partner_cost_kobo, partner_cost_provider_id, payment_confirmed_at)
  values (c_org, v_patient, 'payment_confirmed', 5000000, 'partner', 'patient_initiated', c_bundle,
          350000, c_synlab, '2020-01-01 10:00:00+00')
  returning id into v_lab_order;

  select partner_cost_breakdown, partner_cost_kobo into v_breakdown, v_real_cost
    from public.lab_orders where id = v_lab_order;

  insert into _checks (msg) values (
    'PASS 1: synthetic partner-billed order created; real computed cost is ' || v_real_cost ||
    ' kobo across ' || jsonb_array_length(v_breakdown) || ' tests (fixture only, dated 2020)'
  );

  -- =========================================================================
  -- 2. SABOTAGE — a non-staff stranger cannot insert a partner_statements row
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.partner_statements
      (organisation_id, provider_id, reference, period_start, period_end, invoiced_total_kobo)
    values (c_org, c_synlab, 'TEST-SYN-SABOTAGE', '2020-01-01', '2020-01-02', 350000);
    raise exception 'FAIL 2: a stranger inserted a partner_statements row';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 2: a non-staff stranger is refused inserting a partner_statements row (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 3. Finance/ops staff records the statement + line items — exactly the
  --    shape createPartnerStatement() inserts
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.partner_statements
    (organisation_id, provider_id, reference, period_start, period_end, invoiced_total_kobo)
  values (c_org, c_synlab, 'TEST-SYN-0001', '2020-01-01', '2020-01-02', v_real_cost)
  returning id into v_statement_id;

  for v_elem in select * from jsonb_array_elements(v_breakdown) loop
    insert into public.partner_statement_lines (statement_id, lab_order_id, screen_type_code, invoiced_kobo)
    values (v_statement_id, v_lab_order, v_elem ->> 'code', (v_elem ->> 'cost_kobo')::bigint);
  end loop;

  v_res := public.match_partner_statement(v_statement_id);
  reset role;

  if (v_res ->> 'status') = 'matched' and (v_res ->> 'variance_lines')::int = 0 then
    insert into _checks (msg) values ('PASS 3: match_partner_statement correctly matches every real line — status=matched, 0 variances');
  else
    raise exception 'FAIL 3: expected a clean match — %', v_res;
  end if;

  -- =========================================================================
  -- 4. Approval raises a real vendor bill against account 2700
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.approve_partner_statement(v_statement_id, null);
  reset role;

  if (v_res ->> 'ok')::boolean and (v_res ->> 'agreed_kobo')::bigint = v_real_cost and (v_res ->> 'bill_id') is not null then
    insert into _checks (msg) values ('PASS 4: approve_partner_statement raised a vendor bill for the agreed ' || v_real_cost || ' kobo');
  else
    raise exception 'FAIL 4: approval did not produce the expected bill — %', v_res;
  end if;

  select * into v_row from public.partner_statements where id = v_statement_id;
  if v_row.status = 'approved' and v_row.bill_id is not null then
    insert into _checks (msg) values ('PASS 5: the statement flips to approved with a bill_id recorded');
  else
    raise exception 'FAIL 5: statement row not updated correctly — %', v_row;
  end if;

  -- =========================================================================
  -- 6. The exact read shape the new finance page queries (join to
  --    lab_providers.name) resolves correctly
  -- =========================================================================
  perform 1 from public.partner_statements ps
    join public.lab_providers lp on lp.id = ps.provider_id
   where ps.id = v_statement_id and lp.name = 'Synlab Nigeria';
  if found then
    insert into _checks (msg) values ('PASS 6: the statement joins cleanly to lab_providers.name, matching the finance page''s own query shape');
  else
    raise exception 'FAIL 6: join to lab_providers failed';
  end if;

  -- =========================================================================
  -- 7. SABOTAGE — a disputed statement cannot be approved silently
  -- =========================================================================
  update public.partner_statement_lines set resolution = 'overcharged', expected_kobo = invoiced_kobo - 1
    where id = (select id from public.partner_statement_lines where statement_id = v_statement_id limit 1);
  update public.partner_statements set status = 'disputed' where id = v_statement_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.approve_partner_statement(v_statement_id, null);
    raise exception 'FAIL 7: a disputed statement was approved without a forced reason';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 7: a disputed statement cannot be approved without a written reason (' || sqlerrm || ')');
  end;
  reset role;
end $$;

select msg from _checks order by n;

rollback;
