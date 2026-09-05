create or replace function private.enrol_and_seed_care_plan_actions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_programme public.chronic_condition_programmes%rowtype;
  v_source    public.chronic_enrolment_source;
  v_goal      jsonb;
  v_task      jsonb;
begin
  select * into v_programme
  from public.chronic_condition_programmes
  where condition = new.condition and is_active;

  if v_programme.id is null then
    return new;
  end if;

  v_source := case
    when exists (select 1 from public.care_plan_recommendations r where r.care_plan_id = new.id)
    then 'recommended'::public.chronic_enrolment_source
    else 'clinician'::public.chronic_enrolment_source
  end;

  insert into public.chronic_programme_enrolments
    (organisation_id, patient_id, programme_id, care_plan_id, source)
  values
    (new.organisation_id, new.patient_id, v_programme.id, new.id, v_source)
  on conflict (patient_id, programme_id) where status = 'enrolled'
  do update set care_plan_id = coalesce(chronic_programme_enrolments.care_plan_id, excluded.care_plan_id);

  if not exists (
    select 1 from public.care_plan_goals where care_plan_id = new.id and source = 'protocol'
  ) then
    for v_goal in select * from jsonb_array_elements(v_programme.default_goals)
    loop
      insert into public.care_plan_goals
        (organisation_id, patient_id, care_plan_id, description, metric,
         target_value, target_unit, target_date, status, source)
      values (
        new.organisation_id, new.patient_id, new.id,
        v_goal->>'description',
        v_goal->>'metric',
        (v_goal->>'target_value')::numeric,
        v_goal->>'target_unit',
        case when v_goal->>'target_date_days' is not null
          then current_date + ((v_goal->>'target_date_days')::integer || ' days')::interval
          else null end,
        'open',
        'protocol'
      );
    end loop;
  end if;

  if not exists (
    select 1 from public.care_tasks where care_plan_id = new.id and source = 'programme_template'
  ) then
    for v_task in select * from jsonb_array_elements(v_programme.default_tasks)
    loop
      insert into public.care_tasks
        (organisation_id, patient_id, care_plan_id, title, description,
         owner_role, priority, due_at, recurrence, source)
      values (
        new.organisation_id, new.patient_id, new.id,
        v_task->>'title',
        v_task->>'description',
        coalesce((v_task->>'owner_role')::public.care_task_owner_role, 'patient'),
        coalesce((v_task->>'priority')::smallint, 2),
        now() + (coalesce((v_task->>'due_offset_days')::integer, 7) || ' days')::interval,
        v_task->>'recurrence',
        'programme_template'
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists care_plans_enrol_and_seed_programme_actions on public.care_plans;
create trigger care_plans_enrol_and_seed_programme_actions
  after insert or update of status on public.care_plans
  for each row when (new.status = 'active')
  execute function private.enrol_and_seed_care_plan_actions();

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'enrol_and_seed_care_plan_actions'
      and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'FAIL: private.enrol_and_seed_care_plan_actions() was not created';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'care_plans_enrol_and_seed_programme_actions'
      and tgrelid = 'public.care_plans'::regclass
      and not tgisinternal
  ) then
    raise exception 'FAIL: care_plans_enrol_and_seed_programme_actions trigger was not created';
  end if;

  raise notice 'PASS: enrolment + programme-action seeding is wired to care_plans activation';
end $$;
