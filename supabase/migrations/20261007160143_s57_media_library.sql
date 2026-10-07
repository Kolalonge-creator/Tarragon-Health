-- S57 step 1 of 4: the meditation and sleep library (functions 10.4 to 10.9) and its publish gate.
--
-- NEW: media_library (a GLOBAL catalogue, no organisation_id, the same precedent as health_education_content: it holds no patient data),
-- media_library_config (versioned PROPOSED values), media_sessions (what a patient listened to: patient-only), the go-live guard
-- wellbeing_library_clinical_scripts, the event media.session_completed (ids only).
-- ROWS AFFECTED: none existing. The migration seeds 12 DRAFT placeholder rows (structure only, no content, never servable) and one
-- DRAFT config row. Nothing is signed or published by the build.
--
-- THE ONE RULE (same shape as the F1 learning-content gate): an item is SERVABLE when it is active, published, not a placeholder and its
-- review date (Africa/Lagos calendar day) is in the future. A published item whose date has passed is NOT served, at once, with no job in
-- between (read-time rule in the RLS policy and in every function here). A publish needs a named reviewer, a review date, a future next
-- review date, the right payload for its kind (audio, or a script with steps) and, when a creator is credited and the S55 table exists,
-- a verified creator. Editing the material of a published item without a new review date is refused.
-- Exercises and breathing scripts are reviewed clinical-adjacent content: they are additionally behind the CMO-switched guard
-- wellbeing_library_clinical_scripts (seeded OFF; a test account always passes, like every guard).

-- 1. Config ------------------------------------------------------------------------------------------------------------------
create table if not exists public.media_library_config (
  id           uuid primary key default gen_random_uuid(),
  version      integer not null unique check (version >= 1),
  status       text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  config       jsonb not null,
  notes        text,
  confirmed_by uuid references public.profiles (id) on delete restrict,
  confirmed_at timestamptz,
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint media_library_config_confirmed_has_signer check (status <> 'confirmed' or (confirmed_by is not null and confirmed_at is not null))
);
create unique index if not exists media_library_config_one_active on public.media_library_config (is_active) where is_active;
create index if not exists media_library_config_confirmed_by_idx on public.media_library_config (confirmed_by) where confirmed_by is not null;
alter table public.media_library_config enable row level security;
drop policy if exists media_library_config_select on public.media_library_config;
create policy media_library_config_select on public.media_library_config for select to authenticated using (true);
revoke all on public.media_library_config from anon;
revoke insert, update, delete, truncate on public.media_library_config from authenticated;
grant select on public.media_library_config to authenticated;
-- medialib-config-v1-begin
insert into public.media_library_config (version, status, config, notes, is_active)
values (1, 'proposed', $json${"download":{"wifi_only":true,"max_track_bytes":5242880,"max_pack_bytes":52428800},"breathing":{"min_seconds":180,"max_seconds":300,"max_phase_seconds":10},"sleep_feedback":{"change_epsilon_pct":2},"session":{"min_listened_seconds":30}}$json$::jsonb,
  'DRAFT, UNSIGNED (S57, 2026-10-07). Download caps (5 MB a track from the plan, 50 MB a pack is the build''s proposal), breathing length 3 to 5 minutes (spec 10.7) and the longest single phase, the smallest weekly change worth mentioning, the shortest listen that counts as a session. PROPOSED by the build, not a clinical decision.', true)
on conflict (version) do nothing;
-- medialib-config-v1-end

create or replace function private.media_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select config from public.media_library_config where is_active
$$;
revoke all on function private.media_config() from public, anon, authenticated;

