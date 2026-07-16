-- Tarragon Health
-- Derived "care gap" concept for the Employer/HMO risk-stratification
-- dashboards (Category 4, docs/Tarragon_Health_Master_Operating_Plan_v4.md
-- §13 — "HMO dashboard: member monitoring, risk stratification, care gap
-- tracking, outcome reporting"). A gap is derived state, not owned data —
-- no new mutable table, just a view over screening_schedules/care_plans/
-- patient_risk_scores/screening_results that already exist and already
-- carry their own RLS. security_invoker is critical here: a
-- security_definer view would let any org's staff see every other org's
-- patients, since the view itself has no organisation_id filter of its
-- own — it relies entirely on the underlying tables' RLS being evaluated
-- as the calling user, not the view owner.
--
-- Three gap shapes, unioned:
--   overdue_screening    — screening_schedules past due_date, still
--                          pending/booked (or explicitly 'overdue').
--   stale_monitoring     — an active care_plan with no patient_risk_scores
--                          row logged inside that condition's review
--                          window (90 days for hypertension/diabetes/
--                          cardiovascular/ckd, 180 for obesity/other since
--                          those aren't reviewed on the same cadence).
--   unactioned_abnormal  — an abnormal/critical screening_results row with
--                          no active care_plan opened for that patient
--                          since the result landed (nothing yet escalated
--                          it into ongoing management).
--
-- "Closed" isn't tracked as a separate historical ledger (gaps are derived,
-- recomputed live) — the dashboard's "closed in last N days" figure is
-- computed by the TS query layer (load-care-gaps.ts) diffing today's open
-- gaps against a lookback window, not by this view maintaining state.

create view public.patient_care_gaps
with (security_invoker = true) as
  select
    'overdue_screening'::text as gap_type,
    ss.patient_id,
    ss.organisation_id,
    st.name as condition_or_type,
    ss.due_date::timestamptz as opened_at,
    jsonb_build_object('screen_type', st.name, 'due_date', ss.due_date, 'status', ss.status) as detail
  from public.screening_schedules ss
  join public.screen_types st on st.id = ss.screen_type_id
  where ss.status in ('pending', 'booked', 'overdue')
    and ss.due_date < current_date

  union all

  select
    'stale_monitoring'::text as gap_type,
    cp.patient_id,
    cp.organisation_id,
    cp.condition::text as condition_or_type,
    cp.created_at as opened_at,
    jsonb_build_object(
      'condition', cp.condition,
      'care_plan_id', cp.id,
      'last_reading_at', latest_score.computed_at
    ) as detail
  from public.care_plans cp
  left join lateral (
    select computed_at
    from public.patient_risk_scores prs
    where prs.patient_id = cp.patient_id
    order by prs.computed_at desc
    limit 1
  ) latest_score on true
  where cp.status = 'active'
    and (
      latest_score.computed_at is null
      or latest_score.computed_at < now() - (
        case cp.condition
          when 'hypertension' then interval '90 days'
          when 'diabetes' then interval '90 days'
          when 'cardiovascular' then interval '90 days'
          when 'ckd' then interval '90 days'
          else interval '180 days'
        end
      )
    )

  union all

  select
    'unactioned_abnormal'::text as gap_type,
    sr.patient_id,
    sr.organisation_id,
    coalesce(sr.result_summary, 'abnormal result')::text as condition_or_type,
    sr.created_at as opened_at,
    jsonb_build_object(
      'result_id', sr.id,
      'result_status', sr.result_status,
      'abnormal_flags', sr.abnormal_flags
    ) as detail
  from public.screening_results sr
  where sr.result_status in ('abnormal', 'critical')
    and not exists (
      select 1 from public.care_plans cp
      where cp.patient_id = sr.patient_id
        and cp.status = 'active'
        and cp.created_at >= sr.created_at
    );

comment on view public.patient_care_gaps is
  'Derived, RLS-respecting (security_invoker) view of open care gaps per patient — overdue screenings, stale chronic monitoring, and unactioned abnormal results. No independent access control of its own; relies entirely on screening_schedules/care_plans/screening_results/patient_risk_scores RLS being evaluated as the querying user.';

grant select on public.patient_care_gaps to authenticated;

-- ---------------------------------------------------------------------------
-- cohort_cost_model_constants — the "estimated cost avoided" figure shown
-- on the HMO dashboard's claims-impact card is a modeled business estimate,
-- not a real claims-integration feed (Tarragon has no HMO claims data
-- pipeline). This makes the per-catch estimate an ops-editable input rather
-- than a hardcoded magic number in application code, and gives each HMO
-- contract room for its own negotiated figure without a code change.
-- organisation_id null = platform-wide default; non-null = an org-specific
-- override (e.g. a negotiated HMO contract figure).
-- ---------------------------------------------------------------------------

create table public.cohort_cost_model_constants (
  id                                              uuid primary key default gen_random_uuid(),
  organisation_id                                 uuid references public.organisations (id) on delete cascade,
  estimated_cost_avoided_per_abnormal_catch_kobo  bigint not null default 0,
  updated_at                                      timestamptz not null default now(),
  updated_by                                       uuid references public.profiles (id) on delete set null,
  constraint cohort_cost_model_constants_org_unique unique (organisation_id)
);

-- Partial unique index so there is ever only one platform-default row
-- (organisation_id is null) — a plain unique constraint on a nullable
-- column allows multiple nulls in Postgres, so this needs its own index.
create unique index cohort_cost_model_constants_default_idx
  on public.cohort_cost_model_constants ((organisation_id is null))
  where organisation_id is null;

create trigger cohort_cost_model_constants_set_updated_at
  before update on public.cohort_cost_model_constants
  for each row execute function private.set_updated_at();

alter table public.cohort_cost_model_constants enable row level security;

create policy cohort_cost_model_constants_select on public.cohort_cost_model_constants
  for select to authenticated
  using (organisation_id is null or private.is_org_staff(organisation_id));
create policy cohort_cost_model_constants_insert on public.cohort_cost_model_constants
  for insert to authenticated
  with check (private.is_admin());
create policy cohort_cost_model_constants_update on public.cohort_cost_model_constants
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());
create policy cohort_cost_model_constants_delete on public.cohort_cost_model_constants
  for delete to authenticated
  using (private.is_admin());

grant select, insert, update, delete on public.cohort_cost_model_constants to authenticated;

-- Placeholder platform default (₦150,000/abnormal catch) — a launch-estimate
-- business figure, not a real actuarial number. An admin should tune this
-- via the app once real HMO renewal conversations supply better data; every
-- UI surface rendering it must carry a persistent "modeled estimate" label.
insert into public.cohort_cost_model_constants (organisation_id, estimated_cost_avoided_per_abnormal_catch_kobo)
values (null, 15000000);
