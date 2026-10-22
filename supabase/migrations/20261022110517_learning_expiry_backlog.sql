-- Learning content expiry backlog (S51-S55 gap closure, item 3). DORMANT-SAFE: nothing here changes what a patient can read.
--
-- S55 hides learning content automatically on the day it passes its review date (private.health_education_content_expired, F1). That rule
-- is NOT touched here. This migration adds the people side of it, so content is not first noticed when it disappears:
--
--   1. owner_profile_id: who looks after an item (a staff profile). Null means "no owner yet" and is shown, never guessed.
--   2. review_change_note: a short "what changed since the last review" note, shown on the item. It is cleared when the item leaves service
--      for editing (status updated), because it describes the version that was live; the next version needs its own. REQUIRED when an item that was published
--      before is published again after being edited and re-approved (a new version); NOT required for a first publish, and NOT for the
--      plain "reviewed again, nothing changed" move from review_due back to published (no new version exists then). A second BEFORE trigger, so the S55 publish gate
--      (private.health_education_publish_gate) is not replaced and none of its checks move.
--   3. learning_expiry_backlog(): the screen's list, days until the review date, a 30/14/7 style bucket (the days come from versioned
--      configuration, learning_config key expiry_alerts, mirrored by packages/shared learning.expiry_alerts), owner, and whether the item is
--      already hidden. Admin or the active Chief Medical Officer only; everyone else is refused.
--   4. learning_expiry_summary(), set_learning_content_owner(), learning_expiry_owner_candidates(): the counts, the assign control and its
--      list. Same two roles.
--   5. learning_expiry_run_alerts(): the daily job's body (service role only). One generic in-app notice per owner per Lagos day and one
--      digest per active Chief Medical Officer per Lagos day, on the days an item is exactly 30, 14 or 7 days from its review date.
--      The notice carries a count and no item title (INV-07: nothing is named). A unique index makes a second run on the same day a no-op.
--
-- Rows affected by the schema change: none (two nullable columns). No new table, so no new RLS surface and no grant to add: both columns sit
-- on public.health_education_content, whose existing policies and grants apply unchanged.
-- Written without a live check: before applying, run list_migrations on the live project for anything recent you do not recognise.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.health_education_content
  add column if not exists owner_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists review_change_note text;

alter table public.health_education_content
  drop constraint if exists health_education_content_review_change_note_len;
alter table public.health_education_content
  add constraint health_education_content_review_change_note_len
  check (review_change_note is null or char_length(review_change_note) <= 500);

comment on column public.health_education_content.owner_profile_id is
  'The staff profile responsible for keeping this item in date. Null = no owner yet (shown on the expiry screen, never guessed). Receives the 30/14/7 day notices.';
comment on column public.health_education_content.review_change_note is
  'Short plain-English note of what changed since the last review. Required when a previously published item is published again; shown on the item to patients.';

create index if not exists health_education_content_owner_idx
  on public.health_education_content (owner_profile_id) where owner_profile_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Versioned configuration (PROPOSED, mirrored in packages/shared proposed-config learning.expiry_alerts)
-- ---------------------------------------------------------------------------
-- learning-expiry-alerts-begin
insert into public.learning_config (key, version, value, status, note) values
('expiry_alerts', 1, $json${"thresholds_days":[30,14,7]}$json$::jsonb, 'proposed',
 'Days before an item''s review date at which its owner gets one generic in-app notice and the Chief Medical Officer a digest. The S55 expiry rule itself (hidden on the review date) is separate and unchanged. UNSIGNED: the CMO confirms the numbers.')
on conflict (key, version) do nothing;
-- learning-expiry-alerts-end

-- ---------------------------------------------------------------------------
-- 3. Who may use the screen: an admin or the active Chief Medical Officer (a CMO account is a clinician and cannot open /admin)
-- ---------------------------------------------------------------------------
create or replace function private.learning_can_manage_expiry()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_admin(), false)
      or exists (select 1 from public.clinical_staff cs
                  where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active'
                    and cs.doctor_tier = 'chief_medical_officer');
$$;
revoke all on function private.learning_can_manage_expiry() from public, anon;
grant execute on function private.learning_can_manage_expiry() to authenticated, service_role;

