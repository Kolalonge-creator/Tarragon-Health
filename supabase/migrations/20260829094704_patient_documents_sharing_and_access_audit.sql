-- Tarragon Health — Document & Clinical Record Management, part 3/5: patient-
-- authorised sharing (§35.12) and the document access audit (§35.13).

-- ---------------------------------------------------------------------------
-- 1. Sharing
-- ---------------------------------------------------------------------------
-- §35.12: "Patient can authorise sharing with: clinician, specialist,
-- hospital, another healthcare organisation." A recipient may be an existing
-- Tarragon account (an internal clinician — recipient_profile_id) or someone
-- outside the platform entirely (a specialist at another hospital, that other
-- organisation itself) — recipient_name/recipient_organisation cover that
-- shape, exactly like patient_documents.author_name/author_organisation.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_share_recipient_type') then
    create type public.document_share_recipient_type as enum (
      'clinician',
      'specialist',
      'hospital',
      'organisation'
    );
  end if;
end $$;

create table if not exists public.patient_document_shares (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  document_id          uuid not null references public.patient_documents (id) on delete cascade,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  recipient_type       public.document_share_recipient_type not null,
  -- Set when the recipient already has a Tarragon account — grants that
  -- account read access to this one document (see the SELECT policy in
  -- part 3.2 below). Null for a genuinely external recipient.
  recipient_profile_id uuid references public.profiles (id) on delete set null,
  recipient_name       text,
  recipient_organisation text,
  -- §35.12 "purpose" — required. A share with no stated reason is exactly the
  -- ungoverned hand-off this feature exists to replace.
  purpose              text not null check (length(btrim(purpose)) > 0),
  granted_by           uuid references public.profiles (id) on delete set null,
  shared_at            timestamptz not null default now(),
  expires_at           timestamptz,
  revoked_at           timestamptz,
  revoked_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint patient_document_shares_recipient_named check (
    recipient_profile_id is not null
    or recipient_name is not null
    or recipient_organisation is not null
  ),
  constraint patient_document_shares_expiry_after_grant check (
    expires_at is null or expires_at > shared_at
  )
);

create index if not exists patient_document_shares_document_idx
  on public.patient_document_shares (document_id);
create index if not exists patient_document_shares_patient_idx
  on public.patient_document_shares (patient_id, shared_at desc);
create index if not exists patient_document_shares_recipient_idx
  on public.patient_document_shares (recipient_profile_id)
  where recipient_profile_id is not null;

comment on table public.patient_document_shares is
  '§35.12. A patient-authorised grant of read access to one document version. Recipient may be an existing Tarragon account (recipient_profile_id, read access enforced in patient_documents_select) or an external party (recipient_name/organisation, informational only — Tarragon has no way to enforce access it never controls). Terms (recipient, purpose, expiry) are immutable after creation; only revocation is a later write.';

-- Only the document's owning patient (or someone with an active clinical
-- caregiving grant acting for them — the same "manage" shape used everywhere
-- else a dependent's record is acted on) may create a share, and only for a
-- document that is actually theirs and already readable to them. Org staff
-- read the shares for their patients (so a receiving clinician's own audit of
-- "why do I have access to this" is answerable) but never create one on a
-- patient's behalf — sharing is the patient's decision, not staff's to grant.
alter table public.patient_document_shares enable row level security;

drop policy if exists patient_document_shares_select on public.patient_document_shares;
create policy patient_document_shares_select on public.patient_document_shares
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or recipient_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists patient_document_shares_insert on public.patient_document_shares;
create policy patient_document_shares_insert on public.patient_document_shares
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) or private.can_act_for(patient_id))
    and exists (
      select 1 from public.patient_documents d
      where d.id = document_id
        and d.patient_id = patient_document_shares.patient_id
        and d.organisation_id = patient_document_shares.organisation_id
    )
  );

