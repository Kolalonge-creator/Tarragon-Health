-- Blood group and haemoglobin genotype, stored as structured facts.
--
-- A REAL GAP, not a new feature: this platform already sells a blood group and
-- genotype test (the `single_blood_group_genotype` bundle, self-bookable since
-- the screening-ladder work) and has nowhere to put the answer. Today the
-- result survives only as prose inside `screening_results.result_summary`, so
-- nothing can query it — not the health passport, not a clinician at a glance,
-- and not the emergency card.
--
-- In Nigeria these are two of the highest-value facts in an emergency.
-- Haemoglobin genotype in particular (AA / AS / SS / SC) changes how a
-- receiving team reads a patient in crisis, and sickle cell disease is common
-- enough here that a blank field is a real clinical cost.
--
-- Provenance is NOT NULL-in-spirit: every row records who entered it and where
-- it came from, because "AA" with no source is a rumour, not a result.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'blood_group') then
    create type public.blood_group as enum (
      'O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'haemoglobin_genotype') then
    -- The clinically common phenotypes. Rarer variants are recorded as 'other'
    -- with a note rather than silently forced into the nearest option.
    create type public.haemoglobin_genotype as enum (
      'AA', 'AS', 'AC', 'SS', 'SC', 'CC', 'other'
    );
  end if;
end $$;

create table if not exists public.patient_blood_profile (
  patient_id        uuid primary key references public.profiles (id) on delete cascade,
  organisation_id   uuid not null references public.organisations (id),
  blood_group       public.blood_group,
  genotype          public.haemoglobin_genotype,
  genotype_note     text,
  -- Where this came from. A lab report is not the same as a patient's memory of
  -- what they were told years ago, and an emergency card should say which.
  source            text not null default 'lab_result'
                      check (source in ('lab_result', 'patient_reported', 'clinician_recorded')),
  recorded_by       uuid references public.profiles (id),
  recorded_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- At least one of the two must be present; an empty row is not a record.
  constraint patient_blood_profile_not_empty
    check (blood_group is not null or genotype is not null)
);

alter table public.patient_blood_profile enable row level security;

drop policy if exists patient_blood_profile_select on public.patient_blood_profile;
create policy patient_blood_profile_select on public.patient_blood_profile
  for select using (
    patient_id = auth.uid()
    or private.is_org_staff(organisation_id)
    -- A consented supporter who can already read the clinical record can read
    -- this too; it is the same class of fact as a current medication.
    or private.can_read_clinical(patient_id)
  );

-- Only org staff write. A patient telling us their genotype is valuable but it
-- goes in through a clinician with source = 'patient_reported', so the card can
-- always say where the fact came from.
drop policy if exists patient_blood_profile_write on public.patient_blood_profile;
create policy patient_blood_profile_write on public.patient_blood_profile
  for all using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.patient_blood_profile to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.patient_blood_profile', 'SELECT') then
    raise exception 'patient_blood_profile: authenticated grant did not take';
  end if;
end $$;
