-- Tarragon Health — Analytics Console: user segmentation + facility engagement.
-- Same rules: security definer, search_path='', gated by private.is_analyst(),
-- return jsonb, authenticated-only.

-- Users tab: active vs dormant/past, and users per category / condition / state.
-- "last active" = most recent of a page visit, a vitals log, or an AI-coach chat.
create or replace function public.analytics_user_segments()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'activity', (
      with activity as (
        select p.id,
          greatest(
            (select max(occurred_at) from public.web_events w where w.profile_id = p.id),
            (select max(created_at) from public.vitals_readings v where v.patient_id = p.id),
            (select max(updated_at) from public.ai_conversations a where a.profile_id = p.id)
          ) last_active
        from public.profiles p where p.role = 'patient'
      )
      select jsonb_build_object(
        'total', count(*),
        'active_30d', count(*) filter (where last_active >= now() - interval '30 days'),
        'active_90d', count(*) filter (where last_active >= now() - interval '90 days'),
        'dormant_30d', count(*) filter (where last_active is null or last_active < now() - interval '30 days'),
        'dormant_90d', count(*) filter (where last_active is null or last_active < now() - interval '90 days'),
        'never_active', count(*) filter (where last_active is null)
      ) from activity
    ),
    'churned', (
      select count(*) from (
        select subscriber_id from public.subscriptions where status = 'cancelled'
        except
        select subscriber_id from public.subscriptions where status in ('active','trialing')
      ) x
    ),
    'by_plan', (select coalesce(jsonb_agg(jsonb_build_object('plan', plan, 'users', users) order by users desc), '[]'::jsonb)
      from (select pl.name plan, count(distinct s.subscriber_id) users
            from public.subscriptions s join public.subscription_plans pl on pl.id = s.plan_id
            where s.status in ('active','trialing') group by pl.name) t),
    'by_care_category', jsonb_build_array(
      jsonb_build_object('category','Chronic disease','users', (select count(distinct patient_id) from public.care_plans where status='active')),
      jsonb_build_object('category','Preventive','users', (select count(distinct patient_id) from public.preventive_programme_enrolments)),
      jsonb_build_object('category','Lifestyle','users', (select count(distinct patient_id) from public.lifestyle_programme_enrolments)),
      jsonb_build_object('category','Care coordination','users', (
        select count(distinct pid) from (
          select patient_id pid from public.lab_orders
          union select patient_id from public.pharmacy_orders
          union select patient_id from public.specialist_referrals
        ) c))
    ),
    'by_role', (select coalesce(jsonb_agg(jsonb_build_object('role', role, 'users', c) order by c desc), '[]'::jsonb)
      from (select role::text role, count(*) c from public.profiles group by role) t),
    'by_condition', (select coalesce(jsonb_agg(jsonb_build_object('condition', condition, 'users', c) order by c desc), '[]'::jsonb)
      from (select condition::text condition, count(distinct patient_id) c from public.care_plans where status='active' group by condition) t),
    'by_state', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'users', c) order by c desc), '[]'::jsonb)
      from (select coalesce(state,'Unknown') state, count(*) c from public.profiles where role='patient' group by coalesce(state,'Unknown')) t)
  );
end; $$;

-- Facilities tab: engagement per facility (bookings + lab orders), users per
-- facility, and facility mix by type/state.
create or replace function public.analytics_facility_engagement()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'total_facilities', (select count(*) from public.facilities),
    'active_facilities', (select count(*) from public.facilities where is_active),
    'total_bookings', (select count(*) from public.booking_requests),
    'facilities_with_usage', (
      select count(distinct facility_id) from (
        select facility_id from public.booking_requests where facility_id is not null
        union select facility_id from public.lab_orders where facility_id is not null
      ) u
    ),
    'by_facility', (
      with usage as (
        select facility_id, profile_id user_id from public.booking_requests where facility_id is not null
        union all
        select facility_id, patient_id from public.lab_orders where facility_id is not null
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'facility', name, 'type', type, 'state', state,
        'users', users, 'interactions', interactions) order by interactions desc, users desc), '[]'::jsonb)
      from (
        select f.name, f.type::text type, coalesce(f.state,'Unknown') state,
               count(distinct u.user_id) users, count(u.user_id) interactions
        from public.facilities f
        left join usage u on u.facility_id = f.id
        group by f.id, f.name, f.type, f.state
      ) t
    ),
    'by_type', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'facilities', c) order by c desc), '[]'::jsonb)
      from (select type::text type, count(*) c from public.facilities group by type) t),
    'by_state', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'facilities', c) order by c desc), '[]'::jsonb)
      from (select coalesce(state,'Unknown') state, count(*) c from public.facilities group by coalesce(state,'Unknown')) t),
    'by_service', (select coalesce(jsonb_agg(jsonb_build_object('service_type', service_type, 'bookings', c) order by c desc), '[]'::jsonb)
      from (select service_type::text service_type, count(*) c from public.booking_requests group by service_type) t)
  );
end; $$;

do $$
declare fn text; fns text[] := array[
  'public.analytics_user_segments()',
  'public.analytics_facility_engagement()'
];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end; $$;
