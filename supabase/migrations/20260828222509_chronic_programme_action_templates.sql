-- Tarragon Health — Care Management Engine, step 4
--
-- chronic_condition_programmes already IS the platform's "care programme"
-- (spec §3.2's "structured framework... defines what care should generally
-- look like") — it just has no machine-usable content for the goals/tasks a
-- newly-enrolled patient's plan should start with. condition_protocols
-- carries the equivalent clinical facts already (monitoring.targets,
-- follow_up, escalation.red_flags) but as WHO-sourced *prose* for a
-- clinician to read, not something safe to parse into rows at enrolment
-- time. These two new columns are the structured, admin-editable equivalent
-- — config, not code, same discipline as escalation_slas/
-- medication_review_cadences — read by private.seed_care_plan_actions() in
-- the next migration to build a patient's first goals/tasks automatically
-- (spec §3.5's "automatically generated from an approved protocol").
--
-- A clinician who reviews the generated goals/tasks and edits or deletes
-- them afterward is exactly spec §3.5's "hybrid" model — the system
-- proposes, the clinician validates/modifies. Deliberately kept editable
-- (private.is_admin() write) so the founder/Clinical Director can revise
-- these defaults the same way they revise any other config table, with no
-- redeploy.

alter table public.chronic_condition_programmes
  add column if not exists default_goals jsonb not null default '[]'::jsonb,
  add column if not exists default_tasks jsonb not null default '[]'::jsonb;

comment on column public.chronic_condition_programmes.default_goals is
  'Array of {description, metric, target_value, target_unit, target_date_days} — target_date_days is an offset from enrolment. Instantiated into care_plan_goals (source=''protocol'') by private.seed_care_plan_actions().';
comment on column public.chronic_condition_programmes.default_tasks is
  'Array of {title, description, owner_role, priority, due_offset_days, recurrence}. Instantiated into care_tasks (source=''programme_template'') by private.seed_care_plan_actions().';

update public.chronic_condition_programmes
set default_goals = '[
  {"description": "Improve blood-pressure control", "metric": "home_bp_reading_systolic", "target_value": 140, "target_unit": "mmHg systolic", "target_date_days": 84},
  {"description": "Improve medication adherence", "metric": "adherence_pct", "target_value": 90, "target_unit": "percent", "target_date_days": 30}
]'::jsonb,
default_tasks = '[
  {"title": "Log a home blood-pressure reading", "owner_role": "patient", "priority": 2, "due_offset_days": 2, "recurrence": "weekly"},
  {"title": "Confirm today''s medication dose", "owner_role": "patient", "priority": 2, "due_offset_days": 1, "recurrence": "daily"},
  {"title": "Book baseline blood tests (U&E, fasting glucose, lipids)", "owner_role": "laboratory", "priority": 2, "due_offset_days": 14, "recurrence": null},
  {"title": "Attend blood-pressure review", "owner_role": "clinician", "priority": 2, "due_offset_days": 28, "recurrence": null}
]'::jsonb
where code = 'hypertension';

update public.chronic_condition_programmes
set default_goals = '[
  {"description": "Reach your individualised HbA1c target", "metric": "hba1c_percent", "target_value": 7.0, "target_unit": "%", "target_date_days": 90},
  {"description": "Reach 150 minutes of activity per week", "metric": "activity_minutes_per_week", "target_value": 150, "target_unit": "minutes", "target_date_days": 60}
]'::jsonb,
default_tasks = '[
  {"title": "Log a glucose reading", "owner_role": "patient", "priority": 2, "due_offset_days": 1, "recurrence": "daily"},
  {"title": "Book HbA1c blood test", "owner_role": "laboratory", "priority": 2, "due_offset_days": 90, "recurrence": null},
  {"title": "Complete a foot self-check", "owner_role": "patient", "priority": 2, "due_offset_days": 30, "recurrence": "monthly"},
  {"title": "Medicines check-in with your care team", "owner_role": "care_coordinator", "priority": 2, "due_offset_days": 14, "recurrence": null}
]'::jsonb
where code = 'diabetes';

update public.chronic_condition_programmes
set default_goals = '[
  {"description": "No daytime symptoms more than twice a week", "metric": "symptom_days_per_week", "target_value": 2, "target_unit": "days", "target_date_days": 30}
]'::jsonb,
default_tasks = '[
  {"title": "Confirm inhaler technique with your care team", "owner_role": "clinician", "priority": 2, "due_offset_days": 14, "recurrence": null},
  {"title": "Log reliever-inhaler use this week", "owner_role": "patient", "priority": 2, "due_offset_days": 7, "recurrence": "weekly"}
]'::jsonb
where code = 'asthma';

update public.chronic_condition_programmes
set default_goals = '[
  {"description": "Reduce exacerbation frequency", "metric": "exacerbations_per_quarter", "target_value": 0, "target_unit": "episodes", "target_date_days": 90}
]'::jsonb,
default_tasks = '[
  {"title": "Confirm inhaler technique with your care team", "owner_role": "clinician", "priority": 2, "due_offset_days": 14, "recurrence": null},
  {"title": "Log an SpO2 reading", "owner_role": "patient", "priority": 2, "due_offset_days": 7, "recurrence": "weekly"}
]'::jsonb
where code = 'copd';

update public.chronic_condition_programmes
set default_goals = '[
  {"description": "Keep 3-day weight gain within a safe range", "metric": "weight_gain_kg_3day", "target_value": 2, "target_unit": "kg", "target_date_days": 14}
]'::jsonb,
default_tasks = '[
  {"title": "Log today''s weight", "owner_role": "patient", "priority": 1, "due_offset_days": 1, "recurrence": "daily"},
  {"title": "Medication up-titration review", "owner_role": "clinician", "priority": 1, "due_offset_days": 14, "recurrence": null}
]'::jsonb
where code = 'heart_failure';

update public.chronic_condition_programmes
set default_goals = '[
  {"description": "Keep blood pressure below your individualised target", "metric": "home_bp_reading_systolic", "target_value": 130, "target_unit": "mmHg systolic", "target_date_days": 90}
]'::jsonb,
default_tasks = '[
  {"title": "Book kidney-function blood test (U&E, eGFR)", "owner_role": "laboratory", "priority": 2, "due_offset_days": 90, "recurrence": null},
  {"title": "Log a home blood-pressure reading", "owner_role": "patient", "priority": 2, "due_offset_days": 7, "recurrence": "weekly"}
]'::jsonb
where code = 'ckd';

update public.chronic_condition_programmes
set default_goals = '[
  {"description": "Achieve 5-10% initial weight loss", "metric": "weight_loss_pct", "target_value": 7, "target_unit": "%", "target_date_days": 180},
  {"description": "Reach 150 minutes of activity per week", "metric": "activity_minutes_per_week", "target_value": 150, "target_unit": "minutes", "target_date_days": 60}
]'::jsonb,
default_tasks = '[
  {"title": "Log today''s weight", "owner_role": "patient", "priority": 3, "due_offset_days": 7, "recurrence": "weekly"},
  {"title": "Complete a lifestyle-programme check-in", "owner_role": "patient", "priority": 2, "due_offset_days": 14, "recurrence": null}
]'::jsonb
where code = 'obesity';
