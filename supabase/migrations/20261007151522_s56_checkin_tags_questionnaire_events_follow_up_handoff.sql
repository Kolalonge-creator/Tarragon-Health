-- S56 step 3 of 4: check-in tags (10.1), questionnaire.completed and the follow-up pathway (10.2), the booking hand-off (10.13).
--
-- 1. wellbeing_checkins.tags: optional, from a fixed list (a CHECK, not free text, so a tag can never carry a diagnosis or a name).
--    Existing rows get '{}'. Rows affected on migrate: every existing row takes the default; no conversion is needed.
-- 2. Event questionnaire.completed on the S10 outbox: ids only (screen_id), idempotent per screen. A failure is audited and never
--    blocks the screen.
-- 3. Follow-up pathway for PHQ-9, GAD-7 and EPDS: a moderate or high concern (private.classify_mental_health_screen_concern, the
--    existing governed classification) creates a real clinical_tasks follow-up (existing type symptom_review). The task due times are
--    a DRAFT, PROPOSED and unsigned (table mental_health_follow_up_config, mirrored in packages/shared proposed-config), and the whole
--    pathway sits behind the CMO-switched guard mental_health_follow_up_enabled, seeded OFF. A crisis screen is NOT handled here: the
--    F1 crisis task already covers it. Existing alerts from the older ladder are unchanged.
-- 4. request_mental_health_handoff: a patient sends a positive screen's summary to the care team and a task (admin_clinical) is raised
--    for a clinician. Module 15 (onward referral) is not built; it will consume mental_health_handoffs where state = 'open'.

-- 1. Tags
alter table public.wellbeing_checkins
  add column if not exists tags text[] not null default '{}'::text[];
alter table public.wellbeing_checkins drop constraint if exists wellbeing_checkins_tags_allowed;
alter table public.wellbeing_checkins add constraint wellbeing_checkins_tags_allowed
  check (cardinality(tags) <= 6 and tags <@ array['work', 'money', 'family', 'relationships', 'health', 'sleep', 'grief', 'faith', 'exams', 'loneliness', 'other']::text[]);
comment on column public.wellbeing_checkins.tags is 'Optional context chosen by the patient from a fixed list (S56, 10.1). Never free text.';

-- 2. Event
insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('questionnaire.completed', 'A wellbeing questionnaire was saved (ids only; the instrument and score are read through the audited path)', 'S56', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('questionnaire.completed', 1, array['screen_id'])
on conflict (event_type, version) do nothing;

create or replace function private.mental_health_screen_completed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.emit_domain_event('questionnaire.completed', new.organisation_id, jsonb_build_object('screen_id', new.id),
      'questionnaire.completed:' || new.id, new.patient_id, 'mental_health_screen', new.id);
  exception when others then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'questionnaire_event.error', 'mental_health_screen', new.id, jsonb_build_object('error', sqlerrm));
  end;
  return new;
end $$;
revoke all on function private.mental_health_screen_completed() from public, anon, authenticated;
drop trigger if exists mental_health_screens_questionnaire_event on public.mental_health_screens;
create trigger mental_health_screens_questionnaire_event after insert on public.mental_health_screens
  for each row execute function private.mental_health_screen_completed();

-- 3. Follow-up config (DRAFT, PROPOSED), guard, trigger
create table if not exists public.mental_health_follow_up_config (
  id           uuid primary key default gen_random_uuid(),
  version      integer not null unique check (version >= 1),
  status       text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  config       jsonb not null,
  notes        text,
  confirmed_by uuid references public.profiles (id) on delete restrict,
  confirmed_at timestamptz,
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint mh_follow_up_confirmed_has_signer check (status <> 'confirmed' or (confirmed_by is not null and confirmed_at is not null))
);
create unique index if not exists mental_health_follow_up_config_one_active on public.mental_health_follow_up_config (is_active) where is_active;
create index if not exists mental_health_follow_up_config_confirmed_by_idx on public.mental_health_follow_up_config (confirmed_by) where confirmed_by is not null;
alter table public.mental_health_follow_up_config enable row level security;
drop policy if exists mental_health_follow_up_config_select on public.mental_health_follow_up_config;
create policy mental_health_follow_up_config_select on public.mental_health_follow_up_config for select to authenticated
  using (private.is_admin() or private.is_active_clinical_director());
revoke all on public.mental_health_follow_up_config from anon;
grant select on public.mental_health_follow_up_config to authenticated;
-- followup-rules-v1-begin
insert into public.mental_health_follow_up_config (version, status, config, notes, is_active)
values (1, 'proposed', $json${"phq9":{"moderate_due_minutes":4320,"high_due_minutes":1440},"gad7":{"moderate_due_minutes":4320,"high_due_minutes":1440},"epds":{"moderate_due_minutes":4320,"high_due_minutes":1440}}$json$::jsonb,
  'DRAFT, UNSIGNED (S56, 2026-10-07). Task due times for a follow-up after a moderate or high concern. PROPOSED by the build, not a clinical decision: the CMO must read and confirm or replace them. The pathway stays OFF (guard mental_health_follow_up_enabled) until they do.', true)
