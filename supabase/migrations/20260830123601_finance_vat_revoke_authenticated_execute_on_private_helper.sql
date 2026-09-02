-- Follow-up to the §91.9 subsidy-engine investigation (worktree-payments-billing-engine):
-- private.compute_transaction_subsidy(uuid, text, bigint) was found live with an unexpected
-- direct EXECUTE grant to `authenticated` (proacl showed
-- {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} immediately after
-- creation), already fixed by that branch's own migration
-- 20260830115524_subsidy_engine_revoke_authenticated_execute_on_private_helper.sql. A spot-check
-- found the same-day sibling private.finance_compute_vat(text, bigint) (created by
-- 20260830112029_finance_vat_engine.sql, same session) carrying the identical grant right now.
--
-- Investigated as a possible schema-wide default-privileges misconfiguration. It is not one:
--
-- 1. `select * from pg_default_acl where defaclnamespace = 'private'::regnamespace and
--    defaclobjtype = 'f'` shows `{authenticated=X/postgres,service_role=X/postgres}` for role
--    postgres -- this is exactly, and only, what
--    20260812003758_revoke_private_schema_execute_from_public.sql deliberately set (`alter
--    default privileges in schema private grant execute on functions to authenticated,
--    service_role`), reaffirmed unchanged by 20260829111514's resweep. It is why EVERY new
--    private.* function -- including compute_transaction_subsidy above -- is born
--    authenticated-executable: dozens of RLS policies platform-wide call private.* helpers
--    (private.is_org_staff, private.can_read_clinical, etc.) directly as the `authenticated`
--    role during policy evaluation, so authenticated genuinely needs EXECUTE on most of the
--    schema. Of 538 private.* functions live today, 203 are directly callable (non-trigger);
--    188 of those 203 have authenticated EXECUTE, and that is overwhelmingly correct, load-
--    bearing behaviour, not drift -- do not write a migration that revokes it schema-wide or
--    changes the default privilege itself. Doing so would break RLS evaluation across roughly
--    110 patient-scoped tables gated by private.is_org_staff() alone (see CLAUDE.md).
-- 2. Searched every applied migration's actual SQL in supabase_migrations.schema_migrations
--    (not just local files, per this project's own "a live object/grant can exist with no
--    local file" precedent) for any OTHER `alter default privileges ... schema private ...
--    authenticated` or any `grant execute on all functions in schema private ...` statement.
--    Found none beyond the two named above -- no rogue schema-wide grant exists anywhere in
--    the migration history.
-- 3. finance_compute_vat's own paired test (packages/db/tests/finance_vat_engine.sql, check 7)
--    is reported to have asserted authenticated=false right after this function was created.
--    Given (1) and (2), that is unexplained: default privileges only apply at CREATE time and
--    cannot retroactively change an existing object's ACL, and no tracked migration touched
--    this function's grants afterward. The most likely explanation is an untracked, ad-hoc
--    GRANT run directly against the live project outside the migration system (this project's
--    own `db query --linked -f <file>` pattern does not get recorded in schema_migrations
--    unless the operator manually inserts the row) -- but this cannot be confirmed or
--    attributed: Postgres retains no queryable GRANT history, and this project's pgaudit
--    event trigger (pgaudit_ddl_command_end, confirmed present) logs to the platform's log
--    system, not a table reachable from here. Left open rather than guessed at.
--
-- The one concrete, narrow, safe fix this investigation actually supports: finance_compute_vat
-- is a pure internal computation helper with no caller-identity check, exactly like
-- compute_transaction_subsidy, called only from private.finance_post_journal (grep confirms no
-- other caller anywhere in the app or migrations). Because finance_post_journal is itself
-- SECURITY DEFINER, its internal call to finance_compute_vat runs as the function owner
-- (postgres), not as the original caller's role -- so revoking `authenticated` here cannot
-- break that path. Proved in a rolled-back transaction before this migration was written: the
-- exact same 107,500 -> 100,000 net + 7,500 VAT split via finance_post_journal(..., true)
-- still succeeds after the revoke.
--
-- Not reachable via PostgREST either way (private is not in the exposed schema list), so this
-- was defense-in-depth, not a live-exploitable gap.
--
-- Deliberately NOT included here (out of scope for this fix, flagged instead): the ~186 other
-- private.* functions with authenticated EXECUTE were not individually re-reviewed -- most are
-- legitimate RLS-policy helpers and a blanket sweep would be reckless; and the separate,
-- already-tracked anon/PUBLIC-inheritance drift on 34 private.* functions (see
-- feedback_supabase_anon_execute_gotcha memory) is untouched by this migration.

revoke execute on function private.finance_compute_vat(text, bigint) from authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'private.finance_compute_vat(text, bigint)', 'EXECUTE') then
    raise exception 'authenticated still has EXECUTE on private.finance_compute_vat after revoke';
  end if;
end $$;
