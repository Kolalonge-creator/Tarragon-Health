-- S66 (Module 16, function 16.3; INV-10, INV-12; decisions A13, A14): the clinician cycle PATTERN REPORT and its go-live guard.
--
-- WHY A NEW FUNCTION AND NOT A POLICY: the cycle tables stay exactly as they are (live RLS was changed by S39b and S39g, which this branch's
-- base does not contain, so nothing here replaces a policy). A clinician reads a patient's cycle pattern through ONE audited function, the same
-- shape as read_patient_vitals_audited (S05f): a reason, an audit row for every attempt including a refusal, and a fresh category-scoped check.
--
-- THE CHECK IS WRITTEN FRESH (CLAUDE.md: never copy an RLS shape for reproductive data). private.reproductive_staff_tied(patient) admits ONLY:
--   * an active, credentialed CLINICIAN (profiles.role = 'clinician', active clinical_staff row, not the care-coordinator tier), who is
--   * in the patient's organisation, AND
--   * tied to the patient through private.clinician_has_patient_access (INV-12: care team, a routed escalation or alert, a live appointment).
-- It deliberately does NOT call private.can_staff_read_clinical, so it admits no break-glass, no emergency access, no support view-as session
-- and no S39c "open record" window: reproductive_health is excluded from every one of them. A care coordinator, an admin, a sponsor or employer
-- account, a pharmacist and another organisation's clinician are all refused, and each refusal is audited.
--
-- WHAT THE REPORT CARRIES: period start and end dates, per day the flow level, symptom list and mood list, and the menopause log (symptom
-- types, severity, the postmenopausal bleeding flag). It does NOT carry notes (the
-- patient's own words), basal temperature or ovulation test results (conception-planning data, A14), or anything about contraception.
-- The window is reproductive_privacy_config.report_window_months (PROPOSED 12). The numbers (variability, counts) are computed by the one shared
-- engine in the app (packages/shared/src/cycle/pattern-report.ts), not here.
--
-- GO-LIVE GUARD (INV-14): reproductive_content_enabled, born OFF. It stops the report function (DB side) and the contraception education page
-- (app side, courtesy check). NOTHING IS SWITCHED ON. The conditions list in private.go_live_conditions has no branch for this key yet, so the
-- guard reads "unknown guard, never satisfied" and CANNOT be switched on until a later session adds the CMO content review condition. That
-- function is replaced wholesale by every session that adds a guard (S37, S37b, S28c), and S67 to S69 are building theirs now, so replacing it
-- here from a stale base would silently drop another session's branch. Recorded as OQ-331.
--
-- Live counts 2026-10-07: go_live_guards has 7 rows, none on; no cycle data exists, so no existing reader is affected.

-- ---------------------------------------------------------------------------
-- 1. The guard
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in)
select 'reproductive_content_enabled', 'Reproductive education and clinician cycle report',
       'The clinician cycle pattern report and the contraception education page',
       'The Chief Medical Officer has reviewed the contraception, menopause and danger-sign wording; the audited report read is proven; Chief Medical Officer confirmation',
       'cmo',
       array['public.read_reproductive_pattern_report_audited (every call)', 'the contraception education page (courtesy check)'],
       'The cycle tracker, the menopause log, planning mode and the private section lock are live features and are NOT behind it.'
where not exists (select 1 from public.go_live_guards where key = 'reproductive_content_enabled');

