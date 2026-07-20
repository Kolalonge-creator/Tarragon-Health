-- ===========================================================================
-- Diabetes Clinical Pathway — Sprint E: pregnancy guard + red-flag attestation
-- ---------------------------------------------------------------------------
-- G26 (§20.2, a "never break" guarantee): any pregnant patient with diabetes
-- is obstetric-led and NOT routinely managed on the platform. This records a
-- pregnancy flag so the app can surface the obstetric-led banner and so the
-- drug-safety advisory contraindicates oral agents / ACEi-ARB in pregnancy.
-- G28 (§25): a doctor attests annually that they know and will act on the
-- diabetes red flags — tracked on clinical_staff (surfaced badge, like
-- indemnity; not a hard platform-wide block).
-- ===========================================================================

-- --- G26: pregnancy status (patient- or staff-set) --------------------------
create table if not exists public.patient_pregnancy (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null unique references public.profiles (id) on delete cascade,
  is_pregnant         boolean not null default false,
  estimated_due_date  date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists patient_pregnancy_org_idx on public.patient_pregnancy (organisation_id);

drop trigger if exists patient_pregnancy_set_updated_at on public.patient_pregnancy;
create trigger patient_pregnancy_set_updated_at
  before update on public.patient_pregnancy
  for each row execute function private.set_updated_at();

alter table public.patient_pregnancy enable row level security;

-- Patient manages their own status; org staff read all and may set it too.
drop policy if exists patient_pregnancy_select on public.patient_pregnancy;
create policy patient_pregnancy_select on public.patient_pregnancy
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists patient_pregnancy_insert on public.patient_pregnancy;
create policy patient_pregnancy_insert on public.patient_pregnancy
  for insert to authenticated
  with check ((patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
              or private.is_org_staff(organisation_id));
drop policy if exists patient_pregnancy_update on public.patient_pregnancy;
create policy patient_pregnancy_update on public.patient_pregnancy
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.patient_pregnancy to authenticated;

-- --- G28: annual red-flag attestation on clinical_staff ---------------------
alter table public.clinical_staff
  add column if not exists red_flag_attested_at date;

comment on column public.clinical_staff.red_flag_attested_at is
  'Date the doctor last attested they know/will act on the diabetes red flags (§25). Re-attest annually.';
