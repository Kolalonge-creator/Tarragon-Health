-- Sexual & Reproductive Health platform, 3/8: the positive-result pathway
-- (spec §47.5) and partner notification (spec §47.6).
--
-- WHY A NEW TABLE, NOT A REUSE OF care_plans/screening_upgrades
-- ---------------------------------------------------------------------------
-- A positive HIV/Hep B/Hep C result already has a real, working lifecycle:
-- advance_serology_status() (20260802212314) moves profiles.hiv_status etc.
-- to a terminal state and raises a doctor-review alert. That is right for a
-- lifelong/chronic serology finding, but wrong for chlamydia, gonorrhoea and
-- syphilis, which are CURABLE: they need antibiotic treatment tracking, a
-- re-screen date, and — the one thing nothing on this platform tracks today —
-- a partner-notification workflow. care_plans (hypertension/diabetes/etc,
-- see public.care_plan_condition) doesn't fit either: its whole shape is a
-- chronic, ongoing management plan, not "one course of treatment, then
-- close". So this is a genuinely new, narrow lifecycle — not a parallel
-- generic case/pathway table (the codebase has deliberately never built one;
-- see the per-domain bespoke-table convention throughout this schema).
--
-- Result received -> Clinical review -> Patient communication -> Treatment
-- -> Follow-up, exactly the flow in §47.5, mapped onto real columns:
--   result_received      the trigger's own insert (unconditional)
--   clinical_review       reviewed_by/reviewed_at (null-gated, real clinician)
--   patient_notified       patient_notified_at (doctor-delivered — this rides
--                          on the SAME sensitive-result suppression as HIV/hep,
--                          screen_types.sensitive is already true for both
--                          chlamydia_gonorrhoea and syphilis)
--   treatment_in_progress / treatment_completed   treated_by/treatment_*_at
--   declined_care / closed  terminal states
--
-- Only chlamydia_gonorrhoea and syphilis open an episode here — HIV/Hep B/C
-- keep their own dedicated serology state machine untouched.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'sti_case_status') then
    create type public.sti_case_status as enum (
      'result_received', 'clinical_review', 'patient_notified',
      'treatment_in_progress', 'treatment_completed', 'declined_care', 'closed'
    );
  end if;
end $$;

create table if not exists public.sti_case_episodes (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  screening_result_id   uuid not null references public.screening_results (id) on delete restrict,
  sti_code              text not null check (sti_code in ('chlamydia_gonorrhoea', 'syphilis')),
  status                public.sti_case_status not null default 'result_received',
  -- Null-gated clinician attribution throughout, same rule as ReviewedByDoctor
  -- everywhere else on the platform: no stage may claim a clinician acted
  -- without a real clinical_staff row behind it.
  reviewed_by           uuid references public.clinical_staff (id) on delete restrict,
  reviewed_at           timestamptz,
  patient_notified_at   timestamptz,
  treatment_notes       text,
  treated_by            uuid references public.clinical_staff (id) on delete restrict,
  treatment_started_at  timestamptz,
  treatment_completed_at timestamptz,
  -- Re-screen recommendation, not a test-of-cure: reinfection risk within
  -- ~3 months is the actual evidence-based reason to bring the patient back
  -- for chlamydia/gonorrhoea/syphilis, not confirming the antibiotic worked.
  follow_up_due_at      date,
  follow_up_completed_at timestamptz,
  declined_reason       text,
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (screening_result_id)
);

create index if not exists sti_case_episodes_patient_idx
  on public.sti_case_episodes (patient_id, created_at desc);
create index if not exists sti_case_episodes_open_idx
  on public.sti_case_episodes (organisation_id, status)
  where status not in ('closed', 'declined_care');
create index if not exists sti_case_episodes_follow_up_idx
  on public.sti_case_episodes (follow_up_due_at)
  where follow_up_due_at is not null and follow_up_completed_at is null;

