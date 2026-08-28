create or replace function public.analytics_traffic_summary(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'visitors', (select count(distinct coalesce(session_id, id::text)) from public.web_events
                 where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)),
    'logged_in_visitors', (select count(distinct profile_id) from public.web_events
                 where profile_id is not null and (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)),
    'pageviews', (select count(*) from public.web_events
                 where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)),
    'by_country', (select coalesce(jsonb_agg(jsonb_build_object('country', country, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(country,'Unknown') country, count(distinct coalesce(session_id, id::text)) v from public.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(country,'Unknown')) t),
    'by_region', (select coalesce(jsonb_agg(jsonb_build_object('region', region, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(region,'Unknown') region, count(distinct coalesce(session_id, id::text)) v from public.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(region,'Unknown')) t),
    'by_referrer', (select coalesce(jsonb_agg(jsonb_build_object('referrer_host', referrer_host, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(referrer_host,'Direct') referrer_host, count(distinct coalesce(session_id, id::text)) v from public.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(referrer_host,'Direct')) t),
    'by_source', (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(utm_source,'None') source, count(distinct coalesce(session_id, id::text)) v from public.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(utm_source,'None')) t),
    'by_device', (select coalesce(jsonb_agg(jsonb_build_object('device', device_type, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(device_type,'unknown') device_type, count(distinct coalesce(session_id, id::text)) v from public.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(device_type,'unknown')) t),
    'by_page', (select coalesce(jsonb_agg(jsonb_build_object('page', page, 'pageviews', pv, 'visitors', v) order by pv desc), '[]'::jsonb)
      from (
        select page, count(*) pv, count(distinct visitor) v
        from (
          select
            regexp_replace(path, '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '/:id', 'gi') as page,
            coalesce(session_id, id::text) as visitor
          from public.web_events
          where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)
        ) normalised
        group by page
        order by pv desc
        limit 20
      ) t)
  );
end; $$;
