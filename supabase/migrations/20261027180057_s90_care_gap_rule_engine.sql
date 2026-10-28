-- S90 (first slice): the governed care-gap rule engine, on top of the July outreach engine. Born OFF, UNSIGNED.
-- Research: docs/research/S85-S90-competitor-gap-analysis-2026-10-22.md section 3.6. Design: docs/design/S90.md.
-- Values come from docs/plans/S88-S100-decisions-and-cmo-signoff-pack.md items 4.2 (hypertension cadence and overdue lines) and 4.6 (small cells).
--
-- WHAT THIS ADDS (nothing here changes a stored patient row, and nothing contacts a patient until a person signs and switches it on):
--   1. care_gap_rule_config: the thresholds and windows of six deterministic gap rules, the outreach ladder, the caps and the experiment scaffolding, as
--      versioned PROPOSED config, born UNSIGNED and INACTIVE (the outcome_cascade_config shape). Only the Chief Medical Officer's
--      sign_care_gap_rule_config() activates a version. Mirrored in the code registry as `care_gaps.rules` (drift test).
--   2. A go-live guard, care_gap_engine_enabled, born OFF, patched into private.go_live_conditions the S37 way (anchored replace, fails loudly).
--      OFF: the engine does nothing at all. ON with an unsigned config: SHADOW MODE (gaps are recorded for staff, no patient is contacted, no coordinator
--      task is made). ON with a signed config: live. Signing the config never switches the guard on.
--   3. care_gaps: a gap is a record (type, due date, owner, status, closure reason closed|declined|unreachable|wrong, and the signal that closed it).
--      A closure of kind 'closed' REQUIRES a recorded outcome signal (a reading or lab row, a refill, a recovered adherence line): a message sent or opened
--      never closes a gap. Written only by the definer functions below (no write grant). A closed row is a ledger row and never changes again.
--      The gap holds no reading value and no result: only dates, counts and the name of the failed criterion, so the coordinator queue stays logistics.
--   4. care_gap_attempts: the per-gap contact log (system sends and staff calls) with the variant a patient saw and, seven days later, whether the gap closed.
--      Staff call attempts are also written to the existing care_outreach_contacts log.
--   5. The ladder: push, then in-app card, then email, then a coordinator call task (a care_outreach_tasks row, not a parallel task system), with a weekly cap
--      per patient and Lagos quiet hours. Judgement items (a rising blood pressure trend) route to a doctor and are never put in front of a coordinator.
--   6. Owner auto-assignment, same organisation only: for logistics the least-loaded coordinator not on leave, else the least-loaded eligible doctor (the same
--      eligibility the escalation picker uses), else unowned with an immediate sev2 ops incident (and visible to an admin). A judgement item (a rising trend)
--      goes to a doctor only and is never routed to a coordinator (a trigger refuses it). An owner who goes on leave is replaced on the next run. A doctor-owned
--      gap carries a review date (a clock, not a clinical task): overdue it goes to the Chief Medical Officer, and an ops incident opens if it stays unreviewed.
--   7. public.care_gap_institution_summary(): distinct-people counts by gap type, open, and closed BY A RECORDED OUTCOME in the last 90 days from the real ledger
--      (declined, unreachable and wrong are counted apart, by reason), through the S75a single minimum-cell rule with complementary suppression; service role
--      only (the I9 doorway); filters only select cells already published.
--   8. Two neutral notification templates (INV-07): the wording never names a condition, a reading, a result or a medicine.
--
-- Counts before this migration (live 2026-10-27): no care_gap_rule_config, care_gaps or care_gap_attempts table; nothing to convert. The existing
-- patient_care_gaps view and private.queue_care_outreach() are NOT changed: this layer adds new gap types beside them.
-- The four outreach_trigger_type values this uses were added by 20261027175129 (a separate transaction, as enum labels require).
-- Live definitions read with pg_get_functiondef on 2026-10-27, not trusted from migration files: private.go_live_conditions (anchor present),
-- private.staff_may_read, private.pick_employed_clinician_competent (its eligibility list is mirrored in private.care_gap_pick_doctor), private.patient_reminder_channel(uuid, boolean),
-- private.bp_window_stats and private.bp_reading_usable (the shared usable-reading rule, mirrored in private.care_gap_last_usable_bp), private.weekly_adherence
-- (copied with a medicine scope into private.care_gap_scoped_adherence), private.triage_coverage_rule_params.
--
-- REVISED the same day after a strict review (this migration was never applied, so it is edited in place; live schema_migrations checked first):
--   owner fallback and visibility of unowned gaps; every open gap re-validated against the CURRENT signed configuration on each run (a disabled or changed rule closes the
--   gap as superseded, never suppressed, never messaged); a doctor review clock; failures counted with an ops incident and timeouts returned cleanly; the shared usable
--   blood pressure rule; closed counts for institutions filtered to recorded outcomes; adherence scoped to hypertension and diabetes medicines with the raising line recorded;
--   suppression only for closures a person made; run locks, SKIP LOCKED and an idempotent per (gap, step, week) send so overlapping runs cannot double send.

-- ---------------------------------------------------------------------------
-- 1. Configuration (versioned, PROPOSED, CMO owned, unsigned)
-- ---------------------------------------------------------------------------
create table public.care_gap_rule_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  owner          text not null default 'CMO',
  effective_from date not null,
  config         jsonb not null check (jsonb_typeof(config) = 'object'),
  note           text,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint care_gap_rule_config_active_is_signed check (not is_active or (approved_at is not null and approved_by is not null))
);
create unique index care_gap_rule_config_one_active on public.care_gap_rule_config (is_active) where is_active;
create index care_gap_rule_config_approved_by_idx on public.care_gap_rule_config (approved_by) where approved_by is not null;
alter table public.care_gap_rule_config enable row level security;
revoke all on public.care_gap_rule_config from public, anon, authenticated;
grant select on public.care_gap_rule_config to authenticated;
create policy care_gap_rule_config_read on public.care_gap_rule_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());

create function private.care_gap_rule_config_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'care_gap_rule_config version % is never deleted', old.version using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.is_active or new.approved_at is not null then
      raise exception 'a care gap rule config is created unsigned and inactive' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.config is distinct from old.config or new.version is distinct from old.version then
    raise exception 'a care gap rule config is never edited: add a new version' using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed config keeps its signature' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.care_gap_rule_config_guard() from public, anon, authenticated;
create trigger care_gap_rule_config_guard before insert or update or delete on public.care_gap_rule_config
  for each row execute function private.care_gap_rule_config_guard();
create trigger refuse_superseded_activation before update of is_active on public.care_gap_rule_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- care-gap-rules-v1-begin
insert into public.care_gap_rule_config (version, is_active, effective_from, config, note) values (1, false, '2026-10-27', $json$
{
  "verify_against_source": true,
  "founder_position": "Values in the hypertension rules come from decision pack item 4.2 (CMO-approved 2026-10-07 as the founder's recorded position, pending independent review, not signed). Every number carries verify against source until the CMO confirms the guideline text was opened.",
  "scope": {
    "members_only": true,
    "exclude_minors": true,
    "conditions": ["hypertension", "diabetes"]
  },
  "rules": {
    "missed_reading": {
      "enabled": true,
      "owner_role": "care_coordinator",
      "patient_ladder": true,
      "hypertension_days_without_reading": 14,
      "diabetes_days_without_reading": null,
      "source": "Pack 4.2: a home reading every 7 days when uncontrolled or newly started, every 14 days when controlled, and overdue means 7 days past due. 14 is the uncontrolled cadence plus the overdue allowance. Control state is not read by this rule, so one line serves everyone with an active hypertension plan. Only usable readings count (the shared rule: no pharmacy machine entry, nothing flagged for validation).",
      "cmo_to_supply": ["diabetes_days_without_reading"],
      "cmo_to_confirm": ["hypertension_days_without_reading"],
      "cmo_confirm_note": "For a controlled patient the pack's own overdue line is 21 days (14 plus 7), so this single line of 14 flags a controlled patient 7 days before the pack would. The rule reads only the value here and never infers control state; CMO to confirm 14 or supply a controlled line (OQ-S90-01).",
      "cmo_note": "The pack gives no home glucose cadence for diabetes (item 4.5 gives targets and triggers only). Until the CMO supplies one, a missed glucose reading is not a gap and this rule is inert for diabetes."
    },
    "no_hba1c_12_months": {
      "enabled": true,
      "owner_role": "care_coordinator",
      "patient_ladder": true,
      "lookback_days": 365,
      "grace_days": 30,
      "analyte_codes": ["hba1c"],
      "applies_to": ["diabetes"],
      "source": "Pack 4.2 annual labs and the 30 days past due line for labs; pack 4.5 names HbA1c for diabetes. A result on file counts from its own date; with none on file the plan start counts. Due is that date plus the lookback, and a gap opens only after the grace has passed, so a new plan is never flagged in its first year."
    },
    "no_lipids_12_months": {
      "enabled": true,
      "owner_role": "care_coordinator",
      "patient_ladder": true,
      "lookback_days": 365,
      "grace_days": 30,
      "analyte_codes": ["lipid_panel", "lipid_profile", "lipid", "total_cholesterol", "ldl", "ldl_cholesterol", "triglycerides"],
      "applies_to": ["hypertension", "diabetes"],
      "source": "Pack 4.2 annual labs list lipids; same 30 days past due line and same counting as the HbA1c rule. The analyte codes are the ones the lab ingestion uses today; a laboratory that sends a different code will not clear this gap until its code is added in a new version."
    },
    "rising_bp_trend": {
      "enabled": true,
      "owner_role": "clinician",
      "patient_ladder": false,
      "window_days": 14,
      "min_readings_per_window": 3,
      "min_rise_systolic_mmhg": null,
      "source": "Compares the average of usable home blood pressure readings in the latest window with the window before it, through the existing private.bp_window_stats helper (so it follows the shared usable-reading rule). Nothing here changes a medicine; a gap is a task for a doctor to review.",
      "cmo_to_supply": ["min_rise_systolic_mmhg"],
      "cmo_note": "The pack names the 7-day average and 3 readings on 2 days as the trigger (item 4.2) but gives no rise to call a trend. The engine invents none: with the rise left null this rule is inert. The window length and minimum readings are PROPOSED operational values for the CMO to confirm or change."
    },
    "medication_refill_lapse": {
      "enabled": true,
      "owner_role": "care_coordinator",
      "patient_ladder": true,
      "days_past_due": 7,
      "source": "PROPOSED, not in the pack. Uses the refill date the medicines module already holds (the same date that drives the refill reminder) and mirrors the 7 day overdue allowance for a reading. CMO to confirm or change."
    },
    "adherence_lapse": {
      "enabled": true,
      "owner_role": "care_coordinator",
      "patient_ladder": true,
      "signal_event": "adherence.below_line",
      "within_days": 10,
      "exclude_drug_name_patterns": ["contracept", "levonorgestrel", "ethinylestradiol", "norethisterone", "medroxyprogesterone", "etonogestrel", "drospirenone", "estradiol", "sertraline", "fluoxetine", "escitalopram", "citalopram", "paroxetine", "fluvoxamine", "venlafaxine", "duloxetine", "amitriptyline", "mirtazapine", "bupropion", "lithium"],
      "exclude_indication_patterns": ["contracept", "family planning", "fertility", "menopaus", "depress", "anxiety", "mental health", "psychiat"],
      "source": "Opens from the P6 adherence.below_line signal that the daily coverage sweep emits (the line itself, minPercent, lives in the signed or draft bp_care_triage rule set and is not copied here; it is recorded on the gap when it opens and the gap closes against that same line). The percentage is recomputed over the patient's hypertension and diabetes plan medicines only, so a contraceptive or a mental health medicine can neither raise nor hold a gap (reproductive and mental health stay out of this layer). 10 days matches the window P6 uses to avoid re-grading the same week.",
      "cmo_to_confirm": ["exclude_drug_name_patterns", "exclude_indication_patterns"],
      "cmo_confirm_note": "The two exclusion lists are PROPOSED privacy scope, not clinical thresholds. The main control is structural: only medicines linked to an active hypertension or diabetes plan are counted at all."
    }
  },
  "ladder": {
    "steps": ["push", "in_app", "email", "coordinator_call"],
    "days_between_steps": 3,
    "weekly_cap_per_patient": 2,
    "quiet_hours": { "start": "20:00", "end": "08:00" },
    "coordinator_followup_days": 3,
    "unreachable_after_staff_attempts": 2,
    "reopen_after_manual_close_days": 30,
    "doctor_review_days": 3,
    "recheck_after_hours": 20,
    "note": "PROPOSED operational values, not clinical. A doctor-owned gap (a judgement item) carries a review date this many days after it opens; unreviewed after that it goes to the Chief Medical Officer once, and an ops incident opens if it is still unreviewed (OQ-S90-05). An open gap is re-checked against the current rules at least every recheck_after_hours, sooner when a new reading, lab or medicine change arrives. The weekly cap counts messages actually sent to a patient across all gaps in a rolling 7 days. Quiet hours are Lagos time. A staff call is never capped. A person may mark a gap unreachable only after the stated number of logged staff attempts. A gap a person closed as declined, unreachable or wrong is not opened again for the stated number of days, so a patient who said no is not chased every night. A gap the system closed (the person left the programme, the medicine stopped, the rule changed) is never held back this way."
  },
  "ab": {
    "enabled": false,
    "outcome_days": 7,
    "experiments": [
      { "key": "copy_variant", "variants": ["a", "b"] },
      { "key": "send_hour", "variants": [9, 17] }
    ],
    "note": "Scaffolding only. Nothing is switched on: with enabled false every patient sees variant a and the normal window. Outcome means the gap was closed by a recorded signal within outcome_days of a send, never that a message was opened."
  },
  "notifications": {
    "template_first": "care_gap_checkin",
    "template_followup": "care_gap_checkin_followup",
    "rule": "Neutral by design (INV-07): no condition, reading, result or medicine is ever named, and the payload carries no clinical key."
  },
  "notes": {
    "closure": "A gap closes only when a recorded outcome appears (a reading or lab row, a refill, a recovered adherence line), or a person records declined, unreachable or wrong with a note. A message sent or opened never closes a gap. Every run checks each open gap against the rules as they stand now: if the rule is switched off or the person no longer meets it under the current numbers, the gap closes as superseded, with nothing sent and nothing held back.",
    "institutions": "Institutions see counts of people by gap type, the gaps closed by a recorded outcome, and how the others closed (declined, unreachable, wrong), from the ledger, through the single minimum-cell rule, never an individual."
  }
}
$json$::jsonb, 'PROPOSED, v1, UNSIGNED, INACTIVE (S90). Owner: CMO. Care gap rule thresholds, outreach ladder, caps and experiment scaffolding. Two numbers are left null for the CMO to supply (a diabetes reading cadence and the systolic rise that makes a trend), so those two rules are inert until a later version. Nothing contacts a patient until the CMO signs and the care_gap_engine_enabled guard is switched on.');
-- care-gap-rules-v1-end

