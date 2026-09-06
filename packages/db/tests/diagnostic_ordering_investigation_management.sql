-- Diagnostic Ordering & Investigation Management (module 57) — live proof for
-- 20260829122135_diagnostic_ordering_investigation_management.sql:
--   1. NEGATIVE: a clinician-generated lab_order with no clinical_indication
--      is rejected (23514).
--   2. POSITIVE CONTROL: the same insert with clinical_indication set
--      succeeds, and urgency defaults to 'routine' — proving #1 is the real
--      guard firing, not some unrelated failure.
--   3. An explicit urgency='urgent' order is recorded and satisfies
--      lab_orders_urgent_open_idx's own predicate.
--   4. Amendment: a later document can be marked as correcting an earlier
--      one; the earlier one is stamped superseded_by_document_id/
--      superseded_at automatically (private.enforce_lab_result_document_update).
--   5. NEGATIVE: a document cannot supersede itself.
--   6. NEGATIVE: a second document cannot also claim to supersede a target
--      that is already superseded (double-supersede rejected).
--
-- Run: npx supabase db query --linked -f packages/db/tests/diagnostic_ordering_investigation_management.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

do $$
declare
  v_org      uuid := '00000000-0000-0000-0000-000000000001';
  v_pat      uuid;
  v_clin     uuid;
  v_staff_id uuid;
  v_bundle_id uuid;
  v_order_id uuid;
  v_order_urgent uuid;
  v_doc_a uuid;
  v_doc_b uuid;
  v_doc_c uuid;
  v_failed boolean;
  v_row public.lab_orders%rowtype;
  v_doc_row public.lab_result_documents%rowtype;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  if v_pat is null then raise exception 'SETUP: no patient found in org %', v_org; end if;

  -- A clinician profile with NO existing clinical_staff row — clinical_staff
  -- has a UNIQUE(profile_id) constraint, so reusing one that already has a
  -- row would fail on a constraint this test isn't about.
  select p.id into v_clin
  from public.profiles p
  where p.role = 'clinician' and p.organisation_id = v_org
    and not exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id)
  limit 1;
  if v_clin is null then raise exception 'SETUP: no clinician profile without a clinical_staff row found in org %', v_org; end if;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at)
  values (v_org, v_clin, 'Diagnostic Ordering Test Clinician', true, now())
  returning id into v_staff_id;

  select id into v_bundle_id from public.panel_bundles where code = 'single_fbc' limit 1;
  if v_bundle_id is null then raise exception 'SETUP: single_fbc bundle not found'; end if;

  -- 1. NEGATIVE: clinician order with no clinical_indication.
  v_failed := false;
  begin
    insert into public.lab_orders
      (organisation_id, patient_id, panel_bundle_id, origin, ordered_by)
    values (v_org, v_pat, v_bundle_id, 'clinically_triggered', v_staff_id);
  exception when sqlstate '23514' then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 1: order with no clinical_indication was accepted'; end if;
  raise notice 'PASS 1: clinician order rejected with no clinical_indication';

  -- 2. POSITIVE CONTROL: with clinical_indication, defaults to routine urgency.
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, origin, ordered_by, clinical_indication)
  values (v_org, v_pat, v_bundle_id, 'clinically_triggered', v_staff_id, 'Routine annual FBC')
  returning id into v_order_id;

  select * into v_row from public.lab_orders where id = v_order_id;
  if v_row.urgency is distinct from 'routine' then
    raise exception 'FAIL 2: urgency did not default to routine, got %', v_row.urgency;
  end if;
  if v_row.clinical_indication is distinct from 'Routine annual FBC' then
    raise exception 'FAIL 2b: clinical_indication did not save';
  end if;
  raise notice 'PASS 2: clinician order with clinical_indication succeeds, urgency defaults routine';

  -- 3. Explicit urgent order, and it satisfies the operational-queue index's
  --    own predicate (urgency = 'urgent' and status not in resulted/cancelled).
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, origin, ordered_by, clinical_indication, urgency)
  values (v_org, v_pat, v_bundle_id, 'clinically_triggered', v_staff_id, 'Suspected acute anaemia', 'urgent')
  returning id into v_order_urgent;

  if not exists (
    select 1 from public.lab_orders
    where id = v_order_urgent and urgency = 'urgent' and status not in ('resulted', 'cancelled')
  ) then
    raise exception 'FAIL 3: urgent order does not match lab_orders_urgent_open_idx predicate';
  end if;
  raise notice 'PASS 3: urgent order recorded and matches the operational-queue predicate';

  -- 4. Amendment: doc_b (later) corrects doc_a (earlier) -> doc_a gets stamped.
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, source)
  values (v_org, v_pat, 'test/diag-order-a.pdf', 'patient')
  returning id into v_doc_a;

  insert into public.lab_result_documents (organisation_id, patient_id, file_path, source)
  values (v_org, v_pat, 'test/diag-order-b.pdf', 'lab_liaison')
  returning id into v_doc_b;

  update public.lab_result_documents set supersedes_document_id = v_doc_a where id = v_doc_b;

  select * into v_doc_row from public.lab_result_documents where id = v_doc_a;
  if v_doc_row.superseded_by_document_id is distinct from v_doc_b or v_doc_row.superseded_at is null then
    raise exception 'FAIL 4: superseded document was not stamped';
  end if;
  raise notice 'PASS 4: correcting document stamps the original superseded_by_document_id/superseded_at';

  -- 5. NEGATIVE: a document cannot supersede itself.
  v_failed := false;
  begin
    update public.lab_result_documents set supersedes_document_id = id where id = v_doc_a;
  exception when sqlstate '23514' then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 5: self-supersede was accepted'; end if;
  raise notice 'PASS 5: a document cannot supersede itself';

  -- 6. NEGATIVE: a second document cannot also claim to supersede doc_a,
  --    which is already superseded by doc_b.
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, source)
  values (v_org, v_pat, 'test/diag-order-c.pdf', 'clinician')
  returning id into v_doc_c;

  v_failed := false;
  begin
    update public.lab_result_documents set supersedes_document_id = v_doc_a where id = v_doc_c;
  exception when sqlstate '23514' then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 6: double-supersede of the same target was accepted'; end if;
  raise notice 'PASS 6: a document already superseded cannot be superseded again';

  raise notice 'ALL DIAGNOSTIC ORDERING / INVESTIGATION MANAGEMENT CHECKS PASSED';
end $$;

rollback;
