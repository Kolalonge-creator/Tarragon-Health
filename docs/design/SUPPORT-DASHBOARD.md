# Customer Support Dashboard: gap analysis and build plan

Status: proposal, 2026-11-07. Nothing built yet. Phase 1 of the incoming
"Customer Support Dashboard" spec (codebase inspection and plan).

## 1. What already exists

Support at Tarragon is not missing. It is split across five intake stores, each
with its own worklist. Every one of them has 0 live rows today (checked against
`koiplnmbgnqnbywhpjlf`, 2026-11-07).

| Store | What it is for | Worklist today |
|---|---|---|
| `support_tickets` (+ `support_ticket_comments`, `_status_history`, `_red_flags`) | Technical problems only (CHECK, 2026-09-03). Tier 1 to 3 ladder, phone and email intake by staff, red-flag scan, clinical escalation with close guard, CSAT | `/clinician/support-tickets` |
| `navigation_requests` | Patient "I need help" card: appointment, pharmacy, lab, insurance, referral, payment, technical, other. Clinical hand-off to a care thread, CSAT | Coordinator `support-requests` tab |
| `care_message_threads` support queue (MSG-3) | Two-way conversation; every Free member's thread and every support topic. Automatic owner, least-loaded, leave-aware | `/clinician/messages`, `/clinician/care-operations` |
| `complaints` | Seven-stage complaint governance, links to clinical incidents | `/clinician/complaints` |
| `provider_complaints` | Complaints about a clinician; admin and CMO only | `/admin/provider-quality/complaints` |
| `fd_*` (Front Desk) | Website AI receptionist, leads and enquiries; admin only | `/admin/inbox`, `/admin/front-desk` |

Already in place and reused as is: internal notes vs patient-visible replies
(`support_ticket_comments.is_internal`, enforced by RLS and trigger), the
emergency red-flag scan on every inbound support text, clinical escalation that
never routes through a coordinator, support view-as (30-minute audited
sessions), the "Customer support administrator" permission preset, ClamAV
upload scanning, the refund workflow (Finance, `finance.gl.post`), the ops
incident register, and `analytics/support`.

## 2. Gaps against the spec

1. **No single workspace.** An agent has to visit up to five pages to see what
   is waiting. No combined "attention required", KPIs or team workload.
2. **No support permission actually gates anything.** `support.manage` is
   seeded but unused; support tables are open to all org staff via
   `is_org_staff` (clinicians included, finance excluded).
3. **SLA is code-only and calendar-time.** `support.sla_targets` is a PROPOSED
   config value, unconfirmed; no business-hours or public-holiday calendar; the
   clock flags but never alerts.
4. **No response templates** for tickets, help requests or complaints (only
   `care_message_templates`, for care messages).
5. **No hand-off links to Finance, Technical Ops or Provider Ops.** A payment
   ticket cannot point at a refund; a technical ticket cannot point at an
   `ops_incidents` row.
6. **No patient notice when staff reply to a ticket** (help requests and care
   threads do notify).
7. **No ticket attachments.**
8. **Knowledge base is 5 static staff articles and a patient FAQ in code.**
9. **Reports cover tickets and complaints only**; help requests and the
   message support queue are missing.

## 3. Decisions the spec collides with

The spec asks for one ticket table with every category. Building that would
reverse:

- **2026-09-03 reconciliation**: `navigation_requests` is the patient get-help
  surface; `support_tickets` is technical-only so the other categories "cannot
  silently grow back". (Recorded only in a migration header, never in
  `DECISIONS.md`.)
- **MSG-3 (2026-11-04)**: the support message queue lives on the existing
  thread table, "not a second intake... nothing duplicated".
- **Front Desk M4**: front desk conversations are admin-only (may hold symptom
  text).
- **provider_complaints**: deliberately admin and CMO only.

Two other spec items are out by standing rules and are dropped, not deferred:
WhatsApp and SMS content replies (F-02, INV-07: support replies are in-app,
with a generic "you have a message" email or push at most), and any automation
that turns an inbound email into a ticket (CLAUDE.md, FD-3).

## 4. Recommended approach: one workspace, existing stores

Build the dashboard as a **single read model over the stores that already
exist**, and add only what is genuinely missing. No new ticket table, no data
migration, and no founder decision reversed.

- `public.support_work_items` view (`security_invoker`): one row per open item
  from tickets, help requests, support-queue threads and complaints, with a
  common shape (source, reference, customer, category, priority, owner,
  status, received, SLA due, next action). RLS of each source still applies, so
  an agent sees only what they could already see. Front Desk and provider
  complaints stay out (admin-only by decision); admins get a link card.
- Actions stay with each source's existing RPCs; the workspace links into the
  current detail pages, with one new combined ticket workspace for
  `support_tickets` (three-column layout).

## 5. Phases

| Phase | Scope | Notes |
|---|---|---|
| **A. Workspace** | `/support` overview: attention panel, 8 KPIs (CSAT shows "not yet available" below a minimum sample), queue tabs over `support_work_items`, team workload, filters, saved views (per agent, browser-local), bulk assign (never bulk close or delete). Command-search entries. | Read-only over existing data plus assign |
| **B. Permissions** | `support.agent`, `support.lead` permission keys; `support.manage` starts gating. Support pages require one of them (admin always). Proof that a support agent cannot read vitals, labs, medications, notes. | Account role untouched (CLAUDE.md) |
| **C. SLA** | `support_sla_policies` (versioned operational setting, not a CMO signing) by source and priority, `support_business_hours`, `support_public_holidays`; business-hours clock; pause on "awaiting customer"; breach warning into `ops_alerts`. Clinical items stay on the clinical escalation SLA. | Targets need your answer |
| **D. Communication** | `support_response_templates` (versioned, approval status), patient notice on staff reply (generic text), ticket attachments through ClamAV, confirm-before-send on public replies. | |
| **E. Hand-offs** | Escalation links: ticket → refund request (Finance decides), ticket → `ops_incidents`, help request → provider ops; receiving team acknowledges; outcome shown to support. | Support never approves refunds or changes payments |
| **F. Knowledge base and reports** | KB table with version, approval, review dates (clinical articles need CMO approval), patient help-centre search; cross-channel report and CSV export with no clinical fields. | Reverses "KB as code" only if you choose it |
| **G. AI assist** | Category and priority suggestion, conversation summary, draft reply from approved templates, through `runGovernedAi()` and registered in `ai_systems`, human sends. | Separate AI registration; later |

Every phase ships with Jest tests and `packages/db/tests/` proofs (with a
sabotage step), and `/code-review high` before the PR.
