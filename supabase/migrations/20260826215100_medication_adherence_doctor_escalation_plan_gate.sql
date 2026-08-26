-- Tarragon Health — gate medication-adherence DOCTOR escalation to paid
-- plans; route coach-level adherence alerts into the existing Care
-- Coordinator outreach worklist.
--
-- private.evaluate_adherence_escalation() (20260716175000) has raised a
-- doctor-level medication_adherence_alerts row for EVERY patient at 6+
-- missed doses/30d, regardless of plan, since the day it shipped — the same
-- gap the founder's 2026-08-10 decision already closed for vitals/symptom
-- red flags (20260810022401_gate_vitals_red_flag_escalation_to_paid_plans.
-- sql: "Tarragon Free is self-tracking — nobody schedules anything for a
-- Free patient"). This applies the identical private.patient_has_feature_
-- access() pattern here: a Free patient's repeated misses cap at coach
-- level forever, never silently disappearing (the alert itself, and the
-- health-coach outreach it drives, cost no clinician time and stay
-- available on every plan — matching how a gated vitals red flag still
-- gets the patient a specific self-care suggestion, never silence). A paid
-- patient (Prevent/Essential/Complete) is completely unaffected: 6+ misses
-- still reaches doctor level exactly as before. The "alerts only ever
-- upgrade, never silently downgrade" invariant from the original migration
-- is untouched — this only changes whether a level CAN become 'doctor' in
-- the first place, never removes a 'doctor' level once earned on a paid
-- plan.
--
-- Separately, a coach-level alert is genuinely a Care Coordinator's job —
-- CLAUDE.md's Clinical Tier Ladder has Care Coordinator own "adherence/
-- missed-reading tracking" as logistics, never clinical judgment — but
-- there was no coordinator-facing surface for it at all; /clinician/
-- adherence exists but isn't linked from the Care Coordinator nav, and
-- building a bespoke tab would duplicate the worklist machinery that
-- already exists for exactly this shape of work: care_outreach_tasks +
-- OutreachWorklist (20260723010019_care_outreach_engine.sql), already
-- rendered on BOTH /clinician/outreach and the Care Coordinator's own
-- Outreach worklist tab. So a new coach-level alert also opens a
-- care_outreach_tasks row (new trigger_type 'missed_medication') instead of
-- a new page — "Message patient" / "Escalate to doctor" (a coordinator
-- should never resolve a clinical judgment call themselves) come for free
-- from the shared worklist component. Doctor-level alerts stay exclusively
-- on /clinician/adherence, unreachable from the Care Coordinator nav — that
-- split matches the tier ladder: coordinators do logistics outreach, a
-- doctor-level pattern needs a doctor.
--
-- Only the newly-CREATED coach-level alert opens an outreach task (not
-- every re-evaluation as misses climb from 3 to 4 to 5) — same idiom
-- private.queue_care_outreach() already uses (on conflict ... do nothing,
-- no update-in-place of an existing live task).

-- ---------------------------------------------------------------------------
-- 1. Grant the new feature to every paid tier, same idiom as the vitals gate.
-- ---------------------------------------------------------------------------
update public.subscription_plans
  set features = (select array(select distinct unnest(coalesce(features, '{}') || array['medication_adherence_doctor_escalation'])))
  where (code like 'prevent%' or code like 'essential%' or code like 'complete%')
    and not ('medication_adherence_doctor_escalation' = any(coalesce(features, '{}')));

-- ---------------------------------------------------------------------------
-- 2. New outreach trigger type — own statement, used later in this file's
--    function body (precedented by 20260720015223_bp_red_flag_engine.sql
--    adding + using 'bp_reading' in the same migration).
-- ---------------------------------------------------------------------------
alter type public.outreach_trigger_type add value if not exists 'missed_medication';

-- ---------------------------------------------------------------------------
-- 3. private.evaluate_adherence_escalation() — full body carried forward
--    from 20260716175000_medication_adherence_escalation.sql, with the plan
--    gate on the doctor rung and the new coach-level outreach-task insert.
-- ---------------------------------------------------------------------------
create or replace function private.evaluate_adherence_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missed integer;
  v_level  public.med_adherence_alert_level;
  v_alert  public.medication_adherence_alerts%rowtype;
  v_has_doctor_access boolean;
  v_drug_name text;
  v_is_new_alert boolean := false;
begin
  if new.status <> 'missed' then
    return new;
  end if;

  select count(*) into v_missed
  from public.medication_logs
  where medication_id = new.medication_id
    and status = 'missed'
    and logged_at >= now() - interval '30 days';

  v_has_doctor_access := private.patient_has_feature_access(new.patient_id, 'medication_adherence_doctor_escalation');

  if v_missed >= 6 and v_has_doctor_access then
    v_level := 'doctor';
  elsif v_missed >= 3 then
    v_level := 'coach';
  else
    return new;
  end if;

  select * into v_alert
  from public.medication_adherence_alerts
  where medication_id = new.medication_id and status <> 'resolved'
  limit 1;

  if v_alert.id is null then
    insert into public.medication_adherence_alerts
      (organisation_id, patient_id, medication_id, level, missed_count)
    values
      (new.organisation_id, new.patient_id, new.medication_id, v_level, v_missed);
    v_is_new_alert := true;
  else
    update public.medication_adherence_alerts
      set missed_count = v_missed,
          -- only ever upgrade the rung
          level = case when v_level = 'doctor' then 'doctor' else level end,
          -- a fresh doctor-level breach re-opens an acknowledged coach alert
          status = case
            when status = 'acknowledged' and v_level = 'doctor' and level <> 'doctor'
            then 'open'::public.med_adherence_alert_status
            else status
          end
    where id = v_alert.id;
  end if;

  if v_is_new_alert and v_level = 'coach' then
    select drug_name into v_drug_name from public.medications where id = new.medication_id;

    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail, priority)
    values (
      new.organisation_id,
      new.patient_id,
      'missed_medication',
      jsonb_build_object(
        'medication_id', new.medication_id,
        'drug_name', coalesce(v_drug_name, 'a medication'),
        'missed_count', v_missed,
        'window_days', 30
      ),
      2
    )
    on conflict (patient_id, trigger_type)
      where status in ('open', 'in_progress', 'contacted')
      do nothing;
  end if;

  if v_missed >= 6 and not v_has_doctor_access then
    insert into public.audit_log
      (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (
      new.organisation_id,
      new.patient_id,
      'medication_adherence_alert.escalation_capped_by_plan',
      'medication_logs',
      new.id,
      jsonb_build_object('medication_id', new.medication_id, 'missed_count', v_missed)
    );
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Assertions
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing_plans text;
  v_free_has_feature boolean;
begin
  select string_agg(code, ', ') into v_missing_plans
  from public.subscription_plans
  where (code like 'prevent%' or code like 'essential%' or code like 'complete%')
    and not ('medication_adherence_doctor_escalation' = any(coalesce(features, '{}')));
  if v_missing_plans is not null then
    raise exception 'FAIL: paid plans missing medication_adherence_doctor_escalation: %', v_missing_plans;
  end if;

  select ('medication_adherence_doctor_escalation' = any(coalesce(features, '{}'))) into v_free_has_feature
  from public.subscription_plans where code = 'free';
  if coalesce(v_free_has_feature, false) then
    raise exception 'FAIL: free plan unexpectedly granted medication_adherence_doctor_escalation';
  end if;

  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'outreach_trigger_type' and e.enumlabel = 'missed_medication'
  ) then
    raise exception 'FAIL: outreach_trigger_type is missing missed_medication';
  end if;

  raise notice 'PASS: medication_adherence_doctor_escalation granted to paid plans only; missed_medication outreach trigger in place';
end $$;
