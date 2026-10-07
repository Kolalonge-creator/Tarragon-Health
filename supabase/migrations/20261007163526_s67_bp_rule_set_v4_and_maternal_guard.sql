-- S67, migration 4 of 4: bp_care_triage v4 (DRAFT), the server reads the three new symptom values, and the `maternal_enabled` go-live guard.
--
-- NOTHING IS SIGNED OR SWITCHED ON. The rule set row is a draft (the CMO approves it with approve_triage_rule_set, which an agent never
-- does); the guard is created OFF and no sign-off, attestation or log row is written. `go_live_guard_log`, `go_live_attestations` and
-- `triage_rule_sets.approved_*` stay exactly as they were.
--
-- 1. The v4 row is the JSON below, produced from packages/clinical/src/rules/bp-care-v4.ts; a Jest test fails if the two differ.
--    Version 4 is version 3 plus the swelling sign in `preeclampsiaFlag`, the `obstetricEmergency` group and rule BP-P6 (item A2).
-- 2. `public.triage_context_for_observation` is patched IN PLACE (its live body is read with pg_get_functiondef and one list is widened),
--    so this does not restate a function that other sessions may have changed since. The patch asserts it found its anchor.
-- 3. `private.go_live_conditions` gets one new branch the same way. Conditions for `maternal_enabled`: an approved obstetric protocol
--    (data), an approved bp_care_triage carrying rule BP-P6 (data), the NAFDAC and MDCN replies recorded (attestation, decision B2)
--    and the CMO pressing the switch.
begin;

