-- Fulfilment deferral, step 1 of 2: the enum type only.
--
-- Postgres forbids using a freshly-added enum value/type in the same
-- transaction that creates it, so this is deliberately split from the column +
-- trigger work that follows (the same enum-add-then-use split this codebase has
-- used for booking_origin/video_visit/timeline_event_type).
--
-- Blast radius at time of writing, counted live rather than assumed:
--   lab_orders            0 rows
--   pharmacy_orders       0 rows
--   commissions           0 rows
--   lab_result_documents  0 rows
--   pharmacy_medications  0 rows (catalogue was already empty)
--   care_vouchers         0 rows
-- Nothing has ever flowed through the partner-fulfilment path, so this is a
-- purely structural change with no data conversion step anywhere.
--
-- 'partner'       = Tarragon routes the order to a contracted lab and takes the
--                   payment. The model every existing trigger was written for.
--                   Retained, dormant, so partners can be switched back on.
-- 'self_arranged' = Tarragon issues the order; the patient takes it to any lab
--                   they choose, pays that lab directly, and uploads the result.
--                   Tarragon takes nothing on the test.
create type public.lab_order_fulfilment as enum ('partner', 'self_arranged');

comment on type public.lab_order_fulfilment is
  'How a lab order is fulfilled. self_arranged = patient uses any lab and uploads the result; Tarragon neither routes nor bills it. See private.enforce_lab_order_origin for the guard.';
