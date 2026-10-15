-- S55 (Module 9, Health Learning Centre), part 2 of 2: functions, events, share and offline pack.
-- Rows affected: none (functions, one trigger and grants only).
--
-- Every reader below applies the F1 expiry rule (private.health_education_is_servable) AND hides draft
-- placeholders, so content past its review date is never served by any of them.
-- Function EXECUTE is revoked from public and granted explicitly; the only anon-callable function is
-- learn_shared_article() (a shared link must open for someone who is signed out).

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function private.learning_norm(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g'));
$$;
revoke execute on function private.learning_norm(text) from public;
grant execute on function private.learning_norm(text) to authenticated, service_role;

-- Audience gate used by the new readers, the same rule health_education_feed applies: an item with an age range is hidden
-- from a caller whose age is known and outside it (an unknown age is not restricted, as in the feed).
create or replace function private.learning_age_ok(p_min integer, p_max integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_min is null and p_max is null)
      or coalesce(
           (select (p_min is null or a >= p_min) and (p_max is null or a <= p_max)
              from (select private.patient_age_years((select auth.uid())) as a) x
             where a is not null),
           true);
$$;
revoke execute on function private.learning_age_ok(integer, integer) from public;
grant execute on function private.learning_age_ok(integer, integer) to authenticated, service_role;

-- One definition of "this article may be opened from a shared link", used by the share function and by the flag the apps read to
-- decide whether to offer Share at all (so the button is never shown for a link that would 404).
create or replace function private.learning_item_is_shareable(c public.health_education_content)
returns boolean
language sql
stable
set search_path = ''
as $$
  select c.content_type = 'article'
     and c.share_enabled
     and c.clinician_reviewed
     and c.reviewed_by_name is not null and char_length(btrim(c.reviewed_by_name)) >= 3
     and c.reviewed_at is not null
     and c.next_review_due is not null
     and not c.is_placeholder
     and private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due);
