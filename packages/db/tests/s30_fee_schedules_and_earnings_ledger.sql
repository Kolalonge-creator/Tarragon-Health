-- S30 proof: fee schedules and the earnings ledger (migration *_s30_fee_schedules_and_earnings_ledger.sql).
-- One rolled-back transaction. Proves:
--   1. Fee schedules: admin only, invalid items refused, an approved schedule never changes (even for the table owner), one approved at a
--      time, the schedule in force at a moment, an unknown task type refused, clinicians told on approval.
--   2. The arithmetic: the SAME cases as packages/queue/fixtures/fee-cases.json (embedded below, drift-tested in Jest) through the SQL.
--   3. Task earnings: a contracted clinician's completion writes one line with the fee version and every input; the wait step is read at
--      claim time; employed doctors get no line; a task finished before any schedule waits and is posted retroactively; a retry never
--      pays twice; a missing task type is a flagged zero line; a posting failure never blocks completion and raises an incident.
--   4. Consultations, on-call shifts, lead months and the pilot minimum (shortfall only, merged runs, idempotent).
--   5. Adjustments (admin, reason, idempotent request id, clears a review flag) and the append-only ledger (update, delete, truncate,
--      direct insert refused; payout_id linkable once).
--   6. Access: a clinician reads only their own lines, admin reads all, the clinical lead cannot read others' pay, anon is refused,
--      test accounts are excluded from the admin summary (INV-13), queue_summary shows next_fee_kobo only to a contracted clinician.
--   7. SABOTAGE: the append-only trigger and the fee-version CHECK removed; both checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table saved(k text primary key, v text) on commit drop;
grant all on saved to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.backdate(p_task uuid, p_set text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.task_transition', 'on', true);
  execute format('update public.clinical_tasks set %s where id = %L', p_set, p_task);
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's30-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S30 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S30 ' || p_label, 'MDCN', 'S30-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, true)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;
create function pg_temp.mkblock(p_org uuid, p_uid uuid) returns void language sql as
$$ insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
   values (p_org, p_uid, now() - interval '1 minute', now() + interval '2 hours', 'queue', true) $$;
-- tasks are pushed to an employed doctor when one exists; for a contracted clinician's test they are made plain pool tasks
create function pg_temp.mktask(p_patient uuid, p_type text, p_pull boolean default true) returns uuid language plpgsql as
$f$ declare t uuid;
begin
  t := private.create_clinical_task(p_patient, p_type, null);
  if p_pull then perform pg_temp.backdate(t, 'state = ''open'', delivery_path = ''pull'', pushed_to = null, lead_window_ends_at = null'); end if;
  return t;
end $f$;
-- make a task look like it has waited: created `p_created_ago` ago, due `p_due_in` from now
create function pg_temp.age_task(p_task uuid, p_created_ago text, p_due_in text) returns void language sql as
$$ select pg_temp.backdate(p_task, format('created_at = now() - interval %L, due_at = now() + interval %L', p_created_ago, p_due_in)) $$;
create function pg_temp.next_as(p_uid uuid) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.queue_next(); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
-- claim the next task as p_uid and complete it; returns the claimed task id
create function pg_temp.work(p_uid uuid) returns uuid language plpgsql as
$f$ declare v_task uuid;
begin
  v_task := (pg_temp.next_as(p_uid) -> 'task' ->> 'id')::uuid;
  if v_task is null then return null; end if;
  perform pg_temp.act(p_uid);
  perform public.queue_complete(v_task, '{"done": true}'::jsonb);
  perform pg_temp.back();
  return v_task;
end $f$;
create function pg_temp.clear_queue() returns void language plpgsql as
$f$ declare r record;
begin
  for r in select id from public.clinical_tasks where state not in ('completed', 'cancelled') loop
    update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = r.id and ended_at is null;
    perform private.apply_task_transition(r.id, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');
  end loop;
end $f$;
create function pg_temp.lines_of(p_uid uuid, p_kind text) returns bigint language sql as
$$ select count(*) from public.earnings_ledger where clinician_id = p_uid and kind = p_kind $$;
create function pg_temp.amt_of(p_uid uuid, p_kind text) returns text language sql as
$$ select string_agg(amount_kobo::text, ',' order by amount_kobo) from public.earnings_ledger where clinician_id = p_uid and kind = p_kind $$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------
-- fee-cases-begin
create temp table fee_cases(j jsonb) on commit drop;
insert into fee_cases values ($json${
 "note": "S30. Shared by packages/queue/src/fees.test.ts and packages/db/tests/s30_fee_schedules_and_earnings_ledger.sql. Test amounts only, not proposals: real amounts are set by the founder.",
 "items": {
  "task_types": {
   "amber_bp_review": {
    "base_fee_kobo": 100000,
    "wait_multiplier_steps": [
     {
      "at_pct": 50,
      "add_pct": 10
     },
     {
      "at_pct": 100,
      "add_pct": 25
     }
    ]
   },
   "symptom_review": {
    "base_fee_kobo": 333,
    "wait_multiplier_steps": [
     {
      "at_pct": 50,
      "add_pct": 10
     },
     {
      "at_pct": 100,
      "add_pct": 25
     }
    ]
   },
   "admin_clinical": {
    "base_fee_kobo": 50000,
    "wait_multiplier_steps": []
   },
   "critical_result_review": {
    "base_fee_kobo": 0,
    "wait_multiplier_steps": [
     {
      "at_pct": 100,
      "add_pct": 25
     }
    ]
   }
  },
  "on_call_shift_fee_kobo": 2000000,
  "lead_fee_per_patient_month_kobo": 150000,
  "consultation_share_pct": {
   "video": 60,
   "audio": 50,
   "phone": 40
  },
  "consultation_reference_price_kobo": {
   "video": 1000000
  },
  "pilot_minimum_per_declared_hour_kobo": 250000
 },
 "rules": {
  "lead_month": {
   "min_active_days": 15
  },
  "on_call": {
   "backup_fee_pct": 50
  },
  "minimum_guarantee": {
   "counted_kinds": [
    "task",
    "consultation",
    "on_call_shift"
   ]
  }
 },
 "taskCases": [
  {
   "name": "claimed straight away: base fee only",
   "type": "amber_bp_review",
   "created": "2026-10-01T08:00:00Z",
   "due": "2026-10-02T08:00:00Z",
   "claimed": "2026-10-01T08:30:00Z",
   "expect": {
    "amount": 100000,
    "elapsed": 2,
    "step": null,
    "addPct": 0
   }
  },
  {
   "name": "just before half the window: still base",
   "type": "amber_bp_review",
   "created": "2026-10-01T08:00:00Z",
   "due": "2026-10-02T08:00:00Z",
   "claimed": "2026-10-01T19:59:00Z",
   "expect": {
    "amount": 100000,
    "elapsed": 49,
    "step": null,
    "addPct": 0
   }
  },
  {
   "name": "exactly half the window: plus 10 percent",
   "type": "amber_bp_review",
   "created": "2026-10-01T08:00:00Z",
   "due": "2026-10-02T08:00:00Z",
   "claimed": "2026-10-01T20:00:00Z",
   "expect": {
    "amount": 110000,
    "elapsed": 50,
    "step": 50,
    "addPct": 10
   }
  },
  {
   "name": "after half, before due: still plus 10",
   "type": "amber_bp_review",
   "created": "2026-10-01T08:00:00Z",
   "due": "2026-10-02T08:00:00Z",
   "claimed": "2026-10-02T07:00:00Z",
   "expect": {
    "amount": 110000,
    "elapsed": 95,
    "step": 50,
    "addPct": 10
   }
  },
  {
   "name": "at the due time: plus 25 percent, replacing the 10",
   "type": "amber_bp_review",
   "created": "2026-10-01T08:00:00Z",
   "due": "2026-10-02T08:00:00Z",
   "claimed": "2026-10-02T08:00:00Z",
   "expect": {
    "amount": 125000,
    "elapsed": 100,
    "step": 100,
    "addPct": 25
   }
  },
  {
   "name": "long overdue stays plus 25, never grows",
   "type": "amber_bp_review",
   "created": "2026-10-01T08:00:00Z",
   "due": "2026-10-02T08:00:00Z",
   "claimed": "2026-10-09T08:00:00Z",
   "expect": {
    "amount": 125000,
    "elapsed": 100,
    "step": 100,
    "addPct": 25
   }
  },
  {
   "name": "rounds down to the kobo",
   "type": "symptom_review",
   "created": "2026-10-01T08:00:00Z",
   "due": "2026-10-02T08:00:00Z",
   "claimed": "2026-10-01T20:00:00Z",
   "expect": {
    "amount": 366,
    "elapsed": 50,
    "step": 50,
    "addPct": 10
   }
  },
  {
   "name": "a type with no steps pays its base however late",
   "type": "admin_clinical",
   "created": "2026-10-01T08:00:00Z",
   "due": "2026-10-02T08:00:00Z",
   "claimed": "2026-10-09T08:00:00Z",
   "expect": {
    "amount": 50000,
    "elapsed": 100,
    "step": null,
    "addPct": 0
   }
  },
  {
   "name": "a zero base stays zero whatever the step",
   "type": "critical_result_review",
   "created": "2026-10-01T08:00:00Z",
   "due": "2026-10-01T10:00:00Z",
   "claimed": "2026-10-01T12:00:00Z",
   "expect": {
    "amount": 0,
    "elapsed": 100,
    "step": 100,
    "addPct": 25
   }
  },
  {
   "name": "a zero-length window (due at creation) claimed on time is overdue",
   "type": "amber_bp_review",
   "created": "2026-10-01T08:00:00Z",
   "due": "2026-10-01T08:00:00Z",
   "claimed": "2026-10-01T08:00:00Z",
   "expect": {
    "amount": 125000,
    "elapsed": 100,
    "step": 100,
    "addPct": 25
   }
  },
  {
   "name": "claimed before the task existed counts as nothing waited",
   "type": "amber_bp_review",
   "created": "2026-10-01T08:00:00Z",
   "due": "2026-10-02T08:00:00Z",
   "claimed": "2026-10-01T07:00:00Z",
   "expect": {
    "amount": 100000,
    "elapsed": 0,
    "step": null,
    "addPct": 0
   }
  },
  {
   "name": "a task type missing from the schedule is flagged, not zero",
   "type": "titration_signoff",
   "created": "2026-10-01T08:00:00Z",
   "due": "2026-10-02T08:00:00Z",
   "claimed": "2026-10-01T09:00:00Z",
   "expect": {
    "needsReview": "no_fee_for_task_type"
   }
  }
 ],
 "consultationCases": [
  {
   "name": "video: 60 percent of the paid price",
   "type": "video",
   "purchase": 1200000,
   "expect": {
    "amount": 720000,
    "basis": "purchase"
   }
  },
  {
   "name": "audio: 50 percent, rounded down",
   "type": "audio",
   "purchase": 1001,
   "expect": {
    "amount": 500,
    "basis": "purchase"
   }
  },
  {
   "name": "phone: 40 percent",
   "type": "phone",
   "purchase": 500000,
   "expect": {
    "amount": 200000,
    "basis": "purchase"
   }
  },
  {
   "name": "no purchase but a reference price: share of the reference",
   "type": "video",
   "purchase": null,
   "expect": {
    "amount": 600000,
    "basis": "reference_price"
   }
  },
  {
   "name": "no purchase and no reference price: flagged",
   "type": "audio",
   "purchase": null,
   "expect": {
    "needsReview": "no_price_basis"
   }
  },
  {
   "name": "a free (zero) purchase is a real zero, not a missing price",
   "type": "video",
   "purchase": 0,
   "expect": {
    "amount": 0,
    "basis": "purchase"
   }
  }
 ],
 "leadCases": [
  {
   "name": "14 days: no fee",
   "days": 14,
   "expect": 0
  },
  {
   "name": "15 days: the fee",
   "days": 15,
   "expect": 150000
  },
  {
   "name": "a full month: the fee, once",
   "days": 31,
   "expect": 150000
  }
 ],
 "onCallCases": [
  {
   "name": "primary: the whole shift fee",
   "role": "primary",
   "expect": 2000000
  },
  {
   "name": "backup: the configured percent",
   "role": "backup",
   "expect": 1000000
  }
 ],
 "minimumCases": [
  {
   "name": "8 declared hours, nothing earned: the whole guarantee",
   "seconds": 28800,
   "earned": 0,
   "expect": {
    "guarantee": 2000000,
    "topUp": 2000000
   }
  },
  {
   "name": "earned part: only the shortfall",
   "seconds": 28800,
   "earned": 1500000,
   "expect": {
    "guarantee": 2000000,
    "topUp": 500000
   }
  },
  {
   "name": "earned more than the guarantee: no top-up",
   "seconds": 28800,
   "earned": 2500000,
   "expect": {
    "guarantee": 2000000,
    "topUp": 0
   }
  },
  {
   "name": "a part hour counts in proportion, rounded down",
   "seconds": 2700,
   "earned": 0,
   "expect": {
    "guarantee": 187500,
    "topUp": 187500
   }
  }
 ],
 "invalidItems": [
  {
   "name": "a negative amount",
   "mutate": {
    "on_call_shift_fee_kobo": -1
   }
  },
  {
   "name": "a fraction of a kobo",
   "mutate": {
    "lead_fee_per_patient_month_kobo": 10.5
   }
  },
  {
   "name": "an amount past the typo guard",
   "mutate": {
    "pilot_minimum_per_declared_hour_kobo": 1000000001
   }
  },
  {
   "name": "a share over 100",
   "mutate": {
    "consultation_share_pct": {
     "video": 101,
     "audio": 0,
     "phone": 0
    }
   }
  },
  {
   "name": "a missing consultation type",
   "mutate": {
    "consultation_share_pct": {
     "video": 10,
     "audio": 0
    }
   }
  },
  {
   "name": "an unknown key",
   "mutate": {
    "surge_fee_kobo": 5
   }
  },
  {
   "name": "steps out of order",
   "mutate": {
    "task_types": {
     "symptom_review": {
      "base_fee_kobo": 1,
      "wait_multiplier_steps": [
       {
        "at_pct": 100,
        "add_pct": 25
       },
       {
        "at_pct": 50,
        "add_pct": 10
       }
      ]
     }
    }
   }
  },
  {
   "name": "a step with no uplift field",
   "mutate": {
    "task_types": {
     "symptom_review": {
      "base_fee_kobo": 1,
      "wait_multiplier_steps": [
       {
        "at_pct": 50
       }
      ]
     }
    }
   }
  },
  {
   "name": "a task type with no fee",
   "mutate": {
    "task_types": {
     "symptom_review": {
      "wait_multiplier_steps": []
     }
    }
   }
  },
  {
   "name": "a bad task type code",
   "mutate": {
    "task_types": {
     "Symptom Review": {
      "base_fee_kobo": 1,
      "wait_multiplier_steps": []
     }
    }
   }
  },
  {
   "name": "a reference price for an unknown type",
   "mutate": {
    "consultation_reference_price_kobo": {
     "async": 5
    }
   }
  },
  {
   "name": "task_types not an object",
   "mutate": {
    "task_types": []
   }
  }
 ]
}$json$::jsonb);
-- fee-cases-end
create function pg_temp.cases() returns jsonb language sql as $$ select j from fee_cases $$;
create function pg_temp.items() returns jsonb language sql as $$ select j -> 'items' from fee_cases $$;

do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', 'contracted', '{adult_general,hypertension}', v_admin));
  perform pg_temp.setf('doc2', pg_temp.mkdoc(v_org, 'doc2', 'senior_medical_officer', 'contracted', '{adult_general,hypertension}', v_admin));
  perform pg_temp.setf('emp', pg_temp.mkdoc(v_org, 'emp', 'senior_medical_officer', 'employed', '{adult_general,hypertension}', v_admin));
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{adult_general,on_call,prescribing,result_review,hypertension}', v_admin));
  perform pg_temp.setf('p1', pg_temp.mkuser(v_org, 'p1', 'patient'));
  perform pg_temp.setf('p2', pg_temp.mkuser(v_org, 'p2', 'patient'));
  perform pg_temp.setf('p3', pg_temp.mkuser(v_org, 'p3', 'patient'));
  perform pg_temp.mkblock(v_org, pg_temp.f('doc'));
  perform pg_temp.mkblock(v_org, pg_temp.f('emp'));
  perform pg_temp.ck('setup: no fee schedule exists before the founder sets one', '0', (select count(*) from public.fee_schedules)::text);
end $$;

-- 3a. A contracted clinician finishes a task BEFORE any schedule is approved: nothing is lost, nothing is guessed ----------
do $$
declare v_doc uuid := pg_temp.f('doc'); t uuid;
begin
  t := pg_temp.mktask(pg_temp.f('p1'), 'symptom_review');
  perform pg_temp.age_task(t, '12 hours', '12 hours');
  perform pg_temp.setf('t_early', t);
  perform pg_temp.work(v_doc);
  -- the transaction clock is frozen, so make the completion earlier than the approval that comes later in this proof
  perform pg_temp.backdate(t, 'completed_at = now() - interval ''2 hours''');
  perform pg_temp.ck('a task is claimed and completed with no schedule', 'completed', (select state::text from public.clinical_tasks where id = t));
  perform pg_temp.ck('...it writes no line yet (no amount is guessed)', '0', pg_temp.lines_of(v_doc, 'task')::text);
  perform pg_temp.ck('...and the completion was not blocked or logged as an error', '0', (select count(*) from public.audit_log where action = 'earnings.post_error')::text);
  perform pg_temp.ck('...and the admin health check shows one task waiting for a schedule', '1',
    (pg_temp.q_as(pg_temp.f('admin'), 'select (public.earnings_health(true) ->> ''tasks_waiting_for_a_schedule'')'))::text);
end $$;

-- 1. Fee schedules ----------------------------------------------------------------------------------------------------------
do $$
declare
  v_admin uuid := pg_temp.f('admin'); v_doc uuid := pg_temp.f('doc'); v_items jsonb := pg_temp.items(); d1 uuid; d2 uuid; c jsonb; v_res text; v_n integer := 0;
begin
  perform pg_temp.ck('a clinician cannot create a fee schedule', 'fee_not_authorised',
    pg_temp.try_as(v_doc, format('select public.create_fee_schedule_draft(%L::jsonb)', v_items::text)));
  perform pg_temp.ck('a draft needs items when there is nothing to copy', 'true',
    (pg_temp.try_as(v_admin, 'select public.create_fee_schedule_draft()') like 'fee_items_needed%')::text);
  for c in select value from jsonb_array_elements(pg_temp.cases() -> 'invalidItems') loop
    v_n := v_n + 1;
    perform pg_temp.ck('invalid items refused: ' || (c ->> 'name'), 'false', private.fee_items_valid(v_items || (c -> 'mutate'))::text);
  end loop;
  perform pg_temp.ck('invalid items refused in a CHECK too (not only in the function)', '23514',
    pg_temp.try_sql(format($q$select set_config('tarragon.fee_write', 'on', true); insert into public.fee_schedules (organisation_id, version, items) values (%L, 99, '{}'::jsonb)$q$, pg_temp.f('org'))));
  perform pg_temp.ck('the shared valid items pass the database rule', 'true', private.fee_items_valid(v_items)::text);
  perform pg_temp.ck('a task type that does not exist is refused', 'true',
    (pg_temp.try_as(v_admin, format($q$select public.create_fee_schedule_draft(%L::jsonb)$q$, jsonb_set(v_items, '{task_types,made_up_type}', '{"base_fee_kobo":1,"wait_multiplier_steps":[]}')::text)) like 'fee_unknown_task_type%')::text);

  perform pg_temp.act(v_admin);
  d1 := public.create_fee_schedule_draft(v_items, 'S30 proof test amounts');
  perform pg_temp.back();
  perform pg_temp.setf('d1', d1);
  perform pg_temp.ck('the admin creates draft version 1', '1', (select version::text from public.fee_schedules where id = d1));
  perform pg_temp.ck('a draft can be edited', 'ok', pg_temp.try_as(v_admin, format('select public.update_fee_schedule_draft(%L, %L::jsonb, %L)', d1, v_items::text, 'edited')));
  perform pg_temp.ck('nothing written directly into fee_schedules, even by the owner', '42501',
    pg_temp.try_sql(format($q$update public.fee_schedules set note = 'x' where id = %L$q$, d1)));
  perform pg_temp.ck('a clinician cannot approve', 'fee_not_authorised', pg_temp.try_as(v_doc, format('select public.approve_fee_schedule(%L)', d1)));
  perform pg_temp.ck('a clinician cannot read the schedules table', '0', pg_temp.q_as(v_doc, 'select count(*)::text from public.fee_schedules'));
  perform pg_temp.ck('approve reports the creatable task types with no fee (so the gap is seen)', 'true',
    ((pg_temp.q_as(v_admin, format('select public.approve_fee_schedule(%L)::text', d1)))::jsonb -> 'task_types_without_fee' ? 'titration_signoff')::text);
  perform pg_temp.ck('...and the schedule is approved by the admin, now', 'approved',
    (select status from public.fee_schedules where id = d1 and approved_by = v_admin and approved_at is not null));
  perform pg_temp.ck('...an approved schedule cannot be edited (a draft-only call)', 'fee_not_a_draft',
    pg_temp.try_as(v_admin, format('select public.update_fee_schedule_draft(%L, %L::jsonb)', d1, v_items::text)));
  perform pg_temp.ck('...nor changed directly, even with the write door open', '23514',
    pg_temp.try_sql(format($q$select set_config('tarragon.fee_write', 'on', true); update public.fee_schedules set items = '{}'::jsonb where id = %L$q$, d1)));
  perform pg_temp.ck('...nor deleted', '23514',
    pg_temp.try_sql(format($q$select set_config('tarragon.fee_write', 'on', true); delete from public.fee_schedules where id = %L$q$, d1)));
  perform pg_temp.ck('...nor approved twice', 'fee_not_a_draft', pg_temp.try_as(v_admin, format('select public.approve_fee_schedule(%L)', d1)));
  perform pg_temp.ck('the contracted clinician was told (in app, neutral text)', 'true',
    (exists (select 1 from public.notifications where recipient_id = v_doc and payload ->> 'fee_schedule_id' = d1::text))::text);
  perform pg_temp.ck('an employed doctor was not told (salaried)', 'false',
    (exists (select 1 from public.notifications where recipient_id = pg_temp.f('emp') and payload ->> 'fee_schedule_id' = d1::text))::text);
  perform pg_temp.ck('the contracted clinician reads the schedule that applies to them', 'true',
    ((pg_temp.q_as(v_doc, 'select public.my_fee_schedule()::text'))::jsonb ->> 'approved')::text);
  perform pg_temp.ck('an employed doctor has no fee schedule to read', 'earnings_not_contracted', pg_temp.try_as(pg_temp.f('emp'), 'select public.my_fee_schedule()'));
end $$;

-- 2. The arithmetic: the shared cases through the SQL -----------------------------------------------------------------------
do $$
declare c jsonb; r jsonb; v_items jsonb := pg_temp.items(); rules jsonb := pg_temp.cases() -> 'rules'; v_amt bigint; v_days integer;
begin
  for c in select value from jsonb_array_elements(pg_temp.cases() -> 'taskCases') loop
    r := private.fee_task_calc(v_items, c ->> 'type', (c ->> 'created')::timestamptz, (c ->> 'due')::timestamptz, (c ->> 'claimed')::timestamptz);
    if c -> 'expect' ? 'needsReview' then
      perform pg_temp.ck('task case: ' || (c ->> 'name'), c -> 'expect' ->> 'needsReview', r ->> 'needs_review');
    else
      perform pg_temp.ck('task case: ' || (c ->> 'name'),
        concat_ws('|', c -> 'expect' ->> 'amount', c -> 'expect' ->> 'elapsed', coalesce(c -> 'expect' ->> 'step', 'null'), c -> 'expect' ->> 'addPct'),
        concat_ws('|', r ->> 'amount_kobo', r ->> 'elapsed_pct', coalesce(r ->> 'step_at_pct', 'null'), r ->> 'add_pct'));
    end if;
  end loop;
  for c in select value from jsonb_array_elements(pg_temp.cases() -> 'consultationCases') loop
    r := private.fee_consultation_calc(v_items, c ->> 'type', (c ->> 'purchase')::bigint);
    if c -> 'expect' ? 'needsReview' then
      perform pg_temp.ck('consultation case: ' || (c ->> 'name'), c -> 'expect' ->> 'needsReview', r ->> 'needs_review');
    else
      perform pg_temp.ck('consultation case: ' || (c ->> 'name'), (c -> 'expect' ->> 'amount') || '|' || (c -> 'expect' ->> 'basis'), (r ->> 'amount_kobo') || '|' || (r ->> 'basis'));
    end if;
  end loop;
  for c in select value from jsonb_array_elements(pg_temp.cases() -> 'minimumCases') loop
    r := private.fee_minimum_calc(v_items, (c ->> 'seconds')::numeric, (c ->> 'earned')::bigint);
    perform pg_temp.ck('minimum case: ' || (c ->> 'name'), (c -> 'expect' ->> 'guarantee') || '|' || (c -> 'expect' ->> 'topUp'), (r ->> 'guarantee_kobo') || '|' || (r ->> 'top_up_kobo'));
  end loop;
end $$;

-- 3b. Sweep posts the early task retroactively; completed tasks write one line with the version and inputs ----------------
do $$
declare
  v_doc uuid := pg_temp.f('doc'); v_emp uuid := pg_temp.f('emp'); v_d1 uuid := pg_temp.f('d1'); t uuid; t2 uuid; t3 uuid; t4 uuid; r jsonb;
begin
  perform pg_temp.clear_queue();
  r := private.earnings_sweep();
  perform pg_temp.ck('the sweep posts the task that finished before any schedule', '1', pg_temp.lines_of(v_doc, 'task')::text);
  perform pg_temp.ck('...using the first approved schedule, and says so', 'true',
    (select (calculation ->> 'retroactive_first_schedule')::boolean::text from public.earnings_ledger where clinician_id = v_doc and kind = 'task'));
  perform pg_temp.ck('...the amount is the base plus 10 percent (half the window had passed): 333 -> 366', '366', pg_temp.amt_of(v_doc, 'task'));
  perform pg_temp.ck('...the task row records the fee and the schedule version (INV-16)', '366|true',
    (select fee_kobo_at_completion || '|' || (fee_schedule_version_id = v_d1)::text from public.clinical_tasks where id = pg_temp.f('t_early')));
  perform pg_temp.ck('the health check now shows nothing waiting', '0', (pg_temp.q_as(pg_temp.f('admin'), 'select (public.earnings_health(true) ->> ''tasks_waiting_for_a_schedule'')'))::text);
  r := private.earnings_sweep();
  perform pg_temp.ck('a second sweep pays nothing twice', '1', pg_temp.lines_of(v_doc, 'task')::text);
  perform pg_temp.ck('...nor does posting the same task again', 'true', private.post_task_earning(pg_temp.f('t_early'))::text);
  perform pg_temp.ck('...still one line', '1', pg_temp.lines_of(v_doc, 'task')::text);

  -- a fresh task claimed at half the window, at 95 percent, and when overdue
  t := pg_temp.mktask(pg_temp.f('p2'), 'amber_bp_review');
  perform pg_temp.age_task(t, '12 hours', '12 hours');
  perform pg_temp.work(v_doc);
  perform pg_temp.ck('amber review claimed at half the window: 100000 + 10 percent', '110000', (select amount_kobo::text from public.earnings_ledger where reference_id = t));
  perform pg_temp.ck('...the line is dated at completion and records the schedule and the inputs', 'true',
    (select (fee_schedule_version_id = v_d1 and calculation ->> 'task_type' = 'amber_bp_review' and (calculation ->> 'elapsed_pct')::int = 50
             and calculation ? 'claimed_at' and calculation ? 'due_at' and calculation ? 'schedule_version' and is_test)::text from public.earnings_ledger where reference_id = t));
  perform pg_temp.ck('...a line names no patient', 'false', (select (to_jsonb(l)::text like '%' || pg_temp.f('p2')::text || '%')::text from public.earnings_ledger l where l.reference_id = t));
  t2 := pg_temp.mktask(pg_temp.f('p2'), 'amber_bp_review');
  perform pg_temp.age_task(t2, '30 hours', '-6 hours');
  perform pg_temp.work(v_doc);
  perform pg_temp.ck('claimed overdue: plus 25 percent, not stacked on the 10', '125000', (select amount_kobo::text from public.earnings_ledger where reference_id = t2));
  t3 := pg_temp.mktask(pg_temp.f('p3'), 'amber_bp_review');
  perform pg_temp.age_task(t3, '1 hour', '23 hours');
  perform pg_temp.work(v_doc);
  perform pg_temp.ck('claimed early: the base only', '100000', (select amount_kobo::text from public.earnings_ledger where reference_id = t3));

  -- an employed doctor completes a task: salary, so no line and no fee on the task
  t4 := pg_temp.mktask(pg_temp.f('p1'), 'symptom_review', false);
  perform pg_temp.work(v_emp);
  perform pg_temp.ck('an employed doctor completing a task writes no ledger line', '0', (select count(*) from public.earnings_ledger where clinician_id = v_emp)::text);
  perform pg_temp.ck('...and the task keeps empty fee columns', 'true', (select (fee_kobo_at_completion is null and fee_schedule_version_id is null)::text from public.clinical_tasks where id = t4));
  perform pg_temp.ck('...but it was completed', 'completed', (select state::text from public.clinical_tasks where id = t4));
end $$;

-- 3c. A task type missing from the schedule is a flagged zero line, never a silent skip -----------------------------------
do $$
declare v_doc uuid := pg_temp.f('doc'); t uuid;
begin
  t := pg_temp.mktask(pg_temp.f('p1'), 'async_question');
  perform pg_temp.work(v_doc);
  perform pg_temp.ck('a task type with no fee writes a zero line flagged for review', 'no_fee_for_task_type|0',
    (select (calculation ->> 'needs_review') || '|' || amount_kobo from public.earnings_ledger where reference_id = t));
  perform pg_temp.ck('...admin sees it in the review list', '1', (pg_temp.q_as(pg_temp.f('admin'), 'select count(*)::text from public.earnings_needing_review(true)')));
  perform pg_temp.setf('flagged_line', (select id from public.earnings_ledger where reference_id = t));
end $$;

-- 3d. A failure while posting never blocks the completion, and raises an incident ------------------------------------------
do $$
declare v_doc uuid := pg_temp.f('doc'); v_def text; t uuid; v_before bigint;
begin
  select pg_get_functiondef('private.fee_task_calc(jsonb,text,timestamptz,timestamptz,timestamptz)'::regprocedure) into v_def;
  insert into saved values ('fee_task_calc', v_def);
  create or replace function private.fee_task_calc(p_items jsonb, p_type text, p_created timestamptz, p_due timestamptz, p_claimed timestamptz) returns jsonb
  language plpgsql immutable set search_path = '' as $f$ begin raise exception 'proof: calculator down'; end $f$;
  t := pg_temp.mktask(pg_temp.f('p2'), 'symptom_review');
  perform pg_temp.work(v_doc);
  perform pg_temp.ck('with the calculator broken, the clinician can still complete the task', 'completed', (select state::text from public.clinical_tasks where id = t));
  perform pg_temp.ck('...the failure is logged', 'true', (select (count(*) >= 1)::text from public.audit_log where action = 'earnings.post_error'));
  perform pg_temp.ck('...no line was written for it', '0', (select count(*) from public.earnings_ledger where clinician_id = v_doc and kind = 'task' and reference_id = t)::text);
  perform private.earnings_sweep();
  perform pg_temp.ck('...the sweep raises one open incident for operations', '1', (select count(*) from public.ops_incidents where external_reference = 'earnings_sweep' and status not in ('resolved', 'closed'))::text);
  perform private.earnings_sweep();
  perform pg_temp.ck('...and not a second one', '1', (select count(*) from public.ops_incidents where external_reference = 'earnings_sweep' and status not in ('resolved', 'closed'))::text);
  execute (select v from saved where k = 'fee_task_calc');
  perform private.earnings_sweep();
  perform pg_temp.ck('once fixed, the sweep posts the missed line', '1', (select count(*) from public.earnings_ledger where clinician_id = v_doc and kind = 'task' and reference_id = t)::text);
end $$;

-- 4a. Consultations ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_doc uuid := pg_temp.f('doc'); v_emp uuid := pg_temp.f('emp'); v_p uuid := pg_temp.f('p1'); v_prod uuid; v_pur uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid;
begin
  select id into v_prod from public.service_products order by created_at limit 1;
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
  values (v_org, v_p, v_prod, 'active', 1200000, 'NGN', now(), now() + interval '90 days') returning id into v_pur;
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, service_purchase_id, is_test)
  values (v_org, v_p, v_doc, 'video', 'scheduled', now(), 1, v_pur, true) returning id into e1;
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, is_test)
  values (v_org, v_p, v_doc, 'video', 'scheduled', now(), 1, true) returning id into e2;
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, is_test)
  values (v_org, v_p, v_doc, 'phone', 'scheduled', now(), 1, true) returning id into e3;
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, is_test)
  values (v_org, v_p, v_emp, 'video', 'scheduled', now(), 1, true) returning id into e4;
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, is_test)
  values (v_org, v_p, v_doc, 'audio', 'scheduled', now(), 1, true) returning id into e5;
  -- the purchase is a price for e1 only because e1 used it up; e2 points at a purchase it did not redeem (like a Membership)
  update public.service_purchases set redeemed_at = now(), redeemed_entity_type = 'appointment', redeemed_entity_id = e1 where id = v_pur;
  update public.encounters set service_purchase_id = v_pur where id = e2;
  update public.encounters set status = 'completed', ended_at = now() where id in (e1, e2, e3, e4);
  update public.encounters set status = 'cancelled' where id = e5;
  perform pg_temp.ck('video consultation with a paid purchase: 60 percent of the price paid', '720000|purchase',
    (select amount_kobo || '|' || (calculation ->> 'basis') from public.earnings_ledger where reference_id = e1));
  perform pg_temp.ck('video pointing at a purchase it did not use up (a Membership): the reference price, not the purchase', '600000|reference_price',
    (select amount_kobo || '|' || (calculation ->> 'basis') from public.earnings_ledger where reference_id = e2));
  perform pg_temp.ck('phone with no purchase and no reference price: a flagged zero line', 'no_price_basis|0',
    (select (calculation ->> 'needs_review') || '|' || amount_kobo from public.earnings_ledger where reference_id = e3));
  perform pg_temp.ck('an employed doctor earns no consultation line', '0', (select count(*) from public.earnings_ledger where reference_id = e4)::text);
  perform pg_temp.ck('a cancelled consultation earns nothing', '0', (select count(*) from public.earnings_ledger where reference_id = e5)::text);
  update public.encounters set updated_at = now() where id = e1;
  perform private.earnings_sweep();
  perform pg_temp.ck('completing or sweeping again never pays twice', '3', pg_temp.lines_of(v_doc, 'consultation')::text);
