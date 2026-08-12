-- Tarragon Health
-- Row-level change audit triggers on the clinical core
--
-- public.audit_log (20260705211409_platform_infra.sql) has existed since Sprint 1 and is
-- genuinely append-only (private.reject_mutation() hard-blocks UPDATE/DELETE for every role),
-- but it was populated by hand at ~10 call sites and, checked live 2026-08-12, holds 31 rows
-- across 12 action types — all business events (bp_red_flag.raised, hospital_admission.created).
-- It answers none of "who changed this patient row and when" for the ~140 org-staff-gated
-- tables that were never wired to write to it. This migration closes that gap with a generic
-- trigger, applied to the clinical core, that fires on every INSERT/UPDATE/DELETE.
--
-- Deliberate scope limits, not oversights:
--   - Writes only. A trigger cannot fire on SELECT — "who changed this row" is a different
--     question from "who read this row" (an NDPR access request usually means the latter).
--     Read-access logging needs a different mechanism (pgaudit, or funnelling reads through a
--     logging RPC as analytics_log_patient_access already does) and is left as a follow-up.
--   - Changed COLUMN NAMES only, never old/new values. audit_log_select (platform_infra.sql)
--     grants read on plain is_org_staff(organisation_id); several of these source tables gate
--     narrower than that. Copying full row values into audit_log would flatten every source
--     table's RLS onto one broader policy — a PHI exposure created by the audit feature itself.
--     A sha256 hash of the full row is stored instead: enough to later prove or disprove a
--     specific known value without the log itself holding PHI.
--   - 21 tables in this first pass (vitals_readings, medications, medication_logs,
--     medication_reviews, screening_results, lab_result_documents, lab_analyte_readings,
--     clinician_alerts, escalations, care_plans, profiles, emergency_events,
--     patient_risk_scores, referrals, vaccination_records, clinical_staff, care_messages,
--     case_briefs, wearable_readings, patient_hospital_admissions, symptoms) — the clinical
--     core, not all 140 org-staff-gated tables. Every table below was confirmed live to carry
--     both `id` and `organisation_id` columns, which the generic trigger function assumes.
--     Extending to the rest of the org-staff surface is a mechanical follow-up (the DO block
--     below just needs its array extended) once this pass is reviewed.
--
-- Actor resolution: auth.uid() covers every authenticated-session write. Service-role, Edge
-- Function, and cron writes have no session and so no auth.uid() — those rows fall back to a
-- session-local GUC (app.audit_actor_id) that a trusted server context can SET LOCAL before
-- writing, or land with actor_id null and event.actor_resolved = false if nothing set it. No
-- caller in this codebase sets that GUC yet; wiring it into the service-role client is a
-- follow-up, tracked so a null-actor row is never mistaken for "no audit gap exists."
--
-- No-op suppression: many tables carry an auto-bumped `updated_at`. If that is the ONLY column
-- that differs between OLD and NEW, the row is a touch, not a real change, and is skipped —
-- otherwise every incidental UPDATE (even ones that change nothing a reviewer would care about)
-- would show up as a change event and bury the real ones.
--
-- The trigger function is SECURITY DEFINER so the audit write itself can never be blocked by a
-- narrower policy on the writing role — its own effect (an insert into audit_log) is exactly
-- the thing that must never silently fail because of a permissions edge case on the source table.

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid;
  v_org        uuid;
  v_entity_id  uuid;
  v_action     text;
  v_changed    text[];
  v_old        jsonb;
  v_new        jsonb;
  v_hash       text;
begin
  v_actor := coalesce(
    auth.uid(),
    nullif(current_setting('app.audit_actor_id', true), '')::uuid
  );

  if tg_op = 'INSERT' then
    v_new       := to_jsonb(NEW);
    v_entity_id := (v_new ->> 'id')::uuid;
    v_org       := nullif(v_new ->> 'organisation_id', '')::uuid;
    v_action    := tg_table_name || '.created';
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_new) where value is not null;
    v_hash := encode(extensions.digest(v_new::text, 'sha256'), 'hex');

  elsif tg_op = 'UPDATE' then
    v_old       := to_jsonb(OLD);
    v_new       := to_jsonb(NEW);
    v_entity_id := (v_new ->> 'id')::uuid;
    v_org       := nullif(v_new ->> 'organisation_id', '')::uuid;
    v_action    := tg_table_name || '.updated';
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_new) n
      where key <> 'updated_at'
        and n.value is distinct from (v_old -> n.key);

    if v_changed is null then
      -- Nothing changed except (at most) updated_at — a touch, not a real change.
      return NEW;
    end if;

    v_hash := encode(extensions.digest(v_new::text, 'sha256'), 'hex');

  elsif tg_op = 'DELETE' then
    v_old       := to_jsonb(OLD);
    v_entity_id := (v_old ->> 'id')::uuid;
    v_org       := nullif(v_old ->> 'organisation_id', '')::uuid;
    v_action    := tg_table_name || '.deleted';
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_old) where value is not null;
    v_hash := encode(extensions.digest(v_old::text, 'sha256'), 'hex');
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org, v_actor, v_action, tg_table_name, v_entity_id,
    jsonb_build_object(
      'changed_columns', to_jsonb(coalesce(v_changed, array[]::text[])),
      'row_hash', v_hash,
      'actor_resolved', v_actor is not null
    )
  );

  if tg_op = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

comment on function private.audit_row_change() is
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger. Logs actor, action, entity, and the list '
  'of changed column NAMES (never values) plus a sha256 hash of the full row to public.audit_log. '
  'See 20260812030853_row_change_audit_triggers.sql for the full design rationale.';

do $$
declare
  t text;
  tables text[] := array[
    'vitals_readings', 'medications', 'medication_logs', 'medication_reviews',
    'screening_results', 'lab_result_documents', 'lab_analyte_readings', 'clinician_alerts',
    'escalations', 'care_plans', 'profiles', 'emergency_events', 'patient_risk_scores',
    'referrals', 'vaccination_records', 'clinical_staff', 'care_messages', 'case_briefs',
    'wearable_readings', 'patient_hospital_admissions', 'symptoms'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists audit_row_change_trg on public.%I', t);
    execute format(
      'create trigger audit_row_change_trg '
      'after insert or update or delete on public.%I '
      'for each row execute function private.audit_row_change()',
      t
    );
  end loop;
end $$;

-- Proof, not hope: assert every table in the list actually has the trigger attached.
do $$
declare
  t text;
  tables text[] := array[
    'vitals_readings', 'medications', 'medication_logs', 'medication_reviews',
    'screening_results', 'lab_result_documents', 'lab_analyte_readings', 'clinician_alerts',
    'escalations', 'care_plans', 'profiles', 'emergency_events', 'patient_risk_scores',
    'referrals', 'vaccination_records', 'clinical_staff', 'care_messages', 'case_briefs',
    'wearable_readings', 'patient_hospital_admissions', 'symptoms'
  ];
  v_count int;
begin
  foreach t in array tables loop
    select count(*) into v_count
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t
        and tg.tgname = 'audit_row_change_trg' and not tg.tgisinternal;
    if v_count <> 1 then
      raise exception 'audit_row_change_trg missing or duplicated on public.%: found %', t, v_count;
    end if;
  end loop;
end $$;
