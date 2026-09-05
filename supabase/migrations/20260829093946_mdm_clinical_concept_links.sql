-- Tarragon Health — Health Data Architecture & MDM (spec §34.6, §34.11)
-- Nullable concept_id links from the platform's real clinical tables into
-- the terminology core built in mdm_terminology_core /
-- mdm_units_and_concept_seed.

create or replace function private.validate_concept_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_column         text := TG_ARGV[0];
  v_expected       public.reference_concept_domain := TG_ARGV[1]::public.reference_concept_domain;
  v_concept_id     uuid;
  v_actual_domain  public.reference_concept_domain;
begin
  v_concept_id := (to_jsonb(NEW) ->> v_column)::uuid;
  if v_concept_id is null then
    return NEW;
  end if;

  select domain into v_actual_domain
  from public.reference_concepts
  where id = v_concept_id;

  if v_actual_domain is null then
    raise exception 'concept % referenced by %.% does not exist', v_concept_id, TG_TABLE_NAME, v_column;
  end if;

  if v_actual_domain <> v_expected then
    raise exception '%.% must reference a "%" concept, but % is domain "%"', TG_TABLE_NAME, v_column, v_expected, v_concept_id, v_actual_domain;
  end if;

  return NEW;
end;
$$;

comment on function private.validate_concept_domain is
  'Generic domain guard for a *_concept_id column: TG_ARGV[0] is the column name, TG_ARGV[1] the required reference_concepts.domain value. A null concept_id always passes (the link is optional).';

alter table public.patient_conditions
  add column condition_concept_id uuid references public.reference_concepts (id) on delete set null;

create index patient_conditions_condition_concept_idx
  on public.patient_conditions (condition_concept_id) where condition_concept_id is not null;

create trigger patient_conditions_validate_concept_domain
  before insert or update of condition_concept_id on public.patient_conditions
  for each row execute function private.validate_concept_domain('condition_concept_id', 'condition');

alter table public.medications
  add column drug_concept_id uuid references public.reference_concepts (id) on delete set null;

create index medications_drug_concept_idx
  on public.medications (drug_concept_id) where drug_concept_id is not null;

create trigger medications_validate_concept_domain
  before insert or update of drug_concept_id on public.medications
  for each row execute function private.validate_concept_domain('drug_concept_id', 'medication');

alter table public.patient_allergies
  add column allergen_concept_id uuid references public.reference_concepts (id) on delete set null;

create index patient_allergies_allergen_concept_idx
  on public.patient_allergies (allergen_concept_id) where allergen_concept_id is not null;

create trigger patient_allergies_validate_concept_domain
  before insert or update of allergen_concept_id on public.patient_allergies
  for each row execute function private.validate_concept_domain('allergen_concept_id', 'allergen');

alter table public.lab_analyte_readings
  add column analyte_concept_id uuid references public.reference_concepts (id) on delete set null;

create index lab_analyte_readings_analyte_concept_idx
  on public.lab_analyte_readings (analyte_concept_id) where analyte_concept_id is not null;

create trigger lab_analyte_readings_validate_concept_domain
  before insert or update of analyte_concept_id on public.lab_analyte_readings
  for each row execute function private.validate_concept_domain('analyte_concept_id', 'lab_analyte');

create or replace function public.resolve_analyte_concept(p_tarragon_code text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from public.reference_concepts
  where domain = 'lab_analyte'
    and attributes ->> 'tarragon_analyte_code' = p_tarragon_code
    and status <> 'retired'
  order by (status = 'active') desc
  limit 1;
$$;

comment on function public.resolve_analyte_concept is
  'Looks up the seeded LOINC concept for a lab_analyte_readings.code string via the tarragon_analyte_code bridge written by mdm_units_and_concept_seed. Returns null if that code has no seeded concept yet.';

revoke execute on function public.resolve_analyte_concept(text) from public;
grant execute on function public.resolve_analyte_concept(text) to authenticated, service_role;

grant execute on function private.validate_concept_domain() to authenticated, service_role;

do $$
declare
  v_concept_id              uuid;
  v_wrong_domain_concept_id uuid;
  v_org_id                  uuid;
  v_patient_id              uuid;
  v_insert_wrongly_succeeded boolean := false;
begin
  v_concept_id := public.resolve_analyte_concept('creatinine');
  if v_concept_id is null then
    raise exception 'FAIL: resolve_analyte_concept(creatinine) returned null';
  end if;

  select id into v_org_id from public.organisations limit 1;
  select id into v_patient_id from public.profiles where role = 'patient' limit 1;
  select id into v_wrong_domain_concept_id from public.reference_concepts where domain = 'medication' limit 1;

  if v_org_id is not null and v_patient_id is not null and v_wrong_domain_concept_id is not null then
    begin
      insert into public.patient_conditions (organisation_id, patient_id, condition_name, condition_concept_id)
      values (v_org_id, v_patient_id, 'domain guard test', v_wrong_domain_concept_id);
      v_insert_wrongly_succeeded := true;
    exception
      when others then
        if sqlerrm not like '%must reference a "condition" concept%' then
          raise exception 'FAIL: unexpected error from domain guard: %', sqlerrm;
        end if;
    end;

    if v_insert_wrongly_succeeded then
      raise exception 'FAIL: patient_conditions accepted a medication-domain concept as condition_concept_id';
    end if;
  end if;
end;
$$;
