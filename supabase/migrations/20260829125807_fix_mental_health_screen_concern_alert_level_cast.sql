-- Fix: the live smoke test on 20260829091000_mental_health_screen_risk_stratification.sql
-- caught "column level is of type public.alert_level but expression is of
-- type text" — the CASE expression's branches need an explicit cast, the
-- same class of bug CLAUDE.md's own history has hit before with enum casts.

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
    (case v_concern when 'high' then 'urgent_escalation' else 'clinician_review' end)::public.alert_level,
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

revoke all on function private.handle_mental_health_screen_concern() from public;
