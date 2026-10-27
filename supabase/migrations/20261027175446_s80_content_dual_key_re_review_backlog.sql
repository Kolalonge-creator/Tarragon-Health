-- S80 gap closure (25.1 content CMS): one authoritative review date, an automatic "needs re-review" state, a stale-review backlog for the
-- clinical reviewer, and a dual-key rule in the database.
--
-- Counted first on the live project (read only, 2026-10-27): health_education_content has 283 rows; 0 carry next_review_due, 0 carry
-- review_due_at, so 0 rows disagree and nothing needs converting. 219 rows are published, 213 of those are published with
-- clinician_reviewed = false. THIS MIGRATION DOES NOT TOUCH ANY content_status OR clinician_reviewed VALUE: what to do about the 213 is a
-- CMO decision; the backlog screen below is how the CMO works through them.
--
-- 1. REVIEW DATE. The two columns (next_review_due date, review_due_at timestamptz) were already merged in meaning by
--    20261007002357 (F1): next_review_due is the one authoritative column, review_due_at a trigger-kept mirror. This migration finishes the
--    merge without a destructive drop (review_due_at is also a column of health_education_content_versions and is selected by many earlier
--    functions): rows where the mirror disagrees are re-derived (0 live), and a self-check proves none disagree. Anything that needs the review
--    date reads next_review_due. Dropping the mirror is deferred, see docs/design/S80.md.
-- 2. NEEDS RE-REVIEW. Changing title, summary, body, knowledge_check or evidence_source on an item that is approved, published or review_due sets
--    needs_re_review = true (with when and why) by trigger, and puts every translation of that item back to draft (key convention
--    'health_education_content.<id>.<field>'). The flag does not hide the item (OQ-F1-04: a flag is not an outage); only the CMO's approval
--    through set_health_education_content_status clears it. A client cannot clear it.
-- 3. DUAL KEY. authored_by (stamped at insert, immutable for a signed-in user) and last_edited_by (stamped when a source field changes) are
--    recorded. For safety_relevant content (default true; only the CMO may set it false) the person who authored or last edited the text
--    cannot be the CMO who approves or re-affirms it. Rows with no authored_by (all 283 live rows) fall back to comparing clinical_author_name
--    with the approver's name. Consequence to know: a CMO who writes content cannot approve it herself; a second reviewer is needed.
-- 4. BACKLOG. public.content_review_backlog() lists, for the CMO (and read-only for an admin), items that need re-review, are past their review
--    date, or are live without ever being clinician-reviewed.
-- 5. REGRESSION FIX. The fix-first and S80a replacements of set_health_education_content_status (203417, 204226) re-created the function whole and
--    dropped the F1 refusal to publish while next_review_due is in the past (F1 patched it in place earlier in file order). It is restored here.

alter table public.health_education_content
  add column authored_by uuid references public.profiles (id) on delete set null,
  add column last_edited_by uuid references public.profiles (id) on delete set null,
  add column safety_relevant boolean not null default true,
  add column needs_re_review boolean not null default false,
  add column needs_re_review_since timestamptz,
  add column needs_re_review_reason text;
comment on column public.health_education_content.safety_relevant is 'Dual-key: when true, whoever authored or last edited the text cannot be the CMO who approves it. Default true; only the CMO may set false.';
comment on column public.health_education_content.needs_re_review is 'Set by trigger when the source text of an approved/published item changes. Cleared only by CMO approval.';

-- 1. finish the review-date merge: re-derive any mirror that disagrees (0 live), then prove none do
update public.health_education_content
   set next_review_due = coalesce(next_review_due, (review_due_at at time zone 'Africa/Lagos')::date)
 where (next_review_due is null and review_due_at is not null)
    or (next_review_due is not null and review_due_at is distinct from (next_review_due::timestamp at time zone 'Africa/Lagos'));

