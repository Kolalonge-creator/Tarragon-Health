-- S77 (spec 23.7, CMO decision S-10): live red-flag prompts, the engine only, OFF.
--
-- WHAT THIS ADDS
--   * A new go-live guard, live_redflag_prompts_enabled, born off and switchable only by the Chief Medical Officer once every condition is
--     met. The conditions are people's judgements (speech validated on Nigerian English, consent tables settled, the phrase list signed, the clinical
--     safety case), so all four are attestations and none is seeded. Nothing here turns the engine on.
--   * public.live_prompts: one row each time a prompt is SHOWN to the consulting clinician, and when it is dismissed. It stores only the matched
--     phrase from the signed list, the rule id and version, who dismissed it and when. NEVER transcript text: the matcher runs in the clinician's
--     browser and only a list phrase is sent here.
--   * public.record_live_prompt() and public.dismiss_live_prompt(). Recording needs (a) the guard on (a test pair, patient and clinician both test
--     accounts, passes like the other guards), (b) a granted consent that public.scribe_may_start() accepts for that encounter, (c) the caller to
--     be that encounter's clinician. Dismissing needs only (c), so a prompt can always be put away, even after the guard is switched off.
--   * Prompts are visible to the consulting clinician only: no patient, no other clinician, no admin policy (INV-01: deterministic rules only,
--     no model; the rules are the SAME signed danger-phrase list the written-question screen uses, validated here by
--     private.screen_care_message_for_emergency so the server never accepts a phrase that is not on it).
--   * There is no speech-to-text. The prompt is fed typed or pasted transcript segments only (S-10).
--
-- This migration PATCHES private.go_live_conditions and public.attest_go_live_condition in place (anchored replace on the live definition,
-- failing loudly if an anchor is missing), so it applies on top of whatever other migrations have layered onto them.
-- Counts before writing: no live_prompts table exists; the guard did not exist; encounters and scribe consents had 0 rows live on 2026-10-06 per S37.

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('live_redflag_prompts_enabled', 'Live red-flag prompts', 'Showing a red-flag prompt to the consulting clinician',
   'Speech validated on Nigerian English; consultation consent tables settled; red-flag phrase list signed; clinical safety case', 'cmo',
   array['record_live_prompt (every prompt shown)'],
   'Dismissing a prompt is never behind the guard. There is no speech-to-text: prompts run on typed or pasted transcript segments only, and the consultation room does not host the component yet (OQ-210).');


-- ---------------------------------------------------------------------------
-- 1. The go-live conditions and the attestation list, patched IN PLACE
-- ---------------------------------------------------------------------------
-- Both functions are patched by anchored replace() on the live definition, never replaced wholesale: other migrations (and production)
-- have layered their own guards onto them since S28c, and a copied body would silently delete those.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def not like '%live_redflag_prompts_enabled%' then
    v_new := replace(v_def, E'  end if;\n  -- An unknown key has no conditions',
      E'  elsif p_key = \'live_redflag_prompts_enabled\' then\n' ||
      E'    -- S77 (S-10, spec 23.7): the red-flag prompts stay off until speech is validated on Nigerian English, the consent tables are settled (OQ-96, OQ-161),\n' ||
      E'    -- the phrase list the prompts read is signed, and the safety case covers them. All four are people\'s judgements, so none is seeded.\n' ||
      E'    return jsonb_build_array(\n' ||
      E'      private.go_live_cond(\'speech_validated_nigerian_english\', \'Speech-to-text is validated on Nigerian English\', private.go_live_attested(p_key, \'speech_validated_nigerian_english\'), \'attestation\', null),\n' ||
      E'      private.go_live_cond(\'consent_tables_settled\', \'The consultation consent tables are settled\', private.go_live_attested(p_key, \'consent_tables_settled\'), \'attestation\', null),\n' ||
      E'      private.go_live_cond(\'redflag_phrase_list_signed\', \'The red-flag phrase list is signed by the Chief Medical Officer\', private.go_live_attested(p_key, \'redflag_phrase_list_signed\'), \'attestation\', null),\n' ||
      E'      private.go_live_cond(\'clinical_safety_case_current\', \'A current clinical safety case and hazard log, signed off\', private.go_live_attested(p_key, \'clinical_safety_case_current\'), \'attestation\', null));\n' ||
      E'  end if;\n  -- An unknown key has no conditions');
    if v_new = v_def then raise exception 'S77: go_live_conditions marker not found (definition drifted)'; end if;
    execute v_new;
  end if;

  v_def := pg_get_functiondef('public.attest_go_live_condition(text, text, boolean, text)'::regprocedure);
  if v_def not like '%live_redflag_prompts_enabled%' then
    -- anchor on a tuple that stays put wherever other migrations extend the list, and add ours straight after it
    v_new := replace(v_def, '(''public_signup_enabled'', ''stage2_exit_criteria_met'')',
      '(''public_signup_enabled'', ''stage2_exit_criteria_met''),' || E'\n' ||
      '       (''live_redflag_prompts_enabled'', ''speech_validated_nigerian_english''), (''live_redflag_prompts_enabled'', ''consent_tables_settled''),' || E'\n' ||
      '       (''live_redflag_prompts_enabled'', ''redflag_phrase_list_signed''), (''live_redflag_prompts_enabled'', ''clinical_safety_case_current'')');
    if v_new = v_def then raise exception 'S77: attest_go_live_condition marker not found (definition drifted)'; end if;
    execute v_new;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. live_prompts
