-- Tarragon Health — private.handle_symptom_red_flag raises an alert and
-- notifies nobody. The sixth instance of the same paging gap.
--
-- 2026-09-05, earlier this session: the abnormal-result Edge Function and
-- then the five DB red-flag handlers
-- (20260905005842_red_flag_handlers_page_clinicians_who_have_no_phone.sql)
-- were fixed to stop filtering their clinician recipients on
-- `phone is not null`, which had reduced every one of their recipient loops
-- to zero rows.
--
-- private.handle_symptom_red_flag reaches the same end state by a different
-- route: it has NO recipient loop and NO call to
-- private.enqueue_critical_notification at all. Confirmed against
-- koiplnmbgnqnbywhpjlf with pg_get_functiondef — the string
-- 'enqueue_critical_notification' does not appear in its body, and its only
-- `from public.profiles` is the date-of-birth lookup used for the paediatric
-- age test. It inserts its clinician_alerts row and returns.
--
-- Measured, in a rolled-back transaction against live, before this migration:
--
--   child aged 2, 'poor_feeding' severity 5, entitled
--     -> is_red_flag = true, 1 open clinician_alerts row, 0 notifications
--   adult, 'chest_pain' severity 7, entitled
--     -> is_red_flag = true, 1 open clinician_alerts row, 0 notifications
--   adult, 'chest_pain' severity 9, NOT entitled (Free)
--     -> 0 clinician_alerts rows, 1 in_app self-care suggestion
--
-- So a parent logging a severity-5 'poor feeding' or 'lethargy' for a
-- 2-year-old produces a Priority 1 alert on a dashboard that nobody is told
-- to look at. There are 7 clinician profiles in the organisation and each of
-- them should have been paged.
--
-- WHAT CHANGES
-- The body below is the live definition (pg_get_functiondef, 2026-09-05)
-- with only these additions:
--   * `returning id into v_alert_id` on each of the two clinician_alerts
--     inserts, so the notification can carry source_table/source_id like
--     every sibling handler's does;
--   * v_alert_lvl / v_level_label set alongside each insert;
--   * the recipient loop and enqueue_critical_notification call at the end,
--     copied from private.handle_bp_reading_red_flag as fixed in
--     20260905005842 — deliberately with NO `and phone is not null`, for the
--     reason that migration sets out at length: the first hop for this
--     pathway is 'push', which needs no phone, and a later whatsapp/sms hop
--     that does need one is already failed per-hop by
--     send-pending-notifications.
--
-- NOTHING CLINICAL CHANGES. new.is_red_flag and its three thresholds
-- (severity >= 8; >= 6 for a low-threshold type; >= 4 for a paediatric type
-- in a child under 5) are untouched, as are both alert titles, both detail
-- strings, both sla_due_at expressions, the
-- patient_has_feature_access('vitals_red_flag_doctor_escalation') plan gate
-- that decides whether a clinician alert is raised at all, and both Free-tier
-- raise_dangerous_reading_ai_suggestion calls. The only difference is that an
-- alert that was already being raised now also reaches a human.
--
-- BOTH TIERS PAGE, because both are already raised as alerts and both are
-- already registered with their own channel_sequence in the signed config
-- (see below). This matches the sibling handlers exactly: handle_bp_reading_
-- red_flag pages on its AMBER/clinician_review branch as well as its RED one.
--
-- THE LANDMINE 20260905005842 HIT, AND WHY THIS CANNOT HIT IT
-- Removing the phone predicate from handle_pulse_reading_red_flag would have
-- aborted the whole vitals_readings INSERT, because 'pulse_vitals_red_flag'
-- is unregistered in escalation_slas and private.escalation_channel_sequence
-- RAISES for an unregistered pathway. Two independent reasons that failure
-- mode is unreachable here:
--
--   1. 'symptom_red_flag' IS registered in the ACTIVE, SIGNED config
--      (v7, approved_at 2026-09-04 21:27:18Z), for both tiers:
--        urgent_escalation  240 min, channel_sequence ["push","whatsapp_nudge"]
--        clinician_review  4320 min, channel_sequence ["push, batched"]
--      Both normalise to a first hop of 'push'. No draft is added by this
--      migration and no signed clinical config is altered or activated —
--      there is nothing to register.
--   2. Even if it were unregistered, enqueue_critical_notification now calls
--      private.escalation_channel_sequence_or_null (20260905005842) and
--      degrades to a default sequence with a warning rather than raising.
--
-- Note also that this function ALREADY calls
-- private.escalation_sla_minutes('symptom_red_flag', ...) — which does still
-- raise for an unregistered pathway — inside both alert inserts. That call is
-- unchanged and predates this migration, so registration was already
-- load-bearing for symptom logging; this migration adds no new dependency on
-- it. The assertion block at the end proves the registration rather than
-- assuming it.
--
-- TEMPLATE CHOICE. 'vitals_red_flag_clinician_alert' is reused rather than a
-- new key being minted: it is active in public.notification_templates,
-- audience 'clinician', category 'clinical', priority 'critical', it has a
-- live renderer in send-pending-notifications, and its Meta template name is
-- already approved — a new key would need Meta approval, which is externally
-- blocked, and an Edge Function redeploy. Its rendered body is
-- "<level_label>: <patient_name>'s <vital_label> needs review", which carries
-- a symptom alert as readily as a BP one. vital_label is the deliberately
-- non-specific 'reported symptom' rather than the symptom name: hop 1 is
-- push, but a later hop can be whatsapp/sms, and the symptom itself belongs
-- in the clinician_alerts detail (where it already is) rather than on an open
-- rail. The catalogue description is corrected below to say the template now
-- also covers symptoms.


