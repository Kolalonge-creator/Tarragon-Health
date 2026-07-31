-- 'sponsor' as a third voice in a care conversation.
--
-- Its own migration because Postgres refuses to use a freshly added enum value
-- in the same transaction that adds it — the same split already used for
-- video_visit_alternate_proposed and general_checkin.
alter type public.care_message_author add value if not exists 'sponsor';
