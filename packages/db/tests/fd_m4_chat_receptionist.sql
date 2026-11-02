-- ===========================================================================
-- Proof: Front Desk M4 chat receptionist, data side (migration 20261102005200_fd_m4_chat_receptionist.sql).
-- Spec acceptance checks served here: "handoff reaches you within 1 minute" (a handoff is alertable at once, urgent first, and re-alerts on
-- escalation) and the transcript / first-response / spend records the rest of M4 relies on.
--
--   1. OPEN: the disclosure is stored as the first assistant message; a malformed secret hash is refused.
--   2. TURN: the wrong hash is "not found" (a conversation cannot be continued without its secret); empty or over-long text is refused; the
--      per-session cap holds; a closed conversation takes no more messages; history is returned oldest first.
--   3. REPLY: the first-response time is set once; a flagged reply puts the conversation on the review queue and an unflagged one does not.
--   4. HANDOFF: one open handoff per conversation (a second request does not make another); an escalation to urgent re-alerts; an emergency
--      sets the conversation status and red flag and stays an emergency.
--   5. CAPTURE: the wrong hash captures nothing; no consent captures nothing; with consent the contact is linked to the conversation and the CRM
--      note carries only what the VISITOR wrote.
--   6. SPEND: cost uses the configured price; an unpriced model counts at the highest price (fails safe); today's spend sums.
--   7. ALERTS: urgent first; claimed rows go to 'sending'; a failure retries, then gives up after 5; the transcript is included.
--   8. REPLIES: only staff queue a reply; no email or a suppressed contact is refused; whether the founder edited the suggestion is recorded; a
--      second queue is refused; the reply is claimed once and recorded.
--   9. ACCESS: nobody but the service role runs the chat or delivery functions; the inbox is staff only.
--  10. SABOTAGE (each MUST flip): chat turn granted to authenticated; the hash comparison made always true; the alert claim granted to authenticated.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. Fails loudly and prints a verdict table.
-- ===========================================================================
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.as_val(p_uid uuid, p_role text, p_sql text) returns text language plpgsql as
$f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
                                                else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR:' || sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end $f$;

create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v from fx where k = p_k $$;
create function pg_temp.h(p_secret text) returns text language sql as $$ select encode(sha256(convert_to(p_secret, 'UTF8')), 'hex') $$;
create function pg_temp.opened(p_secret text) returns uuid language sql as $$ select public.service_fd_chat_open(pg_temp.h(p_secret), '/pricing', 'I am an AI assistant.') $$;

do $$
declare v_admin uuid := gen_random_uuid(); v_pat uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'fd4-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_admin, v_pat]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone, created_at) values
    (v_admin, '00000000-0000-0000-0000-000000000001', 'admin',   'FD4 Admin',   '+2348058885701', now() - interval '90 days'),
    (v_pat,   '00000000-0000-0000-0000-000000000001', 'patient', 'FD4 Patient', '+2348058885702', now() - interval '90 days')
  on conflict (id) do update set role = excluded.role;
  insert into fx values ('admin', v_admin), ('pat', v_pat);
  update public.fd_app_config set value = '30'::jsonb where key = 'session_message_cap';
end $$;

-- 1. open ---------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.opened('secret-one') ;
create temp table cv(k text primary key, id uuid) on commit drop;
grant all on cv to public;
insert into cv select 'one', id from public.fd_conversations where secret_hash = pg_temp.h('secret-one');
select pg_temp.rec('open', 'the conversation is open', 'open', (select status from public.fd_conversations where id = (select id from cv where k = 'one')));
select pg_temp.rec('open', 'the AI disclosure is the first message, from the assistant', 'assistant/I am an AI assistant.',
  (select role || '/' || content from public.fd_messages where conversation_id = (select id from cv where k = 'one') order by created_at limit 1));
select pg_temp.rec('open', 'a malformed secret hash is refused', 'ERR:P0001',
  pg_temp.as_val(null, 'service_role', $q$select public.service_fd_chat_open('not-a-hash', '/x', 'hi')::text$q$));

-- 2. turn ---------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('turn', 'the wrong secret is "not found"', 'not_found',
  (public.service_fd_chat_turn((select id from cv where k = 'one'), pg_temp.h('wrong'), 'hello') ->> 'reason'));
