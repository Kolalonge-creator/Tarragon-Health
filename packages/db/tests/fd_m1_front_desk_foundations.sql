-- ===========================================================================
-- Proof: Front Desk M1 foundations (migration 20261101231549_fd_m1_front_desk_foundations.sql).
-- Spec acceptance check: "RLS tests prove anon users read nothing."
--
-- Proves, with simulated sessions in one rolled-back transaction:
--   1. ANON READS NOTHING: every one of the 14 fd_ tables refuses anon (42501). A patient reads zero rows of the seeded tables.
--   2. STAFF SCOPE: an admin reads the seeds; a leads.manage holder reads their OWN organisation's contact and not another
--      organisation's (control: the same holder sees their own).
--   3. NOBODY WRITES DIRECTLY: authenticated cannot insert/update the tables, not even an admin (writes go through the RPCs).
--   4. RPCs: a patient and anon are refused (42501); an admin can set config, and the change is audited WITH its value.
--   5. APPROVAL GATE: seeds are draft; an admin approves; editing the wording through the RPC returns it to draft and clears the
--      approver; a CONTROL schedule-only change keeps the approval; a placeholder outside {{first_name}}/{{link}} is refused.
--   6. KNOWLEDGE: unapproved at seed; approving makes exactly one active version per topic; text cannot be edited in place; a new
--      version supersedes the old; an unknown placeholder is refused.
--   7. AUDIT LOG IS APPEND ONLY (update, delete and truncate all refused, even for the table owner).
--   8. CONSTRAINTS: one live consent per contact/channel/purpose; withdrawing frees the slot; contact email must be lower case;
--      a contact needs an email or phone; suppressed needs a reason; the language is English; the channel has no sms.
--   9. SABOTAGE (each check MUST flip): (a) reset-approval trigger dropped; (b) INSERT granted to authenticated on fd_contacts;
--      (c) audit-log append-only trigger dropped; (d) approval gate loosened from admin-only to any leads.manage holder.
--  10. Delegated staff (leads.manage) can draft wording and switch the assistant OFF, but cannot approve, enable sends or switch it back on;
--      config values are validated per key; stop_events must be real funnel event types.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. Fails loudly (raise exception) and prints a verdict table.
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

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_org2 uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_staff2 uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.organisations where id = v_org) then raise exception 'fixture FAIL: default organisation missing'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'Front Desk Other Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'fd-m1-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_admin, v_pat, v_staff, v_staff2]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_admin,  v_org,  'admin',            'FD Admin',        '+2348058882701'),
    (v_pat,    v_org,  'patient',          'FD Patient',      '+2348058882702'),
    (v_staff,  v_org,  'care_coordinator', 'FD Staff',        '+2348058882703'),
    (v_staff2, v_org2, 'care_coordinator', 'FD Foreign Staff','+2348058882704')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.user_permission_grants (profile_id, permission_key, granted_by)
  select p, 'leads.manage', v_admin from unnest(array[v_staff, v_staff2]) p;
  insert into public.fd_contacts (id, organisation_id, email, source) values
    ('00000000-0000-4000-8000-0000000f1001', v_org,  'fd-own@example.invalid',     'website_form'),
    ('00000000-0000-4000-8000-0000000f1002', v_org2, 'fd-foreign@example.invalid', 'website_form');
  insert into fx values ('admin', v_admin), ('pat', v_pat), ('staff', v_staff), ('staff2', v_staff2);
end $$;

-- 1. anon reads nothing ---------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fd_app_config','fd_audit_log','fd_contacts','fd_consents','fd_conversations','fd_messages','fd_handoffs','fd_review_queue',
                           'fd_knowledge','fd_funnel_events','fd_sequences','fd_sequence_steps','fd_followup_runs','fd_report_runs'] loop
    perform pg_temp.rec('anon', 'anon is refused on ' || t, 'ERR:42501', pg_temp.as_val(null, 'anon', format('select count(*)::text from public.%I', t)));
  end loop;
