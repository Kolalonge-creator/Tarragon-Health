# S07y-cuff-guidance design note: cuff guidance, the pre-visit summary, and the OQ-67 comparison report

Written 2026-10-20 on `s07y/bp-cuff-and-visit-summary`, off `origin/main-dev` (8f8724ac5). Research and sources: `docs/research/S07y.md`. Builds on S07x (`docs/design/S07x.md`) and S12b. Invariants: INV-01 (no model), INV-07 (nothing here reaches a notification), INV-14 (born off), INV-16 (numbers in a signed, versioned row).

## What was built

1. **Governed cuff guidance** (`bp_cuff_guidance_signoffs`, the shared single-active-row shape, v1 seeded UNSIGNED and INACTIVE). `sign_bp_cuff_guidance()` is CMO-only. It is registered in `GOVERNED_CONFIG_TABLES`, the sign-off queue, the refuse-superseded guard (DB trigger and app), the hub panel and a CMO page, and read-only on the admin side, so an unsigned draft shows on the CMO hub like every other governed config. `public.my_bp_cuff_guidance()` returns null until it is signed, and `record_my_bp_cuff()` refuses (55000): the phone shows no cuff-size step and nothing is recorded. The wording is `hc.cuff.*` in `packages/i18n`; the numbers are in versioned PROPOSED config `bp.cuff_sizing` (mirrored by test). The older C4 guide (six lines) is unchanged and still gated by its own attestation; the new size step lives inside it.
2. **The patient's cuff** (`patient_bp_cuffs`, append-only): cuff type (the same three values as `vitals_readings.cuff_type`, S12b; a closing assertion and a proof check keep them equal), an optional model and an optional arm measurement. The phone's BP form starts from the recorded cuff type (she can still change it per reading). Staff read it through the S39 tie.
3. **Validated-device list**: no new table. `device_catalog` (S70a) already is that table (evidence columns, CMO-only review, `recommended_devices()`, module `device_recommended_list`). Added: an admin editor (`/admin/settings/recommended-devices`) and a CMO review page (`/clinician/recommended-devices`) with a hub line, and `private.bp_cuff_model_listing()` which answers `listed`, `not_listed` or `list_empty`. Born with no reviewed row; none is seeded.
4. **Bring this to your visit** (`/api/patient/bp-monthly-summary/pdf?kind=visit`): the existing route gained a `kind` parameter. 7-day home average only when the programme gate is met, doses marked taken (the S08x function), symptoms she ticked; no grade, no colour, no lab, no clinician-only fact. Signed-in patient only, own rows only, a failed read is a 503 and never a page of zeros, and the download is written to her access log (`log_patient_data_export('bp_visit_summary')`). Linked from the existing "Report for your visit" card.
5. **OQ-67 evidence**: `public.bp_band_divergence_report(days)` (admin or active clinical director; aggregates; test accounts excluded) and a read-only page for each. No band or threshold changed. Findings and the decision needed are written under OQ-67 in `docs/OPEN-QUESTIONS.md`.

## Decisions made without asking (reversible)
- The pre-visit average uses the SIGNED programme's gate (stricter than the trend card), see the research note section 3. With no signed programme it shows no average (it never falls back to the proposed values). It counts only manual and device readings (what the server counts) and only symptoms the patient entered.
- The size lookup rounds to a whole centimetre.
- The report re-derives the pipeline level from stored readings rather than reading alerts back, because alerts are plan-gated and merged; the limits are in the function comment and on the page.

## Not done
- The cuff size step on the web. The home check card is phone-only today (S07x); there is no web card to add it to.
- Anything on a device (see the progress log).
