-- AI Health Assistant §36.15/§36.16 — pgvector retrieval over
-- health_education_content, the first of two named approved-content
-- sources this migration closes (the other, condition_protocols, is out of
-- scope here — see docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §7 Phase B).
--
-- Mirrors lpe_content_blocks' own embedding scaffold
-- (20260719124000_lpe_content_embeddings.sql) and retrieval RPC
-- (20260810034407_match_lpe_content_blocks_rpc.sql) exactly: schema-only
-- until a real embedding provider populates it (embeds gracefully no-op
-- with no VOYAGE_API_KEY configured, same as the lifestyle content path),
-- SECURITY INVOKER so RLS on health_education_content is fully respected,
-- and a belt-and-suspenders `clinician_reviewed = true` filter on top of it.
--
-- `extensions.vector`, not a bare `vector` — CLAUDE.md's standing
-- pgvector-schema-location lesson.
create extension if not exists vector with schema extensions;

alter table public.health_education_content
  add column if not exists embedding extensions.vector(1536);

create or replace function public.match_health_education_content(
  query_embedding extensions.vector(1536),
  match_count int default 3,
  filter_condition public.care_plan_condition default null
)
returns table (
  id uuid,
  code text,
  title text,
  summary text,
  body text,
  condition public.care_plan_condition,
  similarity float
)
language sql
stable
set search_path = public, extensions
as $$
  select
    c.id, c.code, c.title, c.summary, c.body, c.condition,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.health_education_content c
  where c.clinician_reviewed = true
    and c.is_active = true
    and c.embedding is not null
    and (filter_condition is null or c.condition = filter_condition or c.condition is null)
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 0)
$$;

-- anon inherits EXECUTE through the PUBLIC pseudo-role unless explicitly
-- revoked from PUBLIC itself (not from `anon`) — standing gotcha, see
-- feedback_supabase_anon_execute_gotcha in memory / CLAUDE.md.
revoke execute on function public.match_health_education_content(extensions.vector, int, public.care_plan_condition) from public;
revoke execute on function public.match_health_education_content(extensions.vector, int, public.care_plan_condition) from anon;
grant execute on function public.match_health_education_content(extensions.vector, int, public.care_plan_condition) to authenticated;

do $$
begin
  if has_function_privilege(
    'anon',
    'public.match_health_education_content(extensions.vector, int, public.care_plan_condition)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: anon can still execute match_health_education_content';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.match_health_education_content(extensions.vector, int, public.care_plan_condition)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated cannot execute match_health_education_content';
  end if;
  raise notice 'PASS: match_health_education_content — anon locked out, authenticated can call it';
end $$;
