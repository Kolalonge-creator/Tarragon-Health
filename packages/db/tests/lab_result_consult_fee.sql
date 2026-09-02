-- Lab-result consultation fee: the gate that blocks a self-arranged
-- lab-result upload until the one-off ₦10,000 consultation fee is paid.
-- Founder rule, 2026-08-30.
--
-- Covers: the price book pins the amount server-side; an unpaid (or
-- already-consumed) credit is refused, never silently allowed; a patient
-- cannot claim another patient's paid credit even by naming their id
-- directly; a claimed credit cannot be claimed twice; settling can both
-- link the real document AND release a claim back to payment_confirmed on a
-- failed upload; and a network-billed (fulfilment='partner') order skips the
-- whole gate without ever needing a lab_result_consult_requests row at all.
--
-- Run inside a single transaction and ROLLED BACK. Every negative is paired
-- with a positive control, because a check that only ever proves "nothing
-- happened" passes just as happily against a completely broken system.
--
-- Verified against the linked project. To re-run:
--   npx supabase db query --linked -f packages/db/tests/lab_result_consult_fee.sql
-- (run it from the MAIN checkout, not a worktree - see
-- reference_supabase_cli_sql_access)

begin;

create temp table r(step text, verdict text) on commit drop;
-- Results are recorded from inside simulated `authenticated` sessions, so
-- that role needs to be able to write to the scratch table.
grant insert, select on r to authenticated;

do $$
declare
  v_org uuid; v_pt uuid; v_pt2 uuid;
  v_bundle uuid; v_state text; v_syn uuid;
  v_req1 uuid; v_req2 uuid; v_req3 uuid;
  v_order_self uuid; v_order_partner uuid;
  v_doc1 uuid;
  v_claimed uuid;
  v_n int; v_status text; v_amount bigint; v_currency text; v_doc_id uuid;
  v_claims text;
