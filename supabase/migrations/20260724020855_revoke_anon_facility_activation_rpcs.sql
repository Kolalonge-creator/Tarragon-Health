-- Supabase grants EXECUTE ON ALL FUNCTIONS to anon/authenticated/service_role
-- via a default-privileges setting independent of the PUBLIC pseudo-role, so
-- `revoke all ... from public` (used in the two migrations just before this
-- one) does not actually strip anon's access -- confirmed live via
-- has_function_privilege(anon, ..., 'EXECUTE') = true after that revoke.
-- Every sibling SECURITY DEFINER RPC in this codebase explicitly revokes
-- from anon by name for this reason; this migration applies the same fix to
-- the two new facility-activation RPCs.
revoke execute on function public.set_lab_order_facility(uuid, uuid) from anon;
revoke execute on function public.set_referral_specialist_provider(uuid, uuid) from anon;
