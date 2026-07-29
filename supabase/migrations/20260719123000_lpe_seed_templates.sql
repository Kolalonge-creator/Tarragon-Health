-- ============================================================================
-- LPE Phase 3 — seed the three condition programme templates (idempotent).
-- Obesity is the full staged model (foundation → build → maintenance); HTN and
-- diabetes are single continuous phases. Content is honest starter copy — a
-- clinician reviews/expands the library later.
-- ============================================================================
do $$
declare
  v_prog uuid;
  v_phase uuid;
begin
  -- ---------------- OBESITY (staged) ----------------
  insert into public.lpe_programme_templates (condition, version, name, modules)
  values ('obesity', 1, 'Obesity Lifestyle Programme',
    '{"diet":{"enabled":true,"weight":1},"activity":{"enabled":true,"weight":1},"behaviour":{"enabled":true,"weight":1},"sleep":{"enabled":true,"weight":0.8},"stress":{"enabled":true,"weight":0.8}}'::jsonb)
  on conflict (condition, version) do update set name = excluded.name
  returning id into v_prog;

  insert into public.lpe_phase_templates (programme_template_id, order_index, key, name, kind, duration_days_min, duration_days_max, auto_advance)
  values
    (v_prog, 0, 'foundation', 'Foundation', 'foundation', 14, 28, false),
    (v_prog, 1, 'build', 'Build', 'build', 28, 56, false),
    (v_prog, 2, 'maintenance', 'Maintenance', 'maintenance', null, null, false)
  on conflict (programme_template_id, key) do nothing;

  select id into v_phase from public.lpe_phase_templates
    where programme_template_id = v_prog and key = 'foundation';
  insert into public.lpe_goal_templates (phase_template_id, module, key, title, description, metric_key, cadence, priority)
  values
    (v_phase, 'diet', 'balanced_plate', 'Build a balanced plate', 'Half your plate vegetables at your main meal.', 'food_log', 'daily', 1),
    (v_phase, 'activity', 'move_more', 'Move a little more', 'Aim for a short daily walk you can keep up.', 'activity_minutes', 'daily', 2),
    (v_phase, 'behaviour', 'weekly_weigh', 'Weekly check-in', 'Log your weight once a week, same day.', 'weight', 'weekly', 3)
  on conflict (phase_template_id, key) do nothing;

  -- ---------------- HYPERTENSION (continuous) ----------------
  insert into public.lpe_programme_templates (condition, version, name, modules)
  values ('hypertension', 1, 'Hypertension Lifestyle Programme',
    '{"diet":{"enabled":true,"weight":1},"activity":{"enabled":true,"weight":0.9},"behaviour":{"enabled":true,"weight":0.8}}'::jsonb)
  on conflict (condition, version) do update set name = excluded.name
  returning id into v_prog;

  insert into public.lpe_phase_templates (programme_template_id, order_index, key, name, kind, duration_days_min, duration_days_max, auto_advance)
  values (v_prog, 0, 'continuous', 'Ongoing', 'continuous', null, null, false)
  on conflict (programme_template_id, key) do nothing;

  select id into v_phase from public.lpe_phase_templates
    where programme_template_id = v_prog and key = 'continuous';
  insert into public.lpe_goal_templates (phase_template_id, module, key, title, description, metric_key, cadence, priority)
  values
    (v_phase, 'diet', 'reduce_salt', 'Ease off the salt', 'Cook with less added salt; skip the shaker at the table.', 'food_log', 'daily', 1),
    (v_phase, 'activity', 'move_more', 'Stay active', 'Regular gentle activity most days.', 'activity_minutes', 'daily', 2),
    (v_phase, 'behaviour', 'log_bp', 'Log your blood pressure', 'Record a home BP reading as your care team asks.', 'bp', 'daily', 3)
  on conflict (phase_template_id, key) do nothing;

  -- ---------------- DIABETES (continuous) ----------------
  insert into public.lpe_programme_templates (condition, version, name, modules)
  values ('diabetes', 1, 'Diabetes Lifestyle Programme',
    '{"diet":{"enabled":true,"weight":1},"activity":{"enabled":true,"weight":0.9},"behaviour":{"enabled":true,"weight":0.8}}'::jsonb)
  on conflict (condition, version) do update set name = excluded.name
  returning id into v_prog;

  insert into public.lpe_phase_templates (programme_template_id, order_index, key, name, kind, duration_days_min, duration_days_max, auto_advance)
  values (v_prog, 0, 'continuous', 'Ongoing', 'continuous', null, null, false)
  on conflict (programme_template_id, key) do nothing;

  select id into v_phase from public.lpe_phase_templates
    where programme_template_id = v_prog and key = 'continuous';
  insert into public.lpe_goal_templates (phase_template_id, module, key, title, description, metric_key, cadence, priority)
  values
    (v_phase, 'diet', 'carb_awareness', 'Know your carbs', 'Notice portion sizes of rice, bread and starchy foods.', 'food_log', 'daily', 1),
    (v_phase, 'activity', 'move_more', 'Stay active', 'Regular gentle activity helps your glucose.', 'activity_minutes', 'daily', 2),
    (v_phase, 'behaviour', 'log_glucose', 'Log your glucose', 'Record readings as your care team asks.', 'glucose', 'daily', 3)
  on conflict (phase_template_id, key) do nothing;
end $$;