end $$;

-- a task that produced a paid live consultation is paid once, by the share
do $$
declare v_org uuid := pg_temp.f('org'); v_doc uuid := pg_temp.f('doc'); t uuid; e uuid;
begin
  t := pg_temp.mktask(pg_temp.f('p3'), 'symptom_review');
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, task_id, is_test)
  values (v_org, pg_temp.f('p3'), v_doc, 'video', 'scheduled', now(), 1, t, true) returning id into e;
  perform pg_temp.work(v_doc);
  perform pg_temp.ck('a task linked to a paid video consultation earns no task line (the share pays it once)', '0', (select count(*) from public.earnings_ledger where reference_id = t)::text);
  update public.encounters set status = 'completed', ended_at = now() where id = e;
  perform pg_temp.ck('...and the consultation earns its share', '1', (select count(*) from public.earnings_ledger where reference_id = e)::text);
end $$;

-- 4b. On-call shifts --------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_doc uuid := pg_temp.f('doc'); v_cmo uuid := pg_temp.f('cmo'); v_rota uuid;
begin
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test)
  values (v_org, now() - interval '30 hours', now() - interval '18 hours', v_doc, v_cmo, true) returning id into v_rota;
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test)
  values (v_org, now() - interval '2 hours', now() + interval '10 hours', v_doc, v_cmo, true);
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.earnings_sweep();
  perform pg_temp.ck('a finished shift pays the primary the shift fee', '2000000', pg_temp.amt_of(v_doc, 'on_call_shift'));
  perform pg_temp.ck('...the backup earns nothing by default (0 percent)', '0', pg_temp.lines_of(v_cmo, 'on_call_shift')::text);
  perform pg_temp.ck('...a shift still running pays nothing yet', '1', pg_temp.lines_of(v_doc, 'on_call_shift')::text);
  update public.earnings_config set rules = jsonb_set(rules, '{on_call,backup_fee_pct}', '50') where is_active;
  perform private.earnings_sweep();
  perform pg_temp.ck('with a 50 percent backup share the backup earns half', '1000000', pg_temp.amt_of(v_cmo, 'on_call_shift'));
  update public.earnings_config set rules = jsonb_set(rules, '{on_call,backup_fee_pct}', '0') where is_active;
  perform private.earnings_sweep();
  perform pg_temp.ck('a repeat sweep never pays a shift twice', '1', pg_temp.lines_of(v_doc, 'on_call_shift')::text);