$$;
revoke execute on function private.learning_item_is_shareable(public.health_education_content) from public;
grant execute on function private.learning_item_is_shareable(public.health_education_content) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Search with the synonym table (spec 9.3) and zero-result logging (no PHI)
--
-- Expansion picks NON-OVERLAPPING matches, longest phrase first (ties go to the later one, the head word), so "high blood sugar"
-- expands the diabetes group ("blood sugar") and not the blood-pressure group ("high blood") that overlaps it.
-- ---------------------------------------------------------------------------
create or replace function public.search_health_education(p_query text, p_limit integer default 20, p_log boolean default false)
returns table (
  content_id uuid, code text, title text, summary text,
  category public.health_education_category, content_type public.health_education_content_type,
  estimated_minutes integer, is_micro_lesson boolean, reviewed_by_name text, rank real
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := private.learning_config('search_gap_log');
  v_syn    jsonb := coalesce(private.learning_config('search_synonyms'), '[]'::jsonb);
  v_q      text;
  v_words  text[];
  v_cover  boolean[];
  v_groups integer[] := '{}';
  v_span   record;
  v_terms  text[];
  v_tsq    tsquery;
  v_one    tsquery;
  v_term   text;
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_found  integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to search' using errcode = '42501';
  end if;
  v_q := left(private.learning_norm(p_query), 120);
  if char_length(v_q) < 2 then
    return;
  end if;
  v_words := string_to_array(v_q, ' ');
  v_cover := array_fill(false, array[cardinality(v_words)]);

  for v_span in
    with terms as (
      select g.ord::integer as gi, string_to_array(private.learning_norm(x.term), ' ') as tw
        from jsonb_array_elements(v_syn) with ordinality g(val, ord)
        cross join lateral jsonb_array_elements_text(g.val -> 'terms') x(term)
    )
    select t.gi, i as s, i + cardinality(t.tw) - 1 as e, cardinality(t.tw) as len
      from terms t
      cross join generate_series(1, cardinality(v_words)) i
     where i + cardinality(t.tw) - 1 <= cardinality(v_words)
       and v_words[i:i + cardinality(t.tw) - 1] = t.tw
     order by len desc, e desc, s
  loop
    if not (true = any (v_cover[v_span.s:v_span.e])) then
      v_cover[v_span.s:v_span.e] := array_fill(true, array[v_span.e - v_span.s + 1]);
      v_groups := v_groups || v_span.gi;
    end if;
  end loop;

  select array_agg(distinct t) into v_terms
  from (
    select v_q as t
    union
    select private.learning_norm(x.term)
      from jsonb_array_elements(v_syn) with ordinality g(val, ord)
      cross join lateral jsonb_array_elements_text(g.val -> 'terms') x(term)
     where g.ord::integer = any (v_groups)
  ) s;

  foreach v_term in array v_terms loop
    v_one := plainto_tsquery('english', v_term);
    if numnode(v_one) > 0 then
      v_tsq := case when v_tsq is null then v_one else v_tsq || v_one end;
    end if;
  end loop;

  create temporary table if not exists pg_temp.learning_search_hits (
    content_id uuid, code text, title text, summary text,
    category public.health_education_category, content_type public.health_education_content_type,
    estimated_minutes integer, is_micro_lesson boolean, reviewed_by_name text, rank real
  ) on commit drop;
  truncate pg_temp.learning_search_hits;

  insert into pg_temp.learning_search_hits
  select c.id, c.code, c.title, c.summary, c.category, c.content_type, c.estimated_minutes,
         c.is_micro_lesson, c.reviewed_by_name,
         (coalesce(case when v_tsq is null then 0 else ts_rank(
            to_tsvector('english'::regconfig, (((coalesce(c.title, '') || ' ') || coalesce(c.summary, '')) || ' ') || coalesce(c.body, '')),
            v_tsq) end, 0)
          + case when exists (select 1 from unnest(v_terms) t where (' ' || private.learning_norm(c.title) || ' ') like ('% ' || t || ' %')) then 2 else 0 end)::real
    from public.health_education_content c
   where private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due)
     and not c.is_placeholder
     and private.learning_age_ok(c.min_age, c.max_age)
     and (
       (v_tsq is not null and to_tsvector('english'::regconfig, (((coalesce(c.title, '') || ' ') || coalesce(c.summary, '')) || ' ') || coalesce(c.body, '')) @@ v_tsq)
       or exists (select 1 from unnest(v_terms) t where (' ' || private.learning_norm(c.title) || ' ') like ('% ' || t || ' %'))
     );

  select count(*) into v_found from pg_temp.learning_search_hits;

  -- Zero-result log: anonymous phrase and count only. OFF until the founder and the DPO confirm it (config `enabled`, OQ-S55-05), and
  -- only for a search the person submitted (p_log), never for the half-typed words of a type-ahead. Skipped for anything that looks
  -- like an identifier (an at-sign, or five or more digits anywhere in the phrase however they are spaced). When the table holds
  -- max_rows the least useful row (lowest count, then oldest) makes room, so junk cannot blind the log.
  if v_found = 0
     and p_log
     and coalesce((v_cfg ->> 'enabled')::boolean, false)
     and char_length(v_q) <= (v_cfg ->> 'max_query_chars')::integer
     and array_length(v_words, 1) <= (v_cfg ->> 'max_words')::integer
     and p_query !~ '@'
     and char_length(regexp_replace(p_query, '[^0-9]', '', 'g')) < 5 then
    begin
      delete from public.learning_search_gaps
       where last_seen < (now() at time zone 'Africa/Lagos')::date - (v_cfg ->> 'retention_days')::integer;
      if not exists (select 1 from public.learning_search_gaps where query_norm = v_q)
         and (select count(*) from public.learning_search_gaps) >= (v_cfg ->> 'max_rows')::integer then
        delete from public.learning_search_gaps
         where query_norm = (select query_norm from public.learning_search_gaps order by hit_count, last_seen, query_norm limit 1);
      end if;
      insert into public.learning_search_gaps as g (query_norm) values (v_q)
      on conflict (query_norm) do update
        set hit_count = g.hit_count + 1,
            last_seen = (now() at time zone 'Africa/Lagos')::date;
    exception when others then
      -- planning telemetry only: the search itself must still answer. Not silent: it lands in the database log.
      raise warning 'learning search gap log failed: %', sqlerrm;
    end;
  end if;

  return query select * from pg_temp.learning_search_hits order by rank desc, title limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trust and template facts for a list of items (reviewer, sources, review date, creator credit, action)
