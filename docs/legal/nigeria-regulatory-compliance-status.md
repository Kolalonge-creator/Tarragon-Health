# Nigeria Regulatory Compliance — Status Scorecard

*Working document, not a legal opinion. This consolidates a Nigeria-regulator-lens review of the platform (31 July 2026) and everything built in direct response to it. Every "Code-complete" item below is a genuine, live-verified engineering control — none of it is a substitute for the external actions (legal review, licensing, registration) also listed, and nothing here should be read or repeated externally as "regulator-approved," per this codebase's own standing rule never to claim that. See `docs/legal/cover-memo-to-counsel.md` for the counsel-facing version of the same review.*

## How to read this

- **✅ Code-complete** — a real, live, verified engineering control exists. Doesn't mean the underlying legal/regulatory question is resolved — several items are structural risk controls built *because* the legal question is still open, precisely so the platform isn't defenceless while waiting for an answer.
- **📄 Documentation-complete** — a draft document exists (runbook, DPIA, consent text) but has not been reviewed or approved by counsel or a DPO.
- **🔴 Requires external action** — nothing further can be done from inside a coding session. Needs a real person: a lawyer, a regulator, an appointed officer, a signed contract.

---

## 1. NDPC / Nigeria Data Protection Act 2023

| Item | Status | Detail |
|---|---|---|
| Data Processing Consent, Telehealth Consent, Terms of Service accurately describe the live platform | ✅ Code-complete | Rewritten 31 July 2026 (v3) — the version real patients were agreeing to before this pass described a narrower, abandoned product (`docs/legal/schedule-{a,b,c}-*.md`, live in `consent_versions` as of migration `20260731030000`) |
| DPIA for general health-data processing | 📄 Documentation-complete | `docs/legal/dpia-health-data-processing.md` |
| DPIA for AI-assisted case-brief processing (Anthropic) | 📄 Documentation-complete | `docs/legal/dpia-ai-case-briefs.md` — flagged as a genuinely new transfer, not covered by any prior assessment |
| Breach-notification runbook + operational tracking | ✅ Code-complete | `docs/legal/breach-notification-runbook.md` + `/admin/settings/data-breach-incidents`, with an automated 72-hour-deadline alert (migration `20260731040000`) |
| Data Protection Officer appointed | 🔴 Requires external action | No DPO named. A real person must be appointed. |
| NDPC registration | 🔴 Requires external action | Status unconfirmed; needs a filing with the NDPC. |
| Lawful cross-border transfer mechanism (Supabase, eu-west-1) | 🔴 Requires external action | The single highest-priority open item in the whole review — needs counsel to select and document a mechanism (adequacy, contractual safeguards, or explicit consent). |
| Data-processing agreement with Anthropic | 🔴 Requires external action | Needed before the AI case-brief feature can be considered fully assessed. |
| Formal data-retention schedule | 🔴 Requires external action | No exact per-category retention periods exist yet; needs counsel input. |

## 2. CBN / fintech (Health Wallet)

| Item | Status | Detail |
|---|---|---|
| Tiered balance ceilings (unverified vs. identity-verified wallets) | ✅ Code-complete | `wallet_kyc_tier_limits` (₦50,000 default / ₦500,000 verified — placeholder figures, admin-editable), enforced prospectively at checkout via `wallet_kyc_balance_headroom`, verified live |
| Non-blocking compliance flagging (over-cap balance, large sponsor top-up, one payer funding several wallets) | ✅ Code-complete | `wallet_compliance_flags`, populated by `private.wallet_apply`, reviewed at `/admin/settings/wallet-compliance` |
| CBN Payment Service Provider licence, or confirmed pass-through status under Paystack/Stripe's own licence | 🔴 Requires external action | **This is the single highest-severity open item found in this review.** No CBN authorisation exists or has been sought. Needs a legal opinion on whether the wallet as designed requires one. |
| AML/CFT transaction-monitoring obligations beyond what's built | 🔴 Requires external action | The flagging built here is a reasonable precaution, not a confirmed regulatory-adequate AML programme. |

## 3. MDCN / clinical staffing

