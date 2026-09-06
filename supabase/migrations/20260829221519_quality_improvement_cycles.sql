-- Tarragon Health
-- Clinical Governance gap-closure, item 4 of 6 (§88.13 "quality improvement"
-- — completing a PARTIAL item). Confirmed live before writing this:
-- diabetes_quality_metrics (and this pass's new hypertension_quality_metrics
-- / obesity_quality_metrics) measure against a target, but nothing links a
-- below-target metric to an intervention and a follow-up measurement --
-- the spec's own Measure -> Identify gap -> Intervention -> Re-measure loop
-- has no table.
--
-- Deliberately NOT gated the way clinical_incident_reports/
-- safeguarding_concerns are (any org staff may file): reviewing a quality
-- metric and deciding an intervention is a clinical-governance act, not a
-- "anyone can flag a concern" one, so this follows is_clinical_tier
-- (matching clinical_encounter_notes' own gate) rather than is_org_staff.
--
-- metric_source is freetext, not an FK, on purpose: the metric views this
-- cycle might reference (diabetes/hypertension/obesity_quality_metrics)
-- are organisation-level aggregates with no row-level identity to key a
-- foreign key against -- same reason clinical_rules.protocol_version_id is
-- the only real FK in that table and everything else there is freetext/jsonb.

create table public.quality_improvement_cycles (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,

  condition             public.care_plan_condition,
  metric_source         text not null check (length(btrim(metric_source)) > 0),
  baseline_value        numeric,
  baseline_measured_at  date not null,
  gap_description       text not null check (length(btrim(gap_description)) > 0),

  intervention          text,
  intervention_started_at date,
  target_value          numeric,

  remeasure_value       numeric,
  remeasured_at         date,
  outcome_note          text,

  status                text not null default 'open' check (status in ('open', 'intervention_active', 'remeasured', 'closed')),

  owner_staff            uuid references public.clinical_staff (id) on delete restrict,
  created_by            uuid references public.profiles (id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint qi_cycles_intervention_active_requires_intervention check (
    status not in ('intervention_active', 'remeasured', 'closed')
    or (intervention is not null and length(btrim(intervention)) > 0 and intervention_started_at is not null)
  ),
  constraint qi_cycles_remeasured_requires_value check (
    status not in ('remeasured', 'closed')
    or (remeasure_value is not null and remeasured_at is not null)
  )
);

comment on table public.quality_improvement_cycles is
  'The Measure -> Identify gap -> Intervention -> Re-measure loop, docs spec §88.13. metric_source names which view/measure prompted this (e.g. "diabetes_quality_metrics.foot_uptodate_pct"), freetext by design since the quality views are organisation-level aggregates with no row to key a foreign key against.';

create index qi_cycles_org_status_idx on public.quality_improvement_cycles (organisation_id, status, created_at desc);

alter table public.quality_improvement_cycles enable row level security;

create policy qi_cycles_select on public.quality_improvement_cycles
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy qi_cycles_insert on public.quality_improvement_cycles
  for insert to authenticated
  with check (private.is_clinical_tier(organisation_id));

create policy qi_cycles_update on public.quality_improvement_cycles
  for update to authenticated
  using (private.is_clinical_tier(organisation_id))
  with check (private.is_clinical_tier(organisation_id));

grant select, insert, update on public.quality_improvement_cycles to authenticated;
revoke delete on public.quality_improvement_cycles from authenticated;

create trigger qi_cycles_set_updated_at
  before update on public.quality_improvement_cycles
  for each row execute function private.set_updated_at();

create or replace function private.enforce_qi_cycle_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    return new;
  end if;

  new.created_by := old.created_by;
  return new;
end;
$$;

comment on function private.enforce_qi_cycle_attribution() is
  'Forces created_by server-side from auth.uid(), same "never trust a client-supplied attribution" discipline as every other governance table this pass touched.';

create trigger qi_cycles_enforce_attribution
  before insert or update on public.quality_improvement_cycles
  for each row execute function private.enforce_qi_cycle_attribution();

revoke all on function private.enforce_qi_cycle_attribution() from public;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'quality_improvement_cycles') then
    raise exception 'quality_improvement_cycles missing after migration';
  end if;
  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'quality_improvement_cycles' and cmd = 'DELETE'
  ) then
    raise exception 'quality_improvement_cycles must have no DELETE policy';
  end if;
  if has_table_privilege('authenticated', 'public.quality_improvement_cycles', 'DELETE') then
    raise exception 'authenticated must not hold DELETE on quality_improvement_cycles';
  end if;
  raise notice 'PASS: quality_improvement_cycles created, RLS + attribution trigger present';
end $$;