-- ---------------------------------------------------------------------------
create or replace function public.health_education_item_trust(p_codes text[])
returns table (
  code text, clinician_reviewed boolean, reviewed_by_name text, clinical_author_name text, reviewed_at timestamptz,
  next_review_due date, source_reference text, evidence_source text, creator_name text,
  audio_clip_id text, self_care_action text, is_shareable boolean, is_micro_lesson boolean, lesson_action text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code, c.clinician_reviewed, c.reviewed_by_name, c.clinical_author_name, c.reviewed_at,
         c.next_review_due, c.source_reference, c.evidence_source,
         case when cr.status = 'verified' then cr.display_name end,
         c.audio_clip_id, c.self_care_action, private.learning_item_is_shareable(c), c.is_micro_lesson, c.lesson_action
    from public.health_education_content c
    left join public.learning_creators cr on cr.id = c.creator_id
   where (select auth.uid()) is not null
     and c.code = any (p_codes[1:100])
     and private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due)
     and private.learning_age_ok(c.min_age, c.max_age)
     and not c.is_placeholder;
$$;

-- ---------------------------------------------------------------------------
-- Daily micro-lesson card (spec 9.2): one lesson, stable for the Lagos day
-- ---------------------------------------------------------------------------
create or replace function public.daily_micro_lesson()
returns table (
  content_id uuid, code text, title text, summary text, body text, estimated_minutes integer,
  lesson_action text, self_care_action text, check_question jsonb, audio_clip_id text,
  reviewed_by_name text, reviewed_at timestamptz, next_review_due date, source_reference text,
  completed_today boolean, status public.health_education_status
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  day0 as (select (date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') as t)
  select c.id, c.code, c.title, c.summary, c.body, c.estimated_minutes, c.lesson_action, c.self_care_action,
         c.knowledge_check -> 0, c.audio_clip_id, c.reviewed_by_name, c.reviewed_at, c.next_review_due,
         coalesce(c.source_reference, c.evidence_source),
         (p.status = 'understood' and p.last_viewed_at >= (select t from day0)),
         p.status
    from public.health_education_content c
    left join public.health_education_progress p
      on p.content_id = c.id and p.patient_id = (select id from me)
   where (select id from me) is not null
     and c.is_micro_lesson
     and not c.is_placeholder
     and private.learning_age_ok(c.min_age, c.max_age)
     and private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due)
     and (p.status is distinct from 'understood' or p.last_viewed_at >= (select t from day0))
   order by (p.status = 'understood') desc nulls last,
            exists (select 1 from public.care_plans cp
                     where cp.patient_id = (select id from me) and cp.condition = c.condition) desc,
            c.sort_order, c.code
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Creators (invite-only): invite, submit evidence, verify, suspend
-- ---------------------------------------------------------------------------
create or replace function public.invite_learning_creator(p_profile uuid, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_role public.user_role;
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Only an admin may invite a creator' using errcode = '42501';
  end if;
  select organisation_id, role into v_org, v_role from public.profiles where id = p_profile;
  if v_org is null then
    raise exception 'Unknown profile' using errcode = '22023';
  end if;
  if v_role <> 'clinician' then
    raise exception 'Only a clinician login can be invited as a creator' using errcode = '22023';
  end if;
  insert into public.learning_creators (organisation_id, profile_id, display_name, invited_by)
  values (v_org, p_profile, btrim(p_display_name), (select auth.uid()))
  returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_org, (select auth.uid()), 'learning_creator.invited', 'learning_creator', v_id, '{}'::jsonb);
  return v_id;
end;
$$;

create or replace function public.submit_creator_credentials(p_mdcn text, p_evidence text, p_indemnity boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.learning_creators%rowtype;
begin
  select * into v_row from public.learning_creators where profile_id = (select auth.uid()) for update;
  if not found then
    raise exception 'You have not been invited as a creator' using errcode = '42501';
  end if;
  if v_row.status not in ('invited', 'pending_verification', 'declined') then
    raise exception 'Your credentials cannot be changed in this state' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_mdcn, ''))) < 4 or char_length(btrim(coalesce(p_evidence, ''))) < 10 then
    raise exception 'An MDCN number and a description of the evidence are required' using errcode = '22023';
  end if;
  update public.learning_creators
     set mdcn_number = btrim(p_mdcn), credential_evidence = btrim(p_evidence),
         indemnity_confirmed = coalesce(p_indemnity, false), status = 'pending_verification', status_note = null
   where id = v_row.id;
