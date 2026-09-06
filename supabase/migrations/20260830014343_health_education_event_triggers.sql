-- Tarragon Health — Health Education: care-event-triggered education (§79.13)
--
-- "After a medication change: here is information about your new
-- medication." / "After abnormal cholesterol: learn how cholesterol
-- affects cardiovascular health." Today the feed is pull-based (condition +
-- risk gates visibility); nothing pushes a specific item in reaction to a
-- specific event. This migration adds two real hooks:
--   • medications AFTER INSERT (a new active medication = a medication
--     change) — the safe integration point; the abnormal-result-handler
--     Edge Function itself is deliberately NOT touched (it's the platform's
--     single highest-priority safety pipeline — see
--     docs/MASTER_ARCHITECTURE_BLUEPRINT_GAP_ANALYSIS.md §2/§4 — and
--     editing it carries real deploy risk this migration doesn't need to
--     take on).
--   • screening_results AFTER INSERT where abnormal_flags is non-empty —
--     reacts to the SAME data the abnormal-result-handler reads, as an
--     additive second consumer, without modifying that function at all.
--
-- Matching is data-driven (health_education_trigger_mappings), not
-- hardcoded PL/pgSQL string logic, matching this codebase's existing
-- config-as-data pattern (alert_rules, drug_monitoring_rules). The seeded
-- match_key values below are a reasonable starting mapping, NOT verified
-- against every producer of `screening_results.abnormal_flags` across the
-- codebase — flagging this as a founder/clinical follow-up to reconcile
-- against the actual flag vocabulary in use, the same "[LOCALISE]"-style
-- caveat used throughout the pathway gap-closure plans for facts needing
-- human sign-off.

create table if not exists public.health_education_trigger_mappings (
  id              uuid primary key default gen_random_uuid(),
  trigger_source  text not null check (trigger_source in ('medication', 'abnormal_result')),
  -- medication: matched against lower(drug_name) via `like`. abnormal_result:
  -- matched against a screening_results.abnormal_flags element, case-insensitive.
  match_key       text not null,
  target_content_id uuid references public.health_education_content (id) on delete cascade,
  target_category public.health_education_category,
  target_condition public.care_plan_condition,
  note            text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists health_education_trigger_mappings_source_idx
  on public.health_education_trigger_mappings (trigger_source, is_active);

alter table public.health_education_trigger_mappings enable row level security;
drop policy if exists health_education_trigger_mappings_select on public.health_education_trigger_mappings;
create policy health_education_trigger_mappings_select on public.health_education_trigger_mappings
  for select to authenticated using (private.is_admin());
drop policy if exists health_education_trigger_mappings_write on public.health_education_trigger_mappings;
create policy health_education_trigger_mappings_write on public.health_education_trigger_mappings
  for all to authenticated using (private.is_admin()) with check (private.is_admin());
grant select, insert, update, delete on public.health_education_trigger_mappings to authenticated;

create table if not exists public.health_education_recommendations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  content_id      uuid not null references public.health_education_content (id) on delete cascade,
  trigger_reason  text not null,
  triggered_at    timestamptz not null default now(),
  viewed_at       timestamptz,
  dismissed_at    timestamptz
);
create index if not exists health_education_recommendations_patient_idx
  on public.health_education_recommendations (patient_id, triggered_at desc);
create index if not exists health_education_recommendations_org_idx
  on public.health_education_recommendations (organisation_id);

alter table public.health_education_recommendations enable row level security;
drop policy if exists health_education_recommendations_select on public.health_education_recommendations;
create policy health_education_recommendations_select on public.health_education_recommendations
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists health_education_recommendations_update on public.health_education_recommendations;
create policy health_education_recommendations_update on public.health_education_recommendations
  for update to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()));
grant select, update on public.health_education_recommendations to authenticated;

-- ============================================================================
-- Medication-change hook.
-- ============================================================================
create or replace function private.health_education_recommend_on_medication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condition public.care_plan_condition;
  v_content record;
