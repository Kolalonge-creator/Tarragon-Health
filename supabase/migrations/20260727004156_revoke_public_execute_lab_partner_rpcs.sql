-- Tarragon Health — the REAL fix for anon-execute on the new lab_partner RPCs.
--
-- The prior migration (20260727004013) revoked EXECUTE from `anon` directly,
-- following the pattern documented for 20260724020855/20260724163357 — but
-- verification via has_function_privilege('anon', ..., 'EXECUTE') showed it
-- was still TRUE afterward. Inspecting pg_proc.proacl directly showed why:
-- a newly created function's ACL carries a grant to the PUBLIC pseudo-role
-- (`=X/postgres`) by default, and `anon` inherits EXECUTE through THAT, not
-- through any direct `anon=X` grant — so `revoke ... from anon` is a no-op
-- when anon never held a direct grant to begin with. `revoke ... from public`
-- is what actually removes the PUBLIC entry from the ACL and closes the gap
-- (confirmed live: anon's has_function_privilege flips false, authenticated's
-- stays true since it holds its own direct grant from the earlier
-- `grant execute ... to authenticated`).
--
-- This appears to reverse the documented belief behind 20260724020855 /
-- 20260724163357 / 20260720224204's "revoke from anon, not public" comments —
-- an earlier PRE-existing precedent (20260719230239_open_health_check_revoke_public)
-- already used the `from public` form successfully, so this was likely a
-- misdiagnosis at the time those later migrations were written. Flagging here
-- rather than re-auditing every previously "fixed" RPC in this pass (out of
-- scope for the lab_partner build) — see CLAUDE.md Current Sprint entry.
revoke execute on function public.lab_partner_orders() from public;
revoke execute on function public.lab_partner_order_patient(uuid) from public;
revoke execute on function public.lab_partner_upload_result(uuid, text, text, text, bigint, text) from public;
