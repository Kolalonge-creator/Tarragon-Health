-- S36a: admin patient search with minimal identity fields, and a record open that needs a typed reason.
--
-- Founder decision OQ-04 (2026-09-30): search shows minimal identity only; opening a record needs a typed
-- reason and writes an audit row. Until now /admin/patients read up to 5000 patients (date of birth, phone,
-- city, purchases) with the service-role client, no reason and one audit row for the whole roster. That
-- conflicted with INV-10 and OQ-04. This migration adds the two doors that replace it:
--
--   admin_patient_search(query)               name / patient number / phone digits / exact email -> at most 25
--                                             rows of minimal identity (name, patient number, masked phone,
--                                             birth year, active, test). One audit row per search: the length
--                                             of the query and the number of hits, never the query text
--                                             (a typed name or phone is itself personal data).
--   admin_open_patient_record(patient, reason) support facts only (contact, account state, purchases), no
--                                             clinical data. Reason 10 to 500 characters. One audit row per
--                                             open carrying the reason in audit_log.reason.
--
-- Admin only (private.is_admin()). Clinical records stay behind support_view_sessions and the clinician ties
-- (INV-12); this function reads nothing from a clinical table. Anon cannot execute either function.
--
-- Counts at write time are not needed: no data is changed, no column added.

