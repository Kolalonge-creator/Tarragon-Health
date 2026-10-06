# S29 design review: Care Circle (supporters) and paying for a loved one

Date: 2026-10-06. Sources: public help pages and search summaries only. Anything not seen on a public page is marked "unverified". Written in my own words.

Method note: search summaries were used for most items; I did not open every help page in full. Treat details marked (summary) as needing a second look before they go into a spec.

## 1. What each competitor does that is notable

### Apple Health Sharing (verified, support.apple.com)
- Up to five people. The person you share with must be in your contacts, and the share is a deliberate invite from the owner.
- Sharing is by topic. The owner picks what to share, and can add notifications for high heart rate, irregular rhythm and large trends.
- The receiver can turn off Alerts, Trends or Updates on their side. The owner can stop sharing entirely, and the data is removed from the other person's device.
- Lesson: per-topic choice, a receiver-side mute, and a clean stop that also deletes the receiver's copy.

### Dexcom Follow (verified, dexcom.com)
- Invite is by email, up to 10 followers. The owner chooses what each follower sees and which alerts each follower gets (for example only urgent low).
- Owner can remove a follower at any time. Alerts have snooze and quiet modes on the follower side.
- Lesson: alerts are chosen per follower, not one switch for everyone. Alert fatigue is a known problem and they give controls for it.

### Medisafe Medfriend (verified, summary)
- Invite from the app using name, phone and email. A switch decides whether the friend sees adherence.
- A missed-dose alert goes to the friend about 30 minutes after the miss and never names the medicine.
- Free users get one Medfriend, premium gets more.
- Lesson: our "no medicine names" rule matches the market. Their alert is fast (30 minutes), ours is not yet specified for adherence.

### CareClinic / CircleOf (summary, partly unverified)
- CircleOf is a free caregiver app built around tasks, calendar, messages and an "Inner Circle" with admin rights. Other circle apps assign roles (family, nurse) and control who can see and comment.
- I could not verify CareClinic specifics. Unverified.
- Lesson: these are coordination tools (who brings food, who drives). Our supporter is a watcher and payer, not a task manager. A light "I called them" acknowledgement is the useful borrow, not the whole task board.

### Omada (verified, employer FAQs)
- Family members are eligible only as separate adult members through the health plan, each with their own account and coach. There is a "bring a loved one" invite, but I found no caregiver view of another person's data. Unverified for any supporter feature.
- Lesson: the market leader treats a family member as their own patient, not as a viewer. Our supporter model is more cautious than most and is a real differentiator.

### Personify Health (unverified)
- I did not find a public page describing family or caregiver sharing. Unverified. No claims made.

### Livongo / Teladoc (verified, summary)
- Optional family alerts for high and low readings. Employer and plan cannot see individual results. Sharing with a doctor is a separate, opt-in choice.
- Lesson: the strongest privacy promise is stated plainly to the user ("your employer cannot see this"). We should say the same about the payer.

### NHS proxy access (verified, nhs.uk and practice policies)
- Adults with capacity give informed consent, often in writing. A carer for someone over 16 needs the patient's permission. Without consent, access only follows a capacity assessment and a best-interests decision.
- Practices limit the level of access (appointments only, repeat prescriptions only, or full record). Identity of the proxy is checked in person or with ID.
- Lesson: levels of access, a stated purpose, and real identity checks for the proxy. Written consent is a trail.

### Google / Fitbit family (verified, summary)
- Guardians of a child see the child's full account. Other family members see only name, picture and activity.
- Lesson: this is guardian control, which we do not want for adults. It shows the risk: family features drift into surveillance when one person can see everything.

### Strava privacy (verified)
- Followers must be approved. Privacy zones hide start and end points. Visibility can be set per activity.
- Lesson: hide the sensitive part by default and let the owner widen it. Our weekly averages (not single readings) follow the same idea. A "this is what your supporter sees" preview is the missing piece.

