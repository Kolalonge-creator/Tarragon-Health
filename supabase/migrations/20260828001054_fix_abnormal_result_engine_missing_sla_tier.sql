-- Tarragon Health — fix a bug caught by testing, not production, before it
-- ever fired for real.
--
-- The previous migration (20260828000800_abnormal_result_engine_
-- corrections_and_ops_dashboard.sql) has both its new non-critical review
-- paths — private.flag_screening_result_discrepancy()'s "clinician_review"
-- branch, and record_result_correction()'s stand-down alert for a downgrade
-- from a non-critical original — call
-- private.escalation_sla_minutes('screening_abnormal_result',
-- 'clinician_review'). That (pathway, tier) pair was never seeded:
-- escalation_slas only configures screening_abnormal_result at 'emergency'
-- (120 min) and 'urgent_escalation' (1440 min) — 'clinician_review' isn't
-- one of them. escalation_sla_minutes fails loud on an unconfigured pair by
-- design (v3_port_escalation_sla_config), which is exactly what caught this
-- in a smoke test before it ever ran against a real disagreeing pair or
-- real downgrade correction in production.
--
-- Fix: only compute an SLA when the branch actually lands on
-- 'urgent_escalation' (which IS configured for this pathway); the
-- 'clinician_review' branch leaves sla_due_at null. This matches the one
-- existing precedent for a TS/trigger-side non-critical review alert on
-- this platform — lib/cv-risk/escalate.ts's flagCvRiskEscalations, which
-- also never sets sla_due_at for its 'clinician_review'-level rows — rather
-- than inventing a new SLA number for a pathway/tier pair no Clinical
-- Director has configured (see design note 5 in the original migration:
-- neither new path may invent a clinical threshold or SLA of its own).

create or replace function private.flag_screening_result_discrepancy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior record;
  v_new_bucket text;
  v_prior_bucket text;
  v_pair_low uuid;
  v_pair_high uuid;
  v_dedup_tag text;
  v_level public.alert_level;
  v_sla_due_at timestamptz;
begin
  if new.corrects_result_id is not null or new.screen_type_code is null then
    return new;
  end if;

  v_new_bucket := case when new.result_status in ('abnormal', 'critical') then 'flagged' else 'clear' end;

  select sr.id, sr.result_status, sr.created_at
    into v_prior
    from public.screening_results sr
    where sr.patient_id = new.patient_id
      and sr.screen_type_code = new.screen_type_code
      and sr.id <> new.id
      and sr.created_at >= new.created_at - interval '14 days'
      and sr.created_at <= new.created_at
      and not exists (select 1 from public.screening_results nc where nc.corrects_result_id = sr.id)
    order by sr.created_at desc
    limit 1;

  if v_prior.id is null then
    return new;
  end if;

  v_prior_bucket := case when v_prior.result_status in ('abnormal', 'critical') then 'flagged' else 'clear' end;
  if v_prior_bucket = v_new_bucket then
    return new;
  end if;

  v_pair_low := least(v_prior.id, new.id);
  v_pair_high := greatest(v_prior.id, new.id);
  v_dedup_tag := format('[discrepancy:%s:%s]', v_pair_low, v_pair_high);

  if exists (
    select 1 from public.clinician_alerts
    where patient_id = new.patient_id and detail like v_dedup_tag || '%'
  ) then
    return new;
  end if;

  v_level := case when new.result_status = 'critical' or v_prior.result_status = 'critical'
    then 'urgent_escalation' else 'clinician_review' end;

  -- screening_abnormal_result only has emergency/urgent_escalation SLA
  -- tiers configured — see migration header. clinician_review gets no SLA
  -- timer, matching lib/cv-risk/escalate.ts's own precedent for a
  -- non-critical review alert.
  v_sla_due_at := case when v_level = 'urgent_escalation'
    then now() + (private.escalation_sla_minutes('screening_abnormal_result', 'urgent_escalation') * interval '1 minute')
    else null end;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, screening_result_id, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    v_level,
    'open',
    'Conflicting results require validation',
    format('%s %s screen: result %s (%s, %s) disagrees with result %s (%s, %s) within 14 days for the same patient — validate before relying on either.',
      v_dedup_tag, new.screen_type_code,
      v_prior.id, v_prior.result_status, v_prior.created_at::date,
      new.id, new.result_status, new.created_at::date),
    v_sla_due_at,
    new.id,
    case when v_level = 'urgent_escalation' then 3 else 2 end
  );

  return new;
