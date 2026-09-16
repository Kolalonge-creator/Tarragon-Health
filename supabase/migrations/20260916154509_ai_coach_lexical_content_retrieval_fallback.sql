-- AI Coach knowledge retrieval: a lexical fallback for when no embedding
-- vendor is configured.
--
-- WHY. The coach's whole "grounded in clinician-approved Tarragon content"
-- premise has never worked in production. Retrieval runs only when an
-- Embedder exists (graph.ts), the only Embedder is Voyage AI, and
-- VOYAGE_API_KEY has never been set — so `createVoyageEmbedderFromEnv()`
-- returns null, the retrieval block is skipped whole, and the daily
-- /api/cron/ai-coach-embed-content run is a permanent no-op that answers
-- `{ reason: "no_embedder_configured" }` to nobody. Measured on the live
-- project on 2026-09-16: 0 of 235 health_education_content rows and 0 of 58
-- lpe_content_blocks rows carry an embedding. Every coach reply to date has
-- been the model's own general knowledge with zero Tarragon grounding, and
-- nothing anywhere said so.
--
-- The failure mode that matters is the silence, not the vendor. Retrieval
-- degraded to *nothing* and looked identical to "no relevant content found".
-- So this adds the path that needs no vendor at all: Postgres full-text
-- search over the same rows, with the same gating, returning the same shape.
-- Semantic search is still better when an embedder exists and the vector
-- RPCs remain the preferred path; this is what runs when one does not, so
-- "ungrounded" stops being the silent default.
--
-- GATING IS COPIED, NOT RE-DECIDED. Both functions repeat the exact
-- predicates their vector siblings use (`clinician_reviewed`, `is_active`,
-- the condition/module filters). A lexical search that could reach a row the
-- semantic search cannot would be a content-governance hole, not a feature —
-- the point is a second way to rank the same permitted rows, never a second,
-- looser set of rows.
--
-- NOTE the separate, larger content-governance gap this does NOT fix, and
-- must not be taken to have fixed: only 6 of 235 health_education_content
-- rows and 0 of 58 lpe_content_blocks rows are `clinician_reviewed`. Both
-- retrieval paths are gated on that flag, so the reachable library is six
-- articles regardless of which one runs. Flipping that flag is a clinician's
-- judgement, not an engineering step, and is deliberately left alone here.
--
-- `similarity` is a weighted ts_rank, which is NOT on the vector path's 0..1
-- cosine scale. The callers only ever order by it and never threshold on it,
-- and the column is named the same so the two RPCs stay drop-in
-- interchangeable. Anything that later wants to threshold must branch on
-- which path ran.

create or replace function public.search_health_education_content_text(
  query_text text,
  match_count integer default 3,
  filter_condition public.care_plan_condition default null
)
returns table (
  id uuid,
  code text,
  title text,
  summary text,
  body text,
  condition public.care_plan_condition,
  similarity double precision
)
language sql
stable
set search_path to ''
as $fn$
  with q as (
    -- OR, not AND. websearch_to_tsquery/plainto_tsquery both AND every term
    -- together, which is right for a search box and wrong for a sentence a
    -- patient typed: "my blood pressure has been high and I eat a lot of
    -- salty food" would have to appear in full in one article to match
    -- anything, so the first draft of this function returned zero rows for
    -- every realistic message. Splitting the message into its own lexemes
    -- and OR-ing them lets an article match on the words it does share, and
    -- the weighted ts_rank below does the actual work of preferring the
    -- article that shares the most of them, in the most important field.
    select nullif(
      (select string_agg(quote_literal(l.lexeme), ' | ')
         from unnest(to_tsvector('pg_catalog.english', coalesce(query_text, ''))) as l),
      ''
    )::tsquery as tsq
  )
  select
    c.id, c.code, c.title, c.summary, c.body, c.condition,
    -- Title matches beat summary matches beat body matches. Unweighted
    -- ts_rank ranked "Understanding your blood sugar" above "Understanding
    -- your blood pressure" for a message about blood pressure, purely on how
    -- often the shared lexeme "blood" appeared in each body.
    ts_rank(
      '{0.1,0.2,0.4,1.0}'::float4[],
      setweight(to_tsvector('pg_catalog.english', coalesce(c.title, '')), 'A') ||
      setweight(to_tsvector('pg_catalog.english', coalesce(c.summary, '')), 'B') ||
      setweight(to_tsvector('pg_catalog.english', coalesce(c.body, '')), 'C'),
      q.tsq
    )::double precision as similarity
  from public.health_education_content c
  cross join q
  where c.clinician_reviewed = true
    and c.is_active = true
    and q.tsq is not null
    -- Matched against the plain, unweighted vector rather than the weighted
    -- one above so the GIN index at the foot of this migration is usable:
    -- the index expression has to be identical to the predicate.
    and to_tsvector('pg_catalog.english', coalesce(c.title, '') || ' ' || coalesce(c.summary, '') || ' ' || coalesce(c.body, '')) @@ q.tsq
    and (filter_condition is null or c.condition = filter_condition or c.condition is null)
  order by similarity desc
  limit greatest(coalesce(match_count, 3), 0)
