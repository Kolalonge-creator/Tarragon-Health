-- Tarragon Health — v3 port: escalation SLA table (data, not code)
--
-- v3 build spec §9.4: "Seeded into ... an escalation_slas config table ...
-- This table is the medico-legal defence and the first artefact an HMO's
-- clinical governance reviewer will request — build it before the code that
-- reads it." CLAUDE.md's pivot-reversal banner lists this among the v3
-- disciplines to port into the platform.
--
-- Audit before writing anything (same discipline as the I1 port's template
-- audit): read every live trigger/cron function that computes
-- clinician_alerts.sla_due_at. Found 8 functions, 12 distinct
-- (pathway, tier) SLA commitments — and a real, live inconsistency: the
-- SAME alert_level enum value carries THREE different SLA meanings
-- depending which function wrote it:
--   - 'urgent_escalation': 24h (screening_abnormal_result) vs 1h
--     (bp_vitals_red_flag, lpe_red_flag, obesity_ed_screen) vs 4h
--     (diabetic_foot_check).
--   - 'emergency': 2h (screening_abnormal_result, emergency_event) vs
--     15min (lpe_red_flag, obesity_ed_screen).
-- This is exactly what a config-not-code table is meant to make visible
-- and auditable. This migration does NOT reconcile these numbers — that is
-- a clinical-safety judgment call across genuinely different care pathways,
-- not an engineering refactor, and is flagged for Clinical Director review
-- via the new admin page rather than decided here. v1 is a faithful,
-- zero-behaviour-change transcription of what is live in production today.

