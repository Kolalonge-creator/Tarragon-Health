-- Follow-up to 20260922190157_doctor_paid_work_and_income_analytics.sql —
-- fixes found by /code-review high before this branch was merged. Not a
-- production incident: the original migration never shipped past this
-- session's own worktree, but per this project's own convention (see e.g.
-- 20260916024151_fix_lab_result_consult_fee_stale_service_product_fallback.sql)
-- a fix to an already-applied migration is a new migration, never a silent
-- edit to the old file's content.
--
-- 1. CANCELLED APPOINTMENTS STILL CREDITED A DOCTOR
--    appointments.clinician_id is set at booking time, unlike every other
--    redemption target's actor column (issued_by/answered_by/reviewed_by/
--    actor_clinical_staff_id), which is only set once the work is actually
--    done. cancel_appointment() (confirmed live via pg_get_functiondef) only
--    ever updates the appointments row — it never reconciles the
--    service_purchases row that redeemed a credit to book it. Left as-is,
--    a doctor is credited (and could be commissioned) for a visit that was
--    cancelled and never happened. Fixed by excluding the doctor
--    attribution — not the revenue itself, which is a separate, platform-
--    wide refund-reconciliation gap shared with analytics_revenue_by_
--    product and out of scope here — when the appointment's own status
--    shows it was cancelled.
--
-- 2. TWO SEPARATE CASE TREES FOR THE SAME WORK_TYPE DISPATCH
--    doctor_profile_id and work_status were each resolved by their own
--    7-branch `case work_type` (14 correlated subqueries per row instead of
--    7), with no guarantee the two trees stay in lockstep as redemption
--    types are added. Replaced with one `left join lateral` per work_type
--    resolving both columns together.
--
-- 3. THE CLINICAL_STAFF "CURRENT ROW FOR A PROFILE" LOOKUP WAS DUPLICATED
--    Both RPCs ran the identical `order by active desc, created_at desc
--    limit 1` lateral independently. Factored into a shared private view.
--
-- 4. by_product WAS O(DOCTORS x ROWS), NOT O(ROWS)
--    Every doctor's per-product breakdown re-scanned the entire (unindexed,
--    materialized) `w` CTE via a correlated subquery. Fixed with a single
--    GROUP BY (doctor_profile_id, product_code) pre-aggregation pass that
--    every doctor's by_product then reads from — O(rows) once, not
--    O(doctors x rows).
--
-- 5. MIXED-CURRENCY TOTALS WERE SILENTLY SUMMED
--    sum(revenue_minor) across every row for a doctor, labelled with
--    min(currency) — an arbitrary pick, not a validated single currency.
--    Live data today is 100% NGN (confirmed), but the currency enum still
--    permits GBP/USD from the platform's pre-2026-07-31 diaspora-
--    subscription history. Rather than a speculative multi-currency
--    redesign for zero live rows, this adds a `mixed_currency` flag (true
--    when a doctor's rows span more than one currency) so the UI can warn
--    rather than silently mis-sum — the minimal fix that turns a silent
--    wrong number into a visibly flagged one.
--
-- 6. NO DB-LEVEL GUARD ON THE REDEMPTION-TYPE DISPATCH LIST
--    service_purchases.redeemed_entity_type was bare text with nothing
--    enumerating the 9 values every reader of this column (including this
--    view) assumes are exhaustive. A future 9th/10th type added at an app
--    call site would silently fall through this view's dispatch into
--    'unattributed' with no error — the "wrong zero is the hardest kind of
--    wrong to notice" class of bug this codebase has been bitten by
--    repeatedly (per CLAUDE.md). Added a CHECK constraint enumerating the
--    9 values actually in use today (confirmed via every real
--    redeem_available_service_purchase call site in supabase/migrations).

begin;

-- ---------------------------------------------------------------------------
-- 6. Guard the dispatch list at the schema level.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'service_purchases_redeemed_entity_type_known'
  ) then
    alter table public.service_purchases
      add constraint service_purchases_redeemed_entity_type_known
      check (redeemed_entity_type is null or redeemed_entity_type in (
        'appointment', 'verified_document', 'async_consult',
        'second_opinion_request', 'senior_case_review',
        'prescription_renewal_request', 'annual_review',
        'care_message_thread', 'screening_schedule'
      )) not valid;
    -- NOT VALID + separate VALIDATE avoids taking a table lock that blocks
    -- concurrent writes while every existing row is checked; the constraint
    -- still applies to every new/updated row immediately.
    alter table public.service_purchases
      validate constraint service_purchases_redeemed_entity_type_known;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Shared "current clinical_staff row for a profile" resolution.