create or replace function public.admin_patient_search(p_query text)
returns table (
  patient_id     uuid,
  full_name      text,
  patient_number text,
  phone_masked   text,
  birth_year     integer,
  is_active      boolean,
  is_test        boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q      text := btrim(coalesce(p_query, ''));
  v_digits text := regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g');
  v_tail   text;
  v_like   text;
  v_hits   integer;
  v_rows   jsonb;
begin
  if not private.is_admin() then
    raise exception 'Only the platform admin can search patients' using errcode = '42501';
  end if;
  if char_length(v_q) < 3 or char_length(v_q) > 80 then
    raise exception 'Type between 3 and 80 characters to search' using errcode = '22023';
  end if;

  -- A phone matches only when the FULL national number is typed (10 digits; a typed 0801... matches a stored +234801...), compared
  -- exactly. A partial suffix would let a script rebuild a masked number one digit at a time without a reason.
  v_tail := case when char_length(v_digits) >= 10 then right(v_digits, 10) else null end;

  -- Escape LIKE wildcards so a typed % or _ is a literal character.
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select coalesce(jsonb_agg(to_jsonb(h) order by h.full_name nulls last, h.patient_id), '[]'::jsonb) into v_rows
  from (
    select p.id as patient_id,
           p.full_name,
           p.patient_number,
           case when p.phone is null or char_length(p.phone) < 7 then null
                else left(p.phone, 4) || repeat('*', greatest(char_length(p.phone) - 7, 3)) || right(p.phone, 3) end as phone_masked,
           extract(year from p.date_of_birth)::integer as birth_year,
           p.is_active,
           coalesce(p.is_test, false) as is_test
    from public.profiles p
    where p.role = 'patient'
      and (
        p.full_name ilike v_like escape '\'
        or p.patient_number ilike v_like escape '\'
        or (v_tail is not null and right(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 10) = v_tail)
        or exists (
          select 1 from auth.users u
          where u.id = p.id and v_q like '%@%' and lower(u.email) = lower(v_q)
        )
      )
    order by p.full_name nulls last, p.id
    limit 25
  ) h;
  v_hits := jsonb_array_length(v_rows);

  perform private.log_audit(
    'admin.patient_searched', 'patient_search', null,
    jsonb_build_object('query_length', char_length(v_q), 'result_count', v_hits,
      'patient_ids', (select coalesce(jsonb_agg(r ->> 'patient_id'), '[]'::jsonb) from jsonb_array_elements(v_rows) r))
  );

  return query
    select r.patient_id, r.full_name, r.patient_number, r.phone_masked, r.birth_year, r.is_active, r.is_test
    from jsonb_to_recordset(v_rows) as r(
      patient_id uuid, full_name text, patient_number text, phone_masked text,
      birth_year integer, is_active boolean, is_test boolean);
end;
$$;

comment on function public.admin_patient_search(text) is
  'S36a (OQ-04). Admin only. Minimal identity fields, at most 25 rows, one audit row per search with the '
  'query LENGTH and result count only. Opening a record is admin_open_patient_record and needs a reason.';

create or replace function public.admin_open_patient_record(p_patient_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_p      record;
  v_email  text;
  v_org    text;
  v_buys   jsonb;
begin
  if not private.is_admin() then
    raise exception 'Only the platform admin can open a patient record' using errcode = '42501';
  end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 500 then
    raise exception 'Write a reason of 10 to 500 characters' using errcode = '22023';
  end if;

  select p.id, p.full_name, p.date_of_birth, p.sex, p.phone, p.city, p.state, p.patient_number,
         p.organisation_id, p.is_active, coalesce(p.is_test, false) as is_test,
         p.created_at, p.app_last_active_at
    into v_p
    from public.profiles p
   where p.id = p_patient_id and p.role = 'patient';
  if not found then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;

  select u.email into v_email from auth.users u where u.id = p_patient_id;
  select o.name into v_org from public.organisations o where o.id = v_p.organisation_id;

  select coalesce(jsonb_agg(t.x order by t.x ->> 'purchased_at' desc), '[]'::jsonb) into v_buys
  from (
   select u.x from (
    select jsonb_build_object(
             'label', coalesce(sp.name, 'Service purchase'),
             'amount_kobo', s.amount_kobo,
             'status', s.status,
             'purchased_at', coalesce(s.purchased_at, s.created_at)) as x
      from public.service_purchases s
      left join public.service_products sp on sp.id = s.service_product_id
     where s.patient_id = p_patient_id
    union all
    select jsonb_build_object(
             'label', coalesce(c.name || ' programme', 'Chronic-care programme'),
             'amount_kobo', pp.price_kobo,
             'status', pp.status,
             'purchased_at', coalesce(pp.purchased_at, pp.created_at))
      from public.programme_purchases pp
      left join public.chronic_condition_programmes c on c.id = pp.programme_id
     where pp.patient_id = p_patient_id
   ) u
   order by u.x ->> 'purchased_at' desc
   limit 20
  ) t;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result)
  values (
    v_p.organisation_id, (select auth.uid()), 'admin.patient_record_opened', 'profiles', p_patient_id,
    jsonb_build_object('scope', 'support_summary'), v_reason, 'success'
  );

  return jsonb_build_object(
    'id', v_p.id,
    'full_name', v_p.full_name,
    'email', v_email,
    'date_of_birth', v_p.date_of_birth,
    'sex', v_p.sex,
    'phone', v_p.phone,
    'city', v_p.city,
    'state', v_p.state,
    'patient_number', v_p.patient_number,
    'organisation_name', v_org,
    'is_active', v_p.is_active,
    'is_test', v_p.is_test,
    'created_at', v_p.created_at,
    'last_active_at', v_p.app_last_active_at,
    'purchases', v_buys
  );
end;
$$;

comment on function public.admin_open_patient_record(uuid, text) is
  'S36a (OQ-04, INV-10). Admin only. Support facts only (contact, account state, last 20 purchases); no '
  'clinical table is read. A reason of 10 to 500 characters is required and stored in audit_log.reason. '
  'Clinical views stay behind support_view_sessions and the clinician ties (INV-12).';

revoke all on function public.admin_patient_search(text) from public;
revoke all on function public.admin_open_patient_record(uuid, text) from public;
grant execute on function public.admin_patient_search(text) to authenticated;
grant execute on function public.admin_open_patient_record(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.admin_patient_search(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_open_patient_record(uuid,text)', 'EXECUTE') then
    raise exception 'S36a: anon can execute a patient search function';
  end if;
end $$;