comment on table public.sti_case_episodes is
  'Positive curable-STI (chlamydia/gonorrhoea, syphilis) orchestration state (spec §47.5) — result received through clinical review, doctor-delivered patient notification, treatment and a reinfection re-screen date. HIV/Hep B/C keep their own serology_status_transitions lifecycle; this table never covers them.';

drop trigger if exists sti_case_episodes_set_updated_at on public.sti_case_episodes;
create trigger sti_case_episodes_set_updated_at
  before update on public.sti_case_episodes
  for each row execute function private.set_updated_at();

alter table public.sti_case_episodes enable row level security;

-- Confidential by construction: patient + org staff only, no profile_access/
-- sponsor visibility (module-wide choice — see 20260829090700's header).
drop policy if exists sti_case_episodes_select on public.sti_case_episodes;
create policy sti_case_episodes_select on public.sti_case_episodes
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

-- No client insert policy — rows are opened only by the trigger below. Update
-- is gated to org staff; the BEFORE UPDATE trigger enforces the legal
-- transition ladder and derives clinician attribution server-side, so a
-- staff account with no real clinical_staff row (e.g. a Care Coordinator)
-- cannot move a case past clinical review.
drop policy if exists sti_case_episodes_update on public.sti_case_episodes;
create policy sti_case_episodes_update on public.sti_case_episodes
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, update on public.sti_case_episodes to authenticated;
revoke all on public.sti_case_episodes from anon;

-- ---------------------------------------------------------------------------
-- Open an episode when a curable-STI screening_results row comes back
-- abnormal/critical. A sibling trigger to advance_serology_status /
-- close_exposure_reports_on_result on the same table, not a rewrite of
-- either — same "layer another AFTER INSERT trigger" pattern this schema
-- already uses on screening_results.
-- ---------------------------------------------------------------------------
create or replace function private.open_sti_case_episode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.screen_type_code not in ('chlamydia_gonorrhoea', 'syphilis') then
    return new;
  end if;
  if new.result_status not in ('abnormal', 'critical') then
    return new;
  end if;

  insert into public.sti_case_episodes
    (organisation_id, patient_id, screening_result_id, sti_code)
  values (new.organisation_id, new.patient_id, new.id, new.screen_type_code)
  on conflict (screening_result_id) do nothing;

  return new;
exception
  -- Never let an episode-tracking failure block recording the clinical
  -- result itself — same discipline as close_exposure_reports_on_result.
  when others then
    return new;
end;
$$;

drop trigger if exists screening_results_open_sti_case_episode on public.screening_results;
create trigger screening_results_open_sti_case_episode
  after insert on public.screening_results
  for each row execute function private.open_sti_case_episode();

-- ---------------------------------------------------------------------------
-- Enforce the transition ladder + derive clinician attribution server-side.
-- Moving into clinical_review / treatment_in_progress / treatment_completed /
-- closed requires the caller to be backed by a real, active clinical_staff
-- row — a Care Coordinator (org staff, but non-clinical) cannot advance a
-- case past result_received, matching the platform-wide Care Coordinator
-- write-access boundary (never medications/escalation resolution/protocol
-- signing) even though no dedicated RLS helper exists for this specific
-- table.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_sti_case_episode_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  -- Immutable facts.
  new.organisation_id     := old.organisation_id;
  new.patient_id          := old.patient_id;
  new.screening_result_id := old.screening_result_id;
  new.sti_code            := old.sti_code;
  new.created_at          := old.created_at;

  if new.status = old.status then
    return new;
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = old.organisation_id
    and cs.active;

  if v_staff is null and new.status not in ('declined_care') then
    raise exception 'only an active clinical staff member may advance an STI case episode' using errcode = '42501';
  end if;

  case old.status
    when 'result_received' then
      if new.status not in ('clinical_review', 'declined_care') then
        raise exception 'illegal transition from result_received to %', new.status;
      end if;
    when 'clinical_review' then
      if new.status not in ('patient_notified', 'declined_care') then
        raise exception 'illegal transition from clinical_review to %', new.status;
      end if;
    when 'patient_notified' then
      if new.status not in ('treatment_in_progress', 'declined_care') then
        raise exception 'illegal transition from patient_notified to %', new.status;
      end if;
    when 'treatment_in_progress' then
      if new.status not in ('treatment_completed', 'declined_care') then
        raise exception 'illegal transition from treatment_in_progress to %', new.status;
      end if;
    when 'treatment_completed' then
      if new.status <> 'closed' then
        raise exception 'illegal transition from treatment_completed to %', new.status;
      end if;
    else
      raise exception '% is a terminal state', old.status;
  end case;

  if new.status = 'clinical_review' then
    new.reviewed_by := v_staff;
    new.reviewed_at := now();
  end if;

  if new.status = 'patient_notified' then
    new.patient_notified_at := now();
  end if;

  if new.status = 'treatment_in_progress' then
    new.treated_by := v_staff;
    new.treatment_started_at := now();
  end if;

  if new.status = 'treatment_completed' then
    new.treatment_completed_at := now();
    if new.follow_up_due_at is null then
      new.follow_up_due_at := (current_date + interval '90 days')::date;
    end if;
  end if;

  if new.status = 'closed' then
    new.closed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists sti_case_episodes_enforce_transition on public.sti_case_episodes;
create trigger sti_case_episodes_enforce_transition
  before update on public.sti_case_episodes
  for each row execute function private.enforce_sti_case_episode_transition();

-- ---------------------------------------------------------------------------
-- Follow-up (re-screen) reminder sweep — completes the §47.5 "Follow-up"
-- step. Reuses the existing care_management/overdue_task alert type rather
-- than inventing a new alert_type_code for one narrow reminder.
-- ---------------------------------------------------------------------------
create or replace function private.raise_sti_follow_up_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.raise_clinician_alert(
    e.organisation_id, e.patient_id, 'routine',
    'STI re-screen due',
    format('Follow-up re-screen for %s was due %s and has not been marked complete.',
      e.sti_code, to_char(e.follow_up_due_at, 'YYYY-MM-DD')),
    'care_management', 'overdue_task'
  )
  from public.sti_case_episodes e
  where e.follow_up_due_at is not null
    and e.follow_up_due_at <= current_date
    and e.follow_up_completed_at is null
    and e.status <> 'closed'
    and not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'overdue_task' and ca.patient_id = e.patient_id
        and ca.status in ('open', 'acknowledged') and ca.created_at > now() - interval '20 hours'
    );
