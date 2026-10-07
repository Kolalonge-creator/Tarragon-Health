-- S52: AI health assistant (2 of 2), safety, transparency, memory and clinician review (spec B.7, functions 7.8 to 7.13).
-- INV-04, INV-05, INV-07, INV-10, INV-11, INV-14. Design: docs/design/S52.md. Stacked on S51 (assistant_config, the assistant_enabled guard).
--
-- D1 (founder): map onto LIVE tables. New tables only where nothing live exists:
--   assistant_memory_consents, assistant_memory_items   goals and preferences the patient chose to be remembered, consent first
--   assistant_review_samples                            the monthly sample for the clinical lead's review (ids and a verdict, never the text)
-- Everything else is a column or a function on what is already live:
--   ai_assistant_turns.interaction_id      the link from a reported answer (ai_safety_incidents, ai_interaction_log) to its conversation
--   assistant_config keys silence, review, memory (PROPOSED; mirrored by packages/shared proposed-config assistant.silence, .review, .memory)
--   AI-020 "Assistant memory" registered DISABLED in ai_systems (kill switch; OFF by default)
--   event type assistant.silence_detected; generic template assistant_reengage
--   public.assistant_page_on_call(), assistant_detect_silence(), assistant_sample_month(), assistant_review_*()
--
-- Live counts checked read-only 2026-10-07: ai_conversations 1, ai_assistant_turns 1, ai_safety_incidents with an interaction 0,
-- chronic_programme_enrolments and active care_pack entitlements: no conversation belongs to either, so no live patient is reached by any
-- job here. No data conversion. Nothing is switched on: AI-020 is disabled, assistant_enabled is off, and every job is closed behind the guard.

-- ---------------------------------------------------------------------------
-- 0. The link from a turn to its audit interaction
-- ---------------------------------------------------------------------------
alter table public.ai_assistant_turns add column if not exists interaction_id uuid references public.ai_interaction_log (id) on delete set null;
create index if not exists ai_assistant_turns_interaction_idx on public.ai_assistant_turns (interaction_id) where interaction_id is not null;
comment on column public.ai_assistant_turns.interaction_id is
  'S52: the ai_interaction_log row of the governed call that produced this turn, so a reported answer (ai_safety_incidents.interaction_id) can be traced to its conversation for the monthly review.';

-- ---------------------------------------------------------------------------
-- 1. Configuration (PROPOSED, CMO confirms)
-- ---------------------------------------------------------------------------
-- assistant-config-s52-begin
insert into public.assistant_config (key, value, config_version)
select e.key, e.value, 1
  from jsonb_each($json${
 "silence": {"silence_days": 7, "reengage_after_days": 10, "reengage_cooldown_days": 30},
 "review": {"monthly_sample_size": 20},
 "memory": {"max_items": 30, "max_chars": 200, "consent_text_version": "mem-v1"},
 "paging": {"repeat_hours": 6, "no_cover_repeat_minutes": 30}
}$json$::jsonb) as e(key, value);
-- assistant-config-s52-end

