-- Tarragon Health — Support/admin "view as" (read-only shadow view)
--
-- Gap found in a 2026-09-18 admin/ops back-office maturity audit: there is no support/admin
-- tool anywhere on the platform to look at what a patient or clinician actually sees, to debug
-- a reported issue. The only "acting as someone else" mechanism that exists today,
-- apps/web/src/lib/acting/acting-for.ts, is the family-caregiver/elder-proxy consent flow — it
-- re-points which patient's data an already-consented supporter is viewing, still under their
-- own auth.uid(), and is structurally unrelated to a support-debugging tool (see that file's own
-- header). CLAUDE.md's `log_patient_record_view` precedent (20260812034612) logs a clinician
-- opening a patient they already have real RLS access to; it authorises nothing new. Neither
-- gives a non-clinical support/ops account, or an admin acting outside their own org, a real,
-- audited way to see an account's data.
--
-- Design, in order of the four things asked for:
--
-- 1. WHO — gated by a capability, not a new account role. Per CLAUDE.md's "Never re-split the
--    ACCOUNT role" rule, this is a new fine-grained permission key, 'support.view_as', on the
--    existing private.has_permission()/public.permissions rail (20260718230000_rbac_permissions),
--    exactly like every other delegated admin capability. `admin` holds it implicitly (every
--    capability); a non-admin needs it granted directly or via a custom role, same as any other
--    permission. No new profiles.role value, no orthogonal flag.
--
-- 2. AUDITED — every session is a real row in the new public.support_view_sessions table:
--    viewer, subject, mandatory reason, started_at/expires_at (server-derived, fixed 30-minute
--    window — not client-settable, same "time-boxed, not a mode to live in" posture as
--    acting-for's 2-hour cookie and emergency_access_grants' 24-hour window), and ended_at/
--    ended_by once it ends. The table carries the existing generic private.audit_row_change()
--    AFTER trigger (same mechanism as emergency_access_grants, care_messages, profiles, etc.) so
--    starting and ending a session lands in public.audit_log automatically — 'created'/'updated'
--    rows with actor, action, entity, changed columns, and a row hash. The mandatory reason is
--    surfaced into audit_log.reason via the same GUC pattern the reason/result migration
--    (20260829204722) already established (set_config('app.audit_reason', ...) before the write) —
--    reusing that exact mechanism rather than adding a second, redundant audit write. "For how
--    long" is answered by the row itself: started_at/ended_at are both permanent and immutable
--    once set (see the update-guard trigger below), so duration is always `ended_at - started_at`
--    without needing a separate stored column.
--
-- 3. NOTICE TO THE PATIENT — an AFTER INSERT trigger fires one in_app (never whatsapp/sms/email,
--    per the Non-Negotiable Business Rules and the existing I1 content_class backstop) notification
--    to the subject the moment a session starts, naming the viewer and the reason, same immediacy
--    as emergency_access_grants' notify-on-grant. NDPA note (flagging, not asserting compliance —
--    this needs founder/legal confirmation, not a guess): Nigeria's Data Protection Act 2023
--    requires lawful, transparent processing (s.24) and gives a data subject a right to be
--    informed how their data is processed (s.34), but — unlike GDPR's specific breach-notification
--    triggers — it does not spell out a specific "we tell you every time staff looked at your
--    account for support purposes" requirement the way this migration's notification satisfies.
--    Sending the notice anyway is the more transparent, patient-respecting default (and matches
--    this platform's existing emergency-access precedent), not a claim that NDPA specifically
--    mandates it.
--
-- 4. READ-ONLY, STRUCTURALLY — this migration adds exactly one new predicate,
--    private.can_support_view(subject_id), and it is appended ONLY to SELECT policies, never to
--    an INSERT/UPDATE/DELETE policy, on a small, explicitly bounded set of tables (see the block
--    below). A support session grants nothing else — no write path anywhere on the platform
--    consults this function. The admin-side page built on top of this (apps/web) is a dedicated
--    read-only summary view with no mutation server actions at all, not a wrapper around the
--    real patient/clinician dashboards (which would require auditing writes across ~110
--    patient-scoped tables platform-wide to keep safe — far outside what "debug a reported
--    issue" calls for). Never bypasses RLS via a service-role client: the read path is real RLS,
--    with one more OR-clause, same as every other additive access grant on this platform
--    (private.is_scoped_access_role() is exactly this codebase's own precedent for "additive,
--    narrowly-scoped, never widen is_org_staff itself").
--
-- Table scope for this pass — profiles, vitals_readings, medications, appointments,
-- screening_schedules, notifications, clinical_staff. Chosen as the read surface that actually
-- answers most reported "my dashboard looks wrong" issues (identity, recent vitals, current
-- meds, upcoming/past appointments, screening due dates, what they were actually notified, and —
-- for a clinician subject — their tier/credential/active status) without touching anything in the
-- reproductive-health family (reproductive_health_profiles, menstrual_cycles,
-- menstrual_daily_logs) or clinical messaging/results content. That exclusion is deliberate, not
-- an oversight: per CLAUDE.md, reproductive_health is a protected access category everywhere else
-- on the platform (private.has_emergency_access excludes it from break-glass; the 2026-09-05
-- platform audit found and closed a guardian-read gap on exactly these three tables) — a new,
-- broader support-debugging grant has no business touching it in a first pass. Extending coverage
-- to more tables later is additive (one more OR-clause per table, reusing the same function) —
-- this is not meant to be the final word on scope.

-- ---------------------------------------------------------------------------
-- 1. Permission catalogue entry.
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description) values
  (
    'support.view_as',
    'Support view-as (read-only)',
    'Operations',
    'Enter a time-boxed, read-only, audited shadow view of a specific patient''s or clinician''s '
    'account summary to debug a reported issue. Never grants write access.'
  )
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. public.support_view_sessions
-- ---------------------------------------------------------------------------
create table public.support_view_sessions (
  id                uuid primary key default gen_random_uuid(),
  viewer_id         uuid not null references public.profiles (id) on delete cascade,
  subject_id        uuid not null references public.profiles (id) on delete cascade,
  organisation_id   uuid references public.organisations (id) on delete set null,
  reason            text not null,
  started_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '30 minutes'),
  ended_at          timestamptz,
  ended_by          uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint support_view_sessions_no_self check (viewer_id <> subject_id),
  constraint support_view_sessions_reason_len check (char_length(btrim(reason)) between 3 and 500)
);

create index support_view_sessions_viewer_idx on public.support_view_sessions (viewer_id);
create index support_view_sessions_subject_idx on public.support_view_sessions (subject_id);
create index support_view_sessions_active_idx on public.support_view_sessions (subject_id, viewer_id, expires_at)
  where ended_at is null;

comment on table public.support_view_sessions is
  'A time-boxed (fixed 30-minute), audited, read-only support/admin "view as" session. '
  'private.can_support_view() consults only this table — an active row here is the sole '
  'authority behind the support.view_as read grant on the tables listed in '
  '20260918104500_support_view_as.sql. Never touch this table with a service-role client.';

-- ---------------------------------------------------------------------------
-- 3. BEFORE INSERT: authorise + re-derive server-controlled fields. Single source of truth —
--    the RLS insert policy below only checks "is this caller the viewer they claim to be";
--    everything else (permission, subject eligibility, reason, timing) is enforced here so a
--    direct table insert can never bypass a UI-layer check.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_support_view_session_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject_role public.user_role;
  v_subject_org  uuid;
begin
  if not private.has_permission('support.view_as') then
    raise exception 'You do not have permission to start a support view-as session'
      using errcode = '42501';
  end if;

  select role, organisation_id into v_subject_role, v_subject_org
  from public.profiles where id = new.subject_id;

  if v_subject_role is null then
    raise exception 'Support view-as subject not found' using errcode = '42501';
  end if;

  if v_subject_role not in ('patient', 'clinician') then
    raise exception 'Support view-as is only available for patient and clinician accounts'
      using errcode = '42501';
  end if;

  new.viewer_id := (select auth.uid());
  new.organisation_id := v_subject_org;
  new.started_at := now();
  new.expires_at := now() + interval '30 minutes';
  new.ended_at := null;
  new.ended_by := null;

  -- Surface the mandatory reason into audit_log.reason via the same GUC pattern
  -- 20260829204722_audit_log_reason_and_result.sql established — private.audit_row_change()
  -- (attached below) reads this in the same transaction.
  perform set_config('app.audit_reason', new.reason, true);

  return new;
end;
$$;

revoke all on function private.enforce_support_view_session_rules() from public;

drop trigger if exists support_view_sessions_enforce_rules on public.support_view_sessions;
create trigger support_view_sessions_enforce_rules
  before insert on public.support_view_sessions
  for each row execute function private.enforce_support_view_session_rules();

-- ---------------------------------------------------------------------------
-- 4. BEFORE UPDATE: the only legitimate change is ending a session — ended_at going from null to
--    now(), ended_by server-derived to the caller. Everything else about a session is immutable.
-- ---------------------------------------------------------------------------
create or replace function private.guard_support_view_session_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.viewer_id is distinct from old.viewer_id
    or new.subject_id is distinct from old.subject_id
    or new.organisation_id is distinct from old.organisation_id
    or new.reason is distinct from old.reason
    or new.started_at is distinct from old.started_at
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'Only ending a support view-as session (ended_at) is allowed once created';
  end if;

  if old.ended_at is not null then
    raise exception 'This support view-as session has already ended';
  end if;

  if new.ended_at is distinct from old.ended_at and new.ended_at is not null then
    new.ended_at := now();
    new.ended_by := (select auth.uid());
  end if;

  return new;
end;
$$;

revoke all on function private.guard_support_view_session_update() from public;

drop trigger if exists support_view_sessions_guard_update on public.support_view_sessions;
create trigger support_view_sessions_guard_update
  before update on public.support_view_sessions
  for each row execute function private.guard_support_view_session_update();

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table public.support_view_sessions enable row level security;

create policy support_view_sessions_select on public.support_view_sessions
  for select to authenticated
  using (
    viewer_id = (select auth.uid())
    or subject_id = (select auth.uid())
    or private.is_admin()
  );

create policy support_view_sessions_insert on public.support_view_sessions
  for insert to authenticated
  with check (viewer_id = (select auth.uid()));

-- Either the viewer, the subject (a patient/clinician can end being watched early), or an admin
-- may end an active session — same "protect the subject" symmetry as emergency_access_grants.
create policy support_view_sessions_end on public.support_view_sessions
  for update to authenticated
  using (
    viewer_id = (select auth.uid())
    or subject_id = (select auth.uid())
    or private.is_admin()
  )
  with check (
    viewer_id = (select auth.uid())
    or subject_id = (select auth.uid())
    or private.is_admin()
  );

grant select, insert, update on public.support_view_sessions to authenticated;

-- Same generic write-audit coverage as emergency_access_grants, care_messages, profiles, etc.
drop trigger if exists audit_row_change_trg on public.support_view_sessions;
create trigger audit_row_change_trg
  after insert or update on public.support_view_sessions
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- 6. Notify the subject the moment a session starts — see header's NDPA note.
-- ---------------------------------------------------------------------------
create or replace function private.notify_support_view_session_started()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_viewer_name text;
begin
  select full_name into v_viewer_name from public.profiles where id = new.viewer_id;

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    new.organisation_id,
    new.subject_id,
    'in_app',
    'pending',
    'support_view_as_started',
    jsonb_build_object(
      'session_id', new.id,
      'viewer_name', coalesce(v_viewer_name, 'A member of the Tarragon Health support team'),
      'reason', new.reason,
      'expires_at', new.expires_at
    ),
    'non_clinical'
  );

  return new;
