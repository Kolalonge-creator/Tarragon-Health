-- ============================================================================
-- Retrieval half of pgvector content personalisation (spec §11) — the actual
-- point of embedding lpe_content_blocks at all. Cosine-similarity search via
-- pgvector's `<=>` operator, scoped to reviewed content only.
--
-- Deliberately SECURITY INVOKER (the default — no `security definer` here):
-- runs with the calling session's own privileges, so RLS on
-- lpe_content_blocks (lpe_content_blocks_read, tightened in
-- 20260810034122_gate_lpe_content_blocks_read_on_review_status.sql) is fully
-- respected — a patient session can never see an unreviewed row through this
-- function even if the WHERE clause below were ever removed by mistake. The
-- explicit `clinician_reviewed = true` filter here is belt-and-suspenders on
-- top of RLS, not a substitute for it.
--
-- `extensions.vector` (not a bare `vector`), per the standing pgvector
-- schema-location lesson in CLAUDE.md.
-- ============================================================================

create or replace function public.match_lpe_content_blocks(
  query_embedding extensions.vector(1536),
  match_count int default 3,
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
  similarity float
)
language sql
stable
set search_path = public, extensions
as $$
  select
    b.id, b.key, b.title, b.body_md, b.condition, b.module,
    1 - (b.embedding <=> query_embedding) as similarity
  from public.lpe_content_blocks b
  where b.clinician_reviewed = true
    and b.embedding is not null
    and (filter_condition is null or b.condition = filter_condition or b.condition is null)
    and (filter_module is null or b.module = filter_module)
  order by b.embedding <=> query_embedding
  limit greatest(match_count, 0)
$$;

-- anon inherits EXECUTE through the PUBLIC pseudo-role unless explicitly
-- revoked from PUBLIC itself (not from `anon`) — standing gotcha, see
-- feedback_supabase_anon_execute_gotcha in memory / CLAUDE.md.
revoke execute on function public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module) from public;
grant execute on function public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module) to authenticated;

-- Prove the anon lockdown actually took, not just hope.
do $$
begin
  if has_function_privilege(
    'anon',
    'public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: anon can still execute match_lpe_content_blocks';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated cannot execute match_lpe_content_blocks';
  end if;
  raise notice 'PASS: match_lpe_content_blocks — anon locked out, authenticated can call it';
end $$;
