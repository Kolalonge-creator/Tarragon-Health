alter table public.video_consultations
  add column patient_prep_notes text,
  add column patient_prep_submitted_at timestamptz;

comment on column public.video_consultations.patient_prep_notes is
  'Consultation System §9.4 -- patient-submitted reason/symptoms ahead of the visit, via submit_consultation_prep(). Separate from video_visit_requests.note (captured at booking time); this can be added or edited any time before the visit.';

create or replace function public.submit_consultation_prep(p_consultation_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  update public.video_consultations
    set patient_prep_notes = nullif(btrim(coalesce(p_notes, '')), ''),
        patient_prep_submitted_at = now()
    where id = p_consultation_id
      and patient_id = v_uid
      and status = 'scheduled';

  if not found then
    raise exception 'consultation not found, not yours, or no longer scheduled'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.consultation_prep_bundle(p_consultation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_consult record;
  v_result  jsonb;
begin
  select * into v_consult from public.video_consultations where id = p_consultation_id;
  if v_consult.id is null then
    raise exception 'consultation not found';
  end if;
  if not private.is_org_staff(v_consult.organisation_id) then
    raise exception 'only care-team staff can view a consultation prep bundle'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'reason', jsonb_build_object(
      'patient_prep_notes', v_consult.patient_prep_notes,
      'request_note', (
        select vr.note from public.video_visit_requests vr
        where vr.video_consultation_id = p_consultation_id
        limit 1
      )
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
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.consultation_prep_bundle(uuid) is
  'Consultation System §9.5 provider preparation: reason, recent vitals, active medications, recent results, and open care gaps for the patient in one read-only staff-gated call. A deterministic read model, not a new source of truth -- distinct from case_briefs (AI-drafted narrative).';

revoke execute on function public.submit_consultation_prep(uuid, text) from public, anon;
revoke execute on function public.consultation_prep_bundle(uuid) from public, anon;
grant execute on function public.submit_consultation_prep(uuid, text) to authenticated;
grant execute on function public.consultation_prep_bundle(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.submit_consultation_prep(uuid, text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.consultation_prep_bundle(uuid)', 'EXECUTE')
  then
    raise exception 'anon must not execute any of the new video-consultation RPCs';
  end if;
  raise notice 'PASS: video_consultations prep RPCs present, anon denied';
end $$;
