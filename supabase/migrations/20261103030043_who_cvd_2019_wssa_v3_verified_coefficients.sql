-- WHO 2019 cardiovascular risk charts, Western sub-Saharan Africa: version 3 with VERIFIED coefficients. UNSIGNED, INACTIVE. NOT A SIGNATURE.
--
-- Closes the coefficient gap of OQ-S45-1 / OQ-S47-1. v1 and v2 of who_cvd_2019_wssa carried null models because the Lancet appendix had not
-- been obtained. It has now (docs/clinical/who-cvd-2019-wssa-coefficients.md records the URLs, SHA-256 hashes and licence), and it turned out
-- that the published charts are NOT one Cox model per region. They are the pooled Emerging Risk Factors Collaboration Cox models for
-- myocardial infarction and for stroke (appendix 1 Table 1.6), each recalibrated to the region on the complementary log-log scale with an
-- intercept and slope fitted to GBD 2017 incidence (the authors' program whocvdrisk, Kaptoge and Pennells, University of Cambridge), then
-- combined as 1 - (1 - p_mi) * (1 - p_stroke). So v3 carries that shape ('two_endpoint_recalibrated'); the engine in @tarragon/clinical and
-- the Zod parser in apps/web accept it alongside the older single-model shape, and sign_risk_instrument's completeness check is widened below.
--
-- Every number below was extracted by script from the authors' published files (nothing typed from memory) and the result reproduces all
-- 2100 cells of the published Western sub-Saharan Africa charts exactly (Jest: packages/clinical/src/risk/who-cvd-2019-wssa-charts.test.ts).
-- Nigeria is listed under Western Sub-Saharan Africa in appendix 1 p 39, so regionCheckedForNigeria is true.
--
-- What this migration does NOT do: sign anything, activate anything, or touch the go-live guard risk_instrument_who2019_enabled. The CMO
-- signs v3 with public.sign_risk_instrument(<v3 id>) from chat, then switches the guard on. Bands, age range, cut-offs, reassessment rules and
-- bandActions are copied from v2 unchanged (asserted at the end).

-- who-cvd-v3-config-begin
insert into public.risk_instrument_versions (code, version, notes, config)
values ('who_cvd_2019_wssa', 3,
  'PROPOSED, UNSIGNED. v2 plus VERIFIED coefficients: WHO 2019 charts, Western sub-Saharan Africa, two recalibrated endpoints (MI and stroke) per sex and model, from the Lancet 2019 appendix and the authors'' whocvdrisk program (GBD 2017 region recalibration). Reproduces all 2100 published chart cells. Nigeria confirmed in the region. Provenance: docs/clinical/who-cvd-2019-wssa-coefficients.md. Needs the CMO''s signature before any real person is scored.',
  $json$
{
 "instrument": "who_cvd_2019_wssa",
 "regionLabel": "Western sub-Saharan Africa",
 "regionCheckedForNigeria": true,
 "coefficientsVerified": true,
 "ageRange": {
  "min": 40,
  "max": 74
 },
 "bands": [
  {
   "code": "lt5",
   "lowPct": 0,
   "highPct": 5,
   "tier": "low"
  },
  {
   "code": "5to10",
   "lowPct": 5,
   "highPct": 10,
   "tier": "low_moderate"
  },
  {
   "code": "10to20",
   "lowPct": 10,
   "highPct": 20,
   "tier": "moderate"
  },
  {
   "code": "20to30",
   "lowPct": 20,
   "highPct": 30,
   "tier": "high"
  },
  {
   "code": "ge30",
   "lowPct": 30,
   "highPct": null,
   "tier": "very_high"
  }
 ],
 "nonLabFurtherAssessmentAtOrAbovePct": 10,
 "treatmentAlreadyIndicated": {
  "systolicAtOrAbove": 160,
  "diastolicAtOrAbove": 100,
  "establishedCvd": true
 },
 "knownDiabetes": "route_to_diabetes_pathway",
 "models": {
  "lab": {
   "male": {
    "shape": "two_endpoint_recalibrated",
    "mi": {
     "baselineSurvival": 0.9540108,
     "terms": [
      {
       "coef": 0.0719227,
       "factors": [
        {
         "var": "age",
         "center": 60
        }
       ]
      },
      {
       "coef": 0.2284944,
       "factors": [
        {
         "var": "total_chol_mmol",
         "center": 6
        }
       ]
      },
      {
       "coef": 0.0132183,
       "factors": [
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": 0.6410114,
       "factors": [
        {
         "var": "diabetes",
         "center": 0
        }
       ]
      },
      {
       "coef": 0.5638109,
       "factors": [
        {
         "var": "smoker",
         "center": 0
        }
       ]
      },
      {
       "coef": -0.0045806,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "total_chol_mmol",
         "center": 6
        }
       ]
      },
      {
       "coef": -0.0001576,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": -0.0124966,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "diabetes",
         "center": 0
        }
       ]
      },
      {
       "coef": -0.0182545,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "smoker",
         "center": 0
        }
       ]
      }
     ],
     "recalibration": {
      "intercept": -0.3095740079879761,
      "slope": 0.9497053623199463
     }
    },
    "stroke": {
     "baselineSurvival": 0.9849257,
     "terms": [
      {
       "coef": 0.0986578,
       "factors": [
        {
         "var": "age",
         "center": 60
        }
       ]
      },
      {
       "coef": 0.029526,
       "factors": [
        {
         "var": "total_chol_mmol",
         "center": 6
        }
       ]
      },
      {
       "coef": 0.0222629,
       "factors": [
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": 0.6268712,
       "factors": [
        {
         "var": "diabetes",
         "center": 0
        }
       ]
      },
      {
       "coef": 0.4981217,
       "factors": [
        {
         "var": "smoker",
         "center": 0
        }
       ]
      },
      {
       "coef": 0.00142,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "total_chol_mmol",
         "center": 6
        }
       ]
      },
      {
       "coef": -0.0004147,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": -0.026302,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "diabetes",
         "center": 0
        }
       ]
      },
      {
       "coef": -0.0150561,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "smoker",
         "center": 0
        }
       ]
      }
     ],
     "recalibration": {
      "intercept": -0.8973300457000732,
      "slope": 0.6761412024497986
     }
    }
   },
   "female": {
    "shape": "two_endpoint_recalibrated",
    "mi": {
     "baselineSurvival": 0.9894159,
     "terms": [
      {
       "coef": 0.1020713,
       "factors": [
        {
         "var": "age",
         "center": 60
        }
       ]
      },
      {
       "coef": 0.2050377,
       "factors": [
        {
         "var": "total_chol_mmol",
         "center": 6
        }
       ]
      },
      {
       "coef": 0.015823,
       "factors": [
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": 1.070358,
       "factors": [
        {
         "var": "diabetes",
         "center": 0
        }
       ]
      },
      {
       "coef": 1.053223,
       "factors": [
        {
         "var": "smoker",
         "center": 0
        }
       ]
      },
      {
       "coef": -0.0051932,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "total_chol_mmol",
         "center": 6
        }
       ]
      },
      {
       "coef": -0.0001378,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": -0.0234174,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "diabetes",
         "center": 0
        }
       ]
      },
      {
       "coef": -0.0332666,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "smoker",
         "center": 0
        }
       ]
      }
     ],
     "recalibration": {
      "intercept": -0.5290281772613525,
      "slope": 0.7057502269744873
     }
    },
    "stroke": {
     "baselineSurvival": 0.9890569,
     "terms": [
      {
       "coef": 0.1056632,
       "factors": [
        {
         "var": "age",
         "center": 60
        }
       ]
      },
      {
       "coef": 0.0257782,
       "factors": [
        {
         "var": "total_chol_mmol",
         "center": 6
        }
       ]
      },
      {
       "coef": 0.0206278,
       "factors": [
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": 0.8581998,
       "factors": [
        {
         "var": "diabetes",
         "center": 0
        }
       ]
      },
      {
       "coef": 0.7443627,
       "factors": [
        {
         "var": "smoker",
         "center": 0
        }
       ]
      },
      {
       "coef": -0.0021387,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "total_chol_mmol",
         "center": 6
        }
       ]
      },
      {
       "coef": -0.0004897,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": -0.0209826,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "diabetes",
         "center": 0
        }
       ]
      },
      {
       "coef": -0.0200822,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "smoker",
         "center": 0
        }
       ]
      }
     ],
     "recalibration": {
      "intercept": -0.8381919264793396,
      "slope": 0.6357288360595703
     }
    }
   }
  },
  "non_lab": {
   "male": {
    "shape": "two_endpoint_recalibrated",
    "mi": {
     "baselineSurvival": 0.9544258,
     "terms": [
      {
       "coef": 0.073593,
       "factors": [
        {
         "var": "age",
         "center": 60
        }
       ]
      },
      {
       "coef": 0.0337219,
       "factors": [
        {
         "var": "bmi",
         "center": 25
        }
       ]
      },
      {
       "coef": 0.0133937,
       "factors": [
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": 0.5954767,
       "factors": [
        {
         "var": "smoker",
         "center": 0
        }
       ]
      },
      {
       "coef": -0.0010432,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "bmi",
         "center": 25
        }
       ]
      },
      {
       "coef": -0.0001837,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": -0.0200831,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "smoker",
         "center": 0
        }
       ]
      }
     ],
     "recalibration": {
      "intercept": -0.36387184262275696,
      "slope": 1.0364793539047241
     }
    },
    "stroke": {
     "baselineSurvival": 0.984826,
     "terms": [
      {
       "coef": 0.097674,
       "factors": [
        {
         "var": "age",
         "center": 60
        }
       ]
      },
      {
       "coef": 0.0159518,
       "factors": [
        {
         "var": "bmi",
         "center": 25
        }
       ]
      },
      {
       "coef": 0.0227294,
       "factors": [
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": 0.4999862,
       "factors": [
        {
         "var": "smoker",
         "center": 0
        }
       ]
      },
      {
       "coef": -0.0003516,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "bmi",
         "center": 25
        }
       ]
      },
      {
       "coef": -0.0004374,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": -0.0153895,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "smoker",
         "center": 0
        }
       ]
      }
     ],
     "recalibration": {
      "intercept": -0.9692327976226807,
      "slope": 0.6512733697891235
     }
    }
   },
   "female": {
    "shape": "two_endpoint_recalibrated",
    "mi": {
     "baselineSurvival": 0.9887124,
     "terms": [
      {
       "coef": 0.1049418,
       "factors": [
        {
         "var": "age",
         "center": 60
        }
       ]
      },
      {
       "coef": 0.0257616,
       "factors": [
        {
         "var": "bmi",
         "center": 25
        }
       ]
      },
      {
       "coef": 0.016726,
       "factors": [
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": 1.093132,
       "factors": [
        {
         "var": "smoker",
         "center": 0
        }
       ]
      },
      {
       "coef": -0.0006537,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "bmi",
         "center": 25
        }
       ]
      },
      {
       "coef": -0.0001966,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": -0.0343739,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "smoker",
         "center": 0
        }
       ]
      }
     ],
     "recalibration": {
      "intercept": -0.50197434425354,
      "slope": 0.7591237425804138
     }
    },
    "stroke": {
     "baselineSurvival": 0.9885706,
     "terms": [
      {
       "coef": 0.1046105,
       "factors": [
        {
         "var": "age",
         "center": 60
        }
       ]
      },
      {
       "coef": 0.0036406,
       "factors": [
        {
         "var": "bmi",
         "center": 25
        }
       ]
      },
      {
       "coef": 0.0216741,
       "factors": [
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": 0.7399405,
       "factors": [
        {
         "var": "smoker",
         "center": 0
        }
       ]
      },
      {
       "coef": -1.29e-05,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "bmi",
         "center": 25
        }
       ]
      },
      {
       "coef": -0.0005311,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "sbp",
         "center": 120
        }
       ]
      },
      {
       "coef": -0.0203997,
       "factors": [
        {
         "var": "age",
         "center": 60
        },
        {
         "var": "smoker",
         "center": 0
        }
       ]
      }
     ],
     "recalibration": {
      "intercept": -0.7182005047798157,
      "slope": 0.663612961769104
     }
    }
   }
  }
 },
 "modelShape": "Each sex entry: { shape: 'two_endpoint_recalibrated', mi: E, stroke: E } where E = { baselineSurvival, terms: [ { coef, factors: [ { var, center } ] } ], recalibration: { intercept, slope } }. For each endpoint: p = 1 - baselineSurvival ^ exp(sum of coef * product of (var - center)); pcal = 1 - exp(-exp(intercept + slope * ln(-ln(1 - p)))). 10-year CVD risk = 1 - (1 - pcal_mi) * (1 - pcal_stroke). The older single-model shape { baselineSurvival, terms } is still accepted by the engine.",
 "reassess": {
  "afterDays": 365,
  "majorChanges": [
   "new_chronic_condition",
   "smoking_status_change",
   "bp_at_or_above_160_100"
  ]
 },
 "bandActions": {
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
 },
 "provenance": {
  "paper": "The WHO CVD Risk Chart Working Group. World Health Organization cardiovascular disease risk charts: revised models to estimate risk in 21 global regions. Lancet Glob Health 2019;7:e1332-45. doi:10.1016/S2214-109X(19)30318-3",
  "paperLicence": "CC BY 4.0 (article copyright line: '(c) 2019 The Author(s). Published by Elsevier Ltd. This is an Open Access article under the CC BY 4.0 license.')",
  "coreModel": "Pooled Cox log hazard ratios and 10-year baseline survivals from the Emerging Risk Factors Collaboration (appendix 1 Table 1.6 to 7 decimal places; baseline survivals to 7 decimal places from the authors' program, the paper's Table 2 gives them to 3)",
  "recalibration": "Western sub-Saharan Africa (GBD region 5), target year 2017, region-level ('cal2') intercept and slope per sex, endpoint and model, from the authors' program whocvdrisk (Kaptoge S, Pennells L; Cardiovascular Epidemiology Unit, University of Cambridge), file whocvdrisk_t10_calparms_gbd_sens0.dta, row ccode = A01GBDR_005_WSSA, year = 2017",
  "sourceFiles": {
   "appendix1": {
    "url": "https://ars.els-cdn.com/content/image/1-s2.0-S2214109X19303183-mmc1.pdf",
    "sha256": "92b52f66f2d7f4f3cb207d7dbedb14975c758a9e97f09e7982f5d4294ec9cf80"
   },
   "appendix2Charts": {
    "url": "https://ars.els-cdn.com/content/image/1-s2.0-S2214109X19303183-mmc2.pdf",
    "sha256": "68ab741131d86897542a3b8e8598f185c34e2d66234b14ae97881667ddc1ca17"
   },
   "whocvdrisk_erfc_score_v03.ado": {
    "url": "https://raw.githubusercontent.com/skkceu/stata/main/whocvdrisk_erfc_score_v03.ado",
    "sha256": "e1a395eb4ccb6e25d2a7704862c6fad6a51fed5995fbf1f23417882753db0e16"
   },
   "whocvdrisk_t10_calparms_gbd_sens0.dta": {
    "url": "https://raw.githubusercontent.com/skkceu/stata/main/whocvdrisk_t10_calparms_gbd_sens0.dta",
    "sha256": "684963c2670993450cb0d8c9cd9a9a7ae5c0bc7681e4430e06f6986a49055910"
   }
  },
  "nigeriaRegion": "Appendix 1 p 39 lists Nigeria under Western Sub-Saharan Africa",
  "chartReproduction": "All 2100 cells of the published Western sub-Saharan Africa charts (appendix 2 pp 5 and 27) are reproduced exactly, using the cell midpoints age 42.5..72.5, SBP 110/130/150/170/190, total cholesterol 3.5/4.5/5.5/6.5/7.5 mmol/L, BMI 17.5/22.5/27.5/32.5/37.5 kg/m2",
  "note": "docs/clinical/who-cvd-2019-wssa-coefficients.md"
 }
}
$json$::jsonb);
-- who-cvd-v3-config-end

