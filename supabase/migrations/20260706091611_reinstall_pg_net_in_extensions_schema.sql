-- Tarragon Health
-- Reinstall pg_net in the extensions schema
--
-- Applied on the remote Supabase project (version 20260706091611) but never
-- committed as a local migration file — discovered 2026-07-11 while wiring
-- up the AbnormalResultHandler Edge Function trigger
-- (20260711130000_abnormal_result_handler_trigger.sql), when
-- `list_migrations` on the live project showed this version/name with no
-- corresponding file anywhere in this repo. Added retroactively, using the
-- exact statements recorded in `supabase_migrations.schema_migrations` on
-- the live project, so a fresh `supabase db push` against a brand-new
-- environment reproduces the same end state. Filename uses the live
-- project's own version stamp so `db push` against the already-migrated
-- project treats this as already applied rather than re-running it.
--
-- schedule_notification_sender (20260706110002, applied earlier on the live
-- project but later in local filename order) already ran
-- `create extension if not exists pg_net with schema extensions;` — this
-- drop+recreate fixed pg_net having installed outside the `extensions`
-- schema despite that clause (a known pg_net/Supabase quirk). Both
-- statements are idempotent (`if exists` / plain create, immediately
-- followed by a fresh create), so this is safe to run before or after
-- schedule_notification_sender on a fresh install — order between the two
-- doesn't matter for the final state.

drop extension if exists pg_net;
create extension pg_net with schema extensions;
