-- ===========================================================================
-- Proof: dw03 escalation working states (DW-03, DW-10..DW-13, G11).
--
-- Proves, with simulated sessions in a fresh organisation:
--   1  a new escalation cannot start in a working state
--   2  an open case cannot jump to a working state before review starts
--   3  the assigned doctor needs a note (10+ chars) to enter a working state, and gets one recorded with attribution
--   4  the same note again is refused (a move needs a new note)
--   5  a bystander doctor cannot move the case; 6 a care coordinator cannot; 7 the CMO can
--   8  monitoring needs a review-by date within 14 days; a valid one is stored
--   9  the assigned doctor keeps access to the patient while the case is monitoring (the gate opens), a bystander does not
--  10  a monitoring case counts as load: a new case routes away from its doctor
--  11  the scheduled return brings back only a due monitoring case, clears the date, leaves a future one alone
--  12  a session-less move out of awaiting_information is refused
--  13  resolving needs a resolution note (G11); a proper one resolves
--  14  contact attempts: a care coordinator can log one, a bystander and the patient cannot, the doctor can read it, nobody reads the
--      table directly
--  SABOTAGE: with the state-rules trigger dropped, the bystander's move succeeds, so checks 5 and 6 can fail.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
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
  insert into public.organisations (id, name, type) values (v_org, 'DW03 Escalation States Test Org', 'clinic');
  insert into ids values ('org', v_org);

  for r in select * from (values
      ('patient', 'patient', null),
      ('doc_a', 'clinician', 'senior_medical_officer'),
      ('doc_b', 'clinician', 'senior_medical_officer'),
      ('cmo', 'clinician', 'chief_medical_officer'),
      ('coord', 'care_coordinator', 'care_coordinator')
    ) as t(key_name, account_role, tier)
  loop
    v_id := gen_random_uuid();
    insert into ids values (r.key_name, v_id);
    insert into auth.users (id, email) values (v_id, format('dw03-%s@example.invalid', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, r.account_role::public.user_role, format('DW03 %s', r.key_name))
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
    if r.tier is not null then
      insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, employment_type,
                                         indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
      values (v_org, v_id, format('DW03 %s', r.key_name), true, now(), r.tier::public.doctor_tier, 'employed',
              'Probe Indemnity Ltd', format('PROBE-DW03-%s', r.key_name), now() + interval '1 year');
    end if;
  end loop;
end $$;

create or replace function pg_temp.as_user(p_key text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = p_key), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

create or replace function pg_temp.as_system() returns void language plpgsql as $f$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $f$;

-- Try an UPDATE as a user; return 'ok', 'blocked' (no row changed, e.g. RLS) or the SQLSTATE that refused it.
create or replace function pg_temp.try_as(p_key text, p_sql text) returns text language plpgsql as $f$
declare
  v_n integer;
  v_state text;
begin
  perform pg_temp.as_user(p_key);
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    v_state := case when v_n > 0 then 'ok' else 'blocked' end;
  exception when others then
    v_state := sqlstate;
  end;
  perform pg_temp.as_system();
  return v_state;
end $f$;

do $$
declare
  v_org uuid := (select v from ids where k = 'org');
  v_pat uuid := (select v from ids where k = 'patient');
  v_a uuid := (select v from ids where k = 'doc_a');
  v_esc uuid;
  v_esc2 uuid;
  v_esc3 uuid;
  v_r text;
  v_row public.escalations;
  v_n integer;
  v_bool boolean;
  v_failed boolean;
begin
  -- 1. cannot be born in a working state
  v_failed := false;
  begin
    insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
    values (v_org, v_pat, 'DW03 born monitoring', v_a, 'monitoring');
  exception when sqlstate '23514' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 1: an escalation was created in a working state'; end if;

  insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
  values (v_org, v_pat, 'DW03 main case', v_a, 'open') returning id into v_esc;
  insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
  values (v_org, v_pat, 'DW03 second case', v_a, 'open') returning id into v_esc2;
  insert into ids values ('esc', v_esc), ('esc2', v_esc2);

  -- 2. open cannot jump straight to a working state
  v_r := pg_temp.try_as('doc_a', format($q$update public.escalations set status = 'awaiting_information', status_note = 'Waiting for the outside ECG report' where id = %L$q$, v_esc2));
  if v_r <> '23514' then raise exception 'FAIL 2: open -> awaiting_information gave %', v_r; end if;

  v_r := pg_temp.try_as('doc_a', format($q$update public.escalations set status = 'under_review' where id = %L$q$, v_esc));
  if v_r <> 'ok' then raise exception 'FAIL setup: assigned doctor could not start review: %', v_r; end if;

  -- 3. note required; with a note the move is recorded and attributed
  v_r := pg_temp.try_as('doc_a', format($q$update public.escalations set status = 'awaiting_information', status_note = 'short' where id = %L$q$, v_esc));
  if v_r <> '23514' then raise exception 'FAIL 3a: a 5-character note was accepted: %', v_r; end if;
  v_r := pg_temp.try_as('doc_a', format($q$update public.escalations set status = 'awaiting_information', status_note = 'Waiting for the outside ECG report' where id = %L$q$, v_esc));
  if v_r <> 'ok' then raise exception 'FAIL 3b: the assigned doctor could not move to awaiting_information: %', v_r; end if;
  select * into v_row from public.escalations where id = v_esc;
  if v_row.status <> 'awaiting_information' or v_row.status_changed_by is distinct from v_a or v_row.status_changed_at is null then
    raise exception 'FAIL 3c: the move was not recorded with attribution: % % %', v_row.status, v_row.status_changed_by, v_row.status_changed_at;
  end if;

  -- 4. the same note again is refused
  v_r := pg_temp.try_as('doc_a', format($q$update public.escalations set status = 'patient_contact_required', status_note = 'Waiting for the outside ECG report' where id = %L$q$, v_esc));
  if v_r <> '23514' then raise exception 'FAIL 4: a reused note was accepted: %', v_r; end if;

  -- 5. bystander doctor, 6. care coordinator: refused (by the trigger, or by RLS before it)
  v_r := pg_temp.try_as('doc_b', format($q$update public.escalations set status = 'patient_contact_required', status_note = 'Bystander trying to move this case' where id = %L$q$, v_esc));
  if v_r not in ('42501', 'blocked') then raise exception 'FAIL 5: a bystander doctor moved the case: %', v_r; end if;
  v_r := pg_temp.try_as('coord', format($q$update public.escalations set status = 'patient_contact_required', status_note = 'Coordinator trying to move this case' where id = %L$q$, v_esc));
  if v_r not in ('42501', 'blocked') then raise exception 'FAIL 6: a care coordinator moved the case: %', v_r; end if;
  if (select status from public.escalations where id = v_esc) <> 'awaiting_information' then raise exception 'FAIL 5/6: the case moved anyway'; end if;

  -- 7. the CMO can
  v_r := pg_temp.try_as('cmo', format($q$update public.escalations set status = 'patient_contact_required', status_note = 'CMO: ring the patient about the ECG' where id = %L$q$, v_esc));
  if v_r <> 'ok' then raise exception 'FAIL 7: the CMO could not move the case: %', v_r; end if;

  -- 7b. a coordinator cannot pull a working-state case back to open; a note cannot be edited without a state change
  v_r := pg_temp.try_as('coord', format($q$update public.escalations set status = 'open' where id = %L$q$, v_esc));
  if v_r not in ('42501', 'blocked') then raise exception 'FAIL 7b: a care coordinator moved a working-state case to open: %', v_r; end if;
  v_r := pg_temp.try_as('doc_a', format($q$update public.escalations set status_note = 'Rewriting the note in place' where id = %L$q$, v_esc));
  if v_r <> '23514' then raise exception 'FAIL 7c: a note edit without a state change was not refused: %', v_r; end if;

  -- 8. monitoring window
  v_r := pg_temp.try_as('doc_a', format($q$update public.escalations set status = 'monitoring', status_note = 'Watch BP readings for a week' where id = %L$q$, v_esc));
  if v_r <> '23514' then raise exception 'FAIL 8a: monitoring without a date was accepted: %', v_r; end if;
  v_r := pg_temp.try_as('doc_a', format($q$update public.escalations set status = 'monitoring', status_note = 'Watch BP readings for a week', monitor_until = now() + interval '20 days' where id = %L$q$, v_esc));
  if v_r <> '23514' then raise exception 'FAIL 8b: a 20-day review-by date was accepted: %', v_r; end if;
  v_r := pg_temp.try_as('doc_a', format($q$update public.escalations set status = 'monitoring', status_note = 'Watch BP readings for a week', monitor_until = now() + interval '3 days' where id = %L$q$, v_esc));
  if v_r <> 'ok' then raise exception 'FAIL 8c: a valid monitoring move was refused: %', v_r; end if;
  if (select monitor_until from public.escalations where id = v_esc) is null then raise exception 'FAIL 8d: review-by date not stored'; end if;

  -- 9. the assigned doctor keeps patient access while monitoring; the bystander has none
  perform pg_temp.as_user('doc_a');
  v_bool := private.clinician_has_patient_access(v_pat);
  perform pg_temp.as_system();
  if not v_bool then raise exception 'FAIL 9a: the assigned doctor lost patient access while the case is monitoring'; end if;
  perform pg_temp.as_user('doc_b');
  v_bool := private.clinician_has_patient_access(v_pat);
  perform pg_temp.as_system();
  if v_bool then raise exception 'FAIL 9b: a bystander doctor has patient access'; end if;

  -- 10. a monitoring case is load: doc_a holds two open cases, so a new case goes elsewhere
  insert into public.escalations (organisation_id, patient_id, reason)
  values (v_org, v_pat, 'DW03 routing probe') returning id into v_esc3;
  if (select assigned_doctor_id from public.escalations where id = v_esc3) is not distinct from v_a then
    raise exception 'FAIL 10: a new case routed to the doctor already holding a monitoring case';
  end if;

  -- 11. scheduled return: make the main case due (bypassing the rules only to move the clock), add a not-yet-due one
  alter table public.escalations disable trigger escalations_enforce_state_rules;
  update public.escalations set monitor_until = now() - interval '1 minute' where id = v_esc;
  update public.escalations set status = 'monitoring', status_note = 'Not yet due monitoring case', monitor_until = now() + interval '2 days' where id = v_esc3;
  alter table public.escalations enable trigger escalations_enforce_state_rules;
  v_n := private.return_due_escalation_monitoring();
  if v_n <> 1 then raise exception 'FAIL 11a: the return moved % cases, expected 1', v_n; end if;
  select * into v_row from public.escalations where id = v_esc;
  if v_row.status <> 'under_review' or v_row.monitor_until is not null or v_row.status_note not like 'Monitoring period ended%' then
    raise exception 'FAIL 11b: due case not returned cleanly: % % %', v_row.status, v_row.monitor_until, v_row.status_note;
  end if;
  if (select status from public.escalations where id = v_esc3) <> 'monitoring' then raise exception 'FAIL 11c: a not-yet-due case was returned'; end if;

  -- 12. no session, not a due monitoring case: refused
  v_r := pg_temp.try_as('doc_a', format($q$update public.escalations set status = 'awaiting_information', status_note = 'Waiting on the cardiology letter' where id = %L$q$, v_esc));
  if v_r <> 'ok' then raise exception 'FAIL setup 12: %', v_r; end if;
  v_failed := false;
  begin
    update public.escalations set status = 'under_review' where id = v_esc;
  exception when sqlstate '42501' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 12: a session-less move out of awaiting_information was allowed'; end if;

  -- 13. resolve needs a resolution note (G11)
  v_r := pg_temp.try_as('doc_a', format($q$update public.escalations set status = 'resolved', resolution_note = 'ok', identity_confirmed = true where id = %L$q$, v_esc));
  if v_r <> '23514' then raise exception 'FAIL 13a: a 2-character resolution note was accepted: %', v_r; end if;
  v_r := pg_temp.try_as('doc_a', format($q$update public.escalations set status = 'resolved', resolution_note = 'ECG normal; reassured patient by phone', identity_confirmed = true where id = %L$q$, v_esc));
  if v_r <> 'ok' then raise exception 'FAIL 13b: a proper resolve was refused: %', v_r; end if;

  -- 14. contact attempts
  perform pg_temp.as_user('coord');
  perform public.log_escalation_contact_attempt(v_esc2, 'no_answer', 'Rang twice, no answer');
  perform pg_temp.as_system();
  v_failed := false;
  perform pg_temp.as_user('doc_b');
  begin
    perform public.log_escalation_contact_attempt(v_esc2, 'reached', null);
  exception when sqlstate '42501' then v_failed := true; end;
  perform pg_temp.as_system();
  if not v_failed then raise exception 'FAIL 14a: a bystander logged a contact attempt'; end if;
  v_failed := false;
  perform pg_temp.as_user('patient');
  begin
    perform public.log_escalation_contact_attempt(v_esc2, 'reached', null);
  exception when sqlstate '42501' then v_failed := true; end;
  perform pg_temp.as_system();
  if not v_failed then raise exception 'FAIL 14b: the patient logged a contact attempt'; end if;
  perform pg_temp.as_user('doc_a');
  select count(*) into v_n from public.escalation_contact_attempts_for(v_esc2);
  perform pg_temp.as_system();
  if v_n <> 1 then raise exception 'FAIL 14c: the assigned doctor read % attempts, expected 1', v_n; end if;
  v_failed := false;
  perform pg_temp.as_user('doc_a');
  begin
    perform 1 from public.escalation_contact_attempts;
  exception when insufficient_privilege then v_failed := true; end;
  perform pg_temp.as_system();
  if not v_failed then raise exception 'FAIL 14d: the contact-attempt table is directly readable'; end if;

  -- SABOTAGE: without the trigger, the bystander's move goes through, so checks 5 and 6 discriminate
  drop trigger escalations_enforce_state_rules on public.escalations;
  v_r := pg_temp.try_as('doc_b', format($q$update public.escalations set status = 'patient_contact_required', status_note = 'Bystander trying to move this case', monitor_until = null where id = %L$q$, v_esc3));
  if v_r <> 'ok' then raise exception 'FAIL SABOTAGE: with the trigger gone the bystander was still refused (%), so checks 5/6 prove nothing', v_r; end if;

  raise notice 'dw03 escalation working states: all checks and the sabotage passed';
end $$;

rollback;