end $$;

-- 4c. Lead months -----------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_doc uuid := pg_temp.f('doc'); v_first date := (private.lagos_month(now()) - interval '1 month')::date; v_last date;
begin
  v_last := (v_first + interval '1 month' - interval '1 day')::date;
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, started_at, ended_at, end_reason, is_test)
  values (v_org, pg_temp.f('p1'), v_doc, 'ended', 'admin', 1, (v_first - 20)::timestamp at time zone 'Africa/Lagos', ((v_last + 5)::timestamp) at time zone 'Africa/Lagos', 'superseded', true);
  insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, started_at, ended_at, end_reason, is_test)
  values (v_org, pg_temp.f('p2'), v_doc, 'ended', 'admin', 1, (v_first - 3)::timestamp at time zone 'Africa/Lagos', ((v_first + 13)::timestamp) at time zone 'Africa/Lagos', 'superseded', true);
  insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, started_at, ended_at, end_reason, is_test)
  values (v_org, pg_temp.f('p3'), v_doc, 'ended', 'admin', 1, (v_first + 14)::timestamp at time zone 'Africa/Lagos', ((v_first + 15)::timestamp) at time zone 'Africa/Lagos', 'superseded', true);
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.ck('a lead month posts one line per patient led for at least 15 days of the month', '1', private.post_lead_month_earnings(1)::text);
  perform pg_temp.ck('...150000 for the patient led all month', '150000', pg_temp.amt_of(v_doc, 'lead_month'));
  perform pg_temp.ck('...the patient led 14 days earns nothing and the patient led 2 days earns nothing', '1', pg_temp.lines_of(v_doc, 'lead_month')::text);
  perform pg_temp.ck('...the line records the days and the minimum', extract(day from v_last)::int || '|15',
    (select (calculation ->> 'active_days') || '|' || (calculation ->> 'min_active_days') from public.earnings_ledger where kind = 'lead_month' and clinician_id = v_doc));
  perform pg_temp.ck('running the same month again pays nothing twice', '0', private.post_lead_month_earnings(1)::text);
  perform pg_temp.ck('a three-month look-back catches the earlier month the first patient was also led (20 days), once', '1', private.post_lead_month_earnings(3)::text);
  perform pg_temp.ck('...and then nothing more', '0', private.post_lead_month_earnings(3)::text);
