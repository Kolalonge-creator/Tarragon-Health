-- Tarragon Health — Alert System infrastructure, part 2b/6.
--
-- Extends clinician_alerts with the taxonomy (8.1), a severity model
-- independent of but derived from the existing deterministic `level`
-- classification (8.2), the rest of the lifecycle (8.3 -- Generated/
-- Assigned/Delivered/Actioned live as timestamps here, Acknowledged/
-- Resolved/Closed as `status` values, 'open' keeps covering
-- generated/assigned/delivered/actioned internally since it already has
-- dozens of live call sites), ownership (8.4), fatigue-prevention dedup
-- (8.7), snooze (8.10), and resolution documentation (8.12).
--
-- Deliberately does NOT touch any of the 8 existing trigger functions that
-- insert into this table (private.handle_abnormal_screening_result,
-- private.handle_bp_reading_red_flag, private.handle_emergency_event,
-- private.handle_foot_self_check, private.handle_lpe_red_flag,
-- private.handle_obesity_ed_screen, private.flag_missing_glucose_logs,
-- private.flag_overdue_vitals, plus the SpO2/temperature red-flag engines) --
-- editing 9+ live clinical-safety trigger functions this migration's author
-- has not read in full would be a materially riskier change than this
-- feature needs. Instead, a single new BEFORE INSERT trigger classifies
-- every row uniformly regardless of which function created it, using only
-- columns those functions already populate (level, screening_result_id,
-- vital_reading_id, title) -- so every existing and future generator is
-- covered without being touched.
--
-- Requires alert_status to already carry 'snoozed'/'closed' (previous
-- migration, part 2a) and alert_rules/alert_category/alert_type_code/
-- alert_resolution_outcome to already exist (part 1).

alter table public.clinician_alerts
  add column category                public.alert_category,
  add column type_code               public.alert_type_code,
  add column severity                smallint,
  add column responsible_clinician_id uuid references public.clinical_staff (id) on delete restrict,
  add column backup_clinician_id     uuid references public.clinical_staff (id) on delete restrict,
  add column assigned_at             timestamptz,
  add column resolution_action       text,
  add column resolution_outcome      public.alert_resolution_outcome,
  add column resolved_by             uuid references public.clinical_staff (id) on delete restrict,
  add column resolved_at             timestamptz,
  add column closed_by               uuid references public.clinical_staff (id) on delete restrict,
  add column closed_at               timestamptz,
  add column snoozed_until           timestamptz,
  add column snooze_reason           text,
  add column snoozed_by              uuid references public.clinical_staff (id) on delete restrict,
  add column dedup_key               text,
  add column duplicate_of            uuid references public.clinician_alerts (id) on delete set null,
  add column suppressed              boolean not null default false,
  add column suppressed_reason       text;

comment on column public.clinician_alerts.severity is
  '0-4 clinical urgency (8.2: 0 Information, 1 Routine action, 2 Clinical attention, 3 Urgent, 4 Emergency). Always derived deterministically from coalesce(override_level, level) by private.classify_and_assign_clinician_alert() / backfilled here -- never client-settable, so it can never drift from the existing classification. Level 0 has no generator yet (matches escalation_slas'' own unused "routine" placeholder tier).';
comment on column public.clinician_alerts.responsible_clinician_id is
  'The alert''s owner (8.4). Auto-assigned at creation from alert_rules'' governed owner_tier (least-loaded active clinical_staff at that tier); if none exists yet, self-assigned to whoever first acknowledges (private.stamp_clinician_alert_lifecycle) so an owner is guaranteed by the time a human has engaged.';
comment on column public.clinician_alerts.dedup_key is
  'type_code:patient_id. Used by the classify/assign trigger to find a recent (24h) open/acknowledged alert of the same type for the same patient -- see duplicate_of. A duplicate is always still inserted and visible; it is only ever hidden from active counts when alert_rules has explicitly turned on protocol-based suppression for that type (8.7) -- never a silent, ungoverned drop.';

