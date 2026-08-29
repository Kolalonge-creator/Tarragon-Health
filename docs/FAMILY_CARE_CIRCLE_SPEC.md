# Family Care Circle — Design Spec & Gap Analysis

> **Status: design/reconciliation doc, not a build order.** This reconciles an incoming "Family
> account" spec (§22.2–22.15 below, reproduced from the handed-in brief) against what already
> exists in the codebase — considerably more than a blank slate — and proposes a phased path. It
> does not itself authorise building anything. Subordinate to `CLAUDE.md`, which is authoritative if
> the two conflict: **`CLAUDE.md` records individual enrolment only (no family plans, no ParentCare)
> as a confirmed, shipped founder decision (2026-07-29, migration
> `20260729143514_individual_enrolment_only.sql`).** See §1 before reading any further — the incoming
> spec's central primitive (a shared "Family Group" account with an administrator) is structurally
> the thing that migration deleted. This doc does not reopen that decision; §5 flags exactly what
> would require a new, explicit founder call versus what fits inside it today.

## 0. What this document is

The brief (§22.2–22.15, Nigeria's family-centred care context) describes: a Family Group the user
creates, per-member relationship roles, a family administrator for logistics, five graded permission
levels, child accounts with an age-threshold transition, elderly-parent-by-proxy management, a
household health dashboard, household preventive-care task list, a shared payment wallet, delegated
appointment management, consent-gated notifications, a family/individual-record privacy boundary, and
a structured family-history concept — ending with an acceptance flow: *create family → invite member
→ establish consent → assign permissions → manage care → revoke access.*

Two things needed to happen before this could turn into a build plan: (1) find out what already
exists — most of the *intent* here, it turns out, already shipped under a different name and a
different governing model — and (2) check the parts that don't exist against the founder decision
that specifically killed the closest prior attempt at this. Both are done below.

## 1. The conflict to flag, and the model that replaced it

Tarragon built a "Family Plan" once: `family_plan_members` (a relationship table saying who shared
somebody else's bill), a `family_relationship` enum, tiered pricing (Family Lite/Plus/Premium,
ParentCare), a `family_dashboard` feature key, and a per-tier headcount cap. On 2026-07-29 the founder
killed all of it — "removal 4 of the four founder-approved narrowings," per `CLAUDE.md`'s "Where
things actually stand" section — specifically because **two orthogonal concepts had been tangled into
one billing construct**: *who is on the bill* and *who may see/act on a record*. The migration's own
header states the reasoning verbatim:

> "What this does NOT remove is the ability for one person to look after another's care. Two
> orthogonal models were tangled here and only one is a billing construct: `family_plan_members` who
> is on the bill *(deleted)*, `profile_access` who may see and act on a record *(kept, untouched)*."

That decision is still live in the current schema (confirmed by re-reading, not assumed from
`CLAUDE.md`): `family_plan_members` and the `family_relationship` enum do not exist;
`apps/web/src/app/(marketing)/_content/pricing.ts` lists only Tarragon Free / Essential Care /
Complete Care (no family tier); the migration ends in an assertion block that fails the whole
transaction if any trace of household billing survives, and it does still pass on the live schema.

**What replaced it is a consent graph, not a shared account**, built specifically to keep those two
concerns separate:

| Table / mechanism | What it governs | Migration |
|---|---|---|
| `profile_access` | Who may view/manage a record, at two levels | `20260706084848` |
| `profile_access.clinical_access` | A separate, owner-only, revocable boolean: may this grantee see *health* information, not just administrative activity | `20260731181143` |
| `care_access_requests` | Two-sided consent (proposal → accept/decline) before a grant is created, in either direction | `20260730025553` |
| `profiles.is_dependent_account` | Distinguishes a child with no login (unconditional grant) from an eldercare-managed adult (accepted grant) | `20260730025603` |
| `care_vouchers` / `health_wallets` | Who has actually paid for whose care — deliberately gated by a *different* predicate than clinical visibility | `care_graph_unification` (`20260807010837`), `can_fund_wallet` |
| `family_history` | A patient's own free-text record of *their family's* conditions — explicitly never auto-populated from a relative's actual record | `20260827195741` |
| `public.my_care_graph()` | One unified read of every grant, request, voucher and care-team assignment touching the caller, from the caller's own point of view | `20260807010837` |

This is, functionally, section 22's own design principle already implemented: **"payment relationship
should be separate from clinical consent" (§22.10) is not aspirational here — it's the load-bearing
architectural decision this whole graph was built around**, and it's enforced at the RLS level, not
just in application code (e.g., `care_vouchers_select` was found and fixed to require
`clinical_access`, not just any `profile_access` grant, so a next-of-kin nominated only to be phoned
in an emergency cannot read what care someone is receiving from their voucher history).

## 2. Section-by-section reconciliation

Legend: 🟢 built and working · 🟡 partially built / different shape than spec · 🔴 not built ·
⚠️ conflicts with a founder decision as literally specified

### 22.2 Family Group — 🔴 as a literal shared account entity / 🟢 equivalent intent achieved differently
No "create a Family Group" object exists, and per §1, deliberately doesn't. Each person keeps a fully
separate `profiles` row and subscription — actually *stronger* record separation than the spec's own
mockup implies. What connects them is a graph of individual, bilateral consent edges
(`profile_access`), not a group membership. `/patient/family` ("Your people") and `/patient/supporting`
("who I support") are the two sides of that graph from one person's point of view.

### 22.3 Family member roles (spouse / parent / child / dependent / other) — 🟡
`care_access_requests.relationship` is free text — every listed role is expressible, but there's no
canonical enum shared across it and the rest of the graph.
`family_history.family_relationship` (a real enum: mother/father/sibling/child/four grandparent
values/aunt_or_uncle/other) is richer but scoped only to that one table, not reused for access grants.
**Gap:** no single relationship vocabulary spans consent, history, and next-of-kin.

### 22.4 Family administrator (appointments/payments/logistics, never automatic clinical access) — 🟢 principle / 🟡 role
The *principle* — administrative authority must never imply clinical access — is exactly what
`clinical_access` being a separate, owner-only column enforces. But there's no single "administrator"
role or flag: a `manage` grant (`profile_access`/`care_access_requests`) covers bookings/logistics
(`booking_requests`, vaccination logging, etc., all RLS-extended to a manage grantee), while funding
is a wholly separate relationship (`care_vouchers.purchaser_profile_id`, `can_fund_wallet`). Different
people can hold each for the same patient — e.g. one sibling manages bookings, another funds a
voucher — which is more flexible than the spec's single-administrator model, but means there's no one
place that answers "who administers this person's account."

### 22.5 Five graded permission levels — 🟡 (two levels + one independent toggle, not five)
Current model: `view` | `manage`, plus the independent `clinical_access` boolean. Rough mapping:
- **L1** (book/pay/logistics only) ≈ `manage` without `clinical_access` — 🟢 exists.
- **L2** (limited health information) — 🔴 no equivalent; `clinical_access` is all-or-nothing today,
  there's no "limited" tier (e.g., vitals but not mental-health notes).
- **L3** (medication + appointment access) — 🟡 `manage` + `clinical_access` gets close, but again not
  separable from full clinical visibility.
- **L4** (clinical information access) ≈ `view`/`manage` + `clinical_access` — 🟢.
- **L5** (full authorised proxy) — 🟡 `manage` + `clinical_access` covers most actions, but some
  (e.g. changing the record owner's own login credentials, deleting the account, presumably signing
  legal/consent documents) are hard-scoped to the owner (`auth.uid()`) in RLS with no proxy path at
  all — full proxy in the literal sense doesn't exist, by design, and probably shouldn't without a
  specific ask.

**This is the clearest structural gap against the literal spec**: no graded 1–5 ladder, just two
coarse access levels plus one coarse clinical toggle.

### 22.6 Child accounts + age-threshold transition — 🟢 provisioning / 🔴 the transition itself
`addChildDependentAction` is solid: a password-less, non-deliverable synthetic login (`profiles.id`
is a hard FK to `auth.users`, so this is the only way to represent "a record with nobody behind it"
yet), an unconditional `manage` grant, `is_dependent_account = true`, auto-generated vaccination
schedule. Age is enforced **only at the Zod form layer** (`addChildDependentSchema`, under-18 check)
— not re-validated in the DB or the `provision_dependent_profile_basics` RPC.
**Real gap, confirmed by search — nothing found anywhere in the codebase**: no mechanism exists for
"changing access rights as the child reaches relevant age thresholds," which the brief explicitly
calls out as an architectural requirement. A child provisioned at birth stays permanently
`is_dependent_account = true` under an unconditional parental `manage` grant with no built-in
review, notice, or path to convert the synthetic login into a real one at majority.

### 22.7 Elderly parent management — 🟢 for an elder who already has an account / 🔴 for one who doesn't
The eldercare `manage` flow (`createEldercareAccessRequestAction` + `care_access_requests`, two-sided
accept) covers book/reschedule/reminders/pharmacy well — `booking_requests` RLS already admits any
`manage` grantee to insert/select on the owner's behalf. **But it requires the elder to already hold
a Tarragon account and personally accept the request** (`find_profile_by_phone` must resolve a real
profile). The brief's own literal example — "my father does not use smartphones" — describes someone
who *can't* do that. The only path that skips the accept step (child provisioning, §22.6) is
form-gated to under-18 and not intended for this case. **Gap:** no "provision an account for an adult
who will never use it directly" path exists, distinct from the child path.

### 22.8 Family health dashboard — 🟢, under a different name
`/patient/supporting`'s `useSupportedPersonHealth`/`useSupportedPersonCareStatus`
(`apps/web/src/lib/queries/sponsorship.ts`) already renders exactly the brief's mockup shape —
per-person active conditions (from `care_plans.condition`) and care status — gated per person on that
person's own `clinical_access` consent. It's split across two routes (`/patient/family` = people
around *my* care; `/patient/supporting` = people *I* support) rather than one unified "Family Health"
screen, and `AdultsYouManageList` on the first page currently renders name-only with no
condition/status roll-up even though the data model would support adding it.

### 22.9 Family preventive-care task list (vaccinations/screening/assessments/reviews across household) — 🔴
No aggregation found. Each piece exists per-person (vaccination schedules, screening recommendations,
`prevention_risk_scores`, `care_plans` reviews), and `useSupportedPersonHealth` already surfaces
per-person conditions — but nothing rolls due/overdue preventive tasks up across everyone in a
person's consent graph into one household list.

### 22.10 Family payment wallet, separate from clinical consent — 🟢, and this is the strongest match in the whole spec
Already built exactly as specified: `care_vouchers` (`purchaser_profile_id` ≠ `beneficiary_profile_id`
is a normal case — the Sponsor + Care Voucher model) and `health_wallets`/`can_fund_wallet` (anyone
holding *any* `profile_access` grant may fund a wallet) both let one person pay for another's
individual plan, and both are RLS-gated on a *different* predicate than `clinical_access`. A
next-of-kin who was only ever nominated to be phoned in an emergency cannot see what a voucher they
didn't buy was redeemed for. No shared "family wallet" ledger exists — funding is always one payer
attributed to one beneficiary — which matches the individual-enrolment model rather than a pooled
household purse.

### 22.11 Delegated appointment management (book/reschedule/cancel/reminders) — 🟢 book/see, 🟡 unverified reschedule/cancel, 🔴 reminders
`booking_requests` SELECT admits any grantee, INSERT requires `manage` — confirmed by reading
`20260724000542_booking_requests_profile_access_manage.sql`. Whether UPDATE (reschedule) and DELETE
(cancel) policies on `booking_requests` extend the same way wasn't confirmed in this pass — verify
before assuming full parity. **Reminders are the clear gap**: no notification migration or code path
found that routes an appointment reminder to a `manage`/`clinical_access` grantee — reminders appear
to go to the record owner only, so the brief's own literal example ("your mother's appointment is
tomorrow," sent to the adult child) does not currently fire to anyone but the mother.

### 22.12 Family notifications, consent-gated — 🟡 principle exists, delivery gap as above
The principle (never notify without the right consent/authorisation) is exactly how `clinical_access`
and the grant-scoped RLS already work for everything the graph *does* deliver (care messages, the
critical/vitals-red-flag notification engine). The specific case in the brief (a proxy-facing
"someone else's appointment" reminder) isn't wired — see §22.11.

### 22.13 Family privacy (never expose a relationship-implied diagnosis without authorisation) — 🟢, and enforced at RLS, not just UI
This is the two-tier `profile_access`/`clinical_access` split's whole reason for existing, and it's
DB-enforced: `private.enforce_clinical_access_consent_owner()` ensures only the record owner can grant
it, and every clinical table's RLS checks `clinical_access` specifically rather than the coarser
`manage`/`view` grant. Worth noting as a subtlety already handled correctly rather than a gap: a
`care_vouchers.sku_name` like "Diabetes Complete Care" is itself diagnosis-adjacent, and the
`care_graph_unification` migration found and closed exactly that leak (a `view`-only next-of-kin could
previously read it) — a good example of this principle being actively defended, not just aspirational.

### 22.14 Family health history, distinct from a relative's actual record — 🟢, precisely as specified
`family_history` (migration `20260827195741`) is a deliberate, founder-decided second table, explicit
in its own header comment about the exact distinction the brief asks for: "one row per
(condition, relative)... A clinician reviewing a patient's record reads both; neither is a duplicate
of the other." It is self-reported narrative (condition name + relationship + approximate onset age +
deceased/alive) and is never auto-populated from a relative's actual `profiles` record via the consent
graph — which is precisely the boundary §22.14 asks the system to maintain.

