-- Tarragon Health — recover private.can_read_clinical(uuid, care_access_category) from
-- untracked live drift back to its own last recorded, self-tested intent.
--
-- FOUND WHILE reconciling packages/db/tests/category_scoping_governance_gaps_rls.sql (its
-- "dependent-account manager reads reproductive_health with no explicit grant" check was
-- failing) against packages/db/tests/category_scoped_clinical_access_and_emergency_access_rls.sql
-- (whose "dependent manager blocked from reproductive_health_profiles" check was passing) —
-- two committed tests asserting OPPOSITE outcomes for the identical scenario.
--
-- THE DRIFT. 20260830103251 and 20260830112511 both defined can_read_clinical(uuid,
-- care_access_category) with:
--   (pa.permission_level = 'manage' and p.is_dependent_account and p_category <> 'reproductive_health')
-- 20260830123653 ("Restore reproductive_health for a dependent account's manager") deliberately
-- removed that exclusion — its own header explains why: a legal guardian's authority over a
-- minor with no login of their own is a categorically different consent relationship from a
-- next-of-kin grant between two consenting adults (where the exclusion is correct and was left
-- untouched, second OR-branch). Its self-test asserted the live function body did NOT contain
-- 'is_dependent_account and p_category' and that migration only got RECORDED because that
-- assertion passed at apply time — so the exclusion genuinely was removed, live, on 2026-08-30.
--
-- Confirmed live today via pg_get_functiondef: the exclusion is back. No migration file
-- anywhere in this repo re-adds it after 123653 — grepped every
-- `create or replace function private.can_read_clinical` across supabase/migrations/, only
-- 103251 and 112511 (both BEFORE 123653) contain that clause. This is the "live schema object
-- with no migration record" drift class CLAUDE.md warns about: something re-applied an earlier
-- version of this function's body directly, outside any migration this project's git history
-- knows about.
--
-- WHY THE RESTORED (NO-EXCLUSION) VERSION IS THE CORRECT ONE TO RECOVER, not the drifted one:
-- 20260902213714_fix_reproductive_health_profiles_rls_regression.sql (2026-09-02, three days
-- AFTER the drift) was written describing the dependent-account bypass as already covering
-- reproductive_health ("the can_read_clinical dependent-account bypass, restored by 20260830123653
-- for exactly that reason"), and layers private.guardian_may_view_confidential_domain() on TOP of
-- can_read_clinical specifically so a dependent in the protected adolescent age band (10-17) is
-- still blocked without a waiver — even though their manager's can_read_clinical check now passes.
-- That design only makes sense if can_read_clinical itself was expected to already allow it. The
-- drift silently double-gated the adolescent case (blocking it twice over) while ALSO wrongly
-- blocking the two cases guardian_may_view_confidential_domain was never meant to touch: a
-- dependent 'child' (<10) or an 'unknown'-band (no date_of_birth) dependent, both of which
-- guardian_may_view_confidential_domain always allows through — for those, the drift is a real,
-- live regression with no compensating control anywhere else in the policy chain.
--
-- FIX. Recreate can_read_clinical(uuid, care_access_category) exactly as 20260830123653 left it
-- (no exclusion). Re-verify with that same migration's own self-test, run again here — proof this
-- is genuinely fixed, not just re-declared.

create or replace function private.can_read_clinical(p_patient uuid, p_category public.care_access_category)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profile_access pa join public.profiles p on p.id = pa.profile_id
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and (
        (pa.permission_level = 'manage' and p.is_dependent_account)
        or exists (
          select 1 from public.profile_access_categories pac
          where pac.profile_access_id = pa.id and pac.category = p_category
        )
      )
  );
$$;

comment on function private.can_read_clinical(uuid, public.care_access_category) is
  'Category-scoped clinical-read gate. A grantee sees p_category for p_patient if they hold an explicit profile_access_categories grant for it, OR they manage a genuinely dependent (no-login) account (profiles.is_dependent_account) — the dependent bypass covers every category including reproductive_health, since a legal guardian''s authority over a minor is a different consent relationship from a next-of-kin grant between two adults (which still requires the explicit category grant). Recovered 2026-09-02 from untracked drift back to 20260830123653''s intent — see 20260902231348_fix_can_read_clinical_dependent_bypass_drift.sql for the full incident. For reproductive_health_profiles specifically, this is layered under private.guardian_may_view_confidential_domain(), which additionally blocks a dependent in the protected adolescent age band (10-17) without an explicit waiver.';

-- ===========================================================================
-- Self-assertions — re-running 20260830123653's own proof, since that proof
-- passing once was not enough to keep this fixed.
-- ===========================================================================
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where proname = 'can_read_clinical' and pronamespace = 'private'::regnamespace
    and pg_get_function_identity_arguments(oid) = 'p_patient uuid, p_category care_access_category';

  if v_def like '%is_dependent_account and p_category%' then
    raise exception 'FAIL: can_read_clinical(uuid, care_access_category) still excludes reproductive_health from the dependent-account branch';
  end if;

  if not has_function_privilege('authenticated', 'private.can_read_clinical(uuid, care_access_category)', 'EXECUTE') then
    raise exception 'FAIL: authenticated lost EXECUTE on can_read_clinical(uuid, care_access_category)';
  end if;
  if has_function_privilege('anon', 'private.can_read_clinical(uuid, care_access_category)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute can_read_clinical(uuid, care_access_category)';
  end if;

  raise notice 'PASS: can_read_clinical(uuid, care_access_category) recovered to the dependent-account bypass covering every category, including reproductive_health';
end $$;
