-- Close anon EXECUTE on the seven SECURITY DEFINER functions that still had it.
--
-- Found by Supabase's security advisor (anon_security_definer_function_executable) only after
-- replaying the full migration history into a clean project -- invisible on the original database.
--
-- ROOT CAUSE, verified from pg_proc.proacl rather than assumed. A broken function's ACL reads:
--     {=X/postgres, postgres=X/postgres, service_role=X/postgres, authenticated=X/postgres}
-- while a correctly-hardened one (public.has_ai_coach_access) reads:
--     {postgres=X/postgres, service_role=X/postgres, authenticated=X/postgres}
-- The difference is the leading `=X/postgres` entry, which is the grant to the PUBLIC
-- pseudo-role. anon holds NO direct grant -- its access is inherited from PUBLIC. Therefore:
--
--   * `revoke execute ... from anon`   -- NO-OP. Does nothing, because anon has no direct grant.
--   * `revoke execute ... from public` -- THE ACTUAL FIX. Removes the `=X/` entry.
--
-- (An earlier attempt at this migration used the anon form and was caught by the assertion at the
-- bottom, which is why that assertion is here rather than trusting the statements above.)
--
-- The explicit grants to authenticated/service_role already exist and are re-stated for clarity,
-- so revoking PUBLIC cannot accidentally lock out the legitimate callers.
--
-- Impact: each function gates internally on auth.uid() (null for anon) or an explicit role check,
-- so there is no known live data leak. This is defence in depth -- four of the seven are the
-- pharmacist cross-tenant PHI functions, and no unauthenticated caller should reach them at all.

revoke execute on function public.admin_send_broadcast(uuid) from public;
grant execute on function public.admin_send_broadcast(uuid) to authenticated, service_role;

revoke execute on function public.admin_broadcast_audience_count(public.broadcast_audience, jsonb) from public;
grant execute on function public.admin_broadcast_audience_count(public.broadcast_audience, jsonb) to authenticated, service_role;

revoke execute on function public.region_service_available(text, text) from public;
grant execute on function public.region_service_available(text, text) to authenticated, service_role;

revoke execute on function public.pharmacist_orders() from public;
grant execute on function public.pharmacist_orders() to authenticated, service_role;

revoke execute on function public.pharmacist_order_allergies(uuid) from public;
grant execute on function public.pharmacist_order_allergies(uuid) to authenticated, service_role;

revoke execute on function public.pharmacist_order_medications(uuid) from public;
grant execute on function public.pharmacist_order_medications(uuid) to authenticated, service_role;

revoke execute on function public.pharmacist_record_dispense(uuid, text, text, date) from public;
grant execute on function public.pharmacist_record_dispense(uuid, text, text, date) to authenticated, service_role;

-- Prove it rather than assume it: fail loudly if anon can still reach any of the seven, or if a
-- legitimate caller was locked out by the revoke.
do $$
declare
  f text;
  still_open text[] := '{}';
  locked_out text[] := '{}';
  fns text[] := array[
    'public.admin_send_broadcast(uuid)',
    'public.admin_broadcast_audience_count(public.broadcast_audience, jsonb)',
    'public.region_service_available(text, text)',
    'public.pharmacist_orders()',
    'public.pharmacist_order_allergies(uuid)',
    'public.pharmacist_order_medications(uuid)',
    'public.pharmacist_record_dispense(uuid, text, text, date)'
  ];
begin
  foreach f in array fns loop
    if has_function_privilege('anon', f, 'execute') then
      still_open := still_open || f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      locked_out := locked_out || f;
    end if;
  end loop;

  if array_length(still_open, 1) > 0 then
    raise exception 'anon still holds EXECUTE on: %', array_to_string(still_open, ', ');
  end if;
  if array_length(locked_out, 1) > 0 then
    raise exception 'authenticated lost EXECUTE on: %', array_to_string(locked_out, ', ');
  end if;
end $$;