### 22.15 End-to-end flow: create → invite → consent → assign permissions → manage → revoke — 🟢 for the parts of the model that exist
`nominateNextOfKinAction`/`createEldercareAccessRequestAction` → `care_access_requests` (invite) →
`respond_to_care_access_request` (consent) → `profile_access` row with a `permission_level`
(assign) → grantee-aware RLS across bookings/records (manage) → `revoke_care_access`, revocable by
*either* party since `care_graph_unification` (revoke). This flow is real, working, and already
matches the brief's acceptance criteria almost exactly — just without a "Family Group" wrapper around
the start of it, and without the 5-level grading in the middle (§22.5).

## 3. Consolidated gap list (ranked, real gaps only — excludes anything already covered above)

1. **No age-of-majority transition for a provisioned child** (§22.6) — architectural gap the brief
   explicitly calls out; nothing exists today.
2. **No account-provisioning path for an adult who can't self-onboard** (§22.7's literal
   smartphone-less-parent case) — only the under-18 child path skips the self-accept step.
3. **No appointment-reminder delivery to a `manage`/`clinical_access` grantee** (§22.11/22.12) —
   the graph's read/write access is there; the notification routing isn't.
4. **Permission levels are 2 (+1 toggle), not 5** (§22.5) — `clinical_access` in particular is
   all-or-nothing; no "vitals but not mental health," etc.
