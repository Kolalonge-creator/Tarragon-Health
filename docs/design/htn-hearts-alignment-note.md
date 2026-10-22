# Hypertension step table: where it stands against Nigeria's HEARTS-based programme

Written 2026-10-22. A note for the CMO, not a clinical decision. It changes no value in the repository and signs nothing.
Source tags: **V** = read in a search result by the research pass (not checked against a primary document); **U** = background knowledge.
Everything marked V must be confirmed against the primary protocol PDFs before it is relied on (the same step OQ-171 already asks the CMO to take).

## What the repository has today

`protocols` row `htn_rtsl_ng`, version 1, status **draft** (migration `20261007190627_s61_s62_pathway_engine.sql`). A one-medicine-per-change ladder:
amlodipine 5 mg, add losartan 50 mg, raise amlodipine to 10 mg, raise losartan to 100 mg, add hydrochlorothiazide 25 mg, then refer.
Each step is proposed by the engine and only a clinician's signature applies it (INV-02). The pathway guard `pathway_bp` is off.

## What the research pass found about the national programme

- Nigeria's National Hypertension Control Initiative follows WHO HEARTS: a simple protocol, task-sharing, and fixed-dose combination (FDC) tablets. **V**
  (https://pmc.ncbi.nlm.nih.gov/articles/PMC13493882/)
- In that programme FDC prescribing rose from 16.3% to 65.2% of prescriptions, and six-month retention moved from 59.9% to 63.1%. **V**, same source.
- Public-sector antihypertensive prices were reported up to 7 times the target generic price. **V**, same source.
- A Lagos costing put guideline-based hypertension care near US$148 per patient per year, about 70% of it medicines. **V**, same source.
- A HEARTS-D diabetes extension is being piloted at 10 FCT primary health centres (trial record NCT07351162). **V**

## Differences worth the CMO's attention

1. **Single-pill combinations.** The programme leans on FDC tablets. The draft ladder uses separate tablets (amlodipine, then losartan), because a signed
   change today carries one medicine. This is already recorded as "S61/S62 start at step 2" in `docs/OPEN-QUESTIONS.md`. Supporting an FDC step needs a
   proposal format that can name one combined product, or the CMO accepting separate tablets. **Decision for the CMO; nothing to build until then.**
2. **Starting step by baseline.** The pack says patients with a higher baseline start at step 2. The ladder starts everyone at step 1. Same open question.
3. **What a pharmacy can stock.** The draft rationale already allows a clinician to substitute telmisartan or amiloride-hydrochlorothiazide "where stocked".
   Whether those belong in the signed table, and which FDC products Nigerian pharmacies actually carry, is a pharmacy-network fact to confirm. **U**
4. **Reporting yardstick.** Outcome reporting should be set against the national programme's own control figure, not vendor claims (build plan 4.1). The
   NHCI control figure quoted in the plan is 39% among 23,117 patients under care. **V** (Project HOPE abstract, as cited in `docs/design/S61-S65-build-plan.md`).
5. **Price sanity.** The Lagos figure above is a check on the price of a membership year for a hypertensive patient. It is not a price proposal.

## What this note does not do

It does not change the step table, any threshold, any price or any guard. It does not claim the draft is wrong: only that three points above (single-pill
combinations, starting step, stockable alternatives) are where it may differ from the national protocol and need the primary documents.

## Next step (owner: CMO)

Read the primary HEARTS and Nigeria protocol documents, then decide points 1 to 3. If single-pill combinations are accepted, the engineering change is a
proposal format that carries a combination product; that is a separate, small, test-first piece of work.