select pg_temp.rec('turn', 'an unknown conversation is "not found"', 'not_found',
  (public.service_fd_chat_turn(gen_random_uuid(), pg_temp.h('secret-one'), 'hello') ->> 'reason'));
select pg_temp.rec('turn', 'empty text is refused', 'invalid_message', (public.service_fd_chat_turn((select id from cv where k = 'one'), pg_temp.h('secret-one'), '   ') ->> 'reason'));
select pg_temp.rec('turn', 'over-long text is refused', 'invalid_message', (public.service_fd_chat_turn((select id from cv where k = 'one'), pg_temp.h('secret-one'), repeat('x', 2001)) ->> 'reason'));
create temp table t1(j jsonb) on commit drop;
grant all on t1 to public;
insert into t1 select public.service_fd_chat_turn((select id from cv where k = 'one'), pg_temp.h('secret-one'), 'How much is membership?');
select pg_temp.rec('turn', 'a good turn is ok, counted, with history oldest first', 'true/1/assistant',
  (select (j ->> 'ok') || '/' || (j ->> 'count') || '/' || (j -> 'history' -> 0 ->> 'role') from t1));
select pg_temp.rec('turn', 'the history ends with the visitor message', 'visitor/How much is membership?',
  (select (j -> 'history' -> -1 ->> 'role') || '/' || (j -> 'history' -> -1 ->> 'content') from t1));
update public.fd_app_config set value = '2'::jsonb where key = 'session_message_cap';
select public.service_fd_chat_turn((select id from cv where k = 'one'), pg_temp.h('secret-one'), 'second');
select pg_temp.rec('turn', 'the per-session message cap holds', 'message_cap',
  (public.service_fd_chat_turn((select id from cv where k = 'one'), pg_temp.h('secret-one'), 'third') ->> 'reason'));
update public.fd_app_config set value = '30'::jsonb where key = 'session_message_cap';
update public.fd_conversations set status = 'closed' where id = (select id from cv where k = 'one');
select pg_temp.rec('turn', 'a closed conversation takes no more messages', 'closed',
  (public.service_fd_chat_turn((select id from cv where k = 'one'), pg_temp.h('secret-one'), 'again') ->> 'reason'));

-- 3. reply --------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.opened('secret-two');
insert into cv select 'two', id from public.fd_conversations where secret_hash = pg_temp.h('secret-two');
select public.service_fd_chat_turn((select id from cv where k = 'two'), pg_temp.h('secret-two'), 'What is TarragonHealth?');
select public.service_fd_chat_reply((select id from cv where k = 'two'), 'It is a Nigerian digital health service.', 'claude-haiku-4-5', 400, 60, '{}', null, 'model');
select pg_temp.rec('reply', 'the first response time is set', 'true',
  (select (first_reply_at is not null and first_response_ms is not null and first_response_ms >= 0)::text from public.fd_conversations where id = (select id from cv where k = 'two')));
create temp table frm(v integer) on commit drop;
grant all on frm to public;
update public.fd_conversations set first_response_ms = 1234 where id = (select id from cv where k = 'two');
select public.service_fd_chat_reply((select id from cv where k = 'two'), 'More detail.', 'claude-haiku-4-5', 10, 10, '{}', null, 'model');
select pg_temp.rec('reply', 'the first response time is set ONCE', '1234', (select first_response_ms::text from public.fd_conversations where id = (select id from cv where k = 'two')));
select pg_temp.rec('reply', 'an unflagged reply does not queue a review', '0', (select count(*)::text from public.fd_review_queue where conversation_id = (select id from cv where k = 'two')));
select public.service_fd_chat_reply((select id from cv where k = 'two'), 'I cannot help with that.', null, null, null, array['clinical_request'], null, 'rules');
select pg_temp.rec('reply', 'a flagged reply puts the conversation on the review queue', '1/flagged',
  (select count(*)::text || '/' || min(reason) from public.fd_review_queue where conversation_id = (select id from cv where k = 'two')));
select public.service_fd_chat_reply((select id from cv where k = 'two'), 'Again.', null, null, null, array['clinical_request'], null, 'rules');
select pg_temp.rec('reply', 'still one review row', '1', (select count(*)::text from public.fd_review_queue where conversation_id = (select id from cv where k = 'two')));
select pg_temp.rec('reply', 'a bad answered_by is refused', 'ERR:P0001',
  pg_temp.as_val(null, 'service_role', format($q$select public.service_fd_chat_reply(%L, 'x', null, null, null, '{}', null, 'magic')::text$q$, (select id from cv where k = 'two'))));