end $$;
select pg_temp.rec('anon', 'a patient reads zero config rows', '0', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select count(*)::text from public.fd_app_config'));
select pg_temp.rec('anon', 'a patient reads zero sequence steps', '0', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select count(*)::text from public.fd_sequence_steps'));
select pg_temp.rec('anon', 'a patient reads zero knowledge rows', '0', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select count(*)::text from public.fd_knowledge'));
select pg_temp.rec('anon', 'a patient reads zero contacts', '0', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select count(*)::text from public.fd_contacts'));

-- 2. staff scope ------------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('staff', 'an admin reads the seeded sequence steps', 'true',
  (pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select count(*)::text from public.fd_sequence_steps')::int >= 15)::text);
select pg_temp.rec('staff', 'an admin reads the seeded config', 'true',
  (pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select count(*)::text from public.fd_app_config')::int >= 10)::text);
select pg_temp.rec('staff', 'CONTROL a leads.manage holder reads their own organisation''s contact', '1',
  pg_temp.as_val(pg_temp.f('staff'), 'authenticated', $q$select count(*)::text from public.fd_contacts where email = 'fd-own@example.invalid'$q$));
select pg_temp.rec('staff', 'a leads.manage holder cannot read another organisation''s contact', '0',
  pg_temp.as_val(pg_temp.f('staff'), 'authenticated', $q$select count(*)::text from public.fd_contacts where email = 'fd-foreign@example.invalid'$q$));
select pg_temp.rec('staff', 'the foreign holder reads their own and not ours', '1/0',
  pg_temp.as_val(pg_temp.f('staff2'), 'authenticated', $q$select (select count(*) from public.fd_contacts where email = 'fd-foreign@example.invalid') || '/' || (select count(*) from public.fd_contacts where email = 'fd-own@example.invalid')$q$));

-- 3. nobody writes directly -----------------------------------------------------------------------------------------------------------------
select pg_temp.rec('writes', 'an admin cannot insert a contact directly', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$insert into public.fd_contacts (email) values ('x@example.invalid')$q$));
select pg_temp.rec('writes', 'an admin cannot update config directly', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$update public.fd_app_config set value = 'false'::jsonb where key = 'assistant_enabled'$q$));
select pg_temp.rec('writes', 'a patient cannot insert a message', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', $q$insert into public.fd_messages (conversation_id, role, content) values (gen_random_uuid(), 'visitor', 'x')$q$));
select pg_temp.rec('writes', 'an admin cannot delete from the audit log', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'delete from public.fd_audit_log'));

-- 4. RPCs + audit -----------------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('rpc', 'a patient cannot set config (42501)', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', $q$select public.fd_set_config('assistant_enabled', 'false'::jsonb)::text$q$));
select pg_temp.rec('rpc', 'anon cannot set config', 'ERR:42501',
  pg_temp.as_val(null, 'anon', $q$select public.fd_set_config('assistant_enabled', 'false'::jsonb)::text$q$));
select pg_temp.rec('rpc', 'CONTROL the kill switch starts on', 'true',
  (select value::text from public.fd_app_config where key = 'assistant_enabled'));
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('assistant_enabled', 'false'::jsonb)::text$q$);
select pg_temp.rec('rpc', 'an admin can flip the kill switch', 'false', (select value::text from public.fd_app_config where key = 'assistant_enabled'));
select pg_temp.rec('rpc', 'the flip is audited WITH the new value and the actor', 'false/true',
  (select (detail -> 'value')::text || '/' || (actor_id = pg_temp.f('admin'))::text from public.fd_audit_log
    where entity = 'fd_app_config' and entity_id = 'assistant_enabled' order by id desc limit 1));
select pg_temp.rec('rpc', 'an unknown config key is refused', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('no_such_key', '1'::jsonb)::text$q$));

-- 4b. delegated staff (leads.manage) may switch the assistant OFF and draft wording, but never approve or enable sends -------------------------------------------
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('assistant_enabled', 'true'::jsonb)::text$q$);
select pg_temp.as_val(pg_temp.f('staff'), 'authenticated', $q$select public.fd_set_config('assistant_enabled', 'false'::jsonb)::text$q$);
select pg_temp.rec('staffgate', 'delegated staff can switch the assistant OFF (kill switch stays reachable)', 'false',
  (select value::text from public.fd_app_config where key = 'assistant_enabled'));
select pg_temp.rec('staffgate', 'delegated staff cannot switch it back ON', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('staff'), 'authenticated', $q$select public.fd_set_config('assistant_enabled', 'true'::jsonb)::text$q$));
select pg_temp.rec('staffgate', 'delegated staff cannot turn follow-up sending on', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('staff'), 'authenticated', $q$select public.fd_set_config('followups_enabled', 'true'::jsonb)::text$q$));
select pg_temp.rec('staffgate', 'delegated staff cannot take follow-ups out of dry-run', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('staff'), 'authenticated', $q$select public.fd_set_config('followups_dry_run', 'false'::jsonb)::text$q$));
select pg_temp.rec('staffgate', 'delegated staff cannot approve a sequence step', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('staff'), 'authenticated',
    $q$select public.fd_approve_sequence_step((select id from public.fd_sequence_steps where step_key = 'welcome_1'))::text$q$));
