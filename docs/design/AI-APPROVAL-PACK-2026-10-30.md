# AI approval pack (2026-10-30)

What is waiting for the CMO's approval in the AI registry, read from the live project on 2026-10-30. Nothing here has been approved,
and no evaluation run, prompt approval or knowledge-source approval has been created or edited by an agent.

## What an approval means

An approval records that a named person read the item and accepts it. It does not switch anything on: `ai_systems.is_enabled` and the
go-live masters (`assistant_enabled` among them) are separate, and all nine masters are off today. Approving an item you have not read
would make the record say something untrue, which is why this pack lists and does not approve.

## How to approve

Reply with the items by name, for example "approve the guardrails for AI-004, AI-005 and AI-006" or "approve everything for AI-001
except the old versions". The approval is then applied as you, by chat order, with the same method used for the earlier sign-offs, and
the result is read back from the database. Read an item first at `/clinician/clinical-signoff` (AI approvals panel) or in
`docs/AI_GOVERNANCE_SPEC.md`.

## Waiting now

| System | Status | Risk | Guardrails unapproved | Other unapproved | Latest evaluation |
|---|---|---|---|---|---|
| AI-001 | live | high | 6 | 4 older system versions (1 approved) | pass 100% (history includes failed runs) |
| AI-002 | live | moderate | 4 | none | pass 100% |
| AI-003 | live | moderate | 4 | none | pass 100% (one earlier run failed at 0%) |
| AI-004 | live | high | 3 | none | pass 100% |
| AI-005 | live | high | 3 | none | pass 100% |
| AI-006 | live | high | 3 | none | pass 100% |
| AI-007 | live | moderate | 2 | none | pass 100% |
| AI-008 | live | low | 2 | none | pass 100% |
| AI-009 | live | low | 2 | none | pass 100% |
| AI-011 | live | moderate | 4 | none | pass 100% |
| AI-012 | live | moderate | 3 | none | pass 100% |
| AI-013 | live | moderate | 4 | none | pass 100% |
| AI-014 | live | high | 5 | none | pass 100% |
| AI-015 | live | low | 3 | none | pass 100% |
| AI-010 | suspended, off | high | 4 | none | pass 100% |
| AI-016 | in evaluation, off | high | 5 | none | pass 100% |
| AI-017 | in evaluation, off | high | 7 | 1 prompt version | pass 100% (six runs) |
| AI-018 | draft, off | moderate | 3 | none | pass 100% (four runs) |
| AI-019 to AI-022 | draft, off | moderate | none | no versions, no evaluation runs yet | none |

Totals: 67 guardrails (48 on live systems), 4 system versions, 1 prompt version.

## Notes

- The live systems run today with guardrails that have no approval recorded. They are enforced as written; the approval is the record
  that a person accepts them. That is why the 48 on live systems come first.
- AI-001 is high risk and live and has the longest history of failed evaluation runs, so it deserves a read rather than a bulk approval.
- "Pass 100%" is the latest run's recorded outcome. These runs are recorded evidence; this pack did not create or alter any of them.
- AI-019 to AI-022 cannot be approved until a version and an evaluation run exist.