-- ---------------------------------------------------------------------------
create or replace view private.doctor_current_staff as
select distinct on (cs.profile_id)
  cs.profile_id, cs.full_name, cs.doctor_tier, cs.employment_type, cs.active
from public.clinical_staff cs
order by cs.profile_id, cs.active desc, cs.created_at desc;

comment on view private.doctor_current_staff is
  'One row per clinical_staff.profile_id — the most-recently-created active '
  'row if a profile ever carries more than one, else the most recent row '
  'overall. Shared by public.analytics_doctor_income and public.'
  'analytics_doctor_paid_jobs so the tie-break rule lives in exactly one '
  'place (20260922192544 fixed a duplicated copy of this same lateral).';

revoke all on private.doctor_current_staff from public;
revoke all on private.doctor_current_staff from anon;
revoke all on private.doctor_current_staff from authenticated;

-- ---------------------------------------------------------------------------
-- 1 & 2. private.doctor_paid_work — one lateral per work_type, both columns
-- at once, and the cancelled-appointment carve-out.
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
    case
      -- A cancelled appointment never happened; the doctor named at
      -- booking time isn't credited with income for it, even though the
      -- credit was spent (the row still counts as revenue — reconciling
      -- service_purchases itself on cancellation is a separate, platform-
      -- wide gap, not something this view alone should paper over).
      when p.work_type = 'appointment'
           and appt.work_status in ('cancelled', 'patient_cancelled', 'provider_cancelled')
        then null
      else coalesce(
        appt.doctor_profile_id, vdoc.doctor_profile_id, ac.doctor_profile_id,
        so.doctor_profile_id, sc.doctor_profile_id, pr.doctor_profile_id,
        ah.doctor_profile_id, cmt.doctor_profile_id
      )
    end as doctor_profile_id,
    coalesce(
      appt.work_status, vdoc.work_status, ac.work_status, so.work_status,
      sc.work_status, pr.work_status, ah.work_status, cmt.work_status
    ) as work_status
  from purchases p
  left join lateral (
    select a.clinician_id as doctor_profile_id, a.status::text as work_status
      from public.appointments a
     where p.work_type = 'appointment' and a.id = p.work_id
  ) appt on true
  left join lateral (
    select cs.profile_id as doctor_profile_id, vd.status::text as work_status
      from public.verified_documents vd
      join public.clinical_staff cs on cs.id = vd.issued_by
     where p.work_type = 'verified_document' and vd.id = p.work_id
  ) vdoc on true
  left join lateral (
    select cs.profile_id as doctor_profile_id, x.status::text as work_status
      from public.async_consults x
      join public.clinical_staff cs on cs.id = x.answered_by
     where p.work_type = 'async_consult' and x.id = p.work_id
  ) ac on true
  left join lateral (
    select cs.profile_id as doctor_profile_id, x.status::text as work_status
      from public.second_opinion_requests x
      join public.clinical_staff cs on cs.id = x.answered_by
     where p.work_type = 'second_opinion_request' and x.id = p.work_id
  ) so on true
  left join lateral (
    select cs.profile_id as doctor_profile_id, x.status::text as work_status
      from public.senior_case_reviews x
      join public.clinical_staff cs on cs.id = x.reviewed_by
     where p.work_type = 'senior_case_review' and x.id = p.work_id
  ) sc on true
  left join lateral (
    select cs.profile_id as doctor_profile_id, x.status::text as work_status
      from public.prescription_renewal_requests x
      join public.clinical_staff cs on cs.id = x.reviewed_by
     where p.work_type = 'prescription_renewal_request' and x.id = p.work_id
  ) pr on true
  left join lateral (
    select cs.profile_id as doctor_profile_id, x.status::text as work_status
      from public.annual_health_checks x
      join public.clinical_staff cs on cs.id = x.reviewed_by
     where p.work_type = 'annual_review' and x.id = p.work_id
  ) ah on true
  left join lateral (
    -- The first care-team reply is the piece of doctor time the credit
    -- paid for. author_role is scoped to 'care_team' so a sponsor's
    -- message can never be mistaken for the clinical reply.
    select cs.profile_id as doctor_profile_id, th.status::text as work_status
      from public.care_message_threads th
      left join public.care_messages m
        on m.thread_id = th.id and m.author_role = 'care_team'
      left join public.clinical_staff cs on cs.id = m.actor_clinical_staff_id
     where p.work_type = 'care_message_thread' and th.id = p.work_id
     order by m.created_at
     limit 1
  ) cmt on true
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
  'unattributed (the work exists, nobody is recorded against it, OR an '
  'appointment that was cancelled after being booked) or no_single_job (the '
  'purchase names no one piece of work — an unspent credit or a term of '
  'standing cover; expected_jobs and the product say which).';

