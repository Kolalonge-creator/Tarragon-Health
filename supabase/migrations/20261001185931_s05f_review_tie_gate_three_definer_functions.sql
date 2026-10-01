-- S05f review follow-up: three SECURITY DEFINER functions still handed org staff clinical data or changed it with only an
-- organisation-membership check, bypassing the tie (INV-12) and the audit row (INV-10) that the closed tables now enforce:
--   * consultation_prep_bundle: conditions, allergies, vitals, medications, results and prior notes of any consultation in the org.
--   * search_patient_record: free-text search across a patient's conditions, allergies, medications, results, documents and imaging.
--   * clear_vitals_validation_flag: sets a vitals reading's validation state.
-- Found by the review of the S05f series (a pg_proc scan of public SECURITY DEFINER functions granted to authenticated that read any of
-- the ten tables). consultation_prep_bundle is the only one with an application caller (the clinician video-visit screen, which already
-- surfaces an RPC error); the other two have none. Each now requires the tie (search also admits the patient, a medical-history
-- caregiver grant and an active support-view session) and the two readers write an audit row on success. A refusal raises (as before),
-- so a denial is not itself audited by the database (a raise rolls its own audit row back; the app layer logs denials separately).
-- Left as is on purpose: aggregate and operational functions (analytics_*, rpm_sla_metrics, device_connection_data_quality) return no
-- individual's clinical values; pharmacist_order_* are scoped to the pharmacist's own order; emergency_card_by_token is the patient's
-- own token-gated card.

CREATE OR REPLACE FUNCTION public.consultation_prep_bundle(p_consultation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_consult record;
  v_result  jsonb;
begin
  select * into v_consult from public.video_consultations where id = p_consultation_id;
  if v_consult.id is null then
    raise exception 'consultation not found';
  end if;
  -- INV-10, INV-12: the bundle carries conditions, allergies, vitals, medications, results and prior notes, so it is gated like the
  -- chart: care-team staff TIED to the patient (care team, a routed escalation or alert, a live appointment, the hosted consultation, an
  -- assigned referral), never any member of the organisation. One refusal for "not staff" and "not tied". A successful read is audited.
  if not private.is_org_staff(v_consult.organisation_id)
     or not private.clinician_has_patient_access(v_consult.patient_id) then
    raise exception 'only care-team staff tied to this patient can view a consultation prep bundle'
      using errcode = '42501';
  end if;
  perform private.audit_chart_read(v_consult.patient_id, array['consultation_prep_bundle'],
                                   'Consultation prep bundle opened', 'success');

  select jsonb_build_object(
    'reason', jsonb_build_object(
      'patient_prep_notes', v_consult.patient_prep_notes,
      'request_note', (
        select vr.note from public.video_visit_requests vr
        where vr.video_consultation_id = p_consultation_id
        limit 1
      )
    ),
    'active_conditions', (
      select coalesce(jsonb_agg(row_to_json(c) order by c.date_identified desc nulls last), '[]'::jsonb) from (
        select condition_name, status, severity, date_identified
        from public.patient_conditions
        where patient_id = v_consult.patient_id
          and status in ('suspected', 'under_investigation', 'active', 'controlled', 'uncontrolled')
      ) c
    ),
    'allergies', (
      select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb) from (
        select allergen, reaction, severity
        from public.patient_allergies
        where patient_id = v_consult.patient_id
      ) a
    ),
    'recent_vitals', (
      select coalesce(jsonb_agg(row_to_json(v) order by v.taken_at desc), '[]'::jsonb) from (
        select vital_type, systolic, diastolic, glucose_mmol_l, weight_kg, pulse_bpm, temperature_c, spo2_pct, taken_at
        from public.vitals_readings
        where patient_id = v_consult.patient_id
        order by taken_at desc
        limit 5
      ) v
    ),
    'active_medications', (
      select coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb) from (
        select drug_name, dose, frequency, refill_date
        from public.medications
        where patient_id = v_consult.patient_id and is_active
        order by drug_name
      ) m
    ),
    'recent_results', (
      select coalesce(jsonb_agg(row_to_json(r) order by r.created_at desc), '[]'::jsonb) from (
        select result_status, result_summary, abnormal_flags, created_at
        from public.screening_results
        where patient_id = v_consult.patient_id
        order by created_at desc
        limit 5
      ) r
    ),
    'care_gaps', (
      select coalesce(jsonb_agg(row_to_json(g)), '[]'::jsonb) from (
        select gap_type, condition_or_type, opened_at
        from public.patient_care_gaps
        where patient_id = v_consult.patient_id
      ) g
    ),
    'active_care_plans', (
      select coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) from (
        select condition, status, created_at
        from public.care_plans
        where patient_id = v_consult.patient_id and status = 'active'
      ) c
    ),
    'previous_consultations', (
      select coalesce(jsonb_agg(row_to_json(p) order by p.encounter_date desc), '[]'::jsonb) from (
        select encounter_type, encounter_date, diagnosis, outcome
        from public.clinical_encounter_notes
        where patient_id = v_consult.patient_id
          and status = 'finalized'
          and (video_consultation_id is null or video_consultation_id <> p_consultation_id)
        order by encounter_date desc
        limit 5
      ) p
    )
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.search_patient_record(p_patient uuid, p_query text)
 RETURNS TABLE(table_name text, record_id uuid, title text, snippet text, occurred_at timestamp with time zone, rank real)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
  v_ts  tsquery;
