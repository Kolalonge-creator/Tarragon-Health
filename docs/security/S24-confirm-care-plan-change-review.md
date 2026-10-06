# Security review: `confirm_care_plan_change` acts as the signer (OQ-174)

Reviewed 2026-10-06 by the build session (an adversarial read plus the proofs in `packages/db/tests/s24b_protocol_signoff_and_confirm_hardening.sql`). This is an engineering review, not an independent one: the founder may still want an outside reviewer, and nothing here replaces that.

## What the function does
The patient presses "Yes, make this change". `public.confirm_care_plan_change(p_change)` is `SECURITY DEFINER` with `search_path = ''`. After its checks it sets the transaction-local session claims (`request.jwt.claim.sub` and `request.jwt.claims`) to the SIGNER, applies the change, puts the claims back, and then marks the change confirmed as the patient. Every existing medication trigger (attribution stamp, clinician allow-list, confirm-only, prescribing safety, prescription signature stamp) therefore sees the signer's own act. The alternative, teaching eight triggers a signed-change exception, spreads the exception and was rejected.

## What an attacker would want
1. Change a medicine, dose or plan without a clinician's signature (INV-02).
2. Act as another user after the call returns.
3. Make the audit trail point at the wrong person.

## Findings

| # | Threat | Verdict | Why |
|---|---|---|---|
| 1 | A patient confirms someone else's change | Blocked | `c.patient_id <> auth.uid()` raises 42501 before anything else. Tested. |
| 2 | A caller chooses who the signer is | Blocked | The signer is `care_plan_changes.signed_by`, read from the row. `signed_by` is stamped by the guard trigger from the signing session and is frozen once signed (a direct update is refused 42501; no API write path exists at all). Tested. |
| 3 | A caller sets the session claims or the `tarragon.change_apply` flag themselves | Blocked by exposure | `set_config` is not reachable through the API: PostgREST exposes only the `public` schema (`supabase/config.toml` `[api] schemas = ["public"]`), and no public function a signed-in user can execute builds SQL from caller text (checked: the only two public functions with dynamic SQL take a uuid or nothing). The flag is also useless on its own: the care plan guard requires a matching row in state `signed` for that plan. **Reliance:** this depends on the API exposing only `public`. If a schema or a dynamic-SQL function is ever exposed, redo this check. |
| 4 | The signer's identity leaks past the call | Mitigated three ways | (a) Claims are restored at every return point. (b) Local settings roll back with any aborted transaction or subtransaction, so a failure mid-apply cannot leave them set even if a caller catches the error (tested with a forced mid-apply failure inside a nested block). (c) NEW: after the restore the function asserts `auth.uid()` is the patient's again and otherwise raises and rolls everything back (proved by a sabotage that removes the restore). |
| 5 | A signer who has lost authority still gets a change applied | Fixed | Previously only active tier was re-checked. Now the signer must also hold a currently verified, unexpired licence at the moment of applying; otherwise the change is sent back (`needs_review`, change expired, signer told). Tested for a deactivated signer and for an expired licence. |
| 6 | A signed stop is "applied" when nothing was stopped | Fixed | A stop that matches no active medicine now returns `needs_review` instead of reporting success. Tested. |
| 7 | Double apply or replay | Blocked | The row is locked `for update` and must be in state `signed`; declined, expired and confirmed rows return `not_available`. Tested. |
| 8 | New allergy or duplicate appears between signing and confirming | Blocked | The safety findings are recomputed at confirm time and anything new sends the change back. Tested in the S24 proof. |
| 9 | Audit attribution | Accepted | The row-change audit entries written by existing triggers for the applied medicine attribute to the signer (the session identity at that moment). `care_plan_change.confirmed` in `audit_log` is written after the restore and names the PATIENT as actor, and the change row carries `patient_confirmed_at`. Anyone reading the medicine's own audit row alone could think the signer wrote it at confirm time; the signed change row and the confirmed audit row disambiguate. |
| 10 | Failure direction if Supabase changes how `auth.uid()` reads its claims | Fails closed | If the claims no longer drive `auth.uid()`, the triggers see the patient and refuse the write (the clinician allow-list and the signature trigger both reject a patient-session write of a clinician medicine); the identity assertion adds a second stop. The result is "nothing applied", never "applied unsigned". |

## Residual risks (accepted, with owner)
- The signer's tie to the patient is not re-checked at confirm time: a signature given by a clinician who has since been reassigned still stands. Clinically a signed change is the signer's decision; re-checking a live tie would make handovers silently void signed changes. Owner: CMO to confirm this reading.
- This review was written by the session that built the function. An independent review of the same function and the S10 event path is still advisable before go-live.
- Reliance in finding 3 (API exposes only `public`) should become a CI check: fail if any non-`public` schema is exposed or any exposed function builds SQL from a text argument. Not built here.

## Evidence
Proof script `packages/db/tests/s24b_protocol_signoff_and_confirm_hardening.sql` (registered in `ci.manifest`): refusals, expired licence, deactivated signer, stale stop, forced mid-apply failure with identity restored, audit actor, and a sabotage proving the identity assertion fires.
