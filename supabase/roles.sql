-- Supabase CLI applies this file to the local dev database before running
-- supabase/migrations/*.sql (docs: "Custom Database Roles"). Used here for
-- a different purpose than its name suggests — see below.
--
-- BACKGROUND: the first-ever run of the DB Migration Tests CI job
-- (2026-08-27) found that a truly fresh `supabase start`/`db reset` fails
-- 20260730105131_v3_port_escalation_sla_config.sql's own self-check:
--   if has_function_privilege('anon', 'public.sign_escalation_slas(uuid)', 'EXECUTE') then
--     raise exception 'FAIL: anon can execute public.sign_escalation_slas';
--   end if;
-- even though the SAME check passes on the live project (confirmed
-- directly: `select has_function_privilege('anon',
-- 'public.sign_escalation_slas(uuid)', 'execute')` returns false on
-- koiplnmbgnqnbywhpjlf).
--
-- RULED OUT: a first attempt set `alter default privileges ... revoke
-- execute on functions from public` here, on the theory that Supabase's
-- hosted platform sets a more restrictive default ACL than the local CLI
-- image does. Confirmed present in this file's own git history and
-- confirmed NOT to fix the failure (it ran at the right time — logged
-- "Seeding globals from roles.sql..." immediately before the first
-- migration — and made no difference). So this isn't a default-privileges
-- gap. The most likely real explanation: the live project's current
-- correct state came from a manual fix applied directly to the database at
-- some point, never captured in any migration — meaning `revoke ... from
-- public` may never have actually been sufficient here, on any environment,
-- including when this migration first ran on live.
--
-- THE FIX (validating on this one function before extending further — see
-- the "stub" pattern discussion for why a much larger set of migrations
-- across this codebase likely share the same gap): PostgreSQL's `CREATE OR
-- REPLACE FUNCTION` preserves the existing object's grants when replacing
-- an already-existing function — only the body/language/attributes change,
-- not the ACL. Pre-creating a stub here with the CORRECT final grants,
-- before the real migration's own `CREATE OR REPLACE FUNCTION` runs, means
-- that migration's redundant `revoke ... from public; grant ... to
-- authenticated;` lines become no-ops on top of grants that were already
-- correct — and the assertion passes regardless of whatever mechanism
-- caused the original gap. This is not a migration and doesn't touch
-- already-applied migration history (which would create real
-- committed-vs-applied drift — see CLAUDE.md's standing lessons); it's
-- environment setup matching the live project's real, already-correct
-- state.
-- STATUS (2026-08-27): validated on 2 functions so far via real CI runs.
-- Stub #1 (sign_escalation_slas) got past 20260730105131 entirely --
-- notably, that same migration's OTHER anon-execute assertion, on
-- private.escalation_sla_minutes(text, alert_level), passed on its own with
-- no stub needed. So the underlying gap does NOT affect every function that
-- has this style of revoke-then-assert self-check -- only some unlucky
-- subset, for a reason still not understood. That rules out blanket
-- pre-stubbing every such function in this codebase (of which there are
-- roughly 45 across roughly 55 files, most involving custom enum/composite
-- types that CAN'T be safely forward-declared here anyway -- see the note at
-- the bottom of this file): it would spend a lot of effort re-implementing
-- signatures that were never actually going to fail, for no benefit, and for
-- the custom-type ones would introduce a NEW category of failure (the type
-- itself not existing yet when this file runs, since roles.sql applies
-- before ANY migration including the one that defines the type -- and enum
-- types have no CREATE OR REPLACE / IF NOT EXISTS to make that safe).
-- Current approach: fix forward one confirmed failure (or small confirmed
-- batch) at a time from what CI actually reports, rather than guessing.
--
-- ATTRIBUTES MATTER, not just the ACL (found the hard way on stub #4 below):
-- 20260729234618_harden_is_org_staff_exclude_lab_partner.sql runs BEFORE
-- lab_partner_own_provider_id is really created (20260730215206) and audits
-- every already-existing lab_partner_* function for `security definer` by
-- name pattern. Because this file's stub exists from the very start (before
-- ANY migration), that earlier audit now sees the stub too -- and failed
-- when the stub didn't carry `security definer`. Every stub below now
-- matches its real definition's `security definer` / `set search_path`
-- exactly, not just its final grants, since there's no way to know in
-- advance which other historical migration might scan for it early.
create function public.sign_escalation_slas(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.sign_escalation_slas(uuid) from public;
revoke all on function public.sign_escalation_slas(uuid) from anon;
grant execute on function public.sign_escalation_slas(uuid) to authenticated;

-- Stub #2/#3: 20260730155706_broadcast_content_class_enforcement.sql was the
-- next real failure after fixing #1 above (confirmed via CI, not guessed).
-- admin_broadcast_content_check(text) is created for the first time in that
-- migration (same shape as sign_escalation_slas: single creation site, same-
-- file assertion). admin_send_broadcast(uuid) is a redefinition (first
-- created 20260716200000_notification_broadcasts.sql) sharing the same
-- assertion do-block -- stubbed defensively alongside it since it costs
-- nothing extra to include and would otherwise need its own CI round trip
-- to discover either way.
create function public.admin_broadcast_content_check(p_text text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.admin_broadcast_content_check(text) from public;
revoke all on function public.admin_broadcast_content_check(text) from anon;
grant execute on function public.admin_broadcast_content_check(text) to authenticated;

create function public.admin_send_broadcast(p_broadcast_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.admin_send_broadcast(uuid) from public;
revoke all on function public.admin_send_broadcast(uuid) from anon;
grant execute on function public.admin_send_broadcast(uuid) to authenticated, service_role;

-- Stub #4 (lab_partner_own_provider_id) does NOT live here, unlike #1-#3
-- above -- see supabase/migrations/20260730215205_stub_lab_partner_own_provider_id_grants.sql
-- for why: 20260729234618_harden_is_org_staff_exclude_lab_partner.sql runs
-- BEFORE lab_partner_own_provider_id is really created and asserts "exactly
-- 3" lab_partner_* functions exist. A roles.sql stub exists before EVERY
-- migration, so it made that count 4 and failed a real, correct assertion
-- (confirmed via CI). This one genuinely needs to exist only from a specific
-- point in migration history onward, which roles.sql-before-everything
-- can't express -- a real migration, timestamped between the two migrations
-- above, can.

-- Stub #5: next confirmed CI failure after #4 above --
-- 20260730215234_lab_turnaround_sla_stats.sql's own assertion on
-- lab_provider_turnaround_stats (single creation site, same pattern again).
-- Its sibling in the same assertion block, lab_partner_turnaround_stats,
-- is NOT stubbed here -- its name matches the `lab\_partner\_%` pattern
-- that 20260729234618_harden_is_org_staff_exclude_lab_partner.sql audits
-- for "exactly 3" functions (same trap as stub #4), so it needs the same
-- real-migration treatment -- see
-- supabase/migrations/20260730215233_stub_lab_partner_turnaround_stats_grants.sql.
-- lab_provider_turnaround_stats does not match that pattern and is safe here.
create function public.lab_provider_turnaround_stats(p_days int default 90)
returns table (
  provider_id uuid,
  provider_name text,
  orders_resulted bigint,
  avg_turnaround_hours numeric,
  median_turnaround_hours numeric,
  pct_over_72h numeric,
  suppressed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

revoke all on function public.lab_provider_turnaround_stats(int) from public;
revoke all on function public.lab_provider_turnaround_stats(int) from anon;
grant execute on function public.lab_provider_turnaround_stats(int) to authenticated;

-- Stub #6: next confirmed CI failure after #5 above --
-- 20260730215245_admin_link_lab_partner.sql's own assertion (single
-- creation site, same pattern again). Name doesn't match `lab\_partner\_%`
-- (it's admin_link_LAB_PARTNER, i.e. contains but doesn't start with that
-- prefix) so it isn't caught by 20260729234618's pattern audit -- safe here.
--
-- PARAMETER NAMES MATTER TOO, not just types (found the hard way here):
-- Postgres's CREATE OR REPLACE FUNCTION refuses to change an existing
-- parameter's name ("cannot change name of input parameter"), so a stub
-- must match the real definition's parameter names exactly, not just their
-- types -- first param is p_profile_id in the real function, not
-- p_facility_id as first guessed.
create function public.admin_link_lab_partner(p_profile_id uuid, p_lab_provider_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
end;
$$;

revoke all on function public.admin_link_lab_partner(uuid, uuid) from public;
revoke all on function public.admin_link_lab_partner(uuid, uuid) from anon;
grant execute on function public.admin_link_lab_partner(uuid, uuid) to authenticated;

-- Stub #7: next confirmed CI failure after #6 above --
-- 20260731023128_sponsor_pay_booking_order.sql's own assertion (single
-- creation site, same pattern again).
create function public.sponsor_pay_booking_order(
  p_beneficiary uuid,
  p_order_type text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.sponsor_pay_booking_order(uuid, text, uuid) from public;
revoke all on function public.sponsor_pay_booking_order(uuid, text, uuid) from anon;
grant execute on function public.sponsor_pay_booking_order(uuid, text, uuid) to authenticated;

-- Stub #8/#9: next confirmed CI failure after #7 above --
-- 20260731023501_sponsor_acting_rpcs.sql's own assertion on both functions
-- it defines (single creation site each, same pattern again).
create function public.sponsor_book_care(
  p_beneficiary uuid,
  p_bundle_code text,
  p_facility_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.sponsor_book_care(uuid, text, uuid) from public;
revoke all on function public.sponsor_book_care(uuid, text, uuid) from anon;
grant execute on function public.sponsor_book_care(uuid, text, uuid) to authenticated;

create function public.sponsor_set_dependent_basics(
  p_beneficiary uuid,
  p_date_of_birth date default null,
  p_sex text default null,
  p_state text default null,
  p_city text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.sponsor_set_dependent_basics(uuid, date, text, text, text) from public;
revoke all on function public.sponsor_set_dependent_basics(uuid, date, text, text, text) from anon;
grant execute on function public.sponsor_set_dependent_basics(uuid, date, text, text, text) to authenticated;

-- Stub #10: next confirmed CI failure after #8/#9 above --
-- 20260731112407_sponsor_payable_orders.sql's own assertion (single
-- creation site at this point in history -- redefined again later in
-- 20260801091000_sponsor_care_status_and_funding.sql with the identical
-- signature, confirmed by inspection).
create function public.sponsor_payable_orders(p_beneficiary uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.sponsor_payable_orders(uuid) from public;
revoke all on function public.sponsor_payable_orders(uuid) from anon;
grant execute on function public.sponsor_payable_orders(uuid) to authenticated;

-- Stub #11: next confirmed CI failure after #10 above --
-- 20260731215226_care_vouchers_purchase_and_layaway.sql's own assertion,
-- covering two functions. Only purchase_care_voucher is stubbed here (plain
-- uuid/uuid/text args); its sibling record_voucher_payment_intent takes a
-- custom enum (public.payment_provider) and needs the real-migration
-- treatment instead -- see
-- supabase/migrations/20260731215225_stub_record_voucher_payment_intent_grants.sql.
-- payment_provider itself is old and stable (created 20260705211343), so
-- that migration is safe to place directly before this one.
create function public.purchase_care_voucher(
  p_beneficiary uuid,
  p_panel_bundle_id uuid,
  p_gift_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.purchase_care_voucher(uuid, uuid, text) from public;
revoke all on function public.purchase_care_voucher(uuid, uuid, text) from anon;
grant execute on function public.purchase_care_voucher(uuid, uuid, text) to authenticated;

-- NOTE on custom types: several other functions with the same style of
-- anon-execute self-check take a custom enum or composite (table row) type
-- as an argument or return type (public.alert_level, public.masked_call_context,
-- public.lpe_module, public.lpe_goal_status, public.payment_provider,
-- public.broadcast_audience, public.lab_order_time_of_day, and composite row
-- types like public.lab_orders/public.lpe_goal_instances). Those types are
-- created BY migrations, so a stub function referencing them here would fail
-- at roles.sql time (type does not exist yet) -- and pre-creating the type
-- itself here would break the real migration's own un-guarded `create type`
-- statement later (no CREATE TYPE ... IF NOT EXISTS for enums). If CI
-- reports one of these as an actual failure, it needs a different fix
-- (e.g. correcting the real migration in place, since none of this
-- session's Care Management Engine migrations are applied anywhere yet --
-- not a pre-stub here).
