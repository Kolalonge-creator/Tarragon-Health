# Owner sign-off record: Terms of Service, Telehealth Consent and Data Processing Consent, merged v2 (2026-10-30)

**Status: signed off by the owner as CEO, by their own statement in chat on 2026-10-30. Recorded here by the assistant from that statement. The assistant did not sign.** The owner's name was not given in the chat, so none is written here. The owner did not state a CMO or DPO capacity in that statement. Counsel review stayed optional, as decided on 2026-10-13, and no lawyer has reviewed this text. Read `membership-terms-nigeria-review.md` for sources and the counsel list.

## What was signed off
Three patient documents, version label 2026-10-30-v2:

- `schedule-a-data-processing-consent.md` (Data Processing Consent), rebuilt from the text that was live (2026-09-08-v1) with only the changes listed below.
- `schedule-b-telehealth-consent.md` (Telehealth Consent).
- `schedule-c-terms-of-service.md` (Terms of Service).

The 2026-10-13 redraft (#1068) described a single 120,000-naira Membership and was never published. This v2 replaces it with the three-plan product: Free, Membership (84,000 naira) and Membership Plus (129,000 naira, adds a yearly blood test).

## Decisions as recorded
| # | Decision | Outcome (owner, chat, 2026-10-30) |
|---|---|---|
| 1 | Non-delivery refund valuation: the blood test is worth the price gap (45,000); each of the 12 calls is worth one twelfth of Membership (7,000) | Accepted as drafted |
| 2 | No platform share kept back from a missed-call refund | Accepted as drafted |
| 3 | No deduction for a test already taken inside 21 days | Accepted as drafted |
| 4 | Plus collection state fixed when buying | Accepted as drafted |
| 5 | Emergency number | Kept generic: "the emergency number for your area" |
| 6 | Reply in 5 working days, pay in 5 working days, complaints 2 and 10 | Accepted as drafted |
| 7 | Response guide | Chosen: keep "within 3 days" for non-urgent findings and add the screening times: contact within 24 hours of an abnormal screening result, within 12 hours if critical. These match the signed escalation SLA (v9: 4320, 1440 and 720 minutes) |
| 8 | Liability wording, no cap | Accepted as drafted |
| 9 | Organisation-paid Memberships: only the paying organisation may claim the 21-day refund | Accepted as drafted |
| A | Schedule A | Fix now and publish with this release. DPO line uses the privacy@ address and no DPO name. NDPC line says registered as a data controller and processor of major importance, with no registration number (owner's instruction). The retention schedule and the transfer mechanism are stated plainly as unfinished, with no brackets. The counsel notes are removed. |
| B | Publish timing | Publish now, even though the Membership products are switched off in the live catalogue |

## Product check, against the running product (origin/main-dev f9dedabc8 and the live database, read only)
**True as written:** an upgrade-only refund keeps the Membership; the 14-day grace; reminders at 30, 14 and 7 days with auto-renewal off; the upgrade charges only the 45,000 difference and does not move the end date; second opinion and extra meeting are blocked for Free accounts; Free check-in answers reach no clinician; abnormal screening and critical lab results go to a doctor on every plan; email and SMS cannot carry clinical content; the Plus collection state is fixed at purchase and live for Lagos, Ogun, Osun and Oyo.

**Text corrected to match the product (this release):**
- Extra online meeting: it is a normal charge refunded in full if no doctor accepts within 48 hours, a doctor declines, or the patient does not choose a time within 24 hours. It is not a held payment.
- 21-day refund: the window ends at the same time of day 21 days after payment (504 hours), not at the end of the 21st day.
- Refund request: the app requires a short reason, so the text asks for one.
- The blood test list is on the pricing page only, not the payment screen.
- Free plan: the "no doctor was alerted" message shows only for the most serious readings, so the text now says that, and also says that no doctor is alerted about any reading or symptom logged on the Free plan.
- Reminders: "we aim to remind you".
- Schedule A: removed a stale "your own language" claim (English only); an emergency (not an urgent) case needs a phone or video conversation before it is closed, as in the Telehealth Consent and the product; "alert your care team" now says where your plan includes doctor review; the required-consent list names the Terms, the Telehealth Consent and this notice, and no longer lists the escalation contact consent, because no code was found that requires it to activate an account (the live sentence saying so is carried over unchanged and is still unverified).

**Product gaps left open (code changes, not text):**
- The Free plan nudge for a RED-level reading does not say that no doctor was told.
- The payment screen does not list the blood tests.
- The refund button shows outside the 21-day window and the server then refuses.
- The extra-meeting refund job runs once a day (05:30 UTC), not every 4 hours as its code comment says.
- The extra online meeting through the Appointments route is pay-to-confirm with no doctor acceptance, which the Terms' wording does not describe.
- An emergency case can be closed only after a started or completed video consultation record, so a phone-only call does not satisfy the gate.
- Whether SMS is switched on at the provider could not be confirmed.
- The signed escalation SLA record (v9) still names a channel that was removed, and its note still says "DRAFT, UNSIGNED" although it carries an approval.
- All three Membership catalogue items are inactive live, so nobody can buy them until they are switched on.

## Not covered by this change
- A 30-day first-purchase guarantee is not adopted and is not in the text.
- A Membership bought by a sponsor for someone else is not described. The text covers vouchers only.
- The retention schedule in Schedule A is still unfinished and the text says so.
- The lawful mechanism for the two data transfers is still unfinished and the text says so.
- No DPO name is printed. The owner chose not to add it.
- Counsel items A to P in `membership-terms-nigeria-review.md` stay open for any lawyer the owner chooses to use.

## Effect of publishing
All three are required consents. Publishing retires the three current rows and inserts new ones, so every existing patient is asked to accept again at next sign-in. The optional consents (research, sponsor reporting) are untouched.

## How it is published
One script, `drafts/consent_membership_ladder_v2_DRAFT.sql`, is generated from the three files by `drafts/build-consent-ladder-v2-draft.mjs <version>` (`--check <version>` fails if it has drifted). It refuses to run with the placeholder version, with a square bracket, an em or en dash, or a retired provider in any body, or with anything but exactly one current row per consent. Applied to the live project only in one transaction, with the `schema_migrations` row at the migration file's version.

Rollback: set the new rows' `is_current` to false and the previous rows' to true. Published text is immutable once a patient has accepted it, so a typo found later needs a new version.
