-- S24b: (1) the CMO's own screen functions for the hypertension titration protocol, and (2) hardening of confirm_care_plan_change after the
-- security review of OQ-174 (docs/security/S24-confirm-care-plan-change-review.md).
--
-- (1) Nothing here signs anything. save_protocol_draft stores the CMO's draft step table; approve_protocol runs only when the Chief Medical Officer
--     presses the button (CMO only, audited, draft only, retires the previously approved version of the same code in the same step). No clinical
--     content is written by this migration: the step table is the CMO's.
-- (2) confirm_care_plan_change: the signer must also hold a currently verified licence at the moment of applying (not just an active tier); a signed
--     stop that matches no active medicine is sent back for review instead of being reported as applied; and the session identity is asserted to
--     be the patient's again before any later write, failing closed (and rolling back) otherwise.

create function public.save_protocol_draft(p_code text, p_definition jsonb, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_version integer;
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can save a protocol draft' using errcode = '42501';
  end if;
  if p_code is null or p_code !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'a protocol code is lowercase letters, digits and underscores' using errcode = '22023';
  end if;
  -- `is distinct from`, not `<>`: a missing key makes jsonb_typeof NULL, and NULL <> 'array' is NULL, which would let it through.
  if p_definition is null or jsonb_typeof(p_definition) is distinct from 'object'
     or jsonb_typeof(p_definition -> 'steps') is distinct from 'array' or jsonb_typeof(p_definition -> 'params') is distinct from 'object' then
    raise exception 'a protocol definition needs params and a list of steps' using errcode = '22023';
  end if;
  select id, version into v_id, v_version from public.protocols where code = p_code and status = 'draft';
  if v_id is not null then
    update public.protocols
       set definition = p_definition || jsonb_build_object('code', p_code, 'version', v_version, 'status', 'draft'), note = nullif(btrim(coalesce(p_note, '')), '')
     where id = v_id;
  else
    select coalesce(max(version), 0) + 1 into v_version from public.protocols where code = p_code;
    insert into public.protocols (code, version, status, definition, note)
    values (p_code, v_version, 'draft', p_definition || jsonb_build_object('code', p_code, 'version', v_version, 'status', 'draft'), nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (private.current_org_id(), (select auth.uid()), 'protocol.draft_saved', 'protocol', v_id,
          jsonb_build_object('code', p_code, 'version', v_version));
  return v_id;
end;
$$;

create function public.approve_protocol(p_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare p public.protocols%rowtype;
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can approve a protocol' using errcode = '42501';
  end if;
  select * into p from public.protocols where id = p_id for update;
  if not found or p.status <> 'draft' then
    raise exception 'only a draft protocol can be approved' using errcode = '22023';
  end if;
  if jsonb_typeof(p.definition -> 'steps') is distinct from 'array' or coalesce(jsonb_array_length(p.definition -> 'steps'), 0) = 0 then
    raise exception 'a protocol with no steps cannot be approved' using errcode = '22023';
  end if;
  -- The test-only placeholder (fictional drug names, flagged placeholder) must never become the table real patients are judged against.
  if p.definition -> 'placeholder' = 'true'::jsonb then
    raise exception 'a placeholder step table is for tests only and cannot be approved' using errcode = '22023';
  end if;
  update public.protocols set status = 'retired' where code = p.code and status = 'approved';
  update public.protocols
     set status = 'approved', approved_by = (select auth.uid()), approved_at = now(),
         definition = jsonb_set(definition, '{status}', '"approved"'::jsonb)
   where id = p_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (private.current_org_id(), (select auth.uid()), 'protocol.approved', 'protocol', p_id,
          jsonb_build_object('code', p.code, 'version', p.version, 'note', nullif(btrim(coalesce(p_note, '')), '')));
end;
$$;

revoke all on function public.save_protocol_draft(text, jsonb, text) from public, anon;
revoke all on function public.approve_protocol(uuid, text) from public, anon;
grant execute on function public.save_protocol_draft(text, jsonb, text) to authenticated;
grant execute on function public.approve_protocol(uuid, text) to authenticated;

create or replace function public.confirm_care_plan_change(p_change uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.care_plan_changes%rowtype;
  v_uid uuid := (select auth.uid());
  v_old public.medications%rowtype;
  v_item jsonb;
  v_rx uuid;
  v_now_findings jsonb;
  v_known jsonb;
  v_new_codes text[];
  v_save_sub text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_save_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_claims jsonb;
  v_n integer;
begin
  select * into c from public.care_plan_changes where id = p_change for update;
  if c.id is null or v_uid is null or c.patient_id <> v_uid then
    raise exception 'Not authorised to confirm this change' using errcode = '42501';
  end if;
  if c.state <> 'signed' then
    return jsonb_build_object('outcome', 'not_available');
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    update public.care_plan_changes set state = 'expired', expired_at = now() where id = p_change;
    perform private.written_care_notify(c.signed_by, c.organisation_id, 'care_change_expired_staff', jsonb_build_object('care_plan_change_id', p_change));
    return jsonb_build_object('outcome', 'expired');
  end if;

  -- Re-check at the moment of applying: something new since signing (a newly recorded allergy, a duplicate) sends it back to the care team.
  if c.kind = 'medication' and c.proposal ->> 'action' in ('start', 'change') then
    v_now_findings := private.prescription_safety_findings(c.patient_id, c.proposal #>> '{item,drug_name}', nullif(c.proposal ->> 'medication_id', '')::uuid);
    v_known := coalesce(c.safety_checks -> 'findings', '[]'::jsonb);
    select array_agg(distinct e ->> 'code') into v_new_codes
      from jsonb_array_elements(v_now_findings) e
     where not exists (select 1 from jsonb_array_elements(v_known) k where k ->> 'code' = e ->> 'code' and coalesce(k ->> 'allergen', '') = coalesce(e ->> 'allergen', ''))
       and e ->> 'code' <> 'allergies_unrecorded';
    if v_new_codes is not null then
      update public.care_plan_changes set state = 'expired', expired_at = now() where id = p_change;
      perform private.written_care_notify(c.signed_by, c.organisation_id, 'care_change_expired_staff', jsonb_build_object('care_plan_change_id', p_change, 'reason', 'recheck'));
      return jsonb_build_object('outcome', 'needs_review');
    end if;
  end if;

  v_claims := coalesce(nullif(v_save_claims, '')::jsonb, '{}'::jsonb) || jsonb_build_object('sub', c.signed_by::text);
  perform set_config('request.jwt.claim.sub', c.signed_by::text, true);
  perform set_config('request.jwt.claims', v_claims::text, true);
  perform set_config('tarragon.change_apply', p_change::text, true);

  if not private.has_prescribing_authority(c.organisation_id)
     or not exists (select 1 from public.clinical_staff cs
                     where cs.profile_id = c.signed_by and cs.organisation_id = c.organisation_id and cs.active
                       and cs.license_verified_at is not null and (cs.license_expires_at is null or cs.license_expires_at > now())) then
    -- The signer has since lost authority or a verified licence: fail closed.
    perform set_config('request.jwt.claim.sub', v_save_sub, true);
    perform set_config('request.jwt.claims', v_save_claims, true);
    perform set_config('tarragon.change_apply', '', true);
    update public.care_plan_changes set state = 'expired', expired_at = now() where id = p_change;
    perform private.written_care_notify(c.signed_by, c.organisation_id, 'care_change_expired_staff', jsonb_build_object('care_plan_change_id', p_change, 'reason', 'authority'));
    return jsonb_build_object('outcome', 'needs_review');
  end if;

  if c.kind = 'medication' then
    v_item := c.proposal -> 'item';
    if c.proposal ->> 'action' = 'stop' then
      update public.medications set is_active = false, stopped_at = now(),
             stopped_reason = coalesce(nullif(btrim(c.proposal ->> 'reason'), ''), c.rationale)
       where id = (c.proposal ->> 'medication_id')::uuid and patient_id = c.patient_id and is_active;
      get diagnostics v_n = row_count;
      if v_n = 0 then
        perform set_config('request.jwt.claim.sub', v_save_sub, true);
        perform set_config('request.jwt.claims', v_save_claims, true);
        perform set_config('tarragon.change_apply', '', true);
        update public.care_plan_changes set state = 'expired', expired_at = now() where id = p_change;
        perform private.written_care_notify(c.signed_by, c.organisation_id, 'care_change_expired_staff', jsonb_build_object('care_plan_change_id', p_change, 'reason', 'stale'));
        return jsonb_build_object('outcome', 'needs_review');
      end if;
    else
      if c.proposal ->> 'action' = 'change' then
        select * into v_old from public.medications where id = (c.proposal ->> 'medication_id')::uuid and patient_id = c.patient_id for update;
        if v_old.id is null or not v_old.is_active or v_old.superseded_at is not null then
          perform set_config('request.jwt.claim.sub', v_save_sub, true);
          perform set_config('request.jwt.claims', v_save_claims, true);
          perform set_config('tarragon.change_apply', '', true);
          update public.care_plan_changes set state = 'expired', expired_at = now() where id = p_change;
          perform private.written_care_notify(c.signed_by, c.organisation_id, 'care_change_expired_staff', jsonb_build_object('care_plan_change_id', p_change, 'reason', 'stale'));
          return jsonb_build_object('outcome', 'needs_review');
        end if;
      end if;
      v_rx := private.issue_signed_prescription(c.organisation_id, c.patient_id, v_item, c.safety_checks,
                                                v_old.prescription_id, case when c.proposal ->> 'action' = 'change' then c.rationale end, c.id, c.is_test);
      if c.proposal ->> 'action' = 'change' then
        update public.medications set is_active = false, superseded_at = now() where id = v_old.id;
        insert into public.medications (organisation_id, patient_id, care_plan_id, drug_name, dose, frequency, refill_date, schedule_times, source, route,
                                        duration_days, quantity, repeats_allowed, indication, instructions, version, previous_version_id, amendment_reason, prescription_id)
        values (v_old.organisation_id, v_old.patient_id, v_old.care_plan_id, v_item ->> 'drug_name', v_item ->> 'dose', v_item ->> 'frequency', v_old.refill_date,
                coalesce(v_item -> 'schedule_times', v_old.schedule_times), 'clinician', v_item ->> 'route', (v_item ->> 'duration_days')::integer,
                v_item ->> 'quantity', coalesce((v_item ->> 'repeats_allowed')::integer, v_old.repeats_allowed), v_item ->> 'indication', v_item ->> 'instructions',
                v_old.version + 1, v_old.id, c.rationale, v_rx);
      else
        insert into public.medications (organisation_id, patient_id, care_plan_id, drug_name, dose, frequency, schedule_times, source, route,
                                        duration_days, quantity, repeats_allowed, indication, instructions, prescription_id)
        values (c.organisation_id, c.patient_id, c.care_plan_id, v_item ->> 'drug_name', v_item ->> 'dose', v_item ->> 'frequency',
                coalesce(v_item -> 'schedule_times', '[]'::jsonb), 'clinician', v_item ->> 'route', (v_item ->> 'duration_days')::integer,
                v_item ->> 'quantity', coalesce((v_item ->> 'repeats_allowed')::integer, 0), v_item ->> 'indication', v_item ->> 'instructions', v_rx);
      end if;
    end if;
  elsif c.kind = 'target' then
    update public.care_plans set target_ranges = target_ranges || (c.proposal -> 'target_ranges') where id = c.care_plan_id;
  else
    update public.care_plans set reading_schedule = c.proposal -> 'reading_schedule' where id = c.care_plan_id;
  end if;

  perform set_config('request.jwt.claim.sub', v_save_sub, true);
  perform set_config('request.jwt.claims', v_save_claims, true);
  perform set_config('tarragon.change_apply', '', true);
  -- Defence in depth: nothing after the apply may run as anyone but the patient. If the identity did not come back, stop and roll everything back.
  if (select auth.uid()) is distinct from v_uid then
    raise exception 'session identity was not restored after applying a change' using errcode = 'XX000';
  end if;

  update public.care_plan_changes
     set state = 'confirmed', patient_confirmed_at = now(), applied_at = now(), applied_prescription_id = v_rx
   where id = p_change;
  perform private.s24_audit('care_plan_change.confirmed', c.organisation_id, c.patient_id, p_change, jsonb_build_object('kind', c.kind));
  perform private.emit_domain_event('care_plan_change.confirmed', c.organisation_id, jsonb_build_object('care_plan_change_id', p_change), 'care_plan_change.confirmed:' || p_change,
                                    c.patient_id, 'care_plan_change', p_change);
  return jsonb_build_object('outcome', 'applied');
end;
$$;
