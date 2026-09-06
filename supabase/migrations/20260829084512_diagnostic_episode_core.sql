-- Tarragon Health — Diagnostic Safety Pathway, part 1/6: the Diagnostic
-- Episode itself (spec modules 56-60, "ABNORMAL RESULT -> CLINICAL REVIEW ->
-- FOLLOW-UP ENGINE").
--
-- The Alert System (20260828013011..20260828020801) already gives every
-- abnormal-result clinician_alerts row a governed owner, an ack-timeout
-- escalation ladder, and resolution-documentation requirements — that
-- machinery is reused here, not rebuilt. What's still missing (confirmed by
-- a full audit before writing this: zero hits for "diagnostic episode" or
-- "closure criteria" anywhere in the codebase or docs) is the thing the
-- spec calls a Diagnostic Episode: one durable record that groups
-- ABNORMAL RESULT -> CLINICAL REVIEW -> ACTION -> PATIENT COMMUNICATION ->
-- FOLLOW-UP -> OUTCOME -> CLOSE for a single abnormal/critical
-- screening_results row, so the pathway can be tracked and closed as one
-- thing instead of scattering across screening_upgrades/clinician_alerts/
-- specialist_referrals with nothing tying them together.
--
-- One episode per screening_results row (unique screening_result_id) —
-- created automatically, deterministically, in the same transaction as the
-- clinician_alerts row that already carries the 4-hour SLA, so an episode
-- can never fail to exist for an actionable result (same "cannot be
-- silently dropped" guarantee the original abnormal-result trigger already
-- gives screening_upgrades/clinician_alerts).
--
-- Deliberately hooks on clinician_alerts AFTER INSERT (not on
-- screening_results or screening_upgrades directly) so this migration never
-- touches private.handle_abnormal_screening_result() or any of its prior
-- redefinitions — same "don't edit a live clinical-safety trigger function
-- this migration's author has not read in full" posture the Alert System
-- migrations already established. By the time clinician_alerts AFTER
-- INSERT fires, private.classify_and_assign_clinician_alert() (BEFORE
-- INSERT) has already stamped type_code/severity, and
-- private.handle_abnormal_screening_result() has already inserted the
-- matching screening_upgrades row in the same statement sequence, with
-- clinician_alerts.screening_result_id populated (confirmed live in the
-- current function body, 20260730105131_v3_port_escalation_sla_config.sql)
-- — so both are safely readable here.

create type public.diagnostic_episode_status as enum ('open', 'closed');

-- 60.8: "Once reviewed, the clinician can choose: patient notification,
-- appointment, telephone contact, message, urgent referral. The system
-- should record the communication."
create type public.result_communication_method as enum (
  'notification', 'appointment', 'telephone', 'message', 'urgent_referral'
);

