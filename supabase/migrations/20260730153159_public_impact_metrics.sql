-- Tarragon Health
-- Public, anonymous-facing "impact" dashboard (M8 gap: "public outcomes
-- dashboard"). A fixed catalogue of platform-wide aggregate counts,
-- computed nightly by a private function -- never a live query against
-- patient tables in response to an anonymous request, and never anything
-- narrower than the whole platform (no per-organisation/per-institution
-- breakdown here at all, which is stricter than I9's "aggregate only for
-- institutions" -- the public gets no institution dimension whatsoever).
--
-- Small-cell suppression: any metric whose true count is below
-- v_floor (25) is stored as value=null/suppressed=true rather than shown
-- -- deliberately stricter than organisations.min_cohort_size (10), which
-- governs authenticated, org-scoped cohort dashboards (HMO/corporate) that
-- already have a legitimate relationship to their own members. A public,
-- anonymous audience gets a higher bar. patient_testimonials is the one
-- exempt metric: those rows are already individually public elsewhere on
-- the marketing site (name, photo, quote), so a raw count adds no privacy
-- exposure the page doesn't already carry.
--
-- Metrics are a fixed, admin-seeded set (not admin-creatable content, since
-- the whole point is that each metric_key has a specific, reviewed SQL
-- definition in the refresh function below) -- but is_published is a real
-- per-row admin toggle, same "give admin a kill switch before going live"
-- posture as marketing_resources/home_visit_providers.

create table public.public_impact_metrics (
  metric_key     text primary key,
  label          text not null,
  description    text,
  value          numeric,
  suppressed     boolean not null default true,
  display_order  integer not null default 100,
  is_published   boolean not null default true,
  computed_at    timestamptz,
  updated_at     timestamptz not null default now()
);

alter table public.public_impact_metrics enable row level security;

create policy public_impact_metrics_public_select on public.public_impact_metrics
  for select to anon, authenticated
  using (is_published or private.has_permission('impact_metrics.manage'));

grant select on public.public_impact_metrics to anon;
grant select on public.public_impact_metrics to authenticated;
-- Deliberately no insert/update/delete grant -- writes only via
-- private.refresh_public_impact_metrics() (cron/admin-triggered) and the
-- two admin RPCs below.

insert into public.public_impact_metrics (metric_key, label, description, display_order) values
  ('abnormal_results_escalated_90d', 'Abnormal results caught and escalated to a doctor', 'Screenings that came back abnormal or critical in the last 90 days, each one routed to a doctor for review.', 10),
  ('active_care_plans', 'Patients on an active chronic care plan', 'People currently being monitored under a doctor-authored care plan (hypertension, diabetes and more).', 20),
  ('screenings_completed_90d', 'Screenings completed in the last 90 days', 'Lab tests and health checks completed through the platform in the last quarter.', 30),
  ('vaccination_doses_verified', 'Vaccination doses verified', 'Doses reviewed and certified by a Tarragon doctor against an uploaded record.', 40),
  ('testimonials_published', 'Patient stories shared', 'Patients who chose to share their experience publicly.', 50)
on conflict (metric_key) do nothing;

create or replace function private.refresh_public_impact_metrics()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_floor constant integer := 25;
  v_val numeric;
begin
  select count(*) into v_val from public.screening_results
    where result_status in ('abnormal', 'critical') and created_at > now() - interval '90 days';
  update public.public_impact_metrics
    set value = case when v_val >= v_floor then v_val else null end,
        suppressed = v_val < v_floor, computed_at = now(), updated_at = now()
    where metric_key = 'abnormal_results_escalated_90d';

  select count(distinct patient_id) into v_val from public.care_plans where status = 'active';
  update public.public_impact_metrics
    set value = case when v_val >= v_floor then v_val else null end,
        suppressed = v_val < v_floor, computed_at = now(), updated_at = now()
    where metric_key = 'active_care_plans';

  select count(*) into v_val from public.screening_results where created_at > now() - interval '90 days';
  update public.public_impact_metrics
    set value = case when v_val >= v_floor then v_val else null end,
        suppressed = v_val < v_floor, computed_at = now(), updated_at = now()
    where metric_key = 'screenings_completed_90d';

  select count(*) into v_val from public.vaccination_records where verification_status = 'verified';
  update public.public_impact_metrics
    set value = case when v_val >= v_floor then v_val else null end,
        suppressed = v_val < v_floor, computed_at = now(), updated_at = now()
    where metric_key = 'vaccination_doses_verified';

  -- Exempt from the suppression floor -- see header comment.
  select count(*) into v_val from public.patient_testimonials where status = 'published';
  update public.public_impact_metrics
    set value = v_val, suppressed = false, computed_at = now(), updated_at = now()
    where metric_key = 'testimonials_published';
end;
$$;

revoke all on function private.refresh_public_impact_metrics() from public, anon;
revoke all on function private.refresh_public_impact_metrics() from anon;

-- Populate real numbers immediately rather than waiting for the first cron tick.
select private.refresh_public_impact_metrics();

select cron.schedule('public-impact-metrics-refresh-daily', '20 3 * * *', $$select private.refresh_public_impact_metrics();$$);

insert into public.permissions (key, label, category) values
  ('impact_metrics.manage', 'Manage public impact dashboard', 'Operations')
on conflict (key) do nothing;

create or replace function public.admin_refresh_public_impact_metrics()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_permission('impact_metrics.manage') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform private.refresh_public_impact_metrics();
  perform private.log_audit('impact_metrics.recomputed', 'public_impact_metrics', null::uuid, '{}'::jsonb);
end;
$$;

revoke all on function public.admin_refresh_public_impact_metrics() from public, anon;
revoke all on function public.admin_refresh_public_impact_metrics() from anon;
grant execute on function public.admin_refresh_public_impact_metrics() to authenticated;

create or replace function public.admin_set_impact_metric_published(p_metric_key text, p_is_published boolean)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_permission('impact_metrics.manage') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  update public.public_impact_metrics
    set is_published = p_is_published, updated_at = now()
    where metric_key = p_metric_key;
  perform private.log_audit('impact_metrics.publish_toggled', 'public_impact_metrics', null::uuid,
    jsonb_build_object('metric_key', p_metric_key, 'is_published', p_is_published));
end;
$$;

revoke all on function public.admin_set_impact_metric_published(text, boolean) from public, anon;
revoke all on function public.admin_set_impact_metric_published(text, boolean) from anon;
grant execute on function public.admin_set_impact_metric_published(text, boolean) to authenticated;

do $$
begin
  if (select count(*) from public.public_impact_metrics) <> 5 then
    raise exception 'expected exactly 5 seeded impact metrics';
  end if;
  if has_function_privilege('anon', 'public.admin_refresh_public_impact_metrics()', 'EXECUTE') then
    raise exception 'anon must not be able to execute admin_refresh_public_impact_metrics';
  end if;
  if has_function_privilege('anon', 'public.admin_set_impact_metric_published(text, boolean)', 'EXECUTE') then
    raise exception 'anon must not be able to execute admin_set_impact_metric_published';
  end if;
end $$;
