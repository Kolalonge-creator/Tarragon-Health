# Doctor summary PDF (spec 2.9, second slice)

Invariants in play: INV-03/04 (released and non-sensitive only: this summary has no results section, so nothing to release), INV-07 (the audit event carries choices, never values), INV-10 (a read of the record leaves an audit row), INV-16 (period and caps in versioned config). No migration, no AI.

## 1. What S43 already shipped (read first)
`GET /api/patient/health-passport/pdf?variant=doctor` (`lib/health-passport/doctor-summary.ts`, `doctor-summary-document.tsx`): one A4 page, black on white, every line tagged with who stands behind it. It covers blood group and genotype, emergency contact, allergies, current medicines (name, dose, frequency, signed or patient-added), ongoing conditions (from care plans), the LATEST reading of each vital type (one line each, no series, no average, no chart), released non-sensitive lab results (latest per analyte), vaccinations, procedures and family history. No section choice, no period, no adherence, no skipped doses, no symptom journal, no schedule, no audit row.

Also existing and untouched: the "report for your visit" (`/api/patient/visit-report/pdf`, statistics over 7/30/90 days, no chart, wearable readings counted in its own source tally) and the adherence report (`/api/patient/medicine-report/pdf`, weekly rows).

## 2. What this adds
One PDF the patient builds by ticking sections (`/patient/doctor-summary`, a plain form that POSTs to `/api/patient/doctor-summary/pdf`):
- blood pressure readings with an average (home cuff, typed and confirmed-photo only; wearable, imported and unknown sources are listed, labelled, and kept out of the average and the chart);
- a blood pressure chart (systolic: solid line, round marker; diastolic: dashed line, square marker; named in words; no band, no colour);
- current medicines with their schedule in words (`describeSchedule`, reads the spec, changes nothing);
- weekly adherence over the chosen period, from `loadAdherenceReport` (the same `buildAdherenceReport` / `computeWeeklyAdherence` the app and the care team's chart use; a new optional `weeksOverride` argument, the period rounded up to whole completed Lagos weeks; no new formula, and no overall percentage is invented);
- skipped doses with the patient's reasons;
- symptom journal entries (from `patient_symptom_journal`);
- allergies and ongoing conditions (from the same facts S43 reads).

Period 30, 60 or 90 days (`record.doctor_summary_pdf`, PROPOSED, owner CMO, with the row caps and the reading sources that may enter the average).

## 3. Rules and where each is enforced
- **Own record only.** The route has no patient id. It reads through the caller's own session (RLS) keyed on `auth.uid()`, requires role `patient`, and the page is not offered while acting for someone else. A caregiver or supporter therefore cannot build one, so the category-scoped caregiver rules are not in play.
- **Category scoping.** No section reads a reproductive-health or mental-health table, and none can be ticked (test: the section list names none, the loader never queries such a table). Symptom entries of reproductive types are left out whole. The limit (free text, a contraceptive in the medicines list) is OQ-679 / OQ-S43-4.
- **Audit.** One `audit_log` row per generation (`patient.doctor_summary_generated`, sections and period only), written before anything is read; if the row cannot be written, nothing is read and the answer is 503. Direct insert under the existing `audit_log_insert` policy (actor must be the caller). `private.audit_patient_read` is for staff reads of someone else's record and is not callable by a patient.
- **Fail loud.** Any ticked section that cannot be read fails the whole summary (503, no PDF), never a page that quietly lacks the section.
- **Labels.** Every line carries its source (typed by the patient, home cuff, photo confirmed, wearable estimate, from a signed prescription, added by the patient, from the care plan). No clinician name, no "reviewed by", no grade, no target. Footer: "Patient-generated summary, not a clinical document" plus the S43 limits wording. Date generated and period are in the header.
- **No GET.** A POST from a form, so a link preview or prefetch never generates one or writes an audit row.

## 4. Not built (decisions needed)
Offline build on the phone: OQ-678. Explicit opt-in for reproductive or mental health content: OQ-679.

## 5. Verification
Jest beside each file (model, loader with a recording fake client, document tree, route, and a real render in a child process under tsx that reads the PDF back). Sabotage: adding `wearable` to `averageSources` flips 8 tests; emptying the reproductive symptom list flips 4. The real render was also read as text with `pdftotext` and viewed as page images.
