-- Consumer wearable "Connect" flow + webhook ingestion (the two pieces
-- CLAUDE.md flags as the real remaining gap now that oauth-providers.ts's
-- authorize-URL builder exists). wearable_connections had no column to
-- persist the OAuth tokens a real sync (webhook-notify-then-fetch, or a
-- periodic pull) needs to call the provider's API later — added here.
-- Service-role-write only (same as wearable_readings), never surfaced to
-- the client beyond "connected"/"not connected".
alter table public.wearable_connections
  add column if not exists access_token text,
  add column if not exists refresh_token text,
  add column if not exists token_expires_at timestamptz;

comment on column public.wearable_connections.access_token is
  'Provider OAuth access token — service-role read/write only at the app layer; never sent to the client beyond a connected/not-connected boolean.';
