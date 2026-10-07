-- S55: Learning Centre governance (spec Module 9, functions 9.1 to 9.8), part 1 of 2.
-- Part 2 (the patient read functions) is 20261007004500_s55_learning_read_functions.sql.
--
-- D1: mapped onto the LIVE tables. No content_items / course_progress. New tables only where nothing live exists:
--   health_education_search_aliases (9.3) and creators (9.7).
--
-- What this adds (all additive)
--   * health_education_content: audio_clip_id and next_action (S33 already added both live; "if not exists" here so a fresh
--     replay without S33 still works and S33's own earlier migration is not broken), clinical_owner_id (a link to a verified
--     clinical_staff row, 9.6), next_step_kind + next_step_target_code (9.4, next_action is the visible label),
--     series_tag (9.5), is_public (9.8), members_only and creator_id (9.7).
--   * Publish gate (trigger): a row cannot become published without a next step (9.4). A lesson in a programme must be 1..5
--     minutes (9.2), enforced here and on programme modules. A public row must carry a complete review record.
--     A row that was ALREADY published and only returns from review_due is exempt from the next-step rule, so the 213+6 live
--     rows are not locked out of the cron's review cycle; they are asked for a next step when next edited by an admin in the UI.
--   * health_education_search_aliases: clinician-reviewable everyday-term synonyms (BP, sugar, high blood). Search only uses a
--     row once the CMO has marked it clinician_reviewed. Seeded rows are DRAFT. Editing a reviewed row sends it back to draft.
--   * creators + RPCs: verified Nigerian clinicians (an active clinical_staff row with a verified credential, not suspended, not
--     a care coordinator) can apply, an admin or the CMO approves, an approved creator submits content INTO the existing review
--     workflow (status clinical_review). Creator content is members_only, can only be published from approved or review_due,
--     needs a reviewer who is not the creator, and is hidden again if the creator stops being verified. No payout, no payment.
--   * mirror_marketing_resource_to_learning(): copies a public marketing article into the in-app library as a DRAFT myth-busting
--     item (never reviewed, never published by this function).
--
-- Live counts read-only 2026-10-07 on koiplnmbgnqnbywhpjlf: 249 content rows (219 published, 30 draft), 3 programmes
-- (hypertension_education_programme, diabetes_education_programme, bp_care_course inactive), 26 programme modules, all with
-- estimated_minutes between 1 and 5 (0 null, 0 above 5), 2 active clinical_staff, 0 creators, 0 aliases.

