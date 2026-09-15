-- Tarragon Health — Employer Health Platform, part 1/6: account structure and
-- the onboarding workflow (Module 26 §26.2, §26.3).
--
-- What already existed, and why it wasn't enough:
--   * `organisations` carries only (name, type, is_active, metadata,
--     min_cohort_size). An employer is a `type = 'corporate'` row and nothing
--     more — no legal entity, no verification state, no record of whether the
--     account is actually live. `admin_create_institution_org`
--     (20260805234029) mints that bare row, which is where employer
--     onboarding currently stops.
--   * `corporate_contracts` (20260705211343) exists but models exactly one
--     commercial shape — per employee per year — and is read by zero lines of
--     application code.
--   * `employer_roster_members` is a flat, phone-only staff list with nothing
--     to segment it by.
--
-- §26.2 names the account structure an employer needs and §26.3 names
-- onboarding as an ORDERED sequence ending in "Go live". This part builds the
-- structural spine: the employer account record (registration → verification →
-- contract → billing → go-live), the five §26.15 billing models folded into
-- the EXISTING `corporate_contracts` table rather than a second contract
-- concept beside it, and locations/departments. Parts 2-6 add
-- eligibility/invitations, benefits + entitlement wiring, the aggregate
-- dashboard, campaigns/communications, and invoicing.
--
-- ── Security posture (read before changing any policy below) ────────────────
-- `private.is_org_staff()` deliberately EXCLUDES corporate_admin/hmo_admin
-- (I9, 20260729124330): an institution administrator reads zero rows from
-- every patient-scoped table, and that exclusion — not a UI choice — is the
-- real enforcement across 314 policies on 110 tables. So every table here
-- grants the employer administrator BY NAME via
-- `private.is_institution_admin() and organisation_id = private.current_org_id()`,
-- exactly as `employer_roster_members`/`outcome_reports` already do. Nothing
-- in this migration holds health data — these are the employer's own
-- corporate records — so the grant widens PHI access by zero rows.
--
-- ── Who may write what ─────────────────────────────────────────────────────
-- Verification, contract terms and go-live are Tarragon-side facts: an
-- employer must not be able to mark its own business verified or its own
-- contract signed. Its legal details, contacts, locations and departments are
-- its own to maintain. RLS is row-level, not column-level, so
-- `employer_accounts` gets one update policy plus a guard trigger blocking a
-- non-admin from the Tarragon-side columns — the same shape as
-- `private.guard_profiles_self_update()`, the established pattern here for
-- "you own the row, but not these columns".

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.employer_verification_status as enum (
  'unverified',   -- registered; nothing submitted yet
  'pending',      -- documents submitted, Tarragon reviewing
  'verified',
  'rejected'
);

-- The §26.3 workflow, in order. An enum rather than a boolean per step, so an
-- account has exactly one position in the sequence and "which step is this
-- employer on" is answerable without inferring it from six nullable
-- timestamps.
create type public.employer_onboarding_step as enum (
  'registration',
  'business_verification',
  'contract',
  'programme_selection',
  'benefit_configuration',
  'eligibility_configuration',
  'billing_setup',
  'administrator_accounts',
  'live'
);

-- §26.15. `hybrid` means a standing fixed fee PLUS a per-active-member rate,
-- so it requires both figures (enforced below) and can never quietly mean
-- "unspecified".
create type public.employer_billing_model as enum (
  'per_employee',
  'per_active_member',
  'fixed_contract',
  'service_based',
  'hybrid'
);

-- ---------------------------------------------------------------------------
-- employer_accounts — 1:1 with a corporate organisation
-- ---------------------------------------------------------------------------

