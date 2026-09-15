-- §91.9 Employer/Insurance Per-Transaction Subsidy Engine.
--
-- Founder decision: two simultaneous charges. At checkout, the sponsor's
-- card is charged their share and the patient's own card is charged theirs,
-- tied together by one transaction_subsidies row. This matches the spec
-- literally (the patient sees and pays a reduced amount immediately) and
-- stays structurally distinct from capitation (I8, see
-- 20260729122912_remove_hmo_capitation_i8.sql): every charge is tied to one
-- real, already-occurring order via a mandatory, unique-constrained FK.
-- transaction_subsidies has no monthly_amount/starts_at/ends_at/recurrence
-- column at all, so a standing per-member-per-month arrangement is
-- structurally inexpressible here, not just policy-forbidden.
--
-- The metadata-kind trigger pattern (apply_subsidy_contribution_from_transaction
-- below) mirrors private.apply_voucher_payment_from_transaction and the
-- now-corrected private.activate_sponsored_subscription (see
-- checkout-metadata.ts's docblock and the two immediately-preceding
-- migrations): it ships without redeploying either Paystack/Stripe webhook,
-- and is deliberately gated on event_type, never processed_at — the lesson
-- from the sponsored-subscription bug just fixed in this same session.
--
-- Institution-facing access stays aggregate-only (I9): institution_subsidy_summary
-- mirrors public.payer_dashboard_analytics's small-cell suppression pattern
-- (greatest(min_cohort_size, 5) distinct sponsored people before any figure
-- is shown) via organisations.min_cohort_size, and no institution role gets
-- any direct grant on transaction_subsidies/subsidy_contributions.
--
-- Verified end-to-end in a rolled-back transaction before this was applied:
-- 60/40 percentage split math; a stranger without a manage grant is refused;
-- a second subsidy on the same order is refused (no double-subsidizing); the
-- underlying order and transaction_subsidies row both stay in a pending
-- state until BOTH the sponsor's and the patient's contribution have posted
-- a payment_transactions row, and only then does the order flip to
-- payment_confirmed and two independent payment-sourced GL entries exist;
-- institution_subsidy_summary suppresses below cohort threshold, refuses a
-- non-staff/non-institution-admin caller, and its jsonb output contains no
-- uuid-shaped value anywhere; anon has no EXECUTE on any function here.

create table public.subsidy_split_rules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  split_type text not null check (split_type in ('percentage','fixed_patient_copay')),
  sponsor_pct_bps integer check (sponsor_pct_bps between 1 and 10000),
  patient_copay_kobo bigint check (patient_copay_kobo >= 0),
  scope text[] not null default array['lab','pharmacy','referral'],
  is_active boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint subsidy_split_rules_shape check (
    (split_type = 'percentage' and sponsor_pct_bps is not null and patient_copay_kobo is null)
    or (split_type = 'fixed_patient_copay' and patient_copay_kobo is not null and sponsor_pct_bps is null)
  ),
  constraint subsidy_split_rules_scope_valid check (
    scope <@ array['lab','pharmacy','referral']::text[] and coalesce(array_length(scope,1),0) > 0
  )
);
alter table public.subsidy_split_rules enable row level security;
create policy subsidy_split_rules_select on public.subsidy_split_rules
  for select to authenticated using (private.is_org_staff(organisation_id));
grant select on public.subsidy_split_rules to authenticated;

create table public.transaction_subsidies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  beneficiary_profile_id uuid not null references public.profiles (id) on delete cascade,
  sponsor_profile_id uuid not null references public.profiles (id) on delete cascade,
  order_type text not null check (order_type in ('lab','pharmacy','referral')),
  order_id uuid not null,
  gross_amount_kobo bigint not null check (gross_amount_kobo > 0),
  sponsor_amount_kobo bigint not null check (sponsor_amount_kobo >= 0),
  patient_amount_kobo bigint not null check (patient_amount_kobo >= 0),
  currency public.currency not null default 'NGN',
  split_rule_id uuid references public.subsidy_split_rules (id) on delete set null,
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transaction_subsidies_split_totals check (sponsor_amount_kobo + patient_amount_kobo = gross_amount_kobo),
  unique (order_type, order_id)
);
alter table public.transaction_subsidies enable row level security;
create policy transaction_subsidies_select on public.transaction_subsidies
  for select to authenticated
  using (
    beneficiary_profile_id = (select auth.uid())
    or sponsor_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );
