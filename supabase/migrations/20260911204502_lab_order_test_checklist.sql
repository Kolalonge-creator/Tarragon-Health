-- Per-test checklist for a multi-test lab order (e.g. Essential/Core
-- Screen): lets a patient mark each individual test in the panel as
-- done / not yet done / will not be doing, and scope an uploaded result to
-- one specific test rather than the whole order. Founder ask, 2026-09-11,
-- alongside removing the dead Synlab "Book & pay" UI (guidance_only made
-- that path unreachable at the DB level already, see migration
-- 20260910011846_catalogue_becomes_guidance_not_commerce.sql).
--
-- A row is only written when the patient actually interacts with that test
-- (changes its status, or uploads against it) — a fresh order needs no rows
-- pre-seeded, every test_code with no row is implicitly "not yet done".

alter table public.lab_result_documents
  add column if not exists test_code text;

create table if not exists public.lab_order_test_status (
  id uuid primary key default gen_random_uuid(),
  lab_order_id uuid not null references public.lab_orders(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id),
  test_code text not null,
  status text not null default 'not_yet_done' check (status in ('not_yet_done', 'done', 'will_not_do')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (lab_order_id, test_code)
);

comment on table public.lab_order_test_status is
  'Per-test-code progress within one lab_orders row (done / not yet done / will not be doing). organisation_id is set by trigger from the parent order, never supplied by the client.';

create or replace function private.set_lab_order_test_status_organisation_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select organisation_id into new.organisation_id
  from public.lab_orders
  where id = new.lab_order_id;
  if new.organisation_id is null then
    raise exception 'lab_order_test_status: lab_order_id % has no organisation_id (order not found?)', new.lab_order_id;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_organisation_id on public.lab_order_test_status;
create trigger set_organisation_id
  before insert or update on public.lab_order_test_status
  for each row execute function private.set_lab_order_test_status_organisation_id();

alter table public.lab_order_test_status enable row level security;

drop policy if exists lab_order_test_status_select on public.lab_order_test_status;
create policy lab_order_test_status_select on public.lab_order_test_status
  for select
  using (
    exists (
      select 1 from public.lab_orders lo
      where lo.id = lab_order_test_status.lab_order_id
        and lo.patient_id = (select auth.uid())
    )
    or private.is_org_staff(organisation_id)
  );

drop policy if exists lab_order_test_status_insert on public.lab_order_test_status;
create policy lab_order_test_status_insert on public.lab_order_test_status
  for insert
  with check (
    exists (
      select 1 from public.lab_orders lo
      where lo.id = lab_order_test_status.lab_order_id
        and lo.patient_id = (select auth.uid())
    )
    or private.is_org_staff(organisation_id)
  );

drop policy if exists lab_order_test_status_update on public.lab_order_test_status;
create policy lab_order_test_status_update on public.lab_order_test_status
  for update
  using (
    exists (
      select 1 from public.lab_orders lo
      where lo.id = lab_order_test_status.lab_order_id
        and lo.patient_id = (select auth.uid())
    )
    or private.is_org_staff(organisation_id)
  )
  with check (
    exists (
      select 1 from public.lab_orders lo
      where lo.id = lab_order_test_status.lab_order_id
        and lo.patient_id = (select auth.uid())
    )
    or private.is_org_staff(organisation_id)
  );

-- New table needs its own explicit grant — RLS restricts rows, it does not
-- grant table access, and Supabase's project-creation-time default grant
-- does not retroactively cover a table added later by a plain migration
-- (recurred at least 3 times on this project; see CLAUDE.md).
grant select, insert, update on public.lab_order_test_status to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lab_order_test_status'
  ) then
    raise exception 'lab_order_test_status: RLS policies missing';
  end if;
  if not has_table_privilege('authenticated', 'public.lab_order_test_status', 'INSERT') then
    raise exception 'lab_order_test_status: authenticated grant missing';
  end if;
end $$;