-- The thresholds, largest first. A missing or malformed setting yields an empty list, so a broken config sends nothing and labels nothing
-- (it never falls back to a number written here).
create or replace function private.learning_expiry_thresholds()
returns integer[]
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select array_agg(t order by t desc)
       from (select (e.value)::integer as t
               from jsonb_array_elements_text(
                      case when jsonb_typeof(private.learning_config('expiry_alerts') -> 'thresholds_days') = 'array'
                           then private.learning_config('expiry_alerts') -> 'thresholds_days' else '[]'::jsonb end) e(value)
              where e.value ~ '^[0-9]{1,4}$' and (e.value)::integer >= 1) s),
    array[]::integer[]);
$$;
revoke all on function private.learning_expiry_thresholds() from public, anon;
grant execute on function private.learning_expiry_thresholds() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The backlog list. One row per active, real, dated item that is hidden already or within the largest threshold of its review date.
-- ---------------------------------------------------------------------------
create or replace function public.learning_expiry_backlog()
returns table (
  content_id uuid, code text, title text, category text, content_status text,
  next_review_due date, days_until_due integer, bucket text, hidden boolean, review_flagged boolean,
  owner_profile_id uuid, owner_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_th integer[] := private.learning_expiry_thresholds();
  v_max integer := coalesce(v_th[1], 0);
begin
  if not private.learning_can_manage_expiry() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select c.id, c.code, c.title, c.category::text, c.content_status::text,
         c.next_review_due, (c.next_review_due - v_today)::integer,
         case
           when private.health_education_content_expired(c.content_status, c.next_review_due) then 'hidden'
           else coalesce((select 'd' || t::text from unnest(v_th) t where (c.next_review_due - v_today) <= t order by t asc limit 1), 'later')
         end,
         private.health_education_content_expired(c.content_status, c.next_review_due),
         c.content_status = 'review_due',
         c.owner_profile_id, p.full_name
    from public.health_education_content c
    left join public.profiles p on p.id = c.owner_profile_id
   where c.is_active
     and not c.is_placeholder
     and c.next_review_due is not null
     and (private.health_education_content_expired(c.content_status, c.next_review_due)
          or (c.next_review_due - v_today) <= v_max)
   order by c.next_review_due asc, c.code asc;
end;
$$;
revoke all on function public.learning_expiry_backlog() from public, anon;
grant execute on function public.learning_expiry_backlog() to authenticated;

-- Counts for the top of the screen. no_date counts live items with no review date: S55 never expires those, so they are the quiet risk.
create or replace function public.learning_expiry_summary()
returns table (metric text, n bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_th integer[] := private.learning_expiry_thresholds();
begin
  if not private.learning_can_manage_expiry() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select 'hidden'::text, count(*) from public.health_education_content c
   where c.is_active and not c.is_placeholder and private.health_education_content_expired(c.content_status, c.next_review_due)
  union all
  select 'd' || t::text, count(*) from unnest(v_th) t
    join public.health_education_content c
      on c.is_active and not c.is_placeholder and c.next_review_due is not null
     and not private.health_education_content_expired(c.content_status, c.next_review_due)
     and (c.next_review_due - v_today) <= t
     and not exists (select 1 from unnest(v_th) t2 where t2 < t and (c.next_review_due - v_today) <= t2)
   group by t
  union all
  select 'no_owner'::text, count(*) from public.health_education_content c
   where c.is_active and not c.is_placeholder and c.owner_profile_id is null
     and c.next_review_due is not null
     and (private.health_education_content_expired(c.content_status, c.next_review_due) or (c.next_review_due - v_today) <= coalesce(v_th[1], 0))
  union all
  select 'no_review_date'::text, count(*) from public.health_education_content c
   where c.is_active and not c.is_placeholder and c.next_review_due is null;
end;
$$;
revoke all on function public.learning_expiry_summary() from public, anon;
grant execute on function public.learning_expiry_summary() to authenticated;

create or replace function public.learning_expiry_owner_candidates()
returns table (profile_id uuid, full_name text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.learning_can_manage_expiry() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select p.id, p.full_name, p.role::text
    from public.profiles p
   where p.is_active
     and (p.role = 'admin'
          or exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id and cs.active and cs.status = 'active'))
   order by p.full_name nulls last, p.id;
end;
$$;
revoke all on function public.learning_expiry_owner_candidates() from public, anon;
grant execute on function public.learning_expiry_owner_candidates() to authenticated;

create or replace function public.set_learning_content_owner(p_content_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.learning_can_manage_expiry() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_owner is not null and not exists (
       select 1 from public.profiles p
        where p.id = p_owner and p.is_active
          and (p.role = 'admin'
               or exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id and cs.active and cs.status = 'active'))) then
    raise exception 'An owner must be an active admin or an active member of the clinical team' using errcode = '23514';
  end if;
  update public.health_education_content set owner_profile_id = p_owner where id = p_content_id;
  if not found then
    raise exception 'No such learning item' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_learning_content_owner(uuid, uuid) from public, anon;
grant execute on function public.set_learning_content_owner(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. "What changed" note: required when a previously published item is published again. A separate trigger named to sort AFTER the
--    version snapshot trigger, leaving the S55 publish gate exactly as it is. A first publish never needs a note.
-- ---------------------------------------------------------------------------
create or replace function private.health_education_change_note_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  -- Editing starts a new version: the note describes the version that was live, so it is cleared when the item leaves service for
  -- editing (unless the same update is writing a fresh one). The admin then writes a note for the new version before it can publish.
  if new.content_status = 'updated' and old.content_status is distinct from 'updated'
     and new.review_change_note is not distinct from old.review_change_note then
    new.review_change_note := null;
  end if;
  if new.content_status = 'published'
     and old.content_status in ('updated', 'clinical_review', 'approved')
     and exists (select 1 from public.health_education_content_status_history h
                  where h.content_id = new.id and (h.to_status = 'published' or h.from_status = 'published'))
     and (new.review_change_note is null or char_length(btrim(new.review_change_note)) < 10) then
    raise exception 'Publishing a new version needs a short note of what changed since the last review (at least 10 characters)'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.health_education_change_note_gate() from public, anon, authenticated;

drop trigger if exists health_education_content_z_change_note_gate on public.health_education_content;
create trigger health_education_content_z_change_note_gate
  before update on public.health_education_content
  for each row execute function private.health_education_change_note_gate();

-- ---------------------------------------------------------------------------
-- 6. Generic notices (INV-07: nothing names a condition, a reading, a medicine or an item title; in-app only)
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('learning_expiry_owner', 'operational', 'routine', 'clinician', array['in_app']::public.notification_channel[], 'scheduled',
   'Some learning content you look after is coming up for review. A count only; names no item.'),
  ('learning_expiry_cmo_digest', 'operational', 'routine', 'clinician', array['in_app']::public.notification_channel[], 'scheduled',
   'A digest for the Chief Medical Officer: learning content is coming up for review. A count only; names no item.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('learning_expiry_owner', 'en', 'in_app', 'Learning content is due for review', 'Some learning content you look after is coming up for review. Open the review list to see which.'),
  ('learning_expiry_cmo_digest', 'en', 'in_app', 'Learning content review digest', 'Learning content is coming up for review. Open the review list to see what and who owns it.')
on conflict do nothing;

create unique index if not exists notifications_learning_expiry_once_per_day
  on public.notifications (recipient_id, template, (payload ->> 'day'))
  where template in ('learning_expiry_owner', 'learning_expiry_cmo_digest');

-- ---------------------------------------------------------------------------
-- 7. The daily job body. Service role only. Safe to run twice in a day (the unique index turns the second run into a no-op).
-- ---------------------------------------------------------------------------
create or replace function public.learning_expiry_run_alerts(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_th integer[] := private.learning_expiry_thresholds();
  v_owner_notices integer := 0;
  v_cmo_digests integer := 0;
  v_items integer := 0;
  v_unowned integer := 0;
  v_n integer;
  r record;
begin
  select count(*), count(*) filter (where c.owner_profile_id is null) into v_items, v_unowned
    from public.health_education_content c
   where c.is_active and not c.is_placeholder and c.next_review_due is not null
     and not private.health_education_content_expired(c.content_status, c.next_review_due)
     and (c.next_review_due - v_today) = any (v_th);

  -- one notice per active owner (a count, no titles)
  for r in
    select c.owner_profile_id as owner_id, p.organisation_id, p.role::text as role, count(*) as n
      from public.health_education_content c
      join public.profiles p on p.id = c.owner_profile_id and p.is_active
     where c.is_active and not c.is_placeholder and c.next_review_due is not null
       and not private.health_education_content_expired(c.content_status, c.next_review_due)
       and (c.next_review_due - v_today) = any (v_th)
     group by c.owner_profile_id, p.organisation_id, p.role
  loop
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, r.owner_id, 'in_app', 'pending', 'learning_expiry_owner',
            jsonb_build_object('day', v_today::text, 'count', r.n, 'area', case when r.role = 'admin' then 'admin' else 'clinician' end))
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_owner_notices := v_owner_notices + v_n;
  end loop;

  -- one digest per active Chief Medical Officer, only on a day something crosses a threshold
  if v_items > 0 then
    for r in
      select p.id as profile_id, p.organisation_id
        from public.clinical_staff cs
        join public.profiles p on p.id = cs.profile_id and p.is_active
       where cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer'
    loop
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (r.organisation_id, r.profile_id, 'in_app', 'pending', 'learning_expiry_cmo_digest',
              jsonb_build_object('day', v_today::text, 'count', v_items, 'unowned', v_unowned, 'area', 'clinician'))
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_cmo_digests := v_cmo_digests + v_n;
    end loop;
  end if;

  return jsonb_build_object('day', v_today::text, 'items_at_threshold', v_items, 'unowned', v_unowned,
                            'owner_notices', v_owner_notices, 'cmo_digests', v_cmo_digests);
end;
$$;
revoke all on function public.learning_expiry_run_alerts(timestamptz) from public, anon, authenticated;
grant execute on function public.learning_expiry_run_alerts(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 8. The item trust reader now also returns the change note. Rebuilt from the S55 weekly-lesson migration's definition with ONE added
--    column at the end; the live definition must be re-read before applying (a function can drift from its file).
-- ---------------------------------------------------------------------------
drop function if exists public.health_education_item_trust(text[]);
create function public.health_education_item_trust(p_codes text[])
returns table (
  code text, clinician_reviewed boolean, reviewed_by_name text, clinical_author_name text, reviewed_at timestamptz,
  next_review_due date, source_reference text, evidence_source text, creator_name text,
  audio_clip_id text, self_care_action text, is_shareable boolean, is_micro_lesson boolean, lesson_action text,
  members_only boolean, review_change_note text
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
         private.learning_creator_locked(c.creator_id),
         c.review_change_note
    from public.health_education_content c
    left join public.learning_creators cr on cr.id = c.creator_id
   where (select auth.uid()) is not null
     and c.code = any (p_codes[1:100])
     and private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due)
     and private.learning_age_ok(c.min_age, c.max_age)
     and not c.is_placeholder;
$$;
revoke all on function public.health_education_item_trust(text[]) from public, anon;
grant execute on function public.health_education_item_trust(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 8b. Register the new Vercel cron in both owner registries (idempotent). Already-applied seed migrations are not edited;
--     tests in apps/web pin vercel.json to those seed files plus this one.
-- ---------------------------------------------------------------------------
insert into public.automation_jobs (job_name, schedule, source)
values ('/api/cron/learning-expiry-alerts', '15 6 * * *', 'vercel')
on conflict (job_name) do nothing;
insert into public.automations (name, kind, schedule, source_ref)
values ('vercel:learning-expiry-alerts', 'vercel_cron', '15 6 * * *', '/api/cron/learning-expiry-alerts')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Self-check: the migration states what it just did (a failed assertion aborts the transaction)
-- ---------------------------------------------------------------------------
do $$
begin
  if array_length(private.learning_expiry_thresholds(), 1) is distinct from 3 then
    raise exception 'learning expiry thresholds did not load (expected 3)';
  end if;
  if has_function_privilege('anon', 'public.learning_expiry_backlog()', 'EXECUTE')
     or has_function_privilege('anon', 'public.learning_expiry_run_alerts(timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.learning_expiry_run_alerts(timestamptz)', 'EXECUTE') then
    raise exception 'learning expiry functions are open to a role that must not run them';
  end if;
  if not has_function_privilege('service_role', 'public.learning_expiry_run_alerts(timestamptz)', 'EXECUTE') then
    raise exception 'the daily job cannot be run by the service role';
  end if;
end $$;
