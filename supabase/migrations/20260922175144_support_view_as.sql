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
-- Table scope for this pass — profiles (via a narrow identity RPC, not a row-level policy — see
-- section 9), vitals_readings, medications, appointments, screening_schedules, notifications
-- (non-clinical only), clinical_staff. Chosen as the read surface that actually answers most
-- reported "my dashboard looks wrong" issues (identity, recent vitals, current meds, upcoming/
-- past appointments, screening due dates, what they were actually notified, and — for a
-- clinician subject — their tier/credential/active status) without touching anything in the
-- reproductive-health family (reproductive_health_profiles, menstrual_cycles,
-- menstrual_daily_logs) or clinical messaging/results content. That exclusion is deliberate, not
-- an oversight: per CLAUDE.md, reproductive_health is a protected access category everywhere else
-- on the platform (private.has_emergency_access excludes it from break-glass; the 2026-09-05
-- platform audit found and closed a guardian-read gap on exactly these three tables) — a new,
-- broader support-debugging grant has no business touching it in a first pass. The
-- notifications_select restriction to content_class = 'non_clinical' exists specifically because
-- some notification templates unrelated to those three tables (e.g. menstrual-cycle reminders)
-- are still clinical content that would otherwise leak through an unfiltered clause. Extending
-- coverage to more tables later is additive (one more OR-clause per table, reusing the same
-- function) — this is not meant to be the final word on scope.

-- ---------------------------------------------------------------------------
-- 0. Migration-record gap closed, found while building this feature (NOT a live bug fix — the
--    live database already behaves correctly; only the committed git history was out of sync
--    with it). private.audit_row_change()'s only two migration-file redefinitions are
--    20260829204722_audit_log_reason_and_result.sql (adds reason/result) and, later the same
--    day, 20260829222942_flag_cross_org_actor_on_phi_audit_entries.sql (adds cross_org_actor) —
--    and 20260829222942's OWN COMMITTED SQL TEXT never declares v_reason, never reads
--    app.audit_reason, and its insert into public.audit_log (...) column list omits reason/
--    result entirely, i.e. replaying git's migration history verbatim would silently drop
--    reason/result support for every table using this generic trigger. But a direct live check
--    against the actual project (koiplnmbgnqnbywhpjlf), via
--    `select pg_get_functiondef(oid) from pg_proc where proname = 'audit_row_change' and
--    pronamespace = 'private'::regnamespace`, shows the LIVE function already has both
--    cross_org_actor AND reason/result together — someone applied the correct merged version
--    directly to the live database at some point, with no matching migration file ever
--    committed for it. Exactly the "live schema object with no migration record at all" class
--    CLAUDE.md's standing lessons describe (previously documented for
--    private.guard_profiles_self_update() — this is a second, independent instance of the same
--    failure mode, not that one recurring). What this section actually does: re-asserts the
--    live, already-correct definition (confirmed byte-identical to the live pg_get_functiondef
--    output, aside from one cosmetic dash character in a comment) so it finally has a matching
--    git migration record — a documentation/provenance fix, not a behavioural one. This feature's
--    own audit trail (support_view_sessions' reason) already works correctly against live without
--    this section; it's included so `supabase db reset` / CI replay produces the same live
--    behaviour a fresh environment would otherwise silently lack, and so this drift is no longer
--    invisible to a plain migration-files-vs-git diff.
-- ---------------------------------------------------------------------------
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid;
  v_actor_org  uuid;
  v_reason     text;
  v_org        uuid;
  v_entity_id  uuid;
  v_action     text;
  v_changed    text[];
  v_old        jsonb;
  v_new        jsonb;
  v_hash       text;
  v_cross_org  boolean;
begin
  v_actor := coalesce(
    auth.uid(),
    nullif(current_setting('app.audit_actor_id', true), '')::uuid
  );
  v_reason := nullif(current_setting('app.audit_reason', true), '');

  if tg_op = 'INSERT' then
    v_new       := to_jsonb(NEW);
    v_entity_id := (v_new ->> 'id')::uuid;
    v_org       := nullif(v_new ->> 'organisation_id', '')::uuid;
    v_action    := tg_table_name || '.created';
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_new) where value is not null;
    v_hash := encode(extensions.digest(v_new::text, 'sha256'), 'hex');

  elsif tg_op = 'UPDATE' then
    v_old       := to_jsonb(OLD);
    v_new       := to_jsonb(NEW);
    v_entity_id := (v_new ->> 'id')::uuid;
    v_org       := nullif(v_new ->> 'organisation_id', '')::uuid;
    v_action    := tg_table_name || '.updated';
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_new) n
      where key <> 'updated_at'
        and n.value is distinct from (v_old -> n.key);

    if v_changed is null then
      -- Nothing changed except (at most) updated_at -- a touch, not a real change.
      return NEW;
    end if;

    v_hash := encode(extensions.digest(v_new::text, 'sha256'), 'hex');

  elsif tg_op = 'DELETE' then
    v_old       := to_jsonb(OLD);
    v_entity_id := (v_old ->> 'id')::uuid;
    v_org       := nullif(v_old ->> 'organisation_id', '')::uuid;
    v_action    := tg_table_name || '.deleted';
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_old) where value is not null;
    v_hash := encode(extensions.digest(v_old::text, 'sha256'), 'hex');
  end if;

  if v_actor is not null then
    select organisation_id into v_actor_org from public.profiles where id = v_actor;
  end if;
  v_cross_org := v_actor_org is not null and v_org is not null and v_actor_org <> v_org;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result)
  values (
    v_org, v_actor, v_action, tg_table_name, v_entity_id,
    jsonb_build_object(
      'changed_columns', to_jsonb(coalesce(v_changed, array[]::text[])),
      'row_hash', v_hash,
      'actor_resolved', v_actor is not null,
      'cross_org_actor', v_cross_org
    ),
    v_reason,
    'success'
  );

  if tg_op = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

