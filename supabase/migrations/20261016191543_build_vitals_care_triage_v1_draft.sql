-- Single-reading dangerous vitals (pulse, SpO2, temperature): vitals_care_triage version 1, a DRAFT. NOT SIGNED.
--
-- Closes the narrow clinical coverage gap left after blood pressure (bp_care_triage) and glucose (glucose_care_triage): a dangerous heart rate, oxygen
-- saturation or temperature was caught only by three older SQL triggers (private.handle_pulse_reading_red_flag, handle_spo2_reading_red_flag,
-- handle_temperature_reading_red_flag) that no rule set, no signature and no phone shares. This is ONE combined rule set, because the three
-- metrics share one shape (a single reading, no symptoms, no repeat flow) and one signature is easier for the CMO to give than three.
--
-- The numbers are the live values of private.classify_pulse_level, classify_spo2_level and classify_temperature_level, read with pg_get_functiondef
-- on 2026-10-16 (pulse emergency <= 35 or >= 150, red 36-39 or 121-149, amber 40-49 or 101-120; SpO2 emergency < 90, red 90-92, amber 93-94;
-- temperature emergency >= 40.0 or < 35.0, red >= 39.0, amber >= 38.0), taken over as PROPOSED starting values so the divergence report compares like
-- with like. Their guideline basis is in docs/research/build-vitals-rule-sets.md. Two differences from the older triggers are deliberate and are
-- listed for the CMO on the sign-off hub: a value outside the physically possible range is rejected as a typo, and a fast heart rate (101 to 149) is
-- routed to a clinician (amber) for a patient under 18. The emergency bands apply to everyone.
--
-- The JSON below is the SAME object as VITALS_CARE_V1 in packages/clinical/src/rules/vitals-care-v1.ts; packages/clinical/src/vitals-drift.test.ts
-- parses this file and fails if the two differ, and the PROPOSED config key triage.single_reading_vitals_bands is held equal to its params.
--
-- WHAT THIS CHANGES IN LIVE BEHAVIOUR: nothing. A draft grades in SHADOW (triage_events.shadow = true; the task and paging subscribers ignore shadow
-- events) and the three older triggers keep running, the same "both run until parity is shown" rule the CMO gave for blood pressure (Q1) and applied
-- to glucose. Signing is the Chief Medical Officer's act through approve_triage_rule_set, from the sign-off hub; an agent never signs it.
--
-- ALSO HERE: the task type the draft's amber reviews need, amber_vitals_review, created with needs_confirmation = true so the CMO confirms it
-- (public.confirm_task_type) before the rule set can be signed (approve_triage_rule_set only counts a task type this rule set can create, OQ-334).
-- It is active and creatable but nothing creates one while the rule set is a draft.