create table public.escalation_slas (
  id            uuid primary key default gen_random_uuid(),
  version       integer not null,
  config        jsonb not null,
  notes         text,
  approved_by   uuid references public.clinical_staff (id),
  approved_at   timestamptz,
  is_active     boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.escalation_slas enable row level security;

create policy escalation_slas_select on public.escalation_slas
  for select
  to authenticated
  using (true);

-- Mirrors vaccination_schedule_signoffs_insert exactly: any authenticated
-- caller may propose a new inactive, unsigned draft version; only the
-- sign_escalation_slas() RPC (Clinical-Director-gated) may activate/sign one.
create policy escalation_slas_insert on public.escalation_slas
  for insert
  to authenticated
  with check (
    private.is_admin()
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

grant select, insert on public.escalation_slas to authenticated;

-- ---------------------------------------------------------------------------
-- Lookup helper — the single place every trigger now reads an SLA from.
-- Fails LOUD (raises) rather than silently returning null on an unknown
-- (pathway, tier): a missing SLA on a real clinical alert is a worse failure
-- mode than a blocked insert, matching this codebase's fail-closed
-- discipline elsewhere (I5, I1).
-- ---------------------------------------------------------------------------
create or replace function private.escalation_sla_minutes(p_pathway text, p_tier public.alert_level)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_minutes integer;
begin
  select (entry->>'sla_minutes')::integer
    into v_minutes
    from public.escalation_slas c,
         jsonb_array_elements(c.config) as entry
    where c.is_active
      and entry->>'pathway' = p_pathway
      and entry->>'tier' = p_tier::text
    limit 1;

  if v_minutes is null then
    raise exception 'No active escalation SLA configured for pathway=% tier=%', p_pathway, p_tier;
  end if;

  return v_minutes;
end;
$$;

revoke all on function private.escalation_sla_minutes(text, public.alert_level) from public, anon;

-- ---------------------------------------------------------------------------
-- Seed v1 — transcribed from the 8 live functions below, zero values changed.
-- Inserted directly (this migration runs with elevated privileges, not
-- through the authenticated-role RLS path) so the lookup succeeds the
-- instant this migration completes; is_active=true from the start since the
-- trigger rewrites below depend on a resolvable config existing immediately,
-- unlike vaccination_schedule_signoffs where the downstream reminder cron
-- was deliberately left unwired pending signature. Deliberately UNSIGNED
-- (approved_by/approved_at null) — a faithful transcription is not the same
-- thing as a Director's clinical attestation; see the admin review page.
-- ---------------------------------------------------------------------------
insert into public.escalation_slas (version, config, notes, is_active)
values (
  1,
  '[
    {"pathway": "screening_abnormal_result", "tier": "emergency", "sla_minutes": 120, "channel_sequence": ["push", "whatsapp", "sms"], "source_function": "private.handle_abnormal_screening_result", "note": "Critical screening result (e.g. critical BP/glucose flag, positive sensitive result)."},
    {"pathway": "screening_abnormal_result", "tier": "urgent_escalation", "sla_minutes": 1440, "channel_sequence": ["push", "whatsapp_nudge"], "source_function": "private.handle_abnormal_screening_result", "note": "Abnormal (non-critical) screening result."},
    {"pathway": "bp_vitals_red_flag", "tier": "urgent_escalation", "sla_minutes": 60, "channel_sequence": ["push", "whatsapp_nudge"], "source_function": "private.handle_bp_reading_red_flag", "note": "Red-range home BP reading."},
    {"pathway": "bp_vitals_red_flag", "tier": "clinician_review", "sla_minutes": 4320, "channel_sequence": ["push, batched"], "source_function": "private.handle_bp_reading_red_flag", "note": "BP above target (amber)."},
    {"pathway": "emergency_event", "tier": "emergency", "sla_minutes": 120, "channel_sequence": ["push", "whatsapp", "sms", "next_of_kin_call_if_unacknowledged"], "source_function": "private.handle_emergency_event", "note": "Danger-symptom report, BP hypertensive-crisis reading, or other emergency_events row."},
    {"pathway": "diabetic_foot_check", "tier": "urgent_escalation", "sla_minutes": 240, "channel_sequence": ["push", "whatsapp_nudge"], "source_function": "private.handle_foot_self_check", "note": "Patient-reported foot problem on self-check."},
    {"pathway": "lpe_red_flag", "tier": "emergency", "sla_minutes": 15, "channel_sequence": ["push", "whatsapp", "sms"], "source_function": "private.handle_lpe_red_flag", "note": "Lifestyle Programme Engine safety rule, severity=emergency."},
    {"pathway": "lpe_red_flag", "tier": "urgent_escalation", "sla_minutes": 60, "channel_sequence": ["push", "whatsapp_nudge"], "source_function": "private.handle_lpe_red_flag", "note": "LPE safety rule, severity=red."},
    {"pathway": "lpe_red_flag", "tier": "clinician_review", "sla_minutes": 4320, "channel_sequence": ["push, batched"], "source_function": "private.handle_lpe_red_flag", "note": "LPE safety rule, severity=amber/other."},
    {"pathway": "obesity_ed_screen", "tier": "emergency", "sla_minutes": 15, "channel_sequence": ["push", "whatsapp", "sms"], "source_function": "private.handle_obesity_ed_screen", "note": "Positive ED/mental-health screen with self-harm risk."},
    {"pathway": "obesity_ed_screen", "tier": "urgent_escalation", "sla_minutes": 60, "channel_sequence": ["push", "whatsapp_nudge"], "source_function": "private.handle_obesity_ed_screen", "note": "Positive ED/mental-health screen, no self-harm risk."},
    {"pathway": "chronic_monitoring_silence", "tier": "clinician_review", "sla_minutes": 4320, "channel_sequence": ["push, batched"], "source_function": "private.flag_missing_glucose_logs, private.flag_overdue_vitals", "note": "\"Silence is not assumed safe\" checks — no recent glucose log / overdue BP reading despite reminders."},
    {"pathway": "general", "tier": "routine", "sla_minutes": 10080, "channel_sequence": ["push, batched digest"], "source_function": null, "note": "Reserved — no current trigger emits alert_level=routine. Seeded for parity with the v3 spec 4-tier table (docs/tarragon-build-spec-v3.md §9.4)."}
  ]'::jsonb,
  'v1 — as-transcribed baseline from live trigger code, 2026-07-30 v3 port. NO clinical values changed from what was already in production. Flagging for Clinical Director review: the enum value ''urgent_escalation'' carries THREE different live SLA meanings depending on origin (24h screening / 1h BP+LPE+obesity / 4h diabetic foot), and ''emergency'' carries TWO (2h screening+emergency_event / 15min LPE+obesity). Recommend deciding whether these should be reconciled to one number per tier (tightening only, never loosening) or kept genuinely pathway-specific — see docs/CLINICAL_TRUST_MODEL_SPEC.md §6''s three-tier Amber(24h)/Red(2h)/Emergency(immediate) table, which itself predates and does not cleanly map onto the 4 pathways added since.',
  true
);

-- ---------------------------------------------------------------------------
-- Sign / attest RPC — mirrors sign_vaccination_schedule() and
-- sign_cv_risk_config() exactly: active Clinical Director only, one active
-- version at a time, audit-logged.
-- ---------------------------------------------------------------------------
create or replace function public.sign_escalation_slas(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.escalation_slas where id = p_id) then
    raise exception 'Escalation SLA config version not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.is_clinical_director
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the escalation SLA config';
  end if;

  update public.escalation_slas set is_active = false
    where is_active and id <> p_id;

  update public.escalation_slas
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'escalation_slas.signed',
         'escalation_slas', p_id,
         jsonb_build_object('signed_by_clinical_staff', v_staff)
  from public.clinical_staff cs where cs.id = v_staff;

  return p_id;
end;
$$;

-- The anon-execute gotcha, corrected form (per this codebase's own
-- 2026-07-27 finding): revoking from anon is usually a no-op because anon
-- inherits EXECUTE via the PUBLIC pseudo-grant rather than a direct one —
-- but a from-scratch replay (this project's first, run 2026-08-27 by the
-- new CI migration-replay job) proved that assumption incomplete: whatever
-- sets up a fresh Supabase Postgres instance grants anon a DIRECT execute
-- default on new public-schema functions (scoped to schema `public` only —
-- private.escalation_sla_minutes above is unaffected), which a
-- public-only revoke does not remove. Revoke from both explicitly, then
-- grant back to authenticated.
revoke all on function public.sign_escalation_slas(uuid) from public, anon;
revoke all on function public.sign_escalation_slas(uuid) from anon;
grant execute on function public.sign_escalation_slas(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Rewire the 8 live functions — same signature, same behaviour, only the
-- hardcoded `v_sla := interval '...'` lines replaced with a config lookup.
-- Every other line is byte-identical to the live definition pulled from
-- pg_proc before writing this migration.
-- ---------------------------------------------------------------------------

create or replace function private.handle_abnormal_screening_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condition public.upgrade_condition := 'other';
  v_upgrade_id uuid;
  v_level public.alert_level;
  v_escalation_level smallint;
  v_sla interval;
  v_sensitive boolean := false;
begin
  if new.result_status not in ('abnormal', 'critical') then
    return new;
  end if;

  if new.abnormal_flags && array['bp', 'blood_pressure', 'hypertension'] then
    v_condition := 'hypertension';
  elsif new.abnormal_flags && array['glucose', 'hba1c', 'diabetes'] then
    v_condition := 'diabetes';
  elsif new.abnormal_flags && array['psa', 'cancer', 'mammography', 'cervical', 'fit'] then
    v_condition := 'cancer_referral';
  end if;

  -- Sensitive = the screened type is flagged sensitive in the catalogue
  -- (authoritative — works even when abnormal_flags is empty, as for a
  -- positive HIV/hep test), OR a cancer-family flag is present (fallback).
  if new.screen_type_code is not null then
    select coalesce(bool_or(st.sensitive), false)
      into v_sensitive
      from public.screen_types st
      where st.code = new.screen_type_code;
  end if;
  if not v_sensitive
     and new.abnormal_flags && array['hiv', 'hep_b', 'hep_c', 'psa', 'cancer', 'mammography', 'cervical', 'fit'] then
    v_sensitive := true;
  end if;

  if new.result_status = 'critical' then
    v_level := 'emergency';
    v_escalation_level := 4;
    v_sla := private.escalation_sla_minutes('screening_abnormal_result', 'emergency') * interval '1 minute';
  else
    v_level := 'urgent_escalation';
    v_escalation_level := 3;
    v_sla := private.escalation_sla_minutes('screening_abnormal_result', 'urgent_escalation') * interval '1 minute';
  end if;

  insert into public.screening_upgrades
    (organisation_id, patient_id, screening_result_id, condition_triggered)
  values
    (new.organisation_id, new.patient_id, new.id, v_condition)
  returning id into v_upgrade_id;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, screening_result_id, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    v_level,
    'open',
    'Priority 1: abnormal screening result',
    format('Screening result %s flagged %s; condition inferred: %s.',
           new.id, coalesce(array_to_string(new.abnormal_flags, ', '), 'none'), v_condition),
    now() + v_sla,
    new.id,
    v_escalation_level
  );

  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/abnormal-result-handler',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'screening_result_id', new.id,
      'screening_upgrade_id', v_upgrade_id,
      'organisation_id', new.organisation_id,
      'patient_id', new.patient_id,
      'condition', v_condition,
      'abnormal_flags', to_jsonb(new.abnormal_flags),
      'result_summary', new.result_summary,
      'sensitive', v_sensitive
    ),
    timeout_milliseconds := 8000
  );

  return new;
