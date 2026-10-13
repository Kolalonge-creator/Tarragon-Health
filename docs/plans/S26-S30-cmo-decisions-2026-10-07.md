# S26 to S30: decisions selected 2026-10-07 (NOT SIGNED)

Status: selections made in chat by the founder/CMO from recommended options. Nothing here is signed. No signing RPC was run. Signing needs the full item text shown again and an explicit approval of that item, through the CMO sign-off path (`/clinician/clinical-signoff`).
Guideline references below were named from memory and are NOT checked against source text. Verify each before signing.
Source plan: `docs/research/S26-S30-competitor-review-and-build-plan.md`.

## Clinical items (CMO to sign)

| # | Item | Selected | PROPOSED values (config, not code) | Guideline basis to verify |
|---|---|---|---|---|
| 1 | Critical lab value (OQ-180) | Senior doctor only releases/acts; acknowledgement within 30 min | ack 30 min; escalate to on-call lead, then CMO at 60 min; patient told only a neutral message | ISO 15189 critical-result notification; UK RCPath/ACB critical-results guidance; MLSCN lab standards |
| 2 | Sensitive positive (HIV, HBsAg, HCV Ab) when patient unreachable (INV-04) | Never auto-release; escalate to CMO/clinical lead | 3 contact attempts over 7 days, then escalation; result stays withheld until a person discloses with counselling and linkage to care | WHO HIV testing services (5 Cs); Nigeria national HIV testing guidelines (NASCP/FMoH); WHO viral hepatitis testing; NDPA 2023 |
| 3 | Routine abnormal result review (INV-03) | Reminder at 1 working day; escalate to clinical lead at 2 working days; never auto-release | patient text "waiting for your care team, usually within 2 working days" | NHS England / RCPath test-result management and acknowledgement standards |
| 4 | Controlled medicines at the pharmacy counter (OQ-276) | Excluded at signing and refused again at the counter; approved repeats of ordinary medicines via partner list | uses the controlled list (OQ-170), which is itself unsigned and must be signed first | Dangerous Drugs Act / NDLEA Act; PCN Electronic Pharmacy Regulations 2026 (reported; counsel to read full text); WHO controlled-substances guidance |
| 5 | Care Circle alerts and pause (OQ-221, OQ-224) | Red alert to supporter immediate and neutral; no patient-first delay on red; check-in requests stay on during pause by default | optional 5 min patient-first window for non-emergency check-ins only (not yet decided to build) | NDPA 2023 explicit consent per permission; person-centred care guidance |

## Founder items (not CMO signature)

| # | Item | Selected |
|---|---|---|
| 6 | Gift window (OQ-225) | 14 days, then expiry and refund to payer; reminders to recipient at about day 3 and day 10 |
| 7 | Refunds and expiry (S26) | 14-day cooling-off if no paid doctor time used, Tarragon absorbs the Paystack fee; no pro-rata after the window; reminders at 30, 7, 1 days; 7-day read-only grace after expiry with one-tap renewal and no doctor time; refund status in days (up to 10 working days) with a reason if refused; never auto-renews |
| 8 | Clinician pay (S30) | Fixed fees only; consultation share stays 0 until Nigerian counsel answers on MDCN fee-splitting; pilot minimum needs an inactivity check; per-line dispute; withholding stored not calculated (D-09) |

## Still undecided from the plan
Which pharmacy to verify first; whether to close PR #993 and stale S26/S28 branches; backup on-call fee (OQ-179); hold-aging reminder values beyond item 3; the optional patient-first window in item 5; counsel one-pager (MDCN, 5% withholding, PCN, NDPA basis for supporter alerts); the CMO's own read of lab ranges v2 (`/clinician/lab-panels`, OQ-176) which is a separate sign-off.

## Next step
1. CMO reads each item's exact config text (to be generated per item in the build session), checks the guideline basis, and approves item by item in chat.
2. Only then is each signed through the existing sign-off RPC, one item at a time.
3. Record each signature in `docs/BUILD-PROGRESS.md` and close the matching OQ entries.