-- ---------------------------------------------------------------------------
-- 1. Content columns
-- ---------------------------------------------------------------------------
alter table public.health_education_content
  add column if not exists audio_clip_id text,
  add column if not exists next_action text,
  add column if not exists clinical_owner_id uuid references public.clinical_staff (id) on delete restrict,
  add column if not exists next_step_kind text,
  add column if not exists next_step_target_code text,
  add column if not exists series_tag text,
  add column if not exists is_public boolean not null default false,
  add column if not exists members_only boolean not null default false,
  add column if not exists creator_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'health_education_content_audio_clip_id_format') then
    alter table public.health_education_content
      add constraint health_education_content_audio_clip_id_format check (audio_clip_id is null or audio_clip_id ~ '^[A-Z]{3}-[A-Z0-9]+$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'health_education_content_next_action_length') then
    alter table public.health_education_content
      add constraint health_education_content_next_action_length check (next_action is null or length(next_action) between 5 and 400);
  end if;
end $$;

alter table public.health_education_content
  add constraint health_education_content_next_step_kind_check
    check (next_step_kind is null or next_step_kind in ('care_plan_goal', 'booking', 'lesson')),
  add constraint health_education_content_next_step_target_check
    check (next_step_kind is distinct from 'lesson' or next_step_target_code is not null),
  add constraint health_education_content_series_tag_check
    check (series_tag is null or series_tag ~ '^[a-z][a-z_]{1,39}$'),
  add constraint health_education_content_public_not_members_check
    check (not (is_public and members_only));

comment on column public.health_education_content.clinical_owner_id is
  'The verified clinician (clinical_staff row) who reviewed this item (S55, 9.6). The patient-facing reviewer name comes from here when set, else from the free-text reviewed_by_name. Never inferred.';
comment on column public.health_education_content.next_action is
  'The visible "what can I do next" line (spec 9.4). With next_step_kind (care_plan_goal | booking | lesson) and, for a lesson, next_step_target_code, it is the standard footer. Required before an item can be published.';
comment on column public.health_education_content.members_only is
  'Creator series are a Members-only perk (S55, 9.7). A non-member sees the item locked, with no body.';

-- ---------------------------------------------------------------------------
-- 2. Verified-clinician test and the lesson length rule
-- ---------------------------------------------------------------------------
create or replace function private.is_verified_clinician(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff cs
    where cs.id = p_staff
      and cs.active
      and cs.status = 'active'
      and cs.suspended_at is null
      and cs.credential_verified_at is not null
      and (cs.license_expires_at is null or cs.license_expires_at > now())
      and cs.doctor_tier is not null
      and cs.doctor_tier <> 'care_coordinator'
  );
$$;
revoke all on function private.is_verified_clinician(uuid) from public, anon, authenticated;

create or replace function private.learning_max_lesson_minutes()
returns integer
language sql
immutable
set search_path = ''
as $$ select 5 $$;
revoke all on function private.learning_max_lesson_minutes() from public, anon, authenticated;
comment on function private.learning_max_lesson_minutes() is
  'Spec 9.2: a lesson in a course is under five minutes. Mirrored in packages/shared proposed-config (learning.max_lesson_minutes); a Jest test keeps the two equal.';

create or replace function private.learning_can_govern()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
      or exists (select 1 from public.clinical_staff cs
                  where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier = 'chief_medical_officer');
$$;
revoke all on function private.learning_can_govern() from public, anon;
-- Called inside RLS policies, which run as the caller, so authenticated needs EXECUTE (it only answers about the caller).
grant execute on function private.learning_can_govern() to authenticated;

create or replace function private.learning_is_cmo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.clinical_staff cs
                  where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier = 'chief_medical_officer');
$$;
revoke all on function private.learning_is_cmo() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Publish gate on content
-- ---------------------------------------------------------------------------
create or replace function private.health_education_content_publish_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max integer := private.learning_max_lesson_minutes();
  v_in_programme boolean;
begin
  -- 9.4: a next step before publication. An item that is only returning from review_due was already published once.
  if new.content_status = 'published'
     and (tg_op = 'INSERT' or old.content_status is distinct from 'published')
     and not (tg_op = 'UPDATE' and old.content_status = 'review_due') then
    if new.next_action is null or new.next_step_kind is null then
      raise exception 'health_education_next_step_required: add a "what can I do next" line and its kind before publishing %', new.code
        using errcode = '23514';
    end if;
    if new.next_step_kind = 'lesson'
       and not exists (select 1 from public.health_education_content t where t.code = new.next_step_target_code and t.id <> new.id) then
      raise exception 'health_education_next_step_target_unknown: no lesson has the code %', new.next_step_target_code using errcode = '23514';
    end if;
  end if;

  -- 9.2: a lesson in a programme is 1..5 minutes.
  if tg_op = 'UPDATE'
     and (new.estimated_minutes is distinct from old.estimated_minutes
          or (new.content_status = 'published' and old.content_status is distinct from 'published')) then
    select exists (select 1 from public.health_education_programme_modules m where m.content_id = new.id) into v_in_programme;
    if v_in_programme and (new.estimated_minutes is null or new.estimated_minutes < 1 or new.estimated_minutes > v_max) then
      raise exception 'health_education_lesson_length: a course lesson must be between 1 and % minutes (got %)', v_max, coalesce(new.estimated_minutes::text, 'none')
        using errcode = '23514';
    end if;
  end if;

  -- 9.8: a public item carries a complete review record, and is never a Members item.
  if new.is_public and (tg_op = 'INSERT' or old.is_public is distinct from true) then
    if not (new.clinician_reviewed and new.reviewed_at is not null) then
      raise exception 'health_education_public_needs_review: only a clinician-reviewed item (with a review date) can be public' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function private.health_education_content_publish_gate() from public, anon, authenticated;

