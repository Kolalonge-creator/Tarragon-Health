-- Two-tier decisions, 2026-10-12 (code review of integration/two-tier), item 1: REFUND.
--
--   * A Membership is refundable only within 21 days of purchase (membership.refund, window_days 21, PROPOSED, versioned in
--     membership_policy_config and mirrored in packages/shared/src/proposed-config/registry.ts with a drift test). After that
--     public.request_order_refund answers 'outside_refund_window' and files nothing.
--   * An APPROVED refund ends Member access IMMEDIATELY: patient_memberships.state becomes 'ended' (not the 14 day grace, which now
--     applies only to a year that ends naturally), the order entitlement is revoked, open follow-up offers are withdrawn, booked
--     follow-ups in the future are cancelled, the monthly entitlement rows are closed ('voided'), and when the person has open
--     clinical tasks or a follow-up was cancelled the existing neutral membership_handoff task goes to a doctor. Only a purchase or
--     voucher Membership is ended; an organisation seat (source 'employer') is never touched by a personal refund.
--   * decide_order_refund and request_order_refund are the LIVE definitions (read with pg_get_functiondef on 2026-10-12) with only
--     the changes above. The earlier branch migration 20261013010732 had turned a refund into a grace; this supersedes it.
-- LIVE COUNTS BEFORE (read-only, 2026-10-12): orders 0, refunds 0, patient_memberships 0, so no existing row changes meaning.
-- ROLLBACK: create or replace the two functions with the 20261013010732 / live bodies; drop function private.end_membership_now;
--   drop table public.membership_policy_config.

create table public.membership_policy_config (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('refund', 'renewal')),
  version        integer not null check (version > 0),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null check (jsonb_typeof(rules) = 'object'),
  created_at     timestamptz not null default now(),
  unique (kind, version)
);
create unique index membership_policy_config_one_active on public.membership_policy_config (kind) where is_active;
alter table public.membership_policy_config enable row level security;
revoke all on public.membership_policy_config from public, anon, authenticated;

-- membership-refund-begin (mirrored as membership.refund in packages/shared/src/proposed-config/registry.ts)
insert into public.membership_policy_config (kind, version, is_active, effective_from, rules)
values ('refund', 1, true, date '2026-10-12', $json${"window_days":21}$json$::jsonb);
-- membership-refund-end

-- membership-renewal-begin (mirrored as membership.renewal in packages/shared/src/proposed-config/registry.ts)
insert into public.membership_policy_config (kind, version, is_active, effective_from, rules)
values ('renewal', 1, true, date '2026-10-12', $json${"min_days_between_requests":28}$json$::jsonb);
-- membership-renewal-end

create function private.membership_refund_window_days() returns integer language sql stable security definer set search_path = ''
as $$ select coalesce((select (rules ->> 'window_days')::integer from public.membership_policy_config where kind = 'refund' and is_active), 21) $$;
revoke all on function private.membership_refund_window_days() from public, anon, authenticated;

