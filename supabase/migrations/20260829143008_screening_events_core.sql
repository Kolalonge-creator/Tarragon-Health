-- Community and Group Screening Days (revenue-architecture spec §8/Line 4).
--
-- "Bring thirty people. We bring SYNLAB. Everyone gets tested, everyone gets
-- a video consult that week, at a group rate" — sold to churches, mosques,
-- market associations, alumni groups, hometown unions and small employers.
-- This is a bulk, staff-mediated sale: one organiser (a pastor, an imam, an
-- association secretary, an HR manager) commits to a headcount and pays a
-- deposit + balance for the group; a coordinator then registers each real
-- participant on the day.
--
-- Design choice worth being explicit about: a prepaid_service care_voucher
-- REQUIRES a real beneficiary_profile_id and a real purchaser_profile_id
-- (care_vouchers_kind_shape, 20260731215012) — there is deliberately no
-- "anonymous slot" voucher, because non-transferability is a structural
-- guarantee of that table, not a convention. So this does NOT pre-issue N
-- blank vouchers before the event; it pre-authorises N REGISTRATIONS (paid
-- for as a block by the organiser), and each on-site registration mints one
-- real voucher for one real, consenting, now-identified participant at the
-- moment their identity is captured. registered_count is the capacity
-- counter that enforces the organiser's paid-for headcount.
--
-- Payment is staff-recorded (deposit then balance transferred to Tarragon's
-- account), not a real-time Paystack/Stripe checkout — deliberately: this is
-- an inherently relationship-mediated B2B sale (§8's non-technical build:
-- "a one-page group proposal... signable by an association chairman without
-- a legal review"), the deposit/balance amounts are negotiated per event
-- rather than a fixed SKU price, and wiring a new checkout kind would mean
-- touching the shared Paystack/stripe webhook dispatch trigger that every
-- other payment path relies on. A self-serve organiser payment link is a
-- reasonable fast-follow once there is real event volume to justify it.
--
-- Aggregate, anonymised organiser reporting (e.g. "18% of your congregation
-- had raised blood pressure") is explicitly NOT built in this migration —
-- it requires joining to result-flag data across whatever condition
-- taxonomy applies, which is real additional work; what's here is
-- registration + capacity + payment-state tracking, which is the load-
-- bearing part (never showing an organiser row-level results, ever).

create type public.screening_event_organiser_type as enum (
  'church', 'mosque', 'market_association', 'alumni_association',
  'hometown_union', 'cooperative_society', 'sme', 'other'
);

create type public.screening_event_status as enum (
  'proposed', 'deposit_paid', 'confirmed', 'completed', 'cancelled'
);

create table public.screening_events (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,

  -- The organiser is a real Tarragon profile (provisioned by staff if they
  -- don't already have one) because they become the purchaser_profile_id on
  -- every voucher this event issues — care_vouchers_kind_shape requires a
  -- real purchaser, and it is also who the aggregate report (once built)
  -- would be shown to.
  organiser_profile_id   uuid not null references public.profiles (id) on delete restrict,
  organiser_name         text not null,
  organiser_phone        text not null,
  organiser_type         public.screening_event_organiser_type not null,

  panel_bundle_id        uuid not null references public.panel_bundles (id) on delete restrict,
  price_per_person_kobo  bigint not null check (price_per_person_kobo > 0),
  headcount_target       integer not null check (headcount_target > 0),
  registered_count       integer not null default 0 check (registered_count >= 0),

  event_date             date not null,
  location_text          text not null,

  deposit_kobo           bigint not null default 0 check (deposit_kobo >= 0),
  deposit_paid_at        timestamptz,
  balance_kobo           bigint not null default 0 check (balance_kobo >= 0),
  balance_paid_at        timestamptz,

  -- "Be explicit and clean about this... Nigerian intermediaries expect to
  -- be compensated; the failure mode is not paying them, it is paying them
  -- opaquely. Put it in writing." A free text note (e.g. "organiser's own
  -- check free, 31 registered") rather than a computed field — the terms
  -- are agreed per event, not derived.
  organiser_incentive_note text,

  agent_id               uuid references public.community_agents (id) on delete set null,
  status                 public.screening_event_status not null default 'proposed',
  created_by             uuid not null references public.profiles (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint screening_events_registered_within_target check (registered_count <= headcount_target),
  constraint screening_events_confirmed_has_balance_terms check (
    status not in ('confirmed', 'completed') or (deposit_paid_at is not null)
  ),
  constraint screening_events_organiser_phone_e164 check (organiser_phone ~ '^\+[1-9][0-9]{7,14}$')
);

create index screening_events_org_idx on public.screening_events (organisation_id, status, event_date);
create index screening_events_organiser_idx on public.screening_events (organiser_profile_id);

create trigger screening_events_set_updated_at
  before update on public.screening_events
  for each row execute function private.set_updated_at();

alter table public.care_vouchers
  add column screening_event_id uuid references public.screening_events (id) on delete set null;
create index care_vouchers_screening_event_idx
  on public.care_vouchers (screening_event_id) where screening_event_id is not null;

-- ---------------------------------------------------------------------------
-- RLS. Staff manage; the organiser reads their own event only (status,
-- counts, payment state — never a participant list, never any clinical
-- content).
-- ---------------------------------------------------------------------------

alter table public.screening_events enable row level security;

create policy screening_events_select on public.screening_events
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or organiser_profile_id = (select auth.uid())
  );

create policy screening_events_write on public.screening_events
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.screening_events to authenticated;

-- ---------------------------------------------------------------------------
-- Staff-facing lifecycle RPCs. Creation is staff-only (the organiser
-- doesn't self-serve a B2B proposal); deposit/balance are recorded once
-- staff confirm the transfer landed, matching "never fulfil on a promise of
-- collection" from §8.
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_screening_event(
  p_organiser_profile_id uuid,
  p_organiser_name text,
  p_organiser_phone text,
  p_organiser_type public.screening_event_organiser_type,
  p_panel_bundle_id uuid,
  p_price_per_person_kobo bigint,
  p_headcount_target integer,
  p_event_date date,
  p_location_text text,
  p_deposit_kobo bigint default 0,
  p_organiser_incentive_note text default null,
  p_agent_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_agent_id uuid;
  v_event_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select organisation_id into v_org from public.profiles where id = v_caller;
  if v_org is null or not private.is_org_staff(v_org) then
    raise exception 'not authorised to create a screening event' using errcode = '42501';
  end if;
  if p_organiser_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'organiser phone must be E.164, e.g. +234XXXXXXXXXX';
  end if;

  if p_agent_code is not null then
    select id into v_agent_id from public.community_agents
      where agent_code = upper(trim(p_agent_code)) and status = 'active';
  end if;

  insert into public.screening_events (
    organisation_id, organiser_profile_id, organiser_name, organiser_phone, organiser_type,
    panel_bundle_id, price_per_person_kobo, headcount_target, event_date, location_text,
    deposit_kobo, organiser_incentive_note, agent_id, created_by
  ) values (
    v_org, p_organiser_profile_id, p_organiser_name, p_organiser_phone, p_organiser_type,
    p_panel_bundle_id, p_price_per_person_kobo, p_headcount_target, p_event_date, p_location_text,
    p_deposit_kobo, p_organiser_incentive_note, v_agent_id, v_caller
  ) returning id into v_event_id;

  return jsonb_build_object('ok', true, 'event_id', v_event_id);
end;
$$;

create or replace function public.admin_record_screening_event_deposit(p_event_id uuid, p_amount_kobo bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evt public.screening_events%rowtype;
begin
  select * into v_evt from public.screening_events where id = p_event_id for update;
  if not found then raise exception 'event not found'; end if;
  if not private.is_org_staff(v_evt.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  update public.screening_events
     set deposit_kobo = p_amount_kobo, deposit_paid_at = now(), status = 'deposit_paid'
   where id = p_event_id and status = 'proposed';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Event is not awaiting a deposit.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Confirms the event: balance received in full, capacity is now bookable.
create or replace function public.admin_record_screening_event_balance(p_event_id uuid, p_amount_kobo bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evt public.screening_events%rowtype;
begin
  select * into v_evt from public.screening_events where id = p_event_id for update;
  if not found then raise exception 'event not found'; end if;
  if not private.is_org_staff(v_evt.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  update public.screening_events
     set balance_kobo = p_amount_kobo, balance_paid_at = now(), status = 'confirmed'
   where id = p_event_id and status = 'deposit_paid';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Event has not had its deposit recorded yet.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- On-site registration: one real, consenting, now-identified participant ->
-- one real voucher. p_participant_id must already be a real profile — the
-- caller (a coordinator's server action) provisions it first via
-- auth.admin.createUser keyed on phone, the same pattern
-- add-child-actions.ts already uses for a dependent, then calls this.
create or replace function public.register_screening_event_participant(
  p_event_id uuid,
  p_participant_id uuid,
  p_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_evt public.screening_events%rowtype;
  v_bundle record;
  v_code text;
  v_voucher_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_consent is not true then
    return jsonb_build_object('ok', false, 'error', 'Consent is required to register a participant.');
  end if;

  select * into v_evt from public.screening_events where id = p_event_id for update;
  if not found then raise exception 'event not found'; end if;
  if not private.is_org_staff(v_evt.organisation_id) then
    raise exception 'not authorised to register participants for this event' using errcode = '42501';
  end if;
  if v_evt.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'error', 'This event is not confirmed for registration yet.');
  end if;
  if v_evt.registered_count >= v_evt.headcount_target then
    return jsonb_build_object('ok', false, 'error', 'This event has reached its paid-for headcount.');
  end if;

  select code, name into v_bundle from public.panel_bundles where id = v_evt.panel_bundle_id;

  v_code := private.next_voucher_number();

  insert into public.care_vouchers (
    organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id,
    panel_bundle_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status,
    activated_at, screening_event_id
  ) values (
    v_evt.organisation_id, v_code, 'prepaid_service', p_participant_id, v_evt.organiser_profile_id,
    v_evt.panel_bundle_id, v_bundle.code, v_bundle.name, v_evt.price_per_person_kobo, v_evt.price_per_person_kobo,
    'active', now(), v_evt.id
  ) returning id into v_voucher_id;

  insert into public.care_voucher_events
    (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
  values
    (v_evt.organisation_id, v_voucher_id, 'activated', v_caller, v_evt.price_per_person_kobo,
     'Issued at screening event: ' || v_evt.organiser_name);

  update public.screening_events set registered_count = registered_count + 1 where id = p_event_id;

  return jsonb_build_object('ok', true, 'voucher_id', v_voucher_id, 'voucher_number', v_code);
end;
$$;

revoke all on function public.admin_create_screening_event(
  uuid, text, text, public.screening_event_organiser_type, uuid, bigint, integer, date, text, bigint, text, text
) from public, anon;
revoke all on function public.admin_record_screening_event_deposit(uuid, bigint) from public, anon;
revoke all on function public.admin_record_screening_event_balance(uuid, bigint) from public, anon;
revoke all on function public.register_screening_event_participant(uuid, uuid, boolean) from public, anon;
grant execute on function public.admin_create_screening_event(
  uuid, text, text, public.screening_event_organiser_type, uuid, bigint, integer, date, text, bigint, text, text
) to authenticated;
grant execute on function public.admin_record_screening_event_deposit(uuid, bigint) to authenticated;
grant execute on function public.admin_record_screening_event_balance(uuid, bigint) to authenticated;
grant execute on function public.register_screening_event_participant(uuid, uuid, boolean) to authenticated;

-- Screening-event registration also earns an agent commission, same
-- completion-gated posture as the other two source types (part 2 of the
-- Community Agents migrations) — added here because screening_events didn't
-- exist yet when that migration ran. INSERT, not UPDATE:
-- register_screening_event_participant creates the voucher already 'active'
-- with screening_event_id set in one statement, so there is no separate
-- transition to catch — this must fire on insert.
create or replace function private.agent_commission_on_screening_registration_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid;
begin
  if new.screening_event_id is not null and new.status = 'active' then
    select agent_id into v_agent from public.screening_events where id = new.screening_event_id;
    perform private.record_agent_commission(
      v_agent, new.organisation_id, 'screening_event_registration', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists care_vouchers_screening_agent_commission on public.care_vouchers;
create trigger care_vouchers_screening_agent_commission
  after insert on public.care_vouchers
  for each row execute function private.agent_commission_on_screening_registration_insert();

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'screening_events' and cmd = 'DELETE'
  ) then
    raise exception 'screening_events must not be deletable — cancellation is a status, not a row removal';
  end if;
  if not has_function_privilege('authenticated', 'public.register_screening_event_participant(uuid,uuid,boolean)', 'EXECUTE') then
    raise exception 'authenticated (staff, gated inside the function) must be able to register participants';
  end if;
end $$;;
