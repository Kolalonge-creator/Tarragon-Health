-- S80a (spec 25.1, Module 25 data model and events): translation status and the content.published event.
--
-- translations: one row per (key, language). state draft -> native_reviewed -> clinical_reviewed. A change to the text or to the
-- source hash puts the row back to draft and clears the reviewer, so a reviewed translation can never silently drift from its source.
-- Only an active Chief Medical Officer may set clinical_reviewed, and only from native_reviewed. Writes go through the two functions
-- below; there is no write policy. The product is English only (D-14): this ships the mechanism and enables no language.
-- translations_release_gate(enabled languages) lists every clinical key not clinical_reviewed in an enabled non-English language, so
-- a build that turns a language on with unreviewed clinical strings can be refused. English wording stays governed by clinical-wording.json.
--
-- Events (INV-07: ids, version and state only, no text): content.published, translation.reviewed.
-- content.published is emitted from set_health_education_content_status when an item becomes published.

create type public.translation_state as enum ('draft', 'native_reviewed', 'clinical_reviewed');

create table public.translations (
  id uuid primary key default gen_random_uuid(),
  key text not null check (length(key) between 1 and 200),
  language text not null check (language ~ '^[a-z]{2,3}$'),
  text text not null check (length(text) > 0),
  is_clinical boolean not null default false,
  state public.translation_state not null default 'draft',
  source_hash text not null check (length(source_hash) between 8 and 128),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, language),
  check ((state = 'draft') = (reviewed_by is null))
);
alter table public.translations enable row level security;
create policy translations_staff_read on public.translations for select to authenticated
  using (private.is_admin() or private.is_active_clinical_director());
revoke all on public.translations from anon;
grant select on public.translations to authenticated;
comment on table public.translations is 'S80a: translated strings with a review state. English only today (D-14); no language is enabled by this table.';

insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('content.published', 'A health education item became published after clinical review', 'S80', false),
  ('translation.reviewed', 'A translation changed review state', 'S80', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('content.published', 1, array['content_id', 'content_version']),
  ('translation.reviewed', 1, array['translation_id', 'language', 'state'])
on conflict (event_type, version) do nothing;

create or replace function public.upsert_translation(
  p_key text, p_language text, p_text text, p_source_hash text, p_is_clinical boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'not authorised: only an admin or the Chief Medical Officer may edit translations';
  end if;
  insert into public.translations (key, language, text, is_clinical, source_hash)
  values (p_key, p_language, p_text, p_is_clinical, p_source_hash)
  on conflict (key, language) do update set
    text = excluded.text,
    is_clinical = excluded.is_clinical or public.translations.is_clinical,
    source_hash = excluded.source_hash,
    state = case when public.translations.text is distinct from excluded.text
                   or public.translations.source_hash is distinct from excluded.source_hash
                 then 'draft'::public.translation_state else public.translations.state end,
    reviewed_by = case when public.translations.text is distinct from excluded.text
                         or public.translations.source_hash is distinct from excluded.source_hash
                       then null else public.translations.reviewed_by end,
    reviewed_at = case when public.translations.text is distinct from excluded.text
                         or public.translations.source_hash is distinct from excluded.source_hash
                       then null else public.translations.reviewed_at end,
    updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.review_translation(p_id uuid, p_state public.translation_state)
returns public.translation_state
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.translations%rowtype;
  v_cmo boolean := private.is_active_clinical_director();
  v_actor uuid := (select auth.uid());
  v_org uuid;
begin
  if not (private.is_admin() or v_cmo) then
    raise exception 'not authorised: only an admin or the Chief Medical Officer may review translations';
  end if;
  select * into v_row from public.translations where id = p_id for update;
  if not found then raise exception 'Unknown translation %', p_id; end if;
  if not (
    (v_row.state = 'draft' and p_state = 'native_reviewed')
    or (v_row.state = 'native_reviewed' and p_state in ('clinical_reviewed', 'draft'))
    or (v_row.state = 'clinical_reviewed' and p_state = 'draft')
  ) then
    raise exception 'Illegal translation state change: % -> %', v_row.state, p_state;
  end if;
  if p_state = 'clinical_reviewed' and not v_cmo then
    raise exception 'not authorised: only an active Chief Medical Officer can mark a translation clinically reviewed';
  end if;
  update public.translations set
    state = p_state,
    reviewed_by = case when p_state = 'draft' then null else v_actor end,
    reviewed_at = case when p_state = 'draft' then null else now() end,
    updated_at = now()
  where id = p_id;
  select organisation_id into v_org from public.profiles where id = v_actor;
  if v_org is not null then
    perform private.emit_domain_event('translation.reviewed', v_org,
      jsonb_build_object('translation_id', p_id, 'language', v_row.language, 'state', p_state),
      'translation.reviewed:' || p_id || ':' || p_state || ':' || extract(epoch from clock_timestamp())::text);
  end if;
  return p_state;
end $$;

create or replace function public.translations_release_gate(p_enabled_languages text[])
returns table (key text, language text, state public.translation_state, reason text)
language sql stable security definer set search_path = '' as $$
  with enabled as (select l from unnest(p_enabled_languages) l where l <> 'en'),
  clinical_keys as (select distinct t.key from public.translations t where t.is_clinical)
  select k.key, e.l, coalesce(t.state, 'draft'::public.translation_state),
         case when t.id is null then 'missing translation of a clinical key' else 'clinical key not clinically reviewed' end
  from clinical_keys k cross join enabled e
  left join public.translations t on t.key = k.key and t.language = e.l
  where t.id is null or t.state <> 'clinical_reviewed'
  order by 1, 2;
$$;

revoke execute on function public.upsert_translation(text, text, text, text, boolean) from public;
revoke execute on function public.review_translation(uuid, public.translation_state) from public;
revoke execute on function public.translations_release_gate(text[]) from public;
grant execute on function public.upsert_translation(text, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.review_translation(uuid, public.translation_state) to authenticated, service_role;
grant execute on function public.translations_release_gate(text[]) to authenticated, service_role;

-- content.published: replace the S80 fix-first function with one that also emits the event.
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
begin
  if not (private.is_admin() or v_cmo) then
    raise exception 'Only an admin or the Chief Medical Officer may change health-education content status';
  end if;

  select content_status into v_current
    from public.health_education_content where id = p_content_id for update;
  if v_current is null then
    raise exception 'Unknown health_education_content id %', p_content_id;
  end if;

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

  update public.health_education_content
    set content_status = p_new_status,
        content_version = case when p_new_status = 'updated' then content_version + 1 else content_version end,
        clinician_reviewed = case when p_new_status = 'approved' then true else clinician_reviewed end,
        reviewed_at = case when p_new_status = 'approved' then now() else reviewed_at end
    where id = p_content_id
    returning content_version into v_version;

  insert into public.health_education_content_status_history (content_id, from_status, to_status, actor_id, note)
  values (p_content_id, v_current, p_new_status, v_actor, p_note);

  if p_new_status = 'published' then
    select organisation_id into v_org from public.profiles where id = v_actor;
    if v_org is not null then
      perform private.emit_domain_event('content.published', v_org,
        jsonb_build_object('content_id', p_content_id, 'content_version', v_version),
        'content.published:' || p_content_id || ':' || extract(epoch from clock_timestamp())::text,
        null, 'health_education_content', p_content_id);
    end if;
  end if;

  return p_new_status;
end;
$$;

revoke execute on function public.set_health_education_content_status(uuid, public.health_education_content_status, text) from public;
grant execute on function public.set_health_education_content_status(uuid, public.health_education_content_status, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.upsert_translation(text, text, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.review_translation(uuid, public.translation_state)', 'EXECUTE')
     or has_function_privilege('anon', 'public.translations_release_gate(text[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_health_education_content_status(uuid, public.health_education_content_status, text)', 'EXECUTE') then
    raise exception 'anon must not execute the S80a functions';
  end if;
  if has_table_privilege('anon', 'public.translations', 'SELECT') then
    raise exception 'anon must not read translations';
  end if;
end $$;
