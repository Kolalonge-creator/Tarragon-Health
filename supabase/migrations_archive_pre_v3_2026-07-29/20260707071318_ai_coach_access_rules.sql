-- Tarragon Health
-- AI Health Coach — admin-controlled access rules
--
-- The coach is a per-message-billed Claude feature, so access is admin-
-- gated rather than open to every patient by default. Two-tier scope,
-- mirroring vitals_reminder_rules (20260706000001): a global row
-- (patient_id is null) enables/disables the coach for the whole org, a
-- per-patient row overrides that for one patient. Both are optional; with
-- neither set, access falls back to the existing subscription-plan
-- 'ai_coach' feature flag (see private.has_ai_coach_access() below).

create table public.ai_coach_access_rules (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  patient_id        uuid references public.profiles (id) on delete cascade,
  enabled           boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- At most one rule per scope tier per org.
create unique index ai_coach_access_rules_patient_uidx
  on public.ai_coach_access_rules (organisation_id, patient_id)
  where patient_id is not null;

create unique index ai_coach_access_rules_global_uidx
  on public.ai_coach_access_rules (organisation_id)
  where patient_id is null;

create index ai_coach_access_rules_org_idx on public.ai_coach_access_rules (organisation_id);

create trigger ai_coach_access_rules_set_updated_at
  before update on public.ai_coach_access_rules
  for each row execute function private.set_updated_at();

alter table public.ai_coach_access_rules enable row level security;

-- Admin-only, same as vitals_reminder_rules: patients never read this table
-- directly (they learn their own resolved access via the RPC below, not by
-- querying this table, since it can also carry org-mates' patient_id rows).
create policy ai_coach_access_rules_admin_select
  on public.ai_coach_access_rules for select
  to authenticated
  using (private.is_admin());

create policy ai_coach_access_rules_admin_insert
  on public.ai_coach_access_rules for insert
  to authenticated
  with check (private.is_admin());

create policy ai_coach_access_rules_admin_update
  on public.ai_coach_access_rules for update
  to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy ai_coach_access_rules_admin_delete
  on public.ai_coach_access_rules for delete
  to authenticated
  using (private.is_admin());

grant select, insert, update, delete on public.ai_coach_access_rules to authenticated;

-- ---------------------------------------------------------------------------
-- private.has_ai_coach_access() — lets any authenticated user learn their
-- own resolved access without needing read access to the admin-only rules
-- table above. Always evaluates for auth.uid(), never a passed-in id, so
-- there's no spoofing surface (same pattern as private.current_role()).
-- ---------------------------------------------------------------------------

create or replace function private.has_ai_coach_access()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_org uuid;
  v_patient_rule boolean;
  v_global_rule boolean;
begin
  select role, organisation_id into v_role, v_org
    from public.profiles where id = (select auth.uid());

  if v_role = 'admin' then
    return true;
  end if;

  select enabled into v_patient_rule
    from public.ai_coach_access_rules
    where organisation_id = v_org and patient_id = (select auth.uid());
  if v_patient_rule is not null then
    return v_patient_rule;
  end if;

  select enabled into v_global_rule
    from public.ai_coach_access_rules
    where organisation_id = v_org and patient_id is null;
  if v_global_rule is not null then
    return v_global_rule;
  end if;

  return exists (
    select 1
    from public.subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
    where s.subscriber_id = (select auth.uid())
      and s.status in ('active', 'trialing')
      and 'ai_coach' = any(p.features)
  );
end;
$$;

grant execute on function private.has_ai_coach_access() to authenticated;