-- Completeness of one sex entry, shared by the signing function and the proofs. True for either accepted shape, and the same rule the
-- engine applies (baseline survival strictly between 0 and 1, at least one term, a positive slope), so the database cannot sign a version the
-- engine would refuse. Every branch is coalesced to false: a missing key yields SQL NULL, and `if not NULL` in plpgsql would silently skip
-- the refusal (the proof's sabotage step caught this).
create or replace function private.risk_cox_model_complete(p_model jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_model) = 'object'
    and jsonb_typeof(p_model -> 'baselineSurvival') = 'number'
    and (p_model ->> 'baselineSurvival')::numeric > 0 and (p_model ->> 'baselineSurvival')::numeric < 1
    and jsonb_typeof(p_model -> 'terms') = 'array'
    and (case when jsonb_typeof(p_model -> 'terms') = 'array' then jsonb_array_length(p_model -> 'terms') else 0 end) > 0, false)
$$;
revoke all on function private.risk_cox_model_complete(jsonb) from public, anon, authenticated;

create or replace function private.risk_sex_model_complete(p_model jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    private.risk_cox_model_complete(p_model)
    or (
      p_model ->> 'shape' = 'two_endpoint_recalibrated'
      and (select bool_and(coalesce(
             private.risk_cox_model_complete(p_model -> ep)
             and jsonb_typeof(p_model -> ep -> 'recalibration' -> 'intercept') = 'number'
             and jsonb_typeof(p_model -> ep -> 'recalibration' -> 'slope') = 'number'
             and (p_model -> ep -> 'recalibration' ->> 'slope')::numeric > 0, false))
           from unnest(array['mi', 'stroke']) as ep)
    ), false)