create function private.assistant_cfg(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select value from public.assistant_config where key = p_key $$;
revoke all on function private.assistant_cfg(text) from public, anon;
grant execute on function private.assistant_cfg(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Register the memory as an AI system, DISABLED (the kill switch is real and starts off)
-- ---------------------------------------------------------------------------
insert into public.ai_systems (
  system_code, name, purpose, owner_role, risk_class, autonomy_level, clinically_meaningful, lifecycle_status, is_enabled, runtime_governed,
  fallback_behaviour, code_reference
) values (
  'AI-020', 'Assistant memory',
  'Goals and preferences a patient has chosen to be remembered (consent first, goals and preferences only, never a clinical fact), read into the assistant''s context so it can be consistent between conversations. The patient can view, edit, delete and export every item.',
  'Clinical Director', 'moderate', 'inform_only', false, 'draft', false, false,
  'The assistant answers without any remembered context. Nothing about the patient is lost: the memory table is the patient''s own list and is not read while this system is disabled.',
  'apps/web/src/lib/ai-coach/memory.ts'
) on conflict (system_code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Memory: consent first, then items
-- ---------------------------------------------------------------------------
create table public.assistant_memory_consents (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  text_version    text not null check (btrim(text_version) <> ''),
  granted_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  source          text not null default 'patient' check (source = 'patient'),
  recorded_by     uuid not null references public.profiles (id) on delete cascade,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  check (revoked_at is null or revoked_at >= granted_at)
);
create unique index assistant_memory_consents_one_active on public.assistant_memory_consents (patient_id) where revoked_at is null;
create index assistant_memory_consents_patient_idx on public.assistant_memory_consents (patient_id, granted_at desc);
comment on table public.assistant_memory_consents is
  'S52 (INV-11, spec 7.12): the patient''s own consent to the assistant remembering goals and preferences. One row per grant; revoked_at ends it. Written only by assistant_memory_set_consent() for the signed-in patient. Nothing is ever defaulted or written for them.';

create table public.assistant_memory_items (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  consent_id      uuid not null references public.assistant_memory_consents (id) on delete cascade,
  kind            text not null check (kind in ('goal', 'preference')),
  text            text not null check (length(btrim(text)) between 3 and 400),
  source          text not null default 'patient' check (source = 'patient'),
  recorded_by     uuid not null references public.profiles (id) on delete cascade,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index assistant_memory_items_patient_idx on public.assistant_memory_items (patient_id, created_at);
comment on table public.assistant_memory_items is
  'S52 (spec 7.12): goals and preferences only, in the patient''s own words, never a clinical fact (a trigger refuses condition, reading, result or medicine words). source and recorded_by name the patient. RLS: the patient only; staff, caregivers and the assistant''s own service role have no policy. The AI path reads it only through assistant_memory_for_prompt(), which needs an active consent and AI-020 enabled.';

alter table public.assistant_memory_consents enable row level security;
alter table public.assistant_memory_items enable row level security;
create policy assistant_memory_consents_own on public.assistant_memory_consents for select to authenticated using (patient_id = (select auth.uid()));
create policy assistant_memory_items_select on public.assistant_memory_items for select to authenticated using (patient_id = (select auth.uid()));
create policy assistant_memory_items_insert on public.assistant_memory_items for insert to authenticated with check (patient_id = (select auth.uid()));
create policy assistant_memory_items_update on public.assistant_memory_items for update to authenticated
  using (patient_id = (select auth.uid())) with check (patient_id = (select auth.uid()));
create policy assistant_memory_items_delete on public.assistant_memory_items for delete to authenticated using (patient_id = (select auth.uid()));
revoke all on public.assistant_memory_consents, public.assistant_memory_items from public, anon, authenticated;
grant select on public.assistant_memory_consents to authenticated;
grant select, insert, update, delete on public.assistant_memory_items to authenticated;

-- Is the memory switched on at all? The kill switch in the AI registry. Off by default.
create function public.assistant_memory_available() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select s.is_enabled from public.ai_systems s where s.system_code = 'AI-020'), false) $$;
revoke all on function public.assistant_memory_available() from public, anon;
grant execute on function public.assistant_memory_available() to authenticated;

create function private.assistant_memory_consent_id(p_patient uuid) returns uuid
language sql stable security definer set search_path = ''
as $$ select id from public.assistant_memory_consents where patient_id = p_patient and revoked_at is null $$;
revoke all on function private.assistant_memory_consent_id(uuid) from public, anon;

-- The consent is the patient's own, written before the first item.
create function public.assistant_memory_set_consent(p_granted boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  v_active uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_granted is null then raise exception 'say whether to switch the memory on or off' using errcode = '22023'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_uid;
  if v_org is null then raise exception 'your account is not attached to an organisation' using errcode = '42501'; end if;
  v_active := private.assistant_memory_consent_id(v_uid);
  if p_granted then
    if not public.assistant_memory_available() then
      raise exception 'assistant_memory_not_available: the memory is not switched on yet' using errcode = '55000';
    end if;
    if v_active is null then
      insert into public.assistant_memory_consents (organisation_id, patient_id, text_version, recorded_by, is_test)
      values (v_org, v_uid, coalesce(private.assistant_cfg('memory') ->> 'consent_text_version', 'mem-v1'), v_uid, v_test)
      returning id into v_active;
      perform private.log_audit('assistant_memory.consent_granted', 'assistant_memory_consents', v_active, '{}'::jsonb);
    end if;
  elsif v_active is not null then
    -- Switching the memory off FORGETS it: the items go with the consent, so a later "switch on" can never bring back what the patient
    -- thought was gone. They can export first (the screen says so). The audit row keeps a count, never the words.
    update public.assistant_memory_consents set revoked_at = now() where id = v_active;
    perform private.log_audit('assistant_memory.consent_revoked', 'assistant_memory_consents', v_active,
      jsonb_build_object('items_removed', (select count(*) from public.assistant_memory_items where patient_id = v_uid)));
    delete from public.assistant_memory_items where patient_id = v_uid;
    v_active := null;
  end if;
  return jsonb_build_object('consented', v_active is not null);
end $$;
revoke all on function public.assistant_memory_set_consent(boolean) from public, anon;
grant execute on function public.assistant_memory_set_consent(boolean) to authenticated;

-- What the patient sees at the top of the screen.
create function public.assistant_memory_state() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'available', public.assistant_memory_available(),
    'consented', private.assistant_memory_consent_id((select auth.uid())) is not null,
    'text_version', coalesce(private.assistant_cfg('memory') ->> 'consent_text_version', 'mem-v1'),
    'max_items', coalesce((private.assistant_cfg('memory') ->> 'max_items')::integer, 30),
    'max_chars', coalesce((private.assistant_cfg('memory') ->> 'max_chars')::integer, 200),
    'items', (select count(*) from public.assistant_memory_items where patient_id = (select auth.uid())))
  where (select auth.uid()) is not null
$$;
revoke all on function public.assistant_memory_state() from public, anon;
grant execute on function public.assistant_memory_state() to authenticated;

-- Item guard: consent first, goals and preferences only, a cap, attribution stamped by the server.
create function private.assistant_memory_items_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cfg jsonb := private.assistant_cfg('memory');
  v_max_chars integer := coalesce((v_cfg ->> 'max_chars')::integer, 200);
  v_max_items integer := coalesce((v_cfg ->> 'max_items')::integer, 30);
  v_consent uuid;
begin
  if v_uid is null or new.patient_id is distinct from v_uid then
    raise exception 'a memory item is the signed-in patient''s own' using errcode = '42501';
  end if;
  v_consent := private.assistant_memory_consent_id(v_uid);
  if v_consent is null then
    raise exception 'assistant_memory_consent_required: switch the memory on first' using errcode = '42501';
  end if;
  if not public.assistant_memory_available() then
    raise exception 'assistant_memory_not_available: the memory is not switched on yet' using errcode = '55000';
  end if;
  new.text := btrim(new.text);
  if length(new.text) > v_max_chars then
    raise exception 'assistant_memory_too_long: keep it to % characters', v_max_chars using errcode = '22001';
  end if;
  -- goals and preferences only, never a clinical fact: the same word list that keeps a notification from naming a condition, reading or medicine
  if cardinality(private.notification_text_violations(new.text)) > 0 then
    raise exception 'assistant_memory_clinical_content: keep this to a goal or a preference. Health details stay in your record' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.assistant_memory_items where patient_id = v_uid) >= v_max_items then
    raise exception 'assistant_memory_full: at most % items. Remove one first', v_max_items using errcode = '54000';
  end if;
  select organisation_id, coalesce(is_test, false) into new.organisation_id, new.is_test from public.profiles where id = v_uid;
  new.consent_id := v_consent;
  new.source := 'patient';
  new.recorded_by := v_uid;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.assistant_memory_items_guard() from public, anon, authenticated;
create trigger assistant_memory_items_guard before insert or update on public.assistant_memory_items
  for each row execute function private.assistant_memory_items_guard();

-- Audit trail: ids and kinds only, never the text.
create function private.assistant_memory_items_audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.log_audit('assistant_memory.item_' || lower(tg_op), 'assistant_memory_items', coalesce(new.id, old.id),
    jsonb_build_object('kind', coalesce(new.kind, old.kind)));
  return null;
end $$;
revoke all on function private.assistant_memory_items_audit() from public, anon, authenticated;
create trigger assistant_memory_items_audit after insert or update or delete on public.assistant_memory_items
  for each row execute function private.assistant_memory_items_audit();

create function public.assistant_memory_delete_all() returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '42501'; end if;
  delete from public.assistant_memory_items where patient_id = (select auth.uid());
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.assistant_memory_delete_all() from public, anon;
grant execute on function public.assistant_memory_delete_all() to authenticated;

create function public.assistant_memory_export() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_out jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_out := jsonb_build_object(
    'exported_at', now(),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('granted_at', c.granted_at, 'revoked_at', c.revoked_at, 'text_version', c.text_version) order by c.granted_at)
                           from public.assistant_memory_consents c where c.patient_id = v_uid), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'text', i.text, 'created_at', i.created_at, 'updated_at', i.updated_at) order by i.created_at)
                        from public.assistant_memory_items i where i.patient_id = v_uid), '[]'::jsonb));
  perform private.log_audit('assistant_memory.exported', 'assistant_memory_items', null, '{}'::jsonb);
  return v_out;
