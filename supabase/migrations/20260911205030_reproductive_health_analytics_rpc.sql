-- Superadmin-only, platform-wide aggregate analytics for reproductive-health data, so the
-- reproductive-health profile/menstrual-cycle-tracking information already being collected
-- can inform internal research and future product decisions.
--
-- reproductive_health is the platform's most-protected care_access_category (excluded even
-- from emergency break-glass access, see CLAUDE.md) and no research-use consent mechanism
-- exists anywhere in the schema today (menstrual_cycle_tracking.sql deliberately deferred
-- collecting the most sensitive field for exactly this reason). Given that, this RPC:
--   - returns AGGREGATE COUNTS/RATES ONLY, never a patient-identifying row — same shape as
--     public.health_education_analytics() and the payer board outcomes report;
--   - applies small-cell suppression (a flat floor of 10, matching organisations
--     .min_cohort_size's own default from the I9 aggregate-only work) so any figure derived
--     from fewer than 10 people renders null, not zero — a zero would read as "nobody", null
--     reads as "not enough people yet" (same convention as
--     20260902211636_payer_board_outcomes_report.sql);
--   - is superadmin-only (private.is_admin()), platform-wide, with no institution/payer access
--     path — extending this to institution/HMO dashboards is a separate, larger decision
--     (this data was never in scope for module 27's payer analytics) and is deliberately not
--     done here;
--   - relies on the general data_processing consent already collected at signup, per an
--     explicit founder call — a dedicated research-use consent flag was considered and
--     deferred, not overlooked.

create function public.reproductive_health_analytics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_floor constant integer := 10;
  v_profile_count integer;
  v_life_stage_breakdown jsonb;
  v_cycle_tracking_patients integer;
  v_total_cycles_logged integer;
  v_avg_cycle_length numeric;
  v_symptom_freq jsonb;
  v_mood_freq jsonb;
begin
  if not private.is_admin() then
    raise exception 'reproductive_health_analytics: admin only';
  end if;

  select count(*) into v_profile_count
  from public.reproductive_health_profiles;

  select jsonb_object_agg(life_stage, cnt) into v_life_stage_breakdown
  from (
    select life_stage, count(*) as cnt
    from public.reproductive_health_profiles
    group by life_stage
    having count(*) >= v_floor
  ) s;

  select count(distinct patient_id), count(*)
    into v_cycle_tracking_patients, v_total_cycles_logged
  from public.menstrual_cycles;

  select avg(average_cycle_length_days) into v_avg_cycle_length
  from public.reproductive_health_profiles
  where average_cycle_length_days is not null;

  select jsonb_object_agg(symptom, cnt) into v_symptom_freq
  from (
    select unnest(symptoms) as symptom, count(*) as cnt
    from public.menstrual_daily_logs
    group by symptom
    having count(*) >= v_floor
  ) s;

  select jsonb_object_agg(mood, cnt) into v_mood_freq
  from (
    select unnest(moods) as mood, count(*) as cnt
    from public.menstrual_daily_logs
    group by mood
    having count(*) >= v_floor
  ) s;

  return jsonb_build_object(
    'generated_at', now(),
    'min_cohort_size', v_floor,
    'reproductive_health_profiles', jsonb_build_object(
      'reportable', v_profile_count >= v_floor,
      'total', case when v_profile_count >= v_floor then v_profile_count else null end,
      'by_life_stage', coalesce(v_life_stage_breakdown, '{}'::jsonb)
    ),
    'menstrual_cycle_tracking', jsonb_build_object(
      'reportable', v_cycle_tracking_patients >= v_floor,
      'patients_tracking', case when v_cycle_tracking_patients >= v_floor then v_cycle_tracking_patients else null end,
      'total_cycles_logged', case when v_cycle_tracking_patients >= v_floor then v_total_cycles_logged else null end,
      'avg_cycle_length_days', case when v_cycle_tracking_patients >= v_floor then round(v_avg_cycle_length, 1) else null end
    ),
    'symptom_frequency', coalesce(v_symptom_freq, '{}'::jsonb),
    'mood_frequency', coalesce(v_mood_freq, '{}'::jsonb)
  );
end;
$$;

comment on function public.reproductive_health_analytics() is
  'Superadmin-only, platform-wide aggregate reproductive-health stats for internal research. '
  'Every figure is suppressed to null below a 10-person floor. Never returns a patient-'
  'identifying row. See migration header for the consent/scope decisions behind this.';

revoke all on function public.reproductive_health_analytics() from public, anon;
grant execute on function public.reproductive_health_analytics() to authenticated;

do $$
declare
  v_admin uuid;
  v_non_admin uuid;
  v_result jsonb;
  v_raised boolean;
begin
  if has_function_privilege('anon', 'public.reproductive_health_analytics()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute reproductive_health_analytics';
  end if;

  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select id into v_non_admin from public.profiles where role <> 'admin' limit 1;

  if v_admin is null or v_non_admin is null then
    raise notice 'SKIPPED behavioral proof: need at least one admin and one non-admin profile to test against';
    return;
  end if;

  v_raised := false;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_non_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.reproductive_health_analytics();
    reset role;
  exception when others then
    reset role;
    if sqlerrm = 'reproductive_health_analytics: admin only' then
      v_raised := true;
    else
      raise;
    end if;
  end;
  if not v_raised then
    raise exception 'FAIL: a non-admin caller was able to run reproductive_health_analytics';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_result := public.reproductive_health_analytics();
  reset role;

  if v_result is null or not (v_result ? 'reproductive_health_profiles') then
    raise exception 'FAIL: admin call did not return the expected aggregate shape';
  end if;
  if (v_result -> 'reproductive_health_profiles' ? 'patient_id')
     or (v_result -> 'menstrual_cycle_tracking' ? 'patient_id') then
    raise exception 'FAIL: aggregate result leaks a patient-identifying field';
  end if;

  raise notice 'PASS: reproductive_health_analytics is admin-gated and returns aggregate-only data';
end $$;
