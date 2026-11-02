-- Front Desk M1: foundations (Tarragon Front Desk Build Specification v1.0, sections 5, 7, 9, 10, 15).
--
-- WHAT THIS IS. The data side of an AI front desk and follow-up system for Tarragon's own enquiries, lead capture, sign-up recovery and
-- reporting. M1 is schema only: tables, RLS, config flags, an append-only audit log, the admin RPCs, and DRAFT seeds. No email is sent and
-- no model is called by anything in this migration. M2 (follow-up engine) onward adds the functions that use these tables.
--
-- DECISIONS THAT SHAPE IT (each recorded 2026-11-01 unless noted):
--   * EMAIL ONLY. The spec's SMS steps are built as email. CLAUDE.md reserves SMS for phone verification codes (OQ-05) and the Termii sender
--     ID is not approved. fd_consents.channel therefore has no 'sms'; adding it later is a CHECK change, not a redesign.
--   * ENGLISH ONLY (founder, 2026-10-07: "we don't have Pidgin again"). The language column exists (spec) but is constrained to 'en'.
--   * Every table carries organisation_id defaulting to Tarragon Health Direct (spec section 15), and RLS is organisation-scoped for staff
--     holding the leads.manage permission. A platform admin sees all organisations, as everywhere else on this platform.
--   * Nothing is writable by anon or authenticated. Writers are the service role (server routes and functions) and the SECURITY DEFINER
--     admin RPCs below, which check private.is_admin() / leads.manage and audit themselves.
--   * WORDING IS DATA WITH A HUMAN GATE. Sequence steps and knowledge entries are seeded as DRAFT. Nothing sends and the assistant states
--     nothing until a person approves that exact text, and editing approved text puts it back to draft (triggers, proved in
--     packages/db/tests/fd_m1_front_desk_foundations.sql). "Claude drafts, you approve once, then it runs."
--   * PRICES ARE NEVER TYPED INTO KNOWLEDGE. Knowledge text may contain {{membership_price}}, {{paid_product_name}}, {{refund_days}} and
--     {{launch_date}}; the server substitutes them at read time from the same versioned config the pricing page uses, so the assistant
--     cannot state a stale price (and the F3 output filter can allow exactly the live value).
--   * The receptionist is registered as AI-023, DISABLED, not runtime governed, with no evaluation or approval seeded (those are human
--     judgements). While it is off the chat degrades to a contact form.
--   * Lawful basis is recorded per purpose in fd_consents (NDPA). Account-setup reminders to someone who has an account are
--     'service_followup' (basis: contract); sequences that are marketing in nature need an explicit 'marketing' consent row.
--
-- Counts before this migration: it only adds new tables and one AI registry row; no existing row is changed.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Config and kill switch
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.fd_app_config (
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  key             text not null check (key ~ '^[a-z0-9_]{3,60}$'),
  value           jsonb not null,
  description     text not null,
  updated_by      uuid references public.profiles (id) on delete restrict,
  updated_at      timestamptz not null default now(),
  primary key (organisation_id, key)
);
comment on table public.fd_app_config is
  'Front desk flags and tunables: kill switch (assistant_enabled), prelaunch mode, models, spend cap, quiet hours, send caps. Changed only through fd_set_config, which audits.';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. Append-only audit log
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.fd_audit_log (
  id              bigint generated always as identity primary key,
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  at              timestamptz not null default now(),
  actor_id        uuid,
  actor_kind      text not null check (actor_kind in ('system', 'admin', 'assistant', 'webhook')),
  action          text not null check (char_length(action) between 2 and 80),
  entity          text not null,
  entity_id       text,
  detail          jsonb not null default '{}'::jsonb
);
create index fd_audit_log_at_idx on public.fd_audit_log (at desc);
create index fd_audit_log_entity_idx on public.fd_audit_log (entity, entity_id);

create function private.fd_audit_log_is_append_only() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'fd_audit_log is append only' using errcode = '55000';
end $$;
create trigger fd_audit_log_no_update_delete before update or delete on public.fd_audit_log
  for each row execute function private.fd_audit_log_is_append_only();
create trigger fd_audit_log_no_truncate before truncate on public.fd_audit_log
  for each statement execute function private.fd_audit_log_is_append_only();

-- One helper every function uses to write an audit row.
create function private.fd_audit(p_action text, p_entity text, p_entity_id text, p_detail jsonb default '{}'::jsonb, p_kind text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.fd_audit_log (actor_id, actor_kind, action, entity, entity_id, detail)
  values (auth.uid(), coalesce(p_kind, case when auth.uid() is null then 'system' else 'admin' end), p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb));
end $$;

