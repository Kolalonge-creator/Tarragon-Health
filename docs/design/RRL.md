# RRL design note: records request letter (NDPA right of access) (spec 2.3 and 2.11)

Invariants in play: INV-07 (events carry ids only; no notification is created), INV-10/12 (own rows only; no staff path exists), INV-13 (`is_test`), INV-14 (go-live guard `records_request_letters`, born OFF), INV-16 (versioned wording and reply period). Research: `docs/research/RRL.md`. One additive migration, `20261020221547_records_request_letters.sql` (newest on origin/main-dev and in live `list_migrations` was `20261020173600`); **not applied by me**.

## 1. Why
No hospital integration exists (Helium Health and others are not configured, S44), so the realistic way to fill a person's Passport is for the person to ask their facility. This is a patient-owned tool: write the letter, print it, hand it over, track it, and when the records arrive add them through the existing document capture screen (suggestions only; nothing joins the record until the person confirms, S43).

## 2. What was built
- **Tables** `records_requests` (facility, optional contact, scope codes from a closed list of four, state prepared/sent/received/withdrawn, letter version key, requested_at, due_at, received_at, note, `is_test`) and `records_request_events` (append-only history). RLS select own rows only; no client insert/update/delete grant (asserted); every write is a function.
- **Functions** (security definer, anon revoked via `from public`, verified with `has_function_privilege`): `create_records_request`, `mark_records_request_sent`, `mark_records_request_received`, `withdraw_records_request`, `set_records_request_note`, `my_records_requests` (with a derived `is_overdue`).
- **Events** `records_request.created/.sent/.received` through `private.emit_domain_event`, payload exactly `{request_id}`.
- **Guard** `records_request_letters` OFF. Creating and handing over refuse while off (a test account may exercise it); reading, marking received and withdrawing never refuse. It has no conditions in `private.go_live_conditions`, so it cannot be switched on yet (same state S43/S44 left their guards in; OQ-RRL-2).
- **Registries**: `data_registry` rows and `minor_dependant_table_policy` (guarded, so an under-18 dependant holds no rows) so the standing proofs stay green.
- **Config** `records_request.letter` v1 (unsigned placeholder wording, founder and counsel) and `records_request.response_days` v1 (30, labelled placeholder). Mirror test.
- **Web** `/patient/records-requests` (list, new request form, honest "not open yet" state), `/patient/records-requests/[id]` (what was asked, dates, download, what to do next, buttons, note, "add the documents to my record" link to `/patient/documents` once received), `GET /api/patient/records-requests/[id]/letter` (A4 black-and-white PDF, no logo or colour), a Passport nav link and an in-app banner on the Passport page when a request is overdue.
- **Mobile** `RecordsRequestsScreen` (list, detail, mark received, withdraw), `lib/records-requests.ts`, drawer entry "Ask for your records". Creating the letter and printing it is web-only on purpose.

## 3. Safety rules (each has a test)
- No outbound sending of any kind: the platform never contacts the facility; no notification row is created; "overdue" is derived from the row and shown in the app (Passport banner, list, detail, phone list). Nothing depends on a send.
- The letter names the Nigeria Data Protection Act 2023 right of access only in words, as a request ("I am making this request under my right of access..."). It asserts no section number, no statutory deadline, no penalty, no "legal advice" claim (a test scans the wording). The UI says the wording is a draft not yet checked by a lawyer and, beyond the letter, only that "you can always ask a facility for your own records".
- The reply date is a reminder from placeholder config, shown with "it is not a legal deadline"; it is stored as `due_at` at hand-over from the configured days (bounded 1 to 180 in the function).
- Own rows only (another patient sees none and gets P0002 on every action; anon refused); the PDF route returns 404 for anyone else's id; staff have no path, so no staff page or console search entry was added.
- History is append only; the note's text lives on the row and the history stores only its length.
- A failed read is shown as a failure, never as "no requests"; every action failure says so in words.

## 4. Proof
`packages/db/tests/records_request_letters.sql` (registered in `ci.manifest`): 40+ checks incl. guard off, state machine, overdue, RLS and direct-write denial, append-only history, ids-only events, guard-off read/receive still work; three sabotages (no guard check, no owner check, `using (true)` policy) all flip. Run against live inside one rolled-back transaction with the migration text (Docker was not running here); confirmed nothing persisted. It is not a CI replay: the CI "Supabase migration replay" job is the replay.

## 5. Not done / unverified
No browser or device run (needs a signed-in local stack). The PDF was only tested with the renderer mocked (layout walk, black-only colours); not opened in a PDF viewer. Mobile has no create flow. No push or inbox reminder (OQ-RRL-3).
