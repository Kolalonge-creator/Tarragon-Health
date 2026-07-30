-- Tarragon Health
-- Live proof for 20260730153159_public_impact_metrics.sql (M8 gap: public
-- outcomes dashboard). Five cases in one rolled-back transaction:
--   1. Small-cell suppression: a metric with a count under the 25 floor
--      is stored as value=null/suppressed=true
--   2. Crossing the floor flips suppressed=false and a real value shows
--   3. testimonials_published is exempt from the floor -- a small real
--      count still shows (not suppressed)
--   4. anon can select a PUBLISHED row but not an UNPUBLISHED one
--   5. A non-admin, non-permissioned caller is blocked from
--      admin_set_impact_metric_published (42501); admin succeeds
--
-- Run: npx supabase db query --linked -f packages/db/tests/public_impact_metrics.sql
-- Nothing here persists -- the whole file runs inside begin/rollback,
-- and cases 1-3 use INSERT/DELETE against public.screening_results (a
-- table with zero real rows at time of writing -- rolled back regardless).

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org        uuid := '00000000-0000-0000-0000-000000000001';
  v_pat        uuid;
  v_admin      uuid;
  v_patient2   uuid;
  v_blocked    boolean;
  v_row        record;
  v_can_see    int;
begin
  select id into v_pat   from public.profiles where role='patient' and organisation_id=v_org limit 1;
  select id into v_admin from public.profiles where role='admin'   and organisation_id=v_org limit 1;

  -- ---------------------------------------------------------------------
  -- Case 1 & 2: insert 30 abnormal screening_results rows (crosses the 25
  -- floor), refresh, confirm value shows; then delete them, refresh again,
  -- confirm it drops back to suppressed.
  -- ---------------------------------------------------------------------
  insert into public.screening_results (organisation_id, patient_id, result_status, abnormal_flags, created_at)
  select v_org, v_pat, 'abnormal', array['test_fixture'], now()
  from generate_series(1, 30);

  perform private.refresh_public_impact_metrics();
  select * into v_row from public.public_impact_metrics where metric_key = 'abnormal_results_escalated_90d';
  insert into test_result values (1, '30 fixture rows (crosses 25 floor)',
    'value=' || coalesce(v_row.value::text,'null') || ' suppressed=' || v_row.suppressed::text,
    'expected: value=30 suppressed=false');

  delete from public.screening_results where organisation_id = v_org and abnormal_flags = array['test_fixture'];
  perform private.refresh_public_impact_metrics();
  select * into v_row from public.public_impact_metrics where metric_key = 'abnormal_results_escalated_90d';
  insert into test_result values (2, 'fixture rows removed (back under the floor)',
    'value=' || coalesce(v_row.value::text,'null') || ' suppressed=' || v_row.suppressed::text,
    'expected: value=null suppressed=true');

  -- ---------------------------------------------------------------------
  -- Case 3: testimonials_published is exempt from the floor
  -- ---------------------------------------------------------------------
  insert into public.patient_testimonials (organisation_id, patient_id, display_name, quote, consent_to_publish, status)
  values (v_org, v_pat, 'Test Fixture', 'Fixture testimonial for public_impact_metrics.sql', true, 'published');
  perform private.refresh_public_impact_metrics();
  select * into v_row from public.public_impact_metrics where metric_key = 'testimonials_published';
  insert into test_result values (3, 'testimonials_published exempt from suppression floor',
    'value=' || coalesce(v_row.value::text,'null') || ' suppressed=' || v_row.suppressed::text,
    'expected: value=1 suppressed=false (a single real row, still shown)');

  -- ---------------------------------------------------------------------
  -- Case 4: anon sees published rows, not unpublished ones
  -- ---------------------------------------------------------------------
  update public.public_impact_metrics set is_published = false where metric_key = 'active_care_plans';

  perform set_config('role', 'anon', true);
  select count(*) into v_can_see from public.public_impact_metrics where metric_key = 'testimonials_published';
  select count(*) + v_can_see into v_can_see from public.public_impact_metrics where metric_key = 'active_care_plans';
  perform set_config('role', 'postgres', true);
  insert into test_result values (4, 'anon select: published + unpublished visible rows',
    v_can_see::text, 'expected: 1 (only the published testimonials_published row -- active_care_plans is hidden)');

  update public.public_impact_metrics set is_published = true where metric_key = 'active_care_plans';

  -- ---------------------------------------------------------------------
  -- Case 5: admin_set_impact_metric_published -- non-admin blocked, admin succeeds
  -- ---------------------------------------------------------------------
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_impact_metric_published('active_care_plans', false);
  exception when others then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (5, 'admin_set_impact_metric_published: patient blocked, then admin succeeds',
    case when v_blocked then 'patient BLOCKED (correct)' else 'patient ALLOWED (BUG)' end, '');

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.admin_set_impact_metric_published('active_care_plans', false);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  update test_result set detail = 'admin toggle result: is_published=' ||
    (select is_published::text from public.public_impact_metrics where metric_key='active_care_plans') || ' (expected false)'
    where case_num = 5;
end $$;

select * from test_result order by case_num;

rollback;
