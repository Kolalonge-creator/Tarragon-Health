-- Code review / replay rehearsal fix: the research_export_enabled guard (20261007212611) lists two conditions a person must attest
-- (counsel has cleared the basis for the recipient; the DPO appointment is on record), but public.attest_go_live_condition only accepts a
-- fixed list of attestable conditions, so those two could never be recorded and the guard could never be switched on. They are added to the
-- list; everything else in the function is exactly as it is live today (including the other guards' conditions).

CREATE OR REPLACE FUNCTION public.attest_go_live_condition(p_key text, p_code text, p_met boolean, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if private.go_live_actor_role() is null then raise exception 'only an admin or the Chief Medical Officer can record this' using errcode = '42501'; end if;
  if not exists (select 1 from public.go_live_guards where key = p_key) then raise exception 'no such go-live guard: %', p_key using errcode = '22023'; end if;
  -- the conditions a person records (the rest are read from the data). A fixed list, so a broken data query cannot block recording one.
  if (p_key, p_code) not in (
       ('clinical_operations_enabled', 'clinical_safety_case_current'), ('prescribing_enabled', 'clinical_safety_case_current'),
       ('scribe_enabled', 'clinical_safety_case_current'), ('prescribing_enabled', 'notification_sender_deployed'),
       ('lab_booking_enabled', 'results_flow_tested'),
       ('scribe_enabled', 'con001_legal_review_recorded'), ('scribe_enabled', 'speech_provider_configured'),
       ('payouts_enabled', 'fee_schedule_approved'), ('payouts_enabled', 'paystack_transfers_configured'),
       ('public_signup_enabled', 'stage2_exit_criteria_met'),
       ('research_export_enabled', 'counsel_cross_border_cleared'), ('research_export_enabled', 'dpo_registered'),
       ('symptom_checker_enabled', 'nafdac_position_recorded'), ('symptom_checker_enabled', 'engine_licence_or_validation_recorded'),
       ('symptom_checker_enabled', 'localisation_signoff_recorded'), ('symptom_checker_enabled', 'accuracy_baseline_recorded')) then
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
end $function$;

revoke execute on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;
