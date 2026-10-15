-- R2 (plan item R2, CMO decisions Q6 to Q9 of 2026-10-07): glucose_care_triage version 1, a DRAFT. NOT SIGNED.
--
-- The glucose rule set for the triage engine: three ADA hypoglycaemia levels (Q6), suspected DKA and the ketone bands (Q7), very high glucose
-- (Q8), and who it grades (Q9: adults 18 and over with type 1 or type 2; pregnancy, under 18 and other diabetes types route to a clinician as
-- amber, while the severe-hypoglycaemia and suspected-DKA reds apply to everyone). Guideline basis per rule: docs/research/S11-S15-glucose.md.
--
-- The JSON below is the SAME object as GLUCOSE_CARE_V1 in packages/clinical/src/rules/glucose-care-v1.ts, which the app bundles for offline
-- red detection; packages/clinical/src/glucose-drift.test.ts parses this file and fails if the two differ.
--
-- WHAT THIS CHANGES IN LIVE BEHAVIOUR: nothing. A draft grades in SHADOW (triage_events.shadow = true; the task and paging subscribers ignore
-- shadow events) and the older glucose pipeline (private.handle_glucose_emergency_backstop, glucose-red-flags) keeps running, the same
-- "both run until parity is shown" rule the CMO gave for blood pressure (Q1). Signing is the Chief Medical Officer's act through
-- approve_triage_rule_set, from the sign-off hub; an agent never signs it.
--
-- ALSO HERE: the task type the draft's urgent reviews need, amber_glucose_review, created with needs_confirmation = true so the CMO confirms it
-- (public.confirm_task_type) before the rule set can be signed. It is active and creatable but nothing creates one while the rule set is a draft.
-- Note for the CMO: an unconfirmed task type also blocks approve_triage_rule_set for bp_care_triage v4 until it is confirmed.

