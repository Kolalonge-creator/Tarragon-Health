-- Employer seat pilot kit (docs/design/EMP.md). Built ON the existing employer platform (accounts, roster, claim, benefit packages,
-- organisation seat price, organisation-billed seats, employer invoices). Adds only:
--   1. employer_seat_pilots: an offer of N Membership seats to one employer, priced at the organisation price in force (snapshot),
--      with a claim window and a terms version. State draft -> invoiced -> active -> ended, or cancelled before payment.
--   2. A pilot is paid as a block by invoice. Finance records the receipt (bank transfer or a Paystack payment link) and the pilot
--      goes active. No new webhook, no card collection, no stored balance (INV-09). Integer kobo (INV-15). No capitation (I8).
--   3. private.grant_org_seat is extended: an organisation that has a pilot is governed by it (no seat before payment, none past the
--      purchased count, none outside the claim window). A pilot seat is created already attached to the pilot invoice, so the
--      arrears invoice generator (which only picks invoice_id is null) can never bill it a second time.
--   4. employer_seat_pilot_report: AGGREGATE ONLY (I9). The one platform minimum cell (private.min_cell_floor, which already takes the
--      greater of the platform number and the organisation's min_cohort_size) and private.suppress_cell for every figure, with the
--      complement (members who did NOT) checked too; figures cut at the last completed Lagos week, usage counts rounded to the
--      nearest 5. No names, no conditions, no readings, no per-person rows.
--
-- Dormant: the organisation_membership module stays off and this migration switches nothing on. The pilot RPCs need a Membership
-- benefit package, and such a package cannot exist while that module is off.
--
-- Live counts before this migration: NOT READ. The live database was unreachable from the authoring session (connection timeouts),
-- so the bodies extended here come from the committed migration files (20261013003317 for grant_org_seat). Verify with
-- pg_get_functiondef('private.grant_org_seat(uuid)') before applying. Per the design note the same migration recorded zero
-- employer_roster_members, zero benefit packages and zero invoices on 2026-10-12, so nothing needs converting.
-- ROLLBACK: restore the 20261013003317 body of private.grant_org_seat; drop table employer_seat_pilots cascade; drop
--   employer_seat_pilot_config; alter table entitlements drop column pilot_id; restore the two-value seat_state check.

-- ---------------------------------------------------------------------------
-- 1. Config (PROPOSED, mirrored in packages/shared/src/proposed-config as employer.seat_pilot)
-- ---------------------------------------------------------------------------
create table public.employer_seat_pilot_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index employer_seat_pilot_config_one_active on public.employer_seat_pilot_config (is_active) where is_active;
alter table public.employer_seat_pilot_config enable row level security;
revoke all on public.employer_seat_pilot_config from public, anon, authenticated;
grant all on public.employer_seat_pilot_config to service_role;

-- employer-seat-pilot-config-begin (mirrored as employer.seat_pilot in packages/shared/src/proposed-config/registry.ts)
insert into public.employer_seat_pilot_config (version, is_active, effective_from, rules)
values (1, true, date '2026-10-16', $json${"max_seats_per_pilot":500,"max_window_days":120,"report_round_to":5,"usage_report_enabled":false}$json$::jsonb);
-- employer-seat-pilot-config-end

-- ---------------------------------------------------------------------------
-- 2. The pilot
-- ---------------------------------------------------------------------------
create table public.employer_seat_pilots (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  benefit_package_id uuid not null references public.employer_benefit_packages (id) on delete restrict,
  seats_purchased    integer not null check (seats_purchased between 1 and 5000),
  seat_price_kobo    bigint not null check (seat_price_kobo > 0),
  seat_price_id      uuid not null references public.organisation_member_prices (id) on delete restrict,
  total_kobo         bigint not null check (total_kobo > 0),
  starts_on          date not null,
  ends_on            date not null,
  terms_version      text not null check (char_length(btrim(terms_version)) between 1 and 60),
  state              text not null default 'draft' check (state in ('draft', 'invoiced', 'active', 'ended', 'cancelled')),
  invoice_id         uuid references public.employer_invoices (id) on delete restrict,
  payment_method     text check (payment_method in ('bank_transfer', 'paystack_link')),
  payment_reference  text check (payment_reference is null or char_length(btrim(payment_reference)) between 4 and 120),
  activated_at       timestamptz,
  activated_by       uuid references public.profiles (id) on delete set null,
  closed_at          timestamptz,
  closed_by          uuid references public.profiles (id) on delete set null,
  close_reason       text,
  created_by         uuid references public.profiles (id) on delete set null,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (total_kobo = seats_purchased::bigint * seat_price_kobo),
  check (state not in ('invoiced', 'active', 'ended') or invoice_id is not null),
  check (state not in ('active', 'ended') or (payment_method is not null and payment_reference is not null and activated_at is not null)),
  check (state not in ('ended', 'cancelled') or (closed_at is not null and char_length(btrim(coalesce(close_reason, ''))) >= 10))
);
create unique index employer_seat_pilots_one_live_per_org on public.employer_seat_pilots (organisation_id) where state in ('draft', 'invoiced', 'active');
create unique index employer_seat_pilots_payment_reference_key on public.employer_seat_pilots (payment_reference) where payment_reference is not null;
create unique index employer_seat_pilots_invoice_key on public.employer_seat_pilots (invoice_id) where invoice_id is not null;
create index employer_seat_pilots_org_idx on public.employer_seat_pilots (organisation_id, created_at desc);
create trigger employer_seat_pilots_set_updated_at before update on public.employer_seat_pilots
  for each row execute function private.set_updated_at();

comment on table public.employer_seat_pilots is
  'EMP: a block of N Membership seats offered to one employer, paid by invoice, claimed by rostered employees. The employer reads this row (it is their own contract) and the aggregate report; it never reads who holds a seat.';

-- Money and identity fields freeze at creation; the state only moves along the allowed path.
create function private.employer_seat_pilots_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'pilot_not_deletable' using errcode = 'P0001'; end if;
  if new.organisation_id is distinct from old.organisation_id or new.benefit_package_id is distinct from old.benefit_package_id
     or new.seats_purchased is distinct from old.seats_purchased or new.seat_price_kobo is distinct from old.seat_price_kobo
     or new.seat_price_id is distinct from old.seat_price_id or new.total_kobo is distinct from old.total_kobo
     or new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on
     or new.terms_version is distinct from old.terms_version or new.is_test is distinct from old.is_test then
    raise exception 'pilot_terms_frozen' using errcode = 'P0001';
  end if;
  if new.state is distinct from old.state and not (
       (old.state = 'draft' and new.state in ('invoiced', 'cancelled'))
    or (old.state = 'invoiced' and new.state in ('active', 'cancelled'))
    or (old.state = 'active' and new.state = 'ended')) then
    raise exception 'pilot_state_transition_not_allowed' using errcode = 'P0001';
  end if;
  if old.state in ('ended', 'cancelled') and (new.state is distinct from old.state) then
    raise exception 'pilot_state_transition_not_allowed' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.employer_seat_pilots_guard() from public, anon, authenticated;
create trigger employer_seat_pilots_guard before update or delete on public.employer_seat_pilots
  for each row execute function private.employer_seat_pilots_guard();

alter table public.employer_seat_pilots enable row level security;
revoke all on public.employer_seat_pilots from public, anon, authenticated;
-- Column grants, not a table grant: finance's internal note, who created, activated and closed it are not the employer's to read.
grant select (id, organisation_id, benefit_package_id, seats_purchased, seat_price_kobo, seat_price_id, total_kobo, starts_on, ends_on,
              terms_version, state, invoice_id, payment_method, payment_reference, activated_at, is_test, created_at, updated_at)
  on public.employer_seat_pilots to authenticated;
grant all on public.employer_seat_pilots to service_role;
create policy employer_seat_pilots_read on public.employer_seat_pilots for select to authenticated
  using (private.is_finance() or private.is_admin()
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));

