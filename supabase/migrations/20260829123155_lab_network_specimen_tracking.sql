-- Laboratory Network, part 5: sample tracking with a unique specimen
-- identifier (§56.9).
--
-- Every specimen gets its own row and its own number, separate from
-- lab_orders.status — an order can be re-drawn (rejection/recollection,
-- §56.10) without losing the history of the first attempt, which a single
-- status column on lab_orders could never represent. organisation_id,
-- patient_id and provider_id are denormalised from the parent order onto
-- the specimen row (platform convention — "every table has organisation_id,
-- always filter by it") so RLS here needs no join back to lab_orders.

create type public.lab_specimen_status as enum (
  'pending_collection', 'collected', 'in_transit', 'received', 'processing', 'completed', 'rejected'
);

create type public.lab_specimen_collection_method as enum (
  'facility_visit', 'home_collection'
);

-- §56.10's own list, verbatim.
create type public.lab_specimen_rejection_reason as enum (
  'insufficient_sample', 'incorrect_container', 'wrong_labelling', 'delayed_transport', 'damaged_specimen'
);

create sequence public.lab_specimen_number_seq;

create table public.lab_specimens (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  lab_order_id       uuid not null references public.lab_orders (id) on delete cascade,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  provider_id        uuid references public.lab_providers (id) on delete set null,
  specimen_number    text not null unique default ('SPX-' || to_char(nextval('public.lab_specimen_number_seq'), 'FM000000')),
  status             public.lab_specimen_status not null default 'pending_collection',
  collection_method  public.lab_specimen_collection_method not null default 'facility_visit',
  collected_at       timestamptz,
  in_transit_at      timestamptz,
  received_at        timestamptz,
  processing_at      timestamptz,
  completed_at       timestamptz,
  rejected_at        timestamptz,
  rejection_reason   public.lab_specimen_rejection_reason,
  rejection_notes    text,
  recollection_of    uuid references public.lab_specimens (id) on delete set null,
  courier_reference  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint lab_specimens_rejection_fields_together
    check ((status = 'rejected') = (rejected_at is not null and rejection_reason is not null))
);

create index lab_specimens_order_idx on public.lab_specimens (lab_order_id);
create index lab_specimens_patient_idx on public.lab_specimens (patient_id, created_at desc);
create index lab_specimens_provider_status_idx on public.lab_specimens (provider_id, status);
create index lab_specimens_recollection_idx on public.lab_specimens (recollection_of) where recollection_of is not null;

create trigger lab_specimens_set_updated_at
  before update on public.lab_specimens
  for each row execute function private.set_updated_at();

alter table public.lab_specimens enable row level security;

-- Same visibility shape as lab_orders_select (20260731181143) plus the lab
-- partner branch lab_partner_orders already relies on.
create policy lab_specimens_select on public.lab_specimens
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
    or (provider_id is not null and provider_id = private.lab_partner_provider())
  );

-- Direct table writes are staff/lab-partner only — a patient never creates
-- or edits their own specimen row; creation is automatic (trigger below) and
-- status progress is recorded by whoever is actually handling the sample.
create policy lab_specimens_insert on public.lab_specimens
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    or (provider_id is not null and provider_id = private.lab_partner_provider())
  );

create policy lab_specimens_update on public.lab_specimens
  for update to authenticated
  using (
    private.is_org_staff(organisation_id)
    or (provider_id is not null and provider_id = private.lab_partner_provider())
  )
  with check (
    private.is_org_staff(organisation_id)
    or (provider_id is not null and provider_id = private.lab_partner_provider())
  );

grant select, insert, update on public.lab_specimens to authenticated;

-- ---------------------------------------------------------------------------
-- A specimen record starts to exist the moment a partner-fulfilled order is
-- real enough to draw against — payment_confirmed for a patient-paid order,
-- or straight to 'ordered' for a clinician-originated one that carries no
-- payment step. Self-arranged orders get no specimen row: Tarragon never
-- takes custody of that sample, so there is nothing here to track.
-- ---------------------------------------------------------------------------
create or replace function private.create_lab_specimen_on_order_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fulfilment is distinct from 'partner' then
    return new;
  end if;
  if new.status not in ('payment_confirmed', 'ordered') then
    return new;
  end if;
  if old is not null and old.status = new.status then
    return new;
  end if;
  if exists (select 1 from public.lab_specimens where lab_order_id = new.id) then
    return new;
  end if;

  insert into public.lab_specimens (organisation_id, lab_order_id, patient_id, provider_id)
  values (new.organisation_id, new.id, new.patient_id, coalesce(new.provider_id, new.partner_cost_provider_id));

  return new;
end;
$$;

revoke all on function private.create_lab_specimen_on_order_ready() from public;

drop trigger if exists lab_orders_create_specimen on public.lab_orders;
create trigger lab_orders_create_specimen
  after insert or update of status on public.lab_orders
  for each row execute function private.create_lab_specimen_on_order_ready();

