-- S05 part 2 of 3: the audited clinical read functions (INV-10, OQ-03) for the health record.
-- Design: docs/design/S05.md.
--
-- Counted first (live, 2026-10-01): 4 audited-read functions existed (all S02 identity/consent/lab-document). Direct staff reads of the
-- health-record tables are used in about 100 call sites (inventory in docs/design/S05.md section 5), so this part ADDS the audited path
-- and part 3 closes the direct path only where no caller remains. Nothing here changes an existing policy.
--
-- What this adds:
--   * private.audit_chart_read(): one audit_log row per chart read, carrying the sections asked for and the result (success or denied).
--   * public.read_patient_chart_audited(patient, sections[], reason): one call, many sections, each gated by its own care-access
--     category. Gate = private.can_staff_read_clinical (INV-12 tie, or break-glass for that category, or an active support-view
--     session). reproductive_health is not a section here and break-glass never reaches it.
--   * public.open_patient_document_audited(document, reason): returns the storage path after the gate and the audit row; the caller
--     signs the URL server-side. Patients keep their own direct path through the storage policies that already exist.

create or replace function private.audit_chart_read(p_patient uuid, p_sections text[], p_reason text, p_result text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id, ip)
  select pr.organisation_id, (select auth.uid()), 'staff.chart_read', 'patient_chart', pr.id,
         jsonb_build_object('reason', btrim(p_reason), 'sections', to_jsonb(p_sections)),
         btrim(p_reason), p_result, pr.id, private.request_ip()
    from public.profiles pr
   where pr.id = p_patient
  returning id into v_id;
  if v_id is null then
    raise exception 'unknown patient' using errcode = '22023';
  end if;
  return v_id;
end;
$$;
revoke all on function private.audit_chart_read(uuid, text[], text, text) from public, anon, authenticated;