drop trigger if exists health_education_content_publish_gate on public.health_education_content;
create trigger health_education_content_publish_gate
  before insert or update on public.health_education_content
  for each row execute function private.health_education_content_publish_gate();

create or replace function private.health_education_module_length_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max integer := private.learning_max_lesson_minutes();
  v_min integer;
begin
  select c.estimated_minutes into v_min from public.health_education_content c where c.id = new.content_id;
  if v_min is null or v_min < 1 or v_min > v_max then
    raise exception 'health_education_lesson_length: a course lesson must be between 1 and % minutes (got %)', v_max, coalesce(v_min::text, 'none')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.health_education_module_length_gate() from public, anon, authenticated;

drop trigger if exists health_education_programme_modules_length_gate on public.health_education_programme_modules;
create trigger health_education_programme_modules_length_gate
  before insert or update of content_id on public.health_education_programme_modules
  for each row execute function private.health_education_module_length_gate();

-- ---------------------------------------------------------------------------
-- 4. Search aliases (9.3)
-- ---------------------------------------------------------------------------
create table public.health_education_search_aliases (
  id               uuid primary key default gen_random_uuid(),
  alias            text not null check (char_length(btrim(alias)) between 2 and 60),
  alias_normalised text generated always as (private.normalise_term(alias)) stored,
  expands_to       text not null check (char_length(btrim(expands_to)) between 2 and 160),
  review_state     text not null default 'draft' check (review_state in ('draft', 'clinician_reviewed', 'retired')),
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  note             text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (alias_normalised is not null),
  check (review_state <> 'clinician_reviewed' or (reviewed_by is not null and reviewed_at is not null))
);
create unique index health_education_search_aliases_alias_key on public.health_education_search_aliases (alias_normalised);
alter table public.health_education_search_aliases enable row level security;

create policy health_education_search_aliases_admin_select on public.health_education_search_aliases
  for select to authenticated using (private.learning_can_govern());
create policy health_education_search_aliases_admin_insert on public.health_education_search_aliases
  for insert to authenticated with check (private.learning_can_govern());
create policy health_education_search_aliases_admin_update on public.health_education_search_aliases
  for update to authenticated using (private.learning_can_govern()) with check (private.learning_can_govern());
create policy health_education_search_aliases_admin_delete on public.health_education_search_aliases
  for delete to authenticated using (private.learning_can_govern());
revoke all on public.health_education_search_aliases from public, anon;
grant select, insert, update, delete on public.health_education_search_aliases to authenticated;

-- Only the CMO can mark an alias clinician_reviewed; editing the wording of a reviewed alias returns it to draft.
create or replace function private.health_education_alias_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.review_state = 'clinician_reviewed' and (tg_op = 'INSERT' or old.review_state is distinct from 'clinician_reviewed') then
    if not private.learning_is_cmo() then
      raise exception 'health_education_alias_review_cmo_only: only the Chief Medical Officer can mark an alias clinician reviewed' using errcode = '42501';
    end if;
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
  elsif tg_op = 'UPDATE' and old.review_state = 'clinician_reviewed' and new.review_state = 'clinician_reviewed'
        and (new.alias is distinct from old.alias or new.expands_to is distinct from old.expands_to) then
    new.review_state := 'draft';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.health_education_alias_guard() from public, anon, authenticated;
create trigger health_education_search_aliases_guard
  before insert or update on public.health_education_search_aliases
  for each row execute function private.health_education_alias_guard();

