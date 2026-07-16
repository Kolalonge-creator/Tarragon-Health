-- Tarragon Health — patient location on profiles (facility-by-location, Phase 0)
--
-- Location-based facility selection (choose a lab / vaccination centre / pharmacy /
-- hospital near you) needs a place to remember a patient's own state/city/area so the
-- pickers pre-fill instead of asking every time. These are additive, nullable columns —
-- an unset location stays unset (the picker still works, the patient just types it each
-- time until they save it). No default is inferred (same null-gating discipline the rest
-- of this codebase uses).
--
-- `state`/`city` mirror the free-text shape already used on public.facilities and
-- public.specialist_providers (no Nigerian-states enum exists anywhere in this codebase
-- and one is unwarranted). `area` is the new optional neighbourhood/LGA granularity.
--
-- profiles' existing RLS is unchanged: a patient reads/updates their own row, so these
-- columns inherit self read/write with no new policy.

alter table public.profiles
  add column if not exists state text,
  add column if not exists city  text,
  add column if not exists area  text;

comment on column public.profiles.state is 'Free-text state/region (e.g. "Lagos"); pre-fills the location pickers. Nullable — no default inferred.';
comment on column public.profiles.city is 'Free-text city/town (e.g. "Ikeja"); pre-fills the location pickers. Nullable.';
comment on column public.profiles.area is 'Optional neighbourhood/LGA (e.g. "Allen Avenue"); narrows the location pickers. Nullable.';
