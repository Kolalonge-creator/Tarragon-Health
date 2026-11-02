-- Front Desk M4: the chat receptionist (spec F1, F2, F3, F11, F12, F14, F17). Data side.
--
-- WHAT THIS ADDS.
--   * service_fd_chat_open / _turn / _reply / _handoff / _capture   the conversation lifecycle, every step stored (full transcripts are kept).
--   * Handoffs that reach the founder FAST: inserting a handoff fires the dispatcher immediately (pg_net), so an emergency wording alert
--     is in the inbox within seconds, not at the next 5 minute tick. The 5 minute cron remains the safety net for anything that failed.
--   * Founder replies (F12): an admin queues a reply, the dispatcher sends it, and whether the founder edited the suggestion is recorded.
--   * Model spend (F17): fd_model_usage per day and model, with a daily cap (fd_app_config.daily_model_spend_cap_usd) that the chat checks
--     before every model call; over the cap the widget falls back to a contact form.
--
-- DESIGN DECISIONS.
--   * The conversation secret never reaches the database: the web route stores only its SHA-256 and sends the hash, so a database reader cannot
--     continue anyone's conversation. Every RPC re-checks the hash.
--   * Deterministic rules (emergency wording, prompt extraction, medical-advice attempts) run in the web layer BEFORE the model; the database
--     only records the outcome. An emergency conversation is flagged red_flag_triggered and an URGENT handoff is created in the same call.
--   * Handoff creation is idempotent per conversation: a second request raises the urgency of the open one, never makes a second.
--   * Email only for alerts (FD-1): there is no SMS to the founder; urgent items are marked URGENT in the subject and arrive the moment they
--     are created.
--   * A flagged conversation (emergency, clinical request, replaced reply) is put on the transcript review queue now; the sampler and the
--     review screen are M5.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Handoffs: alert and reply delivery state
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.fd_handoffs
  add column if not exists alert_state text not null default 'pending' check (alert_state in ('pending', 'sending', 'sent', 'failed')),
  add column if not exists alert_attempts integer not null default 0,
  add column if not exists alert_sent_at timestamptz,
  add column if not exists alert_claimed_at timestamptz,
  add column if not exists reply_state text not null default 'none' check (reply_state in ('none', 'queued', 'sending', 'sent', 'failed')),
  add column if not exists reply_attempts integer not null default 0,
  add column if not exists reply_claimed_at timestamptz,
  add column if not exists reply_sent_at timestamptz,
  add column if not exists reply_message_id text;
create index if not exists fd_handoffs_alert_idx on public.fd_handoffs (created_at) where alert_state in ('pending', 'sending');
create index if not exists fd_handoffs_reply_idx on public.fd_handoffs (replied_at) where reply_state in ('queued', 'sending');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. Model usage and prices
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.fd_model_usage (
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  day             date not null,
  model           text not null check (char_length(model) between 3 and 80),
  calls           integer not null default 0,
  tokens_in       bigint not null default 0,
  tokens_out      bigint not null default 0,
  cost_usd        numeric(12, 6) not null default 0,
  primary key (organisation_id, day, model)
);
alter table public.fd_model_usage enable row level security;
create policy fd_model_usage_staff_select on public.fd_model_usage
  for select to authenticated using (private.is_admin() or (private.has_permission('leads.manage') and organisation_id = private.current_org_id()));
revoke all on public.fd_model_usage from anon;
revoke insert, update, delete, truncate on public.fd_model_usage from authenticated;

insert into public.fd_app_config (key, value, description) values
  ('model_prices_usd_per_mtok',
   '{"claude-haiku-4-5": {"in": 1, "out": 5}, "claude-sonnet-4-5": {"in": 3, "out": 15}}'::jsonb,
   'US dollars per million tokens, by model, used to estimate spend against the daily cap. A model with no price counts at the highest listed price (the cap fails safe).')
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. The conversation lifecycle (service role only)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function private.fd_hash_eq(a text, b text) returns boolean language sql immutable set search_path = '' as $$
  select a is not null and b is not null and sha256(convert_to(a, 'UTF8')) = sha256(convert_to(b, 'UTF8'))
