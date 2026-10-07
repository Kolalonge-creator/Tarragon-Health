-- F1 fix 1: learning content past its review date must NOT be served.
--
-- THE DEFECT. 20260830013226 made `private.health_education_content_sync_is_active()`
-- derive is_active from content_status IN ('published', 'review_due'), so an item
-- that the daily job (or a protocol version bump) moved to 'review_due' stayed
-- live to patients indefinitely. Two columns also claimed to say "when is the next
-- review": `next_review_due` (date, written by the governance cron and the admin
-- screen) and `review_due_at` (timestamptz, added by 20260828230809, read by
-- nothing but the version snapshot and a partial index). Neither was consulted at
-- read time, so an item whose date had passed was still served between the
-- 03:00 job and forever after if the job failed.
--
-- THE ONE RULE (authoritative). An item is EXPIRED when
--     content_status = 'review_due'
--  OR next_review_due <= today (Africa/Lagos).
-- An item is SERVABLE when is_active AND NOT expired. `next_review_due` is the
-- authoritative review column. `review_due_at` is kept as a deprecated mirror
-- (derived from next_review_due, Lagos midnight) so nothing that reads it breaks;
-- a write to the legacy column alone is translated into next_review_due.
-- Items with NO review date are never time-expired (235 seeded items have none;
-- setting dates is a CMO content task, not decided here).
--
-- WHAT CHANGES
--  * private.health_education_content_expired / _is_servable: the single rule.
--  * is_active trigger: 'review_due' no longer counts as active.
--  * RLS read policy + every function that reads the table for patients, the AI
--    coach retrieval RPCs, the recommend-on-result/medication triggers and the
--    unlock nudge now apply the rule at READ time, so the 24h gap before the
--    cron runs cannot serve expired content.
--  * flag job uses the Lagos date (not the server UTC date).
--  * set_health_education_content_status refuses review_due -> published (and any
--    publish) while next_review_due is still in the past, so a re-publish cannot
--    silently re-expire.
--  * lpe_content_blocks: no review-date column exists and its read gate is
--    clinician_reviewed (signed); it does not share this rule. Untouched.
--
-- Backward compatible: no column dropped; admins still see and edit everything.
-- Rows affected live: unknown to this migration (0 seeded items carry a date);
-- the backfill below only fills next_review_due from review_due_at when absent.
-- Functions are patched by reading their CURRENT definition and failing loudly if
-- the target text is missing, so drift cannot make this a silent no-op.

