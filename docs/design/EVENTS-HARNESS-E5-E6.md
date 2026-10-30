
# Events harness: E5 messages and E6 bookings (2026-10-30)

Follows PR 1462 (E1 to E4) and the plan in `docs/design/DASHBOARD-PROGRAMME-CLINICIAN-FIRST.md` on that branch.

`events_care_message_round_trip.sql` and `events_booking_round_trip.sql`, registered in `ci.manifest`. Both pass locally. Sabotages that flip them: message after-insert trigger off, unread sweep gutted, author trigger off; provider-overlap constraint dropped, reminder sweep gutted, appointments read policy narrowed.

Proved (E5): a patient message gets derived author fields; the assigned clinician is notified in app and reads it only through `open_care_thread_audited`, which writes one audit row per 10 minutes (the table policy deliberately gives staff no direct read); the reply carries a real `clinical_staff` row, notifies the patient, flips the thread's last author; a clinical message unopened for 120 minutes raises one alert and tells the responsible clinician or the organisation's admins; an opened thread never alerts; another patient and another organisation are refused (42501); a closed thread rejects posts.

Proved (E6): a rule produces a slot; hold and confirm book it; it leaves the offer and a second patient is refused; the clinician reads the booking, other patients and other organisations cannot; one 24h reminder with reply options, never repeated, none for a visit 30 days away; cancel notifies the patient, re-offers the slot, and shows on the clinician's read.

Findings (not changed here):
- By reading `private.after_care_message_insert` and the sweep (not asserted by a proof): a patient message notifies only the one clinician in `care_team_assignment`. With no assignment row nobody is told at once, and the 120-minute unread sweep covers only category `clinical`, so a `general` message with no assignment would alert nobody. Product decision: should unassigned or `general` messages page someone sooner?
- The clinician is not notified of a new booking or a patient cancellation, only the patient is. The appointments screen shows both. Decide whether a cancellation within, say, 24 hours should tell the clinician.
- Offering availability requires an MDCN primary-source verification unless the staff row is a test row; the proof relies on `is_test` for that reason.
