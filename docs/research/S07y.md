# Research note: blood pressure taken at a pharmacy machine, and the paper diary (S07y)

Written 2026-10-20 on branch `feat/s07y-pharmacy-bp-and-paper-diary`, from `origin/main-dev` at `8f8724ac5`. Design: `docs/design/S07y-reading-labels-and-diary.md`. Open questions: `OQ-S07YL-1` to `OQ-S07YL-9` in `docs/OPEN-QUESTIONS.md`.

## 1. The two behaviours, as found

Many people in Nigeria check their blood pressure on a machine at a pharmacy, and many keep a handwritten diary of home blood pressure and sugar readings. Today the platform has no way to say "this reading came from a pharmacy machine", and no way to bring a paper diary into the record.

What exists (checked live on `koiplnmbgnqnbywhpjlf` on 2026-10-20, read only):

| Fact | Where it was read | Consequence |
|---|---|---|
| `vitals_readings.source` is `manual, device, wearable, cgm, fhir_import, photo_confirmed`. | `pg_enum` | There is no pharmacy value. |
| `vitals_readings` carries 28 triggers. | `pg_trigger` | See next row. |
| A new `vital_source` value would silently fall outside every trigger and view that keys on `source`: glucose triage fires for `manual` and `device` only, `stamp_manual_vitals_timestamp` clamps `taken_at` for `manual` only (a new value would allow backdating), the source lock is deny-by-default, the dedupe class is null. | `pg_get_functiondef` of the five functions; the same conclusion the assisted-entry build recorded on 2026-10-16 (PR #1185 design note) | Both labels ride on `source = 'manual'` and are a separate, frozen column. |
| A care-team clinic reading lives in its own table (`clinic_bp_readings`, S07x) so it can never page as a home reading. | S07x migration header | A pharmacy reading is different: the patient took it, it must be triaged like any reading, and it must fire the same engines. It is therefore the same table, with a label. |
| The 7-day home protocol (`private.home_bp_assess`) and the home average (`private.hbpm_average`, `private.bp_window_stats`) read `private.vitals_readings_diagnostic`, the view that already leaves out wearable estimates. | `pg_get_functiondef` (the S07x migration file text is stale: the live `home_bp_assess` reads the diagnostic view, and the first draft of this migration reverted that until a cuffless-estimate proof caught it) | The exclusion point is those three functions, with the label added to both views. |
| `stamp_manual_vitals_timestamp` keeps a manual reading's device time only inside 72 hours (`offline_sync_config`), otherwise server time. | live definition | A diary is by nature older than that. The window is widened for the diary label only, bounded, and the reading is refused outside it. |
| The S70a photo path (`photo_confirmed`) bounds its date only in the route (7 days), not in the database. | `/api/mobile/photo-readings/route.ts` | The diary bound is in the database trigger, so a hand-made request cannot get round it. |
| The S43 document capture (AI-018) is the existing pattern for "a model suggests, the person confirms, a rejected reading leaves nothing". It stores the photo and the suggestions on a row. | `docs/design/S43.md`, `apps/web/src/lib/document-capture/` | The diary reader takes the same pattern but stores nothing at all (no photo, no suggestion): the photo stays in the page, and only counts reach the audit trail. |
| Live `ai_systems` holds AI-001 to AI-020. | live query | The reader is AI-021, registered disabled and not runtime governed. |

## 2. How others handle this (what was reused, what was not)

- Home blood pressure guidance (the Nigerian hypertension guideline, sections 3.1.1, 3.2, 5.4.5, 6.2, 6.3, already cited in S07x) separates readings taken at home from readings taken in a clinic; the white-coat and masked comparison depends on that separation. A pharmacy machine is closer to a clinic setting than to home. This is why the label exists and why it is left out of the home average, the home check and the pattern comparison. The CMO has not signed C1 to C3, so the exclusion is recorded as a question (OQ-S07YL-1, -2, -3), not as a clinical ruling.
- Existing patient apps that read handwritten logs (printed-form scanners) treat the model output as a draft the person edits. The same rule holds here and is tested: a suggested row starts unchecked and can never become a reading.
- Reading digits from handwriting is error prone (1 and 7, 5 and 6, 0 and 6). That is why every row is shown beside the person's own photo, why a number that cannot be read is left empty rather than guessed, why a unit is never guessed from the size of a glucose number, and why a time such as "morning" is not turned into a clock time.

## 3. Phase B (a pharmacist records the reading at the counter)

Looked at and deliberately not built. The reasons are decisions the founder and the CMO must make, not engineering gaps (design note section 9; OQ-S07YL-8). In short: it creates a reading authored by a third party, it needs a licensed and verified pharmacy that is active (none is: OQ-274), and the assisted-entry build (PR #1185, open) is already adding a governed seam for exactly this (`private.pharmacy_assisted_entry_allowed`, returning false until its own open question is answered). Building a second seam beside it would split one decision in two.

## 4. Third-party code

None. No new package, no new native module, no change to `runtimeVersion`. `expo-image-picker` was already in `apps/mobile`.
