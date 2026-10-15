# Apple Critical Alerts entitlement: request text

Apple only accepts this request from a signed-in Apple Developer account (Account Holder), so it cannot be filed by an agent.

1. Sign in at https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/
2. Fill the form with the values below and paste the use case text.

| Field | Value |
|---|---|
| App name | TarragonHealth |
| Bundle ID | com.tarragonhealth.mobile |
| Team ID | (from your Apple Developer membership page) |
| Entitlement | Critical Alerts (`com.apple.developer.usernotifications.critical-alerts`) |

## Use case (paste)

TarragonHealth is a chronic-disease care platform for patients in Nigeria (hypertension and diabetes). Patients log blood pressure and blood glucose. A deterministic, clinician-approved rule set grades each reading. When a reading meets a clinician-approved emergency rule (for example a severe low blood sugar, suspected diabetic ketoacidosis, or a hypertensive emergency with symptoms), the patient must be told to seek care now and the care team must be able to reach them.

Critical Alerts are needed for two groups only:

1. Patients who have an emergency-level reading that has not been confirmed within 30 minutes. A silent or muted phone must not be the reason a patient misses the message. The alert text is generic and contains no health detail ("Open TarragonHealth now"), so it is safe on a lock screen.
2. On-call clinicians who are paged for an unconfirmed emergency case. A page that is silenced by Do Not Disturb or a muted ringer can delay care for a patient in danger.

The alert is never used for marketing, reminders, or routine updates. Patients can switch it off in the app, and it is sent only after an emergency rule has fired. Delivery is tracked and the alert stops as soon as a clinician acknowledges the case.

Contact for questions: the Chief Medical Officer and the founder (see the app's support page).
