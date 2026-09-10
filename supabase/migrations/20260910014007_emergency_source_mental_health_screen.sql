-- A dedicated emergency source for a self-harm disclosure on a wellbeing screen.
--
-- Its own migration because ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction as anything that references the new value.
--
-- Until now these events were recorded as 'intake_screen', which is the generic
-- source used for anything raised during onboarding. That made a disclosure of
-- suicidal ideation indistinguishable, in the data, from any other intake flag --
-- so it could not be counted, audited, given its own SLA, or reported on. It is
-- the single most serious thing a patient can tell this platform and it had no
-- name of its own.

alter type public.emergency_source add value if not exists 'mental_health_screen';
