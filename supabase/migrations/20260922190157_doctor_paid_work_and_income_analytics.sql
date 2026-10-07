-- Tarragon Health — per-doctor paid work and income, for the analyst console.
--
-- WHY
-- ---
-- Every paid job on this platform is a piece of a doctor's time (the catalogue
-- is priced that way — see service_delivery_cost_model), and a doctor sees the
-- jobs waiting for them in their own /clinician/* worklists. But nothing has
-- ever joined the money to the person who did the work. The closest thing,
-- my_provider_performance (20260827203759), says so explicitly in its own
-- header: "revenue and patient-feedback fields are flags, not numbers: neither
-- exists in this schema". /analytics/doctors counts throughput (escalations,
-- alerts, panel size) and /analytics/financial counts revenue by product, and
-- the two have never met.
--
-- The founder needs the join to work out what commission a doctor is owed at
-- the end of a month. This migration supplies the reporting half of that: what
-- each doctor earned the business, job by job. It deliberately does NOT
-- calculate, store, or pay a commission — no rate, no accrual, no payout
-- ledger. A commission rate is a contractual decision that nobody has made
-- yet, and inventing one in a migration would be exactly the kind of
-- fabricated-fact this codebase keeps having to undo.
--
-- ATTRIBUTION — "who actually did the work"
-- -----------------------------------------
-- service_purchases has no clinician column and never has. A purchase reaches
-- a doctor only through its redemption target
-- (redeemed_entity_type/redeemed_entity_id, 20260831162837), and each target
-- table names its doctor differently AND points at a different actor table:
--
--   redeemed_entity_type            table                          column        -> refs
--   'appointment'                   appointments                   clinician_id     profiles
--   'verified_document'             verified_documents             issued_by        clinical_staff
--   'async_consult'                 async_consults                 answered_by      clinical_staff
--   'second_opinion_request'        second_opinion_requests        answered_by      clinical_staff
--   'senior_case_review'            senior_case_reviews            reviewed_by      clinical_staff
--   'prescription_renewal_request'  prescription_renewal_requests  reviewed_by      clinical_staff
--   'annual_review'                 annual_health_checks           reviewed_by      clinical_staff
--   'care_message_thread'           care_messages                  actor_clinical_staff_id (first care_team reply)
--   'screening_schedule'            (none — lab work, not a doctor's time)
--
-- Note appointments.clinician_id is the ONE that references profiles, not
-- clinical_staff. Every one of those columns carries a column comment warning
-- that joining the wrong actor table matches nothing rather than erroring, so
-- the row reads as unattributed instead of failing. That is why this view
-- normalises everything to a profile id via clinical_staff.profile_id and
-- keys the report on profiles.id rather than on a name (two doctors can share
-- a name; analytics_doctor_performance keys on the name string and would
-- merge them).
--
-- TWO MORE MONEY RAILS, NOT COUNTED ANYWHERE ELSE
-- ----------------------------------------------
-- lab_result_consult_requests and video_visit_requests carry their own
-- amount_minor and their own Paystack reference (private.pin_lab_result_
-- consult_amount / private.pin_video_visit_amount) — they are NOT
-- service_purchases rows, and analytics_revenue_by_product does not see them.
-- They are unambiguously paid doctor work (accepted_by names the clinician),
-- so they are included here with their own `source` label. A reader comparing
-- this report's total against /analytics/financial will find a difference, and
-- the source breakdown is what explains it. Do not "reconcile" that by
-- dropping these rows — the gap is in the other report, not this one.
--
-- WHAT IS NOT ATTRIBUTABLE, AND WHY IT IS STILL SHOWN
-- --------------------------------------------------
-- Two kinds of row have no single doctor, and both are reported rather than
-- filtered away, so the analyst's total is the whole of what was sold:
--   * unattributed   — the work exists but nobody is recorded against it
--                      (still open, or closed without attribution). Never
--                      silently dropped: the same null-gating rule as
--                      reviewed_by/reviewed_at elsewhere in this codebase.
--   * no_single_job  — the purchase names no one piece of work at all. That is
--                      either a single-use credit bought and not yet spent, or
--                      a term of standing cover (continuous_monitoring_* /
--                      weight_management_*) expected to contain several
--                      reviews. Nothing in this schema reliably separates the
--                      two, so the label does not pretend to: expected_jobs
--                      (service_delivery_cost_model.units_per_term) and the
--                      per-product breakdown are carried through instead, and
--                      a reader can see which is which from the product. How
--                      to split a term's money across the reviews inside it is
--                      a commission-policy decision, not a fact to invent here.
--
-- is_doctor_time is derived from service_delivery_cost_model (the founder-
-- maintained table that already answers "is this product a doctor's time, and
-- how many minutes"), NOT from a hardcoded product-code list here — so a
-- product added later is classified by the same table the pricing model uses,
-- instead of silently defaulting into the wrong bucket. Today that correctly
-- excludes ai_coach_daily_pass_30d (the one paid item that is not doctor time)
-- and the screening products.

begin;

-- ---------------------------------------------------------------------------
-- private.doctor_paid_work — one row per paid job, normalised across rails.
--
-- Deliberately a plain (owner-rights) view, not security_invoker: it is read
-- only by the SECURITY DEFINER analyst RPCs below, which do their own
-- private.is_analyst() gate and are the only thing granted to a caller. An
-- analyst console is cross-organisation by definition, so applying the
-- caller's RLS here would defeat the report. It lives in `private`, which is
-- not an exposed PostgREST schema, and every privilege on it is revoked below
-- — so there is no path to it except through those two gated functions.
-- ---------------------------------------------------------------------------
create or replace view private.doctor_paid_work as
with purchases as (
  select
    sp.id                                             as source_id,
    'service_purchase'::text                          as source,
    prod.code                                         as product_code,
    prod.name                                         as product_name,
    sp.patient_id,
    sp.organisation_id,
    coalesce(sp.redeemed_at, sp.purchased_at, sp.created_at) as earned_at,
    sp.amount_kobo::bigint                            as gross_minor,
    coalesce(sp.payable_kobo, sp.amount_kobo)::bigint as revenue_minor,
    sp.currency::text                                 as currency,
    sp.redeemed_entity_type                           as work_type,
    sp.redeemed_entity_id                             as work_id,
    (cm.service_product_code is not null)             as is_doctor_time,
    cm.units_per_term
  from public.service_purchases sp
  join public.service_products prod on prod.id = sp.service_product_id
  left join (
    select service_product_code, max(units_per_term) as units_per_term
      from public.service_delivery_cost_model
     group by service_product_code
  ) cm on cm.service_product_code = prod.code
  -- Same revenue basis as public.analytics_revenue_by_product: a purchase
  -- counts once it is paid for, and an expired grant does not un-earn the
  -- money. pending_payment/cancelled/refunded are not revenue.
  where sp.status in ('active', 'expired')
),
purchases_resolved as (
  select
    p.*,
    case p.work_type
      when 'appointment' then (
        select a.clinician_id from public.appointments a where a.id = p.work_id)
      when 'verified_document' then (
        select cs.profile_id from public.verified_documents vd
          join public.clinical_staff cs on cs.id = vd.issued_by where vd.id = p.work_id)
      when 'async_consult' then (
        select cs.profile_id from public.async_consults ac
          join public.clinical_staff cs on cs.id = ac.answered_by where ac.id = p.work_id)
      when 'second_opinion_request' then (
        select cs.profile_id from public.second_opinion_requests so
          join public.clinical_staff cs on cs.id = so.answered_by where so.id = p.work_id)
      when 'senior_case_review' then (
        select cs.profile_id from public.senior_case_reviews sc
          join public.clinical_staff cs on cs.id = sc.reviewed_by where sc.id = p.work_id)
      when 'prescription_renewal_request' then (
        select cs.profile_id from public.prescription_renewal_requests pr
          join public.clinical_staff cs on cs.id = pr.reviewed_by where pr.id = p.work_id)
      when 'annual_review' then (
        select cs.profile_id from public.annual_health_checks ah
          join public.clinical_staff cs on cs.id = ah.reviewed_by where ah.id = p.work_id)
      when 'care_message_thread' then (
        -- The first care-team reply is the piece of doctor time the credit
        -- paid for. author_role is scoped to 'care_team' so a sponsor's
        -- message can never be mistaken for the clinical reply.
        select cs.profile_id from public.care_messages m
          join public.clinical_staff cs on cs.id = m.actor_clinical_staff_id
         where m.thread_id = p.work_id and m.author_role = 'care_team'
         order by m.created_at
         limit 1)
      else null
    end as doctor_profile_id,
    case p.work_type
      when 'appointment' then (select a.status::text from public.appointments a where a.id = p.work_id)
      when 'verified_document' then (select vd.status::text from public.verified_documents vd where vd.id = p.work_id)
      when 'async_consult' then (select ac.status::text from public.async_consults ac where ac.id = p.work_id)
      when 'second_opinion_request' then (select so.status::text from public.second_opinion_requests so where so.id = p.work_id)
      when 'senior_case_review' then (select sc.status::text from public.senior_case_reviews sc where sc.id = p.work_id)
      when 'prescription_renewal_request' then (select pr.status::text from public.prescription_renewal_requests pr where pr.id = p.work_id)
      when 'annual_review' then (select ah.status::text from public.annual_health_checks ah where ah.id = p.work_id)
      when 'care_message_thread' then (select th.status::text from public.care_message_threads th where th.id = p.work_id)
      else null
    end as work_status
  from purchases p
)
select
  pr.source,
  pr.source_id,
  pr.product_code,
  pr.product_name,
  pr.patient_id,
  pr.organisation_id,
  pr.earned_at,
  pr.gross_minor,
  pr.revenue_minor,
  pr.currency,
  pr.work_type,
  pr.work_id,
  pr.work_status,
  pr.is_doctor_time,
  pr.doctor_profile_id,
  case
    when pr.doctor_profile_id is not null then 'attributed'
    when pr.work_id is not null           then 'unattributed'
    else 'no_single_job'
  end as attribution,
  -- How many pieces of doctor work the price is expected to cover
  -- (service_delivery_cost_model.units_per_term): 1 for a single-use credit,
  -- more for a term of standing cover, null for a product the cost model does
  -- not treat as doctor time at all. Carried through so a reader can tell a
  -- no_single_job row that is an unspent credit from one that is a term —
  -- deliberately NOT collapsed into the attribution label, because the schema
  -- holds no flag that reliably separates the two and guessing one here would
  -- be a fabricated fact rather than a reported one.
  pr.units_per_term as expected_jobs
from purchases_resolved pr

union all

-- Having a self-arranged laboratory result read and written up. Its own fee
-- and its own payment reference; accepted_by is the doctor who took it on.
select
  'lab_result_consult'::text,
  r.id,
  'written_result_interpretation'::text,
  'Written Result Interpretation'::text,
  r.patient_id,
  r.organisation_id,
  coalesce(r.accepted_at, r.updated_at, r.created_at),
  r.amount_minor::bigint,
  r.amount_minor::bigint,
  r.currency,
  'lab_result_consult_request'::text,
  r.id,
  r.status::text,
  true,
  cs.profile_id,
  case when cs.profile_id is not null then 'attributed' else 'unattributed' end,
  1::numeric
from public.lab_result_consult_requests r
left join public.clinical_staff cs on cs.id = r.accepted_by
-- 'requested'/'pending_payment' is money not taken yet; 'refunded'/'cancelled'
-- /'expired' is money given back or never taken.
where r.status in ('payment_confirmed', 'document_uploaded', 'accepted')
  and r.amount_minor > 0

union all

-- On-demand video/audio visit bought directly (as opposed to spending a
-- video_visit_credit, which arrives above as an 'appointment' redemption).
select
  'video_visit_request'::text,
  v.id,
  'video_visit_credit'::text,
  'On-Demand Video/Audio Visit'::text,
  v.patient_id,
  v.organisation_id,
  coalesce(v.accepted_at, v.updated_at, v.created_at),
  v.amount_minor::bigint,
  v.amount_minor::bigint,
  v.currency,
  'video_visit_request'::text,
  v.id,
  v.status::text,
  true,
  cs.profile_id,
  case when cs.profile_id is not null then 'attributed' else 'unattributed' end,
  1::numeric
from public.video_visit_requests v
left join public.clinical_staff cs on cs.id = v.accepted_by
where v.status in ('payment_confirmed', 'accepted')
  and v.amount_minor > 0;

comment on view private.doctor_paid_work is
  'One row per paid job, normalised across service_purchases, '
  'lab_result_consult_requests and video_visit_requests, with the doctor who '
  'did the work resolved to a profiles.id. Read only by '
  'public.analytics_doctor_income / public.analytics_doctor_paid_jobs, which '
  'gate on private.is_analyst(). attribution says why a row has no doctor: '
  'unattributed (the work exists, nobody is recorded against it) or '
  'no_single_job (the purchase names no one piece of work — an unspent credit '
  'or a term of standing cover; expected_jobs and the product say which).';

revoke all on private.doctor_paid_work from public;
revoke all on private.doctor_paid_work from anon;
revoke all on private.doctor_paid_work from authenticated;

-- ---------------------------------------------------------------------------
-- public.analytics_doctor_income — per-doctor income totals for a period,
-- plus the buckets that have no doctor, so the totals add up to everything
-- that was sold rather than only to the attributable part.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_doctor_income(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  return (
    with w as (
      select * from private.doctor_paid_work
       where (p_from is null or earned_at >= p_from)
         and (p_to   is null or earned_at <= p_to)
    )
    select jsonb_build_object(
      'by_doctor', coalesce((
        -- Ordered by the numeric total, not by d->>'revenue_minor' (which
        -- would sort 900000 above 1200000, lexicographically).
        select jsonb_agg(agg.d order by agg.sort_revenue desc, agg.d->>'doctor')
        from (
          select sum(w.revenue_minor)::bigint as sort_revenue,
          jsonb_build_object(
            'doctor_profile_id', w.doctor_profile_id,
            'doctor', coalesce(cs.full_name, p.full_name, '(unnamed)'),
            'tier', cs.doctor_tier::text,
            'employment_type', cs.employment_type::text,
            'active', coalesce(cs.active, false),
            'jobs', count(*),
            'patients', count(distinct w.patient_id),
            'revenue_minor', sum(w.revenue_minor)::bigint,
            'gross_minor', sum(w.gross_minor)::bigint,
            'currency', min(w.currency),
            'first_job_at', min(w.earned_at),
            'last_job_at', max(w.earned_at),
            'by_product', (
              select jsonb_agg(jsonb_build_object(
                       'product_code', x.product_code,
                       'product_name', x.product_name,
                       'jobs', x.jobs,
                       'revenue_minor', x.revenue_minor)
                     order by x.revenue_minor desc, x.product_name)
              from (
                select w2.product_code, min(w2.product_name) product_name,
                       count(*) jobs, sum(w2.revenue_minor)::bigint revenue_minor
                  from w w2
                 where w2.doctor_profile_id = w.doctor_profile_id
                 group by w2.product_code
              ) x
            )
          ) d
          from w
          left join public.profiles p on p.id = w.doctor_profile_id
          -- One clinical_staff row per profile is the norm; the lateral's
          -- order/limit keeps the row deterministic (and prefers the active
          -- one) if a profile ever carries two.
          left join lateral (
            select cs2.full_name, cs2.doctor_tier, cs2.employment_type, cs2.active
              from public.clinical_staff cs2
             where cs2.profile_id = w.doctor_profile_id
             order by cs2.active desc, cs2.created_at
             limit 1
          ) cs on true
          where w.doctor_profile_id is not null
          group by w.doctor_profile_id, cs.full_name, p.full_name, cs.doctor_tier,
                   cs.employment_type, cs.active
        ) agg
      ), '[]'::jsonb),
      -- Everything sold that no doctor is credited with, broken down by
      -- product as well as by reason — the product is what tells an analyst
      -- whether a no_single_job row is an unspent credit or a term of cover.
      'unattributed', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'attribution', t.attribution,
                 'product_code', t.product_code,
                 'product_name', t.product_name,
                 'is_doctor_time', t.is_doctor_time,
                 'expected_jobs', t.expected_jobs,
                 'jobs', t.jobs,
                 'revenue_minor', t.revenue_minor)
               order by t.revenue_minor desc, t.product_name)
        from (
          select attribution, product_code, min(product_name) product_name,
                 bool_or(is_doctor_time) is_doctor_time,
                 max(expected_jobs) expected_jobs,
                 count(*) jobs, sum(revenue_minor)::bigint revenue_minor
            from w where doctor_profile_id is null
           group by attribution, product_code
        ) t
      ), '[]'::jsonb),
      'by_source', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'source', t.source, 'jobs', t.jobs, 'revenue_minor', t.revenue_minor)
               order by t.revenue_minor desc)
        from (
          select source, count(*) jobs, sum(revenue_minor)::bigint revenue_minor
            from w group by source
        ) t
      ), '[]'::jsonb),
      'totals', (
        select jsonb_build_object(
          'jobs', count(*),
          'revenue_minor', coalesce(sum(revenue_minor), 0)::bigint,
          'gross_minor', coalesce(sum(gross_minor), 0)::bigint,
          'attributed_jobs', count(*) filter (where doctor_profile_id is not null),
          'attributed_revenue_minor',
            coalesce(sum(revenue_minor) filter (where doctor_profile_id is not null), 0)::bigint,
          'doctors', count(distinct doctor_profile_id)
        ) from w
      ),
      'period', jsonb_build_object('from', p_from, 'to', p_to)
    )
  );
end;
$$;

comment on function public.analytics_doctor_income(timestamptz, timestamptz) is
  'Analyst-gated. Income each doctor generated over a period, from every paid '
  'job attributable to them, plus the non-attributable buckets so the totals '
  'cover everything sold. Reports money earned; it does not compute or store '
  'a commission — no rate exists in this schema.';

revoke execute on function public.analytics_doctor_income(timestamptz, timestamptz) from public;
revoke execute on function public.analytics_doctor_income(timestamptz, timestamptz) from anon;
grant  execute on function public.analytics_doctor_income(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- public.analytics_doctor_paid_jobs — the line items behind one doctor's
-- total (or behind the whole period, with p_doctor_profile_id null).
--
-- De-identified the same way /analytics/doctors already is: the patient is a
-- patient number, never a name. An analyst is reconciling money, not reading
-- a clinical record.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_doctor_paid_jobs(
  p_doctor_profile_id uuid default null,
  p_from              timestamptz default null,
  p_to                timestamptz default null,
  p_limit             integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'source', t.source,
             'source_id', t.source_id,
             'product_code', t.product_code,
             'product_name', t.product_name,
             'work_type', t.work_type,
             'work_status', t.work_status,
             'is_doctor_time', t.is_doctor_time,
             'attribution', t.attribution,
             'doctor_profile_id', t.doctor_profile_id,
             'doctor', t.doctor,
             'patient_number', t.patient_number,
             'earned_at', t.earned_at,
             'revenue_minor', t.revenue_minor,
             'gross_minor', t.gross_minor,
             'currency', t.currency)
           order by t.earned_at desc nulls last)
    from (
      select w.source, w.source_id, w.product_code, w.product_name, w.work_type,
             w.work_status, w.is_doctor_time, w.attribution, w.doctor_profile_id,
             coalesce(cs.full_name, p.full_name) as doctor,
             pat.patient_number,
             w.earned_at, w.revenue_minor, w.gross_minor, w.currency
        from private.doctor_paid_work w
        left join public.profiles p on p.id = w.doctor_profile_id
        left join lateral (
          select cs2.full_name from public.clinical_staff cs2
           where cs2.profile_id = w.doctor_profile_id
           order by cs2.active desc, cs2.created_at limit 1
        ) cs on true
        left join public.profiles pat on pat.id = w.patient_id
       where (p_doctor_profile_id is null or w.doctor_profile_id = p_doctor_profile_id)
         and (p_from is null or w.earned_at >= p_from)
         and (p_to   is null or w.earned_at <= p_to)
       order by w.earned_at desc nulls last
       limit greatest(1, least(coalesce(p_limit, 500), 2000))
    ) t
  ), '[]'::jsonb);
end;
$$;

comment on function public.analytics_doctor_paid_jobs(uuid, timestamptz, timestamptz, integer) is
  'Analyst-gated line items behind public.analytics_doctor_income. Patients '
  'appear as patient numbers only, matching the de-identification the rest of '
  'the analyst console already applies.';

revoke execute on function public.analytics_doctor_paid_jobs(uuid, timestamptz, timestamptz, integer) from public;
revoke execute on function public.analytics_doctor_paid_jobs(uuid, timestamptz, timestamptz, integer) from anon;
grant  execute on function public.analytics_doctor_paid_jobs(uuid, timestamptz, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions — "it is analyst-gated and anon cannot reach it" proved here,
-- not assumed. anon inherits EXECUTE through the PUBLIC pseudo-role, so the
-- revoke that matters is the one from PUBLIC above; this checks the outcome
-- rather than trusting the grant statement.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.analytics_doctor_income(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_doctor_income';
  end if;
  if has_function_privilege('anon', 'public.analytics_doctor_paid_jobs(uuid, timestamptz, timestamptz, integer)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_doctor_paid_jobs';
  end if;
  if not has_function_privilege('authenticated', 'public.analytics_doctor_income(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute analytics_doctor_income';
  end if;
  if not has_function_privilege('authenticated', 'public.analytics_doctor_paid_jobs(uuid, timestamptz, timestamptz, integer)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute analytics_doctor_paid_jobs';
  end if;
  if has_table_privilege('anon', 'private.doctor_paid_work', 'SELECT')
     or has_table_privilege('authenticated', 'private.doctor_paid_work', 'SELECT') then
    raise exception 'FAIL: private.doctor_paid_work is directly readable';
  end if;
  raise notice 'PASS: doctor income RPCs are analyst-gated and the view is unreachable except through them';
end $$;

commit;
