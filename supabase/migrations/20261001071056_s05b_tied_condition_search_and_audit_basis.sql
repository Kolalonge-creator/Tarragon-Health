-- S05b part 2, from the code review of part 1.
--
--   1. search_patient_ids_by_condition returns only patients the caller is tied to (INV-12). Org staff reach was an oracle: a clinician
--      the chart read refuses could pass p_scope = [that patient] and a guessed condition name and learn whether it matched.
--   2. private.audit_chart_read records the access basis (tied / break_glass / support_view / none) in the audit event, so a reviewer can
--      tell a routine care-team read from an emergency or support read even when the free-text reason is the routine one.
--
-- Counted first (live): patient_conditions 0 rows; no caller outside the clinician patient list.

create or replace function public.search_patient_ids_by_condition(p_condition text, p_scope uuid[] default null, p_cap integer default 301)
returns table (patient_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term text := btrim(coalesce(p_condition, ''));
  v_count integer;
  v_ids uuid[];
begin
  if char_length(v_term) < 2 then
    raise exception 'search text must be at least 2 characters' using errcode = '22023';
  end if;
  if p_cap is null or p_cap < 1 or p_cap > 1000 then
    raise exception 'cap out of range' using errcode = '22023';
  end if;
  if (select auth.uid()) is null
     or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- Only patients the caller is tied to: the same gate as the chart read, so this cannot confirm a condition the chart would refuse.
  select coalesce(array_agg(x.patient_id order by x.patient_id), '{}') into v_ids from (
    select distinct pc.patient_id
      from public.patient_conditions pc
     where pc.condition_name ilike '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
       and private.clinician_has_patient_access(pc.patient_id)
       and (p_scope is null or pc.patient_id = any (p_scope))
     order by pc.patient_id
     limit p_cap
  ) x;
  v_count := cardinality(v_ids);

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, result, ip)
  values (private.current_org_id(), (select auth.uid()), 'staff.condition_search', 'patient_conditions',
          jsonb_build_object('query_length', char_length(v_term), 'result_count', v_count, 'scoped', p_scope is not null, 'basis', 'tied'),
          'success', private.request_ip());

  return query select unnest(v_ids);
end;
$$;
revoke all on function public.search_patient_ids_by_condition(text, uuid[], integer) from public;
grant execute on function public.search_patient_ids_by_condition(text, uuid[], integer) to authenticated;

create or replace function private.audit_chart_read(p_patient uuid, p_sections text[], p_reason text, p_result text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_basis text;
begin
  v_basis := case
    when private.clinician_has_patient_access(p_patient) then 'tied'
    when private.has_emergency_access(p_patient) then 'break_glass'
    when private.can_support_view(p_patient) then 'support_view'
    else 'none'
  end;
  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id, ip)
  select pr.organisation_id, (select auth.uid()), 'staff.chart_read', 'patient_chart', pr.id,
         jsonb_build_object('reason', btrim(p_reason), 'sections', to_jsonb(p_sections), 'basis', v_basis),
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

do $$
begin
  if has_function_privilege('anon', 'public.search_patient_ids_by_condition(text,uuid[],integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.audit_chart_read(uuid,text[],text,text)', 'EXECUTE') then
    raise exception 'S05b assertion: a function privilege is wrong';
  end if;
end $$;
