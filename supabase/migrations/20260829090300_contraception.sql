-- Sexual & Reproductive Health platform, 4/8: contraception (spec §47.7).
--
-- Two tables, same split as screen_types/screening_schedules: a global
-- reference catalogue (contraception_methods, admin-editable, no
-- organisation_id) and a patient-scoped record of what they've actually
-- requested/been prescribed (contraception_plans). Clinical assessment +
-- prescription is a real clinician action here (status transition +
-- null-gated prescribed_by), not a full pharmacy-dispensing integration —
-- linking to the existing pharmacy_orders system is a natural later step,
-- not required for a patient to see and choose a method today.
--
-- Confidential by construction: patient + org staff only, no profile_access.
-- In Nigeria's context that matters as much for an unmarried patient asking
-- about contraception as it does for an STI result — this module treats both
-- with the same privacy posture rather than picking and choosing.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'contraception_method_category') then
    create type public.contraception_method_category as enum (
      'hormonal_pill', 'injectable', 'implant', 'iud_hormonal', 'iud_copper',
      'barrier', 'permanent', 'natural_method', 'emergency'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'contraception_plan_status') then
    create type public.contraception_plan_status as enum (
      'requested', 'active', 'discontinued', 'completed', 'declined'
    );
  end if;
end $$;

create table if not exists public.contraception_methods (
  code                  text primary key,
  name                  text not null,
  category              public.contraception_method_category not null,
  description           text not null,
  typical_effectiveness_pct numeric(4, 1),
  requires_prescription boolean not null default true,
  is_active             boolean not null default true,
  sort_order            integer not null default 0
);

comment on table public.contraception_methods is
  'Global reference catalogue for contraception method education/comparison (spec §47.7). Admin-editable; not a prescribable SKU by itself — a contraception_plans row records what a specific patient actually chose/was prescribed.';

alter table public.contraception_methods enable row level security;
drop policy if exists contraception_methods_select on public.contraception_methods;
create policy contraception_methods_select on public.contraception_methods
  for select to authenticated using (true);
grant select on public.contraception_methods to authenticated;
revoke all on public.contraception_methods from anon;

insert into public.contraception_methods
  (code, name, category, description, typical_effectiveness_pct, requires_prescription, sort_order) values
  ('combined_pill', 'Combined oral contraceptive pill', 'hormonal_pill',
   'A daily pill combining oestrogen and progestin. Needs to be taken at a similar time each day to work well.', 91, true, 10),
  ('progestin_only_pill', 'Progestin-only pill (mini-pill)', 'hormonal_pill',
   'A daily progestin-only pill, an option when oestrogen is not suitable.', 91, true, 20),
  ('injectable_dmpa', 'Contraceptive injection (DMPA)', 'injectable',
   'A progestin injection given every 3 months at a clinic.', 94, true, 30),
  ('implant', 'Contraceptive implant', 'implant',
   'A small rod placed under the skin of the upper arm, lasting 3 to 5 years depending on the brand.', 99, true, 40),
  ('iud_hormonal', 'Hormonal IUD', 'iud_hormonal',
   'A small device placed in the womb releasing progestin, lasting 3 to 8 years depending on the brand.', 99, true, 50),
  ('iud_copper', 'Copper IUD', 'iud_copper',
   'A small hormone-free device placed in the womb, lasting up to 10 years and usable as emergency contraception within 5 days.', 99, true, 60),
  ('male_condom', 'Male condom', 'barrier',
   'A barrier method available without a prescription; the only method that also reduces STI transmission.', 87, false, 70),
  ('female_condom', 'Female condom', 'barrier',
   'A barrier method the receptive partner controls, available without a prescription.', 79, false, 80),
  ('tubal_ligation', 'Tubal ligation', 'permanent',
   'Permanent surgical contraception for someone who is certain they do not want future pregnancies.', 99.5, true, 90),
  ('vasectomy', 'Vasectomy', 'permanent',
   'Permanent surgical contraception for someone who is certain they do not want to father future pregnancies.', 99.9, true, 100),
  ('fertility_awareness', 'Fertility awareness / natural methods', 'natural_method',
   'Tracking the fertile window to avoid unprotected sex on fertile days. Effectiveness depends heavily on consistent, correct use.', 76, false, 110),
  ('emergency_pill', 'Emergency contraceptive pill', 'emergency',
   'A pill taken after unprotected sex; most effective the sooner it is taken. See Emergency Contraception for fast-track access.', 89, true, 120)
on conflict (code) do nothing;

create table if not exists public.contraception_plans (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  method_code           text not null references public.contraception_methods (code) on delete restrict,
  status                public.contraception_plan_status not null default 'requested',
  requested_at          timestamptz not null default now(),
  -- Null-gated: only set when a real clinical_staff row assessed/prescribed.
  prescribed_by         uuid references public.clinical_staff (id) on delete restrict,
  started_at            timestamptz,
  discontinued_at       timestamptz,
  discontinuation_reason text,
  follow_up_due_at      date,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists contraception_plans_patient_idx
  on public.contraception_plans (patient_id, created_at desc);
create index if not exists contraception_plans_pending_idx
  on public.contraception_plans (organisation_id) where status = 'requested';

drop trigger if exists contraception_plans_set_updated_at on public.contraception_plans;
create trigger contraception_plans_set_updated_at
  before update on public.contraception_plans
  for each row execute function private.set_updated_at();

alter table public.contraception_plans enable row level security;

drop policy if exists contraception_plans_select on public.contraception_plans;
create policy contraception_plans_select on public.contraception_plans
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists contraception_plans_insert on public.contraception_plans;
create policy contraception_plans_insert on public.contraception_plans
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and organisation_id = private.current_org_id()
    and status = 'requested'
    and prescribed_by is null
  );

-- Staff-only update: a clinical assessment moves status forward and stamps
-- prescribed_by server-side (never client-supplied) via the trigger below.
drop policy if exists contraception_plans_staff_update on public.contraception_plans;
create policy contraception_plans_staff_update on public.contraception_plans
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.contraception_plans to authenticated;
revoke all on public.contraception_plans from anon;

create or replace function private.enforce_contraception_plan_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  new.organisation_id := old.organisation_id;
  new.patient_id       := old.patient_id;
  new.method_code       := old.method_code;
  new.requested_at      := old.requested_at;
  new.created_at         := old.created_at;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = old.organisation_id
    and cs.active;

  if new.status = 'active' and old.status <> 'active' then
    if v_staff is null then
      raise exception 'only an active clinical staff member may activate a contraception plan' using errcode = '42501';
    end if;
    new.prescribed_by := v_staff;
    new.started_at := coalesce(new.started_at, now());
  elsif old.status = 'active' then
    -- Once prescribed, attribution is frozen; a correction is a new plan.
    new.prescribed_by := old.prescribed_by;
    new.started_at := old.started_at;
  else
    new.prescribed_by := old.prescribed_by;
  end if;

  if new.status = 'discontinued' and old.status = 'active' and old.discontinued_at is null then
    new.discontinued_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists contraception_plans_enforce_update on public.contraception_plans;
create trigger contraception_plans_enforce_update
  before update on public.contraception_plans
  for each row execute function private.enforce_contraception_plan_update();

do $$
begin
  if (select count(*) from public.contraception_methods) < 10 then
    raise exception 'FAIL: contraception_methods seed looks incomplete';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'contraception_plans') then
    raise exception 'FAIL: contraception_plans was not created';
  end if;
  raise notice 'PASS: contraception catalogue + patient plans installed';
end $$;
