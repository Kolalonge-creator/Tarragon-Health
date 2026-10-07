-- ===========================================================================
-- Proof: *_s05e_referrals_audited_reads_and_writes.sql + *_s05e_close_referrals_direct_staff_path.sql (S05e; INV-10, INV-12).
--
-- Visibility rule: tied staff, the creator, the assigned specialist and the referral desk (Care Coordinator / CMO) see a referral;
-- an untied doctor, a pharmacist and another organisation's staff do not. Proves, with simulated sessions:
--   1. Writes go through the functions and need the rule: a tied doctor creates, submits (signature stamped), sets urgency; an untied
--      doctor cannot create, set urgency, waitlist or decline; the assigned specialist and the desk can act on it.
--   2. Reads: get / list-for-patient return ok to those who may see it, `denied` (audited) to those who may not, never an empty ok;
--      the queue list holds only visible referrals; a patient caller raises; short reasons raise; anon cannot execute.
--   3. Counts follow the same rule.
--   4. The table is closed: staff direct SELECT / INSERT / UPDATE refused; the patient still reads her own.
--   5. patient_care_gaps keeps its overdue_referral rows for those who may see the referral, drops them for those who may not, and the
--      service role (employer / HMO aggregate) still sees them.
--   6. SABOTAGE: the old org-staff policy exposes the table; a stubbed visibility rule lets an untied doctor read.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_tied uuid := gen_random_uuid();
  v_untied uuid := gen_random_uuid();
  v_spec uuid := gen_random_uuid();
  v_desk uuid := gen_random_uuid();
  v_ph uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_ref uuid;
  v_ref2 uuid;
  v_json jsonb;
  v_n integer;
  v_failed boolean;
  v_sqlstate text;
  v_spec_staff uuid;
  v_stype public.specialist_type := (enum_range(null::public.specialist_type))[1];
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'S05e Other Org', 'direct_consumer');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,    's05e-pat@example.invalid',    'x', now(), '{}', '{}'),
    (v_tied,   's05e-tied@example.invalid',   'x', now(), '{}', '{}'),
    (v_untied, 's05e-untied@example.invalid', 'x', now(), '{}', '{}'),
    (v_spec,   's05e-spec@example.invalid',   'x', now(), '{}', '{}'),
    (v_desk,   's05e-desk@example.invalid',   'x', now(), '{}', '{}'),
    (v_ph,     's05e-ph@example.invalid',     'x', now(), '{}', '{}'),
    (v_other,  's05e-other@example.invalid',  'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org,  'patient',    'S05e Patient',      '+2348055550001'),
    (v_tied,   v_org,  'clinician',  'S05e Tied Doctor',  '+2348055550002'),
    (v_untied, v_org,  'clinician',  'S05e Untied Doctor','+2348055550003'),
    (v_spec,   v_org,  'clinician',  'S05e Specialist',   '+2348055550004'),
    (v_desk,   v_org,  'clinician',  'S05e Desk',         '+2348055550005'),
    (v_ph,     v_org,  'pharmacist', 'S05e Pharmacist',   '+2348055550006'),
    (v_other,  v_org2, 'clinician',  'S05e Other Org Doctor','+2348055550007')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org,  v_tied,   'S05e Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org,  v_untied, 'S05e Untied Doctor', true, now(), 'senior_medical_officer'),
    (v_org,  v_spec,   'S05e Specialist',    true, now(), 'senior_medical_officer'),
    (v_org,  v_desk,   'S05e Desk',          true, now(), 'care_coordinator'),
    (v_org2, v_other,  'S05e Other Org Doctor', true, now(), 'senior_medical_officer');
  select id into v_spec_staff from public.clinical_staff where profile_id = v_spec;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;

  -- ===== 1. writes =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.create_specialist_referral(v_pat, v_stype, 'clinician_initiated', 'routine', 'S05e proof referral', 'review', '[]'::jsonb, true) into v_ref;
  execute 'reset role';
  if not exists (select 1 from public.specialist_referrals where id = v_ref and status = 'draft' and patient_id = v_pat and referred_by is not null) then
    raise exception 'FAIL 1a: the tied doctor could not create a draft referral (the gate does not open)';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.submit_draft_referral(v_ref, now());
  perform public.set_referral_urgency(v_ref, 'priority');
  execute 'reset role';
  if not exists (select 1 from public.specialist_referrals where id = v_ref and status = 'pending' and urgency = 'priority'
                    and signed_by = v_tied and set_by = v_tied) then
    raise exception 'FAIL 1b: submit / urgency did not land with the signature and set_by stamped';
  end if;
  -- an untied doctor
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_sqlstate := null;
  begin perform public.create_specialist_referral(v_pat, v_stype, 'clinician_initiated', 'routine', 'x', 'y', '[]'::jsonb, true);
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '42501' then raise exception 'FAIL 1c: an untied doctor created a referral'; end if;
  foreach v_sqlstate in array array['urgency', 'waitlist', 'decline'] loop
    v_failed := false;
    begin
      if v_sqlstate = 'urgency' then perform public.set_referral_urgency(v_ref, 'urgent');
      elsif v_sqlstate = 'waitlist' then perform public.waitlist_referral(v_ref, 'plan');
      else perform public.decline_referral(v_ref, 'no'); end if;
    exception when others then v_failed := true; end;
    if not v_failed then raise exception 'FAIL 1d: an untied doctor could % a referral she cannot see', v_sqlstate; end if;
  end loop;
  execute 'reset role';
  if (select urgency from public.specialist_referrals where id = v_ref) <> 'priority' then
    raise exception 'FAIL 1d: an untied write changed the referral';
  end if;

  -- the assigned specialist and the desk can act
  -- fixture only: self-arranged referrals cannot be matched to an in-house specialist, so switch the guard off
  alter table public.specialist_referrals disable trigger specialist_referrals_enforce_fulfilment;   -- stays off for the rest of this rolled-back proof
  update public.specialist_referrals set assigned_specialist_id = v_spec_staff where id = v_ref;
  perform set_config('request.jwt.claims', json_build_object('sub', v_spec, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.record_referral_treatment_plan(v_ref, 'S05e plan note');
  execute 'reset role';
  if not exists (select 1 from public.specialist_referrals where id = v_ref and treatment_plan_received_at is not null) then
    raise exception 'FAIL 1e: the assigned specialist could not record the treatment plan';
  end if;
  -- the specialist reads it too (kept assigned for the read checks below); the fulfilment guard stays off until the end of the proof
  perform set_config('request.jwt.claims', json_build_object('sub', v_desk, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.record_referral_shared_care_handback(v_ref);
  execute 'reset role';
  if not exists (select 1 from public.specialist_referrals where id = v_ref and shared_care_handback_at is not null) then
    raise exception 'FAIL 1f: the referral desk could not act on the referral';
  end if;

  -- ===== 2. reads =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.get_referral_audited(v_ref, 'S05e proof: creator review') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or (v_json -> 'referral' -> 'patient' ->> 'full_name') <> 'S05e Patient' then
    raise exception 'FAIL 2a: the tied creator did not get the referral with its patient: %', v_json;
  end if;
  for v_n in 1..2 loop
    perform set_config('request.jwt.claims', json_build_object('sub', (array[v_spec, v_desk])[v_n], 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.get_referral_audited(v_ref, 'S05e proof: assigned or desk read') into v_json;
    execute 'reset role';
    if v_json ->> 'status' <> 'ok' then raise exception 'FAIL 2b: session % (specialist / desk) was denied: %', v_n, v_json; end if;
  end loop;
  for v_n in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', (array[v_untied, v_ph, v_other])[v_n], 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.get_referral_audited(v_ref, 'S05e proof: attempt without a tie') into v_json;
    execute 'reset role';
    if v_json ->> 'status' <> 'denied' or v_json ? 'referral' then raise exception 'FAIL 2c: session % was not denied: %', v_n, v_json; end if;
  end loop;
  if not exists (select 1 from public.audit_log where action = 'staff.chart_read' and actor_id = v_untied and result = 'denied' and subject_patient_id = v_pat) then
    raise exception 'FAIL 2c: the refusal was not audited';
  end if;
  -- the patient's per-patient list: ok for the tied doctor, denied for the untied one (not an empty ok)
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.list_patient_referrals_audited(v_pat, 'S05e proof: patient referrals', true) into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'referrals') <> 1 then raise exception 'FAIL 2d: tied list wrong: %', v_json; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.list_patient_referrals_audited(v_pat, 'S05e proof: untied list attempt', true) into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'denied' then raise exception 'FAIL 2d: an untied list was not denied: %', v_json; end if;
  -- the queue holds only what the caller may see
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.list_referrals_audited() into v_json;
  execute 'reset role';
  if jsonb_array_length(v_json) <> 0 then raise exception 'FAIL 2e: an untied doctor''s queue holds % referrals', jsonb_array_length(v_json); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_desk, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.list_referrals_audited() into v_json;
  execute 'reset role';
  if jsonb_array_length(v_json) <> 1 then raise exception 'FAIL 2e: the desk queue holds % referrals, expected 1', jsonb_array_length(v_json); end if;
  -- patient caller raises; short reason raises; anon cannot execute
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_sqlstate := null;
  begin perform public.get_referral_audited(v_ref, 'S05e proof: patient attempt');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '42501' then raise exception 'FAIL 2f: a patient caller was not refused'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_sqlstate := null;
  begin perform public.get_referral_audited(v_ref, 'short');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  execute 'reset role';
  if not v_failed or v_sqlstate <> '22023' then raise exception 'FAIL 2g: a short reason was accepted'; end if;
  if has_function_privilege('anon', 'public.get_referral_audited(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_specialist_referral(uuid,public.specialist_type,public.referral_source,public.referral_urgency,text,text,jsonb,boolean,timestamptz)', 'EXECUTE') then
    raise exception 'FAIL 2h: anon can execute a referral function';
  end if;

  -- ===== 3. counts follow the rule =====
  for v_n in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', (array[v_tied, v_untied, v_desk])[v_n], 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.referral_worklist_count('needing_urgency') into v_sqlstate;
    execute 'reset role';
    if v_sqlstate::int <> (array[1, 0, 1])[v_n] then raise exception 'FAIL 3a: session % counts % pending referrals', v_n, v_sqlstate; end if;
  end loop;

  v_failed := false;
  begin perform public.referral_worklist_count('nonsense');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 3b: an unknown count kind returned a quiet number'; end if;
  -- the outcome document may only live in the patient's own folder
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.set_referral_outcome_document(v_ref, v_other::text || '/someone-elses.pdf');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 3c: an outcome document path in another folder was accepted'; end if;
  perform public.set_referral_outcome_document(v_ref, v_pat::text || '/letter.pdf');
  execute 'reset role';
  if not exists (select 1 from public.specialist_referrals where id = v_ref and outcome_document_path = v_pat::text || '/letter.pdf') then
    raise exception 'FAIL 3c: the right path was not saved (the gate does not open)';
  end if;
  update public.specialist_referrals set outcome_document_path = null where id = v_ref;

  -- ===== 4. the table is closed =====
  for v_n in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', (array[v_tied, v_untied, v_desk])[v_n], 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    if (select count(*) from public.specialist_referrals) <> 0 then raise exception 'FAIL 4a: session % read the table directly', v_n; end if;
    update public.specialist_referrals set urgency = 'urgent' where id = v_ref;
    get diagnostics v_sqlstate = row_count;
    if v_sqlstate::int <> 0 then raise exception 'FAIL 4a: session % updated the table directly', v_n; end if;
    v_failed := false;
    begin insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, status) values (v_org, v_pat, v_stype, 'draft');
    exception when others then v_failed := true; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL 4a: session % inserted into the table directly', v_n; end if;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.specialist_referrals;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL 4b: the patient reads % of her referrals, expected 1', v_n; end if;

  -- ===== 5. patient_care_gaps keeps its overdue referral rows for those who may see them =====
  update public.specialist_referrals set created_at = now() - interval '40 days', submitted_at = now() - interval '40 days',
         treatment_plan_received_at = null, treatment_plan_note = null where id = v_ref;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_care_gaps where gap_type = 'overdue_referral' and patient_id = v_pat;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL 5a: the tied doctor sees % overdue-referral gaps, expected 1', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_care_gaps where gap_type = 'overdue_referral' and patient_id = v_pat;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 5b: an untied doctor sees an overdue-referral gap'; end if;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  select count(*) into v_n from public.patient_care_gaps where gap_type = 'overdue_referral' and patient_id = v_pat;
  if v_n <> 1 then raise exception 'FAIL 5c: the service role (aggregate) lost the overdue-referral gap'; end if;
  -- a SECURITY DEFINER function behind analytics / outreach queueing runs as the table owner even when an untied staff session called
  -- it, and must keep seeing every overdue referral (current_user is the owner here, not `authenticated`)
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.patient_care_gaps where gap_type = 'overdue_referral' and patient_id = v_pat;
  if v_n <> 1 then raise exception 'FAIL 5d: a definer-run reader lost the overdue-referral gap for an untied caller'; end if;

  -- ===== 6. SABOTAGE =====
  create policy s05e_sabotage_old_read on public.specialist_referrals for select to authenticated using (private.is_org_staff(organisation_id));
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.specialist_referrals;
  execute 'reset role';
  drop policy s05e_sabotage_old_read on public.specialist_referrals;
  if v_n = 0 then raise exception 'FAIL SABOTAGE 6a: the old policy did not expose the table, so check 4a proves nothing'; end if;

  create or replace function private.referral_visible(p_patient uuid, p_org uuid, p_referred_by uuid, p_assigned uuid)
    returns boolean language sql stable security definer set search_path = '' as 'select true';
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.get_referral_audited(v_ref, 'S05e proof: sabotage of the rule') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' then raise exception 'FAIL SABOTAGE 6b: with the rule stubbed the untied read was still denied, so check 2c proves nothing'; end if;

  raise notice 'S05e proof: all checks and 2 sabotages passed';
end $$;

rollback;
