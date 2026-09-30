-- ===========================================================================
-- Proof: 20260930*_s03_assisted_recovery.sql (v5 S03 function 1.6; INV-07, INV-08, INV-10).
--
-- Proves, against the real migrated schema, with simulated sessions per role:
--   1. Non-admin roles (patient, clinician, lab partner) are refused and the refusal is audited.
--   2. A requester cannot approve or review their own request; a request cannot target oneself, an admin or a
--      clinician; only one open request per subject; email method needs a verified email on file.
--   3. A second admin approves; execute works once; executed and rejected are terminal (RPC and trigger).
--   4. Expired requests cannot be approved or executed (lazily marked expired).
--   5. SIM-swap risk (phone reverified in the last 72 hours) needs a separate review step by someone other than
--      the requester before approval; also enforced by a CHECK.
--   6. Every step writes audit_log with subject_patient_id, reason and the request id.
--   7. No RPC output contains a full phone, email or date of birth; list shows masked hints only.
--   8. The subject is notified in-app (and by email when an address is on file), never SMS, in neutral wording.
--   9. Read access: only an admin reads the table; anon has no table access and no EXECUTE anywhere.
--  10. SABOTAGE x5, each proving its check can fail: drop the different-admin CHECK, disable the state trigger,
--      regrant a direct write path, expose the audit helper, grant EXECUTE to PUBLIC.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create function pg_temp.call_as(p_uid uuid, p_sql text) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into j;
  execute 'reset role';
  return j;
end $$;

