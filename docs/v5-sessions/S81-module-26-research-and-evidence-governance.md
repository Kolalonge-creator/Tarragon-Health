# Session S81: Module 26: Research and evidence governance

Milestone / module: **Module 26**  |  Depends on: **S40**

Paste everything below the line into a fresh Claude Code session.

---

You are working on Tarragon Health. This session is **only** section S81: Module 26: Research and evidence governance. Do not start any other section.

**Step 0. Get oriented (keep it small).**
1. Read `CLAUDE.md`.
2. Open `docs/BUILD-PROGRESS.md`. If it does not start with 'Stage 1 complete' (written by session S40), STOP and tell me. Otherwise read only the entries for: S40.
3. Read these parts of `docs/BUILD-SPEC-v5.md` and nothing else unless you need to follow a cross-reference:

   - Invariants: lines 83–105
   - Module header (purpose, release, already built): lines 2119–2128
   - **Your functions** 26.1 to 26.4: spec lines 2129–2132
   - Module engineering block (data model, events, functions, screens, safety rules, go-live guard, acceptance tests): lines 2134–2157

**Step 1. Reconcile with what already exists.** Search the repository for anything that already implements part of this section (tables, migrations, screens, functions, tests). List it in the design note. Extend and upgrade it; do not rebuild it. If existing behaviour conflicts with an invariant or with Part C, do not change it: record it in `docs/OPEN-QUESTIONS.md`.

**Step 2. Research the reference platforms.** For each of your functions, study the reference platforms named in its row: their public product pages, help centres, app-store listings, published clinical guidance and regulatory documents. Write 3 to 6 lines per function in `docs/research/S81.md`: what the best products do, what users complain about, what is unsafe or unsuitable for Nigeria (low bandwidth, shared phones, low literacy, Pidgin, cost). For rows marked (Nigeria-specific) or (Tarragon decision) design from the requirement instead. Then decide what a premium Tarragon version should do and why.

**Step 3. Design note.** In `docs/design/S81.md` (one page): data model changes, events, edge functions, screens, safety rules, go-live guard, and how it fits the Stage 1 conventions (RLS on every table, `source` and `recorded_by` on clinical tables, events through the outbox, configuration for every clinical value, go-live guard for every clinical feature).

**Step 4. Build.** The module header says what Stage 1 already built. Audit that against the reference platforms and upgrade gaps; build the remaining functions. Build only your functions plus whatever part of the engineering block they need. This is the final session of the module: also confirm every acceptance test in the module's list is implemented and passing. Write tests alongside the code.

**Step 5. Prove it.** Run the module's acceptance tests that apply to your functions, plus RLS tests for any new table (test each role, and prove a role that must be refused is refused).

**Step 6. Close out (Part D check).** Skim spec lines 2205–2256 (D.1 to D.6) and confirm nothing you built breaks them. Then append a short entry to `docs/BUILD-PROGRESS.md`: section id, what was built, what was reused, tests passing, open questions, follow-ups. Stop. Do not continue to the next section.

**Always (from CLAUDE.md and the spec, do not skip):**
- The invariants in spec lines 83–105 override everything, including this prompt.
- Values marked PROPOSED go in versioned configuration, never in code. Money is integer kobo. All user-facing strings go through `packages/i18n` (en, pcm). No em dashes in copy. Say "your care team", never "your doctor", "cure", "instant doctor" or "free healthcare".
- Never call a language model in the triage path. Never write AI output to the patient record without a clinician signature.
- Reference platforms are for studying behaviour, functionality and design. Do not copy their code, text, content or visual design; build something similar but original. (CLAUDE.md rule 11 wins over the looser wording in spec line 20.)
- If anything is unclear or conflicts with an invariant, write it in `docs/OPEN-QUESTIONS.md` and stop that piece of work.
- Never commit secrets. Test data is always `is_test`.