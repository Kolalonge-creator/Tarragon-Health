# Interaction rule set v2: sign-off summary (ingredient pairs)

**Status: DRAFT. Not signed. Not active. Nothing in this file, the migration or the code signs it.** The go-live guard `medicine_interaction_rules` stays held until the Chief Medical Officer signs version 2 and then opens the guard. Prepared 2026-11-03 by a build session (an AI agent, not a pharmacist or a clinician).

**What this is.** The second layer of the add-a-medicine check. The first layer, the S53 class-pair dataset (`public.interactions`, `interaction_dataset_versions` v1, 85 rules, signed by the CMO on 2026-11-03, hash `fa9f38ec…`, documented in `docs/clinical/interaction-dataset-v1.md`), matches medicines to groups by name stems. This layer, `public.medicine_interaction_rule_sets` (S08y, `docs/design/S08y.md`), matches *named ingredient pairs*. Version 1 of it was born `{"rules": []}` and `public.sign_medicine_interaction_rule_sets` refuses an empty set, which is why the guard was held. Version 2 is the first non-empty draft: the 7 High and 34 Review class pairs of the signed dataset, expanded into specific ingredient pairs using the generics commonly dispensed in Nigeria (the names in `packages/medicines/src/safety/drug-safety.ts` `CLASS_PATTERNS` and `public.medicine_catalogue`). High became severity `contraindicated`, Review became `caution`. Note pairs (5 and 24) were not expanded.

