-- S56b step 2 of 2: the go-live guards (all born OFF) for the worklist, the summary share, the calm tool and the patterns view, the CMO
-- attestation path for each, and the one patient-facing question "which of these is open for me".
-- Design: docs/design/S56b.md. Pattern: S07y (a private conditions function patched into private.go_live_conditions, the attestable
-- conditions patched into public.attest_go_live_condition, wording bound to a fingerprint). Nothing is switched on, attested or signed here.
--
-- GUARDS (INV-14), each born off:
--   mental_health_worklist_enabled   the clinician follow-up worklist. Conditions: the worklist rules are signed (data), the CMO records that
--                                    clinician cover for the follow-up tasks exists (attestation), the CMO switch.
--   wellbeing_summary_share_enabled  the patient's "Share with my doctor" summary. Conditions: cover to read shared summaries (attestation), CMO switch.
--   panic_tool_enabled               the calm tool (breathing and 5-4-3-2-1 grounding, offline). Conditions: the CMO has read the exact wording
--                                    (attestation bound to a fingerprint of the panic.* strings), the flow has been tried with a screen reader
--                                    and reduced motion on a real phone (attestation), CMO switch. The crisis card is NEVER behind it.
--   mood_insights_enabled            the patient-private patterns view. Conditions: the CMO has read the sentence templates (attestation bound to
--                                    a fingerprint of the insights.* strings), CMO switch.
-- TEST ACCOUNT RULE (same as every patient guard): private.go_live_open_patient also passes for a test account, so the flows can be walked
-- end to end before the guard is on; a real person is only reachable once the guard is on AND (for the two wording guards) the attestation carries
-- the fingerprint of the current text.

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('mental_health_worklist_enabled', 'Mental health follow-up worklist',
   'The clinician worklist of tied patients who may need a follow-up, and the follow-up task made from it',
   'The worklist rules are signed by the Chief Medical Officer; clinician cover for the follow-up tasks is confirmed',
   'cmo', array['public.list_mental_health_worklist', 'public.count_mental_health_worklist', 'public.create_mental_health_worklist_follow_up'],
   'The crisis path (any self-harm answer), the older clinician alert, the audited read of a patient''s own record, the hand-off a patient sends and the crisis card are not behind it.'),
  ('wellbeing_summary_share_enabled', 'Share with my doctor (wellbeing summary)',
   'A patient building and sending a summary of their scores, check-ins and sleep diary to their care team',
   'Clinician cover to read shared summaries within a working day is confirmed',
   'cmo', array['public.preview_wellbeing_summary', 'public.share_wellbeing_summary_with_care_team'],
   'The older hand-off of a single screen, the crisis card and the crisis path are not behind it.'),
  ('panic_tool_enabled', 'Calm tool (acute anxiety)',
   'The one-tap calming exercise on the wellbeing screens: slow breathing and a 5-4-3-2-1 grounding sequence',
   'The Chief Medical Officer has read the exact wording; it has been tried with a screen reader and reduced motion on a real phone',
   'cmo', array['public.wellbeing_features_open'],
   'The crisis card is never behind this guard and is reachable from inside the exercise on every screen. The exercise needs no network once the screen is open.'),
  ('mood_insights_enabled', 'Patterns in your own check-ins',
   'The patient-private view that sets mood beside sleep, blood pressure, tags and day of week',
   'The Chief Medical Officer has read the sentence templates the patient would see',
   'cmo', array['public.wellbeing_features_open'],
   'It reads only the signed-in patient''s own entries, is never shown to anyone else and never feeds a score, a task or an alert.')
on conflict (key) do nothing;

-- Fingerprints of the exact patient wording. The database cannot see the strings, so it holds a fingerprint of each set (the first 12 characters
-- of the SHA-256 of "key=value" lines for every key with the prefix, sorted by key, each followed by a newline) and treats the wording as attested
-- only while the latest attestation's note carries it. A Jest test (packages/i18n/src/s56b-wording-pin.test.ts) fails if the strings and these
-- constants disagree, so editing a word means shipping a new fingerprint here, which closes the feature until the CMO attests the new text.
create or replace function private.s56b_panic_fingerprint() returns text
language sql immutable set search_path = '' as $$ select '08d630a12368'::text $$;
create or replace function private.s56b_insights_fingerprint() returns text
language sql immutable set search_path = '' as $$ select '9dcccb25574a'::text $$;
revoke all on function private.s56b_panic_fingerprint() from public, anon, authenticated;
revoke all on function private.s56b_insights_fingerprint() from public, anon, authenticated;

