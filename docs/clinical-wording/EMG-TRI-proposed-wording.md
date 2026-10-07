# EMG and TRI wording (SIGNED by the founder 2026-10-07, OQ-203)

Status: **SIGNED 2026-10-07 by the founder (Kola Longe), version 1, all seven codes as written below, on the founder's own instruction. Recorded in `clinical-wording.json`.** This is the founder's sign-off, not a CMO signature; the CMO can re-sign by raising `version`. English only (D-14).

Rule: the screen text and the audio script are the same sentences, from one file (`packages/i18n/src/clinical-wording.json`). A voice says digits as words ("5" as "five").

House rules applied: "your care team", never "your doctor"; no cure promise; no em dashes; short sentences.

## Changes from the first draft, and why
- **"Your care team has been told" is removed** from the red messages. It is untrue on the Free plan (no clinician is paged) and for a reading not yet synced.
- **No phone number in EMG-001.** A guard test and OQ-87 say the text prints none until a number is confirmed. The optional sentence "If you cannot get there, call 112." is held back; add it only if the CMO confirms 112.
- **TRI-002 promises no review** (OQ-251): Free plan patients get no clinician review.

## Proposed text (what the file holds as `proposed`)
| Code | Title | Body |
|---|---|---|
| EMG-001 | Get help now | Your reading and how you feel mean you need care now. Go to the nearest hospital, or ask someone to take you. Do not drive yourself. Tell them your blood pressure and your symptoms. |
| EMG-001L | Sit or lie down, then get help | Sit or lie down now, and raise your legs if you can. Go to the nearest hospital, or ask someone to take you. Stand up slowly and do not drive yourself. |
| TRI-001 | Within your target | This reading is within your target. Well done. Keep checking at the times you planned. |
| TRI-002 | Higher than your target | This reading is higher than your target. Rest, then check again at your next time. If you feel unwell or worse, go to the nearest hospital. |
| TRI-003 | A little above your target | This reading is a little above your target. This is not an emergency. Rest, take your medicines as planned, and check again at your next time. If it stays high over the next few days, book a review with your care team. If you feel unwell, go to the nearest hospital. |
| TRI-005 | Check again in 5 minutes | Sit quietly for 5 minutes with your arm supported. Then measure once more and save it. |
| TRI-006 | That reading does not look right | That reading does not look right. Check the numbers you typed, or measure again. |

## Decisions taken at sign-off
1. No phone number in EMG-001; "call 112" not added (OQ-87 stays).
2. TRI-002 without a review promise, for everyone (OQ-251).
3. Still to do: add EMG-001L to the Audio Production List document so it is recorded in order.

## How to sign
A person (not a build) edits `packages/i18n/src/clinical-wording.json` and sets `"signed": {"by": "<CMO name>", "on": "YYYY-MM-DD", "version": 1}`, then re-runs `scripts/audio/import-production-list.py`. Until then `current` (today's text) is in force; a test checks both states.

## Sign-off record
| Code | Signed by | Date |
|---|---|---|
| EMG-001 | Kola Longe, founder | 2026-10-07 |
| EMG-001L | Kola Longe, founder | 2026-10-07 |
| TRI-001 | Kola Longe, founder | 2026-10-07 |
| TRI-002 | Kola Longe, founder | 2026-10-07 |
| TRI-003 | Kola Longe, founder | 2026-10-07 |
| TRI-005 | Kola Longe, founder | 2026-10-07 |
| TRI-006 | Kola Longe, founder | 2026-10-07 |
