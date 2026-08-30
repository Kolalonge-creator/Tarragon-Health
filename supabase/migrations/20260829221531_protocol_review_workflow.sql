-- Tarragon Health
-- Clinical Governance gap-closure, item 5 of 6 (§88.4/§88.5 "protocol
-- versioning"/"protocol approval" — completing a PARTIAL item). Confirmed
-- live before writing this: protocol_versions already carries evidence_
-- basis/effective_date/review_date/applicable_population/specialty (built
-- by another session on this fleet, not this pass) -- genuinely closing
-- most of §88.5. What's still missing: a tracked pre-approval REVIEW
-- stage. private.stamp_protocol_version_approver() (20260812034845)
-- deliberately makes signing a single atomic Director action -- correct
-- for the ledger itself, but leaves no record that anyone reviewed a
-- protocol before it was signed, i.e. no distinct author vs reviewer vs
-- approver.
--
-- protocol_versions stays exactly as it is -- immutable, Director-signed,
-- untouched by this migration. This adds a staging layer IN FRONT of it: an
-- author drafts, any clinical staff may leave review comments, and only
-- when a Director is satisfied do they promote the draft into a real
-- protocol_versions row via the RPC below -- which does nothing but the
-- same insert the existing UI already does, so the existing trigger's
-- attribution/authority enforcement is the real boundary, unchanged.

create table public.protocol_drafts (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  protocol_id           text not null,
  title                 text not null check (length(btrim(title)) > 0),
  content               jsonb not null default '{}'::jsonb,
  change_summary        text not null check (length(btrim(change_summary)) > 0),
  evidence_basis        text,
  applicable_population text,
  specialty             text,

  status                text not null default 'draft' check (status in ('draft', 'in_review', 'promoted', 'rejected')),
  authored_by_staff     uuid references public.clinical_staff (id) on delete restrict,
  authored_by_profile   uuid references public.profiles (id) on delete restrict,

  promoted_to_version_id uuid references public.protocol_versions (id) on delete set null,
  rejected_reason       text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint protocol_drafts_promoted_requires_version check (
    status <> 'promoted' or promoted_to_version_id is not null
  ),
  constraint protocol_drafts_rejected_requires_reason check (
    status <> 'rejected' or (rejected_reason is not null and length(btrim(rejected_reason)) > 0)
  )
);

comment on table public.protocol_drafts is
  'Pre-signing review stage for a protocol_versions row, docs spec §88.4/§88.5. protocol_versions itself is untouched -- still the immutable, Director-only-signed ledger. A draft becomes a real version only via promote_protocol_draft(), which performs the exact insert the existing protocol UI already does.';

create index protocol_drafts_org_status_idx on public.protocol_drafts (organisation_id, status, created_at desc);

alter table public.protocol_drafts enable row level security;

create policy protocol_drafts_select on public.protocol_drafts
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy protocol_drafts_insert on public.protocol_drafts
  for insert to authenticated
  with check (private.is_clinical_tier(organisation_id));

create policy protocol_drafts_update on public.protocol_drafts
  for update to authenticated
  using (private.is_clinical_tier(organisation_id))
  with check (private.is_clinical_tier(organisation_id));

grant select, insert, update on public.protocol_drafts to authenticated;
revoke delete on public.protocol_drafts from authenticated;

create trigger protocol_drafts_set_updated_at
  before update on public.protocol_drafts
  for each row execute function private.set_updated_at();

create or replace function private.enforce_protocol_draft_attribution()
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
    and active
    and (
      is_clinical_director
      or doctor_tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
    )
  limit 1;

  if v_staff_id is null then
    raise exception 'Only a clinical-tier member of the care team can draft or edit a protocol.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.authored_by_staff := v_staff_id;
    new.authored_by_profile := (select auth.uid());
    new.status := coalesce(nullif(new.status, ''), 'draft');
    if new.status not in ('draft', 'in_review') then
      new.status := 'draft';
    end if;
    new.promoted_to_version_id := null;
    new.rejected_reason := null;
    return new;
  end if;

  if old.status in ('promoted', 'rejected') then
    raise exception 'This protocol draft is % and is closed -- start a new draft if something new needs recording.', old.status
      using errcode = '42501';
  end if;

  new.authored_by_staff := old.authored_by_staff;
  new.authored_by_profile := old.authored_by_profile;
  new.organisation_id := old.organisation_id;
  new.protocol_id := old.protocol_id;

  -- Promotion/rejection only ever happens through promote_protocol_draft()/
  -- reject_protocol_draft() below (security definer, does its own
  -- authority check) -- a plain client UPDATE can move draft <-> in_review
  -- freely but can never itself set status to promoted/rejected.
  if new.status in ('promoted', 'rejected') and old.status not in ('promoted', 'rejected') then
    raise exception 'A protocol draft can only be promoted or rejected via promote_protocol_draft()/reject_protocol_draft(), not a direct update.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function private.enforce_protocol_draft_attribution() is
  'INSERT: requires clinical tier, stamps authorship server-side. UPDATE: locks a promoted/rejected draft, keeps authorship immutable, and blocks a direct client UPDATE from setting status to promoted/rejected -- that only happens through the dedicated RPCs below.';

create trigger protocol_drafts_enforce_attribution
  before insert or update on public.protocol_drafts
  for each row execute function private.enforce_protocol_draft_attribution();

revoke all on function private.enforce_protocol_draft_attribution() from public;

-- ---------------------------------------------------------------------------
-- Review comments -- any clinical staff may leave one on a draft, append-
-- only. Deliberately not gated to a specific reviewer identity: the point
-- is a visible review trail, not a single named reviewer role the spec
-- doesn't actually define.
-- ---------------------------------------------------------------------------

create table public.protocol_draft_comments (
  id            uuid primary key default gen_random_uuid(),
  draft_id      uuid not null references public.protocol_drafts (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  commented_by_staff uuid references public.clinical_staff (id) on delete restrict,
  body          text not null check (length(btrim(body)) > 0),
  created_at    timestamptz not null default now()
);

comment on table public.protocol_draft_comments is
  'Append-only review trail on a protocol_drafts row -- the "reviewer" half of author/reviewer/approver (§88.5), distinct from the Director''s final promote/reject decision.';

create index protocol_draft_comments_draft_idx on public.protocol_draft_comments (draft_id, created_at);

alter table public.protocol_draft_comments enable row level security;

create policy protocol_draft_comments_select on public.protocol_draft_comments
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy protocol_draft_comments_insert on public.protocol_draft_comments
  for insert to authenticated
  with check (private.is_clinical_tier(organisation_id));

grant select, insert on public.protocol_draft_comments to authenticated;
revoke update, delete on public.protocol_draft_comments from authenticated;

create or replace function private.enforce_protocol_draft_comment_attribution()
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
    and active
    and (
      is_clinical_director
      or doctor_tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
    )
  limit 1;

  if v_staff_id is null then
    raise exception 'Only a clinical-tier member of the care team can comment on a protocol draft.'
      using errcode = '42501';
  end if;

  new.commented_by_staff := v_staff_id;
  return new;
end;
$$;

create trigger protocol_draft_comments_enforce_attribution
  before insert on public.protocol_draft_comments
  for each row execute function private.enforce_protocol_draft_comment_attribution();

revoke all on function private.enforce_protocol_draft_comment_attribution() from public;

-- ---------------------------------------------------------------------------
-- Promote / reject -- Director-only (mirrors stamp_protocol_version_approver
-- exactly), the one path from draft to a real, signed protocol_versions row.
-- ---------------------------------------------------------------------------

create or replace function public.promote_protocol_draft(p_draft_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.protocol_drafts%rowtype;
  v_director uuid;
  v_next_version int;
  v_new_version_id uuid;
begin
  select * into v_draft from public.protocol_drafts where id = p_draft_id;
  if v_draft.id is null then
    raise exception 'Protocol draft not found';
  end if;
  if v_draft.status in ('promoted', 'rejected') then
    raise exception 'This draft is already %', v_draft.status;
  end if;

  select id into v_director
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = v_draft.organisation_id
    and active
    and is_clinical_director;
  if v_director is null then
    raise exception 'Only the org''s active Clinical Director can promote a protocol draft'
      using errcode = '42501';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.protocol_versions
  where organisation_id = v_draft.organisation_id and protocol_id = v_draft.protocol_id;

  -- approved_by/approved_at are re-derived by stamp_protocol_version_approver
  -- regardless of what's inserted here -- this call is not a privilege
  -- escalation path, it's the same insert the existing UI performs.
  insert into public.protocol_versions
    (organisation_id, protocol_id, version_number, title, change_summary, content,
     evidence_basis, applicable_population, specialty)
  values
    (v_draft.organisation_id, v_draft.protocol_id, v_next_version, v_draft.title, v_draft.change_summary, v_draft.content,
     v_draft.evidence_basis, v_draft.applicable_population, v_draft.specialty)
  returning id into v_new_version_id;

  update public.protocol_drafts
  set status = 'promoted', promoted_to_version_id = v_new_version_id
  where id = p_draft_id;

  return v_new_version_id;
end;
$$;

comment on function public.promote_protocol_draft(uuid) is
  'Director-only. Inserts the draft''s content into protocol_versions (the same insert the existing protocol UI performs -- stamp_protocol_version_approver still does the real attribution/authority enforcement) and marks the draft promoted. The one path from a reviewed draft to a signed protocol version.';

revoke all on function public.promote_protocol_draft(uuid) from public;
revoke all on function public.promote_protocol_draft(uuid) from anon;
grant execute on function public.promote_protocol_draft(uuid) to authenticated;

create or replace function public.reject_protocol_draft(p_draft_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_director uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A rejection needs a stated reason.';
  end if;

  select organisation_id into v_org from public.protocol_drafts where id = p_draft_id and status not in ('promoted', 'rejected');
  if v_org is null then
    raise exception 'Protocol draft not found, or already promoted/rejected';
  end if;

  select id into v_director
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = v_org
    and active
    and is_clinical_director;
  if v_director is null then
    raise exception 'Only the org''s active Clinical Director can reject a protocol draft'
      using errcode = '42501';
  end if;

  update public.protocol_drafts
  set status = 'rejected', rejected_reason = p_reason
  where id = p_draft_id;
end;
$$;

comment on function public.reject_protocol_draft(uuid, text) is
  'Director-only. Terminal -- a rejected draft cannot be revived; author starts a new one if the protocol still needs the change.';

revoke all on function public.reject_protocol_draft(uuid, text) from public;
revoke all on function public.reject_protocol_draft(uuid, text) from anon;
grant execute on function public.reject_protocol_draft(uuid, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'protocol_drafts') then
    raise exception 'protocol_drafts missing after migration';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'protocol_draft_comments') then
    raise exception 'protocol_draft_comments missing after migration';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'promote_protocol_draft'
  ) then
    raise exception 'promote_protocol_draft was not created';
  end if;
  if has_function_privilege('anon', 'public.promote_protocol_draft(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute promote_protocol_draft';
  end if;
  if has_function_privilege('anon', 'public.reject_protocol_draft(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute reject_protocol_draft';
  end if;
  raise notice 'PASS: protocol_drafts + comments + promote/reject RPCs created, anon denied';
end $$;
