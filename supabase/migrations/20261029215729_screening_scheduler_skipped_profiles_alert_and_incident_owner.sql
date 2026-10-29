-- Screening safety case v0.1, gaps HZ-SCR-03 and HZ-SCR-06.
--
-- HZ-SCR-03: the nightly scheduler skips an active patient who has no date of birth or no sex on file, because screening_due
-- returns nothing for them. Nobody was told. Now each full nightly run counts those patients and, when the count is above zero,
-- writes one audit_log row (a count, no patient named, INV-07) and opens one sev3 ops incident, kept to one open at a time.
-- HZ-SCR-06: the "automatic test requests failed" sev3 incident had no default owner. Both incidents now get the active Chief
-- Medical Officer as owner (CMO instruction 2026-10-29: "You (CMO)").
--
-- Both job bodies below are the LIVE definitions read with pg_get_functiondef on 2026-10-29, not the older migration text.
-- Live counts before writing: 5 real active patients, 1 of them with no date of birth or sex.

create or replace function private.screening_incident_owner()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cs.profile_id
    from public.clinical_staff cs
   where cs.active and cs.doctor_tier = 'chief_medical_officer' and coalesce(cs.is_test, false) = false
   order by cs.created_at
   limit 1
$$;
revoke all on function private.screening_incident_owner() from public, anon, authenticated;

