# Amendments to S01-S87 from the two-tier decisions (2026-10-08)

Source: founder decisions in chat on 2026-10-08, after the process map review (`docs/design/TWO-TIER-PROCESS-MAP.html`). Supersedes the 100,000 naira figure and the 80k/70k/60k organisation tiers in `docs/MEMBERSHIP_MODEL_PLAN.md`. Nothing here is applied, signed or merged. Read this before starting or resuming any session listed below.

## The decisions

| # | Decision |
|---|---|
| D1 | Two tiers only. Free: technology, no human time. Member: annual blood test plus about monthly doctor follow-up. Preventive alerts go to both. |
| D2 | Price: **120,000 naira a year** individual (12,000,000 kobo). **100,000 naira** per organisation member (10,000,000 kobo). Volume tiers dropped (confirm flat). |
| D3 | A red event on a **Free** patient does **not** page a doctor. It shows the acknowledge-gated guidance and notifies the emergency contact. A **Member** red event pages as today. |
| D4 | Monthly follow-up: the **doctor posts several available dates and times and the patient picks one**. |
| D5 | Annual panel includes **HIV and hepatitis**. Founder wrote hepatitis B; earlier notes said C. **Confirm B, C or both.** |
| D6 | Individuals join **testing days listed on the platform with locations**. **Employers get an on-site visit** from the Tarragon team. |

## What changes in each session

| Session | Change | Status of the session's own work |
|---|---|---|
| S25 catalogue, prices, orders | Re-price `membership_annual` to 12,000,000 kobo via a new `prices` row (prices are versioned; never edit the old row). Add an organisation price of 10,000,000 kobo. Seed currently says 10,000,000 and says "100,000 naira founder confirmed 2026-10-05". | Merged; item inactive |
| S73 pricing engine, S71/S72 checkout | Carry two price points (individual, organisation member). Remove any volume-tier logic. Old bundles stay non-sellable, not repriced. | Not built |
| S79 institution console, employer module | Benefit package uses the 100,000 price. Add on-site visit scheduling (D6): date, location, headcount, team, lab courier. Aggregate-only access stays (rule I9). | Not built |
| S19 red event paging, S12 triage wiring | `create_red_page` must check active Membership before paging. Free: guidance plus emergency contact only, still logged as a triage event. Add a proof with a Free patient (no page) and a Member (page), plus a sabotage step. Revisit INV-05 wording: the rule becomes "a red event never waits for a pull" for members; Free is guidance-only by founder decision. Record as an OQ against INV-05. | Built, not applied |
| S21 booking, S18 availability, S65 consultations | New flow: clinician publishes several offered slots, patient picks one, booking confirms. Reuses `availability_blocks`, `hold_appointment_slot`, `confirm_appointment_booking`. Entitlement: 12 monthly follow-ups, and a nudge when a month passes with none booked. | S21 merged; flow not built |
| S27 / S27g lab panel, S45/S46 screening | **Correction 2026-10-09:** `hiv_screen`, `hbsag` and `hcv_ab` are already in `membership_annual` v1 on main-dev (S27g). No new analytes are needed; the work is the CMO signature on the panel version and making sure no rule treats them as risk-based. HIV is a sensitive positive: stays `clinician_disclosure_required`, told in person. New draft sign-off for the CMO; nothing auto-releases until signed. Remove HIV/HCV risk-based logic from S45/S46 for Members, keep it for Free guidance only if wanted. Conflicts with the CMO's earlier risk-based decision: log as an OQ. | S27g merged; v3 not drafted |
| S74 partner network, S27 lab orders | Testing-day listing: date, location, capacity, lab, team. Member signs up, attends, sample is labelled to the lab order. Group screening days (`20260829003735_group_screening_days.sql`) may be reused. | Not built |
| S29 Care Circle | A Member's supporter can buy or gift at 120,000. Gift window stays 14 days. | Built |
| S26 entitlements and refunds | 365-day entitlement at the new price. Refund rule unchanged (14 days). | Built |
| S38 analytics, S75 | Member vs Free split in outcome snapshots; no cell under 20. | S38 in progress |

## Open questions raised

1. Hepatitis B, C or both (D5)?
2. Organisation price flat at 100,000, or a volume tier below it?
3. D3 weakens INV-05 for Free patients. Founder decided it; CMO and DPO should be told, and the Free guidance text must say plainly that no doctor has been alerted.
4. D5 reverses the CMO's risk-based HIV/HCV decision for the annual test. CMO to confirm in `docs/OPEN-QUESTIONS.md`.
5. On-site visit staffing and kit (POC analyser, ECG, phlebotomist) and who bears the cost at 100,000 a member.
6. Doctor capacity for monthly follow-up on every Member against the ratio under review.

## Not done yet

No migration, no code, no price change, no PR. Live payments are untouched.

## Update, same day: CMO decisions (the founder is the CMO)

| # | Decision |
|---|---|
| C1 | HIV and hepatitis tests are done **every year** in the annual panel, not risk-based. This replaces the earlier risk-based HIV/HCV decision for Members. Hepatitis B, C or both is still to be named; proposed default is HBsAg plus anti-HCV (both). |
| C2 | A red event on a Free patient never pages a doctor. This is a sustainability decision by the CMO. The patient is warned, told the next step, and **told in plain words that no doctor has been alerted because they are on the Free plan**. The Free path must still be complete without a doctor (see checklist below). |
| C3 | The 100,000 naira per organisation member is paid by the organisation. |
| C4 | Doctors work 8 hours a day, 5 days a week. Used for staffing below. |

