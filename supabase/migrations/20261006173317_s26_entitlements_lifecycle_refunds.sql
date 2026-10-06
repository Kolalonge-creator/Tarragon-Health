-- S26: entitlements lifecycle, care pack expiry, refunds, pay-for-a-loved-one
-- Spec 4.8, safety cases 24 (from S25) and 25 (no auto-renewal, 7-day reminder).
-- Depends on S25 (catalog_items, prices, orders, payments, entitlements).

-- ---------------------------------------------------------------------------
-- 1. Entitlements: add reminded_at for the 7-day renewal reminder
-- ---------------------------------------------------------------------------
alter table public.entitlements add column if not exists reminded_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Refunds table
-- ---------------------------------------------------------------------------
create table public.refunds (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  order_id           uuid not null references public.orders (id) on delete restrict,
  amount_kobo        bigint not null check (amount_kobo > 0 and amount_kobo <= 100000000000),
  reason             text not null check (length(reason) >= 5),
  state              text not null default 'pending' check (state in ('pending', 'approved', 'processing', 'completed', 'rejected', 'failed')),
  provider           text not null default 'paystack' check (provider = 'paystack'),
  provider_reference text,
  provider_response  jsonb not null default '{}'::jsonb,
  requested_by       uuid references public.profiles (id) on delete restrict,
  decided_by         uuid references public.profiles (id) on delete restrict,
  decided_at         timestamptz,
  decision_note      text,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((decided_by is null) = (decided_at is null)),
  check (state not in ('approved', 'rejected') or decided_by is not null)
);

create unique index refunds_one_live on public.refunds (order_id)
  where state in ('pending', 'approved', 'processing', 'completed');

create index refunds_org_state_idx on public.refunds (organisation_id, state);

alter table public.refunds enable row level security;
revoke all on public.refunds from public, anon, authenticated;
grant select on public.refunds to authenticated;

create policy refunds_read on public.refunds for select to authenticated
  using (
    exists (
      select 1 from public.orders o
       where o.id = refunds.order_id
         and (o.buyer_profile_id = (select auth.uid()) or o.beneficiary_patient_id = (select auth.uid())
              or (private.is_admin() and o.organisation_id = (select organisation_id from public.profiles where id = (select auth.uid()))))
    )
  );

-- State machine trigger
create function private.refunds_state_machine() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'refund_immutable' using errcode = 'P0001'; end if;
  if new.order_id is distinct from old.order_id or new.amount_kobo is distinct from old.amount_kobo then
    raise exception 'refund_immutable' using errcode = 'P0001';
  end if;
  if new.state is distinct from old.state and not (
       (old.state = 'pending'    and new.state in ('approved', 'rejected'))
    or (old.state = 'approved'   and new.state in ('processing', 'failed'))
    or (old.state = 'processing' and new.state in ('completed', 'failed'))
  ) then
    raise exception 'refund_bad_transition % to %', old.state, new.state using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.refunds_state_machine() from public, anon, authenticated;
create trigger refunds_state_machine before update or delete on public.refunds
  for each row execute function private.refunds_state_machine();

-- ---------------------------------------------------------------------------
-- 3. Entitlement lifecycle functions
-- ---------------------------------------------------------------------------

-- 3a. Consume one use of a counted entitlement (service role only)
create function public.consume_entitlement(p_entitlement uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.entitlements%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'entitlement_not_authorised' using errcode = '42501';
  end if;

  select * into e from public.entitlements where id = p_entitlement for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if e.state <> 'active' then return jsonb_build_object('result', 'not_active', 'state', e.state); end if;
  if e.remaining_uses is null then return jsonb_build_object('result', 'unlimited'); end if;
  if e.remaining_uses <= 0 then return jsonb_build_object('result', 'exhausted'); end if;

  update public.entitlements
     set remaining_uses = remaining_uses - 1,
         state = case when remaining_uses - 1 = 0 then 'used' else state end
   where id = p_entitlement;

  return jsonb_build_object('result', 'consumed', 'remaining', e.remaining_uses - 1);
end $$;
revoke all on function public.consume_entitlement(uuid) from public, anon, authenticated;

-- 3b. Revoke an entitlement (admin, typically on refund)
create function public.revoke_entitlement(p_entitlement uuid, p_reason text default 'refund')
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'entitlement_not_authorised' using errcode = '42501';
  end if;

  update public.entitlements set state = 'revoked'
   where id = p_entitlement and state = 'active';
  return found;
end $$;
revoke all on function public.revoke_entitlement(uuid, text) from public, anon, authenticated;

-- 3c. Expire entitlements past their ends_at (cron)
create function private.expire_entitlements() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.entitlements
     set state = 'expired'
   where state = 'active' and ends_at is not null and ends_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.expire_entitlements() from public, anon, authenticated;

-- 3d. Queue 7-day expiry reminders (cron, safety case 25: notifies only, never extends/renews)
create function private.queue_entitlement_expiry_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select e.id, e.patient_id, e.organisation_id, e.kind, e.ends_at
      from public.entitlements e
     where e.state = 'active'
       and e.ends_at is not null
       and e.ends_at > now()
       and e.ends_at <= now() + interval '7 days'
       and e.reminded_at is null
  loop
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, r.patient_id,
            private.patient_reminder_channel(r.patient_id), 'pending',
            'entitlement_expiring_soon',
            jsonb_build_object(
              'entitlement_id', r.id,
              'kind', r.kind,
              'ends_at', r.ends_at
            ));

    update public.entitlements set reminded_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.queue_entitlement_expiry_reminders() from public, anon, authenticated;

