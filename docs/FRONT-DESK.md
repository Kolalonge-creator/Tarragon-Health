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

## Operating it (go-live runbook)

Everything below is switched off or inert until a person turns it on, in this order. None of it can be done by an automated session (it writes secrets or signs off wording).

1. **Secrets** (once): run `scripts/frontdesk-secrets.sh`. It sets `FD_FOLLOWUP_SECRET` and `FD_UNSUBSCRIBE_SECRET` as Edge Function secrets and the same values as Vault secrets `fd_followup_secret` and `fd_unsubscribe_secret`. Then set the rest as Edge Function secrets: `supabase secrets set FOUNDER_ALERT_EMAIL=<where alerts go> HUBSPOT_PRIVATE_APP_TOKEN=<token>`. `RESEND_API_KEY`, `RESEND_FROM` and `APP_BASE_URL` are already set for notifications.
2. **Deploy** the Edge Functions `fd-followup-dispatcher` and `fd-hubspot-sync` (`--no-verify-jwt`).
3. **Approve the wording** at `/admin/sign-off` (emails and knowledge). Nothing is sent or said until you do.
4. **DPO** confirms the lawful basis for account emails on `/admin/follow-ups`. Until then the detector creates no account contacts or consents.
5. **Follow-ups**: they ship ON and in dry-run. Watch `/admin/follow-ups` for a few days to see who would be emailed, then press "Go live".
6. **HubSpot**: turn "HubSpot sync" on at `/admin/follow-ups` once the token is set.
7. **The chat**: run `cd apps/web && ANTHROPIC_API_KEY=... NODE_OPTIONS=--conditions=react-server npx tsx scripts/frontdesk-eval.ts`. It must report zero unsafe and at least 95% correct. Then complete AI-023's acceptance criteria in the AI governance screen (evaluation, guardrails, monitoring, validation) and enable it there. Until then the widget takes a visitor's name and contact details and alerts you (capture-and-handoff), and an emergency message still gets the fixed emergency reply and an urgent alert.
8. **Pilot** (M7): read every handoff and every transcript for two weeks before relying on it.

Kill switches, fastest first: `assistant_enabled` (the widget becomes a contact form), AI-023's switch in AI governance, `followups_enabled`, `hubspot_enabled`, and pausing one sequence.

## What happens to a visitor, in order

kill switch -> daily spend cap -> store the message -> **fixed rules** (emergency, prompt extraction, medical advice, wants a person) -> approved knowledge -> **model** -> **output guard** -> store the reply -> handoff when a person is needed. An emergency is answered first and unconditionally, even with the assistant off, over its cap, or the database down; the alert reaches the founder's inbox within seconds through a database trigger that calls the dispatcher.

## Milestones

| | Status |
|---|---|
| M1 Foundations (schema, RLS, config, audit log, draft seeds) | Built; merged |
| M2 Follow-up engine | Built; PR open |
| M3 CRM link | Built; PR open |
| M4 Chat receptionist | Built; PR open |
| M5 Reporting and review | Not started |
