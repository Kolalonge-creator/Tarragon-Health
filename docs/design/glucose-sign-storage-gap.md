# Glucose warning signs stored on the server

Closes open question 1 of `docs/design/S11-S15-glucose-closeout.md`. Branch `fix/glucose-signs-server-storage`. Nothing applied, deployed, signed or merged.

## The gap
The glucose entry offers nine warning signs. They grade on the phone, but the server only saw the four that already had a symptom type, and the phone did not even send those, so the server's glucose context never held a sign from a phone entry. GL-R2, GL-R3, GL-R5 and GL-R7 could not fire on the server from a phone entry.

## Which signs had no `symptom_type`
Checked against the live enum (24 values, 2026-10-15). `convulsion` and `loss_of_consciousness` already exist (pregnancy work), so only three signs were truly missing:

| Sign (engine code) | Stored as | Status |
|---|---|---|
| confusion | confusion | existed |
| seizure | convulsion | existed |
| unconscious | loss_of_consciousness | existed |
| cannot_swallow | cannot_swallow | NEW value |
| vomiting | vomiting | NEW value |
| abdominal_pain | abdominal_pain | NEW value |
| fast_breathing | breathlessness | existed |
| drowsiness | lethargy | existed |
| very_thirsty_cannot_keep_fluids | dehydration_signs | existed |

(The closeout said five; two of the five already existed.) One table in `packages/clinical/src/glucose-signs.ts` is read by the phone; a Jest test reads the migration and fails if the file and the table drift.

## Migrations (apply in file order, each alone)
1. `20261015002852_glucose_signs_symptom_type_vomiting.sql`, 2. `..2854_..._abdominal_pain.sql`, 3. `..2856_..._cannot_swallow.sql`: one `alter type ... add value` each, nothing else (a new enum value cannot be used in the transaction that adds it).
4. `20261015002922_glucose_signs_context_mapping.sql`: rewrites `triage_context_for_glucose_observation` (mapping) and `private.emit_glucose_symptom_regrade` (the list of types that re-grade a reading when a sign arrives after it), each starting from its live definition. Ends in assertions. No threshold, rule or wording changes.

## The older symptom trigger (the stop condition)
Read live: `private.handle_symptom_red_flag` pages on SEVERITY, not on type: a row at severity 8 or more is a red flag, and a row at 5 or more raises a clinician alert, for any symptom type, including the new ones. So a new type would page if the phone stored it at the severity blood pressure uses (6). It is not touched. Instead the phone stores a glucose tick at severity 3 (`glucose.symptom_checklist`, proposed config, CMO to confirm; the loader refuses 5 or more). At 4 the older trigger raises nothing (proved: not a red flag, no clinician alert, no emergency event), so the governed glucose engine is the only place a glucose sign pages. Consequence to know: until the CMO signs the glucose rules, a Level 3 sign ticked on the phone shows the emergency guidance on the device (unchanged) and is a danger row in the outbox (one-hour "not reached your care team" notice), but the server pages from the older glucose-reading backstop only, not from the sign.

Correction after review: the older trigger also pages `lethargy` and `dehydration_signs` from severity 3 in a child under 5, and two glucose signs (drowsiness, very thirsty) map onto those. So the stored severity is 3 (config max 3, refused above), proved for an adult and for a 3 year old, with a control row at severity 3 showing the trigger would have paged.

## Known limits (accepted, say so to the CMO)
- **Interim: a Level 3 sign pages no one on the server until the glucose rules are signed.** It shows the emergency guidance on the phone, is a danger row (one-hour "not reached your care team" notice) and is stored; the server pages from the older glucose-reading backstop only. The alternative (a stored severity of 5 or more) would make the older trigger page on any glucose tick, vomiting included, which is the side effect this work was told not to ship. Decision for the lead or CMO if an interim server page is wanted.
- **Ten minute window.** A sign counts for a reading when the server received both within 10 minutes (the existing rule for the four signs that already mapped). A sign ticked on one entry also counts for a recheck 6 minutes later; a sign held offline for more than 10 minutes after its reading is stored but does not re-grade it.
- **Shared types.** `confusion`, `breathlessness`, `convulsion`, `loss_of_consciousness` are also read by the blood pressure engine's context (as blood pressure ticks already are), so a glucose-form tick within 10 minutes of a BP reading is seen there too (for example BP-P6 in pregnancy). Not separated: a seizure or unresponsiveness should be seen by both.
- A reading that fails validation with a sign ticked stores nothing on the server (guidance still shows on the phone).
- The migrations' versions are the filenames; apply by merge (auto-apply) or pin the version with `execute_sql`, and check `list_migrations` for anything newer first (2026-10-15: latest live was `20261014234345`).

## Phone
`saveGlucoseSigns` (glucose-log.ts) writes one symptom row per ticked sign into the offline outbox before the reading is sent: idempotent by client id (unique `(patient_id, client_id)` already on `symptoms`), held offline, Level 3 signs are danger rows, a refused row stays listed with a support code. A failure to save on the phone is reported with a toast and never blocks the reading. History labels added for the three values.

## Not done
- The web glucose entry has no sign chips and no on-device grading (only the ketone form), so there is nothing ticked on the web to store. Adding the chips to the web form is a separate piece of UI work.
- A reading rejected as invalid with a sign ticked stores nothing on the server (unchanged; the guidance still shows on the phone).
- The proof runs after the migrations. On a database where the three values are not live yet it swaps the enum type inside its own transaction (drops and recreates the one dependent view); proved on the live project that way inside `begin/rollback`, nothing left behind.
- The engine's own answer per sign is pinned in Jest (`glucose-signs-grading.test.ts`); the SQL proof emulates the processor with those rule ids against the draft rule set.
