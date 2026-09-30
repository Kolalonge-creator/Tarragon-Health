# Decisions

Append-only log of decisions that shape the v5 build. Newest section first. A change to a
spec invariant (INV-01 to INV-16) needs a written founder decision here.

## Founder decisions, 2026-09-30

Source: `docs/v5-sessions/00-FOUNDER-DECISIONS.md`. These settle conflicts between the v5 spec
(`docs/BUILD-SPEC-v5.md`) and the live platform. Every session inherits them.

| ID | Decision | Consequence |
|---|---|---|
| F-01 | **Platform Credit is removed.** Patients pay per service at checkout, with no stored balance (v5 INV-09 stands). Reason: avoid stored-value regulation. | Removal is its own session, S01b. |
| F-02 | **WhatsApp is removed.** In-app, push and email only. SMS stays for verification codes only. | Removal is its own session, S01c. |
| F-03 | **Clinician model is hybrid.** Freelance verified clinicians (v5 credentialing, Next-task queue, per-task fees, on-call) work alongside Tarragon-employed doctors. Do not delete the employed-doctor tiers or auto-assignment. Both feed the same task queue and paging. Employed doctors are paid by salary, not per-task fees; `employment_type` (employed / freelance) decides the earnings path. | S15-S20, S30, S31 and S76-S78 must support both. Overrides Part C.2 "Salaried clinicians". |
| F-04 | **Staff console is split out (long-term choice).** `apps/web` keeps marketing and the patient web dashboard. A new `apps/console` (Next.js, staff only: clinician, ops, clinical lead, admin, partner areas) is extracted in S01d, on its own domain with stricter security headers. `apps/mobile` keeps its name. Shared code moves into `packages/`. | All new console work in S35, S36 and S76-S78 is built in `apps/console`. |

## v5 spec decisions (Section 19), defaults until decided

D-02 to D-04 are not defined in the spec.

| ID | Decision | Default until decided |
|---|---|---|
| D-01 | Build order: Stage 1 is the blood pressure journey | Assumed confirmed |
| D-05 | Termii sender ID | Pre-whitelisted sender in production; own sender ID later |
| D-06 | Laboratory revenue model | Patient pays lab directly and uploads result |
| D-07 | Video provider | Build the interface and a mock; wire the chosen adapter in M5 |
| D-08 | Speech-to-text provider | Build the interface and a mock; wire the chosen adapter in M5 |
| D-09 | Clinician tax handling (withholding tax) and contractor status | Store data only; no tax calculation. Spec note: check Nigerian rules and build this |
| D-10 | Group indemnity for clinicians | Clinician-provided certificate required |
| D-11 | Percentage fees and fee-sharing under Nigerian medical ethics | Fixed fee per task type; consultation share configurable |
| D-12 | Clinician paging channel beyond push and email | Push, in-console alarm and email only; escalation to ops |
| D-13 | App text languages at launch | English and Pidgin |

## Session decisions

### S01, 2026-09-30
- v5 spec copied verbatim to `docs/BUILD-SPEC-v5.md`; never edited, later sessions cite its line numbers.
- PROPOSED values live in versioned configuration (`packages/shared/src/proposed-config`), never in code.
- Copy-lint starts in warn-only mode; existing violations are inventoried in `docs/RECONCILIATION.md`, not mass-edited.
