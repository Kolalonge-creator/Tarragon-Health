-- S11c: bp_care_triage version 2, a DRAFT carrying the Chief Medical Officer's decisions of 2026-10-05.
--  * BP-R2 (200/130 red with no symptom) is retired. At 200/130 or more the system first asks the
--    emergency-symptom question (BP-X1). With a symptom: BP-R1 (red, immediate page, which is stricter than
--    same-day contact). With none: take the usual medicine if not yet taken, rest, recheck after 2 hours
--    (BP-X2, window 4 hours); still urgent on the recheck, or no recheck: amber same-day task (BP-A1).
--  * BP-A7: a systolic under 90 with no symptom is flagged amber (24 hour review). 90 and above is not.
--  * BP-P5 and the postpartum input: the first 6 weeks after a birth use the pregnancy red lines (160/110, and 140/90
--    with a pre-eclampsia symptom) and an amber review at 150/100.
-- Version 1 stays as an unused draft. DO NOT APPLY until the edge function carrying the matching engine is deployed
-- (the grader picks the highest draft version, and the engine now deployed cannot read these rules) and the S12
-- context function passes postpartum and symptomsAnswered: see docs/BUILD-PROGRESS.md (S11c).
insert into public.triage_rule_sets (code, version, status, rules, note)
values ('bp_care_triage', 2, 'draft', $rules_json${
 "code": "bp_care_triage",
 "version": 2,
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
   "days": 5
  },
  "postpartum": {
   "reviewSystolic": 150,
   "reviewDiastolic": 100
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
    "breathlessness"
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
        'DRAFT: CMO decisions 2026-10-05 on top of v1 plus guideline research. Awaiting Chief Medical Officer sign-off.');