-- 2/3. stamp authors, flag source changes, reset translations
create function private.health_education_content_track_source()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_changed boolean;
  v_rpc boolean := coalesce(current_setting('tarragon.content_status_rpc', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.authored_by := v_uid;
      new.last_edited_by := v_uid;
      new.needs_re_review := false; new.needs_re_review_since := null; new.needs_re_review_reason := null;
      if not private.is_active_clinical_director() then new.safety_relevant := true; end if;
    else
      new.last_edited_by := coalesce(new.last_edited_by, new.authored_by);
    end if;
    return new;
  end if;

  -- UPDATE
  if v_uid is not null then
    new.authored_by := old.authored_by;                              -- who wrote it never changes from the client
    if new.safety_relevant is distinct from old.safety_relevant and not private.is_active_clinical_director() then
      new.safety_relevant := old.safety_relevant;                    -- only the CMO may narrow the dual-key rule
    end if;
  end if;
  v_changed := row(old.title, old.summary, old.body, old.knowledge_check, old.evidence_source)
               is distinct from row(new.title, new.summary, new.body, new.knowledge_check, new.evidence_source);
  if v_changed then
    if v_uid is not null then new.last_edited_by := v_uid; end if;
    if old.content_status in ('approved', 'published', 'review_due') then
      new.needs_re_review := true;
      new.needs_re_review_since := coalesce(old.needs_re_review_since, now());
      new.needs_re_review_reason := 'The text changed after it was approved';
    end if;
    update public.translations t
       set state = 'draft', reviewed_by = null, reviewed_at = null, updated_at = now()
     where t.key like 'health_education_content.' || old.id::text || '.%' and t.state <> 'draft';
  elsif not v_rpc and v_uid is not null then
    -- no source change: a client may not clear or forge the flag
    new.needs_re_review := old.needs_re_review;
    new.needs_re_review_since := old.needs_re_review_since;
    new.needs_re_review_reason := old.needs_re_review_reason;
  end if;
  return new;
end $$;
revoke all on function private.health_education_content_track_source() from public, anon, authenticated;

create trigger health_education_content_track_source
  before insert or update on public.health_education_content
  for each row execute function private.health_education_content_track_source();

-- 3/5. the status function: S80a's body + F1 expiry refusal + dual key + flag cleared on approval
create or replace function public.set_health_education_content_status(
  p_content_id uuid,
  p_new_status public.health_education_content_status,
  p_note text default null
)
returns public.health_education_content_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.health_education_content_status;
  v_actor uuid := (select auth.uid());
  v_cmo boolean := private.is_active_clinical_director();
  v_legal boolean := false;
  v_org uuid;
  v_version integer;
  v_row public.health_education_content%rowtype;
  v_actor_name text;
begin
  if not (private.is_admin() or v_cmo) then
    raise exception 'Only an admin or the Chief Medical Officer may change health-education content status';
  end if;

  select * into v_row from public.health_education_content where id = p_content_id for update;
  if not found then
    raise exception 'Unknown health_education_content id %', p_content_id;
  end if;
  v_current := v_row.content_status;

  v_legal := case
    when v_current = 'draft' and p_new_status = 'clinical_review' then true
    when v_current = 'clinical_review' and p_new_status in ('approved', 'draft') then true
    when v_current = 'approved' and p_new_status in ('published', 'clinical_review') then true
    when v_current = 'published' and p_new_status in ('review_due', 'updated', 'draft') then true
    when v_current = 'review_due' and p_new_status in ('updated', 'published', 'draft') then true
    when v_current = 'updated' and p_new_status = 'clinical_review' then true
    else false
  end;
  if not v_legal then
    raise exception 'Illegal health-education status transition: % -> %', v_current, p_new_status;
  end if;

  if (p_new_status = 'approved' or (v_current = 'review_due' and p_new_status = 'published'))
     and not v_cmo then
    raise exception 'not authorised: only an active Chief Medical Officer can approve patient-facing content';
  end if;

  -- dual key: the author or last editor of safety-relevant text cannot be its approver
  if (p_new_status = 'approved' or (v_current = 'review_due' and p_new_status = 'published')) and v_row.safety_relevant then
    select lower(btrim(full_name)) into v_actor_name from public.profiles where id = v_actor;
    if v_row.authored_by = v_actor or v_row.last_edited_by = v_actor
       or (v_row.clinical_author_name is not null and v_actor_name is not null and lower(btrim(v_row.clinical_author_name)) = v_actor_name) then
      raise exception 'not authorised: the author or last editor of safety-relevant content cannot also approve it (a second reviewer is needed)';
    end if;
  end if;

  -- F1: publishing while the review date is still in the past would silently re-expire
  if p_new_status = 'published' and v_row.next_review_due is not null
     and v_row.next_review_due <= (now() at time zone 'Africa/Lagos')::date then
    raise exception 'Set a future next_review_due before publishing this content: its review date has passed';
  end if;

  perform set_config('tarragon.content_status_rpc', 'on', true);
  update public.health_education_content
    set content_status = p_new_status,
        content_version = case when p_new_status = 'updated' then content_version + 1 else content_version end,
        clinician_reviewed = case when p_new_status = 'approved' then true else clinician_reviewed end,
        reviewed_at = case when p_new_status = 'approved' then now() else reviewed_at end,
        needs_re_review = case when p_new_status = 'approved' then false else needs_re_review end,
        needs_re_review_since = case when p_new_status = 'approved' then null else needs_re_review_since end,
        needs_re_review_reason = case when p_new_status = 'approved' then null else needs_re_review_reason end
    where id = p_content_id
    returning content_version into v_version;
  perform set_config('tarragon.content_status_rpc', '', true);

  insert into public.health_education_content_status_history (content_id, from_status, to_status, actor_id, note)
  values (p_content_id, v_current, p_new_status, v_actor, p_note);

  if p_new_status = 'published' then
    select organisation_id into v_org from public.profiles where id = v_actor;
    if v_org is null then raise exception 'the acting profile has no organisation, so the publish event cannot be recorded'; end if;
    perform private.emit_domain_event('content.published', v_org,
      jsonb_build_object('content_id', p_content_id, 'content_version', v_version),
      'content.published:' || p_content_id || ':' || extract(epoch from clock_timestamp())::text,
      null, 'health_education_content', p_content_id);
  end if;

  return p_new_status;
end;
$$;
revoke execute on function public.set_health_education_content_status(uuid, public.health_education_content_status, text) from public;
grant execute on function public.set_health_education_content_status(uuid, public.health_education_content_status, text) to authenticated;

-- 4. the backlog
create function public.content_review_backlog(p_limit integer default 500)
returns table (
  content_id uuid, code text, title text, content_status public.health_education_content_status, clinician_reviewed boolean,
  next_review_due date, days_overdue integer, needs_re_review boolean, needs_re_review_reason text, safety_relevant boolean,
  author_name text, backlog_kind text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_active_clinical_director() or private.is_admin()) then
    raise exception 'only the Chief Medical Officer or an admin can see the content review backlog' using errcode = '42501';
  end if;
  return query
    select c.id, c.code, c.title, c.content_status, c.clinician_reviewed, c.next_review_due,
           case when c.next_review_due is not null and c.next_review_due <= (now() at time zone 'Africa/Lagos')::date
                then ((now() at time zone 'Africa/Lagos')::date - c.next_review_due) else null end,
           c.needs_re_review, c.needs_re_review_reason, c.safety_relevant,
           coalesce(p.full_name, c.clinical_author_name),
           case when c.needs_re_review then 'needs_re_review'
                when c.next_review_due is not null and c.next_review_due <= (now() at time zone 'Africa/Lagos')::date then 'review_overdue'
                else 'never_reviewed' end
      from public.health_education_content c
      left join public.profiles p on p.id = c.authored_by
     where c.content_status in ('published', 'review_due', 'approved')
       and (c.needs_re_review
            or (c.next_review_due is not null and c.next_review_due <= (now() at time zone 'Africa/Lagos')::date)
            or (c.content_status in ('published', 'review_due') and not c.clinician_reviewed))
     order by case when c.needs_re_review then 0
                   when c.next_review_due is not null and c.next_review_due <= (now() at time zone 'Africa/Lagos')::date then 1 else 2 end,
              c.next_review_due nulls last, c.code
     limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end $$;
revoke all on function public.content_review_backlog(integer) from public, anon;
grant execute on function public.content_review_backlog(integer) to authenticated;

-- self-checks
do $$
begin
  if exists (select 1 from public.health_education_content
              where next_review_due is not null and review_due_at is distinct from (next_review_due::timestamp at time zone 'Africa/Lagos')) then
    raise exception 'review date mirror still disagrees with next_review_due';
  end if;
  if has_function_privilege('anon', 'public.content_review_backlog(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_health_education_content_status(uuid, public.health_education_content_status, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.health_education_content_track_source()', 'EXECUTE') then
    raise exception 'content review functions are executable by a role that must not run them';
  end if;
  if pg_get_functiondef('public.set_health_education_content_status(uuid, public.health_education_content_status, text)'::regprocedure) not like '%next_review_due%' then
    raise exception 'the F1 expiry refusal is missing from set_health_education_content_status';
  end if;
end $$;