on conflict (version) do nothing;
-- followup-rules-v1-end

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in)
values ('mental_health_follow_up_enabled', 'Wellbeing follow-up tasks',
  'The follow-up task created after a moderate or high PHQ-9, GAD-7 or EPDS result',
  'The CMO has read and confirmed the follow-up timings (mental_health_follow_up_config), and the on-call and clinician cover for follow-up is confirmed',
  'cmo', array['trigger mental_health_screens_follow_up_task'],
  'The crisis path (any self-harm answer), the older clinician alert for moderate and high results, the crisis card and every screen are not behind it.')
on conflict (key) do nothing;

do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def not like '%mental_health_follow_up_enabled%' then
    v_new := replace(v_def, E'  end if;\n  -- An unknown key has no conditions',
      E'  elsif p_key = ''mental_health_follow_up_enabled'' then\n' ||
      E'    return jsonb_build_array(\n' ||
      E'      private.go_live_cond(''follow_up_timings_confirmed'', ''The CMO has confirmed the follow-up timings'', private.go_live_attested(p_key, ''follow_up_timings_confirmed''), ''attestation'', null),\n' ||
      E'      private.go_live_cond(''follow_up_cover_confirmed'', ''Clinician cover for follow-up tasks is confirmed'', private.go_live_attested(p_key, ''follow_up_cover_confirmed''), ''attestation'', null));\n' ||
      E'  end if;\n  -- An unknown key has no conditions');
    if v_new = v_def then raise exception 'S56: go_live_conditions marker not found (definition drifted)'; end if;
    execute v_new;
  end if;
  v_def := pg_get_functiondef('public.attest_go_live_condition(text, text, boolean, text)'::regprocedure);
  if v_def not like '%mental_health_follow_up_enabled%' then
    v_new := replace(v_def, '(''symptom_checker_enabled'', ''accuracy_baseline_recorded'')) then',
      '(''symptom_checker_enabled'', ''accuracy_baseline_recorded''),' || E'\n' ||
      '       (''mental_health_follow_up_enabled'', ''follow_up_timings_confirmed''), (''mental_health_follow_up_enabled'', ''follow_up_cover_confirmed'')) then');
    if v_new = v_def then raise exception 'S56: attest_go_live_condition marker not found (definition drifted)'; end if;
    execute v_new;
  end if;
end $$;

create or replace function private.mental_health_follow_up_task()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_concern text; v_cfg jsonb; v_due integer;
begin
  if new.crisis_flagged or new.instrument not in ('phq9', 'gad7', 'epds') then return new; end if;
  v_concern := private.classify_mental_health_screen_concern(new.instrument, new.severity_band, new.hazardous);
  if v_concern not in ('moderate', 'high') then return new; end if;
  if not private.go_live_open_patient('mental_health_follow_up_enabled', new.patient_id) then return new; end if;
  begin
    select config -> new.instrument into v_cfg from public.mental_health_follow_up_config where is_active;
    v_due := (v_cfg ->> (v_concern || '_due_minutes'))::integer;
    if v_due is null then raise exception 'no active follow-up timing for % %', new.instrument, v_concern; end if;
    perform private.create_clinical_task(new.patient_id, 'symptom_review', v_due, 'mh_follow_up:' || new.patient_id || ':' || new.instrument);
  exception when others then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'mh_follow_up.error', 'mental_health_screen', new.id, jsonb_build_object('error', sqlerrm));
    perform private.page_incident(new.organisation_id, 'mh_follow_up_failed:' || new.id, 'A wellbeing follow-up task could not be created',
      'A follow-up task for a wellbeing result failed; see audit_log action mh_follow_up.error. The older clinician alert still exists.');
  end;
  return new;
end $$;
revoke all on function private.mental_health_follow_up_task() from public, anon, authenticated;
drop trigger if exists mental_health_screens_follow_up_task on public.mental_health_screens;
create trigger mental_health_screens_follow_up_task after insert on public.mental_health_screens
  for each row execute function private.mental_health_follow_up_task();

-- 4. Hand-off
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
  end if;
  insert into public.mental_health_handoffs (id, organisation_id, patient_id, screen_id, summary, patient_note, is_test)
  values (v_id, v_pr.organisation_id, v_uid, p_screen, v_summary, nullif(btrim(p_note), ''), coalesce(v_pr.is_test, false));
  v_task := private.create_clinical_task(v_uid, 'admin_clinical', null, 'mh_handoff:' || v_id);
  update public.mental_health_handoffs set task_id = v_task where id = v_id;
  return v_id;
end $$;
revoke all on function public.request_mental_health_handoff(uuid, text) from public, anon;
grant execute on function public.request_mental_health_handoff(uuid, text) to authenticated;

do $$
begin
  if not exists (select 1 from public.go_live_guards where key = 'mental_health_follow_up_enabled' and not is_on) then raise exception 'FAIL: follow-up guard missing or on'; end if;
  if jsonb_array_length(private.go_live_conditions('mental_health_follow_up_enabled', null)) <> 2 then raise exception 'FAIL: expected two follow-up conditions'; end if;
  if jsonb_array_length(private.go_live_conditions('symptom_checker_enabled', null)) <> 6 then raise exception 'FAIL: the symptom checker conditions were disturbed'; end if;
  if exists (select 1 from public.mental_health_follow_up_config where status = 'confirmed' or confirmed_by is not null) then raise exception 'FAIL: a follow-up config is signed by the build'; end if;
  if has_function_privilege('anon', 'public.request_mental_health_handoff(uuid,text)', 'EXECUTE') then raise exception 'FAIL: anon can request a hand-off'; end if;
end $$;
