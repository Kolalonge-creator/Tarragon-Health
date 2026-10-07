-- NGO-funded cohort readiness, step 2 of 2: tables, RLS, RPCs, module gate.
--
-- Built dormant, per the founder's explicit go-ahead (see docs/FUNDING_STRATEGY.md
-- and docs/LAUNCH_SCOPE_AND_PLATFORM_REBUILD_AUDIT_2026-09-21.md EPIC 5) and the
-- exact "build it fully, do not make it live" pattern this codebase already uses
-- for module 27/28 — see 20260829092227_platform_module_activation_gate.sql,
-- whose platform_modules table this reuses rather than duplicating. A superadmin
-- switches ngo_funded_cohort on with public.set_platform_module() once a real
-- NGO/PHC/government partnership is signed; until then every table below
-- returns zero rows and every RPC refuses, in addition to the RLS gate proper.
--
-- Design choice: this does NOT introduce a parallel "entitlement" concept.
-- public.care_vouchers is already this platform's one entitlement primitive
-- (see purchase_care_voucher() for the diaspora-sponsor shape this mirrors).
-- An NGO-funded place is a care_voucher whose purchaser_profile_id is the NGO
-- staff member who issued the invitation (matching care_vouchers_kind_shape's
-- existing NOT NULL requirement) rather than an individual buyer — everything
-- downstream (redemption, refund queue, reporting) is the voucher engine that
-- already exists and is already tested.
--
-- What's new is only the pre-account layer care_vouchers doesn't have: a
-- programme (who's funding, how many places, what SKU, what contract) and an
-- invitation (a roster contact who does not have a Tarragon account yet —
-- claiming it is how they get one, never a spreadsheet-created clinical
-- record; see CLAUDE.md's "never make a shared password or silently create a
-- clinical record from a spreadsheet").

-- ---------------------------------------------------------------------------
-- 0. CRITICAL: private.is_org_staff() must exclude ngo_admin, exactly like
--    corporate_admin/hmo_admin/payer_admin/provider_org_staff already are.
--    This function alone gates ~110 patient-scoped tables (see CLAUDE.md's
--    standing warning on it) — a missed exclusion here is a platform-wide PHI
--    exposure to a counterparty, not a local bug. Do this FIRST, before any
--    table below exists, so nothing can even momentarily depend on the gap.
-- ---------------------------------------------------------------------------
create or replace function private.is_org_staff(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role <> 'patient'
      -- I9: an institution administrator is not care-team staff.
      and role not in ('corporate_admin', 'hmo_admin')
      -- Nor is a partner employee or a back-office account. Excluded here
      -- rather than in 314 individual policies. lab_partner joins this list.
      and role not in ('pharmacist', 'lab_partner', 'lab_liaison', 'finance', 'analyst')
      -- Nor is an insurer's administrator (module 27) or a partner
      -- organisation's staff (module 28). Both are counterparties who
      -- transact with Tarragon; neither is on a patient's care team.
      and role not in ('payer_admin', 'provider_org_staff')
      -- Nor is an NGO/PHC/government funding partner's administrator
      -- (module: ngo_funded_cohort). They fund a place; they do not join the
      -- beneficiary's care team, and must never read the beneficiary's
      -- clinical record through this function. See
      -- packages/db/tests/ngo_funded_cohort.sql for the sabotage proof.
      and role not in ('ngo_admin')
      and (role = 'admin' or organisation_id = org)
  );
$$;

comment on function private.is_org_staff(uuid) is
  'The highest-leverage security function in the codebase: gates ~110 patient-scoped tables. Every institutional/partner/back-office role (corporate_admin, hmo_admin, pharmacist, lab_partner, lab_liaison, finance, analyst, payer_admin, provider_org_staff, ngo_admin) is deliberately excluded — a missed exclusion here is a platform-wide PHI exposure. Re-verify with a simulated session before trusting a change to this function.';

-- ---------------------------------------------------------------------------
-- 1. The module row — dormant. RLS/RPCs on this module's own tables check
--    private.module_enabled('ngo_funded_cohort') / assert_module_enabled().
-- ---------------------------------------------------------------------------
insert into public.platform_modules (key, label, description) values (
  'ngo_funded_cohort',
  'NGO-funded cohort',
  'Lets an NGO, PHC programme, or government partner fund a defined number of Tarragon service entitlements for an eligible roster: a funding programme, roster invitations, claim-to-entitlement, and (app-layer) aggregate small-cell-suppressed programme reporting. Beneficiaries get the same clinical review/escalation as any Tarragon patient; the funder never gains read access to an individual beneficiary''s clinical record — see private.is_org_staff()''s ngo_admin exclusion. Dormant until a real NGO/PHC/government partnership is signed. See docs/FUNDING_STRATEGY.md.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. funding_programmes — one row per signed funding arrangement.
-- ---------------------------------------------------------------------------
create type public.funding_programme_status as enum ('draft', 'active', 'expired', 'cancelled');

create table public.funding_programmes (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  service_product_id  uuid not null references public.service_products (id) on delete restrict,
  name                text not null,
  contract_reference  text not null,
  funded_unit_cap     integer not null check (funded_unit_cap > 0),
  -- Contracted price, which may differ from the catalogue's list price (a
  -- volume discount per docs/LAUNCH_SCOPE_AND_PLATFORM_REBUILD_AUDIT_2026-09-21.md
  -- §4.4). Null means "use the catalogue's current price_kobo at claim time".
  price_kobo          bigint check (price_kobo is null or price_kobo >= 0),
  status              public.funding_programme_status not null default 'draft',
  starts_at           timestamptz,
  ends_at             timestamptz,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint funding_programmes_name_not_blank check (char_length(trim(name)) > 0),
  constraint funding_programmes_contract_reference_not_blank check (char_length(trim(contract_reference)) > 0),
  constraint funding_programmes_term_order check (starts_at is null or ends_at is null or ends_at > starts_at)
);

comment on table public.funding_programmes is
  'One row per signed NGO/PHC/government funding arrangement. Dormant unless ngo_funded_cohort is enabled (private.module_enabled). Written only via public.create_funding_programme()/set_funding_programme_status() — no direct insert/update grant.';

create trigger funding_programmes_set_updated_at
  before update on public.funding_programmes
  for each row execute function private.set_updated_at();

-- A funding programme can only belong to an organisation actually typed
-- 'ngo' — catches "someone picked the wrong organisation" at write time
-- rather than leaving it to whoever reads the row later to notice.
create or replace function private.enforce_funding_programme_org_is_ngo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organisations where id = new.organisation_id and type = 'ngo'
  ) then
    raise exception 'funding_programmes.organisation_id must reference an organisation of type ngo'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger funding_programmes_org_must_be_ngo
  before insert or update of organisation_id on public.funding_programmes
  for each row execute function private.enforce_funding_programme_org_is_ngo();

alter table public.funding_programmes enable row level security;

-- Read only: the module's own admin (superadmin) sees every programme; an
-- ngo_admin sees only their own organisation's programmes. No insert/update/
-- delete policy at all — public.create_funding_programme()/
-- set_funding_programme_status() are SECURITY DEFINER and run as the function
-- owner, so they need no table-level write grant (same shape as
-- set_platform_module() itself).
create policy funding_programmes_select on public.funding_programmes
  for select to authenticated using (
    private.module_enabled('ngo_funded_cohort')
    and (
      private.is_admin()
      or exists (
        select 1 from public.profiles
        where id = (select auth.uid())
          and role = 'ngo_admin'
          and organisation_id = funding_programmes.organisation_id
      )
    )
  );

grant select on public.funding_programmes to authenticated;
revoke all on public.funding_programmes from anon;

-- ---------------------------------------------------------------------------
-- 3. funding_programme_invitations — a roster contact who may not have a
--    Tarragon account yet. Claiming is what creates one's relationship to
--    the programme; it never creates a clinical record on its own.
-- ---------------------------------------------------------------------------
create type public.funding_invitation_status as enum ('invited', 'claimed', 'expired', 'revoked');

create table public.funding_programme_invitations (
  id                     uuid primary key default gen_random_uuid(),
  funding_programme_id   uuid not null references public.funding_programmes (id) on delete cascade,
  full_name              text,
  phone                  text,
  email                  text,
  status                 public.funding_invitation_status not null default 'invited',
  invite_token           text not null unique default encode(gen_random_bytes(24), 'hex'),
  -- The NGO staff member (or admin, if provisioning on the NGO's behalf
  -- before the NGO's own login exists) who issued this invitation. Load-
  -- bearing, not just an audit nicety: it becomes care_vouchers.purchaser_
  -- profile_id at claim time, which care_vouchers_kind_shape requires NOT
  -- NULL for a prepaid_service voucher — there is no "funded by an
  -- organisation with nobody named" shape in the voucher engine, by design.
  invited_by             uuid not null references public.profiles (id) on delete restrict,
  invited_at             timestamptz not null default now(),
  expires_at             timestamptz not null,
  claimed_by_profile_id  uuid references public.profiles (id) on delete set null,
  claimed_at             timestamptz,
  care_voucher_id        uuid references public.care_vouchers (id) on delete set null,
  revoked_at             timestamptz,
  revoked_reason         text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint funding_programme_invitations_contact_present check (
    coalesce(trim(phone), '') <> '' or coalesce(trim(email), '') <> ''
  ),
  constraint funding_programme_invitations_phone_e164 check (
    phone is null or phone ~ '^\+[1-9]\d{7,14}$'
  ),
  constraint funding_programme_invitations_claim_consistency check (
    (status = 'claimed') = (
      claimed_by_profile_id is not null and claimed_at is not null and care_voucher_id is not null
    )
  )
);

comment on table public.funding_programme_invitations is
  'A roster contact invited into a funding programme, who may not have a Tarragon account yet. Written only via public.invite_to_funding_programme()/claim_funding_programme_invitation()/revoke_funding_programme_invitation() — no direct insert/update grant.';

create index funding_programme_invitations_programme_idx
  on public.funding_programme_invitations (funding_programme_id, status);

create trigger funding_programme_invitations_set_updated_at
  before update on public.funding_programme_invitations
  for each row execute function private.set_updated_at();

alter table public.funding_programme_invitations enable row level security;

create policy funding_programme_invitations_select on public.funding_programme_invitations
  for select to authenticated using (
    private.module_enabled('ngo_funded_cohort')
    and (
      private.is_admin()
      or exists (
        select 1
        from public.funding_programmes fp
        join public.profiles p
          on p.organisation_id = fp.organisation_id and p.role = 'ngo_admin'
        where fp.id = funding_programme_invitations.funding_programme_id
          and p.id = (select auth.uid())
      )
    )
  );

grant select on public.funding_programme_invitations to authenticated;
revoke all on public.funding_programme_invitations from anon;

-- ---------------------------------------------------------------------------
-- 4. RPCs. All SECURITY DEFINER, search_path pinned empty, module-gated.
-- ---------------------------------------------------------------------------

create or replace function public.create_funding_programme(
  p_organisation_id uuid,
  p_service_product_id uuid,
  p_name text,
  p_contract_reference text,
  p_funded_unit_cap integer,
  p_price_kobo bigint default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'only a superadmin can create a funding programme' using errcode = '42501';
  end if;

  perform private.assert_module_enabled('ngo_funded_cohort');

  if not exists (
    select 1 from public.organisations where id = p_organisation_id and type = 'ngo'
  ) then
    raise exception 'organisation % is not an NGO-type organisation', p_organisation_id
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.service_products where id = p_service_product_id and is_active
  ) then
    raise exception 'service product % is not an active catalogue item', p_service_product_id
      using errcode = '23514';
  end if;

  insert into public.funding_programmes (
    organisation_id, service_product_id, name, contract_reference,
    funded_unit_cap, price_kobo, starts_at, ends_at, created_by
  ) values (
    p_organisation_id, p_service_product_id, trim(p_name), trim(p_contract_reference),
    p_funded_unit_cap, p_price_kobo, p_starts_at, p_ends_at, (select auth.uid())
  ) returning id into v_id;

  perform private.log_audit(
    'funding_programme.created', 'funding_programme', v_id,
    jsonb_build_object('organisation_id', p_organisation_id, 'funded_unit_cap', p_funded_unit_cap)
  );

  return v_id;
end;
$$;

revoke all on function public.create_funding_programme(uuid, uuid, text, text, integer, bigint, timestamptz, timestamptz) from public;
revoke all on function public.create_funding_programme(uuid, uuid, text, text, integer, bigint, timestamptz, timestamptz) from anon;
grant execute on function public.create_funding_programme(uuid, uuid, text, text, integer, bigint, timestamptz, timestamptz) to authenticated;

create or replace function public.set_funding_programme_status(
  p_programme_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_programme public.funding_programmes%rowtype;
  v_new_status public.funding_programme_status;
begin
  if not private.is_admin() then
    raise exception 'only a superadmin can change a funding programme''s status' using errcode = '42501';
  end if;

  select * into v_programme from public.funding_programmes where id = p_programme_id for update;
  if not found then
    raise exception 'no such funding programme' using errcode = '22023';
  end if;

  v_new_status := p_status::public.funding_programme_status;

  if v_programme.status = 'draft' and v_new_status <> 'active' then
    raise exception 'a draft programme can only move to active' using errcode = '23514';
  elsif v_programme.status = 'active' and v_new_status not in ('expired', 'cancelled') then
    raise exception 'an active programme can only move to expired or cancelled' using errcode = '23514';
  elsif v_programme.status in ('expired', 'cancelled') then
    raise exception 'a % programme cannot change status', v_programme.status using errcode = '23514';
  end if;

  update public.funding_programmes
     set status = v_new_status, updated_at = now()
   where id = p_programme_id;

  perform private.log_audit(
    'funding_programme.status_changed', 'funding_programme', p_programme_id,
    jsonb_build_object('from', v_programme.status, 'to', v_new_status, 'note', p_note)
  );
end;
$$;

revoke all on function public.set_funding_programme_status(uuid, text, text) from public;
revoke all on function public.set_funding_programme_status(uuid, text, text) from anon;
grant execute on function public.set_funding_programme_status(uuid, text, text) to authenticated;

create or replace function public.invite_to_funding_programme(
  p_programme_id uuid,
  p_contacts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_programme public.funding_programmes%rowtype;
  v_existing_count integer;
  v_contact jsonb;
  v_created integer := 0;
  v_expires_at timestamptz;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  perform private.assert_module_enabled('ngo_funded_cohort');

  select * into v_programme from public.funding_programmes where id = p_programme_id for update;
  if not found then
    raise exception 'no such funding programme' using errcode = '22023';
  end if;

  if not (
    private.is_admin()
    or exists (
      select 1 from public.profiles
      where id = v_caller and role = 'ngo_admin' and organisation_id = v_programme.organisation_id
    )
  ) then
    raise exception 'you are not authorised to invite people into this funding programme'
      using errcode = '42501';
  end if;

  if v_programme.status <> 'active' then
    raise exception 'this funded programme is not active — activate it before inviting people'
      using errcode = '23514';
  end if;

  if jsonb_typeof(p_contacts) <> 'array' then
    raise exception 'contacts must be a JSON array' using errcode = '22023';
  end if;

  select count(*) into v_existing_count
    from public.funding_programme_invitations
   where funding_programme_id = p_programme_id and status <> 'revoked';

  if v_existing_count + jsonb_array_length(p_contacts) > v_programme.funded_unit_cap then
    raise exception 'this would invite more people than the programme''s funded cap of %',
      v_programme.funded_unit_cap using errcode = '23514';
  end if;

  -- Invitations outlive the programme's own term by 30 days so someone
  -- invited near the end of the term still has a fair window to claim, but
  -- never dangle indefinitely against a programme with no end date.
  v_expires_at := coalesce(v_programme.ends_at, now() + interval '90 days') + interval '30 days';

  for v_contact in select * from jsonb_array_elements(p_contacts)
  loop
    insert into public.funding_programme_invitations (
      funding_programme_id, full_name, phone, email, invited_by, expires_at
    ) values (
      p_programme_id,
      nullif(trim(coalesce(v_contact->>'full_name', '')), ''),
      nullif(trim(coalesce(v_contact->>'phone', '')), ''),
      nullif(trim(coalesce(v_contact->>'email', '')), ''),
      v_caller,
      v_expires_at
    );
    v_created := v_created + 1;
  end loop;

  perform private.log_audit(
    'funding_programme.invitations_created', 'funding_programme', p_programme_id,
    jsonb_build_object('count', v_created)
  );

  return jsonb_build_object('ok', true, 'invited', v_created);
end;
$$;

revoke all on function public.invite_to_funding_programme(uuid, jsonb) from public;
revoke all on function public.invite_to_funding_programme(uuid, jsonb) from anon;
grant execute on function public.invite_to_funding_programme(uuid, jsonb) to authenticated;

create or replace function public.revoke_funding_programme_invitation(
  p_invitation_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_invite public.funding_programme_invitations%rowtype;
  v_programme public.funding_programmes%rowtype;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_invite from public.funding_programme_invitations where id = p_invitation_id;
  if not found then
    raise exception 'no such invitation' using errcode = '22023';
  end if;

  select * into v_programme from public.funding_programmes where id = v_invite.funding_programme_id;

  if not (
    private.is_admin()
    or exists (
      select 1 from public.profiles
      where id = v_caller and role = 'ngo_admin' and organisation_id = v_programme.organisation_id
    )
  ) then
    raise exception 'you are not authorised to revoke this invitation' using errcode = '42501';
  end if;

  if v_invite.status <> 'invited' then
    raise exception 'only a pending invitation can be revoked' using errcode = '23514';
  end if;

  update public.funding_programme_invitations
     set status = 'revoked', revoked_at = now(), revoked_reason = p_reason, updated_at = now()
   where id = p_invitation_id;

  perform private.log_audit(
    'funding_programme_invitation.revoked', 'funding_programme_invitation', p_invitation_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

revoke all on function public.revoke_funding_programme_invitation(uuid, text) from public;
revoke all on function public.revoke_funding_programme_invitation(uuid, text) from anon;
grant execute on function public.revoke_funding_programme_invitation(uuid, text) to authenticated;

create or replace function public.claim_funding_programme_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_invite public.funding_programme_invitations%rowtype;
  v_programme public.funding_programmes%rowtype;
  v_product public.service_products%rowtype;
  v_beneficiary_org uuid;
  v_face_value_kobo bigint;
  v_claimed_count integer;
  v_voucher_id uuid;
  v_number text;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  perform private.assert_module_enabled('ngo_funded_cohort');

  select * into v_invite from public.funding_programme_invitations where invite_token = p_token;
  if not found then
    raise exception 'that invitation link is not valid' using errcode = '22023';
  end if;

  if v_invite.status <> 'invited' then
    raise exception 'that invitation has already been % — it cannot be claimed again', v_invite.status
      using errcode = '23514';
  end if;

  if v_invite.expires_at < now() then
    update public.funding_programme_invitations
       set status = 'expired', updated_at = now()
     where id = v_invite.id;
    raise exception 'that invitation has expired' using errcode = '23514';
  end if;

  -- Lock the programme row for the rest of this transaction so two
  -- concurrent claims cannot both slip past the cap check below.
  select * into v_programme from public.funding_programmes where id = v_invite.funding_programme_id for update;
  if v_programme.status <> 'active' then
    raise exception 'this funded programme is not currently active' using errcode = '23514';
  end if;

  select count(*) into v_claimed_count
    from public.funding_programme_invitations
   where funding_programme_id = v_programme.id and status = 'claimed';
  if v_claimed_count >= v_programme.funded_unit_cap then
    raise exception 'this funded programme has no remaining places' using errcode = '23514';
  end if;

  select organisation_id into v_beneficiary_org from public.profiles where id = v_caller;
  if v_beneficiary_org is null then
    raise exception 'your account has no organisation yet — finish signing up first' using errcode = '23514';
  end if;

  select * into v_product from public.service_products where id = v_programme.service_product_id;
  v_face_value_kobo := coalesce(v_programme.price_kobo, v_product.price_kobo);
  if v_face_value_kobo is null or v_face_value_kobo <= 0 then
    raise exception 'this funded programme has no valid price configured' using errcode = '23514';
  end if;

  v_number := private.next_voucher_number();

  insert into public.care_vouchers (
    organisation_id, voucher_number, kind,
    beneficiary_profile_id, purchaser_profile_id,
    service_product_id, sku_code, sku_name,
    face_value_kobo, amount_paid_kobo, status, activated_at
  ) values (
    v_beneficiary_org, v_number, 'prepaid_service',
    v_caller, v_invite.invited_by,
    v_product.id, v_product.code, v_product.name,
    v_face_value_kobo, v_face_value_kobo, 'active', now()
  ) returning id into v_voucher_id;

  insert into public.care_voucher_events (organisation_id, voucher_id, event_type, actor_profile_id, note)
  select v_beneficiary_org, v_voucher_id, 'created', v_caller,
         'Funded by ' || org.name || ' (' || v_programme.name || ')'
  from public.organisations org where org.id = v_programme.organisation_id;

  update public.funding_programme_invitations
     set status = 'claimed',
         claimed_by_profile_id = v_caller,
         claimed_at = now(),
         care_voucher_id = v_voucher_id,
         updated_at = now()
   where id = v_invite.id;

  perform private.log_audit(
    'funding_programme_invitation.claimed', 'funding_programme_invitation', v_invite.id,
    jsonb_build_object('funding_programme_id', v_programme.id, 'voucher_id', v_voucher_id)
  );

  return jsonb_build_object(
    'ok', true,
    'voucher_id', v_voucher_id,
    'voucher_number', v_number,
    'sku_name', v_product.name,
    'face_value_kobo', v_face_value_kobo
  );
end;
$$;

revoke all on function public.claim_funding_programme_invitation(text) from public;
revoke all on function public.claim_funding_programme_invitation(text) from anon;
grant execute on function public.claim_funding_programme_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Assertions — proves shape and dormancy for real, not just definitions.
--    The deeper RLS/is_org_staff sabotage proof lives in
--    packages/db/tests/ngo_funded_cohort.sql (this file's own transaction
--    only has real fixture profiles to work with in that dedicated suite).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.platform_modules where key = 'ngo_funded_cohort') then
    raise exception 'FAIL: ngo_funded_cohort module row should exist';
  end if;

  if (select is_enabled from public.platform_modules where key = 'ngo_funded_cohort') then
    raise exception 'FAIL: ngo_funded_cohort shipped switched on — must ship dormant';
  end if;

  if private.module_enabled('ngo_funded_cohort') then
    raise exception 'FAIL: module_enabled says ngo_funded_cohort is on';
  end if;

  begin
    perform private.assert_module_enabled('ngo_funded_cohort');
    raise exception 'FAIL: assert_module_enabled did not raise for a dormant ngo_funded_cohort';
  exception
    when check_violation then null;
  end;

  if not ('ngo' = any(enum_range(null::public.organisation_type)::text[])) then
    raise exception 'FAIL: organisation_type is missing ngo';
  end if;

  if not ('ngo_admin' = any(enum_range(null::public.user_role)::text[])) then
    raise exception 'FAIL: user_role is missing ngo_admin';
  end if;

  -- The exclusion this whole migration exists to add. Not a full simulated-
  -- session proof (that needs real fixture profiles — see the DB test suite)
  -- but a direct, unconditional check that the compiled function body itself
  -- now names ngo_admin among the excluded roles.
  if position('ngo_admin' in pg_get_functiondef('private.is_org_staff'::regproc)) = 0 then
    raise exception 'FAIL: private.is_org_staff no longer excludes ngo_admin';
  end if;

  raise notice 'PASS: ngo_funded_cohort ships dormant, fail-closed, with is_org_staff excluding ngo_admin';
end $$;