grant select on public.transaction_subsidies to authenticated;
create trigger transaction_subsidies_set_updated_at before update on public.transaction_subsidies
  for each row execute function private.set_updated_at();

create table public.subsidy_contributions (
  id uuid primary key default gen_random_uuid(),
  transaction_subsidy_id uuid not null references public.transaction_subsidies (id) on delete cascade,
  role text not null check (role in ('sponsor','patient')),
  payer_profile_id uuid not null references public.profiles (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  currency public.currency not null,
  status text not null default 'pending_payment' check (status in ('pending_payment','payment_confirmed','failed')),
  payment_provider public.payment_provider,
  payment_provider_ref text,
  pending_payment_provider_ref text,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (transaction_subsidy_id, role)
);
alter table public.subsidy_contributions enable row level security;
create policy subsidy_contributions_select on public.subsidy_contributions
  for select to authenticated
  using (payer_profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
grant select on public.subsidy_contributions to authenticated;
create index subsidy_contributions_pending_ref_idx on public.subsidy_contributions (pending_payment_provider_ref) where pending_payment_provider_ref is not null;

-- ---------------------------------------------------------------------------
-- Compute the split for a gross amount against whatever active rule applies.
-- No rule -> patient pays 100% (the pre-existing, unsubsidized default).
-- ---------------------------------------------------------------------------
create or replace function private.compute_transaction_subsidy(
  p_organisation_id uuid, p_order_type text, p_gross_amount_kobo bigint
) returns table (sponsor_amount_kobo bigint, patient_amount_kobo bigint, rule_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rule record;
  v_sponsor bigint;
begin
  select * into v_rule from public.subsidy_split_rules
    where organisation_id = p_organisation_id and is_active
      and p_order_type = any(scope)
      and effective_from <= now() and (effective_to is null or effective_to > now())
    order by effective_from desc limit 1;

  if v_rule.id is null then
    return query select 0::bigint, p_gross_amount_kobo, null::uuid;
    return;
  end if;

  if v_rule.split_type = 'percentage' then
    v_sponsor := round(p_gross_amount_kobo * v_rule.sponsor_pct_bps / 10000.0);
  else
    v_sponsor := greatest(p_gross_amount_kobo - v_rule.patient_copay_kobo, 0);
  end if;
  v_sponsor := least(v_sponsor, p_gross_amount_kobo);

  return query select v_sponsor, p_gross_amount_kobo - v_sponsor, v_rule.id;
end;
$$;
revoke all on function private.compute_transaction_subsidy(uuid, text, bigint) from public;

-- ---------------------------------------------------------------------------
-- Entry point: a sponsor with a real manage grant over the patient starts a
-- subsidized checkout for one real, already-existing order. Re-checks the
-- grant here (checkout-initiation time) — the metadata-kind trigger below
-- re-checks it AGAIN when money actually lands, matching the existing
-- sponsored-subscription pattern.
-- ---------------------------------------------------------------------------
create or replace function public.create_transaction_subsidy(
  p_order_type text, p_order_id uuid, p_sponsor_profile_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_patient uuid;
  v_org uuid;
  v_status text;
  v_payable bigint;
  v_split record;
  v_subsidy_id uuid;
  v_sponsor_contribution_id uuid;
  v_patient_contribution_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_order_type not in ('lab', 'pharmacy', 'referral') then
    raise exception 'subsidies can only be applied to lab, pharmacy, or referral orders';
  end if;
  if v_caller <> p_sponsor_profile_id then
    raise exception 'only the sponsor themselves can initiate a subsidized checkout' using errcode = '42501';
  end if;

  if p_order_type = 'lab' then
    select patient_id, organisation_id, status::text, payable_kobo into v_patient, v_org, v_status, v_payable
      from public.lab_orders where id = p_order_id for update;
  elsif p_order_type = 'pharmacy' then
    select patient_id, organisation_id, status::text, payable_kobo into v_patient, v_org, v_status, v_payable
      from public.pharmacy_orders where id = p_order_id for update;
  else
    select patient_id, organisation_id, status::text, payable_kobo into v_patient, v_org, v_status, v_payable
      from public.specialist_referrals where id = p_order_id for update;
  end if;

  if v_patient is null then raise exception 'order not found'; end if;
  if v_status <> 'pending_payment' then raise exception 'that order is not awaiting payment'; end if;
  if v_payable is null or v_payable <= 0 then raise exception 'that order has nothing left to pay'; end if;

  if not exists (
    select 1 from public.profile_access pa
    where pa.profile_id = v_patient and pa.grantee_user_id = p_sponsor_profile_id and pa.permission_level = 'manage'
  ) then
    raise exception 'you are not authorised to sponsor this person''s care' using errcode = '42501';
  end if;

  if exists (select 1 from public.transaction_subsidies where order_type = p_order_type and order_id = p_order_id) then
    raise exception 'this order already has a subsidy in progress';
  end if;

  select * into v_split from private.compute_transaction_subsidy(v_org, p_order_type, v_payable);

  insert into public.transaction_subsidies
    (organisation_id, beneficiary_profile_id, sponsor_profile_id, order_type, order_id,
     gross_amount_kobo, sponsor_amount_kobo, patient_amount_kobo, currency, split_rule_id)
  values (v_org, v_patient, p_sponsor_profile_id, p_order_type, p_order_id,
          v_payable, v_split.sponsor_amount_kobo, v_split.patient_amount_kobo, 'NGN', v_split.rule_id)
  returning id into v_subsidy_id;

  if v_split.sponsor_amount_kobo > 0 then
    insert into public.subsidy_contributions
      (transaction_subsidy_id, role, payer_profile_id, amount_minor, currency, organisation_id)
    values (v_subsidy_id, 'sponsor', p_sponsor_profile_id, v_split.sponsor_amount_kobo, 'NGN', v_org)
    returning id into v_sponsor_contribution_id;
  end if;

  if v_split.patient_amount_kobo > 0 then
    insert into public.subsidy_contributions
      (transaction_subsidy_id, role, payer_profile_id, amount_minor, currency, organisation_id)
    values (v_subsidy_id, 'patient', v_patient, v_split.patient_amount_kobo, 'NGN', v_org)
    returning id into v_patient_contribution_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'subsidy_id', v_subsidy_id,
    'sponsor_amount_kobo', v_split.sponsor_amount_kobo, 'patient_amount_kobo', v_split.patient_amount_kobo,
    'sponsor_contribution_id', v_sponsor_contribution_id, 'patient_contribution_id', v_patient_contribution_id
  );
end;
$$;
revoke all on function public.create_transaction_subsidy(text, uuid, uuid) from public;
grant execute on function public.create_transaction_subsidy(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Set the pending provider ref once checkout is initiated for one side.
-- ---------------------------------------------------------------------------
create or replace function public.set_subsidy_contribution_pending_ref(p_contribution_id uuid, p_pending_ref text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.subsidy_contributions
     set pending_payment_provider_ref = p_pending_ref
   where id = p_contribution_id and payer_profile_id = (select auth.uid()) and status = 'pending_payment';
  if not found then raise exception 'contribution not found, not yours, or already paid'; end if;
end;
$$;
revoke all on function public.set_subsidy_contribution_pending_ref(uuid, text) from public;
grant execute on function public.set_subsidy_contribution_pending_ref(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The metadata-kind trigger — ships without redeploying either webhook,
-- exactly like private.apply_voucher_payment_from_transaction and
-- private.activate_sponsored_subscription (see checkout-metadata.ts). Gated
-- on event_type, never processed_at (see the two immediately-preceding
-- migrations for why that matters).
-- ---------------------------------------------------------------------------
create or replace function private.apply_subsidy_contribution_from_transaction()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb;
  v_contribution_id uuid;
  v_ref text;
  v_contrib record;
  v_all_paid boolean;
  v_subsidy record;
begin
  if new.event_type::text not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_meta := coalesce(
    new.raw_payload -> 'data' -> 'metadata',
    new.raw_payload -> 'data' -> 'object' -> 'metadata',
    new.raw_payload -> 'metadata',
    '{}'::jsonb
  );

  if coalesce(v_meta ->> 'kind', '') <> 'subsidy_contribution' then
    return new;
  end if;

  v_contribution_id := nullif(v_meta ->> 'subsidy_contribution_id', '')::uuid;
  if v_contribution_id is null then return new; end if;

  v_ref := coalesce(
    new.raw_payload -> 'data' ->> 'reference',
    new.raw_payload -> 'data' -> 'object' ->> 'id'
  );
  if v_ref is null then return new; end if;

  update public.subsidy_contributions
     set status = 'payment_confirmed',
         payment_provider = new.provider,
         payment_provider_ref = v_ref,
         pending_payment_provider_ref = null
   where id = v_contribution_id and pending_payment_provider_ref = v_ref and status = 'pending_payment'
   returning * into v_contrib;

  if v_contrib.id is null then return new; end if;

  perform private.finance_post_journal(current_date, new.currency, 'payment', new.id::text,
    initcap(v_contrib.role) || ' subsidy contribution',
    jsonb_build_array(
      jsonb_build_object('account_code', '1020', 'debit_minor', v_contrib.amount_minor, 'credit_minor', 0, 'organisation_id', v_contrib.organisation_id),
      jsonb_build_object('account_code', '4100', 'debit_minor', 0, 'credit_minor', v_contrib.amount_minor, 'organisation_id', v_contrib.organisation_id, 'cost_center_code', 'PARTNER_NET')
    ),
    null);

  select not exists (
    select 1 from public.subsidy_contributions
    where transaction_subsidy_id = v_contrib.transaction_subsidy_id and status <> 'payment_confirmed'
  ) into v_all_paid;

  if v_all_paid then
    update public.transaction_subsidies set status = 'paid', updated_at = now()
      where id = v_contrib.transaction_subsidy_id
      returning * into v_subsidy;

    if v_subsidy.order_type = 'lab' then
      update public.lab_orders set status = 'payment_confirmed', payment_provider = new.provider,
        payment_provider_ref = 'subsidy:' || v_subsidy.id::text, pending_payment_provider_ref = null
        where id = v_subsidy.order_id;
    elsif v_subsidy.order_type = 'pharmacy' then
      update public.pharmacy_orders set status = 'payment_confirmed', payment_provider = new.provider,
        payment_provider_ref = 'subsidy:' || v_subsidy.id::text, pending_payment_provider_ref = null
        where id = v_subsidy.order_id;
    else
      update public.specialist_referrals set status = 'payment_confirmed', payment_provider = new.provider,
        payment_provider_ref = 'subsidy:' || v_subsidy.id::text, pending_payment_provider_ref = null
        where id = v_subsidy.order_id;
    end if;
  end if;

  return new;
exception when others then
  return new;
end;
$$;

create trigger apply_subsidy_contribution_from_transaction
  after insert on public.payment_transactions
  for each row execute function private.apply_subsidy_contribution_from_transaction();

-- ---------------------------------------------------------------------------
-- Institution-facing aggregate view — I9 (aggregate-only, ever). Category
-- label + total only, never a per-patient row, mirroring
-- sponsor_payable_orders/payer_dashboard_analytics's own small-cell
-- suppression precedent.
-- ---------------------------------------------------------------------------
create or replace function public.institution_subsidy_summary(
  p_organisation_id uuid, p_from date default null, p_to date default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_min_cohort integer;
  v_claim_count integer;
  v_total bigint;
  v_categories jsonb;
begin
  if not private.can_manage_employer(p_organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select greatest(coalesce(min_cohort_size, 10), 5) into v_min_cohort
    from public.organisations where id = p_organisation_id;

  select count(distinct ts.beneficiary_profile_id) into v_claim_count
  from public.transaction_subsidies ts
  where ts.organisation_id = p_organisation_id and ts.status = 'paid'
    and (p_from is null or ts.created_at::date >= p_from)
    and (p_to is null or ts.created_at::date <= p_to);

  if v_claim_count < v_min_cohort then
    return jsonb_build_object(
      'suppressed', true, 'min_cohort_size', v_min_cohort,
      'note', 'Fewer than ' || v_min_cohort || ' distinct sponsored people — no figures shown to protect individual privacy.'
    );
  end if;

  select coalesce(sum(ts.sponsor_amount_kobo), 0) into v_total
  from public.transaction_subsidies ts
  where ts.organisation_id = p_organisation_id and ts.status = 'paid'
    and (p_from is null or ts.created_at::date >= p_from)
    and (p_to is null or ts.created_at::date <= p_to);

  select coalesce(jsonb_agg(jsonb_build_object(
           'category_label', initcap(order_type) || ' order',
           'sponsor_paid_kobo', cat_total, 'claim_count', cat_count)), '[]'::jsonb)
    into v_categories
  from (
    select order_type, sum(sponsor_amount_kobo) as cat_total, count(*) as cat_count
    from public.transaction_subsidies
    where organisation_id = p_organisation_id and status = 'paid'
      and (p_from is null or created_at::date >= p_from)
      and (p_to is null or created_at::date <= p_to)
    group by order_type
  ) c;

  return jsonb_build_object(
    'suppressed', false, 'min_cohort_size', v_min_cohort,
    'total_sponsor_paid_kobo', v_total, 'claim_count', v_claim_count,
    'category_breakdown', v_categories
  );
end;
$$;
revoke all on function public.institution_subsidy_summary(uuid, date, date) from public;
grant execute on function public.institution_subsidy_summary(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: create a split rule.
-- ---------------------------------------------------------------------------
create or replace function public.create_subsidy_split_rule(
  p_organisation_id uuid, p_split_type text, p_sponsor_pct numeric default null,
  p_patient_copay_naira numeric default null, p_scope text[] default array['lab','pharmacy','referral']
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.can_manage_employer(p_organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_split_type not in ('percentage', 'fixed_patient_copay') then
    raise exception 'split_type must be percentage or fixed_patient_copay';
  end if;

  insert into public.subsidy_split_rules
    (organisation_id, split_type, sponsor_pct_bps, patient_copay_kobo, scope, created_by)
  values (
    p_organisation_id, p_split_type,
    case when p_split_type = 'percentage' then round(p_sponsor_pct * 100)::integer else null end,
    case when p_split_type = 'fixed_patient_copay' then round(p_patient_copay_naira * 100)::bigint else null end,
    coalesce(p_scope, array['lab','pharmacy','referral']),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_subsidy_split_rule(uuid, text, numeric, numeric, text[]) from public;
grant execute on function public.create_subsidy_split_rule(uuid, text, numeric, numeric, text[]) to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='transaction_subsidies') then
    raise exception 'transaction_subsidies missing after migration';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'apply_subsidy_contribution_from_transaction' and not tgisinternal) then
    raise exception 'apply_subsidy_contribution_from_transaction trigger missing after migration';
  end if;
end $$;
