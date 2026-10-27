-- ===========================================================================
-- Proof: 20261027180057_s90_care_gap_rule_engine.sql (S90 first slice; INV-07, INV-12, INV-13, INV-16, invariant I9; S75a single minimum-cell rule).
--
--   1. DORMANT: the seeded rule config is unsigned and inactive; the guard is born OFF and, off, the engine does nothing (no gap, no message). Only the
--      Chief Medical Officer signs (admin, clinician, coordinator, patient refused); a signed config cannot be edited or re-signed.
--   2. EACH RULE FIRES AND DOES NOT FIRE: missed reading (and its boundary: a plan younger than the line is not flagged; a plan with no reading counts
--      from the plan start), no HbA1c in 12 months, no lipids in 12 months (due is the last result, or with none the plan start, plus 365 days, and opens
--      only after the 30 day grace: a plan of 40 days is NOT flagged, a result already on file counts from its own date), refill lapse, adherence lapse
--      (the P6 signal AND the scoped adherence), rising trend (inert while the CMO has not supplied a rise). A Free patient (no membership) gets no gap.
--   3. SHADOW MODE: guard ON with the config UNSIGNED records gaps (shadow = true) and owners but sends nothing, creates no coordinator task and no attempt row.
--   4. LIVE, SIGNED: the ladder runs push (skipped when there is no subscription), in-app, email, coordinator call task, linked to care_outreach_tasks and
--      assigned to the owner. A judgement item (rising trend) is owned by a doctor and gets no patient message and no coordinator task. A gap opened in shadow
--      that no longer qualifies under the signed numbers is closed and never messaged.
--   5. CLOSURE BY OUTCOME ONLY: a reading, a lab row, a refill closes a gap with the row that closed it recorded; a message sent never closes a gap; 'closed'
--      cannot be set by hand or without a signal; a premise that vanished closes as 'superseded' (a system closure); declined / unreachable / wrong need a note
--      and 'unreachable' needs the logged staff attempts; a closed gap is a ledger row that never changes.
--   6. CAPS AND QUIET HOURS: no send inside the Lagos quiet hours; the weekly cap per patient across all gaps holds.
--   7. INV-07: every notification the engine writes carries only the copy variant in its payload, uses one of two templates, and the template wording names
--      no condition, reading, result or medicine.
--   8. OWNERS: balanced between coordinators; an owner on leave is replaced on the next run.
--   9. RLS (INV-12): the assigned owner reads the gap; an untied coordinator, an untied clinician, a patient and anon read nothing; no one has a write grant.
--  10. INSTITUTION SUMMARY: counts of people by type from the real ledger through the single minimum-cell rule; "closed" counts ONLY recorded outcomes (a
--      declined or unreachable closure is not a success and is counted apart, by reason); a small cell is withheld with complementary suppression; the whole grid
--      is identical under every filter combination and the any-gap totals are withheld whenever a cell is; a test account never counts.
--  11. SCANS: every function has an explicit search_path, none is executable by anon, the cron jobs exist.
--  12. SABOTAGE (a proof that cannot fail is not a proof): each guarantee is replaced by a broken version and the matching check must FLIP.
--  13. OWNER FALLBACK, CROSS-ORGANISATION: no coordinator -> a doctor of the SAME organisation; nobody -> unowned, an immediate sev2 incident, readable by an admin
--      and by nobody else; a judgement item is never owned by a coordinator (trigger); an owner is staff of the gap's own organisation (trigger).
--  14. RE-VALIDATION: every open gap is checked against the CURRENT signed configuration on each run: a rule switched off, a null number, a changed grace or a
--      premise that no longer holds closes the gap as superseded (never suppressed, never messaged); shadow versus live is decided per run.
--  15. DOCTOR REVIEW CLOCK: a doctor-owned gap carries a review date; overdue it goes to the CMO once; still overdue opens an ops incident; the config nulling the rise
--      and a patient who stopped logging both close it with a reason.
--  16. FAILURES: a failing gap is counted, audited and opens care-gap-close-failing while the rest still closes; a statement timeout returns a clean partial result.
--  17. USABLE READINGS: a pharmacy-machine or flagged blood pressure reading neither raises nor closes a missed-reading gap (the shared rule, as bp_window_stats).
--  18. ADHERENCE: scoped to hypertension and diabetes medicines (a contraceptive or an SSRI never raises or holds a gap); the gap closes against the line
--      recorded when it opened.
--  19. REOPEN SUPPRESSION: only a closure a person made holds a gap back for 30 days; a lapse-and-renew (a system closure) reopens at once.
--  20. LOCKS AND IDEMPOTENCY: a second overlapping run does nothing; one send per (gap, step, week) is a key, not a habit; the hourly pass skips gaps whose
--      inputs have not changed.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. Time: the engine is always called with an explicit "now" anchored at T0, a moment in the recent PAST
-- (today 10:00 Lagos, or yesterday 10:00 when it is before 12:00 now), so no reading is ever inserted in the future. The platform minimum cell is lowered to 3
-- on the active outcome_config when that table exists. Tied staff reads are switched on for the run (the module row) so the untied checks mean something.
-- ===========================================================================
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sk(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- a select as a signed-in user; returns the first column as text, or ERR:sqlstate
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
-- a write (no result set) as a signed-in user
create function pg_temp.cmd_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.svc(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;

-- T0 is always in the past: today 10:00 Lagos once it is past noon, else yesterday 10:00. base() is its Lagos date; every fixture day offset is relative to it.
create function pg_temp.at_day(d date, h integer default 9) returns timestamptz language sql as $$ select (d::timestamp + make_interval(hours => h)) at time zone 'Africa/Lagos' $$;
create function pg_temp.t0() returns timestamptz language sql as
$$ select pg_temp.at_day(case when (now() at time zone 'Africa/Lagos')::time >= time '12:00' then (now() at time zone 'Africa/Lagos')::date else (now() at time zone 'Africa/Lagos')::date - 1 end, 10) $$;
create function pg_temp.base() returns date language sql as $$ select (pg_temp.t0() at time zone 'Africa/Lagos')::date $$;
create function pg_temp.org() returns uuid language sql as $$ select id from public.organisations order by created_at limit 1 $$;
create function pg_temp.mkorg(p_label text, p_floor integer default 5) returns uuid language plpgsql as
$f$ declare v uuid; begin
  insert into public.organisations (name, type, min_cohort_size) values ('S90 ' || p_label, 'corporate', p_floor) returning id into v;
  return v;
end $f$;

create function pg_temp.mkuser(p_label text, p_role text, p_dob date default null, p_test boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_org uuid := pg_temp.org();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's90-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, sex)
  values (v, v_org, p_role::public.user_role, 'S90 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          coalesce(p_dob, (current_date - interval '50 years')::date), p_test, 'female'::public.sex)
  on conflict (id) do update set role = excluded.role, is_active = true, is_test = excluded.is_test, phone = excluded.phone, sex = excluded.sex, full_name = excluded.full_name, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
-- staff of an organisation (the first one unless p_org is given)
create function pg_temp.mkstaff(p_label text, p_role text, p_tier text, p_org uuid default null) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_label, p_role); v_org uuid := coalesce(p_org, pg_temp.org());
begin
  if p_org is not null then update public.profiles set organisation_id = p_org where id = v; end if;
  set local session_replication_role = replica;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, status, doctor_tier, languages, license_verified_at, license_expires_at, specialty, indemnity_exempt, indemnity_exempt_by)
  values (v_org, v, 'S90 ' || p_label, true, true, 'active', p_tier::public.doctor_tier, array['en'], now() - interval '3 days', now() + interval '1 year', 'General practice', true, pg_temp.f('admin'));
  set local session_replication_role = origin;
  return v;
end $f$;
-- a patient who has been a Member since 200 days before base, with an active plan that started p_plan_days before base
create function pg_temp.mkpatient(p_label text, p_cond text, p_plan_days integer, p_member boolean default true, p_org uuid default null, p_test boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_label, 'patient', null, p_test); v_org uuid := coalesce(p_org, pg_temp.org()); v_cp uuid;
begin
  if p_org is not null then update public.profiles set organisation_id = p_org where id = v; end if;
  if p_member then
    insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, is_test) values (v_org, v, 'purchase', pg_temp.at_day(pg_temp.base() - 200, 8), p_test);
  end if;
  insert into public.care_plans (organisation_id, patient_id, condition, status) values (v_org, v, p_cond::public.care_plan_condition, 'active') returning id into v_cp;
  set local session_replication_role = replica;
  update public.care_plans set created_at = pg_temp.at_day(pg_temp.base() - p_plan_days, 9) where id = v_cp;
  set local session_replication_role = origin;
  perform pg_temp.setf(p_label || '.plan', v_cp);
  return v;
end $f$;
create function pg_temp.bp_at(p uuid, p_at timestamptz, p_s integer, p_d integer) returns uuid language plpgsql as
$f$ declare v_id uuid; begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values ((select organisation_id from public.profiles where id = p), p, 'blood_pressure', p_s, p_d, p_at, 'device') returning id into v_id;
  return v_id;
end $f$;
create function pg_temp.bp(p uuid, p_days_ago integer, p_s integer, p_d integer, p_n integer default 1) returns uuid language plpgsql as
$f$ declare v_id uuid; begin
  for k in 0 .. p_n - 1 loop v_id := pg_temp.bp_at(p, pg_temp.at_day(pg_temp.base() - p_days_ago + k, 9), p_s, p_d); end loop;
  return v_id;
end $f$;
-- mark a reading as a pharmacy-machine entry, or as flagged for validation (not usable): written straight to the table, past the triggers
create function pg_temp.mark_reading(p_id uuid, p_origin text, p_flags text[]) returns void language plpgsql as
$f$ begin
  set local session_replication_role = replica;
  update public.vitals_readings set entry_origin = p_origin,
         validation_status = case when p_flags is null then validation_status else 'requires_validation'::public.vitals_validation_status end,
         validation_flags = coalesce(p_flags, validation_flags)
   where id = p_id;
  set local session_replication_role = origin;
end $f$;
create function pg_temp.lab_at(p uuid, p_code text, p_at timestamptz) returns uuid language plpgsql as
$f$ declare v_id uuid; begin
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
  values ((select organisation_id from public.profiles where id = p), p, p_code, 5, 'percent', p_at) returning id into v_id;
  return v_id;
end $f$;
create function pg_temp.lab(p uuid, p_code text, p_days_ago integer) returns uuid language sql as
$$ select pg_temp.lab_at(p, p_code, pg_temp.at_day(pg_temp.base() - p_days_ago, 9)) $$;
-- a medicine on a plan (p_plan null = on no plan), a daily 08:00 schedule from 30 days before base, optionally taken on each of the 7 days up to base
create function pg_temp.med(p uuid, p_plan uuid, p_name text, p_indication text default null, p_taken boolean default false) returns uuid language plpgsql as
$f$ declare m uuid; d date; begin
  insert into public.medications (organisation_id, patient_id, care_plan_id, drug_name, indication, is_active, schedule_times)
  values ((select organisation_id from public.profiles where id = p), p, p_plan, p_name, p_indication, true, '["08:00"]'::jsonb) returning id into m;
  set local session_replication_role = replica;
  update public.medications set created_at = pg_temp.at_day(pg_temp.base() - 30, 6) where id = m;
  set local session_replication_role = origin;
  if p_taken then
    for d in select generate_series(pg_temp.base() - 6, pg_temp.base(), interval '1 day')::date loop
      insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date)
      values ((select organisation_id from public.profiles where id = p), p, m, 'taken', '08:00', d);
    end loop;
  end if;
  return m;
end $f$;
-- every medicine on a plan is taken on each of the 7 days up to base
create function pg_temp.taken_all(p uuid) returns void language plpgsql as
$f$ declare m uuid; d date; begin
  for m in select id from public.medications where patient_id = p and care_plan_id is not null loop
    for d in select generate_series(pg_temp.base() - 6, pg_temp.base(), interval '1 day')::date loop
      insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date)
      values ((select organisation_id from public.profiles where id = p), p, m, 'taken', '08:00', d);
    end loop;
  end loop;
end $f$;
create function pg_temp.p6_event(p uuid, p_days_ago integer) returns void language plpgsql as
$f$ begin
  insert into public.domain_events (organisation_id, event_type, event_version, patient_id, idempotency_key, occurred_at)
  values ((select organisation_id from public.profiles where id = p), 'adherence.below_line', 1, p, 's90-proof-' || p || '-' || p_days_ago, pg_temp.at_day(pg_temp.base() - p_days_ago, 7));
end $f$;
create function pg_temp.gaps(p uuid, p_type text, p_status text default 'open') returns integer language sql as
$$ select count(*)::integer from public.care_gaps where patient_id = p and gap_type = p_type and status = p_status $$;
create function pg_temp.gap(p uuid, p_type text) returns uuid language sql as
$$ select id from public.care_gaps where patient_id = p and gap_type = p_type order by opened_at desc, id limit 1 $$;
create function pg_temp.guard(p_on boolean) returns void language plpgsql as
$f$ begin
  set local session_replication_role = replica;   -- the S37 guard trigger wants a log row; this proof flips the switch directly inside its own rolled-back transaction
  update public.go_live_guards set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then pg_temp.f('admin') end,
         change_note = case when p_on then 'S90 proof run' end where key = 'care_gap_engine_enabled';
  set local session_replication_role = origin;
end $f$;
create function pg_temp.sent(p uuid) returns integer language sql as
$$ select count(*)::integer from public.care_gap_attempts where patient_id = p and result = 'sent' $$;
create function pg_temp.notes(p uuid) returns integer language sql as
$$ select count(*)::integer from public.notifications where recipient_id = p and source_table = 'care_gaps' $$;
create function pg_temp.cfg() returns jsonb language sql as $$ select cfg from private.care_gap_effective_config() $$;
create function pg_temp.owner_of(p_gap uuid) returns uuid language sql as $$ select owner_id from public.care_gaps where id = p_gap $$;
create function pg_temp.incident(p_ref text) returns text language sql as
$$ select coalesce((select severity::text || '/' || status::text from public.ops_incidents where external_reference = p_ref and status not in ('resolved', 'closed') limit 1), 'none') $$;

