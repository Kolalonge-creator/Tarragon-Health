-- Admin/analyst funnel widget for the Reputation & Review-Generation Engine
-- (docs/COMPETITIVE_INSIGHTS_BUILD_PLAN.md category 1's "request-to-
-- submission conversion" requirement) -- deliberately a request ->
-- engagement funnel, not a submission count: neither the App/Play Store
-- native review API nor Trustpilot reports back whether a review was
-- actually left. `clicked` is left null for native_app_store (there's
-- nothing to click for a native OS prompt) rather than a fabricated 0.
-- Matches analytics_acquisition_funnel's exact shape (jsonb, plpgsql,
-- private.is_analyst() gate returning an empty array rather than raising).

create or replace function public.analytics_reputation_review_conversion()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_result jsonb;
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;

  select jsonb_agg(
    jsonb_build_object(
      'channel', channel,
      'queued', queued,
      'engaged', engaged,
      'clicked', clicked,
      'skipped_rate_limited', skipped_rate_limited
    )
  )
  into v_result
  from (
    select
      channel::text as channel,
      count(*) filter (where status not in ('skipped_rate_limited', 'skipped_flag_disabled')) as queued,
      count(*) filter (where status in ('sent', 'shown', 'clicked', 'dismissed')) as engaged,
      case
        when channel = 'trustpilot_email' then count(*) filter (where status = 'clicked')
        else null
      end as clicked,
      count(*) filter (where status = 'skipped_rate_limited') as skipped_rate_limited
    from public.reputation_review_prompts
    group by channel
  ) t;

  return coalesce(v_result, '[]'::jsonb);
end;
$function$;

revoke all on function public.analytics_reputation_review_conversion() from public;
grant execute on function public.analytics_reputation_review_conversion() to authenticated;
