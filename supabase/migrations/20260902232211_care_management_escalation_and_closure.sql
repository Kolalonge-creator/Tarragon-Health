-- Tarragon Health — Chronic Disease Case Management (Module 74), part 3/5:
-- 74.13 case escalation ladder + 74.14 gated case closure.
--
-- 74.13's literal ladder ("Case manager → Nurse → Doctor → Specialist →
-- Emergency pathway if required") does not map onto this codebase's actual
-- clinical model: there has never been a "nurse" role/tier (merged into
-- clinician on day one, 20260705211611), and clinical staffing is the
-- 5-tier doctor_tier ladder (care_coordinator, tier_1..tier_5_partner_
-- specialist — docs/Tarragon_Health_Master_Operating_Plan_v4.md §4). This
-- migration re-expresses the ladder in those real terms and — critically —
-- routes it through the EXISTING alert taxonomy/ack-timeout-escalation
-- machinery (20260828 alert system series) rather than building a second,
-- parallel escalation engine: escalating a case just raises a
-- clinician_alerts row of a new type_code, which the existing
-- classify-and-assign trigger, ack-timeout ladder, and delivery pipeline
-- all already handle uniformly.
--
-- clinician_alerts.case_id is the reverse FK (many alerts -> one case) —
-- the same direction patient_hospital_admissions already uses the other way
-- (admission -> its one review alert) inverted, because a case
-- accumulates many alerts over its life where an admission raises exactly
-- one.

alter table public.clinician_alerts
  add column if not exists case_id uuid references public.care_management_cases (id) on delete set null;

create index if not exists clinician_alerts_case_idx on public.clinician_alerts (case_id) where case_id is not null;

comment on column public.clinician_alerts.case_id is
  'Module 74: set when an alert was raised FOR a care_management_cases episode (via escalate_care_management_case, or the deterioration-sweep/discharge triggers in parts 4-5 of this series). Null for every alert unrelated to case management — the large majority.';

-- ---------------------------------------------------------------------------
-- New alert_type_code: 'case_escalation' (care_management category). Adds a
-- 17th value to a type that a prior migration's own proof block asserted
-- "must have exactly 16 values" — that assertion already ran and passed at
-- apply time and is not re-executed by adding a new value here, so this is
-- safe. alert_rules is a versioned whole-document table (one jsonb array
-- per version, not row-per-type), so v2 is built by copying the currently-
-- active v1 config and appending one entry — never by hand-duplicating the
-- other 16, which would risk a silent transcription drift.
-- ---------------------------------------------------------------------------
alter type public.alert_type_code add value if not exists 'case_escalation';

-- Deactivate-then-insert inside one DO block (not a bare INSERT..SELECT
-- followed by a separate UPDATE) so there is never a moment with two
-- is_active rows — alert_rule_config()'s reader assumes exactly one.
do $$
declare
  v_old_id uuid;
  v_old_config jsonb;
begin
  select id, config into v_old_id, v_old_config from public.alert_rules where is_active limit 1;
  if v_old_id is null then
    raise exception 'no active alert_rules version found to extend with case_escalation';
  end if;

  update public.alert_rules set is_active = false where id = v_old_id;

  insert into public.alert_rules (version, config, notes, is_active)
  values (
    (select coalesce(max(version), 0) + 1 from public.alert_rules),
    v_old_config || jsonb_build_array(jsonb_build_object(
      'category', 'care_management',
      'type_code', 'case_escalation',
      'default_severity', 3,
      'severity_meaning', 'Urgent: a case manager escalated a chronic-disease case management episode up the clinical ladder (Module 74.13).',
      'evidence_basis', 'escalate_care_management_case() — human-raised, never automatically generated.',
      'owner_tier', 'tier_1',
      'backup_tier', 'tier_3',
      'senior_tier', 'tier_4_senior_registrar',
      'ack_timeout_minutes', 60,
      'channel_sequence', jsonb_build_array('in_app', 'push'),
      'auto_suppress_duplicates', false,
      'suppress_window_minutes', null,
      'effective_date', null,
      'review_date', null
    )),
    'v2: adds case_escalation type_code for Module 74 chronic disease case management (74.13). Copied forward from the active v1 config plus one new entry.',
    true
  );
end $$;