alter table public.clinician_alerts
  add constraint clinician_alerts_severity_range
    check (severity is null or severity between 0 and 4),
  add constraint clinician_alerts_snooze_requires_reason
    check (snoozed_until is null or snooze_reason is not null),
  add constraint clinician_alerts_snoozed_status_requires_until
    check (status <> 'snoozed' or snoozed_until is not null),
  add constraint clinician_alerts_closed_requires_resolved
    check (status <> 'closed' or resolved_at is not null),
  -- 8.12: "resolution without action documentation should be restricted for
  -- important alerts." Important := severity >= 2 (Clinical attention or
  -- higher). A resolved/closed severity-2+ alert must record both what was
  -- done (resolution_action) and how it''s classified for analytics
  -- (resolution_outcome, feeding false-positive/duplicate rate -- 8.13).
  --
  -- NOT VALID: live-checked before writing this fix -- 2 pre-existing
  -- clinician_alerts rows (status='resolved', level='clinician_review',
  -- QA fixture data from 2026-08-10, predating resolution_action/
  -- resolution_outcome entirely) fail this rule and cannot be retroactively
  -- backfilled with real documentation nobody actually wrote. Standard
  -- Postgres pattern for adding a CHECK to a table with legacy data:
  -- grandfather existing rows, enforce for every row this constraint can
  -- actually govern -- every future insert/update is still fully checked
  -- (NOT VALID only skips the one-time validation scan of rows that
  -- predate the constraint, it does not weaken enforcement going forward).
  add constraint clinician_alerts_resolution_requires_documentation
    check (
      status not in ('resolved', 'closed')
      or coalesce(severity, 0) < 2
      or (resolution_action is not null and resolution_outcome is not null)
    ) not valid;

create index clinician_alerts_type_code_idx
  on public.clinician_alerts (organisation_id, type_code) where status in ('open', 'acknowledged');
create index clinician_alerts_responsible_idx
  on public.clinician_alerts (responsible_clinician_id) where status in ('open', 'acknowledged');
create index clinician_alerts_dedup_key_idx
  on public.clinician_alerts (dedup_key, created_at desc);
create index clinician_alerts_duplicate_of_idx
  on public.clinician_alerts (duplicate_of) where duplicate_of is not null;

-- ---------------------------------------------------------------------------
-- Classification + auto-assignment (BEFORE INSERT)
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

  -- Detection window is a stable 24h regardless of governance config (so
  -- duplicate_of grouping/analytics stays meaningful even for types with no
  -- signed suppression policy yet); actual SUPPRESSION only ever applies
  -- within the governed, narrower suppress_window_minutes -- so a type
  -- configured for e.g. a 4h suppression window can still show duplicate_of
  -- linkage out to 24h without over-suppressing a genuinely new event that
  -- arrives at hour 5.
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

comment on function private.classify_and_assign_clinician_alert() is
  'BEFORE INSERT on clinician_alerts. Derives severity from level/override_level (never client-settable), fills category/type_code when a generator has not already set them, auto-assigns responsible/backup clinicians from alert_rules'' governed tiers (least-loaded active clinical_staff, fail-open if none exist), and computes dedup_key/duplicate_of for fatigue prevention (8.7).';

create trigger clinician_alerts_classify_and_assign
  before insert on public.clinician_alerts
  for each row execute function private.classify_and_assign_clinician_alert();

-- ---------------------------------------------------------------------------
-- Lifecycle stamping (BEFORE UPDATE) -- forge-proof, same "RLS admits
-- broadly, a trigger narrows + overwrites" shape as
-- enforce_alert_override_clinical_only.
-- ---------------------------------------------------------------------------

create or replace function private.stamp_clinician_alert_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active;

  -- 8.4: guarantee an owner exists by the time a human has engaged, even
  -- when auto-assignment at creation found nobody at the governed tier.
  if new.status = 'acknowledged' and old.status <> 'acknowledged'
     and new.responsible_clinician_id is null and v_staff_id is not null then
    new.responsible_clinician_id := v_staff_id;
    new.assigned_at := coalesce(new.assigned_at, now());
  end if;

  -- 8.3/8.12: stamp resolution once, on the transition in; a later
  -- unrelated edit (e.g. a note) must never re-stamp or clear it.
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    new.resolved_by := v_staff_id;
    new.resolved_at := coalesce(new.resolved_at, now());
  elsif old.status in ('resolved', 'closed') then
    new.resolved_by := old.resolved_by;
    new.resolved_at := old.resolved_at;
  end if;

  -- 8.3: closure is a distinct, later accountability step from resolution.
  if new.status = 'closed' and old.status <> 'closed' then
    new.closed_by := v_staff_id;
    new.closed_at := coalesce(new.closed_at, now());
  elsif old.status = 'closed' then
    new.closed_by := old.closed_by;
    new.closed_at := old.closed_at;
  end if;

  -- 8.10: snooze. A resolved/closed alert is done; it cannot be deferred.
  if new.snoozed_until is distinct from old.snoozed_until then
    if new.snoozed_until is not null and old.status in ('resolved', 'closed') then
      raise exception 'Cannot snooze a resolved or closed alert' using errcode = '23514';
    end if;

    if new.snoozed_until is not null then
      new.snoozed_by := v_staff_id;
      new.status := 'snoozed';
    else
      new.snoozed_by := null;
      new.snooze_reason := null;
      if old.status = 'snoozed' then
        new.status := 'open';
      end if;
    end if;
  elsif old.snoozed_until is not null then
    new.snoozed_by := old.snoozed_by;
  end if;

  return new;
