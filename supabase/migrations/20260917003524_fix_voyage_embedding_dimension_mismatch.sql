-- AI-009 (Lifestyle content retrieval embeddings) — fix a real,
-- previously-unverifiable dimension mismatch, found by making the first
-- ever real call to the Voyage API against a real key during the AI-009
-- evaluation (2026-09-17). VOYAGE_API_KEY had never been configured in
-- this environment before (confirmed by PR #647 and the AI-002-015
-- evaluation scope doc), so `EXPECTED_DIMENSIONS = 1536` in
-- voyage-embedder.ts, and the matching `vector(1536)` columns on both
-- lpe_content_blocks and health_education_content, had never actually been
-- exercised against the real API -- exactly the "VERIFY BEFORE TRUSTING
-- THIS LIVE" gap voyage-embedder.ts's own comment flagged.
--
-- The real Voyage API rejects it outright: "Value '1536' supplied for
-- argument 'output_dimension' is not valid -- accepted values for
-- 'voyage-3-large' are [256, 512, 1024, 2048]." Every single embed() call
-- would have thrown a 400 the moment a real key reached production --
-- not a partial degradation, a hard failure on every call, silently
-- swallowed by populateContentEmbeddings' existing best-effort error
-- handling (so this would have looked like "the retrieval pipeline
-- quietly never has any content", not an error anyone would have seen).
--
-- Fixed by moving both tables to 1024 dimensions -- Voyage's own default
-- for voyage-3-large when output_dimension is omitted, and the closest
-- supported value below the originally-assumed 1536 (keeps embedding
-- storage/index cost lower than 2048 for no loss of the platform's own
-- retrieval-quality target, which was never benchmarked at any specific
-- dimension to begin with -- see the AI-009 evaluation notes recorded
-- against this system for the honest picture of what has and hasn't been
-- measured).
--
-- SAFE, ZERO-DATA-RISK CHANGE: both tables have zero rows with a non-null
-- embedding today (58/0 on lpe_content_blocks, 235/0 on
-- health_education_content, confirmed live immediately before this
-- migration) -- this is a pure structural fix, not a backfill.

do $$
declare
  v_lpe_total int;
  v_lpe_embedded int;
  v_health_total int;
  v_health_embedded int;
begin
  select count(*), count(embedding) into v_lpe_total, v_lpe_embedded from public.lpe_content_blocks;
  select count(*), count(embedding) into v_health_total, v_health_embedded from public.health_education_content;
  if v_lpe_embedded <> 0 or v_health_embedded <> 0 then
    raise exception 'expected zero embedded rows before this dimension change (found % lpe_content_blocks, % health_education_content) -- this migration is not safe to run as a pure structural change anymore, it needs a real re-embedding backfill plan instead', v_lpe_embedded, v_health_embedded;
  end if;

  alter table public.lpe_content_blocks alter column embedding type extensions.vector(1024);
  alter table public.health_education_content alter column embedding type extensions.vector(1024);
end;
$$;

drop function if exists public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module);

create function public.match_lpe_content_blocks(
  query_embedding extensions.vector(1024),
  match_count int default 3,
  filter_condition public.care_plan_condition default null,
  filter_module public.lpe_module default null
)
returns table (
  id uuid,
  condition public.care_plan_condition,
  module public.lpe_module,
  key text,
  title text,
  body_md text,
  similarity float
)
language sql
stable
set search_path = public, extensions
as $$
  select
    b.id, b.condition, b.module, b.key, b.title, b.body_md,
    1 - (b.embedding <=> query_embedding) as similarity
  from public.lpe_content_blocks b
  where b.clinician_reviewed = true
    and b.embedding is not null
    and (filter_condition is null or b.condition = filter_condition)
    and (filter_module is null or b.module = filter_module)
  order by b.embedding <=> query_embedding
  limit greatest(match_count, 0)
$$;

-- Dropping and recreating the function loses its prior grants -- restore
-- the exact same anon-locked-out / authenticated-only ACL the original
-- 20260810034407 migration set up.
revoke execute on function public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module) from public;
revoke execute on function public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module) from anon;
grant execute on function public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module) to authenticated;

drop function if exists public.match_health_education_content(extensions.vector, int, public.care_plan_condition);

create function public.match_health_education_content(
  query_embedding extensions.vector(1024),
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

revoke execute on function public.match_health_education_content(extensions.vector, int, public.care_plan_condition) from public;
revoke execute on function public.match_health_education_content(extensions.vector, int, public.care_plan_condition) from anon;
grant execute on function public.match_health_education_content(extensions.vector, int, public.care_plan_condition) to authenticated;

do $$
declare
  v_anon_lpe boolean;
  v_auth_lpe boolean;
  v_anon_health boolean;
  v_auth_health boolean;
begin
  v_anon_lpe := has_function_privilege('anon', 'public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module)', 'EXECUTE');
  v_auth_lpe := has_function_privilege('authenticated', 'public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module)', 'EXECUTE');
  v_anon_health := has_function_privilege('anon', 'public.match_health_education_content(extensions.vector, int, public.care_plan_condition)', 'EXECUTE');
  v_auth_health := has_function_privilege('authenticated', 'public.match_health_education_content(extensions.vector, int, public.care_plan_condition)', 'EXECUTE');
  if v_anon_lpe or v_anon_health then
    raise exception 'anon must not regain EXECUTE on either match function after the drop+recreate (anon_lpe=%, anon_health=%)', v_anon_lpe, v_anon_health;
  end if;
  if not v_auth_lpe or not v_auth_health then
    raise exception 'authenticated must retain EXECUTE on both match functions after the drop+recreate (auth_lpe=%, auth_health=%)', v_auth_lpe, v_auth_health;
  end if;
end;
$$;

do $$
begin
  if (select format_type(a.atttypid, a.atttypmod)
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relname = 'lpe_content_blocks' and a.attname = 'embedding') <> 'vector(1024)' then
    raise exception 'lpe_content_blocks.embedding did not end up as vector(1024)';
  end if;
  if (select format_type(a.atttypid, a.atttypmod)
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relname = 'health_education_content' and a.attname = 'embedding') <> 'vector(1024)' then
    raise exception 'health_education_content.embedding did not end up as vector(1024)';
  end if;
end;
$$;