create or replace function public.read_patient_chart_audited(p_patient uuid, p_sections text[], p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_page constant integer := 500;                     -- technical page size, not a clinical value
  v_known constant text[] := array['vitals','symptoms','medications','dose_events','prescriptions','conditions','allergies',
                                   'family_history','documents','notes','referrals'];
  v_sec text;
  v_cat public.care_access_category;
  v_allowed text[] := '{}';
  v_denied text[] := '{}';
  v_out jsonb := '{}'::jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if p_sections is null or cardinality(p_sections) = 0 then
    raise exception 'at least one section is required' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_sections) s where s <> all (v_known)) then
    raise exception 'unknown chart section' using errcode = '22023';
  end if;
  -- A patient reads her own record directly, never through the staff path; a refusal raises and writes nothing.
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  foreach v_sec in array (select array_agg(distinct s) from unnest(p_sections) s) loop
    v_cat := case v_sec
      when 'vitals' then 'vitals_readings'
      when 'medications' then 'medications'
      when 'dose_events' then 'medications'
      when 'prescriptions' then 'medications'
      when 'notes' then 'appointments_care_plan'
      when 'referrals' then 'appointments_care_plan'
      else 'medical_history'
    end::public.care_access_category;
    if private.can_staff_read_clinical(p_patient, v_cat) then
      v_allowed := v_allowed || v_sec;
    else
      v_denied := v_denied || v_sec;
    end if;
  end loop;

  if cardinality(v_allowed) = 0 then
    perform private.audit_chart_read(p_patient, v_denied, p_reason, 'denied');
    return jsonb_build_object('sections', '{}'::jsonb, 'denied', to_jsonb(v_denied));
  end if;
  perform private.audit_chart_read(p_patient, v_allowed, p_reason, 'success');
  if cardinality(v_denied) > 0 then
    perform private.audit_chart_read(p_patient, v_denied, p_reason, 'denied');
  end if;

  if 'vitals' = any (v_allowed) then
    v_out := v_out || jsonb_build_object('vitals', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select * from public.observations where patient_id = p_patient order by measured_at desc limit c_page) x), '[]'::jsonb));
  end if;
  if 'symptoms' = any (v_allowed) then
    v_out := v_out || jsonb_build_object('symptoms', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select * from public.symptom_reports where patient_id = p_patient order by reported_at desc limit c_page) x), '[]'::jsonb));
  end if;
  if 'medications' = any (v_allowed) then
    v_out := v_out || jsonb_build_object('medications', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select m.id, m.drug_name, m.dose, m.frequency, m.route, m.instructions, m.is_active, m.source, m.prescriber_name,
             m.rx_number, m.prescription_id, m.schedule_times, m.created_at, m.stopped_at, m.stopped_reason
        from public.medications m where m.patient_id = p_patient order by m.created_at desc limit c_page) x), '[]'::jsonb));
  end if;
  if 'dose_events' = any (v_allowed) then
    v_out := v_out || jsonb_build_object('dose_events', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select * from public.dose_events where patient_id = p_patient order by due_at desc limit c_page) x), '[]'::jsonb));
  end if;
  if 'prescriptions' = any (v_allowed) then
    v_out := v_out || jsonb_build_object('prescriptions', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select * from public.prescriptions where patient_id = p_patient order by created_at desc limit c_page) x), '[]'::jsonb));
  end if;
  if 'conditions' = any (v_allowed) then
    v_out := v_out || jsonb_build_object('conditions', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select * from public.conditions where patient_id = p_patient order by created_at desc limit c_page) x), '[]'::jsonb));
  end if;
  if 'allergies' = any (v_allowed) then
    v_out := v_out || jsonb_build_object('allergies', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select * from public.allergies where patient_id = p_patient order by created_at desc limit c_page) x), '[]'::jsonb));
  end if;
  if 'family_history' = any (v_allowed) then
    v_out := v_out || jsonb_build_object('family_history', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select f.id, f.condition_name, f.relationship, f.relationship_detail, f.age_of_onset_years, f.is_deceased, f.source,
             f.recorded_by, f.notes, f.created_at
        from public.family_history f where f.patient_id = p_patient order by f.created_at desc limit c_page) x), '[]'::jsonb));
  end if;
  if 'documents' = any (v_allowed) then
    v_out := v_out || jsonb_build_object('documents', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select * from public.documents where patient_id = p_patient order by created_at desc limit c_page) x), '[]'::jsonb));
  end if;
  if 'notes' = any (v_allowed) then
    v_out := v_out || jsonb_build_object('notes', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select * from public.notes where patient_id = p_patient order by created_at desc limit c_page) x), '[]'::jsonb));
  end if;
  if 'referrals' = any (v_allowed) then
    v_out := v_out || jsonb_build_object('referrals', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select * from public.clinical_referrals where patient_id = p_patient order by created_at desc limit c_page) x), '[]'::jsonb));
  end if;

  return jsonb_build_object('sections', v_out, 'denied', to_jsonb(v_denied));
end;
$$;

create or replace function public.open_patient_document_audited(p_document uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid;
  v_path text;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select d.patient_id, d.file_path into v_patient, v_path from public.patient_documents d where d.id = p_document;
  if v_patient is null then
    return null;                                       -- unknown document: nothing to audit, nothing to reveal
  end if;
  if not private.can_staff_read_clinical(v_patient, 'medical_history') then
    perform private.audit_denied_read('staff.document_open', 'patient_documents', v_patient, p_reason);
    return null;
  end if;
  perform private.audit_patient_read(v_patient, 'patient_documents', p_document, p_reason, 'staff.document_open');
  return v_path;
end;
$$;

-- EXECUTE: revoke from PUBLIC (where anon inherits it), grant to authenticated only. The gate is inside.
revoke all on function public.read_patient_chart_audited(uuid, text[], text) from public;
revoke all on function public.open_patient_document_audited(uuid, text) from public;
grant execute on function public.read_patient_chart_audited(uuid, text[], text) to authenticated;
grant execute on function public.open_patient_document_audited(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.read_patient_chart_audited(uuid,text[],text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.open_patient_document_audited(uuid,text)', 'EXECUTE') then
    raise exception 'S05 assertion: anon can execute an audited clinical read';
  end if;
  if not has_function_privilege('authenticated', 'public.read_patient_chart_audited(uuid,text[],text)', 'EXECUTE') then
    raise exception 'S05 assertion: authenticated cannot execute the chart read';
  end if;
  if has_function_privilege('authenticated', 'private.audit_chart_read(uuid,text[],text,text)', 'EXECUTE') then
    raise exception 'S05 assertion: audit_chart_read is executable by authenticated';
  end if;
end $$;