end $$;

-- 4d. The pilot minimum -----------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_doc2 uuid := pg_temp.f('doc2'); v_cmo uuid := pg_temp.f('cmo'); v_d1 uuid := pg_temp.f('d1');
begin
  -- doc2: two touching confirmed blocks, 8 hours in all, nothing earned inside
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
  values (v_org, v_doc2, now() - interval '30 hours', now() - interval '26 hours', 'queue', 'confirmed', true),
         (v_org, v_doc2, now() - interval '26 hours', now() - interval '22 hours', 'queue', 'confirmed', true);
  -- cmo: 8 hours with 1,500,000 already earned inside
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
  values (v_org, v_cmo, now() - interval '50 hours', now() - interval '42 hours', 'queue', 'confirmed', true);
  perform private.ledger_insert(v_org, v_cmo, 'task', 'clinical_task', gen_random_uuid(), 1500000, v_d1, '{}'::jsonb, now() - interval '45 hours', true);
  -- a declared (not confirmed) block earns no guarantee
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
  values (v_org, pg_temp.f('doc'), now() - interval '80 hours', now() - interval '72 hours', 'queue', 'declared', true);
  perform pg_temp.ck('the first run posts the two top-ups and nothing for a block that was only declared', '2', private.post_minimum_topups()::text);
  perform pg_temp.ck('...two touching confirmed blocks are one run: doc2 (nothing earned) gets the whole 2000000 guarantee', '2000000', pg_temp.amt_of(v_doc2, 'minimum_topup'));
  perform pg_temp.ck('...the cmo, who already earned 1500000 in the run, gets only the shortfall of 500000', '500000', pg_temp.amt_of(v_cmo, 'minimum_topup'));
  perform pg_temp.ck('...the line records the run, hours and what counted', '28800',
    (select (calculation ->> 'declared_seconds')::numeric::int::text from public.earnings_ledger where kind = 'minimum_topup' and clinician_id = v_doc2));
  perform pg_temp.ck('...a block that was only declared earns no top-up', '0', pg_temp.lines_of(pg_temp.f('doc'), 'minimum_topup')::text);
  perform pg_temp.ck('running it again pays nothing twice', '2', (select count(*) from public.earnings_ledger where kind = 'minimum_topup')::text);
  perform pg_temp.ck('a second run reports nothing new', '0', private.post_minimum_topups()::text);
