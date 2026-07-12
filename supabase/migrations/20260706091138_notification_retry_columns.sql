-- Tarragon Health — notification send layer (Phase 1)
-- 01 · Retry bookkeeping for notifications
--
-- The Sprint 2 reminder cron jobs (queue_vitals_reminders,
-- queue_medication_refill_reminders) queue pending notifications, but
-- nothing has consumed the queue yet — this phase adds the sender. Rows
-- that fail to send need to retry a bounded number of times, then land in
-- a permanently-visible failed state — never silently retried forever,
-- never silently dropped.

alter table public.notifications
  add column attempts   integer not null default 0,
  add column last_error  text;