end;
$$;

create or replace function private.handle_bp_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level     text;
  v_alert_lvl public.alert_level;
  v_esc       smallint;
  v_sla       interval;
  v_title     text;
  v_detail    text;
  v_existing  public.clinician_alerts%rowtype;
  v_t_sys     smallint;
  v_t_dia     smallint;
  v_pregnant  boolean;
begin
  if new.vital_type <> 'blood_pressure' then
    return new;
  end if;

  update public.clinician_alerts
    set status = 'resolved', updated_at = now()
  where patient_id = new.patient_id
    and status = 'open'
    and title = 'Missing expected blood-pressure readings';

  v_level := private.classify_bp_level(new.systolic, new.diastolic);

  if v_level = 'green' and new.systolic is not null and new.diastolic is not null then
    select systolic, diastolic into v_t_sys, v_t_dia
    from private.patient_home_bp_target(new.patient_id);
    if new.systolic >= v_t_sys or new.diastolic >= v_t_dia then
      v_level := 'amber';
    end if;
  end if;

  select coalesce(p.is_pregnant, false) into v_pregnant from public.profiles p where p.id = new.patient_id;
  if v_pregnant and new.systolic is not null and new.diastolic is not null then
    if new.systolic >= 160 or new.diastolic >= 110 then
      v_level := 'emergency';
    elsif new.systolic >= 140 or new.diastolic >= 90 then
      if v_level not in ('emergency','red') then v_level := 'red'; end if;
    end if;
  end if;

  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('Home BP reading %s/%s mmHg logged %s.',
                     new.systolic, new.diastolic, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));
  if v_pregnant then
    v_detail := v_detail || ' PREGNANT — obstetric red route (§18.1); do not manage routinely on-platform.';
  end if;

  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id and e.source = 'bp_reading'
        and e.status = 'active' and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (new.organisation_id, new.patient_id, 'bp_reading',
        v_detail || case when v_pregnant then ' Possible pre-eclampsia — urgent obstetric care.' else ' This is in the hypertensive-crisis range.' end,
        'active', new.id);
    end if;
    return new;
  end if;

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3;
    v_sla := private.escalation_sla_minutes('bp_vitals_red_flag', 'urgent_escalation') * interval '1 minute';
    v_title := case when v_pregnant then 'Priority 1: raised BP in pregnancy' else 'Priority 1: high blood pressure reading' end;
    v_detail := v_detail || ' Please ask the patient to rest 5 minutes and re-check, then review same day.';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2;
    v_sla := private.escalation_sla_minutes('bp_vitals_red_flag', 'clinician_review') * interval '1 minute';
    v_title := 'Blood pressure above target';
    v_detail := v_detail || ' Above target — review adherence, technique, lifestyle and titration.';
  end if;

  select * into v_existing
  from public.clinician_alerts
  where patient_id = new.patient_id and vital_reading_id is not null and status = 'open'
  order by created_at desc limit 1;

  if v_existing.id is not null then
    if v_esc >= coalesce(v_existing.escalation_level, 0) then
      update public.clinician_alerts
        set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
            detail = v_detail, sla_due_at = now() + v_sla, vital_reading_id = new.id, updated_at = now()
      where id = v_existing.id;
    end if;
  else
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level, vital_reading_id)
    values (new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
      now() + v_sla, v_esc, new.id);
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (new.organisation_id, new.patient_id, 'bp_red_flag.raised', 'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'systolic', new.systolic, 'diastolic', new.diastolic, 'pregnant', v_pregnant));

  return new;
end;
$$;

create or replace function private.handle_emergency_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_c_name  text;
  v_c_rel   text;
  v_c_phone text;
  v_contact_line text := '';
begin
  -- Surface WHO the patient's emergency contact is (and their relationship) to
  -- the care team, so a doctor reviewing the Priority-1 alert knows who to
  -- expect / who was messaged. Read here (SECURITY DEFINER) from the patient's
  -- profile; omitted cleanly if no contact is on file.
  select emergency_contact_name, emergency_contact_relationship, emergency_contact_phone
    into v_c_name, v_c_rel, v_c_phone
  from public.profiles where id = new.patient_id;
  if v_c_phone is not null then
    v_contact_line := format(' Emergency contact: %s%s — %s.',
      coalesce(v_c_name, 'on file'),
      case when v_c_rel is not null then ' (' || v_c_rel || ')' else '' end,
      v_c_phone);
  end if;

  if new.clinician_alert_id is null then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
    values (
      new.organisation_id,
      new.patient_id,
      'emergency',
      'open',
      'Priority 1: emergency reported',
      format('Emergency event (source: %s).%s%s',
             new.source,
             case when new.trigger_detail is not null then ' ' || new.trigger_detail else '' end,
             v_contact_line),
      now() + (private.escalation_sla_minutes('emergency_event', 'emergency') * interval '1 minute'),
      4
    )
    returning id into v_alert_id;

    -- id is already populated (column default fires before BEFORE triggers).
    new.clinician_alert_id := v_alert_id;
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.patient_id,
    'emergency_event.created',
    'emergency_events',
    new.id,
    jsonb_build_object('source', new.source, 'clinician_alert_id', new.clinician_alert_id)
  );

  return new;
