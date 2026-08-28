-- Tarragon Health — Alert System infrastructure, part 1/6: taxonomy + governance.
--
-- The Alert System is broader than abnormal results: it's the platform's
-- event-to-action notification infrastructure (clinical, care-management,
-- medication and operational events alike). clinician_alerts already carries
-- 8 real generators (abnormal screening results, BP/SpO2/temperature red
-- flags, emergency events, diabetic foot self-report, LPE safety rules,
-- obesity/ED screens, glucose/BP monitoring silence) but has no shared
-- taxonomy across them, no severity model independent of the deterministic
-- `level` classification, and no governed record of who owns each alert
-- type, what channel/timeout ladder applies, or the evidence basis behind
-- any of it. This is part 1 of 6: the taxonomy enums and a governance
-- ledger (`alert_rules`) other parts read from. Parts 2-6 extend
-- clinician_alerts itself, delivery tracking, the ack-timeout escalation
-- ladder, new generators for previously-uncovered alert types, and
-- analytics.
--
-- `alert_rules` mirrors `escalation_slas` (20260730105131) deliberately: one
-- governed jsonb document, versioned, `is_active` flag, no per-row
-- organisation_id (this is a platform-wide clinical-governance policy, same
-- posture escalation_slas already takes for its own config). Live-checked
-- before writing this: escalation_slas is currently on v4, `is_active =
-- true`, with `approved_by`/`approved_at` still null -- i.e. the established,
-- already-shipped practice in this codebase is that a new governance-config
-- table's first version ships active-but-unsigned, flagged for a Clinical
-- Director to review and sign later via a dedicated `sign_*` RPC, not
-- blocked pending signature. `alert_rules` follows exactly that precedent.
--
-- config is a jsonb array, one entry per (category, type_code), each
-- carrying: default_severity/severity_meaning/evidence_basis (governance,
-- 8.14), owner_tier/backup_tier/senior_tier (ownership + routing, 8.4/8.5),
-- ack_timeout_minutes (escalation timer, 8.11), channel_sequence
-- (notification channels, 8.6), auto_suppress_duplicates/
-- suppress_window_minutes (protocol-based suppression, 8.7). Severity
-- itself is NOT read from here at alert-creation time -- it's always
-- deterministically derived from the existing `alert_level` classification
-- (part 2) so the two can never drift apart; default_severity here is the
-- governance record of what severity policy INTENDS for this type, used for
-- comparison/audit, not as a runtime input.

create type public.alert_category as enum ('clinical', 'care_management', 'medication', 'operational');

create type public.alert_type_code as enum (
  -- clinical
  'abnormal_result', 'abnormal_monitoring', 'symptom_escalation', 'medication_safety', 'deterioration',
  -- care management
  'missed_appointment', 'overdue_task', 'overdue_monitoring', 'failed_referral',
  -- medication
  'adherence_problem', 'refill_due', 'potential_interaction', 'pharmacy_problem',
  -- operational
  'provider_unavailable', 'appointment_failure', 'laboratory_failure'
);

create type public.alert_resolution_outcome as enum ('true_positive', 'false_positive', 'duplicate', 'no_action_needed');

create table public.alert_rules (
  id            uuid primary key default gen_random_uuid(),
  version       integer not null,
  config        jsonb not null,
  notes         text,
  approved_by   uuid references public.clinical_staff (id),
  approved_at   timestamptz,
  is_active     boolean not null default false,
  created_at    timestamptz not null default now()
);

comment on table public.alert_rules is
  'Governed jsonb-document ledger, same shape as escalation_slas: one row per proposed/signed version, is_active marks the live one. Each config[] entry is one alert_type_code''s full governance record (8.14) plus its ownership/routing/channel/suppression policy (8.4-8.7, 8.11). Reader: private.alert_rule_config(type_code).';

create index alert_rules_active_idx on public.alert_rules (is_active) where is_active;

alter table public.alert_rules enable row level security;

create policy alert_rules_select on public.alert_rules
  for select to authenticated using (true);