end $$;
revoke all on function public.assistant_memory_export() from public, anon;
grant execute on function public.assistant_memory_export() to authenticated;

-- The ONLY read path for the AI: needs an active consent AND the AI-020 kill switch on. Items only; no ids, no dates.
create function public.assistant_memory_for_prompt() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object('kind', i.kind, 'text', i.text) order by i.created_at)
      from public.assistant_memory_items i
     where i.patient_id = (select auth.uid())
       and i.consent_id = private.assistant_memory_consent_id((select auth.uid()))
       and public.assistant_memory_available()), '[]'::jsonb)
$$;
revoke all on function public.assistant_memory_for_prompt() from public, anon;
grant execute on function public.assistant_memory_for_prompt() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Silence signal and re-engagement (spec 7.10): a signal, never a treatment change
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('assistant.silence_detected', 'A programme member has not written to the assistant for the configured days. A signal for the triage engine and the care team to read; it changes nothing by itself', 'S52', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values ('assistant.silence_detected', 1, array['days'])
on conflict (event_type, version) do nothing;

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('assistant_reengage', 'operational', 'routine', 'patient', array['in_app', 'push']::public.notification_channel[], 'scheduled', 'A gentle note after a quiet spell. Names nothing about the patient.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('assistant_reengage', 'en', 'in_app', 'Here when you need us', 'It has been a little while. Your assistant is here whenever you have a question.'),
  ('assistant_reengage', 'en', 'push', 'Here when you need us', 'It has been a little while. Open the app whenever you are ready.')
on conflict do nothing;

-- A programme member: an active care pack, or enrolled in a chronic care programme.
create function private.assistant_programme_member(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.entitlements e
                  where e.patient_id = p_patient and e.kind = 'care_pack' and e.state = 'active' and (e.ends_at is null or e.ends_at > now()))
      or exists (select 1 from public.chronic_programme_enrolments c where c.patient_id = p_patient and c.status = 'enrolled')
$$;
revoke all on function private.assistant_programme_member(uuid) from public, anon;

-- A timestamp out of a stored message, or null when it is not one. A malformed row must never fail the whole daily job.
create function private.assistant_safe_ts(p_text text) returns timestamptz
language plpgsql immutable set search_path = ''
as $$
begin
  return p_text::timestamptz;
exception when others then
  return null;
end $$;
revoke all on function private.assistant_safe_ts(text) from public, anon;

create function public.assistant_detect_silence(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg jsonb := private.assistant_cfg('silence');
  v_silence integer := coalesce((v_cfg ->> 'silence_days')::integer, 7);
  v_reengage integer := coalesce((v_cfg ->> 'reengage_after_days')::integer, 10);
  v_cooldown integer := coalesce((v_cfg ->> 'reengage_cooldown_days')::integer, 30);
  r record;
  v_days integer;
  v_signals integer := 0;
  v_reengaged integer := 0;
begin
  for r in
    select c.profile_id as patient_id, c.organisation_id, max(u.at) as last_at
      from public.ai_conversations c
      join public.profiles p on p.id = c.profile_id and p.role = 'patient' and p.is_active
      cross join lateral (
        select max(private.assistant_safe_ts(m ->> 'created_at')) as at
          from jsonb_array_elements(case when jsonb_typeof(c.messages) = 'array' then c.messages else '[]'::jsonb end) m
         where jsonb_typeof(m) = 'object' and m ->> 'role' = 'user') u
     where u.at is not null
       -- only people the assistant is open to (the guard on, or an is_test account), and only programme members
       and private.go_live_open_patient('assistant_enabled', c.profile_id)
       and private.assistant_programme_member(c.profile_id)
     group by c.profile_id, c.organisation_id
  loop
    v_days := floor(extract(epoch from (p_now - r.last_at)) / 86400)::integer;
    if v_days >= v_silence then
      perform private.emit_domain_event('assistant.silence_detected', r.organisation_id,
        jsonb_build_object('days', v_days, 'last_message_on', r.last_at::date),
        'assistant.silence_detected:' || r.patient_id || ':' || r.last_at::date, r.patient_id, 'ai_conversations', null, 'normal');
      v_signals := v_signals + 1;
      if v_days >= v_reengage and not exists (
           select 1 from public.notifications n
            where n.recipient_id = r.patient_id and n.template = 'assistant_reengage' and n.created_at > p_now - make_interval(days => v_cooldown)) then
        -- the S51 door: it honours the patient's education_wellness opt-out and is once per day
        if public.assistant_queue_nudge(r.patient_id, 'assistant_reengage', p_now::date) then v_reengaged := v_reengaged + 1; end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('signals', v_signals, 'reengaged', v_reengaged);
end $$;
revoke all on function public.assistant_detect_silence(timestamptz) from public, anon, authenticated;
grant execute on function public.assistant_detect_silence(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 5. On-call page for a self-harm message (INV-05), in the shape the F1 crisis fix uses
-- ---------------------------------------------------------------------------
-- Reuses what exists rather than adding a second crisis path: the S16 class 1 task type red_event_unacknowledged (no lead window, so a
-- crisis never waits to be pulled) under the dedup key crisis:<patient> that the wellbeing-screen crisis follow-up (F1, PR #1005) uses too,
-- so a crisis from the check-in and one from the assistant are ONE live task for the patient; the neutral on_call_page notice to the
-- clinician on call (or the clinical lead and ops with an incident when nobody is); a failed step is audited and opens an incident and never
-- blocks the patient's emergency copy. The S19 page rows hang off a graded triage event, and a shadow grade never pages (OQ-88), so this does
-- not create one. The emergency escalation raised in the same turn keeps its own SLA ladder as the second line.
create function public.assistant_page_on_call(p_patient uuid, p_conversation uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_test boolean;
  v_to uuid;
  v_task uuid;
  v_n integer := 0;
  v_failed boolean := false;
  v_notified boolean := false;
  v_repeat integer := coalesce((private.assistant_cfg('paging') ->> 'repeat_hours')::integer, 6);
  v_repeat_nc integer := coalesce((private.assistant_cfg('paging') ->> 'no_cover_repeat_minutes')::integer, 30);
  c text;
  r record;
begin
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = p_patient;
  if v_org is null then raise exception 'unknown patient' using errcode = '22023'; end if;
  -- once per conversation per window: a patient who keeps writing is not paged every message (the task merges them). A page that found
  -- nobody on call is retried sooner (the rota may have cover by then); a page that failed to send leaves no marker at all.
  if exists (select 1 from public.audit_log a
              where a.action = 'assistant.on_call_paged' and a.entity_id = p_conversation
                and a.created_at > now() - case when coalesce((a.event ->> 'no_cover')::boolean, false) then make_interval(mins => v_repeat_nc) else make_interval(hours => v_repeat) end) then
    return jsonb_build_object('paged', false, 'already', true);
  end if;

  begin
    v_task := private.create_clinical_task(p_patient, 'red_event_unacknowledged', null, 'crisis:' || p_patient, null, null, null);
  exception when others then
    v_failed := true;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (v_org, 'assistant.crisis_task_error', 'ai_conversations', p_conversation, jsonb_build_object('step', 'task', 'error', sqlerrm));
    perform private.page_incident(v_org, 'assistant_crisis_follow_up_failed:' || p_conversation, 'A priority follow-up could not be completed',
      'A priority follow-up from the assistant failed; see audit_log action assistant.crisis_task_error. The emergency guidance was still shown.');
  end;

  begin
    v_to := private.page_recipient(v_org, v_test);
    if v_to is not null then
      foreach c in array array['push', 'in_app', 'email'] loop
        insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
        values (v_to, v_org, c::public.notification_channel, 'on_call_page', '{}'::jsonb, 'pending', 'non_clinical', 'critical',
                case when v_task is not null then 'clinical_tasks' else 'ai_conversations' end, coalesce(v_task, p_conversation));
      end loop;
      v_notified := true;
    else
      for r in
        select p.id from public.profiles p where p.organisation_id = v_org and p.is_active and p.role = 'admin' and p.is_test = v_test
        union
        select cs.profile_id from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id
         where cs.organisation_id = v_org and cs.profile_id is not null and cs.active and cs.status = 'active'
           and cs.doctor_tier = 'chief_medical_officer' and p.is_test = v_test
      loop
        foreach c in array array['push', 'in_app', 'email'] loop
          insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
          values (r.id, v_org, c::public.notification_channel, 'on_call_escalation', '{}'::jsonb, 'pending', 'non_clinical', 'critical',
                  case when v_task is not null then 'clinical_tasks' else 'ai_conversations' end, coalesce(v_task, p_conversation));
        end loop;
        v_n := v_n + 1;
      end loop;
      v_notified := v_n > 0;
      perform private.page_incident(v_org, 'assistant_crisis_no_cover:' || p_conversation, 'A priority case with nobody on call',
        'A self-harm message reached the assistant while no eligible clinician was on the rota. The clinical lead and ops were alerted' ||
        case when v_n = 0 then ' (nobody matched: add or activate a chief medical officer or admin account)' else '' end || ' and a priority task is open.');
    end if;
  exception when others then
    v_failed := true;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (v_org, 'assistant.crisis_task_error', 'ai_conversations', p_conversation, jsonb_build_object('step', 'notify', 'error', sqlerrm));
    perform private.page_incident(v_org, 'assistant_crisis_follow_up_failed:' || p_conversation, 'A priority follow-up could not be completed',
      'A priority follow-up from the assistant failed; see audit_log action assistant.crisis_task_error. The emergency guidance was still shown.');
  end;

  if v_notified then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_org, null, 'assistant.on_call_paged', 'ai_conversations', p_conversation, jsonb_build_object('no_cover', v_to is null, 'task_id', v_task));
  end if;
  return jsonb_build_object('paged', v_notified and v_to is not null, 'no_cover', v_to is null, 'task_id', v_task, 'failed', v_failed);
end $$;
revoke all on function public.assistant_page_on_call(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assistant_page_on_call(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Monthly clinical review (spec 7.13)
-- ---------------------------------------------------------------------------
create table public.assistant_review_samples (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  month            date not null check (month = date_trunc('month', month)::date),
  conversation_id  uuid not null references public.ai_conversations (id) on delete cascade,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  selection        text not null check (selection in ('random', 'reported')),
  incident_id      uuid references public.ai_safety_incidents (id) on delete set null,
  state            text not null default 'pending' check (state in ('pending', 'reviewed')),
  verdict          text check (verdict in ('appropriate', 'needs_improvement', 'unsafe')),
  issue_category   text check (issue_category in ('none', 'incorrect_information', 'missed_escalation', 'dose_or_medicine_advice', 'sensitive_result', 'tone', 'other')),
  note             text,
  reviewed_by      uuid references public.profiles (id) on delete restrict,
  reviewed_at      timestamptz,
  source           text not null default 'sampler' check (source in ('sampler')),
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (month, conversation_id),
  check ((state = 'reviewed') = (verdict is not null and reviewed_by is not null and reviewed_at is not null and issue_category is not null)),
  check (verdict is distinct from 'unsafe' or length(btrim(coalesce(note, ''))) >= 10)
);
create index assistant_review_samples_state_idx on public.assistant_review_samples (state, month);
comment on table public.assistant_review_samples is
  'S52 (spec 7.13): one row per sampled or reported conversation per month. Holds ids and the reviewer''s verdict, NEVER the conversation text. The text is read only through assistant_review_read(), which demands a reason and writes an audit row (INV-10). The conversation read policy is not widened.';
alter table public.assistant_review_samples enable row level security;
create policy assistant_review_samples_reader on public.assistant_review_samples for select to authenticated
  using (private.credential_is_cmo() and organisation_id = private.caller_org());
revoke all on public.assistant_review_samples from public, anon, authenticated;
grant select on public.assistant_review_samples to authenticated;

-- No DELETE grant exists for any role, and no policy; a patient erasure still cascades (the FKs are on delete cascade), so erasure and
-- retention jobs are never blocked by a sampled conversation.
create function private.assistant_review_samples_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.state = 'reviewed' then raise exception 'a recorded review is final' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('tarragon.assistant_review_write', true), '') <> 'on' then
    raise exception 'a review is recorded only through assistant_review_record()' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger assistant_review_samples_guard before update on public.assistant_review_samples
  for each row execute function private.assistant_review_samples_guard();

-- The sampler (service role, monthly): every reported conversation plus a random sample, once per month and conversation.
create function public.assistant_sample_month(p_month date default null, p_size integer default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_month date := coalesce(date_trunc('month', p_month)::date,
                           date_trunc('month', (now() at time zone 'Africa/Lagos') - interval '1 month')::date);
  v_from timestamptz := v_month::timestamp at time zone 'Africa/Lagos';
  v_to timestamptz := (v_month + interval '1 month')::timestamp at time zone 'Africa/Lagos';
  v_size integer := coalesce(p_size, (private.assistant_cfg('review') ->> 'monthly_sample_size')::integer, 20);
  v_reported integer;
  v_random integer;
begin
  -- every reported conversation: a safety incident filed THIS month against an answer the assistant gave (whenever that answer was given,
  -- so a late report of last month's answer is not missed). Automatic flags alone are not "reported": they can still be drawn at random.
  insert into public.assistant_review_samples (organisation_id, month, conversation_id, patient_id, selection, incident_id, is_test)
  select t.organisation_id, v_month, t.conversation_id, t.patient_id, 'reported',
         (select i.id from public.ai_safety_incidents i where i.interaction_id = t.interaction_id order by i.created_at limit 1), coalesce(p.is_test, false)
    from public.ai_assistant_turns t
    join public.profiles p on p.id = t.patient_id
    join public.ai_interaction_log l on l.id = t.interaction_id
   where t.conversation_id is not null and t.interaction_id is not null
     and exists (select 1 from public.ai_safety_incidents i where i.interaction_id = t.interaction_id and i.reporter_kind = 'patient'
                    and i.created_at >= v_from and i.created_at < v_to)
  on conflict (month, conversation_id) do nothing;
  get diagnostics v_reported = row_count;

  -- the random draw is made once per month: a re-run (a retried cron) never draws a second sample
  if exists (select 1 from public.assistant_review_samples where month = v_month and selection = 'random') then
    return jsonb_build_object('month', v_month, 'reported', v_reported, 'random', 0, 'already_drawn', true);
  end if;
  insert into public.assistant_review_samples (organisation_id, month, conversation_id, patient_id, selection, is_test)
  select x.organisation_id, v_month, x.conversation_id, x.patient_id, 'random', x.is_test
    from (
      select distinct on (t.conversation_id) t.organisation_id, t.conversation_id, t.patient_id, coalesce(p.is_test, false) as is_test
        from public.ai_assistant_turns t
        join public.profiles p on p.id = t.patient_id
       where t.created_at >= v_from and t.created_at < v_to and t.conversation_id is not null and t.interaction_type = 'chat_turn'
         and not exists (select 1 from public.assistant_review_samples s where s.month = v_month and s.conversation_id = t.conversation_id)
    ) x
   order by random()
   limit greatest(v_size, 0)
  on conflict (month, conversation_id) do nothing;
  get diagnostics v_random = row_count;
  return jsonb_build_object('month', v_month, 'reported', v_reported, 'random', v_random);
end $$;
revoke all on function public.assistant_sample_month(date, integer) from public, anon, authenticated;
grant execute on function public.assistant_sample_month(date, integer) to service_role;

-- The reviewer's list: ids and states only, no text and no name.
create function public.assistant_review_queue() returns table (
  id uuid, month date, selection text, state text, verdict text, patient_ref text, turns integer, reported boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.credential_is_cmo() then raise exception 'only the Chief Medical Officer can open the monthly review' using errcode = '42501'; end if;
  return query
    select s.id, s.month, s.selection, s.state, s.verdict, left(s.patient_id::text, 8),
           (select count(*)::integer from public.ai_assistant_turns t where t.conversation_id = s.conversation_id),
           s.selection = 'reported'
      from public.assistant_review_samples s
     where s.organisation_id = private.caller_org()
     order by (s.state = 'pending') desc, s.month desc, s.created_at;
end $$;
revoke all on function public.assistant_review_queue() from public, anon;
grant execute on function public.assistant_review_queue() to authenticated;

-- The one door to the conversation text: the CMO, a reason, an audit row.
create function public.assistant_review_read(p_sample uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.assistant_review_samples%rowtype;
  v_messages jsonb;
begin
  if not private.credential_is_cmo() then raise exception 'only the Chief Medical Officer can read a sampled conversation' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'say why you are reading this conversation, in a sentence' using errcode = '22023'; end if;
  select * into s from public.assistant_review_samples where id = p_sample and organisation_id = private.caller_org();
  if not found then raise exception 'no such sample' using errcode = '22023'; end if;
  select messages into v_messages from public.ai_conversations where id = s.conversation_id;
  perform private.log_audit('assistant_review.read', 'assistant_review_samples', s.id,
    jsonb_build_object('reason', btrim(p_reason), 'conversation_id', s.conversation_id, 'month', s.month));
  return jsonb_build_object(
    'id', s.id, 'month', s.month, 'selection', s.selection, 'state', s.state, 'verdict', s.verdict, 'issue_category', s.issue_category, 'note', s.note,
    'messages', coalesce(v_messages, '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(jsonb_build_object('at', t.created_at, 'safety', t.safety_classification, 'final_action', t.final_action, 'status', t.status) order by t.created_at)
                         from public.ai_assistant_turns t where t.conversation_id = s.conversation_id), '[]'::jsonb));
end $$;
revoke all on function public.assistant_review_read(uuid, text) from public, anon;
grant execute on function public.assistant_review_read(uuid, text) to authenticated;

create function public.assistant_review_record(p_sample uuid, p_verdict text, p_category text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.assistant_review_samples%rowtype;
  v_incident uuid;
  v_interaction uuid;
  v_cat public.ai_incident_category;
begin
  if not private.credential_is_cmo() then raise exception 'only the Chief Medical Officer can record a review' using errcode = '42501'; end if;
  if p_verdict not in ('appropriate', 'needs_improvement', 'unsafe') then raise exception 'verdict must be appropriate, needs_improvement or unsafe' using errcode = '22023'; end if;
  if p_category not in ('none', 'incorrect_information', 'missed_escalation', 'dose_or_medicine_advice', 'sensitive_result', 'tone', 'other') then
    raise exception 'unknown issue category' using errcode = '22023';
  end if;
  if p_verdict = 'unsafe' and length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'an unsafe verdict needs a note saying what was wrong' using errcode = '22023'; end if;
  if p_verdict <> 'appropriate' and p_category = 'none' then raise exception 'name the issue category' using errcode = '22023'; end if;
  select * into s from public.assistant_review_samples where id = p_sample and organisation_id = private.caller_org() for update;
  if not found then raise exception 'no such sample' using errcode = '22023'; end if;
  if s.state = 'reviewed' then raise exception 'this review is already recorded' using errcode = '22023'; end if;
  -- the reviewer must have read it through the audited door first: one assistant_review.read audit row for this sample by this person
  if not exists (select 1 from public.audit_log a where a.action = 'assistant_review.read' and a.entity_id = s.id and a.actor_id = (select auth.uid())) then
    raise exception 'read the conversation first, with a reason' using errcode = '42501';
  end if;
  v_incident := s.incident_id;
  if p_verdict = 'unsafe' and v_incident is null then
    select t.interaction_id into v_interaction from public.ai_assistant_turns t
     where t.conversation_id = s.conversation_id and t.interaction_id is not null order by t.created_at desc limit 1;
    v_cat := case p_category
      when 'incorrect_information' then 'incorrect_information'::public.ai_incident_category
      when 'missed_escalation' then 'missed_escalation'::public.ai_incident_category
      when 'sensitive_result' then 'privacy_concern'::public.ai_incident_category
      when 'dose_or_medicine_advice' then 'inappropriate_recommendation'::public.ai_incident_category
      when 'tone' then 'inappropriate_recommendation'::public.ai_incident_category
      else 'other'::public.ai_incident_category end;
    v_incident := public.report_ai_safety_incident('AI-001', v_cat, 'Monthly review verdict unsafe: ' || btrim(p_note), v_interaction);
  end if;
  perform set_config('tarragon.assistant_review_write', 'on', true);
  update public.assistant_review_samples
     set state = 'reviewed', verdict = p_verdict, issue_category = p_category, note = nullif(btrim(coalesce(p_note, '')), ''),
         reviewed_by = (select auth.uid()), reviewed_at = now(), incident_id = v_incident
   where id = s.id;
  perform set_config('tarragon.assistant_review_write', 'off', true);
  perform private.log_audit('assistant_review.recorded', 'assistant_review_samples', s.id, jsonb_build_object('verdict', p_verdict, 'category', p_category, 'incident_id', v_incident));
  return jsonb_build_object('ok', true, 'incident_id', v_incident);
end $$;
revoke all on function public.assistant_review_record(uuid, text, text, text) from public, anon;
grant execute on function public.assistant_review_record(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select is_enabled from public.ai_systems where system_code = 'AI-020') is distinct from false then raise exception 'AI-020 must be registered disabled'; end if;
  if public.assistant_memory_available() then raise exception 'the memory reads as available'; end if;
  if (select count(*) from public.assistant_config where key in ('silence', 'review', 'memory', 'paging')) <> 4 then raise exception 'assistant_config keys'; end if;
  if has_function_privilege('anon', 'public.assistant_memory_for_prompt()', 'EXECUTE') then raise exception 'anon can read memory'; end if;
  if has_function_privilege('authenticated', 'public.assistant_detect_silence(timestamptz)', 'EXECUTE') then raise exception 'authenticated can run the silence job'; end if;
  if has_function_privilege('authenticated', 'public.assistant_sample_month(date, integer)', 'EXECUTE') then raise exception 'authenticated can run the sampler'; end if;
  if has_function_privilege('authenticated', 'public.assistant_page_on_call(uuid, uuid)', 'EXECUTE') then raise exception 'authenticated can page on call'; end if;
  if has_table_privilege('authenticated', 'public.assistant_review_samples', 'INSERT') then raise exception 'authenticated can insert review samples'; end if;
  if has_table_privilege('anon', 'public.assistant_memory_items', 'SELECT') then raise exception 'anon can read memory items'; end if;
end $$;
