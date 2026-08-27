# Indemnity / Liability Governance Controls — Status Scorecard

*Working document, not a legal opinion or an underwriting submission. Consolidates a 2026-08-26
review of what actually reduces Tarragon's professional-indemnity/liability exposure — as opposed
to what a policy document claims — against the eight-item framework a founder review raised the
same day (tech-layer ambiguity, decision logging, human-in-the-loop, referral-out gating, MDCN
credentialing, incident logging, vendor-risk documentation, claims-vs-capability discipline).
Every "✅ Code-complete" item below is a real, live-verified engineering control (proven against
the live `koiplnmbgnqnbywhpjlf` project in a rolled-back transaction where noted) — none of it is a
substitute for the external actions (legal review, MDCN/NMCN regulatory sign-off, DPO appointment)
tracked elsewhere. See `docs/legal/nigeria-regulatory-compliance-status.md` for the adjacent
NDPC/CBN/MDCN regulatory scorecard — this document is narrower and specific to indemnity/liability
structuring. Nothing here should be repeated externally as "regulator-approved" — CLAUDE.md's
standing rule against that claim applies here too.

## How to read this

- **✅ Code-complete** — a real, live, verified engineering control exists.
- **📄 Partial / interim** — a real control exists but has a stated, deliberate limit (see Detail).
- **🔴 Requires external action or further engineering** — not built, or not enforceable yet.

---

## 1. Tech-layer / provider liability ambiguity

