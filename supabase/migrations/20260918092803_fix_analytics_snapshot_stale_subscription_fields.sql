-- Tarragon Health
-- Fixes a real bug introduced in this same session's prior migration
-- (20260918091524_analytics_warehouse_snapshot_layer.sql), caught by
-- /code-review high before the PR was opened -- not a pre-existing issue.
--
-- private.refresh_analytics_snapshot_business_summary() was written by
-- copying public.analytics_business_summary()'s body from the ORIGINAL
-- 2026-07-17 migration (20260717180931_analytics_console_rpcs.sql), which
-- returned 'total_subscriptions'/'active_subscriptions' from
-- public.subscriptions. That table and the whole subscription-plan model
-- were retired 2026-09-02 (CLAUDE.md's "second, bigger pivot"), and
-- analytics_business_summary() was already rewritten in
-- 20260905060409_analytics_read_surface_off_retired_subscriptions.sql to
-- return 'paid_purchases'/'paying_patients' (from service_purchases/
-- programme_purchases) instead. This migration's own header comment
-- claimed the copy was "Identical aggregation logic to the original live
-- ... body" -- it was identical to the ORIGINAL, not the LIVE, body. Exactly
-- the mistake CLAUDE.md warns about by name: "a migration file's committed
-- body is not proof of what a live function does -- check pg_get_functiondef
-- before building on top of an RPC." The live body was checked here via
-- direct grep across every migration that ever redefined this function
-- (20260717180931, 20260905060409, and this session's own 20260918091524),
-- confirming 20260905060409 is the most recent correct shape.
--
-- Blast radius: this had already gone live (20260918091524 was applied to
-- production before this fix), so any of the dashboards reading
-- paid_purchases/paying_patients from analytics_business_summary() --
-- business-dashboard.tsx, financial-dashboard.tsx, investor-dashboard.tsx,
-- users-dashboard.tsx, admin/page.tsx -- would have silently rendered 0 for
-- those fields (Zod schemas default a missing numeric field to 0, not an
-- error) rather than failing loudly. Caught same-day, before merge.

create or replace function private.refresh_analytics_snapshot_business_summary()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  select jsonb_build_object(
    'total_orgs', (select count(*) from public.organisations),
    'active_orgs', (select count(*) from public.organisations where is_active),
    'total_profiles', (select count(*) from public.profiles),
    'total_patients', (select count(*) from public.profiles where role = 'patient'),
    'active_patients', (select count(*) from public.profiles where role = 'patient' and is_active),
    'onboarded_patients', (select count(*) from public.profiles where role = 'patient' and onboarding_completed_at is not null),
    'paid_purchases', (
      select count(*) from public.service_purchases where status in ('active','expired')
    ) + (
      select count(*) from public.programme_purchases where status in ('active','completed','expired')
    ),
    'paying_patients', (
      select count(*) from (
        select patient_id from public.service_purchases where status in ('active','expired')
        union
        select patient_id from public.programme_purchases where status in ('active','completed','expired')
      ) t
    ),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('role', role, 'count', c) order by c desc), '[]'::jsonb)
              from (select role::text as role, count(*) c from public.profiles group by role) t),
    'org_types', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'count', c) order by c desc), '[]'::jsonb)
                  from (select type::text as type, count(*) c from public.organisations group by type) t),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'count', c) order by c desc), '[]'::jsonb)
               from (select coalesce(state, 'Unknown') as state, count(*) c from public.profiles where role = 'patient' group by coalesce(state, 'Unknown')) t)
  ) into v_payload;

  insert into analytics.rpc_snapshots (rpc_name, payload, computed_at)
  values ('analytics_business_summary', v_payload, now())
  on conflict (rpc_name) do update set
    payload = excluded.payload,
    computed_at = excluded.computed_at;
end;
$$;

-- Re-populate immediately with the corrected shape rather than waiting for
-- tonight's cron tick -- the stale-shaped snapshot from 20260918091524 was
-- already live and must not linger even a few hours.
select private.refresh_analytics_snapshot_business_summary();

do $$
declare
  v_payload jsonb;
begin
  select payload into v_payload from analytics.rpc_snapshots where rpc_name = 'analytics_business_summary';

  if v_payload is null then
    raise exception 'analytics_business_summary snapshot missing after refresh';
  end if;
  if v_payload ? 'total_subscriptions' or v_payload ? 'active_subscriptions' then
    raise exception 'analytics_business_summary snapshot still carries retired subscription fields';
  end if;
  if not (v_payload ? 'paid_purchases' and v_payload ? 'paying_patients') then
    raise exception 'analytics_business_summary snapshot missing paid_purchases/paying_patients';
  end if;

  raise notice 'PASS: analytics_business_summary snapshot corrected to the live paid_purchases/paying_patients shape';
end $$;