create table public.employer_accounts (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null unique
                              references public.organisations (id) on delete cascade,

  -- Legal entity (§26.3 "Organisation registration"). CAC RC number and FIRS
  -- TIN are the two identifiers a Nigerian employer is actually asked for.
  legal_name                text,
  rc_number                 text,
  tin                       text,
  industry                  text,
  declared_employee_count   integer,

  primary_contact_name      text,
  primary_contact_email     text,
  primary_contact_phone     text,

  -- Business verification (§26.3). Attribution is null-gated the same way
  -- clinical review is: "verified" is only ever rendered off a real
  -- verified_by/verified_at pair, never inferred from the status alone.
  verification_status       public.employer_verification_status not null default 'unverified',
  verification_submitted_at timestamptz,
  verified_by               uuid references public.profiles (id) on delete restrict,
  verified_at               timestamptz,
  verification_notes        text,

  onboarding_step           public.employer_onboarding_step not null default 'registration',
  went_live_at              timestamptz,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint employer_accounts_phone_e164
    check (primary_contact_phone is null or primary_contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint employer_accounts_declared_count_positive
    check (declared_employee_count is null or declared_employee_count > 0),

  -- Verification attribution is all-or-nothing, and 'verified' cannot be
  -- claimed without it.
  constraint employer_accounts_verified_attribution
    check (
      (verified_by is null) = (verified_at is null)
      and (verification_status <> 'verified' or verified_at is not null)
    ),

  -- §26.3's whole point: "Go live" is the END of the sequence, not a flag
  -- somebody sets early. The rest of the precondition (a signed, active
  -- contract carrying a billing model) lives in a trigger, because a CHECK
  -- cannot read another table.
  constraint employer_accounts_live_is_the_last_step
    check (
      (onboarding_step = 'live') = (went_live_at is not null)
      and (went_live_at is null or verification_status = 'verified')
    )
);

create index employer_accounts_verification_idx
  on public.employer_accounts (verification_status)
  where verification_status in ('pending', 'unverified');

create trigger employer_accounts_set_updated_at
  before update on public.employer_accounts
  for each row execute function private.set_updated_at();

comment on table public.employer_accounts is
  'Employer Health Platform (Module 26 §26.2/§26.3): the corporate account behind a type=corporate organisation — legal entity, business verification, and position in the onboarding workflow. Commercial terms live on corporate_contracts. Holds no health data.';

-- ---------------------------------------------------------------------------
-- corporate_contracts — extended to carry the §26.15 billing models
--
-- Deliberately extended rather than replaced. It already models the
-- commercial relationship (name, status, effective_from/to) and already has
-- RLS; a second "employer contract" table beside it would be exactly the
-- parallel-source-of-truth this codebase keeps out. per_employee_per_year_kobo
-- stays for the rows that already use it and is now one of five shapes.
-- ---------------------------------------------------------------------------

alter table public.corporate_contracts
  add column billing_model             public.employer_billing_model,
  add column billing_rate_kobo         bigint,
  add column billing_fixed_amount_kobo bigint,
  add column billing_interval          public.billing_interval,
  add column billing_contact_email     text,
  add column contract_reference        text,
  add column signed_at                 timestamptz,
  add column signed_by                 uuid references public.profiles (id) on delete restrict;

alter table public.corporate_contracts
  add constraint corporate_contracts_rates_non_negative
    check ((billing_rate_kobo is null or billing_rate_kobo >= 0)
           and (billing_fixed_amount_kobo is null or billing_fixed_amount_kobo >= 0)),
  -- A billing model that leaves its own rate null is the "configured but
  -- meaningless" state this makes unreachable.
  add constraint corporate_contracts_billing_model_has_its_rate
    check (
      billing_model is null
      or (billing_model in ('per_employee', 'per_active_member') and billing_rate_kobo is not null)
      or (billing_model = 'fixed_contract' and billing_fixed_amount_kobo is not null)
      -- service_based is billed per service delivered; it carries no standing rate
      or (billing_model = 'service_based')
      or (billing_model = 'hybrid'
          and billing_rate_kobo is not null and billing_fixed_amount_kobo is not null)
    ),
  add constraint corporate_contracts_signed_attribution
    check ((signed_by is null) = (signed_at is null)),
  add constraint corporate_contracts_effective_dates
    check (effective_to is null or effective_from is null or effective_to >= effective_from);

-- I9 re-grant: an employer may READ its own commercial terms. It may not
-- write them — that stays `is_org_staff` (Tarragon operations), exactly as the
-- original policies had it.
create policy corporate_contracts_select_institution_admin on public.corporate_contracts
  for select to authenticated
  using (private.is_institution_admin() and organisation_id = private.current_org_id());

-- ---------------------------------------------------------------------------
-- employer_locations / employer_departments — the segmentation an employer
-- targets eligibility on and reports against (§26.2, §26.5, §26.9)
-- ---------------------------------------------------------------------------

create table public.employer_locations (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  name             text not null,
  city             text,
  state            text,
  country          text not null default 'Nigeria',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint employer_locations_name_not_blank check (length(trim(name)) > 0)
);

create unique index employer_locations_org_name_key
  on public.employer_locations (organisation_id, lower(trim(name)));
create index employer_locations_org_idx on public.employer_locations (organisation_id) where is_active;

create trigger employer_locations_set_updated_at
  before update on public.employer_locations
  for each row execute function private.set_updated_at();

create table public.employer_departments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  name             text not null,
  -- A department may sit at one site or span all of them; null means
  -- org-wide, not "unknown".
  location_id      uuid references public.employer_locations (id) on delete set null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint employer_departments_name_not_blank check (length(trim(name)) > 0)
);

