-- Laboratory Network, part 9: version-controlled, multi-payer pricing
-- (§56.14) — "cash price, payer price, employer price, Tarragon-negotiated
-- price... pricing must be version-controlled."
--
-- lab_tests.price_kobo already IS the Tarragon-negotiated price (the
-- contract cost — see the 2026-08-21 restructure migration's own header
-- comment) but it is a single live value with no history: a reprice
-- overwrites it in place, and nothing records what it used to be or when it
-- changed. This adds the other three price types the spec names, and gives
-- all four real version history, WITHOUT touching what already keys the
-- margin-safety triggers (assert_test_price_covers_cost,
-- lab_orders_zz_never_below_partner_cost) — those still read
-- lab_tests.price_kobo directly, so this migration keeps that column in
-- sync with the latest tarragon_negotiated version rather than replacing it.
-- A reprice becomes "insert a new version", not "overwrite the only copy".

create type public.lab_price_type as enum ('cash', 'payer', 'employer', 'tarragon_negotiated');

create table public.lab_test_price_versions (
  id              uuid primary key default gen_random_uuid(),
  provider_id     uuid not null,
  test_code       text not null,
  price_type      public.lab_price_type not null,
  price_kobo      bigint not null check (price_kobo >= 0),
  effective_from  timestamptz not null default now(),
  effective_to    timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint lab_test_price_versions_lab_tests_fkey
    foreign key (provider_id, test_code) references public.lab_tests (provider_id, code) on delete cascade,
  constraint lab_test_price_versions_range_valid
    check (effective_to is null or effective_to > effective_from)
);

create index lab_test_price_versions_lookup_idx
  on public.lab_test_price_versions (provider_id, test_code, price_type, effective_from desc);
-- At most one OPEN (effective_to is null) version per (provider, test, price
-- type) — the close-out trigger below is what keeps this true on every
-- insert, this index is what makes it a guarantee rather than a convention.
create unique index lab_test_price_versions_one_open
  on public.lab_test_price_versions (provider_id, test_code, price_type)
  where effective_to is null;

comment on table public.lab_test_price_versions is
  'Append-only price history per (laboratory, test, payer type). Never updated or deleted once written — a correction is a new version. lab_test_current_prices (below) is "the row with effective_to is null" per key.';
comment on column public.lab_test_price_versions.price_type is
  'cash/payer/employer are the laboratory''s own price list, settable by that lab_partner for their own provider_id. tarragon_negotiated is what the laboratory charges TARRAGON (the existing lab_tests.price_kobo) — settable only by an admin or partners.labs.manage, since it is what the margin-safety triggers are built to protect.';

alter table public.lab_test_price_versions enable row level security;

create policy lab_test_price_versions_select on public.lab_test_price_versions
  for select to authenticated using (true);

create policy lab_test_price_versions_insert on public.lab_test_price_versions
  for insert to authenticated
  with check (
    private.is_admin()
    or private.has_permission('partners.labs.manage')
    or (price_type <> 'tarragon_negotiated' and provider_id = private.lab_partner_provider())
  );

-- No update/delete policy at all — see the table comment. RLS default-denies
-- both, which is the point: history is append-only by construction, not by
-- convention someone could forget.

grant select, insert on public.lab_test_price_versions to authenticated;

create view public.lab_test_current_prices
with (security_invoker = true) as
  select provider_id, test_code, price_type, price_kobo, effective_from, created_by
    from public.lab_test_price_versions
   where effective_to is null;

comment on view public.lab_test_current_prices is
  'The live price per (laboratory, test, payer type) — one row per open version. security_invoker so it carries the base table''s own RLS rather than the view owner''s.';

grant select on public.lab_test_current_prices to authenticated;

-- ---------------------------------------------------------------------------
-- Close out the previous open version, and — for tarragon_negotiated only —
-- keep lab_tests.price_kobo in sync so the existing margin triggers keep
-- reading a live number without needing to know this table exists.
-- ---------------------------------------------------------------------------
create or replace function private.apply_lab_test_price_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.lab_test_price_versions
     set effective_to = new.effective_from
   where provider_id = new.provider_id
     and test_code = new.test_code
     and price_type = new.price_type
     and id <> new.id
     and effective_to is null;

  if new.price_type = 'tarragon_negotiated' and new.effective_from <= now() then
    update public.lab_tests
       set price_kobo = new.price_kobo
     where provider_id = new.provider_id and code = new.test_code;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_lab_test_price_version() from public;

drop trigger if exists lab_test_price_versions_apply on public.lab_test_price_versions;
create trigger lab_test_price_versions_apply
  after insert on public.lab_test_price_versions
  for each row execute function private.apply_lab_test_price_version();

-- ---------------------------------------------------------------------------
-- Backfill: every existing (provider, test) with a real price gets its
-- current lab_tests.price_kobo recorded as its opening tarragon_negotiated
-- version, so history starts from the truth already on file rather than
-- empty. effective_from backdated to when the test row itself was created —
-- not "now" — so this backfill does not itself read as a reprice.
-- ---------------------------------------------------------------------------
insert into public.lab_test_price_versions (provider_id, test_code, price_type, price_kobo, effective_from)
select lt.provider_id, lt.code, 'tarragon_negotiated', lt.price_kobo, lt.created_at
  from public.lab_tests lt
 where lt.price_kobo is not null
on conflict do nothing;

-- Live insert/close-out/sync-trigger behaviour (proving a new version both
-- closes the previous one and updates lab_tests.price_kobo) is verified in
-- packages/db/tests/lab_network_pricing_and_specimens.sql, the same
-- begin/rollback-wrapped pattern lab_partner_rls.sql uses — not exercised
-- here, so this migration never has to unwind a probe write of its own.
do $$
declare
  v_synlab uuid;
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'lab_test_price_versions') then
    raise exception 'lab_test_price_versions was not created';
  end if;

  select id into v_synlab from public.lab_providers where name = 'Synlab Nigeria';
  if v_synlab is null then
    raise exception 'Synlab Nigeria not found — cannot verify the backfill';
  end if;

  -- Every priced Synlab test has exactly one open tarragon_negotiated version.
  if exists (
    select 1 from public.lab_tests lt
    where lt.provider_id = v_synlab and lt.price_kobo is not null
      and not exists (
        select 1 from public.lab_test_price_versions v
        where v.provider_id = lt.provider_id and v.test_code = lt.code
          and v.price_type = 'tarragon_negotiated' and v.effective_to is null
      )
  ) then
    raise exception 'a priced Synlab test has no open tarragon_negotiated version after the backfill';
  end if;

  if not has_table_privilege('authenticated', 'public.lab_test_price_versions', 'SELECT') then
    raise exception 'authenticated must be able to read lab_test_price_versions';
  end if;
  if has_table_privilege('authenticated', 'public.lab_test_price_versions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.lab_test_price_versions', 'DELETE') then
    raise exception 'lab_test_price_versions must be append-only — no UPDATE/DELETE grant to authenticated';
  end if;
end $$;
