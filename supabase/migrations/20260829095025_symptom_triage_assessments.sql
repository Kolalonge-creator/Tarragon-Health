-- Tarragon Health — Symptom Assessment & Triage Engine, part 3: the
-- assessment record + escalation wiring (platform brief §37).
--
-- Architecture: category is computed by the pure interpreter in
-- @tarragon/symptom-triage-engine, against the signed config from
-- triage_protocols (part 1) — never trusted from the client. Same
-- discipline as mental_health_screens/prevention_risk_scores: no INSERT
-- grant to authenticated at all, so a row can only be written by the
-- service-role server action after it has recomputed the classification
-- itself. From there, a BEFORE INSERT trigger drives the SAME escalation
-- machinery every other red-flag pathway uses — never a parallel alerting
-- system — so the escalation "can never be silently dropped by a
-- buggy/missing app-layer check" (the exact wording on
-- private.handle_symptom_red_flag, which this mirrors):
--   - category = 'emergency'  -> insert into emergency_events (a new
--     'symptom_triage' emergency_source value); its own existing
--     handle_emergency_event trigger takes it from there (SLA, notify,
--     clinician_alerts on paid plans, self-care fallback on Free — see
--     CLAUDE.md's Free-plan vitals/symptom-escalation carve-out).
--   - category = 'urgent'     -> clinician_alerts directly, gated by the
--     SAME private.patient_has_feature_access('vitals_red_flag_doctor_escalation')
--     check every other patient-logged-symptom pathway uses, with the same
--     private.raise_dangerous_reading_ai_suggestion Free-tier fallback.
--   - clinician_review_required (§37.9 — "AI triage -> uncertain -> human
--     clinical review") on a 'routine'/'self_management' outcome raises a
--     SEPARATE clinician_review alert (an emergency/urgent case already
--     puts a human in front of it, so no second alert there — would just be
--     noise).
--   - 'routine'/'self_management' with no review flag: no alert at all,
--     patient gets the safety-net message only.

alter type public.emergency_source add value if not exists 'symptom_triage';

create table public.symptom_triage_assessments (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  -- Who actually ran the assessment (§37.2 entry points) — nullable for
  -- symmetry with symptoms.logged_by_profile_id/emergency_events.logged_by_profile_id;
  -- null means "the patient, in their own session" (the common case).
  logged_by_profile_id        uuid references public.profiles (id) on delete set null,
  entry_point                 public.triage_entry_point not null default 'patient_app',
  presenting_complaint_key    text not null,
  -- Stamped from triage_protocols.version at classification time — the
  -- "model/rule version" §37.10 asks to be recorded. FK'd (not just an
  -- integer) so a typo'd version can't silently pass RLS-bypassing
  -- service-role validation.
  protocol_version            integer not null references public.triage_protocols (version) on delete restrict,
  -- The full structured capture (§37.3: symptom, onset, duration, severity,
  -- frequency, location, associated symptoms, triggers, history, meds,
  -- measurements) as the engine's SymptomCapture shape.
  initial_capture             jsonb not null,
  -- AnsweredQuestion[] — every question asked and answered (§37.10).
  questions_asked             jsonb not null default '[]'::jsonb,
  -- RedFlagScreenResult — which red-flag rules fired/didn't, for audit.
  red_flag_screen             jsonb not null default '{}'::jsonb,
  category                    public.triage_category not null,
  clinician_review_required   boolean not null default false,
  safety_net_message_key      text not null,
  rationale                   text not null,
  emergency_event_id          uuid references public.emergency_events (id) on delete set null,
  clinician_alert_id          uuid references public.clinician_alerts (id) on delete set null,
  clinician_review_alert_id   uuid references public.clinician_alerts (id) on delete set null,
  -- Clinician override of the engine's classification (mirrors
  -- clinician_alerts.override_level/override_reason/overridden_by/overridden_at
  -- exactly — same "deterministic classification with a clinician_override
  -- field" discipline CLAUDE.md documents as ported from the v3 spec).
  override_category           public.triage_category,
  override_reason             text,
  overridden_by               uuid references public.clinical_staff (id) on delete restrict,
  overridden_at               timestamptz,
  -- §37.10 "outcome" — what actually happened as a result of the triage.
  outcome_action               text,
  outcome_recorded_by          uuid references public.clinical_staff (id) on delete set null,
  outcome_recorded_at          timestamptz,
  -- §37.11 safety monitoring inputs — a reviewing clinician's own audit
  -- findings on THIS assessment. These can never be inferred automatically
  -- (that's the whole point of "missed red flag" / "false reassurance" as
  -- a clinical judgement call), so they're clinician-set flags, aggregated
  -- by the triage_safety_monitoring view (part 4).
  clinician_flagged_missed_red_flag          boolean not null default false,
  clinician_flagged_false_reassurance        boolean not null default false,
  clinician_flagged_inappropriate_escalation boolean not null default false,
  safety_flag_notes           text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint symptom_triage_assessments_override_requires_reason
    check (override_category is null or (override_reason is not null and overridden_by is not null and overridden_at is not null))
);

create index symptom_triage_assessments_patient_idx
  on public.symptom_triage_assessments (patient_id, created_at desc);
create index symptom_triage_assessments_org_category_idx
  on public.symptom_triage_assessments (organisation_id, category, created_at desc);
create index symptom_triage_assessments_review_required_idx
  on public.symptom_triage_assessments (organisation_id, clinician_review_required)
  where clinician_review_required;

alter table public.symptom_triage_assessments enable row level security;

create trigger symptom_triage_assessments_set_updated_at
  before update on public.symptom_triage_assessments
  for each row execute function private.set_updated_at();

-- Read: the patient (their own), whoever logged it on the patient's behalf
-- (mirrors emergency_events_select_own_report), org staff, or anyone with a
-- standing clinical-read grant (mirrors clinician_alerts_select). No
-- insert/update grant to authenticated at all for insert (system-computed
-- classification, same reasoning as mental_health_screens) — see below for
-- the staff-only update policy covering override/outcome/safety flags.
create policy symptom_triage_assessments_select on public.symptom_triage_assessments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or logged_by_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

-- Only org staff may update a row, and only ever to add an override/outcome/
-- safety-flag annotation — the classification columns themselves
-- (category, rationale, questions_asked, red_flag_screen, ...) are never
-- targeted by any app-layer update path; nothing enforces that at the RLS
-- layer today (no column-level RLS in Postgres), so this is a code-review
-- invariant on apps/web's server actions, not a DB one — same trust
-- boundary as clinician_alerts_update.
create policy symptom_triage_assessments_update on public.symptom_triage_assessments
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- No insert grant to authenticated — service role only.
grant select, update on public.symptom_triage_assessments to authenticated;

-- ---------------------------------------------------------------------------
-- Escalation trigger — see the file header for the full routing table.
-- ---------------------------------------------------------------------------
create or replace function private.handle_symptom_triage_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pathway_label text;
  v_has_escalation_access boolean;
  v_emergency_event_id uuid;
  v_clinician_alert_id uuid;
  v_review_alert_id uuid;
begin
  select elem->>'label' into v_pathway_label
  from jsonb_array_elements(
    (select config from public.triage_protocols where version = new.protocol_version) -> 'pathways'
  ) as elem
  where elem->>'key' = new.presenting_complaint_key
  limit 1;

  v_pathway_label := coalesce(v_pathway_label, new.presenting_complaint_key);

  if new.category = 'emergency' then
    insert into public.emergency_events
      (organisation_id, patient_id, source, trigger_detail, status, logged_by_profile_id)
    values (
      new.organisation_id, new.patient_id, 'symptom_triage',
      format('Symptom triage (%s): %s', v_pathway_label, new.rationale),
      'active', new.logged_by_profile_id
    )
    returning id into v_emergency_event_id;
    new.emergency_event_id := v_emergency_event_id;

  elsif new.category = 'urgent' then
    v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');
    if v_has_escalation_access then
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, type_code, title, detail, sla_due_at)
      values (
        new.organisation_id, new.patient_id, 'urgent_escalation', 'open', 'symptom_escalation',
        format('Symptom triage: %s (urgent)', v_pathway_label),
        format('Symptom triage engine classified a %s assessment as needing prompt clinical assessment. %s',
               v_pathway_label, new.rationale),
        now() + (private.escalation_sla_minutes('symptom_triage', 'urgent_escalation') * interval '1 minute')
      )
      returning id into v_clinician_alert_id;
      new.clinician_alert_id := v_clinician_alert_id;
    else
      perform private.raise_dangerous_reading_ai_suggestion(
        new.organisation_id, new.patient_id, v_pathway_label, 'Needs prompt attention',
        format('Based on what you told us about your %s, this is best checked by a clinician soon — please seek care if it does not settle quickly.', v_pathway_label)
      );
    end if;
  end if;

  -- §37.9: force a human look on a genuinely uncertain classification, but
  -- don't pile a second alert onto a case that already put a human in
  -- front of it (emergency/urgent already did, above).
  if new.clinician_review_required and new.category in ('routine', 'self_management') then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, type_code, title, detail, sla_due_at)
    values (
      new.organisation_id, new.patient_id, 'clinician_review', 'open', 'symptom_escalation',
      format('Symptom triage: %s (review requested)', v_pathway_label),
      format('Symptom triage engine could not confidently classify this %s assessment as routine/self-care — flagged for human review. %s',
             v_pathway_label, new.rationale),
      now() + (private.escalation_sla_minutes('symptom_triage', 'clinician_review') * interval '1 minute')
    )
    returning id into v_review_alert_id;
    new.clinician_review_alert_id := v_review_alert_id;
  end if;

  return new;
end;
$function$;

create trigger symptom_triage_assessments_escalate
  before insert on public.symptom_triage_assessments
  for each row execute function private.handle_symptom_triage_assessment();

do $$
begin
  if not exists (
    select 1 from information_schema.triggers
    where event_object_table = 'symptom_triage_assessments'
      and trigger_name = 'symptom_triage_assessments_escalate'
  ) then
    raise exception 'FAIL: escalation trigger missing on symptom_triage_assessments';
  end if;
  raise notice 'PASS: symptom_triage_assessments schema + escalation trigger created';
end $$;