end;
$$;

comment on function private.raise_sti_follow_up_alerts() is
  'Daily sweep: an sti_case_episodes row with a passed follow_up_due_at and no follow_up_completed_at raises a routine clinician_alerts row (8.1 overdue_task), same staleness-sweep pattern as the other alert generators.';

revoke all on function private.raise_sti_follow_up_alerts() from public, anon;

select cron.schedule('sti-follow-up-alerts', '50 3 * * *', $$select private.raise_sti_follow_up_alerts()$$);

-- ---------------------------------------------------------------------------
-- Partner notification (spec §47.6). Two methods only, both keeping the
-- patient's identity out of any message Tarragon itself might send:
--   self_notify         — the app hands the patient copy/template text to
--                          forward themselves; Tarragon sends nothing.
--   clinician_assisted   — the patient consents and gives contact details to
--                          the care team, who decide whether/how to contact
--                          the partner. There is no automated send to an
--                          unverified third party anywhere in this schema —
--                          a human is always in the loop for actual outbound
--                          contact, the same posture this platform takes for
--                          every other genuinely legally-sensitive workflow.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'partner_notification_method') then
    create type public.partner_notification_method as enum ('self_notify', 'clinician_assisted', 'declined');
  end if;
  if not exists (select 1 from pg_type where typname = 'partner_notification_status') then
    create type public.partner_notification_status as enum ('requested', 'contacted', 'could_not_reach', 'declined_by_care_team');
  end if;
