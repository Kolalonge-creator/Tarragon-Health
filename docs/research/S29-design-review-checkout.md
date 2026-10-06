# S29 design review: checkout, membership, refunds, gifting

Date: 2026-10-06. Public sources only, written in my own words. "Unverified" means I could not confirm it from a public page. Search depth was limited (about 8 searches, search snippets only, no full page reads), so treat every competitor line as a lead to confirm, not a quote of policy.

## 1. Notable practice per competitor

**Omada.** Terms say fees paid are non-refundable unless Omada agrees in writing. Cancel by email or in the app. Most members are paid for by an employer or insurer, so access ends when that coverage ends, and there is a dedicated "account closed due to loss of coverage" help page. Lesson: tell people clearly why access ended and what happens next. Renewal reminder practice: unverified.

**Teladoc / Livongo.** Cancel any time by phone. For Livongo, a member who already paid gets a full refund on cancel (per their help page). Copay refunds are promised in 7 to 10 business days, with an email confirming the refund to the original payment method. Lesson: state a refund time in days and confirm by message.

**Calm.** Refund and reminder practice: unverified (search found nothing). Known only that it is app-store billed, which is outside our model.

**Insight Timer.** All subscription charges non-refundable, no credit for part-used periods. Google Play refunds only inside 48 hours. Lesson: the harsh version is what we should not copy, because Nigerian law is less friendly to it (section 4).

**MyFitnessPal.** Premium is final and non-refundable at their discretion, except outside the US, where a 14 day change-of-mind full refund applies. Tells users to cancel at least 24 hours before renewal. Lesson: a no-refund rule plus a regional cooling-off exception is a real pattern; it also shows how complaints pile up (a BBB complaints page exists) when the rule is hard to find.

**Noom.** Refund only within 14 days of the first charge, renewals not refundable, and billing reminder emails state the renewal date and refund eligibility. Lesson: put the refund window and the date in the same reminder.

**Kaia.** Refund policy for the app: unverified (only a retail shop policy surfaced, not relevant).

**Reliance Health, Mpharma, Helium Health, Clafiya, Wellahealth.** No public refund, cancellation or checkout page found. All unverified. Reliance and Wellahealth sell through employers, agents and partners, so a consumer checkout comparison is weak. Do not assume they have a better refund flow than ours.

**Hygeia (Nigerian HMO).** Not confirmed. A site "hygiahealthservices.com" shows a 30 day full refund with a 14 day cutoff for some customers, but the text contradicts itself and I could not confirm it is the Nigerian Hygeia. Unverified.

**Healthtracka / Medbury lab booking.** Healthtracka: home sample collection, results in 1 to 3 days. Cancellation and refund terms not found. Medbury: nothing found. Both unverified.

**Paystack (primary source).** Refund goes back to the original method. Card refunds take about 5 to 10 business days to show; bank transfer refunds about 2 to 3 business days on Paystack's side; Paystack says customers should expect 3 to 10 working days overall. Paystack keeps its own transaction fee on a refund (the merchant bears it). Bank transfer, USSD and mobile money can sit in "pending" or "queued" for seconds to minutes before settling, and the final state arrives by `charge.success` webhook, which should be confirmed with the verify call before giving value. Local card fee 1.5% plus 100 naira (100 waived under 2,500 naira, capped at 2,000); international cards 3.9% plus 100 naira with no cap. Fees can change, so keep reading them from config.

**FCCPC / FCCPA 2018.** Section 120 gives a right to cancel advance bookings and get a refund, subject to reasonable cancellation charges, and a restriction on refunds must be told to the consumer in writing. A court (Enugu High Court, Peace Mass Transit) held a blanket "no refund after payment" rule void when the service was not delivered. Law firm notes say no-refund policies are not automatically lawful. There is no general statutory cooling-off period for online services that I could confirm: unverified. Ask counsel.

## 2. Best practice table

| Best practice | Who does it | Do we have it | Gap or risk |
|---|---|---|---|
| Show total price before paying | Common | Yes (price plus labelled fee estimate) | Estimate for international card is much higher (3.9%); payer abroad may see a surprise at the Paystack page |
| Fee shown as estimate, kept out of price | Rare, ours is ahead | Yes | Make sure the receipt shows the real fee after payment |
| Pay state only from a verified server check | Paystack guidance | Yes (webhook, verify, 5 minute sweep) | Sweep should cover transfers that confirm hours later; see change 3 |
| One entitlement per order, replay safe | Paystack guidance | Yes | None known |
| "Paid but not activated" recovery message | Rare | Unverified in UI | Patient who was debited and sees nothing will panic and message support |
| State the refund rule before payment, in plain words | Noom, MyFitnessPal | Unverified on checkout page | Section 120 needs refund limits told in writing |
| Refund window with a clear start date | Noom (14 days), MFP (14 days outside US) | Refund requests exist, no stated window | Without a stated window every request is a judgement call |
| Pro-rata refund of annual plan | Few; Insight Timer says none | No | Decide: full in first N days, then none or pro-rata; document it |
| Refund time promised in days, with a confirming message | Teladoc (7 to 10 days, email) | Partial (ledger reversal, no stated times) | Bank takes 5 to 10 days; patient thinks money is lost |
| Renewal reminder with date and refund rule | Noom | Partial (7 day reminder only) | One reminder is thin for a 100,000 naira annual spend |
| Never auto-renew | Rare in apps | Yes | Lapse means loss of care; needs a grace or gentle lapse path |
| Grace period after expiry | Unverified at any competitor | No | Clinical continuity risk |
| Payer sees receipt and can get a refund | Gift cards in general | Yes (decline refunds payer) | Payer abroad, naira only: they bear exchange risk and card fees |
| Gift needs recipient acceptance | Rare | Yes | Unaccepted gift needs an auto-expiry and auto-refund date |
| Items off by default behind a go-live switch | Internal practice | Yes | Good; test the refund path before switching on |
| Admin approve/deny refunds | Teladoc phone flow | Yes | Needs a service level for decisions and a reason shown to patient |
| Fee on refund treated as our cost | Paystack rule | Unverified in finance code | A hidden cost on every refund; budget it |

