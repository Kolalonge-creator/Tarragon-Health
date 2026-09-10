-- public.service_product_margins was readable by every logged-in patient.
-- Found 2026-09-10 by an end-to-end check as a real authenticated patient.
--
-- WHAT WENT WRONG
-- ---------------
-- 20260910011854 put RLS on both underlying tables and admitted only
-- private.is_admin(). It then created service_product_margins over them and
-- granted SELECT to `authenticated`, believing the RLS underneath would still
-- apply. It does not.
--
-- A Postgres view runs with the privileges of its OWNER unless it is created
-- with security_invoker = on. This view is owned by postgres, so it read
-- clinical_tier_cost_rates and service_delivery_cost_model as postgres,
-- bypassing their policies entirely. The `grant select ... to authenticated`
-- was therefore the whole access check, and it granted everyone:
--
--   * what a minute of each clinical tier costs Tarragon,
--   * the modelled delivery cost of every paid product,
--   * the contribution and margin on each one.
--
-- Verified as a real patient session, not inferred: a patient JWT selected rows
-- from this view while the same session correctly saw nothing in either base
-- table. The tables were never exposed; the view handed the same data over.
--
-- This is commercial data with no patient-facing purpose, and it directly
-- contradicts the founder's instruction on 2026-09-10 that pay data must not go
-- in front of the clinical team -- in front of every patient is worse.
--
-- THE FIX
-- -------
-- security_invoker = on makes the view execute as the CALLER, so the admin-only
-- policies on both base tables apply and a non-admin sees an empty result. No
-- policy changes, no grant changes, no application change: the admin console
-- reads it as an admin and keeps working.
--
-- THE GENERAL RULE, WHICH IS WHY THIS COMMENT IS LONG
-- ---------------------------------------------------
-- On this platform, a view over an RLS-protected table MUST set
-- security_invoker = on, or it silently becomes a hole in exactly the
-- protection it appears to sit behind. Granting SELECT on such a view is not
-- "letting them see the view", it is "letting them see everything the view can
-- reach, as postgres".
--
-- public.therapy_directory is deliberately NOT changed. It is owner-run on
-- purpose: it selects only non-sensitive columns (no contact details, no
-- licence number, no commission rate) and it exists precisely so the patient
-- directory keeps working when specialist_providers is eventually locked down.
-- That is a considered exception, not the same oversight.

begin;

alter view public.service_product_margins set (security_invoker = on);

comment on view public.service_product_margins is
  'Price, modelled delivery cost, payment processing and contribution for every active paid product. security_invoker = on is LOAD-BEARING: without it this view runs as its owner and hands every logged-in patient the commercial figures the admin-only RLS on clinical_tier_cost_rates and service_delivery_cost_model exists to protect. Never remove it, and never create another view over those tables without it.';

do $$
declare
  v_invoker text;
begin
  select coalesce((select option_value
                     from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'not set')
    into v_invoker
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'service_product_margins';

  -- Postgres stores the reloption verbatim, so this reads back as the string
  -- 'on' rather than 'true'. Accept either, and fail on anything else
  -- (including 'not set') rather than assuming a match.
  if lower(v_invoker) not in ('on', 'true') then
    raise exception 'FAIL: service_product_margins still runs as its owner (security_invoker = %). Every authenticated user can read the cost model.', v_invoker;
  end if;

  raise notice 'PASS: service_product_margins now executes as the caller; the admin-only RLS underneath applies';
end $$;

commit;
