-- Removes the diagnostic_service_catalogue / diagnostic_requests /
-- diagnostic_reports module (PR #287, migrations 20260828230703,
-- 20260828230822, 20260828230842, 20260828231059) — orphaned, never wired
-- into apps/web.
--
-- WHY: PR #287's app code (booking UI, clinician order form, report review,
-- quality-analytics dashboard) was never merged; the schema/RPCs only
-- reached main-dev via an unrelated drift-recovery PR (fc6545f3) that
-- reconciled live-but-uncommitted objects, not a deliberate ship. Meanwhile
-- PR #324's imaging_* platform (imaging_providers/imaging_studies/
-- imaging_orders/imaging_reports/etc., merged 2026-09-02) fully covers the
-- same use case — clinician-ordered diagnostic/imaging services, patient
-- booking, abnormal-result hookup into clinician_alerts — with a richer
-- design (provider network, safety questionnaires, AI-assist governance,
-- turnaround stats). PR #287 was closed as superseded without merging.
-- This migration does not touch any imaging_* object.
--
-- ROW COUNT (confirmed live 2026-09-03 via `supabase db query --linked`):
--   diagnostic_service_catalogue: 7 rows — all 7 are this module's own
--     seed data (xray_general/ultrasound_general/ct_scan/mri_scan/
--     ecg_diagnostic/echocardiography/mammography_diagnostic), not real use.
--   diagnostic_requests: 0
--   diagnostic_reports: 0
--   clinician_alerts.diagnostic_report_id IS NOT NULL: 0
--   storage.objects in bucket 'diagnostic-reports': 0
-- No app code (apps/web/src) and no other migration filed after these four
-- references any object dropped here (confirmed via git grep across
-- origin/main-dev). No ai_systems row references this module. A pure
-- structural removal — no data-conversion step needed.
--
-- private.classify_and_assign_clinician_alert() (shared by all
-- clinician_alerts-raising triggers, not just this module) gained one
-- additive branch in 20260828230822 to classify an alert carrying a
-- diagnostic_report_id as type_code='abnormal_result'. That branch is
-- removed below, restoring the function to its pre-20260828230822 body —
-- verified against pg_get_functiondef live, byte-for-byte, before editing.
-- Every other branch is untouched.

-- ---------------------------------------------------------------------------
-- 1. Revert the classifier's diagnostic_report_id branch before the column
-- it reads is dropped.
-- ---------------------------------------------------------------------------
create or replace function private.classify_and_assign_clinician_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_effective_level public.alert_level;
  v_rule jsonb;
  v_owner_tier public.doctor_tier;
  v_backup_tier public.doctor_tier;
  v_dupe_id uuid;
  v_dupe_created_at timestamptz;
begin
  v_effective_level := coalesce(new.override_level, new.level);

  new.severity := case v_effective_level
    when 'emergency' then 4
    when 'urgent_escalation' then 3
    when 'clinician_review' then 2
    when 'routine' then 1
  end;

  if new.type_code is null then
    new.type_code := case
      when new.screening_result_id is not null then 'abnormal_result'
      when new.vital_reading_id is not null then 'abnormal_monitoring'
      when new.title ilike 'priority%: emergency reported%' then 'symptom_escalation'
      when new.title ilike '%diabetic foot%' then 'symptom_escalation'
      when new.title ilike '%eating-disorder%' or new.title ilike '%mental-health screen%' then 'symptom_escalation'
      when new.title ilike 'lifestyle red flag%' then 'deterioration'
      when new.title ilike '%glucose logs%' or new.title ilike '%blood-pressure readings%' then 'overdue_monitoring'
      else 'abnormal_result'
    end::public.alert_type_code;
  end if;

  if new.category is null then
    new.category := case new.type_code
      when 'missed_appointment' then 'care_management'
      when 'overdue_task' then 'care_management'
      when 'overdue_monitoring' then 'care_management'
      when 'failed_referral' then 'care_management'
      when 'adherence_problem' then 'medication'
      when 'refill_due' then 'medication'
      when 'potential_interaction' then 'medication'
      when 'pharmacy_problem' then 'medication'
      when 'provider_unavailable' then 'operational'
      when 'appointment_failure' then 'operational'
      when 'laboratory_failure' then 'operational'
      else 'clinical'
    end::public.alert_category;
  end if;

  v_rule := private.alert_rule_config(new.type_code);
  if v_rule is not null then
    v_owner_tier := nullif(v_rule->>'owner_tier', '')::public.doctor_tier;
    v_backup_tier := nullif(v_rule->>'backup_tier', '')::public.doctor_tier;

    if new.responsible_clinician_id is null and v_owner_tier is not null then
      select cs.id into new.responsible_clinician_id
      from public.clinical_staff cs
      left join public.clinician_alerts ca
        on ca.responsible_clinician_id = cs.id and ca.status in ('open', 'acknowledged')
      where cs.organisation_id = new.organisation_id
        and cs.active
        and cs.doctor_tier = v_owner_tier
      group by cs.id, cs.created_at
      order by count(ca.id) asc, cs.created_at asc
      limit 1;

      if new.responsible_clinician_id is not null then
        new.assigned_at := now();
      end if;
    end if;

    if new.backup_clinician_id is null and v_backup_tier is not null then
      select cs.id into new.backup_clinician_id
      from public.clinical_staff cs
      left join public.clinician_alerts ca
        on ca.backup_clinician_id = cs.id and ca.status in ('open', 'acknowledged')
      where cs.organisation_id = new.organisation_id
        and cs.active
        and cs.doctor_tier = v_backup_tier
        and cs.id is distinct from new.responsible_clinician_id
      group by cs.id, cs.created_at
      order by count(ca.id) asc, cs.created_at asc
      limit 1;
    end if;
  end if;

  new.dedup_key := new.type_code::text || ':' || new.patient_id::text;

  select id, created_at into v_dupe_id, v_dupe_created_at
  from public.clinician_alerts
  where dedup_key = new.dedup_key
    and status in ('open', 'acknowledged')
    and created_at > now() - interval '24 hours'
  order by created_at desc
  limit 1;

  if v_dupe_id is not null then
    new.duplicate_of := v_dupe_id;
    if v_rule is not null
       and coalesce((v_rule->>'auto_suppress_duplicates')::boolean, false)
       and v_dupe_created_at > now() - (coalesce(nullif(v_rule->>'suppress_window_minutes', ''), '1440')::integer * interval '1 minute')
    then
      new.suppressed := true;
      new.suppressed_reason := 'Protocol-based duplicate suppression: same type and patient as alert ' || v_dupe_id || ' within the governed suppression window.';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Drop the clinician_alerts source-link column (cascades its FK
-- constraint and partial index automatically).
-- ---------------------------------------------------------------------------
alter table public.clinician_alerts
  drop column if exists diagnostic_report_id;

