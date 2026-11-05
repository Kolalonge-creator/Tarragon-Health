# Legal documents v3: removing Membership Plus

Draft for the founder to read. Version `2026-11-05-v3`. Not applied, not committed.
Migration: `supabase/migrations/20261105130954_consent_remove_membership_plus_v3.sql`
Proof: `packages/db/tests/consent_remove_membership_plus_v3.sql`

Only the Terms of Service and the Telehealth Consent change. The Data Processing Consent never mentioned Membership Plus, a blood test or a testing day, so it stays at `2026-10-30-v2`.

**Re-acceptance:** publishing v3 asks every existing patient to accept both documents again. The system has no "minor correction" option: a patient's acceptance only counts for the exact version they accepted. Patients who have already joined see a banner they can dismiss, and nothing on their dashboard is locked. Anyone still signing up, or a supporter switching to receive care, must accept v3 before they can continue.

Lines starting `-` are removed. Lines starting `+` are added. Everything else is unchanged, word for word.

## Terms of service (Schedule C)

```diff
--- v2 (2026-10-30)
+++ v3 (2026-11-05)
@@ -25,6 +25,6 @@
 When an organisation pays, you have no payment relationship with TarragonHealth, and only the organisation that paid can claim the 21-day refund. Any refund goes back to that organisation. If the organisation claims a refund, we tell you, and your Member access ends at once, as it does for any approved refund. You keep your right to a make-good if we fail to deliver the service itself (see "Refunds, and if we do not deliver" below), and your records stay with you.
 
-## The plans: Free, Membership and Membership Plus
-There are three plans.
+## The plans: Free and Membership
+There are two plans.
 
 **Free.** The app, including health tracking, reminders, the screening calendar, education and guidance. Free does not include time with a doctor. See "If you are on the Free plan" below for what that means when a reading or symptom looks dangerous.
@@ -36,14 +36,8 @@
 - prescriptions that your care team signs, for you to take to any pharmacy.
 
-The yearly blood test is not included in Membership.
+Laboratory tests are not included in Membership. You take the laboratory request form to any laboratory you choose and pay the laboratory directly.
 
-**Membership Plus.** Everything in Membership, plus a yearly blood test. Your results are uploaded to your account, and your care team talks them through with you.
-
-Membership and Membership Plus are the same care. You get the same care team, the same monthly video call and the same urgent-care guidance. The only difference is the yearly blood test. What you pay buys scope, never a lower standard of care.
-
 **How the monthly call works.** Each month your doctor offers you times and you choose one. The call is by video. If video does not work for you, it can be by audio only or by phone. "Every month" is the pace we plan for. It is not a promise that a call can never move by a few days. If we miss a month for a reason on our side, "Refunds, and if we do not deliver" below applies.
 
-**The yearly blood test.** The yearly blood panel is a fixed set of tests. The list is shown on our pricing page. Membership Plus blood tests are collected in the state you choose when you buy, and that state stays fixed. If you later move somewhere we do not collect, you will need to come back to that state for your yearly tests. On any plan, including Free, you can ask for the yearly test request, take it to a laboratory and pay the laboratory directly. We do not collect blood on that route.
-
 **Not included.**
 
@@ -63,5 +57,5 @@
 Your plan starts when we receive confirmation of payment from Paystack and runs for 12 months from that day.
 
-**Moving up to Membership Plus.** You can move from Membership to Membership Plus at any time in the year. You pay only the difference, once, and your year does not change. Moving the other way can only happen when your year ends.
+**If you bought a plan we no longer sell.** A plan year you have already bought continues until its end date, even if we no longer sell that plan. When it ends, you can buy Membership, and we will tell you before your year ends.
 
 ## No automatic renewal
@@ -89,9 +83,9 @@
 
 ## Refunds, and if we do not deliver
-**The 21-day refund.** You can ask for a refund of your Membership or Membership Plus within 21 days of buying it. The 21 days start at the time we receive confirmation of your payment and end at the same time of day, 21 days later. A request made before then is in time. If you ask in time, we refund the full price you paid. If you moved up from Membership to Membership Plus, the 21 days for that extra payment start on the day you paid it.
+**The 21-day refund.** You can ask for a refund of your Membership within 21 days of buying it. The 21 days start at the time we receive confirmation of your payment and end at the same time of day, 21 days later. A request made before then is in time. If you ask in time, we refund the full price you paid.
 
 **After 21 days.** After 21 days, a plan is not refundable, except as set out under "If we do not deliver" below and except where the law requires a refund.
 
-**What happens to your access.** When we approve a refund, your Member access ends straight away. You move to the Free plan, with no 14-day grace period. Your health record is kept and stays yours. The one exception is a refund of only the extra payment for moving up to Membership Plus. In that case you go back to Membership for the rest of your year, and you keep your Member access.
+**What happens to your access.** When we approve a refund, your Member access ends straight away. You move to the Free plan, with no 14-day grace period. Your health record is kept and stays yours.
 
 **How to ask.** Use the Request a refund option on your Membership page in the app, or write to legal@tarragonhealth.ng from the email address on your account. Tell us your name and the date you bought. Please add a few words on why you are asking. If an organisation paid for your Membership, only the organisation can ask, and we will not accept a refund request from the Member.
@@ -99,5 +93,5 @@
 **How long it takes.** We reply within 5 working days. If we approve, we send the money back, through Paystack, to the card or bank account that paid, within 5 working days. Your bank then usually shows it within 3 to 10 working days after that. We do not charge you for a refund.
 
-**If we do not deliver.** The 21-day limit does not take away any right you have if we fail to provide what you paid for. Suppose that, during your year, we cannot provide your yearly blood test (Membership Plus), or we repeatedly cannot provide your monthly calls, for a reason on our side. For example, no collection is available in the state you chose, or no doctor can offer you times. We will tell you, and offer you a choice:
+**If we do not deliver.** The 21-day limit does not take away any right you have if we fail to provide what you paid for. Suppose that, during your year, we repeatedly cannot provide your monthly calls, for a reason on our side. For example, no doctor can offer you times. We will tell you, and offer you a choice:
 
 1. a make-good, meaning we deliver the missing item by a new date we agree with you, and extend your Member access by the time it was missing if you ask; or
@@ -106,7 +100,7 @@
 You choose. If an organisation paid for your Membership, you are entitled to the make-good for the service itself, and any refund goes to the organisation that paid.
 
-This is how the share in option 2 is worked out. The yearly blood test is valued at the difference between the price of Membership Plus and the price of Membership. Each of the 12 monthly calls is valued at one twelfth of the price of Membership. We refund the value of the part we did not deliver, even if more than 21 days have passed.
+This is how the share in option 2 is worked out. Each of the 12 monthly calls is valued at one twelfth of the price of Membership. We refund the value of the part we did not deliver, even if more than 21 days have passed.
 
-If a missed item is your doing, it is not a reason on our side. For example, you booked a collection appointment and did not attend. We will still offer to rebook you once. Moving to a state where we do not collect is also not a reason on our side.
+If a missed item is your doing, it is not a reason on our side. We will still offer to rebook you once.
 
 **Cancelling early.** You can stop using your plan at any time. After the first 21 days, we do not refund the unused part of a plan that you choose to give up, apart from the cases above.
@@ -135,5 +129,5 @@
 An abnormal screening result, or a critical laboratory result, that reaches us is sent to a doctor on every plan.
 
-On Membership and Membership Plus, a dangerous reading is seen by our care team as part of your care. You can join at any time. Please do not rely on the Free plan, or on the app, to watch your readings for you. If you feel unwell, get care.
+On Membership, a dangerous reading is seen by our care team as part of your care. You can join at any time. Please do not rely on the Free plan, or on the app, to watch your readings for you. If you feel unwell, get care.
 
 ## Records
```

