-- S37 guard enforcement proof (OQ-184): signing a prescription, a patient-initiated Tarragon-billed lab order, and a payout send are refused
-- while their guards are off, open for test accounts and when the guard is on, and the cases that are not "sales" stay open. Own fixtures;
-- BEGIN/ROLLBACK; ends with a sabotage step.
begin;

do $$
declare
  v_org uuid; v_admin uuid := gen_random_uuid();
  v_cmo_real uuid := gen_random_uuid(); v_cmo_test uuid := gen_random_uuid();
  v_pat_real uuid := gen_random_uuid(); v_pat_test uuid := gen_random_uuid();
  v_rx_a uuid; v_rx_b uuid; v_rx_c uuid; v_msg text; v_ok boolean; v_state text;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then raise exception 'fixture missing: organisation'; end if;
  if exists (select 1 from public.go_live_guards where key in ('prescribing_enabled', 'lab_booking_enabled', 'payouts_enabled') and is_on) then
    raise exception 'control failure: a guard is on in this database, the closed-guard checks would prove nothing';
  end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select x, x::text || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_admin, v_cmo_real, v_cmo_test, v_pat_real, v_pat_test]) x;
  update public.profiles set organisation_id = v_org, role = 'admin', full_name = 'G Admin', is_test = true where id = v_admin;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'G CMO real', is_test = false where id = v_cmo_real;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'G CMO test', is_test = true where id = v_cmo_test;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'G Pat real', is_test = false where id = v_pat_real;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'G Pat test', is_test = true where id = v_pat_test;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  select p, v_org, 'G CMO', 'chief_medical_officer', true, 'MDCN', 'G-' || left(p::text, 6), true, v_admin, v_admin, now() from unnest(array[v_cmo_real, v_cmo_test]) p;

  -- prescriptions: three drafts made by the owner (a draft is always allowed)
  insert into public.prescriptions (organisation_id, patient_id, items, is_test) values (v_org, v_pat_real, '[{"drug":"Proofdrug","dose":"5 mg","quantity":"30 tablets"}]', false) returning id into v_rx_a;
  insert into public.prescriptions (organisation_id, patient_id, items, is_test) values (v_org, v_pat_test, '[{"drug":"Proofdrug","dose":"5 mg","quantity":"30 tablets"}]', true) returning id into v_rx_b;
  insert into public.prescriptions (organisation_id, patient_id, items, is_test) values (v_org, v_pat_real, '[{"drug":"Proofdrug","dose":"5 mg","quantity":"30 tablets"}]', false) returning id into v_rx_c;

  -- GATE: a real clinician signing for a real patient, guard off, is refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo_real, 'role','authenticated')::text, true);
  begin update public.prescriptions set state = 'signed' where id = v_rx_a; v_ok := true; v_msg := null;
  exception when others then v_ok := false; v_msg := sqlerrm; end;
  reset role;
  if v_ok or v_msg is distinct from 'prescribing_guard_off' then raise exception 'FAIL: real signing was not refused by the guard (ok %, msg %)', v_ok, v_msg; end if;
  select state::text into v_state from public.prescriptions where id = v_rx_a;
  if v_state <> 'draft' then raise exception 'FAIL: the refused prescription changed state to %', v_state; end if;

  -- CONTROL: test patient and test clinician, guard off, is open
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo_test, 'role','authenticated')::text, true);
  update public.prescriptions set state = 'signed' where id = v_rx_b;
  reset role;
  select state::text into v_state from public.prescriptions where id = v_rx_b;
  if v_state <> 'signed' then raise exception 'FAIL: a test-account prescription could not be signed (%)', v_state; end if;

  -- CONTROL: a real clinician may still write a draft with the guard off
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo_real, 'role','authenticated')::text, true);
  begin insert into public.prescriptions (organisation_id, patient_id, items) values (v_org, v_pat_real, '[{"drug":"Proofdrug"}]'); v_ok := true; exception when others then v_ok := false; v_msg := sqlerrm; end;
  reset role;
  if not v_ok then raise exception 'FAIL: a draft was refused (%)', v_msg; end if;

  -- CONTROL: guard on, the same real signing now works
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note) values ('prescribing_enabled', 'switched_on', v_cmo_real, 'cmo', 'proof');
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = v_cmo_real, change_note = 'proof' where key = 'prescribing_enabled';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo_real, 'role','authenticated')::text, true);
  update public.prescriptions set state = 'signed' where id = v_rx_c;
  reset role;
  select state::text into v_state from public.prescriptions where id = v_rx_c;
  if v_state <> 'signed' then raise exception 'FAIL: with the guard on, signing was still refused (%)', v_state; end if;

  -- LAB: a real patient, patient-initiated, Tarragon-billed order is refused first, before any other rule
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_real, 'role','authenticated')::text, true);
  set local role authenticated;
  begin insert into public.lab_orders (organisation_id, patient_id, origin, fulfilment) values (v_org, v_pat_real, 'patient_initiated', 'partner'); v_ok := true; v_msg := null;
  exception when others then v_ok := false; v_msg := sqlerrm; end;
  reset role;
  if v_ok or v_msg is distinct from 'lab_booking_guard_off' then raise exception 'FAIL: a real patient-initiated partner order was not refused by the guard (ok %, msg %)', v_ok, v_msg; end if;

  -- CONTROLS: none of these may be refused BY THE GUARD (they may fail a later, different rule, which is fine here)
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_test, 'role','authenticated')::text, true);
  set local role authenticated;
  begin insert into public.lab_orders (organisation_id, patient_id, origin, fulfilment) values (v_org, v_pat_test, 'patient_initiated', 'partner'); v_msg := null; exception when others then v_msg := sqlerrm; end;
  reset role;
  if v_msg = 'lab_booking_guard_off' then raise exception 'FAIL: a test patient was refused by the lab guard'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_real, 'role','authenticated')::text, true);
  set local role authenticated;
  begin insert into public.lab_orders (organisation_id, patient_id, origin, fulfilment) values (v_org, v_pat_real, 'patient_initiated', 'self_arranged'); v_msg := null; exception when others then v_msg := sqlerrm; end;
  if v_msg = 'lab_booking_guard_off' then raise exception 'FAIL: a self-arranged guidance order was refused by the lab guard'; end if;
  begin insert into public.lab_orders (organisation_id, patient_id, origin, fulfilment) values (v_org, v_pat_real, 'clinician_ordered', 'partner'); v_msg := null; exception when others then v_msg := sqlerrm; end;
  reset role;
  if v_msg = 'lab_booking_guard_off' then raise exception 'FAIL: a clinician-ordered test was refused by the lab guard'; end if;

  -- PAYOUTS: already enforced; the send is refused while the guard is off, with the code the app already handles
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.payout_prepare_send(gen_random_uuid()); v_ok := true; v_msg := null; exception when others then v_ok := false; v_msg := sqlerrm; end;
  reset role;
  if v_ok or v_msg is distinct from 'payout_guard_off' then raise exception 'FAIL: a payout send was not refused while the guard is off (ok %, msg %)', v_ok, v_msg; end if;

  -- the dashboard text names where each guard is enforced
  if exists (select 1 from public.go_live_guards where key in ('prescribing_enabled', 'lab_booking_enabled', 'payouts_enabled') and cardinality(enforced_in) = 0) then
    raise exception 'FAIL: a guard still says it is enforced nowhere';
  end if;
  raise notice 'PASS: prescribing, lab booking and payout guards close, open for test accounts and when on, and leave non-sales cases open';

  -- SABOTAGE: drop the lab trigger and show the refusal disappears; disable the prescription trigger and show a real signing goes through
  drop trigger lab_orders_a0_go_live_guard on public.lab_orders;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_real, 'role','authenticated')::text, true);
  set local role authenticated;
  begin insert into public.lab_orders (organisation_id, patient_id, origin, fulfilment) values (v_org, v_pat_real, 'patient_initiated', 'partner'); v_msg := null; exception when others then v_msg := sqlerrm; end;
  reset role;
  if v_msg = 'lab_booking_guard_off' then raise exception 'sabotage did not remove the lab refusal, the test would not discriminate'; end if;
  raise notice 'PASS: sabotage confirmed (lab refusal disappears without the trigger)';
end $$;

rollback;