select pg_temp.rec('staffgate', 'delegated staff cannot approve knowledge', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('staff'), 'authenticated',
    $q$select public.fd_approve_knowledge((select id from public.fd_knowledge where topic = 'launch' and version = 1))::text$q$));
select pg_temp.rec('staffgate', 'CONTROL delegated staff can save a draft step', 'ok',
  case when pg_temp.as_val(pg_temp.f('staff'), 'authenticated',
    $q$select public.fd_save_sequence_step((select id from public.fd_sequence_steps where step_key = 'welcome_1'), 'Welcome to TarragonHealth', 'Hello {{first_name}}, welcome. Open the app here: {{link}}')::text$q$) like 'ERR:%' then 'refused' else 'ok' end);
select pg_temp.rec('staffgate', 'CONTROL delegated staff can save a knowledge draft', 'ok',
  case when pg_temp.as_val(pg_temp.f('staff'), 'authenticated', $q$select public.fd_save_knowledge('contact_details', 'Email hello@tarragonhealth.ng and a person will reply.')::text$q$) like 'ERR:%' then 'refused' else 'ok' end);

-- 4c. config values are validated per key ---------------------------------------------------------------------------------------------------------------
select pg_temp.rec('config', 'a boolean key refuses text', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('assistant_enabled', '"no"'::jsonb)::text$q$));
select pg_temp.rec('config', 'a cap refuses a negative number', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('weekly_send_cap', '-1'::jsonb)::text$q$));
select pg_temp.rec('config', 'a cap refuses text', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('weekly_send_cap', '"three"'::jsonb)::text$q$));
select pg_temp.rec('config', 'a cap refuses a fraction', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('weekly_send_cap', '2.5'::jsonb)::text$q$));
select pg_temp.rec('config', 'the spend cap refuses zero', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('daily_model_spend_cap_usd', '0'::jsonb)::text$q$));
select pg_temp.rec('config', 'quiet hours refuse a malformed time', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('quiet_hours', '{"start":"9pm","end":"07:00","timezone":"Africa/Lagos"}'::jsonb)::text$q$));
select pg_temp.rec('config', 'the launch date refuses a non-date', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('launch_date', '"soon"'::jsonb)::text$q$));
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('weekly_send_cap', '2'::jsonb)::text$q$);
select pg_temp.rec('config', 'CONTROL a valid cap is accepted', '2', (select value::text from public.fd_app_config where key = 'weekly_send_cap'));
select pg_temp.rec('config', 'a sequence stop event must be a real funnel event type', 'ERR:23514',
  pg_temp.as_val(null, 'postgres', $q$update public.fd_sequences set stop_events = array['onboarding_complete'] where key = 'finish_signup' returning 'updated'$q$));
select pg_temp.rec('config', 'CONTROL a real funnel event type is accepted', 'updated',
  pg_temp.as_val(null, 'postgres', $q$update public.fd_sequences set stop_events = array['onboarding_completed'] where key = 'finish_signup' returning 'updated'$q$));