-- UPDATE is narrowed to the revoke fields by the guard below; the RLS policy
-- only decides WHO may reach an UPDATE at all.
drop policy if exists patient_document_shares_update on public.patient_document_shares;
create policy patient_document_shares_update on public.patient_document_shares
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.can_act_for(patient_id))
  with check (patient_id = (select auth.uid()) or private.can_act_for(patient_id));

grant select, insert, update on public.patient_document_shares to authenticated;

create or replace function private.enforce_patient_document_share_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Share terms are immutable once granted — a patient who wants different
  -- terms revokes and creates a new share, so the history stays a true
  -- record of what was authorised and when, never a quietly edited one.
  new.organisation_id      := old.organisation_id;
  new.document_id          := old.document_id;
  new.patient_id           := old.patient_id;
  new.recipient_type       := old.recipient_type;
  new.recipient_profile_id := old.recipient_profile_id;
  new.recipient_name       := old.recipient_name;
  new.recipient_organisation := old.recipient_organisation;
  new.purpose              := old.purpose;
  new.granted_by           := old.granted_by;
  new.shared_at            := old.shared_at;
  new.expires_at           := old.expires_at;

  if old.revoked_at is not null then
    -- Once revoked, stays revoked.
    new.revoked_at := old.revoked_at;
    new.revoked_by := old.revoked_by;
  elsif new.revoked_at is not null then
    new.revoked_at := now();
    new.revoked_by := coalesce((select auth.uid()), new.revoked_by);
  end if;

  return new;
end;
$$;

drop trigger if exists patient_document_shares_update_guard on public.patient_document_shares;
create trigger patient_document_shares_update_guard
  before update on public.patient_document_shares
  for each row execute function private.enforce_patient_document_share_update();

drop trigger if exists patient_document_shares_set_granted_by on public.patient_document_shares;
create or replace function private.stamp_patient_document_share_grantor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.granted_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger patient_document_shares_set_granted_by
  before insert on public.patient_document_shares
  for each row execute function private.stamp_patient_document_share_grantor();

-- --- extend document readability with the share leg -------------------------
-- The one function change in this migration: an active (unrevoked,
-- unexpired) share on a document grants its internal recipient read access to
-- that specific document, regardless of confidentiality — this is the
-- "patient explicitly shared it with you" leg part 1 promised, and the only
-- leg that reaches a 'patient_private' document besides the patient
-- themselves.
create or replace function private.patient_document_shared_with_caller(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.patient_document_shares
    where document_id = p_document_id
      and recipient_profile_id = (select auth.uid())
      and revoked_at is null
      and (expires_at is null or expires_at > now())
  );
$$;

comment on function private.patient_document_shared_with_caller(uuid) is
  '§35.12. True when the current session holds an active, unrevoked, unexpired share on this exact document. The only way an internal account reaches a patient_private document besides the owning patient.';

drop policy if exists patient_documents_select on public.patient_documents;
create policy patient_documents_select on public.patient_documents
  for select to authenticated
  using (
    private.patient_document_readable(patient_id, organisation_id, category, confidentiality)
    or private.patient_document_shared_with_caller(id)
  );

-- ---------------------------------------------------------------------------
-- 2. Access audit (§35.13) — who opened this document, when, why, from which
--    organisation. Append-only, exactly like care_access_events.
-- ---------------------------------------------------------------------------
create table if not exists public.patient_document_access_log (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  document_id                 uuid not null references public.patient_documents (id) on delete cascade,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  -- Null only for a system/service-role read (e.g. a scheduled export job);
  -- never a placeholder for "someone, unrecorded" — a null here says exactly
  -- that no human session made this read.
  accessed_by                 uuid references public.profiles (id) on delete set null,
  -- "From which organisation" (§35.13) — the accessing account's own
  -- organisation, which is what makes a cross-organisation read (a shared
  -- document opened by a specialist at a different Tarragon-hosted org, once
  -- that exists) visible as such rather than looking identical to an in-org
  -- read.
  accessed_by_organisation_id uuid references public.organisations (id) on delete set null,
  reason                      text,
  occurred_at                 timestamptz not null default now(),
  metadata                    jsonb not null default '{}'::jsonb
);