$$;
revoke all on function private.risk_sex_model_complete(jsonb) from public, anon, authenticated;

-- Redefined from the LIVE body (pg_get_functiondef, 2026-11-03); the only change is the completeness check, which now accepts both shapes.
create or replace function public.sign_risk_instrument(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid; v_cfg jsonb; v_code text; v_m text; v_s text;
begin
  select config, code into v_cfg, v_code from public.risk_instrument_versions where id = p_id;
  if v_cfg is null then raise exception 'Risk instrument version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign a risk instrument'; end if;
  if coalesce((v_cfg ->> 'coefficientsVerified')::boolean, false) is not true then
    raise exception 'coefficients_not_verified: this version has no verified coefficients, so there is nothing to sign';
  end if;
  foreach v_m in array array['lab', 'non_lab'] loop
    foreach v_s in array array['male', 'female'] loop
      if not private.risk_sex_model_complete(v_cfg -> 'models' -> v_m -> v_s) then
        raise exception 'coefficients_missing: model % for % is not complete', v_m, v_s;
      end if;
    end loop;
  end loop;
  update public.risk_instrument_versions set is_active = false where code = v_code and is_active and id <> p_id;
  update public.risk_instrument_versions set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('risk_instrument.signed', 'risk_instrument_versions', p_id, jsonb_build_object('code', v_code));
  return p_id;
end $$;
revoke all on function public.sign_risk_instrument(uuid) from public, anon;
grant execute on function public.sign_risk_instrument(uuid) to authenticated;

do $$
declare v2 jsonb; v3 jsonb; k text;
begin
  select config into v2 from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 2;
  select config into v3 from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 3;
  if v3 is null then raise exception 'self-check: v3 missing'; end if;
  if exists (select 1 from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 3 and (is_active or approved_by is not null)) then
    raise exception 'self-check: v3 must be unsigned and inactive';
  end if;
  if private.risk_instrument_signed('who_cvd_2019_wssa') then raise exception 'self-check: the instrument must stay unsigned'; end if;
  if (v3 ->> 'coefficientsVerified')::boolean is not true or (v3 ->> 'regionCheckedForNigeria')::boolean is not true then
    raise exception 'self-check: v3 must say coefficientsVerified and regionCheckedForNigeria';
  end if;
  foreach k in array array['bands', 'ageRange', 'reassess', 'bandActions', 'nonLabFurtherAssessmentAtOrAbovePct', 'treatmentAlreadyIndicated', 'knownDiabetes', 'instrument', 'regionLabel'] loop
    if v3 -> k is distinct from v2 -> k then raise exception 'self-check: v3.% must equal v2.%', k, k; end if;
  end loop;
  if not (private.risk_sex_model_complete(v3 #> '{models,lab,male}') and private.risk_sex_model_complete(v3 #> '{models,lab,female}')
          and private.risk_sex_model_complete(v3 #> '{models,non_lab,male}') and private.risk_sex_model_complete(v3 #> '{models,non_lab,female}')) then
    raise exception 'self-check: every v3 sex model must be complete';
  end if;
  if private.risk_sex_model_complete(v2 #> '{models,lab,male}') then raise exception 'self-check: a null model must not count as complete'; end if;
  -- the lab model carries 9 terms per endpoint (5 main effects, 4 age interactions), the non-lab model 7 (4 and 3)
  if jsonb_array_length(v3 #> '{models,lab,male,mi,terms}') <> 9 or jsonb_array_length(v3 #> '{models,non_lab,female,stroke,terms}') <> 7 then
    raise exception 'self-check: unexpected term counts';
  end if;
end $$;
