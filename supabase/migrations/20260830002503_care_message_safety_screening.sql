-- Health Communication Engine — message escalation (17.12, part 2).
--
--   Patient message -> Safety screening -> Potential urgent concern -> Appropriate urgent pathway
--
-- care_messages has never had any safety screening — a patient describing
-- chest pain or a self-harm intent in a care-team message today sits in the
-- normal thread exactly like "when is my next refill", with no structural
-- guarantee anyone reads it promptly (17.11: a patient must not be able to
-- mistake this channel for a monitored emergency line — see the companion
-- UI change adding that notice to the composer). This adds a deterministic
-- keyword screen, AFTER INSERT on care_messages, for patient- and
-- sponsor-authored messages only (a care-team reply is the clinician's own
-- text, not a new patient-reported signal). "Deterministic" is the point,
-- not a limitation: the spec is explicit that "AI should not be the sole
-- mechanism for deciding whether an emergency exists" — this uses no AI at
-- all, just a fixed phrase list, exactly like every other red-flag
-- detector on this platform (bp_red_flag_engine, spo2_red_flag_engine,
-- private.handle_symptom_red_flag, ...). A match NEVER auto-resolves,
-- auto-diagnoses, or blocks the message from reaching the thread normally
-- — it only ADDS a clinician_alerts row and a proactive page, on top of
-- the message's normal delivery. Over-triggering (a false positive costs a
-- clinician two minutes; under-triggering costs a patient's safety) is the
-- deliberately-accepted failure mode, same posture as every threshold-based
-- red-flag engine already in this codebase.
alter table public.care_messages
  add column flagged_potential_emergency boolean not null default false,
  add column flagged_alert_id uuid references public.clinician_alerts (id) on delete set null;

comment on column public.care_messages.flagged_potential_emergency is
  'Set by private.screen_care_message_for_emergency() when the message body matched the deterministic danger-phrase screen. Never set by the client.';
comment on column public.care_messages.flagged_alert_id is
  'The clinician_alerts row this message''s safety flag raised, if any.';

