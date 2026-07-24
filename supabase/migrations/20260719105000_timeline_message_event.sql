-- Add the 'message_posted' event to the unified patient timeline.
--
-- Kept in its own migration: Postgres forbids using a freshly-added enum value
-- in the same transaction that adds it, and the care_messages migration that
-- follows writes timeline rows with this value at insert time.
alter type public.timeline_event_type add value if not exists 'message_posted';