end;
$$;

create or replace function public.verify_learning_creator(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.learning_creators%rowtype;
begin
  if not private.is_admin() then
    raise exception 'Only an admin may verify a creator' using errcode = '42501';
  end if;
  select * into v_row from public.learning_creators where id = p_id for update;
  if not found then raise exception 'Unknown creator' using errcode = '22023'; end if;
  if v_row.profile_id = (select auth.uid()) then
    raise exception 'A creator cannot verify themselves' using errcode = '42501';
  end if;
  if v_row.status <> 'pending_verification' then
    raise exception 'Only a creator with submitted credentials can be verified' using errcode = '22023';
  end if;
  if v_row.mdcn_number is null or v_row.credential_evidence is null or not v_row.indemnity_confirmed then
    raise exception 'An MDCN number, credential evidence and an indemnity confirmation are all required' using errcode = '22023';
  end if;
  update public.learning_creators
     set status = 'verified', verified_by = (select auth.uid()), verified_at = now(), status_note = p_note
   where id = p_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_row.organisation_id, (select auth.uid()), 'learning_creator.verified', 'learning_creator', p_id, '{}'::jsonb);
end;
$$;

create or replace function public.suspend_learning_creator(p_id uuid, p_reason text, p_decline boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.learning_creators%rowtype;
  v_n integer;
begin
  if not private.is_admin() then
    raise exception 'Only an admin may suspend a creator' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A reason of at least 10 characters is required' using errcode = '22023';
  end if;
  select * into v_row from public.learning_creators where id = p_id for update;
  if not found then raise exception 'Unknown creator' using errcode = '22023'; end if;
  update public.learning_creators
     set status = case when p_decline then 'declined' else 'suspended' end,
         verified_by = null, verified_at = null, status_note = btrim(p_reason)
   where id = p_id;
  -- their published content stops being served until a clinician reviews it again. It goes to 'updated' (needs re-review, not live),
  -- NOT 'review_due': after the F1 review (OQ-F1-04) review_due is a flag that keeps an item served until its own review date, so
  -- it would not take anything down.
  with prev as (
    select c.id, c.content_status as old_status
      from public.health_education_content c
     where c.creator_id = p_id and c.content_status in ('published', 'review_due')
       for update
  ), moved as (
    update public.health_education_content c
       set content_status = 'updated'
      from prev
     where c.id = prev.id
    returning c.id, prev.old_status
  ), hist as (
    insert into public.health_education_content_status_history (content_id, from_status, to_status, actor_id, note)
    select id, old_status, 'updated', (select auth.uid()), 'Automatic: credited creator suspended' from moved
    returning 1
  )
  select count(*) into v_n from moved;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_row.organisation_id, (select auth.uid()), 'learning_creator.suspended', 'learning_creator', p_id,
            jsonb_build_object('content_taken_down', v_n));
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- "Ask your care team": save a lesson for the next consultation (patient), read it (tied clinician)
-- ---------------------------------------------------------------------------
create or replace function public.save_lesson_for_consultation(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_org uuid;
  v_content uuid;
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_me;
  select c.id into v_content from public.health_education_content c
   where c.code = p_code and not c.is_placeholder
     and private.learning_age_ok(c.min_age, c.max_age)
     and private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due);
  if v_content is null then
    return false;
  end if;
  insert into public.learning_saved_for_consultation (organisation_id, patient_id, content_id)
  values (v_org, v_me, v_content)
  on conflict (patient_id, content_id) do update set discussed_at = null, saved_at = now();
  return true;
