-- The Operations analytics page's "Notification deliverability" table showed
-- the in_app channel at a ~2% success rate (3,143 pending / 65 read out of
-- 3,208 total, zero ever failed) -- reading exactly like the platform's
-- primary, current notification channel (CLAUDE.md: WhatsApp/SMS deprioritized
-- 2026-09-15, in-app is the working channel) is almost entirely broken.
--
-- It isn't. `send-pending-notifications` never processes in_app rows at all
-- (see supabase/functions/send-pending-notifications/index.ts's own comment:
-- "in_app rows are never routed through this sender at all -- they're visible
-- via the in_app leg the moment it's queued") -- a row is rendered by
-- NotificationBell the instant it's inserted, no external send step, no
-- provider to fail against. 'pending' for in_app means "not yet read by the
-- patient", not "not yet delivered" the way it legitimately does for
-- whatsapp/sms/email/push, which route through a real external API call that
-- can fail or queue. Confirmed live: in_app has zero 'failed' rows, ever.
--
-- Counting only 'sent'/'delivered'/'read' as success (the correct rule for
-- every other channel) applies the wrong yardstick to in_app and makes a
-- channel that has never once failed look like the most broken one on the
-- page. Fixed: for in_app specifically, anything not explicitly 'failed'
-- counts as delivered.
create or replace function public.analytics_deliverability(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'by_channel', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'channel', channel, 'total', total, 'sent', sent, 'failed', failed, 'pending', pending,
        'success_pct', case when total=0 then 0 else round(100.0 * sent / total, 1) end) order by total desc), '[]'::jsonb)
      from (
        select channel::text channel, count(*) total,
          count(*) filter (
            where status in ('sent','delivered','read')
               or (channel = 'in_app' and status <> 'failed')
          ) sent,
          count(*) filter (where status='failed') failed,
          count(*) filter (where status='pending') pending
        from public.notifications where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to)
        group by channel
      ) t
    ),
    'queue_depth', (
      -- in_app has no real queue -- pending there means unread, not backlogged.
      select count(*) from public.notifications where status='pending' and channel <> 'in_app'
    ),
    'failures', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', c) order by c desc), '[]'::jsonb)
      from (select coalesce(last_error,'unknown') reason, count(*) c from public.notifications where status='failed' group by coalesce(last_error,'unknown')) t),
    'timeseries', (select coalesce(jsonb_agg(jsonb_build_object('bucket', to_char(bucket,'YYYY-MM-DD'), 'sent', sent, 'failed', failed) order by bucket), '[]'::jsonb)
      from (select date_trunc('day', created_at) bucket,
        count(*) filter (where status in ('sent','delivered','read') or (channel = 'in_app' and status <> 'failed')) sent,
        count(*) filter (where status='failed') failed
        from public.notifications where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to) group by 1) t)
  );
end; $function$;

do $$
declare
  v_result jsonb;
  v_in_app jsonb;
  v_pct numeric;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a8150422-1239-4a78-91aa-3e8ffebab19a","role":"authenticated"}';
  v_result := public.analytics_deliverability();
  reset role;
  select c into v_in_app from jsonb_array_elements(v_result -> 'by_channel') c where c ->> 'channel' = 'in_app';
  if v_in_app is null then
    raise notice 'No in_app rows in notifications yet; skipping the success-rate proof.';
  else
    v_pct := (v_in_app ->> 'success_pct')::numeric;
    if v_pct < 95 then
      raise exception 'in_app success_pct should be near 100%% (it has never failed once), got %', v_pct;
    end if;
  end if;
end $$;