-- A pilot's invoice is voided only by cancelling the pilot (close_employer_seat_pilot sets tarragon.pilot_cancelling for the duration). A void
-- through the generic status function would null invoice_id on every pilot seat and let the arrears generator bill them again (paid pilot), or
-- strand the pilot in 'invoiced' with an invoice that can be neither paid nor voided again (unpaid pilot).
create function private.pilot_invoice_void_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'void' and old.status is distinct from 'void'
     and exists (select 1 from public.employer_seat_pilots p
                  where p.invoice_id = old.id and p.state in ('invoiced', 'active', 'ended')
                    and coalesce(current_setting('tarragon.pilot_cancelling', true), '') is distinct from p.id::text) then
    raise exception 'pilot_invoice_void_via_pilot_only' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.pilot_invoice_void_guard() from public, anon, authenticated;
create trigger employer_invoices_pilot_void_guard before update of status on public.employer_invoices
  for each row execute function private.pilot_invoice_void_guard();

-- A contract-driven per-head invoice (employer_generate_invoice) would bill the same people a second time while a pilot block covers them.
create function private.pilot_per_head_overlap_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.contract_id is not null and new.billing_model in ('per_employee', 'per_active_member', 'hybrid')
     and exists (select 1 from public.employer_seat_pilots p
                  where p.organisation_id = new.organisation_id and p.state in ('invoiced', 'active')
                    and p.starts_on <= new.period_end and p.ends_on >= new.period_start) then
    raise exception 'pilot_covers_this_period' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.pilot_per_head_overlap_guard() from public, anon, authenticated;
