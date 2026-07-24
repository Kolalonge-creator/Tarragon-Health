-- Tarragon Health — new video-consult context for self-serve booked check-ins.
--
-- Standalone migration because Postgres forbids using a freshly-added enum
-- value in the same transaction that adds it (same split as the annual-review
-- context migrations 20260717120000/121000). The slot-picker table + constraint
-- relaxation that USE this value follow in 20260723104000.

alter type public.video_consultation_context add value if not exists 'general_checkin';