end $$;

-- 5. Adjustments --------------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_doc uuid := pg_temp.f('doc'); v_emp uuid := pg_temp.f('emp'); v_req uuid := gen_random_uuid(); v_line uuid := pg_temp.f('flagged_line'); a1 uuid; a2 uuid;
begin
  perform pg_temp.ck('a clinician cannot post an adjustment', 'fee_not_authorised',
    pg_temp.try_as(v_doc, format('select public.post_earnings_adjustment(%L, 1000, %L)', v_doc, 'Giving myself a bonus')));
  perform pg_temp.ck('a reason of at least 10 characters is required', 'earnings_reason_needed',
    pg_temp.try_as(v_admin, format('select public.post_earnings_adjustment(%L, 1000, %L)', v_doc, 'too short')));
  perform pg_temp.ck('a zero amount is refused', 'earnings_bad_amount',
    pg_temp.try_as(v_admin, format('select public.post_earnings_adjustment(%L, 0, %L)', v_doc, 'A zero adjustment is nothing')));
  perform pg_temp.ck('an employed doctor (salary) cannot be adjusted', 'earnings_not_contracted',
    pg_temp.try_as(v_admin, format('select public.post_earnings_adjustment(%L, 1000, %L)', v_emp, 'Adjusting a salaried doctor')));
  perform pg_temp.ck('a line of another clinician cannot be named as the one corrected', 'earnings_unknown_line',
    pg_temp.try_as(v_admin, format('select public.post_earnings_adjustment(%L, 1000, %L, %L)', pg_temp.f('doc2'), 'Wrong clinician for this line', v_line)));
  perform pg_temp.ck('two lines need review before the correction', '2', (pg_temp.q_as(v_admin, 'select count(*)::text from public.earnings_needing_review(true)')));
  a1 := (pg_temp.q_as(v_admin, format('select public.post_earnings_adjustment(%L, 50000, %L, %L, %L)::text', v_doc, 'Agreed fee for this async question', v_line, v_req)))::uuid;
  a2 := (pg_temp.q_as(v_admin, format('select public.post_earnings_adjustment(%L, 50000, %L, %L, %L)::text', v_doc, 'Agreed fee for this async question', v_line, v_req)))::uuid;
  perform pg_temp.ck('an adjustment is posted', '50000', (select amount_kobo::text from public.earnings_ledger where id = a1));
  perform pg_temp.ck('a double click with the same request id posts once and returns the same line', 'true', (a1 = a2 and pg_temp.lines_of(v_doc, 'adjustment') = 1)::text);
  perform pg_temp.ck('...it points at the line it corrects and has no schedule version', 'true',
    (select (calculation ->> 'corrects' = v_line::text and fee_schedule_version_id is null and created_by = v_admin)::text from public.earnings_ledger where id = a1));
  perform pg_temp.ck('the corrected line leaves the review list', '1', (pg_temp.q_as(v_admin, 'select count(*)::text from public.earnings_needing_review(true)')));
  perform pg_temp.ck('the clinician was told of the correction', 'true', (exists (select 1 from public.notifications where recipient_id = v_doc and payload ->> 'ledger_id' = a1::text))::text);
  perform pg_temp.ck('a negative adjustment (a clawback) is allowed', 'ok',
    pg_temp.try_as(v_admin, format('select public.post_earnings_adjustment(%L, -10000, %L)', v_doc, 'Overpaid a task last week by mistake')));
  perform pg_temp.ck('the clinician statement counts the adjustments in the total', 'true',
    (((pg_temp.q_as(v_doc, 'select public.my_earnings_summary()::text'))::jsonb ->> 'total_kobo')::bigint = (select sum(amount_kobo) from public.earnings_ledger where clinician_id = v_doc))::text);
  perform pg_temp.ck('...and shows every kind it earned', 'true',
    ((pg_temp.q_as(v_doc, 'select public.my_earnings_summary()::text'))::jsonb -> 'by_kind' ?& array['task', 'consultation', 'on_call_shift', 'lead_month', 'adjustment'])::text);
  perform pg_temp.ck('...unpaid equals total until S31 links a payout', 'true',
    (((pg_temp.q_as(v_doc, 'select public.my_earnings_summary()::text'))::jsonb ->> 'unpaid_kobo') = ((pg_temp.q_as(v_doc, 'select public.my_earnings_summary()::text'))::jsonb ->> 'total_kobo'))::text);