revoke all on private.doctor_paid_work from public;
revoke all on private.doctor_paid_work from anon;
revoke all on private.doctor_paid_work from authenticated;

-- ---------------------------------------------------------------------------
-- 4 & 5. public.analytics_doctor_income — pre-aggregated by_product, and a
-- mixed_currency flag per doctor.
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
    ),
    -- One linear pass: every (doctor, product) combination's totals,
    -- computed once rather than re-scanning `w` once per doctor via a
    -- correlated subquery (was O(doctors x rows), now O(rows)).
    doctor_product as (
      select doctor_profile_id, product_code, min(product_name) as product_name,
             count(*) as jobs, sum(revenue_minor)::bigint as revenue_minor
        from w
       where doctor_profile_id is not null
       group by doctor_profile_id, product_code
    )
    select jsonb_build_object(
      'by_doctor', coalesce((
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
            -- Live data is 100% NGN today, but the currency enum still
            -- permits GBP/USD from the pre-2026-07-31 diaspora history —
            -- this flags rather than silently sums across currencies.
            'mixed_currency', count(distinct w.currency) > 1,
            'first_job_at', min(w.earned_at),
            'last_job_at', max(w.earned_at),
            'by_product', (
              select jsonb_agg(jsonb_build_object(
                       'product_code', dp.product_code,
                       'product_name', dp.product_name,
                       'jobs', dp.jobs,
                       'revenue_minor', dp.revenue_minor)
                     order by dp.revenue_minor desc, dp.product_name)
              from doctor_product dp
              where dp.doctor_profile_id = w.doctor_profile_id
            )
          ) d
          from w
          left join public.profiles p on p.id = w.doctor_profile_id
          left join private.doctor_current_staff cs on cs.profile_id = w.doctor_profile_id
          where w.doctor_profile_id is not null
          group by w.doctor_profile_id, cs.full_name, p.full_name, cs.doctor_tier,
                   cs.employment_type, cs.active
        ) agg
      ), '[]'::jsonb),
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
-- 3. public.analytics_doctor_paid_jobs — now reads the shared
-- private.doctor_current_staff view instead of its own lateral copy.
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
        left join private.doctor_current_staff cs on cs.profile_id = w.doctor_profile_id
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
-- Assertions.
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
  if has_table_privilege('anon', 'private.doctor_current_staff', 'SELECT')
     or has_table_privilege('authenticated', 'private.doctor_current_staff', 'SELECT') then
    raise exception 'FAIL: private.doctor_current_staff is directly readable';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'service_purchases_redeemed_entity_type_known' and convalidated
  ) then
    raise exception 'FAIL: service_purchases_redeemed_entity_type_known is missing or not validated';
  end if;
  raise notice 'PASS: doctor income review fixes applied and re-verified';
end $$;

commit;
