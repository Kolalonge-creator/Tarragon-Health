-- S51: AI health assistant, conversation, explanations and hand-offs (spec B.7, functions 7.1 to 7.7).
-- INV-01, INV-04, INV-07, INV-14, INV-16. Design: docs/design/S51.md.
--
-- D1 (founder, 2026-10-07): map onto LIVE tables. The spec names assistant_conversations / assistant_messages / knowledge_items are NOT created:
-- ai_conversations, ai_assistant_turns, health_education_content and lpe_content_blocks are the live equivalents. This migration adds only:
--   1. assistant_config           versioned DB-side copy of PROPOSED assistant settings (mirrored by packages/shared proposed-config key assistant.go_live)
--   2. the assistant_enabled go-live guard (INV-14), switched by the CMO, born OFF, and its three conditions
--   3. lpe_content_blocks.content_version / review_due_at, so every retrievable row carries owner, version and review date
--   4. assistant_knowledge_sources(uuid[]), the one reader of that metadata (owner name is staff attribution, read through a definer function)
--   5. assistant_protocol_limits(), the approved protocol's LIMITS only (never its step table, so the assistant cannot propose a step)
--   6. event types assistant.message, assistant.red_flag_detected, assistant.handoff
--   7. two generic notification templates (INV-07): assistant_daily_nudge, assistant_weekly_reflection
--
-- Live counts checked read-only 2026-10-07: ai_conversations 1, ai_assistant_turns 1, health_education_content 249 (6 reviewed and active, 0 with a
-- review date), lpe_content_blocks 58 (all marked reviewed). So retrievable rows today: 0 until the CMO sets review dates, which is why the guard
-- condition "approved knowledge rows" is honestly unmet and the guard cannot be switched on yet. Nothing is seeded as approved.

-- ---------------------------------------------------------------------------
-- 1. assistant_config
-- ---------------------------------------------------------------------------
create table public.assistant_config (
  key            text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value          jsonb not null,
  config_version integer not null default 1 check (config_version >= 1),
  created_at     timestamptz not null default now()
);
comment on table public.assistant_config is
  'S51: PROPOSED assistant settings read by database functions. The code-side home is packages/shared proposed-config (key assistant.go_live); a Jest test pins the two. Read only through security definer functions.';

-- assistant-config-begin
insert into public.assistant_config (key, value, config_version) values
  ('go_live', $json${"min_approved_kb_rows": 20}$json$::jsonb, 1);
-- assistant-config-end

alter table public.assistant_config enable row level security;
revoke all on public.assistant_config from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. KB metadata on lpe_content_blocks (health_education_content already has version, reviewer and review dates)
-- ---------------------------------------------------------------------------
alter table public.lpe_content_blocks add column if not exists content_version integer not null default 1 check (content_version >= 1);
alter table public.lpe_content_blocks add column if not exists review_due_at timestamptz;
comment on column public.lpe_content_blocks.review_due_at is
  'S51: when this block is next due for clinical review. A block with no date, or past it, is not retrievable by the assistant (assistant_knowledge_sources).';

-- ---------------------------------------------------------------------------
-- 4. The reader of source metadata. Definer, because the owner is a staff member's name and a patient cannot read staff profiles.
-- ---------------------------------------------------------------------------
create or replace function public.assistant_knowledge_sources(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.j), '[]'::jsonb) from (
    select jsonb_build_object(
             'id', h.id, 'source_table', 'health_education_content', 'title', h.title,
             'owner', nullif(btrim(coalesce(h.reviewed_by_name, h.clinical_author_name, h.author_name)), ''),
             'version', coalesce(h.content_version, h.version, 1),
             'review_due_at', coalesce(h.review_due_at, h.next_review_due::timestamptz),
             'retrievable', coalesce(h.clinician_reviewed and h.is_active
                            and nullif(btrim(coalesce(h.reviewed_by_name, h.clinical_author_name, h.author_name)), '') is not null
                            and coalesce(h.review_due_at, h.next_review_due::timestamptz) > now(), false)) as j
      from public.health_education_content h where h.id = any (p_ids) and h.is_active
    union all
    select jsonb_build_object(
             'id', b.id, 'source_table', 'lpe_content_blocks', 'title', b.title,
             'owner', nullif(btrim(p.full_name), ''),
             'version', b.content_version,
             'review_due_at', b.review_due_at,
             'retrievable', coalesce(b.clinician_reviewed and nullif(btrim(p.full_name), '') is not null and b.review_due_at > now(), false)) as j
      from public.lpe_content_blocks b left join public.profiles p on p.id = b.reviewed_by where b.id = any (p_ids) and b.clinician_reviewed
  ) x
