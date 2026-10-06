-- S35: the clinician's patient summary (spec 9.2) and "my lead patients" (spec 9.1) as audited reads.
--
-- Why: the spec's patient summary is one screen, but the existing audited reads are
-- per-section, so assembling it from five calls would write five audit rows per open and
-- left three sections with no staff read path at all (recent triage events, results
-- metadata, care circle presence). This adds ONE function that checks the tie once,
-- gates every section by its access category, and writes ONE audit_log row (INV-10, INV-12).
-- Staff never read triage_events directly; this is their only path to it.
--
-- Nothing here writes clinical data. Results are metadata only (panel, state, dates), never
-- values, so INV-03/INV-04 are untouched. Care circle shows a count, never identities.
-- reproductive_health is not a section here; it is never surfaced by this function.


-- The tie for these two functions only. A clinician who is the ACTIVE LEAD for a patient has a tie (INV-12, spec 9.1),
-- but private.clinician_has_patient_access does not list lead_assignments, and that shared function is deliberately not
-- touched here. So the lead tie is evaluated inside the S35 functions, and the audit row says basis 'lead'.
create or replace function private.s35_is_my_lead(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.lead_assignments la
                  where la.patient_id = p_patient and la.clinician_id = (select auth.uid()) and la.state = 'active');
$$;

create or replace function private.s35_audit_read(p_patient uuid, p_sections text[], p_reason text, p_result text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_basis text;
begin
  v_basis := case
    when private.clinician_has_patient_access(p_patient) then 'tied'
    when private.s35_is_my_lead(p_patient) then 'lead'
    when private.has_emergency_access(p_patient) then 'break_glass'
    when private.can_support_view(p_patient) then 'support_view'
    else 'none' end;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id, ip)
  select pr.organisation_id, (select auth.uid()), 'staff.chart_read', 'patient_chart', pr.id,
         jsonb_build_object('reason', btrim(p_reason), 'sections', to_jsonb(p_sections), 'basis', v_basis),
         btrim(p_reason), p_result, pr.id, private.request_ip()
    from public.profiles pr where pr.id = p_patient;
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;
end;
$$;
revoke all on function private.s35_is_my_lead(uuid) from public, anon, authenticated;
revoke all on function private.s35_audit_read(uuid, text[], text, text) from public, anon, authenticated;