end;
$$;

comment on function private.stamp_clinician_alert_lifecycle() is
  'BEFORE UPDATE on clinician_alerts. Server-derives responsible_clinician_id (self-assign on first acknowledge if unowned), resolved_by/resolved_at, closed_by/closed_at, and snoozed_by from the caller''s own active clinical_staff record -- never client-supplied, never re-stamped by a later unrelated edit. Un-snoozing (snoozed_until cleared) returns status to ''open'' unconditionally rather than restoring a remembered pre-snooze status, a deliberate simplification: the clinician re-acknowledges if needed.';

create trigger clinician_alerts_stamp_lifecycle
  before update on public.clinician_alerts
  for each row execute function private.stamp_clinician_alert_lifecycle();

-- ---------------------------------------------------------------------------
-- 8.15 acceptance criterion: "No important alert can disappear without
-- accountability." audit_row_change_trg (20260812030853) already logs every
-- clinician_alerts delete to audit_log with a full row hash -- this adds
-- actual PREVENTION on top of that existing logging: an unresolved
-- clinical-attention-or-higher alert cannot be deleted at all, only
-- resolved/closed first.
-- ---------------------------------------------------------------------------

create or replace function private.guard_clinician_alert_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(old.severity, 0) >= 2 and old.status not in ('resolved', 'closed') then
    raise exception 'Cannot delete a clinical-attention-or-higher alert (severity %) before it is resolved and accounted for -- resolve or close it first.', old.severity
      using errcode = '42501';
  end if;
  return old;
end;
$$;

comment on function private.guard_clinician_alert_deletion() is
  'BEFORE DELETE on clinician_alerts. Blocks deleting an unresolved severity>=2 alert outright -- audit_row_change_trg already logs every delete that IS allowed, so this closes the gap where an important alert could be deleted (logged) but still just disappear from the active worklist with nobody having resolved it.';

create trigger clinician_alerts_guard_deletion
  before delete on public.clinician_alerts
  for each row execute function private.guard_clinician_alert_deletion();

-- ---------------------------------------------------------------------------
-- Backfill existing rows, then require classification going forward.
-- ---------------------------------------------------------------------------

update public.clinician_alerts
set severity = case coalesce(override_level, level)
    when 'emergency' then 4
    when 'urgent_escalation' then 3
    when 'clinician_review' then 2
    when 'routine' then 1
  end,
  type_code = case
    when screening_result_id is not null then 'abnormal_result'
    when vital_reading_id is not null then 'abnormal_monitoring'
    when title ilike 'priority%: emergency reported%' then 'symptom_escalation'
    when title ilike '%diabetic foot%' then 'symptom_escalation'
    when title ilike '%eating-disorder%' or title ilike '%mental-health screen%' then 'symptom_escalation'
    when title ilike 'lifestyle red flag%' then 'deterioration'
    when title ilike '%glucose logs%' or title ilike '%blood-pressure readings%' then 'overdue_monitoring'
    else 'abnormal_result'
  end::public.alert_type_code
where severity is null;

update public.clinician_alerts
set category = case type_code
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
  end::public.alert_category
where category is null;

update public.clinician_alerts
set dedup_key = type_code::text || ':' || patient_id::text
where dedup_key is null;

alter table public.clinician_alerts
  alter column category set not null,
  alter column type_code set not null,
  alter column severity set not null,
  alter column dedup_key set not null;

do $$
declare
  v_unclassified integer;
begin
  select count(*) into v_unclassified
  from public.clinician_alerts
  where category is null or type_code is null or severity is null or dedup_key is null;

  if v_unclassified > 0 then
    raise exception '% clinician_alerts rows are still unclassified after backfill', v_unclassified;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'clinician_alerts_classify_and_assign'
      and tgrelid = 'public.clinician_alerts'::regclass and not tgisinternal
  ) then
    raise exception 'clinician_alerts_classify_and_assign trigger was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'clinician_alerts_stamp_lifecycle'
      and tgrelid = 'public.clinician_alerts'::regclass and not tgisinternal
  ) then
    raise exception 'clinician_alerts_stamp_lifecycle trigger was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'clinician_alerts_guard_deletion'
      and tgrelid = 'public.clinician_alerts'::regclass and not tgisinternal
  ) then
    raise exception 'clinician_alerts_guard_deletion trigger was not created';
  end if;

  raise notice 'PASS: clinician_alerts taxonomy/severity backfilled (0 unclassified), lifecycle + deletion-guard triggers installed';
end $$;
