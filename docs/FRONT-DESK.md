# Front Desk

Design record for the AI front desk and follow-up system (spec: "Tarragon Front Desk: Build Specification v1.0"). Decisions FD-1 to FD-5 are in `docs/DECISIONS.md`. Status by milestone is at the bottom.

## What it is

An AI receptionist on the website, a follow-up email engine for stalled sign-ups and enquiries, a HubSpot link, and a Friday report. It exists because enquiries wait for the founder, a real sign-up stalled for over a week with no reply, and there are no response-time or conversion numbers to show HMOs and partners.

## Where it differs from the spec, and why

| Spec | Built | Reason |
|---|---|---|
| SMS via Termii (finish_signup day 1) | Email | CLAUDE.md: SMS is verification codes only (OQ-05); no sender ID approved |
| Pidgin templates and eval set | English only | Founder, 2026-10-07 |
| Voice agent, Meta DMs | Not built | Outside the M1 to M5 build order |
| `RESEND_FROM_ADDRESS` | Existing `RESEND_FROM` | The platform already uses it in two places |
| Models, spend cap in env | `fd_app_config` rows | Spec section 11 says app_config; one place to change them |
| Edge Functions for every F-number | Edge Function for the dispatcher, Next.js routes for chat | The AI governance wrapper (`runGovernedAi`) lives in `apps/web` |

## Rules that are enforced in code or the database, not by the model

- Nothing sends until a person approves the exact wording; editing approved wording returns it to draft (trigger).
- Follow-ups start off and in dry-run (`fd_app_config.followups_enabled`, `followups_dry_run`).
- The assistant states only approved `fd_knowledge`; prices come from live config, never from text.
- AI-023 is registered disabled with no evaluation or approval seeded. While it is off, the widget shows a contact form.
- Every table has `organisation_id` (default Tarragon Health Direct); staff reads are organisation scoped; nobody writes directly, not even an admin. Writes go through the service role or the audited RPCs.
- The audit log is append only, including for the table owner.

## Known gaps carried to later milestones

- `transcript_retention_days` is a setting only; the purge and the contact-erasure path (conversations keep their text when a contact is deleted) are built in M2 (F10) and M5. Until then the 365-day retention promise is not enforced and must not be stated in the privacy notice.
- Approving wording and enabling sends are admin only. Delegated `leads.manage` holders can draft wording and switch the assistant off, nothing more.
- The migration version must be checked against the live project (`list_migrations`) immediately before it is applied.

## For the DPO before launch

Processors that will see personal data: Anthropic (chat text), Supabase, HubSpot, Resend, Vercel. Confirm data processing terms and the cross-border transfer basis for each. Account-setup reminders to someone who already has an account are recorded under basis `contract`; marketing sequences (`reengage_7d`, `health_check_interest`) need an explicit `marketing` consent row. Raw transcripts are kept 365 days (`transcript_retention_days`), then summarised and deleted. A breach runbook already exists at `docs/legal/breach-notification-runbook.md`.

## Milestones

| | Status |
|---|---|
| M1 Foundations (schema, RLS, config, audit log, knowledge and sequence drafts) | Built; proof `packages/db/tests/fd_m1_front_desk_foundations.sql` |
| M2 Follow-up engine | Not started |
| M3 CRM link | Not started |
| M4 Chat receptionist | Not started |
| M5 Reporting and review | Not started |