end $$;

-- 6. The ledger is append only ------------------------------------------------------------------------------------------------
do $$
declare v_line uuid := (select id from public.earnings_ledger where kind = 'consultation' order by created_at limit 1); v_org uuid := pg_temp.f('org'); v_doc uuid := pg_temp.f('doc'); v_d1 uuid := pg_temp.f('d1');
begin
  perform pg_temp.ck('a line cannot be updated (even by the table owner)', '23514', pg_temp.try_sql(format($q$update public.earnings_ledger set amount_kobo = amount_kobo + 1 where id = %L$q$, v_line)));
  perform pg_temp.ck('a line cannot be deleted', '23514', pg_temp.try_sql(format($q$delete from public.earnings_ledger where id = %L$q$, v_line)));
  perform pg_temp.ck('the ledger cannot be truncated', '23514', pg_temp.try_sql('truncate public.earnings_ledger'));
  perform pg_temp.ck('payout_id cannot be set without the payout door', '23514', pg_temp.try_sql(format($q$update public.earnings_ledger set payout_id = gen_random_uuid() where id = %L$q$, v_line)));
  perform pg_temp.ck('payout_id and another column cannot change together, even through the door', '23514',
    pg_temp.try_sql(format($q$select set_config('tarragon.earnings_payout_link', 'on', true); update public.earnings_ledger set payout_id = gen_random_uuid(), amount_kobo = 1 where id = %L$q$, v_line)));
  perform pg_temp.ck('through the door, payout_id links once', 'ok',
    pg_temp.try_sql(format($q$select set_config('tarragon.earnings_payout_link', 'on', true); update public.earnings_ledger set payout_id = gen_random_uuid() where id = %L$q$, v_line)));
  perform pg_temp.ck('...and never again', '23514',
    pg_temp.try_sql(format($q$select set_config('tarragon.earnings_payout_link', 'on', true); update public.earnings_ledger set payout_id = gen_random_uuid() where id = %L$q$, v_line)));
  perform pg_temp.ck('nothing can be inserted directly, even by the owner', '42501',
    pg_temp.try_sql(format($q$insert into public.earnings_ledger (organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, fee_schedule_version_id, calculation, earned_at, employment_type)
      values (%L, %L, 'task', 'clinical_task', gen_random_uuid(), 1, %L, '{}', now(), 'contracted')$q$, v_org, v_doc, v_d1)));
  perform pg_temp.ck('an admin has no insert, update or delete grant on the ledger', 'permission denied for table earnings_ledger',
    pg_temp.try_as(pg_temp.f('admin'), format($q$update public.earnings_ledger set amount_kobo = 1 where id = %L$q$, v_line)));
  perform pg_temp.ck('INV-16: a calculated line with no fee schedule version is refused', '23514',
    pg_temp.try_sql(format($q$select private.ledger_insert(%L, %L, 'task', 'clinical_task', gen_random_uuid(), 1, null, '{}'::jsonb, now(), true)$q$, v_org, v_doc)));
  perform pg_temp.ck('INV-15: a negative calculated line is refused', '23514',
    pg_temp.try_sql(format($q$select private.ledger_insert(%L, %L, 'task', 'clinical_task', gen_random_uuid(), -5, %L, '{}'::jsonb, now(), true)$q$, v_org, v_doc, v_d1)));
  perform pg_temp.ck('a top-up of zero is refused', '23514',
    pg_temp.try_sql(format($q$select private.ledger_insert(%L, %L, 'minimum_topup', 'declared_hours', gen_random_uuid(), 0, %L, '{}'::jsonb, now(), true)$q$, v_org, v_doc, v_d1)));
  perform pg_temp.ck('an adjustment with no reason is refused', '23514',
    pg_temp.try_sql(format($q$select private.ledger_insert(%L, %L, 'adjustment', 'adjustment', gen_random_uuid(), 5, null, '{}'::jsonb, now(), true, null, %L)$q$, v_org, v_doc, pg_temp.f('admin'))));
