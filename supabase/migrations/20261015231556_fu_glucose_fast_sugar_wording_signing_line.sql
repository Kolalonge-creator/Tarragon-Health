-- Follow-up OQ-326 (CMO answer 2026-10-15): the fast-sugar treatment wording gets its OWN signing line on the CMO hub, separate from the glucose rules.
-- The wording (a sweet drink, sugar or honey; 15 g; recheck in 15 minutes) stays UNSIGNED. This migration only creates the place to sign it:
--   * a go-live guard `glucose_fast_sugar_wording` (born OFF) with one attestation the CMO records after reading the exact text: `fast_sugar_wording_signed`;
--   * the attestation is added to the list public.attest_go_live_condition accepts, and the guard's conditions to private.go_live_conditions,
--     both patched in place from their LIVE definitions with one asserted replace each (every entry other migrations added is kept).
-- The text itself is the proposed glucose wording codes GLU-E01 and GLU-T01 (packages/i18n glucose-wording.json); signing the rules (glucose_care_triage) does not sign
-- them and signing them does not sign the rules. Recording the attestation changes nothing a patient sees: the proposed text reaches patients only when
-- GLUCOSE_WORDING_SIGNED is set in the app build, a code change made after this is recorded.
-- Row count before: 0 guards with this key.

create function private.fast_sugar_go_live_conditions(p_key text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  return jsonb_build_array(
    private.go_live_cond('fast_sugar_wording_signed', 'The Chief Medical Officer has read and signed the fast-sugar treatment wording (a sweet drink, sugar or honey; 15 grams; recheck in 15 minutes), separately from the glucose rules',
      private.go_live_attested(p_key, 'fast_sugar_wording_signed'), 'attestation', null),
    private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
end $$;
revoke all on function private.fast_sugar_go_live_conditions(text) from public, anon, authenticated, service_role;

do $mig$
declare
  d text;
  anchor1 constant text := 'return private.go_live_conditions_s71(p_key, p_org);';
  new1 constant text := E'if p_key = ''glucose_fast_sugar_wording'' then\n    return private.fast_sugar_go_live_conditions(p_key);\n  end if;\n  return private.go_live_conditions_s71(p_key, p_org);';
  anchor2 constant text := $q$('maternal_enabled', 'regulator_queries_answered')) then$q$;
  new2 constant text := $q$('maternal_enabled', 'regulator_queries_answered'),
       ('glucose_fast_sugar_wording', 'fast_sugar_wording_signed')) then$q$;
begin
  d := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if d like '%fast_sugar_go_live_conditions%' then
    null;
  elsif (length(d) - length(replace(d, anchor1, ''))) / length(anchor1) <> 1 then
    raise exception 'OQ-326: private.go_live_conditions no longer ends with the expected fall-through; review before changing it';
  else
    execute replace(d, anchor1, new1);
  end if;

  d := pg_get_functiondef('public.attest_go_live_condition(text, text, boolean, text)'::regprocedure);
  if d like '%fast_sugar_wording_signed%' then
    null;
  elsif (length(d) - length(replace(d, anchor2, ''))) / length(anchor2) <> 1 then
    raise exception 'OQ-326: attest_go_live_condition no longer has the expected list tail; review before changing it';
  else
    execute replace(d, anchor2, new2);
  end if;
end $mig$;
revoke all on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('glucose_fast_sugar_wording', 'Fast-sugar treatment wording',
   'Showing the proposed fast-sugar treatment message (GLU-E01 and GLU-T01) to patients in place of the plain text shown today',
   'The Chief Medical Officer has read and signed the fast-sugar wording, separately from the glucose rules',
   'cmo', array['glucose_fast_sugar_wording_in_force'],
   'Recording the signature changes nothing a patient sees by itself: the app shows the proposed text only once the wording is marked signed in the build (packages/i18n glucose-wording.json). Signing the glucose rules does not sign this wording.')
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from public.go_live_guards where key = 'glucose_fast_sugar_wording' and not is_on) then
    raise exception 'OQ-326 self-check: the guard is missing or was born on';
  end if;
  if (private.go_live_conditions('glucose_fast_sugar_wording', null) -> 0 ->> 'code') is distinct from 'fast_sugar_wording_signed' then
    raise exception 'OQ-326 self-check: the guard does not list the wording condition first';
  end if;
  if has_function_privilege('anon', 'private.fast_sugar_go_live_conditions(text)', 'EXECUTE') or has_function_privilege('anon', 'public.attest_go_live_condition(text, text, boolean, text)', 'EXECUTE') then
    raise exception 'OQ-326 self-check: a function became callable by anon';
  end if;
end $$;
