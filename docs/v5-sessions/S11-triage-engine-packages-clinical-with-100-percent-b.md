# Session S11: Triage engine (packages/clinical) with 100 percent branch coverage

Milestone / module: **M3**  |  Depends on: **S10**

Paste everything below the line into a fresh Claude Code session.

---

You are working on Tarragon Health. This session is **only** section S11: Triage engine (packages/clinical) with 100 percent branch coverage. Do not start any other section.

**Step 0. Get oriented (keep it small).**
1. Read `CLAUDE.md`.
2. Open `docs/BUILD-PROGRESS.md` (create it if this is S01) and read only the entries for: S10. If a dependency is not marked done, tell me before doing anything.
3. Read these parts of `docs/BUILD-SPEC-v5.md` and nothing else unless you need to follow a cross-reference:

   - Lines 83–105: Invariants INV-01 to INV-16 (always read)
   - Lines 218–231: 4.5 and 4.6 pathways and triage tables
   - Lines 286–314: 6.1 to 6.2 Triage engine and BP rule set
   - Lines 618–659: 15 Testing and safety cases (cases 1 to 7 and 20)
   - Reference platforms to study for this section (spec line 70): Omada Health, WellDoc, Glooko, BeatO, Health2Sync, DarioHealth, Lark Health, Noom, Oviva, Twin Health, Propeller Health, Kaia Health, Sidekick Health
   - More reference platforms are named per function in Module 13, rows 13.9 to 13.17 (spec lines 1463–1471); read only the rows that fall inside this section's scope

**Step 1. Reconcile with what already exists.** Search the repository for anything that already implements part of this section (tables, migrations, screens, functions, tests). List it in the design note. Extend and upgrade it; do not rebuild it. If existing behaviour conflicts with an invariant or with Part C, do not change it: record it in `docs/OPEN-QUESTIONS.md`.

**Step 2. Research (short).** Where this section names reference platforms, study how they handle the function (public docs, help centres, published guidance) and write 3 to 6 lines per function in `docs/research/S11.md`, including anything unsafe or unsuitable for Nigeria. Adapt, do not copy.

**Step 3. Task.**
Build the pure-TypeScript triage engine exactly as specified: deterministic, no I/O, no model calls, first red wins, input validation, recheck flow. Rules are JSON from versioned triage_rule_sets. Build the shared device/server fixture set proving identical grades. Safety cases 1 to 7 and 20 must pass. Mark every threshold PROPOSED in configuration.

**Step 4. Design note, then build.** Write a one-page design note in `docs/design/S11.md` before code (data model, events, screens, safety rules). Build in small commits with tests alongside.

**Step 5. Prove it.** Safety cases 1-7 and 20; 100% branch coverage; device/server parity fixtures. Add RLS tests for any new table.

**Step 6. Close out (Part D check).** Skim spec lines 2205–2256 (D.1 to D.6) and confirm nothing you built breaks them. Then append a short entry to `docs/BUILD-PROGRESS.md`: section id, what was built, what was reused, tests passing, open questions, follow-ups. Stop. Do not continue to the next section.

**Always (from CLAUDE.md and the spec, do not skip):**
- The invariants in spec lines 83–105 override everything, including this prompt.
- Values marked PROPOSED go in versioned configuration, never in code. Money is integer kobo. All user-facing strings go through `packages/i18n` (en, pcm). No em dashes in copy. Say "your care team", never "your doctor", "cure", "instant doctor" or "free healthcare".
- Never call a language model in the triage path. Never write AI output to the patient record without a clinician signature.
- Reference platforms are for studying behaviour, functionality and design. Do not copy their code, text, content or visual design; build something similar but original. (CLAUDE.md rule 11 wins over the looser wording in spec line 20.)
- If anything is unclear or conflicts with an invariant, write it in `docs/OPEN-QUESTIONS.md` and stop that piece of work.
- Never commit secrets. Test data is always `is_test`.