-- Generic row trigger for tables whose changes must leave a trace (config, steps, knowledge). Long text is left out of the detail.
create function private.fd_audit_row() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb := to_jsonb(new) - 'body_text' - 'content';
begin
  perform private.fd_audit(lower(tg_op), tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'key'), v_row);
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. Contacts and consent
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.fd_contacts (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  email              text check (email is null or (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(email) <= 200)),
  phone              text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  name               text check (name is null or char_length(name) <= 120),
  language           text not null default 'en' check (language = 'en'),
  source             text not null default 'unknown' check (source in ('website_form', 'chat', 'app_signup', 'import', 'unknown')),
  hubspot_contact_id text,
  app_user_id        uuid references public.profiles (id) on delete set null,
  lifecycle_stage    text not null default 'enquiry' check (lifecycle_stage in ('enquiry', 'signed_up', 'onboarded', 'risk_checked', 'paying', 'lapsed', 'closed')),
  last_contacted_at  timestamptz,
  suppressed         boolean not null default false,
  suppressed_reason  text check (suppressed_reason in ('unsubscribed', 'stop_request', 'bounced', 'complained', 'deletion_request', 'manual')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (email is not null or phone is not null),
  check (suppressed = (suppressed_reason is not null))
);
create unique index fd_contacts_email_uq on public.fd_contacts (organisation_id, email) where email is not null;
create unique index fd_contacts_phone_uq on public.fd_contacts (organisation_id, phone) where phone is not null;
create unique index fd_contacts_app_user_uq on public.fd_contacts (organisation_id, app_user_id) where app_user_id is not null;
create index fd_contacts_hubspot_idx on public.fd_contacts (hubspot_contact_id) where hubspot_contact_id is not null;

create table public.fd_consents (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  contact_id      uuid not null references public.fd_contacts (id) on delete cascade,
  channel         text not null check (channel in ('email', 'chat')),
  purpose         text not null check (purpose in ('service_followup', 'marketing', 'chat_capture')),
  lawful_basis    text not null check (lawful_basis in ('consent', 'contract', 'legitimate_interest')),
  granted_at      timestamptz not null default now(),
  evidence_hash   text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  wording_version text not null check (char_length(wording_version) between 1 and 40),
  source          text not null check (char_length(source) between 2 and 80),
  withdrawn_at    timestamptz,
  check (withdrawn_at is null or withdrawn_at >= granted_at)
);
-- One live (not withdrawn) consent per contact, channel and purpose.
create unique index fd_consents_live_uq on public.fd_consents (contact_id, channel, purpose) where withdrawn_at is null;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. Conversations, messages, handoffs, review queue
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.fd_conversations (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  contact_id               uuid references public.fd_contacts (id) on delete set null,
  channel                  text not null default 'web' check (channel in ('web')),
  secret_hash              text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  status                   text not null default 'open' check (status in ('open', 'handed_off', 'emergency', 'closed')),
  language                 text not null default 'en' check (language = 'en'),
  resolution_type          text check (resolution_type in ('ai_resolved', 'handed_off', 'emergency', 'abandoned')),
  first_response_ms        integer check (first_response_ms is null or first_response_ms >= 0),
  summary                  text check (summary is null or char_length(summary) <= 2000),
  intent                   text check (intent is null or char_length(intent) <= 80),
  red_flag_triggered       boolean not null default false,
  page_path                text check (page_path is null or char_length(page_path) <= 300),
  visitor_message_count    integer not null default 0,
  first_visitor_message_at timestamptz,
  first_reply_at           timestamptz,
  started_at               timestamptz not null default now(),
  last_message_at          timestamptz not null default now(),
  check (status <> 'emergency' or red_flag_triggered)
);
create index fd_conversations_started_idx on public.fd_conversations (started_at desc);
create index fd_conversations_contact_idx on public.fd_conversations (contact_id) where contact_id is not null;
create index fd_conversations_status_idx on public.fd_conversations (status, started_at desc);

create table public.fd_messages (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  conversation_id uuid not null references public.fd_conversations (id) on delete cascade,
  role            text not null check (role in ('visitor', 'assistant', 'system', 'founder')),
  content         text not null check (char_length(content) between 1 and 6000),
  model           text,
  tokens_in       integer check (tokens_in is null or tokens_in >= 0),
  tokens_out      integer check (tokens_out is null or tokens_out >= 0),
  safety_flags    text[] not null default '{}',
  ai_interaction_id uuid,
  created_at      timestamptz not null default now()
);
create index fd_messages_conversation_idx on public.fd_messages (conversation_id, created_at);
create index fd_messages_flagged_idx on public.fd_messages (created_at desc) where cardinality(safety_flags) > 0;

create table public.fd_handoffs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  conversation_id uuid references public.fd_conversations (id) on delete set null,
  contact_id      uuid references public.fd_contacts (id) on delete set null,
  urgency         text not null default 'normal' check (urgency in ('normal', 'urgent')),
  reason          text not null check (reason in ('visitor_asked', 'cannot_answer', 'ai_unavailable', 'clinical_request', 'emergency', 'complaint', 'form_fallback')),
  status          text not null default 'open' check (status in ('open', 'replied', 'closed')),
  summary         text check (summary is null or char_length(summary) <= 2000),
  suggested_reply text check (suggested_reply is null or char_length(suggested_reply) <= 4000),
  founder_reply   text check (founder_reply is null or char_length(founder_reply) <= 4000),
  reply_edited    boolean not null default false,
  notified_at     timestamptz,
  replied_at      timestamptz,
  created_at      timestamptz not null default now(),
  check ((status = 'replied') = (founder_reply is not null and replied_at is not null) or status = 'closed')
);
create index fd_handoffs_open_idx on public.fd_handoffs (urgency, created_at desc) where status = 'open';