-- ---------------------------------------------------------------------------
-- Advancing a specimen through the pipeline. One function, not five, because
-- every transition needs the same ownership check and the same "record the
-- matching timestamp" behaviour — five near-identical RPCs would be five
-- places to keep that logic consistent. Rejection is deliberately excluded
-- (its own function in the next migration handles the recollection branch).
-- ---------------------------------------------------------------------------
create or replace function public.lab_partner_update_specimen_status(
  p_specimen_id uuid,
  p_status      public.lab_specimen_status,
  p_courier_reference text default null
)
returns public.lab_specimens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_specimen public.lab_specimens%rowtype;
  v_rank constant text[] := array['pending_collection','collected','in_transit','received','processing','completed'];
  v_from_rank int;
  v_to_rank int;
begin
  if p_status = 'rejected' then
    raise exception 'use lab_partner_reject_specimen to reject a specimen' using errcode = '23514';
  end if;

  select * into v_specimen from public.lab_specimens where id = p_specimen_id;
  if v_specimen.id is null then
    raise exception 'specimen not found' using errcode = '42501';
  end if;
  -- Written as three explicit OR'd null-checks rather than
  -- "provider_id <> lab_partner_provider()" — with SQL's three-valued logic,
  -- <> against a NULL lab_partner_provider() (i.e. the caller is not a lab
  -- partner at all) evaluates to NULL, and PL/pgSQL's `if null then` does
  -- NOT raise (NULL is treated as not-true, so the exception is silently
  -- skipped) — an authorization bypass for exactly the caller this check
  -- exists to refuse. Caught by the local dependency-check harness before
  -- this ever reached a real database; see the migration series' own
  -- validation notes.
  if v_specimen.provider_id is null
     or private.lab_partner_provider() is null
     or v_specimen.provider_id <> private.lab_partner_provider() then
    raise exception 'not authorized for this specimen' using errcode = '42501';
  end if;
  if v_specimen.status = 'rejected' then
    raise exception 'a rejected specimen cannot be advanced — see recollection_of for the replacement specimen' using errcode = '23514';
  end if;

  v_from_rank := array_position(v_rank, v_specimen.status::text);
  v_to_rank := array_position(v_rank, p_status::text);
  if v_to_rank < v_from_rank then
    raise exception 'cannot move a specimen backwards from % to %', v_specimen.status, p_status using errcode = '23514';
  end if;

  update public.lab_specimens
     set status = p_status,
         collected_at  = case when p_status = 'collected'  then coalesce(collected_at, now())  else collected_at  end,
         in_transit_at = case when p_status = 'in_transit' then coalesce(in_transit_at, now()) else in_transit_at end,
         received_at   = case when p_status = 'received'   then coalesce(received_at, now())   else received_at   end,
         processing_at = case when p_status = 'processing' then coalesce(processing_at, now()) else processing_at end,
         completed_at  = case when p_status = 'completed'  then coalesce(completed_at, now())  else completed_at  end,
         courier_reference = coalesce(p_courier_reference, courier_reference)
   where id = p_specimen_id
   returning * into v_specimen;

  return v_specimen;
end;
$$;

revoke all on function public.lab_partner_update_specimen_status(uuid, public.lab_specimen_status, text) from public, anon;
grant execute on function public.lab_partner_update_specimen_status(uuid, public.lab_specimen_status, text) to authenticated;

-- Backfill: the trigger above only fires on a future insert/status change,
-- so any partner order that reached payment_confirmed/ordered before this
-- migration ran needs its specimen row created explicitly, once, here.
insert into public.lab_specimens (organisation_id, lab_order_id, patient_id, provider_id)
select lo.organisation_id, lo.id, lo.patient_id, coalesce(lo.provider_id, lo.partner_cost_provider_id)
  from public.lab_orders lo
 where lo.fulfilment = 'partner'
   and lo.status in ('payment_confirmed', 'ordered')
   and not exists (select 1 from public.lab_specimens ls where ls.lab_order_id = lo.id);

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'lab_specimens') then
    raise exception 'lab_specimens was not created';
  end if;
  if not has_table_privilege('authenticated', 'public.lab_specimens', 'SELECT') then
    raise exception 'authenticated must be able to read lab_specimens';
  end if;
  -- The trigger is live and the backfill above ran: every existing partner
  -- order already payment_confirmed/ordered should now have exactly one specimen.
  if exists (
    select 1 from public.lab_orders lo
    where lo.fulfilment = 'partner' and lo.status in ('payment_confirmed', 'ordered')
      and not exists (select 1 from public.lab_specimens ls where ls.lab_order_id = lo.id)
  ) then
    raise exception 'a partner order in payment_confirmed/ordered status has no specimen row';
  end if;
end $$;