create or replace function private.handle_symptom_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_low_threshold_types public.symptom_type[] := array[
    'breathlessness', 'palpitations', 'swelling',
    'chest_pain', 'severe_headache', 'visual_disturbance', 'confusion'
  ];
  v_paediatric_types public.symptom_type[] := array[
    'poor_feeding', 'lethargy', 'grunting_or_retractions', 'dehydration_signs'
  ];
  v_dob date;
  v_age_years integer;
  v_is_red_flag boolean;
  v_has_escalation_access boolean;
  v_alert_id uuid;
  v_alert_lvl public.alert_level;
  v_level_label text;
  v_should_page boolean := false;
  r public.profiles%rowtype;
begin
  select date_of_birth into v_dob from public.profiles where id = new.patient_id;
  if v_dob is not null then
    v_age_years := extract(year from age(new.reported_at::date, v_dob));
  end if;

  v_is_red_flag := (
    new.severity >= 8
    or (new.symptom_type = any (v_low_threshold_types) and new.severity >= 6)
    or (v_age_years is not null and v_age_years < 5
        and new.symptom_type = any (v_paediatric_types) and new.severity >= 4)
  );
  new.is_red_flag := v_is_red_flag;

  if v_is_red_flag then
    v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');
    if v_has_escalation_access then
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at)
      values (
        new.organisation_id,
        new.patient_id,
        'urgent_escalation',
        'open',
        format('Priority 1: red-flag symptom (%s)', new.symptom_type),
        format('Patient reported %s at severity %s/10.%s',
               new.symptom_type, new.severity,
               case when new.description is not null then ' Note: ' || new.description else '' end),
        now() + (private.escalation_sla_minutes('symptom_red_flag', 'urgent_escalation') * interval '1 minute')
      )
      returning id into v_alert_id;
      v_alert_lvl := 'urgent_escalation';
      v_level_label := 'Priority 1';
      v_should_page := true;
    else
      perform private.raise_dangerous_reading_ai_suggestion(
        new.organisation_id, new.patient_id, replace(new.symptom_type::text, '_', ' '), 'Needs prompt attention',
        format('You reported %s at a high severity. This is described in our emergency guidance as needing prompt in-person care — please go to the nearest hospital if it does not settle quickly.', new.symptom_type)
      );
    end if;
  elsif new.severity >= 5 then
    v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');
    if v_has_escalation_access then
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at)
      values (
        new.organisation_id,
        new.patient_id,
        'clinician_review',
        'open',
        format('Symptom check: %s', new.symptom_type),
        format('Patient reported %s at severity %s/10.%s',
               new.symptom_type, new.severity,
               case when new.description is not null then ' Note: ' || new.description else '' end),
        now() + (private.escalation_sla_minutes('symptom_red_flag', 'clinician_review') * interval '1 minute')
      )
      returning id into v_alert_id;
      v_alert_lvl := 'clinician_review';
      v_level_label := 'Review needed';
      v_should_page := true;
    else
      perform private.raise_dangerous_reading_ai_suggestion(
        new.organisation_id, new.patient_id, replace(new.symptom_type::text, '_', ' '), 'Review needed',
        format('You reported %s at a moderate severity. Keep an eye on it and note if it changes; if it persists beyond a day or two, or gets worse, please seek in-person care.', new.symptom_type)
      );
    end if;
  end if;

  if v_should_page then
    -- New. Everything above this point is the live body. Deliberately NO
    -- phone predicate on this recipient query: hop 1 for symptom_red_flag is
    -- push on both tiers, and a later whatsapp/sms hop that does need a phone
    -- is failed per-hop by send-pending-notifications rather than by dropping
    -- the recipient here. See 20260905005842 for the full argument.
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician'
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'reported symptom',
          'level_label', v_level_label
        ),
        'symptom_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$$;


