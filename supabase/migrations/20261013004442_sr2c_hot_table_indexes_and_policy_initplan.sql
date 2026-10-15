-- SR2c: the highest-value performance-advisor classes, scoped to the hot tables. See docs/design/SR2-advisor-triage.md.
--
-- COUNT FIRST (read-only against live koiplnmbgnqnbywhpjlf, 2026-10-12):
--   * 2,123 foreign keys in public, 1,019 with no covering index. This migration covers the 25 that sit on the tables the
--     queue, paging, emergency, vitals, labs and encounter paths use. The other ~995 are on cold or tiny tables
--     (live holds 12 profiles); indexing all of them would add write cost for no read benefit and is listed in the
--     triage file instead of done.
--   * organisation_id foreign keys on those tables are deliberately NOT indexed: the platform has one organisation, so
--     the column has a single value, an index on it cannot be selective, and a delete of an organisation does not happen.
--   * Live row counts on the target tables: clinical_tasks 0, task_claims 0, clinical_task_transitions 0, encounters 0,
--     clinical_encounters (small), vitals_readings 12, lab_orders and emergency_events a handful. Plain CREATE INDEX is
--     therefore instant and safe inside the migration transaction. If this is ever replayed on a populated copy, build
--     with CREATE INDEX CONCURRENTLY by hand first, then let the IF NOT EXISTS here no-op.
--   * Nullable foreign-key columns get partial indexes (where col is not null): the check a delete on the parent runs is
--     `col = $1`, a strict comparison the planner proves implies not null, so the partial index serves it and stays
--     small while the column is mostly empty (actor columns, override columns).
--   * 6 RLS policies still had a bare auth.uid() (656 elsewhere were already wrapped); 5 are fixed here, the sixth
--     (scribe_consents_insert_clinical) is branch-owned drift, see below. Each is re-expressed as
--     (select auth.uid()) so Postgres evaluates it once per statement instead of once per row. Meaning is identical.
--   * 1 duplicate index proven identical (same table, same columns, same order, same predicate): public.async_consults
--     async_consults_patient_idx and async_consults_patient_month_idx are both btree (patient_id, created_at desc). The
--     second is dropped, the first kept.
--   * Multiple permissive policies (52 role/command combinations on 34 tables, none on a hot table) are NOT merged here;
--     proving two policies equivalent is a per-table RLS review and the risk is exposure of patient data. Listed only.
--
-- ROLLBACK: drop index if exists <name> for each index below; re-create async_consults_patient_month_idx on
-- public.async_consults (patient_id, created_at desc); alter policy back to the bare auth.uid() text in the proof file.

-- ---------------------------------------------------------------------------
-- 1. Foreign-key indexes on the hot tables.
-- ---------------------------------------------------------------------------
create index if not exists clinical_encounters_actor_clinical_staff_id_fk_idx on public.clinical_encounters (actor_clinical_staff_id) where actor_clinical_staff_id is not null;
create index if not exists clinical_encounters_actor_profile_id_fk_idx on public.clinical_encounters (actor_profile_id) where actor_profile_id is not null;
create index if not exists clinical_task_transitions_actor_id_fk_idx on public.clinical_task_transitions (actor_id) where actor_id is not null;
create index if not exists clinical_tasks_fee_schedule_version_id_fk_idx on public.clinical_tasks (fee_schedule_version_id) where fee_schedule_version_id is not null;
create index if not exists clinical_tasks_lead_clinician_id_fk_idx on public.clinical_tasks (lead_clinician_id) where lead_clinician_id is not null;
create index if not exists clinical_tasks_priority_override_by_fk_idx on public.clinical_tasks (priority_override_by) where priority_override_by is not null;
create index if not exists clinical_tasks_triage_event_id_fk_idx on public.clinical_tasks (triage_event_id) where triage_event_id is not null;
create index if not exists clinical_tasks_type_version_fk_idx on public.clinical_tasks (type, task_type_version);
create index if not exists clinician_alerts_backup_clinician_id_fk_idx on public.clinician_alerts (backup_clinician_id) where backup_clinician_id is not null;
create index if not exists clinician_alerts_closed_by_fk_idx on public.clinician_alerts (closed_by) where closed_by is not null;
create index if not exists clinician_alerts_monitoring_schedule_item_id_fk_idx on public.clinician_alerts (monitoring_schedule_item_id) where monitoring_schedule_item_id is not null;
create index if not exists clinician_alerts_resolved_by_fk_idx on public.clinician_alerts (resolved_by) where resolved_by is not null;
create index if not exists clinician_alerts_snoozed_by_fk_idx on public.clinician_alerts (snoozed_by) where snoozed_by is not null;
create index if not exists emergency_events_acknowledged_by_fk_idx on public.emergency_events (acknowledged_by) where acknowledged_by is not null;
create index if not exists emergency_events_clinician_alert_id_fk_idx on public.emergency_events (clinician_alert_id) where clinician_alert_id is not null;
create index if not exists emergency_events_followed_up_by_fk_idx on public.emergency_events (followed_up_by) where followed_up_by is not null;
create index if not exists emergency_events_logged_by_profile_id_fk_idx on public.emergency_events (logged_by_profile_id) where logged_by_profile_id is not null;
create index if not exists emergency_events_vital_reading_id_fk_idx on public.emergency_events (vital_reading_id) where vital_reading_id is not null;
create index if not exists encounters_service_purchase_id_fk_idx on public.encounters (service_purchase_id) where service_purchase_id is not null;
create index if not exists encounters_task_id_fk_idx on public.encounters (task_id) where task_id is not null;
create index if not exists lab_orders_partner_cost_provider_id_fk_idx on public.lab_orders (partner_cost_provider_id) where partner_cost_provider_id is not null;
create index if not exists lab_orders_rejected_by_fk_idx on public.lab_orders (rejected_by) where rejected_by is not null;
create index if not exists task_claims_clinician_id_fk_idx on public.task_claims (clinician_id);
create index if not exists vitals_readings_triage_event_id_fk_idx on public.vitals_readings (triage_event_id) where triage_event_id is not null;
create index if not exists vitals_readings_validated_by_fk_idx on public.vitals_readings (validated_by) where validated_by is not null;