create table public.fd_review_queue (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  conversation_id uuid not null references public.fd_conversations (id) on delete cascade,
  reason          text not null check (reason in ('flagged', 'random_sample', 'handoff', 'pilot_full_review')),
  status          text not null default 'pending' check (status in ('pending', 'reviewed')),
  verdict         text check (verdict in ('ok', 'wrong', 'unsafe')),
  reviewer_id     uuid references public.profiles (id) on delete restrict,
  note            text check (note is null or char_length(note) <= 1000),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (conversation_id),
  check ((status = 'reviewed') = (verdict is not null and reviewer_id is not null and reviewed_at is not null)),
  check (verdict is null or verdict = 'ok' or note is not null)
);

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Knowledge (the only source of facts the assistant may state)
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.fd_knowledge (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  topic           text not null check (topic ~ '^[a-z0-9_]{3,60}$'),
  language        text not null default 'en' check (language = 'en'),
  content         text not null check (char_length(content) between 20 and 4000),
  version         integer not null check (version >= 1),
  approved_by     uuid references public.profiles (id) on delete restrict,
  approved_at     timestamptz,
  active          boolean not null default false,
  created_by      uuid references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  unique (organisation_id, topic, language, version),
  check (not active or (approved_by is not null and approved_at is not null)),
  -- Only these placeholders exist; the server fills them from live config.
  check (content !~ '\{\{(?!(membership_price|paid_product_name|refund_days|launch_date)\}\})')
);
create unique index fd_knowledge_one_active on public.fd_knowledge (organisation_id, topic, language) where active;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. Funnel events, sequences, steps, follow-up runs
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.fd_funnel_events (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  contact_id      uuid references public.fd_contacts (id) on delete cascade,
  app_user_id     uuid references public.profiles (id) on delete set null,
  event_type      text not null check (event_type in ('account_created', 'onboarding_started', 'onboarding_step', 'onboarding_completed',
                                                       'risk_check_done', 'pricing_viewed', 'checkout_started', 'paid', 'app_active')),
  step            text check (step is null or char_length(step) <= 60),
  occurred_at     timestamptz not null default now(),
  props           jsonb not null default '{}'::jsonb,
  dedupe_key      text not null check (char_length(dedupe_key) between 3 and 200),
  unique (organisation_id, dedupe_key),
  check (contact_id is not null or app_user_id is not null)
);
create index fd_funnel_events_contact_idx on public.fd_funnel_events (contact_id, occurred_at desc);
create index fd_funnel_events_type_idx on public.fd_funnel_events (event_type, occurred_at desc);

create table public.fd_sequences (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  key             text not null check (key ~ '^[a-z0-9_]{3,40}$'),
  name            text not null,
  purpose         text not null check (purpose in ('service_followup', 'marketing')),
  trigger_event   text not null check (trigger_event in ('account_created', 'onboarding_stalled', 'onboarding_completed', 'inactive_7d',
                                                         'enquiry_captured', 'health_check_interest')),
  stop_events     text[] not null default '{}',
  -- Must be real funnel event types; a typo would silently never stop a sequence.
  constraint fd_sequences_stop_events_valid check (stop_events <@ array['account_created', 'onboarding_started', 'onboarding_step', 'onboarding_completed',
                                                   'risk_check_done', 'pricing_viewed', 'checkout_started', 'paid', 'app_active']::text[]),
  active          boolean not null default true,
  paused          boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (organisation_id, key)
);

create table public.fd_sequence_steps (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  sequence_id     uuid not null references public.fd_sequences (id) on delete cascade,
  position        integer not null check (position between 1 and 10),
  step_key        text not null check (step_key ~ '^[a-z0-9_]{3,60}$'),
  delay_minutes   integer not null check (delay_minutes between 0 and 60 * 24 * 60),
  subject         text not null check (char_length(subject) between 3 and 150),
  body_text       text not null check (char_length(body_text) between 20 and 4000),
  status          text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by     uuid references public.profiles (id) on delete restrict,
  approved_at     timestamptz,
  updated_at      timestamptz not null default now(),
  unique (sequence_id, position),
  unique (organisation_id, step_key),
  check ((status = 'approved') = (approved_by is not null and approved_at is not null)),
  -- Only these placeholders exist; anything else would reach the recipient as literal braces.
  check (subject !~ '\{\{' and body_text !~ '\{\{(?!(first_name|link)\}\})')
);

