-- Community Agents, part 2: commission ledger + weekly payout batches +
-- attribution on the two order types that already exist (care_vouchers,
-- video visits). Screening-event attribution is added by the screening
-- events migration once that table exists.
--
-- Deliberately a NEW ledger, not a reuse of public.commissions — that table
-- is Tarragon's cut of a PARTNER's revenue (lab/pharmacy/specialist,
-- 20260715115451_commission_dashboard.sql); this is the reverse direction,
-- an amount Tarragon OWES an agent. Mixing the two would make neither
-- reconciliation report honest.
--
-- Fixed naira amount per completed order, not a percentage (revenue-
-- architecture spec §12: "a fixed naira amount per completed check, paid
-- weekly, no clawback games") — commission is earned once, on genuine
-- completion (a redeemed voucher; a video visit whose consultation actually
-- completed, not merely accepted — a no-show or late cancellation must not
-- pay a commission), never on sign-up alone (§12's fraud control).
--
-- Disbursement itself (moving real money to an agent's bank account) is
-- deliberately NOT automated here — that needs Paystack Transfers/recipient-
-- code product access this environment has no credentials to test against.
-- What's built is the batching + audit trail; admin_mark_payout_batch_paid
-- records that a payout happened (by whatever channel — manual bank
-- transfer today), and wiring it to an actual Transfers API call is a
-- same-shaped fast-follow once that product is enabled on the real account.

create type public.agent_commission_source as enum (
  'care_voucher_redeemed',
  'video_visit_completed',
  'screening_event_registration'
);

create type public.agent_commission_status as enum ('pending', 'approved', 'paid', 'voided');

create table public.agent_commission_rates (
  source_type public.agent_commission_source primary key,
  amount_kobo bigint not null check (amount_kobo >= 0),
  is_enabled  boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

-- PLACEHOLDER amounts pending founder sign-off on the doctor/lab margin
-- model (see docs/CLAUDE.md's decision log note) — these must not be read
-- as confirmed rates.
insert into public.agent_commission_rates (source_type, amount_kobo) values
  ('care_voucher_redeemed', 200000),        -- NGN 2,000 placeholder
  ('video_visit_completed', 50000),         -- NGN 500 placeholder
  ('screening_event_registration', 100000)  -- NGN 1,000 placeholder
on conflict (source_type) do nothing;

alter table public.agent_commission_rates enable row level security;
create policy agent_commission_rates_select on public.agent_commission_rates
  for select to authenticated using (true);
create policy agent_commission_rates_write on public.agent_commission_rates
  for all to authenticated
  using (private.is_admin() or private.has_permission('agents.manage'))
  with check (private.is_admin() or private.has_permission('agents.manage'));
grant select, insert, update on public.agent_commission_rates to authenticated;

create table public.agent_payout_batches (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  period_start    date not null,
  period_end      date not null check (period_end >= period_start),
  status          text not null default 'open' check (status in ('open', 'paid')),
  total_kobo      bigint not null default 0 check (total_kobo >= 0),
  note            text,
  paid_at         timestamptz,
  paid_by         uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index agent_payout_batches_org_idx on public.agent_payout_batches (organisation_id, status);

create table public.agent_commissions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  agent_id         uuid not null references public.community_agents (id) on delete restrict,
  source_type      public.agent_commission_source not null,
  source_id        uuid not null,
  amount_kobo      bigint not null check (amount_kobo >= 0),
  status           public.agent_commission_status not null default 'pending',
  payout_batch_id  uuid references public.agent_payout_batches (id) on delete set null,
  earned_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),

  -- Idempotency belt-and-braces alongside each trigger's own
  -- OLD.status IS DISTINCT FROM NEW.status guard: the same completed order
  -- can never mint a second commission.
  constraint agent_commissions_one_per_source unique (source_type, source_id)
);

create index agent_commissions_agent_idx on public.agent_commissions (agent_id, status);
create index agent_commissions_batch_idx on public.agent_commissions (payout_batch_id) where payout_batch_id is not null;

alter table public.agent_payout_batches enable row level security;
alter table public.agent_commissions enable row level security;

create policy agent_payout_batches_select on public.agent_payout_batches
  for select to authenticated
  using (private.is_admin() or private.has_permission('agents.manage'));
grant select on public.agent_payout_batches to authenticated;

-- An agent sees their own commission rows (amount, status, source type,
-- date) — never the patient or order behind source_id. This is deliberately
-- a narrower view than org staff get: an agent is not care-team staff (part
-- 1) and source_id is not even joinable from here without staff access to
-- the underlying table.
create policy agent_commissions_select on public.agent_commissions
  for select to authenticated
  using (
    private.is_admin()
    or private.has_permission('agents.manage')
    or exists (
      select 1 from public.community_agents ca
      where ca.id = agent_commissions.agent_id and ca.profile_id = (select auth.uid())
    )
  );
grant select on public.agent_commissions to authenticated;

-- ---------------------------------------------------------------------------
-- Commission-recording triggers. One per completion event, each guarded so
-- it fires exactly once per order and only when that order actually carries
-- an agent_id (most orders have none — direct/organic purchases mint no
-- commission at all).
-- ---------------------------------------------------------------------------

alter table public.care_vouchers
  add column agent_id uuid references public.community_agents (id) on delete set null;
create index care_vouchers_agent_idx on public.care_vouchers (agent_id) where agent_id is not null;

alter table public.video_visit_requests
  add column agent_id uuid references public.community_agents (id) on delete set null;
create index video_visit_requests_agent_idx on public.video_visit_requests (agent_id) where agent_id is not null;

create or replace function private.record_agent_commission(
  p_agent_id uuid, p_org uuid, p_source_type public.agent_commission_source, p_source_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate record;
begin
  if p_agent_id is null then return; end if;

  select amount_kobo, is_enabled into v_rate
  from public.agent_commission_rates where source_type = p_source_type;
  if not found or not v_rate.is_enabled then return; end if;

  insert into public.agent_commissions (organisation_id, agent_id, source_type, source_id, amount_kobo)
  values (p_org, p_agent_id, p_source_type, p_source_id, v_rate.amount_kobo)
  on conflict (source_type, source_id) do nothing;
exception when others then
  -- Commission bookkeeping must never block the clinical/payment path it
  -- rides on — same posture as maybe_reward_referral and prevention_reward.
  null;
end;
$$;

create or replace function private.agent_commission_on_voucher_redeemed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'redeemed' and old.status is distinct from new.status then
    perform private.record_agent_commission(
      new.agent_id, new.organisation_id, 'care_voucher_redeemed', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists care_vouchers_agent_commission on public.care_vouchers;
create trigger care_vouchers_agent_commission
  after update on public.care_vouchers
  for each row execute function private.agent_commission_on_voucher_redeemed();

-- Video visits: commission on the CONSULTATION actually completing, not on
-- request-acceptance — a doctor accepting the request only holds the slot,
-- and a later no-show/cancellation must not have already paid an agent.
create or replace function private.agent_commission_on_consultation_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    select id, organisation_id, agent_id into v_req
    from public.video_visit_requests
    where video_consultation_id = new.id;
    if found then
      perform private.record_agent_commission(
        v_req.agent_id, v_req.organisation_id, 'video_visit_completed', v_req.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists video_consultations_agent_commission on public.video_consultations;
create trigger video_consultations_agent_commission
  after update on public.video_consultations
  for each row execute function private.agent_commission_on_consultation_completed();

-- ---------------------------------------------------------------------------
-- Weekly payout batching. Staff-triggered rather than a blind cron: a human
-- reviews the batch total before money moves, matching "no clawback games"
-- with "no silent auto-pay" — both trust properties the doc asks for.
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_agent_payout_batch(p_period_start date, p_period_end date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_batch_id uuid;
  v_total bigint;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('agents.manage')) then
    raise exception 'not authorised to run a payout batch' using errcode = '42501';
  end if;
  if p_period_end < p_period_start then
    return jsonb_build_object('ok', false, 'error', 'Period end must be on or after period start.');
  end if;

  select organisation_id into v_org from public.profiles where id = v_caller;

  insert into public.agent_payout_batches (organisation_id, period_start, period_end)
  values (v_org, p_period_start, p_period_end)
  returning id into v_batch_id;

  update public.agent_commissions
     set status = 'approved', payout_batch_id = v_batch_id
   where status = 'pending'
     and payout_batch_id is null
     and earned_at::date between p_period_start and p_period_end;

  select coalesce(sum(amount_kobo), 0) into v_total
  from public.agent_commissions where payout_batch_id = v_batch_id;

  update public.agent_payout_batches set total_kobo = v_total where id = v_batch_id;

  return jsonb_build_object('ok', true, 'batch_id', v_batch_id, 'total_kobo', v_total);
end;
$$;

create or replace function public.admin_mark_payout_batch_paid(p_batch_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('agents.manage')) then
    raise exception 'not authorised to record a payout' using errcode = '42501';
  end if;

  update public.agent_payout_batches
     set status = 'paid', paid_at = now(), paid_by = v_caller, note = coalesce(p_note, note)
   where id = p_batch_id and status = 'open';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Batch not found or already paid.');
  end if;

  update public.agent_commissions set status = 'paid' where payout_batch_id = p_batch_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_create_agent_payout_batch(date, date) from public, anon;
revoke all on function public.admin_mark_payout_batch_paid(uuid, text) from public, anon;
grant execute on function public.admin_create_agent_payout_batch(date, date) to authenticated;
grant execute on function public.admin_mark_payout_batch_paid(uuid, text) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename in ('agent_commissions', 'agent_payout_batches')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'agent_commissions/agent_payout_batches must have no direct write policy: writes go through triggers/definer RPCs only';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'agent_commission_on_voucher_redeemed') ilike '%payout%' then
    raise exception 'commission recording must not itself move money — payout is a separate, staff-reviewed step';
  end if;
end $$;;