comment on function private.audit_row_change() is
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger. Logs actor, action, entity, reason (from '
  'app.audit_reason if a caller set it), result (always success -- a trigger cannot fire on a '
  'rolled-back write), the list of changed column NAMES (never values), a sha256 hash of the '
  'full row, and whether the acting profile''s own organisation_id differs from the row''s '
  '(cross_org_actor) to public.audit_log. See 20260812030853_row_change_audit_triggers.sql for '
  'the original design, 20260829204722_audit_log_reason_and_result.sql for reason/result, '
  '20260829222942_flag_cross_org_actor_on_phi_audit_entries.sql for cross_org_actor, and '
  '20260922175144_support_view_as.sql for why this re-assertion exists: 20260829222942''s own '
  'committed SQL text omits reason/result even though the live function has always carried both '
  'since some untracked change -- this closes that git-vs-live migration-record gap.';

revoke all on function private.audit_row_change() from public;

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
  id                  uuid primary key default gen_random_uuid(),
  viewer_id           uuid not null references public.profiles (id) on delete cascade,
  subject_id          uuid not null references public.profiles (id) on delete cascade,
  -- Snapshotted at insert time, server-derived, immutable — see the enforce-rules trigger.
  -- Deliberately NOT re-read live from public.profiles by the history list/page: once a
  -- session ends, private.can_support_view() (correctly) stops granting a live profiles read
  -- for a non-admin/non-org-staff viewer, which would otherwise make their own past sessions
  -- show "Unknown subject" forever — the session's own record of who it was about must not
  -- depend on a read grant that the session's own end just revoked.
  subject_full_name  text,
  subject_role        public.user_role not null,
  organisation_id     uuid references public.organisations (id) on delete set null,
  reason              text not null,
  started_at          timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '30 minutes'),
  ended_at            timestamptz,
  ended_by            uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
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
  '20260922175144_support_view_as.sql. Never touch this table with a service-role client.';

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
  v_subject_name text;