end;
$$;

revoke all on function private.notify_support_view_session_started() from public;

drop trigger if exists support_view_sessions_notify_started on public.support_view_sessions;
create trigger support_view_sessions_notify_started
  after insert on public.support_view_sessions
  for each row execute function private.notify_support_view_session_started();

-- ---------------------------------------------------------------------------
-- 7. private.can_support_view() — the sole authority the SELECT policies below consult. An
--    active (unended, unexpired) session naming this caller as viewer and the row's subject.
-- ---------------------------------------------------------------------------
create or replace function private.can_support_view(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.support_view_sessions s
    where s.subject_id = p_subject_id
      and s.viewer_id = (select auth.uid())
      and s.ended_at is null
      and s.expires_at > now()
  );
$$;

revoke all on function private.can_support_view(uuid) from public;
grant execute on function private.can_support_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Subject search — a real gap, not a nicety: a delegated (non-admin) support.view_as
--    grantee outside the subject's organisation cannot read public.profiles at all until a
--    session already exists (private.can_support_view requires one), so they would have no
--    way to find WHO to start a session for. `admin` doesn't need this (private.is_admin()
--    already reads any profiles row), but a genuinely delegated grantee does. Same
--    established pattern this codebase already uses for exactly this shape of problem — see
--    profiles_select's own history (20260807112503_clinician_phone_admin_only_visibility.sql):
--    a narrow, name-only SECURITY DEFINER RPC instead of widening a row-level policy. Returns
--    only already-low-sensitivity identity fields (name/role/phone/patient number) — never
--    clinical data — and only to a caller who already holds the permission; it does not by
--    itself grant a read on anything else.
-- ---------------------------------------------------------------------------
create or replace function public.search_support_view_subjects(p_query text)
returns table (
  id               uuid,
  full_name        text,
  role             public.user_role,
  phone            text,
  organisation_id  uuid,
  patient_number   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.role, p.phone, p.organisation_id, p.patient_number
  from public.profiles p
  where private.has_permission('support.view_as')
    and p.role in ('patient', 'clinician')
    and p_query is not null
    and char_length(btrim(p_query)) >= 2
    and (
      p.full_name ilike '%' || p_query || '%'
      or p.phone ilike '%' || p_query || '%'
      or p.patient_number ilike '%' || p_query || '%'
    )
  order by p.full_name
  limit 20;
$$;

revoke all on function public.search_support_view_subjects(text) from public, anon;
grant execute on function public.search_support_view_subjects(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Extend the bounded read surface (see header) — one more OR-clause per policy, every other
--    clause copied byte-identical from each table's live definition so nothing else changes.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_admin()
    or (organisation_id is not null and private.is_org_staff(organisation_id))
    or (
      private.is_lab_liaison()
      and role = 'patient'
      and organisation_id is not null
      and organisation_id = private.current_org_id()
    )
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = profiles.id
        and pa.grantee_user_id = (select auth.uid())
    )
    or private.can_support_view(id)
  );

