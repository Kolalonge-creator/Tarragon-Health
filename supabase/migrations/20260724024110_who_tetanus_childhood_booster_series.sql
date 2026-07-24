-- Explicit ask: model WHO's full lifetime tetanus toxoid-containing vaccine
-- (TTCV) schedule "correctly and to standard" -- 6 total doses across a
-- lifetime: the 3-dose infant Pentavalent series (child_penta, already
-- seeded, unchanged) plus 3 further childhood boosters, before the adult
-- 10-year cadence (tetanus_td_booster) begins. Per WHO's routine
-- immunization schedule guidance, the 3 childhood boosters fall in these
-- windows (this migration schedules each at the EARLIEST age in its window,
-- same convention as every other age_schedule_weeks row in this catalogue,
-- e.g. child_measles's 9-month dose is WHO's earliest recommended age, not
-- a midpoint):
--   - Booster 1: 12-23 months  -> scheduled at 18 months (78 weeks)
--   - Booster 2: 4-7 years     -> scheduled at 4 years (208 weeks)
--   - Booster 3: 9-15 years    -> scheduled at 9 years (469 weeks, same
--     week-number convention already used by child_hpv_girls for "9 years")
-- Week numbers use this catalogue's existing floor(days / 7) rounding at
-- 365.25 days/year (packages/shared/src/index.ts's ageFromDateOfBirth
-- constant) for internal consistency with every other row.
-- max_age_years on each is a generous catch-up ceiling beyond WHO's own
-- window (same "clinical decision, not automatic" precedent as every other
-- childhood row's max_age_years), not itself a WHO-defined cutoff.
--
-- This is the platform's best current modelling of WHO guidance, not
-- asserted as exhaustive or independently clinically verified -- same
-- "provisional, confirm before launch" posture as this codebase's other
-- clinical-protocol defaults (see CLAUDE.md's Clinical Tier Ladder section).
insert into public.vaccination_catalog (code, name, description, recommended_age)
values
  ('child_tetanus_booster_1', 'Tetanus Booster — 18 Months',
     'WHO-recommended childhood tetanus booster, typically given between 12 and 23 months.',
     '{"age_schedule_weeks": [78], "max_age_years": 3}'::jsonb),
  ('child_tetanus_booster_2', 'Tetanus Booster — 4 to 7 Years',
     'WHO-recommended childhood tetanus booster, typically given between 4 and 7 years.',
     '{"age_schedule_weeks": [208], "max_age_years": 8}'::jsonb),
  ('child_tetanus_booster_3', 'Tetanus Booster — 9 to 15 Years',
     'WHO-recommended childhood tetanus booster, typically given between 9 and 15 years -- the last dose before the adult 10-year booster cycle begins.',
     '{"age_schedule_weeks": [469], "max_age_years": 16}'::jsonb)
on conflict (code) do nothing;

-- Repoint the adult booster's fallback anchor from the infant Pentavalent
-- dose to the LAST stage of the now-complete WHO series -- anchoring off an
-- earlier partial stage would compute a next-due date years before a
-- still-outstanding later childhood booster is actually due (see the
-- updated doc comment on computeVaccinationStatuses for the full reasoning).
update public.vaccination_catalog
  set recommended_age = recommended_age || '{"anchor_fallback_code": "child_tetanus_booster_3"}'::jsonb
  where code = 'tetanus_td_booster';