-- 4. handoff ------------------------------------------------------------------------------------------------------------------------------------
create temp table ho(j jsonb) on commit drop;
grant all on ho to public;
insert into ho select public.service_fd_chat_handoff((select id from cv where k = 'two'), 'cannot_answer', 'normal', 'Asked about corporate plans.', 'Hello, thanks for asking.');
select pg_temp.rec('handoff', 'a handoff is created', 'true/true', (select (j ->> 'ok') || '/' || (j ->> 'created') from ho));
select pg_temp.rec('handoff', 'the conversation is handed off', 'handed_off', (select status from public.fd_conversations where id = (select id from cv where k = 'two')));
select pg_temp.rec('handoff', 'it is alertable straight away', 'pending/normal',
  (select alert_state || '/' || urgency from public.fd_handoffs where conversation_id = (select id from cv where k = 'two')));
select pg_temp.rec('handoff', 'a second request does not make a second handoff', '1/false',
  (select count(*)::text || '/' || (public.service_fd_chat_handoff((select id from cv where k = 'two'), 'visitor_asked', 'normal', 'again', null) ->> 'created')
     from public.fd_handoffs where conversation_id = (select id from cv where k = 'two')));
update public.fd_handoffs set alert_state = 'sent' where conversation_id = (select id from cv where k = 'two');
select public.service_fd_chat_handoff((select id from cv where k = 'two'), 'emergency', 'urgent', 'Emergency wording used.', null);
select pg_temp.rec('handoff', 'escalating to urgent re-alerts the same handoff', 'urgent/pending/1',
  (select urgency || '/' || alert_state || '/' || (select count(*)::text from public.fd_handoffs where conversation_id = (select id from cv where k = 'two'))
     from public.fd_handoffs where conversation_id = (select id from cv where k = 'two')));
select pg_temp.rec('handoff', 'an emergency sets the status and the red flag', 'emergency/true',
  (select status || '/' || red_flag_triggered::text from public.fd_conversations where id = (select id from cv where k = 'two')));
select public.service_fd_chat_handoff((select id from cv where k = 'two'), 'visitor_asked', 'normal', 'later ask', null);
select pg_temp.rec('handoff', 'an emergency conversation stays an emergency', 'emergency', (select status from public.fd_conversations where id = (select id from cv where k = 'two')));
select pg_temp.rec('handoff', 'an unknown conversation is reported, not created', 'false', (public.service_fd_chat_handoff(gen_random_uuid(), 'visitor_asked', 'normal', 'x', null) ->> 'ok'));

-- 5. capture ------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.opened('secret-three');
insert into cv select 'three', id from public.fd_conversations where secret_hash = pg_temp.h('secret-three');
select public.service_fd_chat_turn((select id from cv where k = 'three'), pg_temp.h('secret-three'), 'Do you cover my parents as well?');
select public.service_fd_chat_reply((select id from cv where k = 'three'), 'ASSISTANT-ONLY-SENTENCE should never reach the CRM.', null, null, null, '{}', null, 'rules');
select pg_temp.rec('capture', 'the wrong secret captures nothing', 'false/not_found',
  (select (r ->> 'captured') || '/' || (r ->> 'reason') from (select public.service_fd_chat_capture((select id from cv where k = 'three'), pg_temp.h('nope'), 'Ada', 'chatter@example.invalid', null, true, 'wording', 'v1') r) q));
select pg_temp.rec('capture', 'no consent captures nothing', 'false/consent_required',
  (select (r ->> 'captured') || '/' || (r ->> 'reason') from (select public.service_fd_chat_capture((select id from cv where k = 'three'), pg_temp.h('secret-three'), 'Ada', 'chatter@example.invalid', null, false, 'wording', 'v1') r) q));
select pg_temp.rec('capture', 'and no contact exists for that email', '0', (select count(*)::text from public.fd_contacts where email = 'chatter@example.invalid'));
select public.service_fd_chat_capture((select id from cv where k = 'three'), pg_temp.h('secret-three'), 'Ada Obi', 'chatter@example.invalid', null, true, 'I agree to be contacted.', 'enquiry-consent-v1');
select pg_temp.rec('capture', 'with consent the contact is linked to the conversation', 'true',
  (select (c.contact_id = (select id from public.fd_contacts where email = 'chatter@example.invalid'))::text from public.fd_conversations c where c.id = (select id from cv where k = 'three')));
