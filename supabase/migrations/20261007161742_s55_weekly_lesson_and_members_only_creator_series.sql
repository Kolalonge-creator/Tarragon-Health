-- S55 follow-up (stacked on PR #1005): weekly pacing and creator series as a members-only perk.
-- Rows affected: none changed (config seed row added; no content, progress or creator row is touched).
-- Version note: this file sorts after 20261007153127 (the last #1005 migration) on purpose, so it replays after it.
--
-- 1. WEEKLY PACING (founder decision: weekly lessons, not daily). public.daily_micro_lesson() is replaced by
--    public.weekly_micro_lesson(): one lesson for the programme week, chosen with the existing weekly drip engine
--    (health_education_content.drip_week against private.health_education_unlock_week(condition), per-condition clocks).
--    Each lesson is still a micro-lesson capped by the versioned `micro_lesson` config (max_minutes, one check question, enforced by
--    the publish gate and re-checked here). A lesson finished this week stays "this week's lesson" (shown as done) until the
--    programme week turns over; an unfinished earlier-week lesson is offered as catch-up only when nothing newer is due.
--    The F1 expiry rule still applies (private.health_education_is_servable). #1005 is not applied anywhere, so the daily
--    function is dropped here rather than kept beside the weekly one.
--
-- 2. CREATOR SERIES ARE A MEMBERS-ONLY PERK (no payouts, no payment logic). Content with a creator credit
--    (health_education_content.creator_id) is "locked" for anyone who is not a Member (private.patient_is_member, the single
--    membership seam), signed out, or not staff/the creator. A locked reader still gets the title, the creator credit and the
--    summary (the teaser) but never the body, video, audio, check question, lesson action or self-care text. Enforced in the database:
--      * the table's select policy hides locked rows from a direct select;
--      * every reader that returns a body is patched (feed, library, detail, programme detail) or excludes creator content
--        (the two AI knowledge-base searches), and the weekly lesson, item trust, shared article and offline pack are new/replaced here;
--      * a progress write on a locked lesson is refused (no "understood" without the lesson).
--    A lapsed or ended membership locks the creator content again at once on every online read; a phone that stays offline keeps the
--    copy it already downloaded until its next refresh (the pack status marks it unservable and the phone removes it then; OQ-S55-14). The perk is a versioned switch: learning_config key `creator_perk` {"members_only": bool},
--    changed by an admin through set_learning_creator_perk() (new version row, audited), no deploy. Missing config fails CLOSED.
--    Core non-creator Learning Centre content (creator_id null) is unaffected and stays free for everyone.

-- ---------------------------------------------------------------------------
-- 0. The switch
-- ---------------------------------------------------------------------------
-- learning-creator-perk-begin
insert into public.learning_config (key, version, value, status, note) values
('creator_perk', 1, $json${"members_only":true}$json$::jsonb, 'proposed',
 'Founder decision: creator series are a Membership perk. true = a non-member sees title, credit and teaser only. false = creator content is open to everyone. No payment logic.')
on conflict (key, version) do nothing;
-- learning-creator-perk-end

-- ---------------------------------------------------------------------------
-- 1. Who is locked out of creator content
-- ---------------------------------------------------------------------------
-- p_patient is the person whose Membership counts. Staff (an active clinical_staff row or an admin) and the creator themselves are never locked.
create or replace function private.learning_creator_locked_for(p_creator uuid, p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_creator is not null
     and coalesce((private.learning_config('creator_perk') ->> 'members_only')::boolean, true)
     and not (p_patient is not null and coalesce(private.patient_is_member(p_patient), false))
     and not private.is_admin()
     and not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active)
     and not exists (select 1 from public.learning_creators cr where cr.id = p_creator and cr.profile_id = (select auth.uid()));
$$;

create or replace function private.learning_creator_locked(p_creator uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.learning_creator_locked_for(p_creator, (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- 2. Admin switch (new version row, audited)
-- ---------------------------------------------------------------------------
create or replace function public.set_learning_creator_perk(p_members_only boolean, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
  v_org uuid;
begin
  if not private.is_admin() then
    raise exception 'Only an admin may change the creator perk' using errcode = '42501';
  end if;
  if p_members_only is null or char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A value and a reason of at least 10 characters are required' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.learning_config where key = 'creator_perk';
  insert into public.learning_config (key, version, value, status, note)
  values ('creator_perk', v_version, jsonb_build_object('members_only', p_members_only), 'proposed', btrim(p_reason));
  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, (select auth.uid()), 'learning_creator_perk.set', 'learning_config', null,
          jsonb_build_object('members_only', p_members_only, 'version', v_version));
  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Direct table reads: locked creator rows are not visible
-- ---------------------------------------------------------------------------
drop policy if exists health_education_content_select on public.health_education_content;
create policy health_education_content_select on public.health_education_content
  for select to authenticated
  using (
    (private.health_education_is_servable(is_active, content_status, next_review_due)
       and (creator_id is null or not private.learning_creator_locked(creator_id)))
    or private.is_admin()
  );

-- ---------------------------------------------------------------------------
-- 4. A progress write on a locked lesson is refused
-- ---------------------------------------------------------------------------
create or replace function private.health_education_progress_members_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
begin
  -- server-side writers (no signed-in person) are not the patient's own action
  if (select auth.uid()) is null then
    return new;
  end if;
  select creator_id into v_creator from public.health_education_content where id = new.content_id;
  if private.learning_creator_locked_for(v_creator, new.patient_id) then
    raise exception 'This lesson is part of Membership' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists health_education_progress_members_gate on public.health_education_progress;
create trigger health_education_progress_members_gate
  before insert or update on public.health_education_progress
  for each row execute function private.health_education_progress_members_gate();

-- ---------------------------------------------------------------------------
-- 5. Weekly micro-lesson (replaces daily_micro_lesson)
-- ---------------------------------------------------------------------------
drop function if exists public.daily_micro_lesson();

-- "Finished this week" must mean first finished, not last opened: every progress write refreshes last_viewed_at, so re-taking an old
-- lesson would otherwise look like this week's. understood_at is set once, when the status first becomes 'understood'.
alter table public.health_education_progress add column if not exists understood_at timestamptz;
create or replace function private.health_education_progress_understood_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'understood' and new.understood_at is null then
    new.understood_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists health_education_progress_understood_at on public.health_education_progress;
create trigger health_education_progress_understood_at
  before insert or update on public.health_education_progress
  for each row execute function private.health_education_progress_understood_at();
-- existing finished rows: the best record of when is the last time they were opened
update public.health_education_progress set understood_at = last_viewed_at where status = 'understood' and understood_at is null;

-- Start of the person's current programme week for a track: the same anchor private.health_education_unlock_week() counts from.
create or replace function private.health_education_unlock_anchor(p_condition public.care_plan_condition)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case when p_condition is not null then
      (select min(cp.created_at) from public.care_plans cp
        where cp.patient_id = (select auth.uid()) and cp.condition = p_condition and cp.status = 'active')
    end,
    (select min(p.created_at) from public.health_education_progress p where p.patient_id = (select auth.uid())),
    (select pr.onboarding_completed_at from public.profiles pr where pr.id = (select auth.uid())),
    now()
  );
$$;

create or replace function public.weekly_micro_lesson()
returns table (
  content_id uuid, code text, title text, summary text, body text, estimated_minutes integer,
  lesson_action text, self_care_action text, check_question jsonb, audio_clip_id text,
  reviewed_by_name text, reviewed_at timestamptz, next_review_due date, source_reference text,
  completed_this_week boolean, status public.health_education_status,
  members_only boolean, creator_name text, drip_week integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  cfg as (select coalesce((private.learning_config('micro_lesson') ->> 'max_minutes')::integer, 5) as max_minutes),
  cand as (
    select c.*,
           private.health_education_unlock_week(c.condition) as w,
           private.health_education_unlock_anchor(c.condition)
             + (private.health_education_unlock_week(c.condition) - 1) * interval '7 days' as week_start,
           private.learning_creator_locked(c.creator_id) as locked
      from public.health_education_content c, cfg
     where (select id from me) is not null
       and c.is_micro_lesson
       and not c.is_placeholder
       and c.estimated_minutes between 1 and cfg.max_minutes
       and (c.condition is null or c.condition in (select cp.condition from public.care_plans cp
                                                    where cp.patient_id = (select id from me) and cp.status = 'active'))
       and (c.drip_week is null or c.drip_week <= private.health_education_unlock_week(c.condition))
       and private.learning_age_ok(c.min_age, c.max_age)
       and private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due)
  )
  select c.id, c.code, c.title, c.summary,
         case when c.locked then '' else c.body end,
         c.estimated_minutes,
         case when c.locked then null else c.lesson_action end,
         case when c.locked then null else c.self_care_action end,
         case when c.locked then null else c.knowledge_check -> 0 end,
         case when c.locked then null else c.audio_clip_id end,
         c.reviewed_by_name, c.reviewed_at, c.next_review_due,
         coalesce(c.source_reference, c.evidence_source),
         coalesce(p.status = 'understood' and p.understood_at >= c.week_start, false),
         p.status,
         c.locked,
         case when cr.status = 'verified' then cr.display_name end,
         c.drip_week
    from cand c
    left join public.health_education_progress p
      on p.content_id = c.id and p.patient_id = (select id from me)
    left join public.learning_creators cr on cr.id = c.creator_id
   where (p.status is distinct from 'understood' or p.understood_at >= c.week_start)
   order by (p.status = 'understood') desc nulls last,
            c.locked asc,
            (c.drip_week = c.w) desc nulls last,
            (c.condition is not null) desc,
            c.drip_week asc nulls last,
            c.sort_order, c.code
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 6. S55 readers: item trust, shared article, offline pack
-- ---------------------------------------------------------------------------
drop function if exists public.health_education_item_trust(text[]);
create function public.health_education_item_trust(p_codes text[])
returns table (
  code text, clinician_reviewed boolean, reviewed_by_name text, clinical_author_name text, reviewed_at timestamptz,
  next_review_due date, source_reference text, evidence_source text, creator_name text,
  audio_clip_id text, self_care_action text, is_shareable boolean, is_micro_lesson boolean, lesson_action text,
  members_only boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code, c.clinician_reviewed, c.reviewed_by_name, c.clinical_author_name, c.reviewed_at,
         c.next_review_due, c.source_reference, c.evidence_source,
         case when cr.status = 'verified' then cr.display_name end,
         case when private.learning_creator_locked(c.creator_id) then null else c.audio_clip_id end,
         case when private.learning_creator_locked(c.creator_id) then null else c.self_care_action end,
         private.learning_item_is_shareable(c), c.is_micro_lesson,
         case when private.learning_creator_locked(c.creator_id) then null else c.lesson_action end,
         private.learning_creator_locked(c.creator_id)
    from public.health_education_content c
    left join public.learning_creators cr on cr.id = c.creator_id
   where (select auth.uid()) is not null
     and c.code = any (p_codes[1:100])
     and private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due)
     and private.learning_age_ok(c.min_age, c.max_age)
     and not c.is_placeholder;
$$;

-- Signed-out visitors are always "locked": a creator lesson answers with the title, credit and teaser only.
drop function if exists public.learn_shared_article(text);
create function public.learn_shared_article(p_code text)
returns table (
  code text, title text, summary text, body text, estimated_minutes integer,
  reviewed_by_name text, reviewed_at timestamptz, next_review_due date,
  source_reference text, evidence_source text, self_care_action text, creator_name text,
  members_only boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code, c.title, c.summary,
         case when private.learning_creator_locked(c.creator_id) then null else c.body end,
         c.estimated_minutes,
         c.reviewed_by_name, c.reviewed_at, c.next_review_due, c.source_reference, c.evidence_source,
         case when private.learning_creator_locked(c.creator_id) then null else c.self_care_action end,
         case when cr.status = 'verified' then cr.display_name end,
         private.learning_creator_locked(c.creator_id)
    from public.health_education_content c
    left join public.learning_creators cr on cr.id = c.creator_id
   where c.code = p_code
     and private.learning_item_is_shareable(c);
$$;

-- The phone keeps locked creator lessons out of the pack, and learning_pack_status marks them unservable so a lapsed
-- Membership removes them on the next refresh. Everything else is as #1005 defined it.
create or replace function public.learning_offline_pack()
returns table (
  code text, content_version integer, title text, summary text, body text, category public.health_education_category,
  content_type public.health_education_content_type, estimated_minutes integer, is_micro_lesson boolean,
  lesson_action text, self_care_action text, knowledge_check jsonb, audio_clip_id text,
  reviewed_by_name text, reviewed_at timestamptz, next_review_due date, source_reference text, creator_name text,
  text_bytes integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code, c.content_version, c.title, c.summary, c.body, c.category, c.content_type, c.estimated_minutes,
         c.is_micro_lesson, c.lesson_action, c.self_care_action, c.knowledge_check, c.audio_clip_id,
         c.reviewed_by_name, c.reviewed_at, c.next_review_due, coalesce(c.source_reference, c.evidence_source),
         case when cr.status = 'verified' then cr.display_name end,
         (octet_length(c.title) + octet_length(coalesce(c.summary, '')) + octet_length(c.body)
          + octet_length(coalesce(c.knowledge_check::text, '')))::integer
    from public.health_education_content c
    left join public.learning_creators cr on cr.id = c.creator_id
   where (select auth.uid()) is not null
     and c.content_type in ('article', 'faq', 'audio')
     and not c.is_placeholder
     and not private.learning_creator_locked(c.creator_id)
     and private.learning_age_ok(c.min_age, c.max_age)
     and private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due)
   order by c.is_micro_lesson desc, c.sort_order, c.code
   limit coalesce((private.learning_config('offline_pack') ->> 'max_items')::integer, 150);
$$;

create or replace function public.learning_pack_status(p_codes text[])
returns table (code text, servable boolean, content_version integer, next_review_due date)
language sql
stable
security definer
set search_path = ''
as $$
  select k.code,
         coalesce(private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due)
                  and not c.is_placeholder and private.learning_age_ok(c.min_age, c.max_age)
                  and not private.learning_creator_locked(c.creator_id), false),
         c.content_version, c.next_review_due
    from unnest(p_codes[1:300]) as k(code)
    left join public.health_education_content c on c.code = k.code
   where (select auth.uid()) is not null;
$$;

-- ---------------------------------------------------------------------------
-- 7. Legacy readers (feed, library, detail, programme detail): mask the lesson for a locked reader;
--    the two knowledge-base searches (used by the AI assistant) leave creator content out altogether.
--    Patched from the live definition, with an assertion per function, the same way the F1 expiry gate patched them.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
  v_def text;
  v_new text;
  v_lock constant text := 'private.learning_creator_locked(c.creator_id)';
begin
  foreach v_sig in array array[
    'public.health_education_feed()',
    'public.health_education_library(public.health_education_category)',
    'public.health_education_content_detail(text)',
    'public.health_education_programme_detail(text)'
  ] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    v_new := v_def;
    v_new := replace(v_new, 'coalesce(t.body, c.body),', 'case when ' || v_lock || ' then ''''::text else coalesce(t.body, c.body) end,');
    v_new := replace(v_new, E'    c.video_url,\n', E'    case when ' || v_lock || E' then null else c.video_url end,\n');
    v_new := replace(v_new, E'    c.audio_url,\n', E'    case when ' || v_lock || E' then null else c.audio_url end,\n');
    v_new := replace(v_new, E'    c.knowledge_check,\n', E'    case when ' || v_lock || E' then null else c.knowledge_check end,\n');
    if v_new = v_def
       or position('c.body' in replace(v_new, 'coalesce(t.body, c.body) end', '')) > 0
       or v_new not like '%then null else c.video_url end%'
       or v_new not like '%then null else c.audio_url end%'
       or v_new not like '%then null else c.knowledge_check end%' then
      raise exception 'creator perk: % was not fully patched (definition drifted)', v_sig;
    end if;
    execute v_new;
  end loop;

  foreach v_sig in array array[
    'public.match_health_education_content(extensions.vector, integer, public.care_plan_condition)',
    'public.search_health_education_content_text(text, integer, public.care_plan_condition)'
  ] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    v_new := replace(v_def,
      'private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due) = true',
      'private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due) = true and c.creator_id is null');
    if v_new = v_def then
      raise exception 'creator perk: % was not patched (definition drifted)', v_sig;
    end if;
    execute v_new;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Grants: revoke from public, grant explicitly (private helpers are called by RLS and by definer readers)
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.weekly_micro_lesson()',
    'public.health_education_item_trust(text[])',
    'public.learn_shared_article(text)',
    'public.learning_offline_pack()',
    'public.learning_pack_status(text[])',
    'public.set_learning_creator_perk(boolean, text)',
    'private.learning_creator_locked_for(uuid, uuid)',
    'private.learning_creator_locked(uuid)',
    'private.health_education_unlock_anchor(public.care_plan_condition)',
    'private.health_education_progress_members_gate()'
  ] loop
    execute format('revoke execute on function %s from public', v_sig);
    execute format('revoke execute on function %s from anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
  grant execute on function public.learn_shared_article(text) to anon;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.daily_micro_lesson()') is not null then
    raise exception 'creator perk: the daily lesson function still exists';
  end if;
  if has_function_privilege('anon', 'public.weekly_micro_lesson()', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_learning_creator_perk(boolean, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.learning_offline_pack()', 'EXECUTE')
     or has_function_privilege('anon', 'public.health_education_item_trust(text[])', 'EXECUTE') then
    raise exception 'creator perk: anon can execute a signed-in learning function';
  end if;
  if not has_function_privilege('anon', 'public.learn_shared_article(text)', 'EXECUTE') then
    raise exception 'creator perk: the shared article function must stay callable signed out';
  end if;
  if (select private.learning_config('creator_perk') ->> 'members_only') is distinct from 'true' then
    raise exception 'creator perk: the seeded switch is not members_only = true';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'health_education_progress_members_gate') then
    raise exception 'creator perk: progress gate missing';
  end if;
end $$;
