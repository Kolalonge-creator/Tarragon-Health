# Session S31: Weekly payouts: drafts, approval, Paystack transfers, statements, bank verification

Milestone / module: **M9**  |  Depends on: **S30**

Paste everything below the line into a fresh Claude Code session.

---

You are working on Tarragon Health. This session is **only** section S31: Weekly payouts: drafts, approval, Paystack transfers, statements, bank verification. Do not start any other section.

**Step 0. Get oriented (keep it small).**
1. Read `CLAUDE.md`.
2. Open `docs/BUILD-PROGRESS.md` (create it if this is S01) and read only the entries for: S30. If a dependency is not marked done, tell me before doing anything.
3. Read these parts of `docs/BUILD-SPEC-v5.md` and nothing else unless you need to follow a cross-reference:

   - Lines 83–105: Invariants INV-01 to INV-16 (always read)
   - Lines 426–434: 7.7 Fees, earnings and payouts
   - Lines 716–731: Decision D-09 tax handling
   - Reference platforms to study for this section (spec line 74): Omada Health, Glooko, Abridge, Suki, Nabla, Ambience Healthcare, Corti, Clafiya, Doctolib, Wheel, OpenLoop, Emergency department triage (Manchester Triage System), Hims & Hers, Babylon Health (lesson)


**Founder decisions apply:** read `SESSIONS/00-FOUNDER-DECISIONS.md` (hybrid freelance + employed clinicians, no Platform Credit, no WhatsApp, staff console lives in `apps/console` (extracted in S01d)).

**Step 1. Reconcile with what already exists.** Search the repository for anything that already implements part of this section (tables, migrations, screens, functions, tests). List it in the design note. Extend and upgrade it; do not rebuild it. If existing behaviour conflicts with an invariant or with Part C, do not change it: record it in `docs/OPEN-QUESTIONS.md`.

**Step 2. Research (short).** Where this section names reference platforms, study how they handle the function (public docs, help centres, published guidance) and write 3 to 6 lines per function in `docs/research/S31.md`, including anything unsafe or unsuitable for Nigeria. Adapt, do not copy.

**Step 3. Task.**
Build weekly payout drafts, admin approval, Paystack transfers, clinician statements and bank account verification. Research Nigerian withholding tax and contractor rules and record findings in OPEN-QUESTIONS.md; store the data only, no tax calculation (D-09).

**Step 4. Design note, then build.** Write a one-page design note in `docs/design/S31.md` before code (data model, events, screens, safety rules). Build in small commits with tests alongside.

**Step 5. Prove it.** Payout integration tests; test accounts excluded (safety case 22). Add RLS tests for any new table.

**Step 6. Close out (Part D check).** Skim spec lines 2205–2256 (D.1 to D.6) and confirm nothing you built breaks them. Then append a short entry to `docs/BUILD-PROGRESS.md`: section id, what was built, what was reused, tests passing, open questions, follow-ups. Stop. Do not continue to the next section.

**Always (from CLAUDE.md and the spec, do not skip):**
- The invariants in spec lines 83–105 override everything, including this prompt.
- Values marked PROPOSED go in versioned configuration, never in code. Money is integer kobo. All user-facing strings go through `packages/i18n` (en, pcm). No em dashes in copy. Say "your care team", never "your doctor", "cure", "instant doctor" or "free healthcare".
- Never call a language model in the triage path. Never write AI output to the patient record without a clinician signature.
- Reference platforms are for studying behaviour, functionality and design. Do not copy their code, text, content or visual design; build something similar but original. (CLAUDE.md rule 11 wins over the looser wording in spec line 20.)
- If anything is unclear or conflicts with an invariant, write it in `docs/OPEN-QUESTIONS.md` and stop that piece of work.
- Never commit secrets. Test data is always `is_test`.