select pg_temp.rec('capture', 'the contact came from chat', 'chat', (select source from public.fd_contacts where email = 'chatter@example.invalid'));
select pg_temp.rec('capture', 'the CRM note carries what the visitor wrote and not what the assistant said', 'true/false',
  (select (payload ->> 'body' like '%cover my parents%')::text || '/' || (payload ->> 'body' like '%ASSISTANT-ONLY%')::text
     from public.fd_hubspot_outbox where contact_id = (select id from public.fd_contacts where email = 'chatter@example.invalid') and kind = 'note'));
select pg_temp.rec('capture', 'a chat consent record exists', '1',
  (select count(*)::text from public.fd_consents where contact_id = (select id from public.fd_contacts where email = 'chatter@example.invalid') and channel = 'chat' and withdrawn_at is null));
select public.service_fd_chat_handoff((select id from cv where k = 'three'), 'visitor_asked', 'normal', 'asked for a person', null);
select pg_temp.rec('capture', 'a handoff made after capture carries the contact', 'true',
  (select (contact_id = (select id from public.fd_contacts where email = 'chatter@example.invalid'))::text from public.fd_handoffs where conversation_id = (select id from cv where k = 'three')));

-- 6. spend --------------------------------------------------------------------------------------------------------------------------------------
delete from public.fd_model_usage;
select pg_temp.rec('spend', 'cost uses the configured price (1000 in, 500 out at 1 and 5 per million = 0.0035)', '0.003500', round(public.service_fd_usage_add('claude-haiku-4-5', 1000, 500), 6)::text);
select pg_temp.rec('spend', 'an unpriced model counts at the HIGHEST listed price (fails safe)', '0.010500',
  round(public.service_fd_usage_add('some-new-model', 1000, 500), 6)::text);
select pg_temp.rec('spend', 'today''s spend is the sum', '0.014000', (public.service_fd_spend_today())::text);
select public.service_fd_usage_add('claude-haiku-4-5', 1000, 500);
select pg_temp.rec('spend', 'calls accumulate per model', '2', (select calls::text from public.fd_model_usage where model = 'claude-haiku-4-5'));

-- 7. alerts -------------------------------------------------------------------------------------------------------------------------------------
update public.fd_handoffs set alert_state = 'sent' where true;
select pg_temp.opened('secret-four');
insert into cv select 'four', id from public.fd_conversations where secret_hash = pg_temp.h('secret-four');
select public.service_fd_chat_turn((select id from cv where k = 'four'), pg_temp.h('secret-four'), 'Normal question');
select public.service_fd_chat_handoff((select id from cv where k = 'four'), 'cannot_answer', 'normal', 'normal one', null);
select pg_temp.opened('secret-five');
insert into cv select 'five', id from public.fd_conversations where secret_hash = pg_temp.h('secret-five');
select public.service_fd_chat_turn((select id from cv where k = 'five'), pg_temp.h('secret-five'), 'I have chest pain');
select public.service_fd_chat_handoff((select id from cv where k = 'five'), 'emergency', 'urgent', 'urgent one', null);
create temp table al(j jsonb) on commit drop;
grant all on al to public;
insert into al select coalesce(jsonb_agg(jsonb_build_object('id', handoff_id, 'u', urgency, 'tr', jsonb_array_length(transcript)) order by 1), '[]') from public.service_fd_claim_alerts(10);
select pg_temp.rec('alerts', 'both are claimed, the URGENT one first', 'urgent,normal',
  (select string_agg(x ->> 'u', ',' order by ordinality) from al, jsonb_array_elements(j) with ordinality x(x, ordinality)));
select pg_temp.rec('alerts', 'the transcript comes with the alert', 'true', (select (min((x ->> 'tr')::int) >= 2)::text from al, jsonb_array_elements(j) x));
select pg_temp.rec('alerts', 'claimed rows are "sending"', '2', (select count(*)::text from public.fd_handoffs where alert_state = 'sending'));
select pg_temp.rec('alerts', 'a second claim straight away returns nothing', '0', (select count(*)::text from public.service_fd_claim_alerts(10)));
select public.service_fd_finish_alert(id, true, null) from public.fd_handoffs where conversation_id = (select id from cv where k = 'five');
select pg_temp.rec('alerts', 'a delivered alert is "sent" with a time', 'sent/true',
  (select alert_state || '/' || (alert_sent_at is not null)::text from public.fd_handoffs where conversation_id = (select id from cv where k = 'five')));
