-- Tarragon Health — fix the Analytics Console's Engagement panel (2026-08-20)
--
-- Two real problems found while building an investor-facing retention view
-- from live data:
--
-- 1. analytics_engagement_summary / analytics_active_users_timeseries /
--    analytics_retention_cohorts (20260717193112_analytics_console_phase2_rpcs.sql)
--    all define "active"/"retained" as "produced a public.web_events row" —
--    a marketing-site pageview/session ping. For a chronic-disease-management
--    product, that measures whether someone loaded a page while signed in,
--    not whether a patient did the thing that actually matters: logged a
--    vital, responded to an adherence check-in, sent a care message, etc.
--    A patient could browse without ever managing their condition and still
--    count as "retained." Redefine these three functions on top of a new
--    private.patient_engagement_events() — a union of the real behavioural
--    signals the product already captures (vitals, symptoms, medication
--    adherence responses, wellness points, patient-authored care messages,
--    health-education views, activity-log entries, lifestyle-programme
--    measurements, attended video visits).
--
-- 2. None of the four Engagement functions exclude the @tarragon.test QA
--    seed accounts (see project_qa_test_accounts_20260727 — 23 accounts,
--    9 of them role='patient', all created in the same 2026-07-29 seed
--    batch). Right now every non-seed "patient" profile has zero logged
--    activity of any kind — the platform has not opened to real patients
--    yet — so any non-zero number these functions currently return is QA
--    testing noise, not a real user. Add private.real_patient_ids() and
--    join through it everywhere so this panel can only ever report genuine
--    patients, whether that's 0 today or 5,000 later.
--
-- Also fixes a live bug in analytics_feature_adoption(): it references
-- public.lifestyle_programme_enrolments, which does not exist (the table is
-- lpe_enrollments) — every call to this function has been throwing
-- "relation does not exist" since the phase-2 migration shipped, silently
-- breaking the Feature adoption panel.
--
-- Same signatures as before (create or replace), so no grant/revoke needed —
-- the authenticated-only EXECUTE grants from the phase-2 migration's DO
-- block still apply.

-- ---------------------------------------------------------------------------
-- private.real_patient_ids() — patient-role profiles minus the QA seed
-- ---------------------------------------------------------------------------
create or replace function private.real_patient_ids()
returns table(patient_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'patient'
    and u.email !~~* '%tarragon.test%';
$$;

-- ---------------------------------------------------------------------------
-- private.patient_engagement_events() — genuine chronic-disease-management
-- actions, not pageviews. Add a new UNION branch here when a new logging
-- surface ships; every Engagement panel function reads through this one
-- place.
-- ---------------------------------------------------------------------------
create or replace function private.patient_engagement_events()
returns table(patient_id uuid, occurred_at timestamptz, channel text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.patient_id, v.taken_at, 'vitals'::text
  from public.vitals_readings v
  union all
  select s.patient_id, s.reported_at, 'symptom'::text
  from public.symptoms s
  union all
  select m.patient_id, m.responded_at, 'medication_adherence'::text
  from public.medication_adherence_checkins m
  where m.responded_at is not null
  union all
  select w.patient_id, w.created_at, 'wellness_points'::text
  from public.wellness_points_ledger w
  union all
  select cm.patient_id, cm.created_at, 'care_message'::text
  from public.care_messages cm
  where cm.author_profile_id = cm.patient_id
  union all
  select h.patient_id, h.last_viewed_at, 'health_education'::text
  from public.health_education_progress h
  where h.last_viewed_at is not null
  union all
  select a.patient_id, a.logged_at, 'activity_log'::text
  from public.activity_log_entries a
  union all
  select l.patient_id, l.taken_at, 'lifestyle_measurement'::text
  from public.lpe_measurements l
  union all
  select vc.patient_id, vc.started_at, 'video_visit'::text
  from public.video_consultations vc
  where vc.started_at is not null;
$$;

-- ---------------------------------------------------------------------------
-- Engagement summary — DAU/WAU/MAU/stickiness from real engagement events
-- ---------------------------------------------------------------------------
create or replace function public.analytics_engagement_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_dau bigint; v_wau bigint; v_mau bigint;
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  select count(distinct e.patient_id) into v_dau
    from private.patient_engagement_events() e
    join private.real_patient_ids() rp on rp.patient_id = e.patient_id
    where e.occurred_at >= now() - interval '1 day';
  select count(distinct e.patient_id) into v_wau
    from private.patient_engagement_events() e
    join private.real_patient_ids() rp on rp.patient_id = e.patient_id
    where e.occurred_at >= now() - interval '7 days';
  select count(distinct e.patient_id) into v_mau
    from private.patient_engagement_events() e
    join private.real_patient_ids() rp on rp.patient_id = e.patient_id
    where e.occurred_at >= now() - interval '30 days';
  return jsonb_build_object(
    'dau', v_dau, 'wau', v_wau, 'mau', v_mau,
    'stickiness', case when v_mau = 0 then 0 else round(100.0 * v_dau / v_mau, 1) end
  );
end; $$;

-- ---------------------------------------------------------------------------
-- Active users over time — same event source, bucketed
-- ---------------------------------------------------------------------------
create or replace function public.analytics_active_users_timeseries(p_period text default 'day')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_period text := case when p_period in ('day','week','month') then p_period else 'day' end;
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('bucket', to_char(bucket,'YYYY-MM-DD'), 'active_users', au) order by bucket)
    from (
      select date_trunc(v_period, e.occurred_at) bucket, count(distinct e.patient_id) au
      from private.patient_engagement_events() e
      join private.real_patient_ids() rp on rp.patient_id = e.patient_id
      group by 1
    ) t
  ), '[]'::jsonb);