-- 2. The catalogue -----------------------------------------------------------------------------------------------------------
create table if not exists public.media_library (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  kind             text not null check (kind in ('meditation', 'sleep_story', 'soundscape', 'breathing', 'exercise')),
  exercise_type    text check (exercise_type in ('self_help', 'positive_psychology', 'journal_prompt')),
  title            text not null check (char_length(btrim(title)) between 2 and 140),
  summary          text check (summary is null or char_length(summary) <= 400),
  series           text not null default 'general'
                     check (series in ('general', 'intro', 'stress', 'grief', 'work', 'exams', 'faith_reflection', 'sleep')),
  series_position  integer not null default 100 check (series_position >= 0),
  language         text not null default 'en' check (language ~ '^[a-z]{2,3}$'),
  voice            text check (voice is null or char_length(voice) <= 80),
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  bytes            integer check (bytes is null or bytes > 0),
  audio_url        text,
  audio_clip_id    text,          -- seam: S32 audio manifest clip id, when that branch is merged
  script           jsonb,         -- exercises and breathing: {"steps":[{"text":"..."}], "pattern":{"inhale_s":n,"hold_s":n,"exhale_s":n}}
  creator_id       uuid,          -- seam: S55 learning_creators.id (foreign key added below only if that table exists)
  downloadable     boolean not null default true,
  content_status   text not null default 'draft' check (content_status in ('draft', 'published', 'review_due', 'withdrawn')),
  is_placeholder   boolean not null default true,
  is_active        boolean not null default false,
  reviewed_by_name text,
  reviewed_at      date,
  next_review_due  date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint media_library_active_means_published check (not is_active or content_status = 'published'),
  constraint media_library_exercise_has_type check ((kind = 'exercise') = (exercise_type is not null))
);
create index if not exists media_library_browse_idx on public.media_library (kind, series, series_position) where is_active;
create index if not exists media_library_creator_idx on public.media_library (creator_id) where creator_id is not null;
drop trigger if exists set_updated_at on public.media_library;
create trigger set_updated_at before update on public.media_library for each row execute function private.set_updated_at();

do $$ begin
  if to_regclass('public.learning_creators') is not null
     and not exists (select 1 from pg_constraint where conname = 'media_library_creator_fk') then
    alter table public.media_library add constraint media_library_creator_fk
      foreign key (creator_id) references public.learning_creators (id) on delete restrict;
  end if;
end $$;

create or replace function private.media_is_servable(p_active boolean, p_status text, p_placeholder boolean, p_next_review date)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(p_active, false) and p_status = 'published' and not coalesce(p_placeholder, true)
     and p_next_review is not null and p_next_review > (now() at time zone 'Africa/Lagos')::date
$$;
revoke all on function private.media_is_servable(boolean, text, boolean, date) from public, anon;
grant execute on function private.media_is_servable(boolean, text, boolean, date) to authenticated, service_role;

create or replace function private.media_library_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cfg jsonb; v_bmin integer; v_bmax integer; v_ph integer; v_ok boolean; v_dur integer;
begin
  if tg_op = 'UPDATE' and old.content_status = 'published' and new.content_status = 'published'
     and (new.title, new.summary, new.script, new.audio_url, new.audio_clip_id, new.duration_seconds, new.voice)
         is distinct from (old.title, old.summary, old.script, old.audio_url, old.audio_clip_id, old.duration_seconds, old.voice)
     and new.reviewed_at is not distinct from old.reviewed_at then
    raise exception 'The material of a published item changed: record a new review date first' using errcode = '23514';
  end if;
  if new.content_status <> 'published' then return new; end if;
  if new.is_placeholder then raise exception 'A placeholder cannot be published' using errcode = '23514'; end if;
  if new.reviewed_by_name is null or char_length(btrim(new.reviewed_by_name)) < 3 or new.reviewed_at is null then
    raise exception 'Publishing needs a named reviewer and a review date' using errcode = '23514';
  end if;
  if new.next_review_due is null or new.next_review_due <= (now() at time zone 'Africa/Lagos')::date then
    raise exception 'Publishing needs a next review date in the future' using errcode = '23514';
  end if;
  if new.kind in ('meditation', 'sleep_story', 'soundscape') then
    if coalesce(btrim(new.audio_url), '') = '' and coalesce(btrim(new.audio_clip_id), '') = '' then
      raise exception 'An audio item needs an audio file' using errcode = '23514';
    end if;
    if new.duration_seconds is null or new.bytes is null then
      raise exception 'An audio item needs its length and size' using errcode = '23514';
    end if;
  else
    v_ok := new.script is not null and jsonb_typeof(new.script -> 'steps') = 'array' and jsonb_array_length(new.script -> 'steps') > 0;
    if not v_ok then raise exception 'A script item needs at least one step' using errcode = '23514'; end if;
    if new.kind = 'breathing' then
      v_cfg := private.media_config() -> 'breathing';
      v_bmin := (v_cfg ->> 'min_seconds')::integer; v_bmax := (v_cfg ->> 'max_seconds')::integer; v_ph := (v_cfg ->> 'max_phase_seconds')::integer;
      v_dur := new.duration_seconds;
      if v_bmin is null or v_bmax is null or v_ph is null then raise exception 'No breathing bounds are configured' using errcode = '23514'; end if;
      if v_dur is null or v_dur < v_bmin or v_dur > v_bmax then
        raise exception 'A breathing exercise must last between % and % seconds', v_bmin, v_bmax using errcode = '23514';
      end if;
      if jsonb_typeof(new.script -> 'pattern') <> 'object'
         or coalesce((new.script -> 'pattern' ->> 'inhale_s')::numeric, 0) <= 0 or coalesce((new.script -> 'pattern' ->> 'exhale_s')::numeric, 0) <= 0
         or (new.script -> 'pattern' ->> 'inhale_s')::numeric > v_ph or (new.script -> 'pattern' ->> 'exhale_s')::numeric > v_ph
         or coalesce((new.script -> 'pattern' ->> 'hold_s')::numeric, 0) > v_ph then
        raise exception 'A breathing pattern needs inhale and exhale seconds within the configured limit' using errcode = '23514';
      end if;
    end if;
  end if;
  if new.creator_id is not null and to_regclass('public.learning_creators') is not null then
    if not exists (select 1 from public.learning_creators where id = new.creator_id and status = 'verified') then
      raise exception 'The credited creator is not verified' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.media_library_gate() from public, anon, authenticated;
