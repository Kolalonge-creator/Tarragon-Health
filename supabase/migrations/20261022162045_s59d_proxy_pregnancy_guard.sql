-- S59d part 4 of 4: pregnancy answers are the person's own (founder decision on OQ-S59d-05, 2026-10-22).
--
-- A symptom check run by someone else for the person (logged_by_profile_id is set and differs from patient_id: the acting-for or
-- dependant flow) can neither be the pregnancy pathway nor carry the "pregnant" history answer. The app already refuses both before the
-- engine runs (run-step.ts, getActivePathway) and the pickers do not offer the pathway; this puts the same rule in the database so a
-- direct write cannot bypass it:
--   * presenting_complaint_key = 'pregnancy_danger_signs' with a different logger: refused (42501);
--   * a "pregnant" entry in initial_capture.relevantHistory with a different logger: removed from the stored capture (the check is
--     recorded, the pregnancy answer is not).
-- The person themselves (no logger, or the same id) is untouched. Existing rows are not rewritten. Nothing is signed or switched on.
--
-- ROWS AFFECTED: none changed (insert-time trigger only).

create or replace function private.symptom_assessment_proxy_pregnancy_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.logged_by_profile_id is null or new.logged_by_profile_id = new.patient_id then
    return new;
  end if;
  if new.presenting_complaint_key = 'pregnancy_danger_signs' then
    raise exception 'pregnancy questions can only be answered by the person themselves' using errcode = '42501';
  end if;
  if jsonb_typeof(new.initial_capture -> 'relevantHistory') = 'array' then
    new.initial_capture := jsonb_set(
      new.initial_capture, '{relevantHistory}',
      coalesce((select jsonb_agg(e) from jsonb_array_elements(new.initial_capture -> 'relevantHistory') e where e <> '"pregnant"'::jsonb), '[]'::jsonb));
  end if;
  return new;
end $$;
revoke all on function private.symptom_assessment_proxy_pregnancy_guard() from public, anon, authenticated;

drop trigger if exists symptom_triage_assessments_02_proxy_pregnancy on public.symptom_triage_assessments;
create trigger symptom_triage_assessments_02_proxy_pregnancy
  before insert on public.symptom_triage_assessments
  for each row execute function private.symptom_assessment_proxy_pregnancy_guard();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'symptom_triage_assessments_02_proxy_pregnancy' and not tgisinternal) then
    raise exception 'S59d assertion: the proxy pregnancy trigger is missing';
  end if;
  if has_function_privilege('anon', 'private.symptom_assessment_proxy_pregnancy_guard()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.symptom_assessment_proxy_pregnancy_guard()', 'EXECUTE') then
    raise exception 'S59d assertion: an API role can execute the proxy pregnancy guard';
  end if;
end $$;