$fn$;

comment on function public.search_health_education_content_text(text, integer, public.care_plan_condition) is
  'Lexical (full-text) sibling of match_health_education_content, for when no embedding vendor is configured. Identical row gating; weighted ts_rank score, not cosine similarity.';

create or replace function public.search_lpe_content_blocks_text(
  query_text text,
  match_count integer default 3,
  filter_condition public.care_plan_condition default null,
  filter_module public.lpe_module default null
)
returns table (
  id uuid,
  key text,
  title text,
  body_md text,
  condition public.care_plan_condition,
  module public.lpe_module,
  similarity double precision
)
language sql
stable
set search_path to ''
as $fn$
  with q as (
    select nullif(
      (select string_agg(quote_literal(l.lexeme), ' | ')
         from unnest(to_tsvector('pg_catalog.english', coalesce(query_text, ''))) as l),
      ''
    )::tsquery as tsq
  )
  select
    b.id, b.key, b.title, b.body_md, b.condition, b.module,
    ts_rank(
      '{0.1,0.2,0.4,1.0}'::float4[],
      setweight(to_tsvector('pg_catalog.english', coalesce(b.title, '')), 'A') ||
      setweight(to_tsvector('pg_catalog.english', coalesce(b.body_md, '')), 'C'),
      q.tsq
    )::double precision as similarity
  from public.lpe_content_blocks b
  cross join q
  where b.clinician_reviewed = true
    and q.tsq is not null
    and to_tsvector('pg_catalog.english', coalesce(b.title, '') || ' ' || coalesce(b.body_md, '')) @@ q.tsq
    and (filter_condition is null or b.condition = filter_condition or b.condition is null)
    and (filter_module is null or b.module = filter_module)
  order by similarity desc
  limit greatest(coalesce(match_count, 3), 0)
$fn$;

comment on function public.search_lpe_content_blocks_text(text, integer, public.care_plan_condition, public.lpe_module) is
  'Lexical (full-text) sibling of match_lpe_content_blocks, for when no embedding vendor is configured. Identical row gating; weighted ts_rank score, not cosine similarity.';

-- Same grant/revoke shape as the vector siblings: patients ask these through
-- their own authenticated session. `anon` inherits EXECUTE through the PUBLIC
-- pseudo-role, so the revoke has to name PUBLIC — revoking `from anon`
-- directly is the no-op this codebase has re-learned repeatedly.
revoke all on function public.search_health_education_content_text(text, integer, public.care_plan_condition) from public;
revoke all on function public.search_lpe_content_blocks_text(text, integer, public.care_plan_condition, public.lpe_module) from public;
grant execute on function public.search_health_education_content_text(text, integer, public.care_plan_condition) to authenticated;
grant execute on function public.search_lpe_content_blocks_text(text, integer, public.care_plan_condition, public.lpe_module) to authenticated;

-- Indexes so the fallback stays cheap as the libraries grow. GIN over the
-- same expression the `@@` predicates use, or the planner sequential-scans
-- and re-tsvectors every row on every coach turn.
create index if not exists health_education_content_fts_idx
  on public.health_education_content
  using gin (to_tsvector('pg_catalog.english', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, '')));

create index if not exists lpe_content_blocks_fts_idx
  on public.lpe_content_blocks
  using gin (to_tsvector('pg_catalog.english', coalesce(title, '') || ' ' || coalesce(body_md, '')));

do $chk$
declare
  v_hits integer;
begin
  if has_function_privilege('anon', 'public.search_health_education_content_text(text, integer, public.care_plan_condition)', 'EXECUTE') then
    raise exception 'anon can still execute search_health_education_content_text';
  end if;
  if has_function_privilege('anon', 'public.search_lpe_content_blocks_text(text, integer, public.care_plan_condition, public.lpe_module)', 'EXECUTE') then
    raise exception 'anon can still execute search_lpe_content_blocks_text';
  end if;
  if not has_function_privilege('authenticated', 'public.search_health_education_content_text(text, integer, public.care_plan_condition)', 'EXECUTE') then
    raise exception 'authenticated cannot execute search_health_education_content_text';
  end if;
  if not has_function_privilege('authenticated', 'public.search_lpe_content_blocks_text(text, integer, public.care_plan_condition, public.lpe_module)', 'EXECUTE') then
    raise exception 'authenticated cannot execute search_lpe_content_blocks_text';
  end if;

  -- The assertion that would actually have caught the AND-semantics bug: a
  -- sentence-shaped question must reach content, not merely compile. Skipped
  -- rather than failed when the library is empty (a fresh local db reset has
  -- no seeded reviewed content), because "no rows to search" is a legitimate
  -- state for this function and failing here would block CI replay.
  if exists (select 1 from public.health_education_content where clinician_reviewed and is_active) then
    select count(*) into v_hits
      from public.search_health_education_content_text('my blood pressure has been high lately', 3, null);
    if v_hits = 0 then
      raise exception 'lexical retrieval returned nothing for a sentence-shaped query over a non-empty reviewed library';
    end if;
  end if;
end;
$chk$;
