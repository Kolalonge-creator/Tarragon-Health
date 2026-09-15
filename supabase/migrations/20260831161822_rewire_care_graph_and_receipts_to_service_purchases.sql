-- Tarragon Health — Pay-per-service business model, Phase 1 (patient-facing displays)
--
-- Two more real, patient-visible reads found still querying
-- subscriptions/subscription_plans directly:
--   - public.my_care_graph()'s "who funds me" / "people funding me" sections
--     checked subscriptions.paid_by_profile_id, which nothing populates any
--     more (a sponsor purchase now sets service_purchases.purchaser_profile_id
--     instead) — a sponsored patient would stop seeing their sponsor credited
--     at all.
--   - public.patient_receipts()'s "membership" line-item category joined
--     payment_transactions -> subscriptions -> subscription_plans, which no
--     new service_purchase payment populates (payment_transactions has no FK
--     column for it — matching happens via raw_payload, see
--     private.apply_service_purchase_payment) — a patient's own receipts
--     list would silently stop showing anything for a service purchased
--     after 2026-08-31.

create or replace function public.my_care_graph()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_me       uuid := (select auth.uid());
  v_grants   jsonb;
  v_requests jsonb;
  v_funders  jsonb;
  v_team     jsonb;
  v_others   jsonb;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(g order by g->>'name'), '[]'::jsonb) into v_grants
  from (
    select jsonb_build_object(
      'grant_id',          pa.id,
      'profile_id',        pa.grantee_user_id,
      'name',              coalesce(nullif(trim(p.full_name), ''), 'Someone you added'),
      'permission_level',  pa.permission_level,
      'clinical_access',   pa.clinical_access,
      'since',             pa.created_at,
      'clinical_access_changed_at', pa.clinical_access_updated_at,
      'funds_me', exists (
        select 1 from public.care_vouchers cv
         where cv.beneficiary_profile_id = v_me
           and cv.purchaser_profile_id = pa.grantee_user_id
           and cv.amount_paid_kobo > 0
      ) or exists (
        select 1 from public.service_purchases sp
         where sp.patient_id = v_me and sp.purchaser_profile_id = pa.grantee_user_id
           and sp.purchaser_profile_id <> sp.patient_id
      ),
      'last_active_at', (
        select max(e.occurred_at) from public.care_access_events e
         where e.patient_id = v_me
           and e.actor_profile_id = pa.grantee_user_id
           and e.kind in ('record_viewed', 'receipt_generated', 'acted_for')
      )
    ) as g
    from public.profile_access pa
    join public.profiles p on p.id = pa.grantee_user_id
    where pa.profile_id = v_me
  ) rows;

  select coalesce(jsonb_agg(r order by r->>'created_at' desc), '[]'::jsonb) into v_requests
  from (
    select jsonb_build_object(
      'request_id',       car.id,
      'permission_level', car.permission_level,
      'relationship',     car.relationship,
      'created_at',       car.created_at,
      'about_my_record',  car.profile_id = v_me,
      'i_initiated',      car.initiated_by = v_me,
      'awaiting_me',      car.initiated_by <> v_me,
      'other_name', coalesce(nullif(trim(op.full_name), ''), 'Someone')
    ) as r
    from public.care_access_requests car
    join public.profiles op
      on op.id = case when car.profile_id = v_me then car.counterparty_user_id else car.profile_id end
    where car.status = 'pending'
      and (car.profile_id = v_me or car.counterparty_user_id = v_me)
  ) rows;

  select coalesce(jsonb_agg(f order by (f->>'total_kobo')::bigint desc), '[]'::jsonb) into v_funders
  from (
    select jsonb_build_object(
      'profile_id', x.payer,
      'name', coalesce(nullif(trim(p.full_name), ''), 'Someone'),
      'total_kobo', x.total_kobo,
      'last_paid_at', x.last_paid_at,
      'funds_my_plan', x.funds_plan,
      'holds_access', exists (
        select 1 from public.profile_access pa
         where pa.profile_id = v_me and pa.grantee_user_id = x.payer
      )
    ) as f
    from (
      select payer,
             sum(total_kobo)::bigint as total_kobo,
             max(last_paid_at) as last_paid_at,
             bool_or(funds_plan) as funds_plan
      from (
        select cv.purchaser_profile_id as payer,
               sum(cv.amount_paid_kobo) as total_kobo,
               max(cv.created_at) as last_paid_at,
               false as funds_plan
          from public.care_vouchers cv
         where cv.beneficiary_profile_id = v_me
           and cv.purchaser_profile_id is not null
           and cv.purchaser_profile_id <> v_me
           and cv.amount_paid_kobo > 0
         group by cv.purchaser_profile_id
        union all
        select sp.purchaser_profile_id, 0::bigint, max(sp.purchased_at), true
          from public.service_purchases sp
         where sp.patient_id = v_me
           and sp.purchaser_profile_id is not null
           and sp.purchaser_profile_id <> v_me
         group by sp.purchaser_profile_id
      ) u
      group by payer
    ) x
    join public.profiles p on p.id = x.payer
  ) rows;

  select jsonb_build_object(
    'kind', 'care_team',
    'revocable', false,
    'assigned', exists (select 1 from public.care_team_assignment cta where cta.patient_id = v_me),
    'doctors_who_reviewed_me', (
      select count(distinct pt.actor_clinical_staff_id)
        from public.patient_timeline pt
       where pt.patient_id = v_me and pt.actor_clinical_staff_id is not null
    )
  ) into v_team;

  select coalesce(jsonb_agg(o order by o->>'name'), '[]'::jsonb) into v_others
  from (
    select jsonb_build_object(
      'grant_id',         pa.id,
      'profile_id',       pa.profile_id,
      'name',             coalesce(nullif(trim(p.full_name), ''), 'Someone'),
      'permission_level', pa.permission_level,
      'clinical_access',  pa.clinical_access,
      'is_dependent_account', coalesce(p.is_dependent_account, false),
      'since',            pa.created_at
    ) as o
    from public.profile_access pa
    join public.profiles p on p.id = pa.profile_id
    where pa.grantee_user_id = v_me
  ) rows;

  return jsonb_build_object(
    'people_with_access', v_grants,
    'pending_requests',   v_requests,
    'people_funding_me',  v_funders,
    'care_team',          v_team,
    'records_i_can_see',  v_others
  );
