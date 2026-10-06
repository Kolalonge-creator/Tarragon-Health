# Best design: what the competitor research says to change (2026-10-06)

Built from three reviews in this folder: `S29-design-review-care-circle.md`, `S29-design-review-checkout.md`, `S29-design-review-patient-app.md`. All three rest mostly on search snippets, not full page reads, and many Nigerian competitors (Clafiya, Helium, mPharma, Reliance, Hygeia, Wellahealth, Healthtracka) had no public pages, so treat each line as a lead to confirm, not a fact. Nothing here is built yet.

## Verdict
The Care Circle design already matches or beats market practice on the invite link, default-off permissions, neutral alerts, the "who looked" list and the payer firewall (a payer sees no health data). The gaps are around consent preview, pausing, expiry warnings, alert load, payer fallbacks, the refund promise, and the daily-use basics (shared phones, discreet mode, low data).

## Build now (small, safe, no founder decision needed)
| # | Change | Why | Where |
|---|---|---|---|
| 1 | Warn the patient 14 and 3 days before a supporter's access ends (today: one notice at 7 days); renewal only on the patient's tap | A red-alert recipient must not lapse silently | S29 follow-up |
| 2 | "See what my supporter sees" preview on the invite form and on each member | Informed consent; no competitor does it well | S29 follow-up |
| 3 | One-tap "pause all sharing" for 7 days: no reason, no alert to supporters | Guards against coerced family control; silent by design | S29 follow-up |
| 4 | Supporter alert controls (quiet hours, digest) and an in-app "needs attention" badge as backup to push | Alert fatigue and missed push on cheap phones | S29 follow-up |
| 5 | One-tap "I called them" on a red alert (single status, no free text) | Closes the loop without exposing anything clinical | S29 follow-up |
| 6 | Payer screen and receipt say plainly "you see no health information"; consent withdrawal as visible as granting | NDPA, trust | S29 follow-up |
| 7 | Gift guards: confirm the recipient's name before paying; masked payer name until accepted | Wrong-recipient risk | S29 follow-up |
| 8 | Checkout and receipt state the refund and cancellation rule in plain words (FCCPA expects refund limits in writing) | Legal and trust | S25/S26 follow-up |
| 9 | Pending is normal for transfer and USSD: keep the reconcile sweep going for hours and show "we have your payment" | Debited-but-not-active patients | S25 follow-up |
| 10 | Refund promise in days ("up to 10 working days") and a message at each step | Banks take 5 to 10 days | S26 follow-up |
| 11 | Expiry reminders at 30, 7 and 1 day, each with the end date and a renew link (today: 7 days only) | Renewal | S26 follow-up |

## Needs a founder decision first
| # | Question | Recommendation |
|---|---|---|
| A | A second factor for the invite link (an emailed or texted code on the supporter's device)? INV-08 bars platform SMS except sign-in codes, and an email code adds a send path (OQ-190 chose patient-shared links only) | Skip for now: the link is already bound to a verified contact, single use, 72 hours. Revisit if links are forwarded in practice |
| B | Tell the PAYER when the patient declines a gift? The checkout review says yes; we decided no, to avoid conflict at home | Keep "tell nothing" on a decline; tell the payer only that a refund is on its way |
| C | Cooling-off window: 14 days from payment, full refund if no paid doctor time was used (the Paystack fee is not returned, so Tarragon bears it) | Yes, but it is a policy and cost call; needs your number and counsel |
| D | Gift auto-expiry: shorten from 30 to 14 days with automatic refund | Yes (cheap, one config value `gift_decide_days`) |
| E | 7-day grace after expiry for record access and one-tap renewal, without free doctor time | Yes, but confirm what "record access" includes |
| F | Pro-rata refunds after the window or on a part-used care pack, always to the original payment method, never as credit (INV-09) | Publish "none after the window" first; add pro-rata only if asked |
| G | Warn payers on non-Nigerian cards about the international rate (about 3.9% plus 100 naira) before Paystack | Yes, copy only |

## Whole patient app (mostly outside S29; add to the plan)
Ranked: (1) prove the red-result path works fully offline, with an honest "we could not reach your care team, call now" fallback, which no competitor shows; (2) calm, specific wording for high readings so fear does not stop measuring; (3) a cuff step (brand and model, "recommended" or "not checked") that never blocks logging; (4) shared-phone mode: PIN on open, per-person profiles, hide the last reading; (5) discreet mode that also covers the app name, email subjects and lock screen; (6) a data meter, and low-data mode earlier than S34; (7) 30 to 60 second audio clips with transcripts, downloaded only after asking; (8) reward logging, never the number, and "welcome back" instead of streak penalties; (9) a one-page shareable visit summary for clinics outside our network; (10) contact preferences (call window, backup person) and honest reply times; (11) recommended-cuff or cuff-loan guidance (the NHS lends monitors); (12) keep Care Circle summaries-only and make any "tell my supporter" nudge opt-in and neutral.

## Where this disagrees with what is built
- Payer told on a decline: the checkout review says tell them; we chose not to (B above).
- The one-page consent summary (Care Circle review, change 9) overlaps the existing "who looked" list; build the printable summary only if counsel asks.
- Nothing in the research argues for storing a balance, platform SMS or WhatsApp; those stay out.

## Suggested order
1. Items 1, 2, 3 (expiry warnings, preview, pause) as one small S29 follow-up with proof tests.
2. Items 8 to 11 as an S25/S26 copy and reminder pass once #945 and #955 are on `main-dev`.
3. Founder decisions C, D, E, G.
4. The patient-app list goes into the S33 to S34 and Module plans, not S29.
