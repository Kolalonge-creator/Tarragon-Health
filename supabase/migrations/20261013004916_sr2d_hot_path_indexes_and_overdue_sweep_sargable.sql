-- SR2d: three hot-path fixes found by reading real query plans (docs/design/SR2-query-plans.md), measured on the local
-- stack with 1,000,000 synthetic rows per table (never production, rolled back; scripts/sr2-query-plans.sql).
--
--   Q2  private.sweep_clinical_tasks, overdue loop (runs every minute): `due_at + make_interval(...) <= now()` puts the
--       column inside an expression, so no index on due_at can serve it. 1,257 ms, a parallel sequential scan of 30,305
--       pages at 1M rows, for a result of 3,000 rows; every minute, forever. Fix: the same condition written as
--       `due_at <= now() - make_interval(...)` (identical meaning, algebra on the other side) plus a partial index on
--       due_at for the two states it filters on.
--   Q4  same function, amber promotion loop: planned through the (type, task_type_version) foreign-key index, 250,000
--       candidate rows, 828 ms. A tiny partial index on the exact predicate removes it.
--   Q11 lab orders waiting on a result for an organisation, oldest first: 2.1 s at a 20,000-row backlog because the
--       (organisation_id, status) index returns the whole backlog to be sorted. (organisation_id, status, ordered_at)
--       returns the oldest 50 directly. (The shorter index is left in place: it is a prefix, not proven redundant for
--       every query shape, and dropping an index is not worth the risk for a few bytes.)
--   Q8  next batch of pending notifications (every 5 minutes): fine at 8 ms with a 200-row backlog, but it is served by
--       notifications_org_idx and reads 798 buffers; a partial index on created_at for status = 'pending' reads only
--       the backlog however large the table grows. Added.
--
-- COUNT FIRST (live, read-only, 2026-10-12): clinical_tasks 0 rows, notifications 1,827, lab_orders a handful. Plain CREATE
-- INDEX is instant here. The function change is applied surgically: the live definition is read, the one expression is
-- replaced, and the migration refuses to continue if the expected text is not found (live and main-dev were verified
-- byte-identical, md5 ada990bf40f5a5d4d209434984210bf9, before writing this), so it cannot overwrite a newer definition.
-- CREATE OR REPLACE keeps the function's existing privileges.
--
-- ROLLBACK: drop the four indexes; re-run the replace in the reverse direction (`due_at <= now() - make_interval(mins =>
-- v_grace)` back to `due_at + make_interval(mins => v_grace) <= now()`).

create index if not exists clinical_tasks_overdue_idx
  on public.clinical_tasks (due_at) where state in ('offered_to_lead', 'open');

create index if not exists clinical_tasks_amber_promotion_idx
  on public.clinical_tasks (due_at)
  where type = 'amber_bp_review' and priority_class = 4 and priority_class_original = 4
    and state in ('offered_to_lead', 'open', 'claimed');

create index if not exists lab_orders_org_status_ordered_idx
  on public.lab_orders (organisation_id, status, ordered_at);

create index if not exists notifications_pending_send_idx
  on public.notifications (created_at) where status = 'pending';

do $$
declare
  v_def text := pg_get_functiondef('private.sweep_clinical_tasks'::regproc);
  v_old constant text := 'due_at + make_interval(mins => v_grace) <= now()';
  v_new constant text := 'due_at <= now() - make_interval(mins => v_grace)';
begin
  if position(v_new in v_def) > 0 and position(v_old in v_def) = 0 then
    return;  -- already applied
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'SR2d: private.sweep_clinical_tasks no longer contains the expected overdue condition; not rewriting';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

do $$
begin
  if position('due_at <= now() - make_interval(mins => v_grace)' in pg_get_functiondef('private.sweep_clinical_tasks'::regproc)) = 0 then
    raise exception 'SR2d: the overdue sweep was not rewritten';
  end if;
  if has_function_privilege('anon', 'private.sweep_clinical_tasks()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.sweep_clinical_tasks()', 'EXECUTE') then
    raise exception 'SR2d: sweep_clinical_tasks became callable by a client role';
  end if;
end $$;
