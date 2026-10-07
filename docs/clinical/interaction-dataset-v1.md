# Interaction and duplication dataset v1: sign-off summary

**Status: DRAFT. Not signed. Not approved. Nothing in this file or in the code signs it.** The warning it feeds (`interaction_check_enabled`) is switched OFF and stays off until a human signs.

Prepared 2026-10-07 by the S53 build session (an AI agent, not a clinician or pharmacist). Content hash of the 85 rules below: `fa9f38ecdfbb970937ba3bfaafb365f2a01f324f57bc4b8ce15a9fb65a296ea5`. A different hash means a different dataset and a new sign-off.

## 1. The pop-up text (what the person signing is asked to confirm)

> **What this is.** When a patient adds a medicine in the app, the app checks it against the medicines already on their list. If it finds a known problem, it shows a short note that says the two medicines can affect each other, asks the patient to message their care team, and tells them not to stop a prescribed medicine on their own. It never blocks the patient from adding the medicine, never changes a prescription, and never messages anyone by itself.
>
> **What you are signing.** That the list of medicine groups below, the severity given to each pair, and the four fixed sentences shown to patients are acceptable to show to patients in Nigeria, and that the limits listed in section 5 are acceptable.
>
> **What you are not signing.** This is not a complete interaction database. It checks 85 class pairs and duplicate groups only. A patient who sees no warning has not been told their medicines are safe together, and the app says so on screen.
>
> **Before you sign:** a pharmacist has read section 3 and confirmed the sources in the last column of the table, and the medicine-group matching stems in section 5.

## 2. The four sentences a patient can see (exact text)

- **High (interaction, severe)**: "These two medicines can affect each other in a way your care team should look at. Please message your care team before you take them together. Do not stop a medicine your care team prescribed unless they tell you to."
- **Review (interaction, needs a check)**: "These two medicines can affect each other. It is worth checking with your care team. Keep taking your medicines as prescribed until you hear from them."
- **Note (minor)**: "A small note to share with your care team: these two medicines can have a minor effect on each other."
- **Duplicate (two medicines of one kind)**: "You may already take a medicine of this kind. Two of the same kind can add side effects without adding benefit. Please check with your care team before you take both. Do not stop a prescribed medicine on your own."

Every warning is followed by: "This check looks at the most common problems only. No warning does not mean two medicines are safe together. Your care team or pharmacist can check the full picture."

Each warning also shows a button "Message your care team" (opens the in-app message to the care team) and a button "Add it anyway".

## 3. Interaction rules (pairs of medicine groups)

Severity words used here: **High** (shown with the "high" sentence), **Review**, **Note**. The internal engine calls them contraindicated, caution and info; patients never see those labels.