insert into public.triage_rule_sets (code, version, status, rules, note)
values (
  'vitals_care_triage', 1, 'draft',
  $rules_json${
 "code": "vitals_care_triage",
 "version": 1,
 "status": "draft",
 "params": {
  "validation": {
   "pulseMin": 10,
   "pulseMax": 300,
   "spo2Min": 30,
   "spo2Max": 100,
   "temperatureMin": 20,
   "temperatureMax": 46
  },
  "minAdultAgeYears": 18,
  "pulse": {
   "emergencyAtOrBelow": 35,
   "emergencyAtOrAbove": 150,
   "redAtOrBelow": 39,
   "redAtOrAbove": 121,
   "amberAtOrBelow": 49,
   "amberAtOrAbove": 101
  },
  "spo2": {
   "emergencyBelow": 90,
   "redAtOrBelow": 92,
   "amberAtOrBelow": 94
  },
  "temperature": {
   "emergencyAtOrAbove": 40,
   "emergencyBelow": 35,
   "redAtOrAbove": 39,
   "amberAtOrAbove": 38
  },
  "rejected": {
   "explanationKey": "VIT-T04"
  }
 },
 "rules": [
  {
   "id": "VT-PU1",
   "description": "Heart rate 35 or below, or 150 or above: severe slow or fast heart rate, for everyone",
   "triggers": [
    "pulse"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "VIT-E01",
   "when": {
    "any": [
     {
      "field": "pulse.bpm",
      "op": "lte",
      "value": {
       "ref": "params.pulse.emergencyAtOrBelow"
      }
     },
     {
      "field": "pulse.bpm",
      "op": "gte",
      "value": {
       "ref": "params.pulse.emergencyAtOrAbove"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "VIT-E01"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "VT-PU2",
   "description": "Heart rate 36 to 39 at any age, or 121 to 149 in an adult: same-day care",
   "triggers": [
    "pulse"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "VIT-E02",
   "when": {
    "any": [
     {
      "field": "pulse.bpm",
      "op": "lte",
      "value": {
       "ref": "params.pulse.redAtOrBelow"
      }
     },
     {
      "all": [
       {
        "field": "pulse.bpm",
        "op": "gte",
        "value": {
         "ref": "params.pulse.redAtOrAbove"
        }
       },
       {
        "not": {
         "field": "age",
         "op": "lt",
         "value": {
          "ref": "params.minAdultAgeYears"
         }
        }
       }
      ]
     }
    ]
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "VIT-E02"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "VT-PU3",
   "description": "Heart rate 101 or above in a patient under 18 (and not an emergency): adult fast-rate bands do not apply, routed to a clinician",
   "triggers": [
    "pulse"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "VIT-T03",
   "when": {
    "all": [
     {
      "field": "age",
      "op": "lt",
      "value": {
       "ref": "params.minAdultAgeYears"
      }
     },
     {
      "field": "pulse.bpm",
      "op": "gte",
      "value": {
       "ref": "params.pulse.amberAtOrAbove"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "VIT-T03"
    },
    {
     "kind": "route_referral",
     "reason": "age"
    },
    {
     "kind": "create_task",
     "task": "referral_review",
     "dueMinutes": 1440,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "week"
  },
  {
   "id": "VT-PU4",
   "description": "Heart rate 40 to 49, or 101 to 120: review needed",
   "triggers": [
    "pulse"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "VIT-T01",
   "when": {
    "any": [
     {
      "field": "pulse.bpm",
      "op": "lte",
      "value": {
       "ref": "params.pulse.amberAtOrBelow"
      }
     },
     {
      "field": "pulse.bpm",
      "op": "gte",
      "value": {
       "ref": "params.pulse.amberAtOrAbove"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "VIT-T01"
    },
    {
     "kind": "create_task",
     "task": "amber_vitals_review",
     "dueMinutes": 4320,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "week"
  },
  {
   "id": "VT-PU5",
   "description": "Heart rate 50 to 100 and nothing above matched: reading saved",
   "triggers": [
    "pulse"
   ],
   "result": "grade",
   "grade": "green",
   "explanationKey": "VIT-T02",
   "when": {
    "all": [
     {
      "field": "pulse.bpm",
      "op": "gt",
      "value": {
       "ref": "params.pulse.amberAtOrBelow"
      }
     },
     {
      "field": "pulse.bpm",
      "op": "lt",
      "value": {
       "ref": "params.pulse.amberAtOrAbove"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "VIT-T02"
    }
   ]
  },
  {
   "id": "VT-OX1",
   "description": "SpO2 under 90 percent: low oxygen, emergency",
   "triggers": [
    "spo2"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "VIT-E01",
   "when": {
    "field": "spo2.pct",
    "op": "lt",
    "value": {
     "ref": "params.spo2.emergencyBelow"
    }
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "VIT-E01"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "VT-OX2",
   "description": "SpO2 90 to 92 percent: low oxygen, same-day care",
   "triggers": [
    "spo2"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "VIT-E02",
   "when": {
    "field": "spo2.pct",
    "op": "lte",
    "value": {
     "ref": "params.spo2.redAtOrBelow"
    }
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "VIT-E02"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "VT-OX3",
   "description": "SpO2 93 to 94 percent: below target, review needed",
   "triggers": [
    "spo2"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "VIT-T01",
   "when": {
    "field": "spo2.pct",
    "op": "lte",
    "value": {
     "ref": "params.spo2.amberAtOrBelow"
    }
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "VIT-T01"
    },
    {
     "kind": "create_task",
     "task": "amber_vitals_review",
     "dueMinutes": 4320,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "week"
  },
  {
   "id": "VT-OX4",
   "description": "SpO2 at or below the patient's own clinician-set amber line (only ever turns a green amber)",
   "triggers": [
    "spo2"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "VIT-T01",
   "when": {
    "all": [
     {
      "field": "spo2.pct",
      "op": "gt",
      "value": {
       "ref": "params.spo2.amberAtOrBelow"
      }
     },
     {
      "field": "spo2.pct",
      "op": "lte",
      "value": {
       "ref": "spo2.personalAmberAtOrBelow"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "VIT-T01"
    },
    {
     "kind": "create_task",
     "task": "amber_vitals_review",
     "dueMinutes": 4320,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "week"
  },
  {
   "id": "VT-OX5",
   "description": "SpO2 95 percent or more and nothing above matched: reading saved",
   "triggers": [
    "spo2"
   ],
   "result": "grade",
   "grade": "green",
   "explanationKey": "VIT-T02",
   "when": {
    "field": "spo2.pct",
    "op": "gt",
    "value": {
     "ref": "params.spo2.amberAtOrBelow"
    }
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "VIT-T02"
    }
   ]
  },
  {
   "id": "VT-TE1",
   "description": "Temperature 40.0 or above, or under 35.0: dangerously high or low, emergency",
   "triggers": [
    "temperature"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "VIT-E01",
   "when": {
    "any": [
     {
      "field": "temperature.c",
      "op": "gte",
      "value": {
       "ref": "params.temperature.emergencyAtOrAbove"
      }
     },
     {
      "field": "temperature.c",
      "op": "lt",
      "value": {
       "ref": "params.temperature.emergencyBelow"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "VIT-E01"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "VT-TE2",
   "description": "Temperature 39.0 to 39.9: high fever, same-day care",
   "triggers": [
    "temperature"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "VIT-E02",
   "when": {
    "field": "temperature.c",
    "op": "gte",
    "value": {
     "ref": "params.temperature.redAtOrAbove"
    }
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "VIT-E02"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "VT-TE3",
   "description": "Temperature 38.0 to 38.9: fever, review needed",
   "triggers": [
    "temperature"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "VIT-T01",
   "when": {
    "field": "temperature.c",
    "op": "gte",
    "value": {
     "ref": "params.temperature.amberAtOrAbove"
    }
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "VIT-T01"
    },
    {
     "kind": "create_task",
     "task": "amber_vitals_review",
     "dueMinutes": 4320,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "week"
  },
  {
   "id": "VT-TE4",
   "description": "Temperature at or above the patient's own clinician-set amber line (only ever turns a green amber)",
   "triggers": [
    "temperature"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "VIT-T01",
   "when": {
    "all": [
     {
      "field": "temperature.c",
      "op": "lt",
      "value": {
       "ref": "params.temperature.amberAtOrAbove"
      }
     },
     {
      "field": "temperature.c",
      "op": "gte",
      "value": {
       "ref": "temperature.personalAmberAtOrAbove"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "VIT-T01"
    },
    {
     "kind": "create_task",
     "task": "amber_vitals_review",
     "dueMinutes": 4320,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "week"
  },
  {
   "id": "VT-TE5",
   "description": "Temperature 35.0 to 37.9 and nothing above matched: reading saved",
   "triggers": [
    "temperature"
   ],
   "result": "grade",
   "grade": "green",
   "explanationKey": "VIT-T02",
   "when": {
    "all": [
     {
      "field": "temperature.c",
      "op": "gte",
      "value": {
       "ref": "params.temperature.emergencyBelow"
      }
     },
     {
      "field": "temperature.c",
      "op": "lt",
      "value": {
       "ref": "params.temperature.amberAtOrAbove"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "VIT-T02"
    }
   ]
  }
 ]
}$rules_json$::jsonb,
  'vitals_care_triage v1 (pulse, SpO2, temperature): the live bands of the three older per-vital classifiers as PROPOSED starting values, a typo gate, and a clinician route for a heart rate outside the adult range in a patient under 18. DRAFT, NOT SIGNED: the CMO approves it with approve_triage_rule_set; the three older triggers keep running until parity is shown.'
)
on conflict (code, version) do nothing;

insert into public.task_types (code, version, is_active, priority_class, default_due_minutes, min_doctor_tier, required_competencies, lead_window_minutes,
                               claim_timeout_minutes, pushable, creatable, source_task_keys, effective_from, note, needs_confirmation)
select 'amber_vitals_review', 1, true, 5, 4320, 'senior_medical_officer', array['adult_general'], 360, 30, true, true,
       array['amber_vitals_review'], (now() at time zone 'Africa/Lagos')::date,
       'A review for a pulse, oxygen or temperature reading that is outside the usual range but not an emergency (the amber band). PROPOSED class, due time (72 hours, the older amber alert''s review time) and tier, modelled on amber_glucose_review; the competency is adult_general. Needs the CMO to confirm. Holds no reading or band (INV-07).',
       true
 where not exists (select 1 from public.task_types where code = 'amber_vitals_review');

-- Self-check ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_status text; v_rules jsonb; v_tt record;
begin
  select status, rules into v_status, v_rules from public.triage_rule_sets where code = 'vitals_care_triage' and version = 1;
  if v_rules is null then raise exception 'vitals self-check: vitals_care_triage v1 was not created'; end if;
  if v_status <> 'draft' then raise exception 'vitals self-check: v1 must be a draft until the CMO approves it, found %', v_status; end if;
  if jsonb_array_length(v_rules -> 'rules') <> 15 then raise exception 'vitals self-check: expected 15 rules, found %', jsonb_array_length(v_rules -> 'rules'); end if;
  if exists (select 1 from jsonb_array_elements(v_rules -> 'rules') r where r ->> 'grade' = 'red'
              and not (r -> 'actions' @> '[{"kind":"page_on_call"}]'::jsonb and r -> 'actions' @> '[{"kind":"show_emergency_guidance"}]'::jsonb)) then
    raise exception 'vitals self-check: a red rule lacks guidance or the page (INV-05)';
  end if;
  select * into v_tt from public.task_types where code = 'amber_vitals_review';
  if not v_tt.is_active or not v_tt.creatable or not v_tt.needs_confirmation or v_tt.confirmed_at is not null then
    raise exception 'vitals self-check: amber_vitals_review must be active, creatable and awaiting the CMO';
  end if;
  if exists (select 1 from jsonb_path_query(v_rules, '$.rules[*].actions[*] ? (@.kind == "create_task")') x
              where not exists (select 1 from public.task_types t where t.is_active and t.creatable and t.source_task_keys @> array[x ->> 'task'])) then
    raise exception 'vitals self-check: a task key of the vitals rule set has no task type';
  end if;
end $$;
