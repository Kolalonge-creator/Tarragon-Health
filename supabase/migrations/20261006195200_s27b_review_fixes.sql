-- S27b: review fixes. (1) a result file path must be inside the patient's own folder; (2) a Free patient's own outside upload
-- no longer creates a doctor task (doctor time is a paid feature; it stays held and the patient is told it is waiting);
-- (3) a withheld own upload is no longer readable through RLS; (4) a Member's upload still creates the review task.
create or replace function private.submit_lab_result(
  p_patient uuid, p_order uuid, p_panel_code text, p_items jsonb, p_file jsonb, p_kind text, p_actor uuid, p_partner uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  pr public.profiles%rowtype;
  v_ver public.lab_panel_versions%rowtype;
  v_class jsonb;
  v_file uuid;
  v_id uuid := gen_random_uuid();
  v_has_items boolean := p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0;
  v_source text;
  v_state text;
  v_reason text;
  v_task text;
  it jsonb;
  o public.lab_orders%rowtype;
begin
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'lab_patient_not_found' using errcode = '22023'; end if;

  if p_order is not null then
    select * into o from public.lab_orders where id = p_order and patient_id = p_patient;
    if not found then raise exception 'lab_order_not_found' using errcode = '22023'; end if;
    if o.status in ('pending_payment', 'cancelled') then raise exception 'lab_order_not_payable_state' using errcode = '22023'; end if;
  end if;

  if p_file is not null then
    -- a file path must sit in this patient's own folder: nobody can attach another patient's file to a result
    if (p_file ->> 'file_path') is null or (p_file ->> 'file_path') not like p_patient::text || '/%' or (p_file ->> 'file_path') like '%..%' then
      raise exception 'lab_file_path_invalid' using errcode = '22023';
    end if;
    insert into public.lab_result_files (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, uploaded_by, is_test)
    values (pr.organisation_id, p_patient, p_file ->> 'file_path', p_file ->> 'original_filename', p_file ->> 'mime_type',
            (p_file ->> 'file_size_bytes')::bigint, p_actor, pr.is_test)
    returning id into v_file;
  end if;

  if v_has_items then
    if p_panel_code is null then raise exception 'lab_panel_required' using errcode = '22023'; end if;
    select * into v_ver from public.lab_panel_versions where panel_code = p_panel_code and is_active;
    if not found then raise exception 'lab_unknown_panel' using errcode = '22023'; end if;
    v_class := private.classify_lab_result(v_ver.id, p_items);
    v_source := 'portal_entry';
    v_state := v_class ->> 'release_state'; v_reason := v_class ->> 'reason'; v_task := v_class ->> 'task';
  else
    if v_file is null then raise exception 'lab_nothing_to_record' using errcode = '22023'; end if;
    v_source := 'pdf_upload';
    v_state := 'awaiting_review'; v_reason := 'pdf_only'; v_task := 'routine_result_review';
  end if;

  -- always inserted held; the guard allows the one automatic step below
  insert into public.lab_results (id, organisation_id, patient_id, lab_order_id, partner_id, panel_code, panel_version_id, source,
                                  submitted_by_kind, submitted_by, release_state, release_reason, document_id, is_test)
  values (v_id, pr.organisation_id, p_patient, p_order, p_partner, case when v_has_items then p_panel_code end,
          case when v_has_items then v_ver.id end, v_source, p_kind, p_actor,
          case when v_state = 'clinician_disclosure_required' then v_state else 'awaiting_review' end, v_reason, v_file, pr.is_test);

  if v_has_items then
    for it in select * from jsonb_array_elements(v_class -> 'items') loop
      insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit,
                                           ref_low, ref_high, flag, sensitive_positive, is_test)
      values (v_id, pr.organisation_id, p_patient, it ->> 'analyte_code', (it ->> 'value_numeric')::numeric, it ->> 'value_text', it ->> 'unit',
              (it ->> 'ref_low')::numeric, (it ->> 'ref_high')::numeric, it ->> 'flag', (it ->> 'sensitive_positive')::boolean, pr.is_test);
    end loop;
  end if;

  -- the one automatic step; the guard re-checks every item before it allows it
  if v_state = 'released' then
    update public.lab_results set release_state = 'released', release_reason = 'RES-001' where id = v_id;
  end if;

  if p_order is not null then
    -- 'resulted' is what the older triggers act on (timeline, rewards), so a held result moves the order only to 'processing'
    update public.lab_orders
       set panel_code = coalesce(panel_code, case when v_has_items then p_panel_code end),
           status = case when status in ('resulted', 'cancelled') then status
                         when v_state = 'released' then 'resulted'::public.lab_order_status
                         else 'processing'::public.lab_order_status end,
           resulted_at = case when v_state = 'released' then coalesce(resulted_at, now()) else resulted_at end
     where id = p_order;
  end if;

  -- Tarragon Free consumes no doctor time: a patient's own outside upload on no order reaches a clinician only for a Member.
  -- It stays held either way and is never visible as reviewed.
  if v_task is not null and not (p_kind = 'patient' and p_order is null and not private.patient_is_member(p_patient)) then
    perform private.create_clinical_task(p_patient, v_task, null, 'lab_result:' || v_id);
  end if;

  perform private.emit_domain_event('lab_result.received', pr.organisation_id, jsonb_build_object('lab_result_id', v_id),
    'lab_result_received:' || v_id, p_patient, 'lab_result', v_id);
  perform private.log_audit('lab_result.submitted', 'lab_results', v_id,
    jsonb_build_object('kind', p_kind, 'source', v_source, 'state', v_state, 'reason', v_reason));

  if v_state = 'released' then
    perform private.lab_notify(p_patient, pr.organisation_id, 'lab_result_ready', jsonb_build_object('lab_result_id', v_id));
    perform private.emit_domain_event('lab_result.released', pr.organisation_id, jsonb_build_object('lab_result_id', v_id),
      'lab_result_released:' || v_id, p_patient, 'lab_result', v_id);
    perform private.log_audit('lab_result.released', 'lab_results', v_id, jsonb_build_object('reason', 'RES-001'));
  end if;

  return jsonb_build_object('lab_result_id', v_id, 'release_state', v_state, 'reason', v_reason);
end;
$$;
revoke all on function private.submit_lab_result(uuid, uuid, text, jsonb, jsonb, text, uuid, uuid) from public, anon, authenticated;

drop policy lab_results_patient_read on public.lab_results;
create policy lab_results_patient_read on public.lab_results for select to authenticated
  using (patient_id = (select auth.uid()) and (release_state = 'released' or (submitted_by_kind = 'patient' and release_state <> 'withheld')));
