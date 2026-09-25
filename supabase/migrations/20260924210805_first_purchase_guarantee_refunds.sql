-- Tarragon Health — First-purchase money-back guarantee (Risk-Reversal Guarantee).
--
-- SCOPE (product decision confirmed 2026-09-24): applies to a patient's very
-- first-ever service_purchases activation — a one-off consult OR the 12-week
-- doctor-supported chronic-care pack, whichever it happens to be — refunding
-- the FULL amount actually paid (service_purchases.payable_kobo, which
-- already nets out any voucher/promo-code discount) if the patient asks
-- within 30 days of purchase. There is no "first month" carve-out: the
-- chronic-care pack is billed as one lump-sum 84-day purchase with no
-- monthly billing unit anywhere in the schema (confirmed by reading
-- 20260831140512_service_products_and_purchases_core.sql and the finance
-- posting migrations before writing this), so pro-rating it would mean
-- inventing a billing concept this platform doesn't have — deliberately not
-- done here. One guarantee claim per purchase, and because only a patient's
-- first-ever purchase is ever eligible, that is structurally also "once per
-- patient, ever" — no separate per-patient uniqueness constraint is needed.
--
-- Eligibility is restricted to payment_provider in ('paystack',
-- 'platform_credit') — the two providers where the PATIENT's own money paid
-- for the purchase. A purchase funded by 'voucher'/'employer'/'wallet' has
-- no patient cash behind it to hand back; a claim against one is refused
-- with reason 'not_eligible_provider' rather than silently doing nothing.
--
-- REFUND MECHANICS reuse the established patterns from
-- 20260830103626_care_voucher_cancellation_refunds.sql (card refunds: a
-- queue table + the same refundTransaction()/recordRefundLedgerEntry() cron
-- shape) and 20260905204245_reverse_phantom_service_purchase_revenue.sql
-- (how to correctly wind down a revenue_recognition_schedules row: reverse
-- every already-posted recognition tranche, not just the original entry, or
-- a bounded-duration purchase refunded partway through its window leaves
-- already-recognised revenue unreversed on the books).
--
--   - paystack-paid: reverse the original 'payment' GL entry + any posted
--     recognition tranches immediately (synchronous, so the ledger is
--     correct the moment an admin approves), then queue an actual Paystack
--     refund via the service-purchase-guarantee-refunds cron (apps/web),
--     which reuses the same refundTransaction()/recordRefundLedgerEntry()
--     helpers and idempotency-key derivation the voucher cron already uses.
--   - platform_credit-paid: reverse the original 'platform_credit' spend GL
--     entry(ies) + any posted recognition tranches, then restore the
--     patient's balance via the existing public.correct_platform_credit(...)
--     primitive (bucket-aware: a spend draws promo-first-then-paid, so the
--     reversal is split the same way the original spend was, read back from
--     the specific ledger row this purchase created) — synchronous, no
--     queue/cron needed, the patient's balance is back immediately.
--
-- A refunded chronic-care purchase must also give back the access it
-- granted: activate_chronic_programme_doctor_supported_track (20260911211641)
-- upgrades an enrolment's track on purchase, but nothing downgrades it again
-- on refund/cancellation — a real gap, closed below by re-deriving access via
-- the same private.patient_has_feature_access() the enrol-time trigger uses,
-- rather than hand-rolling a second "is there still a live purchase" check.
--
-- Patient-initiated request -> admin review/approve -> refund, per this
-- feature's own "even a manual request-then-approve flow is fine for v1"
-- guardrail — no automatic self-service refund button, an admin always
-- reviews first.

