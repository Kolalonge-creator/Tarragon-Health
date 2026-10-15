-- S85-D3: SMS has ONE named exception beyond verification codes and clinician paging: a content-free alert to the patient's own
-- consented emergency contact when the patient triggers an emergency. This migration adds only the go-live guard that keeps that
-- exception OFF until live delivery is proven (follow the S37 pattern; the guard is data, not a signature). Nothing here touches the
-- CMO-signed escalation_slas row (OQ-29, OQ-316 record the signed-config change that is still needed).
--
-- WHAT IT DOES
--   1. Inserts guard `sms_emergency_contact_enabled`, born off (the guards trigger refuses a row that is born on).
--   2. Patches private.go_live_conditions and public.attest_go_live_condition in place (one new branch / two new attestable codes marked S85-D3). Without this an unknown key is
--      never satisfiable, so the guard could never be switched on.
-- The send-pending-notifications edge function reads go_live_guards.is_on with the service role (select is still granted to it) and
-- treats an unreadable or missing row as OFF (fail closed). Ship order: the edge function change is code and goes first; a sender that
-- does not know the guard refuses every emergency-contact SMS anyway, so this migration cannot open anything.
-- COUNTS CHECKED live 2026-10-07 (read-only): go_live_guards has 7 rows, none named sms_emergency_contact_enabled.

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

-- The two go-live functions are patched IN PLACE (anchored replace on the live definition), not replaced: other migrations have layered their own
-- guards onto both since this file was written, and a copied body would delete them. Fails loudly if an anchor has moved.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def not like '%sms_emergency_contact_enabled%' then
    v_new := replace(v_def, E'  end if;\n  -- An unknown key has no conditions',
      E'  elsif p_key = ''sms_emergency_contact_enabled'' then\n' ||
      E'    -- S85-D3: both conditions are a person''''s judgement, recorded by an admin; neither can be read from the data.\n' ||
      E'    return jsonb_build_array(\n' ||
      E'      private.go_live_cond(''live_sms_delivery_proven'', ''Live SMS delivery is proven: sender ID approved, DND route active, a real message received on a real handset'', private.go_live_attested(p_key, ''live_sms_delivery_proven''), ''attestation'', null),\n' ||
      E'      private.go_live_cond(''founder_approval_d3_recorded'', ''The founder has approved the one named SMS exception (D3, exact text signed)'', private.go_live_attested(p_key, ''founder_approval_d3_recorded''), ''attestation'', null));\n' ||
      E'  end if;\n  -- An unknown key has no conditions');
    if v_new = v_def then raise exception 'S85-D3: go_live_conditions marker not found (definition drifted)'; end if;
    execute v_new;
  end if;

  v_def := pg_get_functiondef('public.attest_go_live_condition(text, text, boolean, text)'::regprocedure);
  if v_def not like '%sms_emergency_contact_enabled%' then
    v_new := replace(v_def, '(''public_signup_enabled'', ''stage2_exit_criteria_met'')',
      '(''sms_emergency_contact_enabled'', ''live_sms_delivery_proven''), (''sms_emergency_contact_enabled'', ''founder_approval_d3_recorded''),' || E'\n' ||
      '       (''public_signup_enabled'', ''stage2_exit_criteria_met'')');
    if v_new = v_def then raise exception 'S85-D3: attest_go_live_condition marker not found (definition drifted)'; end if;
    execute v_new;
  end if;
end $$;


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
