-- Tarragon Health
-- protocol_versions had no self-attribution check at all. protocol_versions_insert
-- (20260712210000) is `with check (private.is_org_staff(organisation_id))` only --
-- "only the Clinical Director signs" was enforced exclusively client-side, in
-- apps/web/src/lib/queries/protocol-versions.ts's getCallerOrgAndDirector(). Any
-- authenticated org-staff session can call the REST API directly, bypassing that
-- browser check entirely, and — proved live in a rolled-back transaction against
-- this project — could INSERT a row with approved_by set to a DIFFERENT
-- clinical_staff member's id, forging that person's signature on a protocol
-- version. protocol_versions is the audit ledger behind
-- docs/CLINICAL_TRUST_MODEL_SPEC.md's "protocols supervised by Dr. X" claim, so a
-- forged row here is a false clinical-governance record — the same class of harm
-- the "Reviewed by Dr. X" null-gating rule (CLAUDE.md) exists to prevent
-- elsewhere.
--
-- Fix: a BEFORE INSERT trigger, same "RLS admits broadly, a trigger narrows"
-- shape as escalations_enforce_emergency_authority (20260803005216) and the
-- ops-audit stamp pattern in private.stamp_outreach_resolution
-- (20260723010019). It re-derives the caller's own active, Clinical-Director
-- clinical_staff record from auth.uid() -- mirroring getCallerOrgAndDirector()'s
-- own checks, now DB-enforced -- and OVERWRITES whatever the client sent for
-- approved_by/approved_at with that record's id and the current time. A
-- non-director caller (any tier, including care_coordinator -- the account this
-- was proved against) is rejected outright with 42501, matching the message the
-- UI already shows. A director can no longer attribute a signature to anyone
-- but themselves, and can no longer backdate approved_at.
--
-- Functional live-proof (5 cases, forged/blocked, in a rolled-back transaction):
-- packages/db/tests/protocol_version_self_attribution.sql

create or replace function private.stamp_protocol_version_approver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
    and is_clinical_director;

  if v_staff_id is null then
    raise exception 'Only the org''s active Clinical Director can sign a protocol version'
      using errcode = '42501';
  end if;

  -- Overwrite, never trust: closes both the self-attribution gap (a director
  -- could otherwise name a different clinical_staff.id) and backdating
  -- (approved_at defaulted to now() but was still client-settable on insert).
  new.approved_by := v_staff_id;
  new.approved_at := now();

  return new;
end;
$$;

comment on function private.stamp_protocol_version_approver() is
  'BEFORE INSERT on protocol_versions. Forces approved_by/approved_at to the '
  'caller''s own active, is_clinical_director clinical_staff record derived '
  'from auth.uid() -- a client-supplied approved_by is always discarded. '
  'Rejects with 42501 if the caller has no such record. DB-enforced mirror of '
  'apps/web/src/lib/queries/protocol-versions.ts''s getCallerOrgAndDirector(), '
  'which remains the friendly pre-flight UI check -- this function is the '
  'actual enforcement boundary, per CLINICAL_TRUST_MODEL_SPEC.md.';

create trigger protocol_versions_stamp_approver
  before insert on public.protocol_versions
  for each row execute function private.stamp_protocol_version_approver();

-- ---------------------------------------------------------------------------
-- Assertions -- the migration is the test.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'protocol_versions_stamp_approver'
      and tgrelid = 'public.protocol_versions'::regclass
      and not tgisinternal
  ) then
    raise exception 'protocol_versions_stamp_approver trigger was not created';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'stamp_protocol_version_approver'
  ) then
    raise exception 'private.stamp_protocol_version_approver was not created';
  end if;

  -- private-schema functions are never PostgREST-exposed, so there is no
  -- anon-execute revoke to make here (same as every other private.* helper);
  -- assert the schema placement instead, since putting this in public by
  -- mistake WOULD need one.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'stamp_protocol_version_approver'
  ) then
    raise exception 'stamp_protocol_version_approver must live in private, not public';
  end if;

  -- The RLS policy this trigger narrows is unchanged (org-staff-wide insert
  -- eligibility still comes from is_org_staff -- the trigger, not the policy,
  -- is what now discriminates director vs non-director). If this ever
  -- changes to a director-only USING/WITH CHECK clause, the app-layer
  -- pre-flight check in protocol-versions.ts and this migration's comment
  -- both go stale, so assert the shape stays as documented.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'protocol_versions'
      and policyname = 'protocol_versions_insert'
      and with_check = 'private.is_org_staff(organisation_id)'
  ) then
    raise exception 'protocol_versions_insert policy shape changed -- re-check this trigger is still the enforcement boundary';
  end if;
end $$;
