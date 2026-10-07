-- chore_remove_pidgin: SUPERSEDED, deliberately a no-op in the repository.
--
-- This version was applied to production on 2026-10-07 before the English-only removal (20261006222924_remove_nigerian_pidgin_english_only.sql,
-- PR #984) was applied: it narrowed the language CHECKs to en, yo, ha, ig, deleted the pidgin_language switch and the unused AI-017 Pidgin eval
-- case. #984 does all of that and also removes yo, ha and ig, and runs earlier in replay order, so replaying the original SQL here would
-- re-widen the constraints. The version is kept in the repository so the live schema_migrations row (whose `statements` column holds the SQL
-- that ran) has a matching file and the migration-drift check finds nothing untraced.
select 1;
