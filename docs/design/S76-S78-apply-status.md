# S75 to S80: what is live in production versus the repository (read-only check, 2026-10-27)

Method: `supabase_migrations.schema_migrations` on project `koiplnmbgnqnbywhpjlf` read with two SELECT statements (no write, nothing applied), compared with the S75 to S80 migration files on `origin/main-dev` at `55a423662`. Re-run before relying on it: production moves daily.

## Result: every S75 to S80 migration file in the repository is recorded as applied under its own version

| Group | Versions (all live) |
|---|---|
| S77 engine | `20261007141845` |
| S75 / S76 / S78 build set | `20261007160001` to `160008`, `160009` to `160012`, `160014` |
| S77 follow-ups | `20261007160101` |
| S80 C-set | `20261007160201`, `160202`, `160203`, `160204` |
| **Review fixes** | **`20261007160301` (`s75_80_review_fixes`) is live** |
| Registration | `20261007164510` (`s75_s80_register_patient_tables`) |
| S80 fix-first, a, b, c | `20261007203417`, `204226`, `204718`, `205203` |
| S75 a, b, c | `20261007211347`, `213829`, `220513` |
| Later S75 to S78 fixes | `20261013221500`, `222000`, `222100`, `20261014233705`, `20261015034112`, `034113`, `20261016004217`, `023011` |

`20261007160013` has no file and no live row (a gap in the numbering, not drift).

## So the hand-off's "review fixes not applied or proved" is out of date
`docs/plans/S75-S80-build-handoff.md` (2026-10-07) says `20261007160301_s75_80_review_fixes.sql` was written but not applied. It is applied: live row `20261007160301 | s75_80_review_fixes`. What is NOT established by this check is whether the proofs for the fixes pass, because applying is not proving. Nobody has recorded a clean replay result for the S76 to S78 proofs; CI's replay runs them, so the merged state is covered by the CI history rather than by any entry in this repository.

## Things this check cannot tell you
- Whether a live function body equals the file body. Version rows can match while the function differs (the S80 fix-first and S80a files re-created `set_health_education_content_status` whole and dropped the F1 expiry refusal on a fresh replay; the live function does contain it, so live and a fresh replay differed until the 2026-10-27 migration restores it).
- Both `public.automations` (S80b) and `public.automation_jobs` (S80 C5) are live, two registries for one job. See `docs/design/S80.md`.
- The S77 live red-flag prompt guard, the S76 dark features and the S78 configs are unsigned or off; nothing here changes that.
