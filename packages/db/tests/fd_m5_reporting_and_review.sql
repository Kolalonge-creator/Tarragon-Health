-- ===========================================================================
-- Proof: Front Desk M5 reporting and review (migration 20261102012803_fd_m5_reporting_and_review.sql).
-- Spec acceptance check served here: "first Friday report arrives with real numbers", and the transcript-review loop ("any unsafe mark opens an
-- incident and tightens the rules").
--
--   1. TOPIC: the first real topic sticks, "other" can be replaced, a malformed topic is refused.
--   2. SETTLE: a quiet conversation the assistant answered ends "ai_resolved", one it never answered "abandoned"; handoffs, recent and closed
--      conversations are untouched; a second run does nothing.
--   3. METRICS: counts, the share that needed no person, the median first response, topics, unanswered topics, handoffs, leads, funnel, reviews,
--      spend and follow-ups are right on known data; the window edges (start inclusive, end exclusive) hold; a conversation outside it or with no
--      visitor message is not counted.
--   4. REPORT TIMING: not before 07:30 London on Friday; exactly once per week; right in summer time (06:30 UTC) as well as winter; a missed
--      Friday is healed for 24 hours and never produced days late; a forced report is idempotent; the report holds no visitor text.
--   5. DELIVERY: a report is claimed once, re-claimed after a stale claim, recorded as sent, retried on failure and given up after 5; only the
--      service role claims; staff cannot generate one.
--   6. SAMPLER: flagged and handed-off conversations are always queued; at 0% nothing else; at 50% exactly the hash-chosen ones; at 100% everything
--      settled; recent and old conversations are skipped; running again queues nothing new.
--   7. REVIEW: only an admin lists or records; a verdict needs a note unless "ok"; it is final; "unsafe" opens an incident and nothing else does;
--      an incident closes only with a stated rule change and survives the conversation it came from.
--   8. DASHBOARD, CONFIG: admin only; review_sample_percent takes 0 to 100 and the earlier keys still validate.
--   9. RETENTION: old text is deleted and a summary stays; text a person still needs (pending review, open handoff, open incident) and recent
--      text are kept; the conversation row and its numbers remain; a second run does nothing.
--  10. DISPATCH TRIGGER: the schedule wants the dispatcher when a report is waiting.
--  11. ACCESS: service functions are service role only; incidents are admin only; a leads.manage holder reads and does none of this.
--  12. SABOTAGE (each MUST flip): the report claim granted to authenticated; incidents opened to everyone; the sampler granted to authenticated.
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
create function pg_temp.cfg(p_key text, p_val text) returns text language plpgsql as
$$ begin perform private.fd_validate_config(p_key, p_val::jsonb); return 'ok'; exception when others then return 'ERR:' || sqlstate; end $$;

-- A conversation fixture; returns its id and remembers it under p_k.
create function pg_temp.mkconv(p_k text, p_started timestamptz, p_last timestamptz, p_visitor integer, p_resolution text, p_first_ms integer,
                               p_intent text, p_status text default 'open', p_red boolean default false, p_replied boolean default false) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.fd_conversations (secret_hash, status, started_at, last_message_at, visitor_message_count, resolution_type, first_response_ms,
                                       intent, red_flag_triggered, first_reply_at, first_visitor_message_at)
  values (encode(sha256(convert_to('m5-' || p_k, 'UTF8')), 'hex'), p_status, p_started, p_last, p_visitor, p_resolution, p_first_ms, p_intent, p_red,
          case when p_replied then p_last else null end, case when p_visitor > 0 then p_started else null end)
  returning id into v_id;
  insert into fx values ('c_' || p_k, v_id);
  return v_id;
end $$;

do $$
declare v_admin uuid := gen_random_uuid(); v_pat uuid := gen_random_uuid(); v_staff uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'fd5-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_admin, v_pat, v_staff]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone, created_at) values
    (v_admin, '00000000-0000-0000-0000-000000000001', 'admin',   'FD5 Admin',   '+2348058885711', now() - interval '90 days'),
    (v_pat,   '00000000-0000-0000-0000-000000000001', 'patient', 'FD5 Patient', '+2348058885712', now() - interval '90 days'),
    (v_staff, '00000000-0000-0000-0000-000000000001', 'care_coordinator', 'FD5 Staff', '+2348058885713', now() - interval '90 days')
  on conflict (id) do update set role = excluded.role;
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_staff, 'leads.manage', v_admin);
  insert into fx values ('admin', v_admin), ('pat', v_pat), ('staff', v_staff);
end $$;

-- 1. topic --------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mkconv('t1', now() - interval '6 days', now() - interval '6 days', 1, 'ai_resolved', null, null);
select pg_temp.mkconv('t2', now() - interval '6 days', now() - interval '6 days', 1, 'ai_resolved', null, 'other');
select public.service_fd_chat_note_topic(pg_temp.f('c_t1'), 'pricing');
select pg_temp.rec('topic', 'the first topic is stored', 'pricing', (select intent from public.fd_conversations where id = pg_temp.f('c_t1')));
select public.service_fd_chat_note_topic(pg_temp.f('c_t1'), 'launch');
select pg_temp.rec('topic', 'a later topic does not replace a real one', 'pricing', (select intent from public.fd_conversations where id = pg_temp.f('c_t1')));
select public.service_fd_chat_note_topic(pg_temp.f('c_t2'), 'privacy');
select pg_temp.rec('topic', '"other" is replaced by a real topic', 'privacy', (select intent from public.fd_conversations where id = pg_temp.f('c_t2')));
select pg_temp.rec('topic', 'a malformed topic is refused', 'ERR:P0001',
  pg_temp.as_val(null, 'service_role', format($q$select public.service_fd_chat_note_topic(%L, 'Bad Topic!')::text$q$, pg_temp.f('c_t1'))));
select pg_temp.rec('topic', 'a missing topic is refused', 'ERR:P0001',
  pg_temp.as_val(null, 'service_role', format($q$select public.service_fd_chat_note_topic(%L, null)::text$q$, pg_temp.f('c_t1'))));