drop trigger if exists media_library_gate on public.media_library;
create trigger media_library_gate before insert or update on public.media_library for each row execute function private.media_library_gate();

alter table public.media_library enable row level security;
-- A patient reads only servable items; scripts (exercise, breathing) also need the guard. An admin reads and writes everything.
drop policy if exists media_library_select on public.media_library;
create policy media_library_select on public.media_library for select to authenticated using (
  private.is_admin()
  or (private.media_is_servable(is_active, content_status, is_placeholder, next_review_due)
      and (kind in ('meditation', 'sleep_story', 'soundscape')
           or private.go_live_open_patient('wellbeing_library_clinical_scripts', (select auth.uid())))));
drop policy if exists media_library_admin_write on public.media_library;
create policy media_library_admin_write on public.media_library for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
revoke all on public.media_library from anon;
grant select, insert, update, delete on public.media_library to authenticated;

-- 3. DRAFT placeholders: structure only (series, kinds). None can be published (is_placeholder) and none is servable. 12 rows.
insert into public.media_library (code, kind, exercise_type, title, summary, series, series_position)
values
  ('draft-intro-1', 'meditation', null, 'Introduction to meditation, session 1 (draft)', 'Placeholder. A clinical or content author writes this.', 'intro', 1),
  ('draft-stress-1', 'meditation', null, 'Stress series, session 1 (draft)', 'Placeholder.', 'stress', 1),
  ('draft-grief-1', 'meditation', null, 'Grief series, session 1 (draft)', 'Placeholder.', 'grief', 1),
  ('draft-work-1', 'meditation', null, 'Work series, session 1 (draft)', 'Placeholder.', 'work', 1),
  ('draft-exams-1', 'meditation', null, 'Exams series, session 1 (draft)', 'Placeholder.', 'exams', 1),
  ('draft-faith-1', 'meditation', null, 'Faith-compatible reflection, session 1 (draft)', 'Placeholder structure only. No spiritual text is written by the build.', 'faith_reflection', 1),
  ('draft-sleep-story-1', 'sleep_story', null, 'Sleep story 1 (draft)', 'Placeholder.', 'sleep', 1),
  ('draft-soundscape-1', 'soundscape', null, 'Soundscape 1 (draft)', 'Placeholder.', 'sleep', 2),
  ('draft-breathing-1', 'breathing', null, 'Paced breathing, 3 minutes (draft)', 'Placeholder. The pattern is set by the reviewer.', 'general', 1),
  ('draft-self-help-1', 'exercise', 'self_help', 'Self-help exercise 1 (draft)', 'Placeholder script.', 'general', 2),
  ('draft-positive-1', 'exercise', 'positive_psychology', 'Positive psychology activity 1 (draft)', 'Placeholder script.', 'general', 3),
  ('draft-journal-prompt-1', 'exercise', 'journal_prompt', 'Journal prompt 1 (draft)', 'Placeholder prompt.', 'general', 4)
on conflict (code) do nothing;

-- 4. What a patient listened to: patient-only, written by record_media_session ----------------------------------------------------
create table if not exists public.media_sessions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  media_id         uuid not null references public.media_library (id) on delete restrict,
  listened_seconds integer not null check (listened_seconds between 0 and 14400),
  is_test          boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists media_sessions_patient_idx on public.media_sessions (patient_id, created_at desc);
