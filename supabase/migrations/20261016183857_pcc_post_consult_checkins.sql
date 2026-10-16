-- PCC: automatic post-consultation check-ins at 48 hours and 7 days (founder decision: a fixed short check-in, red flags escalate, no model).
-- Design: docs/design/PCC.md. Invariants: INV-01, 05, 07, 10, 12, 13, 14, 16.
--
-- WHAT THIS ADDS
--   * post_consult_checkin_config: versioned rules (offsets, windows, the four questions and each option's route). v1 is born INACTIVE and
--     UNSIGNED; only the CMO's sign_post_consult_checkin_config() activates a version. Mirrored in packages/shared as consultations.post_checkin.
--   * post_consult_checkins: one row per (encounter, offset). Patient reads own rows; there is NO staff table policy, so a clinician reads
--     answers only through get_consult_checkins() (audited, the consultation's own clinician only).
--   * go-live guard post_consult_checkins_enabled (born OFF). Nothing is scheduled until the guard is on AND a signed config is active.
--   * care_tasks.kind 'consult_checkin' (the patient task) and a guard so only the answer/sweep functions can close it.
--   * scheduling trigger on encounters (status becomes completed), a pg_cron sweep every 15 minutes (open, nudge once, expire, backfill,
--     cancel), the patient answer function, neutral notification templates, four event types.
--   * red flags reuse the EXISTING deterministic path: private.screen_care_message_for_emergency (the shared danger-phrase list) and the
--     emergency_events machinery (alert, hospital guidance, emergency contact). A structured concern raises one clinician_alerts row.
--
-- Counts before writing: no post-consultation check-in table or task kind existed; nothing live was read in this session (the hosted project
-- did not answer), the repository's replayed migrations were read instead. Nothing here is applied to production by its author.

-- ---------------------------------------------------------------------------
-- 1. Config (PROPOSED, versioned, unsigned)
-- ---------------------------------------------------------------------------
create table public.post_consult_checkin_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint post_consult_checkin_config_active_is_signed check (not is_active or (approved_at is not null and approved_by is not null))
);
create unique index post_consult_checkin_config_one_active on public.post_consult_checkin_config (is_active) where is_active;
create index post_consult_checkin_config_approved_by_idx on public.post_consult_checkin_config (approved_by) where approved_by is not null;

create function private.pcc_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  k text; o jsonb; q jsonb; op jsonb; v_codes text[]; v_qids text[] := '{}';
begin
  if jsonb_typeof(r) <> 'object' then return false; end if;
  foreach k in array array['nudge_after_minutes', 'expire_after_minutes', 'free_text_max_chars', 'skip_if_patient_wrote_within_minutes'] loop
    if not coalesce((r ->> k) ~ '^[0-9]+$' and (r ->> k)::integer > 0, false) then return false; end if;
  end loop;
  if not coalesce((r ->> 'max_nudges') ~ '^[0-3]$', false) then return false; end if;
  if not coalesce((r #>> '{notification_window,start_hour}') ~ '^[0-9]+$' and (r #>> '{notification_window,end_hour}') ~ '^[0-9]+$', false) then return false; end if;
  if (r #>> '{notification_window,start_hour}')::integer >= (r #>> '{notification_window,end_hour}')::integer or (r #>> '{notification_window,end_hour}')::integer > 24 then return false; end if;
  if coalesce(r ->> 'concern_alert_level', '') not in ('clinician_review', 'urgent_escalation') then return false; end if;
  if nullif(btrim(coalesce(r ->> 'task_title', '')), '') is null or nullif(btrim(coalesce(r ->> 'task_description', '')), '') is null then return false; end if;
  if jsonb_typeof(r -> 'encounter_types') <> 'array' or jsonb_array_length(r -> 'encounter_types') = 0
     or exists (select 1 from jsonb_array_elements_text(r -> 'encounter_types') t where t not in ('video', 'audio', 'phone')) then return false; end if;
  if jsonb_typeof(r -> 'offsets') <> 'array' or jsonb_array_length(r -> 'offsets') = 0 then return false; end if;
  for o in select x from jsonb_array_elements(r -> 'offsets') x loop
    if not coalesce((o ->> 'code') ~ '^[a-z0-9]+$' and (o ->> 'after_minutes') ~ '^[0-9]+$' and (o ->> 'after_minutes')::integer > 0, false) then return false; end if;
  end loop;
  if (select count(distinct x ->> 'code') from jsonb_array_elements(r -> 'offsets') x) <> jsonb_array_length(r -> 'offsets') then return false; end if;
  if jsonb_typeof(r -> 'questions') <> 'array' or jsonb_array_length(r -> 'questions') < 1 or jsonb_array_length(r -> 'questions') > 6 then return false; end if;
  for q in select x from jsonb_array_elements(r -> 'questions') x loop
    if not coalesce((q ->> 'id') ~ '^[a-z_]+$', false) or nullif(btrim(coalesce(q ->> 'text', '')), '') is null then return false; end if;
    if q ->> 'id' = any (v_qids) then return false; end if;
    v_qids := v_qids || (q ->> 'id');
    if jsonb_typeof(q -> 'options') <> 'array' or jsonb_array_length(q -> 'options') < 2 then return false; end if;
    v_codes := '{}';
    for op in select x from jsonb_array_elements(q -> 'options') x loop
      if not coalesce((op ->> 'code') ~ '^[a-z_]+$', false) or nullif(btrim(coalesce(op ->> 'label', '')), '') is null then return false; end if;
      if coalesce(op ->> 'route', '') not in ('ok', 'concern_alert', 'clinician_task', 'clarify_task') then return false; end if;
      if op ? 'alert_type' and (op ->> 'alert_type') not in ('symptom_escalation', 'medication_access_barrier') then return false; end if;
      if op ->> 'code' = any (v_codes) then return false; end if;
      v_codes := v_codes || (op ->> 'code');
    end loop;
  end loop;
  return true;
end $$;
revoke all on function private.pcc_rules_valid(jsonb) from public, anon, authenticated;
alter table public.post_consult_checkin_config add constraint post_consult_checkin_config_rules_valid check (private.pcc_rules_valid(rules));

-- pcc-config-v1-begin
insert into public.post_consult_checkin_config (version, is_active, effective_from, rules) values (1, false, '2026-10-16', $json$
{
  "offsets": [
    { "code": "h48", "after_minutes": 2880 },
    { "code": "d7", "after_minutes": 10080 }
  ],
  "encounter_types": ["video", "audio", "phone"],
  "nudge_after_minutes": 1440,
  "max_nudges": 1,
  "expire_after_minutes": 2880,
  "skip_if_patient_wrote_within_minutes": 1440,
  "notification_window": { "start_hour": 7, "end_hour": 21 },
  "concern_alert_level": "clinician_review",
  "free_text_max_chars": 500,
  "task_title": "A quick check-in after your visit",
  "task_description": "A few short questions so your care team knows how you are getting on.",
  "questions": [
    { "id": "feeling", "text": "How are you feeling since your visit?", "options": [
      { "code": "better", "label": "Better", "route": "ok" },
      { "code": "same", "label": "About the same", "route": "ok" },
      { "code": "worse", "label": "Worse", "route": "concern_alert", "alert_type": "symptom_escalation" } ] },
    { "id": "new_symptoms", "text": "Have you noticed any new or worsening symptoms?", "options": [
      { "code": "no", "label": "No", "route": "ok" },
      { "code": "yes", "label": "Yes", "route": "concern_alert", "alert_type": "symptom_escalation" } ] },
    { "id": "medicines", "text": "Are you taking your medicines as agreed with your care team?", "options": [
      { "code": "yes", "label": "Yes", "route": "ok" },
      { "code": "none_prescribed", "label": "I was not given any medicines", "route": "ok" },
      { "code": "some_missed", "label": "I have missed some doses", "route": "clinician_task" },
      { "code": "cannot_take", "label": "I cannot take them", "route": "concern_alert", "alert_type": "medication_access_barrier" } ] },
    { "id": "unclear", "text": "Is anything from your visit unclear?", "options": [
      { "code": "no", "label": "No, it is all clear", "route": "ok" },
      { "code": "yes", "label": "Yes, I would like some help", "route": "clarify_task" } ] }
  ]
}
$json$::jsonb);
-- pcc-config-v1-end

alter table public.post_consult_checkin_config enable row level security;
revoke all on public.post_consult_checkin_config from public, anon, authenticated;
grant select on public.post_consult_checkin_config to authenticated;
create policy post_consult_checkin_config_read on public.post_consult_checkin_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());

create function private.post_consult_checkin_config_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'post_consult_checkin_config version % is never deleted', old.version using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.is_active or new.approved_at is not null then
      raise exception 'a post-consultation check-in config is created unsigned and inactive' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.rules is distinct from old.rules or new.version is distinct from old.version then
    raise exception 'a post-consultation check-in config is never edited: add a new version' using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed config keeps its signature' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.post_consult_checkin_config_guard() from public, anon, authenticated;
create trigger post_consult_checkin_config_guard before insert or update or delete on public.post_consult_checkin_config
  for each row execute function private.post_consult_checkin_config_guard();
create trigger refuse_superseded_activation before update of is_active on public.post_consult_checkin_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

create function public.sign_post_consult_checkin_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.post_consult_checkin_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the check-in questions and timing' using errcode = '42501'; end if;
  select * into c from public.post_consult_checkin_config where version = p_version for update;
  if not found then raise exception 'no such check-in configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.post_consult_checkin_config set is_active = false where is_active and version <> p_version;
  update public.post_consult_checkin_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'post_consult_checkin_config.signed',
            'post_consult_checkin_config', c.id, jsonb_build_object('version', p_version));
end $$;
revoke all on function public.sign_post_consult_checkin_config(integer) from public, anon, authenticated;
grant execute on function public.sign_post_consult_checkin_config(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The patient task kind, and the close guard
-- ---------------------------------------------------------------------------
alter table public.care_tasks drop constraint care_tasks_kind_check;
alter table public.care_tasks add constraint care_tasks_kind_check
  check (kind is null or kind in ('log_bp', 'take_medicine', 'book_test', 'join_consultation', 'read_lesson', 'consult_checkin'));

-- The generic "Done" and "Can't do this" buttons (complete_care_task) must not close a check-in without answers.
create function private.care_task_checkin_close_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'consult_checkin' and new.status in ('completed', 'unable_to_complete', 'in_progress')
     and new.status is distinct from old.status
     and coalesce(current_setting('tarragon.checkin_task_close', true), '') <> 'on' then
    raise exception 'a check-in is closed by answering it' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.care_task_checkin_close_guard() from public, anon, authenticated;
create trigger care_tasks_checkin_close_guard before update of status on public.care_tasks
  for each row execute function private.care_task_checkin_close_guard();

-- ---------------------------------------------------------------------------
-- 3. The check-in rows
-- ---------------------------------------------------------------------------
create table public.post_consult_checkins (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  encounter_id      uuid not null references public.encounters (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  clinician_id      uuid references public.profiles (id) on delete set null,
  offset_code       text not null check (offset_code ~ '^[a-z0-9]+$'),
  due_at            timestamptz not null,
  config_version    integer not null references public.post_consult_checkin_config (version) on delete restrict,
  state             text not null default 'scheduled' check (state in ('scheduled', 'open', 'answered', 'expired', 'cancelled')),
  task_id           uuid references public.care_tasks (id) on delete set null,
  opened_at         timestamptz,
  nudge_count       integer not null default 0 check (nudge_count >= 0),
  nudged_at         timestamptz,
  answered_at       timestamptz,
  expired_at        timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  answers           jsonb,
  free_text         text check (free_text is null or char_length(free_text) <= 2000),
  red_flag          boolean not null default false,
  emergency_event_id uuid references public.emergency_events (id) on delete set null,
  alert_id          uuid references public.clinician_alerts (id) on delete set null,
  clinician_task_id uuid references public.care_tasks (id) on delete set null,
  outcome           jsonb,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (encounter_id, offset_code),
  constraint pcc_answered_has_answers check (state <> 'answered' or (answered_at is not null and answers is not null)),
  constraint pcc_cancelled_has_reason check (state <> 'cancelled' or (cancelled_at is not null and cancel_reason is not null))
);
create index post_consult_checkins_patient_idx on public.post_consult_checkins (patient_id, state);
create index post_consult_checkins_due_idx on public.post_consult_checkins (due_at) where state in ('scheduled', 'open');
create index post_consult_checkins_clinician_idx on public.post_consult_checkins (clinician_id) where clinician_id is not null;
create index post_consult_checkins_task_idx on public.post_consult_checkins (task_id) where task_id is not null;
create index post_consult_checkins_clin_task_idx on public.post_consult_checkins (clinician_task_id) where clinician_task_id is not null;
create index post_consult_checkins_alert_idx on public.post_consult_checkins (alert_id) where alert_id is not null;
create index post_consult_checkins_emergency_idx on public.post_consult_checkins (emergency_event_id) where emergency_event_id is not null;
create index post_consult_checkins_org_idx on public.post_consult_checkins (organisation_id);
create index post_consult_checkins_config_idx on public.post_consult_checkins (config_version);
create trigger post_consult_checkins_set_updated_at before update on public.post_consult_checkins
  for each row execute function private.set_updated_at();
comment on table public.post_consult_checkins is
  'PCC: a patient''s short check-in after a completed consultation. Written only by the PCC functions. The patient reads their own rows; staff read answers only through get_consult_checkins() (audited, the consultation''s own clinician).';

alter table public.post_consult_checkins enable row level security;
revoke all on public.post_consult_checkins from public, anon, authenticated;
grant select on public.post_consult_checkins to authenticated;
create policy post_consult_checkins_patient_read on public.post_consult_checkins for select to authenticated
  using (patient_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Event types (ids only, INV-07) and the go-live guard (born off, INV-14)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('consult_checkin.opened', 'A check-in after a consultation was handed to the patient', 'PCC', false),
  ('consult_checkin.answered', 'A check-in after a consultation was answered', 'PCC', false),
  ('consult_checkin.flagged', 'A check-in answer needs the care team', 'PCC', false),
  ('consult_checkin.expired', 'A check-in after a consultation went unanswered', 'PCC', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('consult_checkin.opened', 1, array['checkin_id']),
  ('consult_checkin.answered', 1, array['checkin_id']),
  ('consult_checkin.flagged', 1, array['checkin_id']),
  ('consult_checkin.expired', 1, array['checkin_id']);

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('post_consult_checkins_enabled', 'Check-ins after a consultation',
   'Scheduling, opening and nudging the 48 hour and 7 day check-ins after a completed consultation',
   'A check-in configuration signed by the Chief Medical Officer (the questions, their routes and the timing); admin confirmation',
   'admin',
   array['private.schedule_post_consult_checkins', 'private.post_consult_checkin_sweep (open, nudge, expire, backfill)'],
   'Answering a check-in already opened, and a red-flag answer, are never behind it. Switching it off pauses delivery; it never hides an open check-in.')
on conflict (key) do nothing;

do $patch$
declare
  v_def text := pg_get_functiondef('private.go_live_conditions(text,uuid)'::regprocedure);
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
  v_branch constant text := $branch$
  elsif p_key = 'post_consult_checkins_enabled' then
    return jsonb_build_array(
      private.go_live_cond('checkin_config_signed', 'A check-in configuration signed by the Chief Medical Officer',
        exists (select 1 from public.post_consult_checkin_config where is_active and approved_at is not null), 'data',
        (select 'version ' || max(version) from public.post_consult_checkin_config where is_active and approved_at is not null)),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));$branch$;
begin
  if v_def like '%post_consult_checkins_enabled%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the PCC branch by hand' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $patch$;
revoke all on function private.go_live_conditions(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------------
create function private.pcc_active_config() returns public.post_consult_checkin_config
language sql stable security definer set search_path = ''
as $$ select c from public.post_consult_checkin_config c where c.is_active and c.approved_at is not null order by c.version desc limit 1 $$;
revoke all on function private.pcc_active_config() from public, anon, authenticated;

-- Notification time: inside the window (Africa/Lagos, no DST) now, otherwise the next window start. The TASK is never delayed by this.
create function private.pcc_send_after(p_at timestamptz, p_start integer, p_end integer) returns timestamptz
language plpgsql immutable set search_path = ''
as $$
declare v_local timestamp := p_at at time zone 'Africa/Lagos'; v_h integer := extract(hour from (p_at at time zone 'Africa/Lagos'))::integer;
begin
  if v_h >= p_start and v_h < p_end then return null; end if;
  if v_h < p_start then
    return (date_trunc('day', v_local) + make_interval(hours => p_start)) at time zone 'Africa/Lagos';
  end if;
  return (date_trunc('day', v_local) + interval '1 day' + make_interval(hours => p_start)) at time zone 'Africa/Lagos';
end $$;
revoke all on function private.pcc_send_after(timestamptz, integer, integer) from public, anon, authenticated;

create function private.pcc_open_incident(p_what text, p_count integer) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.ops_incidents where external_reference = 'pcc_checkins' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev3', 'Post-consultation check-ins could not be handled',
            format('%s: %s item(s) failed; see audit_log actions starting pcc_checkin.error. A patient may be missing a check-in.', p_what, p_count),
            'pcc_checkins', now(), now());
  end if;
end $$;
revoke all on function private.pcc_open_incident(text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Scheduling (guard + signed config; idempotent)
-- ---------------------------------------------------------------------------
create function private.schedule_post_consult_checkins(p_encounter uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  e public.encounters%rowtype;
  c public.post_consult_checkin_config%rowtype;
  o jsonb;
  v_n integer := 0;
  v_rows integer;
begin
  if not private.go_live_guard_on('post_consult_checkins_enabled') then return 0; end if;
  c := private.pcc_active_config();
  if c.id is null then return 0; end if;
  select * into e from public.encounters where id = p_encounter;
  if e.id is null or e.status <> 'completed' or e.ended_at is null then return 0; end if;
  if not (e.type = any (select jsonb_array_elements_text(c.rules -> 'encounter_types'))) then return 0; end if;
  for o in select x from jsonb_array_elements(c.rules -> 'offsets') x loop
    insert into public.post_consult_checkins (organisation_id, encounter_id, patient_id, clinician_id, offset_code, due_at, config_version, is_test)
    values (e.organisation_id, e.id, e.patient_id, e.clinician_id, o ->> 'code', e.ended_at + make_interval(mins => (o ->> 'after_minutes')::integer), c.version, e.is_test)
    on conflict (encounter_id, offset_code) do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end loop;
  return v_n;
end $$;
revoke all on function private.schedule_post_consult_checkins(uuid) from public, anon, authenticated;

-- A failure must never stop the clinician completing a consultation, and must never vanish: it is written down, an incident is opened, and the
-- sweep schedules the encounter again.
create function private.encounters_schedule_checkins() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.schedule_post_consult_checkins(new.id);
  exception when others then
    insert into public.audit_log (action, entity_type, entity_id, event)
    values ('pcc_checkin.error_schedule', 'encounter', new.id, jsonb_build_object('error', left(sqlerrm, 300)));
    perform private.pcc_open_incident('scheduling', 1);
  end;
  return null;
end $$;
revoke all on function private.encounters_schedule_checkins() from public, anon, authenticated;
create trigger encounters_schedule_checkins after update of status on public.encounters
  for each row when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function private.encounters_schedule_checkins();

-- ---------------------------------------------------------------------------
-- 7. The sweep: backfill, cancel, open, expire, nudge
-- ---------------------------------------------------------------------------
create function private.post_consult_checkin_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  c public.post_consult_checkin_config%rowtype;
  rc public.post_consult_checkin_config%rowtype;
  v_start integer; v_end integer; v_after timestamptz; v_ch public.notification_channel;
  v_task uuid; v_errors integer := 0; v_opened integer := 0; v_nudged integer := 0; v_expired integer := 0; v_cancelled integer := 0; v_back integer := 0;
begin
  if not private.go_live_guard_on('post_consult_checkins_enabled') then return jsonb_build_object('skipped', 'guard_off'); end if;
  c := private.pcc_active_config();
  if c.id is null then return jsonb_build_object('skipped', 'no_signed_config'); end if;
  v_start := (c.rules #>> '{notification_window,start_hour}')::integer;
  v_end := (c.rules #>> '{notification_window,end_hour}')::integer;

  -- 1. backfill: a completed encounter with no rows (the trigger failed or the guard was off at the time and was switched on within 8 days)
  for r in select e.id from public.encounters e
            where e.status = 'completed' and e.ended_at > now() - interval '8 days'
              and not exists (select 1 from public.post_consult_checkins k where k.encounter_id = e.id) loop
    begin
      v_back := v_back + private.schedule_post_consult_checkins(r.id);
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event) values ('pcc_checkin.error_backfill', 'encounter', r.id, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;

  -- 2. cancel: the consultation was reversed, the care team cancelled the task, or the patient already wrote to the care team (not yet handed over)
  for r in select k.id, case
                 when e.status <> 'completed' then 'encounter_reversed'
                 when t.status = 'cancelled' then 'task_cancelled'
                 else 'patient_already_wrote' end as why
             from public.post_consult_checkins k
             join public.encounters e on e.id = k.encounter_id
             left join public.care_tasks t on t.id = k.task_id
            where k.state in ('scheduled', 'open')
              and (e.status <> 'completed'
                   or t.status = 'cancelled'
                   or (k.state = 'scheduled' and exists (select 1 from public.care_messages m
                        where m.patient_id = k.patient_id and m.author_role = 'patient' and m.created_at > e.ended_at
                          and m.created_at > k.due_at - make_interval(mins => (c.rules ->> 'skip_if_patient_wrote_within_minutes')::integer)))) loop
    begin
      update public.post_consult_checkins set state = 'cancelled', cancelled_at = now(), cancel_reason = r.why where id = r.id;
      perform set_config('tarragon.checkin_task_close', 'on', true);
      update public.care_tasks set status = 'cancelled' where id = (select task_id from public.post_consult_checkins where id = r.id) and status not in ('completed', 'cancelled');
      perform set_config('tarragon.checkin_task_close', 'off', true);
      v_cancelled := v_cancelled + 1;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event) values ('pcc_checkin.error_cancel', 'post_consult_checkin', r.id, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;

  -- 3. open what is due: the task always, then the notices (the task does not wait for them)
  for r in select * from public.post_consult_checkins where state = 'scheduled' and due_at <= now() order by due_at limit 500 loop
    begin
      select * into rc from public.post_consult_checkin_config where version = r.config_version;
      insert into public.care_tasks (organisation_id, patient_id, title, description, owner_role, priority, due_at, source, kind, source_event_id)
      values (r.organisation_id, r.patient_id, rc.rules ->> 'task_title', rc.rules ->> 'task_description', 'patient', 2, r.due_at, 'post_consult_checkin', 'consult_checkin', r.id)
      returning id into v_task;
      update public.post_consult_checkins set state = 'open', opened_at = now(), task_id = v_task where id = r.id;
      v_after := private.pcc_send_after(now(), v_start, v_end);
      v_ch := private.patient_reminder_channel(r.patient_id);
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, send_after)
      values (r.organisation_id, r.patient_id, v_ch, 'pending', 'consult_checkin_due', jsonb_build_object('checkin_id', r.id), 'non_clinical', v_after);
      if v_ch <> 'in_app' then
        insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
        values (r.organisation_id, r.patient_id, 'in_app', 'pending', 'consult_checkin_due', jsonb_build_object('checkin_id', r.id), 'non_clinical');
      end if;
      perform private.emit_domain_event('consult_checkin.opened', r.organisation_id, jsonb_build_object('checkin_id', r.id), 'consult_checkin.opened:' || r.id::text, r.patient_id, 'post_consult_checkin', r.id);
      v_opened := v_opened + 1;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event) values ('pcc_checkin.error_open', 'post_consult_checkin', r.id, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;

  -- 4. expire: no answer inside the window. Silence is not a clinical signal: no alert, one low-priority task so the loop is visible.
  for r in select k.* from public.post_consult_checkins k
            where k.state = 'open' and k.opened_at + make_interval(mins => (c.rules ->> 'expire_after_minutes')::integer) <= now() loop
    begin
      update public.post_consult_checkins set state = 'expired', expired_at = now() where id = r.id;
      perform set_config('tarragon.checkin_task_close', 'on', true);
      update public.care_tasks set status = 'expired' where id = r.task_id and status not in ('completed', 'cancelled', 'expired');
      perform set_config('tarragon.checkin_task_close', 'off', true);
      insert into public.care_tasks (organisation_id, patient_id, title, description, owner_role, owner_id, priority, source, source_event_id)
      values (r.organisation_id, r.patient_id, 'Check-in after a visit was not answered',
              'The patient did not answer the ' || r.offset_code || ' check-in. This is information only; no concern is implied. Reach out if you wish.',
              'clinician', r.clinician_id, 3, 'post_consult_checkin', r.id)
      returning id into v_task;
      update public.post_consult_checkins set clinician_task_id = v_task where id = r.id;
      perform private.emit_domain_event('consult_checkin.expired', r.organisation_id, jsonb_build_object('checkin_id', r.id), 'consult_checkin.expired:' || r.id::text, r.patient_id, 'post_consult_checkin', r.id);
      v_expired := v_expired + 1;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event) values ('pcc_checkin.error_expire', 'post_consult_checkin', r.id, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;

  -- 5. one gentle nudge (config max_nudges), only for check-ins still open
  for r in select k.* from public.post_consult_checkins k
            where k.state = 'open' and k.nudge_count < (c.rules ->> 'max_nudges')::integer
              and k.opened_at + make_interval(mins => (c.rules ->> 'nudge_after_minutes')::integer) <= now() loop
    begin
      v_after := private.pcc_send_after(now(), v_start, v_end);
      v_ch := private.patient_reminder_channel(r.patient_id);
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, send_after)
      values (r.organisation_id, r.patient_id, v_ch, 'pending', 'consult_checkin_nudge', jsonb_build_object('checkin_id', r.id), 'non_clinical', v_after);
      if v_ch <> 'in_app' then
        insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
        values (r.organisation_id, r.patient_id, 'in_app', 'pending', 'consult_checkin_nudge', jsonb_build_object('checkin_id', r.id), 'non_clinical');
      end if;
      update public.post_consult_checkins set nudge_count = nudge_count + 1, nudged_at = now() where id = r.id;
      v_nudged := v_nudged + 1;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event) values ('pcc_checkin.error_nudge', 'post_consult_checkin', r.id, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;

  if v_errors > 0 then perform private.pcc_open_incident('sweep', v_errors); end if;
  return jsonb_build_object('backfilled', v_back, 'cancelled', v_cancelled, 'opened', v_opened, 'expired', v_expired, 'nudged', v_nudged, 'errors', v_errors);
end $$;
revoke all on function private.post_consult_checkin_sweep() from public, anon, authenticated;
select cron.schedule('pcc-checkin-sweep', '*/15 * * * *', $$ select private.post_consult_checkin_sweep(); $$);

-- ---------------------------------------------------------------------------
-- 8. Patient: read and answer
-- ---------------------------------------------------------------------------
create function public.my_post_consult_checkin(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare k public.post_consult_checkins%rowtype; c public.post_consult_checkin_config%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into k from public.post_consult_checkins where id = p_id and patient_id = (select auth.uid());
  if not found then raise exception 'check-in not found' using errcode = 'P0002'; end if;
  select * into c from public.post_consult_checkin_config where version = k.config_version;
  return jsonb_build_object('id', k.id, 'state', k.state, 'offset_code', k.offset_code, 'due_at', k.due_at,
    'title', c.rules ->> 'task_title', 'intro', c.rules ->> 'task_description',
    'free_text_max_chars', (c.rules ->> 'free_text_max_chars')::integer,
    'questions', (select jsonb_agg(jsonb_build_object('id', q ->> 'id', 'text', q ->> 'text',
        'options', (select jsonb_agg(jsonb_build_object('code', op ->> 'code', 'label', op ->> 'label')) from jsonb_array_elements(q -> 'options') op)))
        from jsonb_array_elements(c.rules -> 'questions') q),
    'outcome', k.outcome);
end $$;
revoke all on function public.my_post_consult_checkin(uuid) from public, anon;
grant execute on function public.my_post_consult_checkin(uuid) to authenticated;

create function public.answer_post_consult_checkin(p_id uuid, p_answers jsonb, p_free_text text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  k public.post_consult_checkins%rowtype;
  c public.post_consult_checkin_config%rowtype;
  q jsonb; op jsonb; v_code text;
  v_text text := nullif(btrim(coalesce(p_free_text, '')), '');
  v_red boolean := false; v_concern boolean := false; v_clin boolean := false; v_clar boolean := false; v_symptom boolean := false;
  v_alert uuid; v_ee uuid; v_task uuid; v_desc text := ''; v_out jsonb; v_codes text := ''; v_level public.alert_level;
  v_type public.alert_type_code;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into k from public.post_consult_checkins where id = p_id and patient_id = v_uid for update;
  if not found then raise exception 'check-in not found' using errcode = 'P0002'; end if;
  if k.state = 'answered' then return k.outcome; end if;
  if k.state <> 'open' then raise exception 'this check-in is %', k.state using errcode = '22023'; end if;
  select * into c from public.post_consult_checkin_config where version = k.config_version;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'answers must be an object' using errcode = '22023'; end if;
  if v_text is not null and char_length(v_text) > (c.rules ->> 'free_text_max_chars')::integer then raise exception 'note is too long' using errcode = '22023'; end if;

  for q in select x from jsonb_array_elements(c.rules -> 'questions') x loop
    v_code := p_answers ->> (q ->> 'id');
    select o into op from jsonb_array_elements(q -> 'options') o where o ->> 'code' = v_code;
    if v_code is null or op is null then raise exception 'please answer every question' using errcode = '22023'; end if;
    v_codes := v_codes || case when v_codes = '' then '' else '; ' end || (q ->> 'id') || '=' || v_code;
    case op ->> 'route'
      when 'concern_alert' then
        v_concern := true;
        if coalesce(op ->> 'alert_type', 'symptom_escalation') = 'symptom_escalation' then v_symptom := true; end if;
      when 'clinician_task' then v_clin := true;
      when 'clarify_task' then v_clar := true;
      else null;
    end case;
  end loop;
  if (select count(*) from jsonb_object_keys(p_answers)) <> jsonb_array_length(c.rules -> 'questions') then
    raise exception 'unexpected answers' using errcode = '22023';
  end if;

  -- INV-01: the deterministic danger-phrase list only
  if v_text is not null and coalesce(array_length(private.screen_care_message_for_emergency(v_text), 1), 0) > 0 then v_red := true; end if;

  if v_red then
    -- the existing emergency path: its trigger raises the emergency-level clinician alert; the patient sees the existing guidance
    insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
    values (k.organisation_id, k.patient_id, 'danger_symptom_checklist', 'Your latest answers need prompt attention.', 'active')
    returning id into v_ee;
    -- the emergency trigger raises the alert; read back what it actually did rather than assume (it can decline by entitlement)
    select clinician_alert_id into v_alert from public.emergency_events where id = v_ee;
    if v_alert is null then
      -- a consultation is a paid Member item, so doctor escalation is allowed here: never leave a red flag with no alert
      v_alert := private.raise_clinician_alert(k.organisation_id, k.patient_id, 'emergency'::public.alert_level,
        'Priority 1: danger wording in a check-in after a consultation',
        'The patient''s check-in note matched the deterministic danger-phrase screen. Open the consultation to read it.', 'clinical', 'symptom_escalation');
    end if;
  elsif v_concern then
    v_level := (c.rules ->> 'concern_alert_level')::public.alert_level;
    v_type := case when v_symptom then 'symptom_escalation' else 'medication_access_barrier' end;
    v_alert := private.raise_clinician_alert(k.organisation_id, k.patient_id, v_level,
      'Check-in after a consultation: the patient reports a concern',
      'Answers (codes): ' || v_codes || '. Open the consultation to read the check-in.', 'clinical', v_type);
  end if;

  if v_clin or v_clar then
    v_desc := case when v_clar then 'The patient said something from the visit was unclear and would like some help. ' else '' end
           || case when v_clin then 'The patient said they have missed some doses. ' else '' end
           || 'Open the consultation to read the check-in.';
    insert into public.care_tasks (organisation_id, patient_id, title, description, owner_role, owner_id, priority, source, source_event_id)
    values (k.organisation_id, k.patient_id, case when v_clar then 'Patient asked for help after a visit' else 'Patient missed some doses' end,
            v_desc, 'clinician', k.clinician_id, 2, 'post_consult_checkin', k.id)
    returning id into v_task;
  end if;

  v_out := jsonb_build_object('red_flag', v_red, 'concern', (v_red or v_concern), 'follow_up', (v_clin or v_clar), 'alert_raised', v_alert is not null);
  update public.post_consult_checkins
     set state = 'answered', answered_at = now(), answers = p_answers, free_text = v_text, red_flag = v_red,
         emergency_event_id = v_ee, alert_id = v_alert, clinician_task_id = v_task, outcome = v_out
   where id = k.id;
  perform set_config('tarragon.checkin_task_close', 'on', true);
  update public.care_tasks set status = 'completed' where id = k.task_id and status not in ('completed', 'cancelled');
  perform set_config('tarragon.checkin_task_close', 'off', true);

  perform private.emit_domain_event('consult_checkin.answered', k.organisation_id, jsonb_build_object('checkin_id', k.id), 'consult_checkin.answered:' || k.id::text, k.patient_id, 'post_consult_checkin', k.id);
  if v_red or v_concern then
    perform private.emit_domain_event('consult_checkin.flagged', k.organisation_id, jsonb_build_object('checkin_id', k.id), 'consult_checkin.flagged:' || k.id::text, k.patient_id, 'post_consult_checkin', k.id);
  end if;
  return v_out;
end $$;
revoke all on function public.answer_post_consult_checkin(uuid, jsonb, text) from public, anon;
grant execute on function public.answer_post_consult_checkin(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Clinician: audited read, the consultation's own clinician only (INV-10, INV-12)
-- ---------------------------------------------------------------------------
create function public.get_consult_checkins(p_encounter uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); e public.encounters%rowtype; v_out jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from public.encounters where id = p_encounter;
  if not found or e.clinician_id is distinct from v_uid then raise exception 'not authorised' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.id, 'offset_code', k.offset_code, 'state', k.state, 'due_at', k.due_at, 'answered_at', k.answered_at, 'red_flag', k.red_flag,
      'answers', (select jsonb_agg(jsonb_build_object('question', q ->> 'text',
                    'answer', (select o ->> 'label' from jsonb_array_elements(q -> 'options') o where o ->> 'code' = k.answers ->> (q ->> 'id'))))
                    from jsonb_array_elements(c.rules -> 'questions') q where k.answers is not null),
      'free_text', k.free_text) order by k.due_at), '[]'::jsonb)
    into v_out
    from public.post_consult_checkins k join public.post_consult_checkin_config c on c.version = k.config_version
   where k.encounter_id = p_encounter;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (e.organisation_id, v_uid, 'consult_checkin.read', 'encounter', e.id, jsonb_build_object('rows', jsonb_array_length(v_out)), e.patient_id);
  return v_out;
end $$;
revoke all on function public.get_consult_checkins(uuid) from public, anon;
grant execute on function public.get_consult_checkins(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Neutral templates (INV-07). No sender change is deployed by this migration (post-merge step: redeploy send-pending-notifications).
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, description) values
  ('consult_checkin_due', 'clinical', 'routine', 'patient', array['push', 'email', 'in_app']::public.notification_channel[], 'A short check-in after a consultation is waiting in the app.'),
  ('consult_checkin_nudge', 'clinical', 'routine', 'patient', array['push', 'email', 'in_app']::public.notification_channel[], 'One gentle reminder that the check-in is still waiting.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('consult_checkin_due', 'en', 'in_app', null, 'Your care team has a quick check-in for you. Open the app to answer'),
  ('consult_checkin_due', 'en', 'push', null, 'Your care team has a quick check-in for you'),
  ('consult_checkin_due', 'en', 'email', 'A quick check-in from your care team', 'Your care team has a quick check-in for you. Open the Tarragon Health app to answer.'),
  ('consult_checkin_nudge', 'en', 'in_app', null, 'Your quick check-in is still waiting whenever you are ready'),
  ('consult_checkin_nudge', 'en', 'push', null, 'Your quick check-in is still waiting'),
  ('consult_checkin_nudge', 'en', 'email', 'Your quick check-in is still waiting', 'Your quick check-in is still waiting in the Tarragon Health app, whenever you are ready.')
on conflict (template_key, locale, channel) do nothing;

-- ---------------------------------------------------------------------------
-- 11. Self-check
-- ---------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  if exists (select 1 from public.post_consult_checkin_config where is_active) then raise exception 'FAIL: a config was born active'; end if;
  if exists (select 1 from public.go_live_guards where key = 'post_consult_checkins_enabled' and is_on) then raise exception 'FAIL: the guard was born on'; end if;
  if jsonb_array_length(private.go_live_conditions('post_consult_checkins_enabled', null)) <> 2 then raise exception 'FAIL: the guard has no conditions'; end if;
  if has_table_privilege('anon', 'public.post_consult_checkins', 'SELECT') or has_table_privilege('authenticated', 'public.post_consult_checkins', 'INSERT')
     or has_table_privilege('authenticated', 'public.post_consult_checkins', 'UPDATE') or has_table_privilege('authenticated', 'public.post_consult_checkins', 'DELETE') then
    raise exception 'FAIL: wrong table privileges on post_consult_checkins';
  end if;
  foreach v_fn in array array['public.answer_post_consult_checkin(uuid,jsonb,text)', 'public.my_post_consult_checkin(uuid)', 'public.get_consult_checkins(uuid)',
                              'public.sign_post_consult_checkin_config(integer)', 'private.post_consult_checkin_sweep()', 'private.schedule_post_consult_checkins(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'FAIL: anon can execute %', v_fn; end if;
  end loop;
  if has_function_privilege('authenticated', 'private.post_consult_checkin_sweep()', 'EXECUTE') then raise exception 'FAIL: authenticated can run the sweep'; end if;
  if not exists (select 1 from cron.job where jobname = 'pcc-checkin-sweep') then raise exception 'FAIL: the sweep is not scheduled'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.encounters'::regclass and tgname = 'encounters_schedule_checkins') then raise exception 'FAIL: the scheduling trigger is missing'; end if;
end $$;
