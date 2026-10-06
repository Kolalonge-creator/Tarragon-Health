# S27 Lab Result Flow: Competitor and Guidance Research

Research date: 2026-10-06. Method: web search plus fetches of public pages. Every point is tagged
**[observed]** (a source says it) or **[inferred]** (our reading or extrapolation). Several sources were
blocked or thin (see "Evidence gaps"); where a competitor's policy could not be confirmed it is said so
rather than guessed. Nothing here is legal advice.

## (a) Summary

The strongest consistent pattern across home-testing and lab competitors is a split in release policy:
routine results are shown directly, while positive STI/HIV or critical results are held until a clinician
or nurse has made contact (Everlywell holds positive STD and Lyme results until contact or three failed
attempts; LetsGetChecked calls positives; Healthtracka offers a free doctor consult on positives).
Tarragon's design (auto-release only when all-normal and complete, hold everything else, personal
clinician disclosure for HIV/HBsAg/HCV) is at the cautious end and is consistent with WHO's 5Cs for HIV and
with how the closest commercial peers handle STDs. The US counter-evidence (Cures Act immediate release; a
large survey where about 95% of patients, including those with abnormal results, wanted immediate release)
does not transfer cleanly: it is a statutory right in a setting where the portal is the patient's existing
record and a clinician follows up, and the evidence is survey-based, not randomised. For Nigeria the
decisive points are privacy (NDPA 2023 treats health data as sensitive; shared phones; notification text),
connectivity, and the fact that doctor time is paid. The biggest gaps to close are: a patient-visible
"waiting for review" state with an honest time expectation, amended/corrected-result handling that
supersedes rather than overwrites and notifies, a documented fallback when disclosure cannot be completed,
and patient display built around range bars, plain language and low-data use. Several partner-portal
features (delta checks, bulk upload, HL7/FHIR) are mostly not needed for a one-lab first release.

## (b) Comparison table

Evidence quality: H = primary source/policy page, M = third-party review or secondary, L = thin or
unverified. "n/c" = could not confirm.

