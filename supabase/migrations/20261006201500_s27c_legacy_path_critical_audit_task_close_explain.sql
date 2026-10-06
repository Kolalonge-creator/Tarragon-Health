-- S27c: decisions of 2026-10-06 on OQ-177, OQ-178, OQ-179, OQ-180 and the audit findings.
--  1. OQ-177: the older partner PDF upload (public.lab_partner_upload_result) now writes a HELD lab_results row through
--     private.submit_lab_result instead of a lab_result_documents row, so a partner PDF is never visible to the patient or
--     announced to them before release (INV-03). The old function keeps its name and signature (the worklist still calls it
--     by name in older app builds).
--  2. OQ-180: a CRITICAL value can be released only by a Senior Medical Officer or the CMO.
--  3. Audit: a refused read is now a RETURNED refusal, so the 'denied' audit row commits (a raise rolled it back).
--     release_lab_result, withhold_lab_result, record_lab_disclosure return jsonb {ok:true} or {error:'not_permitted'}.
--  4. OQ-178: release, disclosure and withhold close the linked queue task (completed when the acting clinician holds the
--     claim; cancelled with a reason when nobody has claimed it; a task claimed by someone else is left to them).
--  5. OQ-179: one definition of "may be explained" (private.lab_result_explainable), used by my_lab_results() and exposed
--     to the owner as lab_result_explain_allowed(), so any AI or audio layer asks the database, not a copy of the rule.
-- Live counts before this migration: 0 rows in lab_results, so no data step.

-- 6. The guard also requires that the row was classified RES-001 at insert (complete and all normal): an incomplete result
--    whose items are all normal could otherwise be pushed through by a direct write.
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
     or new.document_id is distinct from old.document_id or new.received_at is distinct from old.received_at then
    raise exception 'lab_result_immutable' using errcode = '42501';
  end if;
  new.updated_at := now();

  if new.release_state = old.release_state then
    -- the only thing that may change without a state change is a supersede link, set once
    if new.superseded_by is distinct from old.superseded_by and old.superseded_by is not null then
      raise exception 'lab_result_immutable' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.release_state in ('released', 'withheld') then
    raise exception 'lab_result_final' using errcode = '42501';
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

-- 1. -------------------------------------------------------------------------------------------------------------------
create or replace function public.lab_partner_upload_result(
  p_order_id uuid, p_file_path text, p_original_filename text, p_mime_type text, p_file_size_bytes bigint, p_note text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare o public.lab_orders%rowtype; v_provider uuid := private.lab_partner_provider(); v jsonb;
begin
  if v_provider is null then raise exception 'This action is for partner labs' using errcode = '42501'; end if;
  select * into o from public.lab_orders where id = p_order_id and provider_id = v_provider;
  if not found then raise exception 'Order not found for this lab' using errcode = '42501'; end if;
  if coalesce(btrim(p_file_path), '') = '' then raise exception 'File path is required' using errcode = '22023'; end if;
  if exists (select 1 from public.lab_results r where r.lab_order_id = p_order_id and r.release_state <> 'withheld' and r.superseded_by is null) then
    raise exception 'lab_result_already_received' using errcode = '22023';
  end if;
  -- a PDF only: held for review; the note is not stored (a held result has no free text a patient could ever see)
  v := private.submit_lab_result(o.patient_id, p_order_id, null, null,
         jsonb_build_object('file_path', p_file_path, 'original_filename', p_original_filename, 'mime_type', p_mime_type, 'file_size_bytes', p_file_size_bytes),
         'partner', (select auth.uid()), v_provider);
  return (v ->> 'lab_result_id')::uuid;
end;
$$;

-- 5. -------------------------------------------------------------------------------------------------------------------
create function private.lab_result_explainable(p_result uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select r.release_state = 'released'
         and r.submitted_by_kind <> 'patient'
         and not exists (select 1 from public.lab_result_items i where i.lab_result_id = r.id and i.sensitive_positive)
    from public.lab_results r where r.id = p_result;
$$;
revoke all on function private.lab_result_explainable(uuid) from public, anon, authenticated;

create function public.lab_result_explain_allowed(p_result uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select private.lab_result_explainable(r.id) from public.lab_results r where r.id = p_result and r.patient_id = (select auth.uid())), false);
$$;
revoke all on function public.lab_result_explain_allowed(uuid) from public, anon;
grant execute on function public.lab_result_explain_allowed(uuid) to authenticated;

create or replace function public.my_lab_results() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by (x ->> 'received_at') desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'lab_result_id', r.id, 'received_at', r.received_at, 'panel_code', r.panel_code, 'own_upload', r.submitted_by_kind = 'patient',
      'status', case r.release_state when 'released' then 'released' when 'withheld' then 'under_review' when 'clinician_disclosure_required' then 'care_team_will_contact' else 'under_review' end,
      'explain_allowed', coalesce(private.lab_result_explainable(r.id), false),
      'has_file', r.document_id is not null and (r.release_state = 'released' or r.submitted_by_kind = 'patient'),
      'items', case when r.release_state = 'released' then coalesce((select jsonb_agg(jsonb_build_object('analyte_code', i.analyte_code, 'value_numeric', i.value_numeric,
          'value_text', i.value_text, 'unit', i.unit, 'ref_low', i.ref_low, 'ref_high', i.ref_high, 'flag', i.flag) order by i.analyte_code)
          from public.lab_result_items i where i.lab_result_id = r.id), '[]'::jsonb) else '[]'::jsonb end) as x
    from public.lab_results r
   where r.patient_id = (select auth.uid()) and r.release_state <> 'withheld'
  ) s;