-- Scenarios that run once on the real functions and once more after a sabotage (the sabotage must make the same check flip).
create function pg_temp.scen_quiet(p_label text, p_phase text) returns void language plpgsql as
$f$
declare p uuid := pg_temp.mkpatient(p_label, 'hypertension', 25); v_night timestamptz := pg_temp.at_day(pg_temp.base(), 22);
begin
  perform pg_temp.bp(p, 20, 150, 95);
  perform private.care_gap_evaluate(pg_temp.t0());
  perform private.care_gap_outreach_run(v_night);
  perform private.care_gap_outreach_run(v_night + interval '1 minute');
  perform private.care_gap_outreach_run(v_night + interval '2 minutes');
  perform pg_temp.sk(p_phase, '6a nothing is sent inside the Lagos quiet hours (22:00)', '0', pg_temp.sent(p)::text);
end $f$;
create function pg_temp.scen_cap(p_label text, p_phase text) returns void language plpgsql as
$f$
declare p uuid := pg_temp.mkpatient(p_label, 'hypertension', 500); v_t timestamptz := pg_temp.t0();
begin
  perform pg_temp.bp(p, 20, 150, 95);                                         -- a missed reading AND (plan 500 days, no lipids) a lipid gap: two gaps for one patient
  perform private.care_gap_evaluate(v_t);
  perform private.care_gap_outreach_run(v_t);                                 -- push skipped (no subscription) for both
  perform private.care_gap_outreach_run(v_t + interval '1 minute');           -- in-app for both: 2 sent
  perform private.care_gap_outreach_run(v_t + interval '3 days 2 minutes');   -- email for both: the weekly cap (2) is reached
  perform pg_temp.sk(p_phase, '6b the weekly cap per patient holds across gaps', '2', pg_temp.sent(p)::text);
  perform pg_temp.sk(p_phase, '6c a capped step is recorded as skipped, not lost', 'true',
    ((select count(*) from public.care_gap_attempts where patient_id = p and result = 'skipped_cap') > 0)::text);
end $f$;
create function pg_temp.scen_close_by_message(p_label text, p_phase text) returns void language plpgsql as
$f$
declare p uuid := pg_temp.mkpatient(p_label, 'hypertension', 25); g uuid; v_t timestamptz := pg_temp.t0();
begin
  perform pg_temp.bp(p, 20, 150, 95);
  perform private.care_gap_evaluate(v_t);
  g := pg_temp.gap(p, 'missed_reading');
  perform private.care_gap_outreach_run(v_t);
  perform private.care_gap_outreach_run(v_t + interval '1 minute');
  perform private.care_gap_evaluate(v_t + interval '2 minutes');
  perform pg_temp.sk(p_phase, '5w a gap that has had a message sent stays open', 'open', (select status from public.care_gaps where id = g));
end $f$;
create function pg_temp.scen_shadow_send(p_label text, p_phase text) returns void language plpgsql as
$f$
declare p uuid := pg_temp.mkpatient(p_label, 'hypertension', 25); v_t timestamptz := pg_temp.t0();
begin
  perform pg_temp.bp(p, 20, 150, 95);
  perform private.care_gap_evaluate(v_t);
  perform private.care_gap_outreach_run(v_t);
  perform private.care_gap_outreach_run(v_t + interval '1 minute');
  perform pg_temp.sk(p_phase, '3e an unsigned configuration sends nothing', '0', pg_temp.notes(p)::text);
end $f$;
-- a gap recorded in SHADOW under an earlier version that no longer qualifies under the signed numbers (lipids overdue 35 days against a 60 day grace): it must be closed
-- by the ladder's own re-check and must never be messaged, even though it is marked as waiting.
create function pg_temp.scen_requalify(p_label text, p_phase text) returns void language plpgsql as
$f$
declare p uuid := pg_temp.mkpatient(p_label, 'hypertension', 400); v_t timestamptz := pg_temp.t0() + interval '30 minutes'; g uuid;
begin
  perform pg_temp.bp(p, 3, 150, 95);
  insert into public.care_gaps (organisation_id, patient_id, gap_type, condition, due_date, opened_at, owner_role, shadow, config_version, why, next_attempt_due_at)
  values (pg_temp.org(), p, 'no_lipids_12_months', 'hypertension', pg_temp.base() - 35, pg_temp.t0() - interval '1 day', 'care_coordinator', true, 1,
          '{"criterion": "no_lab_in_days", "lookback_days": 365, "grace_days": 30, "anchor": "plan_start"}', null)
  returning id into g;
  perform private.care_gap_outreach_run(v_t);
  perform private.care_gap_outreach_run(v_t + interval '1 minute');
  perform private.care_gap_outreach_run(v_t + interval '2 minutes');
  perform pg_temp.sk(p_phase, '14s a shadow gap that no longer qualifies under the signed numbers is never messaged', '0', pg_temp.notes(p)::text);
  perform pg_temp.sk(p_phase, '14t ...and is closed as superseded by the ladder re-check', 'closed/superseded', (select status || '/' || coalesce(closure_reason, '') from public.care_gaps where id = g));
end $f$;
-- an organisation with only a doctor: the logistics gap of its patient must still get an owner (the doctor), in that organisation
create function pg_temp.scen_owner(p_label text, p_phase text) returns void language plpgsql as
$f$
declare o uuid := pg_temp.mkorg(p_label); d uuid := pg_temp.mkstaff(p_label || '-doc', 'clinician', 'senior_medical_officer', o);
        p uuid := pg_temp.mkpatient(p_label || '-pat', 'hypertension', 25, true, o);
begin
  perform pg_temp.bp(p, 20, 150, 95);
  perform private.care_gap_evaluate(pg_temp.t0());
  perform pg_temp.sk(p_phase, '13a no coordinator in the organisation: the gap goes to its doctor, not to nobody', 'true',
    (pg_temp.owner_of(pg_temp.gap(p, 'missed_reading')) = d)::text);
end $f$;
-- a contraceptive missed every day cannot hold or raise an adherence gap; the hypertension medicine is taken every day
create function pg_temp.scen_scope(p_label text, p_phase text) returns void language plpgsql as
$f$
declare p uuid := pg_temp.mkpatient(p_label, 'hypertension', 25);
begin
  perform pg_temp.bp(p, 5, 150, 95);
  perform pg_temp.med(p, pg_temp.f(p_label || '.plan'), 'S90 htn tablet', 'hypertension', true);
  perform pg_temp.med(p, null, 'S90 contraceptive pill', 'contraception', false);
  perform pg_temp.p6_event(p, 3);
  perform private.care_gap_evaluate(pg_temp.t0());
  perform pg_temp.sk(p_phase, '18c a contraceptive missed every day does not raise an adherence gap', '0', pg_temp.gaps(p, 'adherence_lapse')::text);
