-- Recovery placeholder, 2026-10-31 (Release Integrity UNTRACED finding).
-- This migration is applied live under version 20260922201110 but its source was never committed
-- anywhere, and supabase_migrations.schema_migrations did not keep the SQL for the password verification hook / GoTrue-level lockout change (schema_migrations.statements holds only a pointer comment).
-- The verbatim text is therefore unrecoverable. The live database objects are the authority:
-- read them with pg_get_functiondef / pg_get_triggerdef rather than trusting this file.
-- This file is deliberately a no-op so a fresh replay stays unchanged in behaviour; it exists
-- so the version is traced in git. Do not edit history; if the SQL turns up, replace this body.
select 1;
