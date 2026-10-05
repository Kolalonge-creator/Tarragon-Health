# Session S01: Reconcile v5 with the live platform, docs scaffold, safe foundations

Depends on: nothing. Run this inside the live repo (/Users/kolalonge/Documents/Tarragonhealth). Paste everything below the line.

---

You are starting the Tarragon Health v5 upgrade. This session is **only S01**. Do not start S01b, S01c, S01d or any other section.

**Sources**
- Spec: `/Users/kolalonge/Documents/Tarragon startup/001 Tarragon additional build/TARRAGON-BUILD-SPEC-v5.md` (2,436 lines).
- Extra rules for this upgrade: `/Users/kolalonge/Documents/Tarragon startup/001 Tarragon additional build/CLAUDE.md`.
- Session prompts: `/Users/kolalonge/Documents/Tarragon startup/001 Tarragon additional build/SESSIONS/` (`00-INDEX.md`, `00-FOUNDER-DECISIONS.md`).
- This repo's own `CLAUDE.md` is the operating contract for the live platform and still applies, including its worktree, migration-timestamp, RLS and `/code-review high` rules.

**Step 0. Set up safely**
1. Work in a fresh worktree and branch off `origin/main-dev` (never on main or main-dev). Check `git rev-list --count HEAD..origin/main-dev` first.
2. Copy the spec into the repo as `docs/BUILD-SPEC-v5.md` and the sessions folder to `docs/v5-sessions/`. Every later session reads the spec at `docs/BUILD-SPEC-v5.md`, and its line numbers refer to this exact file, so never edit it.
3. Read the spec lines 8-36, 39-56, 83-105 (invariants), 108-174 (architecture), 660-678 (milestones), 701-731 (extension points, decisions). Read nothing else in it.
4. Read `docs/v5-sessions/00-FOUNDER-DECISIONS.md`. Those decisions are final:
   - Platform Credit will be removed (S01b). Patients pay per service at checkout.
   - WhatsApp will be removed (S01c). In-app, push and email only; SMS only for verification codes.
   - Clinician model is hybrid: freelance verified clinicians (v5 queue, per-task fees) work alongside employed doctors. Keep both.
   - Staff console is split into `apps/console` (S01d). `apps/mobile` keeps its name.

**Step 1. Reconcile (read-only audit, no behaviour changes)**
Audit the live repo against spec Section 3 (stack, layout, roles), Section 4 (data model), Section 2 (INV-01 to INV-16) and Part C (spec lines 2162-2200). Write `docs/RECONCILIATION.md` with these tables:
- **Exists and matches:** feature, where it lives (tables, routes, functions).
- **Exists but differs:** what differs, and whether v5 or the live behaviour should win (recommend, do not decide).
- **Missing:** what v5 needs that the repo lacks.
- **Conflicts with an invariant or Part C:** anything that violates INV-01..16 or Part C, other than the four decisions above. Examples to check: stored balances, SMS or WhatsApp used beyond verification, notification text naming a condition (INV-07), staff reading clinical tables without audit (INV-10), auto-renewing billing, AI writing to the record unsigned (INV-11).
- **Role mapping:** v5 roles (patient, supporter, clinician, clinical_lead, ops, admin, partner_lab, partner_pharmacy) against the live `profiles.user_role` and `clinical_staff.doctor_tier` model.
- **Table mapping:** for each v5 table in Section 4, the live table it corresponds to, or "new".
- **Schema check against the live database, not only files:** run `list_migrations` and list tables via the Supabase MCP or CLI, because this repo has a history of live objects with no migration file.
Put every genuine conflict in `docs/OPEN-QUESTIONS.md` as a numbered question with options and your recommendation. For each conflict, stop work on that piece and continue with the rest.

**Step 2. Docs scaffold**
Create: `docs/OPEN-QUESTIONS.md`, `docs/DECISIONS.md` (copy the four founder decisions above, dated 2026-09-30, plus the existing v5 decisions D-01 to D-13 from spec lines 716-731), `docs/BUILD-PROGRESS.md` (empty log with a header explaining the format: section id, built, reused, tests, open questions, follow-ups), `docs/research/`, `docs/design/`. Do not overwrite this repo's `CLAUDE.md`; append one short section pointing to `docs/BUILD-SPEC-v5.md`, the session list, and the rule "PROPOSED values live in versioned configuration".

**Step 3. Safe foundations only (skip any that already exist and work)**
Check what exists first, then add only what is missing:
- CI running lint, typecheck and tests for every workspace, with the existing required checks left intact.
- A `packages/i18n` catalogue for `en` and `pcm` and a test that fails on a key present in one language but missing in the other.
- Design tokens (Tarragon Green #0E7C52, Clinical Navy #12324B) in a shared package.
- A versioned configuration loader for values marked PROPOSED (keys, owner, status proposed/confirmed, version, effective date), with a test that a PROPOSED value cannot be hard-coded (a lint or scan rule if practical).
- A copy-lint test for banned words in user-facing strings: "cure", "instant doctor", "free healthcare", "your doctor", and em dashes. Start it in warn-only mode and list the existing violations in `docs/RECONCILIATION.md`; do not mass-edit copy in this session.
- Sentry wired for anything not yet covered.
Do not create tables, do not touch RLS, do not change clinical behaviour, and do not move any app folders in this session.

**Step 4. Prove it**
Run lint, typecheck and all tests. Everything that passed before must still pass. Run `/code-review high` on the diff before opening a PR into `main-dev`. Confirm the migration-replay CI job is unaffected.

**Step 5. Close out**
Append the S01 entry to `docs/BUILD-PROGRESS.md`: what was built, what was reused, tests, the count of open questions, and a one-line recommendation on the order to run S01b, S01c, S01d. Then stop. Print the list of open questions that need my decision.

**Always**
- Spec invariants (lines 83-105) override everything, including this prompt.
- PROPOSED values go in versioned configuration, never in code. Money is integer kobo. User-facing strings go through `packages/i18n`. No em dashes in user-facing copy. Say "your care team".
- Never call a language model in the triage path. Never write AI output to the patient record without a clinician signature.
- Study reference platforms for behaviour and design; never copy their code, text or visuals.
- If something is unclear or conflicts with an invariant, write it in `docs/OPEN-QUESTIONS.md` and stop that piece.
- Never commit secrets. Test data is always `is_test`.