end;
$$;

create or replace function private.handle_foot_self_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
begin
  if new.any_problem then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
    values (
      new.organisation_id,
      new.patient_id,
      'urgent_escalation',
      'open',
      'Priority: diabetic foot problem reported',
      format('Patient reported a foot problem on self-check%s.%s Assess urgently — new ulcer, spreading redness, black tissue or fever is an emergency (§18.1).',
             case when array_length(new.findings, 1) is not null then ' (' || array_to_string(new.findings, ', ') || ')' else '' end,
             case when new.note is not null then ' Note: ' || new.note else '' end),
      now() + (private.escalation_sla_minutes('diabetic_foot_check', 'urgent_escalation') * interval '1 minute'),
      3
    )
    returning id into v_alert_id;
    new.clinician_alert_id := v_alert_id;
  end if;
  return new;
end;
$$;

create or replace function private.handle_lpe_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level  public.alert_level;
  v_sla    timestamptz;
  v_alert  uuid;
begin
  -- Map clinical severity → alert level + contact SLA (spec §9.2), now
  -- sourced from private.escalation_sla_minutes('lpe_red_flag', tier)
  -- instead of a hardcoded interval per tier.
  if new.severity = 'emergency' then
    v_level := 'emergency';
    v_sla := now() + (private.escalation_sla_minutes('lpe_red_flag', 'emergency') * interval '1 minute');
  elsif new.severity = 'red' then
    v_level := 'urgent_escalation';
    v_sla := now() + (private.escalation_sla_minutes('lpe_red_flag', 'urgent_escalation') * interval '1 minute');
  else
    v_level := 'clinician_review';
    v_sla := now() + (private.escalation_sla_minutes('lpe_red_flag', 'clinician_review') * interval '1 minute');
  end if;

  if new.clinician_alert_id is null then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
    values (
      new.organisation_id, new.patient_id, v_level, 'open',
      format('Lifestyle red flag (%s): %s', new.severity, new.rule_key),
      format('Rule %s fired for a logged reading. Action: %s.', new.rule_key, new.action),
      v_sla, new.escalation_level)
    returning id into v_alert;
    new.clinician_alert_id := v_alert;
  end if;

  -- ED / self-harm ⇒ pause weight-loss in the SAME transaction (spec §9.3).
  if new.action = 'auto_pause_weightloss' and new.enrollment_id is not null then
    update public.lpe_enrollments
      set status = 'paused',
          paused_reason = coalesce(paused_reason,
            'Auto-paused: safety flag ' || new.rule_key)
      where id = new.enrollment_id
        and status <> 'paused';
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'lpe_red_flag.opened',
    'lpe_red_flag_events', new.id,
    jsonb_build_object('rule_key', new.rule_key, 'severity', new.severity,
                       'action', new.action, 'clinician_alert_id', new.clinician_alert_id));

  return new;
