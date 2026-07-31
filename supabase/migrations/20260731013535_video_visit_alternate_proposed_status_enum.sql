-- Founder ask 2026-07-31: tighten the video-visit doctor-acceptance window
-- to 24h (from 48h) and let a doctor arrange a convenient time with the
-- patient instead of a hard accept-the-exact-slot-or-decline binary. This
-- migration only adds the new status value -- Postgres forbids using a
-- freshly-added enum value in the same transaction that adds it, so the
-- columns/RPCs that use it live in a follow-up migration.
alter type public.video_visit_request_status add value if not exists 'alternate_proposed';
