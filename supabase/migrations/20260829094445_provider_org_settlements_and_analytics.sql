-- Tarragon Health — module 28, part 4: billing (28.10) and analytics
-- (28.11/28.12).
--
-- partner_statements/partner_statement_lines (2026-07-26, finance module)
-- already reconciles Tarragon's OWN payable to a lab_providers row, but its
-- provider_id FK is hard-typed to lab_providers alone — it cannot represent
-- a hospital, pharmacy or specialist practice, or an org with no claimed
-- directory row at all (a hospital offering only in-person consultations
-- has none of the four). provider_org_settlements is a parallel, genuinely
-- generic ledger scoped by organisation_id (the provider_organisation
-- itself), not by which directory type it happens to have claimed.
-- Deliberately NOT wired into finance_bills/finance_vendors yet — that
-- needs a real finance_vendors row per onboarded provider organisation,
-- which is onboarding-process work for whenever the first one actually
-- signs, not schema this migration should invent speculatively. bill_id
-- stays nullable and unused until that integration is built, the same
-- "schema-scaffolded, not wired" posture as clinical_resources.

do $$ begin
  create type public.provider_org_settlement_status as enum
    ('draft', 'issued', 'disputed', 'approved', 'settled');
exception when duplicate_object then null; end $$;

create table public.provider_org_settlements (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  reference           text,
  period_start        date not null,
  period_end          date not null,
  currency            public.currency not null default 'NGN',
  invoiced_total_kobo bigint not null default 0 check (invoiced_total_kobo >= 0),
  approved_total_kobo bigint check (approved_total_kobo is null or approved_total_kobo >= 0),
  status              public.provider_org_settlement_status not null default 'draft',
  note                text,
  bill_id             uuid references public.finance_bills (id) on delete set null,
  approved_by         uuid references public.profiles (id) on delete set null,
  approved_at         timestamptz,
  settled_at          timestamptz,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint provider_org_settlements_period_ordered check (period_end >= period_start)
);

comment on table public.provider_org_settlements is
  '28.10. One statement period for one provider organisation''s Tarragon-related billing (its own service fees, referral fees it owes/is owed, whatever the eventual contract prices) — a generic parallel to partner_statements for organisations that are not (only) a claimed lab_providers row.';

create index provider_org_settlements_org_idx on public.provider_org_settlements (organisation_id, status);

create trigger provider_org_settlements_set_updated_at
  before update on public.provider_org_settlements
  for each row execute function private.set_updated_at();

create table public.provider_org_settlement_lines (
  id              uuid primary key default gen_random_uuid(),
  settlement_id   uuid not null references public.provider_org_settlements (id) on delete cascade,
  description     text not null,
  reference_type  text,
  reference_id    uuid,
  amount_kobo     bigint not null check (amount_kobo >= 0),
  created_at      timestamptz not null default now()
);

comment on column public.provider_org_settlement_lines.reference_id is
  'Optional pointer into whichever table reference_type names (an appointment/referral/service instance) — no FK, same polymorphic-with-comment idiom insurance_claims.source_id already uses; a line can also stand alone with just a description.';

create index provider_org_settlement_lines_settlement_idx on public.provider_org_settlement_lines (settlement_id);

alter table public.provider_org_settlements enable row level security;
alter table public.provider_org_settlement_lines enable row level security;

create policy provider_org_settlements_select on public.provider_org_settlements
  for select to authenticated
  using (private.is_admin() or private.is_provider_org_staff_for(organisation_id));

create policy provider_org_settlements_manage on public.provider_org_settlements
  for all to authenticated
  using (private.is_admin() or private.is_provider_org_staff_for(organisation_id, array['owner', 'finance_manager']::public.provider_org_role[]))
  with check (private.is_admin() or private.is_provider_org_staff_for(organisation_id, array['owner', 'finance_manager']::public.provider_org_role[]));

grant select, insert, update, delete on public.provider_org_settlements to authenticated;
revoke all on public.provider_org_settlements from anon;

create policy provider_org_settlement_lines_select on public.provider_org_settlement_lines
  for select to authenticated
  using (
    private.is_admin()
    or exists (select 1 from public.provider_org_settlements s
                where s.id = settlement_id and private.is_provider_org_staff_for(s.organisation_id))
  );

create policy provider_org_settlement_lines_manage on public.provider_org_settlement_lines
  for all to authenticated
  using (
    private.is_admin()
    or exists (select 1 from public.provider_org_settlements s
                where s.id = settlement_id
                  and private.is_provider_org_staff_for(s.organisation_id, array['owner', 'finance_manager']::public.provider_org_role[]))
  )
  with check (
    private.is_admin()
    or exists (select 1 from public.provider_org_settlements s
                where s.id = settlement_id
                  and private.is_provider_org_staff_for(s.organisation_id, array['owner', 'finance_manager']::public.provider_org_role[]))
  );