create or replace function private.run_screening_scheduler(p_patient uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_set uuid; v_created integer := 0; v_events integer := 0; r record; v_reasons text[]; v_flagged integer := 0;
  v_missing integer := 0; v_missing_org uuid;
begin
  if p_patient is null then
    if not private.go_live_guard_on('screening_scheduler_enabled') then return jsonb_build_object('ran', false, 'reason', 'guard_off'); end if;
    select id into v_set from public.screening_rule_sets where is_active and approved_by is not null limit 1;
  else
    if not private.go_live_open_patient('screening_scheduler_enabled', p_patient) then return jsonb_build_object('ran', false, 'reason', 'guard_off'); end if;
    select id into v_set from public.screening_rule_sets
     where (is_active and approved_by is not null)
        or (exists (select 1 from public.profiles where id = p_patient and is_test))
     order by (is_active and approved_by is not null) desc, version desc limit 1;
  end if;
  if v_set is null then return jsonb_build_object('ran', false, 'reason', 'rules_not_signed'); end if;

  for r in
    with due as (
      select p.id as patient_id, p.organisation_id, d.*
        from public.profiles p
        cross join lateral private.screening_due(p.id, v_set) d
       where p.role = 'patient' and p.is_active and p.organisation_id is not null
         and (p_patient is null or p.id = p_patient)
    ), ins as (
      insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date, rule_set_id)
      select organisation_id, patient_id, screen_type_id, 'pending', due_date, v_set from due
      returning id, organisation_id, patient_id, due_date
    )
    select * from ins
  loop
    v_created := v_created + 1;
    if r.due_date <= current_date + 30 then
      perform private.emit_domain_event('screening.due', r.organisation_id, jsonb_build_object('screening_schedule_id', r.id),
        'screening.due:' || r.id, r.patient_id, 'screening_schedule', r.id);
      v_events := v_events + 1;
    end if;
  end loop;

  -- S47 (decision 13): a woman living with HIV is flagged to the care team for her cervical pathway. This rule never schedules her itself.
  -- The row says only that the pathway needs a care-team decision (no status word); the event carries ids only (INV-07).
  for r in
    with flagged as (
      insert into public.screening_care_team_flags (organisation_id, patient_id, screen_type_id, reason_code, is_test)
      select p.organisation_id, p.id, st.id, 'review_cervical_pathway', p.is_test
        from public.profiles p
        join public.patient_serology_status ss on ss.patient_id = p.id and ss.hiv_status = 'hiv_positive'
        cross join lateral jsonb_to_recordset((select rs.config -> 'rules' from public.screening_rule_sets rs where rs.id = v_set))
             as x(code text, sex text, "ageFrom" integer, "ageTo" integer, "excludeWhenHiv" boolean)
        join public.screen_types st on st.code = x.code
       where coalesce(x."excludeWhenHiv", false)
         and p.role = 'patient' and p.is_active and p.organisation_id is not null and p.date_of_birth is not null
         and p.sex::text = x.sex
         and (p_patient is null or p.id = p_patient)
         and extract(year from age(private.lagos_today(), p.date_of_birth))::integer between coalesce(x."ageFrom", 0) and coalesce(x."ageTo", 150)
         -- a flag the care team already resolved in the last 12 months is not raised again every night
         and not exists (select 1 from public.screening_care_team_flags f where f.patient_id = p.id and f.screen_type_id = st.id and f.resolved_at > now() - interval '12 months')
      on conflict (patient_id, screen_type_id, reason_code) where resolved_at is null do nothing
      returning id, organisation_id, patient_id
    ) select * from flagged
  loop
    v_flagged := v_flagged + 1;
    perform private.emit_domain_event('screening.care_team_review_needed', r.organisation_id, jsonb_build_object('screening_care_flag_id', r.id),
      'screening.care_team_review_needed:' || r.id, r.patient_id, 'screening_care_team_flag', r.id);
  end loop;

  -- HZ-SCR-03: count the real active patients the run could not screen because the profile lacks a date of birth or a sex.
  -- Full nightly run only. The count and one incident name no patient (INV-07); a person finds them in the patient directory.
  if p_patient is null then
    select count(*), (array_agg(p.organisation_id))[1] into v_missing, v_missing_org
      from public.profiles p
     where p.role = 'patient' and p.is_active and p.organisation_id is not null
       and not coalesce(p.is_test, false)
       and (p.date_of_birth is null or p.sex is null);
    if v_missing > 0 then
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
      values (v_missing_org, null, 'screening_scheduler.skipped_missing_profile_data', 'profiles', null,
              jsonb_build_object('skipped', v_missing), 'failed');
      if not exists (select 1 from public.ops_incidents where external_reference = 'screening_scheduler_missing_profile_data' and status not in ('resolved', 'closed')) then
        insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at, owner_id)
        values (v_missing_org, 'technical', 'sev3', 'Some patients cannot be screened: profile is missing a date of birth or sex',
                format('%s active patient(s) were skipped by the nightly screening scheduler because their profile has no date of birth or no sex. No patient is named here. Find them in the admin patient directory and ask them to complete their profile.', v_missing),
                'screening_scheduler_missing_profile_data', now(), now() + interval '7 days', private.screening_incident_owner());
      end if;
    end if;
  end if;

  -- reassessment prompts ride the same nightly run (only while the risk guard is on)
  if p_patient is null and private.go_live_guard_on('risk_instrument_who2019_enabled') then
    for r in select distinct ra.patient_id, ra.organisation_id from public.risk_assessments ra loop
      v_reasons := private.risk_reassessment_reasons(r.patient_id);
      if cardinality(v_reasons) > 0 then
        perform private.emit_domain_event('risk.reassessment_due', r.organisation_id, jsonb_build_object('patient_ref', r.patient_id),
          'risk.reassessment_due:' || r.patient_id || ':' || to_char(current_date, 'YYYY'), r.patient_id, 'profile', r.patient_id);
      end if;
    end loop;
  end if;
  return jsonb_build_object('ran', true, 'rule_set_id', v_set, 'created', v_created, 'events', v_events, 'care_flags', v_flagged, 'skipped_missing_profile', v_missing);
end $function$;

