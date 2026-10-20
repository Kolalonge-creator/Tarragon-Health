# IPS research: International Patient Summary export

Evidence caveat: public standards pages and the existing S44 research only; nothing here was validated against a live validator or a national registry. Re-verify before any claim leaves the building.

## What the IPS is (ISO 27269, HL7 International Patient Summary)
- A minimal, specialty-agnostic summary: a FHIR document Bundle whose Composition (LOINC 60591-5) carries sections for problems, allergies and intolerances, medicines (required), and immunizations, results, vital signs and others (optional). Apple Health, Epic and the European patient summary programme all produce or consume this shape.
- Competitors: Epic and other large EHRs offer IPS or "patient summary" export; consumer apps (Apple Health Records, Eka Care) export their own formats or a PDF. Many produce a PDF a clinic cannot read into a system.
- Unsafe or unsuitable for Nigeria: a required-section rule tempts a producer to write "no known allergies" when it only means "none recorded with us"; that is a patient-safety claim we cannot make. Free-text local drug names and local lab codes travel as text, never as a guessed code. Nigeria's National Digital Health Architecture is built around a health information exchange and the IPS is being balloted for national adoption in 2026, while the Nigeria Core FHIR IG is still a draft (version 0.0.0), so claiming a profile or conformance now would be false.
- Decision: produce an IPS-shaped document (structure only), labelled in the UI as not validated and not approved for any national system; write required empty sections as `unavailable`; keep the section codes and document type in versioned config; claim no profile URL; reuse the existing snapshot so every access, consent and exclusion rule stays in one place (the database).

## The person's view
- A plain-language "what is inside" page matters more than the file: most people cannot read FHIR. The preview shows the document's own narrative lines so what is shown is what is sent, and it prints as a paper copy for facilities that cannot read the file.
- Decision: a download button and a preview link on the existing exchange page, with the list of what is left out written next to the button, not behind a link.
