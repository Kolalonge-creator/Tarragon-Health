-- Tarragon Health — Mental Health & Wellbeing Platform (Module 46 §46.5:
-- risk stratification). Today only a crisis flag (PHQ-9 item 9 / EPDS item
-- 10 self-harm) routes anywhere — via emergency_events, from app code. A
-- PHQ-9 "severe" score with item 9 answered 0, a GAD-7 "severe" score, or an
-- AUDIT-C "higher_risk" score currently raise nothing: no clinician ever
-- sees them. §46.5 wants four tiers (low / moderate / high / immediate); the
-- immediate tier already exists (emergency_events, unchanged by this
-- migration) — this adds the missing moderate/high tiers as clinician_alerts,
-- DB-trigger-level so it fires regardless of client, matching this
-- codebase's convention that safety-relevant escalation lives in the
-- database, not app code (see the vitals red-flag engines).
--
-- Crisis rows are explicitly excluded here (crisis_flagged = true) to avoid
-- a duplicate alert alongside the emergency_events path — that path already
-- pages a clinician at 'emergency' severity, which outranks anything this
-- trigger would raise.

create or replace function private.classify_mental_health_screen_concern(
  p_instrument text,
  p_severity_band text,
  p_hazardous boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_instrument in ('phq9', 'epds') and p_severity_band in ('moderately_severe', 'severe') then 'high'
    when p_instrument in ('phq9', 'epds') and p_severity_band = 'moderate' then 'moderate'
    when p_instrument = 'gad7' and p_severity_band = 'severe' then 'high'
    when p_instrument = 'gad7' and p_severity_band = 'moderate' then 'moderate'
    when p_instrument = 'auditc' and coalesce(p_hazardous, false) then 'moderate'
    else 'none'
  end;
$$;

comment on function private.classify_mental_health_screen_concern(text, text, boolean) is
  'Module 46 §46.5 risk stratification: maps a mental_health_screens severity band to a concern tier (none/moderate/high). Pure/deterministic — no AI, no client input beyond the already-server-computed band. Immediate-safety-concern crisis rows are handled separately via emergency_events, not this function.';

create or replace function private.handle_mental_health_screen_concern()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_concern text;
begin
  if new.crisis_flagged then
    return new;
  end if;

  v_concern := private.classify_mental_health_screen_concern(new.instrument, new.severity_band, new.hazardous);
  if v_concern = 'none' then
    return new;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at)
  values (
    new.organisation_id,
    new.patient_id,
    case v_concern when 'high' then 'urgent_escalation' else 'clinician_review' end,
    'open',
    format('Mental-health screen: %s concern — %s', v_concern, upper(new.instrument)),
    format('Screen %s scored %s (%s band)%s. Screening/triage telemetry only — review before actioning.',
           new.id, new.total_score, new.severity_band,
           case when new.hazardous then '; hazardous-use threshold met' else '' end),
    case v_concern when 'high' then now() + interval '24 hours' else null end
  );

  return new;
end;
$$;

comment on function private.handle_mental_health_screen_concern() is
  'AFTER INSERT on mental_health_screens. Raises a clinician_alerts row for a moderate/high (non-crisis) concern band (§46.5) — the existing classify_and_assign_clinician_alert trigger on clinician_alerts auto-types anything matching title ilike %mental-health screen% as symptom_escalation. Crisis rows are skipped here; they already route via emergency_events from the server action.';

create trigger mental_health_screens_concern_handler
  after insert on public.mental_health_screens
  for each row execute function private.handle_mental_health_screen_concern();

revoke all on function private.classify_mental_health_screen_concern(text, text, boolean) from public;
revoke all on function private.handle_mental_health_screen_concern() from public;

do $$
begin
  if private.classify_mental_health_screen_concern('phq9', 'severe', null) is distinct from 'high' then
    raise exception 'sabotage check failed: PHQ-9 severe should classify as high concern';
  end if;
  if private.classify_mental_health_screen_concern('phq9', 'mild', null) is distinct from 'none' then
    raise exception 'sabotage check failed: PHQ-9 mild should classify as no concern';
  end if;
  if private.classify_mental_health_screen_concern('auditc', 'increasing_risk', true) is distinct from 'moderate' then
    raise exception 'sabotage check failed: hazardous AUDIT-C should classify as moderate concern';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'mental_health_screens_concern_handler'
      and tgrelid = 'public.mental_health_screens'::regclass and not tgisinternal
  ) then
    raise exception 'mental_health_screens_concern_handler trigger was not created';
  end if;

  raise notice 'PASS: mental-health screen risk-stratification classifier + trigger installed';
end $$;
