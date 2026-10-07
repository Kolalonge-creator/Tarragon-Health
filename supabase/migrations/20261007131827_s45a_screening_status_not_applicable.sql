-- S45a: screening_status gains 'not_applicable' (function 3.5, "done, not applicable or declined, with reasons").
-- A new enum value cannot be used in the transaction that adds it, so the columns, constraints and functions that
-- use it live in 20261007131904_s45_risk_screening_packages.sql. Nothing else changes here.
-- Live counts before: 0 rows use the value (it does not exist yet).
alter type public.screening_status add value if not exists 'not_applicable';