end;
$$;

create or replace function public.record_result_correction(
  p_original_result_id uuid,
  p_result_status public.result_status,
  p_result_summary text,
  p_abnormal_flags text[],
  p_correction_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.screening_results%rowtype;
  v_new_id uuid;
  v_old_bucket text;
  v_new_bucket text;
  v_level public.alert_level;
  v_sla_due_at timestamptz;
begin
  select * into v_original from public.screening_results where id = p_original_result_id;
  if v_original.id is null then
    raise exception 'Original result not found' using errcode = '22023';
  end if;

  if not private.is_org_staff(v_original.organisation_id) then
    raise exception 'not authorised';
  end if;
  if not exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid()) and active
  ) then
    raise exception 'Only an active Tarragon care-team doctor can file a result correction';
  end if;
  if p_correction_reason is null or length(btrim(p_correction_reason)) = 0 then
    raise exception 'A correction reason is required' using errcode = '22023';
  end if;

  if exists (select 1 from public.screening_results where corrects_result_id = p_original_result_id) then
    raise exception 'This result has already been corrected — correct the newer version instead' using errcode = '22023';
  end if;

  insert into public.screening_results
    (organisation_id, patient_id, schedule_id, screen_type_code, lab_order_id,
     result_status, result_summary, abnormal_flags, corrects_result_id, correction_reason)
  values
    (v_original.organisation_id, v_original.patient_id, v_original.schedule_id,
     v_original.screen_type_code, v_original.lab_order_id,
     p_result_status, p_result_summary, coalesce(p_abnormal_flags, '{}'), v_original.id, p_correction_reason)
  returning id into v_new_id;

  v_old_bucket := case when v_original.result_status in ('abnormal', 'critical') then 'flagged' else 'clear' end;
  v_new_bucket := case when p_result_status in ('abnormal', 'critical') then 'flagged' else 'clear' end;

  if v_old_bucket = 'flagged' and v_new_bucket = 'clear' then
    v_level := case when v_original.result_status = 'critical' then 'urgent_escalation' else 'clinician_review' end;

    -- Same fix as flag_screening_result_discrepancy above: only
    -- urgent_escalation is a configured tier for this pathway.
    v_sla_due_at := case when v_level = 'urgent_escalation'
      then now() + (private.escalation_sla_minutes('screening_abnormal_result', 'urgent_escalation') * interval '1 minute')
      else null end;

    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, screening_result_id, escalation_level)
    values (
      v_original.organisation_id,
      v_original.patient_id,
      v_level,
      'open',
      'Result correction: previous result stood down',
      format('Result %s was %s; correction %s revises it to %s. Reason: %s. Confirm any action already taken on the original result (patient notification, drafted care plan, referral) is reconciled.',
        v_original.id, v_original.result_status, v_new_id, p_result_status, p_correction_reason),
      v_sla_due_at,
      v_new_id,
      case when v_level = 'urgent_escalation' then 3 else 2 end
    );
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_original.organisation_id, auth.uid(), 'screening_result.corrected', 'screening_results', v_new_id,
    jsonb_build_object(
      'original_result_id', v_original.id,
      'original_status', v_original.result_status,
      'corrected_status', p_result_status,
      'reason', p_correction_reason
    )
  );

  return v_new_id;
end;
$$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'flag_screening_result_discrepancy' and pronamespace = 'private'::regnamespace;
  if v_def like '%escalation_sla_minutes(''screening_abnormal_result'', v_level)%' then
    raise exception 'flag_screening_result_discrepancy still calls escalation_sla_minutes with a variable tier that can be clinician_review';
  end if;

  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'record_result_correction' and pronamespace = 'public'::regnamespace;
  if v_def like '%escalation_sla_minutes(''screening_abnormal_result'', v_level)%' then
    raise exception 'record_result_correction still calls escalation_sla_minutes with a variable tier that can be clinician_review';
  end if;

  raise notice 'PASS: both functions now only call escalation_sla_minutes for the configured urgent_escalation tier';
end $$;