| # | Group A | Group B | Severity | Headline (clinician wording, not shown to patients) | Source to confirm |
|---|---|---|---|---|---|
| 1 | ACE inhibitor | ARB (angiotensin receptor blocker) | High | Dual blockade of the renin-angiotensin system | ONTARGET trial (N Engl J Med 2008;358:1547-59) showed more kidney injury and high potassium with ACE inhibitor plus ARB; BNF Appendix 1. Reviewer to confirm. |
| 2 | ACE inhibitor | NSAID | Review | Kidney injury risk (NSAID with renin-angiotensin blockade) | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 3 | ACE inhibitor | Potassium-sparing diuretic | Review | Hyperkalaemia risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 4 | ACE inhibitor | Potassium supplement | Review | Hyperkalaemia risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 5 | Allopurinol | Colchicine | Note | Expected combination in gout | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 6 | Amiodarone | Fluoroquinolone antibiotic | Review | Additive QT prolongation | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 7 | Amiodarone | Statin | Review | Muscle toxicity risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 8 | Anticoagulant | Antiplatelet | Review | Combined bleeding risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 9 | Anticoagulant | Azole antifungal | Review | Anticoagulant effect increased | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 10 | Anticoagulant | Fluoroquinolone antibiotic | Review | Anticoagulant effect increased | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 11 | Anticoagulant | Macrolide antibiotic | Review | Anticoagulant effect increased | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 12 | Anticoagulant | Metronidazole / tinidazole | Review | Anticoagulant effect increased | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 13 | Antipsychotic | Fluoroquinolone antibiotic | Review | Additive QT prolongation | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 14 | Antipsychotic | Macrolide antibiotic | Review | Additive QT prolongation | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 15 | ARB (angiotensin receptor blocker) | NSAID | Review | Kidney injury risk (NSAID with renin-angiotensin blockade) | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 16 | ARB (angiotensin receptor blocker) | Potassium-sparing diuretic | Review | Hyperkalaemia risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 17 | ARB (angiotensin receptor blocker) | Potassium supplement | Review | Hyperkalaemia risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 18 | Beta blocker | Calcium channel blocker (rate-limiting) | High | Bradycardia and heart block risk | Verapamil and diltiazem product labelling (caution with beta blockers); BNF Appendix 1. Reviewer to confirm. |
| 19 | Digoxin | Amiodarone | Review | Digoxin toxicity risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 20 | Digoxin | Calcium channel blocker (rate-limiting) | Review | Digoxin toxicity risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 21 | Digoxin | Loop diuretic | Review | Digoxin toxicity via low potassium | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 22 | Fluoroquinolone antibiotic | Artemisinin-based antimalarial | Review | Additive QT prolongation | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 23 | Levothyroxine | Calcium / iron supplement | Review | Reduced levothyroxine absorption | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 24 | Levothyroxine | Proton pump inhibitor | Note | Levothyroxine absorption may fall | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 25 | Lithium | ACE inhibitor | Review | Lithium toxicity risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 26 | Lithium | NSAID | High | Lithium toxicity risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 27 | Lithium | Thiazide diuretic | Review | Lithium toxicity risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 28 | Macrolide antibiotic | Artemisinin-based antimalarial | Review | Additive QT prolongation | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 29 | Macrolide antibiotic | Fluoroquinolone antibiotic | Review | Additive QT prolongation | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 30 | Methotrexate | Co-trimoxazole | High | Methotrexate toxicity risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 31 | Methotrexate | NSAID | High | Methotrexate toxicity risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 32 | NSAID | Anticoagulant | High | Serious bleeding risk | BNF Appendix 1 (NSAIDs with anticoagulants); warfarin and DOAC labelling. Reviewer to confirm. |
| 33 | NSAID | Antiplatelet | Review | Gastrointestinal bleeding risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 34 | NSAID | Loop diuretic | Review | Reduced diuretic effect and kidney injury risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 35 | SSRI antidepressant | Anticoagulant | Review | Bleeding risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 36 | SSRI antidepressant | NSAID | Review | Gastrointestinal bleeding risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 37 | SSRI antidepressant | Tramadol / opioid | Review | Serotonin syndrome and seizure risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 38 | Statin | Azole antifungal | Review | Muscle toxicity risk (statin with azole antifungal) | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 39 | Statin | Fibrate | Review | Muscle toxicity risk (statin with fibrate) | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 40 | Statin | Macrolide antibiotic | High | Muscle toxicity risk (statin with macrolide) | Simvastatin and atorvastatin labelling and MHRA drug safety advice on clarithromycin and erythromycin with statins; BNF Appendix 1. Reviewer to confirm. |
| 41 | Sulfonylurea | Azole antifungal | Review | Hypoglycaemia risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 42 | Sulfonylurea | Co-trimoxazole | Review | Hypoglycaemia risk | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |
| 43 | Sulfonylurea | Fluoroquinolone antibiotic | Review | Glucose instability | Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry. |

## 4. Duplicate-therapy rules (two medicines of the same group)

A duplicate warning appears when two active medicines belong to the same group. For insulin and antiplatelets (two are sometimes deliberate) it appears only when the prescribers differ. For every other group it appears whenever two are present. All use the "duplicate" sentence above.