-- ---------------------------------------------------------------------------
-- 1. service_purchase_guarantee_claims — one claim per purchase (unique
--    constraint), which is also what makes this "once per patient ever": a
--    patient's only ever-eligible purchase is their first one.
-- ---------------------------------------------------------------------------
create table public.service_purchase_guarantee_claims (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  service_purchase_id  uuid not null unique references public.service_purchases (id) on delete restrict,
  status               text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  reason               text,
  requested_at         timestamptz not null default now(),
  reviewed_by          uuid references public.profiles (id) on delete set null,
  reviewed_at          timestamptz,
  decision_note        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index service_purchase_guarantee_claims_patient_idx
  on public.service_purchase_guarantee_claims (patient_id, created_at desc);
create index service_purchase_guarantee_claims_status_idx
  on public.service_purchase_guarantee_claims (status) where status = 'pending';

create trigger service_purchase_guarantee_claims_set_updated_at
  before update on public.service_purchase_guarantee_claims
  for each row execute function private.set_updated_at();

alter table public.service_purchase_guarantee_claims enable row level security;

-- Table-level grant is separate from RLS (RLS restricts rows, it does not
-- grant table access) — see CLAUDE.md's "freshly created table" lesson.
grant select on public.service_purchase_guarantee_claims to authenticated;

create policy service_purchase_guarantee_claims_select
  on public.service_purchase_guarantee_claims for select
  to authenticated
  using (patient_id = (select auth.uid()) or private.is_admin());

-- No insert/update policy for authenticated — every write goes through the
-- SECURITY DEFINER RPCs below, which enforce eligibility/authorisation
-- themselves rather than relying on a row-level check a client request could
-- be shaped to satisfy incidentally.

-- ---------------------------------------------------------------------------
-- 2. service_purchase_refund_queue — same shape as voucher_refund_queue,
--    scoped to service_purchases guarantee refunds. Swept by the
--    service-purchase-guarantee-refunds cron (apps/web).
-- ---------------------------------------------------------------------------
create table public.service_purchase_refund_queue (
  id                    uuid primary key default gen_random_uuid(),
  service_purchase_id   uuid not null references public.service_purchases (id) on delete restrict,
  guarantee_claim_id    uuid not null unique references public.service_purchase_guarantee_claims (id) on delete restrict,
  provider              text not null,
  provider_reference    text not null,
  amount_minor          bigint not null check (amount_minor > 0),
  currency              public.currency not null,
  status                text not null default 'due' check (status in ('due', 'refunded', 'failed')),
  provider_refund_ref   text,
  attempts              integer not null default 0,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index service_purchase_refund_queue_due_idx
  on public.service_purchase_refund_queue (status) where status = 'due';

create trigger service_purchase_refund_queue_set_updated_at
  before update on public.service_purchase_refund_queue
  for each row execute function private.set_updated_at();

alter table public.service_purchase_refund_queue enable row level security;

grant select on public.service_purchase_refund_queue to authenticated;

create policy service_purchase_refund_queue_select
  on public.service_purchase_refund_queue for select
  to authenticated
  using (private.is_admin() or exists (
    select 1 from public.service_purchases sp
    where sp.id = service_purchase_refund_queue.service_purchase_id
      and sp.patient_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- 3. request_purchase_guarantee_refund — patient-callable.
-- ---------------------------------------------------------------------------
create or replace function public.request_purchase_guarantee_refund(
  p_service_purchase_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_purchase public.service_purchases%rowtype;
  v_first_purchase_id uuid;
  v_amount_kobo bigint;
  v_claim_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select * into v_purchase from public.service_purchases
    where id = p_service_purchase_id for update;
  if not found or v_purchase.patient_id <> v_caller then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_purchase.status not in ('active', 'expired') then
    return jsonb_build_object('ok', false, 'reason', 'not_refundable_status', 'status', v_purchase.status);
  end if;

  if v_purchase.payment_provider is null or v_purchase.payment_provider not in ('paystack', 'platform_credit') then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible_provider');
  end if;

  v_amount_kobo := coalesce(v_purchase.payable_kobo, v_purchase.amount_kobo);
  if v_amount_kobo is null or v_amount_kobo <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'nothing_paid');
  end if;

  if v_purchase.purchased_at is null or now() > v_purchase.purchased_at + interval '30 days' then
    return jsonb_build_object('ok', false, 'reason', 'window_expired');
  end if;

  -- "First-ever purchase" = the earliest activated purchase for this
  -- patient (a pending_payment row that never activated doesn't count).
  select sp.id into v_first_purchase_id
    from public.service_purchases sp
    where sp.patient_id = v_caller
      and sp.status in ('active', 'expired', 'refunded')
      and sp.purchased_at is not null
    order by sp.purchased_at asc, sp.id asc
    limit 1;

  if v_first_purchase_id is distinct from v_purchase.id then
    return jsonb_build_object('ok', false, 'reason', 'not_first_purchase');
  end if;

  if exists (select 1 from public.service_purchase_guarantee_claims where service_purchase_id = v_purchase.id) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;

  insert into public.service_purchase_guarantee_claims
    (organisation_id, patient_id, service_purchase_id, reason)
  values (v_purchase.organisation_id, v_caller, v_purchase.id, nullif(trim(coalesce(p_reason, '')), ''))
  returning id into v_claim_id;

  perform private.log_audit('service_purchase_guarantee.requested', 'service_purchase_guarantee_claims', v_claim_id,
    jsonb_build_object('service_purchase_id', v_purchase.id, 'amount_kobo', v_amount_kobo));

  return jsonb_build_object('ok', true, 'claim_id', v_claim_id);
end;
$$;

revoke execute on function public.request_purchase_guarantee_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.request_purchase_guarantee_refund(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. decide_purchase_guarantee_refund — admin-only. Approve reverses the GL
--    (synchronously) and either queues a Paystack refund or restores the
--    patient's platform credit balance immediately, depending on how the
--    purchase was originally paid for. Deny just records the decision.
-- ---------------------------------------------------------------------------
create or replace function public.decide_purchase_guarantee_refund(
  p_claim_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_claim public.service_purchase_guarantee_claims%rowtype;
  v_purchase public.service_purchases%rowtype;
  v_amount_kobo bigint;
  v_txn_id uuid;
  v_entry uuid;
  v_schedule record;
  v_recog record;
  v_ledger public.platform_credit_ledger_entries%rowtype;
  v_refund_mode text;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if not private.is_admin() then
    raise exception 'not authorised to decide a guarantee refund' using errcode = '42501';
  end if;

  select * into v_claim from public.service_purchase_guarantee_claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found';
  end if;
  if v_claim.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided', 'status', v_claim.status);
  end if;

  if not p_approve then
    update public.service_purchase_guarantee_claims
      set status = 'denied', reviewed_by = v_caller, reviewed_at = now(), decision_note = p_note
      where id = p_claim_id;
    perform private.log_audit('service_purchase_guarantee.denied', 'service_purchase_guarantee_claims', p_claim_id,
      jsonb_build_object('note', p_note));
    return jsonb_build_object('ok', true, 'status', 'denied');
  end if;

  select * into v_purchase from public.service_purchases where id = v_claim.service_purchase_id for update;
  if not found then
    raise exception 'purchase not found for claim %', p_claim_id;
  end if;
  if v_purchase.status not in ('active', 'expired') then
    -- Race guard: something else (an expiry sweep, another admin) changed
    -- the purchase between request and decision.
    return jsonb_build_object('ok', false, 'reason', 'purchase_no_longer_refundable', 'status', v_purchase.status);
  end if;

  v_amount_kobo := coalesce(v_purchase.payable_kobo, v_purchase.amount_kobo);

  update public.service_purchases set status = 'refunded' where id = v_purchase.id;

  -- Give back any access this purchase granted. Re-derive via the same
  -- feature-access check the enrol-time trigger uses (now sees the
  -- 'refunded' status just written above) rather than hand-rolling a
  -- second "is another live purchase still granting this" query.
  if v_purchase.scoped_entity_type = 'chronic_programme_enrolments' and v_purchase.scoped_entity_id is not null then
    if not private.patient_has_feature_access(v_purchase.patient_id, 'chronic_doctor_supported_track') then
      update public.chronic_programme_enrolments
        set track = 'self_monitoring'
        where id = v_purchase.scoped_entity_id
          and status = 'enrolled'
          and track = 'doctor_supported';
    end if;
  end if;

  -- Wind down any revenue recognition schedule for this purchase — reverse
  -- every already-posted tranche, not just the original entry (see this
  -- migration's header and 20260905204245_reverse_phantom_service_purchase_
  -- revenue.sql for why: a bounded-duration purchase refunded partway
  -- through its window has already recognised some revenue, and reversing
  -- only the original entry would leave that recognised revenue unreversed).
  for v_schedule in
    select * from public.revenue_recognition_schedules
    where source_kind = 'service_purchase' and source_id = v_purchase.id and status = 'active'
  loop
    for v_recog in
      select id from public.finance_journal_entries
      where source = 'revenue_recognition'
        and source_ref like 'revrec:' || v_schedule.id::text || ':%'
        and is_reversed = false
    loop
      perform private.finance_reverse_entry(v_recog.id,
        'First-purchase guarantee approved for service purchase ' || v_purchase.id::text, v_caller);
    end loop;

    update public.revenue_recognition_schedules
      set status = 'cancelled',
          cancelled_reason = 'Guarantee refund approved ' || to_char(now(), 'YYYY-MM-DD') ||
            ' for the service_purchase this schedule recognises revenue against (claim ' || p_claim_id::text || ').'
      where id = v_schedule.id;
  end loop;

  if v_purchase.payment_provider = 'paystack' then
    -- Correlate to the payment_transactions row the same way
    -- finance_post_from_payment does, then reverse its GL entry.
    select id into v_txn_id from public.payment_transactions
      where raw_payload #>> '{data,reference}' = v_purchase.payment_provider_ref
         or raw_payload #>> '{data,object,id}' = v_purchase.payment_provider_ref
      order by created_at desc limit 1;

    if v_txn_id is not null then
      select id into v_entry from public.finance_journal_entries
        where source = 'payment' and source_ref = v_txn_id::text and is_reversed = false;
      if v_entry is not null then
        perform private.finance_reverse_entry(v_entry,
          'First-purchase guarantee approved for service purchase ' || v_purchase.id::text, v_caller);
      end if;
    end if;

    insert into public.service_purchase_refund_queue
      (service_purchase_id, guarantee_claim_id, provider, provider_reference, amount_minor, currency)
    values
      (v_purchase.id, p_claim_id, 'paystack', v_purchase.payment_provider_ref, v_amount_kobo, v_purchase.currency)
    on conflict (guarantee_claim_id) do nothing;

    v_refund_mode := 'queued';

  elsif v_purchase.payment_provider = 'platform_credit' then
    select * into v_ledger from public.platform_credit_ledger_entries
      where service_purchase_id = v_purchase.id and entry_type = 'spend'
      order by created_at desc limit 1;

    if not found then
      raise exception 'no platform credit spend ledger entry found for service purchase %', v_purchase.id;
    end if;

    if v_ledger.paid_amount_kobo > 0 then
      select id into v_entry from public.finance_journal_entries
        where source = 'platform_credit' and source_ref = 'spend-paid:' || v_ledger.id::text and is_reversed = false;
      if v_entry is not null then
        perform private.finance_reverse_entry(v_entry,
          'First-purchase guarantee approved for service purchase ' || v_purchase.id::text, v_caller);
      end if;
      perform public.correct_platform_credit(v_purchase.patient_id, 'paid', 'increase', v_ledger.paid_amount_kobo,
        'First-purchase guarantee approved for service purchase ' || v_purchase.id::text);
    end if;
    if v_ledger.promo_amount_kobo > 0 then
      select id into v_entry from public.finance_journal_entries
        where source = 'platform_credit' and source_ref = 'spend-promo:' || v_ledger.id::text and is_reversed = false;
      if v_entry is not null then
        perform private.finance_reverse_entry(v_entry,
          'First-purchase guarantee approved for service purchase ' || v_purchase.id::text, v_caller);
      end if;
      perform public.correct_platform_credit(v_purchase.patient_id, 'promo', 'increase', v_ledger.promo_amount_kobo,
        'First-purchase guarantee approved for service purchase ' || v_purchase.id::text);
    end if;

    v_refund_mode := 'platform_credit_restored';
  else
    raise exception 'service purchase % has an unexpected payment_provider % for a guarantee refund',
      v_purchase.id, v_purchase.payment_provider;
  end if;

  update public.service_purchase_guarantee_claims
    set status = 'approved', reviewed_by = v_caller, reviewed_at = now(), decision_note = p_note
    where id = p_claim_id;

  perform private.log_audit('service_purchase_guarantee.approved', 'service_purchase_guarantee_claims', p_claim_id,
    jsonb_build_object('service_purchase_id', v_purchase.id, 'amount_kobo', v_amount_kobo, 'refund_mode', v_refund_mode));

  return jsonb_build_object('ok', true, 'status', 'approved', 'refund_mode', v_refund_mode, 'amount_kobo', v_amount_kobo);
end;
$$;

revoke execute on function public.decide_purchase_guarantee_refund(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.decide_purchase_guarantee_refund(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Prove the privilege discipline, rather than hoping — see
--    20260902174504_default_privileges_never_grant_anon_or_authenticated_
--    execute_on_public_functions.sql for why this per-object check is
--    required and ALTER DEFAULT PRIVILEGES alone is not enough.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'service_purchase_guarantee_claims') then
    raise exception 'service_purchase_guarantee_claims was not created';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'service_purchase_refund_queue') then
    raise exception 'service_purchase_refund_queue was not created';
  end if;

  if has_function_privilege('anon', 'public.request_purchase_guarantee_refund(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon must never execute request_purchase_guarantee_refund';
  end if;
  if has_function_privilege('anon', 'public.decide_purchase_guarantee_refund(uuid, boolean, text)', 'EXECUTE') then
    raise exception 'FAIL: anon must never execute decide_purchase_guarantee_refund';
  end if;
  if not has_function_privilege('authenticated', 'public.request_purchase_guarantee_refund(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must be able to execute request_purchase_guarantee_refund';
  end if;
  if not has_function_privilege('authenticated', 'public.decide_purchase_guarantee_refund(uuid, boolean, text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must be able to execute decide_purchase_guarantee_refund';
  end if;

  raise notice 'PASS: first-purchase guarantee refund schema/privileges correct';
end $$;
