-- S70a (Module 18, function 18.3): a new source label for a reading the person photographed from a device screen and then checked
-- digit by digit. Its own migration: Postgres forbids using a newly added enum value in the same transaction that adds it, and the
-- device-core migration that follows refers to it. Nothing is read from or written to this value here.
--
-- Not added: a 'withings' wearable_provider value. Withings is S70b, and a reserved value nobody can use would only invite a half-built connector.
alter type public.vital_source add value if not exists 'photo_confirmed';
