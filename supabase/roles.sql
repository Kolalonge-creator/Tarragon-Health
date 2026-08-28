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

-- Stub #12: next confirmed CI failure after #11 above --
-- 20260731215326_care_vouchers_redemption.sql's own assertion (single
-- creation site, same pattern again).
create function public.redeem_care_voucher(
  p_voucher uuid,
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

revoke all on function public.redeem_care_voucher(uuid, text, uuid) from public;
revoke all on function public.redeem_care_voucher(uuid, text, uuid) from anon;
grant execute on function public.redeem_care_voucher(uuid, text, uuid) to authenticated;

-- Stub #13/#14: next confirmed CI failure after #12 above --
-- 20260731215424_care_vouchers_lifecycle_and_rewards.sql's own assertion on
-- both functions it defines (single creation site each, same pattern again).
create function public.extend_care_voucher(p_voucher uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.extend_care_voucher(uuid, text) from public;
revoke all on function public.extend_care_voucher(uuid, text) from anon;
grant execute on function public.extend_care_voucher(uuid, text) to authenticated;

create function public.cancel_care_voucher(p_voucher uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.cancel_care_voucher(uuid, text) from public;
revoke all on function public.cancel_care_voucher(uuid, text) from anon;
grant execute on function public.cancel_care_voucher(uuid, text) to authenticated;

-- Stub #15/#16: next confirmed CI failure after #13/#14 above --
-- 20260801091000_sponsor_care_status_and_funding.sql's own assertion,
-- covering sponsor_care_status/sponsor_request_refill (both single creation
-- site here) plus sponsor_payable_orders (already stubbed above as #10).
create function public.sponsor_care_status(p_beneficiary uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.sponsor_care_status(uuid) from public;
revoke all on function public.sponsor_care_status(uuid) from anon;
grant execute on function public.sponsor_care_status(uuid) to authenticated;

create function public.sponsor_request_refill(
  p_beneficiary uuid,
  p_medication_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.sponsor_request_refill(uuid, uuid) from public;
revoke all on function public.sponsor_request_refill(uuid, uuid) from anon;
grant execute on function public.sponsor_request_refill(uuid, uuid) to authenticated;

-- Stub #17: next confirmed CI failure after #15/#16 above --
-- 20260802213144_diaspora_usd_processing_fee.sql's own assertion (single
-- creation site, same pattern again).
create function public.set_usd_processing_fee(p_fee_pct numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.set_usd_processing_fee(numeric) from public;
revoke all on function public.set_usd_processing_fee(numeric) from anon;
grant execute on function public.set_usd_processing_fee(numeric) to authenticated;

-- Stub #18: next confirmed CI failure after #17 above --
-- 20260803145146_emergency_cards.sql's own assertion on create_emergency_card
-- (single creation site, no-arg, same pattern again). Its sibling
-- revoke_emergency_card is not checked by that migration's own assertion, so
-- it's left unstubbed until/unless CI reports it as an actual failure.
create function public.create_emergency_card()
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.create_emergency_card() from public;
revoke all on function public.create_emergency_card() from anon;
grant execute on function public.create_emergency_card() to authenticated;

-- Stub #19: next confirmed CI failure after #18 above --
-- 20260807112503_clinician_phone_admin_only_visibility.sql's own assertion
-- on my_care_plan_clinicians (single creation site, no-arg, table-returning),
-- same pattern again.
create function public.my_care_plan_clinicians()
returns table (
  care_plan_id uuid,
  clinician_full_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

revoke all on function public.my_care_plan_clinicians() from public;
revoke all on function public.my_care_plan_clinicians() from anon;
grant execute on function public.my_care_plan_clinicians() to authenticated;

-- Stubs #20/#21/#22: next confirmed CI failure after #19 above --
-- 20260809182227_pharmacist_portal_extension.sql's own assertion on all
-- three functions it defines (single creation site each, same pattern
-- again, all built-in argument types so safe to stub here).
create function public.pharmacist_profile()
returns table (
  name text,
  regions text[],
  city text,
  state text,
  contact_phone text,
  contact_email text,
  delivery boolean,
  license_number text,
  license_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

revoke all on function public.pharmacist_profile() from public;
revoke all on function public.pharmacist_profile() from anon;
grant execute on function public.pharmacist_profile() to authenticated;

create function public.pharmacist_update_profile(
  p_name text,
  p_regions text[],
  p_city text,
  p_state text,
  p_contact_phone text,
  p_contact_email text,
  p_delivery boolean,
  p_license_number text,
  p_license_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
end;
$$;

revoke all on function public.pharmacist_update_profile(text, text[], text, text, text, text, boolean, text, timestamptz) from public;
revoke all on function public.pharmacist_update_profile(text, text[], text, text, text, text, boolean, text, timestamptz) from anon;
grant execute on function public.pharmacist_update_profile(text, text[], text, text, text, text, boolean, text, timestamptz) to authenticated;

create function public.pharmacist_dispense_history(p_limit int default 200)
returns table (
  dispense_id uuid,
  patient_name text,
  drug_name text,
  quantity text,
  dispensed_on date
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

revoke all on function public.pharmacist_dispense_history(int) from public;
revoke all on function public.pharmacist_dispense_history(int) from anon;
grant execute on function public.pharmacist_dispense_history(int) to authenticated;

-- ROOT-CAUSE FIX for the TABLE half of this gap, replacing per-table stubs
-- going forward: the same "anon can reach something it shouldn't" gap that
-- affects an unpredictable subset of functions (fixed one at a time above)
-- also affects an unpredictable subset of newly created TABLES -- hit so far
-- on lab_result_extractions (fixed via
-- supabase/migrations/20260803130644_fix_lab_result_extractions_anon_table_grant.sql)
-- and emergency_cards (fixed via
-- supabase/migrations/20260803145145_fix_emergency_cards_anon_table_grant.sql),
-- both using the same "pre-create the table here with correct grants, one
-- second before its real consumer" trick as the function stubs, which works
-- ONLY because both of those migrations' own `create table` used
-- `IF NOT EXISTS` (making the real migration's create a harmless no-op on
-- top of the pre-created table).
--
-- 20260807010452_care_access_events.sql is the confirmed next CI failure
-- after stub #18 above, with the SAME assertion shape ("anon must not reach
-- the access log") -- but its own `create table public.care_access_events`
-- has NO `IF NOT EXISTS`, so pre-creating it here would make the real
-- migration's own create fail outright with "relation already exists". The
-- per-table pre-create trick is structurally incompatible with this
-- migration, and there's no way to know how many more of the remaining
-- migration history share this same non-idempotent-create shape.
--
-- Fixing at the root instead, the same way 20260729235803's
-- rls_auto_enable_trigger closes the analogous "a migration author forgot to
-- enable RLS" gap: an event trigger, installed here so it exists before ANY
-- migration runs, that fires the instant any public-schema table is created
-- and revokes whatever phantom anon/public grant this environment's bootstrap
-- gives it -- BEFORE the owning migration's own later, explicit
-- `grant ... to authenticated` (and, for the handful of deliberately public
-- tables like marketing_resources/patient_testimonials, `grant ... to anon`)
-- statements run. Since GRANT only ever adds privileges, an explicit later
-- grant to anon is completely unaffected by this earlier revoke -- order of
-- operations is create -> (this trigger fires: revoke all from public/anon)
-- -> the migration's own policies/grants, so a table that deliberately wants
-- anon access still ends up with it, and one that doesn't (the common case)
-- no longer has to fight an unexplained phantom grant.
--
-- This also makes the two per-table migrations above redundant going
-- forward, but they're left in place rather than reverted: they're already
-- confirmed working via CI, and removing them wouldn't change behaviour or
-- reduce risk, just add churn to files this session has already validated.
--
-- EXTENDED (still same CI run's next failure, confirmed): clearing the anon
-- gap on care_access_events surfaced a second, related but distinct default-
-- ACL gap in the SAME migration's own follow-up hardening
-- (20260807014200_care_access_log_hardening.sql): `authenticated` held
-- REFERENCES and TRIGGER on the table (information_schema.role_table_grants),
-- neither of which any migration in this codebase ever intentionally grants
-- to authenticated (confirmed by grep) -- this environment's bootstrap simply
-- gives authenticated more than the SELECT/INSERT/UPDATE/DELETE that
-- 20260731232749's own default-privileges fix establishes as the intended
-- baseline. Narrowing authenticated down to that baseline here too, same
-- create-time-before-any-explicit-grant timing as the anon/public revoke
-- above -- a table that legitimately needs one of these for authenticated
-- would need to say so explicitly (none currently do).
create or replace function public.ci_normalize_table_grants()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type = 'table'
  loop
    if r.schema_name = 'public' then
      execute format('revoke all on %s from public', r.object_identity);
      execute format('revoke all on %s from anon', r.object_identity);
      execute format('revoke references, trigger, truncate on %s from authenticated', r.object_identity);
    end if;
  end loop;
end;
$$;

comment on function public.ci_normalize_table_grants() is
  'Local/CI-only event-trigger function (ddl_command_end on CREATE TABLE). '
  'Revokes whatever phantom anon/public grant and excess authenticated '
  'privileges this environment''s bootstrap gives every new public-schema '
  'table, before the owning migration''s own later grants run. See '
  'supabase/roles.sql for the full investigation. Never invoke directly.';

drop event trigger if exists ci_revoke_anon_table_defaults_trigger;
drop event trigger if exists ci_normalize_table_grants_trigger;

create event trigger ci_normalize_table_grants_trigger
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.ci_normalize_table_grants();

revoke execute on function public.ci_normalize_table_grants() from public;
revoke execute on function public.ci_normalize_table_grants() from anon;

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
