-- Screening cadence/age-gate fixes + PSA shared-decision-making gate.
--
-- Three real cadence bugs found comparing screen_types to the new ladder:
--   * hba1c.frequency_months was 6 — that's a diabetic-pathway monitoring
--     interval bled into the general-population screening row. General
--     screening for a non-diabetic adult should be annual.
--   * lipid_panel.age_from was 40 — the ladder wants it from 18.
--   * psa.age_from was 40 with no shared-decision-making gate at all — moves
--     to 45 (with recorded family history) or 50, 2-yearly, SDM-gated.

update public.screen_types set frequency_months = 12 where code = 'hba1c' and frequency_months = 6;
update public.screen_types set age_from = 18 where code = 'lipid_panel' and age_from = 40;
update public.screen_types set age_from = 45, frequency_months = 24 where code = 'psa';

-- ---------------------------------------------------------------------------
-- Shared-decision-making record for PSA. A patient (or clinician on their
-- behalf) records that the trade-offs of PSA screening were discussed before
-- the test proceeds. Order-level, not per-bundle: one record covers every
-- future PSA-containing order once made.
-- ---------------------------------------------------------------------------
create table if not exists public.patient_shared_decisions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  screen_type_code text not null references public.screen_types (code) on delete restrict,
  recorded_by      uuid references public.clinical_staff (id) on delete restrict,
  notes            text,
  created_at       timestamptz not null default now(),
  unique (patient_id, screen_type_code)
);

alter table public.patient_shared_decisions enable row level security;

drop policy if exists patient_shared_decisions_select on public.patient_shared_decisions;
create policy patient_shared_decisions_select on public.patient_shared_decisions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_shared_decisions_insert on public.patient_shared_decisions;
create policy patient_shared_decisions_insert on public.patient_shared_decisions
  for insert to authenticated
  with check (
    organisation_id = private.current_org_id()
    and (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  );

grant select, insert on public.patient_shared_decisions to authenticated;
revoke all on public.patient_shared_decisions from anon;

-- ---------------------------------------------------------------------------
-- Structural gate: a PSA screening_results row cannot be inserted for an
-- eligible-by-age male patient without a recorded shared-decision. This is
-- the DB-layer enforcement the original spec's build requirement #1 asked
-- for — a bundle order proceeds normally, but the PSA line specifically
-- cannot be resulted without the SDM step (surfaced to the app via the
-- exclusion mechanism in the pathway-suppression migration).
-- ---------------------------------------------------------------------------
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
  if new.screen_type_code <> 'psa' then
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
    raise exception 'PSA result cannot be recorded without a shared-decision-making record for this patient'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists screening_results_enforce_psa_sdm on public.screening_results;
create trigger screening_results_enforce_psa_sdm
  before insert on public.screening_results
  for each row execute function private.enforce_psa_sdm_gate();

do $$
declare
  v_row public.screen_types%rowtype;
begin
  select * into v_row from public.screen_types where code = 'hba1c';
  if v_row.frequency_months <> 12 then
    raise exception 'hba1c cadence fix did not apply';
  end if;

  select * into v_row from public.screen_types where code = 'lipid_panel';
  if v_row.age_from <> 18 then
    raise exception 'lipid_panel age gate fix did not apply';
  end if;

  select * into v_row from public.screen_types where code = 'psa';
  if v_row.age_from <> 45 or v_row.frequency_months <> 24 then
    raise exception 'psa age/frequency fix did not apply';
  end if;
end $$;