insert into public.triage_rule_sets (code, version, status, rules, note)
values ('bp_care_triage', 4, 'draft', $rules_json${
 "code": "bp_care_triage",
 "version": 4,
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
  "extremeRecheck": {
   "afterMinutes": 120,
   "windowMinutes": 240
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
   "days": 7
  },
  "postpartum": {
   "reviewSystolic": 150,
   "reviewDiastolic": 100,
   "windowDays": 42
  },
  "recheckBackupPush": {
   "minAfterMinutes": 60,
   "delayMinutes": 10
  },
  "pregnancy": {
   "severeSystolic": 160,
   "severeDiastolic": 110,
   "raisedSystolic": 140,
   "raisedDiastolic": 90
  },
  "symptomGroups": {
   "redFlag": [
    "severe_headache",
    "chest_pain",
    "breathlessness",
    "weakness_or_numbness",
    "difficulty_speaking",
    "back_pain",
    "confusion",
    "visual_disturbance"
   ],
   "preeclampsiaFlag": [
    "severe_headache",
    "visual_disturbance",
    "epigastric_pain",
    "breathlessness",
    "sudden_face_hand_swelling"
   ],
   "lowBpFlag": [
    "fainting",
    "confusion",
    "chest_pain"
   ],
   "dizzy": [
    "dizziness"
   ],
   "obstetricEmergency": [
    "convulsion",
    "loss_of_consciousness"
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
   "id": "BP-P6",
   "description": "Pregnancy or first 6 weeks after birth: a convulsion or loss of consciousness is an emergency, whatever the reading",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "EMG-001",
   "when": {
    "all": [
     {
      "field": "obstetric",
      "op": "eq",
      "value": true
     },
     {
      "symptomGroup": "obstetricEmergency"
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
   "id": "BP-P3",
   "description": "Pregnancy or first 6 weeks after birth: severe-range reading is an emergency",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "EMG-001",
   "when": {
    "all": [
     {
      "field": "obstetric",
      "op": "eq",
      "value": true
     },
     {
      "any": [
       {
        "field": "reading.systolic",
        "op": "gte",
        "value": {
         "ref": "params.pregnancy.severeSystolic"
        }
       },
       {
        "field": "reading.diastolic",
        "op": "gte",
        "value": {
         "ref": "params.pregnancy.severeDiastolic"
        }
       }
      ]
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
   "id": "BP-P4",
   "description": "Pregnancy or first 6 weeks after birth: a raised reading with a pre-eclampsia symptom is an emergency",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "red",
   "explanationKey": "EMG-001",
   "when": {
    "all": [
     {
      "field": "obstetric",
      "op": "eq",
      "value": true
     },
     {
      "symptomGroup": "preeclampsiaFlag"
     },
     {
      "any": [
       {
        "field": "reading.systolic",
        "op": "gte",
        "value": {
         "ref": "params.pregnancy.raisedSystolic"
        }
       },
       {
        "field": "reading.diastolic",
        "op": "gte",
        "value": {
         "ref": "params.pregnancy.raisedDiastolic"
        }
       }
      ]
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
   "id": "BP-P5",
   "description": "First 6 weeks after birth: at or above the postpartum treatment line, routed to a clinician",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "TRI-002",
   "when": {
    "all": [
     {
      "field": "postpartum",
      "op": "eq",
      "value": true
     },
     {
      "any": [
       {
        "field": "reading.systolic",
        "op": "gte",
        "value": {
         "ref": "params.postpartum.reviewSystolic"
        }
       },
       {
        "field": "reading.diastolic",
        "op": "gte",
        "value": {
         "ref": "params.postpartum.reviewDiastolic"
        }
       }
      ]
     }
    ]
   },
   "actions": [
    {
     "kind": "route_referral",
     "reason": "postpartum"
    },
    {
     "kind": "create_task",
     "task": "postpartum_review",
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
         },
         {
          "not": {
           "any": [
            {
             "field": "previous.systolic",
             "op": "gte",
             "value": {
              "ref": "params.extreme.systolic"
             }
            },
            {
             "field": "previous.diastolic",
             "op": "gte",
             "value": {
              "ref": "params.extreme.diastolic"
             }
            }
           ]
          }
         }
        ]
       },
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
           "ref": "params.extremeRecheck.afterMinutes"
          }
         },
         {
          "field": "recheck.minutesSincePrevious",
          "op": "lte",
          "value": {
           "ref": "params.extremeRecheck.windowMinutes"
          }
         },
         {
          "any": [
           {
            "field": "previous.systolic",
            "op": "gte",
            "value": {
             "ref": "params.extreme.systolic"
            }
           },
           {
            "field": "previous.diastolic",
            "op": "gte",
            "value": {
             "ref": "params.extreme.diastolic"
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
   "id": "BP-X2",
   "description": "200/130 or more, no emergency symptom: take usual medicine if not taken, rest, recheck after 2 hours (CMO decision)",
   "triggers": [
    "observation"
   ],
   "result": "recheck",
   "recheckTiming": "extreme",
   "explanationKey": "TRI-007",
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
      "field": "symptoms.answered",
      "op": "eq",
      "value": true
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
          },
          {
           "not": {
            "any": [
             {
              "field": "previous.systolic",
              "op": "gte",
              "value": {
               "ref": "params.extreme.systolic"
              }
             },
             {
              "field": "previous.diastolic",
              "op": "gte",
              "value": {
               "ref": "params.extreme.diastolic"
              }
             }
            ]
           }
          }
         ]
        },
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
            "ref": "params.extremeRecheck.afterMinutes"
           }
          },
          {
           "field": "recheck.minutesSincePrevious",
           "op": "lte",
           "value": {
            "ref": "params.extremeRecheck.windowMinutes"
           }
          },
          {
           "any": [
            {
             "field": "previous.systolic",
             "op": "gte",
             "value": {
              "ref": "params.extreme.systolic"
             }
            },
            {
             "field": "previous.diastolic",
             "op": "gte",
             "value": {
              "ref": "params.extreme.diastolic"
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
     },
     {
      "any": [
       {
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
       {
        "any": [
         {
          "field": "previous.systolic",
          "op": "gte",
          "value": {
           "ref": "params.extreme.systolic"
          }
         },
         {
          "field": "previous.diastolic",
          "op": "gte",
          "value": {
           "ref": "params.extreme.diastolic"
          }
         }
        ]
       }
      ]
     }
    ]
   },
   "actions": [
    {
     "kind": "prompt_recheck",
     "code": "TRI-007"
    }
   ]
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
          },
          {
           "not": {
            "any": [
             {
              "field": "previous.systolic",
              "op": "gte",
              "value": {
               "ref": "params.extreme.systolic"
              }
             },
             {
              "field": "previous.diastolic",
              "op": "gte",
              "value": {
               "ref": "params.extreme.diastolic"
              }
             }
            ]
           }
          }
         ]
        },
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
            "ref": "params.extremeRecheck.afterMinutes"
           }
          },
          {
           "field": "recheck.minutesSincePrevious",
           "op": "lte",
           "value": {
            "ref": "params.extremeRecheck.windowMinutes"
           }
          },
          {
           "any": [
            {
             "field": "previous.systolic",
             "op": "gte",
             "value": {
              "ref": "params.extreme.systolic"
             }
            },
            {
             "field": "previous.diastolic",
             "op": "gte",
             "value": {
              "ref": "params.extreme.diastolic"
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
     },
     {
      "not": {
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
      }
     },
     {
      "not": {
       "any": [
        {
         "field": "previous.systolic",
         "op": "gte",
         "value": {
          "ref": "params.extreme.systolic"
         }
        },
        {
         "field": "previous.diastolic",
         "op": "gte",
         "value": {
          "ref": "params.extreme.diastolic"
         }
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
   "id": "BP-X1",
   "description": "200/130 or more and the symptom question not yet answered: ask it first (CMO decision)",
   "triggers": [
    "observation"
   ],
   "result": "ask",
   "explanationKey": "TRI-008",
   "when": {
    "all": [
     {
      "field": "symptoms.answered",
      "op": "eq",
      "value": false
     },
     {
      "any": [
       {
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
       {
        "all": [
         {
          "any": [
           {
            "field": "previous.systolic",
            "op": "gte",
            "value": {
             "ref": "params.extreme.systolic"
            }
           },
           {
            "field": "previous.diastolic",
            "op": "gte",
            "value": {
             "ref": "params.extreme.diastolic"
            }
           }
          ]
         },
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
         }
        ]
       }
      ]
     }
    ]
   },
   "actions": [
    {
     "kind": "ask_symptoms",
     "code": "TRI-008"
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
   "id": "BP-A7",
   "description": "Systolic under 90 with no symptom (CMO decision: only under 90 is flagged)",
   "triggers": [
    "observation"
   ],
   "result": "grade",
   "grade": "amber",
   "explanationKey": "TRI-002",
   "when": {
    "field": "reading.systolic",
    "op": "lt",
    "value": {
     "ref": "params.low.redSystolic"
    }
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
        'bp_care_triage v4 (S67): v3 plus the pre-eclampsia swelling sign and rule BP-P6 (convulsion or loss of consciousness in pregnancy). DRAFT, PROPOSED; the CMO signs it in the hub.')
on conflict (code, version) do nothing;

do $patch$
declare
  v_def text;
begin
  select pg_get_functiondef('public.triage_context_for_observation(uuid, text, integer)'::regprocedure) into v_def;
  if v_def is null then raise exception 'S67: triage_context_for_observation(uuid,text,integer) not found'; end if;
  if v_def like '%''convulsion''%' then
    return; -- already patched
  end if;
  if position($a$'dizziness', 'palpitations')$a$ in v_def) = 0 then raise exception 'S67: symptom list anchor not found in triage_context_for_observation'; end if;
  v_def := replace(v_def, $a$'dizziness', 'palpitations')$a$,
                          $a$'dizziness', 'palpitations', 'convulsion', 'loss_of_consciousness', 'sudden_face_hand_swelling')$a$);
  execute v_def;
end $patch$;

do $patch$
declare
  v_def text;
begin
  select pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure) into v_def;
  if v_def is null then raise exception 'S67: go_live_conditions(text,uuid) not found'; end if;
  if v_def like '%maternal_enabled%' then
    return;
  end if;
  if position($a$  -- An unknown key has no conditions$a$ in v_def) = 0 then raise exception 'S67: go_live_conditions anchor not found'; end if;
  v_def := replace(v_def, $a$  end if;
  -- An unknown key has no conditions$a$, $a$  elsif p_key = 'maternal_enabled' then
    return jsonb_build_array(
      private.go_live_cond('obstetric_protocol_signed', 'An approved obstetric protocol, signed by the Chief Medical Officer',
        exists (select 1 from public.protocols where status = 'approved' and code ~ '^(obstetric|maternal|pregnan|antenatal)'), 'data',
        (select count(*) from public.protocols where status = 'approved' and code ~ '^(obstetric|maternal|pregnan|antenatal)') || ' approved'),
      private.go_live_cond('pregnancy_rule_set_approved', 'An approved blood pressure triage rule set that carries the pregnancy rules (BP-P6)',
        exists (select 1 from public.triage_rule_sets where status = 'approved' and code = 'bp_care_triage' and rules -> 'rules' @> '[{"id":"BP-P6"}]'::jsonb), 'data', null),
      private.go_live_cond('regulator_queries_answered', 'The NAFDAC and MDCN written queries are sent and the replies recorded', private.go_live_attested(p_key, 'regulator_queries_answered'), 'attestation', null),
      private.go_live_cond('cmo_confirmation', 'Chief Medical Officer confirmation', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  end if;
  -- An unknown key has no conditions$a$);
  execute v_def;
end $patch$;

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in)
values ('maternal_enabled', 'Pregnancy care (module 16)',
        'Week-by-week content, antenatal schedule, baby movement counter, contraction timer and birth plan for patients',
        'An approved obstetric protocol, an approved blood pressure rule set carrying the pregnancy rules, the regulator replies recorded, and the Chief Medical Officer pressing the switch.',
        'cmo', '{}',
        'Not enforced anywhere yet: S67 ships the guard and its conditions only. The screens are built behind it in a later pass, so switching it on or off changes nothing today.')
on conflict (key) do nothing;

do $$
declare v_on boolean; v_conds jsonb; v4 jsonb;
begin
  select is_on into v_on from public.go_live_guards where key = 'maternal_enabled';
  if v_on is distinct from false then raise exception 'S67 self-check: maternal_enabled must exist and be OFF'; end if;
  if exists (select 1 from public.go_live_guard_log where guard_key = 'maternal_enabled') or exists (select 1 from public.go_live_attestations where guard_key = 'maternal_enabled') then
    raise exception 'S67 self-check: no log or attestation row may exist for maternal_enabled';
  end if;
  v_conds := private.go_live_conditions('maternal_enabled', null);
  if jsonb_array_length(v_conds) <> 4 or exists (select 1 from jsonb_array_elements(v_conds) c where c ->> 'code' = 'unknown_guard') then
    raise exception 'S67 self-check: maternal_enabled has no conditions';
  end if;
  if exists (select 1 from jsonb_array_elements(v_conds) c where c ->> 'code' in ('obstetric_protocol_signed', 'pregnancy_rule_set_approved', 'regulator_queries_answered') and (c ->> 'met')::boolean) then
    raise exception 'S67 self-check: a maternal_enabled condition is already met; nothing was signed by this migration';
  end if;
  select rules into v4 from public.triage_rule_sets where code = 'bp_care_triage' and version = 4;
  if v4 is null or (select status from public.triage_rule_sets where code = 'bp_care_triage' and version = 4) <> 'draft' then
    raise exception 'S67 self-check: bp_care_triage v4 must exist as a draft';
  end if;
  if pg_get_functiondef('public.triage_context_for_observation(uuid, text, integer)'::regprocedure) not like '%''convulsion''%' then
    raise exception 'S67 self-check: the triage context does not read the new symptoms';
  end if;
end $$;

commit;
