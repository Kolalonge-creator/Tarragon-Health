-- Tarragon Health — Health Data Architecture & MDM (spec §34.8)
-- Provenance completeness pass: patient_allergies.verification_status.

create type public.allergy_verification_status as enum ('unverified', 'confirmed', 'refuted');

alter table public.patient_allergies
  add column verification_status public.allergy_verification_status not null default 'unverified',
  add column verified_by uuid references public.profiles (id) on delete set null,
  add column verified_at timestamptz,
  add constraint patient_allergies_verification_consistency check (
    (verification_status = 'unverified' and verified_by is null and verified_at is null)
    or (verification_status <> 'unverified' and verified_by is not null and verified_at is not null)
  );

comment on column public.patient_allergies.verification_status is
  'Whether a clinician has reviewed this allergy claim (§34.8 provenance). Defaults unverified — a patient-reported or fhir_import allergen stays unverified until org staff confirms or refutes it via the trigger below; verified_by/verified_at are system-set, never client-supplied.';

create or replace function private.enforce_allergy_verification_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.verification_status = 'unverified' then
    NEW.verified_by := null;
    NEW.verified_at := null;
    return NEW;
  end if;

  if not private.is_org_staff(NEW.organisation_id) then
    raise exception 'only organisation staff may confirm or refute an allergy';
  end if;

  NEW.verified_by := (select auth.uid());
  NEW.verified_at := now();
  return NEW;
end;
$$;

comment on function private.enforce_allergy_verification_authority is
  'Blocks a non-staff caller (i.e. the patient themselves) from setting patient_allergies.verification_status to anything but unverified, and always system-sets verified_by/verified_at rather than trusting client input.';

create trigger patient_allergies_enforce_verification_authority
  before insert or update of verification_status on public.patient_allergies
  for each row execute function private.enforce_allergy_verification_authority();

grant execute on function private.enforce_allergy_verification_authority() to authenticated, service_role;

do $$
declare
  v_org_id     uuid;
  v_patient_id uuid;
  v_row_id     uuid;
  v_wrongly_succeeded boolean := false;
begin
  select id into v_org_id from public.organisations limit 1;
  select id into v_patient_id from public.profiles where role = 'patient' limit 1;

  if v_org_id is not null and v_patient_id is not null then
    insert into public.patient_allergies (organisation_id, patient_id, allergen, source)
    values (v_org_id, v_patient_id, 'provenance test allergen', 'patient')
    returning id into v_row_id;

    if not exists (
      select 1 from public.patient_allergies
      where id = v_row_id and verification_status = 'unverified' and verified_by is null and verified_at is null
    ) then
      raise exception 'FAIL: default patient_allergies insert did not land as unverified/null-attested';
    end if;

    perform set_config('app.change_reason', 'provenance migration self-test', true);

    begin
      update public.patient_allergies set verification_status = 'confirmed' where id = v_row_id;
      v_wrongly_succeeded := true;
    exception
      when others then
        if sqlerrm not like '%only organisation staff may confirm or refute%' then
          raise exception 'FAIL: unexpected error from allergy verification guard: %', sqlerrm;
        end if;
    end;

    if v_wrongly_succeeded then
      raise exception 'FAIL: patient_allergies verification_status was set to confirmed by a non-staff caller';
    end if;

    delete from public.patient_allergies where id = v_row_id;
  end if;
end;
$$;
