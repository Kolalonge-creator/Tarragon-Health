# Narrative urgent-finding rules: draft for CMO signature (CDE-01)

**Status: DECIDED by the CMO in chat on 2026-11-04 (CDE-09), awaiting confirmation on the sign-off hub; not live.** Decisions: every row below kept as drafted (HPV 16 or 18 kept urgent); QTc 500 ms or more; a match pages on the escalation ladder, ECG and radiology rows at the critical tier, mammography, cervical, HPV and pathology rows at the non-critical abnormal tier.

**Original status: DRAFT. Not signed, not live.** Proposed configuration `documents.narrative_urgent_rules` v1 (`packages/shared/src/proposed-config/registry.ts`), matcher `apps/web/src/lib/clinical-documents/narrative-rules.ts`. Nothing reads these rules to escalate until the CMO signs them (OQ-CDE-11). Until then every narrative report (imaging, mammography, ECG, histopathology, cytology, cervical screening, letters) is routine doctor review, and a doctor escalates by hand.

## What the rules do and do not do

- They read fields **as printed** on a report (a BI-RADS category, a diagnosis line, a cytology category, an ECG statement or QTc, a radiology impression). They never interpret an image or a tracing.
- A match **raises the doctor review to urgent**. It never lowers anything. A report matching no rule is routine review, never "normal".
- A negated mention does not match: a negation in the same clause at most three words before the term ("no evidence of malignancy"), or straight after it ("pulmonary embolism excluded"). The window is deliberately narrow, so that "not benign; carcinoma present" still matches. The rules err toward urgent.

## The rules and their sources

| Area | Raises to urgent | Source the CMO should check against |
|---|---|---|
| Mammography | BI-RADS **0** (incomplete, needs further imaging), **4, 4A, 4B, 4C, 5** (suspicious, needs tissue diagnosis), **6** (known malignancy), any breast | ACR BI-RADS Atlas, 5th edition; NICE NG12 (suspected cancer: recognition and referral), breast section |
| Cervical cytology | HSIL; ASC-H; atypical glandular cells (AGC); squamous cell carcinoma; adenocarcinoma; any mention of invasion | The Bethesda System for Reporting Cervical Cytology (2014); NHS Cervical Screening Programme colposcopy and programme management standards (high-grade referrals seen within 2 weeks) |
| HPV | HPV 16 or 18 detected | ASCCP 2019 risk-based management consensus guidelines; NHS CSP HPV primary screening protocol |
| Histopathology / cytology | carcinoma (incl. in situ), adenocarcinoma, malignant / malignancy, sarcoma, lymphoma, melanoma, leukaemia, metastatic / metastasis, high-grade dysplasia | NICE NG12; Royal College of Pathologists cancer datasets and guidance on communicating critical results |
| ECG (machine or clinician statement as printed) | ventricular tachycardia; ventricular fibrillation; complete (third-degree) heart block; Mobitz II / second-degree AV block type II; ST elevation, STEMI, acute myocardial infarction; **QTc 500 ms or more** | ESC 2022 guidelines on ventricular arrhythmias and the prevention of sudden cardiac death; ESC 2023 acute coronary syndromes guidelines; ESC 2021 pacing guidelines; AHA/ACCF scientific statement on QT prolongation |
| Radiology impression | pneumothorax; pulmonary embolism; aortic dissection; pneumoperitoneum / free air; intracranial haemorrhage; spinal cord compression; ectopic pregnancy; bowel obstruction; "suspicious for" or "highly suggestive of" malignancy | Royal College of Radiologists, *Standards for the communication of radiological reports and fail-safe alert notification*; NICE NG12; the NICE guideline on spinal metastases and metastatic spinal cord compression (2023) |

Where Nigerian national guidance differs (for example the Federal Ministry of Health national cancer control and cervical cancer screening guidelines), the founder rule is that the Nigerian guideline wins. The CMO should check each row against it before signing.

## What the CMO is asked to decide (OQ-CDE-11)

1. Each row: keep, change or remove.
2. The QTc threshold (500 ms is the commonly used high-risk cut-off).
3. Whether a match should page on the escalation ladder (`escalation_slas`, critical or non-critical abnormal tier) or only move the report to the top of the review queue.

Signing makes these values the live configuration. The wiring that applies them (to AI-016 impressions and to fields a doctor files) is built after signature, using the tested matcher above.
