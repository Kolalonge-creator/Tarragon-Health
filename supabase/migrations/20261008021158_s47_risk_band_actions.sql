-- S47 (decisions applied, chat selections 2026-10-07). NOT SIGNATURES.
--
-- What this does:
--   (Share-link defaults, a default view cap on create_record_share, are NOT here: S09x owns share links, decided 2026-10-16 when this stack was merged with main-dev.)
--   1. S45 risk band actions as UNSIGNED versioned config: risk_instrument_versions v2 for who_cvd_2019_wssa = v1 config plus bandActions. The
--      instrument itself stays held (coefficients missing, sign_risk_instrument refuses it). The app never prescribes (INV-02): the actions say
--      "review", never "start a medicine". Thresholds are NOT verified against WHO PEN / HEARTS.

insert into public.risk_instrument_versions (code, version, notes, config)
select 'who_cvd_2019_wssa', 2,
  'PROPOSED, UNSIGNED. v1 plus bandActions (S47, chat selections 2026-10-07, not a signature). Coefficients are still missing, so this version cannot be signed. The action thresholds are not verified against WHO PEN / HEARTS. The app never prescribes: every action says review.',
  v1.config || jsonb_build_object('bandActions', $json${
 "appPrescribes": false,
 "thresholdsStatus": "unverified_against_who_pen_hearts",
 "bands": {
  "lt5": {
   "copyKey": "risk.action.lt5",
   "lifestyleAdvice": true,
   "reassessMonths": 12
  },
  "5to10": {
   "copyKey": "risk.action.5to10",
   "lifestyleAdvice": true,
   "bpCheckEveryMonths": 6
  },
  "10to20": {
   "copyKey": "risk.action.10to20",
   "careTeamReviewWithinWeeks": 4,
   "recheckEveryMonths": 3,
   "doctorDecidesAboutMedicines": true
  },
  "20to30": {
   "copyKey": "risk.action.20to30",
   "doctorReviewWithinWeeks": 2,
   "recheckEveryMonths": 3
  },
  "ge30": {
   "copyKey": "risk.action.ge30",
   "doctorReviewWithinWeeks": 1
  }
 }
}$json$::jsonb)
from public.risk_instrument_versions v1 where v1.code = 'who_cvd_2019_wssa' and v1.version = 1;
-- risk-band-actions-end

do $$
begin
  if exists (select 1 from public.risk_instrument_versions where version = 2 and (is_active or approved_by is not null)) then raise exception 'S47 self-check: instrument v2 must be unsigned'; end if;
  if private.risk_instrument_signed('who_cvd_2019_wssa') then raise exception 'S47 self-check: the instrument must stay unsigned'; end if;
end $$;
