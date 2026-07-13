-- Tarragon Health
-- Recurring add-on catalogue + attachment to a base subscription (Sprint 6).
-- Scope: the 4 recurring add-ons only (Prevention Screening, Dedicated Care
-- Coordinator, Extra Family Member, Expedited Clinician Response) — see
-- docs/FEATURE_SPEC.md §2 and apps/web/.../_content/pricing.ts ADD_ONS. The
-- pay-per-use "BOOK & PAY" items (HPV vaccine, starter kit, Annual Health
-- Check) are deliberately NOT modeled here — those stay ad-hoc bookings, not
-- a recurring Paystack subscription.
--
-- Mirrors subscription_plans/subscriptions in shape and RLS posture (see
-- 20260705211343_b2b_billing.sql). Each attached add-on gets its own
-- independent Paystack Plan+Subscription (provider_ref), since add-ons can
-- have a different interval than the base plan (e.g. a yearly add-on
-- stacked on a monthly plan) — bundling mismatched intervals into one
-- charge is avoided entirely by keeping every billable item its own row.

create table public.add_ons (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique,
  name                    text not null,
  description             text,
  price_minor             bigint not null default 0,
  currency                public.currency not null default 'NGN',
  interval                public.billing_interval not null default 'monthly',
  features                text[] not null default '{}',
  restricted_to_plan_code text,   -- null = attachable to any paid plan
  paystack_plan_code      text,
  price_locked            boolean not null default false,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger add_ons_set_updated_at
  before update on public.add_ons
  for each row execute function private.set_updated_at();

create table public.subscription_add_ons (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  subscription_id     uuid not null references public.subscriptions (id) on delete cascade,
  add_on_id           uuid not null references public.add_ons (id) on delete restrict,
  status              public.subscription_status not null default 'trialing',
  amount_minor        bigint not null default 0,
  currency            public.currency not null default 'NGN',
  interval            public.billing_interval not null default 'monthly',
  provider            public.payment_provider,
  provider_ref        text,
  pending_provider_ref text,
  current_period_end  timestamptz,
  started_at          timestamptz not null default now(),
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (subscription_id, add_on_id)
);

create index subscription_add_ons_subscription_idx on public.subscription_add_ons (subscription_id);
create index subscription_add_ons_addon_idx on public.subscription_add_ons (add_on_id);
create index subscription_add_ons_org_status_idx on public.subscription_add_ons (organisation_id, status);

create trigger subscription_add_ons_set_updated_at
  before update on public.subscription_add_ons
  for each row execute function private.set_updated_at();

-- Cross-table plan-restriction guard — can't be a CHECK constraint (needs a
-- join across subscriptions -> subscription_plans), so a BEFORE trigger is
-- the correct tool, same rigor as clinical_staff's CHECK-based guards but
-- for an invariant a single-table CHECK structurally cannot express.
create or replace function private.validate_subscription_add_on()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restricted_code text;
  v_plan_code text;
begin
  select restricted_to_plan_code into v_restricted_code
    from public.add_ons where id = new.add_on_id;

  if v_restricted_code is not null then
    select p.code into v_plan_code
      from public.subscriptions s
      join public.subscription_plans p on p.id = s.plan_id
      where s.id = new.subscription_id;

    if v_plan_code is distinct from v_restricted_code then
      raise exception 'add_on_restricted_to_plan: this add-on requires the % plan (subscription is on %)',
        v_restricted_code, coalesce(v_plan_code, 'no plan');
    end if;
  end if;

  return new;
end;
$$;

create trigger subscription_add_ons_validate
  before insert or update of subscription_id, add_on_id on public.subscription_add_ons
  for each row execute function private.validate_subscription_add_on();

-- Same price-lock pattern as subscription_plans (see
-- subscription_plans_paystack_sync), scoped to add_ons.
create or replace function private.lock_add_on_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('active', 'trialing') and new.add_on_id is not null then
    update public.add_ons
      set price_locked = true
      where id = new.add_on_id and price_locked = false;
  end if;
  return new;
end;
$$;

create trigger subscription_add_ons_lock_price
  after insert or update of status on public.subscription_add_ons
  for each row execute function private.lock_add_on_price();

alter table public.add_ons enable row level security;
alter table public.subscription_add_ons enable row level security;

create policy add_ons_select on public.add_ons for select to authenticated using (true);
create policy add_ons_insert on public.add_ons for insert to authenticated with check (private.is_admin());
create policy add_ons_update on public.add_ons for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy add_ons_delete on public.add_ons for delete to authenticated using (private.is_admin());

create policy subscription_add_ons_select on public.subscription_add_ons
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or exists (select 1 from public.subscriptions s where s.id = subscription_id and s.subscriber_id = (select auth.uid()))
  );
create policy subscription_add_ons_insert on public.subscription_add_ons
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    or exists (select 1 from public.subscriptions s where s.id = subscription_id and s.subscriber_id = (select auth.uid()))
  );
create policy subscription_add_ons_update on public.subscription_add_ons
  for update to authenticated
  using (
    private.is_org_staff(organisation_id)
    or exists (select 1 from public.subscriptions s where s.id = subscription_id and s.subscriber_id = (select auth.uid()))
  )
  with check (
    private.is_org_staff(organisation_id)
    or exists (select 1 from public.subscriptions s where s.id = subscription_id and s.subscriber_id = (select auth.uid()))
  );
create policy subscription_add_ons_delete on public.subscription_add_ons
  for delete to authenticated
  using (
    private.is_org_staff(organisation_id)
    or exists (select 1 from public.subscriptions s where s.id = subscription_id and s.subscriber_id = (select auth.uid()))
  );

grant select on public.add_ons to authenticated;
grant insert, update, delete on public.add_ons to authenticated;
grant select, insert, update, delete on public.subscription_add_ons to authenticated;