-- 5. approval gate on sequence steps -----------------------------------------------------------------------------------------------------------
select pg_temp.rec('gate', 'every seeded step is draft', '0', (select count(*)::text from public.fd_sequence_steps where status <> 'draft'));
select pg_temp.rec('gate', 'follow-ups start OFF and in dry-run', 'false/true',
  (select (select value::text from public.fd_app_config where key = 'followups_enabled') || '/' || (select value::text from public.fd_app_config where key = 'followups_dry_run')));
create temp table pick(id uuid) on commit drop;
grant all on pick to public;
insert into pick select id from public.fd_sequence_steps where step_key = 'finish_signup_1';
select pg_temp.rec('gate', 'a patient cannot approve a step', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', format($q$select public.fd_approve_sequence_step(%L)::text$q$, (select id from pick))));
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_approve_sequence_step(%L)::text$q$, (select id from pick)));
select pg_temp.rec('gate', 'an admin approves; the approver is recorded', 'approved/true',
  (select status || '/' || (approved_by = pg_temp.f('admin') and approved_at is not null)::text from public.fd_sequence_steps where id = (select id from pick)));
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated',
  format($q$select public.fd_save_sequence_step(%L, 'A new subject line', 'Hello {{first_name}}, this is rewritten wording that is long enough. {{link}}')::text$q$, (select id from pick)));
select pg_temp.rec('gate', 'editing approved wording returns the step to draft', 'draft/true',
  (select status || '/' || (approved_by is null and approved_at is null)::text from public.fd_sequence_steps where id = (select id from pick)));
update public.fd_sequence_steps set status = 'approved', approved_by = pg_temp.f('admin'), approved_at = now() where id = (select id from pick);
update public.fd_sequence_steps set delay_minutes = 90 where id = (select id from pick);
select pg_temp.rec('gate', 'CONTROL a delay-only change keeps the approval', 'approved',
  (select status from public.fd_sequence_steps where id = (select id from pick)));
select pg_temp.rec('gate', 'a placeholder outside {{first_name}} and {{link}} is refused', 'ERR:23514',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated',
    format($q$select public.fd_save_sequence_step(%L, 'Subject line here', 'Hello {{secret}} this body is long enough to pass the length check')::text$q$, (select id from pick))));
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_sequence_paused('welcome', true)::text$q$);
select pg_temp.rec('gate', 'an admin can pause a sequence', 'true', (select paused::text from public.fd_sequences where key = 'welcome'));
select pg_temp.rec('gate', 'the pause is audited', 'true',
  (select exists (select 1 from public.fd_audit_log a join public.fd_sequences q on q.id::text = a.entity_id
                   where a.entity = 'fd_sequences' and q.key = 'welcome' and (a.detail ->> 'paused')::boolean)::text));
select pg_temp.rec('gate', 'a patient cannot pause a sequence', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', $q$select public.fd_set_sequence_paused('welcome', false)::text$q$));

-- 6. knowledge ---------------------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('knowledge', 'every seeded entry is unapproved and inactive', '0',
  (select count(*)::text from public.fd_knowledge where active or approved_by is not null));
create temp table kid(id uuid) on commit drop;
grant all on kid to public;
insert into kid select id from public.fd_knowledge where topic = 'launch' and version = 1;
select pg_temp.rec('knowledge', 'a patient cannot approve knowledge', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', format($q$select public.fd_approve_knowledge(%L)::text$q$, (select id from kid))));
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', format($q$select public.fd_approve_knowledge(%L)::text$q$, (select id from kid)));
select pg_temp.rec('knowledge', 'approving makes version 1 active', 'true',
  (select active::text from public.fd_knowledge where topic = 'launch' and version = 1));
select pg_temp.rec('knowledge', 'approved text cannot be edited in place', 'ERR:55000',
  pg_temp.as_val(null, 'postgres', $q$update public.fd_knowledge set content = 'Changed in place, long enough to pass the check.' where topic = 'launch' and version = 1$q$));
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_save_knowledge('launch', 'The platform opens on {{launch_date}}. Join the waitlist to hear first.')::text$q$);
select pg_temp.rec('knowledge', 'saving creates version 2, inactive and unapproved', '2/false/true',
  (select max(version)::text || '/' || bool_or(active and version = 2)::text || '/' || bool_or(not active and version = 2 and approved_by is null)::text
     from public.fd_knowledge where topic = 'launch'));
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated',
  format($q$select public.fd_approve_knowledge(%L)::text$q$, (select id from public.fd_knowledge where topic = 'launch' and version = 2)));