end;
$$;

create or replace function public.consultation_saved_lessons(p_patient uuid)
returns table (code text, title text, saved_at timestamptz, discussed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.clinician_has_patient_access(p_patient) then
    perform private.audit_denied_read('learning_saved.read', 'learning_saved_for_consultation', p_patient,
      'No active task, assignment or consultation ties this clinician to the patient');
    -- empty, not an error: an error would roll the denied-read audit row back with it
    return;
  end if;
  perform private.audit_patient_read(p_patient, 'learning_saved_for_consultation', null,
    'Viewed the lessons the patient saved for the consultation', 'learning_saved.read');
  return query
    select c.code, c.title, s.saved_at, s.discussed_at
      from public.learning_saved_for_consultation s
      join public.health_education_content c on c.id = s.content_id
     where s.patient_id = p_patient
       and private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due)
     order by s.saved_at desc;
end;
$$;

create or replace function public.mark_saved_lessons_discussed(p_patient uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  if not private.clinician_has_patient_access(p_patient) then
    raise exception 'No access' using errcode = '42501';
  end if;
  update public.learning_saved_for_consultation set discussed_at = now()
   where patient_id = p_patient and discussed_at is null;
  get diagnostics v_n = row_count;
  perform private.audit_patient_read(p_patient, 'learning_saved_for_consultation', null,
    'Marked the patient''s saved lessons as discussed', 'learning_saved.discussed');
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Share by link (spec 9.8): anon-callable, articles only, published and in date, no patient data
-- ---------------------------------------------------------------------------
create or replace function public.learn_shared_article(p_code text)
returns table (
  code text, title text, summary text, body text, estimated_minutes integer,
  reviewed_by_name text, reviewed_at timestamptz, next_review_due date,
  source_reference text, evidence_source text, self_care_action text, creator_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code, c.title, c.summary, c.body, c.estimated_minutes,
         c.reviewed_by_name, c.reviewed_at, c.next_review_due, c.source_reference, c.evidence_source,
         c.self_care_action, case when cr.status = 'verified' then cr.display_name end
    from public.health_education_content c
    left join public.learning_creators cr on cr.id = c.creator_id
   where c.code = p_code
     and private.learning_item_is_shareable(c);
$$;

-- ---------------------------------------------------------------------------
-- Offline pack (spec 9.6): what the phone may download, and a status check to refresh on reconnect
-- ---------------------------------------------------------------------------
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
         coalesce(private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due) and not c.is_placeholder and private.learning_age_ok(c.min_age, c.max_age), false),
         c.content_version, c.next_review_due
    from unnest(p_codes[1:300]) as k(code)
    left join public.health_education_content c on c.code = k.code
   where (select auth.uid()) is not null;
$$;

-- ---------------------------------------------------------------------------
-- Admin reports
-- ---------------------------------------------------------------------------
create or replace function public.learning_search_gaps_report()
returns table (query_norm text, hit_count integer, first_seen date, last_seen date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only an admin may read the search gaps' using errcode = '42501';
  end if;
  return query
    select g.query_norm, g.hit_count, g.first_seen, g.last_seen
      from public.learning_search_gaps g
     where g.hit_count >= (private.learning_config('search_gap_log') ->> 'min_count_to_show')::integer
       and g.last_seen >= (now() at time zone 'Africa/Lagos')::date - (private.learning_config('search_gap_log') ->> 'retention_days')::integer
     order by g.hit_count desc, g.last_seen desc
     limit 200;
end;
$$;

create or replace function public.learning_readiness_report()
returns table (metric text, n integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only an admin may read the readiness report' using errcode = '42501';
  end if;
  return query
  select m.metric, m.n from (
    select 'published_items'::text as metric, count(*)::integer as n, 1 as o
      from public.health_education_content where content_status = 'published' and not is_placeholder
    union all select 'published_without_review_date', count(*)::integer, 2
      from public.health_education_content where content_status = 'published' and next_review_due is null
    union all select 'published_without_named_reviewer', count(*)::integer, 3
      from public.health_education_content where content_status = 'published' and (reviewed_by_name is null or btrim(reviewed_by_name) = '')
    union all select 'published_without_source', count(*)::integer, 4
      from public.health_education_content where content_status = 'published'
       and coalesce(btrim(source_reference), '') = '' and coalesce(btrim(evidence_source), '') = ''
    union all select 'published_without_self_care_action', count(*)::integer, 5
      from public.health_education_content where content_status = 'published' and coalesce(btrim(self_care_action), '') = ''
    union all select 'draft_placeholders', count(*)::integer, 6
      from public.health_education_content where is_placeholder
    union all select 'creators_verified', count(*)::integer, 7 from public.learning_creators where status = 'verified'
    union all select 'creators_waiting_verification', count(*)::integer, 8 from public.learning_creators where status = 'pending_verification'
    union all select 'review_flagged_still_live', count(*)::integer, 9
      from public.health_education_content
     where content_status = 'review_due' and is_active and not is_placeholder
       and (next_review_due is null or next_review_due > (now() at time zone 'Africa/Lagos')::date)
  ) m order by m.o;
end;
$$;

-- ---------------------------------------------------------------------------
-- grants: revoke from public, grant explicitly
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.search_health_education(text, integer, boolean)',
    'public.health_education_item_trust(text[])',
    'public.daily_micro_lesson()',
    'public.invite_learning_creator(uuid, text)',
    'public.submit_creator_credentials(text, text, boolean)',
    'public.verify_learning_creator(uuid, text)',
    'public.suspend_learning_creator(uuid, text, boolean)',
    'public.save_lesson_for_consultation(text)',
    'public.consultation_saved_lessons(uuid)',
    'public.mark_saved_lessons_discussed(uuid)',
    'public.learn_shared_article(text)',
    'public.learning_offline_pack()',
    'public.learning_pack_status(text[])',
    'public.learning_search_gaps_report()',
    'public.learning_readiness_report()',
    'private.learning_age_ok(integer, integer)',
    'private.learning_item_is_shareable(public.health_education_content)',
    'private.health_education_publish_gate()'
  ] loop
    execute format('revoke execute on function %s from public', v_sig);
    execute format('revoke execute on function %s from anon', v_sig);
    if v_sig not like 'private.%' then
      execute format('grant execute on function %s to authenticated, service_role', v_sig);
    end if;
  end loop;
  grant execute on function public.learn_shared_article(text) to anon;
end $$;

-- ---------------------------------------------------------------------------
-- self-check: every function exercised or inspected, grants verified
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.search_health_education(text, integer, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.daily_micro_lesson()', 'EXECUTE')
     or has_function_privilege('anon', 'public.learning_offline_pack()', 'EXECUTE')
     or has_function_privilege('anon', 'public.verify_learning_creator(uuid, text)', 'EXECUTE') then
    raise exception 'S55: anon can execute a signed-in learning function';
  end if;
  if not has_function_privilege('anon', 'public.learn_shared_article(text)', 'EXECUTE') then
    raise exception 'S55: the shared article function must be callable signed out';
  end if;
  -- lesson.completed / course.completed come from S33's trigger on health_education_progress, which S55 relies on and does not duplicate
  if not exists (select 1 from pg_trigger where tgname = 'health_education_progress_events' and not tgisinternal) then
    raise exception 'S55: S33 completion event trigger missing';
  end if;
end $$;
