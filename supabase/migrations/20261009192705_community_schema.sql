-- Community (patient peer-support groups), Phase 1, part 1 of 4: the schema.
--
-- Design:    docs/COMMUNITY_SPEC.md
-- Decisions: docs/DECISIONS.md, "Community decisions, 2026-10-09" (COM-1 to COM-10) and OQ-COM-01 to OQ-COM-10.
--
-- ORGANISATION EXCEPTION (COM-7, deliberate). Every other patient-scoped table filters by organisation_id. Community
-- does not: every group belongs to the single Tarragon-owned organisation (the creating admin's organisation), and
-- MEMBERSHIP, not organisation, gates access, so an employer's staff and a direct patient can sit in the same hypertension
-- group. The counterweight is that institutions (employers, HMOs, payers, NGOs, sponsors) can read NOTHING here, not even
-- counts per organisation, and private.is_org_staff() is not used by anything in this feature.
--
-- ACCESS MODEL. Every table is RPC-only. RLS is enabled with NO policy (default deny) and all table privileges are
-- revoked from authenticated, anon and service_role. Members read and write only through the SECURITY DEFINER functions
-- in the next migrations, which return a pseudonymous handle and never a profile id. RLS is row-level, not column-level,
-- so hiding the author's identity needs the function boundary. service_role is revoked too, so an edge function with the
-- service key cannot read the community either.
--
-- Nothing here is switched on: groups are born as drafts, and the `community` go-live guard (migration 4) is off.
-- No sensitive group can exist (COM-2): a CHECK forbids it until a later migration relaxes it after a written decision.

-- ---------------------------------------------------------------------------
-- 0. Small helpers
-- ---------------------------------------------------------------------------
create or replace function private.community_set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.community_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: a record is never changed or removed', tg_table_name using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Versioned configuration (PROPOSED values live here, never in code). Seeded in migration 4.
-- ---------------------------------------------------------------------------
create table public.community_config (
  version     integer primary key check (version >= 1),
  is_active   boolean not null default false,
  params      jsonb not null,
  created_at  timestamptz not null default now()
);
create unique index community_config_one_active on public.community_config ((true)) where is_active;
comment on table public.community_config is
  'Community: versioned PROPOSED tunables (post length, rate limits, thresholds, retention). New version, never an edit. Mirrors packages/shared/src/proposed-config community.rules; a test fails if they drift.';

-- A version's values never change (INV-16: every decision can name the version it used). Only is_active may move.
create or replace function private.community_config_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a community config version is never deleted' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.version is distinct from old.version or new.params is distinct from old.params or new.created_at is distinct from old.created_at) then
    raise exception 'a community config version never changes; make a new version' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger community_config_guard before update or delete on public.community_config
  for each row execute function private.community_config_guard();
create trigger community_config_no_truncate before truncate on public.community_config
  for each statement execute function private.community_append_only();

-- ---------------------------------------------------------------------------
-- 2. Topics and groups
-- ---------------------------------------------------------------------------
create table public.community_topics (
  code               text primary key check (code ~ '^[a-z][a-z0-9_]{2,40}$'),
  label              text not null check (length(btrim(label)) between 2 and 80),
  description        text,
  sort_order         integer not null default 100,
  is_active          boolean not null default true,
  -- A topic whose group rules the CMO must approve before a group on it can go live (OQ-COM-09: weight loss).
  requires_cmo_rules boolean not null default false,
  created_at         timestamptz not null default now()
);

create table public.community_groups (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  slug                   text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,58}[a-z0-9]$'),
  name                   text not null check (length(btrim(name)) between 3 and 80),
  description            text not null default '' check (length(description) <= 600),
  topic_code             text not null references public.community_topics (code) on delete restrict,
  rules_text             text not null check (length(btrim(rules_text)) > 0),
  rules_version          integer not null default 1 check (rules_version >= 1),
  rules_approved_by      uuid references public.profiles (id) on delete restrict,
  rules_approved_at      timestamptz,
  rules_approved_version integer,
  sensitivity            text not null default 'standard' check (sensitivity in ('standard', 'sensitive')),
  join_mode              text not null default 'open' check (join_mode in ('open', 'request', 'invite')),
  min_age                integer not null default 18,
  -- Soft size cap: a full group refuses new joins (an admin raises it, or opens a sibling group). Null means no cap.
  -- Pictures in posts, off unless an admin turns it on for the group. Every picture waits for a moderator before anyone else sees it.
  images_allowed         boolean not null default false,
  member_cap             integer check (member_cap is null or member_cap between 10 and 100000),
  status                 text not null default 'draft' check (status in ('draft', 'active', 'read_only', 'archived')),
  -- Declared staffed hours (Africa/Lagos), used by the new-member rule. Shape is validated by the scan function, not here.
  moderated_hours        jsonb,
  -- Null for a group seeded by a migration: a row is never attributed to a person who did not create it.
  created_by             uuid references public.profiles (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- COM-4: adults only. COM-2: no sensitive group at launch. Relaxing either is a new migration after a written decision.
  constraint community_groups_adults_only check (min_age >= 18),
  constraint community_groups_no_sensitive_at_launch check (sensitivity = 'standard'),
  constraint community_groups_approval_is_whole check (
    (rules_approved_by is null and rules_approved_at is null and rules_approved_version is null)
    or (rules_approved_by is not null and rules_approved_at is not null and rules_approved_version is not null))
);
create index community_groups_status_idx on public.community_groups (status, topic_code);

create or replace function private.community_groups_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_requires boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'a community group is archived, never deleted' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'a community group is created as a draft' using errcode = '42501';
    end if;
    new.rules_version := 1;
    new.rules_approved_by := null; new.rules_approved_at := null; new.rules_approved_version := null;
    return new;
  end if;

  if new.organisation_id is distinct from old.organisation_id
     or new.created_by is distinct from old.created_by
     or new.slug is distinct from old.slug then
    raise exception 'a community group''s organisation, creator and slug never change' using errcode = '42501';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'an archived community group stays archived' using errcode = '42501';
  end if;

  -- Editing the rules starts a new version and drops any approval of the old text.
  if new.rules_text is distinct from old.rules_text then
    new.rules_version := old.rules_version + 1;
    if new.rules_approved_version is not distinct from old.rules_approved_version then
      new.rules_approved_by := null; new.rules_approved_at := null; new.rules_approved_version := null;
    end if;
  end if;

  -- An approval can only be given by an active Chief Medical Officer, and only for the current version.
  if new.rules_approved_by is not null
     and (new.rules_approved_by is distinct from old.rules_approved_by or new.rules_approved_version is distinct from old.rules_approved_version) then
    if not exists (
      select 1 from public.clinical_staff
       where profile_id = new.rules_approved_by and active and doctor_tier = 'chief_medical_officer'
    ) then
      raise exception 'group rules can only be approved by an active Chief Medical Officer' using errcode = '42501';
    end if;
    if new.rules_approved_version is distinct from new.rules_version then
      raise exception 'the approval names rules version %, the group is on version %', new.rules_approved_version, new.rules_version using errcode = '22023';
    end if;
  end if;

  -- A group can be live only with rules, and (for a topic that needs it) CMO-approved current rules.
  if new.status = 'active' then
    if length(btrim(new.rules_text)) = 0 then
      raise exception 'a live community group needs rules' using errcode = '23514';
    end if;
    select t.requires_cmo_rules into v_requires from public.community_topics t where t.code = new.topic_code;
    if coalesce(v_requires, false) and not (
         new.rules_approved_by is not null and new.rules_approved_version = new.rules_version
         and exists (select 1 from public.clinical_staff
                      where profile_id = new.rules_approved_by and active and doctor_tier = 'chief_medical_officer')) then
      raise exception 'the rules of a % group need the current Chief Medical Officer approval before it goes live', new.topic_code using errcode = '42501';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger community_groups_guard before insert or update or delete on public.community_groups
  for each row execute function private.community_groups_guard();
create trigger community_groups_no_truncate before truncate on public.community_groups
  for each statement execute function private.community_append_only();

-- ---------------------------------------------------------------------------
-- 3. Memberships: the ONLY place a profile is tied to a group. Handles are per group and system-issued.
-- ---------------------------------------------------------------------------
create table public.community_memberships (
  group_id               uuid not null references public.community_groups (id) on delete restrict,
  profile_id             uuid not null references public.profiles (id) on delete cascade,
  handle                 text not null check (handle ~ '^[a-z]{3,12}-[a-z]{3,12}-[0-9]{2,3}$'),
  avatar_code            text not null check (avatar_code ~ '^[a-z0-9_]{1,30}$'),
  status                 text not null default 'active' check (status in ('pending', 'active', 'left', 'suspended', 'banned')),
  rules_accepted_version integer not null,
  rules_accepted_at      timestamptz not null default now(),
  -- COM-6: consent to be identified to the care team ONLY if a post suggests danger. The wording is counsel's; the version
  -- of the text the member saw is recorded.
  consent_version        text not null,
  consented_at           timestamptz not null default now(),
  -- Opt-in weekly digest: one fixed in-app notice, never the group name (INV-07).
  digest_opt_in          boolean not null default false,
  joined_at              timestamptz not null default now(),
  left_at                timestamptz,
  muted_until            timestamptz,
  notifications_muted    boolean not null default false,
  approved_post_count    integer not null default 0 check (approved_post_count >= 0),
  primary key (group_id, profile_id)
);
create unique index community_memberships_handle_uniq on public.community_memberships (group_id, lower(handle));
create index community_memberships_profile_idx on public.community_memberships (profile_id, status);

-- ---------------------------------------------------------------------------
-- 4. Posts (one level of reply), reactions
-- ---------------------------------------------------------------------------
create table public.community_posts (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.community_groups (id) on delete restrict,
  -- Set null (not cascade) so a deleted account leaves a tombstone and the replies still make sense.
  author_profile_id uuid references public.profiles (id) on delete set null,
  -- The handle as it was when the post was written. Feeds read this and never join profiles.
  author_handle     text not null,
  parent_post_id    uuid references public.community_posts (id) on delete restrict,
  body              text not null check (length(body) between 1 and 5000),
  state             text not null default 'visible'
                      check (state in ('visible', 'held', 'auto_hidden', 'removed', 'deleted_by_author')),
  hold_reason_codes text[] not null default '{}',
  rule_set_version  integer,
  client_request_id uuid,
  support_count     integer not null default 0 check (support_count >= 0),
  created_at        timestamptz not null default now(),
  edited_at         timestamptz,
  removed_at        timestamptz,
  removed_by        uuid references public.profiles (id) on delete set null,
  removed_reason_code text
);
create unique index community_posts_retry_uniq on public.community_posts (author_profile_id, client_request_id) where client_request_id is not null;
create index community_posts_feed_idx on public.community_posts (group_id, created_at desc) where state = 'visible' and parent_post_id is null;
create index community_posts_replies_idx on public.community_posts (parent_post_id, created_at) where parent_post_id is not null;
create index community_posts_review_idx on public.community_posts (group_id, created_at) where state in ('held', 'auto_hidden');
create index community_posts_author_idx on public.community_posts (author_profile_id, created_at desc);

create or replace function private.community_posts_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_parent public.community_posts;
begin
  if tg_op = 'DELETE' then
    raise exception 'a community post is never deleted by hand; it is removed or deleted by its author, then purged on schedule' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.parent_post_id is not null then
      select * into v_parent from public.community_posts where id = new.parent_post_id;
      if not found or v_parent.group_id <> new.group_id then
        raise exception 'a reply belongs to a post in the same group' using errcode = '23514';
      end if;
      if v_parent.parent_post_id is not null then
        raise exception 'replies are one level deep' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;
  if new.group_id is distinct from old.group_id
     or new.author_handle is distinct from old.author_handle
     or new.parent_post_id is distinct from old.parent_post_id
     or new.created_at is distinct from old.created_at
     -- The author link may become null (the account was deleted: ON DELETE SET NULL fires this trigger) but never change to someone else.
     or (new.author_profile_id is not null and new.author_profile_id is distinct from old.author_profile_id) then
    raise exception 'a community post''s group, author, handle, parent and time never change' using errcode = '42501';
  end if;
  -- The one way back: a moderator's removal overturned on appeal (the appeal function sets this for its own transaction only).
  if old.state = 'removed' and new.state = 'visible' and coalesce(current_setting('community.restore_on_appeal', true), '') = 'on' then
    return new;
  end if;
  if old.state in ('removed', 'deleted_by_author') and new.state not in ('removed', 'deleted_by_author') then
    raise exception 'a removed post stays removed' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger community_posts_guard before insert or update or delete on public.community_posts
  for each row execute function private.community_posts_guard();
create trigger community_posts_no_truncate before truncate on public.community_posts
  for each statement execute function private.community_append_only();

create table public.community_reactions (
  post_id    uuid not null references public.community_posts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- 5. Moderation: reports, sanctions, an append-only event log (generic, so S69 17.9 can reuse it)
-- ---------------------------------------------------------------------------
create table public.community_reports (
  id                  uuid primary key default gen_random_uuid(),
  subject_kind        text not null default 'post' check (subject_kind in ('post')),
  post_id             uuid not null references public.community_posts (id) on delete cascade,
  reporter_profile_id uuid not null references public.profiles (id) on delete cascade,
  reason_code         text not null check (reason_code in ('contact_details', 'selling_or_promotion', 'medical_misinformation', 'harassment', 'self_harm_or_danger', 'privacy', 'other')),
  detail              text check (detail is null or length(detail) <= 500),
  status              text not null default 'open' check (status in ('open', 'upheld', 'dismissed')),
  created_at          timestamptz not null default now(),
  resolved_by         uuid references public.profiles (id) on delete set null,
  resolved_at         timestamptz,
  unique (post_id, reporter_profile_id)
);
create index community_reports_open_idx on public.community_reports (post_id) where status = 'open';

create table public.community_sanctions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  -- null group means platform-wide.
  group_id     uuid references public.community_groups (id) on delete restrict,
  kind         text not null check (kind in ('warning', 'mute', 'suspend', 'ban')),
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,
  reason_code  text not null,
  issued_by    uuid references public.profiles (id) on delete set null,
  source_post_id uuid references public.community_posts (id) on delete set null,
  appeal_state text not null default 'none' check (appeal_state in ('none', 'requested', 'upheld', 'overturned')),
  created_at   timestamptz not null default now(),
  -- A mute or suspension has an end; a warning or a ban does not.
  constraint community_sanctions_timed check ((kind in ('mute', 'suspend')) = (ends_at is not null))
);
create index community_sanctions_profile_idx on public.community_sanctions (profile_id, group_id, kind);

create table public.community_moderation_events (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid references public.community_groups (id) on delete restrict,
  subject_kind      text not null default 'post',
  subject_id        uuid,
  -- The member the event is about. Staff queues never return it; it exists so cool-downs and sanction ladders can count.
  member_profile_id uuid references public.profiles (id) on delete set null,
  action            text not null,
  actor_id          uuid references public.profiles (id) on delete set null,
  reason_code       text,
  -- Rule ids and classes only. NEVER the matched text: a blocked phone number must not be written to our database.
  filter_hits       jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now()
);
create index community_moderation_events_member_idx on public.community_moderation_events (member_profile_id, action, created_at desc);
create index community_moderation_events_subject_idx on public.community_moderation_events (subject_id);

-- Append-only, with ONE exception: the person columns may be set to NULL and nothing else may change. Deleting an account performs exactly that
-- (member_profile_id and actor_id are ON DELETE SET NULL, which is an UPDATE), and the right to erasure must not be blocked by a log.
create or replace function private.community_events_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'community_moderation_events is append-only: a record is never removed' using errcode = '42501';
  end if;
  if (new.member_profile_id is null or new.member_profile_id is not distinct from old.member_profile_id)
     and (new.actor_id is null or new.actor_id is not distinct from old.actor_id)
     and (new.id, new.group_id, new.subject_kind, new.subject_id, new.action, new.reason_code, new.filter_hits, new.created_at)
         is not distinct from (old.id, old.group_id, old.subject_kind, old.subject_id, old.action, old.reason_code, old.filter_hits, old.created_at) then
    return new;
  end if;
  raise exception 'community_moderation_events is append-only: only the person columns may be cleared (erasure)' using errcode = '42501';
end $$;

create trigger community_moderation_events_append_only before update or delete on public.community_moderation_events
  for each row execute function private.community_events_guard();
create trigger community_moderation_events_no_truncate before truncate on public.community_moderation_events
  for each statement execute function private.community_append_only();

-- ---------------------------------------------------------------------------
-- 6. Filter rule sets (versioned, INV-16). Safety classes can only be activated by the CMO.
-- ---------------------------------------------------------------------------
create table public.community_filter_rule_sets (
  version      integer primary key check (version >= 1),
  status       text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  -- allowed_hosts: exact hostnames a post may link to (COM-10: Tarragon-owned pages only).
  params       jsonb not null default '{"allowed_hosts": []}'::jsonb,
  notes        text,
  approved_by  uuid references public.profiles (id) on delete restrict,
  approved_at  timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint community_rule_sets_active_is_approved check (status = 'draft' or (approved_by is not null and approved_at is not null))
);
create unique index community_filter_rule_sets_one_active on public.community_filter_rule_sets ((true)) where status = 'active';

create table public.community_filter_rules (
  id               bigint generated always as identity primary key,
  rule_set_version integer not null references public.community_filter_rule_sets (version) on delete restrict,
  class            text not null check (class in ('contact', 'contact_platform', 'commerce', 'cure_claim', 'medicine_instruction', 'abuse', 'spam', 'eating_disorder', 'self_harm', 'emergency')),
  -- detector: a named procedural detector (phone_digits, email, url, handle). regex: a Postgres regular expression run on the normalised text.
  kind             text not null check (kind in ('detector', 'regex')),
  pattern          text not null check (length(pattern) between 1 and 400),
  action           text not null check (action in ('block', 'hold', 'safety')),
  note             text,
  unique (rule_set_version, class, kind, pattern),
  constraint community_rules_safety_pairing check ((class in ('self_harm', 'emergency')) = (action = 'safety')),
  constraint community_rules_detector_names check (kind <> 'detector' or pattern in ('phone_digits', 'email', 'url', 'handle'))
);

create or replace function private.community_rule_sets_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_safety boolean;
  v_ok boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'a filter rule set is retired, never deleted' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'a filter rule set is created as a draft' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status <> 'draft' and (new.params is distinct from old.params or new.version is distinct from old.version) then
    raise exception 'an activated filter rule set never changes; make a new version' using errcode = '42501';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'a retired filter rule set stays retired' using errcode = '42501';
  end if;
  if new.status = 'active' and old.status is distinct from 'active' then
    -- The floor: phone numbers, email addresses, links and handles are always blocked. A rule set that drops any of the four
    -- cannot go live, whoever approves it.
    if (select count(distinct r.pattern) from public.community_filter_rules r
         where r.rule_set_version = new.version and r.kind = 'detector' and r.action = 'block'
           and r.pattern in ('phone_digits', 'email', 'url', 'handle')) <> 4 then
      raise exception 'a filter rule set cannot go live without blocking phone numbers, email addresses, links and handles' using errcode = '42501';
    end if;
    select exists (select 1 from public.community_filter_rules r where r.rule_set_version = new.version and r.class in ('self_harm', 'emergency')) into v_safety;
    if new.approved_by is null then
      raise exception 'a filter rule set needs an approver to go live' using errcode = '42501';
    end if;
    if v_safety then
      v_ok := exists (select 1 from public.clinical_staff where profile_id = new.approved_by and active and doctor_tier = 'chief_medical_officer');
      if not v_ok then
        raise exception 'a filter rule set with safety rules can only be activated by an active Chief Medical Officer' using errcode = '42501';
      end if;
    else
      v_ok := exists (select 1 from public.clinical_staff where profile_id = new.approved_by and active and doctor_tier = 'chief_medical_officer')
              or exists (select 1 from public.profiles where id = new.approved_by and role = 'admin' and is_active);
      if not v_ok then
        raise exception 'a filter rule set can only be activated by an admin or the Chief Medical Officer' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger community_rule_sets_guard before insert or update or delete on public.community_filter_rule_sets
  for each row execute function private.community_rule_sets_guard();
create trigger community_rule_sets_no_truncate before truncate on public.community_filter_rule_sets
  for each statement execute function private.community_append_only();

-- Rules can change only while their set is a draft (so what ran is what was approved).
create or replace function private.community_rules_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_version integer;
  v_status text;
begin
  v_version := case when tg_op = 'DELETE' then old.rule_set_version else new.rule_set_version end;
  select status into v_status from public.community_filter_rule_sets where version = v_version;
  if v_status is distinct from 'draft' then
    raise exception 'rules can change only while their rule set is a draft (version % is %)', v_version, coalesce(v_status, 'missing') using errcode = '42501';
  end if;
  -- A bad pattern would raise on every post once the set is live, and a slow one would stall every post (a backreference such as
  -- (.)\1{9,} cost 4.5 seconds on a 2000 character post in this regex engine). Fail when it is saved, not when a member is typing.
  if tg_op <> 'DELETE' and new.kind = 'regex' then
    if new.pattern ~ '\\[1-9]' then
      raise exception 'a filter rule cannot use a backreference (they are very slow); spell the repetition out instead' using errcode = '22023';
    end if;
    perform ''::text ~ new.pattern;
    declare
      v_t0 timestamptz;
      v_sample text;
    begin
      foreach v_sample in array array[repeat('a', 2000), repeat('1 ', 1000), repeat('hello there friends ', 100), repeat('a.', 1000)] loop
        v_t0 := clock_timestamp();
        perform v_sample ~ new.pattern;
        if clock_timestamp() - v_t0 > interval '300 milliseconds' then
          raise exception 'a filter rule must scan a 2000 character post in well under a second; this one took %', clock_timestamp() - v_t0 using errcode = '54000';
        end if;
      end loop;
    end;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger community_rules_guard before insert or update or delete on public.community_filter_rules
  for each row execute function private.community_rules_guard();
create trigger community_rules_no_truncate before truncate on public.community_filter_rules
  for each statement execute function private.community_append_only();

-- ---------------------------------------------------------------------------
-- 7. Safety signals, doctor-reviewed pinned content, staff grants
-- ---------------------------------------------------------------------------
create table public.community_safety_signals (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.community_groups (id) on delete restrict,
  post_id           uuid not null references public.community_posts (id) on delete cascade,
  author_profile_id uuid references public.profiles (id) on delete set null,
  kind              text not null check (kind in ('emergency_language', 'self_harm_language', 'reviewer_concern')),
  status            text not null default 'open' check (status in ('open', 'in_review', 'released', 'kept_withheld', 'closed')),
  rule_set_version  integer,
  handled_by        uuid references public.profiles (id) on delete set null,
  handled_at        timestamptz,
  created_at        timestamptz not null default now(),
  -- handled_by is ON DELETE SET NULL (a reviewer's account may be erased), so only the time is required once a signal is handled.
  constraint community_safety_signals_handled check (status in ('open', 'in_review') or handled_at is not null)
);
create index community_safety_signals_open_idx on public.community_safety_signals (created_at) where status in ('open', 'in_review');

create table public.community_pinned_content (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.community_groups (id) on delete restrict,
  title       text not null check (length(btrim(title)) between 3 and 120),
  body        text not null check (length(btrim(body)) between 1 and 4000),
  authored_by uuid not null references public.profiles (id) on delete restrict,
  -- Null-gated attribution: a "reviewed" badge renders only when BOTH are set. Never a hard-coded string.
  reviewed_by uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  pinned_at   timestamptz not null default now(),
  unpinned_at timestamptz,
  constraint community_pinned_review_is_whole check ((reviewed_by is null) = (reviewed_at is null)),
  constraint community_pinned_two_people check (reviewed_by is null or reviewed_by <> authored_by)
);
create index community_pinned_group_idx on public.community_pinned_content (group_id) where unpinned_at is null;

create or replace function private.community_pinned_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Unpinning, or any change that leaves author and reviewer alone, must still work after a clinician has left.
  if tg_op = 'UPDATE' and new.authored_by is not distinct from old.authored_by and new.reviewed_by is not distinct from old.reviewed_by then
    return new;
  end if;
  if not exists (select 1 from public.clinical_staff where profile_id = new.authored_by and active) then
    raise exception 'pinned group content is written by an active clinician' using errcode = '42501';
  end if;
  if new.reviewed_by is not null and not exists (select 1 from public.clinical_staff where profile_id = new.reviewed_by and active) then
    raise exception 'pinned group content is reviewed by an active clinician' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger community_pinned_guard before insert or update on public.community_pinned_content
  for each row execute function private.community_pinned_guard();

create table public.community_staff (
  id         uuid primary key default gen_random_uuid(),
  -- A grant is administrative: if the account is erased the grant ends (profile_id clears and the grant is revoked by the guard below).
  -- Governance attributions elsewhere (a CMO's rules approval, a clinician's pinned note, a rule set's approver) deliberately RESTRICT
  -- deletion: those accounts are deactivated, never erased, so the signature on a decision survives.
  profile_id uuid references public.profiles (id) on delete set null,
  scope      text not null check (scope in ('moderator', 'safety_reviewer')),
  -- null group means every group.
  group_id   uuid references public.community_groups (id) on delete restrict,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- Opt-in: a first name or a role label the staff member chooses to show members ("Ada, community moderator"). Null shows nothing.
  display_name text check (display_name is null or length(btrim(display_name)) between 2 and 40)
);
create unique index community_staff_active_uniq on public.community_staff (profile_id, scope, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;
create index community_staff_lookup_idx on public.community_staff (profile_id) where revoked_at is null;

-- COM-3: a grant on an existing non-clinical staff role. No new user_role value.
create or replace function private.community_staff_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a community staff grant is revoked, never deleted' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.profiles where id = new.profile_id and is_active and role = 'care_coordinator') then
      raise exception 'community moderation is granted to an active care coordinator account' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles where id = new.granted_by and is_active and role = 'admin') then
      raise exception 'only an admin grants community moderation' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.profile_id is not null and new.profile_id is distinct from old.profile_id)
     or new.scope is distinct from old.scope
     or new.group_id is distinct from old.group_id
     or (new.granted_by is not null and new.granted_by is distinct from old.granted_by)
     or new.granted_at is distinct from old.granted_at
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'a community staff grant can only be revoked' using errcode = '42501';
  end if;
  -- the account was erased: the grant ends with it
  if new.profile_id is null and old.profile_id is not null then
    new.revoked_at := coalesce(new.revoked_at, now());
  end if;
  return new;
end $$;
create trigger community_staff_guard before insert or update or delete on public.community_staff
  for each row execute function private.community_staff_guard();

-- ---------------------------------------------------------------------------
-- 7b. Phase 2: hiding one person, appeals, quality sampling, group prompts
-- ---------------------------------------------------------------------------
-- A member hides one author inside one group. Private to the viewer; the author is never told. Gone with either account.
create table public.community_hidden_authors (
  id         uuid primary key default gen_random_uuid(),
  viewer_id  uuid not null references public.profiles (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  group_id   uuid not null references public.community_groups (id) on delete cascade,
  handle     text not null,
  created_at timestamptz not null default now(),
  unique (viewer_id, author_id, group_id),
  constraint community_hidden_not_self check (viewer_id <> author_id)
);

-- A member's appeal of a removal or a sanction. Decided by a moderator who did not make the original decision.
create table public.community_appeals (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles (id) on delete set null,
  kind         text not null check (kind in ('removal', 'sanction')),
  post_id      uuid references public.community_posts (id) on delete set null,
  sanction_id  uuid references public.community_sanctions (id) on delete set null,
  group_id     uuid references public.community_groups (id) on delete restrict,
  reason       text not null check (length(btrim(reason)) between 10 and 1000),
  status       text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  decided_by   uuid references public.profiles (id) on delete restrict,
  decided_at   timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  created_at   timestamptz not null default now(),
  constraint community_appeals_decided check ((status = 'open') = (decided_at is null))
);
create unique index community_appeals_one_open_post on public.community_appeals (post_id) where status = 'open' and post_id is not null;
create unique index community_appeals_one_open_sanction on public.community_appeals (sanction_id) where status = 'open' and sanction_id is not null;
create index community_appeals_open_idx on public.community_appeals (created_at) where status = 'open';

-- A share of moderator decisions is re-checked by a second moderator. The sample is picked when the decision is made.
create table public.community_mod_samples (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid references public.community_posts (id) on delete set null,
  group_id    uuid not null references public.community_groups (id) on delete restrict,
  decision    text not null check (decision in ('approved', 'removed')),
  decided_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  agrees      boolean,
  note        text check (note is null or length(note) <= 500),
  constraint community_samples_reviewed check ((reviewed_at is null) = (agrees is null))
);
create index community_mod_samples_open_idx on public.community_mod_samples (created_at) where reviewed_at is null;

-- A short line the team shows at the top of a group for a period (a welcome, a weekly question). Not a post, not a reply target.
create table public.community_group_prompts (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.community_groups (id) on delete cascade,
  body       text not null check (length(btrim(body)) between 5 and 300),
  show_from  timestamptz not null default now(),
  show_until timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint community_prompts_window check (show_until is null or show_until > show_from)
);
create index community_group_prompts_idx on public.community_group_prompts (group_id, show_from desc);

-- ---------------------------------------------------------------------------
-- 7c. Phase 2b: pictures, the moderator rota, safety drills, doctor question sessions
-- ---------------------------------------------------------------------------
-- A picture attached to a post. The file lives in the private `community-images` bucket; nobody reads it except through
-- community_image_ref, which checks who is asking. One picture per post.
create table public.community_post_images (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null unique references public.community_posts (id) on delete cascade,
  group_id     uuid not null references public.community_groups (id) on delete restrict,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|png)$'),
  mime         text not null check (mime in ('image/jpeg', 'image/png')),
  size_bytes   integer not null check (size_bytes between 1 and 10485760),
  width        integer not null check (width between 1 and 20000),
  height       integer not null check (height between 1 and 20000),
  created_at   timestamptz not null default now(),
  -- set when the file has been removed from storage
  deleted_at   timestamptz
);
create index community_post_images_due_idx on public.community_post_images (created_at) where deleted_at is null;

-- Who is on duty when (Africa/Lagos). One row per day and span of whole hours; an overnight shift is two rows.
create table public.community_shifts (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.community_staff (id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),   -- 0 = Monday
  start_hour smallint not null check (start_hour between 0 and 23),
  end_hour   smallint not null check (end_hour between 1 and 24),
  created_at timestamptz not null default now(),
  constraint community_shifts_span check (end_hour > start_hour)
);
create index community_shifts_staff_idx on public.community_shifts (staff_id);

-- A rehearsal of the safety hand-off, recorded by the Chief Medical Officer.
create table public.community_tabletop_runs (
  id        uuid primary key default gen_random_uuid(),
  run_by    uuid references public.profiles (id) on delete set null,
  run_at    timestamptz not null default now(),
  passed    boolean not null,
  notes     text check (notes is null or length(notes) <= 2000),
  steps     jsonb not null default '[]'::jsonb
);

-- A one-off text session in which named doctors answer members' questions. One row per group; rows of one session share a series_id.
create table public.community_qa_sessions (
  id           uuid primary key default gen_random_uuid(),
  series_id    uuid not null,
  group_id     uuid not null references public.community_groups (id) on delete restrict,
  title        text not null check (length(btrim(title)) between 3 and 80),
  intro        text not null default '' check (length(intro) <= 300),
  opens_at     timestamptz not null,
  closes_at    timestamptz not null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint community_qa_window check (closes_at > opens_at and closes_at <= opens_at + interval '12 hours'),
  unique (series_id, group_id)
);
create index community_qa_sessions_group_idx on public.community_qa_sessions (group_id, opens_at desc);

create table public.community_qa_doctors (
  series_id  uuid not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  primary key (series_id, profile_id)
);

alter table public.community_posts add column qa_session_id uuid references public.community_qa_sessions (id) on delete set null;

create table public.community_qa_answers (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.community_qa_sessions (id) on delete restrict,
  question_post_id uuid not null references public.community_posts (id) on delete cascade,
  -- The doctor's real name as it was when they answered (null-gated attribution: shown only with a real answer record).
  doctor_profile_id uuid references public.profiles (id) on delete set null,
  doctor_name      text not null check (length(btrim(doctor_name)) between 2 and 120),
  body             text not null check (length(btrim(body)) between 5 and 1500),
  created_at       timestamptz not null default now(),
  removed_at       timestamptz
);
create index community_qa_answers_question_idx on public.community_qa_answers (question_post_id) where removed_at is null;

-- ---------------------------------------------------------------------------
-- 8. Lock everything down. RLS on, no policy (default deny), no table privilege for anyone but the owner.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'community_config', 'community_topics', 'community_groups', 'community_memberships', 'community_posts',
    'community_reactions', 'community_reports', 'community_sanctions', 'community_moderation_events',
    'community_filter_rule_sets', 'community_filter_rules', 'community_safety_signals',
    'community_pinned_content', 'community_staff',
    'community_hidden_authors', 'community_appeals', 'community_mod_samples', 'community_group_prompts',
    'community_post_images', 'community_shifts', 'community_tabletop_runs', 'community_qa_sessions', 'community_qa_doctors', 'community_qa_answers']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

revoke all on function private.community_set_updated_at(), private.community_append_only(),
  private.community_groups_guard(), private.community_posts_guard(), private.community_rule_sets_guard(),
  private.community_rules_guard(), private.community_pinned_guard(), private.community_staff_guard(),
  private.community_config_guard(), private.community_events_guard() from public;

comment on table public.community_memberships is
  'Community: the only table tying a profile to a group. RPC-only; never exposed to members, staff queues or institutions. Handles are per group and system-issued.';
comment on table public.community_moderation_events is
  'Community: append-only moderation log. filter_hits holds rule ids and classes, never the matched text.';

-- ---------------------------------------------------------------------------
-- 9. Self-check (the migration refuses to finish if the lock-down did not hold)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'community_config', 'community_topics', 'community_groups', 'community_memberships', 'community_posts',
    'community_reactions', 'community_reports', 'community_sanctions', 'community_moderation_events',
    'community_filter_rule_sets', 'community_filter_rules', 'community_safety_signals',
    'community_pinned_content', 'community_staff',
    'community_hidden_authors', 'community_appeals', 'community_mod_samples', 'community_group_prompts',
    'community_post_images', 'community_shifts', 'community_tabletop_runs', 'community_qa_sessions', 'community_qa_doctors', 'community_qa_answers']
  loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'community self-check: RLS is off on %', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('service_role', 'public.' || t, 'SELECT')
       or has_table_privilege('service_role', 'public.' || t, 'INSERT') then
      raise exception 'community self-check: % is reachable by a client role', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception 'community self-check: % has a policy, but community tables are RPC-only', t;
    end if;
  end loop;
end $$;