create trigger employer_invoices_pilot_overlap_guard before insert on public.employer_invoices
  for each row execute function private.pilot_per_head_overlap_guard();

-- A pilot seat remembers its pilot. Not in the employee's column grant on entitlements (the employer's terms are not theirs to read).
alter table public.entitlements add column pilot_id uuid references public.employer_seat_pilots (id) on delete restrict;
create index entitlements_pilot_idx on public.entitlements (pilot_id) where pilot_id is not null;

-- A claim that could not become a seat says why, as a count the employer can see.
alter table public.employer_roster_members drop constraint if exists employer_roster_members_seat_state_check;
alter table public.employer_roster_members add constraint employer_roster_members_seat_state_check
  check (seat_state is null or seat_state in ('seat', 'already_member', 'waiting_payment', 'no_seat_left', 'pilot_closed'));

-- ---------------------------------------------------------------------------
-- 3. Seat grant: an organisation with a pilot is governed by it
-- ---------------------------------------------------------------------------
create or replace function private.grant_org_seat(p_roster uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r public.employer_roster_members%rowtype;
  v_package public.employer_benefit_packages;
  it public.catalog_items%rowtype;
  px public.organisation_member_prices%rowtype;
  v_pilot public.employer_seat_pilots%rowtype;
  v_org uuid;
  v_used integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_ends timestamptz; v_ent uuid; v_is_test boolean;
begin
  -- The pilot row is locked before the roster row here. When this runs from the claim trigger the roster row is already locked by the
  -- claiming UPDATE, so the confirm and close loops below take roster rows with SKIP LOCKED: a row a claimant holds is left to that claimant,
  -- who gets the seat as soon as the confirmation commits. That is what stops the two from waiting on each other.
  select organisation_id into v_org from public.employer_roster_members where id = p_roster;
  if v_org is null then return 'skipped'; end if;
  select * into v_pilot from public.employer_seat_pilots
   where organisation_id = v_org and state <> 'cancelled' order by created_at desc limit 1 for update;
  select * into r from public.employer_roster_members where id = p_roster for update;
  if not found or r.status <> 'claimed' or r.claimed_profile_id is null or r.benefit_package_id is null then return 'skipped'; end if;
  select * into v_package from public.employer_benefit_packages where id = r.benefit_package_id and is_active;
  if v_package.id is null or v_package.catalog_item_id is null then return 'skipped'; end if;
  if not coalesce((select is_enabled from public.platform_modules where key = 'organisation_membership'), false) then
    perform private.order_incident(r.organisation_id, 'org-seat-module-off:' || r.id, 'A rostered employee claimed while organisation Membership is off',
      'Roster row ' || r.id || ' claimed a benefit package that grants Membership, but the organisation_membership module is off, so no seat was created.');
    return 'skipped';
  end if;
  -- a replay for someone who already holds the seat is a no-op, whatever the pilot count says now
  if exists (select 1 from public.entitlements where roster_member_id = r.id and state = 'active') then return 'seat'; end if;
  select * into it from public.catalog_items where id = v_package.catalog_item_id;
  -- a pilot carries its own frozen price; only an organisation without a pilot needs a price in force today
  if v_pilot.id is null then
    px := private.organisation_member_price(r.organisation_id, it.id);
    if px.id is null then
      perform private.order_incident(r.organisation_id, 'org-seat-no-price:' || r.id, 'No organisation Membership price is in force',
        'Roster row ' || r.id || ' claimed a Membership benefit but no organisation price is in force, so no seat was created.');
      return 'skipped';
    end if;
  end if;
  -- the person's own Membership wins; the organisation is not billed until it ends (the daily sweep re-offers the seat)
  if private.patient_is_member(r.claimed_profile_id) then return 'already_member'; end if;

  -- EMP: a pilot governs the organisation. The newest pilot that was not cancelled decides. Seats can be claimed from the day payment is
  -- confirmed until ends_on (starts_on is the date of the offer, not a gate: a paid block must never leave a person waiting for a date).
  if v_pilot.id is not null then
    if v_pilot.state in ('draft', 'invoiced') then
      update public.employer_roster_members set seat_state = 'waiting_payment' where id = r.id and seat_state is distinct from 'waiting_payment';
      return 'waiting_payment';
    end if;
    if v_pilot.state = 'ended' or v_today > v_pilot.ends_on then
      update public.employer_roster_members set seat_state = 'pilot_closed' where id = r.id and seat_state is distinct from 'pilot_closed';
      perform private.order_incident(r.organisation_id, 'pilot-closed:' || r.id, 'A rostered employee claimed after the pilot window closed',
        'Roster row ' || r.id || ' claimed after the pilot window or after the pilot ended, so no seat was created. Decide with the employer whether to extend or start a new offer.');
      return 'pilot_closed';
    end if;
    select count(*) into v_used from public.entitlements where pilot_id = v_pilot.id;
    if v_used >= v_pilot.seats_purchased then
      update public.employer_roster_members set seat_state = 'no_seat_left' where id = r.id and seat_state is distinct from 'no_seat_left';
      perform private.order_incident(r.organisation_id, 'pilot-no-seat:' || r.id, 'A rostered employee claimed but every pilot seat is taken',
        'Roster row ' || r.id || ' claimed after all ' || v_pilot.seats_purchased || ' purchased seats were taken, so no seat was created. The employer can buy more seats in a new offer.');
      return 'no_seat_left';
    end if;
  end if;

  v_ends := least(now() + make_interval(days => it.duration_days),
                  case when r.eligible_until is not null then r.eligible_until::timestamptz + interval '1 day' end);
  if v_ends <= now() then return 'skipped'; end if;
  select coalesce(p.is_test, false) into v_is_test from public.profiles p where p.id = r.claimed_profile_id;
  insert into public.entitlements (organisation_id, patient_id, kind, starts_at, ends_at, roster_member_id,
                                   billed_to_organisation_id, seat_price_kobo, seat_price_id, is_test, pilot_id, invoice_id)
  values (r.organisation_id, r.claimed_profile_id, 'membership', now(), v_ends, r.id,
          r.organisation_id,
          case when v_pilot.id is not null then v_pilot.seat_price_kobo else px.amount_kobo end,
          case when v_pilot.id is not null then v_pilot.seat_price_id else px.id end,
          coalesce(v_is_test, false), v_pilot.id, v_pilot.invoice_id)
  on conflict (roster_member_id) where state = 'active' and roster_member_id is not null do nothing
  returning id into v_ent;
  if v_ent is not null then
    insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
    values (r.organisation_id, r.claimed_profile_id, 'employer', now(), v_ends, coalesce(v_is_test, false));
  end if;
  return 'seat';
end $$;
revoke all on function private.grant_org_seat(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Finance steps: create, invoice, confirm payment, close
-- ---------------------------------------------------------------------------
create function private.employer_seat_pilot_rules() returns jsonb language sql stable security definer set search_path = '' as $$
  select rules from public.employer_seat_pilot_config where is_active
$$;
revoke all on function private.employer_seat_pilot_rules() from public, anon, authenticated;

create function public.create_employer_seat_pilot(p_org uuid, p_benefit_package uuid, p_seats integer, p_starts_on date, p_ends_on date,
                                                  p_terms_version text, p_is_test boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rules jsonb := private.employer_seat_pilot_rules();
  v_pkg public.employer_benefit_packages%rowtype;
  px public.organisation_member_prices%rowtype;
  v_id uuid;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if v_uid is null or not private.is_finance() then raise exception 'pilot_not_authorised' using errcode = '42501'; end if;
  if v_rules is null then raise exception 'pilot_config_missing' using errcode = 'P0001'; end if;
  if not coalesce((select is_enabled from public.platform_modules where key = 'organisation_membership'), false) then
    raise exception 'organisation_membership_not_open' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.employer_accounts where organisation_id = p_org) then
    raise exception 'pilot_unknown_employer' using errcode = '22023';
  end if;
  select * into v_pkg from public.employer_benefit_packages where id = p_benefit_package and organisation_id = p_org and is_active;
  if v_pkg.id is null or v_pkg.catalog_item_id is null then raise exception 'pilot_needs_membership_package' using errcode = '22023'; end if;
  if p_seats is null or p_seats < 1 or p_seats > (v_rules ->> 'max_seats_per_pilot')::integer then
    raise exception 'pilot_seat_count_out_of_range' using errcode = '22023';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on or p_starts_on < v_today
     or (p_ends_on - p_starts_on) > (v_rules ->> 'max_window_days')::integer then
    raise exception 'pilot_window_invalid' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_terms_version, ''))) = 0 then raise exception 'pilot_terms_version_needed' using errcode = '22023'; end if;
  px := private.organisation_member_price(p_org, v_pkg.catalog_item_id);
  if px.id is null then raise exception 'pilot_no_price_in_force' using errcode = 'P0001'; end if;
  insert into public.employer_seat_pilots (organisation_id, benefit_package_id, seats_purchased, seat_price_kobo, seat_price_id, total_kobo,
                                           starts_on, ends_on, terms_version, created_by, is_test)
  values (p_org, v_pkg.id, p_seats, px.amount_kobo, px.id, p_seats::bigint * px.amount_kobo, p_starts_on, p_ends_on, btrim(p_terms_version),
          v_uid, coalesce(p_is_test, false))
  returning id into v_id;
  perform private.log_audit('employer_seat_pilot.created', 'employer_seat_pilots', v_id,
    jsonb_build_object('organisation_id', p_org, 'seats', p_seats, 'seat_price_kobo', px.amount_kobo, 'terms_version', btrim(p_terms_version)));
  return v_id;
