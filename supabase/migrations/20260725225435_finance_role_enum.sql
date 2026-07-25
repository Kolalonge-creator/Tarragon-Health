-- Tarragon Health — Finance subsystem: add the `finance` account role.
--
-- A dedicated finance-officer persona (finance@tarragonhealth.ng) with its own
-- dashboard home (/finance), exactly like the `analyst` role. Adding an enum
-- value must live in its own migration/transaction because Postgres forbids
-- using a freshly-added enum value in the same transaction that adds it (the
-- same split used for video_consultations.context and annual_review).
alter type public.user_role add value if not exists 'finance';
