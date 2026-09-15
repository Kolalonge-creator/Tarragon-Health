-- Tarragon Health — module 28, part 3: claiming a directory row (28.8/28.9).
--
-- A registered provider organisation is not automatically the same thing as
-- an existing facilities/lab_providers/pharmacy_partners/specialist_providers
-- row — those four directories predate this module and are Tarragon-curated
-- listings patients already book against. "Claiming" links a provider_org to
-- the directory row that already routes real work to it, the same
-- organisation_id-on-an-existing-table move made for insurers in module 27,
-- so a hospital that is ALSO the specialist practice patients already see in
-- the referral network gets a queue over the referrals already flowing to it
-- — without duplicating the directory or the referral/order tables.
--
-- Read-only queues, not new fulfilment paths: uploading a lab result, dispensing
-- a pharmacy order, and accepting/booking a referral already have their own
-- purpose-built partner surfaces (lab_partner_upload_result, the pharmacist
-- surface, set_referral_specialist_provider's booking flow). This migration
-- gives a provider organisation VISIBILITY into that same work — 28.8's own
-- example is a queue count ("New cardiology referrals: 5 / Awaiting booking: 3
-- / Booked: 7 / Reports pending: 2"), not a request to re-plumb fulfilment
-- through a second account type. A hospital that also wants to fulfil directly
-- still provisions a lab_partner/pharmacist login for that, same as today.
--
-- organisation_id write access on the four claimed directories is already
-- admin/permission-gated by each table's existing update policy
-- (facilities_update/lab_providers_update/pharmacy_partners_update/
-- specialist_providers_update all require is_admin() or a named
-- partners.*.manage permission) — this migration adds no new write path,
-- only the column, its guard, and read-only queue RPCs.

alter table public.facilities            add column if not exists organisation_id uuid references public.organisations (id) on delete set null;
alter table public.lab_providers         add column if not exists organisation_id uuid references public.organisations (id) on delete set null;
alter table public.pharmacy_partners     add column if not exists organisation_id uuid references public.organisations (id) on delete set null;
alter table public.specialist_providers  add column if not exists organisation_id uuid references public.organisations (id) on delete set null;

create index if not exists facilities_organisation_idx           on public.facilities (organisation_id) where organisation_id is not null;
create index if not exists lab_providers_organisation_idx        on public.lab_providers (organisation_id) where organisation_id is not null;
create index if not exists pharmacy_partners_organisation_idx    on public.pharmacy_partners (organisation_id) where organisation_id is not null;
create index if not exists specialist_providers_organisation_idx on public.specialist_providers (organisation_id) where organisation_id is not null;

-- One shared guard: whichever of the four tables is being claimed, the
-- organisation named must actually be a provider_org (reuses the same
-- reasoning as provider_organisations_type_guard — a directory row claimed
-- by a 'clinic'/'hmo' organisation would let that org's staff reach a queue
-- meant only for a registered provider organisation).
create or replace function private.provider_org_claim_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.organisation_type;
begin
  if new.organisation_id is null then
    return new;
  end if;
  select type into v_type from public.organisations where id = new.organisation_id;
  if v_type is distinct from 'provider_org' then
    raise exception 'organisation % is type % — only a provider_org organisation may claim a directory row', new.organisation_id, v_type
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger facilities_claim_guard
  before insert or update of organisation_id on public.facilities
  for each row execute function private.provider_org_claim_guard();
create trigger lab_providers_claim_guard
  before insert or update of organisation_id on public.lab_providers
  for each row execute function private.provider_org_claim_guard();
create trigger pharmacy_partners_claim_guard
  before insert or update of organisation_id on public.pharmacy_partners
  for each row execute function private.provider_org_claim_guard();
create trigger specialist_providers_claim_guard
  before insert or update of organisation_id on public.specialist_providers
  for each row execute function private.provider_org_claim_guard();

-- ---------------------------------------------------------------------------
-- Queues. Same security model as lab_partner_orders(): SECURITY DEFINER,
-- resolves the caller's own organisation via is_provider_org_staff_for, and
-- returns nothing at all for a caller with no active seat or an org that
-- has claimed nothing.
-- ---------------------------------------------------------------------------
create or replace function public.provider_org_referral_queue(p_organisation_id uuid)
returns table (
  referral_id uuid,
  referral_number text,
  patient_name text,
  patient_number text,
  specialist_type text,
  urgency text,
  status text,
  referral_reason text,
  appointment_date timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.referral_number, p.full_name, p.patient_number,
         r.specialist_type::text, r.urgency::text, r.status::text,
         r.referral_reason, r.appointment_date, r.created_at
  from public.specialist_referrals r
  join public.profiles p on p.id = r.patient_id
  join public.specialist_providers sp on sp.id = r.specialist_provider_id
  where private.is_provider_org_staff_for(p_organisation_id)
    and sp.organisation_id = p_organisation_id
  order by r.created_at desc;
$$;

revoke all on function public.provider_org_referral_queue(uuid) from public;
revoke all on function public.provider_org_referral_queue(uuid) from anon;
grant execute on function public.provider_org_referral_queue(uuid) to authenticated;

create or replace function public.provider_org_referral_queue_summary(p_organisation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not private.is_provider_org_staff_for(p_organisation_id) then '{}'::jsonb
    else coalesce(jsonb_object_agg(status, n), '{}'::jsonb) end
  from (
    select r.status::text as status, count(*) as n
    from public.specialist_referrals r
    join public.specialist_providers sp on sp.id = r.specialist_provider_id
    where sp.organisation_id = p_organisation_id
    group by r.status
  ) s;
$$;

revoke all on function public.provider_org_referral_queue_summary(uuid) from public;
revoke all on function public.provider_org_referral_queue_summary(uuid) from anon;
grant execute on function public.provider_org_referral_queue_summary(uuid) to authenticated;

create or replace function public.provider_org_lab_order_queue(p_organisation_id uuid)
returns table (
  order_id uuid,
  order_number text,
  status text,
  patient_name text,
  patient_number text,
  panel_name text,
  ordered_at timestamptz,
  resulted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.status::text, p.full_name, p.patient_number,
         pb.name, o.ordered_at, o.resulted_at
  from public.lab_orders o
  join public.profiles p on p.id = o.patient_id
  join public.lab_providers lp on lp.id = o.provider_id
  left join public.panel_bundles pb on pb.id = o.panel_bundle_id
  where private.is_provider_org_staff_for(p_organisation_id)
    and lp.organisation_id = p_organisation_id
    and o.status <> 'pending_payment'
  order by o.ordered_at desc;
$$;

revoke all on function public.provider_org_lab_order_queue(uuid) from public;
revoke all on function public.provider_org_lab_order_queue(uuid) from anon;
grant execute on function public.provider_org_lab_order_queue(uuid) to authenticated;

create or replace function public.provider_org_pharmacy_order_queue(p_organisation_id uuid)
returns table (
  order_id uuid,
  order_number text,
  status text,
  patient_name text,
  patient_number text,
  total_kobo bigint,
  requested_at timestamptz,
  delivered_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.status::text, p.full_name, p.patient_number,
         o.total_kobo, o.requested_at, o.delivered_at
  from public.pharmacy_orders o
  join public.profiles p on p.id = o.patient_id
  join public.pharmacy_partners pp on pp.id = o.pharmacy_partner_id
  where private.is_provider_org_staff_for(p_organisation_id)
    and pp.organisation_id = p_organisation_id
    and o.status <> 'pending_payment'
  order by o.requested_at desc;
$$;

revoke all on function public.provider_org_pharmacy_order_queue(uuid) from public;
revoke all on function public.provider_org_pharmacy_order_queue(uuid) from anon;
grant execute on function public.provider_org_pharmacy_order_queue(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_sp  uuid;
begin
  -- The claim guard discriminates: wrong-typed org refused, right-typed
  -- org accepted, inside a rolled-back simulation.
  begin
    insert into public.organisations (name, type) values ('ASSERT Wrong Claim Org', 'clinic') returning id into v_org;
    insert into public.specialist_providers (name, specialist_type) values ('ASSERT Specialist', 'cardiology') returning id into v_sp;
    begin
      update public.specialist_providers set organisation_id = v_org where id = v_sp;
      raise exception 'FAIL: a specialist_providers row was claimed by a non-provider_org organisation';
    exception
      when check_violation then null;
    end;

    insert into public.organisations (name, type) values ('ASSERT Right Claim Org', 'provider_org') returning id into v_org;
    update public.specialist_providers set organisation_id = v_org where id = v_sp;
    if (select organisation_id from public.specialist_providers where id = v_sp) <> v_org then
      raise exception 'FAIL: a correctly-typed organisation could not claim a specialist_providers row';
    end if;

    raise exception 'ROLLBACK_ASSERTIONS';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_ASSERTIONS' then raise; end if;
  end;

  if exists (select 1 from public.organisations where name like 'ASSERT %')
     or exists (select 1 from public.specialist_providers where name = 'ASSERT Specialist') then
    raise exception 'FAIL: assertion fixtures survived — should have rolled back';
  end if;

  if pg_get_functiondef('public.provider_org_referral_queue(uuid)'::regprocedure)
       not like '%is_provider_org_staff_for%' then
    raise exception 'FAIL: provider_org_referral_queue does not gate on is_provider_org_staff_for';
  end if;

  raise notice 'PASS: directory claiming + read-only queues in place, claim guard proved to discriminate';
end $$;
