# S85 to S87: CMO decision and sign-off pack (DRAFT, UNSIGNED)

Date: 2026-10-07. Status of every item: **selected by the founder in chat, not yet signed.** Signing is a separate step, done by the CMO through the existing sign-off route after the draft config rows exist. An agent never signs.

Verification note: guideline statements marked VERIFY were not opened by the author. The CMO checks them against the source text before signing.

## D1. Blood pressure at or above 180/120 (selected: ask the symptom question from 180/120)

**Rule to sign (new draft version of `bp_care_triage`, v1 and v2 stay as they are):**
- Reading of 180/120 or higher (either number): ask the emergency-symptom question. No skip, back disabled (existing S11d screen).
- Any listed emergency symptom ticked, including "severe or new headache": **RED**. Offline emergency guidance with nearest facility, on-call page, consented Care Circle alert, follow-up consultation task.
- No symptom: **AMBER**. Clinician contact the same day. Recheck after 2 hours (existing S11e/S11f reminder and backup push). If the recheck is still 180/120 or higher, or never done, the existing amber same-day task rule applies.
- Pregnancy and postpartum: existing pregnancy thresholds are unchanged by this item.
- Deterministic only. No model in the path (INV-01).

**Fields the CMO must still decide (not assumed):** whether "severe or new headache" is one symptom or two; whether 180/110 should be the trigger instead (ISH grade 3); the recheck window (2 hours today).

**Grounding.**
- ACC/AHA 2017: above 180/120 with new or worsening target organ damage is a hypertensive emergency. Without it, severe hypertension managed by same-day or outpatient review, no proven benefit from rapid lowering. Checked in secondary summaries.
- NICE NG136: 180/120 or higher with life-threatening symptoms (new confusion, chest pain, signs of heart failure, acute kidney injury) or retinal haemorrhage or papilloedema: same-day specialist assessment. Otherwise investigate target organ damage as soon as possible and repeat within 7 days. Checked in secondary summaries.
- ESC/ESH 2023 and ISH grade 3 (180/110 or higher): VERIFY.
- Nigeria: FMoHSW National Guideline for the Prevention and Management of Hypertension in Nigeria (2023), and the Nigerian Hypertension Society Guidelines (2020), both include hypertensive emergency. Thresholds and wording: VERIFY.
- Note: neither NICE nor ACC/AHA treats a headache alone as organ damage. RED here is a deliberately cautious, remote-care rule, not a guideline quotation. The CMO should say so in the rationale.

**Journey test consequence:** journey 2 (190/120 with a headache) asserts RED once this version is approved. It reads the approved rule set, never a hard-coded grade.

## D2. Fertile window (selected: hide by default, opt-in conception-planning mode)

**Wording to sign (exact):**
- Label on every screen that shows the window: "Not contraception. This cannot prevent pregnancy."
- Link text under it: "Learn about contraception and talk to your care team."
- Mode switch name: "Planning a pregnancy". Off by default. Turning it on shows the window and the label.
- Banned in the app and marketing (scan test): "safe days", "avoid pregnancy", "natural contraception", "fertile window prediction" without the label.

**Grounding.** Spec C.1 (cycle-based contraception needs NAFDAC approval and local evidence). Typical-use failure of fertility-awareness methods is materially higher than other methods (WHO and Johns Hopkins Family Planning Handbook): VERIFY the figures. National family planning and reproductive health policy: name and edition VERIFY. Data class: `reproductive_health`, NDPA 2023 sensitive; break-glass excluded.

## D3. SMS rule (selected: one named exception). Needs the founder as well as the CMO.

**Rule:**
- SMS stays only for (1) phone verification codes, (2) clinician paging, (3) a content-free alert to the patient's own consented emergency contact when the patient triggers an emergency.
- Text to sign (exact): "Tarragon: please call {name} now." No condition, no result, no reading.
- Removed: the push-failure SMS fallback, the dependent-claim SMS (OQ-48), the SMS broadcast channel, the SMS rung for routine critical results (OQ-92). Replaced by push, email, in-app and a clinician phone call.
- Precondition: live SMS must be shown to deliver (sender ID, DND route, OQ-46) before the emergency-contact exception is relied on. Until then the contact is also sent push and email.
- Record the exception in D-12 and OQ-05. The `escalation_slas` ladder change is CMO-signed.

**Grounding.** Spec C.2 and D-12 (this reverses part of a founder decision). NDPA 2023 data minimisation. NCC rules for sender IDs and DND routes via a licensed aggregator: VERIFY.

## D4. Languages (selected: dormant framework, no language ships)

**Standard to sign (review gate for any future language):**
1. Forward translation by a qualified translator.
2. Independent back translation.
3. Reconciliation of differences.
4. Native-speaker clinical review.
5. CMO signature on each string set, versioned and dated, with a named owner (spec D.4).
6. Enable per feature only after all five, through signed configuration.

D-14 stays in force: English only, nothing ships. Spec D.8 is marked superseded. Near-term access route: language-matched clinician booking (S64), no translated clinical text.

**Grounding.** ISPOR Principles of Good Practice for Translation and Cultural Adaptation; ISO 17100: VERIFY. Spec D.4. MDCN requirement that a clinician is responsible for clinical advice: VERIFY.

## How signing will happen

1. The build sessions create the draft rows (D1 rule set version, D2 wording in `clinical-wording.json` as `proposed`, D3 ladder and template change, D4 registry config).
2. The CMO reads the final text in chat and signs through the existing route (`record_proposed_config_signoff` and the sign RPCs, JWT-simulation pattern). The agent runs the call only on the CMO's explicit "sign" instruction naming the item.
3. Each signature is logged in `docs/DECISIONS.md` with date, version and the guideline checks done.
