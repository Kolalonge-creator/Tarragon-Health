-- Tarragon Health — Care Coordination Build 2: reference numbers,
-- specialist provider catalogue, and commission rate-type refinement.
--
-- Single migration: sequences/functions/a brand-new enum type are all DDL
-- that can be created and used in the same transaction — the Postgres
-- same-transaction restriction only applies to ADD VALUE on an *existing*
-- enum type (see the separate booking_status_enum_values migration).

-- ---------------------------------------------------------------------------
-- Shared reference-number generator
-- ---------------------------------------------------------------------------

create sequence private.patient_number_seq;
create sequence private.lab_order_number_seq;
create sequence private.pharmacy_order_number_seq;
create sequence private.referral_number_seq;

create or replace function private.next_reference(prefix text, seq regclass)
returns text
language sql
as $$
  select prefix || lpad(nextval(seq)::text, 6, '0');
$$;

-- ---------------------------------------------------------------------------
-- profiles.patient_number
--
-- Fires on BEFORE INSERT OR UPDATE (not INSERT-only): private.handle_new_user()
-- sets role directly in its INSERT, so INSERT alone would cover the common
-- case, but the documented two-step staff-provisioning path (createUser()
-- defaults to role='patient', then a later updateUserById({app_metadata})
-- becomes an UPDATE via private.sync_user_profile_from_metadata()) means role
-- can only become (or stop being) 'patient' after the row already exists.
-- Guarding on `patient_number is null` makes this naturally idempotent and
-- correct regardless of which event first makes role='patient' true.
-- ---------------------------------------------------------------------------

alter table public.profiles add column patient_number text unique;

create or replace function private.assign_patient_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'patient' and new.patient_number is null then
    new.patient_number := private.next_reference('TH-', 'private.patient_number_seq'::regclass);
  end if;
  return new;
end;
$$;

create trigger profiles_assign_patient_number
  before insert or update on public.profiles
  for each row execute function private.assign_patient_number();

-- Backfill existing patient profiles via a no-op self-update, so the trigger
-- above does the assigning rather than duplicating its logic here.
update public.profiles set role = role where role = 'patient' and patient_number is null;

-- ---------------------------------------------------------------------------
-- Order/referral reference numbers — BEFORE INSERT only, no async-role-style
-- ambiguity (orders are fully formed at creation).
-- ---------------------------------------------------------------------------

alter table public.lab_orders add column order_number text unique;
alter table public.pharmacy_orders add column order_number text unique;
alter table public.specialist_referrals add column referral_number text unique;

create or replace function private.assign_lab_order_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.order_number is null then
    new.order_number := private.next_reference('LAB-', 'private.lab_order_number_seq'::regclass);
  end if;
  return new;
end;
$$;
create trigger lab_orders_assign_order_number
  before insert on public.lab_orders
  for each row execute function private.assign_lab_order_number();

create or replace function private.assign_pharmacy_order_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.order_number is null then
    new.order_number := private.next_reference('RX-', 'private.pharmacy_order_number_seq'::regclass);
  end if;
  return new;
end;
$$;
create trigger pharmacy_orders_assign_order_number
  before insert on public.pharmacy_orders
  for each row execute function private.assign_pharmacy_order_number();

create or replace function private.assign_referral_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.referral_number is null then
    new.referral_number := private.next_reference('REF-', 'private.referral_number_seq'::regclass);
  end if;
  return new;
end;
$$;
create trigger specialist_referrals_assign_referral_number
  before insert on public.specialist_referrals
  for each row execute function private.assign_referral_number();

-- Backfill any existing rows created before this migration (e.g. real
-- specialist_referrals rows drafted by AbnormalResultHandler). Postgres
-- re-evaluates volatile functions like nextval() per row in an UPDATE's SET
-- clause, so each row gets a distinct sequential number, not one value
-- copied to every row.
update public.lab_orders
  set order_number = private.next_reference('LAB-', 'private.lab_order_number_seq'::regclass)
  where order_number is null;