5. **No household task/dashboard rollup** (§22.9, and the unified-screen half of §22.8) — the
   per-person data all exists; nothing aggregates it across a person's whole consent graph.
6. **No shared relationship vocabulary** (§22.3) between `care_access_requests.relationship` (free
   text) and `family_history.family_relationship` (enum).
7. Unverified: whether `booking_requests` UPDATE/DELETE (reschedule/cancel) extend to grantees the
   same way SELECT/INSERT do (§22.11) — confirm before assuming parity.

None of these 1–7 conflict with the 2026-07-29 individual-enrolment decision — every one of them is an
extension of the existing consent-graph model, not a reintroduction of shared billing.

## 4. What NOT to build without an explicit new founder ask

- **A "Family Group" as a real account/billing entity**, or any single "family administrator" account
  that controls payment for multiple people's plans as a bundle. This is structurally the removed
  `family_plan_members`/Family-tier model; reintroducing it reverses a specific, reasoned, still-live
  founder decision (§1). If the founder wants this reconsidered, that needs to be its own explicit
  conversation, not something this doc or a "the spec asked for it" reading authorises.
- **A pooled/shared family wallet** (one ledger multiple people draw from), as opposed to the current
  per-payer, per-beneficiary funding model (§22.10) — same reasoning.
- **A single blanket "full proxy" permission level** that bypasses owner-only actions currently
  hard-scoped to `auth.uid()` in RLS (credentials, account deletion, legal consent) — the current
  design deliberately keeps some actions non-delegable; loosening that is a security posture decision,
  not a UX gap.