create index if not exists patient_document_access_log_document_idx
  on public.patient_document_access_log (document_id, occurred_at desc);
create index if not exists patient_document_access_log_patient_idx
  on public.patient_document_access_log (patient_id, occurred_at desc);
create index if not exists patient_document_access_log_actor_idx
  on public.patient_document_access_log (accessed_by, occurred_at desc);

comment on table public.patient_document_access_log is
  '§35.13. Append-only: who opened a document, when, why (free-text reason, optional), from which organisation. Written only by private.record_patient_document_access — see the note there on why every read path, not just staff, must call it.';

alter table public.patient_document_access_log enable row level security;

-- The patient sees who has been looking at their own documents. Org staff see
-- the access history for their org's patients (this is the queryable read
-- audit docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §1.25 flags as missing for
-- pgaudit, scoped to documents specifically rather than attempted platform-
-- wide here).
drop policy if exists patient_document_access_log_select on public.patient_document_access_log;
create policy patient_document_access_log_select on public.patient_document_access_log
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

-- No INSERT/UPDATE/DELETE policy on purpose — see the append-only trigger and
-- private.record_patient_document_access below. An access log that the
-- accessing party could write directly is not an audit trail.
grant select on public.patient_document_access_log to authenticated;

create or replace function private.patient_document_access_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'patient_document_access_log is append-only; a % is not permitted', tg_op
    using errcode = '42501';
end;
$$;

create trigger patient_document_access_log_no_update
  before update or delete on public.patient_document_access_log
  for each row execute function private.patient_document_access_log_append_only();

-- The one writer. Re-checks readability itself rather than trusting the
-- caller, so a stray call can never manufacture an access record for a
-- document the session could not actually open — and re-derives the acting
-- organisation from the session rather than accepting it as a parameter, so
-- the "from which organisation" column can never be spoofed.
--
-- Exception-guarded like private.log_care_access: a logging failure must
-- never be the reason a legitimate document read is blocked, but it also must
-- never be silent — it goes to the server log as a warning.
create or replace function private.record_patient_document_access(
  p_document_id uuid,
  p_reason      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc    public.patient_documents;
  v_actor  uuid := (select auth.uid());
  v_actor_org uuid;
begin
  select * into v_doc from public.patient_documents where id = p_document_id;
  if v_doc.id is null then
    return;
  end if;

  if v_actor is not null then
    if not (
      private.patient_document_readable(v_doc.patient_id, v_doc.organisation_id, v_doc.category, v_doc.confidentiality)
      or private.patient_document_shared_with_caller(p_document_id)
    ) then
      raise warning 'document access log skipped: % has no read access to document %', v_actor, p_document_id;
      return;
    end if;
    select organisation_id into v_actor_org from public.profiles where id = v_actor;
  end if;

  insert into public.patient_document_access_log
    (organisation_id, document_id, patient_id, accessed_by, accessed_by_organisation_id, reason)
  values
    (v_doc.organisation_id, p_document_id, v_doc.patient_id, v_actor, v_actor_org, p_reason);
exception
  when others then
    raise warning 'document access log failed for document % (actor %): %', p_document_id, v_actor, sqlerrm;
end;
$$;

comment on function private.record_patient_document_access(uuid, text) is
  '§35.13. Call this from the server action that mints a signed URL or otherwise serves a document''s content — BEFORE the file itself is returned. The read-access check runs a SECOND time here (RLS already confirmed it for the row read) precisely because a signed URL is a capability, not a live query: once minted it works for the URL''s lifetime regardless of what the caller''s access looks like a moment later, so the audit row has to be independently proven, not assumed from the fact that the caller asked.';

-- No explicit grant needed: 20260812003758 set schema-level default
-- privileges for `private` so authenticated/service_role already get
-- EXECUTE on this by default, and public/anon do not.
