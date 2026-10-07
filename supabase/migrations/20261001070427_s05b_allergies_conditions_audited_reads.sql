-- S05b part 1 of 2: what the clinician screens need to stop reading patient_allergies and patient_conditions directly (INV-10, OQ-54).
-- Part 2 (the closing migration) is applied only after the code that uses this has been deployed.
--
-- Counted first (live, 2026-10-01): patient_allergies 0 rows, patient_conditions 0 rows. Staff user-session readers found by code scan
-- plus live function/view scan: loadMedicationSafety (allergies), the care-management case file (conditions) and the clinician patient-list
-- condition filter (conditions). No invoker function or view other than the two S05 views reads either table; the patient-side readers
-- (health summary, AI coach, export, emergency dataset, mobile) read their own rows and are unaffected.
--
-- Adds:
--   * the chart sections `allergies` and `conditions` of read_patient_chart_audited gain the columns those screens use (views extended at
--     the end, so existing callers are unaffected): allergies.source / noted_at; conditions.next_review_due_at / last_reviewed_at /
--     date_identified.
--   * public.search_patient_ids_by_condition(term, scope): the list-wide filter the patient list needs. It cannot go through a per-patient
--     chart read, so it is its own audited function: org staff only (same reach as today), a patient caller is refused, the term is never
--     stored (only its length and the result count), the LIKE wildcards are escaped, one audit row per search.

create or replace view public.allergies with (security_invoker = true) as
select
  a.id,
  a.organisation_id,
  a.patient_id,
  a.allergen as substance,
  a.reaction,
  a.severity,
  a.verification_status,
  a.recorded_by,
  a.created_at,
  a.source,
  a.noted_at
from public.patient_allergies a;

create or replace view public.conditions with (security_invoker = true) as
select
  c.id,
  c.organisation_id,
  c.patient_id,
  c.icd10_code as code,
  c.condition_name as display,
  c.status,
  c.recorded_by,
  (c.diagnosing_clinician_id is not null) as verified_by_clinician,
  c.source,
  c.created_at,
  c.next_review_due_at,
  c.last_reviewed_at,
  c.date_identified
from public.patient_conditions c;

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

  select coalesce(array_agg(x.patient_id order by x.patient_id), '{}') into v_ids from (
    select distinct pc.patient_id
      from public.patient_conditions pc
     where pc.condition_name ilike '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
       and private.is_org_staff(pc.organisation_id)
       and (p_scope is null or pc.patient_id = any (p_scope))
     order by pc.patient_id
     limit p_cap
  ) x;
  v_count := cardinality(v_ids);

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, result, ip)
  values (private.current_org_id(), (select auth.uid()), 'staff.condition_search', 'patient_conditions',
          jsonb_build_object('query_length', char_length(v_term), 'result_count', v_count, 'scoped', p_scope is not null),
          'success', private.request_ip());

  return query select unnest(v_ids);
end;
$$;

revoke all on function public.search_patient_ids_by_condition(text, uuid[], integer) from public;
grant execute on function public.search_patient_ids_by_condition(text, uuid[], integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.search_patient_ids_by_condition(text,uuid[],integer)', 'EXECUTE') then
    raise exception 'S05b assertion: anon can execute the condition search';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allergies' and column_name = 'source')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conditions' and column_name = 'next_review_due_at') then
    raise exception 'S05b assertion: the extended view columns are missing';
  end if;
end $$;
