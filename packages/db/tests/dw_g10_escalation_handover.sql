-- ===========================================================================
-- Proof: dw_g10_escalation_handover (G10, DW-16..19, 2026-11-07).
--
--  1  a bystander doctor and a care coordinator cannot hand over a case they do not hold
--  2  the holding doctor must give a reason and an outstanding action of at least 10 characters
--  3  a case cannot be handed to a coordinator, to a doctor on leave, or to the doctor already holding it
--  4  a valid handover leaves the case with the current doctor, notifies only the new doctor with ids only,
--     and gets a 60-minute acknowledge-by (15 minutes for an emergency-level case)
--  5  only one waiting handover per case; only the new doctor can answer it
--  6  a decline needs a reason, leaves the case where it was, and tells the old doctor
--  7  an accept moves the case to the new doctor and tells the old doctor
--  8  the CMO can hand over someone else's case, and cancelling tells the new doctor and moves nothing
--  9  resolving the case while a handover waits supersedes it, and answering it then moves nothing
-- 10  the table is not directly readable by a signed-in user; the read functions return the record
-- SABOTAGE: let a non-holder request (drop the holder check) and check 1 fails.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures in a fresh organisation.
-- ===========================================================================

begin;

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_id uuid;
  r record;
begin
  insert into public.organisations (id, name, type) values (v_org, 'G10 handover Test Org', 'clinic');
  insert into ids values ('org', v_org);
  for r in select * from (values
      ('patient', 'patient', null), ('doc_a', 'clinician', 'senior_medical_officer'), ('doc_b', 'clinician', 'senior_medical_officer'),
      ('doc_c', 'clinician', 'senior_medical_officer'), ('doc_leave', 'clinician', 'senior_medical_officer'),
      ('cmo', 'clinician', 'chief_medical_officer'), ('coord', 'care_coordinator', 'care_coordinator')
    ) as t(key_name, account_role, tier)
  loop
    v_id := gen_random_uuid();
    insert into ids values (r.key_name, v_id);
    insert into auth.users (id, email) values (v_id, format('g10-%s@example.invalid', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, r.account_role::public.user_role, format('G10 %s', r.key_name))
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
    if r.tier is not null then
      insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, employment_type,
                                         indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
      values (v_org, v_id, format('G10 %s', r.key_name), true, now(), r.tier::public.doctor_tier, 'employed',
              'Probe Indemnity Ltd', format('PROBE-G10-%s', r.key_name), now() + interval '1 year');
    end if;
  end loop;
  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason, created_by)
  values (v_org, (select v from ids where k = 'doc_leave'), 'leave', now() - interval '1 day', now() + interval '1 day', 'G10 proof',
          (select v from ids where k = 'cmo'));
end $$;

-- Run p_sql as the named fixture; return the error message, or null on success.
create or replace function pg_temp.as_user(p_key text, p_sql text) returns text
language plpgsql as $$
declare v_err text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = p_key), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_err;
end $$;

do $$
declare
  v_org uuid := (select v from ids where k = 'org');
  v_pat uuid := (select v from ids where k = 'patient');
  v_a uuid := (select v from ids where k = 'doc_a');
  v_b uuid := (select v from ids where k = 'doc_b');
  v_c uuid := (select v from ids where k = 'doc_c');
  v_cmo uuid := (select v from ids where k = 'cmo');
  v_esc uuid; v_esc2 uuid; v_esc3 uuid; v_alert uuid;
  v_h uuid; v_err text; v_n integer; v_payload jsonb; v_due interval; v_status text;
  good_reason constant text := 'Going on night shift rota change';
  good_action constant text := 'Call the patient about the repeat BP';
