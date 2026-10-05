-- S05f piece C, part 1 (reads): the audited, tie-gated reads of medications (INV-10, INV-12). Additive; the table stays open until the
-- write functions and the closing migration follow (piece C2).
--
-- Counted first (live, 2026-10-01): medications 0 rows. Every database function that reads the table is SECURITY DEFINER except
-- amend_medication (an invoker RPC, moved in C2 with the writes); the invoker views are medication_schedules (no app reader) and a false
-- positive (master_data_registry is a literal VALUES list). Staff readers and the embedded selects are moved in the same PR.
--
-- Three functions (the third, patient_record_counts_for_merge, is explained where it is defined):
--   read_patient_medications_audited(patient, reason, active filter, single medication) -> {status: ok | denied, rows: [full medication rows]}
--     One path for every caller of the shared hooks and loaders. The patient, a caregiver with the 'medications' category grant and a
--     'view_medication' supporter read the rows exactly as the table policy allowed (no audit row, it is their own or their granted
--     data); staff are admitted by private.can_staff_read_clinical (tie, break-glass per category, support-view session) and every staff
--     read writes an audit row with its basis (a refusal too); a staff member with no tie is denied, never shown an empty list.
--   read_medication_embeds_audited(ids) -> {<medication id>: {patient_id, drug_name, dose, frequency, rx_number, repeats_allowed}}
--     For the eight list screens that embedded `medication:medications(...)` in another table's select: once the base table closes to
--     staff that embed would silently return null for every row. A medication the caller may not see is simply absent from the result,
--     which the screens render as "medicine not available to you", never as an empty name. One summary audit row per call when any
--     entry was served on the staff basis (no per-patient fan-out; the same shape as list_referrals_audited).

create or replace function public.read_patient_medications_audited(
  p_patient uuid, p_reason text default null, p_active boolean default null, p_medication uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_page constant integer := 500;                      -- technical page size, not a clinical value
  v_uid uuid := (select auth.uid());
  -- The service role has no user and already bypasses RLS (server jobs such as the CV-risk escalation sweep read through here); it is
  -- admitted like an owner, with no audit row, exactly as its direct table read was.
  v_service boolean := coalesce((select auth.role()), '') = 'service_role';
  v_own boolean;
  v_rows jsonb;
begin
  if v_uid is null and not v_service then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- The same non-staff admissions the table's SELECT policy has: the patient, a category grant, a view_medication supporter.
  v_own := v_service or p_patient = v_uid
        or private.can_read_clinical(p_patient, 'medications'::public.care_access_category)
        or private.can_read_clinical(p_patient, 'view_medication'::public.caregiver_permission);

  if not v_own then
    if exists (select 1 from public.profiles where id = v_uid and role = 'patient') then
      raise exception 'not authorised' using errcode = '42501';
    end if;
    if p_reason is null or char_length(btrim(p_reason)) < 10 then
      raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
    end if;
    if not private.can_staff_read_clinical(p_patient, 'medications'::public.care_access_category) then
      perform private.audit_chart_read(p_patient, array['medications'], p_reason, 'denied');
      return jsonb_build_object('status', 'denied', 'rows', '[]'::jsonb);
    end if;
  end if;

  -- Rows carry the two embeds the shared hooks selected (the linked care plan's condition and the prescriber's name), so the screens
  -- keep their shape. Ordering: active newest first; stopped newest-stopped first, then most recently updated.
  select coalesce(jsonb_agg((to_jsonb(x) - 'search_vector' - 'sort_a' - 'sort_b') order by x.sort_a desc nulls last, x.sort_b desc), '[]'::jsonb) into v_rows from (
    select m.*,
           case when p_active is false then m.stopped_at end as sort_a,
           case when p_active is false then m.updated_at else m.created_at end as sort_b,
           (select jsonb_build_object('condition', cp.condition, 'status', cp.status) from public.care_plans cp where cp.id = m.care_plan_id) as care_plan,
           (select jsonb_build_object('full_name', pr.full_name) from public.profiles pr where pr.id = m.added_by) as added_by_profile
      from public.medications m
     where m.patient_id = p_patient
       and (p_active is null or m.is_active = p_active)
       and (p_medication is null or m.id = p_medication)
     order by case when p_active is false then m.stopped_at end desc nulls last,
              case when p_active is false then m.updated_at else m.created_at end desc
     limit c_page) x;

  if not v_own then
    perform private.audit_chart_read(p_patient, array['medications'], p_reason, 'success');
  end if;
  return jsonb_build_object('status', 'ok', 'rows', v_rows);
end;
$$;

create or replace function public.read_medication_embeds_audited(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max constant integer := 1000;                      -- technical cap on ids per call, not a clinical value
  v_uid uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.role()), '') = 'service_role';   -- see read_patient_medications_audited
  v_out jsonb := '{}'::jsonb;
  v_staff integer := 0;
  r record;