$$;
revoke all on function public.assistant_knowledge_sources(uuid[]) from public, anon;
grant execute on function public.assistant_knowledge_sources(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Protocol limits only. The step table (the part that proposes a change) is never returned.
-- protocols is a platform-wide table (it has no organisation_id: a pathway protocol belongs to the platform, not to a tenant), and
-- `params` holds plausibility ranges and windows, not doses or steps, so any signed-in person may read them. Only the approved row.
-- ---------------------------------------------------------------------------
create or replace function public.assistant_protocol_limits()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'version', p.version, 'limits', p.definition -> 'params')), '[]'::jsonb)
    from public.protocols p where p.status = 'approved' and (select auth.uid()) is not null
$$;
revoke all on function public.assistant_protocol_limits() from public, anon;
grant execute on function public.assistant_protocol_limits() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The assistant_enabled guard and its conditions
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('assistant_enabled', 'AI health assistant', 'The AI health assistant (chat, quick actions, nudges)',
   'Approved knowledge base rows above the configured minimum; red-flag evaluation run passed and reviewed; Chief Medical Officer sign-off', 'cmo',
   array['runCoachTurn (web and mobile message route)', 'mobile ai-coach quick-action route', 'hasCoachAccess (assistant screens are not offered while closed)'],
   'The mobile hand-off route ("I want to speak to someone") stays open on purpose: contact with the care team never waits for an AI guard.')
on conflict (key) do nothing;

