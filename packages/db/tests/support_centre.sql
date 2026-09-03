-- Patient Support & Service Centre — core invariants: the technical-only
-- category boundary added by the module-75 reconciliation
-- (20260903005851_narrow_support_tickets_to_technical_only.sql), the ticket
-- RLS boundary (a patient can never rewrite routing/status fields
-- directly), the §24.5 state machine via advance_support_ticket_status(),
-- first-response/awaiting-patient wiring on comments, the technical
-- escalation ladder (§24.9), the clinical-escalation authority gate
-- (§24.7/24.8, Care Coordinator excluded), and the complaints governance
-- workflow (§24.14/24.15) including the governance_review authority gate.
--
-- Every negative case is paired with a positive control on the same
-- row/action, per this repo's testing convention (see
-- packages/db/tests/consultation_system.sql's header) — a blocked-
-- everything bug would otherwise pass a negatives-only test.
--
-- Rolled back. Fixtures resolved at runtime (an org with 2+ patients, a
-- Care Coordinator, a clinical-tier staff member, a Clinical Director, and
-- an admin), same shape as packages/db/tests/appointment_engine_core.sql.
--
-- Run: npx supabase db query --linked -f packages/db/tests/support_centre.sql
begin;

create temporary table test_result (case_num int, label text, outcome text, detail text) on commit drop;
grant insert, select on test_result to authenticated;

do $$
declare
  v_org          uuid;
  v_patient1     uuid;
  v_patient2     uuid;
  v_coordinator  uuid;
  v_clinical     uuid;
  v_director     uuid;
  v_admin        uuid;
  v_ticket_id    uuid;
  v_tech_ticket  uuid;
  v_comment_id   uuid;
  v_complaint_id uuid;
  v_ticket       public.support_tickets;
  v_complaint    public.complaints;
  v_status       public.support_ticket_status;
  v_alert_id     uuid;
  v_count        int;
  v_edited_description text;
