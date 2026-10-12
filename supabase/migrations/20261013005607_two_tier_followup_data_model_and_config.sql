-- Two-tier model, items 3 and 4 (docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md, D4, C5, C8): the data model.
--
--   * followup_config: versioned PROPOSED configuration for the monthly follow-up (the offers policy) and for the tiered call length.
--     Mirrored in packages/shared/src/proposed-config (keys followups.policy and consultations.call_length) by a drift test.
--   * member_followup_entitlements: one row per month of a Member's 365-day membership (12). No stockpile: an unused month lapses.
--   * followup_offers / followup_offer_slots: the doctor publishes several date-times for one Member, the Member picks one.
--   * encounters gets the length actually planned and the config version it used (INV-16), whether the Member asked for longer,
--     and minutes added by the doctor during the call.
--   * private.slot_is_open accepts a shorter booked length than the 30 minute session (10 to 30, on a 5 minute grid) so a 10, 15 or
--     20 minute call can be booked. With no call_length config it behaves exactly as before (the live definition was read first).
--
-- Rows at the time of writing: patient_memberships has 0 active rows on production, so nothing needs backfilling and no conversion step exists.
-- Nothing here changes a price. Patient and clinician access is through the functions of the next two migrations; the tables have no staff policy.

-- ---------------------------------------------------------------------------
-- 1. Versioned configuration
-- ---------------------------------------------------------------------------
create table public.followup_config (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('call_length', 'offers')),
  version integer not null check (version > 0),
  is_active boolean not null default false,
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  note text,
  created_at timestamptz not null default now(),
  unique (kind, version)
);
create unique index followup_config_one_active on public.followup_config (kind) where is_active;
alter table public.followup_config enable row level security;
create policy followup_config_read on public.followup_config for select to authenticated using (true);
revoke all on table public.followup_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on table public.followup_config from authenticated;
grant select on table public.followup_config to authenticated;
grant all on table public.followup_config to service_role;

-- Mirrors packages/shared/src/proposed-config key consultations.call_length (version 1). A drift test compares the two.
-- call-length-v1-begin
insert into public.followup_config (kind, version, is_active, config, note) values (
  'call_length', 1, true,
  $json${
    "routineMinutes": 15,
    "routineMinMinutes": 10,
    "longMinutes": 20,
    "yearlyResultsMinutes": 20,
    "abnormalLookbackDays": 90,
    "minMinutes": 10,
    "slotGridMinutes": 5,
    "maxExtensionMinutes": 15,
    "conditionStatuses": ["active", "controlled", "uncontrolled", "suspected", "under_investigation"],
    "abnormalFlags": ["low", "high", "critical", "positive"],
    "heldReleaseStates": ["awaiting_review", "clinician_disclosure_required", "withheld"]
  }$json$::jsonb,
  'PROPOSED, CMO decision C8 (2026-10-08): 20 minutes for the yearly results call and for a Member with a condition on the problem list or an abnormal or held result in the last 90 days; otherwise 15 minutes (a doctor may shorten a routine call to 10). Not yet confirmed.');
-- call-length-v1-end

-- Mirrors packages/shared/src/proposed-config key followups.policy (version 1).
-- followups-v1-begin
insert into public.followup_config (kind, version, is_active, config, note) values (
  'offers', 1, true,
  $json${
    "entitlementMonths": 12,
    "carryOverMonths": 0,
    "minSlots": 2,
    "maxSlots": 6,
    "offerValidHours": 72,
    "minLeadMinutes": 120,
    "bulkMaxPatients": 50,
    "lateCancelConsumes": true,
    "patientNoShowConsumes": false,
    "holdMinutes": 10
  }$json$::jsonb,
  'PROPOSED, founder decisions D4 and C5 (2026-10-08). One follow-up per membership month, no stockpile (carryOverMonths 0), a doctor offers 2 to 6 times valid for 72 hours. Not yet confirmed.');
-- followups-v1-end

create function private.followup_setting(p_kind text)
returns jsonb language sql stable security definer set search_path = ''
as $$ select config from public.followup_config where kind = p_kind and is_active $$;
revoke all on function private.followup_setting(text) from public, anon, authenticated;

create function private.followup_setting_version(p_kind text)
returns integer language sql stable security definer set search_path = ''
as $$ select version from public.followup_config where kind = p_kind and is_active $$;
revoke all on function private.followup_setting_version(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Monthly entitlement
-- ---------------------------------------------------------------------------
create table public.member_followup_entitlements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id uuid not null references public.profiles (id) on delete cascade,
  membership_id uuid not null references public.patient_memberships (id) on delete cascade,
  month_index smallint not null check (month_index between 1 and 24),
  period_start timestamptz not null,
  period_end timestamptz not null,
  state text not null default 'available' check (state in ('available', 'booked', 'consumed', 'lapsed', 'voided')),
  appointment_id uuid references public.appointments (id) on delete set null,
  consumed_at timestamptz,
  consumed_reason text,
  lapsed_at timestamptz,
  nudged_at timestamptz,
  config_version integer not null,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, month_index),
  check (period_end > period_start),
  check (state <> 'booked' or appointment_id is not null),
  check (state <> 'consumed' or consumed_at is not null)
);
create index member_followup_entitlements_patient_idx on public.member_followup_entitlements (patient_id, period_start);
create index member_followup_entitlements_open_idx on public.member_followup_entitlements (period_end) where state = 'available';
create index member_followup_entitlements_appointment_idx on public.member_followup_entitlements (appointment_id) where appointment_id is not null;
alter table public.member_followup_entitlements enable row level security;
-- The Member sees their own months. Staff have no policy: they read through the worklist function.
create policy member_followup_entitlements_own on public.member_followup_entitlements for select to authenticated
  using (patient_id = (select auth.uid()));