-- ---------------------------------------------------------------------------
create table public.live_prompts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  encounter_id    uuid not null references public.encounters (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete restrict,
  clinician_id    uuid not null references public.profiles (id) on delete restrict,
  -- A phrase from the signed danger-phrase list, never a sentence of the consultation.
  phrase_matched  text not null check (char_length(phrase_matched) between 3 and 60),
  rule_id         text not null check (rule_id = 'written_question_danger_phrases'),
  rule_version    integer not null check (rule_version >= 1),
  shown_at        timestamptz not null default now(),
  dismissed_at    timestamptz,
  dismissed_by    uuid references public.profiles (id) on delete restrict,
  is_test         boolean not null default false,
  check ((dismissed_at is null) = (dismissed_by is null))
);
-- one undismissed prompt per phrase per consultation (the same phrase said twice does not stack banners)
create unique index live_prompts_one_live_per_phrase on public.live_prompts (encounter_id, phrase_matched) where dismissed_at is null;
create index live_prompts_encounter_idx on public.live_prompts (encounter_id, shown_at);
comment on table public.live_prompts is
  'S77 (23.7, S-10): every red-flag prompt shown to a consulting clinician and its dismissal. Stores the matched list phrase, the rule id and version; no transcript text. Read by that clinician only. Written only by record_live_prompt and dismiss_live_prompt.';

create function private.guard_live_prompt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a live prompt record is never deleted' using errcode = '42501';
  end if;
  if coalesce(current_setting('tarragon.live_prompt_write', true), '') <> 'on' then
    raise exception 'live_prompts change only through record_live_prompt and dismiss_live_prompt' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.dismissed_at is not null
       or (new.id, new.organisation_id, new.encounter_id, new.patient_id, new.clinician_id, new.phrase_matched, new.rule_id, new.rule_version, new.shown_at, new.is_test)
          is distinct from (old.id, old.organisation_id, old.encounter_id, old.patient_id, old.clinician_id, old.phrase_matched, old.rule_id, old.rule_version, old.shown_at, old.is_test) then
      raise exception 'a live prompt changes once: it is dismissed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_live_prompt() from public, anon, authenticated;
create trigger live_prompts_guard before insert or update or delete on public.live_prompts
  for each row execute function private.guard_live_prompt();
create trigger live_prompts_no_truncate before truncate on public.live_prompts
  for each statement execute function private.go_live_append_only();

alter table public.live_prompts enable row level security;
revoke all on public.live_prompts from public, anon, authenticated;
grant select on public.live_prompts to authenticated;
-- the consulting clinician only: not the patient, not another clinician, not an admin
create policy live_prompts_read on public.live_prompts for select to authenticated
  using (clinician_id = (select auth.uid()) and private.is_org_staff(organisation_id));

