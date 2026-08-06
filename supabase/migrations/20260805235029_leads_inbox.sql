-- Gives public.leads (20260712024423) a real read/triage surface. Since that
-- migration it has only ever been written to (server action + service role,
-- from the marketing Contact form and the plan-finder eligibility check) and
-- read by nobody — no admin page, no notification, nothing. A corporate or
-- HMO lead (role already carries both) submitted today would sit in this
-- table forever with zero eyes on it.
--
-- contacted_at/contacted_by let a lead move from "new" to "handled" without
-- deleting the row. The old leads_admin_select policy hand-rolled its own
-- profiles.role='admin' check, predating the RBAC system
-- (20260718230000) — replaced here with the same is_admin()-or-
-- has_permission() shape every RBAC-era table uses, so lead triage can be
-- delegated the same way facilities/partners/orgs already are, without
-- handing out full super admin.

alter table public.leads
  add column contacted_at timestamptz,
  add column contacted_by uuid references public.profiles (id) on delete set null;

insert into public.permissions (key, label, category, description) values
  ('leads.manage', 'Manage leads', 'Growth', 'View and triage marketing leads')
on conflict (key) do nothing;

drop policy if exists leads_admin_select on public.leads;

create policy leads_select on public.leads
  for select to authenticated
  using (private.is_admin() or private.has_permission('leads.manage'));

-- No update policy existed before this — the table was insert-(service-role)-
-- and-nothing-else. "Mark contacted" needs one.
create policy leads_update on public.leads
  for update to authenticated
  using (private.is_admin() or private.has_permission('leads.manage'))
  with check (private.is_admin() or private.has_permission('leads.manage'));

-- RLS restricts rows; it does not grant table-level access (see
-- reference_authenticated_table_grants_root_cause in memory — this exact
-- table already shipped once without checking that). SELECT already reached
-- authenticated via the project's default-privileges fix; UPDATE did not,
-- because until this migration nothing ever needed it.
grant update on public.leads to authenticated;

do $$
begin
  if not exists (select 1 from public.permissions where key = 'leads.manage') then
    raise exception 'leads.manage permission is missing';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'leads' and policyname = 'leads_select'
  ) then
    raise exception 'leads_select policy is missing';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'leads' and policyname = 'leads_update'
  ) then
    raise exception 'leads_update policy is missing';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'leads' and policyname = 'leads_admin_select'
  ) then
    raise exception 'the old hand-rolled admin-only select policy should be gone';
  end if;
end $$;