-- Register the CON-010 notification template
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description)
values ('entitlement_expiring_soon', 'operational', 'important', 'patient', '{in_app,push,email}', 'scheduled',
        'Sent 7 days before an entitlement (care pack or membership) expires. Safety case 25: notifies only, never auto-renews.')
on conflict (key) do nothing;

insert into public.notification_template_locales (template_key, locale, channel, subject, body)
values
  ('entitlement_expiring_soon', 'en', 'in_app', 'Your {{kind}} is expiring soon',
   'Your {{kind}} expires on {{ends_at}}. To keep your access, purchase a new one before it runs out.'),
  ('entitlement_expiring_soon', 'en', 'push', 'Your {{kind}} expires soon',
   'Your {{kind}} expires on {{ends_at}}. Renew now to keep your care access.'),
  ('entitlement_expiring_soon', 'en', 'email', 'Your TarragonHealth {{kind}} is expiring soon',
   'Hi there,\n\nYour {{kind}} expires on {{ends_at}}. To continue your care, please purchase a new one before it runs out.\n\nYour care team')
on conflict (template_key, locale, channel) do nothing;

-- Register a refund notification template
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description)
values ('order_refund_completed', 'operational', 'important', 'patient', '{in_app,push,email}', 'immediate',
        'Sent when a refund has been completed and money is on its way back to the patient.')
on conflict (key) do nothing;

insert into public.notification_template_locales (template_key, locale, channel, subject, body)
values
  ('order_refund_completed', 'en', 'in_app', 'Your refund is on its way',
   'Your refund of {{amount}} has been processed. It should arrive in your bank account within 5 to 10 business days.'),
  ('order_refund_completed', 'en', 'push', 'Refund processed',
   'Your refund of {{amount}} has been processed.'),
  ('order_refund_completed', 'en', 'email', 'Your TarragonHealth refund has been processed',
   'Hi there,\n\nYour refund of {{amount}} has been processed and should arrive in your bank account within 5 to 10 business days.\n\nIf you have any questions, your care team is here to help.')
on conflict (template_key, locale, channel) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Refund RPCs
-- ---------------------------------------------------------------------------

-- 4a. Patient requests a refund (buyer only)
create function public.request_order_refund(p_order uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  o public.orders%rowtype;
  v_refund uuid;
begin
  if v_uid is null then raise exception 'refund_not_authorised' using errcode = '42501'; end if;

  select * into o from public.orders where id = p_order and buyer_profile_id = v_uid;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.state <> 'paid' then return jsonb_build_object('result', 'order_not_paid', 'state', o.state); end if;
  if length(coalesce(p_reason, '')) < 5 then return jsonb_build_object('result', 'reason_too_short'); end if;

  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test)
  values (o.organisation_id, o.id, o.amount_kobo, p_reason, v_uid, o.is_test)
  on conflict (order_id) where state in ('pending', 'approved', 'processing', 'completed') do nothing
  returning id into v_refund;

  if v_refund is null then return jsonb_build_object('result', 'already_requested'); end if;
  return jsonb_build_object('result', 'requested', 'refund_id', v_refund);
end $$;
revoke all on function public.request_order_refund(uuid, text) from public, anon;