## 5. What's safe to build now, if asked

Everything in §3 (the consolidated gap list) extends the existing, founder-approved consent-graph
model rather than reopening §4. In rough dependency order: a shared relationship enum (§3.6, small,
unblocks cleaner UI everywhere else) → household dashboard/task rollup (§3.5, purely additive reads
over existing tables) → grantee-aware appointment reminders (§3.3) → the age-of-majority transition
and the no-smartphone-elder provisioning path (§3.1/§3.2, the two that touch account lifecycle and
deserve the most care) → finer-grained `clinical_access` levels (§3.4, the biggest schema change of
the list, touches every clinical table's RLS).

## 6. Open questions for the founder

- Is the 2-level + 1-toggle access model (§22.5) intentionally simpler than the brief's 5 levels, or
  is finer-grained clinical consent (e.g., vitals-only vs. full record) worth building?
- For §22.7's literal "parent with no smartphone" case: is a guardian-style provisioning path (same
  shape as the child path, but for a consenting adult who will never log in themselves) something to
  build, or is the expectation that every adult eventually gets their own account, however delayed?
- Should `family_history`'s relationship enum become the canonical vocabulary reused by
  `care_access_requests`, or are they intentionally different (one describing biological family, the
  other describing who holds an access grant, which aren't always the same set of people)?