create function public.sign_care_gap_rule_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.care_gap_rule_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the care gap rules' using errcode = '42501'; end if;
  select * into c from public.care_gap_rule_config where version = p_version for update;
  if not found then raise exception 'no such care gap rule configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.care_gap_rule_config set is_active = false where is_active and version <> p_version;
  update public.care_gap_rule_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'care_gap_rule_config.signed',
            'care_gap_rule_config', c.id, jsonb_build_object('version', p_version));
  -- Signing never switches the engine on and never contacts anyone: the guard is a separate act by an admin.
end $$;
revoke all on function public.sign_care_gap_rule_config(integer) from public, anon, authenticated;
grant execute on function public.sign_care_gap_rule_config(integer) to authenticated;

-- The configuration the engine reads: the active SIGNED version if there is one, else the newest draft (shadow mode), else nothing.
create function private.care_gap_effective_config(out cfg jsonb, out cfg_version integer, out is_signed boolean)
language sql stable security definer set search_path = ''
as $$
  select c.config, c.version, (c.is_active and c.approved_at is not null)
    from public.care_gap_rule_config c
   order by (c.is_active and c.approved_at is not null) desc, c.version desc
   limit 1
$$;
revoke all on function private.care_gap_effective_config() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The go-live guard, patched into private.go_live_conditions the S37 way
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('care_gap_engine_enabled', 'Care gap engine',
   'Recording care gaps and, with a signed rule configuration, contacting patients and creating coordinator tasks for them',
   'A care gap rule configuration exists; admin confirmation. With the configuration unsigned the engine runs in shadow mode: staff see gaps, no patient is contacted and no coordinator task is made. Patient contact and tasks need the configuration signed by the Chief Medical Officer.',
   'admin',
   array['private.care_gap_evaluate (record, close, assign)', 'private.care_gap_outreach_run (every patient message and coordinator task)'],
   'The July outreach engine (private.queue_care_outreach) and the patient_care_gaps view are not behind it. Closing a gap on a recorded outcome and a person logging or closing a gap are never behind it.')
on conflict (key) do nothing;

do $patch$
declare
  v_def text := pg_get_functiondef('private.go_live_conditions(text,uuid)'::regprocedure);
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
  v_branch constant text := $branch$
  elsif p_key = 'care_gap_engine_enabled' then
    return jsonb_build_array(
      private.go_live_cond('rule_config_exists', 'A care gap rule configuration exists (signed or not; unsigned means shadow mode)',
        exists (select 1 from public.care_gap_rule_config), 'data',
        (select 'version ' || max(version) || case when bool_or(is_active and approved_at is not null) then ' (a signed version is active)' else ' (none signed: shadow mode)' end from public.care_gap_rule_config)),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));$branch$;
begin
  if v_def like '%care_gap_engine_enabled%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the S90 branch by hand' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $patch$;