-- HZ-SCR-06: same live body as before, with one change: the failure incident gets the CMO as owner.
create or replace function private.run_screening_request_automation(p_patient uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record; v_order uuid; v_issued integer := 0; v_sensitive integer := 0; v_no_bundle integer := 0; v_failed integer := 0; v_is_sens boolean;
  v_fail_states text[] := '{}'; v_fail_org uuid;
begin
  if p_patient is null then
    if not private.go_live_guard_on('screening_request_automation_enabled') then return jsonb_build_object('ran', false, 'reason', 'guard_off'); end if;
  else
    if not private.go_live_open_patient('screening_request_automation_enabled', p_patient) then return jsonb_build_object('ran', false, 'reason', 'guard_off'); end if;
  end if;

  for r in
    select s.id as schedule_id, s.organisation_id, s.patient_id, st.code, st.sensitive,
           (select b.id from public.panel_bundles b where b.is_active and b.test_codes = array[st.code] order by (b.code like 'single\_%') desc, b.self_bookable, b.code limit 1) as bundle_id
      from public.screening_schedules s
      join public.profiles p on p.id = s.patient_id
      join public.screen_types st on st.id = s.screen_type_id and st.is_active
     where s.status in ('pending', 'overdue')
       and s.due_date <= current_date
       and p.role = 'patient' and p.is_active and p.organisation_id is not null
       and (p_patient is null or s.patient_id = p_patient)
       and (coalesce(p.is_test, false)
            or exists (select 1 from public.screening_rule_sets rs where rs.id = s.rule_set_id and rs.is_active and rs.approved_by is not null))
       and not exists (select 1 from public.lab_orders o where o.screening_schedule_id = s.id)
     order by s.due_date, s.id
     limit 1000
  loop
    -- one source: screen_types.sensitive (live, hiv, hep_b, hep_c, syphilis and chlamydia_gonorrhoea are all flagged)
    v_is_sens := r.sensitive;
    -- a sensitive test needs the second guard AND the patient's own opt-in; otherwise it stays a patient action (INV-04)
    if v_is_sens and not (
         private.go_live_open_patient('screening_sensitive_request_optin_enabled', r.patient_id)
         and exists (select 1 from public.screening_sensitive_request_optin o where o.patient_id = r.patient_id and o.opted_in)) then
      v_sensitive := v_sensitive + 1; continue;
    end if;
    if r.bundle_id is null then v_no_bundle := v_no_bundle + 1; continue; end if;
    begin
      perform pg_advisory_xact_lock(hashtextextended('screening_request:' || r.schedule_id::text, 0));
      if exists (select 1 from public.lab_orders o where o.screening_schedule_id = r.schedule_id) then continue; end if;
      perform set_config('tarragon.screening_request_job', 'on', true);
      insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, screening_schedule_id, status, origin, fulfilment, total_kobo)
      values (r.organisation_id, r.patient_id, r.bundle_id, r.schedule_id, 'ordered', 'patient_initiated', 'self_arranged', 0)
      returning id into v_order;
      perform set_config('tarragon.screening_request_job', 'off', true);
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (r.organisation_id, null, 'screening_request.auto_issued', 'lab_orders', v_order,
              case when v_is_sens then jsonb_build_object('screening_schedule_id', r.schedule_id, 'sensitive', true)
                   else jsonb_build_object('screening_schedule_id', r.schedule_id, 'screen_type', r.code) end);
      v_issued := v_issued + 1;
    exception when others then
      -- skip, never bypass; recorded durably after the loop, naming no patient, schedule or test (INV-07)
      perform set_config('tarragon.screening_request_job', 'off', true);
      v_failed := v_failed + 1;
      v_fail_states := array_append(v_fail_states, sqlstate);
      v_fail_org := coalesce(v_fail_org, r.organisation_id);
    end;
  end loop;
  -- outside the per-row handler on purpose: if recording the failure fails, the whole run fails loudly instead of being swallowed
  if v_failed > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
    values (v_fail_org, null, 'screening_request.auto_issue_failed', 'screening_schedules', null,
            jsonb_build_object('failed', v_failed, 'sqlstates', to_jsonb(v_fail_states)), 'failed');
    if not exists (select 1 from public.ops_incidents where external_reference = 'screening_request_automation' and status not in ('resolved', 'closed')) then
      insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at, owner_id)
      values (v_fail_org, 'technical', 'sev3', 'Automatic test requests failed for some patients',
              format('%s automatic test request(s) failed in the last nightly run (SQLSTATE: %s). See audit_log action screening_request.auto_issue_failed. No patient or test is named here.',
                     v_failed, array_to_string(v_fail_states, ',')),
              'screening_request_automation', now(), now() + interval '1 day', private.screening_incident_owner());
    end if;
  end if;
  return jsonb_build_object('ran', true, 'issued', v_issued, 'skipped_sensitive', v_sensitive, 'skipped_no_bundle', v_no_bundle, 'failed', v_failed);
end $function$;

-- Closing self-check: the scheduler body now carries the gap alert and the owner resolver is not open to anon.
-- (No check that a CMO exists: a fresh replay database has none, and a missing owner leaves the incident unowned, not failed.)
do $$
begin
  if position('screening_scheduler_missing_profile_data' in pg_get_functiondef('private.run_screening_scheduler(uuid)'::regprocedure)) = 0 then
    raise exception 'scheduler does not carry the missing-profile alert';
  end if;
  if has_function_privilege('anon', 'private.screening_incident_owner()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.screening_incident_owner()', 'EXECUTE') then
    raise exception 'the owner resolver is callable by anon or a signed-in user';
  end if;
end $$;