select public.service_fd_finish_alert(id, false, 'resend 500') from public.fd_handoffs where conversation_id = (select id from cv where k = 'four');
select pg_temp.rec('alerts', 'a failed alert goes back to pending to retry', 'pending',
  (select alert_state from public.fd_handoffs where conversation_id = (select id from cv where k = 'four')));
update public.fd_handoffs set alert_state = 'sending', alert_attempts = 5 where conversation_id = (select id from cv where k = 'four');
select public.service_fd_finish_alert(id, false, 'resend 500') from public.fd_handoffs where conversation_id = (select id from cv where k = 'four');
select pg_temp.rec('alerts', 'after 5 attempts it stays failed (and is audited)', 'failed/true',
  (select alert_state from public.fd_handoffs where conversation_id = (select id from cv where k = 'four'))
  || '/' || (select exists (select 1 from public.fd_audit_log where action = 'alert_failed')::text));

-- 8. replies ------------------------------------------------------------------------------------------------------------------------------------
create temp table rh(id uuid) on commit drop;
grant all on rh to public;
insert into rh select id from public.fd_handoffs where conversation_id = (select id from cv where k = 'three');
update public.fd_handoffs set suggested_reply = 'Hello Ada, thanks for asking.' where id = (select id from rh);
select pg_temp.rec('reply2', 'a patient cannot queue a reply', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', format($q$select public.fd_handoff_queue_reply(%L, 'hi')::text$q$, (select id from rh))));
select pg_temp.rec('reply2', 'an empty reply is refused', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_handoff_queue_reply(%L, '   ')::text$q$, (select id from rh))));
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_handoff_queue_reply(%L, 'Hello Ada, yes, parents can each join.')::text$q$, (select id from rh)));
select pg_temp.rec('reply2', 'an admin queues it: replied, queued, and the EDIT is recorded', 'replied/queued/true',
  (select status || '/' || reply_state || '/' || reply_edited::text from public.fd_handoffs where id = (select id from rh)));
select pg_temp.rec('reply2', 'the reply is added to the transcript as the founder', 'founder',
  (select role from public.fd_messages where conversation_id = (select id from cv where k = 'three') order by created_at desc limit 1));
select pg_temp.rec('reply2', 'a second queue is refused', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_handoff_queue_reply(%L, 'again')::text$q$, (select id from rh))));
create temp table rp(j jsonb) on commit drop;
grant all on rp to public;
insert into rp select coalesce(jsonb_agg(jsonb_build_object('id', handoff_id, 'email', email, 'first', first_name, 'reply', reply)), '[]') from public.service_fd_claim_replies(10);
select pg_temp.rec('reply2', 'it is claimed once, with the visitor''s email and first name', 'chatter@example.invalid/Ada/1',
  (select (j -> 0 ->> 'email') || '/' || (j -> 0 ->> 'first') || '/' || jsonb_array_length(j)::text from rp));
