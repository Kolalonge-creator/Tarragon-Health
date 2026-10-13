# Ranked design plan (from the three competitor reviews), 2026-10-06

Sources: `S29-design-review-care-circle.md` (CC), `S29-design-review-checkout.md` (CK), `S29-design-review-patient-app.md` (PA); the summary is `S29-best-design-synthesis.md`. Caveat that applies to every line: the reviews rest on search snippets, not full page reads, and most Nigerian competitors had no public pages, so each item is a lead to confirm before it is built.

## How the ranking works
Score = safety first, then legal and trust, then retention and revenue, then cost to build. A safety item that is cheap goes first. A big item stays high only if it protects someone.
Effort: S = under a day, M = a few days, L = a session or more. "Decision" = needs you before building.

## Tier 1: safety and trust (do first)
| Rank | Change | Source | Effort | Decision | Where it goes |
|---|---|---|---|---|---|
| 1 | Prove the red-result path works fully offline, with an honest "we could not reach your care team, call now" fallback | PA 1 | M | no | S12 follow-up (device test on a real phone) |
| 2 | Warn the patient 14 and 3 days before a supporter's access ends; renew only on the patient's tap (today one notice at 7 days) | CC 4, CK 5 | S | no | S29 follow-up |
| 3 | One-tap "pause all sharing" for 7 days, silent to supporters, no reason | CC 3 | S | no | S29 follow-up |
| 4 | "See what my supporter sees" preview on the invite form and each member | CC 2 | S | no | S29 follow-up |
| 5 | Calm, specific wording for high readings so fear does not stop people measuring | PA 2 | S | CMO to approve the words | S07/S12 copy |
| 6 | Shared-phone mode: PIN on open, per-person profiles, hide the last reading | PA 4 | L | no | new session (S34 area) |
| 7 | Discreet mode that also covers the app name, email subjects and lock screen, not only notifications | PA 5 | M | no | S13 follow-up |
| 8 | Payer screen and receipt state "you see no health information"; consent withdrawal as visible as granting it | CC 8 | S | no | S29 follow-up |

## Tier 2: money, refunds and the legal promise
| Rank | Change | Source | Effort | Decision | Where it goes |
|---|---|---|---|---|---|
| 9 | Refund and cancellation rule in plain words on checkout and the receipt (FCCPA expects refund limits in writing) | CK 1 | S | counsel wording | S25 follow-up |
| 10 | Pending is normal for transfer and USSD: keep the reconcile sweep running for hours and show "we have your payment" | CK 3 | S | no | S25 follow-up |
| 11 | Cooling-off window (14 days, full refund if no paid doctor time used; the Paystack fee is not returned, so Tarragon bears it) | CK 2 | M | YES (policy and cost) | S26 follow-up |
| 12 | Refund promise in days ("up to 10 working days") and a message at each step | CK 4 | S | no | S26 follow-up |
| 13 | Refund requests get a service level, a stated reason on denial, and weekly reconciliation against Paystack refund status | CK 10 | M | SLA number | S26 follow-up |
| 14 | Reminders at 30, 7 and 1 day before expiry, each with the end date and a renew link | CK 5 | S | no | S26 follow-up |
| 15 | Gift guards: confirm the recipient's name before paying; masked payer name until accepted; unanswered gifts expire in 14 days (config value `gift_decide_days`) with automatic refund | CC 10, CK 7 | S | 14 vs 30 days | S29 follow-up |
| 16 | Warn payers on non-Nigerian cards about the international rate (about 3.9% plus 100 naira) and give declined-card and bank-transfer help | CC 7, CK 8 | S | no | S25 copy |

## Tier 3: keeps the supporter engaged without harm
| Rank | Change | Source | Effort | Decision | Where it goes |
|---|---|---|---|---|---|
| 17 | Supporter alert controls (quiet hours, digest), an in-app "needs attention" badge as backup to push | CC 5 | M | no | S29 follow-up |
| 18 | One-tap "I called them" on a red alert (single status, no free text) | CC 6 | S | no | S29 follow-up |
| 19 | 7-day grace after expiry for record access and one-tap renewal, no free doctor time | CK 6 | M | YES (what "access" includes) | S26 follow-up |
| 20 | Pro-rata refunds after the window or on a part-used care pack, to the original payment method, never as credit | CK 9 | M | YES; start with "none after the window" | S26 follow-up |

## Tier 4: everyday patient experience (outside S29; goes into later plans)
| Rank | Change | Source | Effort | Where it goes |
|---|---|---|---|---|
| 21 | Data meter, and low-data mode earlier than S34 | PA 6 | M | S34 |
| 22 | Cuff step (brand and model, "recommended" or "not checked") that never blocks logging; recommended-cuff or loan guidance | PA 3, 11 | M | S07 follow-up |
| 23 | 30 to 60 second audio clips with transcripts, downloaded only after asking, quiet-play option | PA 7 | L | S32 to S33 |
| 24 | Reward logging, never the number; "welcome back" instead of streak penalties | PA 8 | S | S07 copy |
| 25 | One-page shareable visit summary for clinics outside our network | PA 9 | M | S35 area |
| 26 | Contact preferences (call window, backup person); named lead clinician with honest reply times | PA 10 | M | S18 follow-up |

## Considered and not recommended
- A second factor for the invite link (an emailed or texted code on the supporter's device). Adds a send path (OQ-190 chose patient-shared links); the link is already bound to a verified contact, single use and 72 hours. Revisit only if forwarded links show up in practice.
- Telling the payer when a patient declines a gift (CK 7). We keep "tell nothing"; the payer hears only that a refund is on its way. A decline message can cause conflict at home.
- A downloadable consent trail (CC 9) beyond the existing "who looked" list: build only if counsel asks.
- Anything that stores a balance, sends platform SMS or WhatsApp, or shows a supporter readings or condition names (PA 12 agrees).

## Suggested build order
1. **S29 follow-up pack (items 2, 3, 4, 8, 15, 17, 18):** all small, same screens and migrations, one proof extension. About a session.
2. **S25/S26 copy and reminder pass (items 9, 10, 12, 14, 16):** after #945 and #955 are on `main-dev`.
3. **Your decisions:** items 11, 13, 19, 20 and the 14-versus-30-day gift window (15), plus the CMO's wording for item 5.
4. **Separate sessions:** item 1 (offline red path, needs a real device), item 6 (shared-phone mode), item 7 (discreet mode), then Tier 4.

## Status (2026-10-06): S29 follow-up pack built
Items 2, 3, 4, 8, 15, 17 and 18 are built on `s29/care-circle` (migration `20261006214127_s29c_care_circle_followup.sql`, not yet applied to production). Deviations: item 17 has no quiet hours or digest (a time window could hide a red alert; a supporter can only drop the push); item 15 keeps the 30-day gift window until the founder chooses 14 or 30, and the gift is now the full yearly Membership only (founder, 2026-10-06, OQ-225). Item 3's "pause check-in requests too" default is OQ-224. See `docs/BUILD-PROGRESS.md`, "S29c".
