-- A Chief Medical Officer can declare their own availability up to 120 days ahead (everyone else stays at 31).
--
-- WHY. public.declare_availability refuses a block that starts more than 31 days from now (queue_bad_window). A contracted clinician's on-call shift
-- needs a confirmed availability block that covers it (rota_validate_clinician_core_base), and a block is at most 24 hours, so a contracted CMO who is also
-- on the on-call rota could not be rostered more than about a month ahead and the rota had to be re-extended every few weeks. The CMO is the one person
-- who also confirms those blocks, so a longer horizon for the CMO's own declarations adds no unchecked authority.
--
-- DEFINITION TAKEN FROM THE LIVE FUNCTION (read 2026-10-29), with ONE change: the 31 day limit becomes 120 days when the caller is an active Chief
-- Medical Officer (clinical_staff.doctor_tier = 'chief_medical_officer'). Everything else is unchanged, including the eligibility check, the 5 minute
-- grace for a start in the past and the insert. The grants on the function are untouched (create or replace keeps them).
-- Counted first: nothing to convert (a function change only).
create or replace function public.declare_availability(p_kind text, p_starts timestamp with time zone, p_ends timestamp with time zone)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare v_uid uuid := (select auth.uid()); cs public.clinical_staff%rowtype; v_id uuid; v_max_days integer;
begin
  select * into cs from public.clinical_staff where profile_id = v_uid;
  if not found or not private.clinician_is_eligible(v_uid) then raise exception 'queue_not_eligible' using errcode = '42501'; end if;
  -- 31 days for everyone; 120 for the Chief Medical Officer's own hours (see the header)
  v_max_days := case when cs.doctor_tier = 'chief_medical_officer' then 120 else 31 end;
  if p_starts < now() - interval '5 minutes' or p_starts > now() + make_interval(days => v_max_days) then
    raise exception 'queue_bad_window' using errcode = '22023';
  end if;
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
  values (cs.organisation_id, v_uid, p_starts, p_ends, p_kind, cs.is_test) returning id into v_id;
  return v_id;
end;
$function$;

do $$
begin
  if pg_get_functiondef('public.declare_availability(text,timestamptz,timestamptz)'::regprocedure) not like '%chief_medical_officer%120%31%' then
    raise exception 'declare_availability was not updated';
  end if;
  if has_function_privilege('anon', 'public.declare_availability(text,timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'declare_availability must not be executable by anon';
  end if;
end $$;