select pg_temp.rec('reply2', 'a second claim returns nothing', '0', (select count(*)::text from public.service_fd_claim_replies(10)));
select public.service_fd_finish_reply((select id from rh), true, 'msg-77', null);
select pg_temp.rec('reply2', 'a sent reply is recorded', 'sent/msg-77', (select reply_state || '/' || reply_message_id from public.fd_handoffs where id = (select id from rh)));
-- unedited suggestion: edited = false
select pg_temp.opened('secret-six');
insert into cv select 'six', id from public.fd_conversations where secret_hash = pg_temp.h('secret-six');
select public.service_fd_chat_turn((select id from cv where k = 'six'), pg_temp.h('secret-six'), 'Question six');
select public.service_fd_chat_capture((select id from cv where k = 'six'), pg_temp.h('secret-six'), 'Bayo', 'bayo@example.invalid', null, true, 'w', 'v1');
select public.service_fd_chat_handoff((select id from cv where k = 'six'), 'cannot_answer', 'normal', 's', 'Use as is.');
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_handoff_queue_reply(%L, 'Use as is.')::text$q$, (select id from public.fd_handoffs where conversation_id = (select id from cv where k = 'six'))));
select pg_temp.rec('reply2', 'sending the suggestion unchanged records edited = false', 'false', (select reply_edited::text from public.fd_handoffs where conversation_id = (select id from cv where k = 'six')));
-- no email / suppressed
select pg_temp.opened('secret-seven');
insert into cv select 'seven', id from public.fd_conversations where secret_hash = pg_temp.h('secret-seven');
select public.service_fd_chat_turn((select id from cv where k = 'seven'), pg_temp.h('secret-seven'), 'Question seven');
select public.service_fd_chat_handoff((select id from cv where k = 'seven'), 'cannot_answer', 'normal', 's', null);
select pg_temp.rec('reply2', 'a visitor who left no contact cannot be replied to', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_handoff_queue_reply(%L, 'hello')::text$q$, (select id from public.fd_handoffs where conversation_id = (select id from cv where k = 'seven')))));
select public.service_fd_unsubscribe((select id from public.fd_contacts where email = 'bayo@example.invalid'));
update public.fd_handoffs set reply_state = 'none', status = 'open', founder_reply = null, replied_at = null where conversation_id = (select id from cv where k = 'six');
select pg_temp.rec('reply2', 'a suppressed contact cannot be replied to', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_handoff_queue_reply(%L, 'hello')::text$q$, (select id from public.fd_handoffs where conversation_id = (select id from cv where k = 'six')))));

-- 9. access -------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('access', 'a patient cannot take a chat turn', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', format($q$select public.service_fd_chat_turn(%L, %L, 'hi')::text$q$, (select id from cv where k = 'one'), pg_temp.h('secret-one'))));
select pg_temp.rec('access', 'anon cannot open a conversation', 'ERR:42501',
  pg_temp.as_val(null, 'anon', format($q$select public.service_fd_chat_open(%L, '/x', 'hi')::text$q$, pg_temp.h('x'))));
select pg_temp.rec('access', 'an admin cannot claim alerts (service role only)', 'ERR:42501', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select count(*)::text from public.service_fd_claim_alerts(1)'));
select pg_temp.rec('access', 'a patient cannot read the inbox', 'ERR:42501', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select (public.fd_inbox())::text'));
select pg_temp.rec('access', 'an admin reads the inbox, urgent open ones first', 'urgent',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select (public.fd_inbox() -> 0 ->> 'urgency')$q$));
select pg_temp.rec('access', 'a patient cannot close a handoff', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', format($q$select public.fd_handoff_close(%L)::text$q$, (select id from rh))));
select pg_temp.rec('access', 'a patient reads no usage rows', '0', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select count(*)::text from public.fd_model_usage'));

-- 10. SABOTAGE ------------------------------------------------------------------------------------------------------------------------------------
grant execute on function public.service_fd_chat_turn(uuid, text, text) to authenticated;
select pg_temp.rec('sabotage', 'SABOTAGE (a): chat turn granted to authenticated, a patient can now post into a conversation', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', format($q$select (public.service_fd_chat_turn(%L, %L, 'sneaky') ->> 'ok')$q$, (select id from cv where k = 'two'), pg_temp.h('secret-two'))));

create or replace function private.fd_hash_eq(a text, b text) returns boolean language sql immutable as $$ select true $$;
select pg_temp.rec('sabotage', 'SABOTAGE (b): hash comparison always true, the wrong secret now continues a conversation', 'not_found',
  (public.service_fd_chat_turn((select id from cv where k = 'five'), pg_temp.h('totally-wrong'), 'hijack') ->> 'reason'));

grant execute on function public.service_fd_claim_alerts(integer) to authenticated;
select pg_temp.rec('sabotage', 'SABOTAGE (c): alert claim granted to authenticated, an admin session can now take the alerts', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select count(*)::text from public.service_fd_claim_alerts(1)'));

-- Verdict ---------------------------------------------------------------------------------------------------------------------------------------
select phase, check_name, expected, actual,
       case when phase = 'sabotage' then case when expected is distinct from actual then 'PASS (caught)' else 'FAIL (sabotage not detected)' end
            when expected = actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;

do $$
declare v_bad int; v_first text;
begin
  select count(*), min(check_name) into v_bad, v_first from results
   where (phase <> 'sabotage' and expected is distinct from actual) or (phase = 'sabotage' and expected is not distinct from actual);
  if v_bad > 0 then raise exception 'fd M4 proof: % check(s) failed, first: %', v_bad, v_first; end if;
end $$;

rollback;