-- ---------------------------------------------------------------------------
-- 3. Storage: drop the policies (0 objects confirmed live in the bucket).
-- The 'diagnostic-reports' bucket ROW itself is deliberately left behind:
-- storage.buckets has a protect_delete() trigger that refuses a plain SQL
-- DELETE ("Use the Storage API instead"), and reaching for the Storage
-- Management API from inside a migration to force it through is a separate,
-- irreversible out-of-band action this migration doesn't take — an empty,
-- policy-less, private bucket is harmless (no RLS policy grants any access
-- to it any more, so nothing can read/write it through the app) and can be
-- deleted later via the dashboard/Storage API if it's ever worth the extra
-- step.
-- ---------------------------------------------------------------------------
drop policy if exists "diagnostic report doc patient insert" on storage.objects;
drop policy if exists "diagnostic report doc patient select" on storage.objects;
drop policy if exists "diagnostic report doc patient update" on storage.objects;
drop policy if exists "diagnostic report doc patient delete" on storage.objects;

-- ---------------------------------------------------------------------------
-- 4. Tables — cascade drops each table's own triggers/policies/indexes.
-- Order matters: diagnostic_reports references diagnostic_requests
-- references diagnostic_service_catalogue.
-- ---------------------------------------------------------------------------
drop table if exists public.diagnostic_reports cascade;
drop table if exists public.diagnostic_requests cascade;
drop table if exists public.diagnostic_service_catalogue cascade;

-- ---------------------------------------------------------------------------
-- 5. Standalone functions (trigger functions were dropped with their
-- tables above; these free-standing ones were not).
-- ---------------------------------------------------------------------------
drop function if exists private.derive_diagnostic_request_attribution();
drop function if exists private.enforce_diagnostic_request_transitions();
drop function if exists public.set_diagnostic_request_booking_preference(uuid, uuid, text, date, public.lab_order_time_of_day, boolean, text);
drop function if exists private.handle_diagnostic_report_insert();
drop function if exists private.handle_diagnostic_report_review();
drop function if exists public.analytics_diagnostic_service_quality(integer);

-- ---------------------------------------------------------------------------
-- 6. Enums.
-- ---------------------------------------------------------------------------
drop type if exists public.diagnostic_modality;
drop type if exists public.diagnostic_urgency;
drop type if exists public.diagnostic_request_status;
drop type if exists public.diagnostic_report_source;

-- ---------------------------------------------------------------------------
-- 7. Self-verification.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename in ('diagnostic_service_catalogue', 'diagnostic_requests', 'diagnostic_reports')) then
    raise exception 'FAIL: a diagnostic_* table still exists';
  end if;

  if exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname in ('diagnostic_modality', 'diagnostic_urgency', 'diagnostic_request_status', 'diagnostic_report_source')) then
    raise exception 'FAIL: a diagnostic_* enum still exists';
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinician_alerts' and column_name = 'diagnostic_report_id') then
    raise exception 'FAIL: clinician_alerts.diagnostic_report_id still exists';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'diagnostic report doc%'
  ) then
    raise exception 'FAIL: a diagnostic report storage policy still exists';
  end if;

  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'set_diagnostic_request_booking_preference'
  ) or exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'analytics_diagnostic_service_quality'
  ) or exists (
    select 1 from pg_proc
    where pronamespace = 'private'::regnamespace
      and proname in ('derive_diagnostic_request_attribution', 'enforce_diagnostic_request_transitions', 'handle_diagnostic_report_insert', 'handle_diagnostic_report_review')
  ) then
    raise exception 'FAIL: a diagnostic_* function still exists';
  end if;

  if pg_get_functiondef('private.classify_and_assign_clinician_alert()'::regprocedure) like '%diagnostic_report_id%' then
    raise exception 'FAIL: classify_and_assign_clinician_alert still references diagnostic_report_id';
  end if;

  raise notice 'PASS: orphaned diagnostic services module removed, imaging_* untouched';
end $$;
