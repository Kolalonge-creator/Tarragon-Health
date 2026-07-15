-- Tarragon Health
-- Full-population employer enrolment (docs/FULL_SPECIFICATION_V4.md §2.4/§8
-- — "Full-population employer distribution model: corporate contracts that
-- auto-enrol the whole workforce rather than relying on elective sign-up").
--
-- Deliberately scoped to *organisation_id assignment* only, not billing/
-- entitlement. public.has_feature_access() (20260712201523) is entirely
-- per-subscriber via subscriptions/subscription_add_ons — there is no
-- org-level "capitation covers this employee's plan" bypass anywhere in the
-- schema yet, and adding one is a real monetisation/architecture decision
-- (how does a roster-enrolled employee's paid tier get funded — corporate
-- invoice, capitation draw-down, employee still pays individually for
-- upgrades?) that shouldn't be smuggled into a roster table. This migration
-- only makes an employee show up under the employer's organisation_id (so
-- they appear in the existing corporate cohort-analytics dashboard and can
-- be reached by org staff) without requiring them to individually sign up
-- and self-associate first, same as the spec's "widening the funnel per
-- employee per month" framing. Free-tier access is already available to
-- everyone regardless of org, so a roster-enrolled employee gets at minimum
-- the same Tarragon Free experience as a self-serve signup, just correctly
-- attributed to their employer from day one.

create type public.employer_roster_status as enum ('pending', 'claimed', 'removed');

create table public.employer_roster_members (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  phone              text not null,
  full_name          text,
  status             public.employer_roster_status not null default 'pending',
  claimed_profile_id uuid references public.profiles (id) on delete set null,
  claimed_at         timestamptz,
  added_by           uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint employer_roster_members_phone_e164 check (phone ~ '^\+[1-9][0-9]{7,14}$')
);

-- One roster row per (org, phone) — re-adding the same person is an update,
-- not a duplicate pending row.
create unique index employer_roster_members_org_phone_idx
  on public.employer_roster_members (organisation_id, phone);

create index employer_roster_members_status_idx
  on public.employer_roster_members (organisation_id, status);

alter table public.employer_roster_members enable row level security;

-- Org staff (corporate_admin, or admin) only — this is an HR/roster tool,
-- not something the employee reads directly (mirrors outcomes_contracts'
-- staff-only visibility).
create policy employer_roster_members_select on public.employer_roster_members
  for select to authenticated
  using (private.is_org_staff(organisation_id));
create policy employer_roster_members_insert on public.employer_roster_members
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
create policy employer_roster_members_update on public.employer_roster_members
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy employer_roster_members_delete on public.employer_roster_members
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.employer_roster_members to authenticated;

-- ---------------------------------------------------------------------------
-- Immediate claim: a corporate admin adds someone to the roster who has
-- already self-signed-up (still sitting on the default consumer org, never
-- reassigned). Cross-org phone lookup is normally blocked (see
-- find_profile_by_phone's same-org restriction, deliberately, to prevent a
-- phone-number enumeration oracle) — this is the one legitimate exception,
-- narrowly scoped: only matches a profile still on the default consumer org
-- (never reassigns someone already attached to a different real employer/
-- clinic/HMO), and only callable by staff of the roster row's own org.
-- ---------------------------------------------------------------------------
create or replace function public.claim_employer_roster_member(target_roster_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roster public.employer_roster_members;
  v_profile_id uuid;
begin
  select * into v_roster from public.employer_roster_members where id = target_roster_id;
  if v_roster.id is null then
    raise exception 'Roster entry not found';
  end if;
  if not private.is_org_staff(v_roster.organisation_id) then
    raise exception 'Not authorised for this organisation';
  end if;
  if v_roster.status <> 'pending' then
    return false;
  end if;

  select id into v_profile_id
  from public.profiles
  where phone = v_roster.phone
    and role = 'patient'
    and organisation_id = '00000000-0000-0000-0000-000000000001'
  limit 1;

  if v_profile_id is null then
    return false;
  end if;

  update public.profiles set organisation_id = v_roster.organisation_id where id = v_profile_id;
  update public.employer_roster_members
    set status = 'claimed', claimed_profile_id = v_profile_id, claimed_at = now()
    where id = target_roster_id;

  return true;
end;
$$;

revoke execute on function public.claim_employer_roster_member(uuid) from public;
revoke execute on function public.claim_employer_roster_member(uuid) from anon;
grant execute on function public.claim_employer_roster_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Signup-time claim: a new self-serve signup's phone matches a pending
-- roster row. Only applies when the signup didn't already resolve to an
-- explicit non-default organisation via app_metadata (an admin-provisioned
-- staff/clinician account, or an already-targeted org) — never overrides
-- that.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_org_id uuid;
  v_roster_id uuid;
  v_roster_org_id uuid;
begin
  v_phone := case
    when new.phone is null or new.phone = '' then null
    when new.phone ~ '^\+' then new.phone
    else '+' || new.phone
  end;

  v_org_id := coalesce(
    (new.raw_app_meta_data ->> 'organisation_id')::uuid,
    '00000000-0000-0000-0000-000000000001'
  );

  -- Only consult the roster when no explicit org came through app_metadata
  -- (i.e. this is an ordinary self-serve signup, not an admin-provisioned
  -- staff/clinician account already targeted at a specific org).
  if (new.raw_app_meta_data ->> 'organisation_id') is null and v_phone is not null then
    select id, organisation_id into v_roster_id, v_roster_org_id
    from public.employer_roster_members
    where phone = v_phone and status = 'pending'
    order by created_at
    limit 1;
    if v_roster_id is not null then
      v_org_id := v_roster_org_id;
    end if;
  end if;

  insert into public.profiles (id, role, organisation_id, full_name, phone)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'patient'),
    coalesce(v_org_id, '00000000-0000-0000-0000-000000000001'),
    new.raw_user_meta_data ->> 'full_name',
    v_phone
  );

  if v_roster_id is not null then
    update public.employer_roster_members
      set status = 'claimed', claimed_profile_id = new.id, claimed_at = now()
      where id = v_roster_id;
  end if;

  return new;
end;
$$;