create index if not exists media_sessions_org_idx on public.media_sessions (organisation_id);
create index if not exists media_sessions_media_idx on public.media_sessions (media_id);
alter table public.media_sessions enable row level security;
drop policy if exists media_sessions_select on public.media_sessions;
create policy media_sessions_select on public.media_sessions for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.media_sessions from anon;
revoke insert, update, delete, truncate on public.media_sessions from authenticated;
grant select on public.media_sessions to authenticated;

insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('media.session_completed', 'A patient finished a library session (ids only: session_id; what they listened to is never in the event)', 'S57', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('media.session_completed', 1, array['session_id'])
on conflict (event_type, version) do nothing;

create or replace function public.record_media_session(p_media uuid, p_listened_seconds integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_pr public.profiles%rowtype; v_m public.media_library%rowtype; v_id uuid; v_min integer;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into v_pr from public.profiles where id = v_uid and role = 'patient';
  if not found then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into v_m from public.media_library where id = p_media;
  if not found or not private.media_is_servable(v_m.is_active, v_m.content_status, v_m.is_placeholder, v_m.next_review_due) then
    raise exception 'That item is not available' using errcode = '22023';
  end if;
  if p_listened_seconds is null or p_listened_seconds < 0 or p_listened_seconds > 14400 then raise exception 'bad length' using errcode = '22023'; end if;
  v_min := coalesce((private.media_config() -> 'session' ->> 'min_listened_seconds')::integer, 2147483647);
  insert into public.media_sessions (organisation_id, patient_id, media_id, listened_seconds, is_test)
  values (v_pr.organisation_id, v_uid, p_media, p_listened_seconds, coalesce(v_pr.is_test, false)) returning id into v_id;
  if p_listened_seconds >= v_min then
    begin
      perform private.emit_domain_event('media.session_completed', v_pr.organisation_id, jsonb_build_object('session_id', v_id),
        'media.session_completed:' || v_id, v_uid, 'media_session', v_id);
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (v_pr.organisation_id, 'media_session_event.error', 'media_session', v_id, jsonb_build_object('error', sqlerrm));
    end;
  end if;
  return v_id;
end $$;
revoke all on function public.record_media_session(uuid, integer) from public, anon;
grant execute on function public.record_media_session(uuid, integer) to authenticated;

-- 5. Offline manifest: servable audio only, within the configured caps, expired items never listed ---------------------------------
create or replace function public.media_offline_manifest() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_cfg jsonb := private.media_config() -> 'download'; v_track bigint; v_pack bigint; v_run bigint := 0; v_items jsonb := '[]'::jsonb; r record;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  v_track := (v_cfg ->> 'max_track_bytes')::bigint; v_pack := (v_cfg ->> 'max_pack_bytes')::bigint;
  if v_track is null or v_pack is null then return jsonb_build_object('wifi_only', true, 'items', '[]'::jsonb); end if;
  for r in
    select id, code, bytes, audio_url, audio_clip_id, updated_at, next_review_due from public.media_library
     where kind in ('meditation', 'sleep_story', 'soundscape') and downloadable
       and private.media_is_servable(is_active, content_status, is_placeholder, next_review_due)
       and bytes is not null and bytes <= v_track
     order by series, series_position, code
  loop
    exit when v_run + r.bytes > v_pack;
    v_run := v_run + r.bytes;
    v_items := v_items || jsonb_build_array(jsonb_build_object('id', r.id, 'code', r.code, 'bytes', r.bytes, 'audio_url', r.audio_url,
      'audio_clip_id', r.audio_clip_id, 'updated_at', r.updated_at, 'expires_on', r.next_review_due));
  end loop;
  return jsonb_build_object('wifi_only', coalesce((v_cfg ->> 'wifi_only')::boolean, true), 'max_track_bytes', v_track, 'max_pack_bytes', v_pack, 'items', v_items);
end $$;
revoke all on function public.media_offline_manifest() from public, anon;
grant execute on function public.media_offline_manifest() to authenticated;

-- 6. Admin: flag items past their date (display only: the read rule already hides them) and a readiness report ------------------------
create or replace function public.media_library_flag_expired() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not (private.is_admin() or coalesce((select auth.role()), '') = 'service_role') then raise exception 'not authorised' using errcode = '42501'; end if;
  update public.media_library set content_status = 'review_due', is_active = false
   where content_status = 'published' and next_review_due is not null and next_review_due <= (now() at time zone 'Africa/Lagos')::date;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.media_library_flag_expired() from public, anon;
grant execute on function public.media_library_flag_expired() to authenticated, service_role;

create or replace function public.media_library_readiness_report() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  return (select jsonb_build_object(
    'servable', count(*) filter (where private.media_is_servable(is_active, content_status, is_placeholder, next_review_due)),
    'placeholders', count(*) filter (where is_placeholder),
    'draft', count(*) filter (where content_status = 'draft' and not is_placeholder),
    'expired', count(*) filter (where content_status in ('published', 'review_due') and not private.media_is_servable(is_active, content_status, is_placeholder, next_review_due) and not is_placeholder),
    'by_series', coalesce((select jsonb_object_agg(s, c) from (select series s, count(*) filter (where private.media_is_servable(is_active, content_status, is_placeholder, next_review_due)) c from public.media_library group by series) x), '{}'::jsonb))
    from public.media_library);
end $$;
revoke all on function public.media_library_readiness_report() from public, anon;
grant execute on function public.media_library_readiness_report() to authenticated;

-- 7. Go-live guards ----------------------------------------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in)
values
  ('wellbeing_library_clinical_scripts', 'Wellbeing exercises and breathing scripts',
   'Reviewed self-help exercises, positive psychology activities, journal prompts and guided breathing in the wellbeing library',
   'The CMO has confirmed that the scripts in the library were reviewed and that the care-team and crisis note is shown with each', 'cmo',
   array['policy media_library_select'], 'Audio sessions (meditation, sleep stories, soundscapes), the crisis card, the journal and every other screen are not behind it.'),
  ('sleep_apnoea_screen_enabled', 'Snoring and daytime sleepiness questionnaire',
   'The sleep questionnaire and the referral task it can create',
   'The CMO has signed the instrument (items and cut-off) and referral cover is confirmed', 'cmo',
   array['function submit_sleep_apnoea_screen', 'function get_sleep_apnoea_instrument'], 'The sleep diary, wind-down planner and library are not behind it.')
on conflict (key) do nothing;

do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def not like '%sleep_apnoea_screen_enabled%' then
    v_new := replace(v_def, E'  end if;\n  -- An unknown key has no conditions',
      E'  elsif p_key = ''wellbeing_library_clinical_scripts'' then\n' ||
      E'    return jsonb_build_array(\n' ||
      E'      private.go_live_cond(''scripts_reviewed'', ''The CMO has confirmed the library scripts were reviewed'', private.go_live_attested(p_key, ''scripts_reviewed''), ''attestation'', null),\n' ||
      E'      private.go_live_cond(''care_team_note_confirmed'', ''The care-team and crisis note shown with each script is confirmed'', private.go_live_attested(p_key, ''care_team_note_confirmed''), ''attestation'', null));\n' ||
      E'  elsif p_key = ''sleep_apnoea_screen_enabled'' then\n' ||
      E'    return jsonb_build_array(\n' ||
      E'      private.go_live_cond(''instrument_signed'', ''The sleep questionnaire items and cut-off are signed'', exists (select 1 from public.sleep_apnoea_screen_config where is_active and status = ''confirmed''), ''data'', null),\n' ||
      E'      private.go_live_cond(''referral_cover_confirmed'', ''Clinician cover for sleep referral tasks is confirmed'', private.go_live_attested(p_key, ''referral_cover_confirmed''), ''attestation'', null));\n' ||
      E'  end if;\n  -- An unknown key has no conditions');
    if v_new = v_def then raise exception 'S57: go_live_conditions marker not found (definition drifted)'; end if;
    execute v_new;
  end if;
  v_def := pg_get_functiondef('public.attest_go_live_condition(text, text, boolean, text)'::regprocedure);
  if v_def not like '%wellbeing_library_clinical_scripts%' then
    v_new := replace(v_def, '(''mental_health_follow_up_enabled'', ''follow_up_cover_confirmed'')) then',
      '(''mental_health_follow_up_enabled'', ''follow_up_cover_confirmed''),' || E'\n' ||
      '       (''wellbeing_library_clinical_scripts'', ''scripts_reviewed''), (''wellbeing_library_clinical_scripts'', ''care_team_note_confirmed''),' || E'\n' ||
      '       (''sleep_apnoea_screen_enabled'', ''referral_cover_confirmed'')) then');
    if v_new = v_def then raise exception 'S57: attest_go_live_condition marker not found (definition drifted)'; end if;
    execute v_new;
  end if;
end $$;
