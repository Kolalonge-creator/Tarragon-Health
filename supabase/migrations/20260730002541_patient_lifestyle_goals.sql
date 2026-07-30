-- Patient-authored LPE goals -- the "Goals" screen (pick a focus area, set a
-- goal, review past goals). lpe_goal_instances write RLS
-- (lpe_goal_instances_write, 20260719120001) is staff-only by design --
-- template/doctor-authored rows -- so a patient cannot INSERT/UPDATE their own
-- goal directly. These two SECURITY DEFINER RPCs open a narrow,
-- ownership-checked path for a patient to add/resolve their OWN personalised
-- goals (personalised = true) without widening that RLS policy at all.
-- Mirrors set_lab_order_facility's shape (20260724020744).

create or replace function public.create_personalised_lifestyle_goal(
  p_enrollment_id uuid,
  p_module public.lpe_module,
  p_title text,
  p_target_value numeric default null,
  p_target_unit text default null,
  p_target_date date default null
)
returns public.lpe_goal_instances
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_enrollment public.lpe_enrollments%rowtype;
  v_instance   public.lpe_programme_instances%rowtype;
  v_title      text;
  v_target     jsonb;
  v_goal       public.lpe_goal_instances%rowtype;
begin
  select * into v_enrollment from public.lpe_enrollments where id = p_enrollment_id;
  if v_enrollment.id is null then
    raise exception 'Programme not found' using errcode = '42501';
  end if;
  if v_enrollment.patient_id is distinct from (select auth.uid()) then
    raise exception 'Not authorised for this programme' using errcode = '42501';
  end if;
  if v_enrollment.status <> 'active' then
    raise exception 'This programme is not active' using errcode = '23514';
  end if;

  v_title := trim(p_title);
  if v_title is null or v_title = '' then
    raise exception 'Please describe your goal' using errcode = '23514';
  end if;
  if length(v_title) > 200 then
    raise exception 'Goal is too long' using errcode = '23514';
  end if;

  select * into v_instance from public.lpe_programme_instances where enrollment_id = p_enrollment_id;
  if v_instance.id is null then
    raise exception 'No programme instance for this enrolment' using errcode = '23514';
  end if;

  if p_target_value is not null or p_target_unit is not null or p_target_date is not null then
    v_target := jsonb_strip_nulls(jsonb_build_object(
      'value', p_target_value, 'unit', p_target_unit, 'date', p_target_date));
  end if;

  insert into public.lpe_goal_instances
    (organisation_id, programme_instance_id, goal_template_id, module, title, target, status, personalised)
  values
    (v_enrollment.organisation_id, v_instance.id, null, p_module, v_title, v_target, 'active', true)
  returning * into v_goal;

  return v_goal;
end;
$$;

revoke all on function public.create_personalised_lifestyle_goal(uuid, public.lpe_module, text, numeric, text, date) from public;
revoke all on function public.create_personalised_lifestyle_goal(uuid, public.lpe_module, text, numeric, text, date) from anon;
grant execute on function public.create_personalised_lifestyle_goal(uuid, public.lpe_module, text, numeric, text, date) to authenticated;

-- Patient resolves (achieves/abandons) a goal they added themselves. A
-- template/doctor-authored goal (personalised = false) is never touchable
-- through this RPC, even by its own patient -- that stays staff-owned.
create or replace function public.resolve_personalised_lifestyle_goal(
  p_goal_id uuid,
  p_status public.lpe_goal_status
)
returns public.lpe_goal_instances
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_goal       public.lpe_goal_instances%rowtype;
  v_patient_id uuid;
begin
  if p_status not in ('achieved', 'abandoned') then
    raise exception 'Invalid goal outcome' using errcode = '23514';
  end if;

  select * into v_goal from public.lpe_goal_instances where id = p_goal_id;
  if v_goal.id is null then
    raise exception 'Goal not found' using errcode = '42501';
  end if;

  select e.patient_id into v_patient_id
  from public.lpe_programme_instances pi
  join public.lpe_enrollments e on e.id = pi.enrollment_id
  where pi.id = v_goal.programme_instance_id;

  if v_patient_id is distinct from (select auth.uid()) then
    raise exception 'Not authorised for this goal' using errcode = '42501';
  end if;
  if not v_goal.personalised then
    raise exception 'Only goals you added yourself can be updated here' using errcode = '42501';
  end if;
  if v_goal.status <> 'active' then
    raise exception 'This goal has already been resolved' using errcode = '23514';
  end if;

  update public.lpe_goal_instances set status = p_status where id = p_goal_id returning * into v_goal;
  return v_goal;
end;
$$;

revoke all on function public.resolve_personalised_lifestyle_goal(uuid, public.lpe_goal_status) from public;
revoke all on function public.resolve_personalised_lifestyle_goal(uuid, public.lpe_goal_status) from anon;
grant execute on function public.resolve_personalised_lifestyle_goal(uuid, public.lpe_goal_status) to authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.create_personalised_lifestyle_goal(uuid, public.lpe_module, text, numeric, text, date)',
    'public.resolve_personalised_lifestyle_goal(uuid, public.lpe_goal_status)'
  ]
  loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'anon can still execute % — the revoke did not take', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'authenticated lost EXECUTE on % — the revoke went too far', v_fn;
    end if;
  end loop;
end $$;