| Item | Status | Detail |
|---|---|---|
| No switchable "marketplace vs. provider" flag anywhere in the platform | ✅ Code-complete | The platform has never been architected as a switchable liability model. Tiers 1–3 are employed under Tarragon's institutional PI; Clinical Director/Tier 4/5 require individual indemnity, DB-enforced before activation (`private.enforce_clinical_staff_indemnity`, migrations `20260713183000`, `20260713193000`, `20260715175909`) |
| Live monitoring of lapsed indemnity on an already-active record | ✅ Code-complete | The activation gate was always write-time only by design (a genuine, documented limit — see its own migration header). `private.notify_clinical_staff_indemnity_lapses()` (migration `20260826224913`) now sweeps daily and notifies admins of an expired/expiring/no-cover Director or Tier 4/5 record with no exemption on file — notify-only, never auto-deactivates (a live check found the platform's sole real Clinical Director relies on a deliberate, named 2026-07-30 founder exemption; an auto-deactivating sweep would have stranded the only doctor the moment it ran) |

## 2. Immutable, protocol-versioned decision log

| Item | Status | Detail |
|---|---|---|
| Append-only protocol-version table, tied to signed Clinical Director approval | ✅ Code-complete | `protocol_versions` (migration `20260712210000`) — grants are select/insert only, no update/delete. Self-attribution forgery found and closed live: `approved_by`/`approved_at` are server-stamped from the caller's own active Director record (migration `20260812034845`), proven against a forged-signature attempt in a rolled-back test transaction |
| Every clinician action on a case tied to the exact protocol version + engine version live at the time | ✅ Code-complete | `case_review_actions` (migration `20260807122212`) carries `protocol_version_id` (FK, `ON DELETE RESTRICT`) and `engine_version`; `source` is pinned to `'protocol_rule'` by CHECK so no AI-authored row is possible; a confirmed/modified/dismissed row is immutable |
| Deterministic classification carries a `clinician_override` field | ✅ Code-complete | `clinician_alerts.override_level`/`override_reason`/`overridden_by`/`overridden_at` (migration `20260730095649`) — the deterministic `level` itself is never mutated |

## 3. Hard-enforced human-in-the-loop

| Item | Status | Detail |
|---|---|---|
| A clinical action cannot be confirmed without a named, tier-authorised signer | ✅ Code-complete | `private.enforce_case_review_action_attribution()` derives the signer server-side from the caller's own `clinical_staff` row; a `'proposed'` row is clinically inert by CHECK |
| Emergency-level case claim/resolve requires Tier 2+/Director | ✅ Code-complete | `private.enforce_emergency_escalation_tier()`, live-proven to block a Care Coordinator (`42501`) |
| `escalations.reviewed_by`/`reviewed_at` are server-derived, never client-supplied | ✅ Code-complete (fixed 2026-08-26) | Was the one remaining client-supplied "who did this" column on the platform, closed in migrations `20260826224252`/`20260826224420` — proven live against a spoofed-reviewer attempt (server overwrites to the actual caller). The same fix closed an ungated `'referred'` transition a Care Coordinator could previously use with no clinical-tier check at all — but corrected mid-pass (`20260826224420`) after the fix's own first draft broke an existing, deliberate safety property: a junior doctor must always be able to refer an emergency case up the chain without needing extra seniority to do so |
| Automatic further escalation on SLA timeout, logged | ✅ Code-complete (built 2026-08-26) | `private.escalate_overdue_clinician_alerts()` (migration `20260826224739`), run every 4 hours via `pg_cron`. Was the one missing half of an otherwise-real SLA system — `escalation_slas` (config, not code, migration `20260730105131`) and `sla_due_at` were already correct, but nothing ever acted on a breach; it only ever surfaced as a passive analytics count. **This was not hypothetical**: a live check before building this found 8 real open `clinician_alerts` past their SLA, two of them emergency-level and breached for over three weeks. Running the sweep once immediately generated the backdated notifications + `audit_log` entries for that real backlog |

## 4. Hard-coded referral-out gate

| Item | Status | Detail |
|---|---|---|
| A case flagged outside protocol scope cannot be resolved on-platform | ✅ Code-complete (built 2026-08-26) | `clinician_alerts.protocol_scope_exceeded` + `private.enforce_protocol_scope_referral_gate()` (migration `20260826225042`) blocks the `'resolved'` transition outright and requires a real `specialist_referrals` row for the same patient before the case can be marked `'referred'` — live-proven both ways in a rolled-back transaction |
| Full closure of the gap | 📄 Partial, limit stated in the migration itself | The flag is populated by `lib/case-cockpit/actions.ts`'s `proposeCaseActionsAction` — i.e. whenever a doctor opens/refreshes the case cockpit for that alert, this platform's own intended entry point into a case. A doctor who resolves an escalation through the plain queue form *without ever opening the cockpit* for that alert will not yet have the determination computed. Fully closing this needs either porting the red-flag threshold parser into SQL, or making cockpit fact-loading a required step before the resolve control is enabled in the UI — flagged, not attempted, in this pass |
| AI Coach lockout on an out-of-scope case | 🔴 Not attempted | Scoped out deliberately: `lib/ai-coach/graph.ts` is a LangGraph pipeline this pass could not verify the structure of well enough to change safely. The DB-level resolve/refer gate above is real and load-bearing on its own |

## 5. System-enforced clinician credentialing

| Item | Status | Detail |
|---|---|---|
| Activation blocked without SOME verification on file | ✅ Code-complete | `clinical_staff_active_requires_verification` CHECK constraint (migration `20260712220000`) — genuinely blocks `active = true` without `license_verified_at`, and blocks self-verification |
| That verification is checked against the real MDCN/NMCN register, by a second person, with an auditable trail | 📄 Partial — a real mechanism exists but isn't the one gating activation | `credential_verified_at`/`credential_verified_by` (migration `20260807163417`) is a genuinely narrower, stronger claim — a second admin explicitly confirmed the registration number against the register, self-verification blocked, and editing the number clears the verification. **It currently gates Health Passport attestation only, not activation.** A live check found every currently-active clinical record on the platform, including the founder's own Clinical Director row, has `credential_verified_at = null` — extending the gate to activation today would either fail to apply (existing rows violate it) or immediately strand every clinical account, which is the same "only one real staff member exists" governance deadlock the 2026-08-07 migration's own header already named. **Interim fix built 2026-08-25/26**: a `RegistrationCheckBadge` in `/admin/settings/clinical-staff` now surfaces "Self-attested only — not register-checked" vs. "Registration checked \<date\>" per record, and a "Verify registration" button now calls the existing `verify_clinical_staff_credential` RPC — which had no UI entry point anywhere in the app before this pass, reachable only via direct SQL |
| Resolving the underlying deadlock | 🔴 Requires external action | Needs a second real, independent admin to exist before any credential can be genuinely register-checked (self-verification is structurally blocked by design) |

## 6. Structured incident / near-miss log

| Item | Status | Detail |
|---|---|---|
| A clinical incident/near-miss reporting table, distinct from data-breach reporting | ✅ Code-complete (built 2026-08-26) | `clinical_incident_reports` (migration `20260826225518`) — confirmed as a genuine gap before building: the only prior "incident" table was `data_breach_incidents`, an NDPA-notification log for admins, unrelated to clinical incidents. `severity` includes `'near_miss'` as its own value (not folded into `'low'`), which is the specific signal an underwriter or governance reviewer is looking for |
| Anyone can file; reviewing/closing is a clinical act | ✅ Code-complete | Filing is open to any org staff, including Care Coordinators (deliberately — reporting a near-miss is not one of the three actions CLAUDE.md restricts a Care Coordinator from). Moving a report into review or closing it requires clinical tier, server-attributed, and a closed report is terminal — all live-proven |
| Feeding an actual governance review process (Tier 3 standing QA/spot-audit) | 🔴 Not built | The table and its RLS/attribution exist; a clinician-console UI to file/browse/close reports, and a recurring governance-review cadence against it, do not yet exist. This pass built the data layer only — flagged as the clear next step, not attempted here given the size of everything else in this pass |

## 7. Data-flow / vendor-risk documentation as an underwriting exhibit

| Item | Status | Detail |
|---|---|---|
| DPIA documents naming Supabase and the Anthropic API as sub-processors | ✅ Documentation exists | `docs/legal/dpia-health-data-processing.md`, `docs/legal/dpia-ai-case-briefs.md` — both explicitly labelled "Draft for legal review," not yet DPO/counsel-reviewed |
| Repackaged as a security-questionnaire response for an MGA/broker | 🔴 Not done | The raw material exists; turning it into the specific format a Lloyd's-linked MGA's security questionnaire expects is a legal/BD task, not an engineering one, and wasn't attempted in this pass |

## 8. Claims-vs-capability discipline (public + in-app copy)

| Item | Status | Detail |
|---|---|---|
| No live "1:120" ratio, "doctor-led" headline, or named-continuous-doctor promise anywhere in marketing or dashboard copy | ✅ Confirmed clean (audit only, 2026-08-26) | Grepped marketing (`apps/web/src/app/(marketing)/`) and dashboard/onboarding copy — no violations found. The omissions are actively guarded by code comments warning future editors off reintroducing them (e.g. `apps/web/src/app/(marketing)/about/page.tsx`) |

---

## Net summary for an underwriting conversation

Six of eight items are now real, DB-enforced or live-verified controls (1, 2, 3, 4-partial, 6-partial,
8). Two carry an honest, stated limit rather than a false "done": the referral-out gate doesn't yet
cover a doctor who bypasses the case cockpit entirely, and MDCN credentialing's real register-check
mechanism exists but isn't (yet, deliberately) the thing gating activation, pending a second real
admin to exist. Item 7 needs a legal/BD repackaging pass, not more engineering. This document should
be re-read and re-verified against the live database before being shown to an underwriter or broker —
per this codebase's own standing rule, treat every specific fact here as something to re-check live,
not as a permanent record.