create table public.fd_followup_runs (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  contact_id          uuid not null references public.fd_contacts (id) on delete cascade,
  sequence_id         uuid not null references public.fd_sequences (id) on delete restrict,
  step_id             uuid not null references public.fd_sequence_steps (id) on delete restrict,
  enrolment_key       text not null check (char_length(enrolment_key) between 3 and 200),
  state               text not null default 'scheduled' check (state in ('scheduled', 'sending', 'sent', 'skipped', 'failed', 'cancelled')),
  scheduled_for       timestamptz not null,
  sent_at             timestamptz,
  skip_reason         text check (skip_reason in ('no_consent', 'suppressed', 'quiet_hours', 'weekly_cap', 'goal_reached', 'step_unapproved',
                                                  'sequence_paused', 'kill_switch', 'no_email', 'opted_out', 'stale', 'dry_run')),
  provider_message_id text,
  attempts            integer not null default 0,
  dry_run             boolean not null default false,
  error               text,
  created_at          timestamptz not null default now(),
  unique (contact_id, step_id, enrolment_key),
  check (state <> 'skipped' or skip_reason is not null)
);
create index fd_followup_runs_due_idx on public.fd_followup_runs (scheduled_for) where state = 'scheduled';
create index fd_followup_runs_contact_sent_idx on public.fd_followup_runs (contact_id, sent_at) where state = 'sent';

create table public.fd_report_runs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  week_start      date not null,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  metrics         jsonb not null default '{}'::jsonb,
  narrative       text,
  recipient       text,
  drive_file_id   text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (organisation_id, week_start)
);

-- Edit-resets-approval triggers (sequence steps and knowledge are versioned/approved wording).
create function private.fd_step_reset_approval() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.subject, new.body_text) is distinct from (old.subject, old.body_text) then
    new.status := 'draft'; new.approved_by := null; new.approved_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger fd_sequence_steps_reset_approval before update on public.fd_sequence_steps
  for each row execute function private.fd_step_reset_approval();

-- Knowledge text is immutable once written; a change is a NEW version (so approved wording can never be edited in place).
create function private.fd_knowledge_immutable_text() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.content, new.topic, new.language, new.version) is distinct from (old.content, old.topic, old.language, old.version) then
    raise exception 'fd_knowledge text is immutable; save a new version' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger fd_knowledge_immutable before update on public.fd_knowledge
  for each row execute function private.fd_knowledge_immutable_text();

create trigger fd_app_config_audit after insert or update on public.fd_app_config for each row execute function private.fd_audit_row();
create trigger fd_sequence_steps_audit after insert or update on public.fd_sequence_steps for each row execute function private.fd_audit_row();
create trigger fd_sequences_audit after update on public.fd_sequences for each row execute function private.fd_audit_row();
create trigger fd_knowledge_audit after insert or update on public.fd_knowledge for each row execute function private.fd_audit_row();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. RLS: staff read, nobody writes except the service role and the RPCs below
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fd_app_config','fd_audit_log','fd_contacts','fd_consents','fd_conversations','fd_messages','fd_handoffs',
                           'fd_review_queue','fd_knowledge','fd_funnel_events','fd_sequences','fd_sequence_steps','fd_followup_runs','fd_report_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (
        private.is_admin() or (private.has_permission('leads.manage') and organisation_id = private.current_org_id()))$p$, t || '_staff_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. Admin RPCs (the only human write paths)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function private.fd_require_staff() returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (private.is_admin() or private.has_permission('leads.manage')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;

-- Approving wording and switching sends on are the founder's calls: admin only, never a delegated leads.manage holder.
create function private.fd_require_admin() returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
end $$;

