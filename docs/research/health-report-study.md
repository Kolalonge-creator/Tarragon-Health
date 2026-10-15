# Yearly Tarragon Health Report: competitor study and design (2026-10-07)

Feeds S46 (functions 3.15 and 3.16) and the S45 seams. Original design; competitors are studied for behaviour only.

**Evidence caveat.** Search was shallow. Two fetches returned HTTP 403 and no real Neko or Function report was seen. Tags: [1P] vendor page seen as a search snippet; [2P] third-party review; [U] unverified or background knowledge. Get a founder-held Function and Neko sample before copying any pattern, including the claims about Neko's body map and "body in numbers" visuals, which are NOT verified.

## What each product does

| Product | Report structure | Borderline handling | Critics |
|---|---|---|---|
| Neko Health | Same-visit scan, bloods, clinician talk-through, action plan; app marks areas normal, watchlist or next step [1P/2P] | A "watchlist" tier, explained live by a clinician | Whole-body screening not recommended for average-risk people (American College of Radiology); incidental findings, follow-up cascades; affluent self-selected cohort [2P] |
| Function Health | Biomarkers grouped by system, counted in range, out of range, other; trend per marker; clinician notes as strengths, watch areas, recommendations [2P] | Tighter "optimal" ranges flag clinically normal people [2P/inference] | Needs health literacy; no consult; add-on costs |
| InsideTracker | Three zones: at risk, normal, personal optimal; proprietary "InnerAge" [2P] | Most people land outside optimal by design | No published method for optimal zones |
| Whoop | Healthspan and Whoop Age from wearable data; Advanced Labs with clinician report [1P/2P] | n/a | No clinical benchmark; claims outrun sensors |
| Withings Year in Review | December timeline, only if enough data logged [2P] | None | Good "enough data" gate |
| NHS Health Check | One-page results card, risk percentage led, brief advice [2P] | None | A record more than a priority list [U] |
| Oura / Apple summaries | Year-in-review recaps, no clinical sign-off [U] | None | Celebratory framing, not clinical |

None of the six was seen offering offline use, audio or local-language text.

## Where Tarragon should differ
- No "optimal" tier, biological age, healthspan score or percentile of "people like you". Clinical ranges only, with the guideline cited.
- A named clinician signs; unsigned reports are invisible (spec acceptance test).
- Three priorities maximum, three states plus "not measured".
- Works on a basic phone and on paper in black and white.

## Twelve design principles
1. Lead with one sentence of meaning, not a score.
2. Maximum three priorities, each with action, why, who helps, when.
3. Three states plus "not measured": on target, needs attention, not checked. Words and icons, never colour alone.
4. Clinical ranges only; cite the guideline behind each target.
5. Every claim needs data; otherwise print "not measured this year".
6. Show uncertainty: repeat-test advice and one plain statement of what a result cannot tell.
7. Compare to your own last year, never to other people.
8. Screening done and due, one line each, with dates.
9. A real named clinician signs, with registration number; signing is the last step before release.
10. Plain language about grade 6, clinician-checked Pidgin (not machine translation), audio per section.
11. Low bandwidth: text first, under about 300 KB, simple bars, printable A4.
12. Consent-led sharing: expiring link, sensitive sections excluded by default.

## Proposed outline (2 to 4 printed pages)
1. Header and sign-off block (clinician, registration number, reviewed on)
2. Your year in one paragraph (English and Pidgin, audio)
3. Your three priorities for next year
4. Your risk band today, what it is based on, what was missing (uses the CMO-signed instrument)
5. Blood pressure: readings, target, trend, number of readings behind it
6. Lab results: value, lab range, status word, last year
7. What changed since last year (improved, same, worse, no comparison)
8. On target (only markers with data and a target)
9. Screening done and due
10. What this report cannot tell you: screening does not rule out disease (fixed wording, CMO-approved)
11. When to get help sooner (emergency signs)
12. How to share, print, or ask a question

## Honesty rules (enforced in code and tests)
- No "on target" without a recorded value inside the target window.
- Every BP summary shows reading count and date range; below the configured minimum it says "too few readings to judge".
- Hard cap of three priorities; the rest go to a collapsed "also worth knowing" list.
- Borderline shown as borderline with a recheck interval, never pass or fail.
- Unreviewed critical or abnormal findings follow the escalation pathway first; a report never delivers one as news. Sensitive positives (HIV, hepatitis B, hepatitis C) are never in the report text, audio or any AI explanation (INV-04).
- A result changed after signing creates a new version with a visible correction note.
- No streaks, rewards or "good job" on clinical items.
- Report stays hidden until signed (`health_reports.signed_by`, RLS).

## Risks
False reassurance from a clean report; alarm from borderline flags; clinician sign-off load (needs a drafted summary plus sampling audit, and any AI-drafted text is never saved to the record before signature, INV-11, and must be registered in `ai_systems`); Pidgin and audio accuracy for medical terms; a printed or shared report exposing HIV, reproductive or mental-health data (default-exclude, follow access-category rules); shared phones and low literacy.

## Build comparison to run in S46
Before building, obtain one real Function Health report and one Neko report sample (founder or a purchased account), place screenshots in `docs/research/` (private), and score our draft against the twelve principles using this checklist. Do not copy their layout or text.