begin
  insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
  values (v_org, v_pat, 'G10 case', v_a, 'open') returning id into v_esc;
  if (select assigned_doctor_id from public.escalations where id = v_esc) <> v_a then
    alter table public.escalations disable trigger escalations_enforce_reassignment_authority;
    update public.escalations set assigned_doctor_id = v_a where id = v_esc;
    alter table public.escalations enable trigger escalations_enforce_reassignment_authority;
  end if;
  insert into ids values ('esc', v_esc);

  -- 1. not the holder
  foreach v_status in array array['doc_c', 'coord'] loop
    v_err := pg_temp.as_user(v_status, format('select public.request_escalation_handover(%L, %L, %L, %L)', v_esc, v_b, good_reason, good_action));
    if v_err is null or v_err not like 'Only the doctor this case is assigned to%' then
      raise exception 'FAIL 1: % could hand over a case they do not hold (%)', v_status, coalesce(v_err, 'no error');
    end if;
  end loop;

  -- 2. reason and action required
  v_err := pg_temp.as_user('doc_a', format('select public.request_escalation_handover(%L, %L, %L, %L)', v_esc, v_b, 'short', good_action));
  if v_err is null or v_err not like 'Say why%' then raise exception 'FAIL 2a: a short reason was accepted (%)', v_err; end if;
  v_err := pg_temp.as_user('doc_a', format('select public.request_escalation_handover(%L, %L, %L, %L)', v_esc, v_b, good_reason, '   tiny   '));
  if v_err is null or v_err not like 'Say what still needs doing%' then raise exception 'FAIL 2b: a short outstanding action was accepted (%)', v_err; end if;

  -- 3. bad targets
  v_err := pg_temp.as_user('doc_a', format('select public.request_escalation_handover(%L, %L, %L, %L)', v_esc, (select v from ids where k = 'coord'), good_reason, good_action));
  if v_err is null or v_err not like 'A case can only be handed to an active doctor%' then raise exception 'FAIL 3a: handed to a coordinator (%)', v_err; end if;
  v_err := pg_temp.as_user('doc_a', format('select public.request_escalation_handover(%L, %L, %L, %L)', v_esc, (select v from ids where k = 'doc_leave'), good_reason, good_action));
  if v_err is null or v_err not like 'That doctor is on leave%' then raise exception 'FAIL 3b: handed to a doctor on leave (%)', v_err; end if;
  v_err := pg_temp.as_user('doc_a', format('select public.request_escalation_handover(%L, %L, %L, %L)', v_esc, v_a, good_reason, good_action));
  if v_err is null or v_err not like 'Choose a different doctor%' then raise exception 'FAIL 3c: handed to the current holder (%)', v_err; end if;

  -- 4. a valid request
  v_err := pg_temp.as_user('doc_a', format('insert into ids select ''h1'', public.request_escalation_handover(%L, %L, %L, %L)', v_esc, v_b, good_reason, good_action));
  if v_err is not null then raise exception 'FAIL 4a: a valid handover was refused: %', v_err; end if;
  v_h := (select v from ids where k = 'h1');
  if (select assigned_doctor_id from public.escalations where id = v_esc) <> v_a then raise exception 'FAIL 4b: the case moved before acceptance'; end if;
  select count(*), max(payload::text)::jsonb into v_n, v_payload from public.notifications where source_id = v_h and template = 'escalation_handover_offered';
  if v_n <> 1 or not exists (select 1 from public.notifications where source_id = v_h and recipient_id = v_b) then
    raise exception 'FAIL 4c: % offered notices, or not to the new doctor', v_n;
  end if;
  if v_payload <> jsonb_build_object('escalation_id', v_esc, 'handover_id', v_h) then raise exception 'FAIL 4d: payload carries more than ids: %', v_payload; end if;
  select acknowledge_by - requested_at into v_due from public.escalation_handovers where id = v_h;
  if v_due <> interval '60 minutes' then raise exception 'FAIL 4e: routine acknowledge-by is %, expected 60 minutes', v_due; end if;

  -- 5. one waiting at a time; only the new doctor answers
  v_err := pg_temp.as_user('doc_a', format('select public.request_escalation_handover(%L, %L, %L, %L)', v_esc, v_c, good_reason, good_action));
  if v_err is null or v_err not like 'This case already has a handover waiting%' then raise exception 'FAIL 5a: a second waiting handover was allowed (%)', v_err; end if;
  v_err := pg_temp.as_user('doc_c', format('select public.respond_escalation_handover(%L, true)', v_h));
  if v_err is null or v_err not like 'Only the doctor this case is being handed to%' then raise exception 'FAIL 5b: a bystander answered (%)', v_err; end if;

  -- 6. decline
  v_err := pg_temp.as_user('doc_b', format('select public.respond_escalation_handover(%L, false, %L)', v_h, 'no'));
  if v_err is null or v_err not like 'Say why you are declining%' then raise exception 'FAIL 6a: a decline without a reason was accepted (%)', v_err; end if;
  v_err := pg_temp.as_user('doc_b', format('select public.respond_escalation_handover(%L, false, %L)', v_h, 'Already at my case limit today'));
  if v_err is not null then raise exception 'FAIL 6b: a valid decline was refused: %', v_err; end if;
  if (select status from public.escalation_handovers where id = v_h) <> 'declined'
     or (select assigned_doctor_id from public.escalations where id = v_esc) <> v_a then
    raise exception 'FAIL 6c: the decline did not record, or the case moved';
  end if;
  if not exists (select 1 from public.notifications where source_id = v_h and template = 'escalation_handover_declined' and recipient_id = v_a) then
    raise exception 'FAIL 6d: the old doctor was not told about the decline';
  end if;

  -- 7. accept
  v_err := pg_temp.as_user('doc_a', format('insert into ids select ''h2'', public.request_escalation_handover(%L, %L, %L, %L)', v_esc, v_b, good_reason, good_action));
  if v_err is not null then raise exception 'FAIL 7a: second request refused: %', v_err; end if;
  v_h := (select v from ids where k = 'h2');
  v_err := pg_temp.as_user('doc_b', format('select public.respond_escalation_handover(%L, true)', v_h));
  if v_err is not null then raise exception 'FAIL 7b: accept refused: %', v_err; end if;
  if (select assigned_doctor_id from public.escalations where id = v_esc) <> v_b then raise exception 'FAIL 7c: the case did not move on accept'; end if;
  if (select status from public.escalation_handovers where id = v_h) <> 'accepted' then raise exception 'FAIL 7d: handover not marked accepted'; end if;
  if not exists (select 1 from public.notifications where source_id = v_h and template = 'escalation_handover_accepted' and recipient_id = v_a) then
    raise exception 'FAIL 7e: the old doctor was not told about the accept';
  end if;

  -- 8. CMO hands over doc_b's case to doc_c (emergency-level: 15 minutes), then cancels
  insert into public.clinician_alerts (organisation_id, patient_id, title, level, status)
  values (v_org, v_pat, 'G10 emergency', 'emergency', 'open') returning id into v_alert;
  alter table public.escalations disable trigger escalations_enforce_reassignment_authority;
  insert into public.escalations (organisation_id, patient_id, reason, clinician_alert_id, assigned_doctor_id, status)
  values (v_org, v_pat, 'G10 critical', v_alert, v_b, 'open') returning id into v_esc2;
  update public.escalations set assigned_doctor_id = v_b where id = v_esc2;
  alter table public.escalations enable trigger escalations_enforce_reassignment_authority;
  v_err := pg_temp.as_user('cmo', format('insert into ids select ''h3'', public.request_escalation_handover(%L, %L, %L, %L)', v_esc2, v_c, good_reason, good_action));
  if v_err is not null then raise exception 'FAIL 8a: the CMO could not hand over: %', v_err; end if;
  v_h := (select v from ids where k = 'h3');
  select acknowledge_by - requested_at into v_due from public.escalation_handovers where id = v_h;
  if v_due <> interval '15 minutes' or not (select is_critical from public.escalation_handovers where id = v_h) then
    raise exception 'FAIL 8b: emergency acknowledge-by is %, expected 15 minutes', v_due;
  end if;
  v_err := pg_temp.as_user('cmo', format('select public.cancel_escalation_handover(%L)', v_h));
  if v_err is not null then raise exception 'FAIL 8c: cancel refused: %', v_err; end if;
  if (select assigned_doctor_id from public.escalations where id = v_esc2) <> v_b
     or not exists (select 1 from public.notifications where source_id = v_h and template = 'escalation_handover_cancelled' and recipient_id = v_c) then
    raise exception 'FAIL 8d: cancel moved the case or did not tell the new doctor';
  end if;

  -- 9. resolving supersedes a waiting handover
  insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
  values (v_org, v_pat, 'G10 resolve', v_a, 'open') returning id into v_esc3;
  alter table public.escalations disable trigger escalations_enforce_reassignment_authority;
  update public.escalations set assigned_doctor_id = v_a where id = v_esc3;
  alter table public.escalations enable trigger escalations_enforce_reassignment_authority;
  v_err := pg_temp.as_user('doc_a', format('insert into ids select ''h4'', public.request_escalation_handover(%L, %L, %L, %L)', v_esc3, v_c, good_reason, good_action));
  if v_err is not null then raise exception 'FAIL 9a: request refused: %', v_err; end if;
  v_h := (select v from ids where k = 'h4');
  alter table public.escalations disable trigger escalations_enforce_emergency_authority;
  alter table public.escalations disable trigger escalations_enforce_identity_confirm;
  alter table public.escalations disable trigger escalations_enforce_emergency_synchronous_contact;
  alter table public.escalations disable trigger escalations_enforce_protocol_scope_referral_gate;
  update public.escalations set status = 'resolved', resolution_note = 'Resolved by phone call today', identity_confirmed = true, identity_confirmed_by = v_a, identity_confirmed_at = now() where id = v_esc3;
  alter table public.escalations enable trigger escalations_enforce_protocol_scope_referral_gate;
  alter table public.escalations enable trigger escalations_enforce_emergency_synchronous_contact;
  alter table public.escalations enable trigger escalations_enforce_identity_confirm;
  alter table public.escalations enable trigger escalations_enforce_emergency_authority;
  if (select status from public.escalation_handovers where id = v_h) <> 'superseded' then raise exception 'FAIL 9b: resolving did not supersede the handover'; end if;
  v_err := pg_temp.as_user('doc_c', format('select public.respond_escalation_handover(%L, true)', v_h));
  if v_err is null or (select assigned_doctor_id from public.escalations where id = v_esc3) <> v_a then
    raise exception 'FAIL 9c: a superseded handover could still be accepted (%)', coalesce(v_err, 'no error');
  end if;

  -- 10. no direct table read; read functions work
  v_err := pg_temp.as_user('doc_a', 'select count(*) from public.escalation_handovers');
  if v_err is null then raise exception 'FAIL 10a: a signed-in user read escalation_handovers directly'; end if;
  v_err := pg_temp.as_user('doc_a', format('insert into ids select ''n_for'', null from public.escalation_handovers_for(%L) having count(*) = 2', v_esc));
  if v_err is not null or not exists (select 1 from ids where k = 'n_for') then
    raise exception 'FAIL 10b: escalation_handovers_for did not return the two handovers on the case (%)', v_err;
  end if;

  -- SABOTAGE: drop the holder check; a bystander can now request, so check 1 discriminates.
  execute replace(
    pg_get_functiondef('public.request_escalation_handover(uuid, uuid, text, text)'::regprocedure),
    'raise exception ''Only the doctor this case is assigned to, or the Chief Medical Officer, can hand it over.''', 'raise notice ''sabotaged'''
  );
  v_err := pg_temp.as_user('doc_c', format('select public.request_escalation_handover(%L, %L, %L, %L)', v_esc, v_a, good_reason, good_action));
  if v_err is not null then
    raise exception 'FAIL SABOTAGE: with the holder check removed the bystander was still refused (%), so check 1 proves nothing', v_err;
  end if;

  raise notice 'G10 handover: all checks and the sabotage passed';
end $$;

rollback;
