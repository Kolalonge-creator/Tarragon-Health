-- Facilities: stop asserting a verification that never happened, and suspend
-- the laboratory rows alongside every other partner catalogue.
--
-- Founder decision 2026-08-03: no lab or facility should be displayed while
-- the platform takes no payment for a test and holds no contracted, inspected
-- network. The patient-facing facility directory was removed in the same
-- change; this makes the data match, so nothing can leak back through a future
-- surface that reads these rows.
--
-- Row counts before this migration (CLAUDE.md removals rule 1 — count first):
--   facilities            9 rows, 9 active, 9 with verified = true
--     of which lab        5 | hospital 2 | vaccination_centre 2
--   lab_providers         4 rows, 0 active   (already suspended)
--   pharmacy_partners     4 rows, 0 active   (already suspended)
--   specialist_providers  9 rows, 0 active   (already suspended)
--
-- So facilities was the one catalogue still fully active, and the only one
-- still reaching a patient.
--
-- Nothing is deleted. Contracting a real laboratory later is an UPDATE, exactly
-- as it is for the other three catalogues.

-- 1. `verified` was seeded true on every row and reflects no inspection at all.
--    A column that claims accreditation nobody performed is worse than an empty
--    one, because a future surface would render it in good faith. Real MLSCN
--    accreditation checking is ops work, not a data edit: until it happens, the
--    honest value is false.
update public.facilities
set verified = false
where verified;

-- 2. Suspend laboratories, matching lab_providers/pharmacy_partners/
--    specialist_providers, which are all already 0 active.
--
--    Hospitals and vaccination centres are deliberately left active: childhood
--    and adult immunisation still books through FacilitySelector into
--    booking_requests, which is a real, live pathway and not a purchase of a
--    test. Suspending those rows would break immunisation booking rather than
--    suppress a listing.
update public.facilities
set is_active = false
where type = 'lab'
  and is_active;

do $$
declare
  v_verified integer;
  v_active_labs integer;
  v_active_vax integer;
begin
  select count(*) into v_verified from public.facilities where verified;
  if v_verified <> 0 then
    raise exception 'facilities.verified still true on % row(s) — the accreditation claim was not cleared', v_verified;
  end if;

  select count(*) into v_active_labs from public.facilities where type = 'lab' and is_active;
  if v_active_labs <> 0 then
    raise exception '% laboratory facility row(s) are still active', v_active_labs;
  end if;

  -- Guard the deliberate exception rather than trusting the comment above: if a
  -- later change sweeps every facility inactive, immunisation booking silently
  -- loses its picker, and this is where that should be noticed.
  select count(*) into v_active_vax
  from public.facilities where type = 'vaccination_centre' and is_active;
  if v_active_vax = 0 then
    raise exception 'no active vaccination_centre remains — immunisation booking has no facility to offer';
  end if;
end $$;
