-- Patient home layout: which tiles a patient pins to their Overview / Home screen.
--
-- LIVE COUNT BEFORE: no table of this name; nothing is converted. A patient with no row sees the same four tiles the Overview has always
-- shown (blood pressure, glucose, active medications, doses today), so shipping this changes nothing for anyone until they choose.
--
-- One row per patient, holding the pinned keys IN ORDER as a text array, so a re-order or a change is a single atomic write and the
-- difference between "never customised" (no row, show the defaults) and "chose to show nothing" (a row with an empty array) is kept.
-- The allowed keys mirror HOME_PIN_KEYS in packages/shared/src/home-pins.ts: a key added there needs a new migration here.
--
-- What this table does NOT hold: any clinical value. It is a display preference. The pins that cannot be removed (today's doses for
-- anyone taking a medication) are NOT enforced here, because they depend on live clinical data; the apps add them back on every read.
--
-- Written only by the patient themselves, for their own dashboard. A supporter acting for someone else sees that person's defaults and
-- has no policy to change their layout.

create table public.patient_home_layout (
  patient_id      uuid primary key references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  pinned          text[] not null default '{}'
                    check (
                      cardinality(pinned) <= 12
                      and pinned <@ array[
                        'bp', 'glucose', 'weight', 'pulse', 'spo2', 'temperature', 'waist', 'peak_flow',
                        'active_meds', 'doses_today',
                        'sleep', 'meals', 'exercise', 'symptoms', 'mood',
                        'labs', 'appointments', 'screenings', 'messages'
                      ]::text[]
                    ),
  updated_at      timestamptz not null default now()
);

comment on table public.patient_home_layout is
  'Which tiles the patient pins to their home screen, in order. A display preference only. No row = defaults; empty array = chose to show nothing. Keys mirror HOME_PIN_KEYS in packages/shared/src/home-pins.ts. Pins that cannot be removed are added back by the apps on read, not enforced here.';

create trigger patient_home_layout_set_updated_at
  before update on public.patient_home_layout
  for each row execute function private.set_updated_at();

alter table public.patient_home_layout enable row level security;
revoke all on public.patient_home_layout from public, anon, authenticated;
grant select, insert, update on public.patient_home_layout to authenticated;

create policy patient_home_layout_select on public.patient_home_layout
  for select to authenticated using (patient_id = (select auth.uid()));
create policy patient_home_layout_insert on public.patient_home_layout
  for insert to authenticated
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());
create policy patient_home_layout_update on public.patient_home_layout
  for update to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());

-- Registrations: data registry (the minor-dependant guard attaches itself when a patient_id table is created).
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('patient_home_layout', 'patient_id', 'operational', 'delete', true,
   'A display preference (which tiles are pinned to the home screen). PROPOSED class, to be confirmed by the CMO and DPO.')
on conflict (table_name) do nothing;

-- Self-checks
do $$
begin
  if has_table_privilege('anon', 'public.patient_home_layout', 'SELECT') then
    raise exception 'patient_home_layout: anon can read the table';
  end if;
  if has_table_privilege('authenticated', 'public.patient_home_layout', 'DELETE') then
    raise exception 'patient_home_layout: a client can delete rows directly';
  end if;
  if exists (select 1 from private.minor_guard_gaps()) then
    raise exception 'patient_home_layout: minor guard gaps: %',
      (select string_agg(table_name || ' (' || problem || ')', ', ') from private.minor_guard_gaps());
  end if;
  if not exists (select 1 from public.data_registry where table_name = 'patient_home_layout') then
    raise exception 'patient_home_layout: not in the data registry';
  end if;
end $$;