## Telehealth consent (Schedule B)

```diff
--- v2 (2026-10-30)
+++ v3 (2026-11-05)
@@ -6,5 +6,5 @@
 This is your consent to receive clinical monitoring, classification and review from TarragonHealth remotely, and to be contacted by phone, message or in the app as part of that care. It is separate from, and in addition to, our Data Processing Consent and our Terms of Service.
 
-Your plan decides how much of this involves a doctor. On Membership and Membership Plus, a doctor reviews your readings and results as part of your care. On the Free plan, the app checks your readings against the same rules and tells you what to do, but no doctor reviews them. The Terms of Service explain the plans.
+Your plan decides how much of this involves a doctor. On Membership, a doctor reviews your readings and results as part of your care. On the Free plan, the app checks your readings against the same rules and tells you what to do, but no doctor reviews them. The Terms of Service explain the plans.
 
 ## Your care team
```

## For you or counsel to confirm

1. **New text (the only new sentences).** (a) "Laboratory tests are not included in Membership. You take the laboratory request form to any laboratory you choose and pay the laboratory directly." (b) The paragraph "If you bought a plan we no longer sell", which replaces "Moving up to Membership Plus". It is based only on T2-13: a Plus year runs to its end date, and the member is told before it ends and can then buy Membership. It does not name Membership Plus, because v3 must not name it anywhere. Counsel should confirm this is enough for the members still in a Plus year. Their yearly blood test and the make-good for it are now covered only by the general rule "A change never reduces what you have already paid for" and by their v2 acceptance.
2. **"We will still offer to rebook you once"** used to follow an example about a missed blood-collection appointment. With that example gone, the sentence now reads as covering a missed monthly call too. That is arguably a slightly wider promise than before.
3. **Free plan and laboratory request forms.** v2 said any plan, including Free, could ask for "the yearly test request". That sentence went with the blood-test paragraph. v3 does not say whether Free patients get a request form. The website's inclusion list (`MEMBERSHIP_INCLUDES`) lists request forms as part of Membership.
4. **Membership inclusions are narrower than the website's list.** The legal list still says a monthly video call, written questions and prescriptions, word for word from v2. The website's `MEMBERSHIP_INCLUDES` also lists a preventive plan, request forms, a doctor's review of uploaded laboratory reports, reminders and Care Circle, and it describes the call as "one online meeting with a doctor". These were left alone because only the Plus wording was in scope.
5. **"Changes to these terms" says we ask you to accept again only "if a material change affects your rights or obligations".** The platform asks everyone to accept again on every new version. This correction is arguably not material, but patients will still be asked.
6. **No price stated.** v2 never named a price ("shown on the screen where you pay"), so v3 does not name ₦100,000.
7. **"Tests, scans and hospital care beyond what is listed above"** (under Not included) was kept word for word. No test is listed above it any more. It is still correct, but you may want it to read "Laboratory tests, scans and hospital care."
8. **The source markdown has not been updated yet.** The live text is generated from `docs/legal/schedule-c-terms-of-service.md` and `schedule-b-telehealth-consent.md`. Those files still hold the v2 text and should be brought in line in the same PR.