-- ---------------------------------------------------------------------------
-- 3. The two functions
-- ---------------------------------------------------------------------------
create function public.record_live_prompt(
  p_encounter uuid, p_phrase text, p_rule_id text default 'written_question_danger_phrases', p_rule_version integer default 1)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters%rowtype;
  v_phrase text := lower(btrim(coalesce(p_phrase, '')));
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  -- (c) the caller is this encounter's clinician; any other caller gets the same answer as for an encounter that does not exist
  select * into e from public.encounters where id = p_encounter;
  if not found or e.clinician_id is distinct from v_uid then
    raise exception 'consultation not found' using errcode = '42501';
  end if;
  -- (a) the guard (INV-14): off means off, for a real patient
  if not private.go_live_open('live_redflag_prompts_enabled', e.patient_id, e.clinician_id) then
    raise exception 'live red-flag prompts are not open yet' using errcode = 'P0001', hint = 'go_live_guard:live_redflag_prompts_enabled';
  end if;
  -- (b) the patient's own granted consent for this consultation, valid right now (also needs the consultation in progress)
  if not public.scribe_may_start(p_encounter) then
    raise exception 'no consent from the patient for this consultation' using errcode = '42501', hint = 'consent_required';
  end if;
  if p_rule_id is distinct from 'written_question_danger_phrases' or p_rule_version is null or p_rule_version < 1 then
    raise exception 'unknown red-flag rule' using errcode = '22023';
  end if;
  -- INV-01: only a phrase on the signed danger-phrase list is accepted; nothing the clinician or patient said is stored
  if v_phrase = '' or not (v_phrase = any (coalesce(private.screen_care_message_for_emergency(v_phrase), '{}'::text[]))) then
    raise exception 'that phrase is not on the red-flag list' using errcode = '22023';
  end if;
  perform set_config('tarragon.live_prompt_write', 'on', true);
  insert into public.live_prompts (organisation_id, encounter_id, patient_id, clinician_id, phrase_matched, rule_id, rule_version, is_test)
  values (e.organisation_id, e.id, e.patient_id, e.clinician_id, v_phrase, p_rule_id, p_rule_version, e.is_test)
  on conflict (encounter_id, phrase_matched) where dismissed_at is null do nothing
  returning id into v_id;
  perform set_config('tarragon.live_prompt_write', 'off', true);
  if v_id is null then
    -- already showing: return that prompt, log nothing twice
    select id into v_id from public.live_prompts where encounter_id = e.id and phrase_matched = v_phrase and dismissed_at is null;
    return v_id;
  end if;
  perform private.log_audit('live_prompt.shown', 'live_prompt', v_id, jsonb_build_object('encounter_id', e.id, 'rule_version', p_rule_version));
  return v_id;
end $$;

create function public.dismiss_live_prompt(p_prompt uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  lp public.live_prompts%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into lp from public.live_prompts where id = p_prompt for update;
  if not found or lp.clinician_id is distinct from v_uid then
    raise exception 'prompt not found' using errcode = '42501';
  end if;
  if lp.dismissed_at is not null then return; end if;
  perform set_config('tarragon.live_prompt_write', 'on', true);
  update public.live_prompts set dismissed_at = now(), dismissed_by = v_uid where id = p_prompt;
  perform set_config('tarragon.live_prompt_write', 'off', true);
  perform private.log_audit('live_prompt.dismissed', 'live_prompt', p_prompt, jsonb_build_object('encounter_id', lp.encounter_id));
end $$;

revoke all on function public.record_live_prompt(uuid, text, text, integer) from public, anon;
revoke all on function public.dismiss_live_prompt(uuid) from public, anon;
grant execute on function public.record_live_prompt(uuid, text, text, integer) to authenticated;
grant execute on function public.dismiss_live_prompt(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.go_live_guards where key = 'live_redflag_prompts_enabled' and not is_on) then
    raise exception 'S77: the live red-flag guard is missing or on';
  end if;
  if private.go_live_guard_on('live_redflag_prompts_enabled') then raise exception 'S77: the guard reads as on'; end if;
  if has_table_privilege('authenticated', 'public.live_prompts', 'INSERT') or has_table_privilege('authenticated', 'public.live_prompts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.live_prompts', 'DELETE') or has_table_privilege('anon', 'public.live_prompts', 'SELECT') then
    raise exception 'S77: live_prompts has the wrong table privileges';
  end if;
  if has_function_privilege('anon', 'public.record_live_prompt(uuid,text,text,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.dismiss_live_prompt(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.record_live_prompt(uuid,text,text,integer)', 'EXECUTE') then
    raise exception 'S77: wrong execute privileges on the live prompt functions';
  end if;
  if exists (select 1 from public.go_live_attestations where guard_key = 'live_redflag_prompts_enabled') then
    raise exception 'S77: an attestation for the live red-flag guard was seeded';
  end if;
  if not (private.go_live_conditions('live_redflag_prompts_enabled', null) @> '[{"code": "speech_validated_nigerian_english", "met": false}]'::jsonb) then
    raise exception 'S77: the live red-flag guard conditions are missing or already met';
  end if;
end $$;
