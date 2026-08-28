-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as supabase/roles.sql's stub fixes and the other real-migration
-- stubs in this history (match_lpe_content_blocks, the service-role
-- actor-attribution functions): 20260812115553_activity_log_entries_source_
-- and_wearable_steps.sql's own self-test asserts `anon` cannot EXECUTE
-- record_wearable_step_count after that migration's
-- `revoke execute ... from public`, but on a fresh replay `anon` still holds
-- direct EXECUTE at that point -- the same unexplained local/CI-only
-- default-ACL gap documented everywhere else in this history, confirmed to
-- require an explicit `revoke ... from anon` (and, belt-and-suspenders,
-- `from authenticated`) in addition to `from public`, not instead of it.
--
-- Not fixed by editing the historical migration (touches already-applied
-- content). Instead, this migration pre-creates the function one second
-- earlier with the exact same signature and the additional explicit
-- revokes -- CREATE OR REPLACE FUNCTION preserves an existing grant set when
-- the argument types match exactly (they do here), so 20260812115553's own
-- `create or replace function` + `revoke ... from public` +
-- `grant ... to service_role` then layers on top of, rather than
-- overwriting, the anon/authenticated revokes established here. Genuine
-- no-op on the live project: live already ran 20260812115553 directly, so
-- this function already exists there with whatever grants that migration's
-- own statements produced live -- this stub's dummy body is immediately
-- superseded by the real CREATE OR REPLACE one second later, on live and on
-- a fresh replay alike.
create function public.record_wearable_step_count(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_logged_on date,
  p_step_count integer
) returns boolean
language sql
set search_path = public, pg_temp
as $$
  select null::boolean;
$$;

revoke all on function public.record_wearable_step_count(uuid, uuid, date, integer) from public;
revoke all on function public.record_wearable_step_count(uuid, uuid, date, integer) from anon;
revoke all on function public.record_wearable_step_count(uuid, uuid, date, integer) from authenticated;