-- ---------------------------------------------------------------------------
-- The single rule
-- ---------------------------------------------------------------------------
create or replace function private.health_education_content_expired(
  p_status public.health_education_content_status,
  p_next_review_due date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status = 'review_due'
      or (p_next_review_due is not null
          and p_next_review_due <= (now() at time zone 'Africa/Lagos')::date);
$$;

create or replace function private.health_education_is_servable(
  p_is_active boolean,
  p_status public.health_education_content_status,
  p_next_review_due date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_is_active, false)
     and not private.health_education_content_expired(p_status, p_next_review_due);
$$;

revoke execute on function private.health_education_content_expired(public.health_education_content_status, date) from public;
revoke execute on function private.health_education_is_servable(boolean, public.health_education_content_status, date) from public;
grant execute on function private.health_education_content_expired(public.health_education_content_status, date) to authenticated, service_role;
grant execute on function private.health_education_is_servable(boolean, public.health_education_content_status, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One authoritative review column: next_review_due. review_due_at is a mirror.
-- ---------------------------------------------------------------------------
create or replace function private.health_education_content_review_date_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.next_review_due is null and new.review_due_at is not null then
      new.next_review_due := (new.review_due_at at time zone 'Africa/Lagos')::date;
    end if;
  else
    if new.next_review_due is not distinct from old.next_review_due
       and new.review_due_at is distinct from old.review_due_at then
      -- only the legacy column was written: translate it
      new.next_review_due := (new.review_due_at at time zone 'Africa/Lagos')::date;
    end if;
  end if;
  new.review_due_at := case
    when new.next_review_due is null then null
    else (new.next_review_due::timestamp at time zone 'Africa/Lagos')
  end;
  return new;
end;
$$;

drop trigger if exists health_education_content_review_date_sync on public.health_education_content;
create trigger health_education_content_review_date_sync
  before insert or update of next_review_due, review_due_at on public.health_education_content
  for each row execute function private.health_education_content_review_date_sync();

comment on column public.health_education_content.next_review_due is
  'AUTHORITATIVE review date (Africa/Lagos calendar day). Content is expired, and not served, on or after this date. See private.health_education_content_expired().';
comment on column public.health_education_content.review_due_at is
  'DEPRECATED mirror of next_review_due (Lagos midnight). Kept for backward compatibility; never the source of truth. Writing only this column is translated into next_review_due by trigger.';

update public.health_education_content
   set next_review_due = (review_due_at at time zone 'Africa/Lagos')::date
 where next_review_due is null and review_due_at is not null;

-- ---------------------------------------------------------------------------
-- is_active: review_due is NOT served
-- ---------------------------------------------------------------------------
create or replace function private.health_education_content_sync_is_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.is_active := new.content_status = 'published';
  return new;
end;
$$;

comment on column public.health_education_content.content_status is
  'Governance lifecycle: draft -> clinical_review -> approved -> published -> review_due -> updated -> (back to clinical_review). is_active is true ONLY for published (F1: review_due is no longer served).';

-- Re-derive is_active for the existing rows (trigger only fires on status writes).
update public.health_education_content
   set is_active = (content_status = 'published')
 where is_active is distinct from (content_status = 'published');

-- ---------------------------------------------------------------------------
-- Flag job: Lagos calendar day, and flag now so state matches the read rule
-- ---------------------------------------------------------------------------
create or replace function private.health_education_flag_overdue_reviews()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    update public.health_education_content
    set content_status = 'review_due'
    where content_status = 'published'
      and next_review_due is not null
      and next_review_due <= (now() at time zone 'Africa/Lagos')::date
    returning id
  )
  insert into public.health_education_content_status_history (content_id, from_status, to_status, note)
  select id, 'published', 'review_due', 'Automatic: next_review_due date passed' from due;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

select private.health_education_flag_overdue_reviews();

-- ---------------------------------------------------------------------------
-- RLS read policy: expired items are invisible to non-admins at read time
-- ---------------------------------------------------------------------------
drop policy if exists health_education_content_select on public.health_education_content;
create policy health_education_content_select on public.health_education_content
  for select to authenticated
  using (
    private.health_education_is_servable(is_active, content_status, next_review_due)
    or private.is_admin()
  );

-- ---------------------------------------------------------------------------
-- Every reader: patch the CURRENT definition, fail loudly if the target is gone
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
  v_def text;
  v_new text;
  v_servable constant text :=
    'private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due)';
begin
  foreach v_sig in array array[
    'public.health_education_feed()',
    'public.health_education_library(public.health_education_category)',
    'public.health_education_content_detail(text)',
    'public.health_education_category_counts()',
    'public.health_education_locked_count()',
    'public.match_health_education_content(extensions.vector, integer, public.care_plan_condition)',
    'public.search_health_education_content_text(text, integer, public.care_plan_condition)',
    'private.health_education_recommend_on_abnormal_result()',
    'private.health_education_recommend_on_medication()',
    'private.queue_health_education_unlock_nudges()'
  ] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    v_new := regexp_replace(v_def, '\mc\.is_active\M', v_servable, 'g');
    if v_new = v_def then
      raise exception 'F1 expiry gate: % has no "c.is_active" filter to patch (definition drifted)', v_sig;
    end if;
    execute v_new;
  end loop;

  -- programme detail joins content without an active filter: hide expired modules
  v_sig := 'public.health_education_programme_detail(text)';
  v_def := pg_get_functiondef(v_sig::regprocedure);
  v_new := replace(v_def,
    'where p.code = p_code and (p.is_active or private.is_admin())',
    'where p.code = p_code and (p.is_active or private.is_admin())' || E'\n' ||
    '    and (not private.health_education_content_expired(c.content_status, c.next_review_due) or private.is_admin())');
  if v_new = v_def then
    raise exception 'F1 expiry gate: % where clause not found (definition drifted)', v_sig;
  end if;
  execute v_new;

  -- publishing while the review date is still in the past would silently re-expire
  v_sig := 'public.set_health_education_content_status(uuid, public.health_education_content_status, text)';
  v_def := pg_get_functiondef(v_sig::regprocedure);
  v_new := replace(v_def,
    E'  update public.health_education_content\n    set content_status = p_new_status,',
    E'  if p_new_status = ''published'' and exists (\n' ||
    E'    select 1 from public.health_education_content\n' ||
    E'    where id = p_content_id\n' ||
    E'      and next_review_due is not null\n' ||
    E'      and next_review_due <= (now() at time zone ''Africa/Lagos'')::date\n' ||
    E'  ) then\n' ||
    E'    raise exception ''Set a future next_review_due before publishing this content: its review date has passed'';\n' ||
    E'  end if;\n\n' ||
    E'  update public.health_education_content\n    set content_status = p_new_status,');
  if v_new = v_def then
    raise exception 'F1 expiry gate: % update statement not found (definition drifted)', v_sig;
  end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------
-- Self-check: no reader of the table is left filtering on bare is_active
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.health_education_feed()',
    'public.health_education_library(public.health_education_category)',
    'public.health_education_content_detail(text)',
    'public.health_education_category_counts()',
    'public.health_education_locked_count()',
    'public.match_health_education_content(extensions.vector, integer, public.care_plan_condition)',
    'public.search_health_education_content_text(text, integer, public.care_plan_condition)',
    'private.health_education_recommend_on_abnormal_result()',
    'private.health_education_recommend_on_medication()',
    'private.queue_health_education_unlock_nudges()',
    'public.health_education_programme_detail(text)'
  ] loop
    if pg_get_functiondef(v_sig::regprocedure) not like '%health_education_%expired%'
       and pg_get_functiondef(v_sig::regprocedure) not like '%health_education_is_servable%' then
      raise exception 'F1 expiry gate not applied to %', v_sig;
    end if;
  end loop;
  if has_function_privilege('anon', 'private.health_education_is_servable(boolean, public.health_education_content_status, date)', 'EXECUTE') then
    raise exception 'anon must not execute the servable helper';
  end if;
end $$;
