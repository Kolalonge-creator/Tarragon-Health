-- ============================================================================
-- LPE Phase 5 — pgvector scaffold for content personalisation (spec §11, §4.1).
-- Schema-only, like the wearables scaffold: the embedding column + ANN index
-- exist so the retrieval path can be wired, but embeddings are only populated
-- once a real embedding provider is configured. Retrieval degrades gracefully
-- (falls back to condition/module/risk tags) until then.
-- ============================================================================
--
-- 2026-07-29: schema-qualified for replay. 20260705211044_core_auth_multitenancy
-- installs pgvector into the `extensions` schema, which is NOT on the migration
-- connection's search_path (config.toml's extra_search_path applies to PostgREST,
-- not to psql/db push). The bare `vector(1536)` below therefore failed with
-- "type vector does not exist" when this history was replayed into a fresh
-- project, even though it worked against the original database. Both the
-- CREATE EXTENSION and the type reference now name the schema explicitly.
create extension if not exists vector with schema extensions;

alter table public.lpe_content_blocks
  add column if not exists embedding extensions.vector(1536);

-- ivfflat needs data to build meaningful lists; deferred until the library is
-- populated. A brute-force cosine scan is fine at the seed-library scale.
