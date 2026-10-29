-- Follow-up to 20261029183817 (found by /code-review high before the PR). Activating mammography with
-- is_optional = false made computeScreeningRecommendations (the app-driven scheduling path, which reads
-- screen_types.is_active) recommend it to every woman aged 40-74 alongside breast_imaging, the exact
-- doubled-reminder defect 20260917222259 fixed. An OPTIONAL screen (like psa and dental_check) is offered on
-- the patient's optional-screenings card and printable on request, and is not recommended as "due".
-- 0 mammography screening_schedules rows existed when this was applied, so no data needs cancelling.
update public.screen_types set is_optional = true where code = 'mammography';

do $$
begin
  if not exists (select 1 from public.screen_types where code = 'mammography' and is_active and is_optional) then
    raise exception 'mammography must be active and optional';
  end if;
  if exists (select 1 from public.screening_schedules where screen_type_id = (select id from public.screen_types where code = 'mammography')) then
    raise exception 'mammography has schedules; cancel them before making it optional';
  end if;
end $$;
