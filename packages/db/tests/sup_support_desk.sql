-- ===========================================================================
-- Proof: Customer Support Dashboard (SUP-1..SUP-3, migrations 20261107022501..20261107022506).
--   1. Gate: a clinician with no support key is refused the desk summary; a Care Coordinator and a support.agent are let in.
--   2. The work-items view shows a coordinator the ticket, with an SLA due time and state; an old unanswered ticket is 'breached'.
--   3. Clinical boundary: the support coordinator who can see the ticket reads none of that patient's vitals or medicines.
--   4. Assignment: self-assign allowed; assigning someone else needs support.manage; the assignee must work the desk; complaints
--      are refused (assigned in their own workflow).
--   5. Hand-offs: support raises a finance hand-off; a duplicate is refused; only finance takes ownership and records the outcome;
--      while it is open the item shows as awaiting another team.
--   6. Templates: a lead's template starts as draft and is invisible to agents; approval shows it; editing the words returns it
--      to draft as version 2; approval cannot be set by a plain update.
--   7. Reply notice: a customer-visible staff reply leaves one in-app 'support_ticket_reply' notice; an internal note leaves none.
--   8. Attachments: a restricted file disappears for an agent, stays for the lead and for the patient who uploaded it.
--   9. SABOTAGE: an open is_support_staff() lets the clinician in (so 1a discriminates); without the trigger no notice is left
--      (so 7a discriminates).
-- BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;
create temp table sup_results (check_name text, observed text, expected text, verdict text);
grant all on sup_results to public;