### What the Free red-event path must contain (so Free is safe without a doctor)
1. Immediate acknowledge-gated message: what happened, what to do now, where to go (nearest facility prompt), and "call an ambulance or go now" wording for emergencies.
2. Plain statement: "A doctor has not been alerted. Doctor review is part of Membership." No fear wording, no dead end.
3. Emergency contact notified (no clinical content in the message).
4. Recheck prompt and a follow-up check-in after a set time ("did you get care?"); the answer is stored, never shown to a doctor on Free.
5. A one-tap path to buy Membership from that screen, never blocking the guidance.
6. Triage event still logged and counted for analytics; no `clinical_task`, no page, no clinician alert row.
7. Proofs: Free red gives no page and no task; Member red pages; the Free message contains the "no doctor alerted" sentence; sabotage the gate and the Member proof must fail.
8. Notify the DPO and legal: this changes the safety promise. Review the terms and the consent wording.

## Update 3, same day (CMO)

| # | Decision |
|---|---|
| C5 | **Every Member gets a monthly call**, healthy or not. No bi-monthly or async-only tier for healthy members. |
| C6 | Hepatitis testing is **both HBsAg (B) and anti-HCV (C)**, with HIV, every year. Closes the B-or-C question. |
| C7 | To implement: AI scribe (AI-017, stays off until the CMO runs the evaluations and signs), auto-release of all-normal results (stays off until the CMO signs the panel ranges, INV-14), and the 8-point Free red-event path. |
| C8 | **Decided (CMO): tiered call length.** Everyone gets a monthly call. 20 minutes for the yearly results call and for any Member with a condition or abnormal result; 10 to 15 minutes for routine months; the doctor may extend and a Member may ask for longer. The booking flow offers the length by need. A pre-call summary (vitals, results, medicines, changes) is shown to the doctor before every call. Planning ratio about 1 doctor per 350 Members. |

## Update 4, 2026-10-12 (CMO)

| # | Decision |
|---|---|
| C9 | ECG and urinalysis are part of the annual check (point of care, at testing days and employer visits). Vitamin D, ferritin and PSA are not added at point of care for now. |
| C10 | Organisation member price is flat 100,000 naira, adjustable from the admin dashboard (versioned price rows, audited, never an edit in place). |
| C11 | Build all of items 1 to 8 and the scale-readiness sessions SR1 to SR7 (`docs/plans/SCALE-READINESS-PLAN.md`). |
| C12 | AI scribe activation and auto-release signing are requested by the CMO. Activation follows the governance gate: the evaluation suites must actually run and pass, and the CMO reviews the results. Panel ranges are shown to the CMO before signing. |

## Update 5, 2026-10-12 (founder/CMO answers to the integration review)

| # | Decision |
|---|---|
| C13 | **Refunds:** a Membership can be refunded only within **21 days of purchase**; after that no refund. An approved refund ends Member access **immediately** (no 14-day grace). The 14-day grace applies only when a year ends naturally. |
| C14 | **Legacy programme holders** are converted into real Memberships (count first; no free year: they keep their existing end date). After conversion the legacy OR-clause in `patient_is_member` is removed, so Member means one thing. |
| C15 | A Member in the 14-day grace **can book** a follow-up. |
| C16 | **Prescription renewals are included** in the Member year. **Second opinions are an extra 5,000 naira each** (500,000 kobo), available to Members only. |

## Update 6, 2026-10-13 (CMO)

| # | Decision |
|---|---|
| C17 | **Sign-off authority:** only the CMO's signature is needed to go live. DPO and legal sign-off are optional (recommended). OQ-309 is not blocked on them. |
| C18 | **Renewals** are not a separate request: they are discussed and prescribed at the monthly doctor review. No standalone renewal route and no 28-day limit. |
| C19 | **Legacy holders:** all become Members. A holder with no end date gets a full 365 days from conversion. |
| C20 | **Terms:** the 21-day refund terms are checked against Nigerian law by a research draft; the owner (CMO and CEO) signs them personally. |
| C21 | **Marketing site shows only Free and Membership pricing.** No other prices anywhere public. Second opinion (5,000 naira) appears only in the signed-in Member app. |
| C22 | **Sign-offs by the CMO** (lab panel v2, urinalysis and HbA1c limits, service targets, AI scribe evaluations) are taken in this chat as pop-ups once the objects exist live. |

## Update 7, 2026-10-13 (owner answers on the terms)

| # | Decision |
|---|---|
| C23 | **Refund rule:** full refund within 21 days of purchase; after that no change-of-mind refund, but for non-delivery of the annual test or monthly calls the Member chooses a make-good or a pro-rata refund of the undelivered part. (Answers the FCCPA s.120/127/129 risk in `docs/legal/membership-terms-nigeria-review.md` on branch `legal/membership-terms`.) |
| C24 | **Organisation-paid Memberships:** only the organisation can claim the 21-day refund; the employee keeps the make-good right for non-delivery. |
