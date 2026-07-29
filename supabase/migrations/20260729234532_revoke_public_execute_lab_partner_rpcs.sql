-- Tarragon Health — the REAL fix for anon-execute on the new lab_partner RPCs.
--
-- The prior migration revoked EXECUTE from `anon` directly, following the
-- pattern documented for 20260724020855/20260724163357 — but verification via
-- has_function_privilege('anon', ..., 'EXECUTE') showed it was still TRUE
-- afterward. Inspecting pg_proc.proacl directly showed why: a newly created
-- function's ACL carries a grant to the PUBLIC pseudo-role (`=X/postgres`) by
-- default, and `anon` inherits EXECUTE through THAT, not through any direct
-- `anon=X` grant — so `revoke ... from anon` is a no-op when anon never held a
-- direct grant to begin with. `revoke ... from public` is what actually removes
-- the PUBLIC entry from the ACL and closes the gap (confirmed live: anon's
-- has_function_privilege flips false, authenticated's stays true since it holds
-- its own direct grant from the earlier `grant execute ... to authenticated`).
--
-- This reverses the documented belief behind 20260724020855 /
-- 20260724163357 / 20260720224204's "revoke from anon, not public" comments.
-- The project-wide sweep was since completed by
-- 20260729183412_revoke_anon_execute_on_security_definer_rpcs, which closed
-- the same gap on every other SECURITY DEFINER RPC in `public` and confirmed
-- the mechanism named here. Ending with the assertion block below is what
-- catches the wrong form being applied.
revoke execute on function public.lab_partner_orders() from public;
revoke execute on function public.lab_partner_order_patient(uuid) from public;
revoke execute on function public.lab_partner_upload_result(uuid, text, text, text, bigint, text) from public;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.lab_partner_orders()',
    'public.lab_partner_order_patient(uuid)',
    'public.lab_partner_upload_result(uuid, text, text, text, bigint, text)'
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
