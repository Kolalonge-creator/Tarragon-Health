-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as 20260803130644_fix_lab_result_extractions_anon_table_grant.sql:
-- 20260803145146_emergency_cards.sql's own assertion (anon must not be able
-- to SELECT this table directly -- the whole point of routing anon access
-- through emergency_card_by_token() instead) fails on a fresh replay, even
-- though that migration only ever grants SELECT to `authenticated`. Same
-- unexplained local/hosted default-ACL gap as roles.sql's function stubs
-- and lab_result_extractions, this time on a second table.
--
-- Table grants can't be pre-seeded in roles.sql (the table doesn't exist
-- yet, before any migration). Instead, pre-create it here with the same
-- shape (CREATE TABLE/INDEX IF NOT EXISTS, so the real migration's own
-- create is a no-op) and the grants already correct, one second before its
-- real consumer -- the same CREATE-OR-REPLACE-preserves-ACL trick used for
-- functions, applied to a table's default ACL instead.
create table if not exists public.emergency_cards (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null unique references public.profiles (id) on delete cascade,
  organisation_id    uuid not null references public.organisations (id),
  token              text not null unique check (length(token) between 32 and 128),
  is_active          boolean not null default true,
  consented_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  revoked_at         timestamptz,
  last_viewed_at     timestamptz,
  view_count         integer not null default 0
);

create index if not exists emergency_cards_token_idx on public.emergency_cards (token)
  where is_active;

revoke all on public.emergency_cards from public;
revoke all on public.emergency_cards from anon;
grant select on public.emergency_cards to authenticated;