-- ---------------------------------------------------------------------------
-- 2. The one proven duplicate index.
-- ---------------------------------------------------------------------------
do $$
declare v_a text; v_b text;
begin
  select pg_get_indexdef(i.indexrelid) into v_a from pg_index i where i.indexrelid = to_regclass('public.async_consults_patient_idx');
  select pg_get_indexdef(i.indexrelid) into v_b from pg_index i where i.indexrelid = to_regclass('public.async_consults_patient_month_idx');
  -- Only drop when the other one really is the same index; never drop on a name match alone.
  if v_a is not null and v_b is not null
     and replace(v_a, 'async_consults_patient_idx', 'X') = replace(v_b, 'async_consults_patient_month_idx', 'X') then
    drop index public.async_consults_patient_month_idx;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Row-level-security initplan: wrap bare auth.uid() in (select ...). Expressions are the live text with only the
--    wrapper added; each ALTER keeps the policy name, command and roles.
-- ---------------------------------------------------------------------------
alter policy clinical_staff_attestations_insert on public.clinical_staff_attestations
  with check ((organisation_id = private.current_org_id()) and exists (
    select 1 from public.clinical_staff cs
    where cs.id = clinical_staff_attestations.clinical_staff_id and cs.profile_id = (select auth.uid())));

alter policy emergency_cards_lookups_select on public.emergency_card_lookups
  using (exists (
    select 1 from public.emergency_cards c
    where c.id = emergency_card_lookups.card_id
      and (c.patient_id = (select auth.uid()) or private.is_org_staff(c.organisation_id))));

alter policy emergency_cards_select on public.emergency_cards
  using ((patient_id = (select auth.uid())) or private.is_org_staff(organisation_id));

alter policy user_known_devices_select on public.user_known_devices
  using (profile_id = (select auth.uid()));

alter policy patient_result_explanations_select on public.patient_result_explanations
  using ((patient_id = (select auth.uid()))
         or private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category));

-- NOT included: scribe_consents_insert_clinical. Live carries a newer definition (private.staff_may_write, from a
-- migration that is on an unmerged branch) than main-dev's (private.is_org_staff). Rewriting it here would either
-- regress live or change main-dev's meaning. Its bare auth.uid() is left for the branch that owns the change.

-- ---------------------------------------------------------------------------
-- 4. Self-check.
-- ---------------------------------------------------------------------------
do $$
declare v_missing text; v_bare integer;
begin
  select string_agg(i, ', ') into v_missing
  from unnest(array[
    'clinical_encounters_actor_clinical_staff_id_fk_idx','clinical_encounters_actor_profile_id_fk_idx','clinical_task_transitions_actor_id_fk_idx',
    'clinical_tasks_fee_schedule_version_id_fk_idx','clinical_tasks_lead_clinician_id_fk_idx','clinical_tasks_priority_override_by_fk_idx',
    'clinical_tasks_triage_event_id_fk_idx','clinical_tasks_type_version_fk_idx','clinician_alerts_backup_clinician_id_fk_idx',
    'clinician_alerts_closed_by_fk_idx','clinician_alerts_monitoring_schedule_item_id_fk_idx','clinician_alerts_resolved_by_fk_idx',
    'clinician_alerts_snoozed_by_fk_idx','emergency_events_acknowledged_by_fk_idx','emergency_events_clinician_alert_id_fk_idx',
    'emergency_events_followed_up_by_fk_idx','emergency_events_logged_by_profile_id_fk_idx','emergency_events_vital_reading_id_fk_idx',
    'encounters_service_purchase_id_fk_idx','encounters_task_id_fk_idx','lab_orders_partner_cost_provider_id_fk_idx',
    'lab_orders_rejected_by_fk_idx','task_claims_clinician_id_fk_idx','vitals_readings_triage_event_id_fk_idx','vitals_readings_validated_by_fk_idx'
  ]) i where to_regclass('public.' || i) is null;
  if v_missing is not null then raise exception 'SR2c: indexes missing: %', v_missing; end if;

  select count(*) into v_bare from pg_policies p
  where p.schemaname = 'public'
    and p.policyname in ('clinical_staff_attestations_insert','emergency_cards_lookups_select','emergency_cards_select',
                         'user_known_devices_select','patient_result_explanations_select')
    and regexp_count(coalesce(p.qual,'') || ' ' || coalesce(p.with_check,''), 'auth\.uid\(\)')
      > regexp_count(coalesce(p.qual,'') || ' ' || coalesce(p.with_check,''), '\( ?SELECT auth\.uid\(\) AS uid\)');
  if v_bare <> 0 then raise exception 'SR2c: % policies still carry a bare auth.uid()', v_bare; end if;
end $$;