create function pg_temp.mkuser(p_role text, p_name text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'sup-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, v_org, p_role::public.user_role, p_name, '+23481' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), date '1980-01-01', true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = true, organisation_id = excluded.organisation_id;
  return v;
end $$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v_state text;
begin
  perform pg_temp.as_user(p_uid); execute 'set local role authenticated';
  begin execute p_sql; execute 'reset role'; return 'ok';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    execute 'reset role';
    return v_state;
  end;
end $$;
-- Runs a scalar query as p_uid under the authenticated role and returns its text value.
create function pg_temp.val_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_user(p_uid); execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into sup_results values (p_name, p_actual, p_expected, case when p_actual is not distinct from p_expected then 'PASS' else 'FAIL' end) $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  admin uuid; clin uuid; coord uuid; lead uuid; agent uuid; analyst uuid; fin uuid; pat uuid;
  v_ticket uuid; v_old uuid; v_complaint uuid; v_handoff uuid; v_tpl uuid; v_att uuid; v_help uuid; v_thread uuid;
begin
  admin := pg_temp.mkuser('admin', 'SUP Admin');
  clin  := pg_temp.mkuser('clinician', 'SUP Clinician');
  coord := pg_temp.mkuser('care_coordinator', 'SUP Coordinator');
  lead  := pg_temp.mkuser('care_coordinator', 'SUP Lead');
  agent := pg_temp.mkuser('clinician', 'SUP Clinician Agent');
  analyst := pg_temp.mkuser('analyst', 'SUP Analyst With Key');
  fin   := pg_temp.mkuser('finance', 'SUP Finance');
  pat   := pg_temp.mkuser('patient', 'SUP Patient');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values
    (lead, 'support.manage', admin), (agent, 'support.agent', admin), (analyst, 'support.agent', admin), (fin, 'finance.view', admin);

  -- Fixtures: a fresh ticket, a ticket logged two weeks ago and never answered, a complaint, clinical data.
  perform pg_temp.as_user(pat);
  insert into public.support_tickets (organisation_id, patient_id, category, priority, subject, description, created_by)
  values (v_org, pat, 'technical', 'normal', 'App will not load', 'The app shows a blank screen', pat) returning id into v_ticket;
  insert into public.support_tickets (organisation_id, patient_id, category, priority, subject, description, created_by)
  values (v_org, pat, 'technical', 'high', 'Cannot upload', 'Upload spins forever', pat) returning id into v_old;
  insert into public.complaints (organisation_id, patient_id, category, description, created_by)
  values (v_org, pat, 'communication', 'Nobody called me back about my booking', pat) returning id into v_complaint;
  insert into public.navigation_requests (organisation_id, patient_id, category, description)
  values (v_org, pat, 'payment', 'I paid but my Membership is not showing') returning id into v_help;
  v_thread := public.start_care_thread('Billing question', 'Why was I charged twice?', pat, null, null, 'billing');
  perform set_config('request.jwt.claims', '', true);
  alter table public.support_tickets disable trigger user;
  update public.support_tickets set created_at = now() - interval '14 days' where id = v_old;
  alter table public.support_tickets enable trigger user;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at)
  values (v_org, pat, 'weight', 70, now());

  -- 1. Gate
  perform pg_temp.ck('1a clinician without a support key refused', '42501', pg_temp.try_as(clin, 'select public.support_desk_summary()'));
  perform pg_temp.ck('1b coordinator let in', 'ok', pg_temp.try_as(coord, 'select public.support_desk_summary()'));
  perform pg_temp.ck('1c clinician holding support.agent let in', 'ok', pg_temp.try_as(agent, 'select public.support_desk_summary()'));
  perform pg_temp.ck('1d support.agent on an analyst account refused', '42501', pg_temp.try_as(analyst, 'select public.support_desk_summary()'));

  -- 2. The view
  perform pg_temp.ck('2a coordinator sees the ticket', '1',
    pg_temp.val_as(coord, format('select count(*) from public.support_work_items where item_id = %L', v_ticket)));
  perform pg_temp.ck('2b fresh ticket has a first-response due time', 'true',
    pg_temp.val_as(coord, format('select (first_response_due_at is not null)::text from public.support_work_items where item_id = %L', v_ticket)));
  perform pg_temp.ck('2c two-week-old unanswered ticket is breached', 'breached',
    pg_temp.val_as(coord, format('select sla_state from public.support_work_items where item_id = %L', v_old)));
  perform pg_temp.ck('2d complaint appears as high priority', 'high',
    pg_temp.val_as(coord, format('select priority from public.support_work_items where item_id = %L', v_complaint)));

  -- 3. Clinical boundary
  perform pg_temp.ck('3a support coordinator reads no vitals for the ticket''s patient', '0',
    pg_temp.val_as(coord, format('select count(*) from public.vitals_readings where patient_id = %L', pat)));
  perform pg_temp.ck('3b support coordinator reads no medicines for the ticket''s patient', '0',
    pg_temp.val_as(coord, format('select count(*) from public.medications where patient_id = %L', pat)));

  -- 4. Assignment
  perform pg_temp.ck('4a coordinator assigns to self', 'ok',
    pg_temp.try_as(coord, format('select public.assign_support_work_item(%L, %L, %L)', 'support_ticket', v_ticket, coord)));
  perform pg_temp.ck('4b coordinator cannot assign someone else', '42501',
    pg_temp.try_as(coord, format('select public.assign_support_work_item(%L, %L, %L)', 'support_ticket', v_ticket, lead)));
  perform pg_temp.ck('4c lead reassigns to coordinator', 'ok',
    pg_temp.try_as(lead, format('select public.assign_support_work_item(%L, %L, %L)', 'support_ticket', v_old, coord)));
  perform pg_temp.ck('4d assignee must work the desk', '22023',
    pg_temp.try_as(lead, format('select public.assign_support_work_item(%L, %L, %L)', 'support_ticket', v_ticket, clin)));
  perform pg_temp.ck('4e complaints are assigned in their own workflow', '22023',
    pg_temp.try_as(lead, format('select public.assign_support_work_item(%L, %L, %L)', 'complaint', v_complaint, coord)));
  perform pg_temp.ck('4f ticket now owned by coordinator', coord::text,
    (select assigned_to::text from public.support_tickets where id = v_old));
  perform pg_temp.ck('4g coordinator takes a help request', 'ok',
    pg_temp.try_as(coord, format('select public.assign_support_work_item(%L, %L, %L)', 'help_request', v_help, coord)));
  perform pg_temp.ck('4h assignment does not count as acknowledging the customer', 'new|null',
    pg_temp.val_as(coord, format('select status_group || ''|'' || coalesce(first_response_at::text, ''null'') from public.support_work_items where item_id = %L', v_help)));
  perform pg_temp.ck('4i coordinator takes a support message', 'ok',
    pg_temp.try_as(coord, format('select public.assign_support_work_item(%L, %L, %L)', 'care_thread', v_thread, coord)));
  perform pg_temp.ck('4j support message owned by coordinator', coord::text,
    (select owner_id::text from public.care_thread_owners where thread_id = v_thread));
  -- A three-week-old conversation, answered long ago, in which the patient has just written again: timed from now.
  alter table public.care_message_threads disable trigger user;
  update public.care_message_threads
     set created_at = now() - interval '21 days', awaiting_reply_since = now(), last_care_team_reply_at = now() - interval '20 days'
   where id = v_thread;
  alter table public.care_message_threads enable trigger user;
  perform pg_temp.ck('4k old conversation with a fresh message is not late', 'false',
    pg_temp.val_as(coord, format('select (sla_state = ''breached'')::text from public.support_work_items where item_id = %L', v_thread)));
  alter table public.care_message_threads disable trigger user;
  update public.care_message_threads set needs_doctor = true where id = v_thread;
  alter table public.care_message_threads enable trigger user;
  perform pg_temp.ck('4l a message waiting for a doctor stays on the doctor route', '22023',
    pg_temp.try_as(lead, format('select public.assign_support_work_item(%L, %L, %L)', 'care_thread', v_thread, lead)));

  -- 5. Hand-offs
  perform pg_temp.ck('5a coordinator raises a finance hand-off', 'ok',
    pg_temp.try_as(coord, format('select public.raise_support_handoff(%L, %L, %L, %L)', 'support_ticket', v_ticket, 'finance',
      'Patient says they were charged twice for Membership')));
  select id into v_handoff from public.support_handoffs where source_id = v_ticket;
  perform pg_temp.ck('5b duplicate hand-off refused', '23505',
    pg_temp.try_as(coord, format('select public.raise_support_handoff(%L, %L, %L, %L)', 'support_ticket', v_ticket, 'finance',
      'Asking again about the double charge')));
  perform pg_temp.ck('5c clinician cannot raise a hand-off', '42501',
    pg_temp.try_as(clin, format('select public.raise_support_handoff(%L, %L, %L, %L)', 'support_ticket', v_ticket, 'technical_ops',
      'Clinician trying to hand off a ticket')));
  perform pg_temp.ck('5d item shows as awaiting another team', 'awaiting_internal',
    pg_temp.val_as(coord, format('select status_group from public.support_work_items where item_id = %L', v_ticket)));
  perform pg_temp.ck('5e coordinator cannot take finance ownership', '42501',
    pg_temp.try_as(coord, format('select public.acknowledge_support_handoff(%L)', v_handoff)));
  perform pg_temp.ck('5f finance takes ownership', 'ok',
    pg_temp.try_as(fin, format('select public.acknowledge_support_handoff(%L)', v_handoff)));
  perform pg_temp.ck('5g finance records the outcome', 'ok',
    pg_temp.try_as(fin, format('select public.record_support_handoff_outcome(%L, %L, %L)', v_handoff,
      'Second charge found and refunded through the finance console', 'We found the second charge and have refunded it.')));
  perform pg_temp.ck('5i insert helper refuses a mismatched patient', '42501',
    pg_temp.try_as(coord, format('select private.support_handoff_insert(%L, %L, %L, %L, %L, %L)', v_org, 'support_ticket', v_old, clin, 'finance',
      'Trying to name a different patient')));
  perform pg_temp.ck('5h finance sees the hand-off but not the ticket', '1|0',
    pg_temp.val_as(fin, format('select (select count(*) from public.support_handoffs where id = %L)::text || ''|'' || (select count(*) from public.support_tickets where id = %L)::text', v_handoff, v_ticket)));

  -- 6. Templates
  perform pg_temp.as_user(lead); execute 'set local role authenticated';
  insert into public.support_response_templates (title, body, category, created_by)
  values ('We are looking into it', 'Thank you for telling us. We are looking into this and will reply soon.', 'acknowledgement', lead)
  returning id into v_tpl;
  execute 'reset role';
  perform pg_temp.ck('6a new template is draft', 'draft', (select status from public.support_response_templates where id = v_tpl));
  perform pg_temp.ck('6b agent cannot see a draft', '0',
    pg_temp.val_as(coord, format('select count(*) from public.support_response_templates where id = %L', v_tpl)));
  perform pg_temp.ck('6c plain update cannot approve', '42501',
    pg_temp.try_as(lead, format('update public.support_response_templates set status = %L where id = %L', 'approved', v_tpl)));
  perform pg_temp.ck('6d coordinator cannot approve', '42501',
    pg_temp.try_as(coord, format('select public.approve_support_response_template(%L)', v_tpl)));
  perform pg_temp.ck('6e lead approves', 'ok', pg_temp.try_as(lead, format('select public.approve_support_response_template(%L)', v_tpl)));
  perform pg_temp.ck('6f agent sees the approved template', '1',
    pg_temp.val_as(coord, format('select count(*) from public.support_response_templates where id = %L', v_tpl)));
  perform pg_temp.try_as(lead, format('update public.support_response_templates set body = %L where id = %L',
    'Thank you. We are checking this now and will reply within a working day.', v_tpl));
  perform pg_temp.ck('6g editing words returns it to draft v2', 'draft|2',
    (select status || '|' || version from public.support_response_templates where id = v_tpl));

  -- 7. Reply notice
  insert into public.support_ticket_comments (organisation_id, ticket_id, author_profile_id, author_role, body, is_internal)
  values (v_org, v_ticket, coord, 'staff', 'We are checking this for you now.', false),
         (v_org, v_ticket, coord, 'staff', 'Internal: looks like the CDN.', true);
  perform pg_temp.ck('7a one in-app notice for the customer-visible reply only', '1',
    (select count(*)::text from public.notifications where recipient_id = pat and template = 'support_ticket_reply'));
  perform pg_temp.ck('7b notice carries no reply text', 'false',
    (select (payload::text like '%checking%')::text from public.notifications where recipient_id = pat and template = 'support_ticket_reply'));

  -- 8. Attachments
  insert into public.support_ticket_attachments (organisation_id, ticket_id, storage_path, file_name, mime_type, size_bytes,
    content_sha256, scan_status, uploaded_by, uploader_role)
  values (v_org, v_ticket, 'proof/' || gen_random_uuid() || '.pdf', 'lab-result.pdf', 'application/pdf', 1000,
    repeat('a', 64), 'clean', pat, 'patient') returning id into v_att;
  perform pg_temp.ck('8a agent cannot restrict', '42501',
    pg_temp.try_as(coord, format('select public.restrict_support_attachment(%L, %L)', v_att, 'This is a clinical document')));
  perform pg_temp.ck('8b lead restricts', 'ok',
    pg_temp.try_as(lead, format('select public.restrict_support_attachment(%L, %L)', v_att, 'Clinical document attached by mistake')));
  perform pg_temp.ck('8c coordinator no longer sees it', '0',
    pg_temp.val_as(coord, format('select count(*) from public.support_ticket_attachments where id = %L', v_att)));
  perform pg_temp.ck('8d lead still sees it', '1',
    pg_temp.val_as(lead, format('select count(*) from public.support_ticket_attachments where id = %L', v_att)));
  perform pg_temp.ck('8e patient still sees their own upload', '1',
    pg_temp.val_as(pat, format('select count(*) from public.support_ticket_attachments where id = %L', v_att)));

  -- 9. Sabotage
  execute 'create or replace function private.is_support_staff() returns boolean language sql stable security definer set search_path to '''' as $f$ select true $f$';
  perform pg_temp.ck('9a SABOTAGE open gate: clinician let in', 'ok', pg_temp.try_as(clin, 'select public.support_desk_summary()'));
  drop trigger support_ticket_comments_reply_notice on public.support_ticket_comments;
  insert into public.support_ticket_comments (organisation_id, ticket_id, author_profile_id, author_role, body, is_internal)
  values (v_org, v_ticket, coord, 'staff', 'A second reply.', false);
  perform pg_temp.ck('9b SABOTAGE no trigger: still one notice', '1',
    (select count(*)::text from public.notifications where recipient_id = pat and template = 'support_ticket_reply'));
end $$;

select * from sup_results order by check_name;

do $$
declare v_fail text;
begin
  select string_agg(check_name || ' (expected ' || coalesce(expected, 'null') || ', got ' || coalesce(observed, 'null') || ')', '; ')
    into v_fail from sup_results where verdict <> 'PASS';
  if v_fail is not null then raise exception 'Support desk proof FAILED: %', v_fail; end if;
end $$;

rollback;
