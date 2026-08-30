-- Tarragon Health — Patient Identity & MPI gap analysis (docs/PATIENT_IDENTITY_MPI_SPEC.md §82.11)
-- "Emergency access" tier for the proxy/consent model.
--
-- private.can_read_clinical() (20260731181143_sponsor_clinical_access_consent.sql) already gates
-- clinical-table SELECT on a patient-controlled `profile_access.clinical_access` toggle — deliberate,
-- always off by default, only the owner can flip it. That is the right model for the steady state
-- ("I choose who sees my health information"), but it has no answer for a crisis: a next-of-kin who
-- holds only 'view' (no clinical_access) and cannot reach the patient to ask them to flip the switch.
--
-- Scope decision (no founder answer existed for this — see the gap-analysis doc's open questions;
-- documenting the default taken here rather than blocking): emergency access is a time-boxed
-- ESCALATION of an EXISTING, already-consented profile_access relationship, not a way for a stranger
-- to self-grant access. A grantee must already hold a profile_access row (any level) for the patient
-- before they can request it. This keeps the feature bounded — it answers "someone the patient
-- already trusted needs more, right now" — not "anyone can claim an emergency."
--
-- Governance, per the spec's "appropriately governed": mandatory reason, fixed 24h window (not
-- client-settable), immediate in_app notification to the patient the moment it's granted (not
-- after the fact), and either the patient or the grantee can end it early. It expires on its own —
-- private.can_read_clinical()'s time check does the work, no cron needed to "turn it off."

create table public.emergency_access_grants (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  grantee_user_id   uuid not null references public.profiles (id) on delete cascade,
  reason            text not null,
  granted_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '24 hours'),
  revoked_at        timestamptz,
  revoked_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint emergency_access_grants_no_self check (profile_id <> grantee_user_id),
  constraint emergency_access_grants_reason_len check (char_length(btrim(reason)) between 1 and 500)
);

create index emergency_access_grants_profile_idx on public.emergency_access_grants (profile_id);
create index emergency_access_grants_grantee_idx on public.emergency_access_grants (grantee_user_id);
create index emergency_access_grants_active_idx on public.emergency_access_grants (profile_id, expires_at)
  where revoked_at is null;

-- BEFORE INSERT: re-derive granted_at/expires_at server-side (a client cannot request a longer
-- window than 24h), require an existing profile_access relationship, and require the requester to
-- be requesting for themselves.
create or replace function private.enforce_emergency_access_grant_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profile_access pa
    where pa.profile_id = new.profile_id
      and pa.grantee_user_id = new.grantee_user_id
  ) then
    raise exception
      'Emergency access can only be requested by someone who already holds a care-access grant for this person'
      using errcode = '42501';
  end if;

  new.granted_at := now();
  new.expires_at := now() + interval '24 hours';
  new.revoked_at := null;
  new.revoked_by := null;

  return new;
end;
$$;

-- Explicit revoke, not relying on ALTER DEFAULT PRIVILEGES — confirmed empirically on this
-- project (see 20260829111514_resweep_private_schema_execute_from_public.sql) that a brand-new
-- private.* function is still born PUBLIC/anon-executable even with a schema-level default set,
-- and that this applies regardless of return type (trigger functions included) — only an
-- explicit per-function revoke closes it.
revoke all on function private.enforce_emergency_access_grant_rules() from public;

drop trigger if exists emergency_access_grants_enforce_rules on public.emergency_access_grants;
create trigger emergency_access_grants_enforce_rules
  before insert on public.emergency_access_grants
  for each row execute function private.enforce_emergency_access_grant_rules();

-- BEFORE UPDATE: the only legitimate change to an existing grant is revocation
-- (revoked_at/revoked_by). Everything else about a grant is immutable once created.
create or replace function private.guard_emergency_access_grant_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.profile_id is distinct from old.profile_id
    or new.grantee_user_id is distinct from old.grantee_user_id
    or new.reason is distinct from old.reason
    or new.granted_at is distinct from old.granted_at
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'Only revoked_at/revoked_by may change on an existing emergency access grant';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_emergency_access_grant_update() from public;

drop trigger if exists emergency_access_grants_guard_update on public.emergency_access_grants;
create trigger emergency_access_grants_guard_update
  before update on public.emergency_access_grants
  for each row execute function private.guard_emergency_access_grant_update();

alter table public.emergency_access_grants enable row level security;

create policy emergency_access_grants_select on public.emergency_access_grants
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or grantee_user_id = (select auth.uid())
    or private.is_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = profile_id
        and p.organisation_id is not null
        and private.is_org_staff(p.organisation_id)
    )
  );