create function private.membership_renewal_min_days() returns integer language sql stable security definer set search_path = ''
as $$ select coalesce((select (rules ->> 'min_days_between_requests')::integer from public.membership_policy_config where kind = 'renewal' and is_active), 28) $$;
revoke all on function private.membership_renewal_min_days() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Ending a Membership on the spot (a refund, not a lapse)
-- ---------------------------------------------------------------------------------------------------------------------
create function private.end_membership_now(p_membership uuid, p_by uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  m public.patient_memberships%rowtype;
  a record;
  v_cancelled integer := 0;
  v_open boolean;
begin
  select * into m from public.patient_memberships where id = p_membership for update;
  if not found or m.state <> 'active' then return false; end if;

  update public.patient_memberships
     set state = 'ended', ended_at = now(), ended_by = p_by, end_reason = p_reason
   where id = m.id;
  -- the membership trigger has now closed every 'available' month

  update public.followup_offer_slots set state = 'withdrawn' where patient_id = m.patient_id and state = 'offered';
  update public.followup_offers set status = 'withdrawn', closed_at = now(), closed_reason = 'membership_ended'
   where patient_id = m.patient_id and status = 'open';

  for a in
    select ap.id from public.appointments ap
      join public.member_followup_entitlements e on e.appointment_id = ap.id
     where e.membership_id = m.id and e.state = 'booked' and ap.scheduled_for > now()
       and ap.status::text in ('scheduled', 'held', 'booked', 'confirmed')
  loop
    update public.appointments
       set status = 'provider_cancelled', cancelled_at = now(), cancelled_by = p_by, cancellation_reason = 'Membership ended'
     where id = a.id;
    v_cancelled := v_cancelled + 1;
  end loop;
  update public.member_followup_entitlements set state = 'voided', updated_at = now()
   where membership_id = m.id and state in ('available', 'booked');

  v_open := v_cancelled > 0
         or exists (select 1 from public.clinical_tasks t where t.patient_id = m.patient_id and t.state::text not in ('completed', 'cancelled'));
  if v_open then
    perform private.create_clinical_task(m.patient_id, 'membership_handoff', null, 'membership_handoff:' || m.id);
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (m.organisation_id, p_by, 'membership.ended_now', 'patient_memberships', m.id,
          jsonb_build_object('reason', p_reason, 'followups_cancelled', v_cancelled, 'handoff_task', v_open));
  return true;
end $$;
revoke all on function private.end_membership_now(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Refund request: inside the window only
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.request_order_refund(p_order uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o public.orders%rowtype;
  v_refund uuid;
  v_days integer := private.membership_refund_window_days();
begin
  if v_uid is null then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order and buyer_profile_id = v_uid;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.state <> 'paid' then return jsonb_build_object('result', 'order_not_paid', 'state', o.state); end if;
  if exists (select 1 from public.catalog_items ci where ci.id = o.catalog_item_id and ci.kind = 'membership')
     and (o.paid_at is null or now() > o.paid_at + make_interval(days => v_days)) then
    return jsonb_build_object('result', 'outside_refund_window', 'window_days', v_days);
  end if;
  if length(coalesce(p_reason, '')) < 5 then return jsonb_build_object('result', 'reason_too_short'); end if;
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test)
  values (o.organisation_id, o.id, o.amount_kobo, p_reason, v_uid, o.is_test)
  on conflict (order_id) where state in ('pending', 'approved', 'processing', 'completed') do nothing
  returning id into v_refund;
  if v_refund is null then return jsonb_build_object('result', 'already_requested'); end if;
  return jsonb_build_object('result', 'requested', 'refund_id', v_refund);
end $$;

create or replace function public.decide_order_refund(p_refund uuid, p_approved boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.refunds%rowtype;
  o public.orders%rowtype;
  e public.entitlements%rowtype;
  m record;
  v_ended boolean := false;
begin
  if not private.is_admin() then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'pending' then return jsonb_build_object('result', 'already_decided', 'state', r.state); end if;
  if not p_approved then
    update public.refunds set state = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = p_note where id = p_refund;
    return jsonb_build_object('result', 'rejected', 'refund_id', p_refund);
  end if;
  update public.refunds set state = 'approved', decided_by = v_uid, decided_at = now(), decision_note = p_note where id = p_refund;
  select * into o from public.orders where id = r.order_id;
  select * into e from public.entitlements where order_id = r.order_id and state = 'active';
  if e.id is not null then
    update public.entitlements set state = 'revoked' where id = e.id;
  end if;
  if o.state = 'paid' then
    update public.orders set state = 'refunded' where id = o.id;
  end if;
  -- Member access ends NOW. The 14 day grace is for a year that ends naturally, never for a refund. An organisation seat is not touched.
  if e.id is not null then
    for m in select id from public.patient_memberships
              where patient_id = o.beneficiary_patient_id and state = 'active' and source in ('purchase', 'voucher') loop
      v_ended := private.end_membership_now(m.id, v_uid, 'Membership refunded (refund ' || p_refund || ')') or v_ended;
    end loop;
  end if;
  return jsonb_build_object('result', 'approved', 'refund_id', p_refund, 'order_id', o.id,
                            'entitlement_revoked', e.id is not null, 'membership_ended', v_ended, 'amount_kobo', r.amount_kobo,
                            'paystack_reference', o.paystack_reference);
end $$;
revoke all on function public.decide_order_refund(uuid, boolean, text) from public, anon;
revoke all on function public.request_order_refund(uuid, text) from public, anon;
grant execute on function public.decide_order_refund(uuid, boolean, text), public.request_order_refund(uuid, text) to authenticated;

do $$
begin
  if private.membership_refund_window_days() <> 21 then raise exception 'two-tier: refund window is not 21 days'; end if;
  if private.membership_renewal_min_days() <> 28 then raise exception 'two-tier: renewal spacing is not 28 days'; end if;
  if has_function_privilege('anon', 'public.request_order_refund(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.decide_order_refund(uuid, boolean, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.end_membership_now(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'two-tier: a refund function is callable by the wrong role';
  end if;
end $$;
