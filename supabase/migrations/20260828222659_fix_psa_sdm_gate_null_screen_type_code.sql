create or replace function private.enforce_psa_sdm_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_age int;
  v_sex text;
begin
  if new.screen_type_code is distinct from 'psa' then
    return new;
  end if;

  select extract(year from age(date_of_birth))::int, sex::text
    into v_age, v_sex
    from public.profiles
    where id = new.patient_id;

  if v_sex is distinct from 'male' then
    raise exception 'PSA screening_results are male-only' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.patient_shared_decisions
    where patient_id = new.patient_id and screen_type_code = 'psa'
  ) then
    raise exception 'PSA screening requires a recorded shared-decision-making conversation first' using errcode = '23514';
  end if;

  return new;
end;
$$;

do $$
begin
  declare
    v_org uuid;
    v_patient uuid;
  begin
    select p.organisation_id, p.id into v_org, v_patient
      from public.profiles p
      where p.role = 'patient' and p.sex is distinct from 'male' and p.organisation_id is not null
      limit 1;

    if v_patient is null then
      raise notice 'no non-male patient fixture available; skipping behavioural assertion';
      return;
    end if;

    insert into public.screening_results (organisation_id, patient_id, result_status)
    values (v_org, v_patient, 'normal');

    delete from public.screening_results
      where organisation_id = v_org and patient_id = v_patient and screen_type_code is null and result_status = 'normal';
  end;
end $$;
