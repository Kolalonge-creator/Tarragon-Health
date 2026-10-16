# Design note: an honest acknowledgement straight after every blood pressure reading

Written 2026-10-16 on `pr2/bp-immediate-acknowledgement` (stacked on `pr1/bp-wearable-estimate-exclusion`). Invariants: INV-06 (emergency guidance works offline: untouched), INV-07 (no clinical term in a notification: this is in-app screen text, not a notification), INV-16 (no number in code: this adds none). Rules from CLAUDE.md: never show a "reviewed by" claim without a `reviewed_by`/`reviewed_at` record; no response time that `escalation_slas` does not back; calm words, colour never carries the meaning.

## What exists (read, not assumed)
- Mobile: `logBpWithExtras` returns `saved`, `syncedAll`, `remaining`, `rejectedSupportCodes`. After a save the screen shows a 3-second toast ("Reading saved", or "Saved on this phone. It will send when you are back online.") and, from the on-device engine, the triage card (TRI-001 / TRI-003 / TRI-005 and the upper-arm advice) or the full-screen emergency guidance (EMG-001, with its own "not yet reached your care team" line when unsent). The recheck-after-5-minutes flow exists (`savePendingRecheck`, the recheck reminder, TRI-005).
- Web: online only. A saved reading shows "Reading logged." for every vital. A dropped connection already returns a friendly retryable error; an offline browser is blocked before submit.
- Signed wording: `activeWording(code)` / `messageKeyFor(code)` for EMG-001/001L, TRI-001/002/003/005/006. TRI-002 is signed without a review promise (OQ-251).

## The gap
The delivery fact ("on your phone only" versus "TarragonHealth has it") lived in a toast that disappears, and the web said nothing about the grade or the delivery.

## Decisions
1. **A pure state function, no new clinical words.** `bpAckDelivery(saveResult)` (packages/shared) returns exactly one of `received`, `waiting`, `refused`, `not_saved`. Order is the safe one: an error or nothing saved is never shown as saved; a refused row is never shown as waiting; only "everything reached the server" is received.
2. **Mobile**: a persistent line under Save, announced politely, in words only. Received: "Received by TarragonHealth. Your reading is saved in your record." Waiting: "Saved on this phone. It will send when you are back online. It has not reached TarragonHealth yet." Refused and not-saved add nothing, because the outbox refusal line (with the support code) or the save error is already on screen. The grade's next step stays exactly what the engine already shows (triage card or emergency guidance): that is the recheck-after-5-minutes flow, TRI-001/003/005 and EMG untouched, so there is no second source of guidance to drift.
3. **Web**: the action returns the display band of a saved blood pressure (`bpAckLevel`, from the existing display classifier; the database trigger still does the real escalation). The form says "Received by TarragonHealth. Your reading is saved in your record." then the signed wording for the band: within target TRI-001, a little above TRI-003, high and very high TRI-005 ("Check again in 5 minutes..."), unknown nothing more. Reused words, not new ones.
4. **Never**: that anyone has looked at it; any time to answer. A test scans every `bpack.*` string for review, clinician, time and digit words, and a web test pins the same for the composed line.
5. **Failure paths**: not saved (mobile save error, web action error), refused (support code), saved but the safety check did not finish (web: received plus the existing honest error), offline (mobile waiting; web blocked before submit, unchanged). All tested.

## Open (OQ-BPA-1 to OQ-BPA-3)
- The web has no emergency-symptom question and no on-device engine. For a very high band it shows TRI-005 (rest and measure again), which is the CMO-approved first step for 200/130 without a symptom, and relies on the server's emergency record (unchanged) for the rest. It does not show EMG-001, because EMG-001 assumes the symptom answer. Needs the CMO to say whether the web should ask the question too.
- The new sentences ("Received by TarragonHealth.", the note and the waiting note) are PROPOSED copy in a namespace outside the reviewed-strings ledger (as `hc.*` is); the CMO should read them.
- English only (founder, Pidgin removed): no second language added.

## Not run
No device or browser run: the mobile line and the web form were exercised only in Jest (component and pure tests). The browser journey `journey-2-red-reading-at-night` now waits for "Received by TarragonHealth." instead of "Reading logged." and was not run here.
