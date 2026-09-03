-- Tarragon Health — fix record_corrections rows losing their relative order
-- when more than one is written inside a single transaction.
--
-- ROOT CAUSE, found while chasing a reported bug in
-- packages/db/tests/record_corrections_platform_wide.sql ("changed_columns
-- came back {multi_condition_notified_at} instead of status on a
-- care_plans.status update"). private.capture_record_correction() itself is
-- correct — it captures exactly the columns that changed on whichever UPDATE
-- fired it. The actual cause: public.record_corrections.corrected_at
-- defaults to `now()`, which in Postgres is transaction_timestamp() — a
-- single constant value for an entire transaction, not the moment each
-- individual row was written. Confirmed live: enrolling a patient in a
-- care_plan (INSERT) with no active programme purchase makes
-- private.ensure_medication_review() (20260830014719_entitlement_gates_use_
-- programme_purchases.sql) issue its own nested `UPDATE care_plans SET
-- multi_condition_notified_at = now()` as a side effect — a second,
-- completely legitimate record_corrections row for the same care_plan,
-- captured correctly by the trigger. When a later statement in the SAME
-- transaction (e.g. `UPDATE care_plans SET status = 'completed'`) produces a
-- third row, all of them can share the identical corrected_at value, so
-- `order by corrected_at desc limit 1` — the obvious, otherwise-correct way
-- to read "the latest correction" — becomes nondeterministic among the tied
-- rows. This is not specific to care_plans or to this one trigger: it is a
-- structural gap in the audit trail itself, since any transaction that
-- writes to more than one audited table (or the same one twice via a
-- cascading trigger) can no longer be temporally ordered by corrected_at.
--
-- FIX. Default corrected_at to clock_timestamp() instead of now() —
-- clock_timestamp() is true wall-clock time and advances between statements
-- within one transaction, same fix as Postgres's own docs recommend for
-- "I need real elapsed time inside a transaction". Column-default-only
-- change: private.capture_record_correction() never supplies corrected_at
-- explicitly, so no trigger code changes, and every one of the ~15
-- migrations that attach this trigger to a table needs no changes either.
-- Existing rows are untouched — this only changes what future INSERTs get.

alter table public.record_corrections
  alter column corrected_at set default clock_timestamp();

comment on column public.record_corrections.corrected_at is
  'clock_timestamp(), not now()/transaction_timestamp() -- deliberately, so multiple corrections written within one transaction (e.g. a cascading trigger''s own nested UPDATE alongside the statement that triggered it) stay orderable relative to each other. Fixed 2026-09-02, see 20260902225935_fix_record_corrections_transaction_timestamp_ordering.sql.';

-- ===========================================================================
-- The migration is the test. record_corrections is deliberately append-only
-- (record_corrections_no_delete/no_update triggers) so this can't prove the
-- fix by inserting-then-cleaning-up rows the normal way; instead it proves
-- two things: (1) the column default now literally reads clock_timestamp(),
-- not now(), via the catalog; (2) clock_timestamp() genuinely advances
-- within one transaction while now() does not, as a standalone fact,
-- confirming the mechanism the fix relies on.
-- ===========================================================================
do $$
declare
  v_default_expr text;
  v_now_1 timestamptz;
  v_now_2 timestamptz;
  v_clock_1 timestamptz;
  v_clock_2 timestamptz;
begin
  select pg_get_expr(d.adbin, d.adrelid) into v_default_expr
  from pg_attrdef d
  join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
  where d.adrelid = 'public.record_corrections'::regclass and a.attname = 'corrected_at';

  if v_default_expr is distinct from 'clock_timestamp()' then
    raise exception 'FAIL: record_corrections.corrected_at default is %, expected clock_timestamp()', v_default_expr;
  end if;

  select now(), now() into v_now_1, v_now_2;
  perform pg_sleep(0.01);
  select now() into v_now_2;
  select clock_timestamp() into v_clock_1;
  perform pg_sleep(0.01);
  select clock_timestamp() into v_clock_2;

  if v_now_1 is distinct from v_now_2 then
    raise exception 'FAIL: now() advanced within one transaction on this Postgres build -- the whole premise of this fix is wrong, needs re-investigation';
  end if;
  if v_clock_2 <= v_clock_1 then
    raise exception 'FAIL: clock_timestamp() did not advance within one transaction (first=%, second=%) -- the fix will not work', v_clock_1, v_clock_2;
  end if;

  raise notice 'PASS: record_corrections.corrected_at default is clock_timestamp(); confirmed clock_timestamp() advances within a transaction while now() does not';
end $$;
