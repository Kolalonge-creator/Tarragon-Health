-- Tarragon Health — service_regions: phased state-by-state rollout master switch
--
-- TarragonHealth launches one Nigerian state at a time (Lagos first, then Abuja, then
-- others) as real partners are contracted in each. This table is the canonical registry
-- of states AND the single admin-controlled go-live switch per state:
--
--   • `is_active = false` (the default) → the state is "dark": partner-dependent actions
--     (book a lab, order pharmacy, home collection, delivery, specialist referral) are
--     gated off and show a "coming soon + notify me" state, EVEN IF partner rows for that
--     state have already been loaded and activated. This is what lets ops enter every
--     Abuja partner ahead of launch while Abuja stays closed to patients.
--   • `is_active = true` → the state is live; a partner-dependent action becomes available
--     the moment an active partner of that service type also exists there (see
--     public.region_service_available in the next migration — BOTH gates must pass).
--
-- The Free / self-service tier (manual vitals, reminders, health record, education, risk
-- assessment) never touches this table — registration and self-service work everywhere,
-- including dark states and diaspora users. Only partner-dependent ACTIONS are gated.
--
-- State names are free text matching the existing convention on facilities.state /
-- pharmacy_partners.state / *.regions ("Lagos", "Abuja") — no Nigerian-states enum exists
-- anywhere in this codebase and one stays unwarranted (same note as profiles.state). The
-- FCT row uses state = 'Abuja' to match the value already present in seed/partner data.
--
-- Global reference data: authenticated read (the gate + signup/location dropdowns need
-- it), admin write — same posture as lab_providers / logistics_partners.

create table if not exists public.service_regions (
  id           uuid primary key default gen_random_uuid(),
  state        text not null unique,
  display_name text not null,
  is_active    boolean not null default false,
  activated_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists service_regions_active_idx
  on public.service_regions (state)
  where is_active;

drop trigger if exists service_regions_set_updated_at on public.service_regions;
create trigger service_regions_set_updated_at
  before update on public.service_regions
  for each row execute function private.set_updated_at();

alter table public.service_regions enable row level security;

drop policy if exists service_regions_select on public.service_regions;
create policy service_regions_select on public.service_regions
  for select to authenticated using (true);

drop policy if exists service_regions_insert on public.service_regions;
create policy service_regions_insert on public.service_regions
  for insert to authenticated with check (private.is_admin());

drop policy if exists service_regions_update on public.service_regions;
create policy service_regions_update on public.service_regions
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists service_regions_delete on public.service_regions;
create policy service_regions_delete on public.service_regions
  for delete to authenticated using (private.is_admin());

grant select on public.service_regions to authenticated;
grant insert, update, delete on public.service_regions to authenticated;

-- 36 states + FCT (as 'Abuja'). All seeded inactive; Lagos flipped live below.
insert into public.service_regions (state, display_name) values
  ('Abia', 'Abia'),
  ('Adamawa', 'Adamawa'),
  ('Akwa Ibom', 'Akwa Ibom'),
  ('Anambra', 'Anambra'),
  ('Bauchi', 'Bauchi'),
  ('Bayelsa', 'Bayelsa'),
  ('Benue', 'Benue'),
  ('Borno', 'Borno'),
  ('Cross River', 'Cross River'),
  ('Delta', 'Delta'),
  ('Ebonyi', 'Ebonyi'),
  ('Edo', 'Edo'),
  ('Ekiti', 'Ekiti'),
  ('Enugu', 'Enugu'),
  ('Gombe', 'Gombe'),
  ('Imo', 'Imo'),
  ('Jigawa', 'Jigawa'),
  ('Kaduna', 'Kaduna'),
  ('Kano', 'Kano'),
  ('Katsina', 'Katsina'),
  ('Kebbi', 'Kebbi'),
  ('Kogi', 'Kogi'),
  ('Kwara', 'Kwara'),
  ('Lagos', 'Lagos'),
  ('Nasarawa', 'Nasarawa'),
  ('Niger', 'Niger'),
  ('Ogun', 'Ogun'),
  ('Ondo', 'Ondo'),
  ('Osun', 'Osun'),
  ('Oyo', 'Oyo'),
  ('Plateau', 'Plateau'),
  ('Rivers', 'Rivers'),
  ('Sokoto', 'Sokoto'),
  ('Taraba', 'Taraba'),
  ('Yobe', 'Yobe'),
  ('Zamfara', 'Zamfara'),
  ('Abuja', 'Federal Capital Territory (Abuja)')
on conflict (state) do nothing;

-- Launch state: Lagos live. Guarded so re-running never re-stamps activated_at.
update public.service_regions
set is_active = true, activated_at = coalesce(activated_at, now())
where state = 'Lagos' and is_active = false;