create or replace function public.clinician_patient_summary(p_patient uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_out jsonb := '{}'::jsonb;
  v_sections text[] := '{}';
  v_denied text[] := '{}';
  v_name text;
  v_lead boolean;
begin
  if v_uid is null then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = p_patient and role <> 'patient') then
    raise exception 'not a patient' using errcode = '22023';
  end if;

  v_lead := private.s35_is_my_lead(p_patient);

  -- readings, last 14 days; the target band belongs to the care plan, so it is only returned with that category
  if v_lead or private.can_staff_read_clinical(p_patient, 'vitals_readings'::public.care_access_category) then
    v_sections := v_sections || 'readings'::text;
    v_out := v_out || jsonb_build_object('readings', jsonb_build_object(
      'window_days', 14,
      'rows', coalesce((select jsonb_agg(to_jsonb(o) order by o.measured_at desc) from (
          select type, systolic, diastolic, value_numeric, unit, measured_at, source
            from public.observations
           where patient_id = p_patient and measured_at >= now() - interval '14 days'
           order by measured_at desc limit 200) o), '[]'::jsonb),
      'targets', case when v_lead or private.can_staff_read_clinical(p_patient, 'appointments_care_plan'::public.care_access_category)
                      then coalesce((select jsonb_agg(jsonb_build_object('condition', cp.condition, 'target_ranges', cp.target_ranges))
                             from public.care_plans cp where cp.patient_id = p_patient and cp.status = 'active'), '[]'::jsonb)
                      else '[]'::jsonb end));
    v_sections := v_sections || 'triage_events'::text;
    v_out := v_out || jsonb_build_object('triage_events', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from (
        select grade, trigger_type, explanation_key, created_at
          from public.triage_events
         where patient_id = p_patient and not shadow and created_at >= now() - interval '30 days'
           and (trigger_type <> 'result' or v_lead or private.can_staff_read_clinical(p_patient, 'labs_results'::public.care_access_category))
         order by created_at desc limit 5) t), '[]'::jsonb));
  else
    v_denied := v_denied || array['readings','triage_events'];
  end if;

  -- current medicines and adherence
  if v_lead or private.can_staff_read_clinical(p_patient, 'medications'::public.care_access_category) then
    v_sections := v_sections || 'medications'::text;
    v_out := v_out || jsonb_build_object('medications', jsonb_build_object(
      'active', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'drug_name', m.drug_name, 'dose', m.dose,
                   'frequency', m.frequency, 'refill_date', m.refill_date) order by m.drug_name)
                 from public.medications m where m.patient_id = p_patient and m.is_active and m.superseded_at is null), '[]'::jsonb),
      'adherence', private.weekly_adherence(p_patient)));
  else
    v_denied := v_denied || 'medications'::text;
  end if;

  -- care plan, pending proposals, signed notes
  if v_lead or private.can_staff_read_clinical(p_patient, 'appointments_care_plan'::public.care_access_category) then
    v_sections := v_sections || array['care_plan','pending_proposals','signed_notes'];
    v_out := v_out || jsonb_build_object(
      'care_plan', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'condition', cp.condition, 'status', cp.status,
                   'target_ranges', cp.target_ranges, 'reading_schedule', cp.reading_schedule, 'notes', cp.notes))
                 from public.care_plans cp where cp.patient_id = p_patient and cp.status = 'active'), '[]'::jsonb),
      'pending_proposals', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from (
          select id, kind, state, proposed_by, rationale, created_at, signed_at, expires_at
            from public.care_plan_changes
           where patient_id = p_patient and state in ('proposed','signed') order by created_at desc limit 5) c), '[]'::jsonb),
      'signed_notes', coalesce((select jsonb_agg(to_jsonb(n) order by n.finalized_at desc) from (
          select id, encounter_type, encounter_date, assessment, plan, finalized_at
            from public.clinical_encounter_notes
           where patient_id = p_patient and status = 'finalized' and amends_note_id is null
           order by finalized_at desc limit 5) n), '[]'::jsonb));
  else
    v_denied := v_denied || array['care_plan','pending_proposals','signed_notes'];
  end if;

  -- results: metadata only, never values
  if v_lead or private.can_staff_read_clinical(p_patient, 'labs_results'::public.care_access_category) then
    v_sections := v_sections || 'results'::text;
    v_out := v_out || jsonb_build_object('results', coalesce((select jsonb_agg(to_jsonb(r) order by r.received_at desc) from (
        select id, panel_code, release_state, received_at, reviewed_at
          from public.lab_results where patient_id = p_patient and superseded_by is null
         order by received_at desc limit 5) r), '[]'::jsonb));
  else
    v_denied := v_denied || 'results'::text;
  end if;

  -- allergies and conditions
  if v_lead or private.can_staff_read_clinical(p_patient, 'medical_history'::public.care_access_category) then
    v_sections := v_sections || array['allergies','conditions'];
    v_out := v_out || jsonb_build_object(
      'allergies', coalesce((select jsonb_agg(jsonb_build_object('allergen', a.allergen, 'reaction', a.reaction, 'severity', a.severity))
                 from public.patient_allergies a where a.patient_id = p_patient), '[]'::jsonb),
      'conditions', coalesce((select jsonb_agg(jsonb_build_object('condition_name', c.condition_name, 'status', c.status, 'severity', c.severity))
                 from public.patient_conditions c where c.patient_id = p_patient and c.status <> 'resolved'), '[]'::jsonb));
  else
    v_denied := v_denied || array['allergies','conditions'];
  end if;

  -- no section readable means no tie, no break-glass and no support view
  if cardinality(v_sections) = 0 then
    perform private.s35_audit_read(p_patient, array['summary'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;

  -- care circle: presence only, no identities
  v_sections := v_sections || 'care_circle_presence'::text;
  v_out := v_out || jsonb_build_object('care_circle', jsonb_build_object(
    'active_members', (select count(*) from public.care_circle_members m
                        where m.patient_id = p_patient and m.state = 'active' and (m.expires_at is null or m.expires_at > now()))));

  select split_part(pr.full_name, ' ', 1) into v_name from public.profiles pr where pr.id = p_patient;
  perform private.s35_audit_read(p_patient, array['summary'] || v_sections, p_reason, 'success');
  return jsonb_build_object('status', case when cardinality(v_denied) = 0 then 'ok' else 'partial' end,
                            'denied', to_jsonb(v_denied), 'patient_first_name', v_name) || v_out;
end;
$$;

-- "My lead patients": the people I lead, with the few numbers that tell me who needs me.
-- Every row is a patient I lead, which is itself the tie (INV-12), so no further category gate applies to the few numbers shown.
create or replace function public.my_lead_patients()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rows jsonb := '[]'::jsonb;
  r record;
  v_item jsonb;
begin
  if v_uid is null or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  for r in
    select la.patient_id, split_part(pr.full_name, ' ', 1) as first_name
      from public.lead_assignments la join public.profiles pr on pr.id = la.patient_id
     where la.clinician_id = v_uid and la.state = 'active'
     order by la.started_at limit 200
  loop
    -- one audit row per patient per day, not one per page load: a lead list refreshed all day is one access, and a
    -- 200-patient list would otherwise write 200 rows every time it is opened
    if not exists (select 1 from public.audit_log al
                    where al.actor_id = v_uid and al.subject_patient_id = r.patient_id and al.action = 'staff.chart_read'
                      and al.event -> 'sections' ? 'lead_list' and al.created_at > now() - interval '24 hours') then
      perform private.s35_audit_read(r.patient_id, array['lead_list'], 'Viewing my lead patient list', 'success');
    end if;
    v_item := jsonb_build_object(
      'patient_id', r.patient_id,
      'first_name', r.first_name,
      'last_bp', (select jsonb_build_object('systolic', o.systolic, 'diastolic', o.diastolic, 'measured_at', o.measured_at)
                    from public.observations o where o.patient_id = r.patient_id and o.systolic is not null
                   order by o.measured_at desc limit 1),
      'adherence_percent', (private.weekly_adherence(r.patient_id) ->> 'percent')::int,
      'pending_proposals', (select count(*) from public.care_plan_changes c where c.patient_id = r.patient_id and c.state in ('proposed','signed')),
      'due_tasks', (select count(*) from public.clinical_tasks t where t.patient_id = r.patient_id
                      and t.state in ('offered_to_lead','open','claimed') and t.due_at <= now() + interval '24 hours'));
    v_rows := v_rows || v_item;
  end loop;
  return v_rows;
end;
$$;

-- anon executes through PUBLIC, not through anon (see feedback_supabase_anon_execute_gotcha)
revoke all on function public.clinician_patient_summary(uuid, text) from public, anon;
revoke all on function public.my_lead_patients() from public, anon;
grant execute on function public.clinician_patient_summary(uuid, text) to authenticated;
grant execute on function public.my_lead_patients() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.clinician_patient_summary(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_lead_patients()', 'EXECUTE') then
    raise exception 'S35: anon can execute a clinician read';
  end if;
  if not has_function_privilege('authenticated', 'public.clinician_patient_summary(uuid,text)', 'EXECUTE') then
    raise exception 'S35: authenticated cannot execute clinician_patient_summary';
  end if;
end $$;
