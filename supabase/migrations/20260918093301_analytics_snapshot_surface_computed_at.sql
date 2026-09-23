-- Tarragon Health
-- Closes a real /code-review high finding on this same session's Phase 1
-- analytics-warehouse work (20260918091524): public.analytics_business_summary()
-- switched from always-live aggregation to reading a nightly-refreshed
-- snapshot, but never surfaced HOW stale the number could be -- the
-- reviewing agent correctly flagged the admin welcome banner's own
-- "Live platform KPIs" comment as no longer accurate with nothing in the
-- payload for a caller to tell the difference. This adds `_computed_at`
-- to the returned jsonb (additive -- existing keys and every consumer's
-- Zod schema, which is not `.strict()`, are unaffected) so the UI can show
-- "as of <time>" and a manual refresh action has something to report back.

create or replace function public.analytics_business_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_computed_at timestamptz;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select payload, computed_at into v_payload, v_computed_at
  from analytics.rpc_snapshots
  where rpc_name = 'analytics_business_summary';

  if v_payload is null then
    return '{}'::jsonb;
  end if;

  return v_payload || jsonb_build_object('_computed_at', v_computed_at);
end;
$$;

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.analytics_business_summary'::regproc);
  if v_def !~ '_computed_at' then
    raise exception 'analytics_business_summary was not updated to surface _computed_at';
  end if;
  raise notice 'PASS: analytics_business_summary now surfaces _computed_at for staleness display';
end $$;