end $$;

-- 7. Access: who reads what ----------------------------------------------------------------------------------------------------
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
do $$
declare v_doc uuid := pg_temp.f('doc'); v_doc2 uuid := pg_temp.f('doc2'); v_cmo uuid := pg_temp.f('cmo'); v_admin uuid := pg_temp.f('admin'); v_emp uuid := pg_temp.f('emp');
begin
  perform pg_temp.ck('a clinician reads exactly their own lines', (select count(*) from public.earnings_ledger where clinician_id = v_doc)::text,
    pg_temp.q_as(v_doc, 'select count(*)::text from public.earnings_ledger'));
  perform pg_temp.ck('a second clinician sees none of the first one''s lines', '0',
    pg_temp.q_as(v_doc2, format('select count(*)::text from public.earnings_ledger where clinician_id = %L', v_doc)));
  perform pg_temp.ck('the clinical lead sees only their own pay, not the team''s', '0',
    pg_temp.q_as(v_cmo, format('select count(*)::text from public.earnings_ledger where clinician_id <> %L', v_cmo)));
  perform pg_temp.ck('an employed doctor sees nothing', '0', pg_temp.q_as(v_emp, 'select count(*)::text from public.earnings_ledger'));
  perform pg_temp.ck('...and has no statement', 'earnings_not_contracted', pg_temp.try_as(v_emp, 'select public.my_earnings_summary()'));
  perform pg_temp.ck('a patient sees nothing', '0', pg_temp.q_as(pg_temp.f('p1'), 'select count(*)::text from public.earnings_ledger'));
  perform pg_temp.ck('admin (finance) reads every line of the organisation', (select count(*) from public.earnings_ledger)::text,
    pg_temp.q_as(v_admin, 'select count(*)::text from public.earnings_ledger'));
  perform pg_temp.ck('anon is refused the ledger', '42501', pg_temp.try_anon('select count(*) from public.earnings_ledger'));
  perform pg_temp.ck('anon is refused the schedules', '42501', pg_temp.try_anon('select count(*) from public.fee_schedules'));
  perform pg_temp.ck('anon is refused the statement function', '42501', pg_temp.try_anon('select public.my_earnings_summary()'));
  perform pg_temp.ck('INV-13: the admin summary leaves test accounts out by default', '0',
    pg_temp.q_as(v_admin, 'select count(*)::text from public.earnings_admin_summary()'));
  perform pg_temp.ck('...and shows them when asked', '3',
    pg_temp.q_as(v_admin, 'select count(*)::text from public.earnings_admin_summary(null, null, true)'));
  perform pg_temp.ck('...needs-review list excludes test accounts too', '0', pg_temp.q_as(v_admin, 'select count(*)::text from public.earnings_needing_review()'));
  perform pg_temp.ck('...and the health check', '0', pg_temp.q_as(v_admin, 'select (public.earnings_health() ->> ''lines_needing_review'')'));
