# S46 comparison: the built yearly Health Report against the twelve principles and the competitor findings

Date 2026-10-07. Scored from the code and its tests, not from a screen review on a device.

**No real Neko Health or Function Health report sample was available** (the study's two fetches returned HTTP 403, and no founder-held sample or purchased account was supplied). Nothing below compares layout, wording or visuals with a real competitor report; the competitor column only restates what `docs/research/health-report-study.md` recorded from vendor snippets and third-party reviews, tagged as unverified there. Treat the competitor comparison as a checklist of behaviours to confirm against a real sample before launch, not as a finished benchmark. No competitor layout or text was copied.

Scale: Met (built and tested), Partly (built with a stated gap), Not met.

## Twelve principles

| # | Principle | Score | Evidence and gap |
|---|---|---|---|
| 1 | Lead with one sentence of meaning, not a score | Partly | The first section is "Your year in one paragraph", counts of on target, needs attention and not measured, no score. The paragraph is a template or a clinician's own text; the template is generic (counts), it does not yet say what matters most. |
| 2 | Maximum three priorities, each with action, why, who helps, when | Met | Composer cap plus a database constraint that refuses a fourth and a priority missing any of the four fields (proof). The "when" windows are PROPOSED settings values the CMO has not signed. |
| 3 | Three states plus not measured, words and icons | Partly | Four states with a word and a bracket symbol each; one honest extra, "recorded, no range given". Symbols are plain text so they survive a black-and-white print. |
| 4 | Clinical ranges only, cite the guideline | Partly | Lab ranges are the laboratory's own and BP uses the care team's target when one exists. The default BP target is PROPOSED and no guideline citation is printed yet (needs the CMO's source). No "optimal" tier exists, and the database refuses the word. |
| 5 | No claim without data | Met | "On target" needs a recorded value and enough readings, enforced in the composer and again by the database guard; an empty year says "not measured". |
| 6 | Show uncertainty: repeat advice and what a result cannot tell | Met | Borderline shows a recheck interval and is never on target; one-off results say one result alone does not tell us why; the fixed statement is on every report. |
| 7 | Compare with your own last year only | Met | Change is computed against the person's own previous year, units are never converted (a unit change says no comparison), and shared copies carry no population comparison. |
| 8 | Screening done and due, one line each, with dates | Met | Done and due lines with dates; blood-borne and sexual-health items are never listed. |
| 9 | A named clinician signs, with registration number | Met | Signer name and registration number are stored and printed; signing is the release step; unsigned reports are invisible to the patient (RLS, proof). |
| 10 | Grade 6 language, clinician-checked Pidgin, audio per section | Partly | Short plain English. English only by founder decision (Pidgin removed), so nothing to check there. No report audio: the audio seam has no clips and result audio is gated off for sensitive items. |
| 11 | Low bandwidth: text first, about 300 KB, printable A4 | Partly | Text-only page and a black-and-white A4 PDF with no images or fonts to load. Not measured on a real connection or checked on a printer in this session. |
| 12 | Consent-led sharing, sensitive sections excluded by default | Partly | A shared variant (`?variant=shared`) drops reproductive screening, the risk band and questionnaires unless named. HIV and hepatitis results are never in any copy. The expiring share link itself is S43's and is not wired. |

## Competitor behaviours (from the study, unverified)

| Finding in the study | Built here |
|---|---|
| Neko: a "watchlist" tier explained live by a clinician | No watchlist tier. Borderline is flagged with a recheck interval; a clinician signs and may edit the paragraph. |
| Function: counts in range and out of range, tighter "optimal" ranges | Counts yes; no optimal ranges, refused by the database. |
| InsideTracker: three zones and a proprietary age | No age, no zones. |
| Whoop: healthspan from wearable data | Not built; the report counts device readings by source only and judges nothing from steps, sleep or HRV. |
| Withings: a year review only when enough data is logged | BP has a minimum reading count; labs need a released result; an empty year says so. |
| NHS Health Check: risk percentage led | The risk band appears only when the S45 instrument is signed and enabled, otherwise "not assessed"; never a percentage. |
| None offered offline use, audio or local language text | Not offered here either (print and PDF only). |

## Gaps to close before launch
1. Obtain a real Function and Neko sample and re-score honestly.
2. CMO: BP target and margins, priority time windows, guideline citations, the fixed statement wording.
3. Check the PDF on a real A4 printer and the page on a slow phone connection.
4. Wire the expiring share link (S43) to the shared variant.
