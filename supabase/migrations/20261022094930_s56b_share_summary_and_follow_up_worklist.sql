-- S56b step 1 of 2: "Share with my doctor" summary and the mental health follow-up worklist.
-- Design: docs/design/S56b.md. Builds on S56 (per-patient access INV-12, audited reads INV-10, hand-offs) and S57 (sleep diary).
--
-- WHAT THIS ADDS
--   1. mental_health_handoffs gains kind ('screen' | 'doctor_summary' | 'talk_request'), seen_by and seen_at. A tied clinician marks a hand-off
--      seen through mark_mental_health_handoff_seen (audited). The existing audited read (read_patient_mental_health_audited) now also
--      returns kind, seen_at: it is the ONLY way staff read a summary, so every read is an audit_log row. Rows affected on migrate: every
--      existing hand-off takes kind 'screen' (or 'talk_request' when it has no screen), nothing else changes.
--   2. A patient-built summary for their care team: preview_wellbeing_summary (owner only, writes nothing, can be shown on screen at a visit)
--      and share_wellbeing_summary_with_care_team (explicit click, section flags that default to NOTHING, the patient's own free text). The
--      journal is never read by either function: the only tables they select from are mental_health_screens, wellbeing_checkins and
--      sleep_log_entries. Raw scores and means only; no instrument item answers (item 9 stays out), no check-in notes or tags, no label
--      beyond the severity_band the signed instrument already stored. Behind the CMO-switched guard wellbeing_summary_share_enabled (step 2).
--   3. The follow-up worklist: a DETERMINISTIC list (no model) of patients who are tied to the calling clinician (INV-12, never is_org_staff)
--      and who meet a rule in the versioned configuration mental_health_worklist_config. The configuration is born UNSIGNED and INACTIVE; only
--      the CMO's sign_mental_health_worklist_config activates a version; until then the list returns status 'not_signed' and no rows. Every
--      patient served is an audit_log row (staff.mental_health_read, section 'worklist'). A care coordinator is refused. Creating a follow-up
--      makes a real clinical_tasks row through private.create_clinical_task (task type symptom_review) and a mental_health_worklist_actions row.
--      Behind the guard mental_health_worklist_enabled (step 2).
--
-- WHAT THE WORKLIST DOES NOT DETECT (the screen says this too): it is not a risk predictor. It sees only what a patient entered. A patient who
-- never screened, never checked in, never logged sleep and never sent a hand-off is invisible to it, and so is anyone whose last answers were
-- low. Silence is not safety. A crisis answer is NOT handled here: the F1 crisis task and page are untouched.
--
-- Counts before writing (local replay): mental_health_handoffs 0 rows. The production count is recorded by the dry run of the apply checklist.

-- ---------------------------------------------------------------------------
-- 1. Hand-off kinds, seen, and the audited read that serves them
-- ---------------------------------------------------------------------------
alter table public.mental_health_handoffs
  add column if not exists kind text,
  add column if not exists seen_by uuid references public.profiles (id) on delete set null,
  add column if not exists seen_at timestamptz;
update public.mental_health_handoffs set kind = case when screen_id is null then 'talk_request' else 'screen' end where kind is null;
alter table public.mental_health_handoffs alter column kind set default 'screen';
alter table public.mental_health_handoffs alter column kind set not null;
alter table public.mental_health_handoffs drop constraint if exists mental_health_handoffs_kind_check;
alter table public.mental_health_handoffs add constraint mental_health_handoffs_kind_check check (kind in ('screen', 'doctor_summary', 'talk_request'));
create index if not exists mental_health_handoffs_seen_by_idx on public.mental_health_handoffs (seen_by) where seen_by is not null;
create index if not exists mental_health_handoffs_open_idx on public.mental_health_handoffs (organisation_id, created_at) where state = 'open';

-- A hand-off with no screen is the patient asking to talk (the calm tool's "tell my care team"). Same function as S56 plus the kind.
create or replace function public.request_mental_health_handoff(p_screen uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_pr public.profiles%rowtype; v_s public.mental_health_screens%rowtype;
  v_summary jsonb := '{}'::jsonb; v_id uuid := gen_random_uuid(); v_task uuid; v_dup uuid;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into v_pr from public.profiles where id = v_uid and role = 'patient';
  if not found then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'note too long' using errcode = '22023'; end if;
  if p_screen is not null then
    select * into v_s from public.mental_health_screens where id = p_screen and patient_id = v_uid;
    if not found then raise exception 'unknown screen' using errcode = '22023'; end if;
    -- a second tap on the same screen while a hand-off for it is still open returns that hand-off: one task, not two
    select id into v_dup from public.mental_health_handoffs where patient_id = v_uid and screen_id = p_screen and state = 'open' order by created_at desc limit 1;
    if v_dup is not null then return v_dup; end if;
    v_summary := jsonb_build_object('instrument', v_s.instrument, 'severity_band', v_s.severity_band, 'total_score', v_s.total_score, 'taken_at', v_s.created_at);
  else
    -- a repeated "talk to me" within ten minutes returns the one already open
    select id into v_dup from public.mental_health_handoffs
     where patient_id = v_uid and kind = 'talk_request' and state = 'open' and created_at > now() - interval '10 minutes' order by created_at desc limit 1;
    if v_dup is not null then return v_dup; end if;
  end if;
  insert into public.mental_health_handoffs (id, organisation_id, patient_id, screen_id, summary, patient_note, is_test, kind)
  values (v_id, v_pr.organisation_id, v_uid, p_screen, v_summary, nullif(btrim(p_note), ''), coalesce(v_pr.is_test, false),
          case when p_screen is null then 'talk_request' else 'screen' end);
  v_task := private.create_clinical_task(v_uid, 'admin_clinical', null, 'mh_handoff:' || v_id);
  update public.mental_health_handoffs set task_id = v_task where id = v_id;
  return v_id;
end $$;
revoke all on function public.request_mental_health_handoff(uuid, text) from public, anon;
grant execute on function public.request_mental_health_handoff(uuid, text) to authenticated;

-- The S56 audited read, with the hand-off section widened (kind, seen_at). Everything else is the S56 body unchanged.
create or replace function public.read_patient_mental_health_audited(
  p_patient uuid, p_reason text default null, p_sections text[] default array['screens'], p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c_known constant text[] := array['screens', 'checkins', 'therapy_sessions', 'schedules', 'handoffs'];
  v_uid uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.role()), '') = 'service_role';
  v_own boolean;
  v_lim integer := least(greatest(coalesce(p_limit, 200), 1), 1000);   -- technical page size, not a clinical value
  v_out jsonb := '{}'::jsonb;
begin
  if v_uid is null and not v_service then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_sections is null or cardinality(p_sections) = 0 or exists (select 1 from unnest(p_sections) s where s is null or s <> all (c_known)) then
    raise exception 'unknown section' using errcode = '22023';
  end if;
  v_own := v_service or p_patient = v_uid or private.can_supporter_read_mental_health(p_patient);
  if not v_own then
    if exists (select 1 from public.profiles where id = v_uid and role = 'patient') then raise exception 'not authorised' using errcode = '42501'; end if;
    if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'a reason of at least 10 characters is required' using errcode = '22023'; end if;
    if not private.can_staff_read_mental_health(p_patient) then
      perform private.audit_mental_health_read(p_patient, p_sections, p_reason, 'denied');
      return jsonb_build_object('status', 'denied');
    end if;
    perform private.audit_mental_health_read(p_patient, p_sections, p_reason, 'success');
  end if;

  if 'screens' = any (p_sections) then
    v_out := v_out || jsonb_build_object('screens', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id, patient_id, instrument, total_score, severity_band, hazardous, crisis_flagged, item_responses, created_at
        from public.mental_health_screens where patient_id = p_patient order by created_at desc limit v_lim) x), '[]'::jsonb));
  end if;
  if 'checkins' = any (p_sections) then
    v_out := v_out || jsonb_build_object('checkins', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select * from public.wellbeing_checkins where patient_id = p_patient order by checked_in_at desc limit v_lim) x), '[]'::jsonb));
  end if;
  if 'therapy_sessions' = any (p_sections) then
    v_out := v_out || jsonb_build_object('therapy_sessions', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id, patient_id, provider_id, status, modality, requested_at, scheduled_for, completed_at, cancelled_at, patient_note, approved_by, approved_at
        from public.therapy_sessions where patient_id = p_patient order by requested_at desc limit v_lim) x), '[]'::jsonb));
  end if;
  if 'schedules' = any (p_sections) then
    v_out := v_out || jsonb_build_object('schedules', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id, patient_id, instrument, due_date from public.mental_health_screening_schedules where patient_id = p_patient order by due_date limit v_lim) x), '[]'::jsonb));
  end if;
  if 'handoffs' = any (p_sections) then
    v_out := v_out || jsonb_build_object('handoffs', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id, patient_id, screen_id, kind, summary, patient_note, state, task_id, seen_at, created_at
        from public.mental_health_handoffs where patient_id = p_patient order by created_at desc limit v_lim) x), '[]'::jsonb));
  end if;
  return jsonb_build_object('status', 'ok') || v_out;
