# Owner sign-off sheet: Membership terms (2026-10-13 draft)

For the owner (CEO and CMO), who signs as the responsible officer. Nothing here is published. The text is an AI-prepared draft, not legally certified. Read `membership-terms-nigeria-review.md` first for sources and counsel items.

## What changed (in `schedule-c-terms-of-service.md`)
- Two plans only: Free and Membership (120,000 naira per year, Paystack, an organisation may pay).
- What Membership includes and excludes, written plainly; second opinion 5,000 naira, Members only.
- 21-day refund, nothing after, except if we fail to deliver or the law requires a refund. Approved refund ends access at once. How to ask, how long it takes.
- New "If we do not deliver" remedy: the Member chooses a make-good or a pro-rata refund of the missing part.
- No auto-renewal, a reminder 30 days before the year ends, 14-day grace, then Free; records kept.
- New plain Free plan safety statement and an Emergencies section; the same Free wording added to the emergency part of Schedule B.
- Liability: nothing excluded that the law will not let us exclude; the old vague limit removed; no financial cap stated.
- Added complaints route (us, then FCCPC, NDPC, MDCN, courts). Stripe and WhatsApp mentions removed.
- Draft migration (not applied): `docs/legal/drafts/terms_of_service_membership_two_plan_DRAFT.sql` (kept out of supabase/migrations on purpose; copy it there with a fresh timestamp only when publishing) inserts a new `consent_versions` row (the table is `consent_versions`; there is no `legal_documents`). It refuses to run while any square bracket remains.

## The five riskiest clauses
1. **21 days, then nothing (Refunds).** May clash with FCCPA s.120 (reasonable cancellation fee only), s.127 (unfair terms) and s.129 (void terms). Your decision stands in the draft; counsel may require a sliding refund.
2. **Non-delivery remedy.** The "fair share" refund needs a published value for each part of the Membership (annual test, point-of-care checks, monthly calls). Not set yet. Without it the clause is vague, and vague terms are read against us.
3. **Refund ends access immediately.** Fair when the Member chose a refund. Needs counsel's view if a refund follows our own failure, and the CMO's view on safe handover of open prescriptions and follow-ups.
4. **Free plan: no doctor alerted.** A clinical and duty-of-care call you have already made. The legal question is only whether the notice is clear enough, and whether the platform entity needs extra registration.
5. **Liability wording and the sentence "withdraw consent at any time" beside "we keep your record".** The first must not exclude negligence liability (FCCPA s.129 and s.144). The second must not mislead: part of treatment records may rest on the medical-care basis (NDPA s.30(1)(g)), not consent alone. Retention periods in Schedule A are still unset.

## Owner decisions recorded 2026-10-13
- Refund rule confirmed as drafted: full refund within 21 days (access ends at once); after 21 days no change-of-mind refund; for non-delivery of the annual test or the monthly calls the Member chooses a make-good or a pro-rata refund of the undelivered part.
- Organisation-paid Memberships: only the organisation may claim the 21-day refund (it paid). The employee is told, has no payment relationship with Tarragon, and keeps the right to a make-good for non-delivery of the service itself. A pro-rata refund for non-delivery goes to the payer.
- Schedule B stale text fixed: one doctor tier plus the CMO; in-app and phone or video only; no WhatsApp; SMS for verification codes only.
- Signing: the owner signs as CMO and CEO. DPO and legal review is optional but recommended. Counsel items A to K in the review memo are kept as the list to put to a lawyer if one is used.

## Value allocation of the 120,000 naira: you must set this before publishing
The non-delivery refund needs a number for each part. **PROPOSED split, for you to react to (not decided):**

| Part | PROPOSED share | PROPOSED naira |
|---|---|---|
| Annual blood test, HIV/hepatitis screening and point-of-care checks | 40% | 48,000 |
| Monthly doctor follow-ups (12) and prescription renewals | 50% | 60,000 |
| Platform, record and records access (not refundable as undelivered) | 10% | 12,000 |
| Total | 100% | 120,000 |

So a missed monthly follow-up would be worth 5,000 naira (60,000 / 12); an undelivered annual test and checks, 48,000. The platform share is not refunded for non-delivery of the test or calls. Counsel item C asks whether a fair split must reflect real costs. Publish the final numbers on the Membership page.

## Before you sign: other decisions only you can make
- Deduct the cost of a test or check already taken from a 21-day refund? (Draft: no.)
- Insert the verified emergency number and the support and complaints addresses.
- Confirm or change the proposed times: reply in 5 working days, pay in 5 working days, complaints answered in 10.

## Steps to publish after you sign (do not do any of these before)
1. Counsel reviews the draft and the review memo; resolve every bracketed item in `schedule-c-terms-of-service.md` and delete the italic draft banner text that is not for patients. Update the version label.
2. You sign the sheet and note the date and your name in the repo (a short commit note or a signed PDF stored with the legal pack). The CMO and DPO are told of the Free plan wording (INV-05; amendments file decision C2).
3. Cut a PR into `main-dev` containing the final Schedule C, the Schedule B emergency change, and the marketing and checkout copy that repeats the refund rule and the Free statement (price, inclusions and refund rule must be on the payment screen before pay).
4. Replace the body in the draft migration with the final text, remove the DRAFT suffix from the file name, re-stamp the version from the clock after `list_migrations` (never a round number), and prove it on a local `supabase db reset`.
5. Apply to the live project `koiplnmbgnqnbywhpjlf` with `execute_sql` in a transaction, with the `schema_migrations` row at the file's version. Check exactly one current `terms_of_service` row and that the other two consent types are untouched.
6. Confirm the app asks users to accept the new version, stores version, time and account, and shows the Free statement on the Free red-event screen.
7. Check the product matches the terms: refund request button, refund flow that ends access at once, 14-day grace, no auto-renewal, reminder at 30 days, finance able to fund Paystack refunds (a refund needs payout or balance).
8. Update `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md` or `docs/DECISIONS.md` with the signed date, and close OQ-313.

## Still open elsewhere
Schedule A has no retention schedule yet; that is for the next legal pass.