-- Deterministic phrase screen. Plain, lowercase substring matching — no
-- external call, no model, nothing that can be down or rate-limited. The
-- list intentionally errs toward common lay phrasing a Nigerian patient
-- would actually type, not clinical terminology (see chest_pain/severe_
-- headache/etc symptom_types in condition_protocols'' red_flags text for
-- the clinical grounding this list is drawn from), and is short and
-- reviewable on purpose — a long, clever list is harder for a future
-- reader to audit than a short, obvious one.
create or replace function private.screen_care_message_for_emergency(p_body text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_agg(phrase)
  from unnest(array[
    'chest pain', 'can''t breathe', 'cannot breathe', 'difficulty breathing', 'struggling to breathe',
    'unconscious', 'unresponsive', 'passed out', 'collapsed',
    'suicide', 'suicidal', 'kill myself', 'end my life', 'want to die', 'self harm', 'self-harm',
    'severe bleeding', 'bleeding heavily', 'won''t stop bleeding',
    'seizure', 'convulsion', 'convulsing', 'fitting',
    'stroke', 'face drooping', 'slurred speech', 'one side weak', 'can''t move my',
    'overdose', 'took too many', 'poisoned', 'swallowed',
    'severe allergic reaction', 'throat closing', 'can''t swallow',
    'blue lips', 'turning blue', 'not breathing', 'baby not breathing', 'baby not moving'
  ]) as phrase
  where lower(coalesce(p_body, '')) like '%' || phrase || '%';
$$;

comment on function private.screen_care_message_for_emergency(text) is
  '17.12 deterministic safety screen. Returns the matched phrase(s) (empty/null array = no match). Case-insensitive substring matching only — no AI, no external call. Over-triggering is the accepted, deliberate failure mode.';

create or replace function private.after_care_message_insert_safety_screen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matches text[];
  v_alert_id uuid;
  v_recipient uuid;
  v_notified boolean := false;
begin
  if new.author_role not in ('patient', 'sponsor') then
    return new;
  end if;

  v_matches := private.screen_care_message_for_emergency(new.body);
  if v_matches is null or array_length(v_matches, 1) is null then
    return new;
  end if;

  v_alert_id := private.raise_clinician_alert(
    new.organisation_id,
    new.patient_id,
    'emergency',
    'Priority 1: potential emergency in a care message',
    format(
      'A care-team message matched the safety screen on: %s.%s This is an automated keyword flag, not a diagnosis — read the full message in the thread and assess. Message excerpt: "%s"',
      array_to_string(v_matches, ', '),
      case when new.author_role = 'sponsor' then ' (sent by a supporter, not the patient directly.)' else '' end,
      left(new.body, 500)
    ),
    'clinical',
    'message_safety_flag'
  );

  update public.care_messages
  set flagged_potential_emergency = true, flagged_alert_id = v_alert_id
  where id = new.id;

  -- Proactively page whoever classify_and_assign_clinician_alert just
  -- auto-assigned as owner (governed by alert_rules' message_safety_flag
  -- entry, added below) — never rely solely on the passive worklist or the
  -- ack-timeout sweep for a same-severity-as-emergency_events signal.
  -- Falls back to every org admin if no owner could be assigned (e.g. no
  -- active tier_2 clinician exists yet), so this is never silently unpaged.
  select p.id into v_recipient
  from public.clinician_alerts ca
  join public.clinical_staff cs on cs.id = ca.responsible_clinician_id
  join public.profiles p on p.id = cs.profile_id
  where ca.id = v_alert_id;

  if v_recipient is not null then
    perform private.notify_clinician_alert(
      v_alert_id, v_recipient, 'care_message_safety_flag',
      jsonb_build_object('thread_id', new.thread_id::text, 'matched_phrases', v_matches)
    );
    v_notified := true;
  end if;

  if not v_notified then
    for v_recipient in select id from public.profiles where role = 'admin' loop
      perform private.notify_clinician_alert(
        v_alert_id, v_recipient, 'care_message_safety_flag',
        jsonb_build_object('thread_id', new.thread_id::text, 'matched_phrases', v_matches)
      );
    end loop;
  end if;

  return new;
end;
$$;

comment on function private.after_care_message_insert_safety_screen() is
  'AFTER INSERT on care_messages, deliberately separate from private.after_care_message_insert() (unchanged) to keep this additive and independently revertable. Patient/sponsor messages only. On a match: raises a clinician_alerts row (emergency level, type_code=message_safety_flag) and proactively pages its auto-assigned owner (or every admin if none could be assigned) via private.notify_clinician_alert — never waits on the passive worklist or the ack-timeout ladder for a signal this urgent.';

drop trigger if exists care_messages_safety_screen on public.care_messages;
create trigger care_messages_safety_screen
  after insert on public.care_messages
  for each row execute function private.after_care_message_insert_safety_screen();

revoke all on function private.screen_care_message_for_emergency(text) from public, anon;
revoke all on function private.after_care_message_insert_safety_screen() from public, anon;

-- Governance: extend the alert_rules ledger with message_safety_flag's
-- ownership/routing policy, mirroring symptom_escalation's existing policy
-- (same class of signal: a patient-self-reported danger indicator). Built
-- programmatically from the current active config rather than
-- hand-retyping the other 16 entries, to make transcription of any of them
-- structurally impossible. Ships active-but-unsigned, same posture v1
-- itself shipped in (20260828013011) — flagged for Clinical Director
-- review via the existing public.sign_alert_rules().
do $$
declare
  v_new_version integer;
begin
  insert into public.alert_rules (version, config, notes, is_active, approved_by, approved_at)
  select
    version + 1,
    config || jsonb_build_array(
      jsonb_build_object(
        'category', 'clinical',
        'type_code', 'message_safety_flag',
        'default_severity', 4,
        'severity_meaning', 'Emergency: a patient (or their supporter) sent a care-team message matching the deterministic danger-phrase safety screen and needs urgent human review. The screen only routes — it never resolves or diagnoses.',
        'evidence_basis', 'New: private.screen_care_message_for_emergency() on public.care_messages (17.12). Owner/backup/channel policy mirrors symptom_escalation, the existing type for the same class of patient-self-reported danger signal.',
        'owner_tier', 'tier_2',
        'backup_tier', 'tier_3',
        'senior_tier', 'tier_4_senior_registrar',
        'ack_timeout_minutes', 15,
        'channel_sequence', jsonb_build_array('in_app', 'push', 'whatsapp', 'sms'),
        'auto_suppress_duplicates', false,
        'suppress_window_minutes', null,
        'effective_date', null,
        'review_date', null
      )
    ),
    'v2: adds message_safety_flag (17.12 care-message safety screening) to v1''s 16 entries, otherwise unchanged. Active-but-unsigned, same posture v1 shipped in — flagged for Clinical Director review/sign-off via public.sign_alert_rules().',
    true,
    null,
    null
  from public.alert_rules
  where is_active
  returning version into v_new_version;

  update public.alert_rules set is_active = false
  where is_active and version is distinct from v_new_version;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'care_messages_safety_screen' and tgrelid = 'public.care_messages'::regclass and not tgisinternal) then
    raise exception 'FAIL: care_messages_safety_screen trigger was not created';
  end if;
  if (select jsonb_array_length(config) from public.alert_rules where is_active) <> 17 then
    raise exception 'FAIL: active alert_rules config does not have 17 entries after adding message_safety_flag';
  end if;
  if (select count(*) from public.alert_rules where is_active) <> 1 then
    raise exception 'FAIL: more than one active alert_rules version';
  end if;
  if has_function_privilege('anon', 'private.screen_care_message_for_emergency(text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute screen_care_message_for_emergency';
  end if;
end $$;
