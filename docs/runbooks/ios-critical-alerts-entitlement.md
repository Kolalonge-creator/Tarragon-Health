# Requesting Apple's Critical Alerts entitlement (medical use)

Status: NOT requested. This is the checklist for whoever holds the Apple Developer account. Nothing in `apps/mobile` was changed by this document, and the native configuration is out of scope here.
Plan reference: `docs/plans/S16-S20-review-and-build-plan.md` decision 10 (request iOS Critical Alerts for medical use; build an Android reliability kit).

## Why

A normal iOS notification is silenced by the mute switch, Do Not Disturb and every Focus. A Critical Alert is allowed to sound and show even then. For an urgent page to an on-call doctor that is the difference between a page that wakes someone and a page that does not. Apple gives this permission only to apps that ask for it and justify it, and it is granted per app.

## What Apple needs (check each against the current Apple page before submitting)

[verify] The details below are from general knowledge of Apple's process. Open the current request form and follow it; do not rely on this list alone.

1. A paid Apple Developer Program account whose Account Holder is the person submitting. The request is made through Apple's "Request the Critical Alerts entitlement" form on developer.apple.com (Contact Us, Notifications), not inside Xcode.
2. The app's bundle identifier exactly as registered. Use the production identifier of the Tarragon Health iOS app, not a development one.
3. A written justification, in plain English, that says:
   - who receives the alert: a named, registered doctor who is on call;
   - what it is for: an unacknowledged urgent clinical event such as a dangerously abnormal reading that needs a doctor's response within minutes;
   - why a normal notification is not enough: a doctor on call may have the phone muted or in a Focus mode overnight, and a missed page is a patient safety risk;
   - how it is limited: only on-call clinicians, only for the urgent page, never for marketing, reminders or patient messages, and never to patients. Patients receive no Critical Alerts from this app.
4. Evidence that the app is a real, reviewable product: a link to the privacy policy, a description of the clinical process, and (if asked) screenshots or a TestFlight build showing the on-call page screen.
5. A named contact at Tarragon Health Apple can write to.

## After Apple replies

- If granted: the entitlement `com.apple.developer.usernotifications.critical-alerts` must be added to the app's provisioning profile and entitlements, and the notification permission request must include the critical option. That is native app work (an EAS rebuild and a runtime version bump per the mobile release rules in `CLAUDE.md`); open a separate piece of work for it. Do it only after the CMO has agreed which events may be critical.
- If refused or asked for more: answer the question asked, shortly. Do not re-submit the same text.
- No committed timeline: Apple does not publish one. Plan on weeks and keep the Android and web routes working in the meantime.

## What stays true whether or not Apple says yes

- Pages are never sent by SMS or WhatsApp.
- The web console alarm, the push notification and the email all still go out.
- The ops desk phones the clinician when a page expires (`docs/runbooks/ops-desk-resilience.md`).
- Android clinicians get the reliability kit: a high-importance alarm channel, the brand steps on the Device check screen, and the monthly fire drill.

## Open items for the founder

- Who is the Account Holder who submits the form?
- Which events are allowed to be critical? Proposed: only an unacknowledged red page and its expiry, to on-call clinicians. The CMO decides.
