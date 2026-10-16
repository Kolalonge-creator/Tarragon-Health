-- P5 (S15 follow-up), part 1 of 2: the enum value for the MDCN primary-source verification check (CMO answer Q14).
-- Alone in its own file on purpose: a new enum value cannot be used in the transaction that adds it, and part 2
-- (the next migration) refers to it. Nothing uses the value yet, so this changes no behaviour by itself.
alter type public.credential_check_kind add value if not exists 'primary_source';
