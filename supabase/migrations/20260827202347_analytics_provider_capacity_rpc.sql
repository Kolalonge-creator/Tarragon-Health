-- Tarragon Health
-- Clinical Network build, Phase 1 item (docs/CLINICAL_NETWORK_SPEC.md §4.17
-- "Provider capacity management"), founder-approved to build. Same shape as
-- every other analytics_* RPC (20260717180931, 20260717193112): security
-- definer, search_path='', gated by private.is_analyst(), returns jsonb,
-- empty result (not an exception) for a non-analyst caller.
--
-- Deliberately internal/admin-facing analytics only -- never a patient-facing
-- recommendation or ranking. This stays inside the guardrail on the
-- referral-matching engine (CLAUDE.md, docs/CLINICAL_NETWORK_SPEC.md §3):
-- it counts and aggregates the existing specialist_providers catalogue and
-- specialist_referrals waitlist, it does not score or rank a provider for a
-- patient. useWaitlistedReferrals already computes a live per-referral match
-- count client-side (apps/web/src/lib/queries/specialist-referrals.ts) --
-- this is the aggregate, org-wide rollup of the same underlying facts for
-- ops, not a new capability layered on top of matching.

create or replace function public.analytics_provider_capacity()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;

  return jsonb_build_object(
    'by_specialty', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'specialist_type', p.specialist_type,
        'active_providers', p.active_providers,
        'total_providers', p.total_providers,
        'waitlisted_referrals', coalesce(w.waitlisted, 0),
        'avg_current_wait_hours', w.avg_current_wait_hours
      ) order by coalesce(w.waitlisted, 0) desc, p.specialist_type), '[]'::jsonb)
      from (
        select specialist_type,
               count(*) filter (where is_active) as active_providers,
               count(*) as total_providers
        from public.specialist_providers
        group by specialist_type
      ) p
      left join (
        select sr.specialist_type,
               count(*) filter (where sr.status = 'waitlisted') as waitlisted,
               round(avg(extract(epoch from (now() - sr.waitlisted_at)) / 3600)
                 filter (where sr.status = 'waitlisted'), 1) as avg_current_wait_hours
        from public.specialist_referrals sr
        group by sr.specialist_type
      ) w on w.specialist_type = p.specialist_type
    ),

    'by_specialty_state', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'specialist_type', specialist_type,
        'state', state,
        'active_providers', active_providers
      ) order by specialist_type, state), '[]'::jsonb)
      from (
        select specialist_type, coalesce(state, 'Unknown') as state,
               count(*) filter (where is_active) as active_providers
        from public.specialist_providers
        group by specialist_type, coalesce(state, 'Unknown')
      ) t
    ),

    'zero_active_provider_specialties', (
      select coalesce(jsonb_agg(specialist_type order by specialist_type), '[]'::jsonb)
      from (
        select specialist_type
        from public.specialist_providers
        group by specialist_type
        having count(*) filter (where is_active) = 0
      ) z
    ),

    'recent_booking_turnaround', (
      select jsonb_build_object(
        'window_days', 90,
        'booked_referrals', count(*),
        'avg_hours_to_booking', round(avg(extract(epoch from (booking_confirmed_at - created_at)) / 3600), 1)
      )
      from public.specialist_referrals
      where booking_confirmed_at is not null
        and created_at >= now() - interval '90 days'
    ),

    'video_slot_utilisation_next_7_days', (
      select jsonb_build_object(
        'total_slots', count(*),
        'booked_slots', count(*) filter (where booked_consultation_id is not null)
      )
      from public.consult_availability_slots
      where slot_start >= now() and slot_start < now() + interval '7 days'
    )
  );
end;
$$;

comment on function public.analytics_provider_capacity() is
  'Admin/ops rollup of specialist-network capacity: provider counts by specialty and state, specialties with zero active providers, current waitlist size + age per specialty, recent booking turnaround, and Tarragon''s own video-consult slot utilisation. Read-only aggregation, never a patient-facing match or ranking -- see docs/CLINICAL_NETWORK_SPEC.md §3/§4.17.';

revoke execute on function public.analytics_provider_capacity() from public, anon;
grant execute on function public.analytics_provider_capacity() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'analytics_provider_capacity'
  ) then
    raise exception 'analytics_provider_capacity missing after migration';
  end if;

  if has_function_privilege('anon', 'public.analytics_provider_capacity()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_provider_capacity';
  end if;

  raise notice 'PASS: analytics_provider_capacity present, anon denied';
end $$;
