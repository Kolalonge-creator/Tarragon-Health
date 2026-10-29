-- Mammography becomes an available (optional) screen type. Founder/CMO decision 2026-10-29: the patient takes the
-- printed request to the nearest imaging centre, or to a partner lab once one offers it.
-- breast_imaging (ultrasound under 40, mammogram 40+) stays the one AUTO-SCHEDULED breast item in rule set v3; the
-- signed rule set has no mammography rule, so activating the type creates no schedule and no duplicate reminder.
-- clinical_breast_exam stays inactive: it needs a clinician, has no price and no where-to-get guidance.
update public.screen_types set is_active = true where code = 'mammography' and not is_active;

do $$
begin
  if not exists (select 1 from public.screen_types where code = 'mammography' and is_active) then
    raise exception 'mammography was not activated';
  end if;
  if exists (select 1 from public.screen_types where code = 'clinical_breast_exam' and is_active) then
    raise exception 'clinical_breast_exam must stay inactive';
  end if;
  if exists (select 1 from jsonb_to_recordset((select config -> 'rules' from public.screening_rule_sets where is_active and approved_by is not null limit 1)) as r(code text) where r.code = 'mammography') then
    raise exception 'the signed rule set now schedules mammography; breast_imaging would duplicate it';
  end if;
end $$;
