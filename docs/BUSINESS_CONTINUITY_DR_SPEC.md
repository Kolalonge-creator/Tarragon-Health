# Tarragon Health — Business Continuity & Disaster Recovery Spec

> The authoritative source on recovery-objective targets (RTO/RPO), the platform's service
> dependency map, and backup-verification status. Defers to `docs/ARCHITECTURE.md` for system
> topology and to `docs/legal/breach-notification-runbook.md` for privacy/confidentiality incidents
> specifically — this doc is about *availability*, not data exposure. Operational response to an
> outage lives in `docs/PLATFORM_OUTAGE_RUNBOOK.md`.
>
> Written from a gap audit against a pasted enterprise business-continuity governance spec
> (2026-08-30): of its ~19 checkable clauses, none were fully built. This doc closes what's honestly
> buildable without founder-only credentials (Sentry billing, GitHub secrets) or a real org this
> company doesn't have yet (see §4). Items still blocked on the founder are listed at the bottom of
> each section rather than silently dropped.

---

## 1. Recovery objectives (RTO/RPO) by service tier

These are **targets**, not measured SLAs — nothing here has been drilled yet (see §3). Stated
honestly as the bar to aim for, not a claim it's already met.

| Tier | Service | RTO target | Why this tier |
|---|---|---|---|
| 0 | Abnormal-result → Category-1 escalation pipeline | ≤ 1 hour | Tightest tier — the platform's own launch gate requires the clinician WhatsApp alert within 60 seconds, and the case then carries a 4-hour clinical contact SLA (`docs/ARCHITECTURE.md:237,242`). An hour of pipeline downtime already eats a meaningful slice of that clock. |
| 1 | Core clinical data plane (vitals, meds, messaging, escalations generally) | ≤ 4 hours | Everything the escalation pipeline and day-to-day care depend on. |
| 2 | Payments (Paystack/Stripe) | ≤ 24 hours | Genuinely loose — both providers retry their own webhook delivery, and `supabase/functions/paystack-webhook/index.ts:145-172` already makes a delayed or duplicated replay a safe no-op via a `(provider, provider_event_id)` unique-constraint insert. |
| 3 | Notifications (WhatsApp/Termii/push/email) | ≤ 24–48 hours | Loose **by design**, not neglect — CLAUDE.md makes WhatsApp/SMS additive-only and never a required interface for any core action. |
| 4 | ML microservice | No fixed RTO | `packages/shared/src/ml-client.ts`'s own doc comment: "**5-second timeout, graceful fallback.** This client MUST NEVER throw — it returns `null` on any error... Every caller must have a non-ML fallback path." Platform correctness doesn't depend on ML being up at all. |
| 5 | Marketing site | ≤ 48 hours | No patient-safety impact; a public-content outage is an inconvenience, not a clinical risk. |

**RPO — stated honestly as unconfirmed.** None of the Supabase MCP tooling available in this
sandbox (`list_projects`, `get_project`, `list_extensions`, `get_advisors`, `list_migrations`,
`execute_sql`) exposes backup/PITR configuration — that's a Supabase-dashboard-only setting
(Settings → Database → Backups). **Do not treat any RPO number as confirmed until the founder (or an
agent with explicit sign-off to open a Supabase branch) actually checks it and, ideally, runs the
restore drill in §3.**

---

## 2. Service dependency map

One row per real dependency: what breaks, and the actual fallback that exists today — or an honest
flag that none does. Everything here is cited against real code, not asserted.

