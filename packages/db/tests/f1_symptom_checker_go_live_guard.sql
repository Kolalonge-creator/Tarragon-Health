-- Proof (F1 fix 3): the symptom checker is behind the S37 go-live guard `symptom_checker_enabled`, seeded OFF.
--
--   1. The guard exists, is off, reads closed, and has six conditions (four attested, two read from the data).
--   2. With the guard off, a real patient's assessment cannot be recorded even through the service role (the path the
--      web action uses); the refusal is 42501. A test patient still can (the S37 test rule), so the flow stays testable.
--   3. It cannot be switched on while conditions are unmet: first nothing is met; the data conditions cannot be attested;
--      the four attestable conditions can; the switch is STILL refused while the active escalation SLA lacks symptom_triage.
--   4. The reason the SLA condition exists: with the active SLA lacking symptom_triage, an urgent assessment cannot be
--      recorded at all (no SLA raises). A DRAFT SLA carrying the pathway exists, unsigned and inactive.
--   5. With every condition met the CMO switches it on, a real patient's assessment is then recorded, and switching it
--      off closes it again.
--   SABOTAGE: with the trigger dropped a real patient gets through while the guard is off; the refusal check must flip.
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception.
begin;

create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_service() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'f1-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'F1 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  if not p_test then update public.profiles set is_test = false where id = v; end if;
  return v;
end $f$;
create function pg_temp.mkcmo(p_org uuid, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, 'cmo', 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'F1 cmo', 'MDCN', 'F1-cmo-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      'chief_medical_officer', 'contracted', 2, true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;
create function pg_temp.assess(p_org uuid, p_patient uuid) returns text language plpgsql as
$f$ begin
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen,
     category, clinician_review_required, safety_net_message_key, rationale)
  values (p_org, p_patient, 'headache', (select min(version) from public.triage_protocols), '{}', '[]', '{}',
          'routine', false, 'routine', 'F1 proof');
  return 'ok';
