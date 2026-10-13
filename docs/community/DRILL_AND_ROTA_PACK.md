# Community: safety drill script and rota template

For the Chief Medical Officer and operations. Nothing here needs a developer. Community cannot be switched on until the rota covers all 168 hours of the week for both moderators and safety reviewers, and a passing drill was recorded in the last 90 days.

## A. Rota template (Africa/Lagos time, whole hours, Monday = day 0)

Fill one sheet per person, then enter it at Admin > Community > Rota. An overnight shift is two rows (for example Monday 22:00 to 24:00 and Tuesday 00:00 to 06:00).

| Person (made-up display name optional) | Role (moderator or safety reviewer) | Day | From | To |
|---|---|---|---|---|
| | | | | |

Coverage check before you submit: for each role, every day must have no gap between 00:00 and 24:00. The Rota screen shows the number of uncovered hours; it must read 0 for both roles.

Checklist for the people:
- Each moderator and safety reviewer holds an active care coordinator account (admin grants the permission on Admin > Community > Staff).
- At least two people per role overall, so a sick day is covered. Safety reviewers are never limited to one group.
- The Chief Medical Officer is the crisis owner (COM-21) and receives the overdue notice if a safety item waits more than 30 minutes or a queue item more than 60.

## B. Safety drill script (about 30 minutes, use test accounts only)

Roles: the Chief Medical Officer (runs it), a safety reviewer, a moderator, and one test member account (an `is_test` account in a live-test group).

1. Test member posts an ordinary message. Expected: it appears (or waits for a moderator if it is among their first posts).
2. Test member posts a message with a phone number. Expected: the post is stopped with a plain message; nothing is stored.
3. Test member posts a self-harm phrase from the approved list (for example "I want to die" in a test group). Expected: the post is NOT shown to the group; the member sees the care card straight away.
4. Safety reviewer opens the safety queue. Expected: the post appears with a made-up name only, no real name.
5. Safety reviewer decides (keep withheld). Expected: the decision is saved; the post stays hidden.
6. Test member posts an emergency phrase ("I have chest pain right now"). Expected: the emergency card shows with the "Alert my emergency contact" button; pressing it alerts only the member's own saved contact.
7. Wait the overdue time (or set it low in a test), leave one item unhandled. Expected: the safety reviewer and the CMO receive the overdue notice.
8. CMO looks up the test member from the concern list with a written reason. Expected: the name is shown, the lookup is written down, and the CMO is notified.
9. Moderator removes a test post. Expected: the member gets a fixed removal notice; the member can appeal.

Record the drill on Clinician > Community > Safety drill: tick each step, add notes, and record Pass only if all 9 steps behaved as expected. A pass is valid for 90 days. A failed drill clears the condition until a new pass is recorded.