| Dependency | What breaks if it's down | Existing fallback |
|---|---|---|
| Supabase Postgres / RLS | Everything — this is the platform. | None; it's the thing everything else falls back *to*. Backup/restore status: see §3. |
| Supabase Auth | **No documented fallback exists today — a real gap, not previously written down.** `apps/web/src/proxy.ts` runs `updateSession()` (`apps/web/src/lib/supabase/middleware.ts:11-40`) on nearly every request via its matcher, which calls `supabase.auth.getUser()` with no timeout or `AbortController`. A slow/degraded Auth service can hang page loads generally, not just login. `getCurrentUser()`'s `React.cache()` wrap (`apps/web/src/lib/supabase/server.ts:42-52`) only dedupes repeated calls within one request — it adds no resilience to a degraded Auth service. |
| ML microservice | Risk scores, HbA1c trajectory, lifestyle-coaching nudges lose their ML-derived component. | Full, real fallback — see Tier 4 above. `apps/web/src/lib/lifestyle/coaching-run.ts:7-9` documents the same pattern in practice: "if the ML service is unreachable... falls back to a local recency heuristic." |
| Paystack / Stripe | New payments/subscription changes stall. | Webhook-driven with provider-side retry, plus local idempotency (`paystack-webhook/index.ts:145-172`, see Tier 2 above). |
| WhatsApp / Termii | Reminders/alerts/confirmations don't arrive on that channel. | Termii SMS is WhatsApp's documented fallback (`docs/ARCHITECTURE.md:35,260,272` — "SMS (Termii) is the fallback when WhatsApp delivery fails"), and per-row email delivery degrades independently: "without `RESEND_API_KEY`, email rows fail with a clear `last_error` and other channels are unaffected" (`.env.example:96-97`). No core action ever depends on any of these succeeding — see CLAUDE.md's Non-Negotiable Business Rules. |
| Vercel (hosting) | The whole app is unreachable. | None possible at the code level; no secondary hosting is provisioned. Accepted, unmitigated platform risk — same category as having a single Supabase project. |
| Upstash Redis | Rate limiting loses cross-instance coordination. | `apps/web/src/lib/rate-limit.ts:10-22` documents its own real degrade path: Redis is used automatically once `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are set, and falls back to an in-process sliding window otherwise — real, active protection today, just not distributed across warm instances. **Note:** as of the last audit these env vars have never actually been set anywhere in the repo, so rate limiting currently always runs on the in-memory fallback path, not because Redis is down but because it was never provisioned. |

**Founder-blocked item:** none in this section — the dependency map itself is complete. The Auth
gap it surfaces (no fallback for a degraded Supabase Auth) is a real, open engineering item, not a
founder-only one — worth a future ask if it's ever worth the complexity of adding a timeout there.

---

## 3. Backup & restore

**What's verified:** nothing. **What's not:** whether PITR is even enabled on the live project, what
its retention window is, and whether a restore has ever actually worked. This section previously
didn't exist at all.

**One-time procedure for the founder to run:**
1. Supabase dashboard → the `koiplnmbgnqnbywhpjlf` ("Tarragon Health") project → Settings →
   Database → Backups. Confirm PITR is enabled and note the actual retention window.
2. Test the mechanism on a **non-production branch only** — Supabase's `create_branch` MCP tool (or
   the dashboard's own branching UI) creates an isolated copy; a restore test belongs there, never
   against the live project via `restore_project`, which is destructive and overwrites the running
   database.
3. Once run, replace the placeholder RTO/RPO numbers in §1 with the numbers actually measured —
   this doc's targets are honest guesses until then, not proof.

---

## 4. Solo-founder continuity

The pasted governance spec this doc responds to assumed eight separate staffed departments
(clinical, engineering, pharmacy, laboratory, care coordination, customer support, finance,
operations), each with its own continuity plan, plus a dedicated staff emergency-communication
channel. **Tarragon runs solo/near-solo through Claude Code today.** Writing eight department plans
for departments that don't exist produces documents nobody would ever read or follow — worse than no
document. This section replaces that assumption with the one continuity question that's actually
real right now.

### If the founder is unreachable

- [ ] **Emergency access.** Name who holds emergency access to each of: Vercel, the Supabase
  project, the domain registrar, and the GitHub org — and how (a sealed password-manager share, a
  designated backup admin, whatever mechanism is actually set up). *Not yet filled in — this is a
  template, not a completed plan.*
- [ ] **Who patients and partners are told to contact.** A single point of contact for "the founder
  is unreachable and something needs a decision only they can make."
- **What a stand-in should never attempt:** clinical judgment. Tarragon employs its own doctors
  specifically so that care decisions are always made by a licensed clinician — a non-clinical
  stand-in's job in an outage is keeping the lights on (infrastructure, communication, vendor
  contact), never practicing medicine. If the founder is a clinician and is the one unreachable, the
  employed care-team doctors (per the Clinical Tier Ladder in CLAUDE.md) continue clinical coverage
  on their own — this checklist is about business/technical continuity only.

**Founder-blocked item:** the two checklist boxes above need real names and a real access mechanism
filled in — that's the founder's own decision, not something this pass can invent.

DPO/NDPC status is tracked in `docs/legal/nigeria-regulatory-compliance-status.md` (as of its last
update: no DPO named, NDPC registration status unconfirmed — both marked "Requires external action")
— cross-referenced here, not restated, since it changes independently of this doc.

---

## 5. What already partially covers "the platform is down" (§90.7/§90.12)

Building a real offline-first sync layer — a queue, conflict resolution, background replay — is
deliberately **not** part of this pass. It would reverse a patient-safety decision already made
elsewhere in the codebase: the service worker intentionally never caches clinical/API data, and a
failed mobile vitals write just errors rather than queuing for later replay, because a stale vitals
reading or a silently-delayed escalation is a real hazard on a chronic-disease platform. Reversing
that is a product decision, not a documentation gap this doc should paper over.

What already exists, cheaply, covers part of the same need — a patient or clinician having *something*
readable when the live platform is unreachable:

- `apps/web/src/app/api/patient/health-passport/pdf/route.ts` — a downloadable PDF care summary.
- `apps/web/src/app/(dashboard)/patient/emergency-card/print/page.tsx` — a printable emergency card.
- `apps/web/src/app/api/patient/quarterly-report/pdf/route.ts` — a downloadable quarterly report.

None of these were built for continuity purposes, but each already gives a patient or clinician an
offline-readable snapshot of the record. That's a real, if partial, answer to "what does someone
have if the platform itself is down" — worth knowing about before building anything new for the same
purpose.