end $$;

create function public.issue_employer_seat_pilot_invoice(p_pilot uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_p public.employer_seat_pilots%rowtype; v_inv uuid;
begin
  if (select auth.uid()) is null or not private.is_finance() then raise exception 'pilot_not_authorised' using errcode = '42501'; end if;
  select * into v_p from public.employer_seat_pilots where id = p_pilot for update;
  if not found then raise exception 'pilot_unknown' using errcode = '22023'; end if;
  if v_p.state = 'invoiced' then return v_p.invoice_id; end if;
  if v_p.state <> 'draft' then raise exception 'pilot_not_in_draft' using errcode = 'P0001'; end if;
  if not coalesce((select is_enabled from public.platform_modules where key = 'organisation_membership'), false) then
    raise exception 'organisation_membership_not_open' using errcode = 'P0001';
  end if;
  insert into public.employer_invoices (organisation_id, contract_id, period_start, period_end, billing_model, headcount_basis, rate_kobo,
                                        fixed_amount_kobo, amount_kobo, status, issued_at, due_at, notes, created_by)
  values (v_p.organisation_id, null, v_p.starts_on, v_p.ends_on, 'fixed_contract', v_p.seats_purchased, v_p.seat_price_kobo,
          v_p.total_kobo, v_p.total_kobo, 'issued', now(), (now() at time zone 'Africa/Lagos')::date + 14,
          'Pilot block of ' || v_p.seats_purchased || ' Membership seats at the organisation price in force on the day the offer was made. Terms version ' || v_p.terms_version || '.',
          (select auth.uid()))
  returning id into v_inv;
  update public.employer_seat_pilots set state = 'invoiced', invoice_id = v_inv where id = v_p.id;
  perform private.log_audit('employer_seat_pilot.invoiced', 'employer_seat_pilots', v_p.id,
    jsonb_build_object('invoice_id', v_inv, 'amount_kobo', v_p.total_kobo));
  return v_inv;
end $$;

-- Finance has checked the money arrived (bank statement, or the Paystack dashboard for a payment link) and records it. Idempotent.
create function public.confirm_employer_seat_pilot_payment(p_pilot uuid, p_method text, p_reference text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_p public.employer_seat_pilots%rowtype;
  v_ref text := btrim(coalesce(p_reference, ''));
  r record; v_res text; v_granted integer := 0;
begin
  if v_uid is null or not private.is_finance() then raise exception 'pilot_not_authorised' using errcode = '42501'; end if;
  if p_method not in ('bank_transfer', 'paystack_link') then raise exception 'pilot_payment_method_invalid' using errcode = '22023'; end if;
  if char_length(v_ref) < 4 or char_length(v_ref) > 120 then raise exception 'pilot_payment_reference_invalid' using errcode = '22023'; end if;
  select * into v_p from public.employer_seat_pilots where id = p_pilot for update;
  if not found then raise exception 'pilot_unknown' using errcode = '22023'; end if;
  if v_p.state = 'active' then
    if v_p.payment_reference = v_ref then return jsonb_build_object('result', 'replay', 'granted', 0); end if;
    raise exception 'pilot_already_paid_other_reference' using errcode = 'P0001';
  end if;
  if v_p.state <> 'invoiced' then raise exception 'pilot_not_awaiting_payment' using errcode = 'P0001'; end if;
  if not coalesce((select is_enabled from public.platform_modules where key = 'organisation_membership'), false) then
    raise exception 'organisation_membership_not_open' using errcode = 'P0001';
  end if;
  if (select status from public.employer_invoices where id = v_p.invoice_id) is distinct from 'paid' then
    perform public.employer_set_invoice_status(v_p.invoice_id, 'paid');
  end if;
  update public.employer_seat_pilots
     set state = 'active', payment_method = p_method, payment_reference = v_ref, activated_at = now(), activated_by = v_uid
   where id = v_p.id;
  perform private.log_audit('employer_seat_pilot.payment_confirmed', 'employer_seat_pilots', v_p.id,
    jsonb_build_object('method', p_method, 'amount_kobo', v_p.total_kobo));
  -- people who claimed while the block was unpaid get their seat now, in claim order, up to the purchased count
  for r in select id from public.employer_roster_members
            where organisation_id = v_p.organisation_id and status = 'claimed' and claimed_profile_id is not null
              and (seat_state is null or seat_state in ('waiting_payment', 'no_seat_left', 'pilot_closed'))
            order by claimed_at nulls last, created_at
              for update skip locked loop
    v_res := private.grant_org_seat(r.id);
    if v_res in ('seat', 'already_member', 'no_seat_left', 'pilot_closed', 'waiting_payment') then
      update public.employer_roster_members set seat_state = v_res where id = r.id and seat_state is distinct from v_res;
    end if;
    if v_res = 'seat' then v_granted := v_granted + 1; end if;
  end loop;
  return jsonb_build_object('result', 'activated', 'granted', v_granted);
end $$;

create function public.close_employer_seat_pilot(p_pilot uuid, p_reason text) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_p public.employer_seat_pilots%rowtype; v_new text; r record; v_res text;
begin
  if v_uid is null or not private.is_finance() then raise exception 'pilot_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'pilot_reason_needed' using errcode = '22023'; end if;
  select * into v_p from public.employer_seat_pilots where id = p_pilot for update;
  if not found then raise exception 'pilot_unknown' using errcode = '22023'; end if;
  if v_p.state in ('ended', 'cancelled') then return v_p.state; end if;
  v_new := case when v_p.state = 'active' then 'ended' else 'cancelled' end;
  -- an unpaid invoice is voided with the same reason; a paid one is never touched (members keep the Membership they were given)
  if v_new = 'cancelled' and v_p.invoice_id is not null then
    perform set_config('tarragon.pilot_cancelling', v_p.id::text, true);
    perform public.employer_set_invoice_status(v_p.invoice_id, 'void', btrim(p_reason));
    perform set_config('tarragon.pilot_cancelling', '', true);
  end if;
  update public.employer_seat_pilots
     set state = v_new, closed_at = now(), closed_by = v_uid, close_reason = btrim(p_reason) where id = v_p.id;
  perform private.log_audit('employer_seat_pilot.' || v_new, 'employer_seat_pilots', v_p.id, jsonb_build_object('reason', btrim(p_reason)));
  -- a cancelled pilot puts the employer back on ordinary billing, so anyone left waiting for the block is offered the ordinary seat now
  if v_new = 'cancelled' then
    for r in select id from public.employer_roster_members
              where organisation_id = v_p.organisation_id and status = 'claimed' and claimed_profile_id is not null and seat_state = 'waiting_payment'
              order by claimed_at nulls last, created_at
                for update skip locked loop
      v_res := private.grant_org_seat(r.id);
      if v_res in ('seat', 'already_member') then
        update public.employer_roster_members set seat_state = v_res where id = r.id;
      end if;
    end loop;
  end if;
  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The aggregate report (I9)
-- ---------------------------------------------------------------------------
-- Every figure goes through private.suppress_cell, the platform's one minimum-cell rule (S75a, OQ-233): below the minimum is withheld, and so is a
-- figure whose complement (members who did NOT) is 1 to minimum-1 people, since 'everyone except two' names two people.

create function public.employer_seat_pilot_report(p_pilot uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_p public.employer_seat_pilots%rowtype;
  v_rules jsonb := private.employer_seat_pilot_rules();
  v_min integer; v_round integer := (v_rules ->> 'report_round_to')::integer;
  v_cut timestamptz := date_trunc('week', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_claimed integer; v_active integer; v_denom integer; v_consult_people integer; v_consults integer; v_checkin_people integer;
  v_usage jsonb;
begin
  if v_rules is null or v_round is null or v_round < 1 then raise exception 'pilot_config_missing' using errcode = 'P0001'; end if;
  select * into v_p from public.employer_seat_pilots where id = p_pilot;
  if not found
     or not (private.is_finance() or private.is_admin()
             or (private.is_institution_admin() and v_p.organisation_id = private.current_org_id())) then
    raise exception 'pilot_report_not_authorised' using errcode = '42501';
  end if;
  v_min := private.min_cell_floor((select min_cohort_size from public.organisations where id = v_p.organisation_id));
  -- seat counts are the employer's own HR facts (it already sees its roster): exact
  select count(*), count(*) filter (where e.state = 'active' and (e.ends_at is null or e.ends_at > now()))
    into v_claimed, v_active
    from public.entitlements e where e.pilot_id = v_p.id and e.is_test = v_p.is_test;
  -- usage is health-adjacent: only people who hold a seat from this pilot, only through the last completed Lagos week
  select count(*) into v_denom from public.entitlements e where e.pilot_id = v_p.id and e.is_test = v_p.is_test and e.starts_at < v_cut;
  if not coalesce((v_rules ->> 'usage_report_enabled')::boolean, false) then
    -- off until counsel and the DPO have signed the employee notice (OQ-EMP-7, OQ-EMP-9): seat counts only
    v_usage := jsonb_build_object('suppressed', true, 'reason', 'not_enabled');
  elsif private.suppress_cell(v_denom, null, v_min) is not null then
    v_usage := jsonb_build_object('suppressed', true, 'reason', 'too_few_members');
  else
    select count(distinct e.patient_id), count(distinct en.id) into v_consult_people, v_consults
      from public.entitlements e join public.encounters en on en.patient_id = e.patient_id
       and en.status = 'completed' and en.ended_at >= e.starts_at and en.ended_at < v_cut
     where e.pilot_id = v_p.id and e.is_test = v_p.is_test;
    select count(distinct e.patient_id) into v_checkin_people
      from public.entitlements e join public.vitals_readings vr on vr.patient_id = e.patient_id
       and vr.taken_at >= e.starts_at and vr.taken_at < v_cut
     where e.pilot_id = v_p.id and e.is_test = v_p.is_test;
    v_usage := jsonb_build_object('suppressed', false,
      'members_with_consultation', case when private.suppress_cell(v_consult_people, array[v_consult_people, v_denom - v_consult_people]::bigint[], v_min) is null
                                        then to_jsonb((round(v_consult_people::numeric / v_round) * v_round)::integer) end,
      'consultations_completed', case when private.suppress_cell(v_consult_people, array[v_consult_people, v_denom - v_consult_people]::bigint[], v_min) is null
                                      then to_jsonb((round(v_consults::numeric / v_round) * v_round)::integer) end,
      'members_with_check_in', case when private.suppress_cell(v_checkin_people, array[v_checkin_people, v_denom - v_checkin_people]::bigint[], v_min) is null
                                    then to_jsonb((round(v_checkin_people::numeric / v_round) * v_round)::integer) end);
  end if;
  return jsonb_build_object(
    'pilot', jsonb_build_object('id', v_p.id, 'state', v_p.state, 'starts_on', v_p.starts_on, 'ends_on', v_p.ends_on,
                                'terms_version', v_p.terms_version, 'total_kobo', v_p.total_kobo, 'seat_price_kobo', v_p.seat_price_kobo),
    'seats', jsonb_build_object('purchased', v_p.seats_purchased, 'claimed', v_claimed, 'active', v_active,
                                'unclaimed', greatest(v_p.seats_purchased - v_claimed, 0),
                                'claims_without_seat', (select count(*) from public.employer_roster_members r
                                                         where r.organisation_id = v_p.organisation_id and r.status = 'claimed'
                                                           and r.seat_state in ('waiting_payment', 'no_seat_left', 'pilot_closed'))),
    'usage', v_usage,
    'min_cell', v_min,
    'rounded_to', v_round,
    'usage_through', (v_cut at time zone 'Africa/Lagos')::date - 1,
    'generated_at', now());
end $$;

revoke all on function public.create_employer_seat_pilot(uuid, uuid, integer, date, date, text, boolean),
  public.issue_employer_seat_pilot_invoice(uuid), public.confirm_employer_seat_pilot_payment(uuid, text, text),
  public.close_employer_seat_pilot(uuid, text), public.employer_seat_pilot_report(uuid) from public, anon;
grant execute on function public.create_employer_seat_pilot(uuid, uuid, integer, date, date, text, boolean),
  public.issue_employer_seat_pilot_invoice(uuid), public.confirm_employer_seat_pilot_payment(uuid, text, text),
  public.close_employer_seat_pilot(uuid, text), public.employer_seat_pilot_report(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'employer_seat_pilots' and c.relrowsecurity) then
    raise exception 'FAIL: RLS not enabled on employer_seat_pilots';
  end if;
  if has_table_privilege('authenticated', 'public.employer_seat_pilots', 'INSERT')
     or has_table_privilege('authenticated', 'public.employer_seat_pilots', 'UPDATE')
     or has_table_privilege('authenticated', 'public.employer_seat_pilots', 'DELETE') then
    raise exception 'FAIL: authenticated can write employer_seat_pilots directly';
  end if;
  if has_table_privilege('anon', 'public.employer_seat_pilots', 'SELECT') or has_table_privilege('authenticated', 'public.employer_seat_pilot_config', 'SELECT') then
    raise exception 'FAIL: pilot tables are readable by the wrong role';
  end if;
  foreach f in array array['public.create_employer_seat_pilot(uuid, uuid, integer, date, date, text, boolean)',
      'public.issue_employer_seat_pilot_invoice(uuid)', 'public.confirm_employer_seat_pilot_payment(uuid, text, text)',
      'public.close_employer_seat_pilot(uuid, text)', 'public.employer_seat_pilot_report(uuid)',
      'private.grant_org_seat(uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'FAIL: anon can execute %', f; end if;
  end loop;
  if (select count(*) from public.employer_seat_pilot_config where is_active) <> 1 then raise exception 'FAIL: pilot config not seeded'; end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'grant_org_seat') not like '%pilot_id%' then
    raise exception 'FAIL: grant_org_seat was not extended';
  end if;
  -- the employer's column grant on entitlements does not include the pilot link
  if has_column_privilege('authenticated', 'public.entitlements', 'pilot_id', 'SELECT') then
    raise exception 'FAIL: authenticated can read entitlements.pilot_id';
  end if;
  raise notice 'PASS  employer seat pilot kit in place';
end $$;