end $$;
revoke all on function public.read_patient_mental_health_audited(uuid, text, text[], integer) from public, anon;
grant execute on function public.read_patient_mental_health_audited(uuid, text, text[], integer) to authenticated, service_role;

-- A tied clinician marks a hand-off seen. NULL when refused (the refusal is audited; a raise would roll the audit row back).
create or replace function public.mark_mental_health_handoff_seen(p_handoff uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_h public.mental_health_handoffs%rowtype; v_n integer;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into v_h from public.mental_health_handoffs where id = p_handoff;
  if not found then raise exception 'unknown hand-off' using errcode = '22023'; end if;
  if not (private.is_mental_health_clinician() and private.clinician_has_patient_access(v_h.patient_id)) then
    perform private.audit_mental_health_read(v_h.patient_id, array['handoffs'], 'attempted to mark a hand-off seen', 'denied');
    return null;
  end if;
  update public.mental_health_handoffs set state = 'seen', seen_by = v_uid, seen_at = now() where id = p_handoff and state = 'open';
  get diagnostics v_n = row_count;
  perform private.audit_mental_health_read(v_h.patient_id, array['handoffs'], 'marked a hand-off seen', 'success');
  return v_n > 0;
end $$;
revoke all on function public.mark_mental_health_handoff_seen(uuid) from public, anon;
grant execute on function public.mark_mental_health_handoff_seen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The patient-built summary
-- ---------------------------------------------------------------------------
-- PROPOSED display windows. Not a clinical decision (what the patient chooses to show a doctor); mirrored in packages/shared as
-- wellbeing.share_summary and checked by a drift test. A new version is a new function body in a new migration.
create or replace function private.wellbeing_share_cfg() returns jsonb
language sql immutable set search_path = '' as $$
  -- share-summary-v1-begin
  select $json${"version":1,"screen_points":3,"checkin_weeks":4,"sleep_days":14,"note_max_chars":500}$json$::jsonb
  -- share-summary-v1-end
$$;
revoke all on function private.wellbeing_share_cfg() from public, anon, authenticated;

-- The one builder both the preview and the send use. Reads ONLY the patient's own screens, check-ins and sleep diary. There is no path
-- from here to the journal tables, to check-in notes or tags, or to any screen's item answers.
create or replace function private.build_wellbeing_summary(p_patient uuid, p_screens boolean, p_checkins boolean, p_sleep boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb := private.wellbeing_share_cfg();
  v_out jsonb := jsonb_build_object('version', (c ->> 'version')::integer);
  v_inst text; v_pts jsonb; v_screens jsonb := '[]'::jsonb; v_prev integer; v_last integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_weeks jsonb; v_sleep jsonb;
begin
  if p_screens then
    foreach v_inst in array array['phq9', 'gad7'] loop
      select coalesce(jsonb_agg(jsonb_build_object('at', r.created_at, 'total', r.total_score, 'band', r.severity_band) order by r.created_at desc), '[]'::jsonb)
        into v_pts
        from (select created_at, total_score, severity_band from public.mental_health_screens
               where patient_id = p_patient and instrument = v_inst order by created_at desc limit (c ->> 'screen_points')::integer) r;
      v_last := (v_pts -> 0 ->> 'total')::integer;
      v_prev := (v_pts -> 1 ->> 'total')::integer;
      if jsonb_array_length(v_pts) > 0 then
        v_screens := v_screens || jsonb_build_array(jsonb_build_object('instrument', v_inst, 'points', v_pts,
          'change_since_previous', case when v_prev is null then null else v_last - v_prev end));
      end if;
    end loop;
    v_out := v_out || jsonb_build_object('screens', v_screens);
  end if;
  if p_checkins then
    select coalesce(jsonb_agg(jsonb_build_object('week_start', w.week_start, 'check_ins', w.n, 'mood_mean', w.mood, 'stress_mean', w.stress) order by w.week_start desc), '[]'::jsonb)
      into v_weeks
      from (select date_trunc('week', (checked_in_at at time zone 'Africa/Lagos'))::date as week_start, count(*) as n,
                   round(avg(mood_score)::numeric, 1) as mood, round(avg(stress_score)::numeric, 1) as stress
              from public.wellbeing_checkins
             where patient_id = p_patient and (checked_in_at at time zone 'Africa/Lagos')::date > v_today - ((c ->> 'checkin_weeks')::integer * 7)
             group by 1) w;
    v_out := v_out || jsonb_build_object('check_ins', v_weeks);
  end if;
  if p_sleep then
    select case when count(*) = 0 then '{}'::jsonb else jsonb_build_object(
             'days', (c ->> 'sleep_days')::integer, 'entries', count(*),
             'mean_hours', round(avg(duration_hours)::numeric, 1), 'shortest_hours', min(duration_hours), 'longest_hours', max(duration_hours),
             'mean_quality', round(avg(quality_rating)::numeric, 1),
             'mean_minutes_to_fall_asleep', round(avg(sleep_latency_minutes)::numeric, 0),
             'mean_night_wakings', round(avg(night_awakenings)::numeric, 1)) end
      into v_sleep
      from public.sleep_log_entries
     where patient_id = p_patient and logged_on > v_today - (c ->> 'sleep_days')::integer;
    v_out := v_out || jsonb_build_object('sleep', coalesce(v_sleep, '{}'::jsonb));
  end if;
  return v_out;
end $$;
revoke all on function private.build_wellbeing_summary(uuid, boolean, boolean, boolean) from public, anon, authenticated;

-- Is there anything in a built summary? (a section can be chosen and still be empty)
create or replace function private.wellbeing_summary_has_content(p_summary jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_array_length(p_summary -> 'screens'), 0) > 0
      or coalesce(jsonb_array_length(p_summary -> 'check_ins'), 0) > 0
      or coalesce(p_summary -> 'sleep', '{}'::jsonb) <> '{}'::jsonb
$$;
revoke all on function private.wellbeing_summary_has_content(jsonb) from public, anon, authenticated;

create or replace function public.preview_wellbeing_summary(p_include_screens boolean default false, p_include_checkins boolean default false, p_include_sleep boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'patient') then raise exception 'not authorised' using errcode = '42501'; end if;
  if not private.go_live_open_patient('wellbeing_summary_share_enabled', v_uid) then raise exception 'feature_not_open' using errcode = '55000'; end if;
  return private.build_wellbeing_summary(v_uid, coalesce(p_include_screens, false), coalesce(p_include_checkins, false), coalesce(p_include_sleep, false));
end $$;
revoke all on function public.preview_wellbeing_summary(boolean, boolean, boolean) from public, anon;
grant execute on function public.preview_wellbeing_summary(boolean, boolean, boolean) to authenticated;

create or replace function public.share_wellbeing_summary_with_care_team(
  p_include_screens boolean default false, p_include_checkins boolean default false, p_include_sleep boolean default false, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_pr public.profiles%rowtype; v_sum jsonb; v_note text := nullif(btrim(p_note), '');
  v_max integer := (private.wellbeing_share_cfg() ->> 'note_max_chars')::integer; v_id uuid := gen_random_uuid(); v_dup uuid; v_task uuid;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into v_pr from public.profiles where id = v_uid and role = 'patient';
  if not found then raise exception 'not authorised' using errcode = '42501'; end if;
  if not private.go_live_open_patient('wellbeing_summary_share_enabled', v_uid) then raise exception 'feature_not_open' using errcode = '55000'; end if;
  if v_note is not null and char_length(v_note) > v_max then raise exception 'note too long' using errcode = '22023'; end if;
  v_sum := private.build_wellbeing_summary(v_uid, coalesce(p_include_screens, false), coalesce(p_include_checkins, false), coalesce(p_include_sleep, false));
  if not private.wellbeing_summary_has_content(v_sum) and v_note is null then raise exception 'nothing to share' using errcode = '22023'; end if;
  -- the same summary and note sent again within ten minutes is the same hand-off: one task, not two
  select id into v_dup from public.mental_health_handoffs
   where patient_id = v_uid and kind = 'doctor_summary' and state = 'open' and created_at > now() - interval '10 minutes'
     and summary = v_sum and patient_note is not distinct from v_note order by created_at desc limit 1;
  if v_dup is not null then return v_dup; end if;
  insert into public.mental_health_handoffs (id, organisation_id, patient_id, screen_id, summary, patient_note, is_test, kind)
  values (v_id, v_pr.organisation_id, v_uid, null, v_sum, v_note, coalesce(v_pr.is_test, false), 'doctor_summary');
  v_task := private.create_clinical_task(v_uid, 'admin_clinical', null, 'mh_summary:' || v_id);
  update public.mental_health_handoffs set task_id = v_task where id = v_id;
  begin
    perform private.emit_domain_event('wellbeing.summary_shared', v_pr.organisation_id, jsonb_build_object('handoff_id', v_id),
      'wellbeing.summary_shared:' || v_id, v_uid, 'mental_health_handoff', v_id);
  exception when others then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (v_pr.organisation_id, 'wellbeing_summary_event.error', 'mental_health_handoff', v_id, jsonb_build_object('error', sqlerrm));
  end;
  return v_id;
end $$;
revoke all on function public.share_wellbeing_summary_with_care_team(boolean, boolean, boolean, text) from public, anon;
grant execute on function public.share_wellbeing_summary_with_care_team(boolean, boolean, boolean, text) to authenticated;

insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('wellbeing.summary_shared', 'A patient chose to share a wellbeing summary with their care team (ids only; the summary is read through the audited path)', 'S56b', false),
  ('mh_worklist.follow_up_created', 'A clinician made a follow-up task from the mental health worklist (ids only)', 'S56b', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('wellbeing.summary_shared', 1, array['handoff_id']),
  ('mh_worklist.follow_up_created', 1, array['action_id'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The worklist configuration (PROPOSED, versioned, born unsigned and inactive)
-- ---------------------------------------------------------------------------
create table if not exists public.mental_health_worklist_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  notes          text,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint mental_health_worklist_config_active_is_signed check (not is_active or (approved_at is not null and approved_by is not null))
);
create unique index if not exists mental_health_worklist_config_one_active on public.mental_health_worklist_config (is_active) where is_active;
create index if not exists mental_health_worklist_config_approved_by_idx on public.mental_health_worklist_config (approved_by) where approved_by is not null;

create or replace function private.mh_int_in(r jsonb, p_path text[], p_lo integer, p_hi integer) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce((r #>> p_path) ~ '^[0-9]{1,6}$' and (r #>> p_path)::integer between p_lo and p_hi, false)
$$;
revoke all on function private.mh_int_in(jsonb, text[], integer, integer) from public, anon, authenticated;

create or replace function private.mh_worklist_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if jsonb_typeof(r) <> 'object' then return false; end if;
  foreach k in array array['rising_screen', 'overdue_screen', 'sleep_trouble', 'missed_checkins', 'unactioned_handoff'] loop
    if jsonb_typeof(r #> array[k, 'enabled']) <> 'boolean' then return false; end if;
  end loop;
  if not (private.mh_int_in(r, '{rising_screen,look_back_days}', 7, 730) and private.mh_int_in(r, '{rising_screen,phq9_min_rise}', 1, 27)
          and private.mh_int_in(r, '{rising_screen,gad7_min_rise}', 1, 21)) then return false; end if;
  if not private.mh_int_in(r, '{overdue_screen,grace_days}', 0, 365) then return false; end if;
  if jsonb_typeof(r #> '{overdue_screen,instruments}') <> 'array' or jsonb_array_length(r #> '{overdue_screen,instruments}') = 0
     or exists (select 1 from jsonb_array_elements_text(r #> '{overdue_screen,instruments}') i where i not in ('phq9', 'gad7')) then return false; end if;
  if not (private.mh_int_in(r, '{sleep_trouble,window_days}', 3, 60) and private.mh_int_in(r, '{sleep_trouble,min_entries}', 1, 60)
          and private.mh_int_in(r, '{sleep_trouble,min_trouble_nights}', 1, 60) and private.mh_int_in(r, '{sleep_trouble,low_quality_at_or_below}', 1, 5)) then return false; end if;
  if not coalesce((r #>> '{sleep_trouble,short_sleep_hours}') ~ '^[0-9]{1,2}(\.[0-9])?$', false) then return false; end if;
  if (r #>> '{sleep_trouble,short_sleep_hours}')::numeric not between 1 and 12 then return false; end if;
  if (r #>> '{sleep_trouble,min_entries}')::integer > (r #>> '{sleep_trouble,window_days}')::integer
     or (r #>> '{sleep_trouble,min_trouble_nights}')::integer > (r #>> '{sleep_trouble,min_entries}')::integer then return false; end if;
  if not (private.mh_int_in(r, '{missed_checkins,prior_window_days}', 7, 180) and private.mh_int_in(r, '{missed_checkins,min_prior_checkins}', 2, 100)
          and private.mh_int_in(r, '{missed_checkins,silent_days}', 3, 90)) then return false; end if;
  if not private.mh_int_in(r, '{unactioned_handoff,after_hours}', 1, 720) then return false; end if;
  if not (private.mh_int_in(r, '{follow_up,task_due_minutes}', 15, 43200) and private.mh_int_in(r, '{follow_up,snooze_days}', 0, 60)) then return false; end if;
  if not private.mh_int_in(r, '{max_rows}', 1, 500) then return false; end if;
  return true;
end $$;
revoke all on function private.mh_worklist_rules_valid(jsonb) from public, anon, authenticated;
alter table public.mental_health_worklist_config drop constraint if exists mental_health_worklist_config_rules_valid;
alter table public.mental_health_worklist_config add constraint mental_health_worklist_config_rules_valid check (private.mh_worklist_rules_valid(rules));

-- mh-worklist-v1-begin
insert into public.mental_health_worklist_config (version, is_active, effective_from, rules, notes)
values (1, false, '2026-10-22', $json${"rising_screen":{"enabled":true,"look_back_days":120,"phq9_min_rise":5,"gad7_min_rise":4},"overdue_screen":{"enabled":true,"grace_days":14,"instruments":["phq9","gad7"]},"sleep_trouble":{"enabled":true,"window_days":14,"min_entries":7,"short_sleep_hours":5.5,"low_quality_at_or_below":2,"min_trouble_nights":5},"missed_checkins":{"enabled":true,"prior_window_days":28,"min_prior_checkins":8,"silent_days":10},"unactioned_handoff":{"enabled":true,"after_hours":48},"follow_up":{"task_due_minutes":4320,"snooze_days":7},"max_rows":100}$json$::jsonb,
  'DRAFT, UNSIGNED (S56b, 2026-10-22). Every number is PROPOSED by the build, not a clinical decision: the CMO must read, amend (a new version) or confirm. The score rises are placeholders chosen to be easy to read, not validated change thresholds. Check-in silence is the rule the CMO may well switch off (check-ins are a patient-controlled habit, see OQ-S56b-03).')
on conflict (version) do nothing;
-- mh-worklist-v1-end

alter table public.mental_health_worklist_config enable row level security;
revoke all on public.mental_health_worklist_config from public, anon, authenticated;
grant select on public.mental_health_worklist_config to authenticated;
drop policy if exists mental_health_worklist_config_read on public.mental_health_worklist_config;
create policy mental_health_worklist_config_read on public.mental_health_worklist_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());

create or replace function private.mental_health_worklist_config_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'mental_health_worklist_config version % is never deleted', old.version using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.is_active or new.approved_at is not null then
      raise exception 'a worklist config is created unsigned and inactive' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.rules is distinct from old.rules or new.version is distinct from old.version then
    raise exception 'a worklist config is never edited: add a new version' using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed config keeps its signature' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.mental_health_worklist_config_guard() from public, anon, authenticated;
drop trigger if exists mental_health_worklist_config_guard on public.mental_health_worklist_config;
create trigger mental_health_worklist_config_guard before insert or update or delete on public.mental_health_worklist_config
  for each row execute function private.mental_health_worklist_config_guard();
drop trigger if exists refuse_superseded_activation on public.mental_health_worklist_config;
create trigger refuse_superseded_activation before update of is_active on public.mental_health_worklist_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

create or replace function public.sign_mental_health_worklist_config(p_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.mental_health_worklist_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the follow-up worklist rules' using errcode = '42501'; end if;
  select * into c from public.mental_health_worklist_config where version = p_version for update;
  if not found then raise exception 'no such worklist configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.mental_health_worklist_config set is_active = false where is_active and version <> p_version;
  update public.mental_health_worklist_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'mental_health_worklist_config.signed',
            'mental_health_worklist_config', c.id, jsonb_build_object('version', p_version));
end $$;
revoke all on function public.sign_mental_health_worklist_config(integer) from public, anon;
grant execute on function public.sign_mental_health_worklist_config(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. What a clinician did from the worklist
-- ---------------------------------------------------------------------------
create table if not exists public.mental_health_worklist_actions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  clinician_id    uuid not null references public.profiles (id) on delete restrict,
  config_version  integer not null references public.mental_health_worklist_config (version) on delete restrict,
  reasons         text[] not null,
  task_id         uuid,
  note            text check (note is null or char_length(note) <= 300),
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists mental_health_worklist_actions_patient_idx on public.mental_health_worklist_actions (patient_id, created_at desc);
create index if not exists mental_health_worklist_actions_clinician_idx on public.mental_health_worklist_actions (clinician_id);
create index if not exists mental_health_worklist_actions_org_idx on public.mental_health_worklist_actions (organisation_id);
create index if not exists mental_health_worklist_actions_config_idx on public.mental_health_worklist_actions (config_version);
alter table public.mental_health_worklist_actions enable row level security;
-- No table policy for anyone: the table is read and written only by the SECURITY DEFINER worklist functions (INV-10, INV-12).
revoke all on public.mental_health_worklist_actions from public, anon, authenticated;
comment on table public.mental_health_worklist_actions is 'S56b: a follow-up a tied clinician made from the mental health worklist. Written only by create_mental_health_worklist_follow_up; read only through the worklist function.';

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select 'mental_health_worklist_actions', 'patient_id', private.retention_class_for('mental_health_worklist_actions'), 'review', true,
       'S56b 2026-10-22: PROPOSED, to be confirmed by the CMO and DPO. A clinician follow-up made from the mental health worklist (reason codes and an optional short note).'
on conflict (table_name) do nothing;
select private.guard_minor_dependant_table('mental_health_worklist_actions', 'patient_id');

-- ---------------------------------------------------------------------------
-- 5. The rules (set based, org scoped) and the caller's tied worklist
-- ---------------------------------------------------------------------------
-- Every rule reads only what the patient entered, within the windows in the SIGNED configuration. A patient is considered only if they have
-- used the mental wellbeing area at all (a screen, a check-in or a hand-off): a sleep diary kept for its own sake does not put anyone on a
-- mental health list. The hits are not yet filtered by the tie; the caller functions do that.
create or replace function private.mh_worklist_hits(p_org uuid, r jsonb)
returns table (patient_id uuid, reason text, facts jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_cadence_signed boolean := exists (select 1 from public.mental_health_screening_cadences where is_active and approved_at is not null);
begin
  return query
  with engaged as (
    select s.patient_id as pid from public.mental_health_screens s where s.organisation_id = p_org
    union select c.patient_id from public.wellbeing_checkins c where c.organisation_id = p_org and c.checked_in_at > now() - interval '400 days'
    union select h.patient_id from public.mental_health_handoffs h where h.organisation_id = p_org
  )
  -- a positive hand-off nobody has marked seen (the oldest per patient)
  select x.pid, 'unactioned_handoff'::text, jsonb_build_object('handoff_id', x.id, 'kind', x.kind, 'hours_waiting', floor(extract(epoch from (now() - x.created_at)) / 3600)::integer)
    from (select distinct on (h.patient_id) h.patient_id as pid, h.id, h.kind, h.created_at
            from public.mental_health_handoffs h
           where (r #>> '{unactioned_handoff,enabled}')::boolean and h.organisation_id = p_org and h.state = 'open'
             and h.created_at < now() - make_interval(hours => (r #>> '{unactioned_handoff,after_hours}')::integer)
           order by h.patient_id, h.created_at) x
  union all
  -- a rising PHQ-9 or GAD-7 between the two most recent screens of the same instrument
  select y.pid, 'rising_screen'::text, jsonb_build_object('instrument', y.instrument, 'from', y.prev_score, 'to', y.total_score, 'rise', y.total_score - y.prev_score,
                                                           'from_at', y.prev_at, 'to_at', y.created_at)
    from (select s.patient_id as pid, s.instrument, s.total_score, s.created_at,
                 lag(s.total_score) over w as prev_score, lag(s.created_at) over w as prev_at,
                 row_number() over (partition by s.patient_id, s.instrument order by s.created_at desc) as rn
            from public.mental_health_screens s
           where (r #>> '{rising_screen,enabled}')::boolean and s.organisation_id = p_org and s.instrument in ('phq9', 'gad7')
             and s.created_at > now() - make_interval(days => 2 * (r #>> '{rising_screen,look_back_days}')::integer)
          window w as (partition by s.patient_id, s.instrument order by s.created_at)) y
   where y.rn = 1 and y.prev_score is not null
     and y.created_at > now() - make_interval(days => (r #>> '{rising_screen,look_back_days}')::integer)
     and y.prev_at > y.created_at - make_interval(days => (r #>> '{rising_screen,look_back_days}')::integer)
     and y.total_score - y.prev_score >= case y.instrument when 'phq9' then (r #>> '{rising_screen,phq9_min_rise}')::integer else (r #>> '{rising_screen,gad7_min_rise}')::integer end
  union all
  -- the next screen is overdue against the (signed) cadence: the schedule is rolled forward from that cadence on every screen
  select sch.patient_id, 'overdue_screen'::text, jsonb_build_object('instrument', sch.instrument, 'due_date', sch.due_date, 'days_overdue', v_today - sch.due_date)
    from public.mental_health_screening_schedules sch
   where (r #>> '{overdue_screen,enabled}')::boolean and v_cadence_signed and sch.organisation_id = p_org
     and sch.instrument in (select jsonb_array_elements_text(r #> '{overdue_screen,instruments}'))
     and sch.due_date < v_today - (r #>> '{overdue_screen,grace_days}')::integer
  union all
  -- trouble sleeping on most nights of the window, from the sleep diary
  select l.pid, 'sleep_trouble'::text, jsonb_build_object('window_days', (r #>> '{sleep_trouble,window_days}')::integer, 'entries', l.entries, 'trouble_nights', l.trouble)
    from (select e.patient_id as pid, count(*)::integer as entries,
                 (count(*) filter (where e.duration_hours < (r #>> '{sleep_trouble,short_sleep_hours}')::numeric
                                      or (e.quality_rating is not null and e.quality_rating <= (r #>> '{sleep_trouble,low_quality_at_or_below}')::integer)))::integer as trouble
            from public.sleep_log_entries e
           where (r #>> '{sleep_trouble,enabled}')::boolean and e.organisation_id = p_org
             and e.logged_on > v_today - (r #>> '{sleep_trouble,window_days}')::integer
             and e.patient_id in (select pid from engaged)
           group by e.patient_id) l
   where l.entries >= (r #>> '{sleep_trouble,min_entries}')::integer and l.trouble >= (r #>> '{sleep_trouble,min_trouble_nights}')::integer
  union all
  -- regular check-ins, then none for the silent window
  select m.pid, 'missed_checkins'::text, jsonb_build_object('prior_check_ins', m.prior_n, 'last_check_in_on', m.last_d, 'silent_days', (r #>> '{missed_checkins,silent_days}')::integer)
    from (select c.patient_id as pid,
                 (count(*) filter (where c.checked_in_at <= now() - make_interval(days => (r #>> '{missed_checkins,silent_days}')::integer)))::integer as prior_n,
                 (count(*) filter (where c.checked_in_at > now() - make_interval(days => (r #>> '{missed_checkins,silent_days}')::integer)))::integer as recent_n,
                 max((c.checked_in_at at time zone 'Africa/Lagos')::date) as last_d
            from public.wellbeing_checkins c
           where (r #>> '{missed_checkins,enabled}')::boolean and c.organisation_id = p_org
             and c.checked_in_at > now() - make_interval(days => (r #>> '{missed_checkins,prior_window_days}')::integer + (r #>> '{missed_checkins,silent_days}')::integer)
           group by c.patient_id) m
   where m.prior_n >= (r #>> '{missed_checkins,min_prior_checkins}')::integer and m.recent_n = 0;
end $$;
revoke all on function private.mh_worklist_hits(uuid, jsonb) from public, anon, authenticated;

create or replace function private.mh_worklist_rank(p_code text) returns integer
language sql immutable set search_path = '' as $$
  select case p_code when 'unactioned_handoff' then 1 when 'rising_screen' then 2 when 'overdue_screen' then 3 when 'missed_checkins' then 4 when 'sleep_trouble' then 5 else 9 end
$$;
revoke all on function private.mh_worklist_rank(text) from public, anon, authenticated;

-- The signed configuration in force (or no row).
create or replace function private.mh_worklist_active_config() returns public.mental_health_worklist_config
language sql stable security definer set search_path = '' as $$
  select c from public.mental_health_worklist_config c where c.is_active and c.approved_at is not null order by c.version desc limit 1
$$;
revoke all on function private.mh_worklist_active_config() from public, anon, authenticated;

-- The calling clinician's worklist: hits for patients the caller is TIED to (private.clinician_has_patient_access; never is_org_staff, never
-- break-glass), whose guard is open (on, or caller and patient both test accounts). Empty for anyone else, and when nothing is signed.
create or replace function private.mh_worklist_for_caller()
returns table (o_patient_id uuid, o_name text, o_number text, o_rank integer, o_reasons jsonb, o_followed_up_at timestamptz, o_followed_up_task uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_org uuid; v_cfg public.mental_health_worklist_config; v_snooze integer; v_max integer;
begin
  if v_uid is null or not private.is_mental_health_clinician() then return; end if;
  v_cfg := private.mh_worklist_active_config();
  if v_cfg.id is null then return; end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  v_snooze := (v_cfg.rules #>> '{follow_up,snooze_days}')::integer;
  v_max := (v_cfg.rules #>> '{max_rows}')::integer;
  return query
  with hits as (select h.patient_id as pid, h.reason, h.facts from private.mh_worklist_hits(v_org, v_cfg.rules) h),
       tied as (select distinct hh.pid from hits hh
                 where private.clinician_has_patient_access(hh.pid) and private.go_live_open('mental_health_worklist_enabled', hh.pid, v_uid))
  select p.id, p.full_name, p.patient_number,
         (select min(private.mh_worklist_rank(hh.reason)) from hits hh where hh.pid = p.id),
         (select jsonb_agg(jsonb_build_object('code', hh.reason, 'facts', hh.facts) order by private.mh_worklist_rank(hh.reason)) from hits hh where hh.pid = p.id),
         a.created_at, a.task_id
    from tied t
    join public.profiles p on p.id = t.pid
    left join lateral (select wa.created_at, wa.task_id from public.mental_health_worklist_actions wa
                        where wa.patient_id = p.id and wa.created_at > now() - make_interval(days => v_snooze) order by wa.created_at desc limit 1) a on true
   order by (a.created_at is not null), 4, p.patient_number
   limit v_max;
end $$;
revoke all on function private.mh_worklist_for_caller() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The public surface
-- ---------------------------------------------------------------------------
create or replace function public.list_mental_health_worklist() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_cfg public.mental_health_worklist_config; v_rows jsonb; v_pid uuid; v_notes jsonb := '[]'::jsonb;
begin
  if v_uid is null or not private.is_mental_health_clinician() then raise exception 'not authorised' using errcode = '42501'; end if;
  if not (private.go_live_guard_on('mental_health_worklist_enabled') or exists (select 1 from public.profiles where id = v_uid and is_test)) then
    return jsonb_build_object('status', 'off');
  end if;
  v_cfg := private.mh_worklist_active_config();
  if v_cfg.id is null then return jsonb_build_object('status', 'not_signed'); end if;
  if (v_cfg.rules #>> '{overdue_screen,enabled}')::boolean and not exists (select 1 from public.mental_health_screening_cadences where is_active and approved_at is not null) then
    v_notes := v_notes || to_jsonb('overdue_off_cadence_unsigned'::text);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', w.o_patient_id, 'full_name', w.o_name, 'patient_number', w.o_number, 'reasons', w.o_reasons,
                                               'followed_up_at', w.o_followed_up_at, 'followed_up_task', w.o_followed_up_task) order by w.o_followed_up_at is not null, w.o_rank, w.o_number), '[]'::jsonb)
    into v_rows from private.mh_worklist_for_caller() w;
  -- one audit row per patient served (INV-10): the list shows their reasons, so each patient's own trail shows it
  for v_pid in select (x ->> 'patient_id')::uuid from jsonb_array_elements(v_rows) x loop
    perform private.audit_mental_health_read(v_pid, array['worklist'], 'mental health follow-up worklist', 'success');
  end loop;
  return jsonb_build_object('status', 'ok', 'config_version', v_cfg.version, 'rows', v_rows, 'notes', v_notes);
end $$;
revoke all on function public.list_mental_health_worklist() from public, anon;
grant execute on function public.list_mental_health_worklist() to authenticated;

-- A bare number: how many tied patients are on the list. Identity-free, so it can sit in a menu. 0 for anyone who is not a tied clinician.
create or replace function public.count_mental_health_worklist() returns integer
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_mental_health_clinician() then return 0; end if;
  if not (private.go_live_guard_on('mental_health_worklist_enabled') or exists (select 1 from public.profiles where id = v_uid and is_test)) then return 0; end if;
  return (select count(*)::integer from private.mh_worklist_for_caller());
end $$;
revoke all on function public.count_mental_health_worklist() from public, anon;
grant execute on function public.count_mental_health_worklist() to authenticated;

-- A tied clinician makes a follow-up task for a patient who is on their list. A refusal returns NULL (the refusal is audited; a raise would
-- roll the audit row back). The task is a real clinical_tasks row from private.create_clinical_task, one per patient per Lagos day.
create or replace function public.create_mental_health_worklist_follow_up(p_patient uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_cfg public.mental_health_worklist_config; v_row record; v_task uuid; v_id uuid := gen_random_uuid();
  v_note text := nullif(btrim(p_note), ''); v_org uuid; v_test boolean;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_patient is null then raise exception 'unknown patient' using errcode = '22023'; end if;
  if not (private.is_mental_health_clinician() and private.clinician_has_patient_access(p_patient)) then
    perform private.audit_mental_health_read(p_patient, array['worklist_follow_up'], 'attempted a worklist follow-up', 'denied');
    return null;
  end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'note too long' using errcode = '22023'; end if;
  v_cfg := private.mh_worklist_active_config();
  if v_cfg.id is null then raise exception 'the worklist rules are not signed' using errcode = '55000'; end if;
  select * into v_row from private.mh_worklist_for_caller() w where w.o_patient_id = p_patient;
  if not found then raise exception 'that patient is not on your worklist' using errcode = '22023'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = p_patient;
  v_task := private.create_clinical_task(p_patient, 'symptom_review', (v_cfg.rules #>> '{follow_up,task_due_minutes}')::integer,
                                         'mh_worklist:' || p_patient || ':' || ((now() at time zone 'Africa/Lagos')::date));
  insert into public.mental_health_worklist_actions (id, organisation_id, patient_id, clinician_id, config_version, reasons, task_id, note, is_test)
  values (v_id, v_org, p_patient, v_uid, v_cfg.version,
          coalesce((select array_agg(distinct x ->> 'code') from jsonb_array_elements(v_row.o_reasons) x), '{}'::text[]), v_task, v_note, v_test);
  perform private.audit_mental_health_read(p_patient, array['worklist_follow_up'], 'made a worklist follow-up task', 'success');
  begin
    perform private.emit_domain_event('mh_worklist.follow_up_created', v_org, jsonb_build_object('action_id', v_id),
      'mh_worklist.follow_up_created:' || v_id, p_patient, 'mental_health_worklist_action', v_id);
  exception when others then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (v_org, 'mh_worklist_event.error', 'mental_health_worklist_action', v_id, jsonb_build_object('error', sqlerrm));
  end;
  return v_task;
end $$;
revoke all on function public.create_mental_health_worklist_follow_up(uuid, text) from public, anon;
grant execute on function public.create_mental_health_worklist_follow_up(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.mental_health_worklist_config where is_active or approved_at is not null) then raise exception 'S56b self-check: a worklist config shipped signed or active'; end if;
  if has_function_privilege('anon', 'public.list_mental_health_worklist()', 'EXECUTE') or has_function_privilege('anon', 'public.count_mental_health_worklist()', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_mental_health_worklist_follow_up(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.share_wellbeing_summary_with_care_team(boolean,boolean,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.preview_wellbeing_summary(boolean,boolean,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_mental_health_handoff_seen(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sign_mental_health_worklist_config(integer)', 'EXECUTE') then
    raise exception 'S56b self-check: anon can execute a new function';
  end if;
  if has_function_privilege('authenticated', 'private.mh_worklist_hits(uuid,jsonb)', 'EXECUTE') or has_function_privilege('authenticated', 'private.mh_worklist_for_caller()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.build_wellbeing_summary(uuid,boolean,boolean,boolean)', 'EXECUTE') then
    raise exception 'S56b self-check: a signed-in user can call a private function directly';
  end if;
  if has_table_privilege('authenticated', 'public.mental_health_worklist_actions', 'SELECT') or has_table_privilege('anon', 'public.mental_health_worklist_actions', 'SELECT') then
    raise exception 'S56b self-check: the worklist actions table is readable';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'mental_health_worklist_actions') <> 0 then raise exception 'S56b self-check: the actions table has a policy'; end if;
  if exists (select 1 from public.mental_health_handoffs where kind not in ('screen', 'doctor_summary', 'talk_request')) then raise exception 'S56b self-check: a hand-off has an unknown kind'; end if;
end $$;