-- Validates a config value against what the code that reads it expects, so a bad value is refused here, not found at send time.
create function private.fd_validate_config(p_key text, p_value jsonb) returns void language plpgsql immutable set search_path = '' as $$
declare v_num numeric;
begin
  if p_key in ('assistant_enabled', 'prelaunch_mode', 'followups_enabled', 'followups_dry_run') then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception '% must be true or false', p_key; end if;
  elsif p_key in ('weekly_send_cap', 'stall_minutes', 'inactive_days', 'session_message_cap', 'transcript_retention_days') then
    if jsonb_typeof(p_value) <> 'number' then raise exception '% must be a whole number', p_key; end if;
    v_num := (p_value #>> '{}')::numeric;
    if v_num < 1 or v_num <> trunc(v_num) or v_num > 100000 then raise exception '% must be a whole number from 1 to 100000', p_key; end if;
  elsif p_key = 'daily_model_spend_cap_usd' then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric <= 0 or (p_value #>> '{}')::numeric > 100000 then
      raise exception 'daily_model_spend_cap_usd must be a positive number'; end if;
  elsif p_key = 'launch_date' then
    if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'launch_date must be YYYY-MM-DD'; end if;
  elsif p_key = 'quiet_hours' then
    if jsonb_typeof(p_value) <> 'object' or coalesce(p_value ->> 'start', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
       or coalesce(p_value ->> 'end', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' or coalesce(p_value ->> 'timezone', '') = '' then
      raise exception 'quiet_hours needs start and end as HH:MM and a timezone'; end if;
  elsif p_key in ('model_fast', 'model_strong', 'sender_name', 'reply_to') then
    if jsonb_typeof(p_value) <> 'string' or btrim(p_value #>> '{}') = '' then raise exception '% must be non-empty text', p_key; end if;
  end if;
end $$;

create function public.fd_set_config(p_key text, p_value jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.fd_require_staff();
  -- The kill switch must stay reachable: a delegated staff member may switch the assistant OFF, nothing else.
  if not private.is_admin() and not (p_key = 'assistant_enabled' and p_value = 'false'::jsonb) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  perform private.fd_validate_config(p_key, p_value);
  update public.fd_app_config set value = p_value, updated_by = auth.uid(), updated_at = now()
   where organisation_id = '00000000-0000-0000-0000-000000000001' and key = p_key;
  if not found then raise exception 'unknown config key %', p_key; end if;
end $$;

create function public.fd_save_sequence_step(p_step_id uuid, p_subject text, p_body_text text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fd_require_staff();
  update public.fd_sequence_steps set subject = btrim(p_subject), body_text = btrim(p_body_text) where id = p_step_id;
  if not found then raise exception 'unknown step'; end if;
end $$;

create function public.fd_approve_sequence_step(p_step_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.fd_require_admin();
  update public.fd_sequence_steps set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_step_id;
  if not found then raise exception 'unknown step'; end if;
end $$;

create function public.fd_set_sequence_paused(p_key text, p_paused boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.fd_require_staff();
  update public.fd_sequences set paused = p_paused where organisation_id = '00000000-0000-0000-0000-000000000001' and key = p_key;
  if not found then raise exception 'unknown sequence %', p_key; end if;
end $$;

create function public.fd_save_knowledge(p_topic text, p_content text) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_version int;
begin
  perform private.fd_require_staff();
  select coalesce(max(version), 0) + 1 into v_version from public.fd_knowledge
   where organisation_id = '00000000-0000-0000-0000-000000000001' and topic = p_topic and language = 'en';
  insert into public.fd_knowledge (topic, content, version, created_by) values (p_topic, btrim(p_content), v_version, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.fd_approve_knowledge(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  perform private.fd_require_admin();
  select * into v from public.fd_knowledge where id = p_id;
  if not found then raise exception 'unknown knowledge entry'; end if;
  -- Deactivate the previous active version first (one active per topic is a unique index).
  update public.fd_knowledge set active = false
   where organisation_id = v.organisation_id and topic = v.topic and language = v.language and active and id <> p_id;
  update public.fd_knowledge set active = true, approved_by = auth.uid(), approved_at = now() where id = p_id;
end $$;

-- Grants: PUBLIC is where anon inherits execute, so revoke from public, then grant to authenticated (the function re-checks staff).
revoke all on function private.fd_audit(text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function private.fd_audit_row() from public, anon, authenticated;
revoke all on function private.fd_require_staff() from public, anon, authenticated;
revoke all on function private.fd_require_admin() from public, anon, authenticated;
revoke all on function private.fd_validate_config(text, jsonb) from public, anon, authenticated;
revoke all on function private.fd_step_reset_approval() from public, anon, authenticated;
revoke all on function private.fd_knowledge_immutable_text() from public, anon, authenticated;
revoke all on function private.fd_audit_log_is_append_only() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.fd_set_config(text, jsonb)','public.fd_save_sequence_step(uuid, text, text)','public.fd_approve_sequence_step(uuid)',
                           'public.fd_set_sequence_paused(text, boolean)','public.fd_save_knowledge(text, text)','public.fd_approve_knowledge(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. Seeds. EVERYTHING IS DRAFT. Copy is plain, warm, English, free of any condition, reading, result or medicine word (patient email is
--    linted for those), no em dashes. {{first_name}} falls back to "there"; {{link}} is the step's destination. The unsubscribe line is
--    appended by code to every send. No price is typed anywhere.
-- ---------------------------------------------------------------------------------------------------------------------------------
insert into public.fd_app_config (key, value, description) values
  ('assistant_enabled',        'true'::jsonb,  'Kill switch. False turns the chat assistant off and the widget shows a contact form. Also honoured: ai_systems AI-023 is_enabled.'),
  ('prelaunch_mode',           'true'::jsonb,  'Until launch the assistant says the platform opens on launch_date and offers a waitlist instead of selling.'),
  ('launch_date',              '"2026-12-31"'::jsonb, 'Public launch date the assistant may state (ISO date).'),
  ('followups_enabled',        'false'::jsonb, 'Master switch for follow-up emails. Off until the founder has approved the sequences and turned on dry-run off.'),
  ('followups_dry_run',        'true'::jsonb,  'When true the dispatcher records what it WOULD send (state skipped, reason dry_run) and sends nothing.'),
  ('quiet_hours',              '{"start":"21:00","end":"07:00","timezone":"Africa/Lagos"}'::jsonb, 'No follow-up is sent inside this window.'),
  ('weekly_send_cap',          '3'::jsonb,     'Maximum follow-up messages per contact in any rolling 7 days.'),
  ('stall_minutes',            '60'::jsonb,    'Minutes without onboarding progress before a sign-up counts as stalled.'),
  ('inactive_days',            '7'::jsonb,     'Days after sign-up or last activity before a contact counts as inactive.'),
  ('model_fast',               '"claude-haiku-4-5"'::jsonb, 'Model for routing and short answers.'),
  ('model_strong',             '"claude-sonnet-4-5"'::jsonb, 'Model for handoff summaries and report narrative.'),
  ('daily_model_spend_cap_usd','5'::jsonb,     'When the day''s model spend reaches this the widget falls back to a form and the founder is alerted.'),
  ('session_message_cap',      '30'::jsonb,    'Visitor messages allowed in one chat session.'),
  ('transcript_retention_days','365'::jsonb,   'Raw transcripts are summarised and deleted after this many days.'),
  ('sender_name',              '"TarragonHealth"'::jsonb, 'Display name on follow-up email (brand data, not code).'),
  ('reply_to',                 '"admin@tarragonhealth.ng"'::jsonb, 'A monitored inbox so replies never dead-end.')
on conflict do nothing;

with seq(key, name, purpose, trigger_event, stop_events) as (values
  ('welcome',              'Welcome',               'service_followup', 'account_created',       array['paid']),
  ('finish_signup',        'Finish sign-up',        'service_followup', 'onboarding_stalled',    array['onboarding_completed']),
  ('risk_check_nudge',     'Risk check reminder',   'service_followup', 'onboarding_completed',  array['risk_check_done']),
  ('reengage_7d',          'Re-engage after 7 days','marketing',        'inactive_7d',           array['app_active']),
  ('post_enquiry',         'After an enquiry',      'service_followup', 'enquiry_captured',      array['account_created', 'paid']),
  ('health_check_interest','Yearly health check',   'marketing',        'health_check_interest', array['checkout_started', 'paid'])
)
insert into public.fd_sequences (key, name, purpose, trigger_event, stop_events)
select key, name, purpose, trigger_event, stop_events from seq on conflict do nothing;

insert into public.fd_sequence_steps (sequence_id, position, step_key, delay_minutes, subject, body_text)
select s.id, v.position, v.step_key, v.delay_minutes, v.subject, v.body_text
from (values
  ('welcome', 1, 'welcome_1', 0, 'Welcome to TarragonHealth',
   E'Hello {{first_name}},\n\nWelcome to TarragonHealth. Your account is ready, and your records, your care team and your reminders all live in one place.\n\nA good first step is to open the app and look around: {{link}}\n\nIf you have a question, reply to this email and a real person will answer.\n\nThe TarragonHealth team'),
  ('welcome', 2, 'welcome_2', 2880, 'Your next step: the short risk check',
   E'Hello {{first_name}},\n\nWhen you have a few minutes, take the short risk check. It helps your care team understand where to start with you, and it is private.\n\nStart it here: {{link}}\n\nThe TarragonHealth team'),
  ('welcome', 3, 'welcome_3', 8640, 'How Membership works',
   E'Hello {{first_name}},\n\nThe app is free to start. Membership is the year-long option that adds a monthly video call with your care team and written questions between calls.\n\nYou can see exactly what is included, and the current price, here: {{link}}\n\nQuestions are always welcome: just reply.\n\nThe TarragonHealth team'),
  ('finish_signup', 1, 'finish_signup_1', 60, 'Your TarragonHealth account is nearly ready',
   E'Hello {{first_name}},\n\nYou started setting up your TarragonHealth account but did not get to the end. It only takes a few minutes to finish, and your answers so far are saved.\n\nPick up where you left off: {{link}}\n\nIf something was unclear, reply to this email and we will help.\n\nThe TarragonHealth team'),
  ('finish_signup', 2, 'finish_signup_2', 1440, 'A quick nudge to finish setting up',
   E'Hello {{first_name}},\n\nYour account is still waiting to be finished. Setup is quick, and you can stop and come back at any time.\n\nContinue here: {{link}}\n\nThe TarragonHealth team'),
  ('finish_signup', 3, 'finish_signup_3', 4320, 'Can we help you finish setting up?',
   E'Hello {{first_name}},\n\nWe noticed your account is still not finished. If something got in the way, tell us by replying to this email. It goes straight to a real person, not a no-reply box.\n\nOr continue here whenever you are ready: {{link}}\n\nThe TarragonHealth team'),
  ('risk_check_nudge', 1, 'risk_check_1', 1440, 'One quick step to get the most from your account',
   E'Hello {{first_name}},\n\nYour account is set up. The next step is the short risk check. It takes only a few minutes and helps your care team know where to start.\n\nTake the check: {{link}}\n\nThe TarragonHealth team'),
  ('risk_check_nudge', 2, 'risk_check_2', 5760, 'Your risk check is still waiting for you',
   E'Hello {{first_name}},\n\nA gentle reminder that your risk check has not been completed. It is short, private and works well on a phone.\n\nComplete it here: {{link}}\n\nIf you have a question about it, reply to this email.\n\nThe TarragonHealth team'),
  ('reengage_7d', 1, 'reengage_1', 0, 'We have not seen you in a while',
   E'Hello {{first_name}},\n\nIt has been a week since you last opened TarragonHealth. Your records and your care team are right where you left them.\n\nWhenever you are ready: {{link}}\n\nIf there is anything that would make the app more useful to you, reply and tell us.\n\nThe TarragonHealth team'),
  ('reengage_7d', 2, 'reengage_2', 10080, 'Still here when you need us',
   E'Hello {{first_name}},\n\nJust a short note to say we are still here. You can pick things up exactly where you left off: {{link}}\n\nThis is the last reminder we will send. If you would rather not hear from us, the link below stops all of these emails.\n\nThe TarragonHealth team'),
  ('post_enquiry', 1, 'post_enquiry_1', 0, 'Thanks for getting in touch with TarragonHealth',
   E'Hello {{first_name}},\n\nThank you for contacting TarragonHealth. We have your message and a member of our team will reply personally.\n\nWhile you wait, you can see how the app works. It is free to start, and you only pay when you choose a service that involves a doctor''s time: {{link}}\n\nIf you would rather talk it through, just reply to this email.\n\nThe TarragonHealth team'),
  ('post_enquiry', 2, 'post_enquiry_2', 4320, 'Can we answer anything else?',
   E'Hello {{first_name}},\n\nA few days ago you got in touch with TarragonHealth. We wanted to check that your questions were answered.\n\nIf not, reply to this email and a real person will pick it up. You can also look around the app here: {{link}}\n\nThe TarragonHealth team'),
  ('post_enquiry', 3, 'post_enquiry_3', 14400, 'Still thinking it over?',
   E'Hello {{first_name}},\n\nIt has been a little while since you contacted us. If you are ready, creating an account takes a few minutes: {{link}}\n\nIf now is not the right time, that is completely fine. This is the last email we will send about your enquiry.\n\nThe TarragonHealth team'),
  ('health_check_interest', 1, 'health_check_1', 0, 'About the yearly health check',
   E'Hello {{first_name}},\n\nYou asked about the yearly health check. In short, it is a once-a-year check-in that helps you and your care team see where you stand.\n\nEverything about what it includes and how to book is here: {{link}}\n\nQuestions? Reply to this email.\n\nThe TarragonHealth team'),
  ('health_check_interest', 2, 'health_check_2', 5760, 'Would a conversation help?',
   E'Hello {{first_name}},\n\nIf you are still weighing up the yearly health check, we are glad to talk it through. Reply to this email and we will arrange a time that suits you.\n\nOr read more here: {{link}}\n\nThe TarragonHealth team')
) as v(seq_key, position, step_key, delay_minutes, subject, body_text)
join public.fd_sequences s on s.key = v.seq_key and s.organisation_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

-- Knowledge drafts. Facts only from what the repo itself states today (catalogue strings, CLAUDE.md, the pricing page). A person must read
-- and approve each one before the assistant may use it. Prices and dates are placeholders filled from live config at read time.
insert into public.fd_knowledge (topic, content, version) values
('what_is_tarragon',
 E'TarragonHealth is a Nigerian digital health service. It brings a person''s health records, check-ups, reminders and access to doctors together in one app, so care stays with them. TarragonHealth does not run clinics. Care is delivered by a team of registered doctors working together, not by one named doctor.', 1),
('how_the_app_works',
 E'Everything starts in the app or on the web. A person creates an account, answers a short set of setup questions, and can then keep their records in one place, log readings, and book services. The app is free to start. A person pays only for a doctor''s time or for a paid service they choose. Reminders arrive in the app, by push notification and by email, but nothing ever depends on a message arriving.', 1),
('how_to_join',
 E'To join, create an account on the website or in the app. Setup takes a few minutes and can be paused and finished later. After setup there is a short risk check, and a person then decides which services they want.', 1),
('membership',
 E'{{paid_product_name}} is a year of care with your care team, on your phone. It includes a video call with the care team every month (12 in the year), written questions to the care team between calls, and prescriptions that the care team signs, for you to take to any pharmacy. Medicines are not included: you take your prescription to any pharmacy and pay there. The price is {{membership_price}} naira for the year. You can ask for a refund within {{refund_days}} days of buying it. Membership Plus also includes a yearly blood test; plain Membership does not. For anything about renewal, point the person to the pricing page, which always shows the current terms.', 1),
('free_tier',
 E'The app is free to start. Tracking, reminders, the screening calendar, the education library, lifestyle and activity tools, the AI Coach and the quarterly report are free. A person pays only for a doctor''s time or a paid service they choose.', 1),
('annual_health_check',
 E'The yearly health check is a once-a-year check-in that helps a person and their care team see where they stand. Details of what is included and how to book are on the website and in the app.', 1),
('device_guidance',
 E'TarragonHealth does not sell blood pressure monitors or glucose meters. A person can buy their own from any local pharmacy or retailer and type the readings into the app by hand.', 1),
('launch',
 E'The TarragonHealth platform opens to the public on {{launch_date}}. Until then a person can join the waitlist and will be told as soon as it opens.', 1),
('what_we_do_not_do',
 E'The assistant cannot diagnose, prescribe, give a dose, interpret test results or give advice about an individual''s own health. TarragonHealth does not provide emergency treatment and does not run its own clinics. For anything about a person''s own health, a doctor call is the right route.', 1),
('contact_details',
 E'People can email hello@tarragonhealth.ng or support@tarragonhealth.ng, or reply to any email from TarragonHealth. A real person reads every reply.', 1),
('emergencies',
 E'TarragonHealth does not provide emergency treatment. In an emergency, go to the nearest hospital right away.', 1)
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 10. AI registry: the receptionist is AI-023, DISABLED, with no evaluation, approval or knowledge-source row seeded.
-- ---------------------------------------------------------------------------------------------------------------------------------
insert into public.ai_systems (
  system_code, name, purpose, owner_role, risk_class, autonomy_level, clinically_meaningful,
  lifecycle_status, is_enabled, runtime_governed, fallback_behaviour, code_reference
) values (
  'AI-023', 'Website Receptionist',
  'Answers a website visitor''s questions about the service (what it is, how the app works, how to join, what Membership costs) using only approved '
  || 'fd_knowledge entries filled from live config. It gives no diagnosis, prescribing or individual clinical advice and points to a doctor call. '
  || 'Red-flag wording is handled by fixed rules BEFORE the model is reached, and its replies are checked by fixed rules AFTER. When it cannot answer '
  || 'it hands the conversation to a person with a short summary. Every message is stored.',
  'Chief Medical Officer', 'moderate', 'assist', false, 'draft', false, false,
  'The widget shows a contact form (name, email, message) and the team is alerted. Nothing else is promised.',
  'apps/web/src/lib/frontdesk/receptionist.ts'
) on conflict (system_code) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 11. Self-check
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  if (select count(*) from public.fd_sequences) < 6 then raise exception 'fd M1: sequences were not seeded'; end if;
  if (select count(*) from public.fd_sequence_steps) < 15 then raise exception 'fd M1: sequence steps were not seeded'; end if;
  if exists (select 1 from public.fd_sequence_steps where status <> 'draft') then raise exception 'fd M1: every seeded step must be draft'; end if;
  if exists (select 1 from public.fd_knowledge where active or approved_by is not null) then raise exception 'fd M1: every seeded knowledge entry must be unapproved'; end if;
  if (select value from public.fd_app_config where key = 'followups_enabled') <> 'false'::jsonb then raise exception 'fd M1: follow-ups must start off'; end if;
  if (select value from public.fd_app_config where key = 'followups_dry_run') <> 'true'::jsonb then raise exception 'fd M1: follow-ups must start in dry-run'; end if;
  if not exists (select 1 from public.ai_systems where system_code = 'AI-023' and is_enabled = false and runtime_governed = false and lifecycle_status = 'draft') then
    raise exception 'fd M1: AI-023 must be registered, disabled and not runtime governed';
  end if;
  if exists (select 1 from public.ai_evaluation_runs r join public.ai_systems s on s.id = r.ai_system_id where s.system_code = 'AI-023') then
    raise exception 'fd M1: no evaluation run may be seeded for AI-023';
  end if;
  foreach t in array array['fd_app_config','fd_audit_log','fd_contacts','fd_consents','fd_conversations','fd_messages','fd_handoffs','fd_review_queue',
                           'fd_knowledge','fd_funnel_events','fd_sequences','fd_sequence_steps','fd_followup_runs','fd_report_runs'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'fd M1: RLS is off on %', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then raise exception 'fd M1: anon can read %', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then raise exception 'fd M1: authenticated can write %', t; end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'organisation_id') then
      raise exception 'fd M1: % has no organisation_id', t;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.fd_approve_sequence_step(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.fd_set_config(text, jsonb)', 'EXECUTE') then
    raise exception 'fd M1: anon can run an admin RPC';
  end if;
end $$;
