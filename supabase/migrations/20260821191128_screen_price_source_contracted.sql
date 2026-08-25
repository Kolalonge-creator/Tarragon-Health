-- Two new price_source values, in their own migration on purpose.
--
-- Postgres allows ALTER TYPE ... ADD VALUE inside a transaction block, but it
-- does NOT allow the newly added value to be USED in that same transaction —
-- and Supabase runs each migration in one. Adding these alongside the UPDATEs
-- that set them would fail on a fresh `supabase db reset` while appearing to
-- work against an already-migrated database, which is the worst version of
-- this bug: invisible until someone rebuilds from scratch.
--
--   contracted               — quoted directly in a signed partner price list.
--                              Real, unlike 'lab_price_list', which only ever
--                              meant "derived from a placeholder provider row".
--   derived_from_panel_total — solved out of a panel total because the partner
--                              never quoted the test on its own line. Honest
--                              about being arithmetic rather than a quote, and
--                              findable in one query when a real quote arrives.
do $$ begin
  alter type public.screen_price_source add value if not exists 'contracted';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.screen_price_source add value if not exists 'derived_from_panel_total';
exception when duplicate_object then null; end $$;
