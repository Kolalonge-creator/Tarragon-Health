# Session S01b: Remove Platform Credit

Milestone / module: **M0 follow-up**  |  Depends on: **S01**

Paste everything below the line into a fresh Claude Code session.

---

You are working on Tarragon Health. This session is **only** section S01b: Remove Platform Credit. Do not start any other section.

**Step 0.** Read `CLAUDE.md`, `SESSIONS/00-FOUNDER-DECISIONS.md` (or docs/DECISIONS.md) and `docs/BUILD-PROGRESS.md` (S01 entry only). Then read `docs/BUILD-SPEC-v5.md` lines 83-105 and Part C.2 (lines 2182-2200).

**Step 1. Count before you cut.** Query the live schema and code for everything this touches. Put the row counts in the migration header. Never hand-type a migration timestamp; check `list_migrations` on the live project first. Work from a fresh worktree off `origin/main-dev`.

**Step 2. Task.**
Remove Platform Credit (`platform_credit_balances`, `platform_credit_ledger_entries`, `grant_platform_credit`, spend-from-credit paths in checkout, top-up flows and UI). Patients pay at checkout for each item via Paystack; Care Vouchers are a separate decision and must NOT be touched here.
- **Money first.** Count balances. If any real `paid`-bucket balance exists, do NOT delete it: stop, list the accounts and amounts in `docs/OPEN-QUESTIONS.md`, and propose a refund-to-original-payment plan for the founder to approve. `promo` bucket balances can be expired with notice, also founder-approved.
- Remove the finance-console/GL postings that reference credit, or keep them read-only for history if closed periods need them; say which and why.
- Confirm no other feature (vouchers, refunds, sponsor flows) depends on credit as a payment source.

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