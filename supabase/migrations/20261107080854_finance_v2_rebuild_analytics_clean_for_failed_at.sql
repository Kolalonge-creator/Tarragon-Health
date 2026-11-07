-- Finance v2 Phase C1 (20261107035055) added public.orders.failed_at. analytics_clean.orders freezes its column list
-- (OQ-39), so it is rebuilt here to pick the column up; the OQ-39 drift proof (oq39_analytics_clean_views_drift.sql)
-- fails until it is. The rebuild is the documented recipe and changes no data.
select private.rebuild_analytics_clean_views();

do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'analytics_clean.orders'::regclass and attname = 'failed_at' and not attisdropped) then
    raise exception 'analytics_clean.orders still lacks failed_at after the rebuild';
  end if;
end $$;
