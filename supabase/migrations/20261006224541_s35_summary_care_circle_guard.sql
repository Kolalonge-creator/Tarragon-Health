-- S35 follow-up: clinician_patient_summary no longer fails when public.care_circle_members does not exist.
--
-- CI (Supabase migration replay) found that the function body names care_circle_members, a table that comes from the Care
-- Circle build (S29) and is not on main-dev yet, so a fresh replay failed the moment the function ran. Production has the
-- table and behaves identically. The care circle count now reads the table only when it exists, and is 0 otherwise.
-- Same signature, same grants (create or replace keeps both); nothing else in the function changes.

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
  v_circle integer := 0;
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

  -- care circle: presence only, no identities. The table arrives with the Care Circle build; until it exists (a fresh
  -- replay of main-dev) the count is 0, so this function never fails on a missing relation.
  v_sections := v_sections || 'care_circle_presence'::text;
  if to_regclass('public.care_circle_members') is not null then
    execute 'select count(*) from public.care_circle_members m where m.patient_id = $1 and m.state = ''active'' and (m.expires_at is null or m.expires_at > now())'
      into v_circle using p_patient;
  end if;
  v_out := v_out || jsonb_build_object('care_circle', jsonb_build_object('active_members', v_circle));

  select split_part(pr.full_name, ' ', 1) into v_name from public.profiles pr where pr.id = p_patient;
  perform private.s35_audit_read(p_patient, array['summary'] || v_sections, p_reason, 'success');
  return jsonb_build_object('status', case when cardinality(v_denied) = 0 then 'ok' else 'partial' end,
                            'denied', to_jsonb(v_denied), 'patient_first_name', v_name) || v_out;
end;
$$;


-- the function body must keep its guards (the proof checks behaviour; this keeps the grants honest)
do $$
begin
  if has_function_privilege('anon', 'public.clinician_patient_summary(uuid,text)', 'EXECUTE') then
    raise exception 'S35: anon can execute clinician_patient_summary';
  end if;
  if not has_function_privilege('authenticated', 'public.clinician_patient_summary(uuid,text)', 'EXECUTE') then
    raise exception 'S35: authenticated lost execute on clinician_patient_summary';
  end if;
end $$;