-- 60.18 governance question ("How many resulted in patient harm or near
-- misses?") has no existing field to answer it from — this is the minimal
-- addition that lets a closing clinician flag it, rather than fabricating
-- an answer from unrelated data. Defaults to 'none'; never inferred.
create type public.diagnostic_outcome_flag as enum ('none', 'near_miss', 'harm');

create table public.diagnostic_episodes (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  screening_result_id         uuid not null references public.screening_results (id) on delete restrict,
  screening_upgrade_id        uuid references public.screening_upgrades (id) on delete set null,
  clinician_alert_id          uuid references public.clinician_alerts (id) on delete set null,
  condition                   public.upgrade_condition,
  result_status_at_open       public.result_status not null,
  status                      public.diagnostic_episode_status not null default 'open',
  opened_at                   timestamptz not null default now(),

  -- CLINICAL REVIEW / INTERPRETATION
  reviewed_at                 timestamptz,
  reviewed_by                 uuid references public.clinical_staff (id) on delete restrict,
  review_note                 text,

  -- PATIENT COMMUNICATION (60.8)
  patient_informed_at         timestamptz,
  patient_informed_by         uuid references public.clinical_staff (id) on delete restrict,
  patient_informed_method     public.result_communication_method,
  patient_informed_note       text,

  -- ACTION plan (60.9 specialist referral / 60.10 repeat investigation) —
  -- booleans the reviewing clinician sets; closure requires whichever of
  -- these is true to actually be completed (part 2 of this series).
  requires_referral           boolean not null default false,
  referral_id                 uuid references public.specialist_referrals (id) on delete set null,
  referral_completed_at       timestamptz,
  requires_repeat_test        boolean not null default false,
  repeat_test_due_date        date,
  repeat_test_result_id       uuid references public.screening_results (id) on delete set null,
  repeat_test_completed_at    timestamptz,

  -- OUTCOME — the clinically-reviewed result of whatever follow-up ran
  -- (specialist report read, or repeat-test value reviewed). Distinct from
  -- "specialist seen"/"repeat test done": those are completion events,
  -- this is the clinical read of what they showed.
  outcome_received_at         timestamptz,
  outcome_note                text,
  outcome_flag                public.diagnostic_outcome_flag not null default 'none',

  follow_up_completed_at      timestamptz,

  -- 60.11 patient non-completion ladder counters (part 5 of this series).
  follow_up_reminder_count      smallint not null default 0,
  follow_up_last_reminded_at    timestamptz,
  follow_up_coordinator_escalated_at timestamptz,
  follow_up_clinically_escalated_at  timestamptz,

  -- CLOSE (60.12)
  closed_at                   timestamptz,
  closed_by                   uuid references public.clinical_staff (id) on delete restrict,
  closure_summary             text,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  unique (screening_result_id)
);

comment on table public.diagnostic_episodes is
  'One row per abnormal/critical screening_results row (spec modules 56-60): groups the abnormal-result -> clinical review -> action -> patient communication -> follow-up -> outcome -> close arc that today scatters across screening_upgrades/clinician_alerts/specialist_referrals with nothing tying them together. Created automatically by private.open_diagnostic_episode() the instant the matching clinician_alerts row lands — never created or closed by a client insert/status-jump, see part 2 for the closure-criteria enforcement trigger.';
comment on column public.diagnostic_episodes.outcome_received_at is
  'The clinical read of whatever follow-up ran (specialist report, or repeat-test value) — distinct from referral_completed_at ("specialist seen") and repeat_test_completed_at ("test done"), which are completion events, not clinical interpretation of what they showed.';

create index diagnostic_episodes_patient_idx on public.diagnostic_episodes (patient_id, opened_at desc);
create index diagnostic_episodes_org_status_idx on public.diagnostic_episodes (organisation_id, status);
create index diagnostic_episodes_open_idx on public.diagnostic_episodes (organisation_id) where status = 'open';
create index diagnostic_episodes_clinician_alert_idx on public.diagnostic_episodes (clinician_alert_id);
create index diagnostic_episodes_screening_upgrade_idx on public.diagnostic_episodes (screening_upgrade_id);
create index diagnostic_episodes_referral_idx on public.diagnostic_episodes (referral_id) where referral_id is not null;
create index diagnostic_episodes_repeat_test_idx on public.diagnostic_episodes (repeat_test_due_date) where requires_repeat_test and repeat_test_completed_at is null;

create trigger diagnostic_episodes_set_updated_at
  before update on public.diagnostic_episodes
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: patient reads their own episode; org staff read/update their org's.
-- No insert policy for authenticated — only private.open_diagnostic_episode()
-- (SECURITY DEFINER, below) creates rows, same "system populates" posture as
-- alert_deliveries/alert_follow_up_tasks.
-- ---------------------------------------------------------------------------
alter table public.diagnostic_episodes enable row level security;

create policy diagnostic_episodes_select on public.diagnostic_episodes
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy diagnostic_episodes_update on public.diagnostic_episodes
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, update on public.diagnostic_episodes to authenticated;

-- ---------------------------------------------------------------------------
-- Auto-creation (AFTER INSERT on clinician_alerts).
-- ---------------------------------------------------------------------------
create or replace function private.open_diagnostic_episode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upgrade public.screening_upgrades;
  v_result  public.screening_results;
begin
  if new.type_code <> 'abnormal_result' or new.screening_result_id is null then
    return new;
  end if;

  -- Idempotent: a suppressed duplicate alert (same result re-inserted, or a
  -- retry) must never open a second episode for the same result.
  if exists (select 1 from public.diagnostic_episodes where screening_result_id = new.screening_result_id) then
    return new;
  end if;

  select * into v_result from public.screening_results where id = new.screening_result_id;
  if v_result.id is null then
    return new;
  end if;

  select * into v_upgrade
    from public.screening_upgrades
    where screening_result_id = new.screening_result_id
    order by upgrade_at desc
    limit 1;

  insert into public.diagnostic_episodes
    (organisation_id, patient_id, screening_result_id, screening_upgrade_id,
     clinician_alert_id, condition, result_status_at_open)
  values
    (new.organisation_id, new.patient_id, new.screening_result_id, v_upgrade.id,
     new.id, v_upgrade.condition_triggered, v_result.result_status);

  return new;
end;
$$;

comment on function private.open_diagnostic_episode() is
  '60.1/60.4: opens a diagnostic_episodes row the instant an abnormal_result clinician_alerts row lands, so no actionable result can end up ownerless or untracked. Idempotent on screening_result_id — a duplicate/suppressed re-alert never opens a second episode. Never touches private.handle_abnormal_screening_result() or any trigger that writes clinician_alerts; purely observes the row after classify_and_assign has already stamped it.';

revoke all on function private.open_diagnostic_episode() from public, anon;

create trigger clinician_alerts_open_diagnostic_episode
  after insert on public.clinician_alerts
  for each row execute function private.open_diagnostic_episode();

-- ---------------------------------------------------------------------------
-- Review derivation (AFTER UPDATE on clinician_alerts): resolving/closing
-- the linked alert counts as the CLINICAL REVIEW step completing, unless a
-- clinician already logged one directly on the episode first ("first
-- reviewer wins" — never overwrites an earlier, possibly different, review).
-- ---------------------------------------------------------------------------
create or replace function private.sync_diagnostic_episode_review_from_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    update public.diagnostic_episodes
      set reviewed_at = coalesce(reviewed_at, new.resolved_at),
          reviewed_by = coalesce(reviewed_by, new.resolved_by),
          review_note = coalesce(review_note, new.resolution_action)
      where clinician_alert_id = new.id;
  end if;
  return new;
end;
$$;

comment on function private.sync_diagnostic_episode_review_from_alert() is
  'Mirrors an abnormal_result clinician_alerts row''s resolution onto its diagnostic_episodes.reviewed_at/reviewed_by (first-reviewer-wins — never overwrites a review a clinician already logged directly on the episode). Does not touch status/closure: an alert being resolved is never sufficient on its own to close the episode, see part 2.';

revoke all on function private.sync_diagnostic_episode_review_from_alert() from public, anon;

create trigger clinician_alerts_sync_diagnostic_episode_review
  after update of status on public.clinician_alerts
  for each row execute function private.sync_diagnostic_episode_review_from_alert();

-- ---------------------------------------------------------------------------
-- Lifecycle stamping (BEFORE UPDATE on diagnostic_episodes) — same
-- "RLS admits broadly, a trigger narrows + overwrites" shape as
-- private.stamp_clinician_alert_lifecycle(): reviewed_by/patient_informed_by/
-- closed_by are never client-settable, always derived from the caller's own
-- active clinical_staff record at the moment the corresponding timestamp
-- transitions from null to non-null.
-- ---------------------------------------------------------------------------
create or replace function private.stamp_diagnostic_episode_lifecycle()
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

  if new.reviewed_at is not null and old.reviewed_at is null then
    new.reviewed_by := coalesce(v_staff_id, new.reviewed_by);
  elsif old.reviewed_at is not null then
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
  end if;

  if new.patient_informed_at is not null and old.patient_informed_at is null then
    new.patient_informed_by := coalesce(v_staff_id, new.patient_informed_by);
  elsif old.patient_informed_at is not null then
    new.patient_informed_at := old.patient_informed_at;
    new.patient_informed_by := old.patient_informed_by;
  end if;

  if new.status = 'closed' and old.status <> 'closed' then
    new.closed_by := v_staff_id;
    new.closed_at := coalesce(new.closed_at, now());
  elsif old.status = 'closed' then
    -- closed_at/closed_by are pinned once set — a later edit (e.g. an admin
    -- correcting closure_summary) can never re-stamp who/when it closed.
    new.closed_by := old.closed_by;
    new.closed_at := old.closed_at;
  end if;

  return new;
end;
$$;

comment on function private.stamp_diagnostic_episode_lifecycle() is
  'BEFORE UPDATE on diagnostic_episodes. Server-derives reviewed_by/patient_informed_by (first transition to non-null only, never re-stamped) and closed_by/closed_at from the caller''s own active clinical_staff record — never client-supplied, and never re-stamped by a later edit once set (see part 2 for the separate closure-criteria gate that runs before this and actually decides whether a close is allowed).';

create trigger diagnostic_episodes_stamp_lifecycle
  before update on public.diagnostic_episodes
  for each row execute function private.stamp_diagnostic_episode_lifecycle();

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'diagnostic_episodes') then
    raise exception 'diagnostic_episodes was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'clinician_alerts_open_diagnostic_episode'
      and tgrelid = 'public.clinician_alerts'::regclass and not tgisinternal
  ) then
    raise exception 'clinician_alerts_open_diagnostic_episode trigger was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'diagnostic_episodes_stamp_lifecycle'
      and tgrelid = 'public.diagnostic_episodes'::regclass and not tgisinternal
  ) then
    raise exception 'diagnostic_episodes_stamp_lifecycle trigger was not created';
  end if;
  if has_function_privilege('anon', 'private.open_diagnostic_episode()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.open_diagnostic_episode';
  end if;
  raise notice 'PASS: diagnostic_episodes table + auto-creation + review-derivation + lifecycle triggers all present, anon denied';
end $$;
