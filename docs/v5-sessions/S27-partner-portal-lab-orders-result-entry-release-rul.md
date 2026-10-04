# Session S27: Partner portal: lab orders, result entry, release rules

Milestone / module: **M7**  |  Depends on: **S25, S13**

Paste everything below the line into a fresh Claude Code session.

---

You are working on Tarragon Health. This session is **only** section S27: Partner portal: lab orders, result entry, release rules. Do not start any other section.

**Step 0. Get oriented (keep it small).**
1. Read `CLAUDE.md`.
2. Open `docs/BUILD-PROGRESS.md` (create it if this is S01) and read only the entries for: S25, S13. If a dependency is not marked done, tell me before doing anything.
3. Read these parts of `docs/BUILD-SPEC-v5.md` and nothing else unless you need to follow a cross-reference:

   - Lines 83–105: Invariants INV-01 to INV-16 (always read)
   - Lines 210–217: 4.4 Laboratory
   - Lines 545–551: 9.6 Partner area
   - Lines 630–659: Safety cases 11 to 13
   - Reference platforms to study for this section (spec line 67): Omada Health, Healthily, CareClinic, Function Health, Everlywell, LetsGetChecked, Clafiya, Vezeeta, Neko Health, InsideTracker, Prenuvo, mPharma, Yodawy, JD Health, Doctolib, Practo, Helium Health, Reliance Health, Withings, DarioHealth, Eka Care
   - More reference platforms are named per function in Module 3, rows 3.1 to 3.16 (spec lines 902–917); read only the rows that fall inside this section's scope
   - More reference platforms are named per function in Module 21, rows 21.1 to 21.7 (spec lines 1884–1890); read only the rows that fall inside this section's scope

**Step 1. Reconcile with what already exists.** Search the repository for anything that already implements part of this section (tables, migrations, screens, functions, tests). List it in the design note. Extend and upgrade it; do not rebuild it. If existing behaviour conflicts with an invariant or with Part C, do not change it: record it in `docs/OPEN-QUESTIONS.md`.

**Step 2. Research (short).** Where this section names reference platforms, study how they handle the function (public docs, help centres, published guidance) and write 3 to 6 lines per function in `docs/research/S27.md`, including anything unsafe or unsuitable for Nigeria. Adapt, do not copy.

**Step 3. Task.**
Build lab orders, SYNLAB partner result entry with PDF, patient upload of a result, Tarragon-team upload, and release rules: abnormal held for clinician review (INV-03), sensitive positives never auto-released or explained by audio or AI (INV-04), normal auto-released. Study Module 3 and Module 21 references.

**Step 4. Design note, then build.** Write a one-page design note in `docs/design/S27.md` before code (data model, events, screens, safety rules). Build in small commits with tests alongside.

**Step 5. Prove it.** Safety cases 11, 12, 13 pass. Add RLS tests for any new table.

**Step 6. Close out (Part D check).** Skim spec lines 2205–2256 (D.1 to D.6) and confirm nothing you built breaks them. Then append a short entry to `docs/BUILD-PROGRESS.md`: section id, what was built, what was reused, tests passing, open questions, follow-ups. Stop. Do not continue to the next section.

**Always (from CLAUDE.md and the spec, do not skip):**
- The invariants in spec lines 83–105 override everything, including this prompt.
- Values marked PROPOSED go in versioned configuration, never in code. Money is integer kobo. All user-facing strings go through `packages/i18n` (en, pcm). No em dashes in copy. Say "your care team", never "your doctor", "cure", "instant doctor" or "free healthcare".
- Never call a language model in the triage path. Never write AI output to the patient record without a clinician signature.
- Reference platforms are for studying behaviour, functionality and design. Do not copy their code, text, content or visual design; build something similar but original. (CLAUDE.md rule 11 wins over the looser wording in spec line 20.)
- If anything is unclear or conflicts with an invariant, write it in `docs/OPEN-QUESTIONS.md` and stop that piece of work.
- Never commit secrets. Test data is always `is_test`.