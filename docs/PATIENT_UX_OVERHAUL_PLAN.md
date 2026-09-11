# Patient UX Overhaul — plan (2026-09-11)

Goal: an ordinary Nigerian patient (not a tech-comfortable Lagos professional)
opens this app and knows what it is for, what to do first, and what their own
numbers mean. Web and native mobile must land the same change; neither is the
"real" one.

Baseline measured on `origin/main-dev` @ 4b222e7c, not assumed:
- 35 patient sidebar links in 5 bands (`lib/navigation.ts`), 33 mirrored into the
  mobile drawer (`apps/mobile/src/lib/sections.ts`).
- Overview renders ~15 stacked cards; on day 1 most self-hide or read "Not enough
  readings yet", and the last thing on the page is an UpgradePrompt.
- Glucose is displayed in mmol/L everywhere. `glucoseUnit` is local form state
  defaulting to `mmol_l` on both web (`vitals-form.tsx:33`) and mobile
  (`vitals-screen.tsx:393`). No stored per-patient display preference exists.
- No first-run orientation anywhere in the patient dashboard on either platform.

## 1. Glucose display unit (safety-adjacent — do first)

A Nigerian meter reads mg/dL. A patient types 110, the dashboard says 6.1, and
the diabetes hypo guidance says "below 3.9 mmol/L" — a number their meter will
never show.

- Migration: `profiles.glucose_display_unit`, CHECK in ('mg_dl','mmol_l'),
  NOT NULL DEFAULT 'mg_dl'. mg/dL is the Nigerian default, not the global one.
- `packages/shared`: `formatGlucose(mmolL, unit)` and `glucoseInputToMmolL`,
  built on the existing `mgDlToMmolL`/`mmolLToMgDl`. Storage stays mmol/L —
  this is a display and input-default concern only, no data migration.
- Web read sites: Overview stat tile, `vitals-trend-chart`, `glucose-insights`,
  `cgm-card`, `diabetes-guidance` (thresholds too), `medication-effectiveness-card`,
  `vitals-history`.
- Both write sites default the unit selector to the stored preference.
- Setting lives on Profile, both platforms.

## 2. Navigation: "Everyday" vs "Everything else"

35 links with no default hierarchy is a directory, not a menu. Nothing is
deleted; the default view stops being 35 items.

- Add `everyday?: boolean` to `NavItem` / mobile `Section`.
- Everyday (6): Overview, Vitals & symptoms, Medications, Labs & results,
  Messages, Appointments. These are the six real jobs.
- The existing four bands move behind one "Everything else" expander, still
  grouped and labelled exactly as now. Expanded state remembered per device.
- Mobile drawer gets the same split. Bottom tab bar is unchanged (already right).

## 3. Day-1 Overview

- `GetStartedCard`: renders while the patient has no vitals, no medications and
  no risk assessment. Three numbered steps, each a real link.
- While in that state, suppress the empty stat-tile grid and the analytic cards
  that can only say "not enough data yet".
- The UpgradePrompt does not render on a first-ever visit.
- Mobile overview gets the same card and the same suppression.

## 4. Post-onboarding welcome

`ReadyNotice` currently explains pricing well and explains what to *do* not at
all. Add a short "what happens next" — three lines, one Start button — so the
first dashboard is not the first explanation.

## 5. Pidgin labels — PLANNED, NOT BUILT

Reverses a recorded founder decision (English-only, 2026-08-03) and needs an
i18n layer neither app has. Scoped here, held for an explicit founder go-ahead:
a label-level toggle over the ~30 highest-traffic strings, not full
localisation, and never over clinical guidance text.
