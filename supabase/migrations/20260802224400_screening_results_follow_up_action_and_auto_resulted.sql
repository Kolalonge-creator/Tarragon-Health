-- Named follow-up action per abnormal result (structured, not just a
-- generic alert) + the completeness check that flips a Screen-tier order to
-- 'resulted' once every applicable analyte has a recorded result, driving
-- the existing handle_screen_tier_resulted trigger (med-review
-- reconciliation + Comprehensive Screen's bundled video consult).
alter table public.screening_results
  add column if not exists follow_up_action text;

-- Dormant imaging codes (no imaging partner exists yet — see
-- 20260802010000's own assertion block) are excluded from the completeness
-- check, or a Comprehensive Screen order could never auto-resolve. Genotype
-- and blood group are once-per-lifetime (matches the matrix's own
-- "Laboratory — once per lifetime" vs "— annual" split): satisfied by ANY
-- prior result for that patient, not one tied to this specific order —
-- everything else must be entered fresh against THIS order.
create or replace function private.check_screen_order_completeness(p_lab_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test_codes text[];
  v_patient_id uuid;
  v_code text;
  v_once_per_lifetime text[] := array['sickle_cell_genotype', 'blood_group'];
  v_dormant text[] := array['abdominal_ultrasound', 'breast_imaging', 'prostate_ultrasound', 'echo'];
  v_satisfied boolean;
begin
  select lo.patient_id, pb.test_codes
    into v_patient_id, v_test_codes
  from public.lab_orders lo
  join public.panel_bundles pb on pb.id = lo.panel_bundle_id
  where lo.id = p_lab_order_id;

  if v_patient_id is null or v_test_codes is null then
    return false;
  end if;

  foreach v_code in array v_test_codes loop
    if v_code = any(v_dormant) then
      continue;
    end if;

    if v_code = any(v_once_per_lifetime) then
      select exists(
        select 1 from public.screening_results
        where patient_id = v_patient_id and screen_type_code = v_code
      ) into v_satisfied;
    else
      select exists(
        select 1 from public.screening_results
        where lab_order_id = p_lab_order_id and screen_type_code = v_code
      ) into v_satisfied;
    end if;

    if not v_satisfied then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function private.maybe_result_screen_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lab_order_id is null then
    return new;
  end if;

  if private.check_screen_order_completeness(new.lab_order_id) then
    update public.lab_orders
      set status = 'resulted', resulted_at = coalesce(resulted_at, now())
      where id = new.lab_order_id
        and status not in ('resulted', 'cancelled');
  end if;

  return new;
end;
$$;

drop trigger if exists screening_results_maybe_result_order on public.screening_results;
create trigger screening_results_maybe_result_order
  after insert on public.screening_results
  for each row execute function private.maybe_result_screen_order();

revoke all on function private.check_screen_order_completeness(uuid) from public;
revoke all on function private.maybe_result_screen_order() from public;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'screening_results' and column_name = 'follow_up_action'
  ) then
    raise exception 'screening_results.follow_up_action should exist';
  end if;
end $$;
