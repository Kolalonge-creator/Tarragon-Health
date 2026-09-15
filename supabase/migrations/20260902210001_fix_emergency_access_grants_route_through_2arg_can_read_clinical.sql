-- Recovered 2026-09-03 (full-platform audit) from supabase_migrations.schema_migrations:
-- this migration was applied live as version 20260902210001 but existed in no commit on any
-- branch (the session that applied it never committed the file). Committed here verbatim so
-- the applied SQL has a home in git; the release-integrity migration-drift check flags this
-- class as UNTRACED. Do not re-apply.

-- PR #377 CI migration-replay fix: 20260830112511_emergency_access_grants.sql originally
-- redefined the 1-arg private.can_read_clinical(p_patient uuid) overload and referenced
-- pa.clinical_access -- both already dropped by
-- 20260830103251_category_scoped_clinical_access_and_emergency_access.sql before this
-- migration runs in filename order, and not recreated until
-- 20260902190500_preserve_legacy_can_read_clinical_overload_for_pr377_compat.sql (timestamped
-- after this one). A fresh migration replay from the committed files therefore fails with
-- "column pa.clinical_access does not exist". Fixed the committed migration file to extend the
-- 2-arg private.can_read_clinical(uuid, care_access_category) instead (which does exist at that
-- point in the sequence) with an emergency_access_grants OR-branch, excluding
-- reproductive_health -- matching the same "translate a blanket grant into the category system"
-- convention already used for the B1 backfill and private.has_emergency_access() in
-- 20260830103251. Applying that same corrected function body live here so the live project
-- matches the corrected migration file (this project already has this migration recorded live
-- under its original, pre-fix content applied out-of-order on 2026-09-02, so this is a
-- same-day follow-up fix, not a fresh apply of 20260830112511 itself).
--
-- Known, pre-existing, out-of-scope gap (unchanged by this fix): private.can_read_clinical is
-- redefined again by 20260830123653_resolve_category_scoping_governance_gaps.sql, which does
-- not carry this emergency_access_grants branch forward -- flagged in the migration file's own
-- comments for the PR #377 reconciliation pass.
create or replace function private.can_read_clinical(p_patient uuid, p_category public.care_access_category)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.profile_access pa join public.profiles p on p.id = pa.profile_id
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and (
        (pa.permission_level = 'manage' and p.is_dependent_account and p_category <> 'reproductive_health')
        or exists (
          select 1 from public.profile_access_categories pac
          where pac.profile_access_id = pa.id and pac.category = p_category
        )
      )
  )
  or exists (
    select 1
    from public.emergency_access_grants eag
    where eag.profile_id = p_patient
      and eag.grantee_user_id = (select auth.uid())
      and eag.revoked_at is null
      and eag.expires_at > now()
      and p_category <> 'reproductive_health'
  );
$$;

do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'can_read_clinical' and pronamespace = 'private'::regnamespace
      and pg_get_function_identity_arguments(oid) like '%care_access_category%'
  ) then
    raise exception 'FAIL: private.can_read_clinical(uuid, care_access_category) does not exist';
  end if;

  if (
    select pg_get_functiondef(oid) from pg_proc
    where proname = 'can_read_clinical' and pronamespace = 'private'::regnamespace
      and pg_get_function_identity_arguments(oid) like '%care_access_category%'
  ) not like '%emergency_access_grants%' then
    raise exception 'FAIL: private.can_read_clinical(uuid, category) does not check emergency_access_grants';
  end if;
end $$;

