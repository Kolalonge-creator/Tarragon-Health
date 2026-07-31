# Data Protection Impact Assessment — AI-Drafted Case Briefs (Anthropic Claude)

*Draft for legal review — not yet approved by counsel or a Data Protection Officer. Prepared because a founder decision on 30 July 2026 moved this specific processing from disposable test fixtures to real patient data, which is exactly the kind of change a DPIA should precede, not follow. See `docs/legal/cover-memo-to-counsel.md`, Question 3.*

**Date:** 31 July 2026
**Scope:** `case_briefs` and the code that populates it (`lib/case-briefs/snapshot.ts`, `lib/case-briefs/generate.ts`) — a doctor-facing summarisation feature built as part of a broader doctor-efficiency initiative on `apps/web`.

## 1. Description of the processing

### What the feature does
When a doctor claims an escalation, or a clinician acknowledges a clinical alert, the platform assembles a small, structured snapshot of that one patient's record — active care plans, latest risk scores, the last five vitals readings, and the last five escalations for the same patient — and sends it to Anthropic's Claude API (model: Claude Haiku 4.5) to draft a plain-language summary and a suggested next step. The result is stored, labelled "AI-drafted — not yet reviewed," and shown above the real clinical data on the doctor's or clinician's screen. It is never shown as, or treated as, a diagnosis, a decision, or a substitute for the doctor's own review.

### What is deliberately excluded from the snapshot
The patient's free-text clinical notes are never sent — only structured, already-categorised fields (care-plan condition, a risk-score number, a vitals reading value and type, an escalation's alert level and date). This narrows the transfer considerably compared to sending the full chart.

### What is never done with the output
The AI output never writes to a clinical record, never closes a case, never adjusts a medication, and never appears without the "AI-drafted — not yet reviewed" label. A doctor's own `reviewed_by`/`reviewed_at` attribution remains the only thing that establishes clinical review occurred, exactly as for every other clinical action on the platform (`docs/CLINICAL_TRUST_MODEL_SPEC.md` §2, §9; `CLAUDE.md`'s "What Claude Must Never Do" list).

## 2. Necessity and proportionality

The stated purpose is genuine efficiency: helping a doctor orient quickly on a case they are about to review, particularly under the growing patient-to-doctor ratio pressure the founder has been actively trying to manage well (see `CLAUDE.md`'s doctor-efficiency initiative). The narrowed, structured-fields-only snapshot (never free-text notes, never the full chart) is a real minimisation choice, not an incidental one — it was a deliberate design decision recorded at build time.

Whether this narrower transfer is *sufficiently* minimised to be proportionate under the Nigeria Data Protection Act, given that it is still sensitive health data leaving Nigeria to a second processor, is the central question this DPIA cannot answer on its own and needs counsel's view on.

## 3. Who is affected, and by how much

Every patient whose case is claimed or acknowledged by a doctor or clinician is affected — this is not an opt-in feature at the point of use (the patient consents to "automated processing" generally under Schedule A, but the AI-specific disclosure is new and not yet as prominent as the general automated-processing paragraph). As of the founder's 30 July 2026 decision, this runs on real patients, not only test fixtures, so the actual number affected grows with every claimed escalation and acknowledged alert going forward.

## 4. International transfer

This is a second, distinct cross-border transfer from the Supabase/eu-west-1 transfer already disclosed and assessed in `docs/legal/dpia-health-data-processing.md`. Anthropic's infrastructure is not in Nigeria. **No data-processing agreement with Anthropic is confirmed to be in place**, and no DPIA-level assessment of Anthropic's own security and data-handling posture (retention of API inputs, sub-processors, training-data usage) has been completed as part of this document — that is squarely a legal/vendor-diligence task, not something this session verified.

## 5. Risks, and current mitigations

| Risk | Mitigation already in place | Residual gap |
|---|---|---|
| Full clinical notes or other unminimised free text leak to a third-party AI vendor | Structural — the snapshot builder only ever selects specific, already-categorised fields; free-text notes are not part of the query at all | None known in the current code, but this is a design property that must be actively preserved on every future change to the snapshot builder, not something enforced by a database constraint |
| The AI output is mistaken for a real clinical decision or diagnosis | The card is always headed "AI-drafted — not yet reviewed" and is never styled like the platform's real `ReviewedByDoctor` attribution component | Relies on UI convention, not a structural guarantee — a future change could accidentally blur this line |
| A doctor relies on a hallucinated or ungrounded summary without checking the underlying data | The system prompt requires every sentence be grounded in the data actually sent, and the real vitals/notes/alert detail are always shown alongside the card, never replaced by it | No measurement yet of how often a doctor actually cross-checks versus trusts the summary at face value — a real-world usage question, not a code one |
| A failed or malformed AI call silently blocks a doctor's worklist | The generator never throws; any failure persists a `status='failed'` row and the UI degrades to showing no brief, matching the same fail-open discipline as the rest of this codebase's external-service integrations | None known |
| No confirmed lawful basis or DPA for the Anthropic transfer specifically | None yet | Real, currently open gap — see cover memo Question 3 |

## 6. Consultation

Not yet reviewed by a DPO or outside counsel. The founder's decision to proceed with real patient data was made with the founder's own understanding of the safety design (AI drafts, never decides), not as a substitute for this DPIA or a formal legal sign-off.

## 7. Conclusion

The technical minimisation (structured fields only, never free text; fail-open on any error; always labelled and never a substitute for real review) is a genuine, deliberately-designed mitigation, not an afterthought. The processing should not be treated as fully assessed until a data-processing agreement with Anthropic is confirmed and counsel has given a view on whether the current disclosure in Schedule A is sufficient or needs a dedicated clause of its own.