exception when others then return sqlstate;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_real uuid; v_test uuid; v_r text; v_ver integer; v_n integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  if not exists (select 1 from public.triage_protocols) then raise exception 'fixture: need a triage_protocols row'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo   := pg_temp.mkcmo(v_org, v_admin);
  v_real  := pg_temp.mkuser(v_org, 'real', 'patient', false);
  v_test  := pg_temp.mkuser(v_org, 'test', 'patient', true);

  -- 1. shape
  if not exists (select 1 from public.go_live_guards where key = 'symptom_checker_enabled' and not is_on and switch_role = 'cmo') then
    raise exception 'FAIL 1a: guard missing, on, or not CMO-switched';
  end if;
  if private.go_live_open('symptom_checker_enabled') then raise exception 'FAIL 1b: guard reads open'; end if;
  if jsonb_array_length(private.go_live_conditions('symptom_checker_enabled', v_org)) <> 6 then raise exception 'FAIL 1c: expected six conditions'; end if;

  -- 2. closed: a real patient is refused through the service role; a test patient is not
  perform pg_temp.act_service();
  v_r := pg_temp.assess(v_org, v_real);
  perform pg_temp.back();
  if v_r <> '42501' then raise exception 'FAIL 2a: real patient with the guard off got % (expected 42501)', v_r; end if;
  perform pg_temp.act_service();
  v_r := pg_temp.assess(v_org, v_test);
  perform pg_temp.back();
  if v_r <> 'ok' then raise exception 'FAIL 2b: a test patient should still be able to try the flow, got %', v_r; end if;

  -- S60: two of the four attestations now need a record behind them (a regulatory position, an accuracy baseline report). Fixtures:
  insert into public.regulatory_positions (organisation_id, topic, position_text, classification, counsel_name, position_date, document_ref, attached_by, is_test)
  values (v_org, 'symptom_checker', 'Proof fixture: counsel advises the checker is decision support, labelled as such.', 'decision_support_not_a_device', 'F1 proof counsel', current_date, 'PROOF-DOC-REF', v_cmo, true);
  insert into public.symptom_accuracy_reports (organisation_id, period_start, period_end, config_version, is_baseline, includes_test_accounts, reviewed_total, cells)
  values (v_org, date '2020-01-01', date '2020-02-01', (select version from public.symptom_accuracy_config where is_active), true, true, 12, '[]');

  -- 3. cannot switch on while conditions are unmet
  perform pg_temp.act(v_cmo);
  begin
    perform public.set_go_live_guard('symptom_checker_enabled', true, 'trying with nothing met');
    raise exception 'FAIL 3a: switched on with no condition met';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.attest_go_live_condition('symptom_checker_enabled', 'symptom_triage_sla_signed', true, 'a data condition cannot be attested');
    raise exception 'FAIL 3b: a data condition was attested';
  exception when sqlstate '22023' then null;
  end;
  perform public.attest_go_live_condition('symptom_checker_enabled', 'nafdac_position_recorded', true, 'Counsel opinion recorded in DECISIONS (proof fixture)');
  perform public.attest_go_live_condition('symptom_checker_enabled', 'engine_licence_or_validation_recorded', true, 'Internal validation recorded (proof fixture)');
  perform public.attest_go_live_condition('symptom_checker_enabled', 'localisation_signoff_recorded', true, 'Localisation signed off (proof fixture)');
  perform public.attest_go_live_condition('symptom_checker_enabled', 'accuracy_baseline_recorded', true, 'Baseline recorded (proof fixture)');
  perform pg_temp.back();

  -- the SLA data condition is still unmet: the active config has no symptom_triage
  if exists (select 1 from jsonb_array_elements(private.go_live_conditions('symptom_checker_enabled', v_org)) c
              where c ->> 'code' = 'symptom_triage_sla_signed' and (c ->> 'met')::boolean) then
    raise exception 'FAIL 3c: the SLA condition reads met while the active SLA lacks symptom_triage';
  end if;
  perform pg_temp.act(v_cmo);
  begin
    perform public.set_go_live_guard('symptom_checker_enabled', true, 'attested but SLA missing');
    raise exception 'FAIL 3d: switched on while the active SLA lacks symptom_triage';
  exception when sqlstate '22023' then null;
  end;
  perform pg_temp.back();

  -- 4. why: with no symptom_triage SLA an urgent assessment cannot be recorded; and the draft exists, unsigned
  begin
    perform private.escalation_sla_minutes('symptom_triage', 'urgent_escalation');
    raise exception 'FAIL 4a: the active SLA unexpectedly carries symptom_triage already';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  select version into v_ver from public.escalation_slas
   where notes like 'DRAFT, UNSIGNED (F1%' and not is_active and approved_at is null and approved_by is null limit 1;
  if v_ver is null then raise exception 'FAIL 4b: the unsigned draft SLA carrying symptom_triage is missing'; end if;
  select count(*) into v_n from public.escalation_slas s, jsonb_array_elements(s.config) e
   where s.version = v_ver and e ->> 'pathway' = 'symptom_triage';
  if v_n <> 2 then raise exception 'FAIL 4c: the draft should carry exactly two symptom_triage tiers, has %', v_n; end if;
  if exists (select 1 from public.escalation_slas s, jsonb_array_elements(s.config) e
              where s.version = v_ver and e ->> 'pathway' = 'symptom_triage' and e::text ilike '%whatsapp%') then
    raise exception 'FAIL 4d: the draft names the removed WhatsApp channel';
  end if;

  -- 5. all conditions met: sign (fixture only, inside this rolled-back transaction) then switch on, assess, switch off
  update public.triage_protocols set is_active = true where version = (select min(version) from public.triage_protocols) and not is_active;
  update public.escalation_slas s set config = d.config
    from (select config from public.escalation_slas where version = v_ver) d
   where s.is_active;
  perform pg_temp.act(v_cmo);
  perform public.set_go_live_guard('symptom_checker_enabled', true, 'proof: every condition met');
  perform pg_temp.back();
  perform pg_temp.act_service();
  v_r := pg_temp.assess(v_org, v_real);
  perform pg_temp.back();
  if v_r <> 'ok' then raise exception 'FAIL 5a: with the guard on a real patient should be recorded, got %', v_r; end if;
  perform pg_temp.act(v_cmo);
  perform public.set_go_live_guard('symptom_checker_enabled', false, 'proof: stop');
  perform pg_temp.back();
  perform pg_temp.act_service();
  v_r := pg_temp.assess(v_org, v_real);
  perform pg_temp.back();
  if v_r <> '42501' then raise exception 'FAIL 5b: after switching off a real patient got %', v_r; end if;

  -- SABOTAGE: drop the trigger; the same refusal must now flip to success
  drop trigger symptom_triage_assessments_00_go_live_guard on public.symptom_triage_assessments;
  perform pg_temp.act_service();
  v_r := pg_temp.assess(v_org, v_real);
  perform pg_temp.back();
  if v_r <> 'ok' then
    raise exception 'VACUOUS TEST: with the trigger dropped a real patient was still refused (%), so the trigger is not what refuses', v_r;
  end if;

  raise notice 'PASS: symptom checker guard seeded off, refuses at the table, cannot switch on until SLA and attestations are met, draft SLA unsigned';
end $$;

rollback;