Groups covered (42): ACE inhibitor, Allopurinol, Aminoglycoside antibiotic, Amiodarone, Anticoagulant, Artemisinin-based antimalarial, Antiplatelet, Antipsychotic, ARB (angiotensin receptor blocker), Azole antifungal, Beta blocker, Calcium / iron supplement, Calcium channel blocker (dihydropyridine), Calcium channel blocker (rate-limiting), Cephalosporin, Colchicine, Co-trimoxazole, Digoxin, DPP-4 inhibitor, Fibrate, Fluoroquinolone antibiotic, Gabapentin / pregabalin, Insulin, Levothyroxine, Lithium, Loop diuretic, Macrolide antibiotic, Metformin, Methotrexate, Nitrofurantoin, Metronidazole / tinidazole, NSAID, Penicillin, Potassium-sparing diuretic, Potassium supplement, Proton pump inhibitor, SGLT2 inhibitor, SSRI antidepressant, Statin, Sulfonylurea, Thiazide diuretic, Tramadol / opioid.

## 5. Known limits and what was NOT covered

1. **Not a complete database.** Only the 43 interaction pairs above and the duplicate groups. Anything else (many antiretrovirals, anticonvulsants, chemotherapy, herbal and traditional medicines, most vaccines, food and alcohol interactions) is not checked. The patient screen says no warning is not a safety statement.
2. **Matching is by name.** A medicine is put in a group by matching its name against generic-name stems (for example names ending -pril or -sartan) and a list of common names. A brand name that is not in the list, a misspelling, or a local name is not recognised, so no warning appears. Review the stems and names in `packages/medicines/src/safety/drug-safety.ts` (`CLASS_PATTERNS`).
3. **No doses.** The check does not look at dose, route, timing or the patient's kidney function, age, pregnancy or allergies. Dose-dependent interactions are not graded.
4. **Severity is coarse.** Three levels. A pair can be dangerous only at some doses or only in some patients; the sentence is therefore always "talk to your care team", never an instruction to stop.
5. **Sources are reference categories, not verified citations.** The "Source to confirm" column names standard reference works (BNF Appendix 1, product labelling) and a few well-known publications. The build session could not open them; none has been checked line by line. The reviewing pharmacist must confirm each entry or correct it, and where Nigerian guidance exists (NAFDAC, the Standard Treatment Guidelines) add it.
6. **English only.** Pidgin and local languages were removed from the product (D-14).
7. **Clinician view is separate.** The clinician medication safety panel uses the same rules with clinician wording and is unchanged by this sign-off.
8. **Duplicate severity label.** Inside the engine most duplicates are graded "contraindicated". Patients never see that word; they see the duplicate sentence.

## 6. What the reviewing pharmacist is asked to check

- [ ] Each pair in section 3 is a recognised interaction and the severity is fair for patients (not alarmist, not falsely calm).
- [ ] Each source cell is correct or replaced; add Nigerian sources where they exist.
- [ ] The medicine-group name lists in `CLASS_PATTERNS` cover the brands and generics commonly dispensed in Nigeria; list any missing names.
- [ ] Duplicate groups: confirm which groups can be deliberately doubled (the list now has insulin and antiplatelets).
- [ ] The four patient sentences and the limits sentence are acceptable.

Reviewer name, PCN registration number, date: ______________________________

## 7. Sign-off, in the order a human runs it

Nothing below has been run. Run as the Chief Medical Officer (steps 1 and 3) and an admin or the CMO (step 2). The database refuses step 1 if the rows no longer hash to the value below, so a changed dataset cannot be signed by accident.

```sql
-- 1. Sign the dataset (Chief Medical Officer only). The note must say who reviewed it.
select public.sign_interaction_dataset(1, 'fa9f38ecdfbb970937ba3bfaafb365f2a01f324f57bc4b8ce15a9fb65a296ea5', 'Reviewed by <pharmacist name, PCN number> on <date>; approved by <CMO name>');

-- 2. Record that the pharmacist's review happened (a human assertion the database cannot see).
select public.attest_go_live_condition('interaction_check_enabled', 'pharmacist_review_recorded', true, '<pharmacist name, PCN number, date>');

-- 3. Switch the guard on (Chief Medical Officer). Switching it off again is always allowed and needs no paperwork.
select public.set_go_live_guard('interaction_check_enabled', true, '<why it is safe to switch on>');
```

To change a rule later: edit `drug-safety.ts`, regenerate the seed file (`WRITE_DATASET=1` with the medicines package tests), add a new dataset version in a migration, and sign that version. Version 1 can never be edited once signed.

Machine-readable copy: `docs/clinical/interaction-dataset-v1.seed.json` (the same rows that are in the database as a draft).
