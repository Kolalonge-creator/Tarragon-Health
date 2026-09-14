-- Tarragon Health
-- CMO governance-surface audit (2026-09-14), Gap A follow-through: the
-- triage_protocols INSERT policy (triage_protocols_insert) required
-- private.is_admin() only, with no Chief Medical Officer / Clinical
-- Director carve-out -- even after giving the CMO a first-class
-- /clinician/triage-protocols page (mirroring /clinician/team-caseload),
-- drafting a new version would still fail at the RLS layer for a genuine
-- CMO whose account role is `clinician`, never `admin` (per CLAUDE.md's
-- "never re-split the account role" rule). The DB-level SIGN gate
-- (public.sign_triage_protocols) already correctly required an active
-- Clinical Director and never admin -- so before this migration a CMO could
-- sign a version but never draft one, and an admin could draft one but
-- (correctly) never sign it. This closes the asymmetry on the draft side
-- without touching the sign side.
--
-- Same three structural guards as before, unchanged: a fresh row must still
-- arrive unsigned (approved_by/approved_at null) and inactive
-- (is_active = false) -- only sign_triage_protocols(), a SECURITY DEFINER
-- RPC, may ever flip is_active or stamp approval, so this migration cannot
-- be used to smuggle a live protocol change past review.

drop policy if exists triage_protocols_insert on public.triage_protocols;

create policy triage_protocols_insert on public.triage_protocols
  for insert to authenticated
  with check (
    (
      private.is_admin()
      or exists (
        select 1 from public.clinical_staff
        where profile_id = (select auth.uid())
          and active
          and doctor_tier = 'chief_medical_officer'
      )
    )
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'triage_protocols' and policyname = 'triage_protocols_insert'
  ) then
    raise exception 'triage_protocols_insert policy was not recreated';
  end if;
end $$;
