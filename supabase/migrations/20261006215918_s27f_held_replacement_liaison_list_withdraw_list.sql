-- S27f: three follow-ups decided 2026-10-06.
--  1. A lab can send a replacement for a result that is still HELD. The held one is marked replaced at once, its review task is closed,
--     it can no longer be released or withheld (lab_result_replaced), and the replacement goes through the same gate. The reviewer sees
--     the correction kind and reason. If the earlier result was never shown to the patient, only the normal release notice is sent.
--  2. The Lab Liaison sees a neutral list of the files they uploaded: "waiting for review" or "reviewed", never values, reasons or state.
--  3. A senior clinician can list a tied patient's released results (an audited read) to withdraw one.
-- Live rows in lab_results before this migration: 0.

-- 1. -------------------------------------------------------------------------------------------------------------------
create or replace function private.guard_lab_result() returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_bad integer; v_items integer;
begin
  if tg_op = 'INSERT' then
    if new.release_state not in ('awaiting_review', 'clinician_disclosure_required') then raise exception 'lab_result_must_start_held' using errcode = '42501'; end if;
    return new;
  end if;

  -- immutable facts
  if new.patient_id is distinct from old.patient_id or new.organisation_id is distinct from old.organisation_id
     or new.lab_order_id is distinct from old.lab_order_id or new.panel_version_id is distinct from old.panel_version_id
     or new.source is distinct from old.source or new.submitted_by is distinct from old.submitted_by
     or new.document_id is distinct from old.document_id or new.received_at is distinct from old.received_at
     or new.corrects_result_id is distinct from old.corrects_result_id or new.correction_kind is distinct from old.correction_kind
     or new.correction_reason is distinct from old.correction_reason then
    raise exception 'lab_result_immutable' using errcode = '42501';
  end if;
  new.updated_at := now();

  if new.release_state = old.release_state then
    -- the only thing that may change without a state change is a supersede link, set once
    if new.superseded_by is distinct from old.superseded_by and old.superseded_by is not null then
      raise exception 'lab_result_immutable' using errcode = '42501';
    end if;
    -- a withdrawal is recorded once, on a released result, with a reason and the clinician who did it
    if new.withdrawn_at is distinct from old.withdrawn_at then
      if old.withdrawn_at is not null or old.release_state <> 'released' or new.withdrawn_by is null or coalesce(btrim(new.withdrawn_reason), '') = '' then
        raise exception 'lab_result_withdraw_invalid' using errcode = '42501';
      end if;
    elsif new.withdrawn_by is distinct from old.withdrawn_by or new.withdrawn_reason is distinct from old.withdrawn_reason then
      raise exception 'lab_result_immutable' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.release_state in ('released', 'withheld') then
    raise exception 'lab_result_final' using errcode = '42501';
  end if;
  -- a held result a lab has replaced can no longer be released or withheld: the replacement is the current one (S27f)
  if old.superseded_by is not null then
    raise exception 'lab_result_replaced' using errcode = '42501';
  end if;

  if new.release_state = 'released' then
    select count(*), count(*) filter (where flag not in ('normal', 'negative') or sensitive_positive)
      into v_items, v_bad from public.lab_result_items where lab_result_id = new.id;
    if old.release_state = 'clinician_disclosure_required' then
      if new.reviewed_by is null or not new.disclosure_attested or new.disclosure_method is null then
        raise exception 'lab_result_disclosure_needs_clinician' using errcode = '42501';
      end if;
      new.release_reason := 'disclosure_recorded';
    elsif new.release_reason = 'RES-001' then
      -- automatic release: only a complete, all-normal result
      if v_items = 0 or v_bad > 0 or new.source <> 'portal_entry' or old.release_reason is distinct from 'RES-001' then
        raise exception 'lab_result_not_auto_releasable' using errcode = '42501';
      end if;
    else
      if new.reviewed_by is null then raise exception 'lab_result_release_needs_clinician' using errcode = '42501'; end if;
      new.release_reason := 'clinician_review';
    end if;
    new.released_at := coalesce(new.released_at, now());
  elsif new.release_state = 'withheld' then
    if new.reviewed_by is null or coalesce(btrim(new.withheld_reason), '') = '' then
      raise exception 'lab_result_withhold_needs_reason' using errcode = '42501';
    end if;
  else
    raise exception 'lab_result_bad_transition' using errcode = '42501';
  end if;
  return new;
