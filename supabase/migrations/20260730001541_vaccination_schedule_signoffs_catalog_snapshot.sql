-- Tarragon Health — capture what was actually reviewed at sign-off time.
--
-- vaccination_schedule_signoffs (20260730000555) records THAT a version was
-- signed, but not WHAT vaccination_catalog looked like at that moment — so a
-- later catalog edit (e.g. another WHO/NPHCDA dosing-accuracy fix, same class
-- as the 2026-07-24 tetanus/shingles work) would leave no way to tell whether
-- the live catalog still matches what was actually reviewed. Adds a snapshot
-- column, populated by the app at draft-creation time (a plain jsonb array of
-- the active catalog rows), not by a trigger — a snapshot must reflect
-- exactly what a human looked at before clicking "create draft", not
-- whatever the catalog happens to contain a moment later.

alter table public.vaccination_schedule_signoffs
  add column if not exists catalog_snapshot jsonb;

comment on column public.vaccination_schedule_signoffs.catalog_snapshot is
  'Snapshot of active vaccination_catalog rows at the moment this draft was created — what the Clinical Director actually reviewed, immutable once signed.';