create unique index employer_departments_org_name_key
  on public.employer_departments (organisation_id, lower(trim(name)));
create index employer_departments_org_idx on public.employer_departments (organisation_id) where is_active;
create index employer_departments_location_idx on public.employer_departments (location_id);

create trigger employer_departments_set_updated_at
  before update on public.employer_departments
  for each row execute function private.set_updated_at();

comment on table public.employer_locations is
  'Employer sites (Module 26 §26.2) — a reporting and eligibility dimension, not an address book.';
comment on table public.employer_departments is
  'Employer departments (Module 26 §26.2). location_id null = org-wide, not unknown.';

-- ---------------------------------------------------------------------------
-- Cross-table invariants a CHECK cannot express
-- ---------------------------------------------------------------------------

-- An employer_accounts row on an HMO or a lab organisation would quietly give
-- the wrong dashboard a contract.
create function private.assert_employer_account_org_is_corporate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.organisation_type;
begin
  select type into v_type from public.organisations where id = new.organisation_id;
  if v_type is distinct from 'corporate' then
    raise exception 'employer_accounts.organisation_id must reference a corporate organisation (got %)',
      coalesce(v_type::text, 'missing organisation');
  end if;
  return new;
end;
$$;

create trigger employer_accounts_org_is_corporate
  before insert or update of organisation_id on public.employer_accounts
  for each row execute function private.assert_employer_account_org_is_corporate();

-- The other half of "go live is the end of the sequence": a live employer
-- must have a signed, active contract that says how it is billed.
create function private.assert_employer_live_has_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.went_live_at is null then
    return new;
  end if;
  if not exists (
    select 1 from public.corporate_contracts c
     where c.organisation_id = new.organisation_id
       and c.status = 'active'
       and c.signed_at is not null
       and c.billing_model is not null
  ) then
    raise exception 'cannot go live: % has no active, signed contract with a billing model', new.organisation_id;
  end if;
  return new;
end;
$$;

create trigger employer_accounts_live_has_contract
  before insert or update of onboarding_step, went_live_at on public.employer_accounts
  for each row execute function private.assert_employer_live_has_contract();

-- A department pointing at another employer's location would leak one
-- employer's site names into another's dashboard.
create function private.assert_employer_department_location_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if new.location_id is null then
    return new;
  end if;
  select organisation_id into v_org from public.employer_locations where id = new.location_id;
  if v_org is distinct from new.organisation_id then
    raise exception 'employer_departments.location_id must belong to the same organisation';
  end if;
  return new;
end;
$$;