revoke all on function private.go_live_conditions(text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 3. The gap record and the contact log
-- ---------------------------------------------------------------------------
create table public.care_gaps (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  gap_type            text not null check (gap_type in ('missed_reading', 'no_hba1c_12_months', 'no_lipids_12_months', 'rising_bp_trend', 'medication_refill_lapse', 'adherence_lapse')),
  condition           text check (condition in ('hypertension', 'diabetes')),
  subject_id          uuid,
  due_date            date not null,
  opened_at           timestamptz not null default now(),
  status              text not null default 'open' check (status in ('open', 'closed')),
  -- closed: a recorded outcome. declined / unreachable / wrong: a PERSON closed it (these, and only these, hold the gap back from reopening).
  -- superseded: the SYSTEM closed it because its premise went (left the programme, medicine stopped, the rule was switched off or no longer applies).
  closure_reason      text check (closure_reason in ('closed', 'declined', 'unreachable', 'wrong', 'superseded')),
  closed_by_signal    jsonb,
  closed_at           timestamptz,
  closed_by           uuid references public.profiles (id) on delete set null,
  closure_note        text,
  owner_id            uuid references public.profiles (id) on delete set null,
  owner_role          text not null check (owner_role in ('care_coordinator', 'clinician')),
  outreach_task_id    uuid references public.care_outreach_tasks (id) on delete set null,
  shadow              boolean not null,
  config_version      integer not null references public.care_gap_rule_config (version) on delete restrict,
  -- Why this gap is open: the failed criterion, its line and the last signal. Dates, counts and names of criteria only, never a reading or a result.
  why                 jsonb not null check (jsonb_typeof(why) = 'object'),
  -- The line that raised the gap (the adherence percentage the P6 sweep used), recorded when it opened and never changed: the gap closes against this same line.
  threshold           numeric,
  risk_rank           smallint not null default 0 check (risk_rank between 0 and 4),
  days_overdue        integer not null default 0 check (days_overdue >= 0),
  trend_flag          boolean not null default false,
  ladder_step         smallint not null default 0 check (ladder_step >= 0),
  next_attempt_due_at timestamptz,
  attempt_count       integer not null default 0 check (attempt_count >= 0),
  -- The review clock of a doctor-owned (judgement) gap: a due time, one escalation to the Chief Medical Officer, then an ops incident. Not a clinical task (OQ-S90-05).
  review_due_at       timestamptz,
  review_escalated_at timestamptz,
  -- When the engine last checked this gap against the current rules (the hourly run only re-checks stale gaps or gaps whose inputs changed).
  last_checked_at     timestamptz,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((status = 'open') = (closure_reason is null)),
  check ((status = 'open') = (closed_at is null)),
  -- Outcome-based closure: kind 'closed' (and a system 'superseded') always carries the recorded signal that closed it.
  check (closure_reason not in ('closed', 'superseded') or (closed_by_signal is not null and closed_by_signal ? 'kind' and closed_by_signal ? 'at'))
);
create unique index care_gaps_one_live on public.care_gaps
  (patient_id, gap_type, (coalesce(condition, '')), (coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  where status = 'open';
create index care_gaps_owner_open_idx on public.care_gaps (owner_id, status) where status = 'open';
create index care_gaps_org_status_idx on public.care_gaps (organisation_id, status, gap_type);
create index care_gaps_patient_idx on public.care_gaps (patient_id);
create index care_gaps_task_idx on public.care_gaps (outreach_task_id) where outreach_task_id is not null;
create index care_gaps_closed_by_idx on public.care_gaps (closed_by) where closed_by is not null;
create index care_gaps_config_version_idx on public.care_gaps (config_version);
create index care_gaps_recheck_idx on public.care_gaps (last_checked_at nulls first) where status = 'open';
create index care_gaps_unowned_idx on public.care_gaps (organisation_id) where status = 'open' and owner_id is null;
create index care_gaps_review_due_idx on public.care_gaps (review_due_at) where status = 'open' and review_due_at is not null;

create trigger care_gaps_set_updated_at before update on public.care_gaps
  for each row execute function private.set_updated_at();
-- The S04b-1e event trigger (guard_new_patient_tables_trigger) already adds this guard to any new table with patient_id; drop-then-create keeps one copy either way.
drop trigger if exists "00_minor_dependant_scope" on public.care_gaps;
create trigger "00_minor_dependant_scope" before insert or update of patient_id on public.care_gaps
  for each row execute function private.guard_minor_dependant_scope('patient_id');

-- A closed gap is a ledger row. Identity never changes. The three columns a deleted profile or task nulls out (ON DELETE SET NULL) may change.
create function private.care_gaps_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.patient_id is distinct from old.patient_id or new.organisation_id is distinct from old.organisation_id
     or new.gap_type is distinct from old.gap_type or new.condition is distinct from old.condition
     or new.subject_id is distinct from old.subject_id or new.opened_at is distinct from old.opened_at
     or new.threshold is distinct from old.threshold then
    raise exception 'a care gap keeps its identity' using errcode = '23514';
  end if;
  if old.status = 'closed'
     and (to_jsonb(new) - 'owner_id' - 'outreach_task_id' - 'closed_by' - 'updated_at')
         is distinct from (to_jsonb(old) - 'owner_id' - 'outreach_task_id' - 'closed_by' - 'updated_at') then
    raise exception 'a closed care gap is a ledger row and never changes' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.care_gaps_guard() from public, anon, authenticated;
create trigger care_gaps_guard before update on public.care_gaps
  for each row execute function private.care_gaps_guard();

-- An owner is staff of the gap's OWN organisation, and a judgement item (owner_role clinician) is never owned by a care coordinator: judgement is a doctor's.
create function private.care_gaps_owner_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_id is null then return new; end if;
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = new.owner_id and cs.organisation_id = new.organisation_id) then
    raise exception 'a care gap is owned by staff of its own organisation' using errcode = '23514';
  end if;
  if new.owner_role = 'clinician' and exists (select 1 from public.clinical_staff cs where cs.profile_id = new.owner_id and cs.doctor_tier = 'care_coordinator') then
    raise exception 'a judgement item is never owned by a care coordinator' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.care_gaps_owner_guard() from public, anon, authenticated;
create trigger care_gaps_owner_guard before insert or update of owner_id, owner_role on public.care_gaps
  for each row execute function private.care_gaps_owner_guard();

create table public.care_gap_attempts (
  id                 uuid primary key default gen_random_uuid(),
  gap_id             uuid not null references public.care_gaps (id) on delete cascade,
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  attempted_at       timestamptz not null default now(),
  step               text not null check (step in ('push', 'in_app', 'email', 'coordinator_call', 'staff_call')),
  channel            text,
  result             text not null check (result in ('sent', 'skipped_cap', 'skipped_no_channel', 'task_created', 'call_reached', 'call_no_answer', 'message_left')),
  actor_id           uuid references public.profiles (id) on delete set null,
  note               text,
  variant            jsonb,
  notification_id    uuid references public.notifications (id) on delete set null,
  -- The Lagos week (its Monday) a send belongs to. One send per gap, step and week: two overlapping runs cannot both send.
  week_start         date,
  outcome_days       integer,
  outcome            text check (outcome in ('closed_by_signal', 'none')),
  outcome_checked_at timestamptz,
  check (result <> 'sent' or week_start is not null)
);
create unique index care_gap_attempts_one_send_per_week on public.care_gap_attempts (gap_id, step, week_start) where result = 'sent';
create index care_gap_attempts_gap_idx on public.care_gap_attempts (gap_id, attempted_at desc);
create index care_gap_attempts_patient_sent_idx on public.care_gap_attempts (patient_id, attempted_at desc) where result = 'sent';
create index care_gap_attempts_org_idx on public.care_gap_attempts (organisation_id);
create index care_gap_attempts_actor_idx on public.care_gap_attempts (actor_id) where actor_id is not null;
create index care_gap_attempts_notification_idx on public.care_gap_attempts (notification_id) where notification_id is not null;
create index care_gap_attempts_outcome_pending_idx on public.care_gap_attempts (attempted_at) where result = 'sent' and outcome is null;

-- Who may read a gap (INV-12). Staff only, and only through a care relationship: the gap's own assigned owner, or a staff member who passes the
-- S39b tie check (private.staff_may_read, which is false for a care coordinator with no assignment). A patient reads nothing; neither does an institution.
-- One addition: a gap nobody owns (no coordinator or doctor was available) would be invisible to everyone, so an admin of the same organisation (ops) may read
-- an UNOWNED gap so it can be assigned. Once it has an owner this door closes.
create function private.care_gap_visible(p_org uuid, p_patient uuid, p_owner uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (private.is_org_staff(p_org)
          and (p_owner = (select auth.uid())
               or private.staff_may_read(p_patient, p_org, 'appointments_care_plan'::public.care_access_category)))
      or (p_owner is null and private.is_admin() and private.is_org_staff(p_org))
$$;
revoke all on function private.care_gap_visible(uuid, uuid, uuid) from public, anon;
grant execute on function private.care_gap_visible(uuid, uuid, uuid) to authenticated;

alter table public.care_gaps enable row level security;
alter table public.care_gap_attempts enable row level security;
revoke all on public.care_gaps from public, anon, authenticated;
revoke all on public.care_gap_attempts from public, anon, authenticated;
grant select on public.care_gaps to authenticated;
grant select on public.care_gap_attempts to authenticated;
create policy care_gaps_select on public.care_gaps for select to authenticated
  using (private.care_gap_visible(organisation_id, patient_id, owner_id));
create policy care_gap_attempts_select on public.care_gap_attempts for select to authenticated
  using (exists (select 1 from public.care_gaps g where g.id = care_gap_attempts.gap_id));

comment on table public.care_gaps is 'S90: one row per open or closed care gap. Written only by SECURITY DEFINER functions. closure_reason closed requires a recorded outcome signal; superseded is a system closure (never suppresses a reopen).';
comment on table public.care_gap_attempts is 'S90: every contact attempt on a gap (system sends and staff calls) with the experiment variant and, after outcome_days, whether the gap closed by a recorded signal. One send per gap, step and Lagos week.';

-- S39b registry and S39d data registry: these tables follow the care tie and are patient data.
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('care_gaps', 'tied', 'patient_id', 'appointments_care_plan', null),
  ('care_gap_attempts', 'tied', 'patient_id', 'appointments_care_plan', null)
on conflict (table_name) do nothing;

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when the S90 care gap engine was added; awaiting review.'
  from unnest(array['care_gaps', 'care_gap_attempts']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------
-- 4. The rules: six deterministic gap types over signals that already exist
-- ---------------------------------------------------------------------------
create type private.care_gap_candidate as (
  patient_id uuid, organisation_id uuid, gap_type text, condition text, subject_id uuid,
  due_date date, days_overdue integer, why jsonb, owner_role text, is_test boolean);

-- Run exclusion: a run holds a transaction-scoped advisory lock under its own name; a second run that starts while the first is still going returns at once.
create function private.care_gap_try_lock(p_name text) returns boolean
language sql volatile set search_path = ''
as $$ select pg_try_advisory_xact_lock(hashtextextended('care_gap:' || p_name, 0)) $$;
revoke all on function private.care_gap_try_lock(text) from public, anon, authenticated;

-- Who the engine looks at: active patients with an active hypertension or diabetes plan, a current Member (config), not a minor dependant.
create function private.care_gap_enrolled(p_now timestamptz, p_cfg jsonb, p_patient uuid default null)
returns table (patient_id uuid, organisation_id uuid, is_test boolean, htn_since timestamptz, dm_since timestamptz)
language sql stable security definer set search_path = ''
as $$
  select pr.id, pr.organisation_id, coalesce(pr.is_test, false), h.since, d.since
    from public.profiles pr
    left join lateral (select max(cp.created_at) as since from public.care_plans cp
                        where cp.patient_id = pr.id and cp.status = 'active' and cp.condition::text = 'hypertension') h on true
    left join lateral (select max(cp.created_at) as since from public.care_plans cp
                        where cp.patient_id = pr.id and cp.status = 'active' and cp.condition::text = 'diabetes') d on true
   where pr.role = 'patient' and pr.is_active and pr.organisation_id is not null
     and (p_patient is null or pr.id = p_patient)
     and (h.since is not null or d.since is not null)
     and (not coalesce((p_cfg #>> '{scope,members_only}')::boolean, true) or private.patient_is_member_at(pr.id, p_now))
     and not private.is_minor_dependant(pr.id)
$$;
revoke all on function private.care_gap_enrolled(timestamptz, jsonb, uuid) from public, anon, authenticated;

-- The shared usable blood pressure rule, exactly as private.bp_window_stats applies it: the diagnostic view (no wearable estimate), both numbers present,
-- never a pharmacy machine entry, and private.bp_reading_usable (valid, or flagged only for missing context). The latest such reading at or before p_now
-- (and after p_after when given).
create function private.care_gap_last_usable_bp(p_patient uuid, p_now timestamptz, p_after timestamptz default null)
returns table (id uuid, taken_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select v.id, v.taken_at
    from private.vitals_readings_diagnostic v
   where v.patient_id = p_patient and v.vital_type::text = 'blood_pressure' and v.systolic is not null and v.diastolic is not null
     and v.entry_origin is distinct from 'pharmacy_machine'
     and private.bp_reading_usable(v.validation_status, v.validation_flags)
     and v.taken_at <= p_now and (p_after is null or v.taken_at > p_after)
   order by v.taken_at desc
   limit 1
$$;
revoke all on function private.care_gap_last_usable_bp(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create function private.care_gap_rule_missed_reading(p_now timestamptz, p_cfg jsonb, p_patient uuid default null)
returns setof private.care_gap_candidate
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_rule jsonb := p_cfg #> '{rules,missed_reading}';
  v_owner text := coalesce(v_rule ->> 'owner_role', 'care_coordinator');
  k record;
begin
  if v_rule is null or not coalesce((v_rule ->> 'enabled')::boolean, false) then return; end if;
  for k in
    select t.cond, t.days, t.vt
      from (values ('hypertension', (v_rule ->> 'hypertension_days_without_reading')::integer, 'blood_pressure'),
                   ('diabetes', (v_rule ->> 'diabetes_days_without_reading')::integer, 'glucose')) as t(cond, days, vt)
     where t.days is not null
  loop
    return query
    select e.patient_id, e.organisation_id, 'missed_reading'::text, k.cond::text, null::uuid,
           ((coalesce(l.last_at, s.since) at time zone 'Africa/Lagos')::date + k.days),
           greatest(0, v_today - ((coalesce(l.last_at, s.since) at time zone 'Africa/Lagos')::date + k.days)),
           jsonb_build_object('criterion', 'no_reading_in_days', 'signal', k.vt, 'threshold_days', k.days,
                              'days_since', v_today - (coalesce(l.last_at, s.since) at time zone 'Africa/Lagos')::date,
                              'last_signal_at', l.last_at,
                              'anchor', case when l.last_at is null then 'plan_start' else 'last_reading' end),
           v_owner, e.is_test
      from private.care_gap_enrolled(p_now, p_cfg, p_patient) e
      cross join lateral (select case when k.cond = 'hypertension' then e.htn_since else e.dm_since end as since) s
      left join lateral (
        select max(z.t) as last_at
          from (select b.taken_at as t from private.care_gap_last_usable_bp(e.patient_id, p_now) b where k.vt = 'blood_pressure'
                union all
                select v.taken_at from private.vitals_readings_current v
                 where k.vt = 'glucose' and v.patient_id = e.patient_id and v.vital_type::text = 'glucose' and v.glucose_mmol_l is not null and v.taken_at <= p_now) z) l on true
     where s.since is not null
       and v_today - (coalesce(l.last_at, s.since) at time zone 'Africa/Lagos')::date >= k.days;
  end loop;
end $$;
revoke all on function private.care_gap_rule_missed_reading(timestamptz, jsonb, uuid) from public, anon, authenticated;

-- A lab gap is due on (the last matching result, or with none on file the start of the plan) plus the lookback, and opens once the grace has also passed.
-- So a new plan is not flagged for a year and a month, and a result already on file counts from its own date.
create function private.care_gap_rule_labs(p_now timestamptz, p_cfg jsonb, p_patient uuid default null)
returns setof private.care_gap_candidate
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_type text;
  v_rule jsonb;
  v_codes text[];
  v_applies text[];
  v_lookback integer;
  v_grace integer;
begin
  foreach v_type in array array['no_hba1c_12_months', 'no_lipids_12_months'] loop
    v_rule := p_cfg #> array['rules', v_type];
    if v_rule is null or not coalesce((v_rule ->> 'enabled')::boolean, false) then continue; end if;
    v_codes := array(select jsonb_array_elements_text(v_rule -> 'analyte_codes'));
    v_applies := array(select jsonb_array_elements_text(v_rule -> 'applies_to'));
    v_lookback := (v_rule ->> 'lookback_days')::integer;
    v_grace := coalesce((v_rule ->> 'grace_days')::integer, 0);
    if v_lookback is null or cardinality(v_codes) = 0 or cardinality(v_applies) = 0 then continue; end if;
    return query
    select e.patient_id, e.organisation_id, v_type, s.cond::text, null::uuid,
           d.due, greatest(0, v_today - d.due),
           jsonb_build_object('criterion', 'no_lab_in_days', 'lookback_days', v_lookback, 'grace_days', v_grace,
                              'last_signal_at', l.last_at,
                              'anchor', case when l.last_at is null then 'plan_start' else 'last_lab' end),
           coalesce(v_rule ->> 'owner_role', 'care_coordinator'), e.is_test
      from private.care_gap_enrolled(p_now, p_cfg, p_patient) e
      cross join lateral (
        select case when 'diabetes' = any (v_applies) and e.dm_since is not null then 'diabetes'
                    when 'hypertension' = any (v_applies) and e.htn_since is not null then 'hypertension' end as cond,
               greatest(case when 'hypertension' = any (v_applies) then e.htn_since end,
                        case when 'diabetes' = any (v_applies) then e.dm_since end) as since) s
      left join lateral (
        select max(x.taken_at) as last_at from private.lab_analyte_readings_current x
         where x.patient_id = e.patient_id and x.code = any (v_codes) and x.taken_at <= p_now) l on true
      cross join lateral (
        select ((coalesce(l.last_at, s.since) at time zone 'Africa/Lagos')::date + v_lookback) as due) d
     where s.since is not null and s.cond is not null
       and v_today - d.due >= v_grace;
  end loop;
end $$;
revoke all on function private.care_gap_rule_labs(timestamptz, jsonb, uuid) from public, anon, authenticated;

create function private.care_gap_rule_rising_bp_trend(p_now timestamptz, p_cfg jsonb, p_patient uuid default null)
returns setof private.care_gap_candidate
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_rule jsonb := p_cfg #> '{rules,rising_bp_trend}';
  v_w integer; v_min integer; v_rise numeric;
begin
  if v_rule is null or not coalesce((v_rule ->> 'enabled')::boolean, false) then return; end if;
  v_w := (v_rule ->> 'window_days')::integer;
  v_min := (v_rule ->> 'min_readings_per_window')::integer;
  v_rise := (v_rule ->> 'min_rise_systolic_mmhg')::numeric;
  -- No rise supplied by the CMO means no trend is defined: inert, never a default.
  if v_w is null or v_min is null or v_rise is null then return; end if;
  return query
  select e.patient_id, e.organisation_id, 'rising_bp_trend'::text, 'hypertension'::text, null::uuid,
         v_today, 0,
         jsonb_build_object('criterion', 'bp_average_rose_between_windows', 'window_days', v_w, 'min_readings_per_window', v_min,
                            'min_rise_systolic_mmhg', v_rise, 'readings_in_window', cur.n, 'readings_in_prior_window', prev.n),
         coalesce(v_rule ->> 'owner_role', 'clinician'), e.is_test
    from private.care_gap_enrolled(p_now, p_cfg, p_patient) e
    cross join lateral private.bp_window_stats(e.patient_id, v_today - (v_w - 1), v_today) cur
    cross join lateral private.bp_window_stats(e.patient_id, v_today - (2 * v_w - 1), v_today - v_w) prev
   where e.htn_since is not null
     and cur.n >= v_min and prev.n >= v_min
     and cur.avg_sys - prev.avg_sys >= v_rise;
end $$;
revoke all on function private.care_gap_rule_rising_bp_trend(timestamptz, jsonb, uuid) from public, anon, authenticated;

-- The refill date the medicines module already holds (the date that drives the refill reminder) is the one signal; the run-out projection is never in the past.
create function private.care_gap_refill_due(p_medication uuid, p_refill_date date, p_now timestamptz)
returns date language sql stable security definer set search_path = ''
as $$
  select case when p_refill_date is not null and s.run_out is not null then least(p_refill_date, s.run_out) else coalesce(p_refill_date, s.run_out) end
    from (select (select ss.run_out_date from private.medication_supply_status(p_medication, p_now) ss) as run_out) s
$$;
revoke all on function private.care_gap_refill_due(uuid, date, timestamptz) from public, anon, authenticated;

create function private.care_gap_rule_medication_refill_lapse(p_now timestamptz, p_cfg jsonb, p_patient uuid default null)
returns setof private.care_gap_candidate
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_rule jsonb := p_cfg #> '{rules,medication_refill_lapse}';
  v_days integer;
begin
  if v_rule is null or not coalesce((v_rule ->> 'enabled')::boolean, false) then return; end if;
  v_days := (v_rule ->> 'days_past_due')::integer;
  if v_days is null then return; end if;
  return query
  select e.patient_id, e.organisation_id, 'medication_refill_lapse'::text, cp.condition::text, m.id,
         d.due, greatest(0, v_today - d.due),
         jsonb_build_object('criterion', 'refill_past_due_days', 'threshold_days', v_days, 'days_since', v_today - d.due, 'due_date', d.due),
         coalesce(v_rule ->> 'owner_role', 'care_coordinator'), e.is_test
    from private.care_gap_enrolled(p_now, p_cfg, p_patient) e
    join public.medications m on m.patient_id = e.patient_id and m.is_active and m.superseded_at is null and m.stopped_at is null
                              and (m.expires_at is null or m.expires_at > p_now)
    join public.care_plans cp on cp.id = m.care_plan_id and cp.status = 'active' and cp.condition::text in ('hypertension', 'diabetes')
    cross join lateral (select private.care_gap_refill_due(m.id, m.refill_date, p_now) as due) d
   where d.due is not null and v_today - d.due >= v_days;
end $$;
revoke all on function private.care_gap_rule_medication_refill_lapse(timestamptz, jsonb, uuid) from public, anon, authenticated;

-- The medicines the adherence rule may count: only those on the patient's active hypertension or diabetes plan, and not on the configured exclusion lists
-- (reproductive health and mental health medicines stay out of this layer; the lists are config, the structural plan link is the main control).
create function private.care_gap_adherence_scope(p_patient uuid, p_cfg jsonb) returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(m.id), '{}'::uuid[])
    from public.medications m
    join public.care_plans cp on cp.id = m.care_plan_id and cp.status = 'active' and cp.condition::text in ('hypertension', 'diabetes')
   where m.patient_id = p_patient and m.is_active and m.superseded_at is null
     and not exists (select 1 from jsonb_array_elements_text(coalesce(p_cfg #> '{rules,adherence_lapse,exclude_drug_name_patterns}', '[]'::jsonb)) pt
                      where lower(coalesce(m.drug_name, '')) like '%' || lower(pt) || '%')
     and not exists (select 1 from jsonb_array_elements_text(coalesce(p_cfg #> '{rules,adherence_lapse,exclude_indication_patterns}', '[]'::jsonb)) pt
                      where lower(coalesce(m.indication, '')) like '%' || lower(pt) || '%')
$$;
revoke all on function private.care_gap_adherence_scope(uuid, jsonb) from public, anon, authenticated;

-- private.weekly_adherence, copied with ONE change: only the medicines in the scope are counted. Same window, same missed-after rule, same minimum doses.
-- It raises the same error when no medicine configuration is active (the caller counts that as a failure, it is never swallowed).
create function private.care_gap_scoped_adherence(p_patient uuid, p_now timestamptz, p_cfg jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  c record;
  v_end date := (p_now at time zone 'Africa/Lagos')::date;
  v_start date;
  r record;
  v_percent integer;
  v_scope uuid[] := private.care_gap_adherence_scope(p_patient, p_cfg);
begin
  select * into c from public.medicine_config where is_active;
  if not found then
    raise exception 'no active medicine_config' using errcode = '55000';
  end if;
  v_start := v_end - (c.adherence_window_days - 1);

  select
    count(*) filter (where state <> 'open')       as due,
    count(*) filter (where state = 'taken')       as taken,
    count(*) filter (where state = 'delayed')     as late,
    count(*) filter (where state = 'skipped')     as skipped,
    count(*) filter (where state = 'missed')      as missed,
    count(*) filter (where state = 'not_available') as unavailable
  into r
  from (
    select coalesce(v.status::text,
             case when p_now >= s.due_at + make_interval(mins => greatest(c.missed_after_minutes, s.win)) then 'missed' else 'open' end) as state
      from (
        select m.id as med_id, g.d::date as sdate, sl.slot_time,
               ((g.d::date + sl.slot_time::time) at time zone 'Africa/Lagos') as due_at,
               greatest(m.created_at, coalesce(m.schedule_effective_from, m.created_at)) as active_from,
               case when (m.schedule_spec ->> 'windowMinutes') ~ '^[0-9]{1,3}$'
                    then least((m.schedule_spec ->> 'windowMinutes')::integer, 360) else 0 end as win
          from public.medications m
         cross join lateral generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') g(d)
         cross join lateral private.medication_slots_on(m.schedule_spec, m.schedule_times, g.d::date, m.patient_id) sl
         where m.patient_id = p_patient and m.id = any (v_scope) and m.is_active and m.superseded_at is null
      ) s
      left join public.medication_logs_latest_per_slot v
        on v.medication_id = s.med_id and v.scheduled_for_date = s.sdate and v.scheduled_time = s.slot_time
     where s.due_at <= p_now and s.due_at >= s.active_from
  ) z;

  v_percent := case when r.due >= c.adherence_min_doses
                    then round(100.0 * (r.taken + r.late) / r.due)::integer end;

  return jsonb_build_object('percent', v_percent, 'due', r.due, 'taken', r.taken, 'late', r.late, 'skipped', r.skipped,
                            'missed', r.missed, 'unavailable', r.unavailable, 'scoped_medicines', cardinality(v_scope),
                            'window_start', v_start, 'window_end', v_end);
end $$;
revoke all on function private.care_gap_scoped_adherence(uuid, timestamptz, jsonb) from public, anon, authenticated;

-- Opens from the P6 signal, but only when the SCOPED adherence (hypertension and diabetes medicines only) is below the line P6 used. The line (minPercent) is
-- recorded in why and becomes the gap's threshold; the percentage itself is never stored.
create function private.care_gap_rule_adherence_lapse(p_now timestamptz, p_cfg jsonb, p_patient uuid default null)
returns setof private.care_gap_candidate
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_rule jsonb := p_cfg #> '{rules,adherence_lapse}';
  v_event text; v_within integer; v_min numeric;
begin
  if v_rule is null or not coalesce((v_rule ->> 'enabled')::boolean, false) then return; end if;
  v_event := v_rule ->> 'signal_event';
  v_within := (v_rule ->> 'within_days')::integer;
  v_min := (private.triage_coverage_rule_params() #>> '{adherence,minPercent}')::numeric;
  if v_event is null or v_within is null or v_min is null then return; end if;
  return query
  select e.patient_id, e.organisation_id, 'adherence_lapse'::text, null::text, null::uuid,
         (de.occurred_at at time zone 'Africa/Lagos')::date, greatest(0, v_today - (de.occurred_at at time zone 'Africa/Lagos')::date),
         jsonb_build_object('criterion', 'adherence_below_line_signal', 'signal_event', v_event, 'within_days', v_within, 'last_signal_at', de.occurred_at,
                            'min_percent', v_min),
         coalesce(v_rule ->> 'owner_role', 'care_coordinator'), e.is_test
    from private.care_gap_enrolled(p_now, p_cfg, p_patient) e
    cross join lateral (
      select d.occurred_at from public.domain_events d
       where d.patient_id = e.patient_id and d.event_type = v_event
         and d.occurred_at > p_now - make_interval(days => v_within) and d.occurred_at <= p_now
       order by d.occurred_at desc limit 1) de
    cross join lateral (select private.care_gap_scoped_adherence(e.patient_id, p_now, p_cfg) as a) ad
   where (ad.a ->> 'percent') is not null and (ad.a ->> 'percent')::numeric < v_min
     -- a lapse that was already closed after this signal (adherence recovered) is not opened again from the same signal
     and not exists (select 1 from public.care_gaps x where x.patient_id = e.patient_id and x.gap_type = 'adherence_lapse'
                        and x.status = 'closed' and x.closed_at >= de.occurred_at);
end $$;
revoke all on function private.care_gap_rule_adherence_lapse(timestamptz, jsonb, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Closure by outcome, re-validation against the current rules, owner assignment
-- ---------------------------------------------------------------------------
-- Returns what should happen to an open gap, or null when nothing has. A message sent or opened is never a signal: nothing here reads notifications.
--   1. the person is no longer enrolled                                  -> kind no_longer_enrolled, reason superseded (a SYSTEM closure)
--   2. a recorded outcome (a reading, a lab row, a refill, a recovery)  -> reason closed, with the row that closed it
--   3. the rule is switched off, or a number it needs is null, in the CURRENT configuration -> kind superseded_config, reason superseded
--   4. the person no longer meets the rule under the CURRENT numbers   -> kind premise_no_longer_holds (or trend_stale / no_scoped_medicine), reason superseded
--   5. it cannot be judged right now (no adherence line, too few doses)  -> kind cannot_judge (the caller counts it and writes one audit row per batch; the gap stays open
--      and the ladder does not message it)
-- So a gap opened under an earlier or a shadow configuration never outlives the rules it was opened under.
create function private.care_gap_closing_signal(g public.care_gaps, p_cfg jsonb, p_now timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rule jsonb := p_cfg #> array['rules', g.gap_type];
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_id uuid; v_at timestamptz; v_codes text[]; v_lookback integer;
  v_w integer; v_min integer; v_rise numeric; cur record;
  v_med public.medications%rowtype; v_due date; v_days integer;
  v_line numeric; a jsonb; v_fn text; v_still boolean; v_cfg_ok boolean;
begin
  if not exists (select 1 from private.care_gap_enrolled(p_now, p_cfg, g.patient_id)) then
    return jsonb_build_object('kind', 'no_longer_enrolled', 'at', p_now, 'reason', 'superseded');
  end if;

  -- 2. a recorded outcome
  if g.gap_type = 'missed_reading' then
    if g.condition = 'diabetes' then
      select v.id, v.taken_at into v_id, v_at from private.vitals_readings_current v
       where v.patient_id = g.patient_id and v.taken_at > g.opened_at and v.taken_at <= p_now
         and v.vital_type::text = 'glucose' and v.glucose_mmol_l is not null
       order by v.taken_at desc limit 1;
    else
      -- only a USABLE reading closes it (the shared rule: no pharmacy machine entry, nothing flagged for validation)
      select b.id, b.taken_at into v_id, v_at from private.care_gap_last_usable_bp(g.patient_id, p_now, g.opened_at) b;
    end if;
    if v_id is not null then return jsonb_build_object('kind', 'reading_logged', 'table', 'vitals_readings', 'id', v_id, 'at', v_at); end if;

  elsif g.gap_type in ('no_hba1c_12_months', 'no_lipids_12_months') then
    v_codes := array(select jsonb_array_elements_text(v_rule -> 'analyte_codes'));
    v_lookback := (v_rule ->> 'lookback_days')::integer;
    if v_lookback is not null and cardinality(v_codes) > 0 then
      select x.id, x.taken_at into v_id, v_at from private.lab_analyte_readings_current x
       where x.patient_id = g.patient_id and x.code = any (v_codes)
         and x.taken_at > p_now - make_interval(days => v_lookback) and x.taken_at <= p_now
       order by x.taken_at desc limit 1;
      if v_id is not null then return jsonb_build_object('kind', 'lab_done', 'table', 'lab_analyte_readings', 'id', v_id, 'at', v_at); end if;
    end if;

  elsif g.gap_type = 'rising_bp_trend' then
    v_w := (v_rule ->> 'window_days')::integer; v_min := (v_rule ->> 'min_readings_per_window')::integer; v_rise := (v_rule ->> 'min_rise_systolic_mmhg')::numeric;
    if v_w is not null and v_min is not null and v_rise is not null then
      declare prev record;
      begin
        select * into cur from private.bp_window_stats(g.patient_id, v_today - (v_w - 1), v_today);
        select * into prev from private.bp_window_stats(g.patient_id, v_today - (2 * v_w - 1), v_today - v_w);
        if cur.n >= v_min and not (prev.n >= v_min and cur.avg_sys - prev.avg_sys >= v_rise) then
          select b.id, b.taken_at into v_id, v_at from private.care_gap_last_usable_bp(g.patient_id, p_now, g.opened_at) b;
          if v_id is not null then return jsonb_build_object('kind', 'trend_cleared', 'table', 'vitals_readings', 'id', v_id, 'at', v_at); end if;
        end if;
      end;
    end if;

  elsif g.gap_type = 'medication_refill_lapse' then
    select * into v_med from public.medications where id = g.subject_id;
    if not found or not v_med.is_active or v_med.superseded_at is not null or v_med.stopped_at is not null or (v_med.expires_at is not null and v_med.expires_at <= p_now) then
      return jsonb_build_object('kind', 'medication_no_longer_current', 'table', 'medications', 'id', g.subject_id, 'at', p_now, 'reason', 'superseded');
    end if;
    v_days := (v_rule ->> 'days_past_due')::integer;
    v_due := private.care_gap_refill_due(v_med.id, v_med.refill_date, p_now);
    if v_days is not null and (v_due is null or v_today - v_due < v_days) then
      return jsonb_build_object('kind', 'refill_recorded', 'table', 'medications', 'id', v_med.id, 'at', p_now);
    end if;

  elsif g.gap_type = 'adherence_lapse' then
    -- closes against the line recorded when the gap opened (the line that raised it), not whatever the line is today
    v_line := coalesce(g.threshold, (private.triage_coverage_rule_params() #>> '{adherence,minPercent}')::numeric);
    if v_line is not null then
      a := private.care_gap_scoped_adherence(g.patient_id, p_now, p_cfg);   -- an error here is NOT swallowed: the batch counts it and opens an incident
      if (a ->> 'percent') is not null and (a ->> 'percent')::numeric >= v_line then
        return jsonb_build_object('kind', 'adherence_recovered', 'table', 'medication_logs', 'at', p_now);
      end if;
    end if;
  end if;

  -- 3. the rule in the CURRENT configuration
  v_cfg_ok := case g.gap_type
    when 'missed_reading' then (v_rule ->> case when g.condition = 'diabetes' then 'diabetes_days_without_reading' else 'hypertension_days_without_reading' end) is not null
    when 'rising_bp_trend' then (v_rule ->> 'window_days') is not null and (v_rule ->> 'min_readings_per_window') is not null and (v_rule ->> 'min_rise_systolic_mmhg') is not null
    when 'medication_refill_lapse' then (v_rule ->> 'days_past_due') is not null
    when 'adherence_lapse' then (v_rule ->> 'signal_event') is not null
    else (v_rule ->> 'lookback_days') is not null
  end;
  if v_rule is null or not coalesce((v_rule ->> 'enabled')::boolean, false) or not coalesce(v_cfg_ok, false) then
    return jsonb_build_object('kind', 'superseded_config', 'at', p_now, 'reason', 'superseded');
  end if;

  -- 4. the person still meets the rule under the current numbers
  if g.gap_type = 'adherence_lapse' then
    if cardinality(private.care_gap_adherence_scope(g.patient_id, p_cfg)) = 0 then
      return jsonb_build_object('kind', 'no_scoped_medicine', 'at', p_now, 'reason', 'superseded');
    end if;
    if v_line is null then return jsonb_build_object('kind', 'cannot_judge', 'cause', 'adherence_no_line'); end if;
    if (a ->> 'percent') is null then return jsonb_build_object('kind', 'cannot_judge', 'cause', 'adherence_too_few_doses'); end if;
    return null;   -- still below the recorded line: stays open
  end if;

  v_fn := case g.gap_type when 'missed_reading' then 'care_gap_rule_missed_reading' when 'rising_bp_trend' then 'care_gap_rule_rising_bp_trend'
                          when 'medication_refill_lapse' then 'care_gap_rule_medication_refill_lapse' else 'care_gap_rule_labs' end;
  execute format('select exists (select 1 from private.%I($1, $2, $3) c where c.gap_type = $4 and coalesce(c.condition, '''') = coalesce($5, '''')
                                   and coalesce(c.subject_id, $7) = coalesce($6, $7))', v_fn)
    into v_still using p_now, p_cfg, g.patient_id, g.gap_type, g.condition, g.subject_id, v_zero;
  if not v_still then
    if g.gap_type = 'rising_bp_trend' then
      -- a patient who stopped logging has no recent window to compare: the trend is stale, not resolved
      v_w := (v_rule ->> 'window_days')::integer; v_min := (v_rule ->> 'min_readings_per_window')::integer;
      select * into cur from private.bp_window_stats(g.patient_id, v_today - (v_w - 1), v_today);
      if cur.n < v_min then return jsonb_build_object('kind', 'trend_stale', 'at', p_now, 'reason', 'superseded'); end if;
    end if;
    return jsonb_build_object('kind', 'premise_no_longer_holds', 'at', p_now, 'reason', 'superseded');
  end if;
  return null;
end $$;
revoke all on function private.care_gap_closing_signal(public.care_gaps, jsonb, timestamptz) from public, anon, authenticated;

-- severity: sev2 for a gap nobody can see, sev3 for a failing job. An existing open incident under the same reference is refreshed and only ever made MORE severe.
create function private.care_gap_incident(p_ref text, p_what text, p_severity text default 'sev3', p_title text default 'The care gap engine is failing') returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_sev public.ops_incident_severity := p_severity::public.ops_incident_severity;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if exists (select 1 from public.ops_incidents where external_reference = p_ref and status not in ('resolved', 'closed')) then
    update public.ops_incidents
       set summary = left(p_what, 500), severity = case when v_sev < severity then v_sev else severity end
     where external_reference = p_ref and status not in ('resolved', 'closed');
  else
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (v_org, 'operational', v_sev, p_title, left(p_what, 500), p_ref,
            now() + case when v_sev <= 'sev2' then interval '1 hour' else interval '1 day' end,
            now() + case when v_sev <= 'sev2' then interval '1 day' else interval '3 days' end);
  end if;
end $$;
revoke all on function private.care_gap_incident(text, text, text, text) from public, anon, authenticated;

-- The one place a gap is closed on a signal (the nightly pass, the hourly pass and the ladder all use it), so the closure and its task clean-up cannot drift apart.
create function private.care_gap_close_with_signal(g public.care_gaps, p_sig jsonb, p_now timestamptz) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_reason text := coalesce(p_sig ->> 'reason', 'closed');
begin
  update public.care_gaps
     set status = 'closed', closure_reason = v_reason, closed_by_signal = p_sig - 'reason', closed_at = p_now, next_attempt_due_at = null, last_checked_at = p_now
   where id = g.id and status = 'open';
  if not found then return false; end if;
  update public.care_outreach_tasks t
     set status = 'resolved', outcome_note = coalesce(t.outcome_note, case v_reason when 'closed' then 'Closed automatically: a recorded outcome was found.'
                                                                       else 'Closed automatically: the care gap no longer applies.' end)
   where t.id = g.outreach_task_id and t.status in ('open', 'in_progress', 'contacted')
     and not exists (select 1 from public.care_gaps o where o.outreach_task_id = t.id and o.status = 'open' and o.id <> g.id);
  return true;
end $$;
revoke all on function private.care_gap_close_with_signal(public.care_gaps, jsonb, timestamptz) from public, anon, authenticated;

-- Re-checks open gaps against the CURRENT rules and closes the ones that now have a recorded outcome or whose premise has gone. Idempotent. p_force checks every
-- open gap (the nightly pass); otherwise only gaps never checked, last checked longer ago than recheck_after_hours, or with a new reading, lab or medicine change
-- since the last check (the hourly pass), so the hourly job is not a full scan. A failure on one gap is counted and audited, never swallowed; failures open an ops
-- incident; a statement timeout ends the batch cleanly with what was done so far.
create function private.care_gap_close_resolved(p_now timestamptz, p_cfg jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  g public.care_gaps; v_sig jsonb;
  v_closed integer := 0; v_checked integer := 0; v_failed integer := 0; v_timed_out boolean := false;
  v_unjudged jsonb := '{}'::jsonb; v_cause text; v_org uuid;
  v_recheck interval := make_interval(hours => coalesce((p_cfg #>> '{ladder,recheck_after_hours}')::integer, 20));
begin
  if not private.care_gap_try_lock('close_resolved') then return jsonb_build_object('skipped', 'locked'); end if;
  begin
    for g in
      select * from public.care_gaps x
       where x.status = 'open'
         and (p_force or x.last_checked_at is null or x.last_checked_at < p_now - v_recheck
              or case when x.gap_type in ('missed_reading', 'rising_bp_trend')
                      then exists (select 1 from private.vitals_readings_current v where v.patient_id = x.patient_id and v.created_at > x.last_checked_at)
                      when x.gap_type in ('no_hba1c_12_months', 'no_lipids_12_months')
                      then exists (select 1 from private.lab_analyte_readings_current l where l.patient_id = x.patient_id and l.created_at > x.last_checked_at)
                      when x.gap_type = 'medication_refill_lapse'
                      then exists (select 1 from public.medications m where m.id = x.subject_id and m.updated_at > x.last_checked_at)
                      else false end)
       order by x.last_checked_at nulls first, x.id
         for update skip locked
    loop
      begin
        v_checked := v_checked + 1;
        v_sig := private.care_gap_closing_signal(g, p_cfg, p_now);
        if v_sig is null then
          update public.care_gaps set last_checked_at = p_now where id = g.id and status = 'open';
        elsif v_sig ->> 'kind' = 'cannot_judge' then
          v_cause := coalesce(v_sig ->> 'cause', 'unknown');
          v_unjudged := jsonb_set(v_unjudged, array[v_cause], to_jsonb(coalesce((v_unjudged ->> v_cause)::integer, 0) + 1));
          update public.care_gaps set last_checked_at = p_now where id = g.id and status = 'open';
        elsif private.care_gap_close_with_signal(g, v_sig, p_now) then
          v_closed := v_closed + 1;
        end if;
      exception
        when query_canceled then v_timed_out := true;
        when others then
          v_failed := v_failed + 1;
          insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
            values (g.organisation_id, 'care_gap_engine.error_close', 'care_gap', g.id, jsonb_build_object('error', left(sqlerrm, 300), 'gap_type', g.gap_type));
      end;
      exit when v_timed_out;
    end loop;
  exception when query_canceled then
    v_timed_out := true;   -- the scan itself ran out of time: this block's work is rolled back, the next run starts again
  end;
  select id into v_org from public.organisations order by created_at limit 1;
  if v_unjudged <> '{}'::jsonb then
    insert into public.audit_log (organisation_id, action, entity_type, event)
      values (v_org, 'care_gap_engine.close_unjudged', 'care_gap_rule', jsonb_build_object('causes', v_unjudged, 'note', 'left open: the line or enough doses was not available to judge'));
  end if;
  if v_failed > 0 or v_timed_out then
    perform private.care_gap_incident('care-gap-close-failing',
      format('The care gap closure pass had %s failed gap(s)%s; see audit_log action care_gap_engine.error_close. Those gaps may be open past their outcome until it is fixed.',
             v_failed, case when v_timed_out then ' and ran out of time' else '' end));
  end if;
  return jsonb_build_object('checked', v_checked, 'closed', v_closed, 'failed', v_failed, 'timed_out', v_timed_out, 'unjudged', v_unjudged);
end $$;
revoke all on function private.care_gap_close_resolved(timestamptz, jsonb, boolean) from public, anon, authenticated;

-- Owners, same organisation only. Coordinators for logistics; when the organisation has no available coordinator, the least-loaded eligible doctor; when it has
-- neither, nobody (the engine then opens an immediate sev2 incident and an admin can read the gap). A judgement item goes to a doctor and never to a coordinator.
create function private.care_gap_pick_coordinator(p_org uuid, p_now timestamptz default now()) returns uuid
language sql stable security definer set search_path = ''
as $$
  select cs.profile_id
    from public.clinical_staff cs
   where cs.organisation_id = p_org and cs.active and cs.status = 'active' and cs.profile_id is not null
     and cs.doctor_tier = 'care_coordinator'
     and not private.clinician_on_leave(cs.profile_id, p_now)
   order by private.clinician_deprioritised_now(cs.profile_id, p_now),
            (select count(*) from public.care_gaps x where x.owner_id = cs.profile_id and x.status = 'open')
            + (select count(*) from public.care_outreach_tasks t where t.assigned_to = cs.profile_id and t.status in ('open', 'in_progress', 'contacted')),
            cs.profile_id
   limit 1
$$;
revoke all on function private.care_gap_pick_coordinator(uuid, timestamptz) from public, anon, authenticated;

-- Eligibility copied from private.pick_employed_clinician_competent (read live 2026-10-27): employed, a doctor tier, eligible, not on leave, not in post-call rest,
-- no conflict with the patient. The load measure is the open care gaps held plus the clinical tasks pushed, so fallback work spreads instead of piling on one doctor.
create function private.care_gap_pick_doctor(p_org uuid, p_patient uuid, p_now timestamptz default now()) returns uuid
language sql stable security definer set search_path = ''
as $$
  select cs.profile_id
    from public.clinical_staff cs
   where cs.organisation_id = p_org and cs.active and cs.status = 'active' and cs.profile_id is not null
     and cs.employment_type = 'employed'
     and cs.doctor_tier is not null
     and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank('senior_medical_officer'::public.doctor_tier)
     and private.clinician_is_eligible(cs.profile_id)
     and not private.clinician_on_leave(cs.profile_id, p_now)
     and not private.clinician_in_post_call_rest(cs.profile_id)
     and not private.has_conflict(cs.profile_id, p_patient)
   order by private.clinician_deprioritised_now(cs.profile_id, p_now),
            (select count(*) from public.care_gaps x where x.owner_id = cs.profile_id and x.status = 'open')
            + (select count(*) from public.clinical_tasks ct where ct.pushed_to = cs.profile_id and ct.state in ('offered_to_lead', 'open', 'claimed', 'escalated')),
            cs.profile_id
   limit 1
$$;
revoke all on function private.care_gap_pick_doctor(uuid, uuid, timestamptz) from public, anon, authenticated;

create function private.care_gap_pick_cmo(p_org uuid, p_now timestamptz default now()) returns uuid
language sql stable security definer set search_path = ''
as $$
  select cs.profile_id from public.clinical_staff cs
   where cs.organisation_id = p_org and cs.active and cs.status = 'active' and cs.profile_id is not null
     and cs.doctor_tier = 'chief_medical_officer' and not private.clinician_on_leave(cs.profile_id, p_now)
   order by cs.profile_id limit 1
$$;
revoke all on function private.care_gap_pick_cmo(uuid, timestamptz) from public, anon, authenticated;

create function private.care_gap_pick_owner(p_org uuid, p_patient uuid, p_role text, p_now timestamptz default now()) returns uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_role = 'clinician' then
    return private.care_gap_pick_doctor(p_org, p_patient, p_now);   -- judgement: a doctor, never a coordinator, never nobody-by-default
  end if;
  return coalesce(private.care_gap_pick_coordinator(p_org, p_now), private.care_gap_pick_doctor(p_org, p_patient, p_now));
end $$;
revoke all on function private.care_gap_pick_owner(uuid, uuid, text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The engine: record, close, assign, review clock (nightly)
-- ---------------------------------------------------------------------------
create function private.care_gap_evaluate(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg jsonb; v_ver integer; v_signed boolean;
  fn text; c private.care_gap_candidate; g public.care_gaps; v_close jsonb;
  v_opened integer := 0; v_refreshed integer := 0; v_closed integer := 0; v_reassigned integer := 0; v_failed integer := 0;
  v_escalated integer := 0; v_overdue integer := 0; v_n integer;
  v_rank smallint; v_owner uuid; v_live_id uuid; v_org uuid; v_timed_out boolean := false;
  v_unowned_live integer; v_unowned_shadow integer; v_unowned_orgs integer;
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_review_days integer;
begin
  if not private.go_live_guard_on('care_gap_engine_enabled') then return jsonb_build_object('skipped', 'guard_off'); end if;
  if not private.care_gap_try_lock('evaluate') then return jsonb_build_object('skipped', 'locked'); end if;
  select e.cfg, e.cfg_version, e.is_signed into v_cfg, v_ver, v_signed from private.care_gap_effective_config() e;
  if v_cfg is null then return jsonb_build_object('skipped', 'no_config'); end if;
  v_review_days := coalesce((v_cfg #>> '{ladder,doctor_review_days}')::integer, 3);

  -- every open gap is checked against the CURRENT configuration first: an outcome closes it, a rule that is off or no longer met supersedes it
  v_close := private.care_gap_close_resolved(p_now, v_cfg, true);
  v_closed := coalesce((v_close ->> 'closed')::integer, 0);
  v_failed := v_failed + coalesce((v_close ->> 'failed')::integer, 0);
  v_timed_out := coalesce((v_close ->> 'timed_out')::boolean, false);

  foreach fn in array array['care_gap_rule_missed_reading', 'care_gap_rule_labs', 'care_gap_rule_rising_bp_trend',
                            'care_gap_rule_medication_refill_lapse', 'care_gap_rule_adherence_lapse'] loop
    exit when v_timed_out;
    begin
      for c in execute format('select * from private.%I($1, $2)', fn) using p_now, v_cfg loop
        begin
          select coalesce((select case x.risk_level when 'very_high' then 4 when 'high' then 3 when 'moderate' then 2 when 'low' then 1 else 0 end
                             from public.patient_risk_scores x where x.patient_id = c.patient_id order by x.computed_at desc limit 1), 0)
            into v_rank;
          v_live_id := null;
          -- a gap a PERSON closed as declined, unreachable or wrong is not opened again straight away. A closure the system made (the person left and came
          -- back, the medicine stopped, the rule changed) never holds anything back.
          if exists (select 1 from public.care_gaps x
                      where x.patient_id = c.patient_id and x.gap_type = c.gap_type and coalesce(x.condition, '') = coalesce(c.condition, '')
                        and coalesce(x.subject_id, v_zero) = coalesce(c.subject_id, v_zero)
                        and x.status = 'closed' and x.closure_reason in ('declined', 'unreachable', 'wrong')
                        and x.closed_at > p_now - make_interval(days => coalesce((v_cfg #>> '{ladder,reopen_after_manual_close_days}')::integer, 30))) then
            continue;
          end if;
          select id into v_live_id from public.care_gaps
           where patient_id = c.patient_id and gap_type = c.gap_type and coalesce(condition, '') = coalesce(c.condition, '')
             and coalesce(subject_id, v_zero) = coalesce(c.subject_id, v_zero)
             and status = 'open';
          if v_live_id is not null then
            -- keep the staff panel current. Shadow versus live is decided from the CURRENT configuration on every run: a gap opened in shadow turns live
            -- only once the configuration is signed AND the gap still qualifies under it (it was just re-validated above and is a candidate now).
            update public.care_gaps set why = c.why, days_overdue = c.days_overdue, risk_rank = v_rank, shadow = not v_signed, config_version = v_ver
             where id = v_live_id and (why is distinct from c.why or days_overdue is distinct from c.days_overdue or risk_rank is distinct from v_rank
                                       or shadow is distinct from not v_signed or config_version is distinct from v_ver);
            if found then v_refreshed := v_refreshed + 1; end if;
          else
            v_owner := private.care_gap_pick_owner(c.organisation_id, c.patient_id, c.owner_role, p_now);
            insert into public.care_gaps (organisation_id, patient_id, gap_type, condition, subject_id, due_date, opened_at, owner_id, owner_role,
                                          shadow, config_version, why, threshold, risk_rank, days_overdue, is_test, review_due_at, last_checked_at)
            values (c.organisation_id, c.patient_id, c.gap_type, c.condition, c.subject_id, c.due_date, p_now, v_owner, c.owner_role,
                    not v_signed, v_ver, c.why, nullif(c.why ->> 'min_percent', '')::numeric, v_rank, c.days_overdue, c.is_test,
                    case when c.owner_role = 'clinician' then p_now + make_interval(days => v_review_days) end, p_now)
            on conflict (patient_id, gap_type, (coalesce(condition, '')), (coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid))) where status = 'open' do nothing;
            get diagnostics v_n = row_count;
            v_opened := v_opened + v_n;   -- a second run that lost the race opens nothing and is not a failure
          end if;
        exception
          when query_canceled then v_timed_out := true;
          when others then
            v_failed := v_failed + 1;
            insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
              values (c.organisation_id, 'care_gap_engine.error_record', 'patient', c.patient_id, jsonb_build_object('rule', fn, 'error', left(sqlerrm, 300)));
        end;
        exit when v_timed_out;
      end loop;
    exception
      when query_canceled then v_timed_out := true;
      when others then
        v_failed := v_failed + 1;
        select id into v_org from public.organisations order by created_at limit 1;
        insert into public.audit_log (organisation_id, action, entity_type, event)
          values (v_org, 'care_gap_engine.error_rule', 'care_gap_rule', jsonb_build_object('rule', fn, 'error', left(sqlerrm, 300)));
    end;
  end loop;

  -- An owner who has gone on leave, left, or was never found is replaced (leave respected, same organisation). A logistics gap held by a fallback doctor moves
  -- back to a coordinator as soon as one is available.
  if not v_timed_out then
    for g in select * from public.care_gaps x where x.status = 'open'
              and (x.owner_id is null
                   or private.clinician_on_leave(x.owner_id, p_now)
                   or not exists (select 1 from public.clinical_staff cs where cs.profile_id = x.owner_id and cs.active and cs.status = 'active')
                   or (x.owner_role = 'care_coordinator'
                       and not exists (select 1 from public.clinical_staff cs where cs.profile_id = x.owner_id and cs.doctor_tier = 'care_coordinator')
                       and private.care_gap_pick_coordinator(x.organisation_id, p_now) is not null))
             order by x.id for update skip locked loop
      begin
        v_owner := private.care_gap_pick_owner(g.organisation_id, g.patient_id, g.owner_role, p_now);
        if v_owner is not null and v_owner is distinct from g.owner_id then
          update public.care_gaps set owner_id = v_owner where id = g.id and status = 'open';
          update public.care_outreach_tasks set assigned_to = v_owner where id = g.outreach_task_id and status in ('open', 'in_progress', 'contacted');
          v_reassigned := v_reassigned + 1;
        end if;
      exception
        when query_canceled then v_timed_out := true;
        when others then
          v_failed := v_failed + 1;
          insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
            values (g.organisation_id, 'care_gap_engine.error_assign', 'care_gap', g.id, jsonb_build_object('error', left(sqlerrm, 300)));
      end;
      exit when v_timed_out;
    end loop;
  end if;

  -- The review clock of a doctor-owned gap (live only: shadow never creates work). Past its review date it goes to the Chief Medical Officer ONCE with a new
  -- date; still unreviewed after that, or nobody to escalate to, and an ops incident opens. This is a clock, not a clinical task (OQ-S90-05).
  if not v_timed_out and v_signed then
    for g in select * from public.care_gaps x where x.status = 'open' and not x.shadow and x.owner_role = 'clinician'
              and x.review_due_at is not null and x.review_due_at <= p_now
             order by x.id for update skip locked loop
      begin
        v_owner := null;
        if g.review_escalated_at is null then v_owner := private.care_gap_pick_cmo(g.organisation_id, p_now); end if;
        if v_owner is not null and v_owner is distinct from g.owner_id then
          update public.care_gaps set owner_id = v_owner, review_escalated_at = p_now,
                 review_due_at = p_now + make_interval(days => v_review_days) where id = g.id and status = 'open';
          v_escalated := v_escalated + 1;
        else
          v_overdue := v_overdue + 1;
          if g.review_escalated_at is null then update public.care_gaps set review_escalated_at = p_now where id = g.id and status = 'open'; end if;
        end if;
      exception
        when query_canceled then v_timed_out := true;
        when others then
          v_failed := v_failed + 1;
          insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
            values (g.organisation_id, 'care_gap_engine.error_review', 'care_gap', g.id, jsonb_build_object('error', left(sqlerrm, 300)));
      end;
      exit when v_timed_out;
    end loop;
  end if;

  -- ranking flag: a patient with an open rising trend gap has the flag on all of their open gaps
  update public.care_gaps x set trend_flag = exists (select 1 from public.care_gaps t where t.patient_id = x.patient_id and t.gap_type = 'rising_bp_trend' and t.status = 'open')
   where x.status = 'open'
     and x.trend_flag is distinct from exists (select 1 from public.care_gaps t where t.patient_id = x.patient_id and t.gap_type = 'rising_bp_trend' and t.status = 'open');

  if v_failed > 0 or v_timed_out then
    perform private.care_gap_incident('care-gap-engine-failing',
      format('%s step(s) failed in the last care gap run%s; see audit_log actions care_gap_engine.error_*. Gaps may be missing or stale until it is fixed.', v_failed,
             case when v_timed_out then ' (it also ran out of time and stopped early)' else '' end));
  end if;
  -- A gap with no owner is invisible to every coordinator (reads follow the assignment): never let one sit quietly. A LIVE unowned gap is sev2 straight away.
  select count(*) filter (where not shadow), count(*) filter (where shadow), count(distinct organisation_id)
    into v_unowned_live, v_unowned_shadow, v_unowned_orgs
    from public.care_gaps where status = 'open' and owner_id is null and not is_test;
  if v_unowned_live + v_unowned_shadow > 0 then
    perform private.care_gap_incident('care-gap-unowned',
      format('%s open care gap(s) in %s organisation(s) have no owner (%s live, %s in shadow) because no coordinator or doctor is available there. Nobody but an admin can see them until an owner exists.',
             v_unowned_live + v_unowned_shadow, v_unowned_orgs, v_unowned_live, v_unowned_shadow),
      case when v_unowned_live > 0 then 'sev2' else 'sev3' end, 'Care gaps have no owner');
  end if;
  if v_overdue > 0 then
    perform private.care_gap_incident('care-gap-review-overdue',
      format('%s doctor-owned care gap(s) are past their review date and have already been escalated once (or there is no Chief Medical Officer to escalate to).', v_overdue),
      'sev3', 'Doctor review of care gaps is overdue');
  end if;
  return jsonb_build_object('opened', v_opened, 'refreshed', v_refreshed, 'closed', v_closed, 'reassigned', v_reassigned, 'escalated', v_escalated, 'review_overdue', v_overdue,
                            'failed', v_failed, 'timed_out', v_timed_out, 'unowned', v_unowned_live + v_unowned_shadow, 'shadow', not v_signed, 'config_version', v_ver);
end $$;
revoke all on function private.care_gap_evaluate(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The outreach ladder (hourly): live only, signed config only
-- ---------------------------------------------------------------------------
-- Deterministic variant for a gap and an experiment key (null when experiments are off or the key is not defined).
create function private.care_gap_variant(p_cfg jsonb, p_gap uuid, p_key text) returns jsonb
language sql stable set search_path = ''
as $$
  select case when coalesce((p_cfg #>> '{ab,enabled}')::boolean, false)
              then (e.value -> 'variants') -> (((hashtext(p_gap::text || ':' || p_key)::bigint & 2147483647) % jsonb_array_length(e.value -> 'variants'))::integer)
         end
    from jsonb_array_elements(coalesce(p_cfg #> '{ab,experiments}', '[]'::jsonb)) as e(value)
   where e.value ->> 'key' = p_key and jsonb_array_length(e.value -> 'variants') > 0
   limit 1
$$;
revoke all on function private.care_gap_variant(jsonb, uuid, text) from public, anon, authenticated;

create function private.care_gap_in_quiet_hours(p_cfg jsonb, p_now timestamptz) returns boolean
language sql stable set search_path = ''
as $$
  select case
    when (p_cfg #>> '{ladder,quiet_hours,start}') is null or (p_cfg #>> '{ladder,quiet_hours,end}') is null then false
    when (p_cfg #>> '{ladder,quiet_hours,start}')::time = (p_cfg #>> '{ladder,quiet_hours,end}')::time then false
    when (p_cfg #>> '{ladder,quiet_hours,start}')::time < (p_cfg #>> '{ladder,quiet_hours,end}')::time
      then (p_now at time zone 'Africa/Lagos')::time >= (p_cfg #>> '{ladder,quiet_hours,start}')::time
       and (p_now at time zone 'Africa/Lagos')::time <  (p_cfg #>> '{ladder,quiet_hours,end}')::time
    else (p_now at time zone 'Africa/Lagos')::time >= (p_cfg #>> '{ladder,quiet_hours,start}')::time
      or (p_now at time zone 'Africa/Lagos')::time <  (p_cfg #>> '{ladder,quiet_hours,end}')::time
  end
$$;
revoke all on function private.care_gap_in_quiet_hours(jsonb, timestamptz) from public, anon, authenticated;

-- Fills in, for sends older than outcome_days, whether the gap then closed by a recorded signal. Never counts an open or a click.
create function private.care_gap_record_outcomes(p_now timestamptz, p_cfg jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_days integer := coalesce((p_cfg #>> '{ab,outcome_days}')::integer, 7); v_n integer;
begin
  update public.care_gap_attempts a
     set outcome_days = v_days, outcome_checked_at = p_now,
         outcome = case when exists (
           select 1 from public.care_gaps g
            where g.id = a.gap_id and g.status = 'closed' and g.closure_reason = 'closed'
              and (g.closed_by_signal ->> 'at')::timestamptz >= a.attempted_at
              and (g.closed_by_signal ->> 'at')::timestamptz <= a.attempted_at + make_interval(days => v_days))
           then 'closed_by_signal' else 'none' end
   where a.result = 'sent' and a.outcome is null and a.attempted_at <= p_now - make_interval(days => v_days);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.care_gap_record_outcomes(timestamptz, jsonb) from public, anon, authenticated;

-- The ladder. Before ANY step the gap is re-checked against the signed configuration as it stands now: one with an outcome or no longer met is closed and gets
-- nothing; one that was opened in shadow (or under an earlier version) is promoted to live only here, only because it still qualifies. A send is one row per
-- (gap, step, Lagos week), so an overlapping run cannot send twice; the weekly cap is counted from those rows under the run lock.
create function private.care_gap_outreach_run(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg jsonb; v_ver integer; v_signed boolean;
  g public.care_gaps; v_steps text[]; v_i integer; v_step text; v_rule jsonb; v_ladder boolean; v_sig jsonb;
  v_cap integer; v_sent_7d integer; v_channel public.notification_channel; v_template text; v_copy jsonb; v_hour jsonb;
  v_nid uuid; v_task uuid; v_att uuid; v_trigger public.outreach_trigger_type; v_variant jsonb;
  v_week date := date_trunc('week', p_now at time zone 'Africa/Lagos')::date;
  v_sent integer := 0; v_capped integer := 0; v_tasks integer := 0; v_failed integer := 0; v_closed integer := 0; v_dupes integer := 0; v_unjudged integer := 0;
  v_promoted integer := 0; v_timed_out boolean := false; v_close jsonb;
begin
  if not private.go_live_guard_on('care_gap_engine_enabled') then return jsonb_build_object('skipped', 'guard_off'); end if;
  select e.cfg, e.cfg_version, e.is_signed into v_cfg, v_ver, v_signed from private.care_gap_effective_config() e;
  -- Shadow mode: staff see gaps, nobody is contacted and no task is made.
  if v_cfg is null or not v_signed then return jsonb_build_object('skipped', 'config_unsigned_shadow'); end if;
  if not private.care_gap_try_lock('outreach') then return jsonb_build_object('skipped', 'locked'); end if;

  v_close := private.care_gap_close_resolved(p_now, v_cfg, false);
  v_closed := coalesce((v_close ->> 'closed')::integer, 0);
  v_failed := coalesce((v_close ->> 'failed')::integer, 0);
  v_timed_out := coalesce((v_close ->> 'timed_out')::boolean, false);
  perform private.care_gap_record_outcomes(p_now, v_cfg);
  v_steps := array(select jsonb_array_elements_text(v_cfg #> '{ladder,steps}'));
  v_cap := coalesce((v_cfg #>> '{ladder,weekly_cap_per_patient}')::integer, 0);

  if not v_timed_out then
  for g in select * from public.care_gaps x
            where x.status = 'open' and (x.next_attempt_due_at is null or x.next_attempt_due_at <= p_now)
              and x.ladder_step < cardinality(v_steps)
            order by x.risk_rank desc, x.days_overdue desc, x.id
              for update skip locked loop
    begin
      -- re-check this one gap against the current signed configuration, whatever its last check says
      v_sig := private.care_gap_closing_signal(g, v_cfg, p_now);
      if v_sig is not null and v_sig ->> 'kind' = 'cannot_judge' then v_unjudged := v_unjudged + 1; continue; end if;
      if v_sig is not null then
        if private.care_gap_close_with_signal(g, v_sig, p_now) then v_closed := v_closed + 1; end if;
        continue;
      end if;
      if g.shadow or g.config_version is distinct from v_ver then
        update public.care_gaps set shadow = false, config_version = v_ver where id = g.id and status = 'open';
        v_promoted := v_promoted + 1;
      end if;

      v_rule := v_cfg #> array['rules', g.gap_type];
      v_ladder := coalesce((v_rule ->> 'patient_ladder')::boolean, false);
      -- skip the steps that do not apply to this gap (a judgement item has no patient steps and no coordinator step)
      v_i := g.ladder_step;
      loop
        v_step := v_steps[v_i + 1];
        exit when v_step is null;
        if v_step <> 'coordinator_call' and not v_ladder then v_i := v_i + 1; continue; end if;
        if v_step = 'coordinator_call' and g.owner_role <> 'care_coordinator' then v_i := v_i + 1; continue; end if;
        exit;
      end loop;
      if v_step is null then
        update public.care_gaps set ladder_step = v_i, next_attempt_due_at = null where id = g.id;
        continue;
      end if;

      if v_step = 'coordinator_call' then
        v_trigger := (case g.gap_type when 'missed_reading' then 'gap_missed_reading'
                                      when 'medication_refill_lapse' then 'gap_refill_lapse'
                                      when 'adherence_lapse' then 'gap_adherence_lapse'
                                      else 'gap_lab_overdue' end)::public.outreach_trigger_type;
        v_task := null;
        insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, trigger_detail, priority, assigned_to)
        values (g.organisation_id, g.patient_id, v_trigger,
                jsonb_build_object('source', 'care_gap_engine', 'gap_id', g.id, 'gap_type', g.gap_type, 'due_date', g.due_date),
                case when g.risk_rank >= 3 then 2 else 3 end, g.owner_id)
        on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted') do nothing
        returning id into v_task;
        if v_task is null then
          select id into v_task from public.care_outreach_tasks
           where patient_id = g.patient_id and trigger_type = v_trigger and status in ('open', 'in_progress', 'contacted') limit 1;
        end if;
        insert into public.care_gap_attempts (gap_id, organisation_id, patient_id, attempted_at, step, channel, result)
        values (g.id, g.organisation_id, g.patient_id, p_now, 'coordinator_call', 'task', 'task_created');
        update public.care_gaps set outreach_task_id = v_task, ladder_step = v_i + 1, attempt_count = attempt_count + 1,
               next_attempt_due_at = p_now + make_interval(days => coalesce((v_cfg #>> '{ladder,coordinator_followup_days}')::integer, 3))
         where id = g.id;
        v_tasks := v_tasks + 1;
        continue;
      end if;

      -- patient-facing step. Not in the quiet hours, and not before the experiment's send hour when one is running.
      v_hour := private.care_gap_variant(v_cfg, g.id, 'send_hour');
      if private.care_gap_in_quiet_hours(v_cfg, p_now) then continue; end if;
      if v_hour is not null and (p_now at time zone 'Africa/Lagos')::time < make_time((v_hour #>> '{}')::integer, 0, 0) then continue; end if;

      -- the channel for this step (push only when the patient has a push subscription; private.patient_reminder_channel decides)
      if v_step = 'push' then
        v_channel := private.patient_reminder_channel(g.patient_id, false);
        if v_channel <> 'push' then
          insert into public.care_gap_attempts (gap_id, organisation_id, patient_id, attempted_at, step, channel, result)
          values (g.id, g.organisation_id, g.patient_id, p_now, 'push', null, 'skipped_no_channel');
          update public.care_gaps set ladder_step = v_i + 1, next_attempt_due_at = p_now where id = g.id;
          continue;
        end if;
      elsif v_step = 'in_app' then v_channel := 'in_app';
      else v_channel := 'email';
      end if;

      -- weekly cap per patient across all gaps (a rolling 7 days of messages actually sent)
      select count(*) into v_sent_7d from public.care_gap_attempts a
       where a.patient_id = g.patient_id and a.result = 'sent' and a.attempted_at > p_now - interval '7 days';
      if v_sent_7d >= v_cap then
        if not exists (select 1 from public.care_gap_attempts a where a.gap_id = g.id and a.result = 'skipped_cap' and a.attempted_at > p_now - interval '1 day') then
          insert into public.care_gap_attempts (gap_id, organisation_id, patient_id, attempted_at, step, channel, result)
          values (g.id, g.organisation_id, g.patient_id, p_now, v_step, v_channel::text, 'skipped_cap');
        end if;
        update public.care_gaps set next_attempt_due_at = p_now + interval '1 day' where id = g.id;
        v_capped := v_capped + 1;
        continue;
      end if;

      v_copy := private.care_gap_variant(v_cfg, g.id, 'copy_variant');
      v_variant := jsonb_strip_nulls(jsonb_build_object('copy_variant', v_copy, 'send_hour', v_hour));
      v_template := case when v_step = 'email' then coalesce(v_cfg #>> '{notifications,template_followup}', 'care_gap_checkin_followup')
                         else coalesce(v_cfg #>> '{notifications,template_first}', 'care_gap_checkin') end;
      -- The attempt row is written FIRST, keyed on (gap, step, week): a run that lost the race finds it already there, sends nothing and is not a failure.
      v_att := null;
      insert into public.care_gap_attempts (gap_id, organisation_id, patient_id, attempted_at, step, channel, result, variant, week_start)
      values (g.id, g.organisation_id, g.patient_id, p_now, v_step, v_channel::text, 'sent', nullif(v_variant, '{}'::jsonb), v_week)
      on conflict (gap_id, step, week_start) where result = 'sent' do nothing
      returning id into v_att;
      if v_att is null then v_dupes := v_dupes + 1; continue; end if;
      -- INV-07: the payload carries the copy variant only. No condition, reading, result, medicine or gap type.
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, source_table, source_id)
      values (g.organisation_id, g.patient_id, v_channel, 'pending', v_template,
              jsonb_build_object('copy_variant', coalesce(v_copy #>> '{}', 'a')), 'care_gaps', g.id)
      returning id into v_nid;
      update public.care_gap_attempts set notification_id = v_nid where id = v_att;
      update public.care_gaps set ladder_step = v_i + 1, attempt_count = attempt_count + 1,
             next_attempt_due_at = p_now + make_interval(days => coalesce((v_cfg #>> '{ladder,days_between_steps}')::integer, 3))
       where id = g.id;
      v_sent := v_sent + 1;
    exception
      when query_canceled then v_timed_out := true;
      when others then
        v_failed := v_failed + 1;
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (g.organisation_id, 'care_gap_engine.error_outreach', 'care_gap', g.id, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
    exit when v_timed_out;
  end loop;
  end if;

  if v_failed > 0 or v_timed_out then
    perform private.care_gap_incident('care-gap-engine-failing',
      format('%s care gap outreach step(s) failed in the last run%s; see audit_log actions care_gap_engine.error_outreach and error_close. Those patients were not contacted.', v_failed,
             case when v_timed_out then ' (it also ran out of time and stopped early)' else '' end));
  end if;
  return jsonb_build_object('sent', v_sent, 'capped', v_capped, 'tasks', v_tasks, 'closed', v_closed, 'failed', v_failed, 'duplicates', v_dupes, 'unjudged', v_unjudged,
                            'promoted', v_promoted, 'timed_out', v_timed_out);
end $$;
revoke all on function private.care_gap_outreach_run(timestamptz) from public, anon, authenticated;

select cron.schedule('care-gap-evaluate', '50 5 * * *', $$ select private.care_gap_evaluate(); $$);
select cron.schedule('care-gap-outreach', '20 * * * *', $$ select private.care_gap_outreach_run(); $$);

-- ---------------------------------------------------------------------------
-- 8. Staff actions: log a contact attempt, close with a recorded reason
-- ---------------------------------------------------------------------------
create function public.log_care_gap_attempt(p_gap uuid, p_result text, p_note text, p_next_in_days integer default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny();
  g public.care_gaps%rowtype;
  v_days integer;
begin
  if p_result not in ('call_reached', 'call_no_answer', 'message_left') then raise exception 'unknown attempt result' using errcode = '22023'; end if;
  if p_note is null or length(btrim(p_note)) = 0 then raise exception 'say what happened in a sentence' using errcode = '22023'; end if;
  select * into g from public.care_gaps where id = p_gap and status = 'open';
  -- the same answer for a gap that does not exist and one the caller may not see
  if not found or not private.care_gap_visible(g.organisation_id, g.patient_id, g.owner_id) then
    raise exception 'care gap not found' using errcode = '42501';
  end if;
  v_days := greatest(1, least(coalesce(p_next_in_days, (select (e.cfg #>> '{ladder,coordinator_followup_days}')::integer from private.care_gap_effective_config() e), 3), 30));
  insert into public.care_gap_attempts (gap_id, organisation_id, patient_id, step, channel, result, actor_id, note)
  values (g.id, g.organisation_id, g.patient_id, 'staff_call', 'call', p_result, v_uid, btrim(p_note));
  update public.care_gaps set attempt_count = attempt_count + 1, next_attempt_due_at = now() + make_interval(days => v_days) where id = g.id;
  -- the existing per-patient call log (the coordinator contact log) keeps the same entry
  insert into public.care_outreach_contacts (organisation_id, patient_id, task_id, channel, note, contacted_by)
  values (g.organisation_id, g.patient_id, g.outreach_task_id, 'call', btrim(p_note), v_uid);
end $$;
revoke all on function public.log_care_gap_attempt(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.log_care_gap_attempt(uuid, text, text, integer) to authenticated;

-- A person closes a gap as declined, unreachable or wrong. 'closed' is never a manual choice: it needs a recorded outcome signal.
create function public.close_care_gap_manual(p_gap uuid, p_reason text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny();
  g public.care_gaps%rowtype;
  v_need integer; v_have integer;
begin
  if p_reason not in ('declined', 'unreachable', 'wrong') then raise exception 'a gap closes as closed only on a recorded outcome; choose declined, unreachable or wrong' using errcode = '22023'; end if;
  if p_note is null or length(btrim(p_note)) < 5 then raise exception 'say why in a sentence' using errcode = '22023'; end if;
  select * into g from public.care_gaps where id = p_gap and status = 'open';
  if not found or not private.care_gap_visible(g.organisation_id, g.patient_id, g.owner_id) then
    raise exception 'care gap not found' using errcode = '42501';
  end if;
  if p_reason = 'unreachable' then
    v_need := coalesce((select (e.cfg #>> '{ladder,unreachable_after_staff_attempts}')::integer from private.care_gap_effective_config() e), 2);
    select count(*) into v_have from public.care_gap_attempts a
     where a.gap_id = g.id and a.actor_id is not null and a.result in ('call_no_answer', 'message_left');
    if v_have < v_need then
      raise exception 'log % unanswered staff attempt(s) before marking a gap unreachable (% logged)', v_need, v_have using errcode = '22023';
    end if;
  end if;
  update public.care_gaps
     set status = 'closed', closure_reason = p_reason, closed_at = now(), closed_by = v_uid, closure_note = btrim(p_note), next_attempt_due_at = null
   where id = g.id and status = 'open';
  update public.care_outreach_tasks t set status = 'resolved', outcome_note = coalesce(t.outcome_note, 'Care gap closed as ' || p_reason || '.')
   where t.id = g.outreach_task_id and t.status in ('open', 'in_progress', 'contacted')
     and not exists (select 1 from public.care_gaps o where o.outreach_task_id = t.id and o.status = 'open' and o.id <> g.id);
end $$;
revoke all on function public.close_care_gap_manual(uuid, text, text) from public, anon, authenticated;
grant execute on function public.close_care_gap_manual(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Institutions: counts of people by gap type, from the real ledger, through the single minimum-cell rule
-- ---------------------------------------------------------------------------
-- Service role only (the I9 doorway in apps/web/src/lib/institutions/aggregate-access.ts). Distinct PEOPLE, never rows: a person with two gaps counts once
-- per type. Live (not shadow) gaps of real accounts only. The whole grid is computed and published (or withheld) first; a filter only SELECTS cells that are
-- already published, so two calls with different filters can never be subtracted to reveal a withheld cell. The "any open gap" total is withheld whenever any
-- type cell is withheld, because the types overlap and a total beside withheld cells is a way back to them.
-- "Closed" means closed BY A RECORDED OUTCOME (closure_reason = 'closed'): a gap a person closed as declined, unreachable or wrong, or the system closed as
-- superseded, is not a success and is never counted as one. The people who closed another way are counted apart, by reason (declined, unreachable, wrong); the
-- by-reason grid is a second complementary-suppressed grid and its total is withheld whenever any of its cells is.
create function private.care_gap_publish_cells(p_cells jsonb, p_floor integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_in jsonb; v_out jsonb;
begin
  -- zero is shown as zero; a positive count goes through the single minimum-cell rule with complementary suppression
  select coalesce(jsonb_agg(c), '[]'::jsonb) into v_in from jsonb_array_elements(p_cells) c where (c ->> 'n')::bigint > 0;
  v_out := private.suppress_groups(v_in, p_floor);
  return coalesce((
    select jsonb_agg(
             case when (c ->> 'n')::bigint = 0 then jsonb_build_object('key', c ->> 'key', 'n', 0, 'suppressed', false, 'reason', null)
                  else (select jsonb_build_object('key', o ->> 'key',
                                                  'n', case when (o ->> 'suppressed')::boolean then null else (o ->> 'n')::bigint end,
                                                  'suppressed', (o ->> 'suppressed')::boolean, 'reason', o ->> 'reason')
                          from jsonb_array_elements(v_out) o where o ->> 'key' = c ->> 'key') end
             order by c ->> 'key')
      from jsonb_array_elements(p_cells) c), '[]'::jsonb);
end $$;
revoke all on function private.care_gap_publish_cells(jsonb, integer) from public, anon, authenticated;

create function public.care_gap_institution_summary(p_org uuid, p_gap_types text[] default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_floor integer; v_org_floor integer;
  v_types constant text[] := array['missed_reading', 'no_hba1c_12_months', 'no_lipids_12_months', 'rising_bp_trend', 'medication_refill_lapse', 'adherence_lapse'];
  v_reasons constant text[] := array['closed', 'declined', 'unreachable', 'wrong'];
  t text; v_n bigint;
  v_open jsonb := '[]'::jsonb; v_closed jsonb := '[]'::jsonb; v_reason jsonb := '[]'::jsonb;
  v_any bigint; v_any_closed bigint; v_any_reason bigint;
  v_since timestamptz := now() - interval '90 days';
begin
  select min_cohort_size into v_org_floor from public.organisations where id = p_org;
  if not found then raise exception 'organisation not found' using errcode = 'P0002'; end if;
  v_floor := private.min_cell_floor(v_org_floor);
  if not (private.go_live_guard_on('care_gap_engine_enabled') and coalesce((select e.is_signed from private.care_gap_effective_config() e), false)) then
    return jsonb_build_object('live', false, 'reason', 'engine_not_live', 'min_cell', v_floor);
  end if;

  foreach t in array v_types loop
    select count(distinct patient_id) into v_n from public.care_gaps where organisation_id = p_org and status = 'open' and not shadow and not is_test and gap_type = t;
    v_open := v_open || jsonb_build_object('key', t, 'n', v_n);
    -- closed = a recorded outcome only
    select count(distinct patient_id) into v_n from public.care_gaps
     where organisation_id = p_org and status = 'closed' and closure_reason = 'closed' and not shadow and not is_test and gap_type = t and closed_at >= v_since;
    v_closed := v_closed || jsonb_build_object('key', t, 'n', v_n);
  end loop;
  foreach t in array v_reasons loop
    select count(distinct patient_id) into v_n from public.care_gaps
     where organisation_id = p_org and status = 'closed' and not shadow and not is_test and closure_reason = t and closed_at >= v_since;
    v_reason := v_reason || jsonb_build_object('key', t, 'n', v_n);
  end loop;
  v_open := private.care_gap_publish_cells(v_open, v_floor);
  v_closed := private.care_gap_publish_cells(v_closed, v_floor);
  v_reason := private.care_gap_publish_cells(v_reason, v_floor);

  select count(distinct patient_id) into v_any from public.care_gaps where organisation_id = p_org and status = 'open' and not shadow and not is_test;
  select count(distinct patient_id) into v_any_closed from public.care_gaps
   where organisation_id = p_org and status = 'closed' and closure_reason = 'closed' and not shadow and not is_test and closed_at >= v_since;
  select count(distinct patient_id) into v_any_reason from public.care_gaps
   where organisation_id = p_org and status = 'closed' and closure_reason = any (v_reasons) and not shadow and not is_test and closed_at >= v_since;

  return jsonb_build_object(
    'live', true, 'min_cell', v_floor,
    'open', jsonb_build_object(
      -- a filter only SELECTS published cells (never recomputes)
      'by_type', (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(v_open) c where p_gap_types is null or c ->> 'key' = any (p_gap_types)),
      'any_people', case when not exists (select 1 from jsonb_array_elements(v_open) c where (c ->> 'suppressed')::boolean)
                          and private.suppress_cell(v_any, null, v_floor) is null then to_jsonb(v_any) end),
    'closed_90d', jsonb_build_object(
      'by_type', (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(v_closed) c where p_gap_types is null or c ->> 'key' = any (p_gap_types)),
      'any_people', case when not exists (select 1 from jsonb_array_elements(v_closed) c where (c ->> 'suppressed')::boolean)
                          and not exists (select 1 from jsonb_array_elements(v_reason) c where (c ->> 'suppressed')::boolean)
                          and private.suppress_cell(v_any_closed, null, v_floor) is null then to_jsonb(v_any_closed) end,
      'by_reason', v_reason,
      'any_reason_people', case when not exists (select 1 from jsonb_array_elements(v_reason) c where (c ->> 'suppressed')::boolean)
                                 and private.suppress_cell(v_any_reason, null, v_floor) is null then to_jsonb(v_any_reason) end));
end $$;
revoke all on function public.care_gap_institution_summary(uuid, text[]) from public, anon, authenticated;
grant execute on function public.care_gap_institution_summary(uuid, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Neutral templates (INV-07). Post-merge step: redeploy send-pending-notifications (the renderers are in source).
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, description) values
  ('care_gap_checkin', 'operational', 'routine', 'patient', array['push', 'in_app']::public.notification_channel[], 'Something small is waiting in the app. Names nothing.'),
  ('care_gap_checkin_followup', 'operational', 'routine', 'patient', array['email']::public.notification_channel[], 'One gentle follow-up that the same small step is still waiting. Names nothing.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('care_gap_checkin', 'en', 'in_app', null, 'Something small is waiting for you in the app. Open it when you have a minute'),
  ('care_gap_checkin', 'en', 'push', null, 'Something small is waiting for you in the app'),
  ('care_gap_checkin_followup', 'en', 'email', 'A small step is waiting for you', 'Your care team left a short step for you in the Tarragon Health app. It takes a minute or two.')
on conflict (template_key, locale, channel) do nothing;

-- ---------------------------------------------------------------------------
-- 11. The migration proves what it claims (no row counts: this also runs on an empty replay database)
-- ---------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  if exists (select 1 from public.care_gap_rule_config where is_active or approved_at is not null) then raise exception 'S90: a care gap rule config was born signed or active'; end if;
  if exists (select 1 from public.go_live_guards where key = 'care_gap_engine_enabled' and is_on) then raise exception 'S90: the guard was born on'; end if;
  if jsonb_array_length(private.go_live_conditions('care_gap_engine_enabled', null)) <> 2 then raise exception 'S90: the guard has no conditions'; end if;
  if has_table_privilege('anon', 'public.care_gaps', 'SELECT') or has_table_privilege('authenticated', 'public.care_gaps', 'INSERT')
     or has_table_privilege('authenticated', 'public.care_gaps', 'UPDATE') or has_table_privilege('authenticated', 'public.care_gaps', 'DELETE')
     or has_table_privilege('anon', 'public.care_gap_attempts', 'SELECT') or has_table_privilege('authenticated', 'public.care_gap_attempts', 'INSERT')
     or has_table_privilege('authenticated', 'public.care_gap_attempts', 'UPDATE') or has_table_privilege('authenticated', 'public.care_gap_attempts', 'DELETE') then
    raise exception 'S90: wrong table privileges on care_gaps or care_gap_attempts';
  end if;
  foreach v_fn in array array['public.sign_care_gap_rule_config(integer)', 'public.log_care_gap_attempt(uuid,text,text,integer)', 'public.close_care_gap_manual(uuid,text,text)',
                              'public.care_gap_institution_summary(uuid,text[])', 'private.care_gap_evaluate(timestamptz)', 'private.care_gap_outreach_run(timestamptz)',
                              'private.care_gap_close_resolved(timestamptz,jsonb,boolean)', 'private.care_gap_pick_owner(uuid,uuid,text,timestamptz)',
                              'private.care_gap_close_with_signal(public.care_gaps,jsonb,timestamptz)', 'private.care_gap_scoped_adherence(uuid,timestamptz,jsonb)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S90: anon can execute %', v_fn; end if;
  end loop;
  foreach v_fn in array array['private.care_gap_evaluate(timestamptz)', 'private.care_gap_outreach_run(timestamptz)', 'public.care_gap_institution_summary(uuid,text[])',
                              'private.care_gap_close_resolved(timestamptz,jsonb,boolean)'] loop
    if has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S90: authenticated can execute %', v_fn; end if;
  end loop;
  if not exists (select 1 from cron.job where jobname = 'care-gap-evaluate') or not exists (select 1 from cron.job where jobname = 'care-gap-outreach') then
    raise exception 'S90: the care gap jobs are not scheduled';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'care_gap_attempts_one_send_per_week') then
    raise exception 'S90: the one-send-per-week key is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.care_gaps'::regclass and tgname = 'care_gaps_owner_guard' and not tgisinternal) then
    raise exception 'S90: the owner guard is missing';
  end if;
end $$;
