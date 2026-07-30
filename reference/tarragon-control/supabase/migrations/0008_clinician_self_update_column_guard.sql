-- Tarragon Control — M2: restrict clinician self-update to `scope` only
--
-- Real bug found while building the M2 activation guard: 0002_rls.sql's
-- clinicians_update_self policy row-scopes to "your own clinicians row"
-- but places no column restriction on what can change within that row.
-- Combined with an activation guard that flips active=false and lets
-- mdcn_expiry/indemnity_expiry lapse, a clinician could simply UPDATE
-- their own row to re-date their credentials and set active=true,
-- silently defeating the entire suspension mechanism M2 exists to build.
--
-- Postgres RLS filters rows, not columns, so this can't be fixed inside
-- the policy itself. Column-level GRANTs won't work either here: all six
-- app-level roles share the single Postgres role `authenticated`
-- (distinguished via profiles.role inside policies), so revoking column
-- privileges from `authenticated` would also block superadmin's
-- legitimate credential-verification writes. A trigger that inspects the
-- acting role is the only mechanism that can tell them apart.

create or replace function private.enforce_clinician_self_service_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- System-level writes (no request.jwt.claims context at all -- the
  -- nightly suspension job, a migration, a service-role script) and
  -- superadmin writes are unrestricted.
  if auth.uid() is null or private.current_role() = 'superadmin' then
    return new;
  end if;

  -- Everyone else reaching this trigger got here via clinicians_update_self,
  -- i.e. it is the clinician editing their own row. Only `scope`
  -- (self-declared specialty tags) may change; every credential/activation
  -- field must be byte-identical to before, or the write is rejected
  -- outright.
  if new.mdcn_number is distinct from old.mdcn_number
     or new.mdcn_expiry is distinct from old.mdcn_expiry
     or new.indemnity_provider is distinct from old.indemnity_provider
     or new.indemnity_policy_no is distinct from old.indemnity_policy_no
     or new.indemnity_expiry is distinct from old.indemnity_expiry
     or new.active is distinct from old.active
     or new.suspended_reason is distinct from old.suspended_reason
     or new.profile_id is distinct from old.profile_id
  then
    raise exception
      'Only `scope` may be self-edited on a clinician record. Credential and activation fields (mdcn_number, mdcn_expiry, indemnity_*, active, suspended_reason) are staff-governed, not self-service -- this is what makes the MDCN/indemnity suspension guard actually mean something.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_clinician_self_service_columns
  before update on clinicians
  for each row
  execute function private.enforce_clinician_self_service_columns();