grant select, insert, update, delete on public.provider_org_settlement_lines to authenticated;
revoke all on public.provider_org_settlement_lines from anon;

-- ---------------------------------------------------------------------------
-- 28.11/28.12 analytics — grounded in the tables actually built. No
-- fabricated appointment/waiting-time/turnaround metrics: this platform
-- deliberately did not give a provider organisation its own booking engine
-- (see part 1's header), so a real appointments/utilisation/turnaround
-- figure does not exist yet for one to report. What DOES exist: staffing,
-- structure, referral/order queue volume and settlement status — reported
-- honestly, with quality metrics (28.12) limited to what the referral
-- queue can actually measure (response time from referral creation to the
-- organisation booking it).
-- ---------------------------------------------------------------------------
create or replace function public.provider_org_analytics(p_organisation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff jsonb;
  v_structure jsonb;
  v_referrals jsonb;
  v_labs jsonb;
  v_pharmacy jsonb;
  v_settlements jsonb;
  v_avg_response_hours numeric;
begin
  if not private.is_provider_org_staff_for(p_organisation_id) then
    raise exception 'not authorised to view this organisation''s analytics' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(org_role, n), '{}'::jsonb) into v_staff
  from (
    select org_role::text, count(*) as n
    from public.provider_org_members
    where organisation_id = p_organisation_id and is_active
    group by org_role
  ) s;

  select jsonb_build_object(
    'locations', (select count(*) from public.provider_org_locations where organisation_id = p_organisation_id and is_active),
    'departments', (select count(*) from public.provider_org_departments where organisation_id = p_organisation_id and is_active),
    'services', (select count(*) from public.provider_org_services where organisation_id = p_organisation_id and is_active),
    'resources', (select count(*) from public.provider_org_resources where organisation_id = p_organisation_id and is_active)
  ) into v_structure;

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb), avg(response_hours)
    into v_referrals, v_avg_response_hours
  from (
    select r.status::text as status,
           extract(epoch from (r.booking_confirmed_at - r.created_at)) / 3600 as response_hours
    from public.specialist_referrals r
    join public.specialist_providers sp on sp.id = r.specialist_provider_id
    where sp.organisation_id = p_organisation_id
  ) s
  group by ();

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_labs
  from (
    select o.status::text, count(*) as n
    from public.lab_orders o
    join public.lab_providers lp on lp.id = o.provider_id
    where lp.organisation_id = p_organisation_id
    group by o.status
  ) s;

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_pharmacy
  from (
    select o.status::text, count(*) as n
    from public.pharmacy_orders o
    join public.pharmacy_partners pp on pp.id = o.pharmacy_partner_id
    where pp.organisation_id = p_organisation_id
    group by o.status
  ) s;

  select coalesce(jsonb_object_agg(status, jsonb_build_object('count', n, 'invoiced_total_kobo', total)), '{}'::jsonb)
    into v_settlements
  from (
    select status::text, count(*) as n, sum(invoiced_total_kobo) as total
    from public.provider_org_settlements
    where organisation_id = p_organisation_id
    group by status
  ) s;

  return jsonb_build_object(
    'staff_by_role', v_staff,
    'structure', v_structure,
    'referrals_by_status', v_referrals,
    'referral_avg_response_hours', round(coalesce(v_avg_response_hours, 0)::numeric, 1),
    'lab_orders_by_status', v_labs,
    'pharmacy_orders_by_status', v_pharmacy,
    'settlements_by_status', v_settlements
  );
end;
$$;

revoke all on function public.provider_org_analytics(uuid) from public;
revoke all on function public.provider_org_analytics(uuid) from anon;
grant execute on function public.provider_org_analytics(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_table_privilege('authenticated', 'public.provider_org_settlements', 'SELECT')
     or not has_table_privilege('authenticated', 'public.provider_org_settlement_lines', 'SELECT') then
    raise exception 'FAIL: missing authenticated grants on settlement tables';
  end if;
  if has_table_privilege('anon', 'public.provider_org_settlements', 'SELECT') then
    raise exception 'FAIL: anon can read provider_org_settlements';
  end if;

  begin
    perform public.provider_org_analytics((select organisation_id from public.provider_organisations limit 1));
    raise exception 'FAIL: provider_org_analytics returned for an unauthorised/no-fixture caller instead of raising';
  exception
    when insufficient_privilege then null;
    when others then
      -- No provider_organisations row exists yet at all (limit 1 returned
      -- null) — the function still must not silently succeed on a null id.
      if sqlerrm not like '%not authorised%' then raise; end if;
  end;

  raise notice 'PASS: provider org settlements + analytics in place';
end $$;
