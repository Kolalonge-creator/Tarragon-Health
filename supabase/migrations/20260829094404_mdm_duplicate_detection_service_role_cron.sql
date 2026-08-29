create or replace function public.run_patient_duplicate_detection()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user <> 'service_role' and not private.is_admin() then
    raise exception 'only an admin (or the scheduled service-role job) may run duplicate-patient detection';
  end if;
  return private.detect_patient_match_candidates();
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.run_patient_duplicate_detection()', 'EXECUTE') then
    raise exception 'FAIL: anon still holds EXECUTE on public.run_patient_duplicate_detection';
  end if;
end;
$$;
