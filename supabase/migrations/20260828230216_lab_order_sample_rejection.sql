-- Tarragon Health — Laboratory Engine, 14.15 (failed sample), step 2 of 2.
--
-- WHAT THIS ADDS
-- A rejected specimen (haemolysed, insufficient volume, wrong tube, clotted,
-- mislabelled — the everyday reasons a lab bounces a sample) becomes a real,
-- attributable, notified event instead of only a post-hoc refund reason:
--   1. rejection_reason/rejected_at/rejected_by on lab_orders, server-derived
--      and immutable once set — the same null-gated attribution discipline as
--      reviewed_by/reviewed_at (docs/CLINICAL_TRUST_MODEL_SPEC.md §2).
--   2. private.handle_lab_order_sample_rejected(): fires once, on the
--      transition into 'sample_rejected', and does exactly the three things
--      spec §14.15 asks for — "the system should create a new action and
--      notify the patient":
--        a. if this order was fulfilling a due screening_schedule, reopens
--           it (booked -> pending/overdue) so the patient's EXISTING,
--           already-proven self-service booking flow simply offers the test
--           again — no new lab_orders row is synthesised here;
--        b. notifies the patient (in_app + whatsapp, confirmation-only per
--           CLAUDE.md's WhatsApp-is-never-transactional rule);
--        c. raises an operational clinician_alerts row via the shared
--           private.raise_clinician_alert() helper (20260828015618),
--           reusing the existing 'laboratory_failure' type_code rather than
--           adding an 17th value to the governed 16-value alert_type_code
--           taxonomy (20260828013011 asserts exactly 16 — this is a closed
--           list, not one this feature gets to extend).
--
-- WHY NO AUTOMATIC REPEAT lab_orders ROW
-- lab_orders carries a dense stack of BEFORE INSERT guards (origin,
-- region, home-visit-provider-active, computed pricing, not-below-partner-
-- cost, subscriber discount, order-number assignment — see \d+ lab_orders on
-- the live project) that a synthesised INSERT would have to satisfy
-- correctly for every origin/fulfilment combination to avoid either being
-- rejected outright or, worse, silently mis-priced. For the one case that
-- IS safe to reopen automatically (a due-screening self-service booking),
-- reopening the existing screening_schedule and letting the patient rebook
-- through the real, already-guarded path is strictly safer than replaying
-- those guards from a trigger. For a clinician-ordered or partner-billed
-- test, arranging the repeat is left to the staff member the alert reaches —
-- consistent with this codebase's general posture that automation drafts or
-- flags financial/clinical actions rather than deciding them unattended.
--
-- Blast radius counted live before writing this: 2 lab_orders rows total,
-- neither past 'ordered'/'pending_payment' — no row anywhere is in
-- 'sample_collected'/'processing', so there is no data-conversion step.

alter table public.lab_orders
  add column if not exists rejection_reason text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references public.profiles (id) on delete set null;

alter table public.lab_orders
  add constraint lab_orders_sample_rejected_has_reason
  check (status <> 'sample_rejected' or (rejection_reason is not null and rejected_at is not null));

comment on column public.lab_orders.rejection_reason is
  'Why the lab bounced the specimen (haemolysed, insufficient volume, wrong tube, clotted, mislabelled, ...). Free text — the range of real-world rejection reasons is too open to enumerate usefully. Required and frozen once status = sample_rejected.';
comment on column public.lab_orders.rejected_at is
  'Stamped once, server-side, on the transition into sample_rejected. Never backfilled, never client-settable — see private.stamp_lab_order_rejected.';
comment on column public.lab_orders.rejected_by is
  'Who recorded the rejection (server-derived from auth.uid() where the transition happens in the caller''s own session; null for a service-role/RPC-derived actor such as the lab-partner path, which has no direct session on this table).';

create index if not exists lab_orders_sample_rejected_idx
  on public.lab_orders (organisation_id, rejected_at)
  where status = 'sample_rejected';

-- ---------------------------------------------------------------------------
-- 1. BEFORE UPDATE: server-derive the rejection stamp, reject a blank reason
--    early with a readable message (the CHECK above is the hard backstop).
-- ---------------------------------------------------------------------------
create or replace function private.stamp_lab_order_rejected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'sample_rejected' and old.status is distinct from 'sample_rejected' then
    if coalesce(btrim(new.rejection_reason), '') = '' then
      raise exception 'A rejection reason is required' using errcode = '22023';
    end if;
    new.rejection_reason := btrim(new.rejection_reason);
    new.rejected_at := now();
    new.rejected_by := (select auth.uid());
  elsif old.status = 'sample_rejected' then
    -- Frozen once recorded — matches lab_result_documents' reviewed_at
    -- freeze pattern (private.enforce_lab_result_document_update).
    new.rejection_reason := old.rejection_reason;
    new.rejected_at := old.rejected_at;
    new.rejected_by := old.rejected_by;
  end if;
  return new;
end;
$$;

drop trigger if exists lab_orders_stamp_rejected on public.lab_orders;
create trigger lab_orders_stamp_rejected
  before update on public.lab_orders
  for each row execute function private.stamp_lab_order_rejected();

-- ---------------------------------------------------------------------------
-- 2. AFTER UPDATE: reopen the due screening, notify the patient, raise the
--    operational alert. security definer — a lab-partner-driven transition
--    has no direct session grant on screening_schedules/notifications/
--    clinician_alerts (private.lab_partner_provider() is the only surface a
--    lab_partner role can act through), so this must run with elevated
--    rights, exactly like private.handle_lab_result_document already does
--    for the same class of patient-facing side effect.
-- ---------------------------------------------------------------------------
create or replace function private.handle_lab_order_sample_rejected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bundle_name text;
  v_reopened boolean := false;
  v_reopened_count integer;
  v_alert_detail text;
begin
  if not (new.status = 'sample_rejected' and old.status is distinct from 'sample_rejected') then
    return new;
  end if;

  select name into v_bundle_name from public.panel_bundles where id = new.panel_bundle_id;

  -- 2a. A due-screening self-service booking: reopen it so the patient's
  -- existing "book this due screening" flow offers the test again. Only
  -- when it is still in the 'booked' state this order itself put it in —
  -- never claw back a schedule some other event has already moved on from.
  if new.screening_schedule_id is not null then
    update public.screening_schedules
    set status = case when due_date <= current_date then 'overdue' else 'pending' end
    where id = new.screening_schedule_id
      and status = 'booked';
    get diagnostics v_reopened_count = row_count;
    v_reopened := v_reopened_count > 0;
  end if;

  -- 2b. Notify the patient — confirmation-only, never the transactional
  -- interface (CLAUDE.md "What Claude Must Never Do").
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values
    (new.organisation_id, new.patient_id, 'in_app', 'pending', 'lab_sample_rejected',
      jsonb_build_object('order_number', new.order_number, 'test_name', coalesce(v_bundle_name, 'your test'),
        'reason', new.rejection_reason, 'schedule_reopened', v_reopened)),
    (new.organisation_id, new.patient_id, 'whatsapp', 'pending', 'lab_sample_rejected',
      jsonb_build_object('order_number', new.order_number, 'test_name', coalesce(v_bundle_name, 'your test'),
        'reason', new.rejection_reason, 'schedule_reopened', v_reopened));

  -- 2c. Operational escalation — "a new action", per spec §14.15's own
  -- diagram wording, for whoever needs to arrange the repeat.
  v_alert_detail := format(
    'Lab order %s (%s) had its sample rejected: %s.',
    coalesce(new.order_number, new.id::text), coalesce(v_bundle_name, 'lab test'), new.rejection_reason
  );
  v_alert_detail := v_alert_detail || case
    when v_reopened then ' The linked screening has been reopened so the patient can rebook it themselves.'
    when new.fulfilment = 'partner' then ' A repeat sample needs arranging with the lab.'
    else ' The patient needs to arrange a repeat sample.'
  end;

  perform private.raise_clinician_alert(
    new.organisation_id, new.patient_id, 'clinician_review',
    'Lab sample rejected — repeat needed', v_alert_detail,
    'operational', 'laboratory_failure'
  );

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.rejected_by, 'lab_order.sample_rejected',
    'lab_orders', new.id,
    jsonb_build_object('reason', new.rejection_reason, 'schedule_reopened', v_reopened, 'fulfilment', new.fulfilment::text)
  );

  return new;