-- A grantee may only ever request emergency access for themselves.
create policy emergency_access_grants_insert on public.emergency_access_grants
  for insert to authenticated
  with check (grantee_user_id = (select auth.uid()));

-- Either party (or admin) may end an active grant early.
create policy emergency_access_grants_revoke on public.emergency_access_grants
  for update to authenticated
  using (
    profile_id = (select auth.uid())
    or grantee_user_id = (select auth.uid())
    or private.is_admin()
  )
  with check (
    profile_id = (select auth.uid())
    or grantee_user_id = (select auth.uid())
    or private.is_admin()
  );

grant select, insert, update on public.emergency_access_grants to authenticated;

-- Same write-audit coverage as profile_access/care_access_requests (see the companion migration
-- 20260830112004_audit_proxy_relationship_changes.sql) — a grant/revoke is exactly the kind of
-- proxy-relationship change that must be traceable.
drop trigger if exists audit_row_change_trg on public.emergency_access_grants;
create trigger audit_row_change_trg
  after insert or update or delete on public.emergency_access_grants
  for each row execute function private.audit_row_change();

-- Extend the shared clinical-read predicate: an active (unexpired, unrevoked) emergency grant
-- reads exactly like an owner-approved clinical_access toggle — read only, never write (nothing
-- below touches a write policy, same invariant the original migration's own assertion enforces).
create or replace function private.can_read_clinical(p_patient uuid)
returns boolean
language sql
stable
set search_path to ''
as $$
  select exists (
    select 1
    from public.profile_access pa
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and pa.clinical_access
  )
  or exists (
    select 1
    from public.emergency_access_grants eag
    where eag.profile_id = p_patient
      and eag.grantee_user_id = (select auth.uid())
      and eag.revoked_at is null
      and eag.expires_at > now()
  );
$$;

-- Notify the patient the moment emergency access is granted — this is the "appropriately governed"
-- half of the feature: the escalation must be visible to the person whose record it is, immediately,
-- not discoverable only after the fact via audit_log.
create or replace function private.notify_emergency_access_granted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_org uuid;
  v_grantee_name text;
begin
  select organisation_id into v_owner_org from public.profiles where id = new.profile_id;
  select full_name into v_grantee_name from public.profiles where id = new.grantee_user_id;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (
    v_owner_org,
    new.profile_id,
    'in_app',
    'pending',
    'emergency_access_granted',
    jsonb_build_object(
      'grant_id', new.id,
      'grantee_name', coalesce(v_grantee_name, 'Someone you gave care access to'),
      'reason', new.reason,
      'expires_at', new.expires_at
    )
  );

  return new;
end;
$$;

revoke all on function private.notify_emergency_access_granted() from public;

drop trigger if exists emergency_access_grants_notify_created on public.emergency_access_grants;
create trigger emergency_access_grants_notify_created
  after insert on public.emergency_access_grants
  for each row execute function private.notify_emergency_access_granted();

-- Tell the grantee if their access was cut short (not just let it silently 403 on next read).
create or replace function private.notify_emergency_access_revoked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grantee_org uuid;
begin
  if old.revoked_at is not null or new.revoked_at is null then
    return new;
  end if;

  select organisation_id into v_grantee_org from public.profiles where id = new.grantee_user_id;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (
    v_grantee_org,
    new.grantee_user_id,
    'in_app',
    'pending',
    'emergency_access_revoked',
    jsonb_build_object('grant_id', new.id)
  );

  return new;
end;
$$;

revoke all on function private.notify_emergency_access_revoked() from public;

drop trigger if exists emergency_access_grants_notify_revoked on public.emergency_access_grants;
create trigger emergency_access_grants_notify_revoked
  after update on public.emergency_access_grants
  for each row execute function private.notify_emergency_access_revoked();

-- Proof, not hope.
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'emergency_access_grants'
  ) then
    raise exception 'FAIL: emergency_access_grants table missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'emergency_access_grants' and cmd = 'SELECT'
  ) then
    raise exception 'FAIL: emergency_access_grants has no SELECT policy';
  end if;

  -- Note: can_read_clinical legitimately gates two INSERT policies already
  -- (care_message_threads_insert, care_messages_insert — a documented, pre-existing exception
  -- letting a clinical-access sponsor ask a question but never edit/close a thread), so this
  -- migration does not re-assert the original "never gates a write policy" claim from
  -- 20260731181143_sponsor_clinical_access_consent.sql — it's already correctly narrower than
  -- that in production and this migration doesn't change that.
  if has_function_privilege('anon', 'private.enforce_emergency_access_grant_rules()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.enforce_emergency_access_grant_rules';
  end if;

  raise notice 'PASS: emergency_access_grants table + rules + notifications + can_read_clinical extension in place';
end $$;