## 3. Ten most valuable changes, ranked

1. **Put the refund and cancellation rule on the checkout page and in the receipt, in plain words.** Why: FCCPA section 120 expects refund limits in writing and a court has voided a blanket no-refund rule. Caution: counsel should approve wording; do not copy a US "all sales final" line.

2. **Set one clear cooling-off window (suggest 14 days from payment, full refund if the patient has not used paid doctor time).** Why: matches Noom and MyFitnessPal outside the US, simple to administer, builds trust at 100,000 naira. Caution: the Paystack fee is not returned to us, so each early refund costs Tarragon real money; decide who pays and budget it.

3. **Treat "pending" as a normal state and tell the patient what it means.** Show "we are waiting for your bank, this can take a few minutes" for transfer and USSD, and extend the reconcile sweep for those channels for several hours. Why: transfers settle late and a stuck screen causes duplicate payments. Caution: a patient debited but not activated must see a plain "we have your payment, activation is in progress" message and a one tap contact option.

4. **Promise refund times in days and send a message at each step (requested, approved, sent to your bank).** Why: Teladoc states 7 to 10 days with an email; Paystack says 3 to 10 working days. Caution: Nigerian banks routinely run to the long end of 5 to 10 days; say "up to 10 working days" and never imply instant.

5. **Send more than one expiry reminder (suggest 30, 7 and 1 day) and put the exact end date and the renew link in each.** Why: no auto-renew means silent lapse is our biggest retention and safety risk. Caution: no reminder may depend on one channel; use email plus in app plus push, and never SMS beyond what is allowed.

6. **Add a short grace period after expiry (suggest 7 days) where records stay visible and renewal is one tap.** Why: protects a hypertension or diabetes patient from losing monitoring because of a late transfer or a payer abroad. Caution: grace must not grant free paid doctor time; define exactly what stays available.

7. **Make the gift flow handle three edges: auto-expire an unaccepted gift (suggest 14 days) with an automatic refund to the payer, a receipt to the payer, and a message to the payer when the patient accepts or declines.** Why: the payer abroad needs proof their money reached the right person. Caution: card refunds to a foreign card take 5 to 10 days and the payer may see a different amount in their own currency; the fee on refund is our cost.

8. **Warn international card payers before they reach Paystack.** Detect or ask "paying with a card issued outside Nigeria?" and show the higher estimate (3.9% plus 100 naira) and the naira amount. Why: the supporter abroad is the likeliest to feel surprised. Caution: keep naira as the only charge currency; do not show a currency conversion we cannot guarantee, because their bank sets the rate.

9. **Decide and publish a rule for refunds after the window (pro-rata, credit, or none) and for any partly used care pack.** Why: unpublished rules turn each request into an argument; pro-rata is the fairest reading of section 120's "reasonable charges". Caution: no stored balance or wallet is allowed, so pro-rata must go back to the original method, never as credit.

10. **Give refund requests a service level and a reason.** Admin decision within a stated number of working days, a short reason code shown to the patient on denial, and an escalation path. Why: a silent or unexplained denial is what drives complaints to the FCCPC. Caution: keep an audit trail of every refund call to Paystack and ledger reversal, and reconcile weekly against Paystack refund status, since "processed" on Paystack can still mean days at the bank.

## 4. What we already do well (keep)

- Order first, paid only by verified server check, replay safe: stronger than most consumer apps.
- Fee shown as a labelled estimate and never part of the price: clear and honest.
- No auto-renew and a reminder: avoids the biggest consumer complaint in this category.
- Gift needs patient acceptance and decline refunds the payer: respects the patient.
- Go-live switch: lets us test refunds with real money before patients see them.

## 5. Open items to confirm (unverified)

- Whether any Nigerian competitor publishes a refund or cooling-off rule (Reliance, Hygeia, mPharma, Helium, Clafiya, Wellahealth, Healthtracka, Medbury, Kaia, Calm all unconfirmed).
- Whether a statutory cooling-off period applies to online health memberships (counsel).
- Current Paystack fee schedule on the day of go-live (read from config, do not hard code).
- Whether Paystack returns its fee on refunds for our account type (public pages say no; confirm with our account manager).

## Sources

- Paystack refund guide: https://support.paystack.com/en/articles/2127106 and https://paystack.com/docs/payments/refunds/
- Paystack payment channels and verify: https://paystack.com/docs/payments/payment-channels/ and https://paystack.com/docs/payments/verify-payments/
- Paystack pricing: https://paystack.com/pricing
- FCCPC consumer rights: https://fccpc.gov.ng/consumers/consumer-rights-responsibilities/rights-responsibilities/
- Refund law notes: https://lawkernel.ng/consumer-rights-in-nigeria-under-the-fccpa-2018/ and https://www.lexworthlegal.com/the-legality-of-no-refund-policies-in-commercial-contracts-in-nigeria/
- Omada terms: https://www.omadahealth.com/terms-of-use
- Teladoc and Livongo: https://www.teladochealth.com/legal/cancellation-policy
- Noom refunds: https://www.noom.com/support/faqs/subscription-and-billing/2025/10/noom-refund-policy/
- Insight Timer: https://help.insighttimer.com/support/solutions/articles/67000675827-subscription-donation-cancellation-and-refund-policy
- MyFitnessPal terms: https://www.myfitnesspal.com/terms-of-service