revoke all on table public.member_followup_entitlements from public, anon;
-- default privileges grant authenticated everything on a new table; a Member only ever reads, and writes go through the functions
revoke insert, update, delete, truncate, references, trigger on table public.member_followup_entitlements from authenticated;
grant select on table public.member_followup_entitlements to authenticated;
grant all on table public.member_followup_entitlements to service_role;

-- ---------------------------------------------------------------------------
-- 3. Offers and their slots
-- ---------------------------------------------------------------------------
create table public.followup_offers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id uuid not null references public.profiles (id) on delete cascade,
  clinician_id uuid not null references public.profiles (id) on delete restrict,
  entitlement_id uuid not null references public.member_followup_entitlements (id) on delete cascade,
  kind text not null default 'monthly' check (kind in ('monthly', 'yearly_results')),
  call_minutes integer not null check (call_minutes between 5 and 60),
  -- a coarse basis, deliberately not the reason: 'standard', 'longer_by_need' or 'yearly_results'. The clinician learns nothing about why.
  call_basis text not null check (call_basis in ('standard', 'longer_by_need', 'yearly_results')),
  call_config_version integer not null,
  followups_config_version integer not null,
  status text not null default 'open' check (status in ('open', 'picked', 'withdrawn', 'expired')),
  expires_at timestamptz not null,
  longer_requested boolean not null default false,
  picked_slot_id uuid,
  appointment_id uuid references public.appointments (id) on delete set null,
  closed_at timestamptz,
  closed_reason text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  check (status = 'open' or closed_at is not null)
);
-- One open offer per Member: a second set of times needs the first withdrawn, so a Member is never shown two competing lists.
create unique index followup_offers_one_open_per_patient on public.followup_offers (patient_id) where status = 'open';
create index followup_offers_clinician_idx on public.followup_offers (clinician_id, created_at desc);
create index followup_offers_entitlement_idx on public.followup_offers (entitlement_id);
create index followup_offers_appointment_idx on public.followup_offers (appointment_id) where appointment_id is not null;
create index followup_offers_expiry_idx on public.followup_offers (expires_at) where status = 'open';
alter table public.followup_offers enable row level security;
create policy followup_offers_own on public.followup_offers for select to authenticated
  using (patient_id = (select auth.uid()));
revoke all on table public.followup_offers from public, anon;
-- default privileges grant authenticated everything on a new table; a Member only ever reads, and writes go through the functions
revoke insert, update, delete, truncate, references, trigger on table public.followup_offers from authenticated;
grant select on table public.followup_offers to authenticated;
grant all on table public.followup_offers to service_role;