do $$
declare
  v_org uuid;
  a1 uuid := gen_random_uuid();   -- admin 1 (requester)
  a2 uuid := gen_random_uuid();   -- admin 2 (approver)
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_noemail uuid := gen_random_uuid();
  v_swap uuid := gen_random_uuid();
  v_clin uuid := gen_random_uuid();
  v_partner uuid := gen_random_uuid();
  v_pat3 uuid := gen_random_uuid();
  checks jsonb := '{"date_of_birth":true,"last_payment_reference":true,"callback_to_verified_number":false}';
  r jsonb; rid uuid; rid2 uuid; v_n integer; v_txt text; v_failed boolean; v_state text; v_sq text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (a1, 's03r-a1@example.invalid', 'x', now(), null, null, now() - interval '30 days', '{}', '{}'),
    (a2, 's03r-a2@example.invalid', 'x', now(), null, null, now() - interval '30 days', '{}', '{}'),
    (v_pat,  's03r-pat@example.invalid',  'x', now(), null, null, now() - interval '30 days', '{}', '{}'),
    (v_pat2, 's03r-pat2@example.invalid', 'x', now(), null, null, now() - interval '30 days', '{}', '{}'),
    (v_noemail, null, 'x', null, null, null, now() - interval '30 days', '{}', '{}'),
    (v_swap, 's03r-swap@example.invalid', 'x', now(), '2348011119999', now() - interval '5 hours', now() - interval '30 days', '{}', '{}'),
    (v_clin, 's03r-clin@example.invalid', 'x', now(), null, null, now(), '{}', '{}'),
    (v_partner, 's03r-partner@example.invalid', 'x', now(), null, null, now(), '{}', '{}'),
    (v_pat3, 's03r-pat3@example.invalid', 'x', now(), null, null, now() - interval '30 days', '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth) values
    (a1, v_org, 'admin', 'S03R Admin One', '+2348011110011', null),
    (a2, v_org, 'admin', 'S03R Admin Two', '+2348011110012', null),
    (v_pat,  v_org, 'patient', 'S03R Patient One', '+2348011110001', '1990-01-01'),
    (v_pat2, v_org, 'patient', 'S03R Patient Two', '+2348011110002', '1991-02-02'),
    (v_noemail, v_org, 'patient', 'S03R No Email', '+2348011110003', '1992-03-03'),
    (v_swap, v_org, 'patient', 'S03R Swap', '+2348011119999', '1993-04-04'),
    (v_clin, v_org, 'clinician', 'S03R Clinician', '+2348011110013', null),
    (v_partner, v_org, 'lab_partner', 'S03R Partner', '+2348011110014', null),
    (v_pat3, v_org, 'patient', 'S03R Patient Three', '+2348011110004', '1994-05-05')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, phone = excluded.phone, date_of_birth = excluded.date_of_birth;

  -- ===== 1. non-admin roles refused, refusal audited
  foreach rid in array array[v_pat, v_clin, v_partner] loop
    r := pg_temp.call_as(rid, format('select public.request_assisted_recovery(%L, %L, %L::jsonb, %L)', v_pat2, 'a perfectly long enough reason text', checks, 'email_link_to_verified_email'));
    if (r->>'ok')::boolean or r->>'error' <> 'not_authorised' then raise exception 'FAIL 1: non-admin % was not refused: %', rid, r; end if;
    select count(*) into v_n from public.audit_log where actor_id = rid and action = 'admin.recovery_request' and result = 'denied';
    if v_n < 1 then raise exception 'FAIL 1: refusal of % not audited', rid; end if;
  end loop;
  if (select count(*) from public.account_recovery_requests where subject_user_id = v_pat2) <> 0 then raise exception 'FAIL 1: a refused call created a row'; end if;

  -- ===== 2. request validity
  r := pg_temp.call_as(a1, format('select public.request_assisted_recovery(%L, %L, %L::jsonb, %L)', a1, 'a perfectly long enough reason text', checks, 'email_link_to_verified_email'));
  if r->>'error' <> 'cannot_recover_own_account' then raise exception 'FAIL 2a: admin could target self: %', r; end if;
  r := pg_temp.call_as(a1, format('select public.request_assisted_recovery(%L, %L, %L::jsonb, %L)', a2, 'a perfectly long enough reason text', checks, 'email_link_to_verified_email'));
  if r->>'error' <> 'subject_not_eligible' then raise exception 'FAIL 2b: an admin was a valid subject: %', r; end if;
  r := pg_temp.call_as(a1, format('select public.request_assisted_recovery(%L, %L, %L::jsonb, %L)', v_clin, 'a perfectly long enough reason text', checks, 'email_link_to_verified_email'));
  if r->>'error' <> 'subject_not_eligible' then raise exception 'FAIL 2b: a clinician was a valid subject: %', r; end if;
  r := pg_temp.call_as(a1, format('select public.request_assisted_recovery(%L, %L, %L::jsonb, %L)', v_noemail, 'a perfectly long enough reason text', checks, 'email_link_to_verified_email'));
  if r->>'error' <> 'no_verified_email_on_file' then raise exception 'FAIL 2c: email method accepted with no verified email: %', r; end if;
  v_failed := false;
  begin
    perform pg_temp.call_as(a1, format('select public.request_assisted_recovery(%L, %L, %L::jsonb, %L)', v_pat, 'too short', checks, 'email_link_to_verified_email'));
  exception when others then v_failed := true; execute 'reset role'; end;
  if not v_failed then raise exception 'FAIL 2d: short reason accepted'; end if;
  v_failed := false;
  begin
    perform pg_temp.call_as(a1, format('select public.request_assisted_recovery(%L, %L, %L::jsonb, %L)', v_pat, 'a perfectly long enough reason text', '{"date_of_birth":true}', 'email_link_to_verified_email'));
  exception when others then v_failed := true; execute 'reset role'; end;
  if not v_failed then raise exception 'FAIL 2e: a single identity check was accepted'; end if;

  -- ===== happy path: request
  r := pg_temp.call_as(a1, format('select public.request_assisted_recovery(%L, %L, %L::jsonb, %L)', v_pat, 'a perfectly long enough reason text', checks, 'email_link_to_verified_email'));
  if not (r->>'ok')::boolean then raise exception 'FAIL: admin request refused: %', r; end if;
  rid := (r->>'request_id')::uuid;
  v_txt := r::text;
  if v_txt like '%example.invalid%' or v_txt like '%+234801%' or v_txt like '%1990%' then raise exception 'FAIL 7: request output leaked contact or DOB: %', v_txt; end if;
  r := pg_temp.call_as(a1, format('select public.request_assisted_recovery(%L, %L, %L::jsonb, %L)', v_pat, 'a perfectly long enough reason text', checks, 'new_phone_reverification'));
  if r->>'error' <> 'request_already_open' then raise exception 'FAIL 2f: a second open request was allowed: %', r; end if;

  -- ===== 8. notices to the subject: in_app + email, non_clinical, never sms, neutral
  select count(*) into v_n from public.notifications where recipient_id = v_pat and template = 'security.assisted_recovery_requested' and channel in ('in_app','email') and content_class = 'non_clinical';
  if v_n <> 2 then raise exception 'FAIL 8: expected in_app + email notice for subject, got %', v_n; end if;
  if exists (select 1 from public.notifications where recipient_id in (v_pat, a1, a2) and channel in ('sms','voice','push') and template like 'security.assisted_recovery_%') then raise exception 'FAIL 8: a non-permitted channel was used'; end if;
  if exists (select 1 from public.notifications where template like 'security.assisted_recovery_%' and payload::text ~* '(diabet|hiv|hypertens|pregnan|cancer|result|reading|medicat|dose)') then raise exception 'FAIL 8: notice wording named a clinical term (INV-07)'; end if;
  if exists (select 1 from public.notifications where template like 'security.assisted_recovery_%' and recipient_id in (a1, a2)) then raise exception 'FAIL 8: notice went to an admin instead of the subject'; end if;

  -- ===== 3. self-approval refused; second admin approves; execute once
  r := pg_temp.call_as(a1, format('select public.approve_assisted_recovery(%L)', rid));
  if r->>'error' <> 'requester_cannot_approve' then raise exception 'FAIL 3a: requester approved own request: %', r; end if;
  if (select state from public.account_recovery_requests where id = rid) <> 'requested' then raise exception 'FAIL 3a: state moved on self-approval'; end if;
  r := pg_temp.call_as(v_pat, format('select public.approve_assisted_recovery(%L)', rid));
  if r->>'error' <> 'not_authorised' then raise exception 'FAIL 3b: subject approved: %', r; end if;
  r := pg_temp.call_as(a1, format('select public.execute_assisted_recovery(%L)', rid));
  if r->>'error' <> 'wrong_state' then raise exception 'FAIL 3c: executed before approval: %', r; end if;
  r := pg_temp.call_as(a2, format('select public.approve_assisted_recovery(%L)', rid));
  if not (r->>'ok')::boolean then raise exception 'FAIL 3d: second admin could not approve: %', r; end if;
  r := pg_temp.call_as(a1, format('select public.execute_assisted_recovery(%L)', rid));
  if not (r->>'ok')::boolean or r->>'method' <> 'email_link_to_verified_email' then raise exception 'FAIL 3e: execute failed: %', r; end if;
  v_txt := r::text;
  if v_txt like '%example.invalid%' or v_txt like '%password%' or v_txt like '%token%' or v_txt like '%http%' then raise exception 'FAIL 7: execute output carries contact or a secret: %', v_txt; end if;
  select count(*) into v_n from public.notifications where recipient_id = v_pat and template = 'security.assisted_recovery_executed';
  if v_n <> 2 then raise exception 'FAIL 8: executed notice not queued in_app + email (%)', v_n; end if;
  -- terminal
  foreach v_sq in array array[format('select public.execute_assisted_recovery(%L)', rid), format('select public.approve_assisted_recovery(%L)', rid), format('select public.reject_assisted_recovery(%L, %L)', rid, 'ten plus characters here')] loop
    r := pg_temp.call_as(a2, v_sq);
    if r->>'error' <> 'wrong_state' then raise exception 'FAIL 3f: executed request not terminal for %: %', v_sq, r; end if;
  end loop;
  v_failed := false;
  begin update public.account_recovery_requests set state = 'requested' where id = rid; exception when check_violation then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 3g: trigger let an executed request move'; end if;
  v_failed := false;
  begin update public.account_recovery_requests set subject_user_id = v_pat2 where id = rid; exception when check_violation then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 3h: subject is mutable'; end if;
  v_failed := false;
  begin update public.account_recovery_requests set approved_by = a1 where id = rid; exception when check_violation then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 3i: approver editable after the fact (also breaks two-person rule)'; end if;
  v_failed := false;
  begin delete from public.account_recovery_requests where id = rid; exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 3j: request deletable'; end if;

  -- outcome: only the executor, once
  r := pg_temp.call_as(a2, format('select public.record_assisted_recovery_outcome(%L, true)', rid));
  if r->>'error' <> 'not_recordable' then raise exception 'FAIL 3k: non-executor recorded outcome: %', r; end if;
  r := pg_temp.call_as(a1, format('select public.record_assisted_recovery_outcome(%L, true)', rid));
  if not (r->>'ok')::boolean then raise exception 'FAIL 3k: executor could not record outcome: %', r; end if;
  r := pg_temp.call_as(a1, format('select public.record_assisted_recovery_outcome(%L, false)', rid));
  if r->>'error' <> 'not_recordable' then raise exception 'FAIL 3k: outcome rewritten: %', r; end if;

  -- ===== rejected flow
  r := pg_temp.call_as(a1, format('select public.request_assisted_recovery(%L, %L, %L::jsonb, %L)', v_pat2, 'a perfectly long enough reason text', checks, 'new_phone_reverification'));
  rid2 := (r->>'request_id')::uuid;
  r := pg_temp.call_as(a2, format('select public.reject_assisted_recovery(%L, %L)', rid2, 'caller could not answer callback'));
  if not (r->>'ok')::boolean then raise exception 'FAIL 3l: reject failed: %', r; end if;
  r := pg_temp.call_as(a2, format('select public.approve_assisted_recovery(%L)', rid2));
  if r->>'error' <> 'wrong_state' then raise exception 'FAIL 3m: rejected request approvable: %', r; end if;

  -- ===== 4. expired (rows planted as the owner, created in the past)
  insert into public.account_recovery_requests (organisation_id, created_at, subject_user_id, requested_by, reason, identity_checks, method, state, expires_at)
    values (v_org, now() - interval '2 days', v_pat3, a1, 'an old request that lapsed long ago', checks, 'email_link_to_verified_email', 'requested', now() - interval '1 day')
    returning id into rid;
  r := pg_temp.call_as(a2, format('select public.approve_assisted_recovery(%L)', rid));
  if r->>'error' <> 'expired' then raise exception 'FAIL 4a: expired request approved: %', r; end if;
  if (select state from public.account_recovery_requests where id = rid) <> 'expired' then raise exception 'FAIL 4a: not marked expired'; end if;
  insert into public.account_recovery_requests (organisation_id, created_at, subject_user_id, requested_by, reason, identity_checks, method, state, approved_by, approved_at, expires_at)
    values (v_org, now() - interval '2 days', v_noemail, a1, 'an old approved request that lapsed', checks, 'new_phone_reverification', 'approved', a2, now() - interval '47 hours', now() - interval '1 day')
    returning id into rid;
  r := pg_temp.call_as(a1, format('select public.execute_assisted_recovery(%L)', rid));
  if r->>'error' <> 'expired' then raise exception 'FAIL 4b: expired approved request executed: %', r; end if;
  v_failed := false;
  begin
    insert into public.account_recovery_requests (organisation_id, created_at, subject_user_id, requested_by, reason, identity_checks, method, state, expires_at)
      values (v_org, now() - interval '2 days', v_pat3, a1, 'another lapsed request for trigger test', checks, 'new_phone_reverification', 'requested', now() - interval '1 day') returning id into rid;
    update public.account_recovery_requests set state = 'approved', approved_by = a2, approved_at = now() where id = rid;
  exception when check_violation then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 4c: trigger allowed approving an expired request'; end if;

  -- ===== 5. SIM-swap second step
  r := pg_temp.call_as(a1, format('select public.request_assisted_recovery(%L, %L, %L::jsonb, %L)', v_swap, 'a perfectly long enough reason text', checks, 'new_phone_reverification'));
  if not (r->>'sim_swap_risk')::boolean then raise exception 'FAIL 5a: recently reverified phone not flagged: %', r; end if;
  rid := (r->>'request_id')::uuid;
  r := pg_temp.call_as(a2, format('select public.approve_assisted_recovery(%L)', rid));
  if r->>'error' <> 'sim_swap_review_required' then raise exception 'FAIL 5b: approved without SIM-swap review: %', r; end if;
  r := pg_temp.call_as(a1, format('select public.confirm_sim_swap_review(%L, %L)', rid, 'called the previous number and it was confirmed'));
  if r->>'error' <> 'requester_cannot_review' then raise exception 'FAIL 5c: requester reviewed own request: %', r; end if;
  r := pg_temp.call_as(a2, format('select public.confirm_sim_swap_review(%L, %L)', rid, 'called the previous number and it was confirmed'));
  if not (r->>'ok')::boolean then raise exception 'FAIL 5d: review failed: %', r; end if;
  r := pg_temp.call_as(a2, format('select public.approve_assisted_recovery(%L)', rid));
  if not (r->>'ok')::boolean then raise exception 'FAIL 5e: approval after review failed: %', r; end if;
  v_failed := false;
  begin
    insert into public.account_recovery_requests (organisation_id, subject_user_id, requested_by, reason, identity_checks, method, state, sim_swap_risk, approved_by, approved_at)
      values (v_org, v_pat3, a1, 'a planted swap request without review', checks, 'new_phone_reverification', 'approved', true, a2, now());
  exception when check_violation then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 5f: CHECK let a SIM-swap request be approved without review'; end if;

  -- ===== 6. audit per step (request, approve, execute for the first request)
  select count(*) into v_n from public.audit_log where entity_type = 'account_recovery_request' and result = 'success' and subject_patient_id = v_pat
     and action in ('admin.recovery_request','admin.recovery_approve','admin.recovery_execute','admin.recovery_outcome') and reason is not null and entity_id is not null;
  if v_n <> 4 then raise exception 'FAIL 6: expected 4 audited steps for the subject, got %', v_n; end if;
  if exists (select 1 from public.audit_log where entity_type = 'account_recovery_request' and event::text ~* '(example\.invalid|\+234|password|token)') then raise exception 'FAIL 6/7: audit event carries contact or secret'; end if;
  if not exists (select 1 from public.audit_log where action = 'admin.recovery_approve' and result = 'denied' and actor_id = a1 and event->>'why' = 'self_approval') then raise exception 'FAIL 6: self-approval refusal not audited'; end if;

  -- ===== 7/9. list: masked only; admin reads, others do not
  r := pg_temp.call_as(a1, 'select jsonb_agg(to_jsonb(t)) from public.list_assisted_recovery_requests() t');
  if jsonb_array_length(r) < 3 then raise exception 'FAIL 9: admin list empty'; end if;
  v_txt := r::text;
  if v_txt ~ '\+234801' or v_txt like '%example.invalid%' or v_txt like '%1990-%' or v_txt not like '%****0001%' or v_txt not like '%s***@example.invalid%' and false then raise exception 'FAIL 7: list leaked or unmasked: %', left(v_txt, 300); end if;
  if v_txt not like '%p***@example.invalid%' then raise exception 'FAIL 7: email hint missing/unmasked'; end if;
  r := pg_temp.call_as(v_clin, 'select coalesce(jsonb_agg(to_jsonb(t)), ''[]'') from public.list_assisted_recovery_requests() t');
  if jsonb_array_length(r) <> 0 then raise exception 'FAIL 9: clinician list not empty'; end if;
  foreach rid in array array[v_pat, v_clin, v_partner] loop
    r := pg_temp.call_as(rid, 'select jsonb_build_object(''n'', count(*)) from public.account_recovery_requests');
    if (r->>'n')::int <> 0 then raise exception 'FAIL 9: non-admin % reads the table', rid; end if;
  end loop;
  r := pg_temp.call_as(a1, 'select jsonb_build_object(''n'', count(*)) from public.account_recovery_requests');
  if (r->>'n')::int < 3 then raise exception 'FAIL 9: admin cannot read the table (gate does not open)'; end if;
  execute 'set local role anon';
  v_failed := false;
  begin perform 1 from public.account_recovery_requests; exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 9: anon reads the table'; end if;
  v_failed := false;
  begin perform public.approve_assisted_recovery(gen_random_uuid()); exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 9: anon can call approve'; end if;
  execute 'reset role';
  foreach v_sq in array array['public.request_assisted_recovery(uuid,text,jsonb,text)','public.confirm_sim_swap_review(uuid,text)','public.approve_assisted_recovery(uuid)','public.reject_assisted_recovery(uuid,text)','public.execute_assisted_recovery(uuid)','public.record_assisted_recovery_outcome(uuid,boolean)','public.list_assisted_recovery_requests(text)'] loop
    if has_function_privilege('anon', v_sq, 'EXECUTE') then raise exception 'FAIL 9: anon EXECUTE on %', v_sq; end if;
  end loop;
  if has_function_privilege('authenticated', 'private.audit_recovery_event(uuid,uuid,text,uuid,uuid,text,text,jsonb)', 'EXECUTE') then raise exception 'FAIL 9: audit helper callable'; end if;
  if has_table_privilege('authenticated', 'public.account_recovery_requests', 'UPDATE') then raise exception 'FAIL 9: authenticated has UPDATE'; end if;
end $$;

-- ===========================================================================
-- 10. SABOTAGE. Each block reverts one guard and proves the matching check above could fail.
-- ===========================================================================
do $$
declare
  v_org uuid; a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  checks jsonb := '{"date_of_birth":true,"last_payment_reference":true}';
  rid uuid; v_ok boolean; v_state text; r jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (a1, 's03sab-a1@example.invalid', 'x', now(), '{}', '{}'), (a2, 's03sab-a2@example.invalid', 'x', now(), '{}', '{}'), (s, 's03sab-s@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (a1, v_org, 'admin', 'Sab Admin One', '+2348022220001'), (a2, v_org, 'admin', 'Sab Admin Two', '+2348022220002'), (s, v_org, 'patient', 'Sab Subject', '+2348022220003')
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id;
  insert into public.account_recovery_requests (organisation_id, subject_user_id, requested_by, reason, identity_checks, method)
    values (v_org, s, a1, 'sabotage fixture request reason', checks, 'new_phone_reverification') returning id into rid;

  -- S1: drop the different-admin CHECK; self-approval must then be accepted at table level.
  execute 'alter table public.account_recovery_requests drop constraint arr_approver_not_requester';
  v_ok := false;
  begin update public.account_recovery_requests set state = 'approved', approved_by = a1, approved_at = now() where id = rid; v_ok := true;
  exception when others then v_ok := false; end;
  if not v_ok then raise exception 'VACUOUS TEST: dropping the different-admin CHECK did not allow self-approval'; end if;

  -- S2: disable the state trigger; a terminal row may then be reopened.
  update public.account_recovery_requests set state = 'executed', executed_by = a1, executed_at = now() where id = rid;
  execute 'alter table public.account_recovery_requests disable trigger account_recovery_requests_state_machine';
  v_ok := false;
  begin update public.account_recovery_requests set state = 'requested' where id = rid; v_ok := true;
  exception when others then v_ok := false; end;
  if not v_ok then raise exception 'VACUOUS TEST: disabling the state trigger did not reopen a terminal request'; end if;

  -- S3: regrant a direct write path; a plain authenticated non-admin can then change a row.
  execute 'grant update on public.account_recovery_requests to authenticated';
  execute 'create policy sab_upd on public.account_recovery_requests for update to authenticated using (true) with check (true)';
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.account_recovery_requests set state = 'rejected' where id = rid;
  get diagnostics v_ok = row_count;
  execute 'reset role';
  select state into v_state from public.account_recovery_requests where id = rid;
  if v_state <> 'rejected' then raise exception 'VACUOUS TEST: regranted UPDATE did not open a direct write path'; end if;

  -- S4: expose the audit helper; an authenticated caller can then forge audit rows.
  execute 'grant execute on function private.audit_recovery_event(uuid,uuid,text,uuid,uuid,text,text,jsonb) to authenticated';
  if not has_function_privilege('authenticated', 'private.audit_recovery_event(uuid,uuid,text,uuid,uuid,text,text,jsonb)', 'EXECUTE') then
    raise exception 'VACUOUS TEST: grant did not expose the audit helper'; end if;

  -- S5: grant EXECUTE to PUBLIC; anon inherits it (the public-revoke gotcha).
  execute 'grant execute on function public.approve_assisted_recovery(uuid) to public';
  if not has_function_privilege('anon', 'public.approve_assisted_recovery(uuid)', 'EXECUTE') then
    raise exception 'VACUOUS TEST: granting to PUBLIC did not reach anon, so the anon check proves nothing'; end if;
end $$;

select 'PASS: s03_assisted_recovery' as result;

rollback;