end $$;

-- 8. queue_summary: the next fee, for a contracted clinician only ---------------------------------------------------------------
do $$
declare v_doc uuid := pg_temp.f('doc'); v_emp uuid := pg_temp.f('emp'); t uuid;
begin
  perform pg_temp.clear_queue();
  t := pg_temp.mktask(pg_temp.f('p2'), 'symptom_review');
  perform pg_temp.age_task(t, '12 hours', '12 hours');
  perform pg_temp.ck('a contracted clinician sees the fee of the next task (333 + 10 percent)', '366',
    (pg_temp.q_as(v_doc, 'select (public.queue_summary() ->> ''next_fee_kobo'')')));
  perform pg_temp.ck('an employed doctor sees no fee', 'null',
    coalesce((pg_temp.q_as(v_emp, 'select (public.queue_summary() ->> ''next_fee_kobo'')')), 'null'));
  perform pg_temp.ck('...and the summary still counts the work', '1',
    (pg_temp.q_as(v_emp, 'select (public.queue_summary() -> ''by_class'' ->> ''5'')')));
end $$;

-- 9. Version rule: a second schedule supersedes the first and only the one in force applies -------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_d1 uuid := pg_temp.f('d1'); d2 uuid; v_copy uuid; v_items jsonb := jsonb_set(pg_temp.items(), '{on_call_shift_fee_kobo}', '3000000');
begin
  perform pg_temp.act(v_admin);
  d2 := public.create_fee_schedule_draft(v_items, 'version two');
  perform public.approve_fee_schedule(d2);
  perform pg_temp.back();
  perform pg_temp.setf('d2', d2);
  perform pg_temp.ck('approving version 2 supersedes version 1', 'superseded', (select status from public.fee_schedules where id = v_d1));
  perform pg_temp.ck('...exactly one schedule is approved', '1', (select count(*) from public.fee_schedules where status = 'approved')::text);
  perform pg_temp.ck('...a moment before version 2 still resolves to version 1', 'true', ((private.fee_schedule_at(pg_temp.f('org'), now() - interval '1 second')).id = v_d1)::text);
  v_copy := (pg_temp.q_as(v_admin, 'select public.create_fee_schedule_draft()::text'))::uuid;
  perform pg_temp.ck('...a draft copied from the active schedule starts from version 2 items', '3000000',
    (select items ->> 'on_call_shift_fee_kobo' from public.fee_schedules where id = v_copy));
  perform pg_temp.ck('...the old lines still name version 1 (INV-16)', 'true',
    (select bool_and(fee_schedule_version_id = v_d1)::text from public.earnings_ledger where kind in ('task', 'consultation', 'on_call_shift')));
  perform pg_temp.ck('the admin may discard a draft', 'ok',
    pg_temp.try_as(v_admin, format('select public.discard_fee_schedule_draft(%L)', (select id from public.fee_schedules where status = 'draft' limit 1))));
end $$;

-- 10. SABOTAGE: the append-only guard and the fee-version rule removed; both checks must flip ---------------------------------------
create or replace function private.guard_earnings_ledger() returns trigger
language plpgsql security definer set search_path = '' as $$ begin return coalesce(new, old); end $$;
do $$
declare v_con text; v_line uuid := (select id from public.earnings_ledger where kind = 'task' order by created_at limit 1); v_doc uuid := pg_temp.f('doc');
begin
  update public.earnings_ledger set amount_kobo = amount_kobo + 7 where id = v_line;
  insert into results values ('sabotaged', 'a line cannot be updated (even by the table owner)', 'refused',
    case when pg_temp.try_sql(format($q$update public.earnings_ledger set amount_kobo = amount_kobo + 1 where id = %L$q$, v_line)) = 'ok' then 'allowed' else 'refused' end);
  select conname into v_con from pg_constraint where conrelid = 'public.earnings_ledger'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%fee_schedule_version_id IS NOT NULL%';
  execute format('alter table public.earnings_ledger drop constraint %I', v_con);
  insert into results values ('sabotaged', 'INV-16: a calculated line with no fee schedule version is refused', 'refused',
    case when pg_temp.try_sql(format($q$select private.ledger_insert(%L, %L, 'task', 'clinical_task', gen_random_uuid(), 1, null, '{}'::jsonb, now(), true)$q$, pg_temp.f('org'), v_doc)) = 'ok' then 'accepted' else 'refused' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S30 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
