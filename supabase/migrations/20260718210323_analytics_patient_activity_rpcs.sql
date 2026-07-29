-- Tarragon Health — Analytics Console: patient activity (forensic / legal).
-- Lets an analyst search a specific patient and see their login sessions +
-- engagement record — e.g. to demonstrate, in a dispute, whether a patient was
-- engaging with the platform. This is deliberately IDENTIFIED (you are looking
-- up one named patient), unlike the aggregate/de-identified surfaces. Access to
-- a patient dossier is itself audited (analytics_log_patient_access).
-- All gated by private.is_analyst(); security definer.

-- Patient lookup by number / name / phone.
create or replace function public.analytics_patient_search(p_query text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  if p_query is null or length(trim(p_query)) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'patient_id', p.id, 'patient_number', p.patient_number, 'name', p.full_name,
      'phone', p.phone, 'org', o.name, 'created_at', p.created_at) order by p.created_at desc)
    from (
      select * from public.profiles
      where role='patient' and (
        patient_number ilike '%'||p_query||'%' or full_name ilike '%'||p_query||'%' or phone ilike '%'||p_query||'%')
      limit 25
    ) p
    left join public.organisations o on o.id = p.organisation_id
  ), '[]'::jsonb);
end; $$;

-- Full activity dossier for one patient: login sessions (from web_events, 30-min
-- idle gap) + an engagement summary + a merged activity timeline.
create or replace function public.analytics_patient_activity(p_patient_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return (
    with pw as (
      select occurred_at,
        case when lag(occurred_at) over (order by occurred_at) is null
               or occurred_at - lag(occurred_at) over (order by occurred_at) > interval '30 minutes'
             then 1 else 0 end ns
      from public.web_events where profile_id = p_patient_id
    ),
    pwn as (select occurred_at, sum(ns) over (order by occurred_at rows unbounded preceding) sn from pw),
    sessions as (select sn, min(occurred_at) started, max(occurred_at) ended, count(*) pv from pwn group by sn),
    acts as (
      select occurred_at ts, event_type::text kind, coalesce(title, summary, event_type::text) label, 'timeline' src
        from public.patient_timeline where patient_id = p_patient_id
      union all
      select created_at, 'vital_'||vital_type::text, 'Logged '||vital_type::text||' reading', 'vitals'
        from public.vitals_readings where patient_id = p_patient_id
      union all
      select updated_at, 'ai_coach', 'AI health coach conversation', 'ai_coach'
        from public.ai_conversations where profile_id = p_patient_id
      union all
      select accepted_at, 'consent', 'Accepted '||consent_type::text||' consent', 'consent'
        from public.patient_consents where patient_id = p_patient_id
      union all
      select created_at, action, coalesce(entity_type, action), 'audit'
        from public.audit_log where actor_id = p_patient_id
    )
    select jsonb_build_object(
      'patient', (select jsonb_build_object(
         'patient_number', patient_number, 'name', full_name, 'phone', phone,
         'created_at', created_at, 'onboarding_completed_at', onboarding_completed_at)
         from public.profiles where id = p_patient_id),
      'engagement', jsonb_build_object(
         'total_login_sessions', (select count(*) from sessions),
         'total_activity_events', (select count(*) from acts),
         'first_activity', (select min(ts) from acts),
         'last_activity', (select max(ts) from acts),
         'active_days', (select count(distinct date_trunc('day', ts)) from acts),
         'days_since_last', (select case when max(ts) is null then null
             else round(extract(epoch from (now()-max(ts)))/86400.0)::int end from acts)
      ),
      'login_sessions', (select coalesce(jsonb_agg(jsonb_build_object(
         'started', started, 'ended', ended,
         'duration_min', round(extract(epoch from (ended-started))/60.0)::int, 'pageviews', pv) order by started desc), '[]'::jsonb) from sessions),
      'activity', (select coalesce(jsonb_agg(jsonb_build_object(
         'occurred_at', ts, 'type', kind, 'label', label, 'source', src) order by ts desc), '[]'::jsonb)
         from (select * from acts order by ts desc limit 300) x)
    )
  );
end; $$;

-- Audit the access itself (forensic hygiene). VOLATILE — writes an audit_log row.
create or replace function public.analytics_log_patient_access(p_patient_id uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_analyst() then raise exception 'not authorised'; end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  select (select organisation_id from public.profiles where id = p_patient_id),
         (select auth.uid()), 'analyst.patient_activity_viewed', 'patient', p_patient_id,
         jsonb_build_object('reason', coalesce(p_reason, ''));
end; $$;

do $$
declare fn text; fns text[] := array[
  'public.analytics_patient_search(text)',
  'public.analytics_patient_activity(uuid)',
  'public.analytics_log_patient_access(uuid, text)'
];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end; $$;
