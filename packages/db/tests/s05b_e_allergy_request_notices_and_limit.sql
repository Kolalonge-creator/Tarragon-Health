-- ===========================================================================
-- Proof: *_s05b_e_allergy_request_notices_and_resubmit_limit.sql (S05b-e).
--
--   A. A patient's allergy request sends ONE in-app notice to the tied non-coordinator clinician and to nobody else (not the care
--      coordinator on the same care team, not an untied clinician, not the patient). The notice and its stored payload name no allergen
--      and no clinical word, and nothing goes out on sms or email (INV-07, INV-08).
--   B. A confirmation sends the patient ONE in-app "record updated" notice (also free of clinical words); a rejection and a withdrawal send
--      none of that kind.
--   C. At most 3 requests per allergy in a rolling 7 days: the 4th is refused with a calm message (any earlier outcome counts, so
--      withdrawing and asking again is not a way round it); another allergy is unaffected; once the three are older than 7 days the
--      patient may ask again.
--   D. SABOTAGE (each must flip): rate-limit trigger dropped, arrival trigger dropped, confirmation trigger dropped, recipient list made
--      permissive (the coordinator is then notified).
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_p   uuid := gen_random_uuid();
  v_c   uuid := gen_random_uuid();   -- tied clinician (senior)
  v_u   uuid := gen_random_uuid();   -- untied clinician
  v_cc  uuid := gen_random_uuid();   -- care coordinator on the care team
  v_a1 uuid; v_a2 uuid; v_a3 uuid; v_a4 uuid; v_a5 uuid; v_a6 uuid; v_a7 uuid; v_a8 uuid;
  v_res jsonb;
  v_req uuid; v_req2 uuid;
  v_state text;
  v_msg text;
  v_n int;
  v_text text;
  v_flipped boolean;
  i int;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_p,  's05be-p@example.invalid',  'x', now(), '{}', '{}'),
    (v_c,  's05be-c@example.invalid',  'x', now(), '{}', '{}'),
    (v_u,  's05be-u@example.invalid',  'x', now(), '{}', '{}'),
    (v_cc, 's05be-cc@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_p,  v_org, 'patient',   'S05be Patient',   '+2348055580001'),
    (v_c,  v_org, 'clinician', 'S05be Tied Doctor',   '+2348055580002'),
    (v_u,  v_org, 'clinician', 'S05be Untied Doctor', '+2348055580003'),
    (v_cc, v_org, 'clinician', 'S05be Coordinator',   '+2348055580004')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_c,  'S05be Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org, v_u,  'S05be Untied Doctor', true, now(), 'senior_medical_officer'),
    (v_org, v_cc, 'S05be Coordinator',   true, now(), 'care_coordinator');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at)
  values (v_org, v_p, v_c, v_cc, now()) on conflict (patient_id) do update set clinician_id = v_c, care_coordinator_id = v_cc;

  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Peanut',    'moderate', 'patient') returning id into v_a1;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Shellfish', 'mild',     'patient') returning id into v_a2;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Latex',     'mild',     'patient') returning id into v_a3;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Sesame',    'mild',     'patient') returning id into v_a4;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Dust',      'mild',     'patient') returning id into v_a5;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Mould',     'mild',     'patient') returning id into v_a6;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Pollen',    'mild',     'patient') returning id into v_a7;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Egg',       'mild',     'patient') returning id into v_a8;

  -- ======================================================================== A. the arrival notice
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a1, 'entered_in_error', 'I do not have this allergy', null);
  execute 'reset role';
  v_req := (v_res ->> 'request_id')::uuid;
  select count(*) into v_n from public.notifications where recipient_id = v_c and template = 'record_change_request_waiting';
  if v_n <> 1 then raise exception 'FAIL A1: the tied clinician got % arrival notices, expected 1', v_n; end if;
  select count(*) into v_n from public.notifications where recipient_id in (v_cc, v_u, v_p) and template = 'record_change_request_waiting';
  if v_n <> 0 then raise exception 'FAIL A2: the notice reached a coordinator, an untied clinician or the patient (%)', v_n; end if;
  if exists (select 1 from public.notifications where template = 'record_change_request_waiting' and (channel <> 'in_app' or content_class <> 'non_clinical')) then
    raise exception 'FAIL A3: an arrival notice left the in-app rail or is not marked non-clinical';
  end if;
  select string_agg(coalesce(l.subject, '') || ' ' || coalesce(l.body, ''), ' ') into v_text
    from public.notification_template_locales l where l.template_key in ('record_change_request_waiting', 'record_change_confirmed');
  if v_text ~* '(allerg|peanut|reaction|severe|medic|drug|diagnos|condition)' then raise exception 'FAIL A4: a notice wording carries a clinical word (%)', v_text; end if;
  select string_agg(payload::text, ' ') into v_text from public.notifications where template = 'record_change_request_waiting';
  if v_text ~* '(allerg|peanut|reaction)' or (select count(*) from public.notifications n, jsonb_object_keys(n.payload) k
                                               where n.template = 'record_change_request_waiting' and k <> 'request_id') <> 0 then
    raise exception 'FAIL A5: the stored payload carries more than the request id (%)', v_text;
  end if;
  raise notice 'PASS A: one in-app notice to the tied doctor only, no clinical words';

  -- ======================================================================== B. the confirmation notice
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.confirm_patient_allergy_correction(v_req, 'checked with the patient');
  execute 'reset role';
  select count(*) into v_n from public.notifications where recipient_id = v_p and template = 'record_change_confirmed' and channel = 'in_app';
  if v_n <> 1 then raise exception 'FAIL B1: the patient got % confirmation notices, expected 1', v_n; end if;
  if exists (select 1 from public.notifications where template = 'record_change_confirmed' and (recipient_id <> v_p or content_class <> 'non_clinical')) then
    raise exception 'FAIL B2: a confirmation notice went to somebody else or is not non-clinical';
  end if;
  -- a rejection and a withdrawal do not send the confirmation notice
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a5, 'entered_in_error', 'Dust was typed by mistake', null);
  v_req2 := (v_res ->> 'request_id')::uuid;
  perform public.withdraw_patient_allergy_correction(v_req2);
  v_res := public.correct_clinical_value('patient_allergies', v_a5, 'entered_in_error', 'Dust was typed by mistake', null);
  execute 'reset role';
  v_req2 := (v_res ->> 'request_id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.reject_patient_allergy_correction(v_req2, 'internal only');
  execute 'reset role';
  select count(*) into v_n from public.notifications where recipient_id = v_p and template = 'record_change_confirmed';
  if v_n <> 1 then raise exception 'FAIL B3: a withdrawal or rejection sent a confirmation notice (%)', v_n; end if;
  raise notice 'PASS B: one confirmation notice to the patient, none for reject or withdraw';

  -- ======================================================================== C. at most 3 requests per allergy in 7 days
  for i in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := public.correct_clinical_value('patient_allergies', v_a2, 'entered_in_error', 'Shellfish was typed by mistake', null);
    perform public.withdraw_patient_allergy_correction((v_res ->> 'request_id')::uuid);
    execute 'reset role';
  end loop;
  v_state := null; v_msg := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.correct_clinical_value('patient_allergies', v_a2, 'entered_in_error', 'Shellfish was typed by mistake', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  execute 'reset role';
  if v_state is distinct from '22023' or v_msg not like '%message your care team%' then
    raise exception 'FAIL C1: the 4th request in 7 days was not refused with the calm message (state %, message %)', v_state, v_msg;
  end if;
  if v_msg ~* '(allerg|shellfish|limit|error|exception)' then raise exception 'FAIL C1b: the refusal wording is not plain (%)', v_msg; end if;
  select count(*) into v_n from public.patient_allergy_correction_requests where allergy_id = v_a2;
  if v_n <> 3 then raise exception 'FAIL C2: a refused request left a row behind (%)', v_n; end if;
  -- another allergy is not affected
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a3, 'entered_in_error', 'Latex was typed by mistake', null);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'pending' then raise exception 'FAIL C3: another allergy was refused (%)', v_res; end if;
  -- once the three are older than 7 days she may ask again (the audit guard is lifted only for this backdating, inside the rolled-back test)
  alter table public.patient_allergy_correction_requests disable trigger patient_allergy_correction_requests_guard;
  update public.patient_allergy_correction_requests set created_at = now() - interval '8 days' where allergy_id = v_a2;
  alter table public.patient_allergy_correction_requests enable trigger patient_allergy_correction_requests_guard;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a2, 'entered_in_error', 'Shellfish was typed by mistake', null);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'pending' then raise exception 'FAIL C4: the window did not roll (%)', v_res; end if;
  -- requests the system itself closed as void (the entry was changed another way) do not use up her three
  for i in 1..3 loop
    insert into public.patient_allergy_correction_requests (organisation_id, patient_id, allergy_id, requested_status, reason, status, decided_at)
    values (v_org, v_p, v_a6, 'entered_in_error', 'closed by the system', 'void', now());
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a6, 'entered_in_error', 'Mould was typed by mistake', null);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'pending' then raise exception 'FAIL C5: void requests used up the limit (%)', v_res; end if;
  raise notice 'PASS C: 3 per allergy per rolling 7 days, calm refusal, other allergies unaffected, void does not count';

  -- ======================================================================== E. a notice that cannot be written never undoes the request or the confirmation
  create function pg_temp.fail_notices() returns trigger language plpgsql as $f$ begin raise exception 'simulated notification failure'; end $f$;
  create trigger zz_fail_notices before insert on public.notifications
    for each row when (new.template in ('record_change_request_waiting', 'record_change_confirmed')) execute function pg_temp.fail_notices();
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a7, 'entered_in_error', 'Pollen was typed by mistake', null);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'pending' then raise exception 'FAIL E1: a failing notice stopped the request (%)', v_res; end if;
  select count(*) into v_n from public.notifications where template = 'record_change_request_waiting' and (payload ->> 'request_id')::uuid = (v_res ->> 'request_id')::uuid;
  if v_n <> 0 then raise exception 'FAIL E2: the failing-notice fixture did not fail'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.confirm_patient_allergy_correction((v_res ->> 'request_id')::uuid, null);
  execute 'reset role';
  if (select correction_status from public.patient_allergies where id = v_a7) is distinct from 'entered_in_error' then
    raise exception 'FAIL E3: a failing confirmation notice undid the confirmation';
  end if;
  drop trigger zz_fail_notices on public.notifications;
  raise notice 'PASS E: a notice that cannot be written does not undo the request or the confirmation';

  -- ======================================================================== D. sabotage (each must flip)
  -- D1: without the limit trigger a 4th request in a week is accepted
  v_flipped := false;
  begin
    drop trigger patient_allergy_correction_requests_rate_limit on public.patient_allergy_correction_requests;
    for i in 1..4 loop
      perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := public.correct_clinical_value('patient_allergies', v_a4, 'entered_in_error', 'Sesame was typed by mistake', null);
      perform public.withdraw_patient_allergy_correction((v_res ->> 'request_id')::uuid);
      execute 'reset role';
    end loop;
    v_flipped := true;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL D1: sabotage did not flip (the limit proof is vacuous)'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'patient_allergy_correction_requests_rate_limit') then raise exception 'FAIL D1b: sabotage was not undone'; end if;

  -- D2: without the arrival trigger the tied clinician is not told
  v_flipped := false;
  begin
    drop trigger patient_allergy_correction_requests_notify_arrived on public.patient_allergy_correction_requests;
    delete from public.notifications where template = 'record_change_request_waiting';
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.correct_clinical_value('patient_allergies', v_a4, 'entered_in_error', 'Sesame was typed by mistake', null);
    execute 'reset role';
    select count(*) into v_n from public.notifications where recipient_id = v_c and template = 'record_change_request_waiting';
    if v_n = 0 then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL D2: sabotage did not flip (the arrival-notice proof is vacuous)'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'patient_allergy_correction_requests_notify_arrived') then raise exception 'FAIL D2b: sabotage was not undone'; end if;

  -- D3: without the confirmation trigger the patient is not told
  v_flipped := false;
  begin
    drop trigger patient_allergy_correction_requests_notify_confirmed on public.patient_allergy_correction_requests;
    delete from public.notifications where template = 'record_change_confirmed';
    -- (the Latex request from section C is still waiting)
    v_req2 :=(select id from public.patient_allergy_correction_requests where allergy_id = v_a3 and status = 'pending');
    perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.confirm_patient_allergy_correction(v_req2, null);
    execute 'reset role';
    select count(*) into v_n from public.notifications where recipient_id = v_p and template = 'record_change_confirmed';
    if v_n = 0 then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL D3: sabotage did not flip (the confirmation-notice proof is vacuous)'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'patient_allergy_correction_requests_notify_confirmed') then raise exception 'FAIL D3b: sabotage was not undone'; end if;

  -- D4: with a permissive recipient list the coordinator and the untied clinician are told too
  v_flipped := false;
  begin
    create or replace function private.allergy_request_recipients(p_patient uuid) returns table (profile_id uuid)
      language sql stable as 'select cs.profile_id from public.clinical_staff cs';
    delete from public.notifications where template = 'record_change_request_waiting';
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.correct_clinical_value('patient_allergies', v_a4, 'entered_in_error', 'Sesame was typed by mistake', null);
    execute 'reset role';
    select count(*) into v_n from public.notifications where recipient_id in (v_cc, v_u) and template = 'record_change_request_waiting';
    if v_n > 0 then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL D4: sabotage did not flip (the recipient proof is vacuous)'; end if;
  if position('care_team_assignment' in pg_get_functiondef('private.allergy_request_recipients(uuid)'::regprocedure)) = 0 then
    raise exception 'FAIL D4b: sabotage was not undone (the recipient list is still permissive)';
  end if;

  -- D5: counting void rows too (the old rule) refuses a patient whose three earlier requests were closed by the system
  v_flipped := false;
  begin
    select pg_get_functiondef(p.oid) into v_text from pg_proc p where p.proname = 'patient_allergy_request_rate_limit' and p.pronamespace = 'private'::regnamespace;
    if position('r.status <> ''void'' and ' in v_text) = 0 then raise exception 'sabotage anchor missing'; end if;
    execute replace(v_text, 'r.status <> ''void'' and ', '');
    for i in 1..3 loop
      insert into public.patient_allergy_correction_requests (organisation_id, patient_id, allergy_id, requested_status, reason, status, decided_at)
      values (v_org, v_p, v_a8, 'entered_in_error', 'closed by the system', 'void', now());
    end loop;
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin perform public.correct_clinical_value('patient_allergies', v_a8, 'entered_in_error', 'Egg was typed by mistake', null);
    exception when others then v_flipped := true; end;
    execute 'reset role';
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL D5: sabotage did not flip (the void-exclusion proof is vacuous)'; end if;
  if position('r.status <> ''void''' in pg_get_functiondef('private.patient_allergy_request_rate_limit()'::regprocedure)) = 0 then
    raise exception 'FAIL D5b: sabotage was not undone';
  end if;

  -- D6: with an unguarded arrival trigger a notice that cannot be written takes the patient's request down with it
  v_flipped := false;
  begin
    create or replace function private.notify_allergy_request_arrived() returns trigger language plpgsql security definer set search_path = '' as $f$
    begin
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
      select new.organisation_id, r.profile_id, 'in_app', 'pending', 'record_change_request_waiting', jsonb_build_object('request_id', new.id), 'non_clinical'
        from private.allergy_request_recipients(new.patient_id) r;
      return null;
    end $f$;
    create trigger zz_fail_notices before insert on public.notifications
      for each row when (new.template in ('record_change_request_waiting', 'record_change_confirmed')) execute function pg_temp.fail_notices();
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin perform public.correct_clinical_value('patient_allergies', v_a5, 'entered_in_error', 'Dust was typed by mistake', null);
    exception when others then get stacked diagnostics v_msg = message_text; if v_msg like '%simulated notification failure%' then v_flipped := true; end if; end;
    execute 'reset role';
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL D6: sabotage did not flip (the notice-failure proof is vacuous)'; end if;
  if position('exception when others' in pg_get_functiondef('private.notify_allergy_request_arrived()'::regprocedure)) = 0 then
    raise exception 'FAIL D6b: sabotage was not undone';
  end if;

  raise notice 'PASS D: six sabotages each flipped';
  raise notice 'S05b-e allergy request notices and resubmit limit proof complete';
end $$;

rollback;
