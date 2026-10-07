-- S85-D3: SMS has ONE named exception beyond verification codes and clinician paging: a content-free alert to the patient's own
-- consented emergency contact when the patient triggers an emergency. This migration adds only the go-live guard that keeps that
-- exception OFF until live delivery is proven (follow the S37 pattern; the guard is data, not a signature). Nothing here touches the
-- CMO-signed escalation_slas row (OQ-29, OQ-316 record the signed-config change that is still needed).
--
-- WHAT IT DOES
--   1. Inserts guard `sms_emergency_contact_enabled`, born off (the guards trigger refuses a row that is born on).
--   2. Replaces private.go_live_conditions and public.attest_go_live_condition (bodies read with pg_get_functiondef on the live project
--      2026-10-07 and repeated unchanged, plus one new branch / two new attestable codes marked S85-D3). Without this an unknown key is
--      never satisfiable, so the guard could never be switched on.
-- The send-pending-notifications edge function reads go_live_guards.is_on with the service role (select is still granted to it) and
-- treats an unreadable or missing row as OFF (fail closed). Ship order: the edge function change is code and goes first; a sender that
-- does not know the guard refuses every emergency-contact SMS anyway, so this migration cannot open anything.
-- COUNTS CHECKED live 2026-10-07 (read-only): go_live_guards has 7 rows, none named sms_emergency_contact_enabled.

-- Refuse to replace the two functions below if the live bodies are not the ones this file was written against (an older or newer
-- branch changed them): replacing blind would silently revert that work. Re-read both with pg_get_functiondef and rebase this file.
do $$
declare v_c text := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
        v_a text := pg_get_functiondef('public.attest_go_live_condition(text, text, boolean, text)'::regprocedure);
begin
  if position('notification_sender_deployed' in v_c) = 0 or position('clinical_safety_case_current' in v_c) = 0
     or position('notification_sender_deployed' in v_a) = 0 or position('clinical_safety_case_current' in v_a) = 0 then
    raise exception 'S85-D3: the live go-live functions are not the bodies this migration repeats; re-read them and rebase this file';
  end if;
  if position('sms_emergency_contact_enabled' in v_c) > 0 then
    raise exception 'S85-D3: go_live_conditions already knows the guard; nothing to add';
  end if;
end $$;

-- A second run of the sender (cron plus the escalation kick can overlap) must not queue the contact copies twice. The sender inserts
-- one row per channel and treats 23505 as "already queued".
create unique index if not exists notifications_emergency_contact_copy_once
  on public.notifications ((payload ->> 'source_notification_id'), channel, template)
  where template = 'emergency_contact_alert' and payload ? 'source_notification_id';

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('sms_emergency_contact_enabled', 'Emergency-contact SMS', 'The one SMS to a patient''s consented emergency contact (push and email still go out when the contact is reachable)',
   'Live SMS delivery proven (sender ID, DND route, real handset); founder approval of D3 recorded', 'admin',
   array['send-pending-notifications (emergency_contact_alert rows on the sms channel)'],
   'Verification codes (Supabase phone auth) and clinician paging are separate and never read this guard. Push and email to a reachable contact never wait for it.')
on conflict (key) do nothing;

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
    -- S28c: sending a prescription to a pharmacy also needs a pharmacy people can actually choose today (active, approved, licence verified and
    -- unexpired, with a verified location), the collection rules confirmed by their owner, and the notification sender deployed.
    return jsonb_build_array(
      private.go_live_cond('pharmacy_partner_active', 'At least one active pharmacy partner', v_n > 0, 'data', v_n || ' active'),
      private.go_live_cond('pharmacy_licence_current', 'At least one approved pharmacy with a current, verified licence and a verified location',
        exists (select 1 from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id where private.pharmacy_location_choosable(pp.id, l.id)), 'data',
        (select count(distinct pp.id) from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id where private.pharmacy_location_choosable(pp.id, l.id)) || ' can be chosen'),
      private.go_live_cond('pharmacy_rules_confirmed', 'The pharmacy collection rules are confirmed',
        coalesce((select s.decision = 'confirmed' from public.proposed_config_signoffs s
                   where s.config_key = 'pharmacy.collection_rules'
                     and s.config_version = (select c.version from public.pharmacy_config c where c.is_active)
                   order by s.id desc limit 1), false), 'data', null),
      private.go_live_cond('notification_sender_deployed', 'The notification sender with the pharmacy messages is deployed',
        private.go_live_attested(p_key, 'notification_sender_deployed'), 'attestation', null),
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
  elsif p_key = 'sms_emergency_contact_enabled' then
    -- S85-D3: both conditions are a person's judgement, recorded by an admin; neither can be read from the data.
    return jsonb_build_array(
      private.go_live_cond('live_sms_delivery_proven', 'Live SMS delivery is proven: sender ID approved, DND route active, a real message received on a real handset', private.go_live_attested(p_key, 'live_sms_delivery_proven'), 'attestation', null),
      private.go_live_cond('founder_approval_d3_recorded', 'The founder has approved the one named SMS exception (D3, exact text signed)', private.go_live_attested(p_key, 'founder_approval_d3_recorded'), 'attestation', null));
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
       ('scribe_enabled', 'clinical_safety_case_current'), ('prescribing_enabled', 'notification_sender_deployed'),
       ('lab_booking_enabled', 'results_flow_tested'),
       ('scribe_enabled', 'con001_legal_review_recorded'), ('scribe_enabled', 'speech_provider_configured'),
       ('payouts_enabled', 'fee_schedule_approved'), ('payouts_enabled', 'paystack_transfers_configured'),
       ('public_signup_enabled', 'stage2_exit_criteria_met'),
       ('sms_emergency_contact_enabled', 'live_sms_delivery_proven'), ('sms_emergency_contact_enabled', 'founder_approval_d3_recorded')) then
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

-- The server action asks one question: is the emergency-contact SMS exception open right now, by the same test the sender uses
-- (is_on, with no test-account exemption). Service role only; a patient's browser session never calls it.
create or replace function public.sms_emergency_contact_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.go_live_guard_on('sms_emergency_contact_enabled')
$$;
revoke all on function public.sms_emergency_contact_open() from public, anon, authenticated;
grant execute on function public.sms_emergency_contact_open() to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.sms_emergency_contact_open()', 'EXECUTE')
     or has_function_privilege('anon', 'public.sms_emergency_contact_open()', 'EXECUTE') then
    raise exception 'S85-D3 assertion: only the service role may ask whether the exception is open';
  end if;
  if exists (select 1 from public.go_live_guards where key = 'sms_emergency_contact_enabled' and is_on) then
    raise exception 'S85-D3 assertion: the guard must be born off';
  end if;
  if private.go_live_guard_on('sms_emergency_contact_enabled') then
    raise exception 'S85-D3 assertion: the reader must say closed';
  end if;
  if not has_table_privilege('service_role', 'public.go_live_guards', 'SELECT') then
    raise exception 'S85-D3 assertion: the sender (service role) must be able to read the guard row';
  end if;
  if has_function_privilege('anon', 'public.attest_go_live_condition(text,text,boolean,text)', 'EXECUTE') then
    raise exception 'S85-D3 assertion: anon must not execute attest_go_live_condition';
  end if;
end $$;
