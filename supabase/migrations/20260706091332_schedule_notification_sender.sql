-- Tarragon Health — notification send layer (Phase 1)
-- 02 · Schedule send-pending-notifications every 5 minutes
--
-- pg_cron + pg_net invoking a Supabase Edge Function is Supabase's own
-- documented pattern for this (see docs/ARCHITECTURE.md §2/§8/§16 — Edge
-- Functions already own "triggers, webhooks"). Railway is mentioned in §11
-- for schedulers generally, but is unprovisioned (§13/§17 item 1); this is
-- a deliberate interim choice, not a silent deviation.
--
-- This migration replays in every environment (local, per-PR preview
-- branch, production — docs/ARCHITECTURE.md §16), so it must never embed
-- an environment-specific project URL or key as a literal. The 'project_url'
-- and 'edge_function_publishable_key' Vault secrets this cron job reads are
-- environment-specific config, not schema — they must be created once per
-- environment out-of-band (dashboard or `supabase secrets`/SQL editor),
-- exactly like WHATSAPP_TOKEN/TERMII_API_KEY are set as Edge Function
-- secrets per environment rather than baked into a migration. Until those
-- two Vault secrets exist, this cron job's net.http_post calls fail closed
-- (null URL/header) rather than misfiring against another environment.

create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'send-pending-notifications',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/send-pending-notifications',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 8000
  ) as request_id;
  $$
);