| Service | Release policy | Sensitive-result handling | Partner entry | Patient display | Sources |
|---|---|---|---|---|---|
| Function Health (US) | Results appear as they arrive over days; a clinician reviews the full set and adds a written summary in 1-2 weeks (M) | n/c (not an STI-focused product) | n/c | Biomarker dashboard with clinician summary (M) | [FAQ](https://www.functionhealth.com/faqs/how-long-does-it-take-to-get-my-results), [review](https://dannb.org/blog/2025/function-health/) |
| Everlywell (US) | Independent physician network reviews, then releases; critical values trigger a phone call; for STD and Lyme, positives held until direct contact or 3 failed attempts (M) | Hold-until-contacted for positives (M) | Partner labs (H, page 404 on fetch) | Online dashboard (M) | [review](https://www.medicalnewstoday.com/articles/everlywell-review), [science](https://www.everlywell.com/science/) |
| LetsGetChecked (US/UK/IE) | Online account in about 2-5 days from lab receipt (M); registered nurse calls on abnormal or positive results (M) | Plain-envelope kits, nurse call for positives (M) | n/c | Account portal (M) | [HIV test page](https://www.letsgetchecked.co.uk/home-hiv-test/), [testing.com](https://www.testing.com/tests/at-home-hiv-test/) |
| Healthtracka (NG) | Portal or email results in about 24-72 h (M, own blog) | Claims confidentiality; free doctor consultation on every positive (M, marketing copy) | n/c | Portal and emailed PDF (M) | [blog](https://blog.healthtracka.com/private-sti-tests-for-nigerians/), [STI page](https://healthtracka.com/sti) |
| Synlab Nigeria | PathProvider online portal for patient access, graphic view, print, notification preferences (M) | n/c | n/c | Archive, graphic view, print (M) | [site](https://www.synlab.com.ng/path-provider/) |
| Cerba Lancet Nigeria | Mobile app and Path Portal; portal is "Doctors Only" per one listing (L) | n/c | n/c | n/c | [Cerba Lancet Nigeria](https://cerbalancetafrica.com/our-network/nigeria/) |
| Epic MyChart (US hospitals) | Immediate release by default under Cures Act; some systems let a patient choose to see results only after clinician review; withholding only under harm/privacy exceptions with approval (M) | Exceptions process, not default | n/a | Result trends, plain-language notes (M) | [Fred Hutch](https://www.fredhutch.org/content/dam/www/clinical-pdf/mychart/IT-1225-00286-test-results-open-notes-and-the-cures-act.pdf), [Yale FAQ](https://hipaa.yale.edu/sites/default/files/files/21st%20Century%20Cures%20FAQ.pdf) |
| Practo (IN) | Patient shares reports into a chat consult (H via forum pages) | n/c | n/c | Upload-and-ask doctor model | [Practo consult pages](https://www.practo.com/consult/uploading-reports-how-can-i-send-upload-my-lab-reports-to-my-consultant-doctor-paid-br-how-can-i-send-upload-my-lab/q) |
| Eka Care (IN) | Personal record app: patient uploads, system parses into dated trends (M) | n/c | Parsing API for lab reports (H) | Trend view across reports (M) | [Eka dev docs](https://developer.eka.care/api-reference/general-tools/medical/lab-report/introduction), [Eka patients](https://www.eka.care/s/for-patients) |
| Clafiya (NG) | n/c; offers rapid tests, STD testing, home pickup, doctor consults (L) | n/c | n/c | n/c | [Techpoint](https://techpoint.africa/insight/9-affordable-telemedicine-startups-nigeria/) |
| Helium Health (NG) | n/c: no public detail found on its lab module | n/c | n/c | n/c | none usable |
| Ada / Healthily | Symptom assessment; Ada publishes a "how to read blood tests" explainer; no result-release workflow found (L) | n/c | n/a | Educational content | [Ada](https://ada.com/blood-test-results/) |

## (c) Findings per question

### Q1. Release policy

- Observed: Everlywell's model is clinician review before release, a phone call for critical values, and a
  hold on positive STD and Lyme results until direct contact or three failed attempts.
  [Medical News Today](https://www.medicalnewstoday.com/articles/everlywell-review). This is the closest
  commercial precedent for Tarragon's "never auto-release a positive" rule and for a bounded fallback.
- Observed: LetsGetChecked uses nurse calls for positive or abnormal results, same day when the patient
  opted in. [testing.com](https://www.testing.com/tests/at-home-hiv-test/). Inferred: contact is by phone
  by a nurse, so the paid-clinician-time economics differ from Tarragon's paid-doctor-time model.
- Observed: Function Health releases individual results as they arrive and follows with a clinician summary
  1-2 weeks later (secondary sources only; the official FAQ page did not render usable detail).
  [FAQ](https://www.functionhealth.com/faqs/how-long-does-it-take-to-get-my-results). Inferred: a
  "results first, interpretation later" model fits wellness panels, not diagnostic HIV/hepatitis tests.
- Observed: US Cures Act rule gives patients immediate electronic access, with narrow exceptions for
  harm and privacy; hospitals using MyChart often offer a patient setting to choose "as soon as possible"
  or "after my care team sees them".
  [Fred Hutch](https://www.fredhutch.org/content/dam/www/clinical-pdf/mychart/IT-1225-00286-test-results-open-notes-and-the-cures-act.pdf).
  Inferred: the Cures Act does not bind Tarragon (Nigerian operation, NDPA applies), but it is the
  reference point patients and journalists will use.
- Observed: in a survey of about 8,100 patients, roughly 95-96% preferred immediate release even for
  abnormal results; only about 8% were more worried after viewing results (17% when they saw a result as
  abnormal vs 5% otherwise). [JAMA Netw Open](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2802672),
  [ONC blog](https://healthit.gov/blog/information-blocking/new-study-shows-patients-prefer-immediate-access-to-test-results-and-have-unmet-information-needs/).
  About 57% sought extra information afterwards, mostly by internet search. Caveats [inferred]: 18%
  response rate, portal users only, US setting.
- Observed: a narrative review notes there are no randomised or controlled comparisons of delayed versus
  immediate release on anxiety or workload.
  [Ovid review](https://www.ovid.com/jnls/apm/fulltext/10.21037/apm-2026-1-0023~the-release-of-clinical-information-under-the-21st-century).
  Inferred: do not claim "evidence shows holding abnormal results is better"; the justification is
  safety and context, not proven anxiety reduction.
- Observed: Nigerian labs (Synlab PathProvider) already give patients direct portal access with
  notification when ready. [Synlab](https://www.synlab.com.ng/path-provider/). Inferred: Tarragon
  patients may compare us against a lab that shows results immediately, so the "held for review" state
  must explain itself.
- Evidence gap: no public release policy found for Cerba Lancet Nigeria, Medicare/Afriglobal, Helium
  Health, Clafiya, Practo or Healthily.

### Q2. Sensitive results (HIV, hepatitis, STIs, pregnancy, cancer markers)

- Observed: WHO's HIV testing guidance is built on the 5Cs: consent, confidentiality, counselling, correct
  results, connection to care. [WHO IRIS](https://iris.who.int/handle/10665/179870). Verbal consent is
  sufficient; written is not required.
  Inferred: Tarragon's recorded method-and-attestation disclosure maps to "counselling" and "connection";
  a pre-test consent capture at order time maps to "consent".
- Observed: WHO says a reactive self-test is not a diagnosis and must be followed by confirmatory testing
  under a validated national algorithm.
  [WHO HIVST guidance](https://www.ncbi.nlm.nih.gov/books/NBK401675/). Inferred: a partner lab's single
  reactive screening value entered as HIV "positive" may be only preliminary; the portal should capture
  whether the result is screening or confirmed, and the patient copy must say "needs confirming" until it
  is.
- Observed: the ethics literature on eHealth delivery of STI/HIV results lists unintended disclosure when
  someone else holds the phone, and SMS or email that is delayed, filtered or sent to wrong contact
  details. [Ethical Implications of eHealth Tools (PMC8057984)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8057984/)
  (read via search summary; the full text blocked the fetch). Inferred: supports "notifications never
  name the result" and a "who may see this device" check.
- Observed: Australian-style practice is in-person disclosure where possible with phone or video at the
  diagnosing clinician's discretion (via secondary source).
  [PMC10257370](https://pmc.ncbi.nlm.nih.gov/articles/PMC10257370/). Inferred: disclosure methods should
  be a clinician-chosen, recorded method; no method is forbidden by WHO, but none should be the default
  for a first positive.
- Observed: Nigeria's HIV and AIDS (Anti-Discrimination) Act 2014 gives people living with HIV a right to
  confidentiality and prohibits disclosure without consent; the Act is summarised in NACA's popular
  version. [NACA](https://naca.gov.ng/wp-content/uploads/2016/11/Updated-Popular-Version-of-Nigerias-HIV-and-AIDS-Anti-Discrimination-Act-27-10-15.pdf).
  Inferred: an employer or insurer receiving an HIV-bearing report from Tarragon would be a serious
  exposure; keep HIV results out of any sponsor, voucher or family-circle view.
- Observed: NDPA 2023 s.30 treats health data as sensitive personal data and permits processing on
  consent or for medical care under a professional owing a duty of confidentiality.
  [Legal500 summary](https://www.legal500.com/intelligence/nigeria/privacy/the-nigeria's-data-protection-act-2023-a-look-at-key-provisions),
  [Act PDF](https://cert.gov.ng/ngcert/resources/Nigeria_Data_Protection_Act_2023.pdf).
  Breach notice to NDPC within 72 hours and to affected people where high risk.
  [PrivacyNeedle](https://privacyneedle.com/compliance/legislation/the-72-hour-rule-what-ndpa-and-gdpr-say-about-data-breaches/).
  Inferred: a notification that names a condition, or a result sent to a wrong number, is a reportable
  incident. Counsel should confirm; no NDPC guidance specifically on SMS wording was found.
- Observed: Healthtracka advertises confidential results and a free doctor consult for positives
  ([blog](https://blog.healthtracka.com/private-sti-tests-for-nigerians/)); this is marketing copy, not a
  published protocol. Inferred: the market expectation is "positive means a doctor reaches you".
- Not found in public sources: Nigerian national guideline text on whether results may be delivered
  remotely (the NACA protocol PDF could not be read through the fetch tool). Open item for the CMO.
- Pregnancy and cancer markers: no authoritative source on delivery rules was retrieved. Inferred: treat
  as "held and clinician-released by default" because both can be unwanted or unsafe in shared-phone or
  coercive settings (consistent with the platform's existing reproductive-health access rules).

### Q3. Partner portal UX

- Observed: standard LIS feature set is a test catalogue with units, reference ranges and turnaround
  targets; autoverification using critical-value, range, delta and QC rules; HL7/ASTM instrument
  interfaces. [SCNSoft overview](https://www.scnsoft.com/healthcare/laboratory-information-system),
  [Genemod](https://genemod.net/lis-software).
- Observed: autoverification studies report large drops in error rate (about 0.04-0.05% residual in the
  cited studies) and faster turnaround, but delta checks lower pass rates in frequently tested patients.
  [BMC Med Inform Decis Mak](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6609390/),
  [ResearchGate summary](https://www.researchgate.net/publication/284197370_Autoverification_in_a_Laboratory_Information_System).
  Inferred: Tarragon already does the cheap, high-value part of this server-side (fixed ranges, DB
  classification); delta checks need patient history that a one-lab first release barely has.
- Observed: CLIA/CAP practice for corrected reports: label the report as corrected, show the corrected
  value, send to everyone who got the original, keep original and corrected copies.
  [CAP](https://documents-cloud.cap.org/appsuite/learning/AP3/LMD/GoodLabDecisions/04_FrmtRsltRprts/story_content/external_files/Report%20Elements%20Part%202_2019_Proof.pdf),
  [42 CFR 493.1105](https://www.law.cornell.edu/cfr/text/42/493.1105).
- Observed: HL7 FHIR defines report statuses amended, corrected, appended and entered-in-error, with a
  reason recommended. [FHIR R4 codes](https://hl7.org/fhir/R4/codesystem-diagnostic-report-status.html),
  [HL7 Europe lab IG](https://build.fhir.org/ig/hl7-eu/laboratory/en/status-mgmt.html).
  Inferred: adopt these four as the vocabulary for our own status column now; real FHIR export can wait.
- Evidence gap: no public documentation found for Helium Health's lab module, Synlab/Lancet partner
  portals, or Everlywell/LetsGetChecked lab integration screens.
- Inferred, reduce errors in a first release: (1) pick-lists, not free text, for analyte and unit;
  (2) hard validation of unit against the fixed Tarragon unit; (3) plausibility limits (physiologically
  impossible value blocks entry); (4) a two-step "review then submit" screen showing value against range;
  (5) a required reason code on any amendment; (6) rejected-sample reason and one-click recollection request.
- Inferred, over-engineered for one lab now: delta checks, HL7/FHIR inbound, bulk CSV/instrument upload,
  multi-lab range overrides, per-analyte QC rules. PDF attachment is cheap and useful as the lab's own
  record of truth but must not be the source of classification.

### Q4. Patient result display

- Observed: studies of portal interface design find horizontal colour bars showing the value against the
  range beat plain tables for usefulness and reduce perceived urgency of borderline values.
  [Springer, BMC MIDM 2018](https://link.springer.com/article/10.1186/s12911-018-0589-7),
  [PMC6078112](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6078112/). A systematic review covers
  presentation formats and their effect on perception and action.
  [JMIR review (ScienceDirect)](https://www.sciencedirect.com/org/science/article/pii/S1438887124004710).
- Observed: low health literacy is a real barrier: terms like "positive" are read as good; plain-language
  guidance says put the key message first, chunk, avoid jargon.
  [JALM "When positive is negative"](https://academic.oup.com/jalm/article/8/6/1133/7263945),
  [PMC5114169](https://pmc.ncbi.nlm.nih.gov/articles/PMC5114169/).
  Inferred: never display the bare word "positive" or "negative" for screening tests without a sentence
  saying what it means.
- Observed: Synlab offers graphic view, archive and print; Eka Care turns uploaded reports into dated
  trends. [Synlab](https://www.synlab.com.ng/path-provider/), [Eka](https://www.eka.care/s/for-patients).
- Observed: a Nigerian maternal mHealth study translated content into Pidgin and Hausa and found audio
  messages a low-cost way to deliver standard counselling, on about USD 60 Android phones.
  [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0123940).
  Older HCI work found text-only interfaces failed for low-literacy users while graphical and spoken
  interfaces succeeded. [ACM](https://dl.acm.org/doi/10.1145/1959022.1959024).
- Inferred, Nigeria patterns that matter: server-rendered, small first load (no heavy charts library);
  a text-first fallback beside every chart for screen readers and slow data; 48 px touch targets;
  download-once PDF/image for offline viewing; audio explanations only for results the clinician has
  released and never for the sensitive set (this matches the existing rule); Pidgin and large-type
  options as a later phase after clinical review of the wording.
- Inferred: "what this means" text must come from clinician-approved templates per analyte and
  direction, not free AI generation, given the AI governance rule.

### Q5. Corrections and amendments

- Observed: lab accreditation practice is to mark the report as corrected, show the changed result, notify
  the clinician and all prior recipients promptly, and keep both versions.
  [CAP](https://documents-cloud.cap.org/appsuite/learning/AP3/LMD/GoodLabDecisions/04_FrmtRsltRprts/story_content/external_files/Report%20Elements%20Part%202_2019_Proof.pdf).
- Observed: FHIR separates amended (content changed), corrected (error fixed), appended (content added) and
  entered-in-error (withdrawn, though decisions may already have been made).
  [FHIR R4](https://hl7.org/fhir/R4/codesystem-diagnostic-report-status.html).
- Observed: no consumer competitor publishes a patient-facing corrections policy that I could find
  (Everlywell, LetsGetChecked, Function, Healthtracka all silent in retrieved pages). Evidence gap.
- Inferred: a correction that changes a classification (normal to abnormal, or the reverse) must re-enter
  the review gate, re-notify with neutral text, and mark the earlier version "superseded" in history
  rather than deleting it. A withdrawn result should show "this result was withdrawn, your care team will
  explain" without exposing the old value by default.
- Inferred: if a result was already acted on (booking, prescription, voucher), flag downstream records.

### Q6. Failure modes and incidents

- Observed: Quest's MyQuest app had unauthorised access exposing lab results and contact details of about
  34,000 people in 2016; a separate 2019 breach via a collections vendor affected 11.9 million, lab
  results not included. [Healthcare IT News](https://www.healthcareitnews.com/news/cyberattack-quest-diagnostics-breaches-34000-patient-records),
  [Fierce Healthcare](https://www.fiercehealthcare.com/tech/quest-diagnostics-breach-may-have-exposed-data-11-9m-patients).
  Lesson [inferred]: patient-facing result portals are attacked; vendor and partner access scope matters.
- Observed: LifeLabs (Canada) regulators found it failed to take reasonable steps and collected more data
  than necessary, after a 2019 hack affecting a portal used by millions.
  [The Record](https://therecord.media/canadian-privacy-regulators-publish-life-labs-investigation).
  Lesson [inferred]: data minimisation and staffing of security are regulatory findings, not just
  technical ones.
- Observed: a Labcorp website bug exposed lab test data and other documents.
  [HIPAA Journal](https://www.hipaajournal.com/website-error-exposed-personal-and-health-data-of-labcorp-patients/).
  Lesson [inferred]: IDOR-style flaws on document URLs are the typical result-release failure; test
  every result and PDF endpoint for access by a different patient.
- Observed: SMS or email with sensitive STI/HIV outcomes may be delayed, filtered, or read by someone else
  holding the phone. [PMC8057984](https://pmc.ncbi.nlm.nih.gov/articles/PMC8057984/).
- Evidence gap: I did not find a published, verifiable wrong-patient or premature-release incident from the
  named competitors, and I found no regulator action about notification text specifically. Do not cite
  incident precedent for those two beyond the generic privacy-breach cases above.

### Evidence gaps (important)

Official Everlywell partner-labs page returned 404; NCBI/PMC full texts blocked by CAPTCHA (used search
summaries); NACA HIV testing protocol PDF unreadable via the fetch tool; Healthtracka blog fetch failed
with an expired certificate; Function Health FAQ page rendered without detail. Nothing was found for
Helium Health's lab module, Clafiya's result delivery, Cerba Lancet or Medicare/Afriglobal release
policies, or Healthily.

## (d) Recommended design changes to S27

Effort is relative to what is already built (classification, auto-release, hold, clinician release,
critical senior review, sensitive disclosure, upload hold, neutral notifications).

1. **Bounded fallback for sensitive-result disclosure.**
   - Change: define and show the clinician what happens after N failed contact attempts (for example 3
     over a stated window): escalate to the CMO, keep result held, send only a neutral "please contact
     your care team" message, never release the value by default. Log each attempt.
   - Evidence: Everlywell holds positives until contact or 3 failed attempts (observed, secondary).
     Note their fallback can release; ours should not for HIV/HBsAg/HCV, because WHO 5Cs requires
     counselling and linkage with the result.
   - Risk: patients become unreachable and a result sits; a clinical and legal decision for the CMO.
   - Effort: small (a counter, a status, a queue view).

2. **"Waiting for review" state with honest expectation.**
   - Change: patient sees "your result is being checked by a doctor" with an expected time and a contact
     route, without hinting at the result; show the review SLA from `escalation_slas`, not a hard-coded
     number.
   - Evidence: patients value timeliness (95% prefer immediate; unmet information needs, 57% seeking
     extra info) [observed]; Synlab shows instantly [observed]. Silence invites worry [inferred].
   - Risk: a visible "held" state itself leaks that something is unusual (a hold implies abnormal).
     Mitigate with identical wording for every result still in the pipeline (including normal results
     awaiting the lab PDF) and accept the weak inference. Decision for CMO.
   - Effort: small.

3. **Corrections as first-class, versioned, re-gated.**
   - Change: status vocabulary corrected / amended / appended / withdrawn; a correction re-runs
     classification and returns to the review gate if the class changes; patient sees "updated result"
     with a neutral notification and history; reason code mandatory; downstream records flagged.
   - Evidence: CAP/CLIA practice and FHIR statuses [observed]; no competitor policy published
     [observed gap].
   - Risk: an updated value reaching a patient who already acted; double-notification confusion.
   - Effort: medium (versioning exists for posted results? to be checked against schema).

4. **Screening vs confirmed flag for HIV/HBsAg/HCV.**
   - Change: partner portal asks "screening/reactive" vs "confirmed"; patient and clinician copy never
     says "you have HIV" from a single screen; confirmatory test order is a required next action in the
     disclosure record.
   - Evidence: WHO says a reactive screen needs confirmation by algorithm [observed].
   - Risk: lab may not know which stage its assay is; need the lab's SOP.
   - Effort: small to medium.

5. **Patient result card: range bar plus plain-language line plus text fallback.**
   - Change: horizontal range bar, one-sentence clinician-approved meaning per analyte and direction,
     "ask your care team" action, download as PDF/image; no heavy chart library; no bare "positive".
   - Evidence: range bars outperform tables and reduce urgency of borderline values; plain language
     guidance [observed]; low-data context [inferred].
   - Risk: wording errors; needs CMO sign-off on templates (no AI-generated meaning).
   - Effort: medium.

6. **Notification hardening checklist.**
   - Change: fixed neutral templates (no analyte, no lab name for sensitive tests, no "results of your
     test" for STI panel orders), no lock-screen preview of detail, wrong-number recovery (confirm phone
     ownership before first result, a "not me" link that quarantines the notification), rate-limit.
   - Evidence: shared-phone and misdirected-message risk [observed]; LetsGetChecked uses plain
     packaging for discretion [observed]; NDPA breach duties [observed].
   - Risk: low. Over-neutral text can reduce open rate.
   - Effort: small.

7. **Partner portal input guard rails (not delta checks).**
   - Change: pick-list analytes, locked units, plausibility limits, review-then-submit, rejected-sample
     reason with recollection request, PDF attach optional, required amendment reason.
   - Evidence: autoverification and LIS rules reduce errors [observed]; delta checks add complexity
     [observed]; one lab [given].
   - Risk: plausibility limits too tight block real extreme values; allow override with reason.
   - Effort: small.

8. **Turnaround-time tracking on the lab queue.**
   - Change: expected vs actual turnaround per order, with an overdue flag to the care team.
   - Evidence: LIS catalogues carry TAT targets [observed]; Healthtracka quotes 24-72 h [observed].
   - Risk: low.
   - Effort: small.

9. **Test of access control on every result and PDF endpoint.**
   - Change: a standing test that a second patient cannot fetch another's result or PDF by guessing IDs,
     signed short-lived PDF URLs.
   - Evidence: Labcorp web bug and Quest portal breach [observed].
   - Risk: low. Effort: small (test plus config).

## (e) Things we should NOT copy

- Immediate release of abnormal or sensitive results by default (Cures Act model): it assumes a mature
  care system and a clinician follow-up that patients can reach for free; ours is paid doctor time and
  shared-phone settings. Optional "show me when ready" for all-normal results only is fine [inferred].
- Automatic release after failed contact attempts for HIV, HBsAg or HCV (Everlywell-style fallback):
  conflicts with the no-auto-release rule and WHO counselling and linkage.
- Results by SMS or WhatsApp text (WhatsApp is also removed from the platform): misdirection and shared
  phone risk [observed in the literature].
- Marketing claims such as "100% confidential" (Healthtracka copy): do not repeat absolutes.
- Instant AI "interpretation" of results (Ada-style explainer, various AI result readers): violates the
  platform AI-governance rule and the sensitive-result rule.
- Wellness-panel pattern of releasing individual results as they arrive then adding a summary weeks later
  (Function): wrong for diagnostic tests.
- Doctor-only portals (Lancet listing) as patient access model: contradicts patient access goals.
- Delta checks, HL7/FHIR inbound, bulk upload, multi-lab rule engines in the first release.

## (f) Open questions for the founder or CMO

1. What is the contact-attempt limit and window for a held sensitive result, and who owns the escalation
   if the patient is unreachable?
2. May the first disclosure of HIV/HBsAg/HCV be by phone or video, or must it be in person? (Nigerian
   national protocol text could not be retrieved; please confirm from FMoH/NASCP or a Nigerian lawyer.)
3. Does the partner lab report screening and confirmed results distinctly, and does Tarragon accept
   preliminary reactive screens as an entry?
4. Should hepatitis B surface antibody, pregnancy tests and cancer markers join the never-auto-release
   set? Which STIs beyond HIV/HBsAg/HCV (syphilis, etc.)?
5. Should an all-normal result auto-release immediately at any hour, or after a short buffer (for
   example a night-time hold) so late-night notifications do not surprise people?
6. What review time can we promise for held results given the paid doctor model, and what does an unpaid
   patient see for an abnormal result (is review part of the test price)?
7. Who approves the plain-language "what this means" templates and Pidgin/audio wording, and when?
8. Does counsel agree that a misdirected neutral notification is not a reportable breach, and what is
   the process if a result itself reaches the wrong person (NDPC 72 hours)?
9. How long must original and superseded result versions be retained, given Nigerian record rules and
   NDPA retention duties?
