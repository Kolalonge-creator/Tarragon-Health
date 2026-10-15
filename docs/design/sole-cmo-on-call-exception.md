# Sole-CMO on-call exception

Founder decision, 2026-10-15 (the founder is also the CMO). The live organisation has one Chief Medical Officer and one other doctor.

## Problem
`public.grant_clinician_competency` refuses a grant to yourself ("you cannot grant your own competencies"). `private.rota_validate_clinician` requires the `on_call` competency, and the on-call rota needs two different people per shift. A sole CMO can therefore never be on the rota.

## Decision
A documented exception, signed by the CMO, as narrow as possible. Nothing else about maker-checker changes.

## Data model
`public.sole_cmo_exceptions`: id, organisation_id, competency_code (CHECK = 'on_call'), reason (CHECK at least 40 characters after trim), signed_by, signed_at, expires_at (default signed_at + 12 months, never null), revoked_at, revoked_by, revoke_reason, is_test. One unrevoked row per organisation and competency (unique partial index). Select only for authenticated, through RLS for an admin or the active CMO of the same organisation. No client insert, update or delete.

## Functions
- `sign_sole_cmo_exception(competency, reason, confirm)`: CMO only; `confirm` must be the typed word SIGN (so the deliberate step is enforced by the database, not only the form); competency must be on_call; reason at least 40 characters; refused while the organisation has more than one active CMO. A row that has expired but was never revoked is closed by the new signature. Audited (`sole_cmo_exception.signed`) and the organisation's admins and CMO get an in-app notice (non-clinical wording).
- `revoke_sole_cmo_exception(id, reason)`: CMO or admin of the organisation; audited; notice.
- `grant_clinician_competency` (live definition read first, every existing check kept): a self grant passes only when `private.sole_cmo_exception_active` returns an id, meaning: caller is the active CMO, the exception names this competency, it was signed by the caller, it is unrevoked and unexpired (checked at use), and the organisation still has exactly one active CMO. The credentialing level still applies. Such a grant is audited as `clinician_competency.self_granted_under_exception` carrying the exception id (not as an ordinary grant) and notifies reviewers.
- A trigger on `clinical_staff` REVOKES the exception the moment a second active CMO exists (it does not resume if that CMO leaves; a fresh signature is needed). A row whose signer is no longer an active CMO is closed by the next signature, so it cannot lock the current CMO out. A self grant that changes nothing (competency already held) writes no audit row, notice or event.
- Revoking or ending the exception does NOT remove a competency already granted; the notices and the panel say so.
- "Exactly one CMO" counts active CMOs of the same kind as the caller (real or test), so test fixtures never affect a real organisation.

## Screens
CMO sign-off hub line "Sole-CMO on-call exception: sign to be allowed on the on-call rota", shown only while the organisation has a sole CMO and no exception in force (`readPendingSoleCmoException`). Inline panel states what it allows, what it never allows and how it ends (12 months, revocation, a second CMO), asks for the reason, a tick and the typed word SIGN, and calls the server action. No new page, so no console search entry is needed (the hub itself is already searchable).

## Safety
- No notification is required for anything to work; the notices are additive. INV-07: wording names no condition, reading or patient.
- Revocation and expiry fail closed. A second CMO ends it without any action.
- Not built: revoke control in the UI (the RPC exists; revoke through an admin or SQL for now, see closeout).

## Closeout
Built: migration `20261014235005_sole_cmo_on_call_exception.sql`, hub reader + line, signing panel and action, proof `packages/db/tests/sole_cmo_on_call_exception.sql` (registered in ci.manifest).
Tests: DB proof 55 checks pass, 2 of 2 sabotages flip, run live in a rolled-back transaction with the migration applied inside it (nothing left behind, verified). Jest: reader 7, hub 3 added, action 4; tsc and ESLint clean.
Not proven: the page rendering in a browser; the exception through the real web login.
Apply order: merge applies the migration (code first is safe: the reader queries a table that does not exist yet and shows a failed-read warning on the hub until it is applied, so apply the migration promptly after merge).
Code-review (high) findings fixed: resume after a second CMO, stale-signer lockout, reader/DB definition mismatch, DB-side SIGN confirmation, audit noise, helper EXECUTE grants. Not done: typed `database.types.ts` entries (the RPCs are called through the same loose casts the neighbouring hub readers use; the types file does not carry grant_clinician_competency either); auto-removal of an already-granted competency on revoke (deliberately left, it could drop the CMO off a live rota).
Proposed OQ: should revoking remove the self-granted competency? should the hub show a revoke control and the current exception's expiry date to the CMO? Should an expiry reminder notice be sent 30 days before expiry?