begin
  if v_uid is null and not v_service then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return v_out;
  end if;
  if cardinality(p_ids) > c_max then
    raise exception 'too many ids' using errcode = '22023';
  end if;

  for r in
    select m.id, m.patient_id, m.drug_name, m.dose, m.frequency, m.rx_number, m.repeats_allowed,
           (v_service or m.patient_id = v_uid
            or private.can_read_clinical(m.patient_id, 'medications'::public.care_access_category)
            or private.can_read_clinical(m.patient_id, 'view_medication'::public.caregiver_permission)) as own
      from public.medications m
     where m.id = any (p_ids)
  loop
    if r.own then
      null;
    elsif not exists (select 1 from public.profiles where id = v_uid and role = 'patient')
          and private.can_staff_read_clinical(r.patient_id, 'medications'::public.care_access_category) then
      v_staff := v_staff + 1;
    else
      continue;                                         -- not visible to this caller: absent from the result
    end if;
    v_out := v_out || jsonb_build_object(r.id::text, jsonb_build_object(
      'patient_id', r.patient_id, 'drug_name', r.drug_name, 'dose', r.dose, 'frequency', r.frequency,
      'rx_number', r.rx_number, 'repeats_allowed', r.repeats_allowed));
  end loop;

  if v_staff > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, result, ip)
    values (private.current_org_id(), v_uid, 'staff.medication_embed_read', 'medications',
            jsonb_build_object('requested', cardinality(p_ids), 'served_on_staff_basis', v_staff), 'success', private.request_ip());
  end if;
  return v_out;
end;
$$;

-- The admin patient-merge page shows how much history each candidate carries so the operator can pick the surviving record. It counted
-- medications and vitals with an exact head-count through the caller's session: once staff lose SELECT that count would silently read 0
-- ("this record has no history") on the page that decides which record survives a merge, because RLS filters rows rather than raising.
-- Counts only, never content, gated on the same permission the merge itself needs.
create or replace function public.patient_record_counts_for_merge(p_patient uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('patients.merge') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'medications', (select count(*) from public.medications where patient_id = p_patient),
    'vitals_readings', (select count(*) from public.vitals_readings where patient_id = p_patient));
end;
$$;

revoke all on function public.patient_record_counts_for_merge(uuid) from public;
grant execute on function public.patient_record_counts_for_merge(uuid) to authenticated;

revoke all on function public.read_patient_medications_audited(uuid, text, boolean, uuid) from public;
revoke all on function public.read_medication_embeds_audited(uuid[]) from public;
grant execute on function public.read_patient_medications_audited(uuid, text, boolean, uuid) to authenticated;
grant execute on function public.read_medication_embeds_audited(uuid[]) to authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array['public.read_patient_medications_audited(uuid,text,boolean,uuid)', 'public.read_medication_embeds_audited(uuid[])', 'public.patient_record_counts_for_merge(uuid)'] loop
    if not (select prosecdef from pg_proc where oid = v_fn::regprocedure) then
      raise exception 'S05f assertion: % is not SECURITY DEFINER', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'S05f assertion: anon can execute %', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'S05f assertion: authenticated cannot execute %', v_fn;
    end if;
  end loop;
end $$;