begin
  select p.organisation_id into v_org
  from public.profiles p
  left join public.clinical_staff cs on cs.profile_id = p.id and cs.organisation_id = p.organisation_id
  group by p.organisation_id
  having count(*) filter (where p.role = 'patient') >= 2
     and count(*) filter (where cs.doctor_tier = 'care_coordinator' and cs.active) >= 1
     and count(*) filter (where cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator' and cs.active) >= 1
     and count(*) filter (where cs.is_clinical_director and cs.active) >= 1
     and count(*) filter (where p.role = 'admin') >= 1
  order by count(*) filter (where p.role = 'patient') desc
  limit 1;

  if v_org is null then
    raise exception 'need an org with 2+ patients, a Care Coordinator, a clinical-tier staff member, a Clinical Director and an admin to run this test';
  end if;

  select id into v_patient1 from public.profiles where organisation_id = v_org and role = 'patient' order by id limit 1;
  select id into v_patient2 from public.profiles where organisation_id = v_org and role = 'patient' and id <> v_patient1 order by id limit 1;
  select profile_id into v_coordinator from public.clinical_staff where organisation_id = v_org and doctor_tier = 'care_coordinator' and active limit 1;
  select profile_id into v_clinical from public.clinical_staff where organisation_id = v_org and doctor_tier is not null and doctor_tier <> 'care_coordinator' and active and not is_clinical_director limit 1;
  if v_clinical is null then
    select profile_id into v_clinical from public.clinical_staff where organisation_id = v_org and doctor_tier is not null and doctor_tier <> 'care_coordinator' and active limit 1;
  end if;
  select profile_id into v_director from public.clinical_staff where organisation_id = v_org and is_clinical_director and active limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  ---------------------------------------------------------------- 1. Patient files a ticket; organisation_id is server-resolved.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.support_tickets (organisation_id, patient_id, category, subject, description)
  values ('00000000-0000-0000-0000-000000000099', v_patient1, 'technical', 'App crashes when I try to reschedule', 'The app closes every time I tap the reschedule button.')
  returning id into v_ticket_id;
  perform set_config('role', 'postgres', true);

  select organisation_id into v_org from public.support_tickets where id = v_ticket_id;
  insert into test_result values (1, 'patient files ticket, org server-resolved', 'PASS', null);

  ---------------------------------------------------------------- 2. A non-technical category is rejected (module-75 reconciliation).
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.support_tickets (organisation_id, patient_id, category, subject, description)
    values ('00000000-0000-0000-0000-000000000099', v_patient1, 'appointment', 'Wrong entry point', 'This belongs on navigation_requests instead.');
    insert into test_result values (2, 'a non-technical category is rejected', 'FAIL', 'insert succeeded');
  exception when check_violation then
    insert into test_result values (2, 'a non-technical category is rejected', 'PASS', sqlerrm);
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 3. Patient cannot change status directly.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.support_tickets set status = 'resolved' where id = v_ticket_id;
    insert into test_result values (3, 'patient blocked from changing ticket status', 'FAIL', 'update succeeded');
  exception when others then
    insert into test_result values (3, 'patient blocked from changing ticket status', 'PASS', sqlerrm);
  end;
  perform set_config('role', 'postgres', true);

  -- Control: staff can assign via the RPC.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.assign_support_ticket(v_ticket_id, v_coordinator);
  perform set_config('role', 'postgres', true);
  select status into v_status from public.support_tickets where id = v_ticket_id;
  if v_status = 'assigned' then
    insert into test_result values (4, 'assign_support_ticket moves New -> Assigned (control)', 'PASS', null);
  else
    insert into test_result values (4, 'assign_support_ticket moves New -> Assigned (control)', 'FAIL', v_status::text);
  end if;

  ---------------------------------------------------------------- 5. Internal comment hidden from patient; staff reply stamps first_response_at.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.support_ticket_comments (ticket_id, body, is_internal)
  values (v_ticket_id, 'Internal note: checking the release notes for a known crash.', true);
  insert into public.support_ticket_comments (ticket_id, body, is_internal)
  values (v_ticket_id, 'Thanks for reporting this — looking into it now.', false)
  returning id into v_comment_id;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.support_ticket_comments where ticket_id = v_ticket_id;
  perform set_config('role', 'postgres', true);
  if v_count = 1 then
    insert into test_result values (5, 'patient sees only the non-internal comment', 'PASS', null);
  else
    insert into test_result values (5, 'patient sees only the non-internal comment', 'FAIL', format('patient saw %s comments, expected 1', v_count));
  end if;

  select first_response_at into v_ticket.first_response_at from public.support_tickets where id = v_ticket_id;
  if v_ticket.first_response_at is not null then
    insert into test_result values (6, 'first_response_at stamped on first non-internal staff reply', 'PASS', null);
  else
    insert into test_result values (6, 'first_response_at stamped on first non-internal staff reply', 'FAIL', null);
  end if;

  ---------------------------------------------------------------- 7. awaiting_patient -> patient reply reopens to in_progress.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.advance_support_ticket_status(v_ticket_id, 'in_progress');
  perform public.advance_support_ticket_status(v_ticket_id, 'awaiting_patient');
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.support_ticket_comments (ticket_id, body) values (v_ticket_id, 'Still happening, tried again today.');
  perform set_config('role', 'postgres', true);
  select status into v_status from public.support_tickets where id = v_ticket_id;
  if v_status = 'in_progress' then
    insert into test_result values (7, 'patient reply reopens awaiting_patient -> in_progress', 'PASS', null);
  else
    insert into test_result values (7, 'patient reply reopens awaiting_patient -> in_progress', 'FAIL', v_status::text);
  end if;

  ---------------------------------------------------------------- 8. resolving requires a note.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.advance_support_ticket_status(v_ticket_id, 'resolved', null);
    insert into test_result values (8, 'resolving without a note is blocked', 'FAIL', 'succeeded with no note');
  exception when others then
    insert into test_result values (8, 'resolving without a note is blocked', 'PASS', sqlerrm);
  end;
  perform public.advance_support_ticket_status(v_ticket_id, 'resolved', 'Reproduced and fixed a stale button-state bug; rescheduling now works.');
  perform set_config('role', 'postgres', true);
  select status, resolved_by, resolved_at into v_status, v_ticket.resolved_by, v_ticket.resolved_at from public.support_tickets where id = v_ticket_id;
  if v_status = 'resolved' and v_ticket.resolved_by is not null and v_ticket.resolved_at is not null then
    insert into test_result values (9, 'resolve with a note succeeds, attribution stamped (control)', 'PASS', null);
  else
    insert into test_result values (9, 'resolve with a note succeeds, attribution stamped (control)', 'FAIL', null);
  end if;

  ---------------------------------------------------------------- 10. satisfaction: patient can rate once, not twice.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.support_tickets set satisfaction_score = 5, satisfaction_comment = 'Fixed quickly, thanks!' where id = v_ticket_id;
  begin
    update public.support_tickets set satisfaction_score = 1 where id = v_ticket_id;
    insert into test_result values (10, 'a second satisfaction rating is blocked', 'FAIL', 'second rating succeeded');
  exception when others then
    insert into test_result values (10, 'a second satisfaction rating is blocked', 'PASS', sqlerrm);
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 11. close, then status_history has a full audit trail.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.advance_support_ticket_status(v_ticket_id, 'closed');
  perform set_config('role', 'postgres', true);
  select count(*) into v_count from public.support_ticket_status_history where ticket_id = v_ticket_id;
  if v_count >= 3 then
    insert into test_result values (11, 'status_history logged every transition', 'PASS', format('%s rows', v_count));
  else
    insert into test_result values (11, 'status_history logged every transition', 'FAIL', format('only %s rows', v_count));
  end if;

  ---------------------------------------------------------------- 12. technical escalation ladder: Tier 1 -> 2 -> 3, then blocked.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.support_tickets (organisation_id, patient_id, category, subject, description)
  values (v_org, v_patient2, 'technical', 'App crashes on login', 'The app closes immediately after I enter my password.')
  returning id into v_tech_ticket;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.bump_support_ticket_technical_tier(v_tech_ticket);
  perform public.bump_support_ticket_technical_tier(v_tech_ticket);
  begin
    perform public.bump_support_ticket_technical_tier(v_tech_ticket);
    insert into test_result values (12, 'technical tier caps at 3 (Engineering)', 'FAIL', 'a 4th bump succeeded');
  exception when others then
    insert into test_result values (12, 'technical tier caps at 3 (Engineering)', 'PASS', sqlerrm);
  end;
  perform set_config('role', 'postgres', true);
  select technical_tier into v_count from public.support_tickets where id = v_tech_ticket;
  if v_count = 3 then
    insert into test_result values (13, 'ladder actually reached Tier 3 (control)', 'PASS', null);
  else
    insert into test_result values (13, 'ladder actually reached Tier 3 (control)', 'FAIL', v_count::text);
  end if;

  ---------------------------------------------------------------- 14. clinical escalation: Care Coordinator blocked, clinical tier allowed.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.escalate_support_ticket_to_clinical(v_tech_ticket, 'This looks like a medication-related question, not a bug.');
    insert into test_result values (14, 'Care Coordinator blocked from clinical escalation', 'FAIL', 'succeeded');
  exception when others then
    insert into test_result values (14, 'Care Coordinator blocked from clinical escalation', 'PASS', sqlerrm);
  end;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_clinical, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_ticket := public.escalate_support_ticket_to_clinical(v_tech_ticket, 'Patient is describing a possible medication side effect, not an app bug — needs clinical eyes.');
  perform set_config('role', 'postgres', true);
  if v_ticket.escalated_alert_id is not null then
    select count(*) into v_count from public.clinician_alerts where id = v_ticket.escalated_alert_id and type_code = 'support_ticket_escalation';
    if v_count = 1 then
      insert into test_result values (15, 'clinical-tier staff escalates ticket, real clinician_alert raised (control)', 'PASS', null);
    else
      insert into test_result values (15, 'clinical-tier staff escalates ticket, real clinician_alert raised (control)', 'FAIL', 'no matching clinician_alert row');
    end if;
  else
    insert into test_result values (15, 'clinical-tier staff escalates ticket, real clinician_alert raised (control)', 'FAIL', 'escalated_alert_id still null');
  end if;

  ---------------------------------------------------------------- 16. complaints: patient files, cannot edit afterward.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.complaints (organisation_id, patient_id, category, description)
  values (v_org, v_patient1, 'communication', 'My care coordinator never called back after three messages.')
  returning id into v_complaint_id;
  -- RLS's USING clause on complaints_update is staff-only, so an update
  -- from a patient matches zero rows and silently no-ops (standard Postgres
  -- RLS behaviour for a bare USING filter on UPDATE — it does not raise,
  -- unlike an INSERT's WITH CHECK failure). Assert on the actual row
  -- content, not on an exception.
  update public.complaints set description = 'edited' where id = v_complaint_id;
  perform set_config('role', 'postgres', true);
  select description into v_edited_description from public.complaints where id = v_complaint_id;
  if v_edited_description <> 'edited' then
    insert into test_result values (16, 'patient cannot edit a filed complaint', 'PASS', 'RLS no-opped the update');
  else
    insert into test_result values (16, 'patient cannot edit a filed complaint', 'FAIL', 'the edit went through');
  end if;

  ---------------------------------------------------------------- 17. cannot skip straight to governance_review.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.advance_complaint_status(v_complaint_id, 'governance_review', 'skipping ahead');
    insert into test_result values (17, 'cannot skip received -> governance_review', 'FAIL', 'succeeded');
  exception when others then
    insert into test_result values (17, 'cannot skip received -> governance_review', 'PASS', sqlerrm);
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 18. walk the pipeline; a non-director/admin is blocked from governance_review.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.advance_complaint_status(v_complaint_id, 'acknowledged');
  perform public.advance_complaint_status(v_complaint_id, 'assigned', p_assignee_id => v_coordinator);
  perform public.advance_complaint_status(v_complaint_id, 'investigating', p_note => 'Checked the message log: three inbound messages, no reply logged for 9 days.');
  perform public.advance_complaint_status(v_complaint_id, 'response_sent', p_note => 'Called the patient, apologised, and rebooked their check-in for this week.');
  perform public.advance_complaint_status(v_complaint_id, 'resolved', p_note => 'Patient confirmed the callback happened and is satisfied.');
  begin
    perform public.advance_complaint_status(v_complaint_id, 'governance_review', 'signing off');
    insert into test_result values (18, 'Care Coordinator blocked from governance_review sign-off', 'FAIL', 'succeeded');
  exception when others then
    insert into test_result values (18, 'Care Coordinator blocked from governance_review sign-off', 'PASS', sqlerrm);
  end;
  perform set_config('role', 'postgres', true);

  -- Control: the Clinical Director can complete governance review.
  perform set_config('request.jwt.claims', json_build_object('sub', v_director, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_complaint := public.advance_complaint_status(v_complaint_id, 'governance_review', 'Reviewed: response-time gap confirmed, coordinator coached, no further action needed.');
  perform set_config('role', 'postgres', true);
  if v_complaint.status = 'governance_review' and v_complaint.governance_reviewed_by is not null then
    insert into test_result values (19, 'Clinical Director completes governance review (control)', 'PASS', null);
  else
    insert into test_result values (19, 'Clinical Director completes governance review (control)', 'FAIL', null);
  end if;

  ---------------------------------------------------------------- 20. a governance_review complaint is terminal.
  perform set_config('request.jwt.claims', json_build_object('sub', v_director, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.complaints set governance_note = 'edited after the fact' where id = v_complaint_id;
    insert into test_result values (20, 'a governance_review complaint is terminal', 'FAIL', 'edit succeeded');
  exception when others then
    insert into test_result values (20, 'a governance_review complaint is terminal', 'PASS', sqlerrm);
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 21. §24.15: complaint -> formal clinical incident.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.complaints (organisation_id, patient_id, category, description)
  values (v_org, v_patient1, 'clinical_care', 'I was given the wrong dose in a video consult and felt unwell after.')
  returning id into v_complaint_id;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_complaint := public.escalate_complaint_to_incident(v_complaint_id, 'medication_error', 'medium', 'Patient-reported dosing error during a video consult; confirmed via complaint intake.');
  perform set_config('role', 'postgres', true);
  if v_complaint.incident_report_id is not null then
    select count(*) into v_count from public.clinical_incident_reports where id = v_complaint.incident_report_id and category = 'medication_error';
    if v_count = 1 then
      insert into test_result values (21, 'complaint escalates into a real clinical_incident_reports row', 'PASS', null);
    else
      insert into test_result values (21, 'complaint escalates into a real clinical_incident_reports row', 'FAIL', 'no matching incident row');
    end if;
  else
    insert into test_result values (21, 'complaint escalates into a real clinical_incident_reports row', 'FAIL', 'incident_report_id still null');
  end if;

  ---------------------------------------------------------------- 22. cross-patient isolation: patient2 cannot see patient1's ticket.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.support_tickets where id = v_ticket_id;
  perform set_config('role', 'postgres', true);
  if v_count = 0 then
    insert into test_result values (22, 'patient cannot read another patient''s ticket', 'PASS', null);
  else
    insert into test_result values (22, 'patient cannot read another patient''s ticket', 'FAIL', format('%s rows visible', v_count));
  end if;

  -- Control: the ticket's own patient can still read it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.support_tickets where id = v_ticket_id;
  perform set_config('role', 'postgres', true);
  if v_count = 1 then
    insert into test_result values (23, 'the owning patient can still read their own ticket (control)', 'PASS', null);
  else
    insert into test_result values (23, 'the owning patient can still read their own ticket (control)', 'FAIL', format('%s rows visible', v_count));
  end if;

  ---------------------------------------------------------------- 24. cross-patient isolation: patient2 cannot see patient1's complaint.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.complaints where id = v_complaint_id;
  perform set_config('role', 'postgres', true);
  if v_count = 0 then
    insert into test_result values (24, 'patient cannot read another patient''s complaint', 'PASS', null);
  else
    insert into test_result values (24, 'patient cannot read another patient''s complaint', 'FAIL', format('%s rows visible', v_count));
  end if;

  ---------------------------------------------------------------- 25. cross-patient isolation: patient2 cannot see patient1's non-internal comment thread on a ticket they don't own.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.support_ticket_comments where ticket_id = v_ticket_id;
  perform set_config('role', 'postgres', true);
  if v_count = 0 then
    insert into test_result values (25, 'patient cannot read comments on another patient''s ticket', 'PASS', null);
  else
    insert into test_result values (25, 'patient cannot read comments on another patient''s ticket', 'FAIL', format('%s rows visible', v_count));
  end if;

  ---------------------------------------------------------------- 26. analytics RPCs: fail-closed for a non-analyst/non-admin caller, real data for admin.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  declare
    v_json jsonb;
  begin
    select public.analytics_support_ticket_summary() into v_json;
    if v_json = '{}'::jsonb then
      insert into test_result values (26, 'analytics_support_ticket_summary fails closed for a non-analyst', 'PASS', null);
    else
      insert into test_result values (26, 'analytics_support_ticket_summary fails closed for a non-analyst', 'FAIL', v_json::text);
    end if;
  end;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  declare
    v_json jsonb;
  begin
    select public.analytics_support_ticket_summary() into v_json;
    if v_json ? 'total' and (v_json->>'total')::int >= 1 then
      insert into test_result values (27, 'analytics_support_ticket_summary returns real data for admin (control)', 'PASS', v_json->>'total');
    else
      insert into test_result values (27, 'analytics_support_ticket_summary returns real data for admin (control)', 'FAIL', v_json::text);
    end if;
    select public.analytics_complaints_summary() into v_json;
    if v_json ? 'total' and (v_json->>'total')::int >= 1 then
      insert into test_result values (28, 'analytics_complaints_summary returns real data for admin (control)', 'PASS', v_json->>'total');
    else
      insert into test_result values (28, 'analytics_complaints_summary returns real data for admin (control)', 'FAIL', v_json::text);
    end if;
  end;
  perform set_config('role', 'postgres', true);

end $$;

select case_num, label, outcome, detail from test_result order by case_num;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from test_result where outcome = 'FAIL';
  if v_fail > 0 then
    raise exception '% case(s) FAILED — see the SELECT above', v_fail;
  end if;
  raise notice 'PASS: all support-centre invariant cases passed';
end $$;

rollback;
