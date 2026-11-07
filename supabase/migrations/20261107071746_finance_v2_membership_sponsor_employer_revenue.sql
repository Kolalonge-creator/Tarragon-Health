-- ===========================================================================
-- Finance dashboard v2, Phase C2: Membership, family-sponsorship and employer revenue.
-- Design: docs/design/FINANCE-DASHBOARD-V2.md. Read-only: nothing here changes a
-- Membership, order, voucher, invoice or contract.
--
-- public.finance_membership_revenue(from, to)
--   The Membership workspace's figures for a Lagos-date period:
--   * paid Memberships in force at the period end, split by who paid (member, family
--     sponsor, employer); granted Memberships counted apart and never as revenue;
--   * new paid Memberships started, renewals paid, Memberships ended early (refunded or
--     cancelled) and lapsed (ran out unrenewed) in the period;
--   * Memberships due to end in the next 30 days, and how many renew automatically;
--   * renewal rate = renewed / due, where "due" is every paid Membership whose term
--     ended inside the period (and before now), and "renewed" is the subset with a paid
--     renewal order for that Membership. Null, not 0%, when nothing was due;
--   * failed automatic-renewal charges in the period;
--   * Membership revenue (gross, refunds, net) on the same basis as the overview
--     (private.finance_money_events, streams membership and employer_membership).
-- public.finance_memberships_list(...)
--   Paged Memberships with beneficiary, payer (when someone else paid), type, amount
--   paid, dates, state and renewal status. Names only, no health data. Audited
--   (finance.memberships.listed) when it returns rows.
-- public.finance_sponsorships(from, to, ...)
--   Payments where the payer is not the person receiving care: gifted checkout orders
--   and Care Vouchers bought for someone else. Sponsor and beneficiary are separate
--   fields; paying gives the sponsor no access to the beneficiary's record. Audited.
-- public.finance_employer_revenue()
--   Per employer: contract, seats, price per seat, invoiced, paid, outstanding (issued and
--   unpaid), overdue, last payment and renewal date. No employee is named; no health data.
--
-- Every function: SECURITY DEFINER, private.is_finance() or 42501, anon cannot execute.
-- ===========================================================================

-- Who paid for a Membership, from its source and order. Private.
create or replace function private.membership_payer_type(p_source text, p_buyer uuid, p_beneficiary uuid)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when p_source = 'employer' then 'employer'
    when p_source in ('purchase', 'voucher') and p_buyer is not null and p_buyer is distinct from p_beneficiary then 'family_sponsor'
    when p_source in ('purchase', 'voucher') then 'individual'
    else 'granted'
  end;
