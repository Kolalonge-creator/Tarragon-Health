# Home pins: patient-chosen tiles on the Overview and Home screen

Status: built on branch `feat/patient-home-pins` (web and mobile). Not yet applied to the live database. Origin: a review of Samsung Health and Apple Health (curated home, "Manage items" and "Pinned" lists).

## What it does
- The patient's home shows a set of **pinned tiles**. Vitals and medications are where everyone starts; the patient can add anything else from a closed list and reorder it. A **Customise** control opens the chooser (web dialog, mobile bottom sheet).
- With nothing saved, a patient sees exactly what the Overview has always led with (blood pressure, glucose, active medications, doses today; a preventive-care patient sees blood pressure beside their three screening tiles). Shipping this changes nothing until someone customises.
- Tiles are links: a tap opens the page behind them.

## The catalogue (closed, 19 keys)
`packages/shared/src/home-pins.ts` is the single source.
- Vitals (tile with latest reading): `bp`, `glucose`, `weight`, `pulse`, `spo2`, `temperature`, `waist`, `peak_flow`.
- Medications: `active_meds`, `doses_today`.
- Other things to track (shortcut tile): `sleep`, `meals`, `exercise`, `symptoms`, `mood`.
- Care: `labs`, `appointments`, `screenings` (a count on web, a shortcut on mobile), `messages`.
A key added here needs a destination on both surfaces (typed `Record`s force that) and a new migration (the table CHECK mirrors the list).

## Decisions
1. **One row per patient, an ordered text array** (`patient_home_layout.pinned`). A reorder is one atomic write. No row means "never customised" (show defaults); an empty array means "chose to show nothing".
2. **Only the patient's own account has a layout.** RLS lets a patient read and write only their own row. A supporter acting for someone else sees that person's defaults and has no Customise control.
3. **Some pins cannot be removed.** `doses_today` for anyone with an active medication, and the tile for each vital the patient's enrolled chronic programme monitors (`chronic_condition_programmes.monitoring_vitals`, for example blood pressure for hypertension). The database cannot know this, so both apps add them back on every read and again on every save. Rule lives in `lockedHomePins`. A save refuses if either input could not be read.
4. **No invented numbers.** A vitals tile with no reading says "No reading yet". Pulse, oxygen and temperature never take a wearable's estimate (same rule as the BP tile). Blood pressure and glucose keep their existing sources and the reader's glucose unit.
5. **Display preference only.** No clinical value is stored here, nothing is escalated from it, and the emergency and red-flag paths are untouched.
6. Registered in `data_registry` (operational, exported, proposed class pending CMO/DPO confirmation). The minor-dependant guard attaches itself on table creation.

7. **Failures are shown, not hidden.** A failed layout read shows the defaults but hides Customise (saving from the defaults would overwrite a layout we could not read). A failed vitals read shows "Couldn't load", never "No reading yet". A save refuses when the medication count cannot be read, so the lock never fails open on write. A rejected save request shows a message in the dialog.
8. **Unsaved defaults differ by surface.** Web gives a preventive-care patient one BP tile beside their screening tiles; mobile has always shown four tiles. Once a patient saves, the same list shows on both.
9. The CHECK in the migration is a copy of `HOME_PIN_KEYS`; `packages/shared/src/home-pins-migration.test.ts` fails if they drift.

## Files
- DB: `supabase/migrations/20261022002351_patient_home_layout.sql`, proof `packages/db/tests/patient_home_layout.sql` (registered in `ci.manifest`, includes a sabotage step).
- Shared: `packages/shared/src/home-pins.ts` (+ test), `database.types.ts` (this table only, spliced by hand), `packages/i18n/src/en.ts` (`home.pins.*`, `home.pin.*`).
- Web: `lib/patient/home-pins.ts`, `lib/patient/home-pin-targets.ts`, `(dashboard)/patient/home-pin-tiles.tsx`, `manage-home-pins.tsx`, `home-pins-actions.ts`, `(sections)/page.tsx`.
- Mobile: `lib/home-pins.ts`, `lib/home-pin-targets.ts`, `screens/sections/home-pin-tiles.tsx`, `manage-home-pins-sheet.tsx`, `overview-screen.tsx`, six new icons in `ui/kit/Icon.tsx`.

## Open items
- On **read**, the doses lock still depends on the summary stats; if that medications query fails the tile can drop for that load (the existing stats code reports 0). Fixing it means surfacing the stats failure, which is outside this change. The programme-vitals lock is read on its own, and on mobile Customise is hidden when that read fails.
- A preventive-care patient's `screenings` pin is not drawn on web because the fixed "Screenings due" tile already shows it; the pin still saves and shows on a care-plan layout.
- Up to six small vitals queries per render; one latest-per-type query would be cheaper.
- Mobile `screenings` is a shortcut, not a count, because the mobile summary stats carry no screening count.
- Mobile weight opens the Vitals section; web opens the Weight page.
- The migration has not been replayed against a fresh database or applied live; the SQL proof has not been run. Do both before merging, and check `list_migrations` on the live project for anything recent first.
- Not built: Track/Trends template for every vital, units beyond glucose, app-lock and settings regrouping (see the Samsung/Apple audit).
