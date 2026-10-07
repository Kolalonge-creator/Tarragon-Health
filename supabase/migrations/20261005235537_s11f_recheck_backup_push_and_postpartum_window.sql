-- S11f: (1) a backup push from the server for the long recheck, and (2) the postpartum window read from the rule set.
--  * triage_pending_rechecks gains backup_at (null = no backup) and reminder_queued_at. record_triage_result sets backup_at
--    only for an APPROVED rule set whose params.recheckBackupPush asks for it and whose wait is at least minAfterMinutes
--    (the 2 hour recheck after 200/130): the phone's own local reminder is the first, this is the second, sent delayMinutes
--    later and only if the patient still has not measured again.
--  * private.queue_triage_recheck_backup_reminders() (every minute) queues ONE neutral reminder per such recheck: push, or
--    in-app when there is no push subscription (never email, never SMS: INV-08), plus an in-app copy. The wording is the
--    template triage_recheck_due in send-pending-notifications and never names a condition or a reading (INV-07).
--  * triage_context_for_observation reads the postpartum window (days) from the rule set instead of a fixed 42.
alter table public.triage_pending_rechecks
  add column if not exists backup_at timestamptz,
  add column if not exists reminder_queued_at timestamptz;
create index if not exists triage_pending_rechecks_backup_idx on public.triage_pending_rechecks (backup_at)
  where state = 'pending' and backup_at is not null and reminder_queued_at is null;

create or replace function public.triage_context_for_observation(p_observation_id uuid, p_recheck text default null, p_window_minutes integer default 15)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.vitals_readings%rowtype;
  v_prof public.profiles%rowtype;
  v_target record;
  v_prev record;
  v_recheck jsonb := null;
  v_symptoms jsonb;
  v_history jsonb;
  v_open jsonb;
  v_window integer;
  v_post_days integer;