$$;
revoke all on function private.membership_payer_type(text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.finance_membership_revenue(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_on date;
  v_result jsonb;
begin
  if not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3700 then
    raise exception 'finance_membership_revenue: choose a date range of up to ten years' using errcode = '22023';
  end if;
  v_on := least(p_to, v_today);

  with m as (
    select pm.*, o.buyer_profile_id, o.total_kobo, o.paid_at, o.renews_membership_id as order_renews,
           private.membership_payer_type(pm.source, o.buyer_profile_id, pm.patient_id) as payer_type,
           (pm.starts_at at time zone 'Africa/Lagos')::date as start_d,
           (pm.ends_at at time zone 'Africa/Lagos')::date as end_d,
           (pm.ended_at at time zone 'Africa/Lagos')::date as ended_d
      from public.patient_memberships pm
      left join public.orders o on o.id = pm.order_id
     where not pm.is_test
       and not exists (select 1 from public.profiles p where p.id = pm.patient_id and p.is_test)
  ),
  in_force as (
    select * from m
     where start_d <= v_on and (end_d is null or end_d > v_on) and (ended_d is null or ended_d > v_on)
  ),
  due as (
    select m.id,
           exists (select 1 from public.orders r where r.renews_membership_id = m.id and r.paid_at is not null and not r.is_test) as renewed
      from m
     where m.payer_type <> 'granted' and m.end_d between p_from and p_to and m.ends_at <= now()
       and (m.ended_d is null or m.ended_d >= m.end_d)
  ),
  money as (
    select
      coalesce(sum(amount_minor) filter (where event_kind = 'payment'), 0)::bigint as gross,
      count(*) filter (where event_kind = 'payment')::bigint as payments,
      coalesce(sum(amount_minor) filter (where event_kind = 'refund'), 0)::bigint as refunds,
      coalesce(sum(amount_minor) filter (where event_kind = 'payment' and is_renewal), 0)::bigint as renewal_gross,
      coalesce(sum(amount_minor) filter (where event_kind = 'payment' and payer_type = 'individual'), 0)::bigint as gross_individual,
      coalesce(sum(amount_minor) filter (where event_kind = 'payment' and payer_type = 'family_sponsor'), 0)::bigint as gross_sponsor,
      coalesce(sum(amount_minor) filter (where event_kind = 'payment' and payer_type = 'employer'), 0)::bigint as gross_employer
      from private.finance_money_events e
     where e.stream in ('membership', 'employer_membership') and e.currency = 'NGN'
       and (e.occurred_at at time zone 'Africa/Lagos')::date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'as_of', v_on, 'generated_at', now(),
    'in_force', jsonb_build_object(
      'paid', (select count(*) from in_force where payer_type <> 'granted'),
      'individual', (select count(*) from in_force where payer_type = 'individual'),
      'family_sponsor', (select count(*) from in_force where payer_type = 'family_sponsor'),
      'employer', (select count(*) from in_force where payer_type = 'employer'),
      'granted', (select count(*) from in_force where payer_type = 'granted'),
      'auto_renew', (select count(*) from in_force where payer_type <> 'granted' and auto_renew and renewal_cancelled_at is null)),
    'new_paid', (select count(*) from m where payer_type <> 'granted' and order_renews is null and start_d between p_from and p_to),
    'renewals', (select count(*) from public.orders r
                  where r.renews_membership_id is not null and r.paid_at is not null and not r.is_test
                    and (r.paid_at at time zone 'Africa/Lagos')::date between p_from and p_to),
    'ended_early', (select count(*) from m where payer_type <> 'granted' and state = 'ended' and ended_d between p_from and p_to
                      and (end_d is null or ended_d < end_d)),
    'lapsed', (select count(*) from m where payer_type <> 'granted' and state = 'lapsed' and end_d between p_from and p_to),
    'expiring_30d', (select count(*) from m where payer_type <> 'granted' and state = 'active'
                       and end_d between v_today and v_today + 30),
    'expiring_30d_auto_renew', (select count(*) from m where payer_type <> 'granted' and state = 'active'
                                  and end_d between v_today and v_today + 30 and auto_renew and renewal_cancelled_at is null),
    'renewal_due', (select count(*) from due),
    'renewal_renewed', (select count(*) from due where renewed),
    'renewal_rate', (select case when count(*) = 0 then null else round(count(*) filter (where renewed)::numeric / count(*), 4) end from due),
    'failed_renewal_charges', (select count(*) from public.membership_renewal_attempts a
                                where a.outcome = 'failed' and (a.created_at at time zone 'Africa/Lagos')::date between p_from and p_to),
    'revenue', (select jsonb_build_object('gross_minor', gross, 'payments', payments, 'refunds_minor', refunds,
                                          'net_minor', gross - refunds, 'renewal_gross_minor', renewal_gross,
                                          'individual_minor', gross_individual, 'family_sponsor_minor', gross_sponsor,
                                          'employer_minor', gross_employer) from money)
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.finance_memberships_list(
  p_states text[] default null,
  p_payer_types text[] default null,
  p_search text default null,
  p_expiring_within_days integer default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_result jsonb;
begin
  if not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_search is not null and char_length(v_search) > 100 then
    raise exception 'finance_memberships_list: search is limited to 100 characters' using errcode = '22023';
  end if;
  if p_expiring_within_days is not null and (p_expiring_within_days < 0 or p_expiring_within_days > 366) then
    raise exception 'finance_memberships_list: expiring window is 0 to 366 days' using errcode = '22023';
  end if;
  v_pattern := '%' || replace(replace(replace(coalesce(v_search, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with base as (
    select pm.id, pm.state, pm.source, pm.tier, pm.starts_at, pm.ends_at, pm.ended_at, pm.end_reason, pm.auto_renew,
           pm.renewal_cancelled_at, pm.order_id, pm.created_at,
           o.total_kobo, o.paid_at, o.paystack_reference, o.renews_membership_id,
           private.membership_payer_type(pm.source, o.buyer_profile_id, pm.patient_id) as payer_type,
           coalesce(nullif(trim(bp.full_name), ''), 'Member') as beneficiary,
           case when o.buyer_profile_id is not null and o.buyer_profile_id is distinct from pm.patient_id
                then coalesce(nullif(trim(sp.full_name), ''), 'Sponsor') end as sponsor,
           case when pm.source = 'employer' then (select org.name from public.organisations org where org.id = pm.organisation_id) end as employer
      from public.patient_memberships pm
      left join public.orders o on o.id = pm.order_id
      left join public.profiles bp on bp.id = pm.patient_id
      left join public.profiles sp on sp.id = o.buyer_profile_id
     where not pm.is_test and not coalesce(bp.is_test, false)
  ),
  filtered as (
    select * from base b
     where (p_states is null or b.state = any (p_states))
       and (p_payer_types is null or b.payer_type = any (p_payer_types))
       and (p_expiring_within_days is null
            or (b.state = 'active' and (b.ends_at at time zone 'Africa/Lagos')::date between v_today and v_today + p_expiring_within_days))
       and (v_search is null
            or b.beneficiary ilike v_pattern escape '\'
            or coalesce(b.sponsor, '') ilike v_pattern escape '\'
            or coalesce(b.employer, '') ilike v_pattern escape '\'
            or coalesce(b.paystack_reference, '') ilike v_pattern escape '\'
            or b.id::text = lower(v_search))
  ),
  page as (
    select * from filtered order by coalesce(ends_at, starts_at) asc nulls last, id limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'limit', v_limit, 'offset', v_offset,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'state', p.state, 'source', p.source, 'tier', p.tier, 'payer_type', p.payer_type,
      'beneficiary', p.beneficiary, 'sponsor', p.sponsor, 'employer', p.employer,
      'starts_at', p.starts_at, 'ends_at', p.ends_at, 'ended_at', p.ended_at, 'end_reason', p.end_reason,
      'auto_renew', p.auto_renew and p.renewal_cancelled_at is null,
      'amount_paid_minor', p.total_kobo, 'paid_at', p.paid_at, 'paystack_reference', p.paystack_reference,
      'order_id', p.order_id, 'is_renewal', p.renews_membership_id is not null,
      'renewed', exists (select 1 from public.orders r where r.renews_membership_id = p.id and r.paid_at is not null and not r.is_test))
      order by coalesce(p.ends_at, p.starts_at) asc nulls last, p.id), '[]'::jsonb) from page p)
  ) into v_result;

  if jsonb_array_length(v_result -> 'rows') > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, event)
    values (private.caller_org(), (select auth.uid()), 'finance.memberships.listed', 'patient_memberships',
            jsonb_build_object('rows', jsonb_array_length(v_result -> 'rows'), 'offset', v_offset, 'search', v_search is not null,
                               'filters', jsonb_strip_nulls(jsonb_build_object('states', p_states, 'payer_types', p_payer_types,
                                                                               'expiring_within_days', p_expiring_within_days))));
  end if;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.finance_sponsorships(p_from date, p_to date, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3700 then
    raise exception 'finance_sponsorships: choose a date range of up to ten years' using errcode = '22023';
  end if;

  with s as (
    -- gifted checkout orders (a Membership or other item paid for someone else)
    select 'order'::text as kind, o.id as record_id, o.paid_at as paid_at, o.total_kobo as amount_minor,
           o.paystack_reference as reference, o.state as status, o.buyer_profile_id as sponsor_id, o.beneficiary_patient_id as beneficiary_id,
           ci.code as item,
           (select jsonb_build_object('starts_at', pm.starts_at, 'ends_at', pm.ends_at, 'state', pm.state,
                                      'auto_renew', pm.auto_renew and pm.renewal_cancelled_at is null)
              from public.patient_memberships pm where pm.order_id = o.id order by pm.starts_at limit 1) as membership
      from public.orders o
      left join public.catalog_items ci on ci.id = o.catalog_item_id
     where o.paid_at is not null and not o.is_test
       and o.beneficiary_patient_id is not null and o.buyer_profile_id is distinct from o.beneficiary_patient_id
       and (o.paid_at at time zone 'Africa/Lagos')::date between p_from and p_to
    union all
    -- Care Vouchers bought for someone else
    select 'care_voucher', cv.id, cv.created_at, cv.amount_paid_kobo, cv.voucher_number, cv.status::text,
           cv.purchaser_profile_id, cv.beneficiary_profile_id, coalesce(cv.sku_code, cv.kind::text), null::jsonb
      from public.care_vouchers cv
     where cv.beneficiary_profile_id is not null and cv.purchaser_profile_id is distinct from cv.beneficiary_profile_id
       and coalesce(cv.amount_paid_kobo, 0) > 0
       and (cv.created_at at time zone 'Africa/Lagos')::date between p_from and p_to
  ),
  clean as (
    select s.*, coalesce(nullif(trim(sp.full_name), ''), 'Sponsor') as sponsor, coalesce(nullif(trim(bp.full_name), ''), 'Member') as beneficiary
      from s
      left join public.profiles sp on sp.id = s.sponsor_id
      left join public.profiles bp on bp.id = s.beneficiary_id
     where not coalesce(sp.is_test, false) and not coalesce(bp.is_test, false)
  )
  select jsonb_build_object(
    'total', (select count(*) from clean),
    'total_minor', (select coalesce(sum(amount_minor), 0) from clean),
    'sponsors', (select count(distinct sponsor_id) from clean),
    'beneficiaries', (select count(distinct beneficiary_id) from clean),
    'limit', v_limit, 'offset', v_offset,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'kind', c.kind, 'record_id', c.record_id, 'paid_at', c.paid_at, 'amount_minor', c.amount_minor,
      'reference', c.reference, 'status', c.status, 'sponsor', c.sponsor, 'beneficiary', c.beneficiary,
      'item', c.item, 'membership', c.membership) order by c.paid_at desc), '[]'::jsonb)
      from (select * from clean order by paid_at desc limit v_limit offset v_offset) c)
  ) into v_result;

  if jsonb_array_length(v_result -> 'rows') > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, event)
    values (private.caller_org(), (select auth.uid()), 'finance.sponsorships.listed', 'orders',
            jsonb_build_object('from', p_from, 'to', p_to, 'rows', jsonb_array_length(v_result -> 'rows'), 'offset', v_offset));
  end if;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.finance_employer_revenue()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row order by row ->> 'name')
      from (
        select jsonb_build_object(
          'organisation_id', o.id,
          'name', coalesce(ea.legal_name, o.name),
          'contact', ea.primary_contact_name,
          'contract', (select jsonb_build_object('name', c.name, 'status', c.status, 'effective_from', c.effective_from,
                                                 'effective_to', c.effective_to, 'employee_count', c.employee_count,
                                                 'price_per_employee_minor', coalesce(c.per_employee_per_year_kobo, c.billing_rate_kobo),
                                                 'billing_model', c.billing_model, 'reference', c.contract_reference)
                         from public.corporate_contracts c where c.organisation_id = o.id
                        order by (c.status in ('active', 'paid', 'approved')) desc, c.effective_from desc nulls last limit 1),
          'seats', (select jsonb_build_object('seats', sum(sp.seats_purchased), 'seat_price_minor', max(sp.seat_price_kobo),
                                              'value_minor', sum(sp.total_kobo), 'starts_on', min(sp.starts_on), 'ends_on', max(sp.ends_on))
                      from public.employer_seat_pilots sp
                     where sp.organisation_id = o.id and not sp.is_test and sp.state in ('invoiced', 'active')),
          'invoiced_minor', (select coalesce(sum(i.amount_kobo), 0) from public.employer_invoices i
                              where i.organisation_id = o.id and i.status in ('issued', 'paid')),
          'paid_minor', (select coalesce(sum(i.amount_kobo), 0) from public.employer_invoices i
                          where i.organisation_id = o.id and i.status = 'paid'),
          'outstanding_minor', (select coalesce(sum(i.amount_kobo), 0) from public.employer_invoices i
                                 where i.organisation_id = o.id and i.status = 'issued'),
          'overdue_minor', (select coalesce(sum(i.amount_kobo), 0) from public.employer_invoices i
                             where i.organisation_id = o.id and i.status = 'issued' and i.due_at < now()),
          'open_invoices', (select count(*) from public.employer_invoices i where i.organisation_id = o.id and i.status = 'issued'),
          'last_paid_at', (select max(i.paid_at) from public.employer_invoices i where i.organisation_id = o.id and i.status = 'paid'),
          'members_in_force', (select count(*) from public.patient_memberships pm
                                where pm.organisation_id = o.id and pm.source = 'employer' and pm.state = 'active' and not pm.is_test),
          'renewal_date', coalesce(
             (select max(sp.ends_on) from public.employer_seat_pilots sp where sp.organisation_id = o.id and not sp.is_test and sp.state in ('invoiced', 'active')),
             (select c.effective_to from public.corporate_contracts c where c.organisation_id = o.id and c.status in ('active', 'paid', 'approved')
               order by c.effective_to desc nulls last limit 1)),
          'renewal_within_60d', coalesce(
             (select max(sp.ends_on) from public.employer_seat_pilots sp where sp.organisation_id = o.id and not sp.is_test and sp.state in ('invoiced', 'active')),
             (select c.effective_to from public.corporate_contracts c where c.organisation_id = o.id and c.status in ('active', 'paid', 'approved')
               order by c.effective_to desc nulls last limit 1)) between v_today and v_today + 60
        ) as row
        from public.organisations o
        left join public.employer_accounts ea on ea.organisation_id = o.id
       where o.type = 'corporate'
         and (exists (select 1 from public.corporate_contracts c where c.organisation_id = o.id)
              or exists (select 1 from public.employer_invoices i where i.organisation_id = o.id)
              or exists (select 1 from public.employer_seat_pilots sp where sp.organisation_id = o.id and not sp.is_test))
      ) t
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
revoke all on function public.finance_membership_revenue(date, date) from public, anon;
revoke all on function public.finance_memberships_list(text[], text[], text, integer, integer, integer) from public, anon;
revoke all on function public.finance_sponsorships(date, date, integer, integer) from public, anon;
revoke all on function public.finance_employer_revenue() from public, anon;
grant execute on function public.finance_membership_revenue(date, date) to authenticated;
grant execute on function public.finance_memberships_list(text[], text[], text, integer, integer, integer) to authenticated;
grant execute on function public.finance_sponsorships(date, date, integer, integer) to authenticated;
grant execute on function public.finance_employer_revenue() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.finance_membership_revenue(date, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finance_memberships_list(text[], text[], text, integer, integer, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finance_sponsorships(date, date, integer, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finance_employer_revenue()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.membership_payer_type(text, uuid, uuid)', 'EXECUTE') then
    raise exception 'C2 finance functions must not be executable by anon (or the private helper by authenticated)';
  end if;
end $$;