end $f$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 0. Fixtures
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.org(); p uuid; m uuid; v_ver integer;
begin
  if v_org is null then insert into public.organisations (name, type) values ('S90 org', 'direct') returning id into v_org; end if;
  if to_regclass('public.outcome_config') is not null then
    set local session_replication_role = replica;
    update public.outcome_config set config = jsonb_set(config, '{min_cell}', '3') where is_active;
    set local session_replication_role = origin;
  end if;
  if to_regclass('public.platform_modules') is not null then
    update public.platform_modules set is_enabled = true where key = 'tied_staff_reads';
  end if;
  -- the weekly adherence needs an active medicine configuration (the live one is seeded by S08; make sure a replay database has one)
  if not exists (select 1 from public.medicine_config where is_active) then
    select coalesce(max(version), 0) + 1 into v_ver from public.medicine_config;
    insert into public.medicine_config (version, is_active, missed_after_minutes, server_missed_after_minutes, low_supply_days, adherence_window_days, adherence_threshold_percent, adherence_min_doses, note)
    values (v_ver, true, 120, 720, 7, 7, 80, 3, 'S90 proof');
  end if;
  perform pg_temp.setf('admin', pg_temp.mkuser('admin', 'admin'));
  perform pg_temp.setf('cmo', pg_temp.mkstaff('cmo', 'clinician', 'chief_medical_officer'));
  perform pg_temp.setf('c1', pg_temp.mkstaff('coord1', 'care_coordinator', 'care_coordinator'));
  perform pg_temp.setf('c2', pg_temp.mkstaff('coord2', 'care_coordinator', 'care_coordinator'));
  perform pg_temp.setf('smo', pg_temp.mkstaff('smo', 'clinician', 'senior_medical_officer'));
  perform pg_temp.setf('clin', pg_temp.mkuser('untied-clinician', 'clinician'));
  perform pg_temp.setf('coord_untied', pg_temp.mkuser('untied-coordinator', 'care_coordinator'));
  perform pg_temp.setf('pat', pg_temp.mkuser('patient', 'patient'));

  perform pg_temp.setf('A', pg_temp.mkpatient('A', 'hypertension', 25));  perform pg_temp.bp(pg_temp.f('A'), 20, 150, 95);          -- reading 20 days old: missed (line 14)
  perform pg_temp.setf('B', pg_temp.mkpatient('B', 'hypertension', 25));  perform pg_temp.bp(pg_temp.f('B'), 5, 150, 95);           -- reading 5 days old: not missed
  perform pg_temp.setf('C', pg_temp.mkpatient('C', 'hypertension', 10));                                                            -- plan 10 days, no reading: under the line
  perform pg_temp.setf('F', pg_temp.mkpatient('F', 'hypertension', 20));                                                            -- plan 20 days, no reading: flagged from the plan start
  perform pg_temp.setf('G', pg_temp.mkpatient('G', 'hypertension', 500)); perform pg_temp.bp(pg_temp.f('G'), 3, 150, 95);           -- no lipids ever, plan 500 days: lipids gap
  perform pg_temp.setf('N40', pg_temp.mkpatient('N40', 'hypertension', 40)); perform pg_temp.bp(pg_temp.f('N40'), 3, 150, 95);     -- no lipids, plan 40 days: NOT flagged (a year and a month from the plan start)
  perform pg_temp.setf('BL1', pg_temp.mkpatient('BL1', 'hypertension', 40)); perform pg_temp.bp(pg_temp.f('BL1'), 3, 150, 95); perform pg_temp.lab(pg_temp.f('BL1'), 'lipid_panel', 300);   -- a baseline on file counts from its own date: due in 65 days
  perform pg_temp.setf('BL2', pg_temp.mkpatient('BL2', 'hypertension', 10)); perform pg_temp.bp(pg_temp.f('BL2'), 3, 150, 95); perform pg_temp.lab(pg_temp.f('BL2'), 'lipid_panel', 400);   -- a young plan but a result 400 days old: due 35 days ago
  perform pg_temp.setf('SHL', pg_temp.mkpatient('SHL', 'hypertension', 400)); perform pg_temp.bp(pg_temp.f('SHL'), 3, 150, 95);   -- lipids overdue 35 days: qualifies under v1 (grace 30), not under v2 (grace 60)
  perform pg_temp.setf('D', pg_temp.mkpatient('D', 'diabetes', 500));     perform pg_temp.lab(pg_temp.f('D'), 'hba1c', 400);        -- last HbA1c 400 days ago, no lipids: both lab gaps
  perform pg_temp.setf('E', pg_temp.mkpatient('E', 'diabetes', 500));     perform pg_temp.lab(pg_temp.f('E'), 'hba1c', 100); perform pg_temp.lab(pg_temp.f('E'), 'lipid_panel', 100);  -- both up to date
  perform pg_temp.setf('H', pg_temp.mkpatient('H', 'hypertension', 40, false));                                                     -- no membership: not enrolled
  perform pg_temp.setf('TST', pg_temp.mkpatient('TST', 'hypertension', 25, true, null, true)); perform pg_temp.bp(pg_temp.f('TST'), 20, 150, 95);  -- a test account
  p := pg_temp.mkpatient('R', 'hypertension', 25); perform pg_temp.setf('R', p); perform pg_temp.bp(p, 5, 150, 95);                -- refill date 10 days ago
  insert into public.medications (organisation_id, patient_id, care_plan_id, drug_name, is_active) values (v_org, p, pg_temp.f('R.plan'), 'S90 medicine', true) returning id into m;
  update public.medications set refill_date = pg_temp.base() - 10 where id = m;
  perform pg_temp.setf('Rmed', m);
  -- Q: the P6 adherence signal 3 days ago and a hypertension medicine with no dose logged on any of the 7 days (0 percent against the line of 80)
  p := pg_temp.mkpatient('Q', 'hypertension', 25); perform pg_temp.setf('Q', p); perform pg_temp.bp(p, 5, 150, 95);
  perform pg_temp.med(p, pg_temp.f('Q.plan'), 'S90 htn tablet', 'hypertension', false);
  perform pg_temp.p6_event(p, 3);
  p := pg_temp.mkpatient('W', 'hypertension', 60); perform pg_temp.setf('W', p);                                                   -- rising: 3 readings averaging 150 now, 3 averaging 130 before
  perform pg_temp.bp(p, 6, 150, 90, 3); perform pg_temp.bp(p, 20, 130, 85, 3); perform pg_temp.lab(p, 'lipid_panel', 10);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Dormant: unsigned, inactive, guard off, nothing runs
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_r jsonb;
begin
  perform pg_temp.ck('1a the seeded config is unsigned and inactive', '1/0/0',
    (select count(*) || '/' || count(*) filter (where is_active) || '/' || count(*) filter (where approved_at is not null) from public.care_gap_rule_config where version = 1));
  perform pg_temp.ck('1b the guard is born off', 'false', (select is_on::text from public.go_live_guards where key = 'care_gap_engine_enabled'));
  perform pg_temp.ck('1c the guard has two conditions (the S37 patch took)', '2', jsonb_array_length(private.go_live_conditions('care_gap_engine_enabled', null))::text);
  v_r := private.care_gap_evaluate(pg_temp.t0());
  perform pg_temp.ck('1d guard off: the engine skips and records nothing', 'guard_off/0', (v_r ->> 'skipped') || '/' || (select count(*) from public.care_gaps)::text);
  v_r := private.care_gap_outreach_run(pg_temp.t0());
  perform pg_temp.ck('1e guard off: the outreach run skips and sends nothing', 'guard_off/0', (v_r ->> 'skipped') || '/' || (select count(*) from public.notifications where source_table = 'care_gaps')::text);
  perform pg_temp.ck('1f an admin cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('admin'), 'select public.sign_care_gap_rule_config(1)::text'));
  perform pg_temp.ck('1g a coordinator cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('c1'), 'select public.sign_care_gap_rule_config(1)::text'));
  perform pg_temp.ck('1h a clinician cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('clin'), 'select public.sign_care_gap_rule_config(1)::text'));
  perform pg_temp.ck('1i a patient cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), 'select public.sign_care_gap_rule_config(1)::text'));
  perform pg_temp.ck('1j anon cannot sign', '42501', pg_temp.try_anon('select public.sign_care_gap_rule_config(1)'));
  perform pg_temp.ck('1k a config cannot be inserted signed', '42501',
    pg_temp.try($q$insert into public.care_gap_rule_config (version, is_active, effective_from, config, approved_at) values (90, false, current_date, '{}', now())$q$));
  perform pg_temp.ck('1l a config is never edited', '23514', pg_temp.try($q$update public.care_gap_rule_config set config = '{}'::jsonb where version = 1$q$));
  perform pg_temp.ck('1m a config is never deleted', '23514', pg_temp.try($q$delete from public.care_gap_rule_config where version = 1$q$));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2, 3, 8. SHADOW MODE: guard on, config unsigned. Gaps are recorded; nobody is contacted.
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_r jsonb; v_c1 integer; v_c2 integer;
begin
  perform pg_temp.guard(true);
  v_r := private.care_gap_evaluate(pg_temp.t0());
  perform pg_temp.ck('3a the run is shadow and says so', 'true', v_r ->> 'shadow');
  perform pg_temp.ck('3b every recorded gap is a shadow gap', '0', (select count(*) from public.care_gaps where not shadow)::text);

  perform pg_temp.ck('2a missed reading fires for a reading 20 days old', '1', pg_temp.gaps(pg_temp.f('A'), 'missed_reading')::text);
  perform pg_temp.ck('2b missed reading does not fire for a reading 5 days old', '0', pg_temp.gaps(pg_temp.f('B'), 'missed_reading')::text);
  perform pg_temp.ck('2c a plan younger than the line is not flagged', '0', pg_temp.gaps(pg_temp.f('C'), 'missed_reading')::text);
  perform pg_temp.ck('2d a plan with no reading counts from the plan start', 'plan_start',
    (select why ->> 'anchor' from public.care_gaps where patient_id = pg_temp.f('F') and gap_type = 'missed_reading'));
  perform pg_temp.ck('2e the why holds the failed criterion, its line and the days', 'no_reading_in_days/14/20',
    (select (why ->> 'criterion') || '/' || (why ->> 'threshold_days') || '/' || (why ->> 'days_since') from public.care_gaps where patient_id = pg_temp.f('A') and gap_type = 'missed_reading'));
  perform pg_temp.ck('2f the why holds no reading value', 'false',
    (select (why::text ~* '(systolic|diastolic|mmhg|\m150\M|\m95\M)')::text from public.care_gaps where patient_id = pg_temp.f('A') and gap_type = 'missed_reading'));
  perform pg_temp.ck('2g no HbA1c in 12 months fires (last 400 days ago, 30 day grace passed)', '1', pg_temp.gaps(pg_temp.f('D'), 'no_hba1c_12_months')::text);
  perform pg_temp.ck('2h no HbA1c does not fire for one 100 days old', '0', pg_temp.gaps(pg_temp.f('E'), 'no_hba1c_12_months')::text);
  perform pg_temp.ck('2i no lipids fires for a plan 500 days old with no lipid result', '1', pg_temp.gaps(pg_temp.f('G'), 'no_lipids_12_months')::text);
  perform pg_temp.ck('2j no lipids does not fire for a plan inside the first year (20 days)', '0', pg_temp.gaps(pg_temp.f('F'), 'no_lipids_12_months')::text);
  perform pg_temp.ck('2k no lipids does not fire for a recent lipid panel', '0', pg_temp.gaps(pg_temp.f('E'), 'no_lipids_12_months')::text);
  perform pg_temp.ck('2w a plan of 40 days with no lab is NOT flagged 30 days after its start (due a year after, then the grace)', '0', pg_temp.gaps(pg_temp.f('N40'), 'no_lipids_12_months')::text);
  perform pg_temp.ck('2x a baseline result on file counts from its own date (300 days old: due in 65 days)', '0', pg_temp.gaps(pg_temp.f('BL1'), 'no_lipids_12_months')::text);
  perform pg_temp.ck('2y ...and a result 400 days old on a young plan is due 35 days ago, so it is flagged', '1', pg_temp.gaps(pg_temp.f('BL2'), 'no_lipids_12_months')::text);
  perform pg_temp.ck('2z the lab gap is due on the last result plus the lookback', 'last_lab/' || (pg_temp.base() - 35)::text,
    (select (why ->> 'anchor') || '/' || due_date::text from public.care_gaps where patient_id = pg_temp.f('BL2') and gap_type = 'no_lipids_12_months'));
  perform pg_temp.ck('2l a Free patient (no membership) gets no gap of any type', '0', (select count(*) from public.care_gaps where patient_id = pg_temp.f('H'))::text);
  perform pg_temp.ck('2m refill lapse fires (refill date 10 days ago, line 7) and names the medicine', '1/' || pg_temp.f('Rmed')::text,
    pg_temp.gaps(pg_temp.f('R'), 'medication_refill_lapse')::text || '/' || (select subject_id::text from public.care_gaps where patient_id = pg_temp.f('R') and gap_type = 'medication_refill_lapse'));
  perform pg_temp.ck('2n adherence lapse fires from the P6 signal with the scoped adherence below the line', '1', pg_temp.gaps(pg_temp.f('Q'), 'adherence_lapse')::text);
  perform pg_temp.ck('2n2 the line that raised the adherence gap is recorded on it', '80', (select threshold::text from public.care_gaps where patient_id = pg_temp.f('Q') and gap_type = 'adherence_lapse'));
  perform pg_temp.ck('2o the rising trend rule is inert while the CMO has supplied no rise', '0', pg_temp.gaps(pg_temp.f('W'), 'rising_bp_trend')::text);
  perform pg_temp.ck('2p a test account gets a gap flagged is_test', 'true', (select is_test::text from public.care_gaps where patient_id = pg_temp.f('TST') and gap_type = 'missed_reading'));
  perform pg_temp.ck('2sa under v1 (grace 30) lipids overdue by 35 days is a gap, recorded in shadow (patient SHL)', '1', pg_temp.gaps(pg_temp.f('SHL'), 'no_lipids_12_months')::text);
  perform pg_temp.ck('2q the same run twice opens nothing new', '0', (private.care_gap_evaluate(pg_temp.t0()) ->> 'opened'));

  v_r := private.care_gap_outreach_run(pg_temp.t0());
  perform pg_temp.ck('3c the outreach run is a no-op in shadow mode', 'config_unsigned_shadow', v_r ->> 'skipped');
  perform pg_temp.ck('3d no message, no attempt row, no coordinator task', '0/0/0',
    (select count(*) from public.notifications where source_table = 'care_gaps')::text || '/' || (select count(*) from public.care_gap_attempts)::text || '/'
    || (select count(*) from public.care_outreach_tasks where trigger_detail ->> 'source' = 'care_gap_engine')::text);
  perform pg_temp.scen_shadow_send('SHADOW-real', 'real');

  select count(*) filter (where owner_id = pg_temp.f('c1')), count(*) filter (where owner_id = pg_temp.f('c2')) into v_c1, v_c2
    from public.care_gaps where owner_role = 'care_coordinator';
  perform pg_temp.ck('8a coordinator gaps are balanced between the two coordinators (difference at most 1)', 'true', (abs(v_c1 - v_c2) <= 1 and v_c1 + v_c2 > 0)::text);
  perform pg_temp.ck('8b a logistics gap is owned by a coordinator of its organisation while one is available', '0',
    (select count(*) from public.care_gaps g where g.owner_role = 'care_coordinator' and g.owner_id is not null and g.owner_id not in (pg_temp.f('c1'), pg_temp.f('c2')))::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. A draft that supplies a rise (and a longer lipid grace) turns the trend rule on (still unsigned, still shadow); then the CMO signs
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_cfg jsonb; v_cmo uuid := pg_temp.f('cmo'); v_shl uuid;
begin
  select config into v_cfg from public.care_gap_rule_config where version = 1;
  v_cfg := jsonb_set(v_cfg, '{rules,rising_bp_trend,min_rise_systolic_mmhg}', '5');
  v_cfg := jsonb_set(v_cfg, '{rules,no_lipids_12_months,grace_days}', '60');
  insert into public.care_gap_rule_config (version, effective_from, config, note) values (2, current_date, v_cfg, 'S90 proof draft: a rise of 5 supplied, lipid grace 60');
  perform private.care_gap_evaluate(pg_temp.t0());
  perform pg_temp.ck('2r once a draft supplies a rise the trend rule fires (average rose 20)', '1', pg_temp.gaps(pg_temp.f('W'), 'rising_bp_trend')::text);
  perform pg_temp.ck('2s a judgement item is owned by a doctor, never a coordinator', 'clinician/true',
    (select owner_role || '/' || (owner_id in (pg_temp.f('smo'), pg_temp.f('cmo')))::text from public.care_gaps where patient_id = pg_temp.f('W') and gap_type = 'rising_bp_trend'));
  perform pg_temp.ck('2t the trend flag is set on the patient''s open gaps', 'true',
    (select bool_and(trend_flag)::text from public.care_gaps where patient_id = pg_temp.f('W') and status = 'open'));
  perform pg_temp.ck('2u the draft in use is shadow (still unsigned)', 'true', (select shadow::text from public.care_gaps where patient_id = pg_temp.f('W') and gap_type = 'rising_bp_trend'));
  perform pg_temp.ck('2v the why for a trend holds counts and the line, never an average', 'false',
    (select (why::text ~* '(avg_|average_sys|\m150\M|\m130\M)')::text from public.care_gaps where patient_id = pg_temp.f('W') and gap_type = 'rising_bp_trend'));

  -- a shadow gap is re-validated against the newest DRAFT on every run too: under the draft (grace 60) SHL's lipid gap no longer qualifies and is closed, unmessaged
  perform pg_temp.ck('4m a shadow gap that the newest draft no longer supports is closed by the next run, with nothing sent', 'closed/superseded/0',
    (select status || '/' || coalesce(closure_reason, '') from public.care_gaps where id = pg_temp.gap(pg_temp.f('SHL'), 'no_lipids_12_months')) || '/' || pg_temp.notes(pg_temp.f('SHL'))::text);
  -- and one that was recorded in shadow before the draft existed and is still waiting (no run has looked at it since) is what the ladder must re-check after signing
  insert into public.care_gaps (organisation_id, patient_id, gap_type, condition, due_date, opened_at, owner_role, shadow, config_version, why)
  values (pg_temp.org(), pg_temp.f('SHL'), 'no_lipids_12_months', 'hypertension', pg_temp.base() - 35, pg_temp.t0() - interval '1 day', 'care_coordinator', true, 1,
          '{"criterion": "no_lab_in_days", "lookback_days": 365, "grace_days": 30, "anchor": "plan_start"}')
  returning id into v_shl;
  perform pg_temp.act(v_cmo);
  perform public.sign_care_gap_rule_config(2);
  perform pg_temp.back();
  perform pg_temp.ck('1n the CMO signed version 2 and it is the active signed version', '2/true',
    (select version::text || '/' || (is_active and approved_by is not null)::text from public.care_gap_rule_config where is_active));
  perform pg_temp.ck('1o signing did not change the guard (this proof turned it on; signing alone never does)', 'true', (select is_on::text from public.go_live_guards where key = 'care_gap_engine_enabled'));
  perform pg_temp.ck('1p a signed version cannot be signed again', 'ERR:23514', pg_temp.q_as(v_cmo, 'select public.sign_care_gap_rule_config(2)::text'));
  perform pg_temp.ck('1q a signed config cannot be edited', '23514', pg_temp.try($q$update public.care_gap_rule_config set config = '{}'::jsonb where version = 2$q$));

  -- the gaps recorded in shadow are still waiting as shadow rows (no evaluate has run since signing). The ladder must re-check each one against the NOW signed
  -- numbers before anything else, at an hour when it may not send, so the only things that can happen are a closure or a promotion.
  perform private.care_gap_outreach_run(pg_temp.at_day(pg_temp.base(), 22));
  perform pg_temp.ck('4k a gap recorded in shadow that does not qualify under the signed numbers is closed by the ladder, with nothing sent', 'closed/superseded/0/0',
    (select status || '/' || coalesce(closure_reason, '') from public.care_gaps where id = v_shl)
    || '/' || pg_temp.notes(pg_temp.f('SHL'))::text || '/' || (select count(*) from public.care_gap_attempts where patient_id = pg_temp.f('SHL'))::text);
  perform pg_temp.ck('4l ...and one that does qualify is promoted to live by the same re-check', 'true',
    (select (not shadow and config_version = 2)::text from public.care_gaps where patient_id = pg_temp.f('A') and gap_type = 'missed_reading'));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. LIVE: the ladder, INV-07, the coordinator task, closures
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_r jsonb; a uuid := pg_temp.f('A'); g uuid; v_task uuid; v_t0 timestamptz := pg_temp.t0();
  v_bad integer; v_reading uuid; v_lab uuid; gf uuid; own uuid;
begin
  v_r := private.care_gap_evaluate(v_t0);
  perform pg_temp.ck('4a after signing, gaps turn live', '0', (select count(*) from public.care_gaps where shadow and status = 'open')::text);
  g := pg_temp.gap(a, 'missed_reading');

  v_r := private.care_gap_outreach_run(v_t0);
  perform pg_temp.ck('4b step 1 (push) is skipped for a patient with no push subscription (not counted as a send)', 'skipped_no_channel/0/1',
    (select result from public.care_gap_attempts where gap_id = g order by attempted_at, id limit 1) || '/' || pg_temp.sent(a)::text || '/' || (select ladder_step::text from public.care_gaps where id = g));
  v_r := private.care_gap_outreach_run(v_t0 + interval '1 minute');
  perform pg_temp.ck('4c step 2 sends the in-app card', '1/in_app', pg_temp.sent(a)::text || '/' || (select channel from public.care_gap_attempts where gap_id = g and result = 'sent' order by attempted_at limit 1));
  perform pg_temp.ck('4d the next attempt is due after the configured gap', 'true',
    (select (next_attempt_due_at = v_t0 + interval '1 minute' + interval '3 days')::text from public.care_gaps where id = g));
  v_r := private.care_gap_outreach_run(v_t0 + interval '2 days');
  perform pg_temp.ck('4e nothing is sent before the next attempt is due', '1', pg_temp.sent(a)::text);
  v_r := private.care_gap_outreach_run(v_t0 + interval '3 days 2 minutes');
  perform pg_temp.ck('4f step 3 sends the email follow-up', '2/email', pg_temp.sent(a)::text || '/' || (select channel from public.care_gap_attempts where gap_id = g and step = 'email' and result = 'sent'));
  v_r := private.care_gap_outreach_run(v_t0 + interval '6 days 5 minutes');
  select outreach_task_id into v_task from public.care_gaps where id = g;
  perform pg_temp.ck('4g step 4 creates one linked coordinator task, assigned to the gap owner', 'gap_missed_reading/true/true',
    (select t.trigger_type::text || '/' || (t.assigned_to = gp.owner_id)::text || '/' || (t.status = 'open')::text from public.care_outreach_tasks t join public.care_gaps gp on gp.outreach_task_id = t.id where gp.id = g));
  perform pg_temp.ck('4h the ladder is complete and waits for the coordinator follow-up', '4', (select ladder_step::text from public.care_gaps where id = g));
  perform pg_temp.ck('4i running the ladder again changes nothing', 'true',
    ((private.care_gap_outreach_run(v_t0 + interval '6 days 6 minutes') ->> 'tasks')::integer = 0
     and (select count(*) from public.care_outreach_tasks where patient_id = a and trigger_type = 'gap_missed_reading') = 1)::text);
  perform pg_temp.ck('4j a rising trend gap gets no message, no attempt and no coordinator task', '0/0/0',
    pg_temp.notes(pg_temp.f('W'))::text || '/' || (select count(*) from public.care_gap_attempts where patient_id = pg_temp.f('W'))::text
    || '/' || (select count(*) from public.care_outreach_tasks where patient_id = pg_temp.f('W') and trigger_detail ->> 'gap_type' = 'rising_bp_trend')::text);

  -- 7. INV-07
  select count(*) into v_bad from public.notifications n where n.source_table = 'care_gaps'
     and (n.template not in ('care_gap_checkin', 'care_gap_checkin_followup')
          or exists (select 1 from jsonb_object_keys(n.payload) k where k <> 'copy_variant')
          or n.payload::text ~* '(missed|hba1c|lipid|refill|adherence|trend|reading|gap_type|diabetes|hypertension|pressure)');
  perform pg_temp.ck('7a every message the engine wrote uses a neutral template and carries only the copy variant', '0', v_bad::text);
  perform pg_temp.ck('7b the engine wrote messages to check', 'true', ((select count(*) from public.notifications where source_table = 'care_gaps') > 0)::text);
  select count(*) into v_bad from public.notification_template_locales l
   where l.template_key in ('care_gap_checkin', 'care_gap_checkin_followup')
     and (coalesce(l.subject, '') || ' ' || l.body) ~* '\m(diabet|hypertens|blood pressure|bp|sugar|glucose|cholesterol|lipid|hba1c|reading|readings|result|results|lab|labs|medicine|medication|pill|pills|dose|refill|pressure|screening|symptom|treatment|trend|gap|missed|overdue)';
  perform pg_temp.ck('7c the template wording names no condition, reading, result or medicine', '0', v_bad::text);
  perform pg_temp.ck('7d only two engine templates exist', '2', (select count(*) from public.notification_templates where key like 'care_gap%')::text);

  -- 5. closures. A message sent is not a closure: A has had four contacts and is still open.
  perform pg_temp.ck('5a four contacts later the gap is still open (a message sent never closes it)', 'open', (select status from public.care_gaps where id = g));
  perform private.care_gap_close_resolved(v_t0 + interval '6 days 7 minutes', pg_temp.cfg(), true);
  perform pg_temp.ck('5b ...even after the closure sweep runs', 'open', (select status from public.care_gaps where id = g));
  perform pg_temp.ck('5c a person cannot close a gap as closed', 'ERR:22023', pg_temp.q_as(pg_temp.f('c1'), format('select public.close_care_gap_manual(%L, ''closed'', ''looks fine to me'')::text', g)));
  perform pg_temp.ck('5d a direct update to close it is refused (no write grant)', 'ERR:42501', pg_temp.cmd_as(pg_temp.f('c1'), format('update public.care_gaps set status = ''closed'' where id = %L', g)));
  perform pg_temp.ck('5e even the table owner cannot close as closed without a signal', '23514',
    pg_temp.try(format($q$update public.care_gaps set status = 'closed', closure_reason = 'closed', closed_at = now() where id = %L$q$, g)));

  -- the patient logs a reading after the gap opened: the gap closes on that row and the task is resolved
  v_reading := pg_temp.bp_at(a, v_t0 + interval '30 minutes', 140, 90);
  perform private.care_gap_evaluate(v_t0 + interval '6 days 10 minutes');
  perform pg_temp.ck('5f a reading logged closes the gap as closed, with the reading that closed it', 'closed/reading_logged/' || v_reading::text,
    (select closure_reason || '/' || (closed_by_signal ->> 'kind') || '/' || (closed_by_signal ->> 'id') from public.care_gaps where id = g));
  perform pg_temp.ck('5g the linked coordinator task is resolved', 'resolved', (select status::text from public.care_outreach_tasks where id = v_task));
  perform pg_temp.ck('5h a closed gap is a ledger row that never changes', '23514', pg_temp.try(format($q$update public.care_gaps set why = '{}'::jsonb where id = %L$q$, g)));
  perform pg_temp.ck('5i a closed gap cannot be reopened', '23514', pg_temp.try(format($q$update public.care_gaps set status = 'open', closure_reason = null, closed_at = null where id = %L$q$, g)));
  perform pg_temp.ck('5j a gap keeps its identity', '23514', pg_temp.try(format($q$update public.care_gaps set gap_type = 'adherence_lapse' where id = %L$q$, pg_temp.gap(pg_temp.f('F'), 'missed_reading'))));

  v_lab := pg_temp.lab_at(pg_temp.f('D'), 'hba1c', v_t0 + interval '30 minutes');
  perform private.care_gap_evaluate(v_t0 + interval '6 days 11 minutes');
  perform pg_temp.ck('5k a new HbA1c closes the HbA1c gap with the lab row', 'closed/lab_done/' || v_lab::text,
    (select closure_reason || '/' || (closed_by_signal ->> 'kind') || '/' || (closed_by_signal ->> 'id') from public.care_gaps where patient_id = pg_temp.f('D') and gap_type = 'no_hba1c_12_months'));
  perform pg_temp.ck('5l ...and leaves the lipid gap open (a different signal)', '1', pg_temp.gaps(pg_temp.f('D'), 'no_lipids_12_months')::text);
  update public.medications set refill_date = pg_temp.base() + 30 where id = pg_temp.f('Rmed');
  perform private.care_gap_evaluate(v_t0 + interval '6 days 12 minutes');
  perform pg_temp.ck('5m a refill recorded closes the refill gap with the medicine', 'closed/refill_recorded/' || pg_temp.f('Rmed')::text,
    (select closure_reason || '/' || (closed_by_signal ->> 'kind') || '/' || (closed_by_signal ->> 'id') from public.care_gaps where patient_id = pg_temp.f('R') and gap_type = 'medication_refill_lapse'));
  update public.care_plans set status = 'completed' where id = pg_temp.f('G.plan');
  perform private.care_gap_evaluate(v_t0 + interval '6 days 13 minutes');
  perform pg_temp.ck('5n a patient who is no longer enrolled has the gap closed as superseded (a system closure, not a person''s)', 'superseded/no_longer_enrolled',
    (select closure_reason || '/' || (closed_by_signal ->> 'kind') from public.care_gaps where patient_id = pg_temp.f('G') and gap_type = 'no_lipids_12_months'));
  perform pg_temp.ck('5o an adherence gap stays open while nothing records a recovery', '1', pg_temp.gaps(pg_temp.f('Q'), 'adherence_lapse')::text);
  -- the patient takes the medicine on each of the 7 days: the scoped adherence is 100 percent, above the recorded line
  perform pg_temp.taken_all(pg_temp.f('Q'));
  perform private.care_gap_close_resolved(v_t0 + interval '1 hour', pg_temp.cfg(), true);
  perform pg_temp.ck('5p recovered adherence closes the adherence gap', 'closed/adherence_recovered',
    (select closure_reason || '/' || (closed_by_signal ->> 'kind') from public.care_gaps where patient_id = pg_temp.f('Q') and gap_type = 'adherence_lapse'));

  -- manual closure: a note is required, unreachable needs the logged staff attempts
  gf := pg_temp.gap(pg_temp.f('F'), 'missed_reading');
  select owner_id into own from public.care_gaps where id = gf;
  perform pg_temp.ck('5q declined needs a note', 'ERR:22023', pg_temp.q_as(own, format('select public.close_care_gap_manual(%L, ''declined'', '''')::text', gf)));
  perform pg_temp.ck('5r unreachable is refused with no staff attempt logged', 'ERR:22023', pg_temp.q_as(own, format('select public.close_care_gap_manual(%L, ''unreachable'', ''could not reach them'')::text', gf)));
  perform pg_temp.act(own);
  perform public.log_care_gap_attempt(gf, 'call_no_answer', 'rang twice, no answer');
  perform public.log_care_gap_attempt(gf, 'message_left', 'left a voicemail');
  perform pg_temp.back();
  perform pg_temp.ck('5s two staff attempts are in the gap log and the contact log', '2/2',
    (select count(*) from public.care_gap_attempts where gap_id = gf and actor_id = own)::text || '/' || (select count(*) from public.care_outreach_contacts where patient_id = pg_temp.f('F') and contacted_by = own)::text);
  perform pg_temp.ck('5t a next attempt is now due in the future', 'true', (select (next_attempt_due_at > now())::text from public.care_gaps where id = gf));
  perform pg_temp.act(own);
  perform public.close_care_gap_manual(gf, 'unreachable', 'two calls, no answer, voicemail left');
  perform pg_temp.back();
  perform pg_temp.ck('5u unreachable closes once the attempts are logged, attributed to the person', 'unreachable/true',
    (select closure_reason || '/' || (closed_by = own)::text from public.care_gaps where id = gf));
  perform pg_temp.ck('5v a person closing as unreachable records no outcome signal', 'null', coalesce((select closed_by_signal::text from public.care_gaps where id = gf), 'null'));
  perform pg_temp.setf('Fgap', gf);
end $$;

-- 6 (quiet hours, cap), the message-closure scenario, and the shadow re-qualification scenario, on the real functions
do $$
begin
  perform pg_temp.scen_quiet('Q-real', 'real');
  perform pg_temp.scen_cap('CAP-real', 'real');
  perform pg_temp.scen_close_by_message('MSG-real', 'real');
  perform pg_temp.scen_requalify('RQ-real', 'real');
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The real definitions are captured here, before anything is replaced, and put back after each sabotage or injected fault, so one never hides the next.
-- ---------------------------------------------------------------------------------------------------------------------------------
create temp table orig_defs (fn text primary key, def text) on commit drop;
insert into orig_defs
select p.oid::regprocedure::text, pg_get_functiondef(p.oid) from pg_proc p
 where p.oid in ('private.care_gap_closing_signal(public.care_gaps,jsonb,timestamptz)'::regprocedure, 'private.care_gap_effective_config()'::regprocedure,
                 'private.care_gap_in_quiet_hours(jsonb,timestamptz)'::regprocedure, 'private.suppress_cell(bigint,bigint[],integer)'::regprocedure,
                 'private.suppress_groups(jsonb,integer)'::regprocedure, 'private.care_gap_try_lock(text)'::regprocedure,
                 'private.care_gap_last_usable_bp(uuid,timestamptz,timestamptz)'::regprocedure, 'private.care_gap_adherence_scope(uuid,jsonb)'::regprocedure,
                 'private.care_gap_pick_owner(uuid,uuid,text,timestamptz)'::regprocedure, 'private.care_gap_evaluate(timestamptz)'::regprocedure,
                 'private.care_gap_close_resolved(timestamptz,jsonb,boolean)'::regprocedure, 'public.care_gap_institution_summary(uuid,text[])'::regprocedure);
create function pg_temp.restore() returns void language plpgsql as
$f$ declare r record; begin
  for r in select def from orig_defs loop execute r.def; end loop;
  drop policy if exists care_gaps_select on public.care_gaps;
  create policy care_gaps_select on public.care_gaps for select to authenticated using (private.care_gap_visible(organisation_id, patient_id, owner_id));
  create unique index if not exists care_gap_attempts_one_send_per_week on public.care_gap_attempts (gap_id, step, week_start) where result = 'sent';
  drop trigger if exists care_gaps_owner_guard on public.care_gaps;
  create trigger care_gaps_owner_guard before insert or update of owner_id, owner_role on public.care_gaps for each row execute function private.care_gaps_owner_guard();
  alter table public.care_gaps enable trigger care_gaps_guard;
end $f$;
-- a replaced version of one captured function (a textual change to the real definition, so the rest of it stays the real thing)
create function pg_temp.mutate(p_fn text, p_old text, p_new text) returns void language plpgsql as
$f$ declare v text; begin
  select def into v from orig_defs where fn = p_fn::regprocedure::text;
  if v is null or position(p_old in v) = 0 then raise exception 'mutation target not found in %', p_fn; end if;
  execute replace(v, p_old, p_new);
end $f$;

-- an organisation with only a coordinator: a judgement item can never be handed to that coordinator, whoever tries
create function pg_temp.scen_owner_guard(p_label text, p_phase text) returns void language plpgsql as
$f$
declare o uuid := pg_temp.mkorg(p_label); c uuid := pg_temp.mkstaff(p_label || '-coord', 'care_coordinator', 'care_coordinator', o);
        p uuid := pg_temp.mkpatient(p_label || '-pat', 'hypertension', 25, true, o);
begin
  perform pg_temp.sk(p_phase, '13h a judgement item can never be owned by a care coordinator (the database refuses it)', '23514',
    pg_temp.try(format($q$insert into public.care_gaps (organisation_id, patient_id, gap_type, condition, due_date, owner_id, owner_role, shadow, config_version, why)
                          values (%L, %L, 'rising_bp_trend', 'hypertension', current_date, %L, 'clinician', false, 1, '{}')$q$, o, p, c)));
end $f$;
-- a person leaves the programme and comes back: the system's own closure must not hold the gap back from reopening
create function pg_temp.scen_lapse(p_label text, p_phase text) returns void language plpgsql as
$f$
declare p uuid := pg_temp.mkpatient(p_label, 'hypertension', 25); v_t timestamptz := pg_temp.t0();
begin
  perform pg_temp.bp(p, 20, 150, 95);
  perform private.care_gap_evaluate(v_t);
  update public.profiles set is_active = false where id = p;
  perform private.care_gap_evaluate(v_t + interval '1 hour');
  update public.profiles set is_active = true where id = p;
  perform private.care_gap_evaluate(v_t + interval '2 hours');
  perform pg_temp.sk(p_phase, '19c a lapse and renew reopens the gap at once: a system closure holds nothing back', 'open=1/superseded=1',
    'open=' || pg_temp.gaps(p, 'missed_reading')::text || '/superseded=' || (select count(*) from public.care_gaps where patient_id = p and closure_reason = 'superseded')::text);
end $f$;
-- a failing gap does not stop the rest: one gap's rule value is poisoned in the configuration handed to the closure pass; the gap with a recorded outcome still closes
create function pg_temp.scen_fail(p_label text, p_phase text) returns void language plpgsql as
$f$
declare p1 uuid := pg_temp.mkpatient(p_label || '-a', 'hypertension', 25); p2 uuid := pg_temp.mkpatient(p_label || '-b', 'hypertension', 25);
        v_t timestamptz := pg_temp.t0(); v_bad jsonb; v_r jsonb;
begin
  perform pg_temp.bp(p1, 20, 150, 95);
  perform pg_temp.bp(p2, 20, 150, 95);
  perform private.care_gap_evaluate(v_t);
  perform pg_temp.bp_at(p2, v_t + interval '30 minutes', 140, 90);
  set local session_replication_role = replica;
  update public.ops_incidents set status = 'resolved', root_cause = 'S90 proof reset' where external_reference = 'care-gap-close-failing' and status not in ('resolved', 'closed');
  set local session_replication_role = origin;
  v_bad := jsonb_set(pg_temp.cfg(), '{rules,missed_reading,hypertension_days_without_reading}', '"abc"');
  v_r := private.care_gap_close_resolved(v_t + interval '2 hours', v_bad, true);
  perform pg_temp.sk(p_phase, '16a a failing gap is counted, not swallowed', 'true', ((v_r ->> 'failed')::integer >= 1)::text);
  perform pg_temp.sk(p_phase, '16b a failing pass opens the care-gap-close-failing incident', 'sev3/open', pg_temp.incident('care-gap-close-failing'));
  perform pg_temp.sk(p_phase, '16c the gap with a recorded outcome still closed', 'closed/closed', (select status || '/' || closure_reason from public.care_gaps where id = pg_temp.gap(p2, 'missed_reading')));
  perform pg_temp.sk(p_phase, '16d the failure is audited against the gap', 'true',
    (exists (select 1 from public.audit_log where action = 'care_gap_engine.error_close' and entity_id = pg_temp.gap(p1, 'missed_reading')))::text);
end $f$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 13. Owner fallback and cross-organisation
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  o3 uuid := pg_temp.mkorg('org3-doctor-only'); o4 uuid := pg_temp.mkorg('org4-nobody'); o5 uuid := pg_temp.mkorg('org5-own-coordinator'); o6 uuid := pg_temp.mkorg('org6-coordinator-only');
  d3 uuid; c5 uuid; d5 uuid; c6 uuid; c3 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; g3 uuid; g6 uuid; v_org1 uuid := pg_temp.org(); v_n integer;
begin
  d3 := pg_temp.mkstaff('d3', 'clinician', 'senior_medical_officer', o3);
  c5 := pg_temp.mkstaff('c5', 'care_coordinator', 'care_coordinator', o5);
  d5 := pg_temp.mkstaff('d5', 'clinician', 'senior_medical_officer', o5);
  c6 := pg_temp.mkstaff('c6', 'care_coordinator', 'care_coordinator', o6);
  p3 := pg_temp.mkpatient('P3', 'hypertension', 25, true, o3); perform pg_temp.bp(p3, 20, 150, 95);
  p4 := pg_temp.mkpatient('P4', 'hypertension', 25, true, o4); perform pg_temp.bp(p4, 20, 150, 95);
  p5 := pg_temp.mkpatient('P5', 'hypertension', 25, true, o5); perform pg_temp.bp(p5, 20, 150, 95);
  p6 := pg_temp.mkpatient('P6', 'hypertension', 60, true, o6); perform pg_temp.bp(p6, 6, 150, 90, 3); perform pg_temp.bp(p6, 20, 130, 85, 3);
  perform pg_temp.setf('o3', o3); perform pg_temp.setf('o4', o4); perform pg_temp.setf('o5', o5); perform pg_temp.setf('o6', o6);
  perform pg_temp.setf('d3', d3); perform pg_temp.setf('c5', c5); perform pg_temp.setf('d5', d5); perform pg_temp.setf('c6', c6);
  perform private.care_gap_evaluate(pg_temp.t0());
  g3 := pg_temp.gap(p3, 'missed_reading'); g6 := pg_temp.gap(p6, 'rising_bp_trend');
  perform pg_temp.setf('g6', g6); perform pg_temp.setf('g3', g3);

  perform pg_temp.ck('13a no coordinator in the organisation: the logistics gap goes to its doctor, not to nobody', 'true/care_coordinator', (pg_temp.owner_of(g3) = d3)::text || '/' || (select owner_role from public.care_gaps where id = g3));
  perform pg_temp.ck('13b that organisation''s gaps are owned by its own staff only, never by an org1 coordinator or doctor', '0',
    (select count(*) from public.care_gaps where organisation_id = o3 and owner_id is distinct from d3)::text);
  perform pg_temp.ck('13c an organisation with nobody leaves its gap unowned', 'true', (pg_temp.owner_of(pg_temp.gap(p4, 'missed_reading')) is null)::text);
  perform pg_temp.ck('13d ...and that opens an immediate sev2 incident (the gap is live), not a nightly sev3', 'sev2/open', pg_temp.incident('care-gap-unowned'));
  perform pg_temp.ck('13e where a coordinator exists the coordinator is preferred to the doctor', 'true', (pg_temp.owner_of(pg_temp.gap(p5, 'missed_reading')) = c5)::text);
  perform pg_temp.ck('13f no org1 gap is owned by another organisation''s staff (and the reverse)', '0/0',
    (select count(*) from public.care_gaps where organisation_id = v_org1 and owner_id in (d3, c5, d5, c6))::text || '/'
    || (select count(*) from public.care_gaps where organisation_id in (o3, o4, o5, o6) and owner_id in (pg_temp.f('c1'), pg_temp.f('c2'), pg_temp.f('smo'), pg_temp.f('cmo')))::text);
  perform pg_temp.ck('13g a judgement item in an organisation with only a coordinator stays unowned: never the coordinator', 'true/true',
    (g6 is not null)::text || '/' || (pg_temp.owner_of(g6) is null)::text);
  perform pg_temp.ck('13i the database refuses an owner from another organisation', '23514',
    pg_temp.try(format($q$update public.care_gaps set owner_id = %L where id = %L$q$, pg_temp.f('c1'), g3)));
  perform pg_temp.scen_owner_guard('OG-real', 'real');
  select count(*) into v_n from public.care_gaps where owner_id is null;
  perform pg_temp.ck('13j an admin of the organisation reads the unowned gaps (ops can see them)', 'true',
    (pg_temp.q_as(pg_temp.f('admin'), 'select count(*)::text from public.care_gaps where owner_id is null')::integer = v_n and v_n >= 2)::text);
  perform pg_temp.ck('13k ...but not a gap that has an owner', '0', pg_temp.q_as(pg_temp.f('admin'), 'select count(*)::text from public.care_gaps where owner_id is not null'));
  perform pg_temp.ck('13l ...and a coordinator or a patient still cannot read an unowned gap', '0/0',
    pg_temp.q_as(pg_temp.f('c2'), 'select count(*)::text from public.care_gaps where owner_id is null') || '/' || pg_temp.q_as(pg_temp.f('pat'), 'select count(*)::text from public.care_gaps where owner_id is null'));
  -- a coordinator joins the doctor-only organisation: the logistics gap moves back to coordinator work on the next run
  c3 := pg_temp.mkstaff('c3', 'care_coordinator', 'care_coordinator', o3);
  perform private.care_gap_evaluate(pg_temp.t0());
  perform pg_temp.ck('13m a coordinator appears: the gap held by the fallback doctor moves to the coordinator', 'true', (pg_temp.owner_of(g3) = c3)::text);
  perform pg_temp.scen_owner('OWN-real', 'real');
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 15. The review clock of a doctor-owned gap
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare w4 uuid; gw uuid; v_t timestamptz := pg_temp.t0(); v_cmo uuid := pg_temp.f('cmo'); v_smo uuid := pg_temp.f('smo');
begin
  perform pg_temp.ck('15z the first trend gap (patient W), unreviewed for six days of this proof''s clock, was handed to the CMO by the nightly run and counted as overdue', 'true',
    (select (review_escalated_at is not null)::text from public.care_gaps where id = pg_temp.gap(pg_temp.f('W'), 'rising_bp_trend')));
  w4 := pg_temp.mkpatient('W4', 'hypertension', 60); perform pg_temp.bp(w4, 6, 150, 90, 3); perform pg_temp.bp(w4, 20, 130, 85, 3);
  perform private.care_gap_evaluate(v_t);
  gw := pg_temp.gap(w4, 'rising_bp_trend');
  perform pg_temp.ck('15a a doctor-owned gap carries a review date three days after it opened', 'true', (select (review_due_at = opened_at + interval '3 days')::text from public.care_gaps where id = gw));
  perform pg_temp.ck('15b a coordinator gap carries no review clock', '0', (select count(*) from public.care_gaps where owner_role = 'care_coordinator' and review_due_at is not null)::text);
  update public.care_gaps set owner_id = v_smo where id = gw;
  set local session_replication_role = replica;
  update public.ops_incidents set status = 'resolved', root_cause = 'S90 proof reset' where external_reference = 'care-gap-review-overdue' and status not in ('resolved', 'closed');
  set local session_replication_role = origin;
  perform private.care_gap_evaluate(v_t + interval '1 hour');
  perform pg_temp.ck('15c before the review date nothing moves', 'true/null', (pg_temp.owner_of(gw) = v_smo)::text || '/' || coalesce((select review_escalated_at::text from public.care_gaps where id = gw), 'null'));
  update public.care_gaps set review_due_at = v_t - interval '1 day' where id = gw;
  perform private.care_gap_evaluate(v_t + interval '1 hour');
  perform pg_temp.ck('15d past the review date it goes to the Chief Medical Officer, once, with a new date', 'true/true/true',
    (pg_temp.owner_of(gw) = v_cmo)::text || '/' || (select (review_escalated_at is not null)::text from public.care_gaps where id = gw) || '/'
    || (select (review_due_at = v_t + interval '1 hour' + interval '3 days')::text from public.care_gaps where id = gw));
  perform pg_temp.ck('15e one escalation is not yet an incident', 'none', pg_temp.incident('care-gap-review-overdue'));
  update public.care_gaps set review_due_at = v_t - interval '1 day' where id = gw;
  perform private.care_gap_evaluate(v_t + interval '2 hours');
  perform pg_temp.ck('15f still unreviewed after the escalation: no second hand-off, an ops incident opens', 'true/sev3/open',
    (pg_temp.owner_of(gw) = v_cmo)::text || '/' || pg_temp.incident('care-gap-review-overdue'));
  perform pg_temp.ck('15g the trend gap never gets a patient message, a coordinator task or an attempt', '0/0/0',
    pg_temp.notes(w4)::text || '/' || (select count(*) from public.care_outreach_tasks where patient_id = w4)::text || '/' || (select count(*) from public.care_gap_attempts where patient_id = w4)::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. RLS: the owner reads; everyone else untied reads nothing; nobody writes
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.rls_checks(p_phase text) returns void language plpgsql as
$f$
declare v_gap uuid; v_owner uuid; v_other uuid; v_patient uuid;
begin
  select id, owner_id, patient_id into v_gap, v_owner, v_patient from public.care_gaps
   where status = 'open' and owner_role = 'care_coordinator' and owner_id is not null and organisation_id = pg_temp.org() order by id limit 1;
  v_other := pg_temp.f('c1');
  if v_other = v_owner then v_other := pg_temp.f('c2'); end if;
  perform pg_temp.sk(p_phase, '9a the assigned owner reads their gap', '1', pg_temp.q_as(v_owner, format('select count(*)::text from public.care_gaps where id = %L', v_gap)));
  perform pg_temp.sk(p_phase, '9b a coordinator who does not own the gap reads nothing of it', '0', pg_temp.q_as(v_other, format('select count(*)::text from public.care_gaps where id = %L', v_gap)));
  perform pg_temp.sk(p_phase, '9c an untied coordinator reads no gap at all', '0', pg_temp.q_as(pg_temp.f('coord_untied'), 'select count(*)::text from public.care_gaps'));
  perform pg_temp.sk(p_phase, '9d an untied clinician reads no gap at all', '0', pg_temp.q_as(pg_temp.f('clin'), 'select count(*)::text from public.care_gaps'));
  perform pg_temp.sk(p_phase, '9e a patient reads no gap, not even their own', '0', pg_temp.q_as(v_patient, 'select count(*)::text from public.care_gaps'));
  perform pg_temp.sk(p_phase, '9f the attempt log follows the same rule', '0', pg_temp.q_as(pg_temp.f('coord_untied'), 'select count(*)::text from public.care_gap_attempts'));
  perform pg_temp.sk(p_phase, '9g anon cannot read', '42501', pg_temp.try_anon('select count(*) from public.care_gaps'));
end $f$;
do $$
declare v_gap uuid; v_owner uuid; v_pat uuid;
begin
  perform pg_temp.rls_checks('real');
  select id, owner_id, patient_id into v_gap, v_owner, v_pat from public.care_gaps
   where status = 'open' and owner_role = 'care_coordinator' and owner_id is not null and organisation_id = pg_temp.org() order by id limit 1;
  perform pg_temp.ck('9h no one has a write grant: insert', 'ERR:42501',
    pg_temp.cmd_as(v_owner, format($q$insert into public.care_gaps (organisation_id, patient_id, gap_type, due_date, owner_role, shadow, config_version, why) select organisation_id, patient_id, 'adherence_lapse', current_date, 'care_coordinator', false, 2, '{}' from public.care_gaps where id = %L$q$, v_gap)));
  perform pg_temp.ck('9i no one has a write grant: update', 'ERR:42501', pg_temp.cmd_as(v_owner, format('update public.care_gaps set owner_id = null where id = %L', v_gap)));
  perform pg_temp.ck('9j no one has a write grant: delete', 'ERR:42501', pg_temp.cmd_as(v_owner, format('delete from public.care_gaps where id = %L', v_gap)));
  perform pg_temp.ck('9k a staff member who cannot see a gap cannot log an attempt on it (same answer as a missing gap)', 'ERR:42501',
    pg_temp.q_as(pg_temp.f('coord_untied'), format('select public.log_care_gap_attempt(%L, ''call_reached'', ''spoke'')::text', v_gap)));
  perform pg_temp.ck('9l ...nor close it', 'ERR:42501', pg_temp.q_as(pg_temp.f('coord_untied'), format('select public.close_care_gap_manual(%L, ''wrong'', ''not them'')::text', v_gap)));
  perform pg_temp.ck('9m the rule config is unreadable to a patient and a coordinator', '0/0',
    pg_temp.q_as(pg_temp.f('pat'), 'select count(*)::text from public.care_gap_rule_config') || '/' || pg_temp.q_as(pg_temp.f('c1'), 'select count(*)::text from public.care_gap_rule_config'));
  perform pg_temp.ck('9n the CMO can read the rule config', '2', pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.care_gap_rule_config'));
  if to_regclass('public.stub_ties') is not null then
    insert into public.stub_ties values (pg_temp.f('clin'), v_pat);
    perform pg_temp.ck('9o a clinician with a tie to the patient reads that patient''s gap', 'true', (pg_temp.q_as(pg_temp.f('clin'), format('select count(*)::text from public.care_gaps where id = %L', v_gap)) = '1')::text);
    delete from public.stub_ties;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 10. Institution summary: a second organisation with a known ledger
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.subsets() returns setof text[] language plpgsql as
$f$
declare t text[] := array['missed_reading', 'no_hba1c_12_months', 'no_lipids_12_months', 'rising_bp_trend', 'medication_refill_lapse', 'adherence_lapse']; m integer; s text[]; i integer;
begin
  for m in 1 .. 63 loop s := '{}'; for i in 0 .. 5 loop if (m >> i) & 1 = 1 then s := s || t[i + 1]; end if; end loop; return next s; end loop;
end $f$;
create function pg_temp.cell(p_res jsonb, p_section text, p_key text) returns jsonb language sql as
$$ select x from jsonb_array_elements(p_res -> p_section -> 'by_type') x where x ->> 'key' = p_key $$;
create function pg_temp.inst_checks(p_phase text, p_org uuid) returns void language plpgsql as
$f$
declare full_res jsonb; res jsonb; s text[]; v_bad integer := 0; c jsonb; v_floor integer; v_supp integer;
begin
  full_res := public.care_gap_institution_summary(p_org);
  v_floor := (full_res ->> 'min_cell')::integer;
  for s in select * from pg_temp.subsets() loop
    res := public.care_gap_institution_summary(p_org, s);
    for c in select x from jsonb_array_elements(res -> 'open' -> 'by_type') x loop
      if (c ->> 'suppressed')::boolean = false and (c ->> 'n')::bigint between 1 and v_floor - 1 then v_bad := v_bad + 1; end if;
      if c is distinct from pg_temp.cell(full_res, 'open', c ->> 'key') then v_bad := v_bad + 1; end if;
      if (c ->> 'suppressed')::boolean and (c ->> 'n') is not null then v_bad := v_bad + 1; end if;
    end loop;
    for c in select x from jsonb_array_elements(res -> 'closed_90d' -> 'by_type') x loop
      if (c ->> 'suppressed')::boolean = false and (c ->> 'n')::bigint between 1 and v_floor - 1 then v_bad := v_bad + 1; end if;
      if c is distinct from pg_temp.cell(full_res, 'closed_90d', c ->> 'key') then v_bad := v_bad + 1; end if;
    end loop;
    -- the by-reason grid is not touched by a type filter and never shows a small cell
    if (res -> 'closed_90d' -> 'by_reason') is distinct from (full_res -> 'closed_90d' -> 'by_reason') then v_bad := v_bad + 1; end if;
    for c in select x from jsonb_array_elements(res -> 'closed_90d' -> 'by_reason') x loop
      if (c ->> 'suppressed')::boolean = false and (c ->> 'n')::bigint between 1 and v_floor - 1 then v_bad := v_bad + 1; end if;
    end loop;
    if (res -> 'open' -> 'any_people') is distinct from (full_res -> 'open' -> 'any_people')
       or (res -> 'closed_90d' -> 'any_people') is distinct from (full_res -> 'closed_90d' -> 'any_people')
       or (res -> 'closed_90d' -> 'any_reason_people') is distinct from (full_res -> 'closed_90d' -> 'any_reason_people') then v_bad := v_bad + 1; end if;
  end loop;
  -- a withheld by-reason cell withholds both totals that sit beside it
  if exists (select 1 from jsonb_array_elements(full_res -> 'closed_90d' -> 'by_reason') x where (x ->> 'suppressed')::boolean)
     and ((full_res -> 'closed_90d' -> 'any_people') is distinct from 'null'::jsonb or (full_res -> 'closed_90d' -> 'any_reason_people') is distinct from 'null'::jsonb) then v_bad := v_bad + 1; end if;
  perform pg_temp.sk(p_phase, '10a under every one of the 63 filter combinations no small cell is shown and every cell equals the published grid (types and reasons)', '0', v_bad::text);
  select count(*) into v_supp from jsonb_array_elements(full_res -> 'open' -> 'by_type') x where (x ->> 'suppressed')::boolean;
  perform pg_temp.sk(p_phase, '10b a withheld cell is never alone: with a small cell present at least two cells are withheld (complementary suppression)', 'true', (v_supp >= 2)::text);
  perform pg_temp.sk(p_phase, '10c the any-gap total is withheld while any type cell is withheld', 'null', coalesce(full_res -> 'open' ->> 'any_people', 'null'));
end $f$;
do $$
declare v_org2 uuid; v_org2b uuid; p uuid; m uuid; i integer; res jsonb; own uuid; gi uuid; v_t timestamptz := pg_temp.t0();
begin
  v_org2 := pg_temp.mkorg('institution', 5); perform pg_temp.setf('org2', v_org2);
  for i in 1 .. 8 loop
    p := pg_temp.mkpatient('I' || i, 'hypertension', 500, true, v_org2);
    perform pg_temp.bp(p, 20, 150, 95);
    perform pg_temp.setf('I' || i, p);
  end loop;
  for i in 1 .. 2 loop
    insert into public.medications (organisation_id, patient_id, care_plan_id, drug_name, is_active) values (v_org2, pg_temp.f('I' || i), pg_temp.f('I' || i || '.plan'), 'S90 medicine', true) returning id into m;
    update public.medications set refill_date = pg_temp.base() - 10 where id = m;
  end loop;
  -- a test account with the same gaps and an adherence signal: it must never count (its adherence cell stays at zero)
  p := pg_temp.mkpatient('I9', 'hypertension', 500, true, v_org2, true);
  perform pg_temp.bp(p, 20, 150, 95);
  perform pg_temp.med(p, pg_temp.f('I9.plan'), 'S90 htn tablet', 'hypertension', false);
  perform pg_temp.p6_event(p, 3);
  perform private.care_gap_evaluate(v_t);
  perform pg_temp.ck('10e before any closure the open missed-reading count is exact (8 people, the test account aside)', '8',
    (select count(distinct patient_id)::text from public.care_gaps where organisation_id = v_org2 and gap_type = 'missed_reading' and status = 'open' and not is_test));
  perform pg_temp.ck('10ee the test account really has an adherence gap (so 10i means something)', '1', pg_temp.gaps(p, 'adherence_lapse')::text);
  -- six readings close six gaps; one gap is declined and one marked unreachable by the admin (the only person who can see an unowned gap)
  for i in 1 .. 6 loop perform pg_temp.bp_at(pg_temp.f('I' || i), v_t + interval '1 hour', 140, 90); end loop;
  perform private.care_gap_evaluate(v_t + interval '2 hours');
  perform pg_temp.ck('10f six readings closed six gaps in the ledger', '6',
    (select count(distinct patient_id)::text from public.care_gaps where organisation_id = v_org2 and gap_type = 'missed_reading' and status = 'closed' and closure_reason = 'closed'));
  perform pg_temp.ck('10f2 nobody in the organisation owns anything: an unowned gap is closed by the admin who can see it', 'ok',
    pg_temp.cmd_as(pg_temp.f('admin'), format($q$select public.close_care_gap_manual(%L, 'declined', 'the patient said no thank you')$q$, pg_temp.gap(pg_temp.f('I7'), 'missed_reading'))));
  gi := pg_temp.gap(pg_temp.f('I8'), 'missed_reading');
  perform pg_temp.act(pg_temp.f('admin'));
  perform public.log_care_gap_attempt(gi, 'call_no_answer', 'rang, no answer');
  perform public.log_care_gap_attempt(gi, 'message_left', 'left a voicemail');
  perform public.close_care_gap_manual(gi, 'unreachable', 'two attempts and a voicemail, no reply');
  perform pg_temp.back();
  res := public.care_gap_institution_summary(v_org2);
  perform pg_temp.ck('10k closed counts only recorded outcomes: six people closed by a reading, the declined and the unreachable are not counted as closed', '6/false',
    (pg_temp.cell(res, 'closed_90d', 'missed_reading') ->> 'n') || '/' || (pg_temp.cell(res, 'closed_90d', 'missed_reading') ->> 'suppressed'));
  perform pg_temp.ck('10l the people who closed another way are counted apart, by reason, each small cell withheld', 'true/true/true',
    ((select (x ->> 'suppressed')::boolean from jsonb_array_elements(res -> 'closed_90d' -> 'by_reason') x where x ->> 'key' = 'declined')::text) || '/' ||
    ((select (x ->> 'suppressed')::boolean from jsonb_array_elements(res -> 'closed_90d' -> 'by_reason') x where x ->> 'key' = 'unreachable')::text) || '/' ||
    ((res -> 'closed_90d' -> 'any_people') = 'null'::jsonb)::text);

  perform pg_temp.ck('10j an organisation with no coordinator or doctor leaves its gaps unowned, and that is the sev2 incident rather than a quiet row', 'true/sev2/open',
    (exists (select 1 from public.care_gaps where organisation_id = v_org2 and status = 'open' and owner_id is null))::text || '/' || pg_temp.incident('care-gap-unowned'));
  perform pg_temp.ck('10g the service role can read the summary; an admin, a patient and anon cannot', 'true/ERR:42501/ERR:42501/42501',
    ((pg_temp.svc(format('select public.care_gap_institution_summary(%L)::text', v_org2)) like '{%'))::text || '/' ||
    pg_temp.q_as(pg_temp.f('admin'), format('select public.care_gap_institution_summary(%L)::text', v_org2)) || '/' ||
    pg_temp.q_as(pg_temp.f('pat'), format('select public.care_gap_institution_summary(%L)::text', v_org2)) || '/' ||
    pg_temp.try_anon(format('select public.care_gap_institution_summary(%L)', v_org2)));
  res := public.care_gap_institution_summary(v_org2);
  perform pg_temp.ck('10h the summary is live and carries a floor of at least 5', 'true/true', ((res ->> 'live')::boolean)::text || '/' || ((res ->> 'min_cell')::integer >= 5)::text);
  perform pg_temp.ck('10i a test account never counts: its adherence gap leaves the adherence cell at a shown zero', 'false/0',
    ((pg_temp.cell(res, 'open', 'adherence_lapse') ->> 'suppressed')::boolean)::text || '/' || (pg_temp.cell(res, 'open', 'adherence_lapse') ->> 'n'));
  perform pg_temp.inst_checks('real', v_org2);

  -- a second, small organisation: two people closed by a reading is a small closed cell and must be withheld
  v_org2b := pg_temp.mkorg('institution-small', 5);
  for i in 1 .. 2 loop
    p := pg_temp.mkpatient('J' || i, 'hypertension', 25, true, v_org2b);
    perform pg_temp.bp(p, 20, 150, 95);
    perform pg_temp.setf('J' || i, p);
  end loop;
  perform private.care_gap_evaluate(v_t);
  for i in 1 .. 2 loop perform pg_temp.bp_at(pg_temp.f('J' || i), v_t + interval '1 hour', 140, 90); end loop;
  perform private.care_gap_evaluate(v_t + interval '2 hours');
  res := public.care_gap_institution_summary(v_org2b);
  perform pg_temp.ck('10d two people closed by a reading is a small closed cell: withheld, and so is the closed total', 'true/true',
    ((pg_temp.cell(res, 'closed_90d', 'missed_reading') ->> 'suppressed')::boolean)::text || '/' || ((res -> 'closed_90d' -> 'any_people') = 'null'::jsonb)::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 17, 18. Usable readings and the adherence scope
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.scen_usable_rule(p_label text, p_phase text) returns void language plpgsql as
$f$
declare p uuid := pg_temp.mkpatient(p_label, 'hypertension', 25); r1 uuid; r2 uuid; v_t timestamptz := pg_temp.t0(); g uuid; r3 uuid; r4 uuid;
begin
  perform pg_temp.bp(p, 20, 150, 95);                                 -- the last usable reading is 20 days old
  r1 := pg_temp.bp(p, 3, 140, 90); perform pg_temp.mark_reading(r1, 'pharmacy_machine', null);        -- a pharmacy machine entry 3 days ago
  r2 := pg_temp.bp(p, 2, 150, 95); perform pg_temp.mark_reading(r2, null, array['implausible']);      -- a reading flagged for validation 2 days ago
  perform private.care_gap_evaluate(v_t);
  g := pg_temp.gap(p, 'missed_reading');
  perform pg_temp.sk(p_phase, '17a neither a pharmacy-machine nor a flagged reading counts as the last reading: the gap opens on the 20 day old usable one', '1/20',
    pg_temp.gaps(p, 'missed_reading')::text || '/' || coalesce((select why ->> 'days_since' from public.care_gaps where id = g), 'none'));
  r3 := pg_temp.bp_at(p, v_t + interval '30 minutes', 140, 90); perform pg_temp.mark_reading(r3, 'pharmacy_machine', null);
  r4 := pg_temp.bp_at(p, v_t + interval '40 minutes', 150, 95); perform pg_temp.mark_reading(r4, null, array['implausible']);
  perform private.care_gap_evaluate(v_t + interval '2 hours');
  perform pg_temp.sk(p_phase, '17b readings of that kind logged afterwards never close the gap', 'open', coalesce((select status from public.care_gaps where id = g), 'none'));
end $f$;
do $$
declare p uuid; v_t timestamptz := pg_temp.t0(); g uuid; r uuid; ss uuid; v_scope uuid[];
begin
  perform pg_temp.scen_usable_rule('UR-real', 'real');
  -- a usable reading does close it, so 17b is not just a gap that nothing can close
  select id into g from public.care_gaps where patient_id = (select id from public.profiles where full_name = 'S90 UR-real' limit 1) and gap_type = 'missed_reading';
  r := pg_temp.bp_at((select patient_id from public.care_gaps where id = g), v_t + interval '50 minutes', 130, 85);
  perform private.care_gap_evaluate(v_t + interval '3 hours');
  perform pg_temp.ck('17c a usable reading logged afterwards does close it', 'closed/closed/' || r::text,
    (select status || '/' || closure_reason || '/' || (closed_by_signal ->> 'id') from public.care_gaps where id = g));

  -- 18: the SSRI sits on the hypertension plan and is missed every day, the hypertension tablet is taken every day
  ss := pg_temp.mkpatient('SS', 'hypertension', 25); perform pg_temp.bp(ss, 5, 150, 95);
  perform pg_temp.med(ss, pg_temp.f('SS.plan'), 'S90 htn tablet', 'hypertension', true);
  perform pg_temp.med(ss, pg_temp.f('SS.plan'), 'S90 sertraline', 'depression', false);
  perform pg_temp.p6_event(ss, 3);
  perform private.care_gap_evaluate(v_t);
  perform pg_temp.ck('18a a mental health medicine on the plan, missed every day, neither raises nor holds an adherence gap', '0', pg_temp.gaps(ss, 'adherence_lapse')::text);
  v_scope := private.care_gap_adherence_scope(ss, pg_temp.cfg());
  perform pg_temp.ck('18b the scope is the hypertension tablet only', '1', cardinality(v_scope)::text);
  perform pg_temp.scen_scope('CTR-real', 'real');
  perform pg_temp.ck('18d the positive control: a hypertension medicine missed every day does open the gap (patient Q)', '1', pg_temp.gaps(pg_temp.f('Q'), 'adherence_lapse', 'closed')::text);
end $$;
do $$
declare p uuid; g uuid; v_t timestamptz := pg_temp.t0();
begin
  -- the gap closes against the line recorded when it opened, not whatever the line is today
  p := pg_temp.mkpatient('QT', 'hypertension', 25); perform pg_temp.bp(p, 5, 150, 95);
  perform pg_temp.med(p, pg_temp.f('QT.plan'), 'S90 htn tablet', 'hypertension', false);
  perform pg_temp.p6_event(p, 3);
  perform private.care_gap_evaluate(v_t);
  g := pg_temp.gap(p, 'adherence_lapse');
  perform pg_temp.ck('18e the line is recorded on the gap when it opens', '80', (select threshold::text from public.care_gaps where id = g));
  perform pg_temp.taken_all(p);
  alter table public.care_gaps disable trigger care_gaps_guard;
  update public.care_gaps set threshold = 101 where id = g;
  perform private.care_gap_close_resolved(v_t + interval '1 hour', pg_temp.cfg(), true);
  perform pg_temp.ck('18f 100 percent against a recorded line of 101 does not close it, although the current line is 80', 'open', (select status from public.care_gaps where id = g));
  update public.care_gaps set threshold = 50 where id = g;
  alter table public.care_gaps enable trigger care_gaps_guard;
  perform private.care_gap_close_resolved(v_t + interval '1 hour', pg_temp.cfg(), true);
  perform pg_temp.ck('18g against a recorded line of 50 it closes as recovered', 'closed/adherence_recovered', (select closure_reason || '/' || (closed_by_signal ->> 'kind') from public.care_gaps where id = g));
  perform pg_temp.ck('18h the recorded line cannot be edited', '23514', pg_temp.try(format($q$update public.care_gaps set threshold = 1 where id = %L$q$, g)));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 19. Reopen suppression: only a closure a person made
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare p uuid; g uuid; own uuid; v_t timestamptz := pg_temp.t0();
begin
  p := pg_temp.mkpatient('SU', 'hypertension', 25); perform pg_temp.bp(p, 20, 150, 95);
  perform private.care_gap_evaluate(v_t);
  g := pg_temp.gap(p, 'missed_reading');
  own := pg_temp.owner_of(g);
  perform pg_temp.act(own);
  perform public.close_care_gap_manual(g, 'declined', 'the patient said no for now');
  perform pg_temp.back();
  perform private.care_gap_evaluate(v_t + interval '1 hour');
  perform pg_temp.ck('19a a gap a person closed as declined is not opened again straight away', '0', pg_temp.gaps(p, 'missed_reading')::text);
  alter table public.care_gaps disable trigger care_gaps_guard;
  update public.care_gaps set closed_at = now() - interval '40 days' where id = g;
  alter table public.care_gaps enable trigger care_gaps_guard;
  perform private.care_gap_evaluate(v_t + interval '2 hours');
  perform pg_temp.ck('19b ...but after the 30 days it is', '1', pg_temp.gaps(p, 'missed_reading')::text);
  perform pg_temp.scen_lapse('LAPSE-real', 'real');
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 20. Locks and idempotency
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare p uuid; g uuid; v_t timestamptz := pg_temp.t0() + interval '5 hours'; v_r jsonb; a record; v_ch uuid; v_cg uuid; v_before timestamptz;
begin
  p := pg_temp.mkpatient('LK', 'hypertension', 25); perform pg_temp.bp(p, 20, 150, 95);
  perform private.care_gap_evaluate(pg_temp.t0());
  g := pg_temp.gap(p, 'missed_reading');
  -- another run holds the lock (the helper is replaced by one that cannot take it): all three runs return at once and change nothing
  perform pg_temp.mutate('private.care_gap_try_lock(text)', 'select pg_try_advisory_xact_lock(hashtextextended(''care_gap:'' || p_name, 0))', 'select false');
  perform pg_temp.ck('20a a run that cannot take the lock returns at once: evaluate, closure pass and the ladder', 'locked/locked/locked/0',
    (private.care_gap_evaluate(v_t) ->> 'skipped') || '/' || (private.care_gap_close_resolved(v_t, pg_temp.cfg(), true) ->> 'skipped') || '/'
    || (private.care_gap_outreach_run(v_t) ->> 'skipped') || '/' || (select count(*) from public.care_gap_attempts where gap_id = g)::text);
  perform pg_temp.restore();
  v_r := private.care_gap_outreach_run(pg_temp.t0() + interval '90 minutes');
  perform pg_temp.ck('20b with the lock free the same run does its work (the push step is recorded as skipped)', '1', (select count(*) from public.care_gap_attempts where gap_id = g)::text);
  -- two runs at the same instant never send twice: the second finds the step's row
  perform private.care_gap_outreach_run(pg_temp.t0() + interval '91 minutes');
  v_r := private.care_gap_outreach_run(pg_temp.t0() + interval '91 minutes');
  perform pg_temp.ck('20c an immediate repeat of the same run sends nothing more', '1', pg_temp.sent(p)::text);
  select * into a from public.care_gap_attempts where result = 'sent' order by attempted_at desc limit 1;
  perform pg_temp.sk('real', '20d one send per gap, step and Lagos week is a key: a second row for the same triple is refused', '23505',
    pg_temp.try(format($q$insert into public.care_gap_attempts (gap_id, organisation_id, patient_id, step, channel, result, week_start) values (%L, %L, %L, %L, 'x', 'sent', %L)$q$,
                       a.gap_id, a.organisation_id, a.patient_id, a.step, a.week_start)));
  -- the hourly pass is not a full scan: a gap whose inputs have not changed is not looked at again; a new reading brings it back
  v_ch := pg_temp.mkpatient('CH', 'hypertension', 25); perform pg_temp.bp(v_ch, 20, 150, 95);
  set local session_replication_role = replica;
  update public.vitals_readings set created_at = now() - interval '5 hours' where patient_id = v_ch;
  set local session_replication_role = origin;
  perform private.care_gap_evaluate(now() - interval '1 hour');
  v_cg := pg_temp.gap(v_ch, 'missed_reading');
  v_before := (select last_checked_at from public.care_gaps where id = v_cg);
  perform private.care_gap_close_resolved(now(), pg_temp.cfg(), false);
  perform pg_temp.ck('20e the hourly pass does not re-check a gap whose inputs have not changed', 'true', ((select last_checked_at from public.care_gaps where id = v_cg) = v_before)::text);
  perform pg_temp.bp_at(v_ch, now() - interval '10 minutes', 140, 90);
  perform private.care_gap_close_resolved(now(), pg_temp.cfg(), false);
  perform pg_temp.ck('20f ...and a new reading brings it back at once (and closes it)', 'closed/closed', (select status || '/' || closure_reason from public.care_gaps where id = v_cg));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 16. A failing gap is counted, audited and opens an incident; a timeout returns a clean partial result
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$ begin perform pg_temp.scen_fail('FAIL-real', 'real'); end $$;
do $$
begin
  set local session_replication_role = replica;
  update public.ops_incidents set status = 'resolved', root_cause = 'S90 proof reset' where external_reference = 'care-gap-close-failing' and status not in ('resolved', 'closed');
  set local session_replication_role = origin;
  -- every closure check now takes 0.3 seconds
  execute $q$create or replace function private.care_gap_closing_signal(g public.care_gaps, p_cfg jsonb, p_now timestamptz) returns jsonb
             language plpgsql stable security definer set search_path = '' as $b$ begin perform pg_sleep(0.3); return null; end $b$ $q$;
end $$;
set local statement_timeout = '700ms';
do $$
declare v_r jsonb;
begin
  v_r := private.care_gap_close_resolved(pg_temp.t0() + interval '3 hours', pg_temp.cfg(), true);
  perform pg_temp.ck('16e a statement timeout in the closure pass ends it cleanly with a partial result, not an error', 'true/true',
    ((v_r ->> 'timed_out')::boolean)::text || '/' || ((v_r ->> 'checked')::integer >= 1)::text);
end $$;
reset statement_timeout;
select pg_temp.restore();
select pg_temp.ck('16f ...and it opens the same incident, so a pass that keeps running out of time is seen', 'sev3/open', pg_temp.incident('care-gap-close-failing'));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. Leave is respected: an owner on leave is replaced on the next run. A patient who stopped logging has the trend closed as stale.
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_c1 uuid := pg_temp.f('c1'); v_c2 uuid := pg_temp.f('c2'); v_t timestamptz := pg_temp.t0() + interval '20 days'; v_n integer; v_ok text; w2 uuid;
begin
  w2 := pg_temp.mkpatient('W2', 'hypertension', 60); perform pg_temp.bp(w2, 6, 150, 90, 3); perform pg_temp.bp(w2, 20, 130, 85, 3);
  perform private.care_gap_evaluate(pg_temp.t0());
  perform pg_temp.ck('15h a second rising trend opens', '1', pg_temp.gaps(w2, 'rising_bp_trend')::text);
  select count(*) into v_n from public.care_gaps where owner_id = v_c1 and status = 'open';
  perform pg_temp.ck('8c the first coordinator owns open gaps before leave', 'true', (v_n > 0)::text);
  begin
    insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at) values (pg_temp.org(), v_c1, 'leave', v_t - interval '1 day', v_t + interval '5 days');
    v_ok := 'ok';
  exception when others then v_ok := 'skip:' || sqlstate;
  end;
  perform private.care_gap_evaluate(v_t);
  perform pg_temp.ck('15i a patient who stopped logging has the trend closed as stale (superseded, not resolved), with nothing sent', 'superseded/trend_stale/0',
    (select closure_reason || '/' || (closed_by_signal ->> 'kind') from public.care_gaps where id = pg_temp.gap(w2, 'rising_bp_trend')) || '/' || pg_temp.notes(w2)::text);
  if v_ok = 'ok' then
    perform pg_temp.ck('8d an owner on leave is replaced: no open coordinator gap is left with them', '0', (select count(*) from public.care_gaps where owner_id = v_c1 and status = 'open' and owner_role = 'care_coordinator')::text);
    perform pg_temp.ck('8e ...and the second coordinator took them over', 'true', ((select count(*) from public.care_gaps where owner_id = v_c2 and status = 'open') > 0)::text);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 14. A new signed configuration supersedes the open gaps it no longer supports. Version 3 switches the refill rule off, nulls the rise and stretches the HbA1c grace.
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_cfg jsonb; v_cmo uuid := pg_temp.f('cmo'); rvr uuid; rvg uuid; w3 uuid; ctl uuid; m uuid; v_t timestamptz := pg_temp.t0();
begin
  rvr := pg_temp.mkpatient('RVR', 'hypertension', 25); perform pg_temp.bp(rvr, 5, 150, 95);
  insert into public.medications (organisation_id, patient_id, care_plan_id, drug_name, is_active) values (pg_temp.org(), rvr, pg_temp.f('RVR.plan'), 'S90 medicine', true) returning id into m;
  update public.medications set refill_date = pg_temp.base() - 10 where id = m;
  rvg := pg_temp.mkpatient('RVG', 'diabetes', 500); perform pg_temp.lab(rvg, 'hba1c', 400);
  w3 := pg_temp.mkpatient('W3', 'hypertension', 60); perform pg_temp.bp(w3, 6, 150, 90, 3); perform pg_temp.bp(w3, 20, 130, 85, 3);
  ctl := pg_temp.mkpatient('CTL', 'hypertension', 25); perform pg_temp.bp(ctl, 20, 150, 95);
  perform private.care_gap_evaluate(v_t);
  perform pg_temp.ck('14a before the change each of the four has its gap open', '1/1/1/1',
    pg_temp.gaps(rvr, 'medication_refill_lapse')::text || '/' || pg_temp.gaps(rvg, 'no_hba1c_12_months')::text || '/' || pg_temp.gaps(w3, 'rising_bp_trend')::text || '/' || pg_temp.gaps(ctl, 'missed_reading')::text);

  select config into v_cfg from public.care_gap_rule_config where version = 2;
  v_cfg := jsonb_set(v_cfg, '{rules,medication_refill_lapse,enabled}', 'false');
  v_cfg := jsonb_set(v_cfg, '{rules,rising_bp_trend,min_rise_systolic_mmhg}', 'null');
  v_cfg := jsonb_set(v_cfg, '{rules,no_hba1c_12_months,grace_days}', '400');
  insert into public.care_gap_rule_config (version, effective_from, config, note) values (3, current_date, v_cfg, 'S90 proof draft: refill off, rise null, HbA1c grace 400');
  perform pg_temp.act(v_cmo);
  perform public.sign_care_gap_rule_config(3);
  perform pg_temp.back();
  perform private.care_gap_evaluate(v_t + interval '1 hour');
  perform pg_temp.ck('14b a rule switched off closes its gap as superseded by the configuration', 'closed/superseded/superseded_config',
    (select status || '/' || closure_reason || '/' || (closed_by_signal ->> 'kind') from public.care_gaps where id = pg_temp.gap(rvr, 'medication_refill_lapse')));
  perform pg_temp.ck('14c a person who no longer meets the stretched grace has the gap closed as superseded', 'closed/superseded/premise_no_longer_holds',
    (select status || '/' || closure_reason || '/' || (closed_by_signal ->> 'kind') from public.care_gaps where id = pg_temp.gap(rvg, 'no_hba1c_12_months')));
  perform pg_temp.ck('14d the CMO nulling the rise closes the doctor-owned trend gap', 'closed/superseded/superseded_config',
    (select status || '/' || closure_reason || '/' || (closed_by_signal ->> 'kind') from public.care_gaps where id = pg_temp.gap(w3, 'rising_bp_trend')));
  perform pg_temp.ck('14e the gap that still qualifies is untouched', 'open', (select status from public.care_gaps where id = pg_temp.gap(ctl, 'missed_reading')));
  perform pg_temp.ck('14f none of the superseded gaps was messaged, and none holds anything back (no person closed them)', '0/0/0/0',
    pg_temp.notes(rvr)::text || '/' || pg_temp.notes(rvg)::text || '/' || pg_temp.notes(w3)::text || '/' || (select count(*) from public.care_gaps where closure_reason in ('declined', 'unreachable', 'wrong') and patient_id in (rvr, rvg, w3))::text);
  perform pg_temp.ck('14g the engine now runs on version 3, signed', '3/true', (select cfg_version::text || '/' || is_signed::text from private.care_gap_effective_config()));
  perform pg_temp.ck('14h a gap of a rule that is switched off is not opened again', '0', pg_temp.gaps(rvr, 'medication_refill_lapse')::text);
  perform pg_temp.ck('14i a superseded closure carries its signal, never a person', 'true/null',
    (select (closed_by_signal ? 'kind' and closed_by_signal ? 'at')::text || '/' || coalesce(closed_by::text, 'null') from public.care_gaps where id = pg_temp.gap(rvr, 'medication_refill_lapse')));
  perform pg_temp.scen_requalify('RQ2-real', 'real');
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 11. Scans
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('11a every S90 function has an explicit search_path', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ((n.nspname = 'private' and p.proname like 'care_gap%') or (n.nspname = 'public' and p.proname in ('sign_care_gap_rule_config', 'log_care_gap_attempt', 'close_care_gap_manual', 'care_gap_institution_summary')))
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')));
  perform pg_temp.ck('11b no S90 function is executable by anon', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ((n.nspname = 'private' and p.proname like 'care_gap%') or (n.nspname = 'public' and p.proname in ('sign_care_gap_rule_config', 'log_care_gap_attempt', 'close_care_gap_manual', 'care_gap_institution_summary')))
        and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.ck('11c the engine, the closure sweep, the owner pickers and the summary are not executable by a signed-in user', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('private', 'public') and p.proname in ('care_gap_evaluate', 'care_gap_outreach_run', 'care_gap_institution_summary', 'care_gap_close_resolved', 'care_gap_pick_owner',
                                                                 'care_gap_pick_coordinator', 'care_gap_pick_doctor', 'care_gap_pick_cmo', 'care_gap_close_with_signal', 'care_gap_scoped_adherence')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')));
  perform pg_temp.ck('11d both cron jobs exist', '2', (select count(*)::text from cron.job where jobname in ('care-gap-evaluate', 'care-gap-outreach')));
  perform pg_temp.ck('11e no hand-written minimum compare in the summary or the cell publisher', '0',
    (select count(*)::text from pg_proc p where p.proname in ('care_gap_institution_summary', 'care_gap_publish_cells') and p.prosrc ~* '(min_cohort_size\s*[<>]|v_floor\s*[<>]|< *v_min|n *< *5)'));
  perform pg_temp.ck('11f the two tables are registered with the staff read scope', '2', (select count(*)::text from public.staff_read_scope where table_name in ('care_gaps', 'care_gap_attempts') and mode = 'tied'));
  perform pg_temp.ck('11g no care gap function counts adherence with the unscoped private.weekly_adherence', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'care_gap%' and p.prosrc ~ 'private\.weekly_adherence'));
  perform pg_temp.ck('11h the rules and the closing signal read blood pressure only through the shared usable-reading helper', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in ('care_gap_rule_missed_reading', 'care_gap_closing_signal') and p.prosrc ~* 'vitals_readings_current[^;]*blood_pressure'));
  perform pg_temp.ck('11i no care gap function swallows an error without counting or logging it (every when others handler writes an audit row or returns)', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in ('care_gap_close_resolved', 'care_gap_evaluate', 'care_gap_outreach_run') and p.prosrc ~* 'when others then\s*(null|return null)'));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 12. SABOTAGE: break each guarantee and the matching check must FLIP
-- ---------------------------------------------------------------------------------------------------------------------------------
-- a. closure by message
create or replace function private.care_gap_closing_signal(g public.care_gaps, p_cfg jsonb, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.care_gap_attempts a where a.gap_id = g.id and a.result = 'sent') then jsonb_build_object('kind', 'message_sent', 'at', p_now) end $$;
select pg_temp.scen_close_by_message('MSG-sab', 'sab-message');
select pg_temp.restore();

-- b. no weekly cap
create or replace function private.care_gap_effective_config(out cfg jsonb, out cfg_version integer, out is_signed boolean)
language sql stable security definer set search_path = '' as $$
  select jsonb_set(c.config, '{ladder,weekly_cap_per_patient}', '100'), c.version, (c.is_active and c.approved_at is not null)
    from public.care_gap_rule_config c order by (c.is_active and c.approved_at is not null) desc, c.version desc limit 1 $$;
select pg_temp.scen_cap('CAP-sab', 'sab-cap');
select pg_temp.restore();

-- b2. no quiet hours
create or replace function private.care_gap_in_quiet_hours(p_cfg jsonb, p_now timestamptz) returns boolean language sql stable set search_path = '' as $$ select false $$;
select pg_temp.scen_quiet('Q-sab', 'sab-quiet');
select pg_temp.restore();

-- c. the read policy opened to everyone
drop policy care_gaps_select on public.care_gaps;
create policy care_gaps_select on public.care_gaps for select to authenticated using (true);
select pg_temp.rls_checks('sab-rls');
select pg_temp.restore();

-- d. the small-cell helpers stop withholding
create or replace function private.suppress_cell(p_n bigint, p_categories bigint[] default null, p_min integer default null) returns text
language sql stable security definer set search_path = '' as $$ select null::text $$;
create or replace function private.suppress_groups(p_groups jsonb, p_min integer default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(g.doc || jsonb_build_object('suppressed', false, 'reason', null)), '[]'::jsonb) from jsonb_array_elements(p_groups) as g(doc) $$;
select pg_temp.inst_checks('sab-cell', pg_temp.f('org2'));
select pg_temp.restore();

-- f. no fallback: a logistics gap with no coordinator is left unowned
create or replace function private.care_gap_pick_owner(p_org uuid, p_patient uuid, p_role text, p_now timestamptz default now()) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_role = 'clinician' then return private.care_gap_pick_doctor(p_org, p_patient, p_now); end if;
  return private.care_gap_pick_coordinator(p_org, p_now);
end $$;
select pg_temp.scen_owner('OWN-sab', 'sab-owner');
select pg_temp.restore();

-- g. no re-check before the ladder sends: a gap that no longer qualifies is messaged
create or replace function private.care_gap_closing_signal(g public.care_gaps, p_cfg jsonb, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$ select null::jsonb $$;
select pg_temp.scen_requalify('RQ-sab', 'sab-requalify');
select pg_temp.restore();

-- h. the usable-reading rule dropped: every blood pressure row counts
create or replace function private.care_gap_last_usable_bp(p_patient uuid, p_now timestamptz, p_after timestamptz default null)
returns table (id uuid, taken_at timestamptz) language sql stable security definer set search_path = '' as $$
  select v.id, v.taken_at from private.vitals_readings_current v
   where v.patient_id = p_patient and v.vital_type::text = 'blood_pressure' and v.systolic is not null and v.taken_at <= p_now and (p_after is null or v.taken_at > p_after)
   order by v.taken_at desc limit 1 $$;
select pg_temp.scen_usable_rule('UR-sab', 'sab-usable');
select pg_temp.restore();

-- i. the adherence scope dropped: every active medicine counts
create or replace function private.care_gap_adherence_scope(p_patient uuid, p_cfg jsonb) returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.id), '{}'::uuid[]) from public.medications m where m.patient_id = p_patient and m.is_active and m.superseded_at is null $$;
select pg_temp.scen_scope('CTR-sab', 'sab-scope');
select pg_temp.restore();

-- j. reopen suppression applied to every closure, including the system's own
select pg_temp.mutate('private.care_gap_evaluate(timestamptz)', 'x.closure_reason in (''declined'', ''unreachable'', ''wrong'')', 'x.closure_reason is not null');
select pg_temp.scen_lapse('LAPSE-sab', 'sab-lapse');
select pg_temp.restore();

-- k. the one-send-per-week key dropped
drop index public.care_gap_attempts_one_send_per_week;
do $$
declare a record;
begin
  select * into a from public.care_gap_attempts where result = 'sent' order by attempted_at desc limit 1;
  perform pg_temp.sk('sab-key', '20d one send per gap, step and Lagos week is a key: a second row for the same triple is refused', '23505',
    pg_temp.try(format($q$insert into public.care_gap_attempts (gap_id, organisation_id, patient_id, step, channel, result, week_start) values (%L, %L, %L, %L, 'x', 'sent', %L)$q$,
                       a.gap_id, a.organisation_id, a.patient_id, a.step, a.week_start)));
  delete from public.care_gap_attempts where channel = 'x' and result = 'sent';   -- the duplicate the sabotaged table accepted, so the key can be put back
end $$;
select pg_temp.restore();

-- l. the institution summary counts every closure as closed
select pg_temp.mutate('public.care_gap_institution_summary(uuid,text[])',
                      'status = ''closed'' and closure_reason = ''closed'' and not shadow and not is_test and gap_type = t',
                      'status = ''closed'' and not shadow and not is_test and gap_type = t');
select pg_temp.sk('sab-summary', '10k closed counts only recorded outcomes: six people closed by a reading, the declined and the unreachable are not counted as closed', '6/false',
  (pg_temp.cell(public.care_gap_institution_summary(pg_temp.f('org2')), 'closed_90d', 'missed_reading') ->> 'n') || '/'
  || (pg_temp.cell(public.care_gap_institution_summary(pg_temp.f('org2')), 'closed_90d', 'missed_reading') ->> 'suppressed'));
select pg_temp.restore();

-- m. a failing pass that raises no incident
select pg_temp.mutate('private.care_gap_close_resolved(timestamptz,jsonb,boolean)', 'if v_failed > 0 or v_timed_out then', 'if false then');
select pg_temp.scen_fail('FAIL-sab', 'sab-fail');
select pg_temp.restore();

-- n. the owner guard dropped
drop trigger care_gaps_owner_guard on public.care_gaps;
select pg_temp.scen_owner_guard('OG-sab', 'sab-guard');
select pg_temp.restore();

-- e. an unsigned configuration treated as signed (last: it leaves the configuration rows in a broken state)
create or replace function private.care_gap_effective_config(out cfg jsonb, out cfg_version integer, out is_signed boolean)
language sql stable security definer set search_path = '' as $$
  select c.config, c.version, true from public.care_gap_rule_config c order by (c.is_active and c.approved_at is not null) desc, c.version desc limit 1 $$;
do $$ begin
  update public.care_gap_rule_config set is_active = false where is_active;
  set local session_replication_role = replica;
  update public.care_gap_rule_config set approved_at = null, approved_by = null where version = 3;
  set local session_replication_role = origin;
end $$;
select pg_temp.scen_shadow_send('SHADOW-sab', 'sab-shadow');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Verdict
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_bad integer; v_flipped integer; v_names text; r record;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S90 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  if (select count(*) from results where phase = 'real') < 190 then raise exception 'S90 proof ran fewer than 190 real checks: %', (select count(*) from results where phase = 'real'); end if;
  -- every sabotage must flip at least the named checks (a count of checks whose actual differs from the expected value)
  for r in select * from (values
      ('sab-message', '^5w', 1), ('sab-cap', '^6b', 1), ('sab-quiet', '^6a', 1), ('sab-rls', '^9[b-f]', 4), ('sab-cell', '^10[ab]', 2),
      ('sab-owner', '^13a', 1), ('sab-requalify', '^14[st]', 2), ('sab-usable', '^17[ab]', 2), ('sab-scope', '^18c', 1), ('sab-lapse', '^19c', 1),
      ('sab-key', '^20d', 1), ('sab-summary', '^10k', 1), ('sab-fail', '^16b', 1), ('sab-guard', '^13h', 1), ('sab-shadow', '^3e', 1)
    ) as t(phase, pat, need) loop
    select count(*), string_agg(check_name, '; ') into v_flipped, v_names from results where phase = r.phase and check_name ~ r.pat and expected is distinct from actual;
    if v_flipped < r.need then raise exception 'VACUOUS TEST: sabotage % flipped % of the required % checks matching % (%)', r.phase, v_flipped, r.need, r.pat, coalesce(v_names, 'none'); end if;
  end loop;
end $$;

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
select 'SABOTAGE ' || phase || ' ' || check_name as check_name, expected, actual, case when expected is distinct from actual then 'PASS' else 'FAIL' end as result
  from results
 where (phase = 'sab-message' and check_name ~ '^5w') or (phase = 'sab-cap' and check_name ~ '^6b') or (phase = 'sab-quiet' and check_name ~ '^6a')
    or (phase = 'sab-rls' and check_name ~ '^9[b-f]') or (phase = 'sab-cell' and check_name ~ '^10[ab]') or (phase = 'sab-shadow' and check_name ~ '^3e')
    or (phase = 'sab-owner' and check_name ~ '^13a') or (phase = 'sab-requalify' and check_name ~ '^14[st]') or (phase = 'sab-usable' and check_name ~ '^17[ab]')
    or (phase = 'sab-scope' and check_name ~ '^18c') or (phase = 'sab-lapse' and check_name ~ '^19c') or (phase = 'sab-key' and check_name ~ '^20d')
    or (phase = 'sab-summary' and check_name ~ '^10k') or (phase = 'sab-fail' and check_name ~ '^16b') or (phase = 'sab-guard' and check_name ~ '^13h')
 order by phase, check_name;

rollback;