end; $$;

-- ---------------------------------------------------------------------------
-- Retention cohorts — weekly signup cohorts; "retained" = at least one real
-- engagement event in that following week, not a pageview
-- ---------------------------------------------------------------------------
create or replace function public.analytics_retention_cohorts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(row order by (row->>'cohort_week'))
    from (
      select jsonb_build_object(
        'cohort_week', to_char(c.cohort_week,'YYYY-MM-DD'),
        'cohort_size', c.cohort_size,
        'offsets', (
          select coalesce(jsonb_agg(jsonb_build_object('week_offset', o.k, 'retained', (
            select count(distinct e.patient_id)
            from private.patient_engagement_events() e
            where e.patient_id = any(c.members)
              and e.occurred_at >= c.cohort_week + (o.k || ' weeks')::interval
              and e.occurred_at <  c.cohort_week + ((o.k + 1) || ' weeks')::interval
          )) order by o.k), '[]'::jsonb)
          from generate_series(0,3) as o(k)
        )
      ) row
      from (
        select date_trunc('week', p.created_at) cohort_week, count(*) cohort_size, array_agg(p.id) members
        from public.profiles p
        join private.real_patient_ids() rp on rp.patient_id = p.id
        where p.created_at >= now() - interval '8 weeks'
        group by 1
      ) c
    ) rows
  ), '[]'::jsonb);
end; $$;

-- ---------------------------------------------------------------------------
-- Feature adoption — fixes the lifestyle_programme_enrolments -> lpe_enrollments
-- typo (was a hard SQL error on every call) and scopes every count to real,
-- non-seed patients
-- ---------------------------------------------------------------------------
create or replace function public.analytics_feature_adoption()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return jsonb_build_array(
    jsonb_build_object('feature','Vitals logging','patients',
      (select count(distinct v.patient_id) from public.vitals_readings v
       join private.real_patient_ids() rp on rp.patient_id = v.patient_id)),
    jsonb_build_object('feature','AI health coach','patients',
      (select count(distinct a.profile_id) from public.ai_conversations a
       join private.real_patient_ids() rp on rp.patient_id = a.profile_id)),
    jsonb_build_object('feature','Care plans','patients',
      (select count(distinct c.patient_id) from public.care_plans c
       join private.real_patient_ids() rp on rp.patient_id = c.patient_id)),
    jsonb_build_object('feature','Medications','patients',
      (select count(distinct m.patient_id) from public.medications m
       join private.real_patient_ids() rp on rp.patient_id = m.patient_id)),
    jsonb_build_object('feature','Vaccinations','patients',
      (select count(distinct vr.profile_id) from public.vaccination_records vr
       join private.real_patient_ids() rp on rp.patient_id = vr.profile_id)),
    jsonb_build_object('feature','Screenings','patients',
      (select count(distinct s.patient_id) from public.screening_schedules s
       join private.real_patient_ids() rp on rp.patient_id = s.patient_id)),
    jsonb_build_object('feature','Lifestyle coaching','patients',
      (select count(distinct l.patient_id) from public.lpe_enrollments l
       join private.real_patient_ids() rp on rp.patient_id = l.patient_id)),
    jsonb_build_object('feature','Preventive programmes','patients',
      (select count(distinct pp.patient_id) from public.preventive_programme_enrolments pp
       join private.real_patient_ids() rp on rp.patient_id = pp.patient_id))
  );
end; $$;

-- ---------------------------------------------------------------------------
-- Prove it, don't hope it
-- ---------------------------------------------------------------------------
do $$
declare
  v_test_leak int;
begin
  -- real_patient_ids() must never surface a @tarragon.test QA seed account
  select count(*) into v_test_leak
  from private.real_patient_ids() rp
  join auth.users u on u.id = rp.patient_id
  where u.email ilike '%tarragon.test%';
  if v_test_leak <> 0 then
    raise exception 'private.real_patient_ids() leaks % QA test account(s) — exclusion filter is broken', v_test_leak;
  end if;

  -- the table analytics_feature_adoption() now points at must actually exist
  if to_regclass('public.lpe_enrollments') is null then
    raise exception 'public.lpe_enrollments not found — analytics_feature_adoption would fail at runtime';
  end if;

  -- sabotage check: an intentionally-wrong filter (email is NOT NULL, i.e.
  -- "any user") must NOT match real_patient_ids()'s actual definition —
  -- confirms the exclusion clause is doing real work, not vacuously true.
  -- Needs a real discriminating case to mean anything: on a from-scratch
  -- replay there are no patient profiles at all (seed.sql inserts only
  -- reference/lookup data), so both counts below were trivially 0 = 0,
  -- passing vacuously — the opposite of what this check is for (found by
  -- the new CI migration-replay job, 2026-08-27). Creates one real and one
  -- @tarragon.test patient to force an actual comparison, then cleans up.
  declare
    v_real_id uuid := gen_random_uuid();
    v_qa_id uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values
      (v_real_id, 'real-patient-check@example.invalid', 'x', now(), '{}', '{}'),
      (v_qa_id, 'qa-patient-check@tarragon.test', 'x', now(), '{}', '{}');

    if (select count(*) from private.real_patient_ids() where patient_id in (v_real_id, v_qa_id)) <> 1 then
      raise exception 'private.real_patient_ids() did not exclude the @tarragon.test account as expected';
    end if;

    delete from auth.users where id in (v_real_id, v_qa_id);
  end;
end $$;
