-- S59c: assessment experience on top of the S59/S60 symptom checker (design: docs/design/S59c.md). Invariants: INV-01, 05, 06, 07, 10, 12, 14, 16.
--
-- WHAT THIS ADDS
--   * public.symptom_ux_config: ONE versioned, CMO-signed config table for four kinds: `checkback` (the follow-up timing), `describe` (the
--     describe-it synonym table), `explainer` (the "Why this result" reasons) and `safety_net` (the per-pathway "go to hospital if" lines).
--     Every kind is born as an UNSIGNED, INACTIVE version 1 (the shipped drafts); only the CMO's sign_symptom_ux_config() activates a version.
--     The stored JSON is immutable and always the draft form: what a reader gets from symptom_ux_active_config() has its signature added from the
--     row's own columns, so it can never be edited into looking signed. Mirrored in packages/shared (symptom.checkback, symptom.describe_synonyms,
--     symptom.result_explainer, symptom.safety_net) and bundled in the apps; drift tests fail if any copy differs.
--   * public.symptom_checkbacks: one follow-up per completed assessment that ended as self-care or a routine appointment ("better, same or
--     worse?" plus "did you get care?"), opened 24 to 48 hours later (config), one reminder at most, expiring. Patient reads own rows; there is NO
--     staff table policy, a clinician reads through read_symptom_checkback_audited() (tied, audited). The outcome columns (progress, care_received,
--     new_signs, action, answered_at, hours_since_check) are what the accuracy audit will read; nothing here reads them back.
--   * scheduling trigger on symptom_triage_assessments (exception-safe: a failure is audited and opens an incident, never fails the assessment),
--     a pg_cron sweep every 15 minutes (backfill, cancel, expire, open, nudge; loud on failure), the patient answer function with the decision table
--     (see below), neutral notification templates, two event types (ids only), data registry and minor-guard registration.
--
-- THE DECISION TABLE (answer_symptom_checkback; the TypeScript twin is decideCheckback in the engine package, pinned by tests on both sides)
--   floor category 'emergency' (the red-flag floor re-run on the original answers plus anything newly ticked)       -> emergency
--   any newly ticked warning sign, or floor 'urgent', or progress 'worse'                                         -> escalate
--   progress 'same' and hours since the check >= the category's same_nudge_after_hours                            -> book
--   progress 'same' earlier: keep_watching, and ONE more check (round 2) is scheduled at the nudge time; round 2 never schedules another
--   progress 'better' with nothing newly ticked                                                                   -> close
--   emergency raises an emergency_events row (source symptom_triage, the existing path: alert, hospital guidance, emergency contact) and, if that path
--   raised no alert, one emergency-level alert. escalate raises ONE urgent_escalation alert carrying the original summary when the person's plan
--   includes doctor time (the same private.patient_may_page_doctor gate every symptom path uses; Free gets the guidance on screen and no alert).
--   The floor category is supplied by the app (the engine is TypeScript) and can only RAISE the action: a smaller or missing value never lowers
--   the signals the database sees for itself (progress, newly ticked signs).
--
-- INV-14: nothing here opens the checker. Scheduling, opening and answering all require symptom_checker_enabled to be open for that patient
-- (private.go_live_open_patient: on, or a test account) AND a signed `checkback` config. The describe, explainer and safety-net configs are read
-- only by screens that are themselves unreachable while the guard is off. No go-live guard is flipped and no config is signed by this migration.
-- Counts before writing: no symptom check-back, describe or explainer table existed. Nothing live was read in this session (the project is not
-- touched by the author); the repository's replayed migrations were read instead.

-- ---------------------------------------------------------------------------
-- 1. The config table
-- ---------------------------------------------------------------------------
create table public.symptom_ux_config (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('checkback', 'describe', 'explainer', 'safety_net')),
  version        integer not null check (version >= 1),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (kind, version),
  constraint symptom_ux_config_active_is_signed check (not is_active or (approved_at is not null and approved_by is not null))
);
create unique index symptom_ux_config_one_active on public.symptom_ux_config (kind) where is_active;
create index symptom_ux_config_approved_by_idx on public.symptom_ux_config (approved_by) where approved_by is not null;
comment on table public.symptom_ux_config is
  'S59c: versioned PROPOSED config for the assessment experience (checkback, describe, explainer, safety_net). Born unsigned and inactive; only sign_symptom_ux_config (CMO) activates a version. rules is immutable and always the draft form.';

