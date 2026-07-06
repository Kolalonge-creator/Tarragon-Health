-- Tarragon Health — notification send layer (Phase 1)
-- 02 · Schedule send-pending-notifications every 5 minutes
--
-- pg_cron + pg_net invoking a Supabase Edge Function is Supabase's own
-- documented pattern for this (see docs/ARCHITECTURE.md §2/§8/§16 — Edge
-- Functions already own "triggers, webhooks"). Railway is mentioned in §11
-- for schedulers generally, but is unprovisioned (§13/§17 item 1); this is
-- a deliberate interim choice, not a silent deviation.
--
-- The publishable key stored below is not a secret in the security sense
-- (it's RLS-scoped and safe to expose to a browser) — Vault is still the
-- documented mechanism for keeping it out of migration literals doing
-- double duty as both schema and config.

create extension if not exists pg_net with schema extensions;

select vault.create_secret(
  'https://koiplnmbgnqnbywhpjlf.supabase.co',
  'project_url'
);

select vault.create_secret(
  'sb_publishable_b59zf3vYYD7AKHUlTyzbAQ_yRq7vhE2',
  'edge_function_publishable_key'
);

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