end $$;

create table if not exists public.sti_partner_notifications (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  patient_id               uuid not null references public.profiles (id) on delete cascade,
  sti_case_episode_id      uuid not null references public.sti_case_episodes (id) on delete cascade,
  method                   public.partner_notification_method not null,
  -- The patient's own free-text label for the partner ("my partner", "Chidi")
  -- — never a requirement to identify anyone, and never surfaced outbound.
  partner_label            text,
  -- Only meaningful for clinician_assisted; staff-only in practice (the
  -- patient already knows their own partner's contact details).
  partner_contact          text,
  consent_given_at         timestamptz not null default now(),
  clinician_assisted_status public.partner_notification_status,
  clinician_assisted_notes text,
  created_by               uuid references public.profiles (id) on delete set null,
  created_at               timestamptz not null default now()
);

create index if not exists sti_partner_notifications_episode_idx
  on public.sti_partner_notifications (sti_case_episode_id);

comment on table public.sti_partner_notifications is
  'Patient-consented partner-notification record (spec §47.6). self_notify hands the patient template copy to send themselves (no Tarragon-originated message to a third party); clinician_assisted is staff-actioned, never automated. Confidential: patient + org staff only.';

alter table public.sti_partner_notifications enable row level security;

drop policy if exists sti_partner_notifications_select on public.sti_partner_notifications;
create policy sti_partner_notifications_select on public.sti_partner_notifications
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists sti_partner_notifications_insert on public.sti_partner_notifications;
create policy sti_partner_notifications_insert on public.sti_partner_notifications
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and organisation_id = private.current_org_id()
    and exists (
      select 1 from public.sti_case_episodes e
      where e.id = sti_case_episode_id and e.patient_id = (select auth.uid())
    )
  );

drop policy if exists sti_partner_notifications_staff_update on public.sti_partner_notifications;
create policy sti_partner_notifications_staff_update on public.sti_partner_notifications
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.sti_partner_notifications to authenticated;
revoke all on public.sti_partner_notifications from anon;

-- ---------------------------------------------------------------------------
-- Optional specialist referral link (e.g. ongoing/recurrent-case referral to
-- genitourinary medicine) — a plain nullable FK onto the existing referral
-- primitive, not a new matching engine.
-- ---------------------------------------------------------------------------
do $$ begin
  alter type public.specialist_type add value if not exists 'genitourinary_medicine';
exception when duplicate_object then null; end $$;

alter table public.specialist_referrals
  add column if not exists sti_case_episode_id uuid references public.sti_case_episodes (id) on delete set null;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'sti_case_episodes') then
    raise exception 'FAIL: sti_case_episodes was not created';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'screening_results_open_sti_case_episode' and tgrelid = 'public.screening_results'::regclass and not tgisinternal) then
    raise exception 'FAIL: screening_results_open_sti_case_episode trigger was not created';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'sti_case_episodes_enforce_transition' and tgrelid = 'public.sti_case_episodes'::regclass and not tgisinternal) then
    raise exception 'FAIL: sti_case_episodes_enforce_transition trigger was not created';
  end if;
  if not exists (select 1 from cron.job where jobname = 'sti-follow-up-alerts') then
    raise exception 'FAIL: sti-follow-up-alerts cron job was not scheduled';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'sti_partner_notifications') then
    raise exception 'FAIL: sti_partner_notifications was not created';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sti_case_episodes' and cmd = 'INSERT'
  ) then
    raise exception 'FAIL: sti_case_episodes must have no client-facing INSERT policy (trigger-opened only)';
  end if;
  raise notice 'PASS: sti_case_episodes + partner notification pathway installed';
end $$;