-- Shape checks. The database consumes `checkback` itself (so it is checked in full); the other three are served to the screens and are checked
-- for the shape the TypeScript schemas also require.
create function private.symptom_ux_rules_valid(p_kind text, p_version integer, r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  e jsonb; c text;
begin
  if jsonb_typeof(r) <> 'object' then return false; end if;
  if not coalesce((r ->> 'version') ~ '^[0-9]{1,6}$', false) or (r ->> 'version')::integer <> p_version then return false; end if;
  if coalesce(r ->> 'status', '') not in ('draft', 'signed_off') then return false; end if;
  if jsonb_typeof(r -> 'provenance') <> 'object' or nullif(btrim(coalesce(r #>> '{provenance,source}', '')), '') is null
     or nullif(btrim(coalesce(r #>> '{provenance,note}', '')), '') is null then return false; end if;

  if p_kind = 'checkback' then
    foreach c in array array['self_management', 'routine'] loop
      if not coalesce((r #>> array['categories', c, 'delay_hours']) ~ '^[0-9]{1,3}$', false) then return false; end if;
      if not coalesce((r #>> array['categories', c, 'same_nudge_after_hours']) ~ '^[0-9]{1,3}$', false) then return false; end if;
      if (r #>> array['categories', c, 'delay_hours'])::integer not between 1 and 168 then return false; end if;
      if (r #>> array['categories', c, 'same_nudge_after_hours'])::integer not between 1 and 336 then return false; end if;
    end loop;
    if (select count(*) from jsonb_object_keys(r -> 'categories')) <> 2 then return false; end if;
    if not coalesce((r ->> 'expire_after_hours') ~ '^[0-9]{1,3}$', false) or (r ->> 'expire_after_hours')::integer not between 1 and 336 then return false; end if;
    if not coalesce((r ->> 'nudge_after_hours') ~ '^[0-9]{1,3}$', false) or (r ->> 'nudge_after_hours')::integer not between 1 and 168 then return false; end if;
    if not coalesce((r ->> 'max_nudges') ~ '^[0-1]$', false) then return false; end if;
    if not coalesce((r #>> '{notification_window,start_hour}') ~ '^[0-9]{1,2}$' and (r #>> '{notification_window,end_hour}') ~ '^[0-9]{1,2}$', false) then return false; end if;
    if (r #>> '{notification_window,start_hour}')::integer >= (r #>> '{notification_window,end_hour}')::integer
       or (r #>> '{notification_window,end_hour}')::integer > 24 then return false; end if;
    return true;
  end if;

  if jsonb_typeof(r -> 'entries') <> 'array' or jsonb_array_length(r -> 'entries') < 1 or jsonb_array_length(r -> 'entries') > 300 then return false; end if;
  if (select count(distinct x ->> 'id') from jsonb_array_elements(r -> 'entries') x) <> jsonb_array_length(r -> 'entries') then return false; end if;
  if p_kind = 'describe' then
    if not coalesce((r ->> 'min_score') ~ '^[0-9]{1,2}$' and (r ->> 'ambiguity_margin') ~ '^[0-9]{1,2}$', false) then return false; end if;
    if (r ->> 'min_score')::integer not between 1 and 10 or (r ->> 'ambiguity_margin')::integer not between 1 and 10 then return false; end if;
    -- the least time between two danger-wording events for one person (a PROPOSED value; the database reads it, so it is checked in full)
    if not coalesce((r ->> 'danger_event_min_gap_minutes') ~ '^[0-9]{1,4}$', false) or (r ->> 'danger_event_min_gap_minutes')::integer not between 1 and 1440 then return false; end if;
    for e in select x from jsonb_array_elements(r -> 'entries') x loop
      if not coalesce((e ->> 'id') ~ '^[a-z][a-z0-9_]*$' and (e ->> 'pathway_key') ~ '^[a-z][a-z0-9_]*$' and (e ->> 'weight') ~ '^[1-3]$', false) then return false; end if;
      if jsonb_typeof(e -> 'phrases') <> 'array' or jsonb_array_length(e -> 'phrases') < 1 then return false; end if;
    end loop;
  elsif p_kind = 'explainer' then
    for e in select x from jsonb_array_elements(r -> 'entries') x loop
      if not coalesce((e ->> 'id') ~ '^(rule|outcome|tightening):[a-z0-9_.]+$', false) then return false; end if;
      if char_length(coalesce(e ->> 'reason', '')) not between 10 and 400 then return false; end if;
    end loop;
  elsif p_kind = 'safety_net' then
    if jsonb_typeof(r -> 'emergency_number') <> 'null' and not (
         jsonb_typeof(r -> 'emergency_number') = 'object' and coalesce((r #>> '{emergency_number,value}') ~ '^[0-9]{3,5}$', false)
         and jsonb_typeof(r #> '{emergency_number,confirmed}') = 'boolean') then return false; end if;
    for e in select x from jsonb_array_elements(r -> 'entries') x loop
      if not coalesce((e ->> 'id') ~ '^[a-z][a-z0-9_]*$' and (e ->> 'pathway_key') ~ '^([a-z][a-z0-9_]*|\*)$'
                      and (e ->> 'category') in ('emergency', 'urgent', 'routine', 'self_management', '*'), false) then return false; end if;
      if jsonb_typeof(e -> 'triggers') <> 'array' or jsonb_array_length(e -> 'triggers') not between 1 and 8 then return false; end if;
    end loop;
  end if;
  return true;
end $$;
revoke all on function private.symptom_ux_rules_valid(text, integer, jsonb) from public, anon, authenticated;
alter table public.symptom_ux_config add constraint symptom_ux_config_rules_valid check (private.symptom_ux_rules_valid(kind, version, rules));

-- ux-seed-checkback-begin
insert into public.symptom_ux_config (kind, version, effective_from, rules) values ('checkback', 1, '2026-10-22', $json$
{
  "version": 1,
  "status": "draft",
  "clinical_sign_off": null,
  "provenance": {
    "source": "docs/design/S59c.md section 2",
    "note": "Agent-proposed timing for the CMO. Delays and the nudge rule are product choices, not clinical thresholds. Not reviewed by a clinician."
  },
  "categories": {
    "self_management": {
      "delay_hours": 48,
      "same_nudge_after_hours": 72
    },
    "routine": {
      "delay_hours": 24,
      "same_nudge_after_hours": 24
    }
  },
  "expire_after_hours": 48,
  "nudge_after_hours": 12,
  "max_nudges": 1,
  "notification_window": {
    "start_hour": 7,
    "end_hour": 21
  }
}
$json$::jsonb);
-- ux-seed-checkback-end

-- ux-seed-describe-begin
insert into public.symptom_ux_config (kind, version, effective_from, rules) values ('describe', 1, '2026-10-22', $json$
{
  "version": 1,
  "status": "draft",
  "clinical_sign_off": null,
  "provenance": {
    "source": "docs/design/S59c.md section 3",
    "note": "Agent-proposed routing words. A wrong route only changes which questions are asked: the red-flag floor runs over every answer either way. Not reviewed by a clinician or a Nigerian-English speaker."
  },
  "min_score": 2,
  "ambiguity_margin": 2,
  "danger_event_min_gap_minutes": 30,
  "entries": [
    {
      "id": "headache_clear",
      "pathway_key": "headache",
      "weight": 2,
      "phrases": [
        "headache*",
        "head ache",
        "head pain",
        "migraine*",
        "pain in my head",
        "pain in the head",
        "my head hurts",
        "head hurts",
        "head is hurting",
        "head is paining",
        "my head is paining me",
        "head is pounding",
        "pounding head",
        "throbbing head"
      ]
    },
    {
      "id": "headache_hint",
      "pathway_key": "headache",
      "weight": 1,
      "phrases": [
        "head feels heavy",
        "heavy head",
        "sore head"
      ]
    },
    {
      "id": "chest_pain_clear",
      "pathway_key": "chest_pain",
      "weight": 2,
      "phrases": [
        "chest pain*",
        "chest ache",
        "pain in my chest",
        "pain in the chest",
        "chest hurts",
        "chest is hurting",
        "chest is paining",
        "my chest is paining me",
        "chest paining",
        "heart pain",
        "pain around my heart"
      ]
    },
    {
      "id": "chest_pain_hint",
      "pathway_key": "chest_pain",
      "weight": 1,
      "phrases": [
        "chest feels heavy",
        "heavy chest",
        "sore chest",
        "chest discomfort"
      ]
    },
    {
      "id": "breathlessness_clear",
      "pathway_key": "breathlessness",
      "weight": 2,
      "phrases": [
        "breathless*",
        "short of breath",
        "shortness of breath",
        "difficulty breathing",
        "difficulty in breathing",
        "trouble breathing",
        "hard to breathe",
        "cannot catch my breath",
        "can't catch my breath",
        "out of breath",
        "panting",
        "wheez*"
      ]
    },
    {
      "id": "breathlessness_hint",
      "pathway_key": "breathlessness",
      "weight": 1,
      "phrases": [
        "breathing is heavy",
        "breathing fast",
        "breathing hard",
        "chest is tight"
      ]
    },
    {
      "id": "fever_clear",
      "pathway_key": "fever",
      "weight": 2,
      "phrases": [
        "fever*",
        "feverish",
        "high temperature",
        "my body is hot",
        "body is hot",
        "body hot",
        "hot body",
        "feeling hot",
        "chills",
        "shivering"
      ]
    },
    {
      "id": "fever_hint",
      "pathway_key": "fever",
      "weight": 1,
      "phrases": [
        "temperature",
        "sweating at night"
      ]
    },
    {
      "id": "abdominal_pain_clear",
      "pathway_key": "abdominal_pain",
      "weight": 2,
      "phrases": [
        "stomach pain*",
        "stomach ache",
        "stomach is paining",
        "my stomach is paining me",
        "belly pain",
        "belly ache",
        "belly is paining",
        "tummy pain",
        "tummy ache",
        "abdominal pain",
        "pain in my stomach",
        "pain in my belly",
        "cramps"
      ]
    },
    {
      "id": "abdominal_pain_hint",
      "pathway_key": "abdominal_pain",
      "weight": 1,
      "phrases": [
        "stomach feels",
        "bloated",
        "upset stomach"
      ]
    }
  ]
}
$json$::jsonb);
-- ux-seed-describe-end

-- ux-seed-explainer-begin
insert into public.symptom_ux_config (kind, version, effective_from, rules) values ('explainer', 1, '2026-10-22', $json$
{
  "version": 1,
  "status": "draft",
  "clinical_sign_off": null,
  "provenance": {
    "source": "docs/design/S59c.md section 4",
    "note": "Plain-words restatement of the signed v1 red-flag rules and the rationale on each signed outcome. No new clinical rule. Not reviewed by a clinician."
  },
  "entries": [
    {
      "id": "rule:headache.thunderclap_onset",
      "reason": "You told us the headache came on suddenly and is very strong. A sudden, very strong headache is one of the signs this check treats as serious."
    },
    {
      "id": "rule:headache.neuro_deficit",
      "reason": "You told us you have new weakness, numbness or confusion with the headache. Those are signs this check treats as serious."
    },
    {
      "id": "rule:headache.meningitic_signs",
      "reason": "You told us you have a fever and a stiff neck with the headache. Together they are signs this check treats as serious."
    },
    {
      "id": "rule:headache.vision_loss",
      "reason": "You told us you have lost some vision with the headache. That is a sign this check treats as serious."
    },
    {
      "id": "rule:headache.recent_head_injury",
      "reason": "You told us the headache followed a recent knock to the head and is quite strong. That is a sign this check treats as serious."
    },
    {
      "id": "rule:headache.immunocompromised_new_severe",
      "reason": "You told us about something in your health history that makes a strong headache worth a prompt look."
    },
    {
      "id": "rule:headache.pregnancy_severe",
      "reason": "You told us about something in your health history that makes a strong headache worth a prompt look."
    },
    {
      "id": "rule:chest_pain.cardiac_pattern",
      "reason": "You told us the chest pain comes with breathlessness, sweating, or pain in your arm or jaw. Together they are signs this check treats as serious."
    },
    {
      "id": "rule:chest_pain.sudden_severe_tearing",
      "reason": "You told us the chest pain started suddenly and is very strong. That is a sign this check treats as serious."
    },
    {
      "id": "rule:chest_pain.syncope",
      "reason": "You told us you fainted with the chest pain. That is a sign this check treats as serious."
    },
    {
      "id": "rule:chest_pain.known_cardiac_history",
      "reason": "You told us about something in your health history that makes chest pain worth checking straight away."
    },
    {
      "id": "rule:breathlessness.severe_sudden",
      "reason": "You told us the breathlessness came on suddenly and is severe even at rest. That is a sign this check treats as serious."
    },
    {
      "id": "rule:breathlessness.spo2_low",
      "reason": "You told us your oxygen reading was low. That is a sign this check treats as serious."
    },
    {
      "id": "rule:breathlessness.chest_pain",
      "reason": "You told us you have chest pain with the breathlessness. Together they are signs this check treats as serious."
    },
    {
      "id": "rule:breathlessness.cannot_complete_sentences",
      "reason": "You told us you are too breathless to finish a sentence. That is a sign this check treats as serious."
    },
    {
      "id": "rule:breathlessness.unilateral_leg_swelling",
      "reason": "You told us one leg is swollen along with the breathlessness. Together they are signs this check treats as serious."
    },
    {
      "id": "outcome:headache.urgent_worsening",
      "reason": "Your answers show a headache that is getting worse or waking you from sleep. This check asks for a prompt look at a headache that follows that pattern.",
      "tell_us_sooner_if": [
        "the pain comes on suddenly and is very strong",
        "you have new weakness, numbness or confusion",
        "you lose some of your vision",
        "you get a fever with a stiff neck"
      ]
    },
    {
      "id": "outcome:headache.routine_frequent",
      "reason": "Your answers show headaches that come often. This check suggests a routine appointment to look at the pattern.",
      "tell_us_sooner_if": [
        "the pain comes on suddenly and is very strong",
        "you have new weakness, numbness or confusion",
        "you lose some of your vision",
        "you get a fever with a stiff neck"
      ]
    },
    {
      "id": "outcome:headache.self_mild",
      "reason": "Your answers show a mild headache with none of the warning signs on this check's list. That is why it suggests looking after yourself and keeping an eye on it.",
      "tell_us_sooner_if": [
        "the pain comes on suddenly and is very strong",
        "you have new weakness, numbness or confusion",
        "you lose some of your vision",
        "you get a fever with a stiff neck"
      ]
    },
    {
      "id": "outcome:headache.routine_moderate",
      "reason": "Your answers show a headache that is slowing you down, with none of the warning signs on this check's list. This check suggests a routine appointment.",
      "tell_us_sooner_if": [
        "the pain comes on suddenly and is very strong",
        "you have new weakness, numbness or confusion",
        "you lose some of your vision",
        "you get a fever with a stiff neck"
      ]
    },
    {
      "id": "outcome:headache.urgent_severe",
      "reason": "Your answers show severe pain without a clear reason from the questions asked. This check asks for a prompt look.",
      "tell_us_sooner_if": [
        "the pain comes on suddenly and is very strong",
        "you have new weakness, numbness or confusion",
        "you lose some of your vision",
        "you get a fever with a stiff neck"
      ]
    },
    {
      "id": "outcome:chest_pain.urgent_exertional",
      "reason": "Your answers show chest pain that comes on with effort. This check asks for a prompt look at that pattern.",
      "tell_us_sooner_if": [
        "the pain comes with breathlessness, sweating, or pain in your arm or jaw",
        "the pain starts suddenly and is very strong",
        "you faint"
      ]
    },
    {
      "id": "outcome:chest_pain.self_msk",
      "reason": "Your answers show chest pain that changes when you press on it and has stayed steady, with none of the warning signs on this check's list. That is why it suggests looking after yourself and keeping an eye on it.",
      "tell_us_sooner_if": [
        "the pain comes with breathlessness, sweating, or pain in your arm or jaw",
        "the pain starts suddenly and is very strong",
        "you faint"
      ]
    },
    {
      "id": "outcome:chest_pain.routine_msk",
      "reason": "Your answers show chest pain that changes when you press on it and is new or changing. This check suggests a routine appointment.",
      "tell_us_sooner_if": [
        "the pain comes with breathlessness, sweating, or pain in your arm or jaw",
        "the pain starts suddenly and is very strong",
        "you faint"
      ]
    },
    {
      "id": "outcome:chest_pain.urgent_new",
      "reason": "Your answers show new chest pain, under an hour old, without a clear pattern. This check asks for a prompt look.",
      "tell_us_sooner_if": [
        "the pain comes with breathlessness, sweating, or pain in your arm or jaw",
        "the pain starts suddenly and is very strong",
        "you faint"
      ]
    },
    {
      "id": "outcome:chest_pain.routine_general",
      "reason": "Your answers show chest pain lasting several hours or longer, with none of the warning signs on this check's list. This check suggests a routine appointment.",
      "tell_us_sooner_if": [
        "the pain comes with breathlessness, sweating, or pain in your arm or jaw",
        "the pain starts suddenly and is very strong",
        "you faint"
      ]
    },
    {
      "id": "outcome:breathlessness.routine_exertional",
      "reason": "Your answers show breathlessness that comes with effort and eases with rest. This check suggests a routine appointment.",
      "tell_us_sooner_if": [
        "the breathlessness comes on suddenly and is severe even at rest",
        "you cannot finish a sentence",
        "you have chest pain with it",
        "one leg swells up"
      ]
    },
    {
      "id": "outcome:breathlessness.urgent_worsening",
      "reason": "Your answers show breathlessness that has been getting worse over days. This check asks for a prompt look.",
      "tell_us_sooner_if": [
        "the breathlessness comes on suddenly and is severe even at rest",
        "you cannot finish a sentence",
        "you have chest pain with it",
        "one leg swells up"
      ]
    },
    {
      "id": "outcome:breathlessness.self_mild",
      "reason": "Your answers show mild, steady breathlessness with none of the warning signs on this check's list. That is why it suggests looking after yourself and keeping an eye on it.",
      "tell_us_sooner_if": [
        "the breathlessness comes on suddenly and is severe even at rest",
        "you cannot finish a sentence",
        "you have chest pain with it",
        "one leg swells up"
      ]
    }
  ]
}
$json$::jsonb);
-- ux-seed-explainer-end

-- ux-seed-safety_net-begin
insert into public.symptom_ux_config (kind, version, effective_from, rules) values ('safety_net', 1, '2026-10-22', $json$
{
  "version": 1,
  "status": "draft",
  "clinical_sign_off": null,
  "provenance": {
    "source": "docs/design/S59c.md section 5",
    "note": "Plain-words restatement of the signed v1 red-flag rules of each pathway. No new clinical rule and no phone number. Not reviewed by a clinician."
  },
  "emergency_number": {
    "value": "112",
    "confirmed": false
  },
  "entries": [
    {
      "id": "headache_all",
      "pathway_key": "headache",
      "category": "*",
      "triggers": [
        "the headache comes on suddenly and is very strong",
        "you have new weakness, numbness or confusion",
        "you lose some of your vision",
        "you have a fever and a stiff neck",
        "the headache follows a knock to the head"
      ]
    },
    {
      "id": "chest_pain_all",
      "pathway_key": "chest_pain",
      "category": "*",
      "triggers": [
        "the pain comes with breathlessness, sweating, or pain in your arm or jaw",
        "the pain starts suddenly and is very strong",
        "you faint"
      ]
    },
    {
      "id": "breathlessness_all",
      "pathway_key": "breathlessness",
      "category": "*",
      "triggers": [
        "the breathlessness comes on suddenly and is severe even at rest",
        "you cannot finish a sentence",
        "you have chest pain with it",
        "one leg swells up"
      ]
    }
  ]
}
$json$::jsonb);
-- ux-seed-safety_net-end

alter table public.symptom_ux_config enable row level security;
revoke all on public.symptom_ux_config from public, anon, authenticated;
grant select on public.symptom_ux_config to authenticated;
-- only the CMO and an admin read the table directly (the sign-off screen); patients and clinicians get the active config through symptom_ux_active_config()
create policy symptom_ux_config_read on public.symptom_ux_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());

create function private.symptom_ux_config_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'symptom_ux_config % version % is never deleted', old.kind, old.version using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    -- born unsigned, inactive and in the draft form: a row can never be inserted already signed
    if new.is_active or new.approved_at is not null or new.approved_by is not null then
      raise exception 'a symptom ux config is created unsigned and inactive' using errcode = '42501';
    end if;
    if new.rules ->> 'status' <> 'draft' or coalesce(jsonb_typeof(new.rules -> 'clinical_sign_off'), 'missing') <> 'null' then
      raise exception 'a symptom ux config is stored in its draft form (status draft, no sign-off); the signature lives in the row''s own columns' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.rules is distinct from old.rules or new.version is distinct from old.version or new.kind is distinct from old.kind then
    raise exception 'a symptom ux config is never edited: add a new version' using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed config keeps its signature' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.symptom_ux_config_guard() from public, anon, authenticated;
create trigger symptom_ux_config_guard before insert or update or delete on public.symptom_ux_config
  for each row execute function private.symptom_ux_config_guard();
-- never activate a version older than one already signed (per kind). Own trigger name so the shared guard proof's count is unchanged.
create trigger symptom_ux_config_refuse_superseded before update of is_active on public.symptom_ux_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version('kind');

create function public.sign_symptom_ux_config(p_kind text, p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.symptom_ux_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the symptom assessment wording and timing' using errcode = '42501'; end if;
  select * into c from public.symptom_ux_config where kind = p_kind and version = p_version for update;
  if not found then raise exception 'no such symptom ux config version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.symptom_ux_config set is_active = false where kind = p_kind and is_active and version <> p_version;
  update public.symptom_ux_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where id = c.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'symptom_ux_config.signed',
            'symptom_ux_config', c.id, jsonb_build_object('kind', p_kind, 'version', p_version));
end $$;
revoke all on function public.sign_symptom_ux_config(text, integer) from public, anon, authenticated;
grant execute on function public.sign_symptom_ux_config(text, integer) to authenticated;

-- The active SIGNED config of a kind, with its signature added from the row's own columns, or null. This is what the screens compare their bundled
-- copy with (a copy that differs is drift and is not used). status can only read 'signed_off' for a row that really carries a signature.
create function private.symptom_ux_signed_json(c public.symptom_ux_config) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select c.rules || jsonb_build_object(
    'status', case when c.approved_at is not null and c.approved_by is not null then 'signed_off' else 'draft' end,
    'clinical_sign_off', case when c.approved_at is not null and c.approved_by is not null
      then jsonb_build_object(
             'by', coalesce(nullif(btrim((select p.full_name from public.profiles p where p.id = c.approved_by)), ''), 'Chief Medical Officer'),
             'at', to_char(c.approved_at at time zone 'Africa/Lagos', 'YYYY-MM-DD'))
      else 'null'::jsonb end)
$$;
revoke all on function private.symptom_ux_signed_json(public.symptom_ux_config) from public, anon, authenticated;

create function public.symptom_ux_active_config(p_kind text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare c public.symptom_ux_config%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into c from public.symptom_ux_config where kind = p_kind and is_active and approved_at is not null and approved_by is not null order by version desc limit 1;
  if not found then return null; end if;
  return private.symptom_ux_signed_json(c);
end $$;
revoke all on function public.symptom_ux_active_config(text) from public, anon;
grant execute on function public.symptom_ux_active_config(text) to authenticated;

create function private.symptom_ux_active(p_kind text) returns public.symptom_ux_config
language sql stable security definer set search_path = ''
as $$ select c from public.symptom_ux_config c where c.kind = p_kind and c.is_active and c.approved_at is not null and c.approved_by is not null order by c.version desc limit 1 $$;
revoke all on function private.symptom_ux_active(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Events (ids only, INV-07)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('symptom_checkback.sent', 'A follow-up after a symptom check was handed to the patient', 'S59c', false),
  ('symptom_checkback.answered', 'A follow-up after a symptom check was answered', 'S59c', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('symptom_checkback.sent', 1, array['checkback_id']),
  ('symptom_checkback.answered', 1, array['checkback_id'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The follow-up rows
-- ---------------------------------------------------------------------------
create table public.symptom_checkbacks (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  assessment_id      uuid not null references public.symptom_triage_assessments (id) on delete cascade,
  -- round 1 is the scheduled check; round 2 exists only when round 1 was answered "same" before the nudge time (one more ask, at the threshold)
  round              smallint not null default 1 check (round in (1, 2)),
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  config_id          uuid not null references public.symptom_ux_config (id) on delete restrict,
  category           public.triage_category not null check (category in ('self_management', 'routine')),
  due_at             timestamptz not null,
  state              text not null default 'scheduled' check (state in ('scheduled', 'open', 'answered', 'expired', 'cancelled')),
  opened_at          timestamptz,
  nudge_count        integer not null default 0 check (nudge_count between 0 and 1),
  nudged_at          timestamptz,
  expired_at         timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  -- the outcome (what the accuracy audit will read; nothing here reads it back)
  answered_at        timestamptz,
  progress           text check (progress in ('better', 'same', 'worse')),
  care_received      text check (care_received in ('saw_clinician', 'pharmacist', 'not_yet', 'not_needed')),
  new_signs          text[] not null default '{}',
  floor_category     text check (floor_category in ('urgent', 'emergency')),
  action             text check (action in ('close', 'keep_watching', 'book', 'escalate', 'emergency')),
  hours_since_check  numeric(8, 2),
  escalated          boolean not null default false,
  doctor_access      boolean,
  emergency_event_id uuid references public.emergency_events (id) on delete set null,
  alert_id           uuid references public.clinician_alerts (id) on delete set null,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint symptom_checkbacks_answered_has_outcome check (state <> 'answered' or (answered_at is not null and progress is not null and action is not null)),
  constraint symptom_checkbacks_cancelled_has_reason check (state <> 'cancelled' or (cancelled_at is not null and cancel_reason is not null)),
  unique (assessment_id, round),
  constraint symptom_checkbacks_signs_bounded check (coalesce(array_length(new_signs, 1), 0) <= 10)
);
create index symptom_checkbacks_patient_idx on public.symptom_checkbacks (patient_id, state);
create index symptom_checkbacks_due_idx on public.symptom_checkbacks (due_at) where state in ('scheduled', 'open');
create index symptom_checkbacks_org_idx on public.symptom_checkbacks (organisation_id);
create index symptom_checkbacks_config_idx on public.symptom_checkbacks (config_id);
create index symptom_checkbacks_emergency_idx on public.symptom_checkbacks (emergency_event_id) where emergency_event_id is not null;
create index symptom_checkbacks_alert_idx on public.symptom_checkbacks (alert_id) where alert_id is not null;
create trigger symptom_checkbacks_set_updated_at before update on public.symptom_checkbacks
  for each row execute function private.set_updated_at();
comment on table public.symptom_checkbacks is
  'S59c: a patient''s follow-up ("better, same or worse?") after a self-care or routine symptom check. Written only by the S59c functions. The patient reads own rows; staff read only through read_symptom_checkback_audited() (tied, audited).';

alter table public.symptom_checkbacks enable row level security;
revoke all on public.symptom_checkbacks from public, anon, authenticated;
grant select on public.symptom_checkbacks to authenticated;
create policy symptom_checkbacks_patient_read on public.symptom_checkbacks for select to authenticated
  using (patient_id = (select auth.uid()));

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select 'symptom_checkbacks', 'patient_id', private.retention_class_for('symptom_checkbacks'),
       case when private.retention_class_for('symptom_checkbacks') = 'operational' then 'delete' else 'review' end,
       private.retention_class_for('symptom_checkbacks') <> 'audit',
       'S59c 2026-10-22: PROPOSED, to be confirmed by the CMO and DPO. A patient''s answer to the follow-up after a symptom check (progress, care received, newly ticked signs).'
on conflict (table_name) do nothing;
select private.guard_minor_dependant_table('symptom_checkbacks', 'patient_id');

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------
-- Notice time: inside the window (Africa/Lagos, no DST) now, otherwise the next window start. The in-app item is never delayed by this.
create function private.symptom_checkback_send_after(p_at timestamptz, p_start integer, p_end integer) returns timestamptz
language plpgsql immutable set search_path = ''
as $$
declare v_local timestamp := p_at at time zone 'Africa/Lagos'; v_h integer := extract(hour from (p_at at time zone 'Africa/Lagos'))::integer;
begin
  if v_h >= p_start and v_h < p_end then return null; end if;
  if v_h < p_start then
    return (date_trunc('day', v_local) + make_interval(hours => p_start)) at time zone 'Africa/Lagos';
  end if;
  return (date_trunc('day', v_local) + interval '1 day' + make_interval(hours => p_start)) at time zone 'Africa/Lagos';
end $$;
revoke all on function private.symptom_checkback_send_after(timestamptz, integer, integer) from public, anon, authenticated;

create function private.symptom_checkback_open_incident(p_what text, p_count integer) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.page_incident_sev(null, 'symptom_checkbacks', 'sev3', 'Symptom follow-ups could not be handled',
    format('%s: %s item(s) failed; see audit_log actions starting symptom_checkback.error. A patient may be missing a follow-up.', p_what, p_count));
end $$;
revoke all on function private.symptom_checkback_open_incident(text, integer) from public, anon, authenticated;

-- An event is for downstream observers. It must never undo an answer or stop a follow-up opening: a failure is written down and an incident opened.
create function private.symptom_checkback_emit(p_type text, p_org uuid, p_checkback uuid, p_patient uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.emit_domain_event(p_type, p_org, jsonb_build_object('checkback_id', p_checkback), p_type || ':' || p_checkback::text, p_patient, 'symptom_checkback', p_checkback);
exception when others then
  insert into public.audit_log (action, entity_type, entity_id, event) values ('symptom_checkback.error_event', 'symptom_checkback', p_checkback, jsonb_build_object('type', p_type, 'error', left(sqlerrm, 300)));
  perform private.symptom_checkback_open_incident('event bus', 1);
end $$;
revoke all on function private.symptom_checkback_emit(text, uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Scheduling (signed config + checker open for that patient; idempotent)
-- ---------------------------------------------------------------------------
create function private.schedule_symptom_checkback(p_assessment uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  a public.symptom_triage_assessments%rowtype;
  c public.symptom_ux_config;
  v_cat public.triage_category;
  v_delay integer;
  v_test boolean;
  v_rows integer;
begin
  c := private.symptom_ux_active('checkback');
  if c.id is null then return 0; end if;
  select * into a from public.symptom_triage_assessments where id = p_assessment;
  if a.id is null then return 0; end if;
  -- INV-14: closed means closed, for that patient (test accounts excepted, the S37 rule)
  if not private.go_live_open_patient('symptom_checker_enabled', a.patient_id) then return 0; end if;
  v_cat := coalesce(a.override_category, a.category);
  -- only self-care and routine results; an urgent or emergency result already put a human in the loop, and an assessment that raised an
  -- emergency event is never followed up this way
  if v_cat::text not in ('self_management', 'routine') or a.emergency_event_id is not null or a.category::text not in ('self_management', 'routine') then return 0; end if;
  v_delay := (c.rules #>> array['categories', v_cat::text, 'delay_hours'])::integer;
  if v_delay is null then return 0; end if;
  -- an assessment whose whole window has already passed (found when the config was first signed) is not followed up
  if a.created_at + make_interval(hours => v_delay + (c.rules ->> 'expire_after_hours')::integer) <= now() then return 0; end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = a.patient_id;
  insert into public.symptom_checkbacks (organisation_id, assessment_id, patient_id, config_id, category, due_at, is_test)
  values (a.organisation_id, a.id, a.patient_id, c.id, v_cat, a.created_at + make_interval(hours => v_delay), coalesce(v_test, false))
  on conflict (assessment_id, round) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.schedule_symptom_checkback(uuid) from public, anon, authenticated;

-- A failure must never stop the assessment being recorded, and must never vanish: it is written down, an incident is opened, and the sweep
-- schedules the assessment again.
create function private.symptom_triage_assessments_schedule_checkback() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.schedule_symptom_checkback(new.id);
  exception when others then
    insert into public.audit_log (action, entity_type, entity_id, event)
    values ('symptom_checkback.error_schedule', 'symptom_triage_assessment', new.id, jsonb_build_object('error', left(sqlerrm, 300)));
    perform private.symptom_checkback_open_incident('scheduling', 1);
  end;
  return null;
end $$;
revoke all on function private.symptom_triage_assessments_schedule_checkback() from public, anon, authenticated;
create trigger symptom_triage_assessments_90_schedule_checkback after insert on public.symptom_triage_assessments
  for each row execute function private.symptom_triage_assessments_schedule_checkback();

-- ---------------------------------------------------------------------------
-- 6. The sweep: backfill, cancel, expire, open, nudge
-- ---------------------------------------------------------------------------
create function private.symptom_checkback_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  c public.symptom_ux_config;
  v_after timestamptz; v_ch public.notification_channel; v_maxdelay integer;
  v_errors integer := 0; v_opened integer := 0; v_nudged integer := 0; v_expired integer := 0; v_cancelled integer := 0; v_back integer := 0;
begin
  c := private.symptom_ux_active('checkback');

  -- 1. backfill (only with a signed config): an assessment with no row (the trigger failed, or the config was signed after the check)
  if c.id is not null then
    select greatest((c.rules #>> '{categories,self_management,delay_hours}')::integer, (c.rules #>> '{categories,routine,delay_hours}')::integer) into v_maxdelay;
    for r in select a.id from public.symptom_triage_assessments a
              where a.category::text in ('self_management', 'routine') and a.emergency_event_id is null
                and a.created_at + make_interval(hours => v_maxdelay + (c.rules ->> 'expire_after_hours')::integer) > now()
                and private.go_live_open_patient('symptom_checker_enabled', a.patient_id)
                and not exists (select 1 from public.symptom_checkbacks k where k.assessment_id = a.id)
              order by a.created_at limit 500 loop
      begin
        v_back := v_back + private.schedule_symptom_checkback(r.id);
      exception when others then
        v_errors := v_errors + 1;
        insert into public.audit_log (action, entity_type, entity_id, event) values ('symptom_checkback.error_backfill', 'symptom_triage_assessment', r.id, jsonb_build_object('error', left(sqlerrm, 300)));
      end;
    end loop;
  end if;

  -- 2. cancel (always): a later check by the same person ended as urgent or an emergency, so a human is already involved
  for r in select k.id from public.symptom_checkbacks k
            where k.state in ('scheduled', 'open')
              and exists (select 1 from public.symptom_triage_assessments l
                           join public.symptom_triage_assessments o on o.id = k.assessment_id
                          where l.patient_id = k.patient_id and l.created_at > o.created_at and l.category::text in ('urgent', 'emergency')) loop
    begin
      update public.symptom_checkbacks set state = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_later_check' where id = r.id and state in ('scheduled', 'open');
      if found then
        delete from public.notifications where status = 'pending' and template in ('symptom_checkback_due', 'symptom_checkback_nudge') and payload ->> 'checkback_id' = r.id::text;
        v_cancelled := v_cancelled + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event) values ('symptom_checkback.error_cancel', 'symptom_checkback', r.id, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;

  -- 2b. too old (always): a follow-up that never opened and whose whole window (due time plus the time it stays open) has passed is not asked
  --     weeks later ("how are you getting on?" after a month is noise at best). It is cancelled with a reason, loudly in the row, never opened.
  for r in select k.id from public.symptom_checkbacks k join public.symptom_ux_config cc on cc.id = k.config_id
            where k.state = 'scheduled' and k.due_at + make_interval(hours => (cc.rules ->> 'expire_after_hours')::integer) <= now() loop
    begin
      update public.symptom_checkbacks set state = 'cancelled', cancelled_at = now(), cancel_reason = 'too_old' where id = r.id and state = 'scheduled';
      if found then v_cancelled := v_cancelled + 1; end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event) values ('symptom_checkback.error_cancel', 'symptom_checkback', r.id, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;

  -- 3. expire (always): no answer inside the window. Silence is not a clinical signal: no alert. Only moved while still open, so a late answer that
  --    commits first is never overwritten.
  for r in select k.id from public.symptom_checkbacks k join public.symptom_ux_config cc on cc.id = k.config_id
            where k.state = 'open' and k.opened_at + make_interval(hours => (cc.rules ->> 'expire_after_hours')::integer) <= now() loop
    begin
      update public.symptom_checkbacks set state = 'expired', expired_at = now() where id = r.id and state = 'open';
      if found then
        delete from public.notifications where status = 'pending' and template in ('symptom_checkback_due', 'symptom_checkback_nudge') and payload ->> 'checkback_id' = r.id::text;
        v_expired := v_expired + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event) values ('symptom_checkback.error_expire', 'symptom_checkback', r.id, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;

  -- 4. open what is due (needs the checker open for that patient). The in-app item always; the patient's own channel beside it.
  for r in select k.*, cc.rules as rules from public.symptom_checkbacks k join public.symptom_ux_config cc on cc.id = k.config_id
            where k.state = 'scheduled' and k.due_at <= now()
              and k.due_at + make_interval(hours => (cc.rules ->> 'expire_after_hours')::integer) > now()
            order by k.due_at limit 500 loop
    begin
      if not private.go_live_open_patient('symptom_checker_enabled', r.patient_id) then continue; end if;
      update public.symptom_checkbacks set state = 'open', opened_at = now() where id = r.id and state = 'scheduled';
      if not found then continue; end if;
      v_after := private.symptom_checkback_send_after(now(), (r.rules #>> '{notification_window,start_hour}')::integer, (r.rules #>> '{notification_window,end_hour}')::integer);
      v_ch := private.patient_reminder_channel(r.patient_id);
      -- the notice window holds a push or an email at night; an in-app item is never held (it is a quiet inbox row, not an interruption)
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, send_after)
      values (r.organisation_id, r.patient_id, v_ch, 'pending', 'symptom_checkback_due', jsonb_build_object('checkback_id', r.id), 'non_clinical', case when v_ch = 'in_app' then null else v_after end);
      if v_ch <> 'in_app' then
        insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
        values (r.organisation_id, r.patient_id, 'in_app', 'pending', 'symptom_checkback_due', jsonb_build_object('checkback_id', r.id), 'non_clinical');
      end if;
      perform private.symptom_checkback_emit('symptom_checkback.sent', r.organisation_id, r.id, r.patient_id);
      v_opened := v_opened + 1;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event) values ('symptom_checkback.error_open', 'symptom_checkback', r.id, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;

  -- 5. one gentle reminder (the config's max_nudges), only for follow-ups still open
  for r in select k.*, cc.rules as rules from public.symptom_checkbacks k join public.symptom_ux_config cc on cc.id = k.config_id
            where k.state = 'open' and k.nudge_count < (cc.rules ->> 'max_nudges')::integer
              and k.opened_at + make_interval(hours => (cc.rules ->> 'nudge_after_hours')::integer) <= now() loop
    begin
      if not private.go_live_open_patient('symptom_checker_enabled', r.patient_id) then continue; end if;
      update public.symptom_checkbacks set nudge_count = nudge_count + 1, nudged_at = now() where id = r.id and state = 'open' and nudge_count = r.nudge_count;
      if not found then continue; end if;
      v_after := private.symptom_checkback_send_after(now(), (r.rules #>> '{notification_window,start_hour}')::integer, (r.rules #>> '{notification_window,end_hour}')::integer);
      v_ch := private.patient_reminder_channel(r.patient_id);
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, send_after)
      values (r.organisation_id, r.patient_id, v_ch, 'pending', 'symptom_checkback_nudge', jsonb_build_object('checkback_id', r.id), 'non_clinical', case when v_ch = 'in_app' then null else v_after end);
      if v_ch <> 'in_app' then
        insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
        values (r.organisation_id, r.patient_id, 'in_app', 'pending', 'symptom_checkback_nudge', jsonb_build_object('checkback_id', r.id), 'non_clinical');
      end if;
      v_nudged := v_nudged + 1;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event) values ('symptom_checkback.error_nudge', 'symptom_checkback', r.id, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;

  if v_errors > 0 then perform private.symptom_checkback_open_incident('sweep', v_errors); end if;
  return jsonb_build_object('config_signed', c.id is not null, 'backfilled', v_back, 'cancelled', v_cancelled, 'opened', v_opened, 'expired', v_expired, 'nudged', v_nudged, 'errors', v_errors);
end $$;
revoke all on function private.symptom_checkback_sweep() from public, anon, authenticated;
select cron.schedule('symptom-checkback-sweep', '*/15 * * * *', $$ select private.symptom_checkback_sweep(); $$);

-- ---------------------------------------------------------------------------
-- 7. Patient: read one, and answer
-- ---------------------------------------------------------------------------
create function public.my_symptom_checkback(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  k public.symptom_checkbacks%rowtype;
  a public.symptom_triage_assessments%rowtype;
  cc public.symptom_ux_config%rowtype;
  v_pathway jsonb; v_label text;
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into k from public.symptom_checkbacks where id = p_id and patient_id = (select auth.uid());
  if not found then raise exception 'follow-up not found' using errcode = 'P0002'; end if;
  select * into a from public.symptom_triage_assessments where id = k.assessment_id;
  select * into cc from public.symptom_ux_config where id = k.config_id;
  select elem into v_pathway
    from jsonb_array_elements((select config from public.triage_protocols where version = a.protocol_version) -> 'pathways') elem
   where elem ->> 'key' = a.presenting_complaint_key limit 1;
  v_label := coalesce(v_pathway ->> 'label', a.presenting_complaint_key);
  return jsonb_build_object(
    'id', k.id, 'state', k.state, 'assessment_id', k.assessment_id, 'due_at', k.due_at, 'opened_at', k.opened_at,
    'category', k.category, 'urgency_level', a.urgency_level, 'complaint_key', a.presenting_complaint_key, 'complaint_label', v_label,
    'checked_at', a.created_at,
    'hours_since_check', round((extract(epoch from (now() - a.created_at)) / 3600)::numeric, 2),
    'same_nudge_after_hours', (cc.rules #>> array['categories', k.category::text, 'same_nudge_after_hours'])::integer,
    -- the vocabulary a newly ticked sign may come from: the pathway's own, as signed
    'sign_vocabulary', coalesce(v_pathway -> 'knownAssociatedSymptoms', '[]'::jsonb),
    -- the original answers, so the red-flag floor can be re-run on this device with what is newly ticked added
    'capture', a.initial_capture,
    'protocol_version', a.protocol_version,
    'round', k.round,
    -- what the screen needs to say the same thing on a later visit as it said when the answer was given (told only if an alert or an emergency really was raised)
    'outcome', case when k.state = 'answered' then jsonb_build_object('action', k.action, 'progress', k.progress, 'escalated', k.escalated,
      'alert_raised', k.alert_id is not null, 'emergency', k.emergency_event_id is not null, 'doctor_access', k.doctor_access) else null end);
end $$;
revoke all on function public.my_symptom_checkback(uuid) from public, anon;
grant execute on function public.my_symptom_checkback(uuid) to authenticated;

-- The red-flag floor, evaluated in the database from the SIGNED protocol the assessment was made under, on the original answers plus newly ticked signs.
-- Same reading of a rule as the engine's evaluateCondition (every present key is AND-ed). The app also sends its own figure; the database takes the
-- more urgent of the two, so a direct caller can never downgrade an emergency-grade sign by sending a smaller figure. A rule it cannot read counts as
-- not fired here (the app's figure still applies).
create function private.symptom_red_flag_floor(p_protocol integer, p_complaint text, p_capture jsonb, p_extra_symptoms text[]) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  pw jsonb; r jsonb; cond jsonb; v_ok boolean; v_top integer := 0; v_rank integer; v_m numeric;
  v_sym text[]; v_trig text[]; v_hist text[];
begin
  select elem into pw from jsonb_array_elements((select config from public.triage_protocols where version = p_protocol) -> 'pathways') elem
   where elem ->> 'key' = p_complaint limit 1;
  if pw is null then return null; end if;
  v_sym := array(select jsonb_array_elements_text(coalesce(p_capture -> 'associatedSymptoms', '[]'::jsonb))) || coalesce(p_extra_symptoms, '{}'::text[]);
  v_trig := array(select jsonb_array_elements_text(coalesce(p_capture -> 'triggers', '[]'::jsonb)));
  v_hist := array(select jsonb_array_elements_text(coalesce(p_capture -> 'relevantHistory', '[]'::jsonb)));
  for r in select x from jsonb_array_elements(coalesce(pw -> 'redFlagScreen', '[]'::jsonb)) x loop
    cond := r -> 'rule';
    v_ok := true;
    begin
      if cond ? 'onset' and (p_capture ->> 'onset') is distinct from (cond ->> 'onset') then v_ok := false; end if;
      if v_ok and cond ? 'minSeverity' and coalesce((p_capture ->> 'severity')::numeric, 0) < (cond ->> 'minSeverity')::numeric then v_ok := false; end if;
      if v_ok and cond ? 'anyAssociatedSymptom' and not (v_sym && array(select jsonb_array_elements_text(cond -> 'anyAssociatedSymptom'))) then v_ok := false; end if;
      if v_ok and cond ? 'allAssociatedSymptoms' and not (v_sym @> array(select jsonb_array_elements_text(cond -> 'allAssociatedSymptoms'))) then v_ok := false; end if;
      if v_ok and cond ? 'anyTrigger' and not (v_trig && array(select jsonb_array_elements_text(cond -> 'anyTrigger'))) then v_ok := false; end if;
      if v_ok and cond ? 'anyHistory' and not (v_hist && array(select jsonb_array_elements_text(cond -> 'anyHistory'))) then v_ok := false; end if;
      if v_ok and cond ? 'measurementBelow' then
        v_m := (p_capture -> 'measurements' ->> (cond #>> '{measurementBelow,key}'))::numeric;
        if v_m is null or not (v_m <= (cond #>> '{measurementBelow,value}')::numeric) then v_ok := false; end if;
      end if;
      if v_ok and cond ? 'measurementAtLeast' then
        v_m := (p_capture -> 'measurements' ->> (cond #>> '{measurementAtLeast,key}'))::numeric;
        if v_m is null or not (v_m >= (cond #>> '{measurementAtLeast,value}')::numeric) then v_ok := false; end if;
      end if;
    exception when others then
      v_ok := false;
    end;
    if v_ok then
      v_rank := case r ->> 'category' when 'emergency' then 2 when 'urgent' then 1 else 0 end;
      if v_rank > v_top then v_top := v_rank; end if;
    end if;
  end loop;
  return case v_top when 2 then 'emergency' when 1 then 'urgent' else null end;
end $$;
revoke all on function private.symptom_red_flag_floor(integer, text, jsonb, text[]) from public, anon, authenticated;

create function public.answer_symptom_checkback(p_id uuid, p_progress text, p_care text, p_new_signs text[], p_floor_category text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  k public.symptom_checkbacks%rowtype;
  a public.symptom_triage_assessments%rowtype;
  cc public.symptom_ux_config%rowtype;
  v_signs text[] := coalesce(p_new_signs, '{}');
  v_vocab jsonb; v_label text; v_hours numeric; v_nudge integer; v_action text; v_sign text;
  v_alert uuid; v_ee uuid; v_may boolean; v_summary jsonb; v_detail text; v_out jsonb; v_floor text; v_db_floor text; v_next timestamptz;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into k from public.symptom_checkbacks where id = p_id and patient_id = v_uid for update;
  if not found then raise exception 'follow-up not found' using errcode = 'P0002'; end if;
  -- an answer already given is returned as it was stored (idempotent); nothing more is raised
  if k.state = 'answered' then
    return jsonb_build_object('action', k.action, 'escalated', k.escalated, 'alert_raised', k.alert_id is not null, 'emergency', k.emergency_event_id is not null,
                              'doctor_access', k.doctor_access, 'assessment_id', k.assessment_id, 'repeat', true);
  end if;
  if k.state not in ('open', 'expired') then raise exception 'this follow-up is %', k.state using errcode = '55000'; end if;
  -- INV-14: closed means closed, for this patient (test accounts excepted)
  if not private.go_live_open_patient('symptom_checker_enabled', k.patient_id) then
    raise exception 'The symptom checker is not open yet' using errcode = '42501';
  end if;
  if p_progress is null or p_progress not in ('better', 'same', 'worse') then raise exception 'please say whether it is better, the same or worse' using errcode = '22023'; end if;
  if p_care is not null and p_care not in ('saw_clinician', 'pharmacist', 'not_yet', 'not_needed') then raise exception 'unknown answer' using errcode = '22023'; end if;
  if p_floor_category is not null and p_floor_category not in ('urgent', 'emergency') then raise exception 'unknown floor category' using errcode = '22023'; end if;
  if coalesce(array_length(v_signs, 1), 0) > 10 then raise exception 'too many signs' using errcode = '22023'; end if;

  select * into a from public.symptom_triage_assessments where id = k.assessment_id;
  select * into cc from public.symptom_ux_config where id = k.config_id;
  select elem -> 'knownAssociatedSymptoms', elem ->> 'label' into v_vocab, v_label
    from jsonb_array_elements((select config from public.triage_protocols where version = a.protocol_version) -> 'pathways') elem
   where elem ->> 'key' = a.presenting_complaint_key limit 1;
  -- a newly ticked sign must come from the pathway's own vocabulary: nothing free-form reaches an alert
  foreach v_sign in array v_signs loop
    if v_vocab is null or not (v_vocab ? v_sign) then raise exception 'unknown sign' using errcode = '22023'; end if;
  end loop;
  v_signs := (select coalesce(array_agg(distinct s order by s), '{}') from unnest(v_signs) s);

  -- the floor: the more urgent of what the app sent and what the database derives itself from the signed protocol (a client cannot lower it)
  v_db_floor := private.symptom_red_flag_floor(a.protocol_version, a.presenting_complaint_key, a.initial_capture, v_signs);
  v_floor := case when p_floor_category = 'emergency' or v_db_floor = 'emergency' then 'emergency'
                  when p_floor_category = 'urgent' or v_db_floor = 'urgent' then 'urgent' else null end;
  v_hours := round((extract(epoch from (now() - a.created_at)) / 3600)::numeric, 2);
  v_nudge := (cc.rules #>> array['categories', k.category::text, 'same_nudge_after_hours'])::integer;
  v_action := case
    when v_floor = 'emergency' then 'emergency'
    when coalesce(array_length(v_signs, 1), 0) > 0 or v_floor = 'urgent' or p_progress = 'worse' then 'escalate'
    when p_progress = 'same' then case when v_hours >= v_nudge then 'book' else 'keep_watching' end
    else 'close' end;

  if v_action in ('emergency', 'escalate') then
    v_summary := private.build_symptom_summary_payload(a);
    -- the ORIGINAL summary, so whoever picks the alert up sees what was reported at the time of the check (the payload never carries pregnancy)
    v_detail := left(format(
      'Follow-up after a symptom check (%s, checked %s, result: %s). Answered: %s; %s hours after the check%s. At the time of the check the person reported: onset %s, severity %s%s%s%s.',
      coalesce(v_summary ->> 'complaint_label', a.presenting_complaint_key),
      to_char(a.created_at at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'),
      a.category,
      p_progress, v_hours::text,
      case when coalesce(array_length(v_signs, 1), 0) > 0 then '; newly ticked: ' || array_to_string(v_signs, ', ') else '' end,
      coalesce(v_summary ->> 'onset', 'not stated'), coalesce(v_summary ->> 'severity', 'not stated'),
      case when jsonb_array_length(coalesce(v_summary -> 'associated_symptoms', '[]'::jsonb)) > 0
           then '; ticked: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(v_summary -> 'associated_symptoms') x) else '' end,
      case when jsonb_array_length(coalesce(v_summary -> 'history', '[]'::jsonb)) > 0
           then '; history: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(v_summary -> 'history') x) else '' end,
      case when jsonb_array_length(coalesce(v_summary -> 'red_flags_fired', '[]'::jsonb)) > 0
           then '; red flags then: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(v_summary -> 'red_flags_fired') x) else '' end), 1800);
  end if;

  if v_action = 'emergency' then
    -- the existing emergency path: its trigger raises the clinician alert and the patient sees the guidance and their contacts are told
    insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
    values (k.organisation_id, k.patient_id, 'symptom_triage', left('Symptom follow-up: ' || v_detail, 1900), 'active')
    returning id into v_ee;
    select clinician_alert_id into v_alert from public.emergency_events where id = v_ee;
    if v_alert is null then
      -- the emergency path can decline by entitlement; a red flag is never left with nobody told on a plan that includes doctor time
      if private.patient_may_page_doctor(k.patient_id) then
        v_alert := private.raise_clinician_alert(k.organisation_id, k.patient_id, 'emergency'::public.alert_level,
          'Priority 1: warning sign in a follow-up after a symptom check', v_detail, 'clinical', 'symptom_escalation');
      end if;
    end if;
  elsif v_action = 'escalate' then
    v_may := private.patient_may_page_doctor(k.patient_id);
    if v_may then
      v_alert := private.raise_clinician_alert(k.organisation_id, k.patient_id, 'urgent_escalation'::public.alert_level,
        'Follow-up after a symptom check: not getting better', v_detail, 'clinical', 'symptom_escalation');
    end if;
  end if;

  -- "same" before the nudge time is not the end: one more ask is scheduled at the threshold (round 2, once; round 2 itself never schedules another)
  if v_action = 'keep_watching' and k.round = 1 then
    v_next := greatest(a.created_at + make_interval(hours => v_nudge), now() + interval '1 hour');
    insert into public.symptom_checkbacks (organisation_id, assessment_id, patient_id, config_id, category, due_at, round, is_test)
    values (k.organisation_id, k.assessment_id, k.patient_id, k.config_id, k.category, v_next, 2, k.is_test)
    on conflict (assessment_id, round) do nothing;
  end if;
  v_out := jsonb_build_object('action', v_action, 'escalated', v_action in ('emergency', 'escalate'), 'alert_raised', v_alert is not null,
                              'emergency', v_ee is not null, 'doctor_access', case when v_action = 'escalate' then v_may else null end,
                              'next_check_at', v_next, 'assessment_id', k.assessment_id, 'repeat', false);
  update public.symptom_checkbacks
     set state = 'answered', answered_at = now(), progress = p_progress, care_received = p_care, new_signs = v_signs, floor_category = v_floor,
         action = v_action, hours_since_check = v_hours, escalated = v_action in ('emergency', 'escalate'), doctor_access = case when v_action = 'escalate' then v_may else null end,
         emergency_event_id = v_ee, alert_id = v_alert
   where id = k.id;
  delete from public.notifications where status = 'pending' and template in ('symptom_checkback_due', 'symptom_checkback_nudge') and payload ->> 'checkback_id' = k.id::text;
  perform private.symptom_checkback_emit('symptom_checkback.answered', k.organisation_id, k.id, k.patient_id);
  return v_out;
end $$;
revoke all on function public.answer_symptom_checkback(uuid, text, text, text[], text) from public, anon;
grant execute on function public.answer_symptom_checkback(uuid, text, text, text[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Clinician: audited read, tied (INV-10, INV-12). Same rule as read_symptom_session_audited.
-- ---------------------------------------------------------------------------
create function public.read_symptom_checkback_audited(p_assessment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a public.symptom_triage_assessments%rowtype;
  k public.symptom_checkbacks%rowtype;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if (select auth.uid()) is null or not private.is_reviewing_clinician() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select * into a from public.symptom_triage_assessments where id = p_assessment;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if not private.can_staff_read_clinical(a.patient_id, 'medical_history'::public.care_access_category) then
    perform private.audit_chart_read(a.patient_id, array['symptom_checkback'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  perform private.audit_chart_read(a.patient_id, array['symptom_checkback'], p_reason, 'success');
  select * into k from public.symptom_checkbacks where assessment_id = a.id order by round desc limit 1;
  if not found then return jsonb_build_object('status', 'none'); end if;
  return jsonb_build_object('status', 'ok', 'checkback', jsonb_build_object(
    'id', k.id, 'round', k.round, 'state', k.state, 'category', k.category, 'due_at', k.due_at, 'opened_at', k.opened_at, 'answered_at', k.answered_at,
    'progress', k.progress, 'care_received', k.care_received, 'new_signs', k.new_signs, 'action', k.action,
    'hours_since_check', k.hours_since_check, 'escalated', k.escalated));
end $$;
revoke all on function public.read_symptom_checkback_audited(uuid, text) from public, anon;
grant execute on function public.read_symptom_checkback_audited(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Neutral templates (INV-07): nothing names a symptom, a result or a person. The sender renderers and the in-app copy are in the repository;
--    post-merge step: redeploy send-pending-notifications.
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, description) values
  ('symptom_checkback_due', 'clinical', 'routine', 'patient', array['push', 'email', 'in_app']::public.notification_channel[], 'A short follow-up is waiting in the app.'),
  ('symptom_checkback_nudge', 'clinical', 'routine', 'patient', array['push', 'email', 'in_app']::public.notification_channel[], 'One gentle reminder that the follow-up is still waiting.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('symptom_checkback_due', 'en', 'in_app', null, 'Your care team would like to know how you are getting on. Open the app to answer'),
  ('symptom_checkback_due', 'en', 'push', null, 'Your care team would like to know how you are getting on'),
  ('symptom_checkback_due', 'en', 'email', 'How are you getting on?', 'Your care team would like to know how you are getting on. Open the Tarragon Health app to answer.'),
  ('symptom_checkback_nudge', 'en', 'in_app', null, 'Your quick follow-up is still waiting whenever you are ready'),
  ('symptom_checkback_nudge', 'en', 'push', null, 'Your quick follow-up is still waiting'),
  ('symptom_checkback_nudge', 'en', 'email', 'Your quick follow-up is still waiting', 'Your quick follow-up is still waiting in the Tarragon Health app, whenever you are ready.')
on conflict (template_key, locale, channel) do nothing;

-- The go-live dashboard lists where the guard is enforced.
update public.go_live_guards
   set enforced_in = enforced_in || array['schedule_symptom_checkback, symptom_checkback_sweep (open, nudge) and answer_symptom_checkback (refuse or do nothing while closed for that patient)']
 where key = 'symptom_checker_enabled'
   and not (enforced_in @> array['schedule_symptom_checkback, symptom_checkback_sweep (open, nudge) and answer_symptom_checkback (refuse or do nothing while closed for that patient)']);

-- ---------------------------------------------------------------------------
-- 10. Self-checks
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Describe-it danger wording (OQ-S59c-05, founder decision): the device screened the typed words and found danger wording. The words are never sent.
-- This records ONLY the fact (a coarse code 'danger' or 'self_harm', the patient and the time) on the existing emergency path.
--   * doctor_alerted is true ONLY if a clinician alert was really raised. A plan without doctor time gets the emergency event and the Free guidance
--     record (private.open_free_red_event) but no human is paged, and the screen must not say otherwise.
--   * suppress_contact_notify = true: the emergency path would otherwise message the person's emergency contact ten minutes later
--     (private.notify_unacknowledged_emergencies -> alert_emergency_contact_copies). A typed self-harm or danger phrase must not reach anyone outside
--     the care team unless the person chooses it, so the contact notice is switched off for this event (the existing carve-out column).
--   * acting for someone else: the web action refuses before calling (the cookie is not visible here); auth.uid() is always the caller.
--   * rate limit: one event per person per danger_event_min_gap_minutes (PROPOSED, in the describe config) and once per session key; a repeat
--     inside the window raises nothing new and says what the first one did. Needs the describe config signed (no signed config, the box does not
--     exist, so the answer is recorded=false / not_enabled).
-- It never raises to the caller for a storage failure: that is audited, opens a sev3 incident and answers recorded=false, so the screen makes no
-- promise and the on-screen guidance is never blocked. The emergency path runs whatever the plan; closed means closed (INV-14).
-- ---------------------------------------------------------------------------
create index audit_log_describe_danger_idx on public.audit_log (actor_id, created_at desc) where action = 'symptom_describe.danger';

create function public.record_describe_danger(p_session uuid, p_category text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid; v_ee uuid; v_alert uuid; v_prev record; v_gap integer; v_cfg public.symptom_ux_config;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_session is null or p_category is null or p_category not in ('danger', 'self_harm') then raise exception 'bad request' using errcode = '22023'; end if;
  begin
    select organisation_id into v_org from public.profiles where id = v_uid;
    if v_org is null then raise exception 'no organisation'; end if;
    if not private.go_live_open_patient('symptom_checker_enabled', v_uid) then
      return jsonb_build_object('recorded', false, 'doctor_alerted', false, 'reason', 'closed');
    end if;
    v_cfg := private.symptom_ux_active('describe');
    if v_cfg.id is null then
      return jsonb_build_object('recorded', false, 'doctor_alerted', false, 'reason', 'not_enabled');
    end if;
    v_gap := (v_cfg.rules ->> 'danger_event_min_gap_minutes')::integer;
    perform pg_advisory_xact_lock(hashtextextended('describe_danger:' || v_uid::text, 0));
    select a.event, a.created_at into v_prev from public.audit_log a
     where a.action = 'symptom_describe.danger' and a.actor_id = v_uid
       and (a.event ->> 'session' = p_session::text or a.created_at > now() - make_interval(mins => v_gap))
     order by a.created_at desc limit 1;
    if found then
      return jsonb_build_object('recorded', true, 'repeat', true, 'doctor_alerted', coalesce((v_prev.event ->> 'doctor_alerted')::boolean, false));
    end if;
    insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status, suppress_contact_notify)
    values (v_org, v_uid, 'symptom_triage', 'Danger wording was detected in the describe-it box (' || p_category || '). No text was kept.', 'active', true)
    returning id into v_ee;
    select clinician_alert_id into v_alert from public.emergency_events where id = v_ee;
    if v_alert is null and private.patient_may_page_doctor(v_uid) then
      v_alert := private.raise_clinician_alert(v_org, v_uid, 'emergency'::public.alert_level,
        'Priority 1: danger wording in the symptom describe box', 'The person typed wording that matched an emergency screen. Their words were not kept. Please contact them.', 'clinical', 'symptom_escalation');
    end if;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_org, v_uid, 'symptom_describe.danger', 'emergency_event', v_ee,
            jsonb_build_object('session', p_session, 'category', p_category, 'doctor_alerted', v_alert is not null));
    return jsonb_build_object('recorded', true, 'repeat', false, 'doctor_alerted', v_alert is not null);
  exception when others then
    begin
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (v_org, v_uid, 'symptom_describe.error', 'symptom_describe', p_session, jsonb_build_object('error', left(sqlerrm, 300)));
    exception when others then null;
    end;
    begin
      perform private.page_incident_sev(null, 'symptom_checkbacks', 'sev3', 'A danger phrase in the describe box could not be recorded',
        'The person was shown emergency guidance on screen. The care team was NOT told. See audit_log action symptom_describe.error.');
    exception when others then null;
    end;
    return jsonb_build_object('recorded', false, 'doctor_alerted', false, 'reason', 'error');
  end;
end $$;
revoke all on function public.record_describe_danger(uuid, text) from public, anon;
grant execute on function public.record_describe_danger(uuid, text) to authenticated;

do $$
declare v_fn text;
begin
  if exists (select 1 from public.symptom_ux_config where is_active or approved_at is not null) then raise exception 'FAIL: a symptom ux config was born signed or active'; end if;
  if (select count(*) from public.symptom_ux_config where version = 1) <> 4 then raise exception 'FAIL: the four draft configs were not seeded'; end if;
  if exists (select 1 from public.symptom_ux_config where rules ->> 'status' <> 'draft' or jsonb_typeof(rules -> 'clinical_sign_off') <> 'null') then raise exception 'FAIL: a seed is not in its draft form'; end if;
  if (select is_on from public.go_live_guards where key = 'symptom_checker_enabled') then raise exception 'FAIL: the checker guard is on'; end if;
  if has_table_privilege('anon', 'public.symptom_checkbacks', 'SELECT') or has_table_privilege('authenticated', 'public.symptom_checkbacks', 'INSERT')
     or has_table_privilege('authenticated', 'public.symptom_checkbacks', 'UPDATE') or has_table_privilege('authenticated', 'public.symptom_checkbacks', 'DELETE') then
    raise exception 'FAIL: wrong table privileges on symptom_checkbacks';
  end if;
  if has_table_privilege('anon', 'public.symptom_ux_config', 'SELECT') or has_table_privilege('authenticated', 'public.symptom_ux_config', 'INSERT')
     or has_table_privilege('authenticated', 'public.symptom_ux_config', 'UPDATE') then
    raise exception 'FAIL: wrong table privileges on symptom_ux_config';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'symptom_checkbacks' and (qual ilike '%is_org_staff%' or with_check ilike '%is_org_staff%')) then
    raise exception 'FAIL: a staff-wide policy exists on symptom_checkbacks';
  end if;
  foreach v_fn in array array['public.answer_symptom_checkback(uuid,text,text,text[],text)', 'public.my_symptom_checkback(uuid)', 'public.read_symptom_checkback_audited(uuid,text)',
                              'public.sign_symptom_ux_config(text,integer)', 'public.symptom_ux_active_config(text)', 'public.record_describe_danger(uuid,text)', 'private.symptom_checkback_sweep()', 'private.schedule_symptom_checkback(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'FAIL: anon can execute %', v_fn; end if;
  end loop;
  if has_function_privilege('authenticated', 'private.symptom_checkback_sweep()', 'EXECUTE') then raise exception 'FAIL: authenticated can run the sweep'; end if;
  if not exists (select 1 from cron.job where jobname = 'symptom-checkback-sweep') then raise exception 'FAIL: the sweep is not scheduled'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.symptom_triage_assessments'::regclass and tgname = 'symptom_triage_assessments_90_schedule_checkback') then
    raise exception 'FAIL: the scheduling trigger is missing';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.symptom_ux_config'::regclass and tgname = 'symptom_ux_config_refuse_superseded' and not tgisinternal) <> 1 then
    raise exception 'FAIL: the superseded-version guard is missing';
  end if;
end $$;