update public.pharmacy_orders
  set order_number = private.next_reference('RX-', 'private.pharmacy_order_number_seq'::regclass)
  where order_number is null;
update public.specialist_referrals
  set referral_number = private.next_reference('REF-', 'private.referral_number_seq'::regclass)
  where referral_number is null;

-- ---------------------------------------------------------------------------
-- Commission rate-type refinement
-- ---------------------------------------------------------------------------

create type public.commission_rate_type as enum ('percentage', 'flat');

alter table public.lab_tests
  add column commission_rate_type public.commission_rate_type not null default 'percentage',
  add column commission_flat_kobo bigint;

alter table public.pharmacy_medications
  add column commission_rate numeric(5, 4),
  add column commission_rate_type public.commission_rate_type not null default 'percentage',
  add column commission_flat_kobo bigint;

alter table public.commissions
  add column rate_type public.commission_rate_type not null default 'percentage',
  add column source_reference text;

comment on column public.commissions.source_reference is
  'Human-readable counterpart to source_id (LAB-.../RX-.../REF-...). Populated by whichever Build 3-5 server action first writes a commission row.';

-- ---------------------------------------------------------------------------
-- specialist_providers — NEW catalogue table, mirrors lab_providers/
-- pharmacy_partners exactly (global, no organisation_id, authenticated-read/
-- admin-write RLS).
-- ---------------------------------------------------------------------------

create table public.specialist_providers (
  id                     uuid primary key default gen_random_uuid(),
  specialist_type        public.specialist_type not null,
  name                   text not null,
  location               text,
  consultation_fee_kobo  bigint not null default 0,
  commission_rate_type   public.commission_rate_type not null default 'percentage',
  commission_rate        numeric(5, 4),
  commission_flat_kobo   bigint,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now()
);

create index specialist_providers_type_idx on public.specialist_providers (specialist_type);

alter table public.specialist_providers enable row level security;

create policy specialist_providers_select on public.specialist_providers
  for select to authenticated using (true);
create policy specialist_providers_insert on public.specialist_providers
  for insert to authenticated with check (private.is_admin());
create policy specialist_providers_update on public.specialist_providers
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy specialist_providers_delete on public.specialist_providers
  for delete to authenticated using (private.is_admin());

grant select on public.specialist_providers to authenticated;
grant insert, update, delete on public.specialist_providers to authenticated;

-- Placeholder partner names — no real specialist partner contracts exist yet
-- (same posture as the /about page's bracketed founder-bio placeholder).
-- Flat consultation fee, percentage commission by default; ops can correct
-- both once real partner terms are negotiated.
insert into public.specialist_providers (specialist_type, name, location, consultation_fee_kobo, commission_rate_type, commission_rate) values
  ('urologist',     '[Placeholder] Lagos Urology Partners',        'Lagos',  1500000, 'percentage', 0.15),
  ('oncologist',     '[Placeholder] Lagos Oncology Partners',       'Lagos',  2000000, 'percentage', 0.15),
  ('ob_gyn',         '[Placeholder] Women''s Health Partners',      'Lagos',  1500000, 'percentage', 0.15),
  ('cardiology',     '[Placeholder] Cardiology Referral Network',   'Lagos',  1800000, 'percentage', 0.15),
  ('endocrinology',  '[Placeholder] Endocrinology Referral Network','Lagos',  1500000, 'percentage', 0.15),
  ('nephrology',     '[Placeholder] Nephrology Referral Network',   'Lagos',  1800000, 'percentage', 0.15),
  ('ophthalmology',  '[Placeholder] Ophthalmology Referral Network','Lagos',  1200000, 'percentage', 0.15),
  ('dietetics',      '[Placeholder] Dietetics Referral Network',    'Lagos',   800000, 'percentage', 0.15),
  ('podiatry',       '[Placeholder] Podiatry Referral Network',     'Lagos',   800000, 'percentage', 0.15);