-- 2. settle (these are 5 days old, so the sampler's 3 day window never sees them) --------------------------------------------------------------
select pg_temp.mkconv('sa', now() - interval '5 days', now() - interval '5 days', 2, null, 1500, null, 'open', false, true);
select pg_temp.mkconv('sb', now() - interval '5 days', now() - interval '5 days', 1, null, null, null, 'open', false, false);
select pg_temp.mkconv('sc', now() - interval '5 minutes', now() - interval '5 minutes', 1, null, null, null, 'open', false, true);
select pg_temp.mkconv('sd', now() - interval '5 days', now() - interval '5 days', 1, 'handed_off', null, null, 'handed_off', false, true);
select pg_temp.mkconv('se', now() - interval '5 days', now() - interval '5 days', 1, null, null, null, 'closed', false, true);
select pg_temp.rec('settle', 'the first run settles exactly the two quiet open conversations', '2', public.service_fd_settle_conversations()::text);
select pg_temp.rec('settle', 'an answered quiet conversation ended without a person', 'ai_resolved', (select resolution_type from public.fd_conversations where id = pg_temp.f('c_sa')));
select pg_temp.rec('settle', 'one the visitor wrote to and never got an answer is abandoned', 'abandoned', (select resolution_type from public.fd_conversations where id = pg_temp.f('c_sb')));
select pg_temp.rec('settle', 'a recent conversation is left alone', 'none', coalesce((select resolution_type from public.fd_conversations where id = pg_temp.f('c_sc')), 'none'));
select pg_temp.rec('settle', 'a handoff keeps its own outcome', 'handed_off', (select resolution_type from public.fd_conversations where id = pg_temp.f('c_sd')));
select pg_temp.rec('settle', 'a closed conversation is left alone', 'none', coalesce((select resolution_type from public.fd_conversations where id = pg_temp.f('c_se')), 'none'));
select pg_temp.rec('settle', 'a second run settles nothing', '0', public.service_fd_settle_conversations()::text);
select pg_temp.rec('settle', 'settling does not close the chat (the visitor can come back)', 'open', (select status from public.fd_conversations where id = pg_temp.f('c_sa')));

-- 3. metrics on known data (window 2026-03-02 .. 2026-03-09, UTC = London in early March) ---------------------------------------------------
select pg_temp.mkconv('m1', '2026-03-03 10:00+00', '2026-03-03 10:05+00', 1, 'ai_resolved', 2000, 'pricing', 'open', false, true);
select pg_temp.mkconv('m2', '2026-03-04 10:00+00', '2026-03-04 10:05+00', 1, 'ai_resolved', 4000, 'pricing', 'open', false, true);
select pg_temp.mkconv('m3', '2026-03-05 10:00+00', '2026-03-05 10:05+00', 1, 'handed_off', 6000, 'launch', 'handed_off', false, true);
select pg_temp.mkconv('m4', '2026-03-06 10:00+00', '2026-03-06 10:05+00', 1, 'emergency', 1000, null, 'emergency', true, true);
select pg_temp.mkconv('m5', '2026-03-01 23:59:59+00', '2026-03-02 00:05+00', 1, 'ai_resolved', 1000, 'pricing', 'open', false, true);   -- before the window
select pg_temp.mkconv('m6', '2026-03-09 00:00:00+00', '2026-03-09 00:05+00', 1, 'ai_resolved', 1000, 'pricing', 'open', false, true);   -- exactly the end: excluded
select pg_temp.mkconv('m7', '2026-03-05 11:00+00', '2026-03-05 11:00+00', 0, null, null, 'pricing');                                      -- no visitor message
insert into public.fd_messages (conversation_id, role, content) values (pg_temp.f('c_m1'), 'visitor', 'SECRET-SYMPTOM-TEXT my chest hurts when I climb stairs');
insert into public.fd_handoffs (conversation_id, urgency, reason, status, created_at, replied_at, founder_reply, alert_state) values
  (pg_temp.f('c_m3'), 'normal', 'cannot_answer', 'replied', '2026-03-05 10:05+00', '2026-03-05 10:35+00', 'we will get back to you', 'sent'),
  (pg_temp.f('c_m4'), 'urgent', 'emergency', 'open', '2026-03-06 10:01+00', null, null, 'failed');
insert into public.fd_contacts (email, source, created_at) values
  ('l1-fd5@example.invalid', 'website_form', '2026-03-03 09:00+00'), ('l2-fd5@example.invalid', 'website_form', '2026-03-04 09:00+00'),
  ('l3-fd5@example.invalid', 'chat', '2026-03-05 09:00+00'), ('l4-fd5@example.invalid', 'app_signup', '2026-03-05 09:00+00'),
  ('l5-fd5@example.invalid', 'website_form', '2026-02-20 09:00+00');
insert into public.fd_funnel_events (contact_id, event_type, occurred_at, dedupe_key)
select id, 'account_created', '2026-03-04 12:00+00', 'm5-acct-' || email from public.fd_contacts where email in ('l1-fd5@example.invalid', 'l2-fd5@example.invalid');
insert into public.fd_funnel_events (contact_id, event_type, occurred_at, dedupe_key)
select id, 'account_created', '2026-03-05 12:00+00', 'm5-acct2-' || email from public.fd_contacts where email = 'l1-fd5@example.invalid';       -- a second event for the same person
insert into public.fd_funnel_events (contact_id, event_type, occurred_at, dedupe_key)
select id, 'paid', '2026-03-06 12:00+00', 'm5-paid-' || email from public.fd_contacts where email = 'l1-fd5@example.invalid';
select pg_temp.mkconv('x1', '2026-02-01 10:00+00', '2026-02-01 10:00+00', 0, null, null, null);
select pg_temp.mkconv('x2', '2026-02-01 10:00+00', '2026-02-01 10:00+00', 0, null, null, null);
select pg_temp.mkconv('x3', '2026-02-01 10:00+00', '2026-02-01 10:00+00', 0, null, null, null);
select pg_temp.mkconv('x4', '2026-02-01 10:00+00', '2026-02-01 10:00+00', 0, null, null, null);
insert into public.fd_review_queue (conversation_id, reason, status, verdict, reviewer_id, note, reviewed_at) values
  (pg_temp.f('c_x1'), 'random_sample', 'reviewed', 'ok',     pg_temp.f('admin'), null,            '2026-03-04 08:00+00'),
  (pg_temp.f('c_x2'), 'random_sample', 'reviewed', 'wrong',  pg_temp.f('admin'), 'wrong price',   '2026-03-04 08:00+00'),
  (pg_temp.f('c_x3'), 'flagged',       'reviewed', 'unsafe', pg_temp.f('admin'), 'gave a dose',   '2026-03-04 08:00+00');
insert into public.fd_review_queue (conversation_id, reason) values (pg_temp.f('c_x4'), 'random_sample');
insert into public.fd_incidents (conversation_id, opened_note, opened_by, opened_at) values (pg_temp.f('c_x3'), 'gave a dose', pg_temp.f('admin'), '2026-03-04 08:00+00');
insert into public.fd_model_usage (day, model, calls, tokens_in, tokens_out, cost_usd) values
  ('2026-03-03', 'claude-haiku-4-5', 10, 1000, 500, 0.5), ('2026-03-05', 'claude-haiku-4-5', 5, 400, 200, 0.25), ('2026-03-20', 'claude-haiku-4-5', 99, 1, 1, 9);
do $$
declare v_c uuid := (select id from public.fd_contacts where email = 'l1-fd5@example.invalid'); v_step uuid; v_seq uuid;
begin
  select id, sequence_id into v_step, v_seq from public.fd_sequence_steps limit 1;
  insert into public.fd_followup_runs (contact_id, sequence_id, step_id, enrolment_key, state, scheduled_for, sent_at, dry_run, skip_reason) values
    (v_c, v_seq, v_step, 'm5a', 'sent',    '2026-03-04 09:00+00', '2026-03-04 09:00+00', false, null),
    (v_c, v_seq, v_step, 'm5b', 'skipped', '2026-03-04 10:00+00', null,                  true,  'dry_run'),
    (v_c, v_seq, v_step, 'm5c', 'failed',  '2026-03-05 09:00+00', null,                  false, null),
    (v_c, v_seq, v_step, 'm5d', 'sent',    '2026-03-20 09:00+00', '2026-03-20 09:00+00', false, null);
end $$;
create temp table mx(m jsonb) on commit drop;
insert into mx select private.fd_week_metrics('2026-03-02 00:00+00', '2026-03-09 00:00+00');
select pg_temp.rec('metrics', 'conversations counted (edges and no-message rows excluded)', '4', (select m #>> '{conversations,total}' from mx));
select pg_temp.rec('metrics', 'visitor messages counted', '4', (select m #>> '{conversations,visitor_messages}' from mx));
select pg_temp.rec('metrics', 'ended without a person', '2', (select m #>> '{conversations,ai_resolved}' from mx));
select pg_temp.rec('metrics', 'handed off', '1', (select m #>> '{conversations,handed_off}' from mx));
select pg_temp.rec('metrics', 'emergency wording', '1', (select m #>> '{conversations,emergency}' from mx));
select pg_temp.rec('metrics', 'share that needed no person is 50% of the ended ones', 'true', (select ((m #>> '{conversations,ai_resolved_pct}')::numeric = 50)::text from mx));
select pg_temp.rec('metrics', 'median first response is 3 seconds (1, 2, 4, 6)', 'true', (select ((m #>> '{conversations,median_first_response_seconds}')::numeric = 3)::text from mx));
select pg_temp.rec('metrics', 'top topic first', 'pricing/2', (select (m #>> '{topics,0,topic}') || '/' || (m #>> '{topics,0,count}') from mx));
select pg_temp.rec('metrics', 'second topic', 'launch/1', (select (m #>> '{topics,1,topic}') || '/' || (m #>> '{topics,1,count}') from mx));
select pg_temp.rec('metrics', 'a conversation with no topic adds none', '2', (select jsonb_array_length(m -> 'topics')::text from mx));
select pg_temp.rec('metrics', 'unanswered questions are named by topic only', 'launch/1', (select (m #>> '{unanswered,0,topic}') || '/' || (m #>> '{unanswered,0,count}') from mx));
select pg_temp.rec('metrics', 'handoffs', '2', (select m #>> '{handoffs,total}' from mx));
select pg_temp.rec('metrics', 'urgent handoffs', '1', (select m #>> '{handoffs,urgent}' from mx));
select pg_temp.rec('metrics', 'median time to a reply is 30 minutes', 'true', (select ((m #>> '{handoffs,median_reply_minutes}')::numeric = 30)::text from mx));
select pg_temp.rec('metrics', 'handoffs by reason', '1/1', (select (m #>> '{handoffs,by_reason,cannot_answer}') || '/' || (m #>> '{handoffs,by_reason,emergency}') from mx));
select pg_temp.rec('metrics', 'a failed alert is counted', '1', (select m #>> '{handoffs,alerts_failed}' from mx));
select pg_temp.rec('metrics', 'enquiries (app sign-ups and other weeks excluded)', '3', (select m #>> '{leads,total}' from mx));
select pg_temp.rec('metrics', 'enquiries by source', '2/1', (select (m #>> '{leads,by_source,website_form}') || '/' || (m #>> '{leads,by_source,chat}') from mx));
select pg_temp.rec('metrics', 'accounts are people, not events', '2', (select m #>> '{funnel,events,account_created}' from mx));
select pg_temp.rec('metrics', 'enquiry to account is 66.7%', 'true', (select ((m #>> '{funnel,enquiry_to_account_pct}')::numeric = 66.7)::text from mx));
select pg_temp.rec('metrics', 'account to paid is 50%', 'true', (select ((m #>> '{funnel,account_to_paid_pct}')::numeric = 50)::text from mx));
select pg_temp.rec('metrics', 'reviews recorded this week (ok / wrong / unsafe)', '1/1/1', (select (m #>> '{review,ok}') || '/' || (m #>> '{review,wrong}') || '/' || (m #>> '{review,unsafe}') from mx));
select pg_temp.rec('metrics', 'reviews still waiting', '1', (select m #>> '{review,pending}' from mx));
select pg_temp.rec('metrics', 'incidents open and opened this week', '1/1', (select (m #>> '{review,incidents_open}') || '/' || (m #>> '{review,incidents_opened}') from mx));
select pg_temp.rec('metrics', 'spend counts only the window', 'true', (select ((m #>> '{spend,cost_usd}')::numeric = 0.75)::text from mx));
select pg_temp.rec('metrics', 'model calls counted', '15', (select m #>> '{spend,calls}' from mx));
select pg_temp.rec('metrics', 'follow-ups sent (a dry-run hold and another week are not "sent")', '1', (select m #>> '{followups,sent}' from mx));
select pg_temp.rec('metrics', 'follow-ups held by dry-run', '1', (select m #>> '{followups,held_by_dry_run}' from mx));
select pg_temp.rec('metrics', 'follow-ups failed', '1', (select m #>> '{followups,failed}' from mx));
select pg_temp.rec('metrics', 'an empty window gives zero and a null share, not an error', 'true',
  (select (e #>> '{conversations,total}' = '0' and e #> '{conversations,ai_resolved_pct}' = 'null'::jsonb and e #> '{funnel,enquiry_to_account_pct}' = 'null'::jsonb)::text
     from (select private.fd_week_metrics('2020-01-01 00:00+00', '2020-01-08 00:00+00') as e) z));

-- Summer time: the week 2026-07-03 .. 2026-07-10 (London) must take the spend of those calendar days, not a window shifted by one day.
insert into public.fd_model_usage (day, model, calls, tokens_in, tokens_out, cost_usd) values
  ('2026-07-02', 'claude-sonnet-4-5', 1, 1, 1, 100), ('2026-07-03', 'claude-sonnet-4-5', 1, 1, 1, 1), ('2026-07-09', 'claude-sonnet-4-5', 1, 1, 1, 2), ('2026-07-10', 'claude-sonnet-4-5', 1, 1, 1, 200);
select pg_temp.rec('metrics', 'in summer time the spend window is the London calendar days (3 July to 9 July, not shifted a day)', 'true',
  ((private.fd_week_metrics('2026-07-02 23:00+00', '2026-07-09 23:00+00') #>> '{spend,cost_usd}')::numeric = 3)::text);

-- 4. report timing ------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mkconv('r1', '2026-03-10 12:00+00', '2026-03-10 12:10+00', 1, 'ai_resolved', 2000, 'pricing', 'open', false, true);
insert into public.fd_messages (conversation_id, role, content) values (pg_temp.f('c_r1'), 'visitor', 'SECRET-SYMPTOM-TEXT my chest hurts when I climb stairs');
select pg_temp.rec('timing', 'Friday 07:29 London is too early', 'none', coalesce(private.fd_generate_report_at('2026-03-13 07:29+00', false)::text, 'none'));
create temp table rp(k text primary key, id uuid) on commit drop;
insert into rp select 'march13', private.fd_generate_report_at('2026-03-13 07:30+00', false);
select pg_temp.rec('timing', 'Friday 07:30 produces the report', 'true', (select (id is not null)::text from rp where k = 'march13'));
select pg_temp.rec('timing', 'it covers the seven days before that Friday', '2026-03-06/2026-03-13',
  (select week_start::text || '/' || week_end::text from public.fd_report_runs where id = (select id from rp where k = 'march13')));
select pg_temp.rec('timing', 'it holds that week''s real numbers (the three conversations started 6 to 13 March)', '3', (select metrics #>> '{conversations,total}' from public.fd_report_runs where id = (select id from rp where k = 'march13')));
select pg_temp.rec('timing', 'it holds no visitor text', 'false', (select (metrics::text like '%SECRET-SYMPTOM-TEXT%')::text from public.fd_report_runs where id = (select id from rp where k = 'march13')));
select pg_temp.rec('timing', 'a second run the same morning makes no second report', 'none', coalesce(private.fd_generate_report_at('2026-03-13 07:31+00', false)::text, 'none'));
select pg_temp.rec('timing', 'exactly one report for that week', '1', (select count(*)::text from public.fd_report_runs where week_start = '2026-03-06'));
select pg_temp.rec('timing', 'a missed Friday is healed the next morning', 'true', (select (private.fd_generate_report_at('2026-03-21 06:00+00', false) is not null)::text));
select pg_temp.rec('timing', 'the healed report is for the missed week', '2026-03-13', (select week_start::text from public.fd_report_runs where week_end = '2026-03-20'));
select pg_temp.rec('timing', 'summer time: 06:29 UTC is 07:29 London, too early', 'none', coalesce(private.fd_generate_report_at('2026-04-03 06:29+00', false)::text, 'none'));
select pg_temp.rec('timing', 'summer time: 06:30 UTC is 07:30 London, due', 'true', (select (private.fd_generate_report_at('2026-04-03 06:30+00', false) is not null)::text));
select pg_temp.rec('timing', 'summer time: the later hourly run makes no second report', 'none', coalesce(private.fd_generate_report_at('2026-04-03 07:30+00', false)::text, 'none'));
select pg_temp.rec('timing', 'a Friday missed for more than a day is not produced days late', 'none', coalesce(private.fd_generate_report_at('2026-04-12 10:00+00', false)::text, 'none'));
select pg_temp.rec('timing', 'no report exists for that missed week', '0', (select count(*)::text from public.fd_report_runs where week_start = '2026-04-03'));
select pg_temp.rec('timing', 'a Thursday makes nothing', 'none', coalesce(private.fd_generate_report_at('2026-04-09 12:00+00', false)::text, 'none'));
insert into rp select 'forced', private.fd_generate_report_at('2026-05-05 10:00+00', true);
select pg_temp.rec('timing', 'a forced report covers the seven days ending today', '2026-04-28',
  (select week_start::text from public.fd_report_runs where id = (select id from rp where k = 'forced')));
select pg_temp.rec('timing', 'forcing the same day again makes none new (idempotent)', 'none', coalesce(private.fd_generate_report_at('2026-05-05 11:00+00', true)::text, 'none'));
select pg_temp.rec('timing', 'a patient cannot generate a report', 'ERR:42501', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select public.fd_report_generate_now()::text'));
select pg_temp.rec('timing', 'a leads.manage holder cannot generate a report', 'ERR:42501', pg_temp.as_val(pg_temp.f('staff'), 'authenticated', 'select public.fd_report_generate_now()::text'));
select pg_temp.rec('timing', 'an admin can generate one now, and is told it was created', '36/true/pending',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select char_length(r ->> 'id')::text || '/' || (r ->> 'created') || '/' || (r ->> 'status') from (select public.fd_report_generate_now() r) z$q$));
select pg_temp.rec('timing', 'asking again returns the same report and says it was not created again', 'true/false',
  (select ((a ->> 'id') = (b ->> 'id'))::text || '/' || (b ->> 'created') from
     (select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select public.fd_report_generate_now()::text')::jsonb a,
             pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select public.fd_report_generate_now()::text')::jsonb b) z));
update public.fd_report_runs set status = 'sent', sent_at = now() where week_start = (now() at time zone 'Europe/London')::date - 7;
select pg_temp.rec('timing', 'an already sent report is reported as sent and is not queued again', 'false/sent',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select (r ->> 'created') || '/' || (r ->> 'status') from (select public.fd_report_generate_now() r) z$q$));
update public.fd_report_runs set status = 'failed' where week_start = (now() at time zone 'Europe/London')::date - 7;
select pg_temp.rec('timing', 'a failed one is put back in the queue', 'false/pending',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select (r ->> 'created') || '/' || (r ->> 'status') from (select public.fd_report_generate_now() r) z$q$));

-- 5. delivery -----------------------------------------------------------------------------------------------------------------------------------
update public.fd_report_runs set status = 'sent';
insert into public.fd_report_runs (week_start, week_end, metrics, status) values ('2025-01-06', '2025-01-13', '{}'::jsonb, 'pending');
select pg_temp.rec('delivery', 'the first claim takes the waiting report and compares it with the week before', '1:true',
  pg_temp.as_val(null, 'service_role', $q$select attempts::text || ':' || (prev_metrics is not null)::text from public.service_fd_claim_reports(1)$q$));
select pg_temp.rec('delivery', 'a claimed report is "sending"', 'sending', (select status from public.fd_report_runs where week_start = '2025-01-06'));
select pg_temp.rec('delivery', 'a second claim finds nothing (exactly once)', '0', pg_temp.as_val(null, 'service_role', 'select count(*)::text from public.service_fd_claim_reports(1)'));
update public.fd_report_runs set claimed_at = now() - interval '11 minutes' where week_start = '2025-01-06';
select pg_temp.rec('delivery', 'a stale claim is taken again', '2', pg_temp.as_val(null, 'service_role', 'select attempts::text from public.service_fd_claim_reports(1)'));
select public.service_fd_finish_report((select id from public.fd_report_runs where week_start = '2025-01-06'), true, 'the narrative', 'founder@example.invalid', null);
select pg_temp.rec('delivery', 'a successful send is recorded', 'sent/the narrative/founder@example.invalid/true',
  (select status || '/' || narrative || '/' || recipient || '/' || (sent_at is not null)::text from public.fd_report_runs where week_start = '2025-01-06'));
select public.service_fd_finish_report((select id from public.fd_report_runs where week_start = '2025-01-06'), false, null, null, 'late failure');
select pg_temp.rec('delivery', 'a finished report cannot be un-sent by a stray call', 'sent', (select status from public.fd_report_runs where week_start = '2025-01-06'));
insert into public.fd_report_runs (week_start, week_end, metrics, status, attempts) values ('2025-02-03', '2025-02-10', '{}'::jsonb, 'pending', 0);
select attempts from public.service_fd_claim_reports(1);
select public.service_fd_finish_report((select id from public.fd_report_runs where week_start = '2025-02-03'), false, null, null, 'smtp down');
select pg_temp.rec('delivery', 'a failure under 5 attempts goes back to waiting, with the reason', 'pending/smtp down',
  (select status || '/' || last_error from public.fd_report_runs where week_start = '2025-02-03'));
update public.fd_report_runs set attempts = 4 where week_start = '2025-02-03';
select attempts from public.service_fd_claim_reports(1);
select public.service_fd_finish_report((select id from public.fd_report_runs where week_start = '2025-02-03'), false, null, null, 'smtp still down');
select pg_temp.rec('delivery', 'the fifth failure gives up', 'failed', (select status from public.fd_report_runs where week_start = '2025-02-03'));
insert into public.fd_report_runs (week_start, week_end, metrics, status, attempts, claimed_at) values ('2025-03-03', '2025-03-10', '{}'::jsonb, 'sending', 5, now() - interval '11 minutes');
select count(*) from public.service_fd_claim_reports(1);
select pg_temp.rec('delivery', 'a stuck report at its last attempt is marked failed, not claimed forever', 'failed', (select status from public.fd_report_runs where week_start = '2025-03-03'));

-- 6. sampler (the fixtures here are 2 hours old: inside the 3 day window, past the 30 minute settle time) -------------------------------------
select pg_temp.mkconv('s_flag', now() - interval '2 hours', now() - interval '2 hours', 1, null, null, null, 'open', true, false);
select pg_temp.mkconv('s_msg',  now() - interval '2 hours', now() - interval '2 hours', 1, null, null, null, 'open', false, true);
select pg_temp.mkconv('s_hand', now() - interval '2 hours', now() - interval '2 hours', 1, null, null, null, 'open', false, true);
insert into public.fd_messages (conversation_id, role, content, safety_flags) values (pg_temp.f('c_s_msg'), 'assistant', 'a flagged reply', '{medical_advice}');
insert into public.fd_handoffs (conversation_id, reason) values (pg_temp.f('c_s_hand'), 'visitor_asked');
select pg_temp.mkconv('p' || g, now() - interval '2 hours', now() - interval '2 hours', 1, null, null, null, 'open', false, true) from generate_series(1, 20) g;
select pg_temp.mkconv('u' || g, now() - interval '2 hours', now() - interval '2 hours', 1, null, null, null, 'open', false, false) from generate_series(1, 3) g;
select pg_temp.mkconv('s_old', now() - interval '4 days', now() - interval '4 days', 1, null, null, null, 'open', false, true);
select pg_temp.mkconv('s_new', now() - interval '5 minutes', now() - interval '5 minutes', 1, null, null, null, 'open', false, true);
update public.fd_app_config set value = '0'::jsonb where key = 'review_sample_percent';
select pg_temp.rec('sampler', 'at 0% only the flagged and the handed-off are queued', '3', public.service_fd_sample_reviews()::text);
select pg_temp.rec('sampler', 'a red-flag conversation is "flagged"', 'flagged', (select reason from public.fd_review_queue where conversation_id = pg_temp.f('c_s_flag')));
select pg_temp.rec('sampler', 'a conversation with a flagged message is "flagged"', 'flagged', (select reason from public.fd_review_queue where conversation_id = pg_temp.f('c_s_msg')));
select pg_temp.rec('sampler', 'a handoff is queued as "handoff"', 'handoff', (select reason from public.fd_review_queue where conversation_id = pg_temp.f('c_s_hand')));
select pg_temp.rec('sampler', 'running again queues nothing new', '0', public.service_fd_sample_reviews()::text);
create temp table expect50(n integer) on commit drop;
insert into expect50 select count(*)::integer from public.fd_conversations c
 where c.id in (select v from fx where k like 'c\_p%') and ((hashtextextended(c.id::text, 0) & 9223372036854775807) % 100) < 50;
update public.fd_app_config set value = '50'::jsonb where key = 'review_sample_percent';
select pg_temp.rec('sampler', 'at 50% exactly the hash-chosen answered conversations are added', (select n::text from expect50), public.service_fd_sample_reviews()::text);
select pg_temp.rec('sampler', 'they are marked "random_sample"', (select n::text from expect50),
  (select count(*)::text from public.fd_review_queue where reason = 'random_sample' and conversation_id in (select v from fx where k like 'c\_p%')));
select pg_temp.rec('sampler', 'an unanswered conversation is not sampled below 100%', '0',
  (select count(*)::text from public.fd_review_queue where conversation_id in (select v from fx where k like 'c\_u%')));
update public.fd_app_config set value = '100'::jsonb where key = 'review_sample_percent';
select pg_temp.rec('sampler', 'at 100% (the pilot) everything left is queued', (23 - (select n from expect50))::text, public.service_fd_sample_reviews()::text);
select pg_temp.rec('sampler', 'pilot rows are marked "pilot_full_review"', (23 - (select n from expect50))::text,
  (select count(*)::text from public.fd_review_queue where reason = 'pilot_full_review' and conversation_id in (select v from fx where k like 'c\_p%' or k like 'c\_u%')));
select pg_temp.rec('sampler', 'a conversation older than 3 days is never sampled', '0', (select count(*)::text from public.fd_review_queue where conversation_id = pg_temp.f('c_s_old')));
select pg_temp.rec('sampler', 'a conversation still in progress is never sampled', '0', (select count(*)::text from public.fd_review_queue where conversation_id = pg_temp.f('c_s_new')));

-- 7. review and incidents -----------------------------------------------------------------------------------------------------------------------
create temp table rq(k text primary key, id uuid) on commit drop;
insert into rq select 'flag', id from public.fd_review_queue where conversation_id = pg_temp.f('c_s_flag');
insert into rq select 'msg',  id from public.fd_review_queue where conversation_id = pg_temp.f('c_s_msg');
insert into rq select 'hand', id from public.fd_review_queue where conversation_id = pg_temp.f('c_s_hand');
select pg_temp.rec('review', 'a leads.manage holder cannot list reviews (they hold visitor text)', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('staff'), 'authenticated', $q$select public.fd_review_list('pending', 5)::text$q$));
select pg_temp.rec('review', 'a patient cannot list reviews', 'ERR:42501', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', $q$select public.fd_review_list('pending', 5)::text$q$));
select pg_temp.rec('review', 'an admin lists them, flagged first', 'flagged',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select (public.fd_review_list('pending', 5) -> 0 ->> 'reason')$q$));
select pg_temp.rec('review', 'the list carries the transcript', 'true',
  (select (pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select (public.fd_review_list('pending', 100))::text$q$) like '%a flagged reply%')::text));
select pg_temp.rec('review', 'a bad status is refused', 'ERR:P0001', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_review_list('weird', 5)::text$q$));
select pg_temp.rec('review', 'a leads.manage holder cannot record a verdict', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('staff'), 'authenticated', format($q$select public.fd_review_record(%L, 'ok', null)::text$q$, (select id from rq where k = 'msg'))));
select pg_temp.rec('review', 'an unknown verdict is refused', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_review_record(%L, 'fine', null)::text$q$, (select id from rq where k = 'msg'))));
select pg_temp.rec('review', '"wrong" without a note is refused', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_review_record(%L, 'wrong', '  ')::text$q$, (select id from rq where k = 'hand'))));
select pg_temp.rec('review', '"ok" records and opens no incident', 'none',
  coalesce(pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_review_record(%L, 'ok', null)::text$q$, (select id from rq where k = 'msg'))), 'none'));
select pg_temp.rec('review', 'the verdict, reviewer and time are stored', 'reviewed/ok/true/true',
  (select status || '/' || verdict || '/' || (reviewer_id = pg_temp.f('admin'))::text || '/' || (reviewed_at is not null)::text from public.fd_review_queue where id = (select id from rq where k = 'msg')));
select pg_temp.rec('review', 'a verdict is final', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_review_record(%L, 'unsafe', 'changed my mind')::text$q$, (select id from rq where k = 'msg'))));
select pg_temp.rec('review', '"wrong" with a note records and opens no incident', 'none',
  coalesce(pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_review_record(%L, 'wrong', 'quoted the old price')::text$q$, (select id from rq where k = 'hand'))), 'none'));
select pg_temp.rec('review', 'no incident exists for a merely wrong answer', '0', (select count(*)::text from public.fd_incidents where conversation_id = pg_temp.f('c_s_hand')));
create temp table inc(id uuid) on commit drop;
insert into inc select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_review_record(%L, 'unsafe', 'told the visitor a dose to take')::text$q$, (select id from rq where k = 'flag')))::uuid;
select pg_temp.rec('review', '"unsafe" opens an incident and returns it', 'true', (select (id is not null)::text from inc));
select pg_temp.rec('review', 'the incident is open, names the conversation and the reviewer', 'open/true/true',
  (select status || '/' || (conversation_id = pg_temp.f('c_s_flag'))::text || '/' || (opened_by = pg_temp.f('admin'))::text from public.fd_incidents where id = (select id from inc)));
select pg_temp.rec('review', 'the review and the incident are in the audit trail', '2',
  (select count(*)::text from public.fd_audit_log where (action = 'review_recorded' and detail ->> 'verdict' = 'unsafe') or (action = 'incident_opened' and entity_id = (select id::text from inc))));
select pg_temp.rec('review', 'a leads.manage holder cannot close an incident', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('staff'), 'authenticated', format($q$select public.fd_incident_close(%L, 'tightened the dose rule')::text$q$, (select id from inc))));
select pg_temp.rec('review', 'an incident cannot be closed without saying what was tightened', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_incident_close(%L, 'fixed')::text$q$, (select id from inc))));
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_incident_close(%L, 'Added the words dose and how many tablets to the clinical-request rules')::text$q$, (select id from inc)));
select pg_temp.rec('review', 'an admin closes it with the rule change', 'closed/true/true',
  (select status || '/' || (closed_by = pg_temp.f('admin'))::text || '/' || (rule_change like 'Added the words dose%')::text from public.fd_incidents where id = (select id from inc)));
select pg_temp.rec('review', 'closing twice is refused', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_incident_close(%L, 'Added the rule a second time')::text$q$, (select id from inc))));
-- Two statements, review row first: this proof runs in ONE transaction, and Postgres re-checks the other FK of a row inserted in the same
-- transaction while a cascade is half done. A committed incident (the real case) does not hit that.
delete from public.fd_review_queue where conversation_id = pg_temp.f('c_s_flag');
delete from public.fd_conversations where id = pg_temp.f('c_s_flag');
select pg_temp.rec('review', 'the incident outlives the conversation it came from', '1/true/true',
  (select count(*)::text || '/' || (conversation_id is null)::text || '/' || (review_id is null)::text from public.fd_incidents where id = (select id from inc) group by conversation_id, review_id));

-- 8. dashboard and config -----------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('dashboard', 'an admin reads the dashboard', 'true',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select (public.fd_dashboard() ?& array['current', 'previous', 'reports', 'incidents', 'spend_today_usd', 'review_sample_percent'])::text$q$));
select pg_temp.rec('dashboard', 'a leads.manage holder cannot', 'ERR:42501', pg_temp.as_val(pg_temp.f('staff'), 'authenticated', 'select public.fd_dashboard()::text'));
select pg_temp.rec('dashboard', 'a patient cannot', 'ERR:42501', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select public.fd_dashboard()::text'));
select pg_temp.rec('dashboard', 'anon cannot', 'ERR:42501', pg_temp.as_val(null, 'anon', 'select public.fd_dashboard()::text'));
select pg_temp.rec('config', 'review_sample_percent accepts 0', 'ok', pg_temp.cfg('review_sample_percent', '0'));
select pg_temp.rec('config', 'review_sample_percent accepts 100', 'ok', pg_temp.cfg('review_sample_percent', '100'));
select pg_temp.rec('config', 'review_sample_percent refuses 101', 'ERR:P0001', pg_temp.cfg('review_sample_percent', '101'));
select pg_temp.rec('config', 'review_sample_percent refuses -1', 'ERR:P0001', pg_temp.cfg('review_sample_percent', '-1'));
select pg_temp.rec('config', 'review_sample_percent refuses 10.5', 'ERR:P0001', pg_temp.cfg('review_sample_percent', '10.5'));
select pg_temp.rec('config', 'review_sample_percent refuses text', 'ERR:P0001', pg_temp.cfg('review_sample_percent', '"x"'));
select pg_temp.rec('config', 'an earlier key still validates (hubspot_enabled true)', 'ok', pg_temp.cfg('hubspot_enabled', 'true'));
select pg_temp.rec('config', 'an earlier key still refuses nonsense (hubspot_enabled "yes")', 'ERR:P0001', pg_temp.cfg('hubspot_enabled', '"yes"'));
select pg_temp.rec('config', 'an earlier counter still refuses 0 (weekly_send_cap)', 'ERR:P0001', pg_temp.cfg('weekly_send_cap', '0'));
select pg_temp.rec('config', 'quiet hours still validate', 'ok', pg_temp.cfg('quiet_hours', '{"start":"21:00","end":"07:00","timezone":"Africa/Lagos"}'));
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('review_sample_percent', '25'::jsonb)::text$q$);
select pg_temp.rec('config', 'an admin sets the sample share', '25', (select value #>> '{}' from public.fd_app_config where key = 'review_sample_percent'));

-- 9. retention ----------------------------------------------------------------------------------------------------------------------------------
update public.fd_app_config set value = '30'::jsonb where key = 'transcript_retention_days';
-- Everything built so far counts as recent for this section, so only the fixtures below can be purged.
select pg_temp.mkconv('ret_a', now() - interval '61 days', now() - interval '60 days', 1, 'ai_resolved', 1000, null, 'open', false, true);
select pg_temp.mkconv('ret_b', now() - interval '61 days', now() - interval '60 days', 1, 'ai_resolved', 1000, null, 'open', false, true);
select pg_temp.mkconv('ret_c', now() - interval '61 days', now() - interval '60 days', 1, 'ai_resolved', 1000, null, 'open', false, true);
select pg_temp.mkconv('ret_d', now() - interval '61 days', now() - interval '60 days', 1, 'handed_off', 1000, null, 'handed_off', false, true);
select pg_temp.mkconv('ret_e', now() - interval '61 days', now() - interval '60 days', 1, 'ai_resolved', 1000, null, 'open', false, true);
select pg_temp.mkconv('ret_f', now() - interval '11 days', now() - interval '10 days', 1, 'ai_resolved', 1000, null, 'open', false, true);
select pg_temp.mkconv('ret_g', now() - interval '61 days', now() - interval '60 days', 1, 'handed_off', 1000, null, 'handed_off', false, true);
update public.fd_conversations set last_message_at = now() where id not in (select v from fx where k like 'c\_ret\_%');
update public.fd_conversations set summary = 'Asked about pricing.' where id = pg_temp.f('c_ret_b');
insert into public.fd_messages (conversation_id, role, content) select v, 'visitor', 'old words ' || k from fx where k like 'c\_ret\_%';
insert into public.fd_messages (conversation_id, role, content) select v, 'assistant', 'old reply ' || k from fx where k like 'c\_ret\_%';
insert into public.fd_review_queue (conversation_id, reason) values (pg_temp.f('c_ret_c'), 'random_sample');
insert into public.fd_handoffs (conversation_id, reason, status) values (pg_temp.f('c_ret_d'), 'visitor_asked', 'open');
insert into public.fd_incidents (conversation_id, opened_note, opened_by) values (pg_temp.f('c_ret_e'), 'kept for the incident', pg_temp.f('admin'));
insert into public.fd_handoffs (conversation_id, reason, status, suggested_reply) values (pg_temp.f('c_ret_g'), 'visitor_asked', 'closed', 'a drafted reply');
select pg_temp.rec('retention', 'the first run purges exactly the three that nobody still needs', '3', public.service_fd_retention_purge()::text);
select pg_temp.rec('retention', 'an old finished conversation loses its messages', '0', (select count(*)::text from public.fd_messages where conversation_id = pg_temp.f('c_ret_a')));
select pg_temp.rec('retention', 'a summary stays, with a note where there was none', 'Transcript removed after the retention period.',
  (select summary from public.fd_conversations where id = pg_temp.f('c_ret_a')));
select pg_temp.rec('retention', 'an existing summary is kept as it was', 'Asked about pricing.', (select summary from public.fd_conversations where id = pg_temp.f('c_ret_b')));
select pg_temp.rec('retention', 'the conversation row and the purge time remain', 'true', (select (transcript_purged_at is not null)::text from public.fd_conversations where id = pg_temp.f('c_ret_a')));
select pg_temp.rec('retention', 'a drafted reply is removed from the handoff', 'none', coalesce((select suggested_reply from public.fd_handoffs where conversation_id = pg_temp.f('c_ret_g')), 'none'));
select pg_temp.rec('retention', 'text waiting for a review is kept', '2', (select count(*)::text from public.fd_messages where conversation_id = pg_temp.f('c_ret_c')));
select pg_temp.rec('retention', 'text behind an open handoff is kept', '2', (select count(*)::text from public.fd_messages where conversation_id = pg_temp.f('c_ret_d')));
select pg_temp.rec('retention', 'text behind an open incident is kept', '2', (select count(*)::text from public.fd_messages where conversation_id = pg_temp.f('c_ret_e')));
select pg_temp.rec('retention', 'recent text is kept', '2', (select count(*)::text from public.fd_messages where conversation_id = pg_temp.f('c_ret_f')));
select pg_temp.rec('retention', 'a second run purges nothing', '0', public.service_fd_retention_purge()::text);
select pg_temp.rec('retention', 'the purge is in the audit trail', 'true', (select (count(*) > 0)::text from public.fd_audit_log where action = 'retention_purge'));
select pg_temp.rec('retention', 'a purged conversation still counts in the numbers', 'true',
  (select ((private.fd_week_metrics(now() - interval '62 days', now() - interval '60 days 12 hours') #>> '{conversations,total}')::int >= 5)::text));

-- 10. the dispatcher trigger --------------------------------------------------------------------------------------------------------------------
delete from vault.secrets where name = 'fd_followup_secret';
select pg_temp.rec('trigger', 'without the secret the dispatcher is never called', 'false', private.fd_dispatch_wanted()::text);
select vault.create_secret('proof-secret', 'fd_followup_secret');
update public.fd_app_config set value = 'false'::jsonb where key = 'followups_enabled';
update public.fd_handoffs set alert_state = 'sent', reply_state = 'none';
update public.fd_report_runs set status = 'sent' where status in ('pending', 'sending');
select pg_temp.rec('trigger', 'with the secret and nothing to send it is not called', 'false', private.fd_dispatch_wanted()::text);
insert into public.fd_report_runs (week_start, week_end, metrics, status) values ('2024-06-03', '2024-06-10', '{}'::jsonb, 'pending');
select pg_temp.rec('trigger', 'a waiting report makes the schedule call it', 'true', private.fd_dispatch_wanted()::text);

-- 11. access ------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('access', 'an admin session cannot settle conversations (service role only)', 'ERR:42501', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select public.service_fd_settle_conversations()::text'));
select pg_temp.rec('access', 'an admin session cannot run the sampler', 'ERR:42501', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select public.service_fd_sample_reviews()::text'));
select pg_temp.rec('access', 'an admin session cannot purge', 'ERR:42501', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select public.service_fd_retention_purge()::text'));
select pg_temp.rec('access', 'an admin session cannot claim a report', 'ERR:42501', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select count(*)::text from public.service_fd_claim_reports(1)'));
select pg_temp.rec('access', 'an admin session cannot record a send', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.service_fd_finish_report(%L, true, 'x', 'y', null)::text$q$, gen_random_uuid())));
select pg_temp.rec('access', 'a patient cannot note a topic', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', format($q$select public.service_fd_chat_note_topic(%L, 'pricing')::text$q$, pg_temp.f('c_t1'))));
select pg_temp.rec('access', 'anon cannot purge', 'ERR:42501', pg_temp.as_val(null, 'anon', 'select public.service_fd_retention_purge()::text'));
select pg_temp.rec('access', 'the service role can run the sweeps', 'true', (pg_temp.as_val(null, 'service_role', 'select public.service_fd_settle_conversations()::text') ~ '^[0-9]+$')::text);
select pg_temp.rec('access', 'the metrics function is not callable from a session', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select private.fd_week_metrics(now() - interval '7 days', now())::text$q$));
select pg_temp.rec('access', 'an admin reads incidents', 'true', (pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select count(*)::text from public.fd_incidents')::int > 0)::text);
select pg_temp.rec('access', 'a leads.manage holder reads no incidents', '0', pg_temp.as_val(pg_temp.f('staff'), 'authenticated', 'select count(*)::text from public.fd_incidents'));
select pg_temp.rec('access', 'a leads.manage holder reads no review rows (their notes can quote visitors)', '0', pg_temp.as_val(pg_temp.f('staff'), 'authenticated', 'select count(*)::text from public.fd_review_queue'));
select pg_temp.rec('access', 'an admin reads the review rows', 'true', (pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select count(*)::text from public.fd_review_queue')::int > 0)::text);
select pg_temp.rec('access', 'a patient reads no incidents', '0', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select count(*)::text from public.fd_incidents'));
select pg_temp.rec('access', 'a patient cannot write an incident', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', $q$insert into public.fd_incidents (opened_note) values ('x') returning 'x'$q$));
select pg_temp.rec('access', 'the sample share survives a patient trying to set it', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', $q$select public.fd_set_config('review_sample_percent', '0'::jsonb)::text$q$));

-- 12. SABOTAGE ------------------------------------------------------------------------------------------------------------------------------------
grant execute on function public.service_fd_claim_reports(integer) to authenticated;
select pg_temp.rec('sabotage', 'SABOTAGE (a): report claim granted to authenticated, an admin session can now take the weekly report', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select count(*)::text from public.service_fd_claim_reports(1)'));

create policy fd_incidents_sabotage on public.fd_incidents for select to authenticated using (true);
select pg_temp.rec('sabotage', 'SABOTAGE (b): incidents opened to everyone, a leads.manage holder can now read them', '0',
  pg_temp.as_val(pg_temp.f('staff'), 'authenticated', 'select count(*)::text from public.fd_incidents'));

grant execute on function public.service_fd_sample_reviews() to authenticated;
select pg_temp.rec('sabotage', 'SABOTAGE (c): sampler granted to authenticated, a patient session can now fill the review queue', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select public.service_fd_sample_reviews()::text'));

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
  if v_bad > 0 then raise exception 'fd M5 proof: % check(s) failed, first: %', v_bad, v_first; end if;
end $$;

rollback;