select pg_temp.rec('knowledge', 'approving version 2 supersedes version 1: exactly one active', '1/2',
  (select count(*)::text || '/' || max(version)::text from public.fd_knowledge where topic = 'launch' and active));
select pg_temp.rec('knowledge', 'a placeholder outside the allowed four is refused', 'ERR:23514',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_save_knowledge('launch', 'The price is {{secret_price}} for everyone who joins us.')::text$q$));
select pg_temp.rec('knowledge', 'a patient cannot save knowledge', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', $q$select public.fd_save_knowledge('launch', 'A patient trying to write knowledge text here.')::text$q$));

-- 7. audit log is append only -----------------------------------------------------------------------------------------------------------------
select pg_temp.rec('audit', 'update on the audit log is refused even for the owner', 'ERR:55000',
  pg_temp.as_val(null, 'postgres', 'update public.fd_audit_log set action = action'));
select pg_temp.rec('audit', 'delete on the audit log is refused even for the owner', 'ERR:55000',
  pg_temp.as_val(null, 'postgres', 'delete from public.fd_audit_log'));
select pg_temp.rec('audit', 'truncate on the audit log is refused even for the owner', 'ERR:55000',
  pg_temp.as_val(null, 'postgres', 'truncate public.fd_audit_log'));

-- 8. constraints --------------------------------------------------------------------------------------------------------------------------------
insert into public.fd_consents (contact_id, channel, purpose, lawful_basis, evidence_hash, wording_version, source)
values ('00000000-0000-4000-8000-0000000f1001', 'email', 'marketing', 'consent', repeat('a', 64), 'v1', 'proof');
select pg_temp.rec('rules', 'a second live consent for the same contact, channel and purpose is refused', 'ERR:23505',
  pg_temp.as_val(null, 'postgres', $q$insert into public.fd_consents (contact_id, channel, purpose, lawful_basis, evidence_hash, wording_version, source)
    values ('00000000-0000-4000-8000-0000000f1001', 'email', 'marketing', 'consent', repeat('b', 64), 'v1', 'proof')$q$));
update public.fd_consents set withdrawn_at = now() where contact_id = '00000000-0000-4000-8000-0000000f1001';
select pg_temp.rec('rules', 'once withdrawn, a fresh consent is allowed', 'ok',
  case when pg_temp.as_val(null, 'postgres', $q$insert into public.fd_consents (contact_id, channel, purpose, lawful_basis, evidence_hash, wording_version, source)
    values ('00000000-0000-4000-8000-0000000f1001', 'email', 'marketing', 'consent', repeat('c', 64), 'v2', 'proof') returning 'ok'$q$) = 'ok' then 'ok' else 'bad' end);
select pg_temp.rec('rules', 'there is no sms consent channel', 'ERR:23514',
  pg_temp.as_val(null, 'postgres', $q$insert into public.fd_consents (contact_id, channel, purpose, lawful_basis, evidence_hash, wording_version, source)
    values ('00000000-0000-4000-8000-0000000f1001', 'sms', 'marketing', 'consent', repeat('d', 64), 'v1', 'proof')$q$));
select pg_temp.rec('rules', 'a contact email must be lower case', 'ERR:23514',
  pg_temp.as_val(null, 'postgres', $q$insert into public.fd_contacts (email) values ('Upper@Example.invalid')$q$));
select pg_temp.rec('rules', 'a contact needs an email or a phone', 'ERR:23514',
  pg_temp.as_val(null, 'postgres', $q$insert into public.fd_contacts (name) values ('No Channel')$q$));
select pg_temp.rec('rules', 'suppressed needs a reason', 'ERR:23514',
  pg_temp.as_val(null, 'postgres', $q$insert into public.fd_contacts (email, suppressed) values ('sup@example.invalid', true)$q$));
select pg_temp.rec('rules', 'the language is English only', 'ERR:23514',
  pg_temp.as_val(null, 'postgres', $q$insert into public.fd_contacts (email, language) values ('lang@example.invalid', 'pcm')$q$));
select pg_temp.rec('rules', 'a duplicate email in one organisation is refused', 'ERR:23505',
  pg_temp.as_val(null, 'postgres', $q$insert into public.fd_contacts (email) values ('fd-own@example.invalid')$q$));
select pg_temp.rec('rules', 'a run cannot be skipped without a reason', 'ERR:23514',
  pg_temp.as_val(null, 'postgres', format($q$insert into public.fd_followup_runs (contact_id, sequence_id, step_id, enrolment_key, state, scheduled_for)
    values ('00000000-0000-4000-8000-0000000f1001', %L, %L, 'proof:1', 'skipped', now())$q$,
    (select sequence_id from public.fd_sequence_steps where step_key = 'welcome_1'), (select id from public.fd_sequence_steps where step_key = 'welcome_1'))));
select pg_temp.rec('rules', 'a reviewed queue row needs a verdict and a reviewer', 'ERR:23514',
  pg_temp.as_val(null, 'postgres', format($q$insert into public.fd_review_queue (conversation_id, reason, status) values (%L, 'flagged', 'reviewed')$q$, gen_random_uuid())));

-- 9. SABOTAGE (expected = the healthy value; a flip is the proof the check can fail) -------------------------------------------------------------------
drop trigger fd_sequence_steps_reset_approval on public.fd_sequence_steps;
update public.fd_sequence_steps set status = 'approved', approved_by = pg_temp.f('admin'), approved_at = now() where step_key = 'risk_check_2';
update public.fd_sequence_steps set body_text = body_text || E'\n\nSabotage edit.' where step_key = 'risk_check_2';
select pg_temp.rec('sabotage', 'SABOTAGE (a): reset trigger dropped, edited wording no longer returns to draft', 'draft',
  (select status from public.fd_sequence_steps where step_key = 'risk_check_2'));

-- Two independent locks guard writes (no INSERT grant AND no insert policy); the sabotage removes both so the check has something to catch.
grant insert on public.fd_contacts to authenticated;
alter table public.fd_contacts disable row level security;
select pg_temp.rec('sabotage', 'SABOTAGE (b): INSERT granted and RLS off, a patient can now insert a contact', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', $q$insert into public.fd_contacts (email) values ('sab@example.invalid') returning 'inserted'$q$));

drop trigger fd_audit_log_no_update_delete on public.fd_audit_log;
select pg_temp.rec('sabotage', 'SABOTAGE (c): append-only trigger dropped, the audit log can now be edited', 'ERR:55000',
  pg_temp.as_val(null, 'postgres', $q$update public.fd_audit_log set action = action where id = (select min(id) from public.fd_audit_log) returning 'updated'$q$));

-- (d) the admin-only gate loosened to any leads.manage holder: delegated staff can then approve wording.
create or replace function private.fd_require_admin() returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (private.is_admin() or private.has_permission('leads.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;
select pg_temp.rec('sabotage', 'SABOTAGE (d): approval gate loosened, delegated staff can now approve a step', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('staff'), 'authenticated',
    $q$select public.fd_approve_sequence_step((select id from public.fd_sequence_steps where step_key = 'welcome_1'))::text$q$));

-- Verdict ---------------------------------------------------------------------------------------------------------------------------------------
select phase, check_name, expected, actual,
       case when phase = 'sabotage' then case when expected is distinct from actual then 'PASS (caught)' else 'FAIL (sabotage not detected)' end
            when expected = actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;

do $$
declare v_bad int; v_first text;
begin
  select count(*), min(check_name) into v_bad, v_first from results
   where (phase <> 'sabotage' and expected is distinct from actual)
      or (phase = 'sabotage' and expected is not distinct from actual);
  if v_bad > 0 then raise exception 'fd M1 proof: % check(s) failed, first: %', v_bad, v_first; end if;
end $$;

rollback;
