-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as supabase/roles.sql's stub fixes (see that file's header) and
-- the other real-migration stubs in this history (lab_partner_own_provider_id,
-- record_voucher_payment_intent): 20260810034407_match_lpe_content_blocks_rpc.sql's
-- own anon-execute assertion fails on a fresh replay, same unexplained
-- local/hosted default-ACL gap, but this function takes custom types
-- (extensions.vector, public.care_plan_condition, public.lpe_module) that
-- don't exist yet when roles.sql runs (before any migration), so it can't
-- be stubbed there -- needs a real migration instead, placed where those
-- types are already long-established (care_plan_condition since
-- 20260705211129, lpe_module since 20260719120001, both well before this
-- point in history).
create function public.match_lpe_content_blocks(
  query_embedding extensions.vector(1536),
  match_count int default 3,
  filter_condition public.care_plan_condition default null,
  filter_module public.lpe_module default null
)
returns table (
  id uuid,
  key text,
  title text,
  body_md text,
  condition public.care_plan_condition,
  module public.lpe_module,
  similarity float
)
language sql
stable
set search_path = public, extensions
as $$
  select null::uuid, null::text, null::text, null::text,
         null::public.care_plan_condition, null::public.lpe_module, null::float
  where false;
$$;

revoke execute on function public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module) from public;
revoke execute on function public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module) from anon;
grant execute on function public.match_lpe_content_blocks(extensions.vector, int, public.care_plan_condition, public.lpe_module) to authenticated;