create or replace function private.go_live_conditions_assistant(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_min integer := coalesce((select (value ->> 'min_approved_kb_rows')::integer from public.assistant_config where key = 'go_live'), 20);
  v_kb integer;
  v_runs integer;
begin
  select count(*) into v_kb from (
    select 1 from public.health_education_content h
     where h.clinician_reviewed and h.is_active
       and nullif(btrim(coalesce(h.reviewed_by_name, h.clinical_author_name, h.author_name)), '') is not null
       and coalesce(h.review_due_at, h.next_review_due::timestamptz) > now()
    union all
    select 1 from public.lpe_content_blocks b join public.profiles p on p.id = b.reviewed_by
     where b.clinician_reviewed and nullif(btrim(p.full_name), '') is not null and b.review_due_at > now()
  ) k;
  -- a reviewed, passing safety or red-team run for AI-001: a person looked at the result (reviewed_by), it is not only a green job
  select count(*) into v_runs
    from public.ai_evaluation_runs r
    join public.ai_systems s on s.id = r.ai_system_id
    join public.ai_evaluation_suites su on su.id = r.suite_id
   where s.system_code = 'AI-001' and su.kind in ('safety', 'red_team')
     and r.outcome = 'pass' and r.completed_at is not null and r.reviewed_by is not null;
  return jsonb_build_array(
    private.go_live_cond('approved_kb_rows', 'Approved knowledge base rows (reviewed, owned, with a future review date) at or above the minimum',
      v_kb >= v_min, 'data', v_kb || ' of ' || v_min || ' needed'),
    private.go_live_cond('red_flag_tests_passing', 'A reviewed, passing red-flag safety evaluation run exists for the assistant',
      v_runs > 0, 'data', v_runs || ' reviewed passing run(s)'),
    private.go_live_cond('clinical_lead_signoff', 'Clinical lead sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
end $$;
revoke all on function private.go_live_conditions_assistant(uuid) from public, anon, authenticated;

-- Add one branch to the LIVE body of go_live_conditions rather than replacing the whole function: that function is extended by many sessions
-- (live already carries a clinical_safety_case_current condition this branch's files do not), so a full CREATE OR REPLACE would silently undo
-- someone else's condition. The body is read, patched and re-created in place; the DO block asserts the patch took.
do $$
declare
  v_def text := pg_get_functiondef('private.go_live_conditions(text,uuid)'::regprocedure);
  v_patched text;
begin
  if v_def not like '%assistant_enabled%' then
    v_patched := regexp_replace(v_def, '(\nbegin\n)', E'\\1  if p_key = ''assistant_enabled'' then return private.go_live_conditions_assistant(p_org); end if;\n', 'n');
    if v_patched = v_def or v_patched not like '%assistant_enabled%' then
      raise exception 'could not add the assistant_enabled branch to private.go_live_conditions';
    end if;
    execute v_patched;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Events (type and version are data). Payloads carry ids and codes, never text of a message.
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('assistant.message', 'The assistant answered a message (ids and tier only, never the text)', 'S51', false),
  ('assistant.red_flag_detected', 'The deterministic red-flag screen fired on an assistant message. Informational: the escalation itself is raised by the existing emergency path, so this event is not urgent and wakes no worker', 'S51', false),
  ('assistant.handoff', 'The assistant handed the patient to the symptom checker or the care team', 'S51', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('assistant.message', 1, array['conversation_id', 'tier']),
  ('assistant.red_flag_detected', 1, array['conversation_id', 'trigger']),
  ('assistant.handoff', 1, array['conversation_id', 'target'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Generic notification templates (INV-07: nothing names a condition, reading, result or medicine; in-app and push only)
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('assistant_daily_nudge', 'operational', 'routine', 'patient', array['in_app', 'push']::public.notification_channel[], 'scheduled', 'One daily check-in. Names nothing about the patient.'),
  ('assistant_weekly_reflection', 'operational', 'routine', 'patient', array['in_app', 'push']::public.notification_channel[], 'scheduled', 'One weekly look back. Names nothing about the patient.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('assistant_daily_nudge', 'en', 'in_app', 'Your daily check-in', 'Your check-in for today is ready. Open the app when you have a minute.'),
  ('assistant_daily_nudge', 'en', 'push', 'Your daily check-in', 'Your check-in for today is ready.'),
  ('assistant_weekly_reflection', 'en', 'in_app', 'Your week in a minute', 'Your look back at this week is ready. Open the app to read it.'),
  ('assistant_weekly_reflection', 'en', 'push', 'Your week in a minute', 'Your look back at this week is ready.')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 8. Queueing a nudge: once per patient, template and Lagos day (a unique index, so an overlapping run cannot double-send), and not for
--    a patient who has switched every wellness channel off. Service role only.
-- ---------------------------------------------------------------------------
create unique index notifications_assistant_once_per_day on public.notifications (recipient_id, template, (payload ->> 'day'))
  where template in ('assistant_daily_nudge', 'assistant_weekly_reflection', 'assistant_reengage');

create function public.assistant_queue_nudge(p_patient uuid, p_template text, p_day date) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_n integer;
begin
  if p_template not in ('assistant_daily_nudge', 'assistant_weekly_reflection', 'assistant_reengage') then
    raise exception 'not an assistant template: %', p_template using errcode = '22023';
  end if;
  select organisation_id into v_org from public.profiles where id = p_patient and role = 'patient' and is_active;
  if v_org is null then return false; end if;
  if exists (select 1 from public.patient_notification_preferences pr
              where pr.patient_id = p_patient and pr.category = 'education_wellness' and not (pr.email_enabled or pr.sms_enabled or pr.push_enabled)) then
    return false;
  end if;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (v_org, p_patient, 'in_app', 'pending', p_template, jsonb_build_object('day', p_day::text))
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.assistant_queue_nudge(uuid, text, date) from public, anon, authenticated;
grant execute on function public.assistant_queue_nudge(uuid, text, date) to service_role;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select is_on from public.go_live_guards where key = 'assistant_enabled') is distinct from false then raise exception 'assistant_enabled must be born off'; end if;
  if private.go_live_guard_on('assistant_enabled') then raise exception 'assistant_enabled reads as open'; end if;
  if jsonb_array_length(private.go_live_conditions('assistant_enabled', null)) <> 3 then raise exception 'assistant_enabled conditions not wired'; end if;
  if jsonb_array_length(private.go_live_conditions('clinical_operations_enabled', null)) < 4 then raise exception 'the existing guard conditions were damaged'; end if;
  if has_function_privilege('anon', 'public.assistant_knowledge_sources(uuid[])', 'EXECUTE') then raise exception 'anon can read knowledge sources'; end if;
  if has_function_privilege('anon', 'public.assistant_protocol_limits()', 'EXECUTE') then raise exception 'anon can read protocol limits'; end if;
  if has_function_privilege('authenticated', 'public.assistant_queue_nudge(uuid, text, date)', 'EXECUTE') then raise exception 'authenticated can queue nudges'; end if;
  if has_table_privilege('authenticated', 'public.assistant_config', 'SELECT') then raise exception 'assistant_config is readable by authenticated'; end if;
  if (select count(*) from public.event_types where event_type like 'assistant.%') <> 3 then raise exception 'assistant event types'; end if;
end $$;