**Every rule has a source the build session actually opened**, in the built-in browser on 2026-11-03: the BNF interactions page of one of the two ingredients (bnf.nice.org.uk/interactions/<drug>/, with the BNF's own severity word quoted: Severe, Moderate, or "unranked" where the BNF lists the pair without a severity marker) or, for fluconazole with a sulfonylurea, the Diflucan SmPC on the electronic Medicines Compendium. **A pair the BNF does not list was left out, not guessed**; section 5 lists every one.

| Fact | Value |
|---|---|
| Rules | 350 (79 `contraindicated`, 271 `caution`, 0 `info`) |
| Class pairs expanded | 40 of the 41 High and Review pairs (pair 43, sulfonylurea with a fluoroquinolone, has no BNF entry and contributes no rule) |
| Migration | `supabase/migrations/20261103030242_interaction_rule_set_v2_unsigned.sql` (inserts version 2 unsigned and inactive; ends in assertions) |
| Machine-readable copy | `docs/clinical/interaction-rule-set-v2.seed.json` (sha256 of the file: `2da113ca58906606fb66338fd15867a619494aa09ad62b99b2439eefc8ad9939`) |
| Content hash in the database | `982efbdb58cd24008ace3156d5796238f70b26edd2ed9c9610213956239aa397` from `select encode(sha256(convert_to(config::text, 'utf8')), 'hex') from public.medicine_interaction_rule_sets where version = 2` (a different value means a different draft) |
| First and last rule codes | `p01_lisinopril_losartan` … `p42_glipizide_co_trimoxazole` (codes are `p<class pair number>_<ingredient a>_<ingredient b>`) |
| Proof | `packages/db/tests/interaction_rule_set_v2_unsigned.sql` (registered in `ci.manifest`) |

## 1. The pop-up text (what the person signing is asked to confirm)

> **What this is.** When a patient adds a medicine in the app, the app already checks it against the medicines on their list using the medicine-group dataset you signed. This adds a second, more exact list: 350 named pairs of ingredients (for example lisinopril with losartan, warfarin with ibuprofen). When the new medicine and one already on the list contain a named pair, the app shows one short note that says your care team has flagged this pair, asks the patient to message their care team, and tells them not to stop a prescribed medicine on their own. It never blocks the patient from adding the medicine, never changes a prescription, and never messages anyone by itself. If both lists fire on the same pair the patient reads one warning, not two.
>
> **What you are signing.** That each of the 350 pairs in section 3, with the severity given to it (High or Review), is acceptable to show to patients in Nigeria; that the three fixed sentences in section 2 are acceptable; and that the limits in section 5 are acceptable, including the pairs deliberately left out because the BNF does not list them.
>
> **What you are not signing.** This is not a complete interaction database. A patient who sees no warning has not been told their medicines are safe together, and the app says so on screen. The sources are the BNF's interaction entries and one SmPC as read on 2026-11-03 by a build session; no pharmacist has yet read them line by line.
>
> **Before you sign:** read section 3, spot-check the sources (each cell is a link to the exact page), and read section 5.

## 2. The three sentences a patient can see (exact text, `packages/i18n/src/en.ts`)

- **High (`contraindicated`, key `medicines.rules.advice.high`)**: "Your care team has flagged this pair of ingredients for a closer look. Please message your care team before you take them together. Do not stop a medicine your care team prescribed unless they tell you to."
- **Review (`caution`, key `medicines.rules.advice.review`)**: "Your care team has flagged this pair of ingredients to check. It is worth asking them. Keep taking your medicines as prescribed until you hear from them."
- **Note (`info`, key `medicines.rules.advice.note`)**: "A small note to share with your care team about this pair of ingredients." (No rule in version 2 uses this level.)

Every warning is followed by the limits sentence: "This check looks at the most common problems only. No warning does not mean two medicines are safe together. Your care team or pharmacist can check the full picture." Each warning shows the buttons "Message your care team" and "Add it anyway".

## 3. The full rule table

Severity of the whole class pair is given in the heading (High = `contraindicated`, Review = `caution`). "BNF word" is the severity marker on the BNF page as read: Severe, Moderate, "unranked" (listed with no marker), or SmPC for the one product-label source. Ingredient names are in the normalised form the matcher uses (lower case, hyphens become spaces, so co-trimoxazole is "co trimoxazole").

#### Class pair 1: ACE inhibitor + ARB (High; 25 rules)

Dual blockade of the renin-angiotensin system.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p01_lisinopril_losartan` | lisinopril | losartan | Severe | BNF interactions, lisinopril page, entry "losartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p01_lisinopril_valsartan` | lisinopril | valsartan | Severe | BNF interactions, lisinopril page, entry "valsartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p01_lisinopril_telmisartan` | lisinopril | telmisartan | Severe | BNF interactions, lisinopril page, entry "telmisartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p01_lisinopril_irbesartan` | lisinopril | irbesartan | Severe | BNF interactions, lisinopril page, entry "irbesartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p01_lisinopril_candesartan` | lisinopril | candesartan | Severe | BNF interactions, lisinopril page, entry "candesartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p01_ramipril_losartan` | ramipril | losartan | Severe | BNF interactions, ramipril page, entry "losartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p01_ramipril_valsartan` | ramipril | valsartan | Severe | BNF interactions, ramipril page, entry "valsartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p01_ramipril_telmisartan` | ramipril | telmisartan | Severe | BNF interactions, ramipril page, entry "telmisartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p01_ramipril_irbesartan` | ramipril | irbesartan | Severe | BNF interactions, ramipril page, entry "irbesartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p01_ramipril_candesartan` | ramipril | candesartan | Severe | BNF interactions, ramipril page, entry "candesartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p01_enalapril_losartan` | enalapril | losartan | Severe | BNF interactions, enalapril page, entry "losartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p01_enalapril_valsartan` | enalapril | valsartan | Severe | BNF interactions, enalapril page, entry "valsartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p01_enalapril_telmisartan` | enalapril | telmisartan | Severe | BNF interactions, enalapril page, entry "telmisartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p01_enalapril_irbesartan` | enalapril | irbesartan | Severe | BNF interactions, enalapril page, entry "irbesartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p01_enalapril_candesartan` | enalapril | candesartan | Severe | BNF interactions, enalapril page, entry "candesartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p01_perindopril_losartan` | perindopril | losartan | Severe | BNF interactions, perindopril page, entry "losartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p01_perindopril_valsartan` | perindopril | valsartan | Severe | BNF interactions, perindopril page, entry "valsartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p01_perindopril_telmisartan` | perindopril | telmisartan | Severe | BNF interactions, perindopril page, entry "telmisartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p01_perindopril_irbesartan` | perindopril | irbesartan | Severe | BNF interactions, perindopril page, entry "irbesartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p01_perindopril_candesartan` | perindopril | candesartan | Severe | BNF interactions, perindopril page, entry "candesartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p01_captopril_losartan` | captopril | losartan | Severe | BNF interactions, captopril page, entry "losartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |
| `p01_captopril_valsartan` | captopril | valsartan | Severe | BNF interactions, captopril page, entry "valsartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |
| `p01_captopril_telmisartan` | captopril | telmisartan | Severe | BNF interactions, captopril page, entry "telmisartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |
| `p01_captopril_irbesartan` | captopril | irbesartan | Severe | BNF interactions, captopril page, entry "irbesartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |
| `p01_captopril_candesartan` | captopril | candesartan | Severe | BNF interactions, captopril page, entry "candesartan" (Severe: increases the risk of renal impairment; manufacturer advises avoid or monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |

#### Class pair 18: Beta blocker + rate-limiting calcium channel blocker (High; 12 rules)

Bradycardia and heart block risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p18_atenolol_diltiazem` | atenolol | diltiazem | Severe | BNF interactions, atenolol page, entry "diltiazem" (Severe: cardiodepression; also bradycardia and hypotension), read 2026-11-03: https://bnf.nice.org.uk/interactions/atenolol/ |
| `p18_atenolol_verapamil` | atenolol | verapamil | Severe | BNF interactions, atenolol page, entry "verapamil" (Severe: cardiovascular adverse effects; also bradycardia and hypotension), read 2026-11-03: https://bnf.nice.org.uk/interactions/atenolol/ |
| `p18_bisoprolol_diltiazem` | bisoprolol | diltiazem | Severe | BNF interactions, bisoprolol page, entry "diltiazem" (Severe: cardiodepression; also bradycardia and hypotension), read 2026-11-03: https://bnf.nice.org.uk/interactions/bisoprolol/ |
| `p18_bisoprolol_verapamil` | bisoprolol | verapamil | Severe | BNF interactions, bisoprolol page, entry "verapamil" (Severe: cardiovascular adverse effects; also bradycardia and hypotension), read 2026-11-03: https://bnf.nice.org.uk/interactions/bisoprolol/ |
| `p18_metoprolol_diltiazem` | metoprolol | diltiazem | Severe | BNF interactions, metoprolol page, entry "diltiazem" (Severe: cardiodepression; also bradycardia and hypotension), read 2026-11-03: https://bnf.nice.org.uk/interactions/metoprolol/ |
| `p18_metoprolol_verapamil` | metoprolol | verapamil | Severe | BNF interactions, metoprolol page, entry "verapamil" (Severe: cardiovascular adverse effects; also bradycardia and hypotension), read 2026-11-03: https://bnf.nice.org.uk/interactions/metoprolol/ |
| `p18_propranolol_diltiazem` | propranolol | diltiazem | Severe | BNF interactions, propranolol page, entry "diltiazem" (Severe: cardiodepression; also bradycardia and hypotension), read 2026-11-03: https://bnf.nice.org.uk/interactions/propranolol/ |
| `p18_propranolol_verapamil` | propranolol | verapamil | Severe | BNF interactions, propranolol page, entry "verapamil" (Severe: cardiovascular adverse effects; also bradycardia and hypotension), read 2026-11-03: https://bnf.nice.org.uk/interactions/propranolol/ |
| `p18_carvedilol_diltiazem` | carvedilol | diltiazem | Severe | BNF interactions, carvedilol page, entry "diltiazem" (Severe: cardiodepression; also bradycardia and hypotension), read 2026-11-03: https://bnf.nice.org.uk/interactions/carvedilol/ |
| `p18_carvedilol_verapamil` | carvedilol | verapamil | Severe | BNF interactions, carvedilol page, entry "verapamil" (Severe: cardiovascular adverse effects; also bradycardia and hypotension), read 2026-11-03: https://bnf.nice.org.uk/interactions/carvedilol/ |
| `p18_nebivolol_diltiazem` | nebivolol | diltiazem | Severe | BNF interactions, nebivolol page, entry "diltiazem" (Severe: cardiodepression; also bradycardia and hypotension), read 2026-11-03: https://bnf.nice.org.uk/interactions/nebivolol/ |
| `p18_nebivolol_verapamil` | nebivolol | verapamil | Severe | BNF interactions, nebivolol page, entry "verapamil" (Severe: cardiovascular adverse effects; also bradycardia and hypotension), read 2026-11-03: https://bnf.nice.org.uk/interactions/nebivolol/ |

#### Class pair 26: Lithium + NSAID (High; 5 rules)

Lithium toxicity risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p26_lithium_ibuprofen` | lithium | ibuprofen | Severe | BNF interactions, lithium page, entry "ibuprofen" (Severe: increases the concentration of lithium; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/lithium/ |
| `p26_lithium_diclofenac` | lithium | diclofenac | Severe | BNF interactions, lithium page, entry "diclofenac" (Severe: increases the concentration of lithium; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/lithium/ |
| `p26_lithium_naproxen` | lithium | naproxen | Severe | BNF interactions, lithium page, entry "naproxen" (Severe: increases the concentration of lithium; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/lithium/ |
| `p26_lithium_meloxicam` | lithium | meloxicam | Severe | BNF interactions, lithium page, entry "meloxicam" (Severe: increases the concentration of lithium; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/lithium/ |
| `p26_lithium_piroxicam` | lithium | piroxicam | Severe | BNF interactions, lithium page, entry "piroxicam" (Severe: increases the concentration of lithium; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/lithium/ |

#### Class pair 30: Methotrexate + co-trimoxazole (High; 3 rules)

Methotrexate toxicity risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p30_methotrexate_trimethoprim` | methotrexate | trimethoprim | Severe | BNF interactions, methotrexate page, entry "trimethoprim" (Severe: haematological side-effects, sometimes fatal), read 2026-11-03: https://bnf.nice.org.uk/interactions/methotrexate/ |
| `p30_methotrexate_sulfamethoxazole` | methotrexate | sulfamethoxazole | Severe | BNF interactions, sulfamethoxazole page, entry "methotrexate" (Severe: increases the exposure to methotrexate), read 2026-11-03: https://bnf.nice.org.uk/interactions/sulfamethoxazole/ |
| `p30_methotrexate_co_trimoxazole` | methotrexate | co trimoxazole | Severe | BNF interactions, trimethoprim page, entry "methotrexate" (Severe: co-trimoxazole is trimethoprim with sulfamethoxazole; haematological side-effects, sometimes fatal), read 2026-11-03: https://bnf.nice.org.uk/interactions/trimethoprim/ |

#### Class pair 31: Methotrexate + NSAID (High; 5 rules)

Methotrexate toxicity risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p31_methotrexate_ibuprofen` | methotrexate | ibuprofen | Severe | BNF interactions, methotrexate page, entry "ibuprofen" (Severe: increases the risk of methotrexate toxicity, particularly high-dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/methotrexate/ |
| `p31_methotrexate_diclofenac` | methotrexate | diclofenac | Severe | BNF interactions, methotrexate page, entry "diclofenac" (Severe: increases the risk of methotrexate toxicity, particularly high-dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/methotrexate/ |
| `p31_methotrexate_naproxen` | methotrexate | naproxen | Severe | BNF interactions, methotrexate page, entry "naproxen" (Severe: increases the risk of methotrexate toxicity, particularly high-dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/methotrexate/ |
| `p31_methotrexate_meloxicam` | methotrexate | meloxicam | Severe | BNF interactions, methotrexate page, entry "meloxicam" (Severe: increases the risk of methotrexate toxicity, particularly high-dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/methotrexate/ |
| `p31_methotrexate_piroxicam` | methotrexate | piroxicam | Severe | BNF interactions, methotrexate page, entry "piroxicam" (Severe: increases the risk of methotrexate toxicity, particularly high-dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/methotrexate/ |

#### Class pair 32: NSAID + anticoagulant (High; 25 rules)

Serious bleeding risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p32_ibuprofen_warfarin` | ibuprofen | warfarin | Severe | BNF interactions, warfarin page, entry "ibuprofen" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p32_ibuprofen_rivaroxaban` | ibuprofen | rivaroxaban | Severe | BNF interactions, rivaroxaban page, entry "ibuprofen" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p32_ibuprofen_apixaban` | ibuprofen | apixaban | Severe | BNF interactions, apixaban page, entry "ibuprofen" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p32_ibuprofen_dabigatran` | ibuprofen | dabigatran | Severe | BNF interactions, dabigatran page, entry "ibuprofen" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p32_ibuprofen_enoxaparin` | ibuprofen | enoxaparin | Severe | BNF interactions, enoxaparin page, entry "ibuprofen" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/enoxaparin/ |
| `p32_diclofenac_warfarin` | diclofenac | warfarin | Severe | BNF interactions, warfarin page, entry "diclofenac" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p32_diclofenac_rivaroxaban` | diclofenac | rivaroxaban | Severe | BNF interactions, rivaroxaban page, entry "diclofenac" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p32_diclofenac_apixaban` | diclofenac | apixaban | Severe | BNF interactions, apixaban page, entry "diclofenac" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p32_diclofenac_dabigatran` | diclofenac | dabigatran | Severe | BNF interactions, dabigatran page, entry "diclofenac" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p32_diclofenac_enoxaparin` | diclofenac | enoxaparin | Severe | BNF interactions, enoxaparin page, entry "diclofenac" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/enoxaparin/ |
| `p32_naproxen_warfarin` | naproxen | warfarin | Severe | BNF interactions, warfarin page, entry "naproxen" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p32_naproxen_rivaroxaban` | naproxen | rivaroxaban | Severe | BNF interactions, rivaroxaban page, entry "naproxen" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p32_naproxen_apixaban` | naproxen | apixaban | Severe | BNF interactions, apixaban page, entry "naproxen" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p32_naproxen_dabigatran` | naproxen | dabigatran | Severe | BNF interactions, dabigatran page, entry "naproxen" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p32_naproxen_enoxaparin` | naproxen | enoxaparin | Severe | BNF interactions, enoxaparin page, entry "naproxen" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/enoxaparin/ |
| `p32_meloxicam_warfarin` | meloxicam | warfarin | Severe | BNF interactions, warfarin page, entry "meloxicam" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p32_meloxicam_rivaroxaban` | meloxicam | rivaroxaban | Severe | BNF interactions, rivaroxaban page, entry "meloxicam" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p32_meloxicam_apixaban` | meloxicam | apixaban | Severe | BNF interactions, apixaban page, entry "meloxicam" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p32_meloxicam_dabigatran` | meloxicam | dabigatran | Severe | BNF interactions, dabigatran page, entry "meloxicam" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p32_meloxicam_enoxaparin` | meloxicam | enoxaparin | Severe | BNF interactions, enoxaparin page, entry "meloxicam" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/enoxaparin/ |
| `p32_piroxicam_warfarin` | piroxicam | warfarin | Severe | BNF interactions, warfarin page, entry "piroxicam" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p32_piroxicam_rivaroxaban` | piroxicam | rivaroxaban | Severe | BNF interactions, rivaroxaban page, entry "piroxicam" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p32_piroxicam_apixaban` | piroxicam | apixaban | Severe | BNF interactions, apixaban page, entry "piroxicam" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p32_piroxicam_dabigatran` | piroxicam | dabigatran | Severe | BNF interactions, dabigatran page, entry "piroxicam" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p32_piroxicam_enoxaparin` | piroxicam | enoxaparin | Severe | BNF interactions, enoxaparin page, entry "piroxicam" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/enoxaparin/ |

#### Class pair 40: Statin + macrolide (High; 4 rules)

Muscle toxicity risk (statin with macrolide).

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p40_simvastatin_clarithromycin` | simvastatin | clarithromycin | Severe | BNF interactions, simvastatin page, entry "clarithromycin" (Severe: increases the exposure to simvastatin; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/simvastatin/ |
| `p40_simvastatin_erythromycin` | simvastatin | erythromycin | Severe | BNF interactions, simvastatin page, entry "erythromycin" (Severe: markedly increases the exposure to simvastatin; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/simvastatin/ |
| `p40_atorvastatin_clarithromycin` | atorvastatin | clarithromycin | Severe | BNF interactions, atorvastatin page, entry "clarithromycin" (Severe: increases the exposure to atorvastatin; manufacturer advises avoid or adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/atorvastatin/ |
| `p40_atorvastatin_erythromycin` | atorvastatin | erythromycin | Severe | BNF interactions, atorvastatin page, entry "erythromycin" (Severe: increases the exposure to atorvastatin; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/atorvastatin/ |

#### Class pair 2: ACE inhibitor + NSAID (Review; 25 rules)

Kidney injury risk (NSAID with renin-angiotensin blockade).

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p02_lisinopril_ibuprofen` | lisinopril | ibuprofen | unranked | BNF interactions, lisinopril page, entry "ibuprofen" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p02_lisinopril_diclofenac` | lisinopril | diclofenac | unranked | BNF interactions, lisinopril page, entry "diclofenac" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p02_lisinopril_naproxen` | lisinopril | naproxen | unranked | BNF interactions, lisinopril page, entry "naproxen" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p02_lisinopril_meloxicam` | lisinopril | meloxicam | unranked | BNF interactions, lisinopril page, entry "meloxicam" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p02_lisinopril_piroxicam` | lisinopril | piroxicam | unranked | BNF interactions, lisinopril page, entry "piroxicam" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p02_ramipril_ibuprofen` | ramipril | ibuprofen | unranked | BNF interactions, ramipril page, entry "ibuprofen" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p02_ramipril_diclofenac` | ramipril | diclofenac | unranked | BNF interactions, ramipril page, entry "diclofenac" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p02_ramipril_naproxen` | ramipril | naproxen | unranked | BNF interactions, ramipril page, entry "naproxen" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p02_ramipril_meloxicam` | ramipril | meloxicam | unranked | BNF interactions, ramipril page, entry "meloxicam" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p02_ramipril_piroxicam` | ramipril | piroxicam | unranked | BNF interactions, ramipril page, entry "piroxicam" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p02_enalapril_ibuprofen` | enalapril | ibuprofen | unranked | BNF interactions, enalapril page, entry "ibuprofen" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p02_enalapril_diclofenac` | enalapril | diclofenac | unranked | BNF interactions, enalapril page, entry "diclofenac" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p02_enalapril_naproxen` | enalapril | naproxen | unranked | BNF interactions, enalapril page, entry "naproxen" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p02_enalapril_meloxicam` | enalapril | meloxicam | unranked | BNF interactions, enalapril page, entry "meloxicam" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p02_enalapril_piroxicam` | enalapril | piroxicam | unranked | BNF interactions, enalapril page, entry "piroxicam" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p02_perindopril_ibuprofen` | perindopril | ibuprofen | unranked | BNF interactions, perindopril page, entry "ibuprofen" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p02_perindopril_diclofenac` | perindopril | diclofenac | unranked | BNF interactions, perindopril page, entry "diclofenac" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p02_perindopril_naproxen` | perindopril | naproxen | unranked | BNF interactions, perindopril page, entry "naproxen" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p02_perindopril_meloxicam` | perindopril | meloxicam | unranked | BNF interactions, perindopril page, entry "meloxicam" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p02_perindopril_piroxicam` | perindopril | piroxicam | unranked | BNF interactions, perindopril page, entry "piroxicam" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p02_captopril_ibuprofen` | captopril | ibuprofen | unranked | BNF interactions, captopril page, entry "ibuprofen" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |
| `p02_captopril_diclofenac` | captopril | diclofenac | unranked | BNF interactions, captopril page, entry "diclofenac" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |
| `p02_captopril_naproxen` | captopril | naproxen | unranked | BNF interactions, captopril page, entry "naproxen" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |
| `p02_captopril_meloxicam` | captopril | meloxicam | unranked | BNF interactions, captopril page, entry "meloxicam" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |
| `p02_captopril_piroxicam` | captopril | piroxicam | unranked | BNF interactions, captopril page, entry "piroxicam" (unranked: both increase the risk of nephrotoxicity and of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |

#### Class pair 3: ACE inhibitor + potassium-sparing diuretic (Review; 15 rules)

Hyperkalaemia risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p03_lisinopril_spironolactone` | lisinopril | spironolactone | unranked | BNF interactions, lisinopril page, entry "spironolactone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p03_lisinopril_eplerenone` | lisinopril | eplerenone | unranked | BNF interactions, lisinopril page, entry "eplerenone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p03_lisinopril_amiloride` | lisinopril | amiloride | unranked | BNF interactions, lisinopril page, entry "amiloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p03_ramipril_spironolactone` | ramipril | spironolactone | unranked | BNF interactions, ramipril page, entry "spironolactone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p03_ramipril_eplerenone` | ramipril | eplerenone | unranked | BNF interactions, ramipril page, entry "eplerenone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p03_ramipril_amiloride` | ramipril | amiloride | unranked | BNF interactions, ramipril page, entry "amiloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p03_enalapril_spironolactone` | enalapril | spironolactone | unranked | BNF interactions, enalapril page, entry "spironolactone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p03_enalapril_eplerenone` | enalapril | eplerenone | unranked | BNF interactions, enalapril page, entry "eplerenone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p03_enalapril_amiloride` | enalapril | amiloride | unranked | BNF interactions, enalapril page, entry "amiloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p03_perindopril_spironolactone` | perindopril | spironolactone | unranked | BNF interactions, perindopril page, entry "spironolactone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p03_perindopril_eplerenone` | perindopril | eplerenone | unranked | BNF interactions, perindopril page, entry "eplerenone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p03_perindopril_amiloride` | perindopril | amiloride | unranked | BNF interactions, perindopril page, entry "amiloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p03_captopril_spironolactone` | captopril | spironolactone | unranked | BNF interactions, captopril page, entry "spironolactone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |
| `p03_captopril_eplerenone` | captopril | eplerenone | unranked | BNF interactions, captopril page, entry "eplerenone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |
| `p03_captopril_amiloride` | captopril | amiloride | unranked | BNF interactions, captopril page, entry "amiloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |

#### Class pair 4: ACE inhibitor + potassium supplement (Review; 5 rules)

Hyperkalaemia risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p04_lisinopril_potassium_chloride` | lisinopril | potassium chloride | unranked | BNF interactions, lisinopril page, entry "potassium chloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p04_ramipril_potassium_chloride` | ramipril | potassium chloride | unranked | BNF interactions, ramipril page, entry "potassium chloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p04_enalapril_potassium_chloride` | enalapril | potassium chloride | unranked | BNF interactions, enalapril page, entry "potassium chloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p04_perindopril_potassium_chloride` | perindopril | potassium chloride | unranked | BNF interactions, perindopril page, entry "potassium chloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p04_captopril_potassium_chloride` | captopril | potassium chloride | unranked | BNF interactions, captopril page, entry "potassium chloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |

#### Class pair 6: Amiodarone + fluoroquinolone (Review; 1 rule)

Additive QT prolongation.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p06_amiodarone_moxifloxacin` | amiodarone | moxifloxacin | Severe | BNF interactions, amiodarone page, entry "moxifloxacin" (Severe: both prolong the QT interval), read 2026-11-03: https://bnf.nice.org.uk/interactions/amiodarone/ |

#### Class pair 7: Amiodarone + statin (Review; 2 rules)

Muscle toxicity risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p07_amiodarone_simvastatin` | amiodarone | simvastatin | Severe | BNF interactions, simvastatin page, entry "amiodarone" (Severe: increases the exposure to simvastatin; adjust simvastatin dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/simvastatin/ |
| `p07_amiodarone_atorvastatin` | amiodarone | atorvastatin | Moderate | BNF interactions, atorvastatin page, entry "amiodarone" (Moderate: predicted to increase the exposure to atorvastatin; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/atorvastatin/ |

#### Class pair 8: Anticoagulant + antiplatelet (Review; 10 rules)

Combined bleeding risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p08_warfarin_aspirin` | warfarin | aspirin | Severe | BNF interactions, warfarin page, entry "aspirin" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p08_warfarin_clopidogrel` | warfarin | clopidogrel | Severe | BNF interactions, warfarin page, entry "clopidogrel" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p08_rivaroxaban_aspirin` | rivaroxaban | aspirin | Severe | BNF interactions, rivaroxaban page, entry "aspirin" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p08_rivaroxaban_clopidogrel` | rivaroxaban | clopidogrel | Severe | BNF interactions, rivaroxaban page, entry "clopidogrel" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p08_apixaban_aspirin` | apixaban | aspirin | Severe | BNF interactions, apixaban page, entry "aspirin" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p08_apixaban_clopidogrel` | apixaban | clopidogrel | Severe | BNF interactions, apixaban page, entry "clopidogrel" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p08_dabigatran_aspirin` | dabigatran | aspirin | Severe | BNF interactions, dabigatran page, entry "aspirin" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p08_dabigatran_clopidogrel` | dabigatran | clopidogrel | Severe | BNF interactions, dabigatran page, entry "clopidogrel" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p08_enoxaparin_aspirin` | enoxaparin | aspirin | Severe | BNF interactions, enoxaparin page, entry "aspirin" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/enoxaparin/ |
| `p08_enoxaparin_clopidogrel` | enoxaparin | clopidogrel | Severe | BNF interactions, enoxaparin page, entry "clopidogrel" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/enoxaparin/ |

#### Class pair 9: Anticoagulant + azole antifungal (Review; 13 rules)

Anticoagulant effect increased.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p09_warfarin_fluconazole` | warfarin | fluconazole | Severe | BNF interactions, warfarin page, entry "fluconazole" (Severe: increases the anticoagulant effect; monitor INR and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p09_warfarin_itraconazole` | warfarin | itraconazole | Severe | BNF interactions, warfarin page, entry "itraconazole" (Severe: potentially increases the anticoagulant effect), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p09_warfarin_ketoconazole` | warfarin | ketoconazole | Severe | BNF interactions, warfarin page, entry "ketoconazole" (Severe: potentially increases the anticoagulant effect; monitor INR), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p09_warfarin_voriconazole` | warfarin | voriconazole | Moderate | BNF interactions, warfarin page, entry "voriconazole" (Moderate: increases the anticoagulant effect; monitor INR and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p09_rivaroxaban_itraconazole` | rivaroxaban | itraconazole | Severe | BNF interactions, rivaroxaban page, entry "itraconazole" (Severe: increases the exposure to rivaroxaban; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p09_rivaroxaban_ketoconazole` | rivaroxaban | ketoconazole | Severe | BNF interactions, rivaroxaban page, entry "ketoconazole" (Severe: increases the exposure to rivaroxaban; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p09_rivaroxaban_voriconazole` | rivaroxaban | voriconazole | Severe | BNF interactions, rivaroxaban page, entry "voriconazole" (Severe: increases the exposure to rivaroxaban; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p09_apixaban_itraconazole` | apixaban | itraconazole | Severe | BNF interactions, apixaban page, entry "itraconazole" (Severe: increases the exposure to apixaban; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p09_apixaban_ketoconazole` | apixaban | ketoconazole | Severe | BNF interactions, apixaban page, entry "ketoconazole" (Severe: increases the exposure to apixaban; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p09_apixaban_voriconazole` | apixaban | voriconazole | Severe | BNF interactions, apixaban page, entry "voriconazole" (Severe: increases the exposure to apixaban; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p09_dabigatran_itraconazole` | dabigatran | itraconazole | Severe | BNF interactions, dabigatran page, entry "itraconazole" (Severe: predicted to increase the exposure to dabigatran; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p09_dabigatran_ketoconazole` | dabigatran | ketoconazole | Severe | BNF interactions, dabigatran page, entry "ketoconazole" (Severe: predicted to increase the exposure to dabigatran; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p09_dabigatran_fluconazole` | dabigatran | fluconazole | Severe | BNF interactions, dabigatran page, entry "fluconazole" (Severe: predicted to increase the exposure to dabigatran), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |

#### Class pair 10: Anticoagulant + fluoroquinolone (Review; 4 rules)

Anticoagulant effect increased.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p10_warfarin_ciprofloxacin` | warfarin | ciprofloxacin | Severe | BNF interactions, warfarin page, entry "ciprofloxacin" (Severe: increases the anticoagulant effect of warfarin; monitor INR), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p10_warfarin_levofloxacin` | warfarin | levofloxacin | Severe | BNF interactions, warfarin page, entry "levofloxacin" (Severe: increases the anticoagulant effect of warfarin; monitor INR), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p10_warfarin_moxifloxacin` | warfarin | moxifloxacin | Severe | BNF interactions, warfarin page, entry "moxifloxacin" (Severe: increases the anticoagulant effect of warfarin; monitor INR), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p10_warfarin_ofloxacin` | warfarin | ofloxacin | Severe | BNF interactions, warfarin page, entry "ofloxacin" (Severe: increases the anticoagulant effect of warfarin; monitor INR), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |

#### Class pair 11: Anticoagulant + macrolide (Review; 12 rules)

Anticoagulant effect increased.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p11_warfarin_clarithromycin` | warfarin | clarithromycin | Severe | BNF interactions, warfarin page, entry "clarithromycin" (Severe: increases the anticoagulant effect; monitor INR and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p11_warfarin_erythromycin` | warfarin | erythromycin | Severe | BNF interactions, warfarin page, entry "erythromycin" (Severe: increases the anticoagulant effect; monitor INR and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p11_warfarin_azithromycin` | warfarin | azithromycin | Severe | BNF interactions, warfarin page, entry "azithromycin" (Severe: might increase the risk of bleeding events), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p11_rivaroxaban_clarithromycin` | rivaroxaban | clarithromycin | Moderate | BNF interactions, rivaroxaban page, entry "clarithromycin" (Moderate: increases the exposure to rivaroxaban; caution in renal impairment), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p11_rivaroxaban_erythromycin` | rivaroxaban | erythromycin | Moderate | BNF interactions, rivaroxaban page, entry "erythromycin" (Moderate: increases the exposure to rivaroxaban; caution in renal impairment), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p11_rivaroxaban_azithromycin` | rivaroxaban | azithromycin | Moderate | BNF interactions, rivaroxaban page, entry "azithromycin" (Moderate: increases the exposure to rivaroxaban; caution in renal impairment), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p11_apixaban_clarithromycin` | apixaban | clarithromycin | Moderate | BNF interactions, apixaban page, entry "clarithromycin" (Moderate: increases the exposure to apixaban), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p11_apixaban_erythromycin` | apixaban | erythromycin | Moderate | BNF interactions, apixaban page, entry "erythromycin" (Moderate: increases the exposure to apixaban), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p11_apixaban_azithromycin` | apixaban | azithromycin | Moderate | BNF interactions, apixaban page, entry "azithromycin" (Moderate: increases the exposure to apixaban), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p11_dabigatran_clarithromycin` | dabigatran | clarithromycin | Moderate | BNF interactions, dabigatran page, entry "clarithromycin" (Moderate: increases the exposure to dabigatran; monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p11_dabigatran_erythromycin` | dabigatran | erythromycin | Severe | BNF interactions, dabigatran page, entry "erythromycin" (Severe: predicted to increase the exposure to dabigatran), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p11_dabigatran_azithromycin` | dabigatran | azithromycin | Severe | BNF interactions, dabigatran page, entry "azithromycin" (Severe: predicted to increase the exposure to dabigatran), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |

#### Class pair 12: Anticoagulant + metronidazole / tinidazole (Review; 1 rule)

Anticoagulant effect increased.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p12_warfarin_metronidazole` | warfarin | metronidazole | Severe | BNF interactions, warfarin page, entry "metronidazole" (Severe: increases the anticoagulant effect; monitor INR and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |

#### Class pair 13: Antipsychotic + fluoroquinolone (Review; 4 rules)

Additive QT prolongation.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p13_haloperidol_moxifloxacin` | haloperidol | moxifloxacin | Severe | BNF interactions, haloperidol page, entry "moxifloxacin" (Severe: both prolong the QT interval), read 2026-11-03: https://bnf.nice.org.uk/interactions/haloperidol/ |
| `p13_chlorpromazine_moxifloxacin` | chlorpromazine | moxifloxacin | Severe | BNF interactions, chlorpromazine page, entry "moxifloxacin" (Severe: both prolong the QT interval), read 2026-11-03: https://bnf.nice.org.uk/interactions/chlorpromazine/ |
| `p13_olanzapine_ciprofloxacin` | olanzapine | ciprofloxacin | Moderate | BNF interactions, olanzapine page, entry "ciprofloxacin" (Moderate: predicted to increase the exposure to olanzapine), read 2026-11-03: https://bnf.nice.org.uk/interactions/olanzapine/ |
| `p13_chlorpromazine_ciprofloxacin` | chlorpromazine | ciprofloxacin | Moderate | BNF interactions, chlorpromazine page, entry "ciprofloxacin" (Moderate: predicted to increase the exposure to chlorpromazine), read 2026-11-03: https://bnf.nice.org.uk/interactions/chlorpromazine/ |

#### Class pair 14: Antipsychotic + macrolide (Review; 5 rules)

Additive QT prolongation.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p14_haloperidol_erythromycin` | haloperidol | erythromycin | Severe | BNF interactions, haloperidol page, entry "erythromycin" (Severe: both prolong the QT interval), read 2026-11-03: https://bnf.nice.org.uk/interactions/haloperidol/ |
| `p14_chlorpromazine_erythromycin` | chlorpromazine | erythromycin | Severe | BNF interactions, chlorpromazine page, entry "erythromycin" (Severe: both prolong the QT interval), read 2026-11-03: https://bnf.nice.org.uk/interactions/chlorpromazine/ |
| `p14_quetiapine_clarithromycin` | quetiapine | clarithromycin | Severe | BNF interactions, quetiapine page, entry "clarithromycin" (Severe: predicted to increase the exposure to quetiapine; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/quetiapine/ |
| `p14_quetiapine_erythromycin` | quetiapine | erythromycin | Moderate | BNF interactions, quetiapine page, entry "erythromycin" (Moderate: predicted to increase the exposure to quetiapine; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/quetiapine/ |
| `p14_risperidone_clarithromycin` | risperidone | clarithromycin | Moderate | BNF interactions, risperidone page, entry "clarithromycin" (Moderate: predicted to increase the exposure to risperidone), read 2026-11-03: https://bnf.nice.org.uk/interactions/risperidone/ |

#### Class pair 15: ARB + NSAID (Review; 25 rules)

Kidney injury risk (NSAID with renin-angiotensin blockade).

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p15_losartan_ibuprofen` | losartan | ibuprofen | unranked | BNF interactions, losartan page, entry "ibuprofen" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/losartan/ |
| `p15_losartan_diclofenac` | losartan | diclofenac | unranked | BNF interactions, losartan page, entry "diclofenac" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/losartan/ |
| `p15_losartan_naproxen` | losartan | naproxen | unranked | BNF interactions, losartan page, entry "naproxen" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/losartan/ |
| `p15_losartan_meloxicam` | losartan | meloxicam | unranked | BNF interactions, losartan page, entry "meloxicam" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/losartan/ |
| `p15_losartan_piroxicam` | losartan | piroxicam | unranked | BNF interactions, losartan page, entry "piroxicam" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/losartan/ |
| `p15_valsartan_ibuprofen` | valsartan | ibuprofen | unranked | BNF interactions, valsartan page, entry "ibuprofen" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/valsartan/ |
| `p15_valsartan_diclofenac` | valsartan | diclofenac | unranked | BNF interactions, valsartan page, entry "diclofenac" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/valsartan/ |
| `p15_valsartan_naproxen` | valsartan | naproxen | unranked | BNF interactions, valsartan page, entry "naproxen" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/valsartan/ |
| `p15_valsartan_meloxicam` | valsartan | meloxicam | unranked | BNF interactions, valsartan page, entry "meloxicam" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/valsartan/ |
| `p15_valsartan_piroxicam` | valsartan | piroxicam | unranked | BNF interactions, valsartan page, entry "piroxicam" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/valsartan/ |
| `p15_telmisartan_ibuprofen` | telmisartan | ibuprofen | unranked | BNF interactions, telmisartan page, entry "ibuprofen" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/telmisartan/ |
| `p15_telmisartan_diclofenac` | telmisartan | diclofenac | unranked | BNF interactions, telmisartan page, entry "diclofenac" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/telmisartan/ |
| `p15_telmisartan_naproxen` | telmisartan | naproxen | unranked | BNF interactions, telmisartan page, entry "naproxen" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/telmisartan/ |
| `p15_telmisartan_meloxicam` | telmisartan | meloxicam | unranked | BNF interactions, telmisartan page, entry "meloxicam" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/telmisartan/ |
| `p15_telmisartan_piroxicam` | telmisartan | piroxicam | unranked | BNF interactions, telmisartan page, entry "piroxicam" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/telmisartan/ |
| `p15_irbesartan_ibuprofen` | irbesartan | ibuprofen | unranked | BNF interactions, irbesartan page, entry "ibuprofen" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/irbesartan/ |
| `p15_irbesartan_diclofenac` | irbesartan | diclofenac | unranked | BNF interactions, irbesartan page, entry "diclofenac" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/irbesartan/ |
| `p15_irbesartan_naproxen` | irbesartan | naproxen | unranked | BNF interactions, irbesartan page, entry "naproxen" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/irbesartan/ |
| `p15_irbesartan_meloxicam` | irbesartan | meloxicam | unranked | BNF interactions, irbesartan page, entry "meloxicam" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/irbesartan/ |
| `p15_irbesartan_piroxicam` | irbesartan | piroxicam | unranked | BNF interactions, irbesartan page, entry "piroxicam" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/irbesartan/ |
| `p15_candesartan_ibuprofen` | candesartan | ibuprofen | unranked | BNF interactions, candesartan page, entry "ibuprofen" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/candesartan/ |
| `p15_candesartan_diclofenac` | candesartan | diclofenac | unranked | BNF interactions, candesartan page, entry "diclofenac" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/candesartan/ |
| `p15_candesartan_naproxen` | candesartan | naproxen | unranked | BNF interactions, candesartan page, entry "naproxen" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/candesartan/ |
| `p15_candesartan_meloxicam` | candesartan | meloxicam | unranked | BNF interactions, candesartan page, entry "meloxicam" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/candesartan/ |
| `p15_candesartan_piroxicam` | candesartan | piroxicam | unranked | BNF interactions, candesartan page, entry "piroxicam" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/candesartan/ |

#### Class pair 16: ARB + potassium-sparing diuretic (Review; 15 rules)

Hyperkalaemia risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p16_losartan_spironolactone` | losartan | spironolactone | unranked | BNF interactions, losartan page, entry "spironolactone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/losartan/ |
| `p16_losartan_eplerenone` | losartan | eplerenone | unranked | BNF interactions, losartan page, entry "eplerenone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/losartan/ |
| `p16_losartan_amiloride` | losartan | amiloride | unranked | BNF interactions, losartan page, entry "amiloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/losartan/ |
| `p16_valsartan_spironolactone` | valsartan | spironolactone | unranked | BNF interactions, valsartan page, entry "spironolactone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/valsartan/ |
| `p16_valsartan_eplerenone` | valsartan | eplerenone | unranked | BNF interactions, valsartan page, entry "eplerenone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/valsartan/ |
| `p16_valsartan_amiloride` | valsartan | amiloride | unranked | BNF interactions, valsartan page, entry "amiloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/valsartan/ |
| `p16_telmisartan_spironolactone` | telmisartan | spironolactone | unranked | BNF interactions, telmisartan page, entry "spironolactone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/telmisartan/ |
| `p16_telmisartan_eplerenone` | telmisartan | eplerenone | unranked | BNF interactions, telmisartan page, entry "eplerenone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/telmisartan/ |
| `p16_telmisartan_amiloride` | telmisartan | amiloride | unranked | BNF interactions, telmisartan page, entry "amiloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/telmisartan/ |
| `p16_irbesartan_spironolactone` | irbesartan | spironolactone | unranked | BNF interactions, irbesartan page, entry "spironolactone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/irbesartan/ |
| `p16_irbesartan_eplerenone` | irbesartan | eplerenone | unranked | BNF interactions, irbesartan page, entry "eplerenone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/irbesartan/ |
| `p16_irbesartan_amiloride` | irbesartan | amiloride | unranked | BNF interactions, irbesartan page, entry "amiloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/irbesartan/ |
| `p16_candesartan_spironolactone` | candesartan | spironolactone | unranked | BNF interactions, candesartan page, entry "spironolactone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/candesartan/ |
| `p16_candesartan_eplerenone` | candesartan | eplerenone | unranked | BNF interactions, candesartan page, entry "eplerenone" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/candesartan/ |
| `p16_candesartan_amiloride` | candesartan | amiloride | unranked | BNF interactions, candesartan page, entry "amiloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/candesartan/ |

#### Class pair 17: ARB + potassium supplement (Review; 5 rules)

Hyperkalaemia risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p17_losartan_potassium_chloride` | losartan | potassium chloride | unranked | BNF interactions, losartan page, entry "potassium chloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/losartan/ |
| `p17_valsartan_potassium_chloride` | valsartan | potassium chloride | unranked | BNF interactions, valsartan page, entry "potassium chloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/valsartan/ |
| `p17_telmisartan_potassium_chloride` | telmisartan | potassium chloride | unranked | BNF interactions, telmisartan page, entry "potassium chloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/telmisartan/ |
| `p17_irbesartan_potassium_chloride` | irbesartan | potassium chloride | unranked | BNF interactions, irbesartan page, entry "potassium chloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/irbesartan/ |
| `p17_candesartan_potassium_chloride` | candesartan | potassium chloride | unranked | BNF interactions, candesartan page, entry "potassium chloride" (unranked: both increase the risk of hyperkalaemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/candesartan/ |

#### Class pair 19: Digoxin + amiodarone (Review; 1 rule)

Digoxin toxicity risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p19_digoxin_amiodarone` | digoxin | amiodarone | Severe | BNF interactions, digoxin page, entry "amiodarone" (Severe: moderately increases the exposure to digoxin; monitor and adjust dose; also bradycardia), read 2026-11-03: https://bnf.nice.org.uk/interactions/digoxin/ |

#### Class pair 20: Digoxin + rate-limiting calcium channel blocker (Review; 2 rules)

Digoxin toxicity risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p20_digoxin_verapamil` | digoxin | verapamil | Severe | BNF interactions, digoxin page, entry "verapamil" (Severe: increases the concentration of digoxin; monitor and adjust dose; also bradycardia), read 2026-11-03: https://bnf.nice.org.uk/interactions/digoxin/ |
| `p20_digoxin_diltiazem` | digoxin | diltiazem | Severe | BNF interactions, digoxin page, entry "diltiazem" (Severe: increases the concentration of digoxin; monitor and adjust dose; also bradycardia), read 2026-11-03: https://bnf.nice.org.uk/interactions/digoxin/ |

#### Class pair 21: Digoxin + loop diuretic (Review; 2 rules)

Digoxin toxicity via low potassium.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p21_digoxin_furosemide` | digoxin | furosemide | Severe | BNF interactions, digoxin page, entry "furosemide" (Severe: predicted to increase the risk of digoxin toxicity), read 2026-11-03: https://bnf.nice.org.uk/interactions/digoxin/ |
| `p21_digoxin_bumetanide` | digoxin | bumetanide | Severe | BNF interactions, digoxin page, entry "bumetanide" (Severe: predicted to increase the risk of digoxin toxicity), read 2026-11-03: https://bnf.nice.org.uk/interactions/digoxin/ |

#### Class pair 22: Fluoroquinolone + artemisinin-based antimalarial (Review; 1 rule)

Additive QT prolongation.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p22_moxifloxacin_artemether` | moxifloxacin | artemether | Severe | BNF interactions, moxifloxacin page, entry "artemether" (Severe: both prolong the QT interval), read 2026-11-03: https://bnf.nice.org.uk/interactions/moxifloxacin/ |

#### Class pair 23: Levothyroxine + calcium / iron supplement (Review; 4 rules)

Reduced levothyroxine absorption.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p23_levothyroxine_calcium_carbonate` | levothyroxine | calcium carbonate | Moderate | BNF interactions, levothyroxine page, entry "calcium carbonate" (Moderate: decreases the absorption of oral levothyroxine; separate administration), read 2026-11-03: https://bnf.nice.org.uk/interactions/levothyroxine/ |
| `p23_levothyroxine_ferrous_sulfate` | levothyroxine | ferrous sulfate | Moderate | BNF interactions, levothyroxine page, entry "iron" (Moderate: oral iron decreases the absorption of oral levothyroxine; separate administration by at least 4 hours), read 2026-11-03: https://bnf.nice.org.uk/interactions/levothyroxine/ |
| `p23_levothyroxine_ferrous_fumarate` | levothyroxine | ferrous fumarate | Moderate | BNF interactions, levothyroxine page, entry "iron" (Moderate: oral iron decreases the absorption of oral levothyroxine; separate administration by at least 4 hours), read 2026-11-03: https://bnf.nice.org.uk/interactions/levothyroxine/ |
| `p23_levothyroxine_ferrous_gluconate` | levothyroxine | ferrous gluconate | Moderate | BNF interactions, levothyroxine page, entry "iron" (Moderate: oral iron decreases the absorption of oral levothyroxine; separate administration by at least 4 hours), read 2026-11-03: https://bnf.nice.org.uk/interactions/levothyroxine/ |

#### Class pair 25: Lithium + ACE inhibitor (Review; 5 rules)

Lithium toxicity risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p25_lithium_lisinopril` | lithium | lisinopril | Severe | BNF interactions, lisinopril page, entry "lithium" (Severe: predicted to increase the concentration of lithium; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/lisinopril/ |
| `p25_lithium_ramipril` | lithium | ramipril | Severe | BNF interactions, ramipril page, entry "lithium" (Severe: predicted to increase the concentration of lithium; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/ramipril/ |
| `p25_lithium_enalapril` | lithium | enalapril | Severe | BNF interactions, enalapril page, entry "lithium" (Severe: predicted to increase the concentration of lithium; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/enalapril/ |
| `p25_lithium_perindopril` | lithium | perindopril | Severe | BNF interactions, perindopril page, entry "lithium" (Severe: predicted to increase the concentration of lithium; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/perindopril/ |
| `p25_lithium_captopril` | lithium | captopril | Severe | BNF interactions, captopril page, entry "lithium" (Severe: predicted to increase the concentration of lithium; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/captopril/ |

#### Class pair 27: Lithium + thiazide diuretic (Review; 4 rules)

Lithium toxicity risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p27_lithium_hydrochlorothiazide` | lithium | hydrochlorothiazide | Severe | BNF interactions, lithium page, entry "hydrochlorothiazide" (Severe: increases the concentration of lithium; avoid or adjust dose and monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/lithium/ |
| `p27_lithium_bendroflumethiazide` | lithium | bendroflumethiazide | Severe | BNF interactions, lithium page, entry "bendroflumethiazide" (Severe: increases the concentration of lithium; avoid or adjust dose and monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/lithium/ |
| `p27_lithium_indapamide` | lithium | indapamide | Severe | BNF interactions, lithium page, entry "indapamide" (Severe: increases the concentration of lithium; avoid or adjust dose and monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/lithium/ |
| `p27_lithium_chlortalidone` | lithium | chlortalidone | Severe | BNF interactions, lithium page, entry "chlortalidone" (Severe: increases the concentration of lithium; avoid or adjust dose and monitor), read 2026-11-03: https://bnf.nice.org.uk/interactions/lithium/ |

#### Class pair 28: Macrolide + artemisinin-based antimalarial (Review; 4 rules)

Additive QT prolongation.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p28_erythromycin_artemether` | erythromycin | artemether | Severe | BNF interactions, erythromycin page, entry "artemether" (Severe: both prolong the QT interval), read 2026-11-03: https://bnf.nice.org.uk/interactions/erythromycin/ |
| `p28_erythromycin_dihydroartemisinin` | erythromycin | dihydroartemisinin | Severe | BNF interactions, erythromycin page, entry "artenimol" (Severe: artenimol is the BNF name for dihydroartemisinin; both prolong the QT interval), read 2026-11-03: https://bnf.nice.org.uk/interactions/erythromycin/ |
| `p28_erythromycin_piperaquine` | erythromycin | piperaquine | Severe | BNF interactions, erythromycin page, entry "piperaquine" (Severe: predicted to increase the concentration of piperaquine), read 2026-11-03: https://bnf.nice.org.uk/interactions/erythromycin/ |
| `p28_clarithromycin_piperaquine` | clarithromycin | piperaquine | Severe | BNF interactions, clarithromycin page, entry "piperaquine" (Severe: predicted to increase the concentration of piperaquine), read 2026-11-03: https://bnf.nice.org.uk/interactions/clarithromycin/ |

#### Class pair 29: Macrolide + fluoroquinolone (Review; 1 rule)

Additive QT prolongation.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p29_erythromycin_moxifloxacin` | erythromycin | moxifloxacin | Severe | BNF interactions, moxifloxacin page, entry "erythromycin" (Severe: both prolong the QT interval), read 2026-11-03: https://bnf.nice.org.uk/interactions/moxifloxacin/ |

#### Class pair 33: NSAID + antiplatelet (Review; 10 rules)

Gastrointestinal bleeding risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p33_ibuprofen_aspirin` | ibuprofen | aspirin | Severe | BNF interactions, ibuprofen page, entry "aspirin" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/ibuprofen/ |
| `p33_ibuprofen_clopidogrel` | ibuprofen | clopidogrel | Severe | BNF interactions, ibuprofen page, entry "clopidogrel" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/ibuprofen/ |
| `p33_diclofenac_aspirin` | diclofenac | aspirin | Severe | BNF interactions, diclofenac page, entry "aspirin" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/diclofenac/ |
| `p33_diclofenac_clopidogrel` | diclofenac | clopidogrel | Severe | BNF interactions, diclofenac page, entry "clopidogrel" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/diclofenac/ |
| `p33_naproxen_aspirin` | naproxen | aspirin | Severe | BNF interactions, naproxen page, entry "aspirin" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/naproxen/ |
| `p33_naproxen_clopidogrel` | naproxen | clopidogrel | Severe | BNF interactions, naproxen page, entry "clopidogrel" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/naproxen/ |
| `p33_meloxicam_aspirin` | meloxicam | aspirin | Severe | BNF interactions, meloxicam page, entry "aspirin" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/meloxicam/ |
| `p33_meloxicam_clopidogrel` | meloxicam | clopidogrel | Severe | BNF interactions, meloxicam page, entry "clopidogrel" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/meloxicam/ |
| `p33_piroxicam_aspirin` | piroxicam | aspirin | Severe | BNF interactions, piroxicam page, entry "aspirin" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/piroxicam/ |
| `p33_piroxicam_clopidogrel` | piroxicam | clopidogrel | Severe | BNF interactions, piroxicam page, entry "clopidogrel" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/piroxicam/ |

#### Class pair 34: NSAID + loop diuretic (Review; 10 rules)

Reduced diuretic effect and kidney injury risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p34_ibuprofen_furosemide` | ibuprofen | furosemide | Moderate | BNF interactions, ibuprofen page, entry "furosemide" (Moderate: ototoxicity at high NSAID dose; both increase the risk of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ibuprofen/ |
| `p34_ibuprofen_bumetanide` | ibuprofen | bumetanide | Moderate | BNF interactions, ibuprofen page, entry "bumetanide" (Moderate: ototoxicity at high NSAID dose; both increase the risk of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ibuprofen/ |
| `p34_diclofenac_furosemide` | diclofenac | furosemide | Moderate | BNF interactions, diclofenac page, entry "furosemide" (Moderate: ototoxicity at high NSAID dose; both increase the risk of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/diclofenac/ |
| `p34_diclofenac_bumetanide` | diclofenac | bumetanide | Moderate | BNF interactions, diclofenac page, entry "bumetanide" (Moderate: ototoxicity at high NSAID dose; both increase the risk of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/diclofenac/ |
| `p34_naproxen_furosemide` | naproxen | furosemide | Moderate | BNF interactions, naproxen page, entry "furosemide" (Moderate: ototoxicity at high NSAID dose; both increase the risk of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/naproxen/ |
| `p34_naproxen_bumetanide` | naproxen | bumetanide | Moderate | BNF interactions, naproxen page, entry "bumetanide" (Moderate: ototoxicity at high NSAID dose; both increase the risk of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/naproxen/ |
| `p34_meloxicam_furosemide` | meloxicam | furosemide | Moderate | BNF interactions, meloxicam page, entry "furosemide" (Moderate: ototoxicity at high NSAID dose; both increase the risk of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/meloxicam/ |
| `p34_meloxicam_bumetanide` | meloxicam | bumetanide | Moderate | BNF interactions, meloxicam page, entry "bumetanide" (Moderate: ototoxicity at high NSAID dose; both increase the risk of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/meloxicam/ |
| `p34_piroxicam_furosemide` | piroxicam | furosemide | Moderate | BNF interactions, piroxicam page, entry "furosemide" (Moderate: ototoxicity at high NSAID dose; both increase the risk of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/piroxicam/ |
| `p34_piroxicam_bumetanide` | piroxicam | bumetanide | Moderate | BNF interactions, piroxicam page, entry "bumetanide" (Moderate: ototoxicity at high NSAID dose; both increase the risk of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/piroxicam/ |

#### Class pair 35: SSRI antidepressant + anticoagulant (Review; 25 rules)

Bleeding risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p35_fluoxetine_warfarin` | fluoxetine | warfarin | Severe | BNF interactions, warfarin page, entry "fluoxetine" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p35_fluoxetine_rivaroxaban` | fluoxetine | rivaroxaban | Severe | BNF interactions, rivaroxaban page, entry "fluoxetine" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p35_fluoxetine_apixaban` | fluoxetine | apixaban | Severe | BNF interactions, apixaban page, entry "fluoxetine" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p35_fluoxetine_dabigatran` | fluoxetine | dabigatran | Severe | BNF interactions, dabigatran page, entry "fluoxetine" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p35_fluoxetine_enoxaparin` | fluoxetine | enoxaparin | Severe | BNF interactions, enoxaparin page, entry "fluoxetine" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/enoxaparin/ |
| `p35_sertraline_warfarin` | sertraline | warfarin | Severe | BNF interactions, warfarin page, entry "sertraline" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p35_sertraline_rivaroxaban` | sertraline | rivaroxaban | Severe | BNF interactions, rivaroxaban page, entry "sertraline" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p35_sertraline_apixaban` | sertraline | apixaban | Severe | BNF interactions, apixaban page, entry "sertraline" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p35_sertraline_dabigatran` | sertraline | dabigatran | Severe | BNF interactions, dabigatran page, entry "sertraline" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p35_sertraline_enoxaparin` | sertraline | enoxaparin | Severe | BNF interactions, enoxaparin page, entry "sertraline" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/enoxaparin/ |
| `p35_paroxetine_warfarin` | paroxetine | warfarin | Severe | BNF interactions, warfarin page, entry "paroxetine" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p35_paroxetine_rivaroxaban` | paroxetine | rivaroxaban | Severe | BNF interactions, rivaroxaban page, entry "paroxetine" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p35_paroxetine_apixaban` | paroxetine | apixaban | Severe | BNF interactions, apixaban page, entry "paroxetine" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p35_paroxetine_dabigatran` | paroxetine | dabigatran | Severe | BNF interactions, dabigatran page, entry "paroxetine" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p35_paroxetine_enoxaparin` | paroxetine | enoxaparin | Severe | BNF interactions, enoxaparin page, entry "paroxetine" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/enoxaparin/ |
| `p35_citalopram_warfarin` | citalopram | warfarin | Severe | BNF interactions, warfarin page, entry "citalopram" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p35_citalopram_rivaroxaban` | citalopram | rivaroxaban | Severe | BNF interactions, rivaroxaban page, entry "citalopram" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p35_citalopram_apixaban` | citalopram | apixaban | Severe | BNF interactions, apixaban page, entry "citalopram" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p35_citalopram_dabigatran` | citalopram | dabigatran | Severe | BNF interactions, dabigatran page, entry "citalopram" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p35_citalopram_enoxaparin` | citalopram | enoxaparin | Severe | BNF interactions, enoxaparin page, entry "citalopram" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/enoxaparin/ |
| `p35_escitalopram_warfarin` | escitalopram | warfarin | Severe | BNF interactions, warfarin page, entry "escitalopram" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/warfarin/ |
| `p35_escitalopram_rivaroxaban` | escitalopram | rivaroxaban | Severe | BNF interactions, rivaroxaban page, entry "escitalopram" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/rivaroxaban/ |
| `p35_escitalopram_apixaban` | escitalopram | apixaban | Severe | BNF interactions, apixaban page, entry "escitalopram" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/apixaban/ |
| `p35_escitalopram_dabigatran` | escitalopram | dabigatran | Severe | BNF interactions, dabigatran page, entry "escitalopram" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/dabigatran/ |
| `p35_escitalopram_enoxaparin` | escitalopram | enoxaparin | Severe | BNF interactions, enoxaparin page, entry "escitalopram" (Severe: both increase the risk of bleeding), read 2026-11-03: https://bnf.nice.org.uk/interactions/enoxaparin/ |

#### Class pair 36: SSRI antidepressant + NSAID (Review; 25 rules)

Gastrointestinal bleeding risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p36_fluoxetine_ibuprofen` | fluoxetine | ibuprofen | Severe | BNF interactions, ibuprofen page, entry "fluoxetine" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ibuprofen/ |
| `p36_fluoxetine_diclofenac` | fluoxetine | diclofenac | Severe | BNF interactions, diclofenac page, entry "fluoxetine" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/diclofenac/ |
| `p36_fluoxetine_naproxen` | fluoxetine | naproxen | Severe | BNF interactions, naproxen page, entry "fluoxetine" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/naproxen/ |
| `p36_fluoxetine_meloxicam` | fluoxetine | meloxicam | Severe | BNF interactions, meloxicam page, entry "fluoxetine" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/meloxicam/ |
| `p36_fluoxetine_piroxicam` | fluoxetine | piroxicam | Severe | BNF interactions, piroxicam page, entry "fluoxetine" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/piroxicam/ |
| `p36_sertraline_ibuprofen` | sertraline | ibuprofen | Severe | BNF interactions, ibuprofen page, entry "sertraline" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ibuprofen/ |
| `p36_sertraline_diclofenac` | sertraline | diclofenac | Severe | BNF interactions, diclofenac page, entry "sertraline" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/diclofenac/ |
| `p36_sertraline_naproxen` | sertraline | naproxen | Severe | BNF interactions, naproxen page, entry "sertraline" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/naproxen/ |
| `p36_sertraline_meloxicam` | sertraline | meloxicam | Severe | BNF interactions, meloxicam page, entry "sertraline" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/meloxicam/ |
| `p36_sertraline_piroxicam` | sertraline | piroxicam | Severe | BNF interactions, piroxicam page, entry "sertraline" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/piroxicam/ |
| `p36_paroxetine_ibuprofen` | paroxetine | ibuprofen | Severe | BNF interactions, ibuprofen page, entry "paroxetine" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ibuprofen/ |
| `p36_paroxetine_diclofenac` | paroxetine | diclofenac | Severe | BNF interactions, diclofenac page, entry "paroxetine" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/diclofenac/ |
| `p36_paroxetine_naproxen` | paroxetine | naproxen | Severe | BNF interactions, naproxen page, entry "paroxetine" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/naproxen/ |
| `p36_paroxetine_meloxicam` | paroxetine | meloxicam | Severe | BNF interactions, meloxicam page, entry "paroxetine" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/meloxicam/ |
| `p36_paroxetine_piroxicam` | paroxetine | piroxicam | Severe | BNF interactions, piroxicam page, entry "paroxetine" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/piroxicam/ |
| `p36_citalopram_ibuprofen` | citalopram | ibuprofen | Severe | BNF interactions, ibuprofen page, entry "citalopram" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ibuprofen/ |
| `p36_citalopram_diclofenac` | citalopram | diclofenac | Severe | BNF interactions, diclofenac page, entry "citalopram" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/diclofenac/ |
| `p36_citalopram_naproxen` | citalopram | naproxen | Severe | BNF interactions, naproxen page, entry "citalopram" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/naproxen/ |
| `p36_citalopram_meloxicam` | citalopram | meloxicam | Severe | BNF interactions, meloxicam page, entry "citalopram" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/meloxicam/ |
| `p36_citalopram_piroxicam` | citalopram | piroxicam | Severe | BNF interactions, piroxicam page, entry "citalopram" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/piroxicam/ |
| `p36_escitalopram_ibuprofen` | escitalopram | ibuprofen | Severe | BNF interactions, ibuprofen page, entry "escitalopram" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/ibuprofen/ |
| `p36_escitalopram_diclofenac` | escitalopram | diclofenac | Severe | BNF interactions, diclofenac page, entry "escitalopram" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/diclofenac/ |
| `p36_escitalopram_naproxen` | escitalopram | naproxen | Severe | BNF interactions, naproxen page, entry "escitalopram" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/naproxen/ |
| `p36_escitalopram_meloxicam` | escitalopram | meloxicam | Severe | BNF interactions, meloxicam page, entry "escitalopram" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/meloxicam/ |
| `p36_escitalopram_piroxicam` | escitalopram | piroxicam | Severe | BNF interactions, piroxicam page, entry "escitalopram" (Severe: both increase the risk of bleeding; also hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/piroxicam/ |

#### Class pair 37: SSRI antidepressant + tramadol (Review; 5 rules)

Serotonin syndrome and seizure risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p37_fluoxetine_tramadol` | fluoxetine | tramadol | Severe | BNF interactions, fluoxetine page, entry "tramadol" (Severe: predicted to decrease the efficacy of tramadol; both might increase the risk of serotonin toxicity), read 2026-11-03: https://bnf.nice.org.uk/interactions/fluoxetine/ |
| `p37_paroxetine_tramadol` | paroxetine | tramadol | Severe | BNF interactions, paroxetine page, entry "tramadol" (Severe: predicted to decrease the efficacy of tramadol; both might increase the risk of serotonin toxicity), read 2026-11-03: https://bnf.nice.org.uk/interactions/paroxetine/ |
| `p37_sertraline_tramadol` | sertraline | tramadol | unranked | BNF interactions, sertraline page, entry "tramadol" (unranked: both might increase the risk of serotonin toxicity and of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/sertraline/ |
| `p37_citalopram_tramadol` | citalopram | tramadol | unranked | BNF interactions, citalopram page, entry "tramadol" (unranked: both might increase the risk of serotonin toxicity and of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/citalopram/ |
| `p37_escitalopram_tramadol` | escitalopram | tramadol | unranked | BNF interactions, escitalopram page, entry "tramadol" (unranked: both might increase the risk of serotonin toxicity and of hyponatraemia), read 2026-11-03: https://bnf.nice.org.uk/interactions/escitalopram/ |

#### Class pair 38: Statin + azole antifungal (Review; 8 rules)

Muscle toxicity risk (statin with azole antifungal).

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p38_simvastatin_fluconazole` | simvastatin | fluconazole | Severe | BNF interactions, simvastatin page, entry "fluconazole" (Severe: predicted to increase the exposure to simvastatin; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/simvastatin/ |
| `p38_simvastatin_itraconazole` | simvastatin | itraconazole | Severe | BNF interactions, simvastatin page, entry "itraconazole" (Severe: predicted to increase the exposure to simvastatin; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/simvastatin/ |
| `p38_simvastatin_ketoconazole` | simvastatin | ketoconazole | Severe | BNF interactions, simvastatin page, entry "ketoconazole" (Severe: predicted to increase the exposure to simvastatin; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/simvastatin/ |
| `p38_simvastatin_voriconazole` | simvastatin | voriconazole | Severe | BNF interactions, simvastatin page, entry "voriconazole" (Severe: predicted to increase the exposure to simvastatin; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/simvastatin/ |
| `p38_atorvastatin_fluconazole` | atorvastatin | fluconazole | Severe | BNF interactions, atorvastatin page, entry "fluconazole" (Severe: predicted to increase the exposure to atorvastatin; monitor and adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/atorvastatin/ |
| `p38_atorvastatin_itraconazole` | atorvastatin | itraconazole | Severe | BNF interactions, atorvastatin page, entry "itraconazole" (Severe: predicted to increase the exposure to atorvastatin; manufacturer advises avoid or adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/atorvastatin/ |
| `p38_atorvastatin_ketoconazole` | atorvastatin | ketoconazole | Severe | BNF interactions, atorvastatin page, entry "ketoconazole" (Severe: predicted to increase the exposure to atorvastatin; manufacturer advises avoid or adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/atorvastatin/ |
| `p38_atorvastatin_voriconazole` | atorvastatin | voriconazole | Severe | BNF interactions, atorvastatin page, entry "voriconazole" (Severe: predicted to increase the exposure to atorvastatin; manufacturer advises avoid or adjust dose), read 2026-11-03: https://bnf.nice.org.uk/interactions/atorvastatin/ |

#### Class pair 39: Statin + fibrate (Review; 6 rules)

Muscle toxicity risk (statin with fibrate).

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p39_simvastatin_gemfibrozil` | simvastatin | gemfibrozil | Severe | BNF interactions, simvastatin page, entry "gemfibrozil" (Severe: increases the exposure to simvastatin; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/simvastatin/ |
| `p39_simvastatin_fenofibrate` | simvastatin | fenofibrate | Severe | BNF interactions, simvastatin page, entry "fenofibrate" (Severe: increases the risk of rhabdomyolysis with simvastatin), read 2026-11-03: https://bnf.nice.org.uk/interactions/simvastatin/ |
| `p39_atorvastatin_gemfibrozil` | atorvastatin | gemfibrozil | Severe | BNF interactions, atorvastatin page, entry "gemfibrozil" (Severe: increases the exposure to atorvastatin; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/atorvastatin/ |
| `p39_atorvastatin_fenofibrate` | atorvastatin | fenofibrate | Severe | BNF interactions, atorvastatin page, entry "fenofibrate" (Severe: increases the risk of rhabdomyolysis with atorvastatin), read 2026-11-03: https://bnf.nice.org.uk/interactions/atorvastatin/ |
| `p39_rosuvastatin_gemfibrozil` | rosuvastatin | gemfibrozil | Severe | BNF interactions, rosuvastatin page, entry "gemfibrozil" (Severe: increases the exposure to rosuvastatin; manufacturer advises avoid), read 2026-11-03: https://bnf.nice.org.uk/interactions/rosuvastatin/ |
| `p39_rosuvastatin_fenofibrate` | rosuvastatin | fenofibrate | Severe | BNF interactions, rosuvastatin page, entry "fenofibrate" (Severe: increases the risk of rhabdomyolysis with rosuvastatin), read 2026-11-03: https://bnf.nice.org.uk/interactions/rosuvastatin/ |

#### Class pair 41: Sulfonylurea + azole antifungal (Review; 8 rules)

Hypoglycaemia risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p41_gliclazide_voriconazole` | gliclazide | voriconazole | Moderate | BNF interactions, gliclazide page, entry "voriconazole" (Moderate: predicted to increase the concentration of gliclazide), read 2026-11-03: https://bnf.nice.org.uk/interactions/gliclazide/ |
| `p41_glibenclamide_voriconazole` | glibenclamide | voriconazole | Moderate | BNF interactions, glibenclamide page, entry "voriconazole" (Moderate: predicted to increase the concentration of glibenclamide), read 2026-11-03: https://bnf.nice.org.uk/interactions/glibenclamide/ |
| `p41_glimepiride_voriconazole` | glimepiride | voriconazole | Moderate | BNF interactions, glimepiride page, entry "voriconazole" (Moderate: predicted to increase the concentration of glimepiride), read 2026-11-03: https://bnf.nice.org.uk/interactions/glimepiride/ |
| `p41_glipizide_voriconazole` | glipizide | voriconazole | Moderate | BNF interactions, glipizide page, entry "voriconazole" (Moderate: predicted to increase the concentration of glipizide), read 2026-11-03: https://bnf.nice.org.uk/interactions/glipizide/ |
| `p41_gliclazide_fluconazole` | gliclazide | fluconazole | SmPC | Diflucan 150 mg hard capsules (fluconazole), Pfizer SmPC section 4.5 (fluconazole prolongs the half-life of oral sulfonylureas, e.g. glibenclamide and glipizide; frequent blood glucose monitoring and sulfonylurea dose reduction recommended; gliclazide is covered by the class statement, not named), read 2026-11-03: https://www.medicines.org.uk/emc/product/1065/smpc |
| `p41_glibenclamide_fluconazole` | glibenclamide | fluconazole | SmPC | Diflucan 150 mg hard capsules (fluconazole), Pfizer SmPC section 4.5 (fluconazole prolongs the half-life of oral sulfonylureas, e.g. glibenclamide and glipizide; frequent blood glucose monitoring and sulfonylurea dose reduction recommended), read 2026-11-03: https://www.medicines.org.uk/emc/product/1065/smpc |
| `p41_glimepiride_fluconazole` | glimepiride | fluconazole | SmPC | Diflucan 150 mg hard capsules (fluconazole), Pfizer SmPC section 4.5 (fluconazole prolongs the half-life of oral sulfonylureas, e.g. glibenclamide and glipizide; frequent blood glucose monitoring and sulfonylurea dose reduction recommended; glimepiride is covered by the class statement, not named), read 2026-11-03: https://www.medicines.org.uk/emc/product/1065/smpc |
| `p41_glipizide_fluconazole` | glipizide | fluconazole | SmPC | Diflucan 150 mg hard capsules (fluconazole), Pfizer SmPC section 4.5 (fluconazole prolongs the half-life of oral sulfonylureas, e.g. glibenclamide and glipizide; frequent blood glucose monitoring and sulfonylurea dose reduction recommended), read 2026-11-03: https://www.medicines.org.uk/emc/product/1065/smpc |

#### Class pair 42: Sulfonylurea + co-trimoxazole (Review; 8 rules)

Hypoglycaemia risk.

| Rule code | Ingredient A | Ingredient B | BNF word | Source |
|---|---|---|---|---|
| `p42_gliclazide_sulfamethoxazole` | gliclazide | sulfamethoxazole | Moderate | BNF interactions, sulfamethoxazole page, entry "gliclazide" (Moderate: predicted to increase the exposure to gliclazide; manufacturer advises caution), read 2026-11-03: https://bnf.nice.org.uk/interactions/sulfamethoxazole/ |
| `p42_gliclazide_co_trimoxazole` | gliclazide | co trimoxazole | Moderate | BNF interactions, sulfamethoxazole page, entry "gliclazide" (Moderate: co-trimoxazole contains sulfamethoxazole, which is predicted to increase the exposure to gliclazide), read 2026-11-03: https://bnf.nice.org.uk/interactions/sulfamethoxazole/ |
| `p42_glibenclamide_sulfamethoxazole` | glibenclamide | sulfamethoxazole | Moderate | BNF interactions, sulfamethoxazole page, entry "glibenclamide" (Moderate: predicted to increase the exposure to glibenclamide; manufacturer advises caution), read 2026-11-03: https://bnf.nice.org.uk/interactions/sulfamethoxazole/ |
| `p42_glibenclamide_co_trimoxazole` | glibenclamide | co trimoxazole | Moderate | BNF interactions, sulfamethoxazole page, entry "glibenclamide" (Moderate: co-trimoxazole contains sulfamethoxazole, which is predicted to increase the exposure to glibenclamide), read 2026-11-03: https://bnf.nice.org.uk/interactions/sulfamethoxazole/ |
| `p42_glimepiride_sulfamethoxazole` | glimepiride | sulfamethoxazole | Moderate | BNF interactions, sulfamethoxazole page, entry "glimepiride" (Moderate: predicted to increase the exposure to glimepiride; manufacturer advises caution), read 2026-11-03: https://bnf.nice.org.uk/interactions/sulfamethoxazole/ |
| `p42_glimepiride_co_trimoxazole` | glimepiride | co trimoxazole | Moderate | BNF interactions, sulfamethoxazole page, entry "glimepiride" (Moderate: co-trimoxazole contains sulfamethoxazole, which is predicted to increase the exposure to glimepiride), read 2026-11-03: https://bnf.nice.org.uk/interactions/sulfamethoxazole/ |
| `p42_glipizide_sulfamethoxazole` | glipizide | sulfamethoxazole | Moderate | BNF interactions, sulfamethoxazole page, entry "glipizide" (Moderate: predicted to increase the exposure to glipizide; manufacturer advises caution), read 2026-11-03: https://bnf.nice.org.uk/interactions/sulfamethoxazole/ |
| `p42_glipizide_co_trimoxazole` | glipizide | co trimoxazole | Moderate | BNF interactions, sulfamethoxazole page, entry "glipizide" (Moderate: co-trimoxazole contains sulfamethoxazole, which is predicted to increase the exposure to glipizide), read 2026-11-03: https://bnf.nice.org.uk/interactions/sulfamethoxazole/ |

## 4. What the add form shows when both layers fire

Once both the signed S53 dataset (`interaction_check_enabled`) and this rule set (`medicine_interaction_rules`) are open, the common pairs fire in both: an ACE inhibitor with an ARB is class pair 1 in S53 and `p01_<acei>_<arb>` here. Before this change the web form (`apps/web/src/app/(dashboard)/patient/add-medication-form.tsx`) and the phone (`apps/mobile/src/screens/sections/medicine-cabinet-screen.tsx`) simply concatenated the two result lists, so a patient adding losartan to lisinopril would have read two near-identical warnings about one pair.

Both forms now pass the combined list through `mergeAddFindings` (`packages/medicines/src/add-check-merge.ts`) together with the name typed for the new medicine. An S08y finding always names the new medicine and one other; an S53 finding names every medicine in the matched group (two ACE inhibitors already on the list plus the new ARB is one finding naming three), so it stands for one pair per other medicine. Per family (interaction: S53 `interaction` or S08y `rule`; duplicate: S53 `duplicate` or S08y `same_ingredient`), an S53 finding and the S08y findings that cover its pairs are twins, and one side survives: the more severe one, and on a tie the S08y side, because it is the one with a named ingredient pair and a cited source signed line by line, and its sentence says so. An S53 finding is dropped only when S08y findings cover every pair it stands for; with partial cover it stays for the uncovered pair. A warning never disappears for a pair, only its twin does; a pair only one layer knows is untouched; the list stays worst first. Jest: `packages/medicines/src/add-check-merge.test.ts`.

## 5. Known limits and what was NOT covered

1. **Left out because the BNF does not list the pair** (as read 2026-11-03). Each of these is in the S53 class pairs but contributes no ingredient rule here, so a patient on these combinations is covered by the S53 class warning only:
   - Ciprofloxacin, levofloxacin and ofloxacin with amiodarone, with any antipsychotic (haloperidol, olanzapine*, risperidone, quetiapine, chlorpromazine*), with artemether, lumefantrine, artesunate, amodiaquine, dihydroartemisinin or piperaquine, with the macrolides, and with the sulfonylureas (class pairs 6, 13, 22, 29, 43). Only moxifloxacin carries the BNF's QT entries. *Olanzapine and chlorpromazine with ciprofloxacin are included as an exposure interaction (Moderate), not QT.
   - Azithromycin with simvastatin, atorvastatin, rosuvastatin, any antipsychotic, or any artemisinin antimalarial (pairs 14, 28, 40).
   - Rosuvastatin and pravastatin with the macrolides and the azoles, and with amiodarone (the BNF lists only an unranked hepatotoxicity line, not the muscle-toxicity interaction); pravastatin is not expanded anywhere in this set. Pairs 7, 38, 40.
   - Rivaroxaban, apixaban, dabigatran and enoxaparin with any fluoroquinolone, with metronidazole or tinidazole; rivaroxaban and apixaban with fluconazole; dabigatran with voriconazole; enoxaparin with any azole or macrolide (the BNF's enoxaparin entries are hepatotoxicity at high dose, a different mechanism). Pairs 9, 10, 11, 12.
   - Warfarin with tinidazole (pair 12).
   - Gliclazide, glibenclamide, glimepiride and glipizide with itraconazole or ketoconazole (pair 41). Fluconazole with the four sulfonylureas is included from the Diflucan SmPC, which names glibenclamide and glipizide and covers the others as "oral sulfonylureas".
   - Clarithromycin with artemether, lumefantrine, artesunate, amodiaquine or dihydroartemisinin; erythromycin with lumefantrine, artesunate or amodiaquine (pair 28).
2. **Expanded to the common generics only.** NSAIDs are ibuprofen, diclofenac, naproxen, meloxicam, piroxicam (not celecoxib, etoricoxib, indometacin, ketoprofen, mefenamic acid, nimesulide, aceclofenac); beta blockers are atenolol, bisoprolol, metoprolol, propranolol, carvedilol, nebivolol; ACE inhibitors lisinopril, ramipril, enalapril, perindopril, captopril; ARBs losartan, valsartan, telmisartan, irbesartan, candesartan; statins simvastatin, atorvastatin, rosuvastatin; opioids only tramadol (pair 37). A medicine outside these lists gets no ingredient rule; the S53 class stems may still catch it.
3. **Names, not salts or hyphenated combinations.** The matcher compares normalised ingredient names from the medicine's generic name (resolved through the reviewed brand map or the catalogue) and splits a combination on "and", "with", "/", "+", "," and "&". A combination typed with a hyphen ("artemether-lumefantrine") is one token and matches neither ingredient; a salt ("amlodipine besylate") does not match the plain name. This is the existing S08y limit, not new.
4. **Co-trimoxazole appears three ways.** Rules exist for "co trimoxazole" (the catalogue generic and brand Septrin), "trimethoprim" and "sulfamethoxazole", so the pair fires whichever name the medicine carries.
5. **No doses, no patient factors.** Dose, route, timing, kidney function, age, pregnancy and allergies are not considered. BNF entries that are dose-qualified (high-dose aspirin with methotrexate, high-dose NSAID ototoxicity with a loop diuretic) are included at the class pair's severity without the qualifier.
6. **Two class headlines are not what the cited BNF entry says.** Pair 34 (NSAID with a loop diuretic) is headlined "reduced diuretic effect and kidney injury risk" in the S53 dataset, but the BNF entries cited here say high-dose NSAID ototoxicity (Moderate) plus hyponatraemia; pair 15 (ARB with an NSAID) is headlined "kidney injury risk" but the BNF's ARB pages list only hyperkalaemia (the ACE inhibitor pages list nephrotoxicity as well). The rules are included because the BNF does list each pair; the reviewer is asked to accept them on the evidence quoted, not on the class headline.
7. **Severity is the class pair's, not the BNF's.** Every rule carries the severity its S53 class pair was signed with (High or Review), even where the BNF's own marker for that specific pair is Moderate or unranked. The BNF word is kept in the table and in each rule's source so the reviewer can disagree pair by pair.
8. **Sources were read by a build session, not a pharmacist.** The links are real and the quoted detail is from the page as rendered on 2026-11-03, but no pharmacist has yet confirmed each line. Where Nigerian guidance exists (NAFDAC, the Standard Treatment Guidelines) it was not consulted.
9. **Clinician view is unchanged.** The clinician medication safety panel uses the S53 engine only.

## 6. What the reviewer is asked to check

- [ ] Each class pair's severity (High or Review) is still fair once applied to every named ingredient pair under it.
- [ ] The pairs left out in section 5 item 1 are acceptable to leave to the S53 class warning.
- [ ] The three patient sentences and the limits sentence are acceptable.
- [ ] The merge rule in section 4 (one warning per pair, more severe wins, S08y wins a tie) is acceptable.

Reviewer name, PCN or MDCN number, date: ______________________________

## 7. Sign-off, in the order a human runs it

Nothing below has been run. Step 1 is the Chief Medical Officer's (the function refuses anyone else and refuses an empty set). Step 2 is an admin's or the CMO's from `/admin/go-live` or SQL. The draft also appears on the CMO sign-off hub (`/clinician/clinical-signoff`) as "Medicine interaction rules, version 2 drafted", via the sign-off queue, until signed.

```sql
-- 0. Confirm it is the draft this document describes (expect 350 and the hash in the table above).
select version, jsonb_array_length(config -> 'rules') as rules, encode(sha256(convert_to(config::text, 'utf8')), 'hex') as content_hash, is_active, approved_by
  from public.medicine_interaction_rule_sets order by version;

-- 1. Sign version 2 (Chief Medical Officer only). This marks it active and signed; it retires version 1 as the live row.
select public.sign_medicine_interaction_rule_sets((select id from public.medicine_interaction_rule_sets where version = 2));

-- 2. Open the guard (admin or CMO). Opening a feature clears its held_reason itself (set_go_live_guard, G-01). Switching it off again is always allowed.
select public.set_go_live_guard('medicine_interaction_rules', true, 'Interaction rule set v2 signed by the CMO on <date>; reviewed per docs/clinical/interaction-rule-set-v2.md');
```

To change a rule later: do not edit version 2. Add version 3 in a new migration (unsigned), document it the same way, and sign that; the supersede trigger refuses re-activating an older signed version.