-- ---------------------------------------------------------------------------
-- 2. The fresh category-scoped tie check
-- ---------------------------------------------------------------------------
create function private.reproductive_staff_tied(p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and p_patient is not null
     and exists (
       select 1
         from public.profiles me
         join public.clinical_staff cs on cs.profile_id = me.id
         join public.profiles pt on pt.id = p_patient
        where me.id = (select auth.uid())
          and me.role = 'clinician' and me.is_active
          and cs.active
          and cs.doctor_tier is distinct from 'care_coordinator'
          and pt.role = 'patient'
          and pt.organisation_id = me.organisation_id
     )
     and private.clinician_has_patient_access(p_patient)
$$;
revoke all on function private.reproductive_staff_tied(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. The audited read
-- ---------------------------------------------------------------------------
create function public.read_reproductive_pattern_report_audited(p_patient uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_cap constant integer := 1000;                 -- technical page cap, not a clinical value
  v_uid uuid := (select auth.uid());
  v_months integer;
  v_from date;
  v_stage text;
  v_cycles jsonb;
  v_logs jsonb;
  v_meno jsonb;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  -- A patient (and a caregiver, who is a patient-role account) reads her own tracker directly; this is the staff path.
  if exists (select 1 from public.profiles where id = v_uid and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  -- INV-14 (server side). Fail closed, and say so plainly: this is not a denial of access, the feature is not open.
  if not private.go_live_open('reproductive_content_enabled', p_patient, v_uid) then
    raise exception 'reproductive_content_guard_off' using errcode = '55000';
  end if;
  -- An unknown id and a patient the caller may not read look the same to the caller: a refusal.
  if not exists (select 1 from public.profiles where id = p_patient and role = 'patient') then
    return jsonb_build_object('status', 'denied', 'cycles', '[]'::jsonb, 'logs', '[]'::jsonb, 'menopause_logs', '[]'::jsonb);
  end if;
  if not private.reproductive_staff_tied(p_patient) then
    perform private.audit_chart_read(p_patient, array['reproductive_pattern_report'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied', 'cycles', '[]'::jsonb, 'logs', '[]'::jsonb, 'menopause_logs', '[]'::jsonb);
  end if;

  v_months := private.reproductive_privacy_rule('report_window_months');
  v_from := (now() at time zone 'Africa/Lagos')::date - (v_months * 31);
  select life_stage::text into v_stage from public.reproductive_health_profiles where patient_id = p_patient;

  select coalesce(jsonb_agg(jsonb_build_object('period_start_date', c.period_start_date, 'period_end_date', c.period_end_date)
                            order by c.period_start_date), '[]'::jsonb)
    into v_cycles
    from (select period_start_date, period_end_date from public.menstrual_cycles
           where patient_id = p_patient and period_start_date >= v_from
           order by period_start_date desc limit c_cap) c;
  select coalesce(jsonb_agg(jsonb_build_object('log_date', l.log_date, 'flow', l.flow, 'symptoms', to_jsonb(l.symptoms), 'moods', to_jsonb(l.moods))
                            order by l.log_date), '[]'::jsonb)
    into v_logs
    from (select log_date, flow, symptoms, moods from public.menstrual_daily_logs
           where patient_id = p_patient and log_date >= v_from
           order by log_date desc limit c_cap) l;

  -- The menopause log rides in the same audited read (16.4): symptom types, severity and the bleeding flag, never the free-text notes.
  select coalesce(jsonb_agg(jsonb_build_object('logged_at', m.logged_at, 'symptom_types', to_jsonb(m.symptom_types), 'severity', m.severity,
                                               'postmenopausal_bleeding', m.postmenopausal_bleeding) order by m.logged_at), '[]'::jsonb)
    into v_meno
    from (select logged_at, symptom_types, severity, postmenopausal_bleeding from public.menopause_symptom_logs
           where patient_id = p_patient and logged_at >= v_from
           order by logged_at desc limit c_cap) m;

  perform private.audit_chart_read(p_patient, array['reproductive_pattern_report'], p_reason, 'success');
  return jsonb_build_object('status', 'ok', 'window_months', v_months, 'life_stage', coalesce(v_stage, 'menstruating'),
                            'cycles', v_cycles, 'logs', v_logs, 'menopause_logs', v_meno);
end $$;
revoke all on function public.read_reproductive_pattern_report_audited(uuid, text) from public, anon;
grant execute on function public.read_reproductive_pattern_report_audited(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. "Who can see this": the patient reads who opened her cycle report (and who was refused)
-- ---------------------------------------------------------------------------
create function public.my_reproductive_access_log(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', x.created_at, 'result', x.result, 'reader', coalesce(x.full_name, 'A member of your care team'))
                     order by x.created_at desc)
      from (
        select a.created_at, a.result, p.full_name
          from public.audit_log a
          left join public.profiles p on p.id = a.actor_id
         where a.subject_patient_id = v_uid
           and a.action = 'staff.chart_read'
           and a.event -> 'sections' ? 'reproductive_pattern_report'
         order by a.created_at desc
         limit least(greatest(coalesce(p_limit, 50), 1), 200)
      ) x
  ), '[]'::jsonb);
end $$;
revoke all on function public.my_reproductive_access_log(integer) from public, anon;
grant execute on function public.my_reproductive_access_log(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.go_live_guards where key = 'reproductive_content_enabled' and not is_on) then
    raise exception 'S66: the reproductive_content_enabled guard must exist and be OFF';
  end if;
  if has_function_privilege('anon', 'public.read_reproductive_pattern_report_audited(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_reproductive_access_log(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'private.reproductive_staff_tied(uuid)', 'EXECUTE') then
    raise exception 'S66: anon can execute a reproductive function';
  end if;
  if not has_function_privilege('authenticated', 'public.read_reproductive_pattern_report_audited(uuid,text)', 'EXECUTE') then
    raise exception 'S66: authenticated must be able to call the audited report';
  end if;
  raise notice 'PASS: S66 pattern report and guard installed (guard OFF)';
end $$;