begin
  if not new.is_active then
    return new;
  end if;

  select cp.condition into v_condition
  from public.care_plans cp where cp.id = new.care_plan_id;

  for v_content in
    select distinct c.id
    from public.health_education_trigger_mappings tm
    join public.health_education_content c
      on c.is_active
      and (tm.target_content_id is null or c.id = tm.target_content_id)
      and (tm.target_category is null or c.category = tm.target_category)
      and (tm.target_condition is null or c.condition = tm.target_condition or c.condition is null)
    where tm.is_active
      and tm.trigger_source = 'medication'
      and lower(new.drug_name) like '%' || lower(tm.match_key) || '%'
      and (tm.target_condition is null or tm.target_condition = v_condition)
  loop
    insert into public.health_education_recommendations (organisation_id, patient_id, content_id, trigger_reason)
    values (new.organisation_id, new.patient_id, v_content.id, format('New medication: %s', new.drug_name));
  end loop;

  return new;
end;
$$;

drop trigger if exists health_education_recommend_on_medication on public.medications;
create trigger health_education_recommend_on_medication
  after insert on public.medications
  for each row execute function private.health_education_recommend_on_medication();

-- ============================================================================
-- Abnormal-screening-result hook.
-- ============================================================================
create or replace function private.health_education_recommend_on_abnormal_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag text;
  v_content record;
begin
  if new.abnormal_flags is null or array_length(new.abnormal_flags, 1) is null then
    return new;
  end if;

  foreach v_flag in array new.abnormal_flags loop
    for v_content in
      select distinct c.id
      from public.health_education_trigger_mappings tm
      join public.health_education_content c
        on c.is_active
        and (tm.target_content_id is null or c.id = tm.target_content_id)
        and (tm.target_category is null or c.category = tm.target_category)
        and (tm.target_condition is null or c.condition = tm.target_condition or c.condition is null)
      where tm.is_active
        and tm.trigger_source = 'abnormal_result'
        and lower(v_flag) like '%' || lower(tm.match_key) || '%'
    loop
      insert into public.health_education_recommendations (organisation_id, patient_id, content_id, trigger_reason)
      values (new.organisation_id, new.patient_id, v_content.id, format('Abnormal result: %s', v_flag));
    end loop;
  end loop;

  return new;
end;
$$;

drop trigger if exists health_education_recommend_on_abnormal_result on public.screening_results;
create trigger health_education_recommend_on_abnormal_result
  after insert on public.screening_results
  for each row execute function private.health_education_recommend_on_abnormal_result();

-- ============================================================================
-- Seed a starting mapping (targets categories/conditions, not specific
-- content ids, so it stays valid as the library grows). Verify match_key
-- values against real abnormal_flags vocabulary before relying on this in
-- production — see the migration header.
-- ============================================================================
insert into public.health_education_trigger_mappings (trigger_source, match_key, target_category, note)
values
  ('abnormal_result', 'cholesterol', 'heart', 'Abnormal cholesterol -> cardiovascular education'),
  ('abnormal_result', 'lipid', 'heart', 'Abnormal lipid panel -> cardiovascular education'),
  ('abnormal_result', 'ldl', 'heart', 'Abnormal LDL -> cardiovascular education'),
  ('abnormal_result', 'glucose', 'diabetes', 'Abnormal glucose -> diabetes education'),
  ('abnormal_result', 'hba1c', 'diabetes', 'Abnormal HbA1c -> diabetes education'),
  ('abnormal_result', 'blood_pressure', 'hypertension', 'Abnormal BP screening -> hypertension education'),
  ('medication', 'amlodipine', 'medicines', 'New CCB -> medicines education'),
  ('medication', 'losartan', 'medicines', 'New ARB -> medicines education'),
  ('medication', 'metformin', 'medicines', 'New metformin -> medicines education'),
  ('medication', 'statin', 'medicines', 'New statin -> medicines education')
on conflict do nothing;
