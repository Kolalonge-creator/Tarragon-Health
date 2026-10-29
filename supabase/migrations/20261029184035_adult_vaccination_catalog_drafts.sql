-- Adult vaccination catalogue drafts (founder ask 2026-10-29: build the adult schedule; no influenza, no COVID-19,
-- because Nigeria does not run them). Influenza has never been in the catalogue and covid_19 is already inactive.
--
-- ALL THREE ARE INSERTED INACTIVE. vaccination_schedule_signed() is already true (the CMO signed schedule v2 on
-- 2026-10-27), so an ACTIVE row here would start generating schedules and reminders under a signature that did not
-- cover it. The CMO reads each row, verifies it against the current NPHCDA/WHO table, then activates it.
-- Evidence in every description is the assistant's drafting, NOT verified against a dated national table.
--   tetanus_td_booster : tetanus-diphtheria booster every 10 years; the clock starts from the last childhood
--                        tetanus booster when no Td dose is on file (anchor_fallback_code), as the engine documents.
--   hepatitis_b_adult  : 3-dose series at 0, 1, 6 months from age 18. It should follow the hep_b serology screen
--                        (immune or infected adults are not vaccinated); the engine does not read serology, so
--                        the CMO decides whether that rule is enforced by the clinician or by a later change.
--   yellow_fever_adult : single dose for adults with no record; Nigeria is endemic. Booster policy not stated.
-- typhoid is active in the catalogue but schedule v2 records "typhoid is not in the schedule" (founder decision
-- 2026-10-07). That conflict is left for the founder and CMO and is NOT changed here.
insert into public.vaccination_catalog (code, name, description, recommended_age, is_active)
values
  ('tetanus_td_booster', 'Tetanus and diphtheria (Td) booster',
   'DRAFT, UNVERIFIED. Adult tetanus-diphtheria booster every 10 years. The 10-year clock starts from the last childhood tetanus booster when no Td dose is recorded.',
   '{"interval_years": 10, "anchor_fallback_code": "child_tetanus_booster_3"}'::jsonb, false),
  ('hepatitis_b_adult', 'Hepatitis B (adult series)',
   'DRAFT, UNVERIFIED. Three doses at 0, 1 and 6 months for adults from 18 who are not immune. Offer after the hepatitis B surface antigen screen, not before.',
   '{"dose_schedule_months": [0, 1, 6], "min_age": 18}'::jsonb, false),
  ('yellow_fever_adult', 'Yellow fever (adult catch-up)',
   'DRAFT, UNVERIFIED. One dose for an adult with no yellow fever vaccination on record. Booster policy and exclusions to be confirmed by the CMO.',
   '{"doses": 1}'::jsonb, false)
on conflict (code) do nothing;

do $$
begin
  if (select count(*) from public.vaccination_catalog where code in ('tetanus_td_booster','hepatitis_b_adult','yellow_fever_adult') and not is_active) <> 3 then
    raise exception 'the three adult drafts must exist and be inactive';
  end if;
  if exists (select 1 from public.vaccination_catalog where is_active and (code ~* 'influenza|flu|covid')) then
    raise exception 'influenza or COVID-19 must not be active in the Nigerian catalogue';
  end if;
end $$;