begin
  select p.organisation_id into v_org from public.profiles p where p.id = p_patient;
  if v_org is null then
    raise exception 'unknown patient';
  end if;

  -- INV-10, INV-12: the patient, a caregiver with the medical-history grant, or staff TIED to the patient (or in an active support-view
  -- session). Any org staff member used to be admitted. A staff search is audited with its basis.
  if not (
    p_patient = (select auth.uid())
    or private.can_read_clinical(p_patient, 'medical_history'::public.care_access_category)
    or (private.is_org_staff(v_org)
        and (private.clinician_has_patient_access(p_patient) or private.can_support_view(p_patient)))
  ) then
    raise exception 'insufficient_privilege: not authorised to search this patient''s record';
  end if;
  if p_patient is distinct from (select auth.uid())
     and not private.can_read_clinical(p_patient, 'medical_history'::public.care_access_category) then
    perform private.audit_chart_read(p_patient, array['record_search'], 'Patient record search', 'success');
  end if;

  if p_query is null or length(btrim(p_query)) = 0 then
    return;
  end if;

  v_ts := websearch_to_tsquery('english', p_query);

  return query
  select
    'patient_conditions'::text as table_name, c.id as record_id, c.condition_name as title,
    coalesce(nullif(c.current_treatment, ''), c.supporting_evidence) as snippet,
    coalesce(c.last_reviewed_at, c.date_identified::timestamptz, c.created_at) as occurred_at,
    ts_rank(c.search_vector, v_ts) as rank
    from public.patient_conditions c
    where c.patient_id = p_patient and c.search_vector @@ v_ts
  union all
  select
    'patient_allergies'::text as table_name, a.id as record_id, a.allergen as title, a.reaction as snippet,
    a.noted_at as occurred_at, ts_rank(a.search_vector, v_ts) as rank
    from public.patient_allergies a
    where a.patient_id = p_patient and a.search_vector @@ v_ts
  union all
  select
    'medications'::text as table_name, m.id as record_id, m.drug_name as title, m.dose as snippet,
    m.created_at as occurred_at, ts_rank(m.search_vector, v_ts) as rank
    from public.medications m
    where m.patient_id = p_patient and m.search_vector @@ v_ts
  union all
  select
    'screening_results'::text as table_name, s.id as record_id, 'Screening result'::text as title,
    s.result_summary as snippet, s.created_at as occurred_at, ts_rank(s.search_vector, v_ts) as rank
    from public.screening_results s
    where s.patient_id = p_patient and s.search_vector @@ v_ts
  union all
  select
    'patient_documents'::text as table_name, d.id as record_id, replace(d.document_type::text, '_', ' ') as title,
    coalesce(d.original_filename, d.note) as snippet, d.created_at as occurred_at,
    ts_rank(d.search_vector, v_ts) as rank
    from public.patient_documents d
    where d.patient_id = p_patient and d.search_vector @@ v_ts
  union all
  select
    'imaging_reports'::text as table_name, r.id as record_id, replace(r.modality::text, '_', ' ') as title,
    coalesce(r.impression, r.findings) as snippet, r.created_at as occurred_at,
    ts_rank(r.search_vector, v_ts) as rank
    from public.imaging_reports r
    where r.patient_id = p_patient and r.search_vector @@ v_ts
  order by rank desc
  limit 50;
end;
$function$;

CREATE OR REPLACE FUNCTION public.clear_vitals_validation_flag(p_reading_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
  v_patient uuid;
begin
  select organisation_id, patient_id into v_org, v_patient from public.vitals_readings where id = p_reading_id;
  -- INV-12: reviewing (and so changing the validation state of) a reading needs a tie to the patient, not just membership of the
  -- organisation. One answer for "no such reading" and "not yours", so existence is not disclosed to an untied caller.
  if v_org is null or not private.is_org_staff(v_org) or not private.clinician_has_patient_access(v_patient) then
    raise exception 'Not authorised to review this reading' using errcode = 'insufficient_privilege';
  end if;

  update public.vitals_readings
    set validation_status = 'valid',
        validated_by = (select id from public.clinical_staff where profile_id = (select auth.uid())),
        validated_at = now()
  where id = p_reading_id;
end;
$function$;

revoke all on function public.consultation_prep_bundle(uuid) from public, anon;
revoke all on function public.search_patient_record(uuid, text) from public, anon;
revoke all on function public.clear_vitals_validation_flag(uuid) from public, anon;
grant execute on function public.consultation_prep_bundle(uuid) to authenticated;
grant execute on function public.search_patient_record(uuid, text) to authenticated;
grant execute on function public.clear_vitals_validation_flag(uuid) to authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array['public.consultation_prep_bundle(uuid)', 'public.search_patient_record(uuid,text)', 'public.clear_vitals_validation_flag(uuid)'] loop
    if not (select prosecdef from pg_proc where oid = v_fn::regprocedure) then
      raise exception 'S05f assertion: % is not SECURITY DEFINER', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'S05f assertion: anon can execute %', v_fn;
    end if;
    if pg_get_functiondef(v_fn::regprocedure) not ilike '%clinician_has_patient_access%' then
      raise exception 'S05f assertion: % does not check the tie', v_fn;
    end if;
  end loop;
end $$;