### Gifting and diaspora payment
- Reliance HMO and Hygeia (summary, third-party comparison site): diaspora buyers can pay in naira from abroad and cover parents in Nigeria. The HMO verifies the insured with a NIN and may verify the payer with a passport or residence permit. Prices quoted on that site were from roughly 42,500 to 55,590 naira a year. These are third-party figures, unverified against the HMO sites.
- mPharma, Clafiya, Helium Health: no public gift or pay-for-someone flow found. Unverified.
- Healthtracka: no public gift flow found (kits, pre-wedding and full-body packages only). Unverified.
- Paystack (verified, support.paystack.com): accepts Visa, Mastercard and Verve cards from anywhere if international payments are enabled on the business. International cards are charged at the higher international rate. Common declines: card not enabled for online use, insufficient funds, bank timeout, daily limit. Alternatives such as bank transfer and USSD are offered when cards fail.
- Lesson: nobody in Nigeria has a polished, consent-first gift flow. The HMO pattern (payer is verified, insured is verified separately) is the only precedent, and it is identity-heavy, not consent-heavy.

## 2. Best practice table

| Best practice | Who does it | Do we have it | Gap or risk |
|---|---|---|---|
| Owner starts the share, receiver cannot self-invite | Apple, Dexcom, Medisafe | Yes (patient-shared one-time link) | None |
| Invite bound to the intended person | NHS (ID check), Apple (contacts) | Yes (verified email or phone, 72h, attempt cap) | Shared phones: link forwarded in a family chat could be opened by the wrong person on a shared handset. Needs a code check on the supporter device |
| Per-topic permissions, off by default | Apple, Dexcom, NHS levels | Yes (five, off until ticked) | None |
| Alerts chosen per follower | Dexcom | Yes (red alerts permission) | No stated cap on alert frequency or quiet hours |
| Alert content is neutral | Medisafe (no med name) | Yes | None. Check lock-screen preview too |
| Receiver can mute alerts without leaving | Apple, Dexcom | Not stated | Gap: supporter mute and digest option |
| Stop sharing also removes receiver's copy | Apple | Partly (expiry, remove, leave) | Confirm cached views and push history are cleared on removal |
| Expiry with renewal | NHS reviews (practice dependent) | Yes (12 months default) | Silent expiry may drop a supporter right before a crisis. Warn both sides before expiry |
| Owner sees who looked | Few (unverified elsewhere) | Yes ("who looked" list) | Ahead of market. Make sure it is easy to read, not a raw log |
| Preview of what the supporter sees | Strava-style privacy preview | Not stated | Gap: "see it as your supporter would" screen |
| Read-only supporter view | Dexcom, Apple | Yes | None |
| Plain privacy promise to the payer side | Livongo (employer cannot see) | Yes (payer sees no health data) | Say it on the payer screen in one sentence |
| Gift waits for recipient acceptance | HMO identity checks (different shape) | Yes | Strong. Keep the decline path silent to payer as built |
| Refund on decline | Not documented anywhere | Yes | Test the Paystack refund timing and tell the payer only "refunded", never why |
| Fallback when international card fails | Paystack guidance (transfer, USSD) | Not stated | Gap: payer-side fallback and clear decline wording |
| Safety escape for coerced sharing | None found | No | Gap, see change 3 |
| Minor or incapacity path | NHS proxy, Google guardian | Not in scope | Out of scope for adults. Note for later |

## 3. Ten most valuable changes, ranked

1. **Make the invite link need a second factor on the supporter device.** Why: a link shared in a family chat is the weakest point; the verified email or phone is only as safe as the handset. Nigeria caution: shared phones and SIM swaps are common, so bind to the email first and do not treat a texted code to a recycled number as strong proof. Re-verify at first open and on any new device.

2. **Add a "what my supporter sees" preview for the patient.** Why: the patient can consent properly only if they see the real screen, and this is the single most trust-building control from the Strava pattern. Cheap, no new data.