insert into public.triage_rule_sets (code, version, status, rules, note)
values (
  'glucose_care_triage', 1, 'draft',
  $rules_json${
 "code": "glucose_care_triage",
 "version": 1,
 "status": "draft",
 "params": {
  "validation": {
   "glucoseMinMmol": 0.5,
   "glucoseMaxMmol": 55.5,
   "ketoneMaxMmol": 20
  },
  "minAdultAgeYears": 18,
  "hypo": {
   "severe": 3,
   "alert": 3.9
  },
  "high": {
   "dka": 11,
   "urgent": 20,
   "severe": 33.3
  },
  "ketone": {
   "raised": 1.5,
   "dka": 3
  },
  "symptomGroups": {
   "severeHypoSigns": [
    "confusion",
    "seizure",
    "unconscious",
    "cannot_swallow"
   ],
   "dkaSigns": [
    "vomiting",
    "abdominal_pain",
    "fast_breathing",
    "drowsiness"
   ],
   "hyperSigns": [
    "vomiting",
    "drowsiness",
    "confusion",
    "very_thirsty_cannot_keep_fluids"
   ],
   "redFlag": [
    "confusion",
    "seizure",
    "unconscious",
    "cannot_swallow"
   ]
  },
  "rejected": {
   "explanationKey": "GLU-T06",
   "redFlagGuidanceCode": "GLU-E02"
  }
 },
 "rules": [
  {
   "id": "GL-R1",
   "description": "Glucose under 3.0 (ADA level 2 hypoglycaemia), for everyone",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "GLU-E01",
   "when": {
    "field": "glucose.mmol",
    "op": "lt",
    "value": {
     "ref": "params.hypo.severe"
    }
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "GLU-E01"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "GL-R2",
   "description": "Low glucose with confusion, seizure, unconsciousness or unable to swallow (ADA level 3), for everyone",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "GLU-E01",
   "when": {
    "all": [
     {
      "field": "glucose.mmol",
      "op": "lt",
      "value": {
       "ref": "params.hypo.alert"
      }
     },
     {
      "symptomGroup": "severeHypoSigns"
     }
    ]
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "GLU-E01"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "GL-R3",
   "description": "Any glucose with confusion, seizure, unconsciousness or unable to swallow (ADA level 3), for everyone",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "GLU-E02",
   "when": {
    "symptomGroup": "severeHypoSigns"
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "GLU-E02"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "GL-R4",
   "description": "Suspected DKA: glucose 11.0 or more with blood ketones 3.0 or more, or urine ketones moderate or large, for everyone",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "GLU-E02",
   "when": {
    "all": [
     {
      "field": "glucose.mmol",
      "op": "gte",
      "value": {
       "ref": "params.high.dka"
      }
     },
     {
      "any": [
       {
        "field": "ketone.bloodMmol",
        "op": "gte",
        "value": {
         "ref": "params.ketone.dka"
        }
       },
       {
        "field": "ketone.urineRaised",
        "op": "eq",
        "value": true
       }
      ]
     }
    ]
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "GLU-E02"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "GL-R5",
   "description": "Raised ketones (1.5 or more, or urine moderate or large) with vomiting, abdominal pain, fast breathing or drowsiness",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "GLU-E02",
   "when": {
    "all": [
     {
      "field": "ketone.raised",
      "op": "eq",
      "value": true
     },
     {
      "symptomGroup": "dkaSigns"
     }
    ]
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "GLU-E02"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "GL-R6",
   "description": "Glucose 33.3 or more, whatever else is known",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "GLU-E02",
   "when": {
    "field": "glucose.mmol",
    "op": "gte",
    "value": {
     "ref": "params.high.severe"
    }
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "GLU-E02"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "GL-R7",
   "description": "Glucose 20.0 or more with vomiting, drowsiness, confusion or very thirsty and not keeping fluids down",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "GLU-E02",
   "when": {
    "all": [
     {
      "field": "glucose.mmol",
      "op": "gte",
      "value": {
       "ref": "params.high.urgent"
      }
     },
     {
      "symptomGroup": "hyperSigns"
     }
    ]
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "GLU-E02"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "GL-A1P",
   "description": "Glucose 3.0 to 3.8 (ADA level 1) in pregnancy, under 18, or with gestational or other diabetes: treat now with fast sugar, and routed to a clinician",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "GLU-T01",
   "when": {
    "all": [
     {
      "field": "glucose.mmol",
      "op": "gte",
      "value": {
       "ref": "params.hypo.severe"
      }
     },
     {
      "field": "glucose.mmol",
      "op": "lt",
      "value": {
       "ref": "params.hypo.alert"
      }
     },
     {
      "any": [
       {
        "field": "pregnant",
        "op": "eq",
        "value": true
       },
       {
        "field": "age",
        "op": "lt",
        "value": {
         "ref": "params.minAdultAgeYears"
        }
       },
       {
        "field": "diabetes.type",
        "op": "eq",
        "value": "gestational"
       },
       {
        "field": "diabetes.type",
        "op": "eq",
        "value": "other"
       }
      ]
     }
    ]
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "GLU-T01"
    },
    {
     "kind": "route_referral",
     "reason": "population"
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
   "id": "GL-A1",
   "description": "Glucose 3.0 to 3.8 (ADA level 1 hypoglycaemia): treat now with fast sugar and recheck",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "GLU-T01",
   "when": {
    "all": [
     {
      "field": "glucose.mmol",
      "op": "gte",
      "value": {
       "ref": "params.hypo.severe"
      }
     },
     {
      "field": "glucose.mmol",
      "op": "lt",
      "value": {
       "ref": "params.hypo.alert"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "GLU-T01"
    }
   ]
  },
  {
   "id": "GL-A2",
   "description": "Raised ketones without the warning signs: urgent same-day review",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "GLU-T02",
   "when": {
    "field": "ketone.raised",
    "op": "eq",
    "value": true
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "GLU-T02"
    },
    {
     "kind": "create_task",
     "task": "urgent_glucose_review",
     "dueMinutes": 480,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "reading"
  },
  {
   "id": "GL-A3",
   "description": "Glucose 20.0 or more: urgent same-day review",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "GLU-T03",
   "when": {
    "field": "glucose.mmol",
    "op": "gte",
    "value": {
     "ref": "params.high.urgent"
    }
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "GLU-T03"
    },
    {
     "kind": "create_task",
     "task": "urgent_glucose_review",
     "dueMinutes": 480,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "reading"
  },
  {
   "id": "GL-P1",
   "description": "Pregnancy: not graded on adult bands, routed to a clinician",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "GLU-T04",
   "when": {
    "field": "pregnant",
    "op": "eq",
    "value": true
   },
   "actions": [
    {
     "kind": "route_referral",
     "reason": "pregnancy"
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
   "id": "GL-P2",
   "description": "Under the adult age line: routed to a clinician",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "GLU-T04",
   "when": {
    "field": "age",
    "op": "lt",
    "value": {
     "ref": "params.minAdultAgeYears"
    }
   },
   "actions": [
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
   "id": "GL-P3",
   "description": "Gestational or other diabetes type: not graded on type 1 and type 2 bands, routed to a clinician",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "GLU-T04",
   "when": {
    "any": [
     {
      "field": "diabetes.type",
      "op": "eq",
      "value": "gestational"
     },
     {
      "field": "diabetes.type",
      "op": "eq",
      "value": "other"
     }
    ]
   },
   "actions": [
    {
     "kind": "route_referral",
     "reason": "diabetes_type"
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
   "id": "GL-G1",
   "description": "Glucose at 3.9 or more and nothing above matched: reading saved",
   "triggers": [
    "glucose"
   ],
   "result": "grade",
   "grade": "green",
   "explanationKey": "GLU-T05",
   "when": {
    "field": "glucose.mmol",
    "op": "gte",
    "value": {
     "ref": "params.hypo.alert"
    }
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "GLU-T05"
    }
   ]
  }
 ]
}$rules_json$::jsonb,
  'glucose_care_triage v1 (CMO decisions Q6 to Q9, 2026-10-07): three ADA hypoglycaemia levels, suspected DKA and ketone bands, very high glucose, adults 18+ with type 1 or 2 graded and everyone else routed. DRAFT, NOT SIGNED: the CMO approves it with approve_triage_rule_set; the older glucose pipeline keeps running until parity is shown.'
)
on conflict (code, version) do nothing;

insert into public.task_types (code, version, is_active, priority_class, default_due_minutes, min_doctor_tier, required_competencies, lead_window_minutes,
                               claim_timeout_minutes, pushable, creatable, source_task_keys, effective_from, note, needs_confirmation)
select 'amber_glucose_review', 1, true, 4, 480, 'senior_medical_officer', array['adult_general'], 120, 30, true, true,
       array['urgent_glucose_review'], (now() at time zone 'Africa/Lagos')::date,
       'R2: an urgent same-day glucose review: ketones raised without warning signs, or glucose 20.0 or more (CMO Q7, Q8). PROPOSED class, due time and tier, modelled on amber_bp_review; the competency is adult_general because no diabetes competency exists yet. Needs the CMO to confirm. Holds no reading or band (INV-07).',
       true
 where not exists (select 1 from public.task_types where code = 'amber_glucose_review');

-- Self-check ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_status text; v_rules jsonb; v_tt record;
begin
  select status, rules into v_status, v_rules from public.triage_rule_sets where code = 'glucose_care_triage' and version = 1;
  if v_rules is null then raise exception 'R2 self-check: glucose_care_triage v1 was not created'; end if;
  if v_status <> 'draft' then raise exception 'R2 self-check: v1 must be a draft until the CMO approves it, found %', v_status; end if;
  if jsonb_array_length(v_rules -> 'rules') <> 15 then raise exception 'R2 self-check: expected 15 rules, found %', jsonb_array_length(v_rules -> 'rules'); end if;
  if exists (select 1 from jsonb_array_elements(v_rules -> 'rules') r where r ->> 'grade' = 'red'
              and not (r -> 'actions' @> '[{"kind":"page_on_call"}]'::jsonb and r -> 'actions' @> '[{"kind":"show_emergency_guidance"}]'::jsonb)) then
    raise exception 'R2 self-check: a red rule lacks guidance or the page (INV-05)';
  end if;
  select * into v_tt from public.task_types where code = 'amber_glucose_review';
  if not v_tt.is_active or not v_tt.creatable or not v_tt.needs_confirmation or v_tt.confirmed_at is not null then
    raise exception 'R2 self-check: amber_glucose_review must be active, creatable and awaiting the CMO';
  end if;
  if exists (select 1 from jsonb_path_query(v_rules, '$.rules[*].actions[*] ? (@.kind == "create_task")') x
              where not exists (select 1 from public.task_types t where t.is_active and t.creatable and t.source_task_keys @> array[x ->> 'task'])) then
    raise exception 'R2 self-check: a task key of the glucose rule set has no task type';
  end if;
end $$;