-- Same shape as escalation_slas_insert: any authenticated caller may propose
-- a new inactive, unsigned draft version; only public.sign_alert_rules()
-- (Clinical-Director-gated, SECURITY DEFINER) may activate/sign one.
create policy alert_rules_insert on public.alert_rules
  for insert to authenticated
  with check (
    private.is_admin()
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

grant select, insert on public.alert_rules to authenticated;

create or replace function public.sign_alert_rules(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.alert_rules where id = p_id) then
    raise exception 'Alert rules config version not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.is_clinical_director
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the alert rules config';
  end if;

  update public.alert_rules set is_active = false
    where is_active and id <> p_id;

  update public.alert_rules
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'alert_rules.signed',
         'alert_rules', p_id,
         jsonb_build_object('signed_by_clinical_staff', v_staff)
  from public.clinical_staff cs where cs.id = v_staff;

  return p_id;
end;
$$;

comment on function public.sign_alert_rules(uuid) is
  'Clinical-Director-only sign step for an alert_rules draft version, mirroring public.sign_escalation_slas(). Retires any other active version, stamps approved_by/approved_at from the caller''s own clinical_staff record (never client-supplied), audit-logs the signature.';

revoke all on function public.sign_alert_rules(uuid) from public, anon;
grant execute on function public.sign_alert_rules(uuid) to authenticated;

-- Reader: fail-open (returns null), never raises. Alert generation must
-- never be blocked by unsigned or missing governance -- contrast
-- private.escalation_sla_minutes(), which DOES raise, because that function
-- is only ever called from the 8 pre-existing, already-live trigger
-- pathways that have always had a required config entry. This function is
-- called from the new classify/assign trigger (part 2) for every alert,
-- including types no Director has configured yet, so it degrades to "no
-- routing/timeout metadata" rather than failing the insert.
create or replace function private.alert_rule_config(p_type_code public.alert_type_code)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select entry
  from public.alert_rules c, jsonb_array_elements(c.config) as entry
  where c.is_active and entry->>'type_code' = p_type_code::text
  limit 1;
$$;

comment on function private.alert_rule_config(public.alert_type_code) is
  'Looks up the active alert_rules config entry for one alert_type_code. Returns null (never raises) if no active config or no entry for that type -- callers must treat null as "no governed routing/timeout policy yet" and degrade gracefully, not fail the alert.';

revoke all on function private.alert_rule_config(public.alert_type_code) from public, anon;

-- v1 seed: active-but-unsigned (see header), one entry per alert_type_code.
-- Defaults are a reasonable starting ladder derived from the severity each
-- type is expected to carry via its `alert_level` mapping (part 2) --
-- flagged for real Clinical Director review like every other config-not-code
-- table this project has shipped.
insert into public.alert_rules (version, config, notes, is_active)
values (
  1,
  jsonb_build_array(
    jsonb_build_object('category','clinical','type_code','abnormal_result','default_severity',3,'severity_meaning','Urgent: abnormal/critical screening or lab result requiring clinician review within the configured SLA.','evidence_basis','Existing abnormal-result pipeline (private.handle_abnormal_screening_result); severity already varies 3/4 by result_status.','owner_tier','tier_1','backup_tier','tier_2','senior_tier','tier_4_senior_registrar','ack_timeout_minutes',30,'channel_sequence',jsonb_build_array('in_app','push','whatsapp'),'auto_suppress_duplicates',false,'suppress_window_minutes',null,'effective_date',null,'review_date',null),
    jsonb_build_object('category','clinical','type_code','abnormal_monitoring','default_severity',3,'severity_meaning','Urgent: a home vitals reading (BP/SpO2/temperature) crossed a red-flag threshold.','evidence_basis','Existing BP/SpO2/temperature red-flag engines.','owner_tier','tier_1','backup_tier','tier_2','senior_tier','tier_4_senior_registrar','ack_timeout_minutes',30,'channel_sequence',jsonb_build_array('in_app','push','whatsapp'),'auto_suppress_duplicates',true,'suppress_window_minutes',240,'effective_date',null,'review_date',null),
    jsonb_build_object('category','clinical','type_code','symptom_escalation','default_severity',4,'severity_meaning','Emergency: a patient self-reported a danger symptom, emergency event, or positive self-harm/ED screen.','evidence_basis','Existing emergency_events, diabetic foot self-check and obesity/ED-screen handlers.','owner_tier','tier_2','backup_tier','tier_3','senior_tier','tier_4_senior_registrar','ack_timeout_minutes',15,'channel_sequence',jsonb_build_array('in_app','push','whatsapp','sms'),'auto_suppress_duplicates',false,'suppress_window_minutes',null,'effective_date',null,'review_date',null),
    jsonb_build_object('category','clinical','type_code','medication_safety','default_severity',3,'severity_meaning','Urgent: a medication safety concern (e.g. a flagged interaction or contraindication) needs clinician attention.','evidence_basis','Reserved for future automated interaction detection; currently clinician-raised only.','owner_tier','tier_2','backup_tier','tier_3','senior_tier','tier_4_senior_registrar','ack_timeout_minutes',60,'channel_sequence',jsonb_build_array('in_app','push'),'auto_suppress_duplicates',false,'suppress_window_minutes',null,'effective_date',null,'review_date',null),
    jsonb_build_object('category','clinical','type_code','deterioration','default_severity',3,'severity_meaning','Urgent: a lifestyle-programme safety rule fired, indicating clinical deterioration risk.','evidence_basis','Existing LPE (Lifestyle Programme Engine) safety-core red-flag rules.','owner_tier','tier_1','backup_tier','tier_2','senior_tier','tier_3','ack_timeout_minutes',60,'channel_sequence',jsonb_build_array('in_app','push'),'auto_suppress_duplicates',false,'suppress_window_minutes',null,'effective_date',null,'review_date',null),
    jsonb_build_object('category','care_management','type_code','missed_appointment','default_severity',2,'severity_meaning','Doctor review: a scheduled appointment was recorded as a no-show.','evidence_basis','appointments.status = no_show.','owner_tier','care_coordinator','backup_tier','tier_1','senior_tier','tier_2','ack_timeout_minutes',1440,'channel_sequence',jsonb_build_array('in_app'),'auto_suppress_duplicates',true,'suppress_window_minutes',1440,'effective_date',null,'review_date',null),
    jsonb_build_object('category','care_management','type_code','overdue_task','default_severity',1,'severity_meaning','Routine: a care-coordination outreach task has sat open too long without a nudge.','evidence_basis','care_outreach_tasks stuck open, no nudge_sent_at, past staleness window.','owner_tier','care_coordinator','backup_tier','tier_1','senior_tier','tier_2','ack_timeout_minutes',1440,'channel_sequence',jsonb_build_array('in_app'),'auto_suppress_duplicates',true,'suppress_window_minutes',1440,'effective_date',null,'review_date',null),
    jsonb_build_object('category','care_management','type_code','overdue_monitoring','default_severity',2,'severity_meaning','Doctor review: expected glucose or BP self-monitoring has gone silent.','evidence_basis','Existing private.flag_missing_glucose_logs / private.flag_overdue_vitals nightly sweeps.','owner_tier','tier_1','backup_tier','tier_2','senior_tier','tier_3','ack_timeout_minutes',240,'channel_sequence',jsonb_build_array('in_app','push'),'auto_suppress_duplicates',true,'suppress_window_minutes',1440,'effective_date',null,'review_date',null),
    jsonb_build_object('category','care_management','type_code','failed_referral','default_severity',2,'severity_meaning','Doctor review: a specialist referral was declined and needs a new plan.','evidence_basis','specialist_referrals.status = declined.','owner_tier','tier_1','backup_tier','tier_2','senior_tier','tier_4_senior_registrar','ack_timeout_minutes',1440,'channel_sequence',jsonb_build_array('in_app'),'auto_suppress_duplicates',false,'suppress_window_minutes',null,'effective_date',null,'review_date',null),
    jsonb_build_object('category','medication','type_code','adherence_problem','default_severity',3,'severity_meaning','Urgent: repeated missed doses reached the doctor-level rung of the adherence ladder.','evidence_basis','Existing medication_adherence_alerts (level=doctor) escalation ladder, bridged into the unified inbox.','owner_tier','tier_1','backup_tier','tier_2','senior_tier','tier_3','ack_timeout_minutes',240,'channel_sequence',jsonb_build_array('in_app','push'),'auto_suppress_duplicates',false,'suppress_window_minutes',null,'effective_date',null,'review_date',null),
    jsonb_build_object('category','medication','type_code','refill_due','default_severity',1,'severity_meaning','Routine: a medication refill is due; currently patient-facing reminders only, reserved here for a future staff-facing escalation if refill non-adherence causes missed doses.','evidence_basis','medication_refill_reminder_rules / medication_refill_state (patient reminder engine); no staff-facing generator yet.','owner_tier','care_coordinator','backup_tier','tier_1','senior_tier','tier_2','ack_timeout_minutes',1440,'channel_sequence',jsonb_build_array('in_app'),'auto_suppress_duplicates',true,'suppress_window_minutes',1440,'effective_date',null,'review_date',null),
    jsonb_build_object('category','medication','type_code','potential_interaction','default_severity',3,'severity_meaning','Urgent: a clinician-identified potential drug interaction or contraindication.','evidence_basis','No automated interaction-detection engine exists yet; clinician-raised only, taxonomy reserved for when one is built.','owner_tier','tier_2','backup_tier','tier_3','senior_tier','tier_4_senior_registrar','ack_timeout_minutes',60,'channel_sequence',jsonb_build_array('in_app','push'),'auto_suppress_duplicates',false,'suppress_window_minutes',null,'effective_date',null,'review_date',null),
    jsonb_build_object('category','medication','type_code','pharmacy_problem','default_severity',2,'severity_meaning','Doctor review: a pharmacy order has stalled before dispensing/delivery.','evidence_basis','pharmacy_orders stuck requested/confirmed past staleness window.','owner_tier','care_coordinator','backup_tier','tier_1','senior_tier','tier_2','ack_timeout_minutes',1440,'channel_sequence',jsonb_build_array('in_app'),'auto_suppress_duplicates',true,'suppress_window_minutes',1440,'effective_date',null,'review_date',null),
    jsonb_build_object('category','operational','type_code','provider_unavailable','default_severity',1,'severity_meaning','Routine: a partner provider (lab/pharmacy/specialist) capacity or availability gap. No automated generator yet.','evidence_basis','No live source table maps cleanly to this yet; taxonomy reserved for when partner-availability tracking is built out.','owner_tier','care_coordinator','backup_tier','tier_1','senior_tier',null,'ack_timeout_minutes',1440,'channel_sequence',jsonb_build_array('in_app'),'auto_suppress_duplicates',false,'suppress_window_minutes',null,'effective_date',null,'review_date',null),
    jsonb_build_object('category','operational','type_code','appointment_failure','default_severity',1,'severity_meaning','Routine: an appointment could not be scheduled/confirmed due to a system or partner issue. No automated generator yet.','evidence_basis','No live source table maps cleanly to this yet.','owner_tier','care_coordinator','backup_tier','tier_1','senior_tier',null,'ack_timeout_minutes',1440,'channel_sequence',jsonb_build_array('in_app'),'auto_suppress_duplicates',false,'suppress_window_minutes',null,'effective_date',null,'review_date',null),
    jsonb_build_object('category','operational','type_code','laboratory_failure','default_severity',2,'severity_meaning','Doctor review: a lab order has stalled before sample collection.','evidence_basis','lab_orders stuck ordered past staleness window.','owner_tier','care_coordinator','backup_tier','tier_1','senior_tier','tier_2','ack_timeout_minutes',1440,'channel_sequence',jsonb_build_array('in_app'),'auto_suppress_duplicates',true,'suppress_window_minutes',1440,'effective_date',null,'review_date',null)
  ),
  'v1: active-but-unsigned, seeded from the platform''s existing generators and staleness sweeps. Flagged for Clinical Director review/sign-off via public.sign_alert_rules() -- same posture escalation_slas v1 shipped in.',
  true
);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'alert_category') then
    raise exception 'alert_category enum was not created';
  end if;
  if not exists (select 1 from pg_type where typname = 'alert_type_code') then
    raise exception 'alert_type_code enum was not created';
  end if;
  if (select count(*) from pg_enum where enumtypid = 'public.alert_type_code'::regtype) <> 16 then
    raise exception 'alert_type_code must have exactly 16 values (8.1 taxonomy)';
  end if;
  if not exists (select 1 from public.alert_rules where is_active) then
    raise exception 'alert_rules v1 seed was not activated';
  end if;
  if (select jsonb_array_length(config) from public.alert_rules where is_active) <> 16 then
    raise exception 'alert_rules v1 config must have one entry per alert_type_code (16)';
  end if;
  if has_function_privilege('anon', 'private.alert_rule_config(public.alert_type_code)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.alert_rule_config';
  end if;
  if has_function_privilege('anon', 'public.sign_alert_rules(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.sign_alert_rules';
  end if;
  raise notice 'PASS: alert_category/alert_type_code taxonomy + alert_rules governance ledger all present, anon denied';
end $$;