3. **Add a quiet "pause sharing" and a coercion-aware exit.** Why: family control can turn into pressure. Give the patient one tap to pause all supporters for 7 days, with no notice to the supporter beyond a neutral "sharing is paused", and make removal never trigger an alert. Nigeria caution: elders and spouses may be pushed to share; do not show a supporter a reason or a time of removal.

4. **Warn before expiry and make renewal a patient choice, not an automatic one.** Why: Apple and NHS-style access should be live when needed; a quiet lapse breaks red alerts at the worst time. Notify the patient (in app and email) 14 and 3 days before, never auto-renew without a tap.

5. **Give the supporter control over their own alert load.** Why: Dexcom shows follower fatigue is real. Offer red alerts always on, weekly summary on or off, a quiet-hours window, and a low-data text-only view. Nigeria caution: low data and patchy push delivery, so a missed push must not be the only route; show a "needs attention" badge on next open.

6. **Add a gentle acknowledgement on red alerts ("I called them").** Why: borrowed from circle apps; stops five supporters all calling at once and tells the patient someone cares. Keep it to a single status, no free text, so no health data leaks through chat.

7. **Payer-side card decline help and a bank-transfer path.** Why: Paystack documents international cards declined for common reasons and an international rate; diaspora payers need clear words and a second route. Show the naira total before they pay, explain that a bank may need to allow online or international use, and offer transfer. Never retry silently.

8. **Say the payer promise on the payer screen and in the receipt email.** Why: Livongo-style plain statement ("you will not see their health information, only that the gift was accepted or refunded"). Nigeria caution: NDPA treats health status as sensitive personal data needing consent that can be withdrawn as easily as given; make the withdrawal button as visible as the grant.

9. **Record consent as a trail, not just a toggle.** Why: NHS proxy keeps a written consent and a stated level. Store who, what permission, when, from which device, and the exact wording shown, so an NDPA complaint or a family dispute can be answered. Include a one-page plain consent summary the patient can download.

10. **Guard the gift against the "wrong person" case.** Why: a payer typing the wrong phone or email could send a Membership to a stranger who then sees a charity-looking offer. Require the payer to confirm the recipient name as the patient entered it, show the recipient only a masked payer name until they accept, and expire an unaccepted gift (for example 14 days) with an automatic refund. Nigeria caution: names and numbers are often shared or recycled; do not rely on phone alone.

## 4. Things I would not copy
- Guardian-style full visibility (Google family). It fits children, not adult patients.
- Employer-style access to results (the Livongo promise is the opposite and is right).
- Free tier limits like one supporter (Medisafe). A single supporter is fragile in a family that shares care across siblings.
- Any supporter chat inside the app until moderation and consent for it exist.

## 5. Open questions for the founder
- Is a supporter allowed to be a person outside Nigeria on a foreign number? (SMS is only for sign-in codes, so email is the safe default.)
- Should a pay-for-care supporter also be allowed to see invoices for what they paid, without any health detail? (Likely yes, low risk.)
- Who handles a dispute where a payer says a gift was a mistake after acceptance? Needs a support path and a clear refund rule.

## 6. Sources (public)
- Apple: support.apple.com (Share and view health data in the Health app)
- Dexcom: dexcom.com (Follow FAQs, user guide)
- Medisafe: medisafe.com and app tips page
- NHS: nhs.uk (how to get proxy access) and GP practice policies
- Omada: omadahealth.com FAQs and employer FAQs
- Google/Fitbit: Google Health help centre
- Strava: support.strava.com (Privacy Controls)
- Teladoc Livongo: teladochealth.com/livongo
- Paystack: support.paystack.com (Pay with card, international payments)
- NDPA 2023: ndpc.gov.ng and the Act text on cert.gov.ng
- Reliance, Hygeia diaspora prices: nairacompare.ng (third party, unverified)
