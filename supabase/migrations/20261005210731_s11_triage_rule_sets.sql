-- S11: versioned triage rule sets (spec 4.5, INV-01, INV-16).
--
-- The triage engine (packages/clinical) is pure code; its rules are data. This table holds each
-- rule set version, the draft until the Chief Medical Officer signs it, then immutable. Every
-- decision made with a rule set will record the version id (S12 adds triage_events.rule_set_version_id).
--
--  * code + version are unique; the JSON repeats them and a check keeps the two in step.
--  * status draft -> approved -> retired. Approved needs approved_by and approved_at (check).
--    One approved version per code (partial unique index).
--  * An approved or retired row can never change, except approved -> retired. A draft can be edited
--    or deleted. An approved row can never be deleted.
--  * No API write path: nobody signs a rule set by accident. Writing goes through the service role
--    (the sign-off screen is S37). The seed below is a DRAFT: the numbers are PROPOSED and nobody
--    has approved them.
--  * Read: admins and the active clinical director (to review a draft). Everyone signed in gets the
--    approved rules through public.get_approved_triage_rule_set (rules are not patient data), which
--    is how a phone refreshes its bundled copy.
-- Live has no triage_rule_sets or triage_events table (checked before writing); triage_events is S12.

create table public.triage_rule_sets (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  version     integer not null check (version >= 1),
  status      text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  rules       jsonb not null check (jsonb_typeof(rules) = 'object'),
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  unique (code, version),
  check (rules -> 'code' = to_jsonb(code) and rules -> 'version' = to_jsonb(version)),
  check (status = 'draft' or (approved_by is not null and approved_at is not null))
);
create unique index triage_rule_sets_one_approved on public.triage_rule_sets (code) where status = 'approved';

comment on table public.triage_rule_sets is 'S11: versioned triage rules (INV-16). Draft until the CMO approves; approved rows are immutable. Seeded rows are drafts with PROPOSED values.';
comment on column public.triage_rule_sets.rules is 'The rule set JSON read by packages/clinical grade(); the same object is bundled in the app for offline red detection.';

create or replace function private.triage_rule_sets_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'an approved or retired rule set cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status <> 'draft' then
    if old.status = 'approved' and new.status = 'retired'
       and (new.id, new.code, new.version, new.rules, new.approved_by, new.approved_at, new.created_at)
           is not distinct from (old.id, old.code, old.version, old.rules, old.approved_by, old.approved_at, old.created_at) then
      return new;
    end if;
    raise exception 'an approved or retired rule set is immutable (only approved -> retired is allowed)' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger triage_rule_sets_guard before update or delete on public.triage_rule_sets
  for each row execute function private.triage_rule_sets_guard();

alter table public.triage_rule_sets enable row level security;
create policy triage_rule_sets_review_read on public.triage_rule_sets for select to authenticated
  using (private.is_admin() or private.is_active_clinical_director());

revoke all on public.triage_rule_sets from public, anon, authenticated;
grant select on public.triage_rule_sets to authenticated;

create or replace function public.get_approved_triage_rule_set(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'code', code, 'version', version, 'rules', rules)
  from public.triage_rule_sets where code = p_code and status = 'approved';
$$;
revoke all on function public.get_approved_triage_rule_set(text) from public, anon;
grant execute on function public.get_approved_triage_rule_set(text) to authenticated;
comment on function public.get_approved_triage_rule_set(text) is 'S11: the approved rule set for a code, or null. Rules are not patient data, so any signed-in user may read them (the phone refreshes its bundled copy here).';