end;
$$;

create or replace function private.handle_obesity_ed_screen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level public.alert_level;
  v_sla   timestamptz;
  v_esc   smallint;
  v_alert uuid;
begin
  if not new.positive then
    return new;
  end if;

  if new.self_harm_risk then
    v_level := 'emergency';
    v_sla := now() + (private.escalation_sla_minutes('obesity_ed_screen', 'emergency') * interval '1 minute');
    v_esc := 4;
  else
    v_level := 'urgent_escalation';
    v_sla := now() + (private.escalation_sla_minutes('obesity_ed_screen', 'urgent_escalation') * interval '1 minute');
    v_esc := 3;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
  values (
    new.organisation_id, new.patient_id, v_level, 'open',
    'Eating-disorder / mental-health screen positive',
    format('Positive obesity ED/mental-health screen (SCOFF %s/5%s%s). Weight-loss tasks paused; review and refer per §18 before resuming.',
      new.scoff_score,
      case when new.self_harm_risk then ', self-harm risk' else '' end,
      case when new.low_mood then ', low mood' else '' end),
    v_sla, v_esc)
  returning id into v_alert;

  update public.obesity_ed_screens set clinician_alert_id = v_alert where id = new.id;

  -- PAUSE the obesity lifestyle programme's weight-loss (§16.3, §18.2).
  update public.lpe_enrollments
    set status = 'paused',
        paused_reason = coalesce(paused_reason, 'Auto-paused: positive ED/mental-health screen')
    where patient_id = new.patient_id
      and condition = 'obesity'
      and status not in ('paused','completed');

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, coalesce(new.administered_by, new.patient_id),
    'obesity_ed_screen.positive', 'obesity_ed_screens', new.id,
    jsonb_build_object('scoff_score', new.scoff_score, 'self_harm_risk', new.self_harm_risk,
                       'low_mood', new.low_mood, 'clinician_alert_id', v_alert));

  return new;
