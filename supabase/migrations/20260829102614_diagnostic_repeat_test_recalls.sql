-- Tarragon Health — Diagnostic Safety Pathway, part 4/6: repeat
-- investigation / recall tracking (60.10).
--
-- "If repeat testing is needed: abnormal result -> repeat in N weeks ->
-- recall created -> patient notified -> test -> compare -> clinical
-- decision." No generic repeat-test/recall engine exists today — only two
-- narrow domain-specific analogues (exposure_retest_rules for STI/
-- needlestick exposure, diabetes_blood_sugar_recheck_cadence) confirmed by
-- a full audit before writing this. A diagnostic_episode can need more than
-- one repeat cycle over time (still abnormal -> repeat again), so this is a
-- one-to-many table keyed to diagnostic_episodes, not flat columns on the
-- episode itself.

create type public.diagnostic_recall_status as enum (
  'pending', 'patient_notified', 'completed', 'cancelled'
);

create table public.diagnostic_repeat_test_recalls (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  diagnostic_episode_id       uuid not null references public.diagnostic_episodes (id) on delete cascade,
  screen_type_id              uuid references public.screen_types (id) on delete set null,
  due_date                    date not null,
  status                      public.diagnostic_recall_status not null default 'pending',
  ordered_by                  uuid references public.clinical_staff (id) on delete restrict,
  ordered_at                  timestamptz not null default now(),
  patient_notified_at         timestamptz,
  result_screening_result_id  uuid references public.screening_results (id) on delete set null,
  comparison_note             text,
  clinical_decision           text,
  cancelled_reason            text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on table public.diagnostic_repeat_test_recalls is
  '60.10: one row per repeat-investigation cycle an episode needs (an episode can need more than one over time, e.g. still abnormal -> repeat again). status advances pending -> patient_notified -> completed (result_screening_result_id set) or cancelled. Read by the diagnostic-safety dashboard''s "pending repeat tests" count and by private.escalate_diagnostic_follow_up_non_completion() (part 5) for overdue detection.';

create index diagnostic_repeat_test_recalls_episode_idx on public.diagnostic_repeat_test_recalls (diagnostic_episode_id);
create index diagnostic_repeat_test_recalls_patient_idx on public.diagnostic_repeat_test_recalls (patient_id);
create index diagnostic_repeat_test_recalls_pending_idx
  on public.diagnostic_repeat_test_recalls (organisation_id, due_date)
  where status in ('pending', 'patient_notified');

create trigger diagnostic_repeat_test_recalls_set_updated_at
  before update on public.diagnostic_repeat_test_recalls
  for each row execute function private.set_updated_at();

alter table public.diagnostic_repeat_test_recalls enable row level security;

create policy diagnostic_repeat_test_recalls_select on public.diagnostic_repeat_test_recalls
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy diagnostic_repeat_test_recalls_insert on public.diagnostic_repeat_test_recalls
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy diagnostic_repeat_test_recalls_update on public.diagnostic_repeat_test_recalls
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.diagnostic_repeat_test_recalls to authenticated;

-- ---------------------------------------------------------------------------
-- ordered_by is server-derived, never client-settable (same posture as
-- every other clinical-staff attribution column in this codebase). A recall
-- moving to completed always carries a result_screening_result_id (the
-- reverse — a result being attached always completes the recall) is
-- enforced by a CHECK below rather than inferred, so either write order
-- (set the result then the status, or the status then the result in the
-- same statement) works and stays consistent.
-- ---------------------------------------------------------------------------
create or replace function private.stamp_diagnostic_recall_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if tg_op = 'INSERT' then
    -- organisation_id/patient_id are never trusted from the client — always
    -- derived from the episode being recalled, so a recall can never be
    -- mis-filed against the wrong patient/org even if the insert supplied
    -- something else. Must happen BEFORE the clinical_staff lookup below,
    -- which keys off new.organisation_id.
    select organisation_id, patient_id into new.organisation_id, new.patient_id
      from public.diagnostic_episodes where id = new.diagnostic_episode_id;
    if new.organisation_id is null then
      raise exception 'diagnostic_episode_id % does not reference a real diagnostic_episodes row', new.diagnostic_episode_id;
    end if;
  end if;

  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active;

  if tg_op = 'INSERT' then
    new.ordered_by := coalesce(v_staff_id, new.ordered_by);

    -- Opening a recall is the clinician's decision that a repeat test is
    -- needed — reflect that on the parent episode immediately, not only
    -- once the recall completes.
    update public.diagnostic_episodes
      set requires_repeat_test = true,
          repeat_test_due_date = new.due_date,
          -- A fresh recall means the last cycle's completion (if any) no
          -- longer satisfies closure — a still-abnormal repeat that itself
          -- needed a further repeat must not leave a stale "done" stamp.
          repeat_test_completed_at = null,
          repeat_test_result_id = null
      where id = new.diagnostic_episode_id;
    return new;
  end if;

  -- UPDATE: result attached -> always completed; explicit 'completed'
  -- status change without a result is rejected below by the CHECK.
  if new.result_screening_result_id is not null and old.result_screening_result_id is null then
    new.status := 'completed';
  end if;

  return new;
end;
$$;

create trigger diagnostic_repeat_test_recalls_stamp_lifecycle
  before insert or update on public.diagnostic_repeat_test_recalls
  for each row execute function private.stamp_diagnostic_recall_lifecycle();

alter table public.diagnostic_repeat_test_recalls
  add constraint diagnostic_repeat_test_recalls_completed_requires_result
  check (status <> 'completed' or result_screening_result_id is not null);

-- Sync the completion back onto the parent episode (AFTER, so it reads the
-- already-committed row) — most recent completed recall wins if an episode
-- has needed more than one cycle.
create or replace function private.sync_diagnostic_episode_from_recall()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.diagnostic_episodes
      set repeat_test_completed_at = now(),
          repeat_test_result_id = new.result_screening_result_id
      where id = new.diagnostic_episode_id;
  end if;
  return new;
end;
$$;

comment on function private.sync_diagnostic_episode_from_recall() is
  '60.10: mirrors a diagnostic_repeat_test_recalls row reaching completed onto its parent diagnostic_episodes.repeat_test_completed_at/repeat_test_result_id, so the closure checklist (part 2) can see it without a subquery. The most recently completed recall wins if an episode needed more than one repeat cycle.';

revoke all on function private.sync_diagnostic_episode_from_recall() from public, anon;

create trigger diagnostic_repeat_test_recalls_sync_episode
  after update of status on public.diagnostic_repeat_test_recalls
  for each row execute function private.sync_diagnostic_episode_from_recall();

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'diagnostic_repeat_test_recalls') then
    raise exception 'diagnostic_repeat_test_recalls was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'diagnostic_repeat_test_recalls_sync_episode'
      and tgrelid = 'public.diagnostic_repeat_test_recalls'::regclass and not tgisinternal
  ) then
    raise exception 'diagnostic_repeat_test_recalls_sync_episode trigger was not created';
  end if;
  raise notice 'PASS: diagnostic_repeat_test_recalls table + lifecycle + episode-sync triggers installed';
end $$;