-- Draft starting points for the CMO to edit and review. Not clinical claims: they only widen which already-published,
-- already-reviewed items a search can reach. None is used by search until it is clinician_reviewed.
insert into public.health_education_search_aliases (alias, expands_to, note) values
  ('BP', 'blood pressure hypertension', 'Engineering draft, not clinician reviewed.'),
  ('high BP', 'high blood pressure hypertension', 'Engineering draft, not clinician reviewed.'),
  ('high blood', 'high blood pressure hypertension', 'Everyday term. Engineering draft, not clinician reviewed.'),
  ('pressure', 'blood pressure hypertension', 'Everyday term. Engineering draft, not clinician reviewed.'),
  ('sugar', 'blood sugar glucose diabetes', 'Everyday term. Engineering draft, not clinician reviewed.'),
  ('sugar disease', 'diabetes blood sugar glucose', 'Everyday term. Engineering draft, not clinician reviewed.'),
  ('high sugar', 'high blood sugar glucose diabetes', 'Engineering draft, not clinician reviewed.'),
  ('low sugar', 'low blood sugar hypoglycaemia glucose', 'Engineering draft, not clinician reviewed.'),
  ('sugar test', 'blood glucose test monitoring diabetes', 'Engineering draft, not clinician reviewed.')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. Creators (9.7)
-- ---------------------------------------------------------------------------
create table public.creators (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id uuid not null unique references public.clinical_staff (id) on delete restrict,
  bio               text check (bio is null or char_length(bio) <= 600),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'suspended')),
  requested_at      timestamptz not null default now(),
  decided_by        uuid references public.profiles (id) on delete set null,
  decided_at        timestamptz,
  decision_reason   text,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (status = 'pending' or (decided_by is not null and decided_at is not null))
);
create index creators_org_status_idx on public.creators (organisation_id, status);
alter table public.creators enable row level security;
create policy creators_select on public.creators
  for select to authenticated
  using (
    private.learning_can_govern()
    or exists (select 1 from public.clinical_staff cs where cs.id = creators.clinical_staff_id and cs.profile_id = (select auth.uid()))
  );
revoke all on public.creators from public, anon, authenticated;
grant select on public.creators to authenticated;

alter table public.health_education_content
  add constraint health_education_content_creator_fk foreign key (creator_id) references public.creators (id) on delete restrict;

create or replace function private.learning_creator_in_good_standing(p_creator uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.creators c
                  where c.id = p_creator and c.status = 'approved' and private.is_verified_clinician(c.clinical_staff_id));
$$;
revoke all on function private.learning_creator_in_good_standing(uuid) from public, anon, authenticated;

-- Creator content rules: Members only; only publishable after clinical review by someone other than the creator.
create or replace function private.health_education_creator_content_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_staff uuid;
begin
  if new.creator_id is null then
    return new;
  end if;
  new.members_only := true;
  new.is_public := false;
  if new.content_status = 'published' and (tg_op = 'INSERT' or old.content_status is distinct from 'published') then
    if tg_op = 'INSERT' or old.content_status not in ('approved', 'review_due') then
      raise exception 'creator_content_needs_review: creator content can only be published after clinical review (approved)' using errcode = '23514';
    end if;
    if not (new.clinician_reviewed and new.reviewed_at is not null and new.clinical_owner_id is not null) then
      raise exception 'creator_content_needs_review: a complete review record with a verified reviewer is required' using errcode = '23514';
    end if;
    select c.clinical_staff_id into v_creator_staff from public.creators c where c.id = new.creator_id;
    if new.clinical_owner_id = v_creator_staff then
      raise exception 'creator_content_self_review: the reviewer cannot be the creator' using errcode = '23514';
    end if;
    if not private.is_verified_clinician(new.clinical_owner_id) then
      raise exception 'creator_content_needs_review: the reviewer is not a verified clinician' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.health_education_creator_content_gate() from public, anon, authenticated;
create trigger health_education_content_creator_gate
  before insert or update on public.health_education_content
  for each row execute function private.health_education_creator_content_gate();