$$;

-- Opens a conversation and records the opening disclosure as the first assistant message, so every transcript shows that the visitor was told
-- they were talking to an AI assistant (spec guardrail 7).
create function public.service_fd_chat_open(p_secret_hash text, p_page text, p_intro text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid secret hash'; end if;
  insert into public.fd_conversations (secret_hash, page_path) values (p_secret_hash, left(p_page, 300)) returning id into v_id;
  insert into public.fd_messages (conversation_id, role, content) values (v_id, 'assistant', left(p_intro, 6000));
  return v_id;
end $$;

-- One visitor turn: verifies the hash, enforces the per-session message cap, stores the message, returns the recent history.
create function public.service_fd_chat_turn(p_conv uuid, p_secret_hash text, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_cap int := private.fd_cfg_int('session_message_cap', 30); v_history jsonb;
begin
  if p_text is null or btrim(p_text) = '' or char_length(p_text) > 2000 then return jsonb_build_object('ok', false, 'reason', 'invalid_message'); end if;
  select * into c from public.fd_conversations where id = p_conv for update;
  if not found or not private.fd_hash_eq(c.secret_hash, p_secret_hash) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.status = 'closed' then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if c.visitor_message_count >= v_cap then return jsonb_build_object('ok', false, 'reason', 'message_cap'); end if;
  insert into public.fd_messages (conversation_id, role, content) values (p_conv, 'visitor', btrim(p_text));
  update public.fd_conversations
     set visitor_message_count = visitor_message_count + 1, first_visitor_message_at = coalesce(first_visitor_message_at, now()), last_message_at = now()
   where id = p_conv;
  select coalesce(jsonb_agg(jsonb_build_object('role', role, 'content', content) order by created_at), '[]'::jsonb) into v_history
    from (select role, content, created_at from public.fd_messages where conversation_id = p_conv and role in ('visitor', 'assistant', 'founder')
           order by created_at desc limit 12) q;
  return jsonb_build_object('ok', true, 'status', c.status, 'count', c.visitor_message_count + 1, 'history', v_history);
end $$;

-- An assistant reply (or a rule's fixed reply). Sets the first-response time once and queues flagged conversations for transcript review.
create function public.service_fd_chat_reply(
  p_conv uuid, p_text text, p_model text, p_tokens_in integer, p_tokens_out integer, p_flags text[], p_interaction uuid, p_answered_by text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_first timestamptz;
begin
  if p_answered_by not in ('model', 'rules', 'fallback') then raise exception 'bad answered_by'; end if;
  insert into public.fd_messages (conversation_id, role, content, model, tokens_in, tokens_out, safety_flags, ai_interaction_id)
  values (p_conv, 'assistant', left(p_text, 6000), p_model, p_tokens_in, p_tokens_out, coalesce(p_flags, '{}'), p_interaction);
  update public.fd_conversations
     set first_reply_at = coalesce(first_reply_at, now()),
         first_response_ms = coalesce(first_response_ms, greatest(0, (extract(epoch from (now() - first_visitor_message_at)) * 1000)::integer)),
         last_message_at = now()
   where id = p_conv returning first_visitor_message_at into v_first;
  if cardinality(coalesce(p_flags, '{}')) > 0 then
    insert into public.fd_review_queue (conversation_id, reason) values (p_conv, 'flagged') on conflict (conversation_id) do nothing;
  end if;
end $$;

-- A handoff to a person. Idempotent per conversation: a second request raises the urgency of the open handoff and never makes another.
create function public.service_fd_chat_handoff(p_conv uuid, p_reason text, p_urgency text, p_summary text, p_suggested_reply text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; h record; v_id uuid; v_created boolean := false;
begin
  select * into c from public.fd_conversations where id = p_conv for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into h from public.fd_handoffs where conversation_id = p_conv and status = 'open' order by created_at limit 1;
  if found then
    v_id := h.id;
    if p_urgency = 'urgent' and h.urgency <> 'urgent' then
      -- an escalation to urgent must alert again
      update public.fd_handoffs set urgency = 'urgent', reason = case when p_reason = 'emergency' then 'emergency' else reason end,
             alert_state = 'pending', alert_attempts = 0, summary = coalesce(left(p_summary, 2000), summary) where id = v_id;
    end if;
  else
    insert into public.fd_handoffs (conversation_id, contact_id, urgency, reason, summary, suggested_reply)
    values (p_conv, c.contact_id, p_urgency, p_reason, left(p_summary, 2000), left(p_suggested_reply, 4000)) returning id into v_id;
    v_created := true;
  end if;
  update public.fd_conversations
     set status = case when p_reason = 'emergency' or status = 'emergency' then 'emergency' else 'handed_off' end,
         red_flag_triggered = red_flag_triggered or p_reason = 'emergency',
         resolution_type = case when p_reason = 'emergency' or status = 'emergency' then 'emergency' else 'handed_off' end,
         summary = coalesce(left(p_summary, 2000), summary), last_message_at = now()
   where id = p_conv;
  if p_reason in ('emergency', 'clinical_request') then
    insert into public.fd_review_queue (conversation_id, reason) values (p_conv, 'flagged') on conflict (conversation_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'handoff_id', v_id, 'created', v_created);
end $$;

-- The visitor leaves contact details (after the consent tick): one contact, consent recorded, CRM and follow-up queued (M3), linked here.
create function public.service_fd_chat_capture(
  p_conv uuid, p_secret_hash text, p_name text, p_email text, p_phone text, p_consent boolean, p_wording text, p_wording_version text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; r jsonb; v_msgs text;
begin
  select * into c from public.fd_conversations where id = p_conv;
  if not found or not private.fd_hash_eq(c.secret_hash, p_secret_hash) then return jsonb_build_object('captured', false, 'reason', 'not_found'); end if;
  -- The CRM note carries what the visitor themselves wrote (up to their last three messages), never anything the assistant said.
  select coalesce(string_agg(content, E'\n' order by created_at), '') into v_msgs
    from (select content, created_at from public.fd_messages where conversation_id = p_conv and role = 'visitor' order by created_at desc limit 3) q;
  r := public.service_fd_capture_lead(p_email, p_phone, p_name, 'chat', v_msgs, p_consent, p_wording, p_wording_version);
  if (r ->> 'captured')::boolean then
    update public.fd_conversations set contact_id = (r ->> 'contact_id')::uuid where id = p_conv;
    update public.fd_handoffs set contact_id = (r ->> 'contact_id')::uuid where conversation_id = p_conv and contact_id is null;
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. Spend (F17)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.service_fd_usage_add(p_model text, p_tokens_in integer, p_tokens_out integer) returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_prices jsonb := private.fd_cfg('model_prices_usd_per_mtok'); v_p jsonb; v_in numeric; v_out numeric; v_cost numeric;
begin
  v_p := v_prices -> p_model;
  -- An unpriced model counts at the highest listed price, so a misconfigured model can only make the cap trip sooner, never later.
  v_in := coalesce((v_p ->> 'in')::numeric, (select max((e.value ->> 'in')::numeric) from jsonb_each(coalesce(v_prices, '{}'::jsonb)) e), 15);
  v_out := coalesce((v_p ->> 'out')::numeric, (select max((e.value ->> 'out')::numeric) from jsonb_each(coalesce(v_prices, '{}'::jsonb)) e), 75);
  v_cost := (coalesce(p_tokens_in, 0) * v_in + coalesce(p_tokens_out, 0) * v_out) / 1000000.0;
  insert into public.fd_model_usage (day, model, calls, tokens_in, tokens_out, cost_usd)
  values ((now() at time zone 'UTC')::date, p_model, 1, coalesce(p_tokens_in, 0), coalesce(p_tokens_out, 0), v_cost)
  on conflict (organisation_id, day, model) do update
    set calls = fd_model_usage.calls + 1, tokens_in = fd_model_usage.tokens_in + excluded.tokens_in,
        tokens_out = fd_model_usage.tokens_out + excluded.tokens_out, cost_usd = fd_model_usage.cost_usd + excluded.cost_usd;
  return v_cost;
end $$;

create function public.service_fd_spend_today() returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(cost_usd), 0) from public.fd_model_usage
   where organisation_id = '00000000-0000-0000-0000-000000000001' and day = (now() at time zone 'UTC')::date
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Alerts and founder replies (delivered by the dispatcher Edge Function)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.service_fd_claim_alerts(p_limit integer default 10)
returns table (handoff_id uuid, urgency text, reason text, summary text, suggested_reply text, conversation_id uuid, contact_name text, contact_email text, contact_phone text,
               transcript jsonb, attempts integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare r record;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then p_limit := 10; end if;
  update public.fd_handoffs set alert_state = 'failed' where alert_state = 'sending' and alert_claimed_at < now() - interval '10 minutes' and alert_attempts >= 5;
  for r in
    select h.id as hid, h.urgency as urg, h.reason as rsn, h.summary as sm, h.suggested_reply as sr, h.conversation_id as cid, h.alert_attempts as tries,
           c.name as cn, c.email as ce, c.phone as cp
      from public.fd_handoffs h left join public.fd_contacts c on c.id = h.contact_id
     where (h.alert_state = 'pending' or (h.alert_state = 'sending' and h.alert_claimed_at < now() - interval '10 minutes' and h.alert_attempts < 5))
     -- urgent first, then oldest
     order by (h.urgency = 'urgent') desc, h.created_at
     limit p_limit
       for update of h skip locked
  loop
    update public.fd_handoffs set alert_state = 'sending', alert_attempts = alert_attempts + 1, alert_claimed_at = now() where id = r.hid;
    handoff_id := r.hid; urgency := r.urg; reason := r.rsn; summary := r.sm; suggested_reply := r.sr; conversation_id := r.cid;
    contact_name := r.cn; contact_email := r.ce; contact_phone := r.cp; attempts := r.tries + 1;
    select coalesce(jsonb_agg(jsonb_build_object('role', m.role, 'content', left(m.content, 600)) order by m.created_at), '[]'::jsonb) into transcript
      from (select role, content, created_at from public.fd_messages where conversation_id = r.cid order by created_at desc limit 8) m;
    return next;
  end loop;
end $$;

create function public.service_fd_finish_alert(p_handoff uuid, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.fd_handoffs
     set alert_state = case when p_ok then 'sent' when alert_attempts >= 5 then 'failed' else 'pending' end,
         alert_sent_at = case when p_ok then now() else alert_sent_at end
   where id = p_handoff and alert_state = 'sending';
  if not p_ok then perform private.fd_audit('alert_failed', 'fd_handoffs', p_handoff::text, jsonb_build_object('error', left(coalesce(p_error, 'unknown'), 200)), 'system'); end if;
end $$;

-- Staff queue a reply to a handoff. It goes to the visitor's email (the original channel for a web visitor who left one). Whether the founder
-- changed the suggested wording is recorded, so good edits can later be promoted into the knowledge base.
create function public.fd_handoff_queue_reply(p_handoff uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare h record; c record; v_edited boolean;
begin
  perform private.fd_require_staff();
  if p_text is null or btrim(p_text) = '' or char_length(p_text) > 4000 then raise exception 'reply must be 1 to 4000 characters'; end if;
  select * into h from public.fd_handoffs where id = p_handoff for update;
  if not found then raise exception 'unknown handoff'; end if;
  if h.reply_state in ('queued', 'sending', 'sent') then raise exception 'a reply is already on its way'; end if;
  select * into c from public.fd_contacts where id = h.contact_id;
  if not found or c.email is null then raise exception 'this visitor left no email address, so there is nowhere to send a reply'; end if;
  if c.suppressed then raise exception 'this person asked not to be contacted'; end if;
  v_edited := h.suggested_reply is distinct from btrim(p_text);
  update public.fd_handoffs
     set founder_reply = btrim(p_text), reply_edited = v_edited, status = 'replied', replied_at = now(), reply_state = 'queued', reply_attempts = 0
   where id = p_handoff;
  insert into public.fd_messages (conversation_id, role, content) select conversation_id, 'founder', btrim(p_text) from public.fd_handoffs where id = p_handoff and conversation_id is not null;
  perform private.fd_audit('handoff_reply_queued', 'fd_handoffs', p_handoff::text, jsonb_build_object('edited', v_edited));
  perform private.fd_kick_dispatcher();
end $$;

create function public.fd_handoff_close(p_handoff uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.fd_require_staff();
  update public.fd_handoffs set status = 'closed' where id = p_handoff and status in ('open', 'replied');
  if not found then raise exception 'unknown or already closed handoff'; end if;
end $$;

create function public.service_fd_claim_replies(p_limit integer default 10)
returns table (handoff_id uuid, contact_id uuid, email text, first_name text, reply text, attempts integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare r record;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then p_limit := 10; end if;
  update public.fd_handoffs set reply_state = 'failed' where reply_state = 'sending' and reply_claimed_at < now() - interval '10 minutes' and reply_attempts >= 5;
  for r in
    select h.id as hid, c.id as cid, c.email as em, c.name as nm, h.founder_reply as fr, h.reply_attempts as tries, c.suppressed as supp
      from public.fd_handoffs h join public.fd_contacts c on c.id = h.contact_id
     where h.reply_state = 'queued' or (h.reply_state = 'sending' and h.reply_claimed_at < now() - interval '10 minutes' and h.reply_attempts < 5)
     order by h.replied_at limit p_limit for update of h skip locked
  loop
    if r.supp or r.em is null then
      update public.fd_handoffs set reply_state = 'failed' where id = r.hid;
      continue;
    end if;
    update public.fd_handoffs set reply_state = 'sending', reply_attempts = reply_attempts + 1, reply_claimed_at = now() where id = r.hid;
    handoff_id := r.hid; contact_id := r.cid; email := r.em; first_name := split_part(coalesce(r.nm, ''), ' ', 1); reply := r.fr; attempts := r.tries + 1;
    return next;
  end loop;
end $$;

create function public.service_fd_finish_reply(p_handoff uuid, p_ok boolean, p_message_id text, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.fd_handoffs
     set reply_state = case when p_ok then 'sent' when reply_attempts >= 5 then 'failed' else 'queued' end,
         reply_sent_at = case when p_ok then now() else reply_sent_at end,
         reply_message_id = case when p_ok then p_message_id else reply_message_id end
   where id = p_handoff and reply_state = 'sending';
  if p_ok then
    update public.fd_contacts set last_contacted_at = now() where id = (select contact_id from public.fd_handoffs where id = p_handoff);
  else
    perform private.fd_audit('reply_failed', 'fd_handoffs', p_handoff::text, jsonb_build_object('error', left(coalesce(p_error, 'unknown'), 200)), 'system');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. Reach the founder within seconds: a new handoff (or queued reply) fires the dispatcher at once
-- ---------------------------------------------------------------------------------------------------------------------------------
create function private.fd_kick_dispatcher() returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_key text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'edge_function_publishable_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'fd_followup_secret';
  if v_url is null or v_key is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/fd-followup-dispatcher',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'x-fd-followup-secret', v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds := 20000);
exception when others then
  -- Never let a failure to nudge the dispatcher break creating the handoff; the 5 minute schedule is the safety net.
  raise warning 'fd: could not kick the dispatcher: %', sqlerrm;
end $$;

create function private.fd_on_handoff_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.fd_kick_dispatcher();
  return new;
end $$;
create trigger fd_handoff_created after insert on public.fd_handoffs for each row execute function private.fd_on_handoff_created();

-- An urgent escalation of an existing handoff re-alerts too.
create function private.fd_on_handoff_escalated() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.urgency = 'urgent' and old.urgency <> 'urgent' then perform private.fd_kick_dispatcher(); end if;
  return new;
end $$;
create trigger fd_handoff_escalated after update of urgency on public.fd_handoffs for each row execute function private.fd_on_handoff_escalated();

-- The 5 minute schedule now also runs when an alert or a reply is waiting, even with follow-ups off (same name replaces the M2 job).
select cron.schedule(
  'fd-dispatch',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/fd-followup-dispatcher',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'x-fd-followup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fd_followup_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 55000
  ) as request_id
  where exists (select 1 from vault.decrypted_secrets where name = 'fd_followup_secret')
    and (private.fd_cfg('followups_enabled') = 'true'::jsonb
         or exists (select 1 from public.fd_handoffs where alert_state in ('pending', 'sending') or reply_state in ('queued', 'sending')));
  $$
);

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. Inbox for the console
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.fd_inbox() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fd_require_staff();
  return coalesce((select jsonb_agg(to_jsonb(q) order by q.rank, q.created_at desc) from (
    select h.id, h.status, h.urgency, h.reason, h.summary, h.suggested_reply, h.founder_reply, h.reply_state, h.alert_state, h.created_at,
           (case when h.status = 'open' and h.urgency = 'urgent' then 0 when h.status = 'open' then 1 else 2 end) as rank,
           c.name as contact_name, c.email as contact_email, c.phone as contact_phone, (c.email is not null and not c.suppressed) as can_reply,
           coalesce((select jsonb_agg(jsonb_build_object('role', m.role, 'content', m.content, 'at', m.created_at, 'flags', m.safety_flags) order by m.created_at)
                       from (select role, content, created_at, safety_flags from public.fd_messages where conversation_id = h.conversation_id order by created_at desc limit 20) m), '[]'::jsonb) as transcript
      from public.fd_handoffs h left join public.fd_contacts c on c.id = h.contact_id
     order by (case when h.status = 'open' and h.urgency = 'urgent' then 0 when h.status = 'open' then 1 else 2 end), h.created_at desc limit 100) q), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. Grants and self-check
-- ---------------------------------------------------------------------------------------------------------------------------------
revoke all on function private.fd_hash_eq(text, text) from public, anon, authenticated;
revoke all on function private.fd_kick_dispatcher() from public, anon, authenticated;
revoke all on function private.fd_on_handoff_created() from public, anon, authenticated;
revoke all on function private.fd_on_handoff_escalated() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.service_fd_chat_open(text, text, text)', 'public.service_fd_chat_turn(uuid, text, text)',
    'public.service_fd_chat_reply(uuid, text, text, integer, integer, text[], uuid, text)', 'public.service_fd_chat_handoff(uuid, text, text, text, text)',
    'public.service_fd_chat_capture(uuid, text, text, text, text, boolean, text, text)', 'public.service_fd_usage_add(text, integer, integer)',
    'public.service_fd_spend_today()', 'public.service_fd_claim_alerts(integer)', 'public.service_fd_finish_alert(uuid, boolean, text)',
    'public.service_fd_claim_replies(integer)', 'public.service_fd_finish_reply(uuid, boolean, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.fd_handoff_queue_reply(uuid, text)', 'public.fd_handoff_close(uuid)', 'public.fd_inbox()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  if has_function_privilege('anon', 'public.service_fd_chat_turn(uuid, text, text)', 'EXECUTE') or has_function_privilege('authenticated', 'public.service_fd_chat_turn(uuid, text, text)', 'EXECUTE') then
    raise exception 'fd M4: the chat turn function is callable by a non service role';
  end if;
  if has_table_privilege('anon', 'public.fd_model_usage', 'SELECT') then raise exception 'fd M4: anon can read usage'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'fd_handoff_created') then raise exception 'fd M4: the handoff trigger is missing'; end if;
end $$;
