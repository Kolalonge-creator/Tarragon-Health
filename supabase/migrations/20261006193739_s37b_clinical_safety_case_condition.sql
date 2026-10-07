-- S37 follow-up: a clinical guard also needs a current clinical safety case and hazard log, recorded by a person.
-- Why: the live research (docs/research/S37.md) found the one control the NHS DCB0129 standard asks of a health IT
-- maker before release, a named safety officer's sign-off on a hazard log and safety case, was missing. The CMO could
-- switch a clinical feature on with no record of the safety evidence behind it. The database cannot see a document, so
-- this is an attestation (note names the document, version and signer; a later met = false withdraws it), exactly like
-- the CON-001 legal review. Adds the condition to clinical_operations_enabled, prescribing_enabled and scribe_enabled.
-- No guard is on, nothing is seeded or attested. Re-creates two functions only; no table, grant or trigger changes.

create or replace function private.go_live_conditions(p_key text, p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_n integer;
  v_gaps integer;
begin
  if p_key = 'clinical_operations_enabled' then
    -- the approved hypertension protocol is a public.protocols row (S24) whose code starts htn or hypertension (the S24 placeholder is htn_hearts_ng)
    select count(*) into v_n from public.protocols where status = 'approved' and code ~ '^(htn|hypertension)';
    return jsonb_build_array(
      private.go_live_cond('hypertension_protocol_approved', 'An approved hypertension protocol', v_n > 0, 'data', v_n || ' approved'),
      private.go_live_cond('triage_rule_set_approved', 'An approved blood pressure triage rule set',
        exists (select 1 from public.triage_rule_sets where status = 'approved' and code = 'bp_care_triage'), 'data',
        (select count(*) from public.triage_rule_sets where status = 'approved' and code = 'bp_care_triage') || ' approved'),
      private.go_live_cond('tier2_clinician_active', 'At least one active tier 2 clinician',
        (select count(*) from public.clinical_staff where active and status = 'active' and credentialing_level >= 2 and is_test is not true) > 0, 'data',
        (select count(*) from public.clinical_staff where active and status = 'active' and credentialing_level >= 2 and is_test is not true) || ' active'),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));
  elsif p_key = 'on_call_cover_ok' then
    select count(*) into v_gaps from private.rota_gaps(p_org, now(), now() + interval '7 days');
    return jsonb_build_array(
      private.go_live_cond('rota_covers_next_7_days', 'The rota covers the next 7 days with a primary and an eligible backup', v_gaps = 0, 'data', v_gaps || ' gaps'));
  elsif p_key = 'lab_booking_enabled' then
    return jsonb_build_array(
      private.go_live_cond('synlab_active', 'SYNLAB is an active laboratory partner',
        exists (select 1 from public.lab_providers where is_active and name ilike 'synlab%'), 'data', null),
      private.go_live_cond('collection_sites', 'SYNLAB has at least one active collection site',
        exists (select 1 from public.lab_provider_locations l join public.lab_providers p on p.id = l.lab_provider_id where l.is_active and p.is_active and p.name ilike 'synlab%'), 'data', null),
      private.go_live_cond('results_flow_tested', 'The results flow has been tested end to end', private.go_live_attested(p_key, 'results_flow_tested'), 'attestation', null));
  elsif p_key = 'prescribing_enabled' then
    select count(*) into v_n from public.pharmacy_partners where is_active and onboarding_status = 'activated';
    return jsonb_build_array(
      private.go_live_cond('pharmacy_partner_active', 'At least one active pharmacy partner', v_n > 0, 'data', v_n || ' active'),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('clinical_lead_signoff', 'Clinical lead sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  elsif p_key = 'scribe_enabled' then
    return jsonb_build_array(
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('con001_legal_review_recorded', 'Legal review of consent text CON-001 recorded', private.go_live_attested(p_key, 'con001_legal_review_recorded'), 'attestation', null),
      private.go_live_cond('speech_provider_configured', 'A speech-to-text provider is configured', private.go_live_attested(p_key, 'speech_provider_configured'), 'attestation', null));
  elsif p_key = 'payouts_enabled' then
    return jsonb_build_array(
      private.go_live_cond('fee_schedule_approved', 'A fee schedule is approved', private.go_live_attested(p_key, 'fee_schedule_approved'), 'attestation', null),
      private.go_live_cond('paystack_transfers_configured', 'Paystack transfers are configured', private.go_live_attested(p_key, 'paystack_transfers_configured'), 'attestation', null));
  elsif p_key = 'public_signup_enabled' then
    return jsonb_build_array(
      private.go_live_cond('stage2_exit_criteria_met', 'The Stage 2 exit criteria are met', private.go_live_attested(p_key, 'stage2_exit_criteria_met'), 'attestation', null));
  end if;
  -- An unknown key has no conditions, and a guard with no conditions is never satisfied (fail closed).
  return jsonb_build_array(private.go_live_cond('unknown_guard', 'This guard has no defined condition', false, 'data', null));
end $$;

create or replace function public.attest_go_live_condition(p_key text, p_code text, p_met boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if private.go_live_actor_role() is null then raise exception 'only an admin or the Chief Medical Officer can record this' using errcode = '42501'; end if;
  if not exists (select 1 from public.go_live_guards where key = p_key) then raise exception 'no such go-live guard: %', p_key using errcode = '22023'; end if;
  -- the conditions a person records (the rest are read from the data). A fixed list, so a broken data query cannot block recording one.
  if (p_key, p_code) not in (
       ('clinical_operations_enabled', 'clinical_safety_case_current'), ('prescribing_enabled', 'clinical_safety_case_current'),
       ('scribe_enabled', 'clinical_safety_case_current'),
       ('lab_booking_enabled', 'results_flow_tested'),
       ('scribe_enabled', 'con001_legal_review_recorded'), ('scribe_enabled', 'speech_provider_configured'),
       ('payouts_enabled', 'fee_schedule_approved'), ('payouts_enabled', 'paystack_transfers_configured'),
       ('public_signup_enabled', 'stage2_exit_criteria_met')) then
    raise exception 'that condition is read from the data (or does not exist), it cannot be attested' using errcode = '22023';
  end if;
  if p_met is null or length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'say what was checked and by whom, in a sentence' using errcode = '22023';
  end if;
  -- the safety case is the safety officer's: an admin who is not the CMO cannot record it
  if p_code = 'clinical_safety_case_current' and not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can record the clinical safety case' using errcode = '42501';
  end if;
  if p_code = 'clinical_safety_case_current' and p_met and length(btrim(p_note)) < 25 then
    raise exception 'name the safety case document, its version and who signed it' using errcode = '22023';
  end if;
  insert into public.go_live_attestations (guard_key, condition_code, met, note, attested_by)
  values (p_key, p_code, p_met, btrim(p_note), v_uid);
  perform private.log_audit('go_live_guard.condition_attested', 'go_live_guard', null, jsonb_build_object('key', p_key, 'code', p_code, 'met', p_met));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.go_live_conditions(text, uuid) from public;
revoke all on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;

do $$ begin
  if has_function_privilege('anon', 'public.attest_go_live_condition(text,text,boolean,text)', 'EXECUTE') then raise exception 'anon can execute attest_go_live_condition'; end if;
  if (select count(*) from public.go_live_guards where is_on) <> 0 then raise exception 'a guard is on'; end if;
  if not exists (select 1 from jsonb_array_elements(private.go_live_conditions('prescribing_enabled', null)) c where c ->> 'code' = 'clinical_safety_case_current') then
    raise exception 'safety case condition missing';
  end if;
end $$;