create or replace function public.apply_as_creator(p_bio text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_staff public.clinical_staff%rowtype;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into v_staff from public.clinical_staff cs where cs.profile_id = v_uid;
  if not found or not private.is_verified_clinician(v_staff.id) then
    raise exception 'creator_not_verified: only a verified clinician can apply' using errcode = '42501';
  end if;
  insert into public.creators (organisation_id, clinical_staff_id, bio, is_test)
  values (v_staff.organisation_id, v_staff.id, nullif(btrim(p_bio), ''), coalesce(v_staff.is_test, false))
  on conflict (clinical_staff_id) do update set bio = coalesce(excluded.bio, public.creators.bio), updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.apply_as_creator(text) from public, anon;
grant execute on function public.apply_as_creator(text) to authenticated;

create or replace function public.set_creator_status(p_creator uuid, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c public.creators%rowtype;
begin
  if v_uid is null or not private.learning_can_govern() then
    raise exception 'creator_not_authorised' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'suspended') then
    raise exception 'creator_bad_status' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'creator_reason_required: give a reason of at least 10 characters' using errcode = '22023';
  end if;
  select * into v_c from public.creators where id = p_creator for update;
  if not found then raise exception 'unknown creator' using errcode = '22023'; end if;
  if p_status = 'approved' and not private.is_verified_clinician(v_c.clinical_staff_id) then
    raise exception 'creator_not_verified: the clinician is not currently verified' using errcode = '23514';
  end if;
  update public.creators
     set status = p_status, decided_by = v_uid, decided_at = now(), decision_reason = p_reason, updated_at = now()
   where id = p_creator;
end;
$$;
revoke all on function public.set_creator_status(uuid, text, text) from public, anon;
grant execute on function public.set_creator_status(uuid, text, text) to authenticated;

-- A creator submits a piece INTO the existing review workflow. It lands at clinical_review: not active, not reviewed.
create or replace function public.creator_submit_content(
  p_code text, p_title text, p_summary text, p_body text,
  p_category public.health_education_category, p_content_type public.health_education_content_type,
  p_estimated_minutes integer, p_source_reference text, p_next_action text, p_next_step_kind text, p_next_step_target_code text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_creator public.creators%rowtype;
  v_name text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select c.* into v_creator from public.creators c join public.clinical_staff cs on cs.id = c.clinical_staff_id
   where cs.profile_id = v_uid;
  if not found or not private.learning_creator_in_good_standing(v_creator.id) then
    raise exception 'creator_not_approved' using errcode = '42501';
  end if;
  if p_code !~ '^cr_[a-z0-9_]{3,60}$' then
    raise exception 'creator_bad_code: use cr_ then lower-case letters, digits and underscores' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) < 50 or char_length(btrim(coalesce(p_title, ''))) < 5 then
    raise exception 'creator_content_too_short' using errcode = '22023';
  end if;
  if coalesce(p_estimated_minutes, 0) < 1 or p_estimated_minutes > 60 then
    raise exception 'creator_bad_minutes' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_source_reference, ''))) < 5 then
    raise exception 'creator_sources_required: cite at least one source' using errcode = '22023';
  end if;
  select cs.full_name into v_name from public.clinical_staff cs where cs.id = v_creator.clinical_staff_id;
  insert into public.health_education_content (
    code, title, summary, body, category, content_type, estimated_minutes, source_reference, next_action, next_step_kind,
    next_step_target_code, author_name, clinical_author_name, creator_id, members_only, content_status, clinician_reviewed)
  values (p_code, btrim(p_title), nullif(btrim(p_summary), ''), p_body, p_category, p_content_type, p_estimated_minutes,
          p_source_reference, nullif(btrim(p_next_action), ''), p_next_step_kind, p_next_step_target_code,
          v_name, v_name, v_creator.id, true, 'clinical_review', false)
  returning id into v_id;
  insert into public.health_education_content_status_history (content_id, from_status, to_status, actor_id, note)
  values (v_id, 'draft', 'clinical_review', v_uid, 'Submitted by a verified clinician creator.');
  return v_id;
