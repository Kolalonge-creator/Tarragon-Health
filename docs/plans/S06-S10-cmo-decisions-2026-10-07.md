# S06 to S10: decisions recorded 2026-10-07

Source: selections made in chat against `docs/plans/S06-S10-decisions-and-cmo-signoff-pack.md`. That file holds the full proposed text, options and guideline basis for every item; this file records only what was chosen.

**Status of the clinical items (C1 to C8): APPROVED TEXT, NOT SIGNED.** The versioned config rows they belong to do not exist yet (they are created by S07x, S08x and S09x). When each row exists, it is signed through the CMO chat-signing method after the founder approves that specific row. No item below has been signed, and no signing RPC has been run.

Not yet copied into `docs/DECISIONS.md` (this checkout is on the S38 branch, and that file should be edited from a fresh worktree off `origin/main-dev`).

## Founder and DPO decisions (Part A)

| # | Decision | Chosen |
|---|---|---|
| D1 | Encrypt the phone's local database | Yes, in the one native build; key in the device keychain; copy-verify-delete migration |
| D2 | Unsent drafts after forced sign-out | Keep drafts, encrypted and per account; wipe the read mirror only |
| D3 | Remote wipe of a lost phone | One last upload attempt or a 30-day key lease, then wipe; never silent; patient told |
| D4 | Lock-screen pass on shared phones | Off until the patient turns it on |
| D5 | Hosted queue or webhook vendor | Stay in-house; revisit after DPO review |
| D6 | Medicine data for S53 | **Hybrid**: NAFDAC Greenbook catalogue with written terms (fallback: hand-curated top Nigerian brands); interaction rules curated from public-domain openFDA/DailyMed labels and the Nigeria Essential Medicines List 2020, signed by CMO and a pharmacist; checker off until signed; unknown drugs say "not checked". WHO ATC/EML (non-commercial licence) and DrugBank (paid) not used without a licence |
| D7 | Clinician-only white-coat / masked flag | Yes, behind a guard |
| D8 | Test devices | Founder supplies two Android floor phones and one iPhone |
| D9 | Counsel on NDPA 2023 basis for emergency card and access logs | Instruct counsel now, before S09x-c ships |

Actions this creates for the founder: write to NAFDAC for Greenbook terms (D6); supply the phones (D8); instruct counsel (D9).

## Clinical items for the CMO (Part B): approved text

| # | Item | Chosen | Basis (see pack for text) | Config row that will carry it |
|---|---|---|---|---|
| C1 | Home BP check protocol v1 | Approve as written: 7-day target, 3-day / 12-reading minimum, average all readings, "complete" average only at 12+ readings over 3+ days | Nigeria 2023-2028 s3.1.1, s5.4.5, s3.2; ESH 2023 and AHA/ACC 2025 (summaries) | S07x home-check protocol config |
| C2 | Home BP thresholds | Approve as written: 135/85 and above; borderline 130-134 / 80-84; below 130/80 target; clinician sets personal target | Nigeria out-of-office table and target; ESH 2023, ISH 2020 (borderline band from a summary, re-check) | S07x band set (also settles the home-BP default pair left open in OQ-67) |
| C3 | White-coat / masked pattern rule | Approve for all adults with a clinic reading and a complete protocol within 30 days; clinician-only routine task; never patient-facing | Nigeria s6.2, s6.3, s3.2; ESH 2023 | S07x pattern rule, behind a guard |
| C4 | Cuff and measurement guidance | Approve as written, including the battery-cuff advice | Nigeria s3.1, s3.1.1, s6.4; AHA/ACC 2025 | S07x content |
| C5 | Asymptomatic low BP | Amber 24-hour care-team review for systolic below 90 in a patient taking BP medicines | No guideline line exists; clinical judgement | S12 band set |
| C6 | Adherence display and review trigger (OQ-75) | Approve as written: below 80% for 2 consecutive weeks, or 3 consecutive missed doses of a critical medicine | WHO 2003; Nigeria s5.4.5 | `adherence.threshold` / medicine config |
| C7 | PRN limits and interaction wording | Approve as written: clinician-set limits, no defaults, warn never block; three tiers; "not checked"; checker off until a signed dataset exists | Not guideline-grounded; CMO and pharmacist call | S08x PRN config, S53 interaction config |
| C8 | Lock-screen pass fields | Approve as written: initials, blood group, genotype with provenance, "allergies on file", emergency contact phone | Privacy judgement; NDPA 2023 (counsel, D9) | S09x-c pass config |

Caveats carried forward, not resolved by these selections:
- The ESH 2023 and AHA/ACC 2025 points rest on search summaries, not the full texts. Re-check before each row is signed.
- C5 and C7 are not guideline-derived; they are clinical judgements recorded as the CMO's own.
- C8 and the lock-screen pass depend on counsel's view (D9).
- C1 to C4 depend on OQ-67 being written up as a follow-up so the S11/S12 band set and these home bands do not contradict each other.

## Next steps
1. Merge the progress-log correction (branch `docs/progress-log-s07-s09-s10`, not yet pushed).
2. Copy Part A into `docs/DECISIONS.md` from a fresh worktree.
3. Start P0, then S06x, S10x and S09x-a in parallel worktrees; S07x after the OQ-67 follow-up.
4. When each config row exists, show its exact content and ask for approval before signing.