-- 4b. Admin decides a refund
create function public.decide_order_refund(p_refund uuid, p_approved boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  r public.refunds%rowtype;
  o public.orders%rowtype;
  e public.entitlements%rowtype;
begin
  if not private.is_admin() then raise exception 'refund_not_authorised' using errcode = '42501'; end if;

  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'pending' then return jsonb_build_object('result', 'already_decided', 'state', r.state); end if;

  if not p_approved then
    update public.refunds
       set state = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = p_note
     where id = p_refund;
    return jsonb_build_object('result', 'rejected', 'refund_id', p_refund);
  end if;

  update public.refunds
     set state = 'approved', decided_by = v_uid, decided_at = now(), decision_note = p_note
   where id = p_refund;

  select * into o from public.orders where id = r.order_id;
  select * into e from public.entitlements where order_id = r.order_id and state = 'active';

  if e.id is not null then
    update public.entitlements set state = 'revoked' where id = e.id;
  end if;

  if o.state = 'paid' then
    update public.orders set state = 'refunded' where id = o.id;
  end if;

  if e.id is not null and exists (select 1 from public.patient_memberships where patient_id = o.beneficiary_patient_id and state = 'active') then
    update public.patient_memberships
       set state = 'ended', ended_at = now(), ended_by = v_uid, end_reason = 'Membership refunded (refund ' || p_refund || ')'
     where patient_id = o.beneficiary_patient_id and state = 'active';
  end if;

  return jsonb_build_object('result', 'approved', 'refund_id', p_refund, 'order_id', o.id,
                            'entitlement_revoked', e.id is not null, 'amount_kobo', r.amount_kobo,
                            'paystack_reference', o.paystack_reference);
end $$;
revoke all on function public.decide_order_refund(uuid, boolean, text) from public, anon;

-- 4c. Record Paystack refund result (called by app-layer server action after Paystack API call)
create function public.record_refund_provider_result(p_refund uuid, p_success boolean, p_reference text default null, p_response jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
  o public.orders%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'refund_not_authorised' using errcode = '42501';
  end if;

  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'approved' then return jsonb_build_object('result', 'wrong_state', 'state', r.state); end if;

  if p_success then
    update public.refunds
       set state = 'completed', provider_reference = p_reference, provider_response = p_response
     where id = p_refund;

    select * into o from public.orders where id = r.order_id;

    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, o.buyer_profile_id,
            private.patient_reminder_channel(o.buyer_profile_id), 'pending',
            'order_refund_completed',
            jsonb_build_object('amount', r.amount_kobo, 'order_id', r.order_id));

    return jsonb_build_object('result', 'completed', 'refund_id', p_refund);
  else
    update public.refunds
       set state = 'failed', provider_response = p_response
     where id = p_refund;
    return jsonb_build_object('result', 'failed', 'refund_id', p_refund);
  end if;
end $$;
revoke all on function public.record_refund_provider_result(uuid, boolean, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Pay-for-a-loved-one: open create_order to accept a different beneficiary
-- ---------------------------------------------------------------------------
create or replace function public.create_order(p_code text, p_client_key uuid default null, p_beneficiary uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pr public.profiles%rowtype;
  it public.catalog_items%rowtype;
  px public.prices%rowtype;
  o public.orders%rowtype;
  v_beneficiary uuid;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found then raise exception 'order_not_authorised' using errcode = '42501'; end if;

  v_beneficiary := coalesce(p_beneficiary, v_uid);
  if v_beneficiary <> v_uid then
    if not exists (
      select 1 from public.profile_access
       where grantee_user_id = v_uid and profile_id = v_beneficiary
    ) then
      raise exception 'order_beneficiary_not_allowed' using errcode = '42501';
    end if;
  end if;

  if p_client_key is not null then
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    if found then
      return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', o.checkout_url, 'replay', true);
    end if;
  end if;

  if not coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false) then
    raise exception 'checkout_not_open' using errcode = 'P0001';
  end if;
  select * into it from public.catalog_items where organisation_id = pr.organisation_id and code = p_code;
  if not found or not it.active then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  px := private.current_price(it.id);
  if px.id is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;

  if it.kind = 'membership' and exists (
       select 1 from public.patient_memberships m where m.patient_id = v_beneficiary and m.state = 'active' and (m.ends_at is null or m.ends_at > now())) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  if it.grants_lead and not exists (select 1 from private.lead_candidates(v_beneficiary, '{}', true)) then
    raise exception 'no_capacity' using errcode = 'P0001';
  end if;
  if (select count(*) from public.orders where buyer_profile_id = v_uid and state = 'created' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too_many_open_orders' using errcode = 'P0001';
  end if;

  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, components,
                             paystack_reference, client_key, is_test)
  values (pr.organisation_id, v_uid, v_beneficiary, it.id, px.id, px.amount_kobo, px.components,
          'tho_' || replace(gen_random_uuid()::text, '-', ''), p_client_key, coalesce(pr.is_test, false))
  on conflict (buyer_profile_id, client_key) where client_key is not null do nothing
  returning * into o;
  if o.id is null then
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', o.checkout_url, 'replay', true);
  end if;
  return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', null, 'replay', false);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Reversing journal entry for refunds (S25b deferred this to S26)
-- ---------------------------------------------------------------------------
create function private.post_refund_reversal(p_order_id uuid, p_refund_amount bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  o public.orders%rowtype;
  it public.catalog_items%rowtype;
  v_date date;
  v_ref text;
  v_entry uuid;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then return null; end if;
  select * into it from public.catalog_items where id = o.catalog_item_id;

  v_date := (now() at time zone 'Africa/Lagos')::date;
  if exists (select 1 from public.finance_periods where period_month = date_trunc('month', v_date)::date and status <> 'open') then
    v_date := (now() at time zone 'Africa/Lagos')::date;
  end if;
  v_ref := 'refund:' || o.id;

  if it.duration_days is null then
    v_entry := private.finance_post_journal(v_date, 'NGN', 'adjustment', v_ref, 'Refund: ' || it.code,
      jsonb_build_array(
        jsonb_build_object('account_code', '4100', 'debit_minor', p_refund_amount, 'credit_minor', 0, 'organisation_id', o.organisation_id),
        jsonb_build_object('account_code', '1020', 'debit_minor', 0, 'credit_minor', p_refund_amount, 'organisation_id', o.organisation_id)), null);
  else
    v_entry := private.finance_post_journal(v_date, 'NGN', 'adjustment', v_ref, 'Refund: ' || it.code,
      jsonb_build_array(
        jsonb_build_object('account_code', '2000', 'debit_minor', p_refund_amount, 'credit_minor', 0, 'organisation_id', o.organisation_id),
        jsonb_build_object('account_code', '1020', 'debit_minor', 0, 'credit_minor', p_refund_amount, 'organisation_id', o.organisation_id)), null);
  end if;
  return v_entry;
end $$;
revoke all on function private.post_refund_reversal(uuid, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
grant select on public.refunds to authenticated;

-- `revoke ... from public` also removes the EXECUTE authenticated inherits through PUBLIC,
-- so the two RPCs called from signed-in sessions need an explicit grant.
grant execute on function public.request_order_refund(uuid, text) to authenticated;
grant execute on function public.decide_order_refund(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'entitlements' and column_name = 'reminded_at') then
    raise exception 'S26: entitlements.reminded_at column missing';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'refunds') then
    raise exception 'S26: refunds table missing';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'refunds_one_live') then
    raise exception 'S26: refunds_one_live partial unique index missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'consume_entitlement' and pronamespace = 'public'::regnamespace) then
    raise exception 'S26: consume_entitlement function missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'expire_entitlements' and pronamespace = 'private'::regnamespace) then
    raise exception 'S26: private.expire_entitlements function missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'queue_entitlement_expiry_reminders' and pronamespace = 'private'::regnamespace) then
    raise exception 'S26: private.queue_entitlement_expiry_reminders function missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'request_order_refund' and pronamespace = 'public'::regnamespace) then
    raise exception 'S26: request_order_refund function missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'decide_order_refund' and pronamespace = 'public'::regnamespace) then
    raise exception 'S26: decide_order_refund function missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'post_refund_reversal' and pronamespace = 'private'::regnamespace) then
    raise exception 'S26: private.post_refund_reversal function missing';
  end if;
  if has_function_privilege('anon', 'public.consume_entitlement(uuid)', 'EXECUTE') then
    raise exception 'S26: anon must not have EXECUTE on consume_entitlement';
  end if;
  if has_function_privilege('anon', 'public.request_order_refund(uuid, text)', 'EXECUTE') then
    raise exception 'S26: anon must not have EXECUTE on request_order_refund';
  end if;
  if has_function_privilege('anon', 'public.record_refund_provider_result(uuid, boolean, text, jsonb)', 'EXECUTE') then
    raise exception 'S26: anon must not have EXECUTE on record_refund_provider_result';
  end if;
  if not has_function_privilege('authenticated', 'public.request_order_refund(uuid, text)', 'EXECUTE') then
    raise exception 'S26: authenticated must have EXECUTE on request_order_refund';
  end if;
  if not has_function_privilege('authenticated', 'public.decide_order_refund(uuid, boolean, text)', 'EXECUTE') then
    raise exception 'S26: authenticated must have EXECUTE on decide_order_refund';
  end if;
  if has_function_privilege('anon', 'public.decide_order_refund(uuid, boolean, text)', 'EXECUTE') then
    raise exception 'S26: anon must not have EXECUTE on decide_order_refund';
  end if;
  raise notice 'S26: all checks passed';
end $$;