-- Seed: BP rule set version 1 as a DRAFT. A test keeps this JSON identical to packages/clinical BP_CARE_V1.
insert into public.triage_rule_sets (code, version, status, rules, note)
values ('bp_care_triage', 1, 'draft', $rules_json${
 "code": "bp_care_triage",
 "version": 1,
 "status": "draft",
 "params": {
  "validation": {
   "systolicMin": 60,
   "systolicMax": 299,
   "diastolicMin": 30,
   "diastolicMax": 200
  },
  "recheck": {
   "afterMinutes": 5,
   "windowMinutes": 15
  },
  "averageWindowDays": 7,
  "minAdultAgeYears": 18,
  "severe": {
   "systolic": 180,
   "diastolic": 120
  },
  "extreme": {
   "systolic": 200,
   "diastolic": 130
  },
  "urgent": {
   "systolic": 180,
   "diastolic": 110
  },
  "low": {
   "redSystolic": 90,
   "amberSystolic": 100
  },
  "average": {
   "overSystolic": 20,
   "overDiastolic": 10,
   "minReadings": 5
  },
  "adherence": {
   "minPercent": 80
  },
  "silence": {
   "days": 5
  },
  "symptomGroups": {
   "redFlag": [
    "severe_headache",
    "chest_pain",
    "breathlessness",
    "weakness_or_numbness",
    "confusion",
    "visual_disturbance"
   ],
   "lowBpFlag": [
    "fainting",
    "confusion",
    "chest_pain"
   ],
   "dizzy": [
    "dizziness"
   ]
  },
  "rejected": {
   "explanationKey": "TRI-006",
   "redFlagGuidanceCode": "EMG-001"
  }
 },
 "rules": [
  {
   "id": "BP-R1",
   "description": "Severe-range reading with a red-flag symptom",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "EMG-001",
   "when": {
    "all": [
     {
      "any": [
       {
        "field": "reading.systolic",
        "op": "gte",
        "value": {
         "ref": "params.severe.systolic"
        }
       },
       {
        "field": "reading.diastolic",
        "op": "gte",
        "value": {
         "ref": "params.severe.diastolic"
        }
       }
      ]
     },
     {
      "symptomGroup": "redFlag"
     }
    ]
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "EMG-001"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "BP-R2",
   "description": "Extreme reading, with or without symptoms",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "EMG-001",
   "when": {
    "any": [
     {
      "field": "reading.systolic",
      "op": "gte",
      "value": {
       "ref": "params.extreme.systolic"
      }
     },
     {
      "field": "reading.diastolic",
      "op": "gte",
      "value": {
       "ref": "params.extreme.diastolic"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "EMG-001"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "BP-R3",
   "description": "Low pressure with fainting, confusion or chest pain",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "EMG-001L",
   "when": {
    "all": [
     {
      "field": "reading.systolic",
      "op": "lt",
      "value": {
       "ref": "params.low.redSystolic"
      }
     },
     {
      "symptomGroup": "lowBpFlag"
     }
    ]
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "EMG-001L"
    },
    {
     "kind": "page_on_call"
    }
   ]
  },
  {
   "id": "BP-P1",
   "description": "Pregnancy: not graded on adult bands, routed to a clinician",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "TRI-002",
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
   "id": "BP-P2",
   "description": "Under the adult age line: routed to a clinician",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "TRI-002",
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
   "id": "BP-A6",
   "description": "A red-flag symptom with a reading below the severe line",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "TRI-002",
   "when": {
    "symptomGroup": "redFlag"
   },
   "actions": [
    {
     "kind": "show_emergency_guidance",
     "code": "EMG-001"
    },
    {
     "kind": "create_task",
     "task": "urgent_bp_review",
     "dueMinutes": 240,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "reading"
  },
  {
   "id": "BP-A1",
   "description": "Urgent range without red-flag symptoms, confirmed on repeat after rest (or not repeated in time)",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "TRI-002",
   "when": {
    "all": [
     {
      "any": [
       {
        "field": "reading.systolic",
        "op": "gte",
        "value": {
         "ref": "params.urgent.systolic"
        }
       },
       {
        "field": "reading.diastolic",
        "op": "gte",
        "value": {
         "ref": "params.urgent.diastolic"
        }
       }
      ]
     },
     {
      "not": {
       "symptomGroup": "redFlag"
      }
     },
     {
      "any": [
       {
        "all": [
         {
          "field": "recheck.kind",
          "op": "eq",
          "value": "repeat"
         },
         {
          "field": "recheck.minutesSincePrevious",
          "op": "gte",
          "value": {
           "ref": "params.recheck.afterMinutes"
          }
         },
         {
          "field": "recheck.minutesSincePrevious",
          "op": "lte",
          "value": {
           "ref": "params.recheck.windowMinutes"
          }
         },
         {
          "any": [
           {
            "field": "previous.systolic",
            "op": "gte",
            "value": {
             "ref": "params.urgent.systolic"
            }
           },
           {
            "field": "previous.diastolic",
            "op": "gte",
            "value": {
             "ref": "params.urgent.diastolic"
            }
           }
          ]
         }
        ]
       },
       {
        "field": "recheck.kind",
        "op": "eq",
        "value": "timed_out"
       }
      ]
     }
    ]
   },
   "actions": [
    {
     "kind": "create_task",
     "task": "urgent_bp_review",
     "dueMinutes": 240,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "reading"
  },
  {
   "id": "BP-A1W",
   "description": "Urgent range without red-flag symptoms: ask for a repeat reading after rest before any task",
   "triggers": [
    "observation"
   ],
   "result": "recheck",
   "explanationKey": "TRI-005",
   "when": {
    "all": [
     {
      "any": [
       {
        "field": "reading.systolic",
        "op": "gte",
        "value": {
         "ref": "params.urgent.systolic"
        }
       },
       {
        "field": "reading.diastolic",
        "op": "gte",
        "value": {
         "ref": "params.urgent.diastolic"
        }
       }
      ]
     },
     {
      "not": {
       "symptomGroup": "redFlag"
      }
     },
     {
      "not": {
       "any": [
        {
         "all": [
          {
           "field": "recheck.kind",
           "op": "eq",
           "value": "repeat"
          },
          {
           "field": "recheck.minutesSincePrevious",
           "op": "gte",
           "value": {
            "ref": "params.recheck.afterMinutes"
           }
          },
          {
           "field": "recheck.minutesSincePrevious",
           "op": "lte",
           "value": {
            "ref": "params.recheck.windowMinutes"
           }
          },
          {
           "any": [
            {
             "field": "previous.systolic",
             "op": "gte",
             "value": {
              "ref": "params.urgent.systolic"
             }
            },
            {
             "field": "previous.diastolic",
             "op": "gte",
             "value": {
              "ref": "params.urgent.diastolic"
             }
            }
           ]
          }
         ]
        },
        {
         "field": "recheck.kind",
         "op": "eq",
         "value": "timed_out"
        }
       ]
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "prompt_recheck",
     "code": "TRI-005"
    }
   ]
  },
  {
   "id": "BP-A2",
   "description": "7-day average well above target, with enough readings",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "TRI-002",
   "when": {
    "all": [
     {
      "field": "avg.count",
      "op": "gte",
      "value": {
       "ref": "params.average.minReadings"
      }
     },
     {
      "any": [
       {
        "field": "avg.systolicOver",
        "op": "gte",
        "value": {
         "ref": "params.average.overSystolic"
        }
       },
       {
        "field": "avg.diastolicOver",
        "op": "gte",
        "value": {
         "ref": "params.average.overDiastolic"
        }
       }
      ]
     }
    ]
   },
   "actions": [
    {
     "kind": "create_task",
     "task": "bp_review",
     "dueMinutes": 1440,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "week"
  },
  {
   "id": "BP-A3",
   "description": "Low systolic with dizziness",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "TRI-002",
   "when": {
    "all": [
     {
      "field": "reading.systolic",
      "op": "lt",
      "value": {
       "ref": "params.low.amberSystolic"
      }
     },
     {
      "symptomGroup": "dizzy"
     }
    ]
   },
   "actions": [
    {
     "kind": "create_task",
     "task": "low_bp_review",
     "dueMinutes": 1440,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "reading"
  },
  {
   "id": "BP-A4",
   "description": "Care-pack patient: doses taken below the line over 7 days",
   "triggers": [
    "adherence"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "TRI-002",
   "when": {
    "all": [
     {
      "field": "pathway.carePack",
      "op": "eq",
      "value": true
     },
     {
      "field": "adherence.percent7d",
      "op": "lt",
      "value": {
       "ref": "params.adherence.minPercent"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "create_task",
     "task": "adherence_review",
     "dueMinutes": 2880,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "week"
  },
  {
   "id": "BP-A5",
   "description": "Care-pack patient: no readings for the silence line",
   "triggers": [
    "silence"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "TRI-002",
   "when": {
    "all": [
     {
      "field": "pathway.carePack",
      "op": "eq",
      "value": true
     },
     {
      "field": "silence.days",
      "op": "gte",
      "value": {
       "ref": "params.silence.days"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "create_task",
     "task": "silence_check",
     "dueMinutes": 2880,
     "notifyKey": "notify.triage.task_created"
    }
   ],
   "taskAnchor": "lastReadingDate"
  },
  {
   "id": "BP-G1",
   "description": "Reading within target",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "green",
   "explanationKey": "TRI-001",
   "when": {
    "all": [
     {
      "field": "reading.systolic",
      "op": "lt",
      "value": {
       "ref": "target.systolic"
      }
     },
     {
      "field": "reading.diastolic",
      "op": "lt",
      "value": {
       "ref": "target.diastolic"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "TRI-001"
    }
   ]
  },
  {
   "id": "BP-G2",
   "description": "Above target but no amber rule matched: advice only",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "green",
   "explanationKey": "TRI-003",
   "when": {
    "any": [
     {
      "field": "reading.systolic",
      "op": "gte",
      "value": {
       "ref": "target.systolic"
      }
     },
     {
      "field": "reading.diastolic",
      "op": "gte",
      "value": {
       "ref": "target.diastolic"
      }
     }
    ]
   },
   "actions": [
    {
     "kind": "show_message",
     "code": "TRI-003"
    }
   ]
  }
 ]
}$rules_json$::jsonb,
        'PROPOSED values from spec 6.2 plus BP-P1, BP-P2, BP-A6 (OQ-86). Awaiting Chief Medical Officer sign-off.');

do $$
begin
  if (select count(*) from public.triage_rule_sets) <> 1 or exists (select 1 from public.triage_rule_sets where status <> 'draft') then
    raise exception 'S11 self-check: expected exactly one draft rule set';
  end if;
  if has_table_privilege('anon', 'public.triage_rule_sets', 'SELECT') or has_table_privilege('authenticated', 'public.triage_rule_sets', 'INSERT')
     or has_table_privilege('authenticated', 'public.triage_rule_sets', 'UPDATE') or has_table_privilege('authenticated', 'public.triage_rule_sets', 'DELETE') then
    raise exception 'S11 self-check: table grants are wrong';
  end if;
  if has_function_privilege('anon', 'public.get_approved_triage_rule_set(text)', 'EXECUTE') then
    raise exception 'S11 self-check: anon can execute get_approved_triage_rule_set';
  end if;
end $$;