create trigger employer_departments_location_same_org
  before insert or update of location_id, organisation_id on public.employer_departments
  for each row execute function private.assert_employer_department_location_same_org();

-- ---------------------------------------------------------------------------
-- The column guard on employer_accounts (see the header note)
-- ---------------------------------------------------------------------------

create function private.guard_employer_account_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Trigger-driven writes (the go-live RPC below, a later part's invoice run)
  -- are not the employer editing their own row.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  -- A platform admin, or Tarragon care-team/operations staff of the org, may
  -- set anything here.
  if private.is_admin() or private.is_org_staff(old.organisation_id) then
    return new;
  end if;

  if new.organisation_id is distinct from old.organisation_id then
    raise exception 'employer_accounts.organisation_id cannot be changed by the employer';
  end if;
  if new.verification_status is distinct from old.verification_status
     or new.verified_by is distinct from old.verified_by
     or new.verified_at is distinct from old.verified_at
     or new.verification_notes is distinct from old.verification_notes then
    raise exception 'employer_accounts verification is set by Tarragon, not by the employer';
  end if;
  if new.went_live_at is distinct from old.went_live_at then
    raise exception 'employer_accounts.went_live_at is set by Tarragon, not by the employer';
  end if;
  -- The employer MAY advance its own configuration steps up to (but not into)
  -- 'live' — that is it working through its own setup checklist.
  if new.onboarding_step is distinct from old.onboarding_step and new.onboarding_step = 'live' then
    raise exception 'going live is a Tarragon action, not an employer one';
  end if;

  return new;
end;
$$;

create trigger employer_accounts_guard_self_update
  before update on public.employer_accounts
  for each row execute function private.guard_employer_account_self_update();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.employer_accounts    enable row level security;
alter table public.employer_locations   enable row level security;
alter table public.employer_departments enable row level security;

-- RLS restricts rows; it does not grant table-level access. A freshly created
-- table needs its own grant (this has silently broken access three times in
-- this project's history — the failure mode is an empty result, not an error).
grant select, insert, update, delete on public.employer_accounts    to authenticated;
grant select, insert, update, delete on public.employer_locations   to authenticated;
grant select, insert, update, delete on public.employer_departments to authenticated;

create policy employer_accounts_select on public.employer_accounts
  for select to authenticated
  using (
    private.is_admin()
    or private.is_org_staff(organisation_id)
    or (private.is_institution_admin() and organisation_id = private.current_org_id())
  );

create policy employer_accounts_insert on public.employer_accounts
  for insert to authenticated
  with check (private.is_admin()
              or private.has_permission('orgs.corporate.manage')
              or private.has_permission('orgs.manage'));

create policy employer_accounts_update on public.employer_accounts
  for update to authenticated
  using (
    private.is_admin()
    or private.is_org_staff(organisation_id)
    or (private.is_institution_admin() and organisation_id = private.current_org_id())
  )
  with check (
    private.is_admin()
    or private.is_org_staff(organisation_id)
    or (private.is_institution_admin() and organisation_id = private.current_org_id())
  );

create policy employer_accounts_delete on public.employer_accounts
  for delete to authenticated
  using (private.is_admin());

-- Locations and departments are the employer's own to maintain.
do $$
declare t text;
begin
  foreach t in array array['employer_locations', 'employer_departments']
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (private.is_org_staff(organisation_id)
               or (private.is_institution_admin() and organisation_id = private.current_org_id()));
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (private.is_org_staff(organisation_id)
                    or (private.is_institution_admin() and organisation_id = private.current_org_id()));
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (private.is_org_staff(organisation_id)
               or (private.is_institution_admin() and organisation_id = private.current_org_id()))
        with check (private.is_org_staff(organisation_id)
                    or (private.is_institution_admin() and organisation_id = private.current_org_id()));
      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (private.is_org_staff(organisation_id)
               or (private.is_institution_admin() and organisation_id = private.current_org_id()));
    $f$, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tarragon-side onboarding RPCs
--
-- Verification and go-live are the two decisions an employer must not make
-- for itself. Routing them through SECURITY DEFINER functions (rather than
-- leaving them to a policy) is what puts the attribution stamp and the audit
-- entry beyond the caller's reach.
-- ---------------------------------------------------------------------------

create function public.employer_set_verification(
  p_organisation_id uuid,
  p_status text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if not (private.is_admin()
          or private.has_permission('orgs.corporate.manage')
          or private.has_permission('orgs.manage')) then
    raise exception 'not authorised';
  end if;
  if p_status not in ('unverified', 'pending', 'verified', 'rejected') then
    raise exception 'p_status must be one of unverified/pending/verified/rejected';
  end if;

  update public.employer_accounts
     set verification_status = p_status::public.employer_verification_status,
         verification_notes  = coalesce(p_notes, verification_notes),
         verified_by = case when p_status = 'verified' then v_actor else null end,
         verified_at = case when p_status = 'verified' then now() else null end
   where organisation_id = p_organisation_id;

  if not found then
    raise exception 'no employer account for organisation %', p_organisation_id;
  end if;

  perform private.log_audit('employer_account.verification_set', 'employer_accounts',
    p_organisation_id, jsonb_build_object('status', p_status));
end;
$$;

revoke all on function public.employer_set_verification(uuid, text, text) from public, anon;
grant execute on function public.employer_set_verification(uuid, text, text) to authenticated;
revoke execute on function public.employer_set_verification(uuid, text, text) from anon;

create function public.employer_go_live(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.is_admin()
          or private.has_permission('orgs.corporate.manage')
          or private.has_permission('orgs.manage')) then
    raise exception 'not authorised';
  end if;

  -- The CHECK and the assert_employer_live_has_contract trigger are the real
  -- gate; this only names the organisation in the error an admin will read.
  update public.employer_accounts
     set onboarding_step = 'live',
         went_live_at    = coalesce(went_live_at, now())
   where organisation_id = p_organisation_id;

  if not found then
    raise exception 'no employer account for organisation %', p_organisation_id;
  end if;

  perform private.log_audit('employer_account.went_live', 'employer_accounts',
    p_organisation_id, '{}'::jsonb);
end;
$$;

revoke all on function public.employer_go_live(uuid) from public, anon;
grant execute on function public.employer_go_live(uuid) to authenticated;
revoke execute on function public.employer_go_live(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Assertions — "built" should be provable, not hopeful
-- ---------------------------------------------------------------------------

do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('employer_accounts', 'employer_locations', 'employer_departments')
     and c.relrowsecurity;
  if v_n <> 3 then raise exception 'FAIL: expected RLS on 3 new tables, found %', v_n; end if;

  select count(distinct table_name) into v_n
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and table_name in ('employer_accounts', 'employer_locations', 'employer_departments');
  if v_n <> 3 then raise exception 'FAIL: expected 3 authenticated SELECT grants, found %', v_n; end if;

  -- The employer can now read its own contract terms, and still cannot write
  -- them (no institution-admin write policy was added).
  select count(*) into v_n from pg_policies
   where tablename = 'corporate_contracts' and policyname = 'corporate_contracts_select_institution_admin';
  if v_n <> 1 then raise exception 'FAIL: corporate_contracts institution-admin read policy missing'; end if;
  select count(*) into v_n from pg_policies
   where tablename = 'corporate_contracts' and cmd <> 'SELECT' and qual like '%is_institution_admin%';
  if v_n <> 0 then raise exception 'FAIL: an employer must not be able to write its own contract terms'; end if;

  -- anon must not reach the onboarding RPCs. A direct anon grant is not the
  -- leak here — PUBLIC-inherited execute is.
  if has_function_privilege('anon', 'public.employer_set_verification(uuid, text, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute employer_set_verification';
  end if;
  if has_function_privilege('anon', 'public.employer_go_live(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute employer_go_live';
  end if;

  raise notice 'PASS  employer account structure: 3 tables + contract billing models, RLS + grants, RPCs closed to anon';
end $$;