begin
  select * into v from public.vitals_readings where id = p_observation_id;
  if not found or v.vital_type::text <> 'blood_pressure' or v.systolic is null or v.diastolic is null then
    return jsonb_build_object('found', false);
  end if;
  select * into v_prof from public.profiles where id = v.patient_id;
  -- The longest wait either recheck can have, read from the rule set that will grade (the engine itself decides which
  -- previous reading counts as a repeat), so a 2 hour recheck after 200/130 is found as well as a 5 minute one.
  select coalesce(greatest((rs.rules #>> '{params,recheck,windowMinutes}')::int, (rs.rules #>> '{params,extremeRecheck,windowMinutes}')::int), p_window_minutes),
         coalesce((rs.rules #>> '{params,postpartum,windowDays}')::int, 42)
    into v_window, v_post_days
  from public.triage_rule_sets rs
  where rs.code = 'bp_care_triage' and rs.status in ('approved', 'draft')
  order by (rs.status = 'approved') desc, rs.version desc limit 1;
  v_window := coalesce(v_window, p_window_minutes);
  v_post_days := coalesce(v_post_days, 42);
  select * into v_target from private.patient_home_bp_target(v.patient_id);

  select coalesce(jsonb_agg(distinct s.symptom_type::text), '[]'::jsonb) into v_symptoms
  from public.symptoms s
  where s.patient_id = v.patient_id
    and s.symptom_type::text in ('severe_headache', 'chest_pain', 'breathlessness', 'weakness_or_numbness',
          'difficulty_speaking', 'back_pain', 'epigastric_pain', 'confusion', 'visual_disturbance', 'fainting',
          'dizziness', 'palpitations')
    and s.created_at between v.created_at - interval '10 minutes' and v.created_at + interval '10 minutes';

  select coalesce(jsonb_agg(jsonb_build_object('systolic', h.systolic, 'diastolic', h.diastolic, 'takenAt', h.taken_at)
                            order by h.taken_at desc), '[]'::jsonb) into v_history
  from public.vitals_readings h
  where h.patient_id = v.patient_id and h.vital_type::text = 'blood_pressure' and h.id <> v.id
    and h.systolic is not null and h.diastolic is not null
    and h.taken_at between v.taken_at - interval '14 days' and v.taken_at;

  if p_recheck = 'timed_out' then
    v_recheck := jsonb_build_object('kind', 'timed_out');
  else
    select h.systolic, h.diastolic, h.taken_at into v_prev
    from public.triage_pending_rechecks p
    join public.vitals_readings h on h.id = p.observation_id
    where p.patient_id = v.patient_id and p.state = 'pending' and p.observation_id <> v.id
      and h.taken_at <= v.taken_at and h.taken_at >= v.taken_at - make_interval(mins => v_window)
    order by h.taken_at desc limit 1;
    if found then
      v_recheck := jsonb_build_object('kind', 'repeat',
        'previous', jsonb_build_object('systolic', v_prev.systolic, 'diastolic', v_prev.diastolic, 'takenAt', v_prev.taken_at),
        'minutesSincePrevious', round(extract(epoch from (v.taken_at - v_prev.taken_at)) / 60.0, 2));
    end if;
  end if;

  select coalesce(jsonb_agg(c.task_key), '[]'::jsonb) into v_open
  from (select distinct e.task_key from public.triage_events e
        where e.patient_id = v.patient_id and e.task_key is not null and not e.shadow
          and e.created_at > now() - interval '30 days') c;

  return jsonb_build_object(
    'found', true,
    'organisationId', v.organisation_id,
    'patientId', v.patient_id,
    'isTest', coalesce(v_prof.is_test, false),
    'observationId', v.id,
    'basis', md5(coalesce((select string_agg(s2, ',' order by s2) from jsonb_array_elements_text(v_symptoms) s2), '') || '|' || coalesce(v_recheck ->> 'kind', '')),
    'input', jsonb_strip_nulls(jsonb_build_object(
      'trigger', jsonb_strip_nulls(jsonb_build_object(
        'type', 'observation',
        'reading', jsonb_build_object('systolic', v.systolic, 'diastolic', v.diastolic, 'takenAt', v.taken_at),
        'symptoms', v_symptoms,
        -- The server cannot ask a question; the phone's form already did, so a reading here is answered.
        'symptomsAnswered', true,
        'recheck', v_recheck)),
      'history', v_history,
      'target', jsonb_build_object('systolic', v_target.systolic, 'diastolic', v_target.diastolic),
      'pathway', jsonb_build_object('state', 'self_guided'),
      'postpartum', exists (select 1 from public.postnatal_profiles pn where pn.patient_id = v.patient_id
                            and pn.delivery_date <= (v.taken_at at time zone 'Africa/Lagos')::date
                            and pn.delivery_date > (v.taken_at at time zone 'Africa/Lagos')::date - v_post_days),
      'pregnant', coalesce((select pp.is_pregnant from public.patient_pregnancy pp where pp.patient_id = v.patient_id limit 1), false),
      'ageYears', case when v_prof.date_of_birth is null then null else extract(year from age(v.taken_at, v_prof.date_of_birth))::int end,
      'now', now(),
      'existingOpenTaskKeys', v_open)));
end $$;

create or replace function public.record_triage_result(
  p_observation_id uuid,
  p_result jsonb,
  p_rule_set_id uuid,
  p_causation_id uuid default null,
  p_basis text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.vitals_readings%rowtype;
  v_rs public.triage_rule_sets%rowtype;
  v_status text := p_result ->> 'status';
  v_grade text := p_result ->> 'grade';
  v_shadow boolean;
  v_id uuid;
  v_created boolean := false;
  v_is_test boolean;
  v_actions jsonb := coalesce(p_result -> 'actions', '[]'::jsonb);
  v_after integer;
  v_window integer;
  v_min integer;
  v_delay integer;
  v_backup timestamptz;
begin
  if v_status not in ('graded', 'recheck_required', 'symptom_check_required', 'rejected') then
    raise exception 'record_triage_result: unknown status %', v_status using errcode = '22023';
  end if;
  select * into v from public.vitals_readings where id = p_observation_id;
  if not found then
    raise exception 'record_triage_result: observation % not found', p_observation_id using errcode = '22023';
  end if;
  select * into v_rs from public.triage_rule_sets where id = p_rule_set_id;
  if not found then
    raise exception 'record_triage_result: rule set % not found', p_rule_set_id using errcode = '22023';
  end if;
  if p_result #>> '{ruleSet,code}' is distinct from v_rs.code or (p_result #>> '{ruleSet,version}')::int is distinct from v_rs.version then
    raise exception 'record_triage_result: result was graded with a different rule set than the one named' using errcode = '22023';
  end if;
  select coalesce(is_test, false) into v_is_test from public.profiles where id = v.patient_id;
  v_shadow := v_rs.status <> 'approved';

  -- Not graded and nothing to store: a rejected reading, or a symptom question only the phone can ask.
  if v_status in ('rejected', 'symptom_check_required') then
    return jsonb_build_object('status', v_status, 'created', false);
  end if;

  if v_status = 'recheck_required' then
    v_after := coalesce((p_result #>> '{recheck,afterMinutes}')::int, 5);
    v_window := coalesce((p_result #>> '{recheck,windowMinutes}')::int, 15);
    update public.triage_pending_rechecks set state = 'superseded'
      where patient_id = v.patient_id and state = 'pending' and observation_id <> v.id;
    -- A backup push from the server for a long recheck (CMO decision): only for an APPROVED rule set (shadow results
    -- never message a patient), only when the rule set asks for it, and only for a wait of at least minAfterMinutes.
    v_min := (v_rs.rules #>> '{params,recheckBackupPush,minAfterMinutes}')::int;
    v_delay := (v_rs.rules #>> '{params,recheckBackupPush,delayMinutes}')::int;
    v_backup := case when v_rs.status = 'approved' and v_min is not null and v_delay is not null and v_after >= v_min
                     then v.taken_at + make_interval(mins => v_after + v_delay) end;
    insert into public.triage_pending_rechecks (observation_id, organisation_id, patient_id, due_at, backup_at)
      values (v.id, v.organisation_id, v.patient_id, v.taken_at + make_interval(mins => v_window), v_backup)
      on conflict (observation_id) do nothing;
    if not exists (select 1 from public.care_tasks t where t.patient_id = v.patient_id and t.source = 'triage_recheck'
                   and t.status in ('not_started', 'scheduled', 'in_progress')) then
      insert into public.care_tasks (organisation_id, patient_id, title, owner_role, priority, due_at, source, kind, source_event_id)
        values (v.organisation_id, v.patient_id, '', 'patient', 1, v.taken_at + make_interval(mins => v_after), 'triage_recheck', 'log_bp', p_causation_id);
    end if;
    return jsonb_build_object('status', 'recheck_required', 'created', true);
  end if;

  if v_grade not in ('green', 'amber', 'red') then
    raise exception 'record_triage_result: a graded result needs a grade' using errcode = '22023';
  end if;

  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id,
      rule_set_code, rule_set_version, rule_set_status, explanation_key, actions, matched_rule_ids, task_key, basis, shadow, is_test)
    values (v.organisation_id, v.patient_id, 'observation', v.id, v_grade, p_result ->> 'ruleId', v_rs.id,
      v_rs.code, v_rs.version, v_rs.status, p_result ->> 'explanationKey', v_actions,
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_result -> 'matchedRuleIds', '[]'::jsonb)) x), '{}'),
      p_result ->> 'taskKey', coalesce(p_basis, ''), v_shadow, coalesce(v_is_test, false))
    on conflict (trigger_type, trigger_id, rule_set_id, basis) do nothing
    returning id into v_id;
  v_created := v_id is not null;
  if not v_created then
    select id into v_id from public.triage_events
      where trigger_type = 'observation' and trigger_id = v.id and rule_set_id = v_rs.id and basis = coalesce(p_basis, '');
  end if;

  if v_created then
    update public.vitals_readings set triage_event_id = v_id where id = v.id and triage_event_id is null;
    -- Only readings taken no later than this one are settled by it: a late or regraded older reading must not
    -- close the wait on a newer first elevated reading.
    update public.triage_pending_rechecks p set state = case when p.observation_id = v.id then 'timed_out' else 'resolved' end
      where p.patient_id = v.patient_id and p.state = 'pending'
        and exists (select 1 from public.vitals_readings h where h.id = p.observation_id and h.taken_at <= v.taken_at);
    update public.care_tasks set status = 'completed'
      where patient_id = v.patient_id and source = 'triage_recheck' and status in ('not_started', 'scheduled', 'in_progress')
        and not exists (select 1 from public.triage_pending_rechecks p where p.patient_id = v.patient_id and p.state = 'pending');
    perform private.emit_domain_event(
      'triage.graded', v.organisation_id,
      jsonb_build_object('grade', v_grade, 'triage_event_id', v_id, 'observation_id', v.id,
        'rule_id', p_result ->> 'ruleId', 'rule_set_status', v_rs.status, 'shadow', v_shadow,
        'explanation_key', p_result ->> 'explanationKey', 'task_key', p_result ->> 'taskKey', 'actions', v_actions),
      'triage:' || v_id::text, v.patient_id, 'triage_event', v_id,
      case when v_grade = 'red' then 'urgent' else 'normal' end, null, p_causation_id);
  end if;
  return jsonb_build_object('status', 'graded', 'created', v_created, 'triage_event_id', v_id, 'shadow', v_shadow);
end $$;

create or replace function private.queue_triage_recheck_backup_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  r record;
  v_channel public.notification_channel;
begin
  for r in
    with claimed as (
      update public.triage_pending_rechecks p
         set reminder_queued_at = now()
       where p.state = 'pending' and p.backup_at is not null and p.backup_at <= now()
         and p.reminder_queued_at is null and p.due_at > now()
      returning p.observation_id, p.organisation_id, p.patient_id
    )
    select * from claimed
  loop
    v_channel := private.patient_reminder_channel(r.patient_id, false);
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
      values (r.organisation_id, r.patient_id, v_channel, 'pending', 'triage_recheck_due',
              jsonb_build_object('observation_id', r.observation_id), 'non_clinical');
    if v_channel <> 'in_app' then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
        values (r.organisation_id, r.patient_id, 'in_app', 'pending', 'triage_recheck_due',
                jsonb_build_object('observation_id', r.observation_id), 'non_clinical');
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function private.queue_triage_recheck_backup_reminders() from public, anon, authenticated;
select cron.schedule('triage-recheck-backup-push', '* * * * *', $$select private.queue_triage_recheck_backup_reminders()$$);

-- The draft rule set version 2 gains the two new settings (still a draft: nobody has approved it, so editing is allowed).
-- A test keeps this JSON identical to packages/clinical BP_CARE_V1.
update public.triage_rule_sets set rules = $rules_json${
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
}$rules_json$::jsonb
 where code = 'bp_care_triage' and version = 2 and status = 'draft';
do $$
begin
  if not exists (select 1 from public.triage_rule_sets where code = 'bp_care_triage' and version = 2 and rules #>> '{params,recheckBackupPush,delayMinutes}' = '10') then
    raise exception 'S11f self-check: the draft rule set v2 was not updated (is it still a draft?)';
  end if;
end $$;