end;
$$;

create or replace function private.flag_missing_glucose_logs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
  select distinct
    cp.organisation_id,
    cp.patient_id,
    'clinician_review'::public.alert_level,
    'open'::public.alert_status,
    'No recent glucose logs',
    'This patient on an active diabetes care plan has not logged a glucose reading in over 7 days. Silence is not assumed safe (§15.5) — check in: confirm they are well, have test strips / supplies, and help them resume logging.',
    now() + (private.escalation_sla_minutes('chronic_monitoring_silence', 'clinician_review') * interval '1 minute'),
    2::smallint
  from public.care_plans cp
  where cp.condition = 'diabetes'
    and cp.status = 'active'
    and not exists (
      select 1 from public.vitals_readings v
      where v.patient_id = cp.patient_id
        and v.vital_type = 'glucose'
        and v.taken_at >= now() - interval '7 days'
    )
    and not exists (
      select 1 from public.clinician_alerts a
      where a.patient_id = cp.patient_id
        and a.title = 'No recent glucose logs'
        and a.status = 'open'
    );
end;
$$;

create or replace function private.flag_overdue_vitals()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  for v_row in
    with monitored as (
      select p.id as patient_id, p.organisation_id,
        coalesce(
          (select r.frequency_days from public.vitals_reminder_rules r where r.patient_id = p.id),
          (select min(r.frequency_days) from public.vitals_reminder_rules r
             join public.care_plans cp on cp.condition = r.condition and cp.patient_id = p.id and cp.status='active'
             where r.patient_id is null and r.condition is not null and r.organisation_id = p.organisation_id),
          case when exists (
            select 1 from public.care_plans cp
            where cp.patient_id = p.id and cp.status='active' and cp.condition in ('hypertension','diabetes')
          ) then 3 else 30 end
        ) as freq_days,
        (select max(v.taken_at) from public.vitals_readings v
           where v.patient_id = p.id and v.vital_type = 'blood_pressure') as last_bp
      from public.profiles p
      where p.role = 'patient' and p.organisation_id is not null
        and exists (
          select 1 from public.care_plans cp
          where cp.patient_id = p.id and cp.status='active' and cp.condition in ('hypertension','diabetes')
        )
    )
    select m.* from monitored m
    where (m.last_bp is null or m.last_bp < now() - ((m.freq_days + 7) || ' days')::interval)
      and exists (select 1 from public.vitals_reminder_state s
                    where s.patient_id = m.patient_id and s.reminder_sent_at is not null)
      and not exists (
        select 1 from public.clinician_alerts a
        where a.patient_id = m.patient_id and a.status = 'open'
          and a.title = 'Missing expected blood-pressure readings'
      )
  loop
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
    values (
      v_row.organisation_id, v_row.patient_id, 'clinician_review', 'open',
      'Missing expected blood-pressure readings',
      format('No blood-pressure reading logged in over %s days despite reminders. Silence is not assumed safe — please make contact to check on the patient and their monitoring.',
             v_row.freq_days + 7),
      now() + (private.escalation_sla_minutes('chronic_monitoring_silence', 'clinician_review') * interval '1 minute'), 2
    );

    insert into public.audit_log
      (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (
      v_row.organisation_id, v_row.patient_id, 'bp_missing_reading.flagged',
      'profiles', v_row.patient_id,
      jsonb_build_object('freq_days', v_row.freq_days, 'last_bp', v_row.last_bp)
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assertion block — the migration is the test. Confirms every (pathway,
-- tier) combination the 8 rewritten functions depend on resolves, AND that
-- every resolved value matches the exact pre-migration hardcoded number
-- (zero behaviour change proof), matching this codebase's established
-- "migration ends with a DO block of assertions" discipline.
-- ---------------------------------------------------------------------------
do $$
declare
  v_val integer;
begin
  v_val := private.escalation_sla_minutes('screening_abnormal_result', 'emergency');
  if v_val <> 120 then raise exception 'FAIL: screening_abnormal_result/emergency = % (expected 120)', v_val; end if;

  v_val := private.escalation_sla_minutes('screening_abnormal_result', 'urgent_escalation');
  if v_val <> 1440 then raise exception 'FAIL: screening_abnormal_result/urgent_escalation = % (expected 1440)', v_val; end if;

  v_val := private.escalation_sla_minutes('bp_vitals_red_flag', 'urgent_escalation');
  if v_val <> 60 then raise exception 'FAIL: bp_vitals_red_flag/urgent_escalation = % (expected 60)', v_val; end if;

  v_val := private.escalation_sla_minutes('bp_vitals_red_flag', 'clinician_review');
  if v_val <> 4320 then raise exception 'FAIL: bp_vitals_red_flag/clinician_review = % (expected 4320)', v_val; end if;

  v_val := private.escalation_sla_minutes('emergency_event', 'emergency');
  if v_val <> 120 then raise exception 'FAIL: emergency_event/emergency = % (expected 120)', v_val; end if;

  v_val := private.escalation_sla_minutes('diabetic_foot_check', 'urgent_escalation');
  if v_val <> 240 then raise exception 'FAIL: diabetic_foot_check/urgent_escalation = % (expected 240)', v_val; end if;

  v_val := private.escalation_sla_minutes('lpe_red_flag', 'emergency');
  if v_val <> 15 then raise exception 'FAIL: lpe_red_flag/emergency = % (expected 15)', v_val; end if;

  v_val := private.escalation_sla_minutes('lpe_red_flag', 'urgent_escalation');
  if v_val <> 60 then raise exception 'FAIL: lpe_red_flag/urgent_escalation = % (expected 60)', v_val; end if;

  v_val := private.escalation_sla_minutes('lpe_red_flag', 'clinician_review');
  if v_val <> 4320 then raise exception 'FAIL: lpe_red_flag/clinician_review = % (expected 4320)', v_val; end if;

  v_val := private.escalation_sla_minutes('obesity_ed_screen', 'emergency');
  if v_val <> 15 then raise exception 'FAIL: obesity_ed_screen/emergency = % (expected 15)', v_val; end if;

  v_val := private.escalation_sla_minutes('obesity_ed_screen', 'urgent_escalation');
  if v_val <> 60 then raise exception 'FAIL: obesity_ed_screen/urgent_escalation = % (expected 60)', v_val; end if;

  v_val := private.escalation_sla_minutes('chronic_monitoring_silence', 'clinician_review');
  if v_val <> 4320 then raise exception 'FAIL: chronic_monitoring_silence/clinician_review = % (expected 4320)', v_val; end if;

  v_val := private.escalation_sla_minutes('general', 'routine');
  if v_val <> 10080 then raise exception 'FAIL: general/routine = % (expected 10080)', v_val; end if;

  raise notice 'PASS: all 12 escalation_slas entries resolve to their expected as-transcribed values';
end $$;

-- Anon-execute check for the new lookup helper and sign RPC, corrected form.
do $$
begin
  if has_function_privilege('anon', 'private.escalation_sla_minutes(text, public.alert_level)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.escalation_sla_minutes';
  end if;
  if has_function_privilege('anon', 'public.sign_escalation_slas(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.sign_escalation_slas';
  end if;
  if not has_function_privilege('authenticated', 'public.sign_escalation_slas(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.sign_escalation_slas';
  end if;
  raise notice 'PASS: anon denied, authenticated allowed on both new functions';
end $$;