| Item | Status | Detail |
|---|---|---|
| Doctor registration verification + automatic overnight suspension on lapse | ✅ Code-complete | Already built (`private.run_clinician_activation_guard`), predates this review |
| Credential-gap visibility in admin UI | ✅ Code-complete | `MissingCredentialBadge`, built in the 2026-07-30 GMC-review pass that preceded this session |
| Five-tier clinical-authority model correctly described to patients | ✅ Code-complete | Schedules B/C rewritten to describe the real ladder, not the fictional two-model system the prior consent text claimed |
| MDCN's written confirmation that the tier-authority split (e.g. a Tier 1 doctor confirming refills but never initiating new prescriptions) is compliant | 🔴 Requires external action | Never claimed as regulator-approved anywhere on the platform, per standing rule — but also never actually sought. |

## 4. PCN / NAFDAC / facility licensing (partner network)

| Item | Status | Detail |
|---|---|---|
| Regulatory license/registration tracking on every partner catalogue (labs, pharmacies, specialists, home-visit providers, logistics partners) | ✅ Code-complete | `license_type`/`license_number`/`license_expires_at`/`license_verified_at` on all 5 tables, migration `20260731010000` |
| Hard gate blocking new assignment of an expired-license partner | ✅ Code-complete | Extended for `home_visit_providers`/`logistics_partners`, the two tables with an existing assignment-time trigger to extend; verified live |
| Nightly admin alert on expiring/expired partner licenses | ✅ Code-complete | `partner-license-expiry-alerts-daily` cron, in-app only |
| Same hard gate on `lab_providers`/`pharmacy_partners`/`specialist_providers` | 🔴 Not built this pass | These three don't have an existing assignment-time trigger to extend (their FK is set via RPC, not a bare column write) — flagged as a follow-up, not silently skipped. |
| Actual partner license numbers entered for real partners | 🔴 Requires external action | The tracking mechanism exists; nobody has populated real license data for the existing seeded/real partners yet. |

## 5. State-level telehealth service registration

| Item | Status | Detail |
|---|---|---|
| Confirmation of whether the platform entity itself needs state-level telehealth registration, separate from individual clinician MDCN licenses | 🔴 Requires external action | Not investigated by this session beyond flagging it — this needs a real conversation with the relevant state Ministry of Health, not a code change. |

## 6. FCCPC / consumer protection

| Item | Status | Detail |
|---|---|---|
| Pre-purchase auto-renewal disclosure on the subscription onboarding flow | ✅ Code-complete (already existed) | Confirmed present before this session started |
| Pre-purchase disclosure on the "Change plan" and "Add-on" actions on the live subscription-management page | ✅ Code-complete | Real gap found and fixed this session — those two actions had zero renewal-terms disclosure at the point of clicking |
| Whether the current "cancel any time, no pro-rata refund" position meets FCCPC's specific requirements | 🔴 Requires external action | Needs counsel's view — see cover memo Question 7. |

---

## What changed this session, in one list

1. Partner regulatory license/registration tracking across all 5 partner catalogues + a hard assignment-time gate on the two tables that could support one + a nightly expiry alert.
2. CBN-shaped tiered KYC balance ceilings on the Health Wallet, enforced prospectively at checkout, plus non-blocking AML-style compliance flagging and an admin review UI.
3. A full, accurate rewrite of the counsel-facing legal package (cover memo + all three schedules) — the prior version described an abandoned, narrower product.
4. **The live `consent_versions` rows real patients were agreeing to were rewritten to match** — this was the most consequential single finding: patients were consenting to a description of a product that does not exist.
5. A real, operational breach-notification runbook + incident-tracking admin page with an automated 72-hour-deadline alert.
6. Two DPIA drafts (general health data; AI case-brief processing) grounded in the platform's actual architecture, not generic boilerplate.
7. A missing pre-purchase disclosure gap on two live subscription-management actions.

## What remains, and who has to do it

Everything marked 🔴 above needs a person, not a pull request: an appointed DPO, an NDPC filing, a CBN legal opinion, an MDCN conversation, a state Ministry of Health conversation, an Anthropic DPA, and — underpinning several of the above — engaged outside counsel to actually review `docs/legal/cover-memo-to-counsel.md` and its nine questions. Nothing in this scorecard should be presented to a regulator, a patient, or an investor as "compliant" — it should be presented as "here is exactly what is built, and here is exactly what is still open," which is the most honest and most useful thing an engineering pass can hand off.
