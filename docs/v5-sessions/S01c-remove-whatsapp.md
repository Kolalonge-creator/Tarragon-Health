# Session S01c: Remove WhatsApp

Milestone / module: **M0 follow-up**  |  Depends on: **S01**

Paste everything below the line into a fresh Claude Code session.

---

You are working on Tarragon Health. This session is **only** section S01c: Remove WhatsApp. Do not start any other section.

**Step 0.** Read `CLAUDE.md`, `SESSIONS/00-FOUNDER-DECISIONS.md` (or docs/DECISIONS.md) and `docs/BUILD-PROGRESS.md` (S01 entry only). Then read `docs/BUILD-SPEC-v5.md` lines 83-105 and Part C.2 (lines 2182-2200).

**Step 1. Count before you cut.** Query the live schema and code for everything this touches. Put the row counts in the migration header. Never hand-type a migration timestamp; check `list_migrations` on the live project first. Work from a fresh worktree off `origin/main-dev`.

**Step 2. Task.**
Remove WhatsApp as a channel: the inbound webhook, `/clinician/support-inbox` WhatsApp path, the whatsapp notification channel and templates, WhatsApp branches in `send-pending-notifications` and any doctor-alert-by-WhatsApp path (red/abnormal paging must move to push, in-console alarm and email, per v5 D-12).
- **Safety first.** The abnormal-screening and emergency escalation paths currently alert doctors by WhatsApp. Before removing, map each such path and confirm a replacement channel (push, in-console alarm, email) is live and tested. A silent loss of clinician alerting is the main risk here.
- Delete the enum VALUE for the channel; check `notification_channel`-style enums, preferences columns and consent types. Existing WhatsApp-only patients: count them and record how they will be reached in app.
- Redeploy the edge function from source and verify the deployed version matches (the repo has a history of drift).
- Update copy that mentions WhatsApp (marketing, onboarding, footers) to say the in-app route.

**Step 3. Follow the repo's feature-removal pattern** (see CLAUDE.md): delete enum VALUES, not only code paths; rewrite dependent views and policies before dropping what they reference; end the migration with a DO block of assertions proving removal; prove RLS changes with a simulated session plus a control in a rolled-back transaction; reconcile `seed.sql`; update marketing, in-app copy and docs so nothing still promises the removed feature.

**Step 4. Prove it.** Add regression tests (a BEGIN/ROLLBACK proof in `packages/db/tests/` registered in `ci.manifest` and a Jest test where app code changed). Run `/code-review high` on the diff, naming money and silent-failure classes explicitly, before any PR.

**Step 5. Close out.** Append to `docs/BUILD-PROGRESS.md` and to CLAUDE.md's Known follow-ups only what is durable. Stop.

**Always (from CLAUDE.md and the spec, do not skip):**
- The invariants in spec lines 83–105 override everything, including this prompt.
- Values marked PROPOSED go in versioned configuration, never in code. Money is integer kobo. All user-facing strings go through `packages/i18n` (en, pcm). No em dashes in copy. Say "your care team", never "your doctor", "cure", "instant doctor" or "free healthcare".
- Never call a language model in the triage path. Never write AI output to the patient record without a clinician signature.
- Reference platforms are for studying behaviour, functionality and design. Do not copy their code, text, content or visual design; build something similar but original. (CLAUDE.md rule 11 wins over the looser wording in spec line 20.)
- If anything is unclear or conflicts with an invariant, write it in `docs/OPEN-QUESTIONS.md` and stop that piece of work.
- Never commit secrets. Test data is always `is_test`.