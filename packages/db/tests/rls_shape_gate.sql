-- W-36 (c): RLS shape gate. For every table in public with a patient_id column:
--   1. row security is on (rls_off);
--   2. no PERMISSIVE policy opens a command to everyone: for SELECT, UPDATE, DELETE and ALL the USING expression, and for INSERT, UPDATE and
--      ALL the WITH CHECK expression, is not true, 1=1, (select true), "true or ...", "... or true", or "auth.uid() is not null"
--      (open_policy_select / open_policy_write);
--   3. every table that has a read policy has at least one read policy that CALLS a reviewed helper (private.<name>( ... )) or compares
--      patient_id with auth.uid(). An incidental substring such as "auth.uid() is not null" or "task_id" does not count (unreviewed_read_helper);
--   4. every table whose read policy calls a staff-capable helper is listed in staff_read_scope, the S39b registry (INV-12), unless it
--      is in the baseline below (staff_read_not_registered).
-- RESTRICTIVE policies only narrow access, so they are never findings; their count is printed as a NOTICE.
-- Tables with no read policy at all are deny-all for signed-in users (service-role only) and are not a finding.
--
-- BASELINE: 33 tables on the live project (read-only catalogue query, 2026-10-27) have a staff-capable read policy and no staff_read_scope
-- row: the organisation-wide reads recorded in OQ-280 plus tables whose own policy limits staff (owner-only or clinician-relationship
-- reads). Baseline names that do not exist in a given database are ignored. A NEW table is not baselined: register it in staff_read_scope.
-- Against live on 2026-10-27 the check function returned exactly one finding, care_circle_alert_acks (owner-only by supporter_id, now baselined
-- inside the unreviewed_read_helper check), so the gate returns 0 findings there. 429 patient_id tables were in scope.
--
-- NOT EXECUTED as a file (no Docker). The check function body was run read-only against live through the Supabase MCP; the probe/sabotage
-- section was not run.
-- SABOTAGE (end of file): probe tables for every check, each must flip; rolled back.
-- EVENT TRIGGERS: this project has event triggers that act on CREATE TABLE (rls_auto_enable_trigger turns row security ON for new tables;
-- guard_new_patient_tables_trigger adds RESTRICTIVE minor-guard policies to a new public table with a patient_id). So a probe that wants row
-- security OFF must switch it off explicitly after the create, and probe tables are expected to carry extra restrictive policies.
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
  pol as (
    select tablename as t, cmd,
           lower(coalesce(qual, '')) as q,
           lower(coalesce(with_check, '')) as w,
           regexp_replace(lower(coalesce(qual, '')), '[() \n\t]', '', 'g') as qn,
           regexp_replace(lower(coalesce(with_check, '')), '[() \n\t]', '', 'g') as wn
      from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE'
  ),
  open_re(re) as (
    values ('^(select)?true$|^1=1$|^(select)?trueor|(or)(select)?true$|^(select)?auth\.uid(asuid)?isnotnull$|(or)(select)?auth\.uid(asuid)?isnotnull$')
  ),
  helper(re) as (
    -- reviewed helpers, called as private.<name>( ; list taken from the live read policies of patient_id tables, 2026-10-27
    values ('private\.(care_gap_visible|staff_may_read|is_org_staff|can_read_clinical|has_emergency_access|is_admin|can_act_for|can_supporter_read_mental_health|maternal_staff_may_read|pregnancy_staff_may_read|pregnancy_caregiver_may_read|maternal_caregiver_may_read|can_credential_review|guardian_may_view_confidential_domain|encounter_visible|can_support_view|current_org_id|task_staff_reader|credential_is_cmo|clinician_has_patient_access|visit_summary_state_ok|is_correcting_clinician|can_read_record_correction|can_review_access_log|can_review_safeguarding_concern|follow_up_actor_is_clinician|is_analyst|is_complaints_handler|caller_org|is_insurance_admin|is_lab_liaison|lab_partner_provider|may_see_sensitive_lab_result|patient_result_blocked|profile_access_active|supporter_may_see_dose_reason|task_is_mine|timeline_staff_from_profile|visit_summary_caregiver_may|visit_summary_caregiver_ok)\(')
  ),
  owner(re) as (
    values ('patient_id[^a-z_]*=[^a-z_]*(select)?[^a-z_]*auth\.uid\(\)|auth\.uid\(\)[^a-z_]*(as uid)?[^a-z_]*=[^a-z_]*([a-z_]+\.)?patient_id|patient_id = \(select auth\.uid\(\)')
  ),
  staffy(re) as (
    values ('private\.(is_org_staff|staff_may_read|is_admin|is_analyst|maternal_staff_may_read|pregnancy_staff_may_read|task_staff_reader|current_org_id|caller_org)\(')
  ),
  baseline(t) as (
    values ('ai_coach_access_rules'),('assistant_review_samples'),('birth_plans'),('breastfeeding_feed_log'),('care_access_events'),('clinical_tasks'),
      ('clinician_conflicts'),('contractions'),('data_deletion_requests'),('data_export_requests'),('data_quality_findings'),('domain_events'),
      ('emergency_record_access_grants'),('entitlements'),('health_education_feedback'),('kick_counts'),('legacy_notice_holds'),('lifecycle_events'),
      ('lifecycle_states'),('medication_dose_reminders'),('medication_refill_reminder_rules'),('medication_refill_state'),('patient_reminder_group_members'),
      ('postnatal_baby_checks'),('pregnancies'),('pregnancy_loss_records'),('red_alert_watch'),('reputation_review_prompts'),
      ('service_purchase_guarantee_claims'),('tracker_deletion_requests'),('triage_events'),('vitals_reminder_rules'),('vitals_reminder_state'),
      -- baseline-labs prescribing rule: read limited to the CMO credential or an admin (reviewed 2026-10-28)
      ('baseline_labs_overrides')
  ),
  readpol as (select * from pol where cmd in ('SELECT', 'ALL'))
  select 'rls_off', t from pt where not rls
  union all
  select 'open_policy_select', p.t from pol p, open_re o
   where p.t in (select t from pt) and p.cmd in ('SELECT', 'UPDATE', 'DELETE', 'ALL') and p.qn ~ o.re
  union all
  select 'open_policy_write', p.t from pol p, open_re o
   where p.t in (select t from pt) and p.cmd in ('INSERT', 'UPDATE', 'ALL') and p.wn ~ o.re
  union all
  select 'unreviewed_read_helper', pt.t from pt
   where exists (select 1 from readpol r where r.t = pt.t)
     and not exists (select 1 from readpol r, helper h, owner w where r.t = pt.t and (r.q ~ h.re or r.q ~ w.re))
     -- baseline: owner-only by supporter_id = auth.uid() (a supporter reads their own acknowledgements); found live 2026-10-27, the only one
     and pt.t not in ('care_circle_alert_acks',
                      -- S90: the read policy is an EXISTS over care_gaps, so it inherits care_gaps' own tied policy (reviewed 2026-10-28)
                      'care_gap_attempts')
  union all
  select 'staff_read_not_registered', pt.t from pt
   where exists (select 1 from readpol r, staffy s where r.t = pt.t and r.q ~ s.re)
     and not exists (select 1 from public.staff_read_scope s where s.table_name = pt.t)
     and pt.t not in (select t from baseline)
$$;

do $$
declare bad text; n_restrictive int;
begin
  select string_agg(distinct check_name || ':' || offender, ', ' order by check_name || ':' || offender) into bad from pg_temp.shape_violations();
  if bad is not null then raise exception 'RLS shape gate: %', bad; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'patient_id' and not a.attisdropped where c.relkind in ('r','p')) < 100 then
    raise exception 'RLS shape gate: fewer than 100 patient_id tables found, the scan is not seeing the catalogue';
  end if;
  select count(*) into n_restrictive from pg_policies where schemaname = 'public' and permissive = 'RESTRICTIVE'
     and tablename in (select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'patient_id' and not a.attisdropped
                        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p'));
  raise notice 'RLS shape gate: % restrictive policies on patient_id tables (counted, never findings)', n_restrictive;
end $$;

-- SABOTAGE ----------------------------------------------------------------------------------------------------------------------------
-- (signature checked read-only on live 2026-10-27: private.is_org_staff(uuid); private.staff_may_read(uuid, uuid, care_access_category))
create table public._rls_gate_probe_open (patient_id uuid);
alter table public._rls_gate_probe_open enable row level security;
create policy probe_open on public._rls_gate_probe_open for select using (true);

create table public._rls_gate_probe_open2 (patient_id uuid);
alter table public._rls_gate_probe_open2 enable row level security;
create policy probe_open2 on public._rls_gate_probe_open2 for select using ((select true) or patient_id is null);

create table public._rls_gate_probe_authnotnull (patient_id uuid);
alter table public._rls_gate_probe_authnotnull enable row level security;
create policy probe_authnotnull on public._rls_gate_probe_authnotnull for select using (auth.uid() is not null);

create table public._rls_gate_probe_write (patient_id uuid);
alter table public._rls_gate_probe_write enable row level security;
create policy probe_write_sel on public._rls_gate_probe_write for select using (patient_id = auth.uid());
create policy probe_write_ins on public._rls_gate_probe_write for insert with check (true);
create policy probe_write_upd on public._rls_gate_probe_write for update using (patient_id = auth.uid()) with check (auth.uid() is not null);

create table public._rls_gate_probe_helper (patient_id uuid, task_id uuid);
alter table public._rls_gate_probe_helper enable row level security;
create policy probe_helper on public._rls_gate_probe_helper for select using (task_id is not null and patient_id is not null);

create table public._rls_gate_probe_staff (patient_id uuid);
alter table public._rls_gate_probe_staff enable row level security;
create policy probe_staff on public._rls_gate_probe_staff for select using (private.is_org_staff(gen_random_uuid()));

-- control: an owner-only table must NOT be flagged
create table public._rls_gate_probe_ok (patient_id uuid);
alter table public._rls_gate_probe_ok enable row level security;
create policy probe_ok on public._rls_gate_probe_ok for select using (patient_id = (select auth.uid()));

-- rls_auto_enable_trigger switches row security on at CREATE TABLE, so turn it off explicitly
create table public._rls_gate_probe_norls (patient_id uuid);
alter table public._rls_gate_probe_norls disable row level security;

create function pg_temp.flagged(p_check text, p_table text) returns boolean language sql as
$$ select exists (select 1 from pg_temp.shape_violations() v where v.check_name = p_check and v.offender = p_table) $$;

do $$
declare missing text;
begin
  select string_agg(c || ':' || t, ', ') into missing from (values
    ('open_policy_select', '_rls_gate_probe_open'), ('open_policy_select', '_rls_gate_probe_open2'),
    ('open_policy_select', '_rls_gate_probe_authnotnull'), ('open_policy_write', '_rls_gate_probe_write'),
    ('unreviewed_read_helper', '_rls_gate_probe_helper'), ('staff_read_not_registered', '_rls_gate_probe_staff'),
    ('rls_off', '_rls_gate_probe_norls')) v(c, t)
   where not pg_temp.flagged(c, t);
  if missing is not null then raise exception 'SABOTAGE did not flip: %', missing; end if;
  if exists (select 1 from pg_temp.shape_violations() where offender = '_rls_gate_probe_ok') then
    raise exception 'CONTROL failed: an owner-only table was flagged';
  end if;
end $$;

rollback;
