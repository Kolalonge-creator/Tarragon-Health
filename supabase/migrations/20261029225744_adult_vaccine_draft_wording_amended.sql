-- Adult vaccine drafts: amended wording for the CMO to read and sign (owed sign-off vaccination_adult_drafts).
--
-- The three drafts from 20261029184035 stay INACTIVE. This only changes their description text, to close three gaps found on
-- reading them against WHO guidance (not against the current NPHCDA table, which has not been seen):
--   Td: the 10-year booster is stated as a Tarragon policy choice, because WHO does not require adult boosters after the
--       childhood series; wounds and pregnancy are named as clinician decisions this reminder does not handle.
--   Hepatitis B: "not immune" is defined by an antibody (anti-HBs) result plus no sign of current or past infection; the
--       surface antigen screen alone does not show immunity.
--   Yellow fever: one dose is treated as lifelong (WHO), so no booster is reminded; the usual exclusions are listed for a clinician check.
-- Each description still says the wording awaits the CMO's verification. Signing the owed item records that verification; it
-- does not switch anything on. recommended_age is untouched, so no reader of that column can be affected.
--
-- Counts before writing (live, read-only 2026-10-29): the three rows exist and are inactive; no vaccination_schedules rows
-- reference them, so no patient is affected by a text change.

update public.vaccination_catalog
   set description = 'Adult tetanus and diphtheria (Td) booster every 10 years. This 10-year interval is a Tarragon policy choice: WHO does not require adult boosters after the childhood series. When no Td dose is recorded, the 10-year clock starts from the last childhood tetanus booster. A deep or dirty wound, or pregnancy, is a clinician decision and is not handled by this reminder. Amended 2026-10-29, awaiting the CMO''s verification against the NPHCDA and WHO table.'
 where code = 'tetanus_td_booster' and not is_active;

update public.vaccination_catalog
   set description = 'Three doses at 0, 1 and 6 months for adults from 18 who are not immune. Not immune means a clinician has seen a negative hepatitis B surface antibody (anti-HBs) result and no sign of current or past infection (surface antigen and core antibody). The surface antigen screen alone does not show immunity. Offer after those tests, not before. Amended 2026-10-29, awaiting the CMO''s verification against the NPHCDA and WHO table.'
 where code = 'hepatitis_b_adult' and not is_active;

update public.vaccination_catalog
   set description = 'One dose for an adult with no yellow fever vaccination on record. WHO treats one dose as lifelong, so no booster is reminded. This is a live vaccine: a clinician checks first for age 60 or over, pregnancy or breastfeeding, HIV or other immune suppression, thymus disease, or a severe egg allergy. Amended 2026-10-29, awaiting the CMO''s verification against the NPHCDA and WHO table.'
 where code = 'yellow_fever_adult' and not is_active;

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.vaccination_catalog
   where code in ('tetanus_td_booster', 'hepatitis_b_adult', 'yellow_fever_adult') and not is_active and description like '%Amended 2026-10-29%';
  if v_n <> 3 then raise exception 'expected the three adult vaccine drafts amended and still inactive, found %', v_n; end if;
  if exists (select 1 from public.vaccination_schedules s join public.vaccination_catalog c on c.id = s.vaccination_catalog_id
              where c.code in ('tetanus_td_booster', 'hepatitis_b_adult', 'yellow_fever_adult')) then
    raise exception 'a patient schedule references an inactive draft';
  end if;
end $$;
