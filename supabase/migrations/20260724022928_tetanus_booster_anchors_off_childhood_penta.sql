-- Explicit ask: the adult tetanus/Td booster (tetanus_td_booster,
-- {interval_years: 10}) already existed but had no relationship to the
-- childhood Pentavalent series (child_penta, DTP-HepB-Hib), which is the
-- tetanus-toxoid-containing dose most children actually receive last, at
-- 14 weeks (the 3rd of 3 age_schedule_weeks doses). computeVaccinationStatuses
-- now supports an anchor_fallback_code on the interval_years shape: when an
-- entry has no dose of its own logged, it falls back to the last dose logged
-- under the named other catalog code. This wires child_penta in as that
-- fallback for tetanus_td_booster -- so a patient with no tetanus_td_booster
-- dose but a completed Pentavalent series gets their booster clock correctly
-- started from their last childhood dose, ten years out, rather than showing
-- "due" from day one. Once a real tetanus_td_booster dose is ever logged, the
-- fallback stops being consulted (the entry anchors off its own history from
-- then on).
update public.vaccination_catalog
  set recommended_age = recommended_age || '{"anchor_fallback_code": "child_penta"}'::jsonb
  where code = 'tetanus_td_booster'
    and not (recommended_age ? 'anchor_fallback_code');