begin
  ------------------------------------------------------------------
  -- Fixtures. Asserted, so a lookup miss fails loudly instead of
  -- silently making every check below vacuous. No clinical_staff fixture is
  -- needed — nothing in this gate checks clinical authority.
  ------------------------------------------------------------------
  select id, organisation_id into v_pt, v_org
    from public.profiles where role = 'patient' and organisation_id is not null
    order by created_at limit 1;
  select id into v_pt2
    from public.profiles where role = 'patient' and organisation_id = v_org and id <> v_pt
    limit 1;
  select id into v_bundle from public.panel_bundles where code = 'screen_core';

  if v_pt is null or v_pt2 is null or v_bundle is null then
    raise exception 'fixture lookup failed - the test would have been vacuous';
  end if;

  ------------------------------------------------------------------
  -- 0. Fixture lab_orders: one self-arranged (to link request #2 to), one
  --    network-billed/partner (to prove the whole gate is skipped for it).
  ------------------------------------------------------------------
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, origin, status, total_kobo)
  values (v_org, v_pt, v_bundle, 'patient_initiated', 'ordered', 0)
  returning id into v_order_self;

  select state into v_state from public.profiles where id = v_pt;
  if v_state is not null then
    update public.service_regions set is_active = true where state = v_state;
    if not found then insert into public.service_regions (state, is_active) values (v_state, true); end if;
  end if;
  update public.lab_providers set is_active = true, regions = array[coalesce(v_state, 'Lagos')]
    where name = 'Synlab Nigeria';
  select id into v_syn from public.lab_providers where name = 'Synlab Nigeria';

  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin,
     investigation_tier, fulfilment, provider_id)
  values (v_org, v_pt, v_bundle, 'ordered', 0, 'patient_initiated', 1, 'partner', v_syn)
  returning id into v_order_partner;

  ------------------------------------------------------------------
  -- 1. Price book pins the amount server-side.
  ------------------------------------------------------------------
  v_claims := json_build_object('sub', v_pt, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;

  insert into public.lab_result_consult_requests (organisation_id, patient_id)
  values (v_org, v_pt)
  returning id into v_req1;

  select amount_minor, currency, status::text into v_amount, v_currency, v_status
    from public.lab_result_consult_requests where id = v_req1;
  insert into r values ('1a amount/currency pinned server-side from the price book',
    case when v_amount = 1000000 and v_currency = 'NGN' then 'PASS'
         else 'FAIL - got ' || v_amount || ' ' || v_currency end);
  insert into r values ('1b fresh request starts requested',
    case when v_status = 'requested' then 'PASS' else 'FAIL - got ' || v_status end);

  reset role;

  ------------------------------------------------------------------
  -- 2. An unpaid request cannot be claimed — the gate must reject, never
  --    silently allow, an upload with no confirmed payment.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;

  begin
    perform public.claim_lab_result_consult_credit(v_pt, null);
    insert into r values ('2a CONTROL unpaid request cannot be claimed', 'FAIL - accepted');
  exception when raise_exception then
    insert into r values ('2a CONTROL unpaid request cannot be claimed', 'PASS');
  end;

  reset role;

  ------------------------------------------------------------------
  -- 3. Simulate the webhook confirming payment (service-role path — done
  --    here as the unrestricted top-level role, matching how a real webhook
  --    write is not RLS-scoped either).
  ------------------------------------------------------------------
  update public.lab_result_consult_requests set status = 'payment_confirmed' where id = v_req1;

  ------------------------------------------------------------------
  -- 4. A patient cannot claim ANOTHER patient's paid credit, even by naming
  --    that patient's id directly — and an unrelated patient with no paid
  --    request of their own is refused too, not silently waved through.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pt2, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.claim_lab_result_consult_credit(v_pt, null);
    insert into r values ('4a CONTROL cannot claim another patient''s paid credit', 'FAIL - accepted');
  exception when insufficient_privilege then
    insert into r values ('4a CONTROL cannot claim another patient''s paid credit', 'PASS');
  end;

  begin
    perform public.claim_lab_result_consult_credit(v_pt2, null);
    insert into r values ('4b CONTROL unrelated patient has nothing to claim', 'FAIL - accepted');
  exception when raise_exception then
    insert into r values ('4b CONTROL unrelated patient has nothing to claim', 'PASS');
  end;

  reset role;

  ------------------------------------------------------------------
  -- 5. The real patient claims their paid credit — succeeds exactly once.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;

  select public.claim_lab_result_consult_credit(v_pt, null) into v_claimed;
  insert into r values ('5a patient claims their own paid credit',
    case when v_claimed = v_req1 then 'PASS' else 'FAIL - got ' || coalesce(v_claimed::text, 'null') end);

  select status::text into v_status from public.lab_result_consult_requests where id = v_req1;
  insert into r values ('5b claimed request flips to document_uploaded',
    case when v_status = 'document_uploaded' then 'PASS' else 'FAIL - got ' || v_status end);

  ------------------------------------------------------------------
  -- 6. The SAME credit cannot be claimed a second time.
  ------------------------------------------------------------------
  begin
    perform public.claim_lab_result_consult_credit(v_pt, null);
    insert into r values ('6a an already-claimed request cannot be claimed twice', 'FAIL - accepted');
  exception when raise_exception then
    insert into r values ('6a an already-claimed request cannot be claimed twice', 'PASS');
  end;

  ------------------------------------------------------------------
  -- 7. Settle links the real document once it exists (the reason claim and
  --    document-insert are two calls, not one — see the migration header).
  ------------------------------------------------------------------
  insert into public.lab_result_documents
    (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_pt, v_pt || '/consult-fee-test.pdf', 'result.pdf', 'application/pdf', 1024, 'patient')
  returning id into v_doc1;

  perform public.settle_lab_result_consult_claim(v_req1, v_doc1);
  select lab_result_document_id into v_doc_id from public.lab_result_consult_requests where id = v_req1;
  insert into r values ('7a settle links the real document id',
    case when v_doc_id = v_doc1 then 'PASS' else 'FAIL' end);

  reset role;

  ------------------------------------------------------------------
  -- 8. An order-linked request only satisfies an upload naming that SAME
  --    order — no cross-matching between a loose credit and an order-linked
  --    one in either direction.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;

  insert into public.lab_result_consult_requests (organisation_id, patient_id, lab_order_id)
  values (v_org, v_pt, v_order_self)
  returning id into v_req2;
  reset role;

  update public.lab_result_consult_requests set status = 'payment_confirmed' where id = v_req2;

  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;

  begin
    perform public.claim_lab_result_consult_credit(v_pt, null);
    insert into r values ('8a CONTROL order-linked credit does not satisfy a loose upload', 'FAIL - accepted');
  exception when raise_exception then
    insert into r values ('8a CONTROL order-linked credit does not satisfy a loose upload', 'PASS');
  end;

  select public.claim_lab_result_consult_credit(v_pt, v_order_self) into v_claimed;
  insert into r values ('8b claiming with the matching lab_order_id succeeds',
    case when v_claimed = v_req2 then 'PASS' else 'FAIL' end);

  ------------------------------------------------------------------
  -- 9. Settle can also RELEASE a claim (failed upload) back to
  --    payment_confirmed, so a transient failure never stranded the
  --    patient's paid fee — and the released credit can then be claimed for
  --    real.
  ------------------------------------------------------------------
  perform public.settle_lab_result_consult_claim(v_req2, null);
  select status::text into v_status from public.lab_result_consult_requests where id = v_req2;
  insert into r values ('9a release reverts a claim back to payment_confirmed',
    case when v_status = 'payment_confirmed' then 'PASS' else 'FAIL - got ' || v_status end);

  select public.claim_lab_result_consult_credit(v_pt, v_order_self) into v_claimed;
  insert into r values ('9b a released credit can be claimed again',
    case when v_claimed = v_req2 then 'PASS' else 'FAIL' end);

  reset role;

  ------------------------------------------------------------------
  -- 10. Network-billed (fulfilment='partner') orders skip the whole gate —
  --     no lab_result_consult_requests row is ever needed for one.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;

  select public.claim_lab_result_consult_credit(v_pt, v_order_partner) into v_claimed;
  insert into r values ('10a partner-fulfilled order returns null (nothing to claim)',
    case when v_claimed is null then 'PASS' else 'FAIL - claimed ' || v_claimed::text end);

  begin
    insert into public.lab_result_consult_requests (organisation_id, patient_id, lab_order_id)
    values (v_org, v_pt, v_order_partner);
    insert into r values ('10b CONTROL cannot even create a fee request against a partner order', 'FAIL - accepted');
  exception when check_violation then
    insert into r values ('10b CONTROL cannot even create a fee request against a partner order', 'PASS');
  end;

  reset role;

  -- Run as v_pt2's OWN session (patient_id = auth.uid() so the RLS insert
  -- policy itself is satisfied) so this specifically exercises the trigger's
  -- ownership guard, not just RLS.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pt2, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.lab_result_consult_requests (organisation_id, patient_id, lab_order_id)
    values (v_org, v_pt2, v_order_self);
    insert into r values ('10c CONTROL lab_order_id must belong to the same patient', 'FAIL - accepted');
  exception when check_violation then
    insert into r values ('10c CONTROL lab_order_id must belong to the same patient', 'PASS');
  end;

  reset role;
end $$;

select step, verdict from r order by step;

rollback;
