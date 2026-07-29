-- ============================================================================
-- LPE Phase 5 — pgvector scaffold for content personalisation (spec §11, §4.1).
-- Schema-only, like the wearables scaffold: the embedding column + ANN index
-- exist so the retrieval path can be wired, but embeddings are only populated
-- once a real embedding provider is configured. Retrieval degrades gracefully
-- (falls back to condition/module/risk tags) until then.
-- ============================================================================
create extension if not exists vector;

alter table public.lpe_content_blocks
  add column if not exists embedding vector(1536);

-- ivfflat needs data to build meaningful lists; deferred until the library is
-- populated. A brute-force cosine scan is fine at the seed-library scale.