begin
  if not private.has_permission('support.view_as') then
    raise exception 'You do not have permission to start a support view-as session'
      using errcode = '42501';
  end if;

  select role, organisation_id, full_name into v_subject_role, v_subject_org, v_subject_name
  from public.profiles where id = new.subject_id;

  if v_subject_role is null then
    raise exception 'Support view-as subject not found' using errcode = '42501';
  end if;

  if v_subject_role not in ('patient', 'clinician') then
    raise exception 'Support view-as is only available for patient and clinician accounts'
      using errcode = '42501';
  end if;

  new.viewer_id := (select auth.uid());
  -- v_subject_org can legitimately be null (profiles.organisation_id is nullable) — same
  -- org-less-profile edge case every other org-scoped table on this platform already lives
  -- with (e.g. profiles_select's own "organisation_id is not null and is_org_staff(...)"
  -- guard). A null here just means this session's audit_log/notifications rows carry a null
  -- organisation_id too, same as any other org-less profile's activity would.
  new.organisation_id := v_subject_org;
  new.subject_role := v_subject_role;
  new.subject_full_name := v_subject_name;
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
  if new.id is distinct from old.id
    or new.viewer_id is distinct from old.viewer_id
    or new.subject_id is distinct from old.subject_id
    or new.subject_full_name is distinct from old.subject_full_name
    or new.subject_role is distinct from old.subject_role
    or new.organisation_id is distinct from old.organisation_id
    or new.reason is distinct from old.reason
    or new.started_at is distinct from old.started_at
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Only ending a support view-as session (ended_at) is allowed once created';
  end if;

  if old.ended_at is not null then
    raise exception 'This support view-as session has already ended';
  end if;

  -- ended_by is forced back to its old value (null, since we just checked old.ended_at is
  -- null) EXCEPT in the one legitimate transition below — closes a gap where a caller
  -- permitted to UPDATE this row (viewer/subject/admin) could set ended_by alone, without
  -- ending the session (ended_at left null), writing an attributable-looking value onto a
  -- session that per ended_at is still active. ended_by must never be settable independently
  -- of a genuine ended_at null->non-null transition.
  new.ended_by := old.ended_by;

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

-- Same generic write-audit coverage as most tables using this trigger (care_messages, profiles,
-- etc. — 20260812030853's own table list is wired insert-or-update-or-delete). No RLS DELETE
-- policy exists on this table (asserted in the closing proof block below), so no `authenticated`
-- client can ever trigger this branch — included anyway so a future service-role/ops deletion
-- still leaves an audit_log trace, rather than silently going untracked the way an
-- insert-or-update-only trigger would.
drop trigger if exists audit_row_change_trg on public.support_view_sessions;
create trigger audit_row_change_trg
  after insert or update or delete on public.support_view_sessions
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
  )
  -- Re-checked on every read, not just once at session creation — the migration's own header
  -- calls support.view_as "a real, audited, revocable grant"; without this, revoking it
  -- mid-session (e.g. an admin responding to suspected misuse) would leave an already-open
  -- session still granting reads for up to the remaining ~30 minutes, since
  -- enforce_support_view_session_rules() only checks the permission once, at INSERT time.
  and private.has_permission('support.view_as');
$$;

revoke all on function private.can_support_view(uuid) from public;
grant execute on function private.can_support_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7b. Narrow identity RPC for a support-view-as session — see the note on profiles_select
--    (section 9) for why this exists instead of a can_support_view(id) clause on profiles
--    itself: RLS is row-level, so a policy clause would grant the subject's entire row,
--    including hiv_status/hbv_status/hcv_status and emergency_contact_*, not just the
--    identity fields this feature's admin page actually needs. Returns exactly the columns
--    apps/web's [sessionId]/page.tsx displays, gated on an active session for that specific
--    subject — nothing more.
-- ---------------------------------------------------------------------------
create or replace function public.get_support_view_subject_identity(p_subject_id uuid)
returns table (
  id               uuid,
  full_name        text,
  role             public.user_role,
  phone            text,
  city             text,
  state            text,
  patient_number   text,
  organisation_id  uuid,
  created_at       timestamptz,
  is_active        boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.role, p.phone, p.city, p.state, p.patient_number,
         p.organisation_id, p.created_at, p.is_active
  from public.profiles p
  where p.id = p_subject_id
    and private.can_support_view(p_subject_id);
$$;

revoke all on function public.get_support_view_subject_identity(uuid) from public, anon;
grant execute on function public.get_support_view_subject_identity(uuid) to authenticated;

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
--
--    Deliberate tenant-isolation trade-off, called out explicitly rather than left implicit:
--    unlike almost every other multi-tenant read on this platform ("every table has
--    organisation_id — always filter by it"), this search is NOT organisation_id-scoped — it
--    searches every patient/clinician profile platform-wide. That's the point of the RPC (a
--    delegated grantee is very often looking for someone outside their own org), but it does
--    mean any support.view_as holder can discover name/phone/patient_number for anyone on the
--    platform, before starting a session against them. Accepted here because support.view_as
--    is itself a real, audited, revocable grant (not ambient), and the fields returned are the
--    same low-sensitivity identity fields already shown in-app search/booking UIs — not a
--    justification for widening scope further without the same reasoning.
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
      -- Trimmed once, reused for both the length gate above and every pattern below — a stray
      -- leading/trailing space (pasted from a phone field, a typo) used to pass the length
      -- check but never match anything, since the ILIKE pattern was built from the untrimmed
      -- literal. Also escapes ILIKE's own wildcard characters so a literal "_" (e.g. inside a
      -- phone number) or "%" doesn't act as a pattern wildcard and silently widen the match.
      p.full_name ilike '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%'
      or p.phone ilike '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%'
      or p.patient_number ilike '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%'
    )
  order by p.full_name
  limit 20;