-- ---------------------------------------------------------------------------
-- 74.14 — gated case closure. SECURITY DEFINER so it can (a) derive
-- closed_by from the caller's own clinical_staff row, never client-
-- supplied, and (b) authorize the one 'closed' transition the guard
-- trigger (part 1) otherwise blocks via the session-local flag.
-- ---------------------------------------------------------------------------
create or replace function public.close_care_management_case(p_case_id uuid, p_closure_summary text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.care_management_cases%rowtype;
  v_staff_id uuid;
  v_open_goals integer;
  v_outstanding_interventions integer;
  v_open_barriers integer;
begin
  select * into v_case from public.care_management_cases where id = p_case_id;
  if v_case.id is null then
    raise exception 'Case not found';
  end if;
  if not private.is_org_staff(v_case.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_case.status <> 'active' then
    raise exception 'Case is not active';
  end if;

  -- "responsible clinician agrees where appropriate" (74.14): closing
  -- requires an active clinical-tier staff member, same floor as claiming/
  -- resolving an escalation — a Care Coordinator may open a case and raise
  -- an escalation on it, but per CLAUDE.md's Care Coordinator write-access
  -- rule must never be the one to close it.
  if not private.is_clinical_tier(v_case.organisation_id) then
    raise exception 'not authorised: only an active clinical-tier staff member may close a case' using errcode = '42501';
  end if;
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid()) and organisation_id = v_case.organisation_id and active
  limit 1;
  if v_staff_id is null then
    raise exception 'no active clinical_staff record found for the current session';
  end if;

  -- "goals achieved" (74.14): no goal left in the open state.
  select count(*) into v_open_goals
  from public.care_plan_goals
  where case_id = p_case_id and status = 'open';
  if v_open_goals > 0 then
    raise exception 'Cannot close: % goal(s) still open — mark achieved or abandoned first', v_open_goals;
  end if;

  -- "outstanding actions resolved" (74.14): no case-scoped intervention
  -- left active with no recorded outcome, and no open barrier.
  select count(*) into v_outstanding_interventions
  from public.care_plan_interventions
  where case_id = p_case_id and status = 'active' and outcome is null;
  if v_outstanding_interventions > 0 then
    raise exception 'Cannot close: % case plan item(s) still outstanding — record an outcome or remove them first', v_outstanding_interventions;
  end if;

  select count(*) into v_open_barriers
  from public.care_management_barriers
  where case_id = p_case_id and status = 'open';
  if v_open_barriers > 0 then
    raise exception 'Cannot close: % barrier(s) still open — resolve them first', v_open_barriers;
  end if;

  perform set_config('private.case_close_authorized', 'true', true);
  update public.care_management_cases
    set status = 'closed', closed_at = now(), closed_by = v_staff_id, closure_summary = p_closure_summary
    where id = p_case_id;
  perform set_config('private.case_close_authorized', 'false', true);

  insert into public.care_management_case_events
    (case_id, organisation_id, patient_id, event_type, reason, actor_id, clinical_staff_id)
  values
    (p_case_id, v_case.organisation_id, v_case.patient_id, 'closed', p_closure_summary, (select auth.uid()), v_staff_id);

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_case.organisation_id, (select auth.uid()), 'care_management_case.closed', 'care_management_cases', p_case_id,
          jsonb_build_object('closed_by', v_staff_id));
end;
$$;

comment on function public.close_care_management_case(uuid, text) is
  '74.14 gated case closure: blocks while any care_plan_goals row is open, any case-scoped care_plan_interventions row is active with no outcome, or any care_management_barriers row is open. Requires an active clinical-tier clinical_staff record for the caller (never a Care Coordinator). The only authorised path to status=closed — see care_management_cases_enforce_closure.';

revoke all on function public.close_care_management_case(uuid, text) from public, anon;
grant execute on function public.close_care_management_case(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinician_alerts' and column_name = 'case_id'
  ) then
    raise exception 'clinician_alerts.case_id was not added';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'alert_type_code' and e.enumlabel = 'case_escalation'
  ) then
    raise exception 'case_escalation was not added to alert_type_code';
  end if;
  if not exists (
    select 1 from public.alert_rules
    where is_active and config @> jsonb_build_array(jsonb_build_object('type_code', 'case_escalation'))
  ) then
    raise exception 'active alert_rules config does not carry a case_escalation entry';
  end if;
  if (select count(*) from public.alert_rules where is_active) <> 1 then
    raise exception 'expected exactly one active alert_rules version after the v2 bump';
  end if;
  if has_function_privilege('anon', 'public.close_care_management_case(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute close_care_management_case';
  end if;
  raise notice 'PASS: clinician_alerts.case_id + case_escalation taxonomy + gated close_care_management_case all present, anon denied';
end $$;