$$;

-- 3. and 2. -------------------------------------------------------------------------------------------------------------
drop function public.release_lab_result(uuid, text);
drop function public.record_lab_disclosure(uuid, text, boolean, text);
drop function public.withhold_lab_result(uuid, text);
drop function public.lab_result_for_review(uuid, text);
drop function private.lab_review_actor(uuid, boolean);

-- Returns the result row, or a row with a null id when the clinician is not tied (after writing the denied audit row).
-- Raising would roll that audit row back, which is the defect this replaces.
create function private.lab_review_actor(p_result uuid, p_need_senior boolean, p_critical_needs_senior boolean default false)
returns public.lab_results
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype; v uuid := (select auth.uid()); v_senior boolean;
begin
  select * into r from public.lab_results where id = p_result;
  if not found then raise exception 'lab_result_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = v and role = 'clinician') or not private.clinician_is_eligible(v) then
    raise exception 'This action is for clinicians' using errcode = '42501';
  end if;
  if not private.clinician_has_patient_access(r.patient_id) then
    perform private.audit_chart_read(r.patient_id, array['lab_results'], 'lab result action', 'denied');
    r.id := null;
    return r;
  end if;
  v_senior := exists (select 1 from public.clinical_staff cs where cs.profile_id = v and cs.active
                       and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer'));
  if p_need_senior and not v_senior then raise exception 'lab_disclosure_needs_senior_clinician' using errcode = '42501'; end if;
  if p_critical_needs_senior and r.release_reason = 'critical' and not v_senior then
    raise exception 'lab_critical_needs_senior_clinician' using errcode = '42501';
  end if;
  return r;
end;
$$;
revoke all on function private.lab_review_actor(uuid, boolean, boolean) from public, anon, authenticated;

-- 4. closing the queue task
create function private.lab_close_tasks(p_result uuid, p_actor uuid, p_verb text) returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.clinical_tasks%rowtype;
begin
  for t in select * from public.clinical_tasks
            where dedup_key like 'lab_result:' || p_result::text || '%' and state in ('created', 'offered_to_lead', 'open', 'escalated', 'claimed') loop
    if t.state = 'claimed' then
      -- only the clinician who holds the claim completes it; a claim held by someone else is theirs to finish
      if t.claimed_by = p_actor then
        perform private.apply_task_transition(t.id, 'completed', 'clinician', p_actor, null, null, null, jsonb_build_object('lab_result', p_verb));
      end if;
    else
      perform private.apply_task_transition(t.id, 'cancelled', 'lead', p_actor, 'The result was ' || p_verb || ' directly by a tied clinician');
    end if;
  end loop;
end;
$$;
revoke all on function private.lab_close_tasks(uuid, uuid, text) from public, anon, authenticated;

create function public.lab_result_for_review(p_result uuid, p_reason text) returns jsonb
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
    'file_path', f.file_path,
    'items', coalesce((select jsonb_agg(jsonb_build_object('analyte_code', i.analyte_code, 'value_numeric', i.value_numeric, 'value_text', i.value_text,
        'unit', i.unit, 'ref_low', i.ref_low, 'ref_high', i.ref_high, 'flag', i.flag, 'sensitive_positive', i.sensitive_positive) order by i.analyte_code)
        from public.lab_result_items i where i.lab_result_id = r.id), '[]'::jsonb));