end;
$function$;

create or replace function public.patient_receipts()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  return coalesce(
    (
      select jsonb_agg(row_to_json(r) order by r.occurred_at desc)
      from (
        -- Membership / service purchases (pay-per-service, 2026-08-31 on) —
        -- built directly from service_purchases rather than a
        -- payment_transactions join, since a service_purchase payment is
        -- matched via raw_payload, not a stored FK column.
        select
          sp.id,
          coalesce(sp.purchased_at, sp.created_at) as occurred_at,
          'membership'::text as service_type,
          coalesce(p.name, 'Service') as service_label,
          coalesce(sp.payment_provider_ref, sp.id::text) as reference,
          sp.amount_kobo as amount_minor,
          sp.currency,
          case
            when sp.status = 'active' then 'successful'
            when sp.status = 'refunded' then 'refunded'
            when sp.status = 'cancelled' then 'failed'
            else 'pending'
          end as status,
          sp.payment_provider::text as provider,
          sp.organisation_id
        from public.service_purchases sp
        left join public.service_products p on p.id = sp.service_product_id
        where sp.patient_id = v_caller
          and sp.amount_kobo > 0

        union all

        -- Laboratory bookings.
        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at),
          'laboratory',
          coalesce(pb.name, 'Lab order'),
          coalesce(pt.provider_event_id, pt.id::text),
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end,
          pt.provider::text,
          lo.organisation_id
        from public.payment_transactions pt
        join public.lab_orders lo on lo.id = pt.booking_order_id
        left join public.panel_bundles pb on pb.id = lo.panel_bundle_id
        where pt.booking_order_type = 'lab' and lo.patient_id = v_caller

        union all

        -- Pharmacy bookings.
        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at),
          'pharmacy',
          'Pharmacy order (' || jsonb_array_length(coalesce(po.items, '[]'::jsonb)) || ' item'
            || case when jsonb_array_length(coalesce(po.items, '[]'::jsonb)) = 1 then '' else 's' end || ')',
          coalesce(pt.provider_event_id, pt.id::text),
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end,
          pt.provider::text,
          po.organisation_id
        from public.payment_transactions pt
        join public.pharmacy_orders po on po.id = pt.booking_order_id
        where pt.booking_order_type = 'pharmacy' and po.patient_id = v_caller

        union all

        -- Specialist referrals.
        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at),
          'referral',
          initcap(replace(sr.specialist_type::text, '_', ' ')) || ' referral',
          coalesce(pt.provider_event_id, pt.id::text),
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end,
          pt.provider::text,
          sr.organisation_id
        from public.payment_transactions pt
        join public.specialist_referrals sr on sr.id = pt.booking_order_id
        where pt.booking_order_type = 'referral' and sr.patient_id = v_caller

        union all

        -- Video consultations — never reach payment_transactions'
        -- booking_order_* columns (commission_type has no 'consultation'
        -- member), so this table is its own receipt source.
        select
          vvr.id,
          vvr.created_at,
          'consultation',
          'Video consultation',
          coalesce(vvr.payment_provider_ref, vvr.id::text),
          vvr.amount_minor,
          vvr.currency::public.currency,
          case
            when vvr.refund_status = 'refunded' then 'refunded'
            when vvr.status in ('declined', 'expired') and vvr.refund_status = 'due' then 'pending_refund'
            when vvr.status in ('declined', 'expired') then 'failed'
            when vvr.payment_provider_ref is not null then 'successful'
            else 'pending'
          end,
          vvr.payment_provider,
          vvr.organisation_id
        from public.video_visit_requests vvr
        where vvr.patient_id = v_caller and vvr.amount_minor > 0

        union all

        -- Care voucher instalments the patient paid for themselves (a
        -- voucher bought as a gift is the purchaser's receipt, not the
        -- beneficiary's).
        select
          cvp.id,
          cvp.created_at,
          'care_voucher',
          coalesce(cv.sku_name, 'Care voucher'),
          coalesce(cvp.pending_provider_ref, cvp.id::text),
          cvp.amount_minor,
          cvp.currency::public.currency,
          case cvp.status
            when 'applied' then 'successful'
            when 'failed' then 'failed'
            else 'pending'
          end,
          cvp.provider::text,
          cvp.organisation_id
        from public.care_voucher_payments cvp
        join public.care_vouchers cv on cv.id = cvp.voucher_id
        where cvp.payer_profile_id = v_caller
      ) r
    ),
    '[]'::jsonb
  );
end;
$function$;

do $$
begin
  if pg_get_functiondef('public.my_care_graph()'::regprocedure) ~ 'paid_by_profile_id' then
    raise exception 'my_care_graph still reads subscriptions.paid_by_profile_id';
  end if;
  if pg_get_functiondef('public.patient_receipts()'::regprocedure) ~ 'join public\.subscriptions' then
    raise exception 'patient_receipts still joins the retired subscriptions table';
  end if;
  raise notice 'PASS: my_care_graph and patient_receipts repointed to service_purchases';
end $$;