create table public.followup_offer_slots (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.followup_offers (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id uuid not null references public.profiles (id) on delete cascade,
  clinician_id uuid not null references public.profiles (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  state text not null default 'offered' check (state in ('offered', 'picked', 'released', 'withdrawn', 'expired', 'taken')),
  created_at timestamptz not null default now(),
  unique (offer_id, starts_at),
  check (ends_at > starts_at)
);
create index followup_offer_slots_clinician_idx on public.followup_offer_slots (clinician_id, starts_at) where state = 'offered';
alter table public.followup_offer_slots enable row level security;
create policy followup_offer_slots_own on public.followup_offer_slots for select to authenticated
  using (patient_id = (select auth.uid()));
revoke all on table public.followup_offer_slots from public, anon;
-- default privileges grant authenticated everything on a new table; a Member only ever reads, and writes go through the functions
revoke insert, update, delete, truncate, references, trigger on table public.followup_offer_slots from authenticated;
grant select on table public.followup_offer_slots to authenticated;
grant all on table public.followup_offer_slots to service_role;

alter table public.followup_offers
  add constraint followup_offers_picked_slot_fk foreign key (picked_slot_id) references public.followup_offer_slots (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. What the call turned out to be, on the encounter (INV-16)
-- ---------------------------------------------------------------------------
alter table public.encounters
  add column planned_minutes integer check (planned_minutes is null or planned_minutes between 5 and 90),
  add column call_length_basis text check (call_length_basis is null or call_length_basis in ('standard', 'longer_by_need', 'yearly_results')),
  add column call_length_config_version integer,
  add column extended_minutes integer not null default 0 check (extended_minutes between 0 and 60),
  add column longer_requested boolean not null default false;

do $$
declare v_name text;
begin
  select c.conname into v_name from pg_constraint c
   where c.conrelid = 'public.encounter_events'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%room_created%';
  if v_name is null then raise exception 'encounter_events kind check not found'; end if;
  execute format('alter table public.encounter_events drop constraint %I', v_name);
  alter table public.encounter_events add constraint encounter_events_kind_check check (kind = any (array[
    'room_created', 'joined', 'left', 'quality', 'mode_changed', 'fallback_offered', 'phone_requested', 'phone_connected',
    'reconnect_grace_started', 'no_show_marked', 'completed', 'cancelled', 'credit_returned', 'scribe_consent_asked',
    'scribe_consent_changed', 'host_key_issued', 'call_extended', 'longer_call_requested']));
end $$;

-- ---------------------------------------------------------------------------
-- 5. slot_is_open: a shorter booked length (live definition read with pg_get_functiondef on 2026-10-12).
--    The ONLY change is the length and grid test marked below. With no call_length config the old rule applies unchanged.
-- ---------------------------------------------------------------------------
create or replace function private.slot_is_open(p_clinician uuid, p_patient uuid, p_start timestamptz, p_end timestamptz, p_settling boolean default false)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  c jsonb := private.consult_policy();
  cl jsonb := private.followup_setting('call_length');
  v_len integer;
  v_min integer;
  v_grid integer;
  v_dur integer;
  v_test boolean := coalesce((select pr.is_test from public.profiles pr where pr.id = p_patient), false);
begin
  if c is null then return false; end if;
  v_len := (c ->> 'sessionMinutes')::integer;
  if v_len is null or v_len <= 0 then return false; end if;
  -- two-tier items 3 and 4: the booked length may be shorter than the session, never longer, on the configured grid
  v_min := coalesce((cl ->> 'minMinutes')::integer, v_len);
  v_grid := coalesce((cl ->> 'slotGridMinutes')::integer, v_len);
  v_dur := (extract(epoch from (p_end - p_start)) / 60)::integer;
  if p_end <> p_start + (v_dur * interval '1 minute') or v_dur < v_min or v_dur > v_len or mod(v_dur, v_grid) <> 0 then
    return false;
  end if;
  if not p_settling and (p_start < now() + ((c ->> 'bookingLeadMinutes')::integer * interval '1 minute')
                         or p_start >= now() + ((c ->> 'bookingHorizonDays')::integer * interval '1 day')) then
    return false;
  end if;
  return exists (
           select 1 from public.availability_blocks b
             join public.clinical_staff cs on cs.profile_id = b.clinician_id and cs.organisation_id = b.organisation_id
            where b.clinician_id = p_clinician
              and b.kind = 'bookable_consultations'
              and b.state = 'confirmed'
              and b.starts_at <= p_start and b.ends_at >= p_end
              and b.is_test = v_test
              and mod((extract(epoch from (p_start - b.starts_at)) / 60)::numeric, v_grid) = 0
              and cs.active
              and (cs.license_expires_at is null or cs.license_expires_at > p_end))
     and not exists (
           select 1 from public.provider_time_off t
            where t.clinician_id = p_clinician and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_start, p_end, '[)'))
     and not exists (
           select 1 from public.clinician_conflicts cf
            where cf.clinician_id = p_clinician and cf.patient_id = p_patient and cf.status <> 'lifted');
end;
$$;
-- create or replace keeps the live function's grants

-- ---------------------------------------------------------------------------
-- 6. Neutral notification templates (INV-07: no condition, reading, result or medicine; INV-08: never SMS)
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('followup_times_offered', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'Your care team has offered times for your monthly check-in.'),
  ('followup_offer_withdrawn', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'The times offered earlier are no longer available.'),
  ('followup_month_missed', 'operational', 'routine', 'patient', array['in_app','push','email']::public.notification_channel[], 'scheduled', 'A month passed with no check-in booked.'),
  ('followup_slot_picked', 'operational', 'routine', 'clinician', array['in_app']::public.notification_channel[], 'immediate', 'A member picked one of the offered times.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('followup_times_offered', 'en', 'in_app', 'Pick a time for your check-in', 'Your care team has offered some times for your monthly check-in. Open the app and choose the one that suits you.'),
  ('followup_times_offered', 'en', 'push', 'Pick a time for your check-in', 'Open the app to choose a time.'),
  ('followup_offer_withdrawn', 'en', 'in_app', 'Those times have changed', 'The times offered for your check-in are no longer available. Your care team will send new ones.'),
  ('followup_month_missed', 'en', 'in_app', 'Your monthly check-in is waiting', 'A month has passed without a check-in booked. Open the app to pick a time, or your care team will offer some.'),
  ('followup_month_missed', 'en', 'push', 'Your monthly check-in is waiting', 'Open the app to pick a time.'),
  ('followup_month_missed', 'en', 'email', 'Your monthly check-in is waiting', 'A month has passed without a check-in booked. Open the Tarragon Health app to pick a time, or your care team will offer some.'),
  ('followup_slot_picked', 'en', 'in_app', 'A time was picked', 'A member picked one of your offered times. See your check-ins.')
on conflict (template_key, locale, channel) do nothing;
