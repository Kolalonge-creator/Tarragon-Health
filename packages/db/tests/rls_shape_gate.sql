-- W-36 (c): RLS shape gate. For every table in public with a patient_id column:
--   1. row security is on;
--   2. no read policy (SELECT or ALL) is the bare constant true;
--   3. every table that has a read policy has at least one that names an approved helper or auth.uid()
--      (a read policy built from some new, unreviewed function fails until the function is reviewed and listed below);
--   4. every table whose read policy lets staff in (is_org_staff, staff_may_read, is_admin, ...) is listed in staff_read_scope,
--      the S39b registry (INV-12), unless it is in the baseline below.
-- Tables with no read policy at all are deny-all for signed-in users (service-role only) and are not a finding.
--
-- BASELINE: 33 tables found on the live project on 2026-10-27 that have a staff-capable read policy and no staff_read_scope row. They are the
-- organisation-wide reads recorded in OQ-280 plus tables whose own policy limits staff (owner-only or clinician-relationship reads). Baseline
-- names that do not exist in a given database are ignored. A NEW table is not baselined: register it in staff_read_scope.
--
-- NOT EXECUTED locally when written (no Docker). Run via supabase db reset in CI, or by pasting into a read-only session with begin/rollback.
-- SABOTAGE (end of file): an open policy, an unreviewed helper, and an unregistered staff-readable table, one probe table each;
-- each check must flip. Everything is rolled back.
begin;

create function pg_temp.shape_violations() returns table(check_name text, offender text)
language sql as $$
  with pt as (
    select c.oid, c.relname as t, c.relrowsecurity as rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'patient_id' and not a.attisdropped
     where c.relkind in ('r', 'p')
  ),
  rp as (
    select tablename as t, coalesce(qual, '') as q
      from pg_policies where schemaname = 'public' and cmd in ('SELECT', 'ALL')
  ),
  approved(re) as (
    values ('(auth\.uid|staff_may_read|is_org_staff|can_read_clinical|has_emergency_access|is_admin|can_act_for|supporter|maternal|pregnancy|can_credential_review|guardian|encounter_visible|can_support_view|current_org_id|task_|clinician_has|visit_summary|correcting|record_correction|access_log|safeguarding|follow_up_actor|is_analyst|complaints|caller_org|insurance_admin|lab_liaison|lab_partner|sensitive_lab|result_blocked|profile_access|dose_reason|timeline_staff|credential_is_cmo)')
  ),
  staffy(re) as (
    values ('(is_org_staff|staff_may_read|is_admin|is_analyst|maternal_staff_may_read|pregnancy_staff_may_read|task_staff_reader|current_org_id|caller_org)')
  ),
  baseline(t) as (
    values ('ai_coach_access_rules'),('assistant_review_samples'),('birth_plans'),('breastfeeding_feed_log'),('care_access_events'),('clinical_tasks'),
      ('clinician_conflicts'),('contractions'),('data_deletion_requests'),('data_export_requests'),('data_quality_findings'),('domain_events'),
      ('emergency_record_access_grants'),('entitlements'),('health_education_feedback'),('kick_counts'),('legacy_notice_holds'),('lifecycle_events'),
      ('lifecycle_states'),('medication_dose_reminders'),('medication_refill_reminder_rules'),('medication_refill_state'),('patient_reminder_group_members'),
      ('postnatal_baby_checks'),('pregnancies'),('pregnancy_loss_records'),('red_alert_watch'),('reputation_review_prompts'),
      ('service_purchase_guarantee_claims'),('tracker_deletion_requests'),('triage_events'),('vitals_reminder_rules'),('vitals_reminder_state')
  )
  select 'rls_off', t from pt where not rls
  union all
  select 'open_read_policy', t from rp where t in (select t from pt) and btrim(q) in ('true', '(true)')
  union all
  select 'unreviewed_read_helper', pt.t from pt
   where exists (select 1 from rp where rp.t = pt.t)
     and not exists (select 1 from rp, approved where rp.t = pt.t and rp.q ~ approved.re)
  union all
  select 'staff_read_not_registered', pt.t from pt
   where exists (select 1 from rp, staffy where rp.t = pt.t and rp.q ~ staffy.re)
     and not exists (select 1 from public.staff_read_scope s where s.table_name = pt.t)
     and pt.t not in (select t from baseline)
$$;

do $$
declare bad text;
begin
  select string_agg(check_name || ':' || offender, ', ' order by check_name, offender) into bad from pg_temp.shape_violations();
  if bad is not null then raise exception 'RLS shape gate: %', bad; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'patient_id' and not a.attisdropped where c.relkind in ('r','p')) < 100 then
    raise exception 'RLS shape gate: fewer than 100 patient_id tables found, the scan is not seeing the catalogue';
  end if;
end $$;

-- SABOTAGE ----------------------------------------------------------------------------------------------------------------------------
create table public._rls_gate_probe_open (patient_id uuid);
alter table public._rls_gate_probe_open enable row level security;
create policy probe_open on public._rls_gate_probe_open for select using (true);

create table public._rls_gate_probe_helper (patient_id uuid);
alter table public._rls_gate_probe_helper enable row level security;
create policy probe_helper on public._rls_gate_probe_helper for select using (patient_id is not null);

create table public._rls_gate_probe_staff (patient_id uuid);
alter table public._rls_gate_probe_staff enable row level security;
create policy probe_staff on public._rls_gate_probe_staff for select using (private.is_org_staff(gen_random_uuid()));

create table public._rls_gate_probe_norls (patient_id uuid);

do $$
declare got text;
begin
  select string_agg(check_name || ':' || offender, ', ') into got from pg_temp.shape_violations();
  if got is null
     or got not like '%open_read_policy:_rls_gate_probe_open%'
     or got not like '%unreviewed_read_helper:_rls_gate_probe_helper%'
     or got not like '%staff_read_not_registered:_rls_gate_probe_staff%'
     or got not like '%rls_off:_rls_gate_probe_norls%' then
    raise exception 'SABOTAGE did not flip all four checks: %', coalesce(got, '(none)');
  end if;
end $$;

rollback;