end;
$$;
revoke all on function public.creator_submit_content(text, text, text, text, public.health_education_category, public.health_education_content_type, integer, text, text, text, text) from public, anon;
grant execute on function public.creator_submit_content(text, text, text, text, public.health_education_category, public.health_education_content_type, integer, text, text, text, text) to authenticated;

create or replace function public.creator_my_content()
returns table (content_id uuid, code text, title text, content_status public.health_education_content_status, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.code, c.title, c.content_status, c.updated_at
  from public.health_education_content c
  join public.creators cr on cr.id = c.creator_id
  join public.clinical_staff cs on cs.id = cr.clinical_staff_id
  where cs.profile_id = (select auth.uid())
  order by c.updated_at desc;
$$;
revoke all on function public.creator_my_content() from public, anon;
grant execute on function public.creator_my_content() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Mirror a public marketing article into the library as a DRAFT (9.5)
-- ---------------------------------------------------------------------------
create or replace function public.mirror_marketing_resource_to_learning(p_slug text, p_series_tag text default 'myth_busting')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.marketing_resources%rowtype;
  v_body text;
  v_code text;
  v_id uuid;
begin
  if v_uid is null or not private.learning_can_govern() then
    raise exception 'learning_not_authorised' using errcode = '42501';
  end if;
  select * into r from public.marketing_resources where slug = p_slug;
  if not found then raise exception 'unknown marketing resource' using errcode = '22023'; end if;
  select string_agg(coalesce(s->>'heading', '') || E'\n\n' || coalesce((select string_agg(p, E'\n\n') from jsonb_array_elements_text(s->'paragraphs') p), ''), E'\n\n')
    into v_body from jsonb_array_elements(r.sections) s;
  v_code := 'myth_' || regexp_replace(lower(p_slug), '[^a-z0-9]+', '_', 'g');
  insert into public.health_education_content (code, title, summary, body, category, content_type, estimated_minutes, series_tag, content_status, clinician_reviewed, is_public)
  values (left(v_code, 80), r.title, r.description, coalesce(v_body, r.description), 'getting_started', 'article', greatest(1, least(r.read_minutes, 60)), p_series_tag, 'draft', false, false)
  on conflict (code) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.health_education_content where code = left(v_code, 80);
  end if;
  return v_id;
end;
$$;
revoke all on function public.mirror_marketing_resource_to_learning(text, text) from public, anon;
grant execute on function public.mirror_marketing_resource_to_learning(text, text) to authenticated;

-- The myth-busting series as a programme: modules are added by an admin once items are reviewed. Active, but a programme with
-- no published, in-date, active lesson shows nothing.
insert into public.health_education_programmes (code, title, description, condition, category, is_active, sort_order)
values ('myth_busting_series', 'Common health myths', 'Short, plain answers to health myths people hear in Nigeria. Every item is reviewed by a clinician before you see it.', null, null, true, 900)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.apply_as_creator(text)', 'public.set_creator_status(uuid,text,text)', 'public.creator_my_content()',
    'public.mirror_marketing_resource_to_learning(text,text)'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated cannot execute %', f; end if;
  end loop;
  if has_function_privilege('anon', 'public.creator_submit_content(text,text,text,text,public.health_education_category,public.health_education_content_type,integer,text,text,text,text)', 'EXECUTE') then
    raise exception 'anon can execute creator_submit_content';
  end if;
  if has_table_privilege('anon', 'public.creators', 'SELECT') or has_table_privilege('anon', 'public.health_education_search_aliases', 'SELECT') then
    raise exception 'anon can read creators or aliases';
  end if;
  if has_table_privilege('authenticated', 'public.creators', 'INSERT') or has_table_privilege('authenticated', 'public.creators', 'UPDATE') then
    raise exception 'authenticated can write creators directly';
  end if;
  if (select count(*) from public.health_education_search_aliases where review_state = 'clinician_reviewed') <> 0 then
    raise exception 'an alias was seeded as reviewed';
  end if;
  if private.learning_max_lesson_minutes() <> 5 then raise exception 'lesson length constant changed'; end if;
end $$;
