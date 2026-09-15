-- New enum values for part B's per-category access lifecycle logging. Split into its own
-- migration: a new enum value cannot be used in the same transaction that adds it.
alter type public.care_access_event_kind add value if not exists 'category_access_granted';
alter type public.care_access_event_kind add value if not exists 'category_access_withdrawn';