drop policy if exists vitals_readings_select on public.vitals_readings;
create policy vitals_readings_select on public.vitals_readings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'vitals_readings')
    or private.has_emergency_access(patient_id, 'vitals_readings')
    or private.can_support_view(patient_id)
  );

drop policy if exists medications_select on public.medications;
create policy medications_select on public.medications
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'medications'::public.care_access_category)
    or private.can_read_clinical(patient_id, 'view_medication'::public.caregiver_permission)
    or private.can_support_view(patient_id)
  );

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'view_appointments'::public.caregiver_permission)
    or private.can_support_view(patient_id)
  );

drop policy if exists screening_schedules_select on public.screening_schedules;
create policy screening_schedules_select on public.screening_schedules
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results')
    or private.has_emergency_access(patient_id, 'labs_results')
    or private.can_support_view(patient_id)
  );

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    recipient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_support_view(recipient_id)
  );

drop policy if exists clinical_staff_select on public.clinical_staff;
create policy clinical_staff_select on public.clinical_staff
  for select to authenticated
  using (
    organisation_id = private.current_org_id()
    or private.is_org_staff(organisation_id)
    or (profile_id is not null and private.can_support_view(profile_id))
  );

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'support_view_sessions'
  ) then
    raise exception 'FAIL: support_view_sessions table missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'support_view_sessions' and cmd = 'SELECT'
  ) then
    raise exception 'FAIL: support_view_sessions has no SELECT policy';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'support_view_sessions' and cmd = 'DELETE'
  ) then
    raise exception 'FAIL: support_view_sessions must never have a DELETE policy';
  end if;

  if has_function_privilege('anon', 'private.enforce_support_view_session_rules()', 'EXECUTE')
    or has_function_privilege('anon', 'private.guard_support_view_session_update()', 'EXECUTE')
    or has_function_privilege('anon', 'private.notify_support_view_session_started()', 'EXECUTE')
  then
    raise exception 'FAIL: anon can execute a support_view_sessions trigger function';
  end if;

  if has_function_privilege('anon', 'private.can_support_view(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.can_support_view';
  end if;

  if not has_function_privilege('authenticated', 'private.can_support_view(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute private.can_support_view';
  end if;

  if has_function_privilege('anon', 'public.search_support_view_subjects(text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.search_support_view_subjects';
  end if;

  if not has_function_privilege('authenticated', 'public.search_support_view_subjects(text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.search_support_view_subjects';
  end if;

  if not exists (select 1 from public.permissions where key = 'support.view_as') then
    raise exception 'FAIL: support.view_as permission not seeded';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles', 'vitals_readings', 'medications', 'appointments',
        'screening_schedules', 'notifications', 'clinical_staff'
      )
      and cmd = 'SELECT'
      and coalesce(qual, '') !~ 'can_support_view'
  ) then
    raise exception 'FAIL: a SELECT policy in the support-view-as read surface is missing can_support_view';
  end if;

  raise notice 'PASS: support_view_sessions table + rules + audit + notification + can_support_view read surface in place';
end $$;