end;
$$;



create or replace function private.submit_lab_result(
  p_patient uuid, p_order uuid, p_panel_code text, p_items jsonb, p_file jsonb, p_kind text, p_actor uuid, p_partner uuid,
  p_corrects uuid default null, p_correction_kind text default null, p_correction_reason text default null
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

  -- a correction names the result it replaces, says what kind of change it is and why; the old one must belong to this patient,
  -- be released and not already replaced. The correction then goes through the same gate as any new result (S27d).
  if p_corrects is not null then
    if p_correction_kind not in ('corrected', 'amended', 'appended') or coalesce(btrim(p_correction_reason), '') = '' then
      raise exception 'lab_correction_needs_kind_and_reason' using errcode = '22023';
    end if;
    if not exists (select 1 from public.lab_results r where r.id = p_corrects and r.patient_id = p_patient
                    and r.release_state in ('released', 'awaiting_review', 'clinician_disclosure_required')
                    and r.superseded_by is null and r.withdrawn_at is null) then
      raise exception 'lab_correction_target_invalid' using errcode = '22023';
    end if;
  end if;

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

  -- Ranges that no CMO has signed never auto-release anything (INV-14): the result is held for a clinician instead.
  if v_state = 'released' and not private.lab_panels_signed() then
    v_state := 'awaiting_review'; v_reason := 'ranges_not_signed'; v_task := 'routine_result_review';
  end if;

  -- always inserted held; the guard allows the one automatic step below
  insert into public.lab_results (id, organisation_id, patient_id, lab_order_id, partner_id, panel_code, panel_version_id, source,
                                  submitted_by_kind, submitted_by, release_state, release_reason, document_id, is_test,
                                  corrects_result_id, correction_kind, correction_reason)
  values (v_id, pr.organisation_id, p_patient, p_order, p_partner, case when v_has_items then p_panel_code end,
          case when v_has_items then v_ver.id end, v_source, p_kind, p_actor,
          case when v_state = 'clinician_disclosure_required' then v_state else 'awaiting_review' end, v_reason, v_file, pr.is_test,
          p_corrects, p_correction_kind, btrim(p_correction_reason));

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

create or replace function private.lab_apply_correction() returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.lab_results set superseded_by = new.id where id = new.corrects_result_id and superseded_by is null;
  -- "something was updated" only if the patient had already been shown the earlier result; otherwise the release notice is the right one
  if exists (select 1 from public.lab_results o where o.id = new.corrects_result_id and o.release_state = 'released') then
    perform private.lab_notify(new.patient_id, new.organisation_id, 'lab_result_corrected', jsonb_build_object('lab_result_id', new.id));
  end if;
  perform private.log_audit('lab_result.replaced', 'lab_results', new.corrects_result_id,
    jsonb_build_object('by', new.id, 'kind', new.correction_kind));
  return null;
end;
$$;

create or replace function public.lab_result_for_review(p_result uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype; f public.lab_result_files%rowtype;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = '22023'; end if;
  r := private.lab_review_actor(p_result, false);
  if r.id is null then return jsonb_build_object('error', 'not_permitted'); end if;
  perform private.audit_chart_read(r.patient_id, array['lab_results'], p_reason, 'success');
  select * into f from public.lab_result_files where id = r.document_id;
  return jsonb_build_object(
    'lab_result_id', r.id, 'patient_id', r.patient_id, 'release_state', r.release_state, 'release_reason', r.release_reason,
    'panel_code', r.panel_code, 'received_at', r.received_at, 'submitted_by_kind', r.submitted_by_kind,
    'correction_kind', r.correction_kind, 'correction_reason', r.correction_reason, 'replaced', r.superseded_by is not null,
    'file_path', f.file_path,
    'items', coalesce((select jsonb_agg(jsonb_build_object('analyte_code', i.analyte_code, 'value_numeric', i.value_numeric, 'value_text', i.value_text,
        'unit', i.unit, 'ref_low', i.ref_low, 'ref_high', i.ref_high, 'flag', i.flag, 'sensitive_positive', i.sensitive_positive) order by i.analyte_code)
        from public.lab_result_items i where i.lab_result_id = r.id), '[]'::jsonb));
end;
$$;


-- a held result that gets a replacement is marked replaced when the replacement arrives
create function private.lab_supersede_held() returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.lab_results set superseded_by = new.id
   where id = new.corrects_result_id and release_state <> 'released' and superseded_by is null;
  if found then perform private.lab_close_tasks(new.corrects_result_id, null, 'replaced by a corrected result'); end if;
  return null;
end;
$$;
revoke all on function private.lab_supersede_held() from public, anon, authenticated;
create trigger lab_results_supersede_held after insert on public.lab_results
  for each row when (new.corrects_result_id is not null) execute function private.lab_supersede_held();

-- the review queue lists only results that are still current
create or replace function public.lab_results_review_queue() returns table (lab_result_id uuid, patient_id uuid, release_state text, release_reason text, received_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.patient_id, r.release_state, r.release_reason, r.received_at
    from public.lab_results r
   where r.release_state in ('awaiting_review', 'clinician_disclosure_required') and r.superseded_by is null
     and exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'clinician')
     and private.clinician_has_patient_access(r.patient_id)
   order by (r.release_state = 'clinician_disclosure_required') desc, r.received_at;
$$;

-- 2. -------------------------------------------------------------------------------------------------------------------
create function public.liaison_recent_uploads() returns table (lab_result_id uuid, received_at timestamptz, order_number text, patient_number text, file_name text, status text)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.received_at, o.order_number, p.patient_number, f.original_filename,
         -- two neutral words only: the liaison never learns values, reasons or whether anything was abnormal or withheld
         case when r.release_state in ('awaiting_review', 'clinician_disclosure_required') and r.superseded_by is null then 'waiting_for_review' else 'reviewed' end
    from public.lab_results r
    join public.profiles p on p.id = r.patient_id
    left join public.lab_orders o on o.id = r.lab_order_id
    left join public.lab_result_files f on f.id = r.document_id
   where r.submitted_by = (select auth.uid()) and r.submitted_by_kind = 'tarragon_team'
     and exists (select 1 from public.profiles me where me.id = (select auth.uid()) and me.role = 'lab_liaison' and me.organisation_id = r.organisation_id)
     and r.received_at > now() - interval '30 days'
   order by r.received_at desc
   limit 100;
$$;
revoke all on function public.liaison_recent_uploads() from public, anon;
grant execute on function public.liaison_recent_uploads() to authenticated;

-- 3. -------------------------------------------------------------------------------------------------------------------
create function public.patient_released_lab_results(p_patient uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v uuid := (select auth.uid());
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = v and role = 'clinician') or not private.clinician_is_eligible(v) then
    raise exception 'This action is for clinicians' using errcode = '42501';
  end if;
  if not private.clinician_has_patient_access(p_patient) then
    perform private.audit_chart_read(p_patient, array['lab_results'], 'released lab results', 'denied');
    return jsonb_build_object('error', 'not_permitted');
  end if;
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = v and cs.active and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')) then
    return jsonb_build_object('error', 'senior_only');
  end if;
  perform private.audit_chart_read(p_patient, array['lab_results'], p_reason, 'success');
  return jsonb_build_object('results', coalesce((
    select jsonb_agg(jsonb_build_object(
             'lab_result_id', r.id, 'received_at', r.received_at, 'released_at', r.released_at, 'panel_code', r.panel_code,
             'order_number', o.order_number, 'submitted_by_kind', r.submitted_by_kind, 'withdrawn', r.withdrawn_at is not null,
             'replaced', r.superseded_by is not null,
             'abnormal_count', (select count(*) from public.lab_result_items i where i.lab_result_id = r.id and i.flag not in ('normal', 'negative')),
             'item_count', (select count(*) from public.lab_result_items i where i.lab_result_id = r.id)) order by r.released_at desc)
      from public.lab_results r left join public.lab_orders o on o.id = r.lab_order_id
     where r.patient_id = p_patient and r.release_state = 'released'), '[]'::jsonb));
end;
$$;
revoke all on function public.patient_released_lab_results(uuid, text) from public, anon;
grant execute on function public.patient_released_lab_results(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.liaison_recent_uploads()', 'execute') or has_function_privilege('anon', 'public.patient_released_lab_results(uuid, text)', 'execute') then
    raise exception 'S27f self-check: anon can execute a lab function';
  end if;
end $$;