end;
$$;

drop trigger if exists lab_orders_sample_rejected on public.lab_orders;
create trigger lab_orders_sample_rejected
  after update on public.lab_orders
  for each row execute function private.handle_lab_order_sample_rejected();

-- ---------------------------------------------------------------------------
-- 3. Lab-partner-facing RPC — a lab_partner has no direct RLS write on
--    lab_orders (private.is_org_staff excludes lab_partner by design, see
--    20260729234618_harden_is_org_staff_exclude_lab_partner.sql), so marking
--    a rejection needs the same SECURITY DEFINER + private.lab_partner_provider()
--    ownership check as lab_partner_upload_result.
-- ---------------------------------------------------------------------------
create or replace function public.lab_partner_reject_sample(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.lab_orders%rowtype;
begin
  select * into v_order
  from public.lab_orders
  where id = p_order_id and provider_id = private.lab_partner_provider();

  if v_order.id is null then
    raise exception 'Order not found for this lab' using errcode = '42501';
  end if;
  if v_order.status not in ('sample_collected', 'processing') then
    raise exception 'Only a collected sample can be marked rejected' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A rejection reason is required' using errcode = '22023';
  end if;

  update public.lab_orders
  set status = 'sample_rejected', rejection_reason = p_reason
  where id = p_order_id;
end;
$$;

comment on function public.lab_partner_reject_sample(uuid, text) is
  'A lab partner marks one of their own routed orders sample_rejected. Ownership re-checked here (not trusted from any prior lookup); side effects (schedule reopen, patient notification, operational alert) all live in the lab_orders trigger, not here, so the same rejection recorded any other way (future admin/liaison path) gets identical behaviour for free.';

revoke all on function public.lab_partner_reject_sample(uuid, text) from public, anon;
grant execute on function public.lab_partner_reject_sample(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.lab_partner_reject_sample(uuid, text)', 'EXECUTE') then
    raise exception 'anon can execute lab_partner_reject_sample — the revoke did not take (revoke from public, not just anon — see CLAUDE.md''s anon-execute gotcha)';
  end if;
  if not has_function_privilege('authenticated', 'public.lab_partner_reject_sample(uuid, text)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on lab_partner_reject_sample';
  end if;
end $$;
