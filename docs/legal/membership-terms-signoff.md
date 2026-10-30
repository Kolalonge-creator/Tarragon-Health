# Owner sign-off sheet: Terms of Service and Telehealth Consent, merged v2 (2026-10-30)

For the owner (CEO, CMO and DPO), who signs personally as the responsible officer. **Status: unsigned. Nothing in this sheet has been published or applied to any database.** The text is an AI-prepared draft, not legally certified. Read `membership-terms-nigeria-review.md` for sources and the counsel list. Counsel review stays optional, as you decided on 2026-10-13.

## Where this stands
The 2026-10-13 redraft is already in the repository (merged to `main-dev` as #1068). It was never published to patients, and it describes a single 120,000-naira Membership, which is no longer the product. This v2 replaces it with the three-plan product that is live today, and it also covers the Telehealth Consent, which the 13 October publish script left out. Two files carry the patient text:

- `schedule-c-terms-of-service.md` (Terms of Service)
- `schedule-b-telehealth-consent.md` (Telehealth Consent)

## What changed from the 13 October draft
**Terms of Service**
- Three plans: Free, Membership and Membership Plus. Prices are kept out of the legal text on purpose (they are shown on the payment screen and the receipt) so a price change never forces a new consent. The prices are in the table below for your check.
- Membership has the monthly video call and written questions between calls. Membership Plus adds the yearly blood test, collected where we collect, in the state chosen when buying.
- Moving up from Membership to Membership Plus at any time in the year, paying only the difference. No moving down in the year.
- Extras for Members only: a second opinion and an extra online meeting. For the extra meeting, payment is held until a doctor accepts.
- The 21-day refund is kept, with your 13 October rules for organisation-paid Memberships unchanged. The non-delivery remedy now has a worked valuation (see decision 1).
- No automatic renewal, reminders at 30, 14 and 7 days, 14-day grace, then Free. Records kept and always downloadable.
- Care Vouchers, referral rewards and the monitoring-device paragraphs are carried over unchanged.
- The Free plan safety statement and an Emergencies section are kept. The emergency number is generic (see decision 5).

**Telehealth Consent**
- One doctor tier plus the Chief Medical Officer. "Led by our doctors" became "provided by", in line with the rule against "doctor-led" as a claim.
- Removed the "24 to 48 hours" promise. Non-urgent findings now say "within 3 days", and the section says plainly that readings on the Free plan are not reviewed by a doctor. Abnormal screening results and critical laboratory results reach a doctor on every plan.
- Removed the masked-number claim, because nothing in the product confirms it.
- Withdrawal now matches the rule that a required consent cannot be withdrawn while the account stays open (OQ-53). You close the account instead.
- Channels list matches the product: app, phone or video, push and in-app alerts, email for documents only, SMS for verification codes only.
- The version line and "pending legal review" sentence are gone from the body, because the page prints its own version and date.

## Prices these terms rest on (for your check)
| Item | Price (naira) | Where it must match |
|---|---|---|
| Membership, one year | 84,000 | pricing page, payment screen |
| Membership Plus, one year | 129,000 | pricing page, payment screen |
| Moving up from Membership to Plus | 45,000 | payment screen |
| Second opinion (Members only) | 5,000 | in-app, before confirming |
| Extra online meeting (Members only) | 5,000 | in-app, before confirming |

## Decisions only you can make
For each one, tick "Accept" to keep what the text says, or write your change.

| # | Decision | What the text says now | Accept | Change to |
|---|---|---|---|---|
| 1 | How a non-delivery refund is valued | The yearly blood test is worth the price gap between Plus and Membership (45,000). Each of the 12 calls is worth one twelfth of the Membership price (7,000). | | |
| 2 | Is any part of the Membership price kept back as a platform share that is never refunded for a missed call? | No. All of the 84,000 is attributed to the 12 calls. This replaces the earlier 40/50/10 split of 120,000, which no longer fits the prices. | | |
| 3 | Is a blood test already taken inside 21 days deducted from a 21-day refund? | No deduction. | | |
| 4 | Plus blood tests: the state is fixed when buying | Fixed at purchase. If the Member moves to a state where we do not collect, they come back to the chosen state or use the open request route. Today's collection states are set by the admin list (Lagos, Oyo, Osun and Ogun at the last check). | | |
| 5 | Emergency number | "The emergency number for your area." Insert 112 only after you have confirmed it is the right national line. | | |
| 6 | Service times | Reply to a refund request in 5 working days; pay in 5 working days; acknowledge a complaint in 2 working days and answer in 10. | | |
| 7 | Response guide for non-urgent findings | "Within 3 days." Confirm it against the signed escalation SLA (`escalation_slas`, active version) before you sign, and change the sentence if the signed figure differs. | | |
| 8 | Liability wording | No financial cap. Nothing excluded that the law will not let us exclude. | | |
| 9 | Organisation-paid Memberships | Your 13 October rule: only the organisation may claim the 21-day refund, the Member is told, and keeps the make-good right. | | |

## Things the text says that the product must actually do
These are statements in the patient text. Each one must be true on the day the text is published. I have not tested any of them against the running product.

- [ ] A "Request a refund" option exists on the Membership page, and an approved refund ends Member access at once, with no grace.
- [ ] The 14-day grace after a natural year end, then return to Free, with the record kept.
- [ ] Reminders at 30, 14 and 7 days before the year ends, and no card charge unless the person buys again. (`membership_auto_renew` is OFF today. If it is ever switched on, change these terms first.)
- [ ] Moving up from Membership to Plus charges only the difference and does not move the end date.
- [ ] An extra online meeting is paid for only when a doctor accepts, and a decline or a time-out refunds the payment. **Check how the payment is held (an authorisation hold, or a charge followed by a refund), since the text says "held" and "refunded".**
- [ ] Second opinion and extra meeting are not offered to Free accounts.
- [ ] Refunding only the Plus upgrade payment returns the person to Membership and keeps their Member access (the text says so).
- [ ] On the Free plan, the later check-in answers after a dangerous reading stay in the patient's own record and reach no doctor. The text says "not sent to a doctor". If any path alerts a clinician, change the sentence before publishing.
- [ ] The Free plan red-event screen shows the Free statement and says no doctor was alerted.
- [ ] Email and SMS never carry results or clinical advice. SMS is used for verification codes only.
- [ ] The doctor phones or video-calls the patient for urgent and emergency findings, and a note of the call goes into the record.
- [ ] The yearly blood panel list is on the pricing page and the payment screen, as the text says.
- [ ] Complaints address `legal@tarragonhealth.ng` and care address `support@tarragonhealth.ng` are monitored.
- [ ] Finance keeps enough Paystack payout or balance to fund refunds.

## Not covered by this change
- A 30-day first-purchase guarantee is not in the text, because it is not an adopted rule. Say so if you want one.
- A Membership bought by a sponsor for someone else is not described. The text covers vouchers bought for another person only.
- **Reconcile before publishing:** Schedule A line 104 still says a person can withdraw "any of the specific consents listed above at any time". Schedules B and C now say a required consent is ended by closing the account. If Schedule A lists a required consent, the three documents disagree. Change Schedule A in the same release, or decide that it stays as is.
- Schedule A (Data Processing Consent) still has the unset retention schedule and the open DPO name, DPO email and NDPC registration reference. Those are your inputs and are tracked in `facts.json`.
- The signed escalation SLA record still names a channel that was removed. That is an engineering fix, not a text change.
- Counsel items A to K in `membership-terms-nigeria-review.md` stay open for any lawyer you choose to use. The review memo now has a v2 addendum that says which of them changed.

## Your signature
Nothing is signed. Signing is yours alone, and an agent must never sign for you.

| Field | |
|---|---|
| Documents approved | Schedule C Terms of Service, Schedule B Telehealth Consent, version label 2026-10-30-v2-draft |
| Signed by (name and role) | |
| Signature | |
| Date | |

## Steps to publish after you sign (do not do any of these before)
1. Choose the final version string, for example `2026-11-02-v2`. It goes into the publish script only. The italic banner paragraph at the top of each file is not published, because the generator starts at the first `##` heading, but delete it anyway so the signed files read clean.
2. Regenerate the script from the two signed files, so the script and the files cannot drift:
   `node docs/legal/drafts/build-consent-ladder-v2-draft.mjs <final version>`
   Without a version argument the script keeps the `SET-AT-PUBLISH` placeholder and refuses to run.
3. Run `node docs/legal/drafts/build-consent-ladder-v2-draft.mjs --check <final version>` (it fails if the script no longer matches the two files), then `legal-docs-facts.test.ts` and the lint step. The Terms must still contain the words "21-day refund".
4. Cut a PR into `main-dev` with the final files and the copy changes you listed under the product checklist. Run `/code-review high` on the diff first, as the repository rules require.
5. Copy the script into `supabase/migrations` with a fresh timestamp taken after `list_migrations` on the live project, never a round number. Prove it on a local `supabase db reset`.
6. Apply to the live project `koiplnmbgnqnbywhpjlf` using `execute_sql` in one transaction, with the `schema_migrations` row at the file's version. Never use `apply_migration` for this.
7. Check afterwards: exactly one current row each for `terms_of_service` and `telehealth`, the other consent types untouched, and a test account being asked to accept the new versions.
8. **Know the effect before you press apply:** these are required consents. Retiring the old rows and inserting new ones means every existing patient is asked to accept again at next sign-in.
9. Record the signed date in `docs/DECISIONS.md`, and close OQ-313.
10. Rollback if needed: flip `is_current` back on the previous rows and off on the new ones. Published text is immutable once any patient has accepted it, so a typo found later needs a new version, not an edit.

## Still open elsewhere
Schedule A has no retention schedule yet; that is for the next legal pass.