$$;

revoke all on function public.search_support_view_subjects(text) from public, anon;
grant execute on function public.search_support_view_subjects(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Extend the bounded read surface (see header) on the 6 tables where a row-level grant is
--    actually the right shape (vitals_readings, medications, appointments, screening_schedules,
--    notifications, clinical_staff) — one more OR-clause per policy, every other clause copied
--    byte-identical from each table's live definition so nothing else changes, EXCEPT two
--    `can_read_clinical` calls (vitals_readings_select, screening_schedules_select) that needed
--    an explicit ::care_access_category cast added — see the inline note on vitals_readings_select
--    below: confirmed via a live dry run against project koiplnmbgnqnbywhpjlf that
--    private.can_read_clinical(patient_id, 'vitals_readings') is ambiguous today
--    (private.can_read_clinical now has 3 live overloads), even though this is the exact bare
--    text the tables' own last migration (20260902232555) used successfully — it was created
--    before the caregiver_permission overload existed and Postgres never re-resolves an
--    already-bound policy expression. notifications_select additionally restricts its clause to
--    content_class = 'non_clinical' — see its own comment below.
-- ---------------------------------------------------------------------------
-- profiles is deliberately NOT touched here — see public.get_support_view_subject_identity()
-- below. RLS is row-level, not column-level: a can_support_view(id) OR-clause here would grant
-- the subject's ENTIRE profiles row, including hiv_status/hbv_status/hcv_status
-- (20260802212314_serology_state_machine.sql) and emergency_contact_*, to any query the caller
-- makes against the table directly — not just the curated identity columns this feature's own
-- admin page asks for. This codebase already made and fixed exactly this mistake once
-- (20260807112503_clinician_phone_admin_only_visibility.sql: a profiles_select clause meant for
-- a name lookup exposed phone/DOB/HIV/HBV/HCV/emergency contacts to any patient with a care
-- plan; the fix replaced the row-level grant with a narrow, name-only SECURITY DEFINER RPC).
-- Reusing that established pattern here rather than reintroducing the same shape of leak.

drop policy if exists vitals_readings_select on public.vitals_readings;
create policy vitals_readings_select on public.vitals_readings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    -- Explicit ::care_access_category cast, added by this migration: private.can_read_clinical
    -- now has THREE live overloads (1-arg legacy, 2-arg care_access_category, 2-arg
    -- caregiver_permission — confirmed via pg_proc against the live project), so a bare
    -- untyped string literal here is genuinely ambiguous, not just in this migration's own
    -- dry run but for any future CREATE POLICY that recreates this exact clause. The original
    -- (20260902232555) got away with the untyped form only because it was created before the
    -- caregiver_permission overload existed and Postgres never re-resolves an already-created
    -- policy's bound function reference — a fresh `supabase db reset` replaying migration
    -- history in order could still hit this the moment both overloads coexist. Fixed here for
    -- this policy's own re-creation; flagged separately as a latent platform-wide risk.
    or private.can_read_clinical(patient_id, 'vitals_readings'::public.care_access_category)
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
    -- Explicit cast — see the identical note on vitals_readings_select above.
    or private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'labs_results')
    or private.can_support_view(patient_id)
  );

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    recipient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    -- Restricted to content_class = 'non_clinical', unlike every other clause in this policy —
    -- notifications is not template-filtered by category the way the rest of this feature's read
    -- surface deliberately excludes reproductive_health, and some non-reproductive-health
    -- templates (e.g. cycle_period_due_soon/today/late, 20260902201443) are still content_class
    -- 'clinical' and would otherwise surface exactly the category this feature's own header says
    -- it stays out of. non_clinical is the existing, already-audited distinction
    -- (20260730094515_i1_notifications_content_class.sql) for "safe to show on an open rail" —
    -- reused here for "safe to show a support agent", not a new judgement call.
    or (private.can_support_view(recipient_id) and content_class = 'non_clinical')
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

  if (select pg_get_functiondef(oid) from pg_proc
      where proname = 'can_support_view' and pronamespace = 'private'::regnamespace)
    not like '%has_permission%'
  then
    raise exception 'FAIL: private.can_support_view() does not re-check support.view_as on every read (revocation mid-session would be ineffective)';
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

  -- At least one permissive SELECT policy per table must carry can_support_view — NOT every
  -- SELECT policy on the table. Several of these tables have more than one permissive SELECT
  -- policy for unrelated purposes (profiles_select_my_grantees, profiles_select_pending_care_
  -- access, vitals_readings_select_own_entry — confirmed live), and Postgres ORs multiple
  -- permissive policies together, so the grant only needs to exist in ONE of them (the table's
  -- own <table>_select policy, which is what this migration edits). profiles is deliberately
  -- excluded from this list — see section 9's comment: it's read via
  -- get_support_view_subject_identity() instead of a row-level RLS clause.
  if exists (
    select t.tbl
    from unnest(array[
      'vitals_readings', 'medications', 'appointments',
      'screening_schedules', 'notifications', 'clinical_staff'
    ]) as t(tbl)
    where not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t.tbl and cmd = 'SELECT'
        and coalesce(qual, '') ~ 'can_support_view'
    )
  ) then
    raise exception 'FAIL: a table in the support-view-as read surface has no SELECT policy carrying can_support_view';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'
      and coalesce(qual, '') ~ 'can_support_view'
  ) then
    raise exception 'FAIL: profiles must never carry a can_support_view row-level grant — use get_support_view_subject_identity() instead (see section 9)';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notifications' and cmd = 'SELECT'
      and coalesce(qual, '') ~ 'can_support_view' and coalesce(qual, '') !~ 'non_clinical'
  ) then
    raise exception 'FAIL: notifications_select''s can_support_view clause is missing the content_class = non_clinical restriction';
  end if;

  if has_function_privilege('anon', 'public.get_support_view_subject_identity(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.get_support_view_subject_identity';
  end if;

  if not has_function_privilege('authenticated', 'public.get_support_view_subject_identity(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.get_support_view_subject_identity';
  end if;

  -- The section-0 fix: private.audit_row_change() must actually read app.audit_reason and
  -- write reason/result again, not just typecheck — this is exactly the kind of "committed body
  -- looks right, live behaviour doesn't" gap CLAUDE.md warns about, so assert the live definition
  -- text directly rather than trusting that CREATE OR REPLACE applied what this file intends.
  if (select pg_get_functiondef(oid) from pg_proc
      where proname = 'audit_row_change' and pronamespace = 'private'::regnamespace)
    not like '%app.audit_reason%'
  then
    raise exception 'FAIL: private.audit_row_change() does not read app.audit_reason';
  end if;

  if (select pg_get_functiondef(oid) from pg_proc
      where proname = 'audit_row_change' and pronamespace = 'private'::regnamespace)
    !~ 'insert into public\.audit_log \([^)]*reason[^)]*result'
  then
    raise exception 'FAIL: private.audit_row_change() does not insert reason/result into audit_log';
  end if;

  if has_function_privilege('anon', 'private.audit_row_change()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.audit_row_change';
  end if;

  raise notice 'PASS: support_view_sessions table + rules + audit + notification + can_support_view read surface in place';
end $$;