-- The attestation counts only while its note carries the CURRENT fingerprint (no test-account allowance: this is the condition the CMO sees).
create or replace function private.s56b_attested_with(p_key text, p_code text, p_fp text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.met and a.note like '%' || p_fp || '%' from public.go_live_attestations a
                    where a.guard_key = p_key and a.condition_code = p_code order by a.id desc limit 1), false)
$$;
revoke all on function private.s56b_attested_with(text, text, text) from public, anon, authenticated;

create or replace function private.s56b_wording_ok(p_key text, p_code text, p_fp text, p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p_patient and is_test) or private.s56b_attested_with(p_key, p_code, p_fp)
$$;
revoke all on function private.s56b_wording_ok(text, text, text, uuid) from public, anon, authenticated;

create or replace function private.s56b_go_live_conditions(p_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_key = 'mental_health_worklist_enabled' then
    return jsonb_build_array(
      private.go_live_cond('worklist_rules_signed', 'The follow-up worklist rules are signed by the Chief Medical Officer',
        exists (select 1 from public.mental_health_worklist_config where is_active and approved_at is not null), 'data',
        (select 'version ' || max(version) from public.mental_health_worklist_config where is_active and approved_at is not null)),
      private.go_live_cond('worklist_cover_confirmed', 'Clinician cover for the follow-up tasks it creates is confirmed',
        private.go_live_attested(p_key, 'worklist_cover_confirmed'), 'attestation', null),
      private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  elsif p_key = 'wellbeing_summary_share_enabled' then
    return jsonb_build_array(
      private.go_live_cond('share_cover_confirmed', 'A clinician reads a shared summary within a working day (cover confirmed)',
        private.go_live_attested(p_key, 'share_cover_confirmed'), 'attestation', null),
      private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  elsif p_key = 'panic_tool_enabled' then
    return jsonb_build_array(
      private.go_live_cond('panic_wording_signed', 'The Chief Medical Officer has read the exact wording of the calm tool',
        private.s56b_attested_with(p_key, 'panic_wording_signed', private.s56b_panic_fingerprint()), 'attestation', null),
      private.go_live_cond('panic_accessibility_checked', 'The calm tool has been tried with a screen reader and with reduced motion on a real phone',
        private.go_live_attested(p_key, 'panic_accessibility_checked'), 'attestation', null),
      private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  elsif p_key = 'mood_insights_enabled' then
    return jsonb_build_array(
      private.go_live_cond('insights_wording_signed', 'The Chief Medical Officer has read the sentences the patterns view would show',
        private.s56b_attested_with(p_key, 'insights_wording_signed', private.s56b_insights_fingerprint()), 'attestation', null),
      private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  end if;
  return '[]'::jsonb;
end $$;
revoke all on function private.s56b_go_live_conditions(text) from public, anon, authenticated, service_role;

-- Patch the branch into the CURRENT private.go_live_conditions (raises if the fall-through anchor is gone; never rewrites blindly).
do $$
declare
  v_def text;
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def like '%s56b_go_live_conditions%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the S56b branch by hand' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor,
    E'\n  elsif p_key in (''mental_health_worklist_enabled'', ''wellbeing_summary_share_enabled'', ''panic_tool_enabled'', ''mood_insights_enabled'') then\n    return private.s56b_go_live_conditions(p_key);\n  end if;\n  -- An unknown key has no conditions');
end $$;
revoke all on function private.go_live_conditions(text, uuid) from public;

-- The conditions a person records must be on the attestable list. Patched in place from the CURRENT definition: after the newest tuple this
-- list is known to end with (S07y), else after the long-standing S28c tuple. Either way the original text carries on after the insert.
do $patch$
declare
  v_def text := pg_get_functiondef('public.attest_go_live_condition(text,text,boolean,text)'::regprocedure);
  v_anchor text;
  v_new constant text := $n$, ('mental_health_worklist_enabled', 'worklist_cover_confirmed'), ('wellbeing_summary_share_enabled', 'share_cover_confirmed'), ('panic_tool_enabled', 'panic_wording_signed'), ('panic_tool_enabled', 'panic_accessibility_checked'), ('mood_insights_enabled', 'insights_wording_signed')$n$;
begin
  if position('panic_wording_signed' in v_def) > 0 then return; end if;
  if position($a$('cuff_visit_prompt', 'visit_prompt_wording_signed')$a$ in v_def) > 0 then
    v_anchor := $a$('cuff_visit_prompt', 'visit_prompt_wording_signed')$a$;
  elsif position($a$('public_signup_enabled', 'stage2_exit_criteria_met')$a$ in v_def) > 0 then
    v_anchor := $a$('public_signup_enabled', 'stage2_exit_criteria_met')$a$;
  else
    raise exception 'attest_go_live_condition: anchor not found, refusing to rewrite' using errcode = '55000';
  end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) <> length(v_anchor) then
    raise exception 'attest_go_live_condition: anchor is not unique, refusing to rewrite' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor, v_anchor || v_new);
end $patch$;
revoke all on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The patient-facing question: which of these is open for me? One round trip; the phone caches the answer so the calm tool still opens offline.
-- ---------------------------------------------------------------------------
alter table public.wellbeing_checkin_preferences add column if not exists mood_insights_hidden boolean not null default false;

create or replace function public.wellbeing_features_open() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_hidden boolean;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'patient') then
    return jsonb_build_object('panic', false, 'insights', false, 'share', false, 'insights_hidden', false);
  end if;
  select coalesce((select p.mood_insights_hidden from public.wellbeing_checkin_preferences p where p.patient_id = v_uid), false) into v_hidden;
  return jsonb_build_object(
    'panic', private.go_live_open_patient('panic_tool_enabled', v_uid)
             and private.s56b_wording_ok('panic_tool_enabled', 'panic_wording_signed', private.s56b_panic_fingerprint(), v_uid),
    'insights', private.go_live_open_patient('mood_insights_enabled', v_uid)
             and private.s56b_wording_ok('mood_insights_enabled', 'insights_wording_signed', private.s56b_insights_fingerprint(), v_uid),
    'share', private.go_live_open_patient('wellbeing_summary_share_enabled', v_uid),
    'insights_hidden', v_hidden);
end $$;
revoke all on function public.wellbeing_features_open() from public, anon;
grant execute on function public.wellbeing_features_open() to authenticated;

-- Hide (or show again) the patterns view. A patient preference only: nothing else reads it.
create or replace function public.set_mood_insights_hidden(p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid and role = 'patient';
  if v_org is null then raise exception 'not authorised' using errcode = '42501'; end if;
  insert into public.wellbeing_checkin_preferences (patient_id, organisation_id, mood_insights_hidden)
  values (v_uid, v_org, coalesce(p_hidden, false))
  on conflict (patient_id) do update set mood_insights_hidden = excluded.mood_insights_hidden, updated_at = now();
end $$;
revoke all on function public.set_mood_insights_hidden(boolean) from public, anon;
grant execute on function public.set_mood_insights_hidden(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.go_live_guards where key in ('mental_health_worklist_enabled', 'wellbeing_summary_share_enabled', 'panic_tool_enabled', 'mood_insights_enabled') and not is_on) <> 4 then
    raise exception 'S56b self-check: the four guards must exist and be off';
  end if;
  if jsonb_array_length(private.go_live_conditions('mental_health_worklist_enabled', null)) <> 3
     or jsonb_array_length(private.go_live_conditions('wellbeing_summary_share_enabled', null)) <> 2
     or jsonb_array_length(private.go_live_conditions('panic_tool_enabled', null)) <> 3
     or jsonb_array_length(private.go_live_conditions('mood_insights_enabled', null)) <> 2 then
    raise exception 'S56b self-check: a guard has the wrong number of conditions';
  end if;
  if jsonb_array_length(private.go_live_conditions('mental_health_follow_up_enabled', null)) <> 2 then raise exception 'S56b self-check: another guard''s conditions were disturbed'; end if;
  if has_function_privilege('anon', 'public.wellbeing_features_open()', 'EXECUTE') or has_function_privilege('anon', 'public.set_mood_insights_hidden(boolean)', 'EXECUTE') then
    raise exception 'S56b self-check: anon can execute a new function';
  end if;
  if has_function_privilege('authenticated', 'private.s56b_wording_ok(text,text,text,uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'private.s56b_go_live_conditions(text)', 'EXECUTE') then
    raise exception 'S56b self-check: a signed-in user can call a private function directly';
  end if;
  if exists (select 1 from public.go_live_attestations where guard_key in ('mental_health_worklist_enabled', 'wellbeing_summary_share_enabled', 'panic_tool_enabled', 'mood_insights_enabled')) then
    raise exception 'S56b self-check: an attestation exists that the build did not make';
  end if;
end $$;