end;
$$;

create function public.release_lab_result(p_result uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype;
begin
  r := private.lab_review_actor(p_result, false, true);
  if r.id is null then return jsonb_build_object('error', 'not_permitted'); end if;
  if r.release_state <> 'awaiting_review' then raise exception 'lab_result_not_awaiting_review' using errcode = '22023'; end if;
  update public.lab_results set release_state = 'released', reviewed_by = (select auth.uid()), reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_result;
  perform private.lab_order_resulted(r.lab_order_id);
  perform private.lab_notify(r.patient_id, r.organisation_id, 'lab_result_ready', jsonb_build_object('lab_result_id', p_result));
  perform private.emit_domain_event('lab_result.released', r.organisation_id, jsonb_build_object('lab_result_id', p_result),
    'lab_result_released:' || p_result, r.patient_id, 'lab_result', p_result);
  perform private.log_audit('lab_result.released', 'lab_results', p_result, jsonb_build_object('reason', 'clinician_review'));
  perform private.lab_close_tasks(p_result, (select auth.uid()), 'released');
  return jsonb_build_object('ok', true);
end;
$$;

create function public.record_lab_disclosure(p_result uuid, p_method text, p_attested boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype;
begin
  r := private.lab_review_actor(p_result, true);
  if r.id is null then return jsonb_build_object('error', 'not_permitted'); end if;
  if r.release_state <> 'clinician_disclosure_required' then raise exception 'lab_result_not_for_disclosure' using errcode = '22023'; end if;
  if p_method not in ('in_person', 'phone', 'video') or p_attested is not true then
    raise exception 'lab_disclosure_needs_attestation' using errcode = '22023';
  end if;
  update public.lab_results set release_state = 'released', reviewed_by = (select auth.uid()), reviewed_at = now(), disclosure_method = p_method,
         disclosure_attested = true, review_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_result;
  perform private.lab_order_resulted(r.lab_order_id);
  perform private.lab_notify(r.patient_id, r.organisation_id, 'lab_result_ready', jsonb_build_object('lab_result_id', p_result));
  perform private.emit_domain_event('lab_result.released', r.organisation_id, jsonb_build_object('lab_result_id', p_result),
    'lab_result_released:' || p_result, r.patient_id, 'lab_result', p_result);
  perform private.log_audit('lab_result.disclosed', 'lab_results', p_result, jsonb_build_object('method', p_method));
  perform private.lab_close_tasks(p_result, (select auth.uid()), 'disclosed');
  return jsonb_build_object('ok', true);
end;
$$;

create function public.withhold_lab_result(p_result uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype;
begin
  r := private.lab_review_actor(p_result, false);
  if r.id is null then return jsonb_build_object('error', 'not_permitted'); end if;
  if r.release_state not in ('awaiting_review', 'clinician_disclosure_required') then raise exception 'lab_result_final' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = '22023'; end if;
  update public.lab_results set release_state = 'withheld', reviewed_by = (select auth.uid()), reviewed_at = now(), withheld_reason = btrim(p_reason)
   where id = p_result;
  perform private.log_audit('lab_result.withheld', 'lab_results', p_result, jsonb_build_object('reason', btrim(p_reason)));
  perform private.lab_close_tasks(p_result, (select auth.uid()), 'withheld');
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.lab_result_for_review(uuid, text), public.release_lab_result(uuid, text),
  public.record_lab_disclosure(uuid, text, boolean, text), public.withhold_lab_result(uuid, text) from public, anon;
grant execute on function public.lab_result_for_review(uuid, text), public.release_lab_result(uuid, text),
  public.record_lab_disclosure(uuid, text, boolean, text), public.withhold_lab_result(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.release_lab_result(uuid, text)', 'execute') or has_function_privilege('anon', 'public.lab_result_explain_allowed(uuid)', 'execute') then
    raise exception 'S27c self-check: anon can execute a lab function';
  end if;
end $$;