-- The catalogue row said this template covered "BP/SpO2/temperature". It has
-- covered pulse since 20260829140000 and now covers symptoms too. Description
-- only — key, category, priority, audience, channels and approval state are
-- all untouched.
update public.notification_templates
   set description = 'Red-flag needing clinician review: a RED/AMBER vital (BP/SpO2/temperature/pulse) or a patient-logged red-flag symptom.',
       updated_at = now()
 where key = 'vitals_red_flag_clinician_alert'
   and description is distinct from 'Red-flag needing clinician review: a RED/AMBER vital (BP/SpO2/temperature/pulse) or a patient-logged red-flag symptom.';


-- ---------------------------------------------------------------------------
-- Assertions — the migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_src text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'handle_symptom_red_flag';
  if v_src is null then
    raise exception 'FAIL: private.handle_symptom_red_flag does not exist';
  end if;

  -- the gap this migration exists to close
  if v_src !~ 'enqueue_critical_notification' then
    raise exception 'FAIL: handle_symptom_red_flag still never enqueues a notification — it pages nobody';
  end if;
  if v_src !~ 'role\s*=\s*''clinician''' then
    raise exception 'FAIL: handle_symptom_red_flag has no clinician recipient loop';
  end if;
  -- must not reintroduce the defect fixed in 20260905005842
  -- Same regex 20260905005842's own test uses: matches the recipient query,
  -- not prose. (prosrc includes comments, so a looser pattern matches the
  -- explanatory comment inside the function and fails vacuously.)
  if v_src ~ 'role\s*=\s*''clinician''\s*and\s*phone\s+is\s+not\s+null' then
    raise exception 'FAIL: handle_symptom_red_flag filters recipients on a phone number; 0 of 7 clinicians have one';
  end if;

  -- preserved behaviour
  if v_src !~ 'v_paediatric_types' then
    raise exception 'FAIL: the paediatric red-flag branch was lost';
  end if;
  if v_src !~ 'patient_has_feature_access' then
    raise exception 'FAIL: the Free-tier plan gate was lost';
  end if;
  if v_src !~ 'raise_dangerous_reading_ai_suggestion' then
    raise exception 'FAIL: the Free-tier self-care path was lost';
  end if;
  if v_src !~ 'new\.severity\s*>=\s*8' or v_src !~ 'new\.severity\s*>=\s*6'
     or v_src !~ 'new\.severity\s*>=\s*4' or v_src !~ 'new\.severity\s*>=\s*5' then
    raise exception 'FAIL: a red-flag severity threshold changed';
  end if;
  if v_src !~ 'new\.is_red_flag\s*:=\s*v_is_red_flag' then
    raise exception 'FAIL: new.is_red_flag is no longer set from the threshold test';
  end if;

  -- the abort landmine: both tiers must be registered in the ACTIVE config,
  -- because this function already calls the fail-loud escalation_sla_minutes
  -- for both of them inside the alert inserts.
  if not exists (
    select 1 from public.escalation_slas c, jsonb_array_elements(c.config) e
     where c.is_active and e->>'pathway' = 'symptom_red_flag'
       and e->>'tier' = 'urgent_escalation'
  ) then
    raise exception 'FAIL: symptom_red_flag/urgent_escalation is not in the active escalation_slas config';
  end if;
  if not exists (
    select 1 from public.escalation_slas c, jsonb_array_elements(c.config) e
     where c.is_active and e->>'pathway' = 'symptom_red_flag'
       and e->>'tier' = 'clinician_review'
  ) then
    raise exception 'FAIL: symptom_red_flag/clinician_review is not in the active escalation_slas config';
  end if;

  -- and the channel this actually pages on must not need a phone
  if (private.normalize_escalation_channels(
        private.escalation_channel_sequence_or_null('symptom_red_flag', 'urgent_escalation')))[1]::text is distinct from 'push' then
    raise exception 'FAIL: the first hop for symptom_red_flag/urgent_escalation is not push';
  end if;
  if (private.normalize_escalation_channels(
        private.escalation_channel_sequence_or_null('symptom_red_flag', 'clinician_review')))[1]::text is distinct from 'push' then
    raise exception 'FAIL: the first hop for symptom_red_flag/clinician_review is not push';
  end if;

  raise notice 'OK: handle_symptom_red_flag now pages every clinician in the organisation on push, both tiers, with no phone filter and no clinical change';
end $$;
