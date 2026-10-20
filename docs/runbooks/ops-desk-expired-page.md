# Ops desk: when a red page expires

Who this is for: the named ops person (primary or deputy), the chief medical officer, and the founder, who names the people.
Decision: `docs/plans/S16-S20-review-and-build-plan.md` decision 10 (the final fallback is the in-console alarm plus a NAMED ops person who phones the on-call clinician and the CMO). Open question: OQ-441 in `docs/OPEN-QUESTIONS.md`.
Related: `docs/runbooks/ops-desk-resilience.md` (power, internet, the paper list), `docs/design/S16-S20-pager-delivery.md` (the expired state), `docs/PLATFORM_OUTAGE_RUNBOOK.md`.

Pages are never sent by sms or voice (INV-08, D-12). The last line of defence for a red page is a human with a phone, and this document and the Ops desk screen (`/admin/ops/desk`; the CMO reads it at `/clinician/ops-desk`) make sure that human is named, told, and recorded.

## What the system does

1. A red event page runs through every alert and nobody acknowledges it. It reaches `expired`, and the existing sev1 incident `page_expired:<id>` ("Phone the on-call clinician now") opens. The same happens when the health job finds that nobody reachable is on call (`page_nobody_reachable:<organisation>`).
2. The system assigns the incident to the ops primary who is on duty for that hour (hours are in Lagos time) and tells them by push, in-app and email. If the primary is not on duty, the deputy on duty is used.
3. If the primary has not acknowledged after 5 minutes (`deputy_after_seconds`, PROPOSED, CMO owned), the deputy on duty is assigned and told. Once only.
4. If the deputy also does not acknowledge in the same time, one closing sev1 ("Nobody at the ops desk has acknowledged a page incident") is raised and the CMO and administrators are told. It does not loop.
5. If nobody is on duty at all, a sev1 says so ("No named ops person for this hour") and the CMO and administrators are told to phone themselves.
6. Separately, once a minute, if a real on-call rota is running and no ops contact is on duty for the current hour, a sev1 ("Nobody is named at the ops desk for this hour") is opened. Switch it off with `uncovered_roster_alarm = 0` in the ops desk configuration.

Page text stays neutral (INV-07): no patient, no case detail, in any message or on the call sheet.

## What the person on the desk does

1. Open the Ops desk page. Press "I have this one" on the incident. That stops it moving to the deputy.
2. Read the call sheet on the same card: the on-call clinician, the backup, and the chief medical officer, each with the number from their own account. A number appears only when the person has confirmed it on their account. If there is none, use the paper list in `docs/runbooks/ops-desk-resilience.md` section 4.
3. Phone the on-call clinician. If they answer, tell them there is an unacknowledged page on the On call screen and stay on the line until they say they have it. If no answer in 2 minutes, phone the backup. If no answer in a further 2 minutes, phone the chief medical officer. (The 2 minute gaps are PROPOSED; the CMO confirms them.)
4. After each call press "Record the call": who you phoned, what happened, and a short note. Never write a patient name, number or any clinical detail in the note. A recorded call cannot be changed or removed; add a new line if something changes.
5. If the page is for someone who needs an ambulance and nobody can be reached, follow the emergency instruction in the clinical protocol. Do not wait for a doctor to be found.

## The roster (administrators)

- Add an administrator account as primary or deputy. A new contact starts not active.
- Set the hours (Lagos time, one window per line, `1 08:00-18:00`, 1 is Monday). A night shift is two lines.
- Make them active only after you have checked the number on their account by phoning it. The system refuses to activate a contact unless: the account is an administrator account in this organisation; the phone number on the account has been confirmed by the person through sign-in; the number is not an obvious placeholder; and at least one window of hours is set. No name, number or hours are ever filled in for you.
- A contact whose number later stops being confirmed drops off duty automatically; the roster shows "Phone number not confirmed".
- Cover the whole 24 hours across the primary and the deputy. The overview shows the hours in the next 7 days with nobody on duty.

## The checklist (attested by a person, never invented)

The Ops desk page lists four lines: backup power, a second internet link, tested contact numbers, deputy cover. Each is "in place" or "not in place" by a named person, with a date and what they saw or tested (at least 20 characters). The system does not know whether the inverter or the second link exists. A statement older than 90 days (`checklist_max_age_days`) stops counting and shows as out of date.

Today the checklist gates nothing. ops desk configuration version 2 (inactive, unsigned) makes it a condition: the on-call cover guard (`on_call_cover_ok`) cannot be switched ON until every line has a fresh "in place" statement and a primary and a deputy are active with confirmed numbers. Only the CMO signs it, on the sign-off hub. It never switches anything off and never delays a red page.

## What needs a human before this protects anyone

- The founder names the primary and the deputy ops people, makes sure each has confirmed their own phone number on their account, and sets their hours so the 24 hours are covered. Nothing is named in the system today.
- The founder buys and tests the backup power (inverter or UPS, power banks) and the second internet link, then a named person attests each on the Ops desk page.
- Someone phones each number on the call sheet once to prove it works, and attests "tested contact numbers".
- The CMO confirms the 5 minute deputy time and the 2 minute call gaps, and decides whether to sign version 2 (the checklist gate).
- Deploy the edge function `send-pending-notifications` before the migration applies (three new templates: `on_call_ops_desk`, `on_call_ops_desk_uncovered` and `on_call_ops_desk_roster`). Until then a page that expires still raises the incident and the in-console alarm, and the new notices wait to send.

## Known limits

- The system assigns and reminds; it cannot know that a call was made except by the record the person makes. A call log with no entries for an expired page is itself the finding.
- Assignment fires when the incident is created. An incident already open before the roster exists is not assigned retroactively.
- The uncovered-roster and closing incidents are opened once and closed by a person (the same convention as the other paging incidents).
- A native (Expo) receipt for pages does not exist yet, which is a separate limit described in `docs/design/S16-S20-pager-delivery.md`.
