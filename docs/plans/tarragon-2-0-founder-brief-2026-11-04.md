# Tarragon Health 2.0 — founder brief (verbatim)

> Pasted by the founder on 2026-11-04. Kept word for word as the source document. Do not edit; decisions taken on it go in `docs/DECISIONS.md`, conflicts in `docs/OPEN-QUESTIONS.md`, and the discovery report in `docs/plans/tarragon-2-0-discovery-2026-11-04.md`.

---

The strategic change is significant. Tarragon Health is moving from a platform that facilitates access to laboratory testing towards an AI-enabled preventative and longitudinal healthcare management platform.

The technology should become the competitive advantage. Tarragon should not simply receive PDF laboratory results and store them. It should be able to understand them, extract clinical information, validate the findings, compare them against clinically approved reference ranges, identify abnormalities, monitor changes over time, trigger clinical escalation and coordinate appropriate follow-up.

I would approach this as a major product evolution, not just a change to the membership pricing or removal of Plus.

Below is a comprehensive product and technical implementation brief that you can give directly to Claude. It is designed to make Claude understand the business strategy, existing functionality, new architecture, clinical safety requirements and implementation priorities.
Tarragon Health: Product Transformation and Technical Implementation Blueprint
Proposed product direction
Tarragon Health 2.0
AI-powered preventative healthcare, diagnostic intelligence and longitudinal patient management.
₦100,000
Annual individual membership

2
Membership options, Free and Membership

100%
Laboratory-independent testing model

AI + Doctor
Automated intelligence with clinical oversight



Core principle: Tarragon owns the patient's health intelligence and care journey, not the laboratory infrastructure.

TARRAGON HEALTH 2.0
Product Transformation, AI Diagnostic Intelligence and Technical Implementation Specification
Document purpose: Master product and engineering brief for implementation using Claude.

Product: Tarragon Health
Primary market: Nigeria
Primary objective: Build a scalable, AI-powered preventative and longitudinal healthcare management platform.

1. EXECUTIVE SUMMARY
Tarragon Health is transitioning to a laboratory-independent preventative healthcare model.

Previously, the platform relied more heavily on laboratory partnerships, testing arrangements and membership entitlements linked to specific tests.

The new model separates laboratory testing from the healthcare intelligence and management services provided by Tarragon.

Patients will be able to undertake recommended investigations at any reputable laboratory in Nigeria. They can receive their results directly from the laboratory and upload the resulting PDF, photograph or other supported document to Tarragon.

Tarragon will use an AI-powered diagnostic document processing system to:
1. Identify and extract laboratory results from uploaded documents.
2. Recognise individual investigations, values, units and laboratory reference intervals.
3. Validate extracted information and identify potential extraction errors.
4. Map extracted investigations to Tarragon's standardised clinical test catalogue.
5. Interpret results against clinically approved, test-specific reference ranges and decision thresholds.
6. Identify abnormal or clinically significant findings.
7. Automatically initiate the appropriate clinical alert workflow.
8. Store results in a structured longitudinal patient health record.
9. Generate trends and identify changes in patient health over time.
10. Support doctors in reviewing results and determining appropriate next steps.
The doctor remains responsible for clinical interpretation and management decisions.

Tarragon must become the patient's central preventative healthcare management platform, irrespective of where they undertake their laboratory investigations.
1.1 Strategic objectives
- Remove Tarragon's dependency on laboratory testing costs.
- Eliminate the need to operate as a laboratory.
- Remove Plus membership.
- Retain Free and Membership tiers.
- Introduce one annual Membership priced at ₦100,000.
- Allow members to use any qualifying laboratory.
- Develop an advanced AI laboratory document extraction and clinical intelligence engine.
- Establish personalised preventative investigation plans.
- Introduce doctor-led result review and monthly check-ins.
- Build longitudinal health monitoring.
- Establish a reliable nationwide laboratory directory.
- Develop an employer-sponsored preventative health programme.
- Build technology capable of scaling across Nigeria and eventually other African markets.
2. PRODUCT AND MEMBERSHIP CHANGES
2.1 Membership structure
Retire the Plus membership completely.

The platform should have only two membership categories:
Free
Retain the existing free functionality, subject to the existing product entitlements.
Membership
Annual individual membership: ₦100,000.

Membership provides:
- Personalised preventative health plan.
- Baseline health assessment.
- Annual and scheduled investigation recommendations.
- Downloadable laboratory request forms.
- Laboratory discovery and directory access.
- Uploading of laboratory reports.
- AI-powered laboratory result extraction.
- Structured longitudinal health records.
- Automated abnormal-result detection.
- Doctor review of submitted results within the published service-level agreement.
- Plain-English result explanations.
- Clinical follow-up where indicated.
- Monthly doctor check-in.
- BP and other available health parameter tracking.
- Medication monitoring and follow-up.
- Test reminders and overdue investigation follow-up.
- Annual comprehensive health review.
- Care Circle functionality with patient consent.
The membership fee must not be linked to the number of tests performed or the laboratory chosen.

Laboratory payments are made directly by the patient to the laboratory.
2.2 Remove Plus functionality
Audit the entire application and remove or retire:
- Plus subscription and upgrade options.
- Plus-specific entitlements.
- Plus payment logic.
- Plus-specific testing days.
- Plus-specific individual testing benefits.
- Existing marketing copy describing Plus.
- The old 17-test membership entitlement.
- Any logic that restricts investigations based on the previous membership model.
Do not delete historical subscription records or payment transactions.

Preserve historical data for accounting, audit and reporting purposes.

Update all relevant backend permissions, frontend components, API responses, payment logic and administrative interfaces.
2.3 Membership pricing
New annual membership price: ₦100,000.

Existing ₦84,000 pricing should be replaced for new purchases.

Review existing subscriptions before changing renewal logic. Existing members must not experience unexpected charges or entitlement changes without an appropriate migration and communication process.
3. THE MOST IMPORTANT TECHNOLOGY: AI LABORATORY RESULT INTELLIGENCE ENGINE
This is the most important technical development in Tarragon Health 2.0.

The system must be capable of receiving laboratory reports from different Nigerian laboratories, understanding their different formats and converting the information into a consistent, structured patient health record.

This must work even when the laboratory has no direct API integration with Tarragon.
3.1 Supported document formats
The system should accept:
- PDF laboratory reports.
- Photographs of laboratory reports.
- JPG and JPEG.
- PNG.
- Scanned documents.
- Multi-page PDF reports.
- Multiple laboratory reports uploaded together.
Design the architecture so additional document formats can be supported later.
3.2 AI document processing architecture
Develop a dedicated Laboratory Intelligence Engine.

The processing pipeline should follow these stages:
Stage 1: Document ingestion
When a patient uploads a laboratory report:
1. Confirm the patient identity and document ownership.
2. Check supported file type and size.
3. Scan the uploaded document for malware.
4. Generate a unique document ID.
5. Store the original document securely.
6. Record upload date, patient ID and document metadata.
7. Create a processing job.
8. Display processing status to the patient.
Possible statuses:
- Uploaded.
- Queued.
- Processing.
- Awaiting verification.
- Successfully processed.
- Failed.
- Requires manual review.
The original document must always be retained as the source of truth.
Stage 2: Document recognition and OCR
Use a hybrid OCR architecture.

Evaluate:
- Google Document AI.
- AWS Textract.
- Azure AI Document Intelligence.
- Open-source OCR alternatives such as PaddleOCR.
- Vision-capable AI models for difficult or unusual documents.
Do not assume one OCR provider will perform best on all Nigerian laboratory report formats.

The system should recognise:
- Laboratory name.
- Branch/location.
- Patient name.
- Patient date of birth, where available.
- Report date.
- Sample collection date.
- Investigation name.
- Result value.
- Measurement unit.
- Laboratory reference interval.
- High/low indicators.
- Qualitative results.
- Positive/negative findings.
- Specimen type.
- Comments and laboratory observations.
It must support tables, multiple columns, different layouts and multi-page reports.
Stage 3: Structured result extraction
Convert the OCR output into a standardised JSON structure.

Each extracted result must contain:
- Original investigation name.
- Standardised Tarragon test identifier.
- Extracted value.
- Original unit.
- Standardised unit, where safely convertible.
- Laboratory reference interval.
- Laboratory-reported abnormal flag.
- Date of test.
- Source laboratory.
- Source document ID.
- Extraction confidence.
- Validation status.
- Processing model/version.
- Verification status.
Illustrative structure:
{
  "patient_id": "PATIENT_ID",
  "document_id": "DOCUMENT_ID",
  "laboratory": "Laboratory name",
  "report_date": "2026-11-01",
  "results": [
    {
      "original_test_name": "HbA1c",
      "standard_test_code": "HBA1C",
      "value": 7.8,
      "unit": "%",
      "laboratory_reference_range": "4.0-5.6",
      "tarragon_interpretation": "Requires clinical review",
      "extraction_confidence": 0.98,
      "verification_status": "pending"
    }
  ]
}
This is illustrative, not a fixed schema. Engineering should design a versioned data model capable of accommodating different investigation types.
Stage 4: Standardisation and test mapping
Different laboratories may use different names for the same investigation.

For example:
- Glycated haemoglobin.
- HbA1c.
- Haemoglobin A1c.
These should map to one standard Tarragon investigation.

Create a central test catalogue containing:
- Standard test name.
- Synonyms.
- Standard identifier.
- LOINC mapping where appropriate.
- Clinical category.
- Accepted units.
- Conversion rules.
- Specimen type.
- Reference interval rules.
- Clinical decision thresholds.
- Relevant patient demographic requirements.
Use recognised terminology standards where practical, including LOINC and UCUM.

Never automatically convert incompatible units or map an uncertain investigation without flagging it for verification.
Stage 5: Clinical validation
This is a critical safety layer.

The system must distinguish between:
1. The reference interval printed by the laboratory.
2. Tarragon's clinically approved reference interval.
3. A clinically significant decision threshold.
4. A personalised patient-specific target, where appropriate.
Do not replace the laboratory's reference interval with a generic Tarragon range.

For example, an HbA1c result may be interpreted differently depending on whether the patient is being screened for diabetes or is already receiving diabetes treatment.

The clinical rules engine must consider:
- Age.
- Sex where clinically relevant.
- Pregnancy status where relevant.
- Known medical conditions.
- Medication history.
- Previous results.
- Clinical context.
- Investigation type.
- Units.
- Specimen and laboratory-specific information.
For results that require demographic context, do not produce a definitive interpretation when the necessary information is unavailable.

Store the original result and the laboratory's reference range alongside the Tarragon interpretation.
Stage 6: Extraction confidence and verification
Introduce confidence-based processing.

Suggested initial engineering thresholds:
- High confidence: at least 98%, subject to field-specific validation.
- Intermediate confidence: 90% to below 98%.
- Low confidence: below 90%.
These are initial engineering thresholds, not clinically validated safety thresholds. Calibrate them through testing against manually verified reports.

High-confidence extraction must still undergo deterministic validation.

Intermediate-confidence results should be queued for review.

Low-confidence results must not automatically become trusted clinical data.

Flag:
- Missing units.
- Ambiguous decimals.
- Incorrectly recognised characters.
- Unclear reference ranges.
- Duplicate investigations.
- Inconsistent patient details.
- Unrecognised tests.
- Impossible or implausible values.
- Conflicting values across pages.
Never silently correct an uncertain value.
Stage 7: Patient confirmation
The patient should be able to see the extracted results before they become confirmed entries in their longitudinal record.

For example:

Laboratory result detected
- HbA1c: 7.8%
- Total cholesterol: 5.9 mmol/L
- Creatinine: 95 µmol/L
Provide an option to confirm that the extracted information matches the uploaded report.

Where uncertainty exists, route the result to an administrator or clinician for verification.

Patient confirmation must not be treated as a substitute for clinical validation.
Stage 8: Clinical interpretation and alert generation
After validation, the results should pass through Tarragon's deterministic clinical rules engine.

The AI may assist with extracting information and preparing explanations, but clinical alerts must be generated from validated structured results and approved clinical rules, not from an unconstrained AI-generated interpretation.

The system must identify:
- Normal results.
- Abnormal results.
- Borderline results.
- Significantly abnormal results.
- Critical results.
- Results requiring urgent clinical assessment.
- Results requiring routine clinical follow-up.
The platform must generate the relevant alert automatically.
4. CLINICAL ALERT AND ESCALATION SYSTEM
The abnormal-result alert system is a non-negotiable core function.

Every successfully validated uploaded result must enter the same safety-netting process as any future structured result received through a laboratory integration.

There must not be separate clinical safety pathways for:
- Synlab results.
- Other partner laboratories.
- Non-partner laboratories.
- Patient-uploaded PDFs.
- Photographs of laboratory results.
- Manually entered results.
All result sources must converge on one central clinical rules and alert engine.
4.1 Alert classification
Establish a clinically governed alert framework.
Alert category	System response
Normal	Save result and update trends
Borderline	Add to monitoring and review where appropriate
Abnormal	Generate doctor review task
Significantly abnormal	Prioritised doctor alert
Critical	Immediate escalation according to approved protocol
Uncertain extraction	Hold for verificationThe clinical team must define the specific investigation thresholds and escalation requirements.
4.2 Doctor alert dashboard
Develop a dedicated clinical alert dashboard.

It should display:
- Patient name and ID.
- Investigation.
- Result.
- Unit.
- Laboratory reference interval.
- Tarragon clinical decision threshold.
- Date of test.
- Laboratory source.
- Original report.
- Previous results.
- Current trend.
- Alert severity.
- Time received.
- Time awaiting review.
- Assigned clinician.
- Clinical action.
- Review status.
Alert statuses:
- New.
- Assigned.
- Under review.
- Patient contacted.
- Action required.
- Escalated.
- Resolved.
- Closed.
Every alert must have an auditable history.
4.3 Critical safety requirements
A critical result must not wait for routine doctor review.

The platform must:
- Immediately flag the result.
- Trigger the approved escalation pathway.
- Notify the responsible clinical team.
- Record acknowledgement.
- Escalate unacknowledged alerts.
- Record contact attempts.
- Record clinical advice and disposition.
A patient must never be told that an uploaded report is safe merely because the AI did not detect an abnormality.

The patient-facing interface should clearly communicate that automated processing does not replace medical assessment.

Where a critical result is suspected but extraction is uncertain, the system must treat it as a potential safety issue and initiate human verification without delay.

Develop and test an operational out-of-hours escalation policy, including what happens when no clinician is immediately available.
4.4 Upload alert parity testing
Before deploying this feature, demonstrate that an abnormal result uploaded as a PDF or photograph produces the same clinical alert as the equivalent structured result.

This must be a formal release acceptance criterion.

Test:
- Normal results.
- Mildly abnormal results.
- Significantly abnormal results.
- Critical results.
- Multiple abnormalities in one report.
- Multi-page documents.
- Poor-quality photographs.
- Incorrect units.
- Missing reference ranges.
- Ambiguous OCR values.
- Duplicate uploads.
- Incorrect patient association.
5. LONGITUDINAL HEALTH RECORD AND TREND ANALYTICS
Tarragon must evolve beyond a document storage system.

Every verified investigation should become part of a structured, longitudinal patient health record.
5.1 Patient health dashboard
Develop a comprehensive health dashboard containing:
- Blood glucose.
- HbA1c.
- Lipid profile.
- Renal function.
- Liver function.
- Full blood count.
- Thyroid function where indicated.
- Blood pressure.
- Weight.
- BMI.
- Waist circumference.
- Other relevant investigations.
Display only relevant health categories and results for each patient.
5.2 Result trends
Allow patients and doctors to view changes over time.

Examples:
- HbA1c over 12 months.
- Creatinine and eGFR over time.
- Total cholesterol and LDL trends.
- Haemoglobin trends.
- Blood pressure trends.
- Weight and BMI changes.
Charts should include:
- Test date.
- Result value.
- Measurement unit.
- Reference interval or clinical target where appropriate.
- Previous measurements.
- Abnormal flags.
- Laboratory source.
Use line charts for longitudinal results.
5.3 AI trend detection
Introduce an additional intelligence layer that identifies:
- Progressive deterioration.
- Persistent abnormalities.
- Rapid changes.
- Emerging risk patterns.
- Repeated missed investigations.
- Potential medication-related changes.
- Improvements following clinical intervention.
For example:

A patient may have HbA1c results of:
- January: 6.1%.
- April: 6.7%.
- July: 7.3%.
- October: 8.0%.
The system should identify a worsening trajectory and generate a clinician review recommendation.

Do not rely exclusively on whether a result is outside the reference interval. A result can remain within range while showing a clinically meaningful change.

Trend alerts must be clinically governed and validated. The system should not independently diagnose disease or recommend medication changes.
6. PERSONAL PREVENTATIVE HEALTH PLAN
Every member should have an individualised preventative health plan.

The plan should be generated using approved clinical protocols and reviewed or authorised by a doctor.

The plan must not simply prescribe the same large panel of tests to every member.
6.1 Three levels of investigation planning
A. Baseline assessment
Conducted at membership enrolment.

Collect:
- Age.
- Sex.
- Family history.
- Medical history.
- Medication history.
- Smoking and alcohol history.
- Previous investigations.
- Weight.
- BMI.
- Waist circumference.
- Blood pressure.
- Relevant lifestyle factors.
- Previous diagnoses and risk factors.
Use the assessment to establish an appropriate baseline investigation plan.
B. Annual core investigations
Develop a practical, affordable core set of investigations that can be undertaken in most major Nigerian laboratories.

The initial clinical team should assess the following:
Investigation	Proposed role
Full blood count	Baseline haematological assessment
HbA1c	Diabetes screening where indicated
Lipid profile	Cardiovascular risk assessment
Creatinine/eGFR	Renal assessment
Liver function tests	Where clinically indicated
Urinalysis	Renal and urinary assessmentThese are proposed candidates, not a mandatory universal panel. The clinical team must determine which are suitable for routine baseline assessment and which require risk-based indications.
C. Risk-based investigations
Additional investigations should be selected based on patient age, sex, medical history, symptoms, risk factors and previous findings.

Examples include:
- Urine albumin-creatinine ratio.
- Thyroid function.
- Hepatitis B screening.
- HIV screening.
- PSA.
- Cervical cancer screening.
- Colorectal cancer screening.
- Other clinically indicated investigations.
Screening intervals must follow approved clinical guidance.

Do not recommend PSA, HIV, hepatitis screening, cervical screening or other investigations universally without considering eligibility, informed consent and relevant clinical guidance.
6.2 Test plan generation
Each patient should receive a clear investigation schedule.

Example:
Investigation	When	Status
HbA1c	Baseline	Due
Lipid profile	Baseline	Due
Renal function	Baseline	Due
Full blood count	Baseline	Due
Risk-based screening	As indicated	Pending reviewThe schedule should automatically adjust following clinical review.
6.3 Laboratory request forms
Generate downloadable laboratory request forms.

Each form should include:
- Tarragon Health branding.
- Patient name and ID.
- Date of birth where necessary.
- Investigation list.
- Clinical indication where appropriate.
- Request date.
- Requesting clinician details where authorised.
- Unique verification code.
- QR code for authenticity verification.
The patient should be able to:
- Download the request form.
- Print it.
- Present it at any suitable laboratory.
- Upload the resulting report afterwards.
The form should not imply that Tarragon has contracted the laboratory or that the laboratory is obliged to accept it.
6.4 Test reminders and overdue follow-up
Develop an automated reminder engine.

Example:
- Investigation due in 14 days.
- Investigation due in 7 days.
- Investigation due tomorrow.
- Investigation overdue by 7 days.
- Investigation overdue by 30 days.
Use WhatsApp, email, SMS or in-platform notifications depending on available integrations and patient consent.

Introduce coordinator follow-up for members who repeatedly miss clinically important investigations.

Allow patients and clinicians to defer or cancel an investigation with a recorded reason.
7. DOCTOR-LED CARE AND MONTHLY CHECK-INS
The new membership should sell responsiveness, continuity and clinical oversight rather than unlimited access to a doctor.
7.1 Doctor review of results
Every submitted result should be reviewed by a doctor within a clearly defined service-level agreement.

The doctor should be able to:
- View the original laboratory report.
- Review extracted results.
- Correct extraction errors.
- Review previous results.
- View trends.
- Confirm clinical interpretation.
- Provide a plain-English explanation.
- Record next steps.
- Generate follow-up recommendations.
- Escalate significant findings.
Define separate turnaround times for routine and urgent results.

Do not advertise a turnaround time until staffing and operational capacity have been established.
7.2 Monthly doctor check-in
Every member should receive one scheduled monthly check-in.

The check-in should assess:
- General wellbeing.
- Blood pressure, where available.
- Medication adherence.
- Lifestyle changes.
- Symptoms or concerns.
- Progress with investigations.
- Outstanding clinical recommendations.
The doctor should have access to the patient's longitudinal record before the consultation.
7.3 Proactive doctor contact
The platform should generate doctor tasks when:
- A significant abnormal result is detected.
- A critical result is identified.
- A clinically important trend deteriorates.
- A patient misses an important investigation.
- A medication-related follow-up is due.
- A patient reports a concerning symptom.
Clinical urgency should determine the response.

Do not create unnecessary doctor alerts for every minor administrative event.
7.4 Annual health review
Generate a consolidated annual health report containing:
- Patient profile.
- Previous medical history.
- Investigations undertaken.
- Results and trends.
- Blood pressure and weight trends.
- Identified risk factors.
- Medication review.
- Clinical interventions.
- Outstanding recommendations.
- Next year's preventative health plan.
The report should be doctor-reviewed before being presented as a clinical assessment.
8. LABORATORY DIRECTORY
Tarragon should build a nationwide laboratory directory.

The purpose is to allow patients to identify suitable laboratories based on location, test availability and accreditation.
8.1 Laboratory categories
There should be no distinction in patient-facing service functionality between contracted partner laboratories and other listed laboratories.

All laboratories should be discoverable through the same directory and patient workflow.

Partner status is an internal operational attribute.

The current partner relationship with Synlab provides an additional trust and operational relationship, but it should not determine how patients access the wider laboratory network.
8.2 Laboratory verification
Minimum eligibility:
- Evidence of registration with the Medical Laboratory Science Council of Nigeria (MLSCN), where applicable.
- Verifiable laboratory identity and location.
- Appropriate operating credentials.
- Contact details.
- Test menu information.
Additional quality indicators:
- ISO 15189 accreditation.
- Participation in external quality assessment schemes.
- Other recognised quality certifications.
Display accreditation transparently.

Do not imply that a laboratory has ISO 15189 accreditation simply because it has a quality management policy.
8.3 Laboratory information
Each laboratory listing should contain:
- Laboratory name.
- Branch name.
- State.
- LGA.
- Address.
- GPS location.
- Phone number.
- Website.
- Opening hours, where verified.
- Available investigations.
- Accreditation status.
- Accreditation scope.
- External quality assessment participation, where verified.
- Verification date.
- Verification status.
8.4 Search and discovery
The existing location picker and test-to-location search should be retained and enhanced.

Patients should be able to search by:
- State.
- LGA.
- Town.
- Nearby location.
- Investigation.
- Laboratory name.
- Accreditation.
- Quality indicators.
Allow users to filter results by distance, test availability and accreditation.

Do not create a misleading numerical laboratory quality ranking.

Do not display laboratory prices as fixed figures. Use:

"Contact the laboratory for current pricing."
8.5 Nationwide directory research
Build the initial directory across:
- Lagos.
- Abuja.
- Ogun.
- Oyo.
- Rivers.
- Enugu.
- Anambra.
- Delta.
- Edo.
- Kano.
- Kaduna.
- Akwa Ibom.
- Cross River.
- Other Nigerian states.
The longer-term objective is coverage of all 36 states and the FCT.

Research major chains, including:
- Synlab Nigeria.
- Cerba Lancet Nigeria.
- Afriglobal Medicare.
- Other established national and regional providers.
- Reputable independent laboratories.
Do not populate the directory with unverified laboratories.

Use a laboratory verification workflow and record the source of each accreditation and registration claim.
9. EMPLOYER PREVENTATIVE HEALTH PROGRAMME
Retire the current employer Plus-style membership.

Introduce a simplified employer-sponsored membership arrangement.
9.1 Employer pricing
Reference annual individual membership price: ₦100,000.

Proposed employer-sponsored price: ₦90,000 per person per year, representing a 10% discount.

The employer purchases memberships for individual employees.

Each employee receives the same Membership functionality.

Do not create a separate employer clinical membership tier.
9.2 On-site health screening
Employer on-site visits should be a separately scoped service.

Potential screening activities:
- Blood pressure.
- Weight.
- Height.
- BMI.
- Waist circumference.
- Capillary blood glucose.
- HIV rapid testing, subject to consent, qualified personnel and applicable protocols.
- Hepatitis B screening, subject to consent and appropriate clinical arrangements.
- Other suitable point-of-care screening.
Define the cost, staffing, equipment, consumables, confirmatory testing and referral requirements separately.

On-site testing must not be represented as automatically included in the ₦90,000 membership fee without an approved commercial costing model.

Employees should receive laboratory request forms for investigations that need to be completed at an external laboratory.

Employers must not automatically receive individual clinical results. Employee confidentiality and consent must be preserved.
10. CARE CIRCLE AND FAMILY SPONSORSHIP
Retain individual enrolment.

Do not introduce family membership plans at this stage.
10.1 Care Circle
Allow a patient to authorise relatives to receive selected health updates.

Features:
- Invitation by the member.
- Consent-based access.
- Permission controls.
- Revocable access.
- Audit trail.
- Selected health information sharing.
The patient remains the owner and controller of their personal care-sharing preferences, subject to applicable law.
10.2 Sponsorship
Allow one person to purchase an annual membership for another person.

Example:

A Nigerian living in the UK purchases a ₦100,000 annual membership for their parent in Lagos.

The sponsored patient receives the full individual membership.

The sponsor does not automatically receive access to the patient's medical records.

Build:
- Sponsor payment.
- Beneficiary invitation.
- Beneficiary registration.
- Membership activation.
- Renewal reminders.
- Consent-based Care Circle invitation.
This is a potentially important customer acquisition and revenue channel.
11. TECHNICAL ARCHITECTURE
The new features should be built as modular services within the existing Tarragon application.

Do not rebuild the entire platform unnecessarily.

First inspect the existing codebase, database, APIs, authentication, payment architecture and current integrations.

The architecture should support future growth without creating unnecessary microservice complexity at this stage.
11.1 Core modules
Develop or enhance the following modules:
1. Membership and Subscription Management.
2. Patient Health Profile.
3. Preventative Health Assessment.
4. Clinical Test Catalogue.
5. Personalised Test Plan Engine.
6. Laboratory Directory.
7. Laboratory Document Ingestion.
8. OCR and AI Extraction Engine.
9. Test Standardisation Engine.
10. Clinical Rules Engine.
11. Clinical Alert and Escalation Engine.
12. Longitudinal Health Record.
13. Trend Analytics Engine.
14. Doctor Review Dashboard.
15. Monthly Check-in Management.
16. Patient Communication and Reminders.
17. Care Circle.
18. Membership Sponsorship.
19. Employer Management.
20. On-site Screening Management.
21. Administrative and Clinical Governance Dashboard.
22. Audit and Compliance Management.
11.2 Suggested technology stack
Retain the existing technology where it is stable and suitable.

Suggested architecture:

Backend
- Python.
- Django.
- Django REST Framework.
- PostgreSQL.
Frontend
- Retain the existing frontend framework.
- Use React or Next.js if already established in the application.
Background processing
- Celery.
- Redis.
- Scheduled background tasks.
Document storage
- Secure object storage, such as AWS S3 or an equivalent.
- Encryption at rest.
- Short-lived signed access URLs.
AI and OCR
- OCR provider abstraction.
- Vision-capable AI model for document interpretation assistance.
- Deterministic validation and rules engine.
- Model and prompt version tracking.
Analytics
- PostgreSQL for structured clinical records.
- Suitable charting library for longitudinal trends.
- Reporting and operational dashboards.
Communication
- WhatsApp Business API.
- Email.
- SMS.
- In-app notifications.
Do not introduce an expensive technology dependency without demonstrating its value.
11.3 Processing architecture
Recommended workflow:

Patient uploads report
↓
Secure document ingestion
↓
Document classification
↓
OCR extraction
↓
AI-assisted result interpretation
↓
Structured data generation
↓
Test catalogue mapping
↓
Confidence and validation checks
↓
Patient/administrator verification where required
↓
Clinical rules engine
↓
Alert generation
↓
Doctor review
↓
Patient communication
↓
Longitudinal health record update
↓
Trend analytics and future test planning

All processing stages should be traceable.
12. DATABASE DESIGN
Claude should inspect the existing database before introducing new models.

The following are proposed logical entities, not instructions to create duplicate tables where equivalent models already exist.

Potential models:
- PatientHealthProfile.
- MedicalHistory.
- MedicationRecord.
- PreventativeAssessment.
- ClinicalTest.
- ClinicalTestSynonym.
- ClinicalTestPlan.
- ClinicalTestPlanItem.
- Laboratory.
- LaboratoryBranch.
- LaboratoryAccreditation.
- LaboratoryTestAvailability.
- LaboratoryDocument.
- LaboratoryProcessingJob.
- ExtractedLaboratoryResult.
- VerifiedLaboratoryResult.
- ClinicalReferenceRange.
- ClinicalDecisionRule.
- ClinicalAlert.
- ClinicalReview.
- HealthMeasurement.
- HealthTrend.
- DoctorCheckIn.
- PatientReminder.
- CareCircleInvitation.
- MembershipSponsorship.
- EmployerAccount.
- EmployerMembership.
- OnsiteScreeningEvent.
- OnsiteScreeningRecord.
- AuditLog.
Every result should retain a connection to its original document and patient.

Maintain a distinction between:
- Raw extracted data.
- Corrected data.
- Clinically verified data.
- Clinically interpreted data.
Never overwrite the original extracted information without retaining the audit history.
13. CLINICAL GOVERNANCE AND DATA SECURITY
Tarragon is handling sensitive medical information. Clinical governance and data protection must be embedded into the architecture.
13.1 Clinical governance
Establish a Clinical Medical Officer-approved framework covering:
- Investigation selection.
- Screening eligibility.
- Reference intervals.
- Decision thresholds.
- Critical-result definitions.
- Alert priorities.
- Clinical escalation.
- Doctor review standards.
- Patient communication.
- Follow-up pathways.
Clinical rules must have:
- Version numbers.
- Approval dates.
- Responsible clinician.
- Evidence source.
- Effective dates.
- Review dates.
Clinical rule changes must not silently reinterpret historical results.
13.2 Data protection
Implement:
- Role-based access control.
- Encryption in transit and at rest.
- Secure document storage.
- Access logging.
- Consent management.
- Data retention policies.
- Patient data export.
- Appropriate deletion and correction workflows.
- Secure backups.
- Disaster recovery.
- Administrative access restrictions.
Ensure compliance with the Nigeria Data Protection Act and applicable requirements.

Any AI provider processing identifiable patient information must undergo appropriate privacy, contractual and security assessment.

Do not send patient documents to an external AI service without an approved data-processing arrangement and suitable safeguards.
13.3 AI governance
The AI must not:
- Invent missing laboratory values.
- Infer an unreadable result without flagging uncertainty.
- Replace the original laboratory reference interval.
- Make autonomous treatment decisions.
- Prescribe medication.
- Independently close critical alerts.
- Tell patients that a result is normal when extraction is uncertain.
- Generate unapproved screening recommendations.
Maintain an audit trail of:
- AI model.
- Model version.
- Prompt version.
- Extraction output.
- Confidence scores.
- Corrections.
- Human verification.
- Final clinical interpretation.
14. IMPLEMENTATION ROADMAP
Implementation should be phased, with the clinical safety infrastructure prioritised.
Phase 0: Existing system audit and technical discovery
Before changing code:
- Map the current architecture.
- Review existing patient and provider models.
- Review membership and payment logic.
- Review existing Synlab workflows.
- Identify existing structured-result processing.
- Identify existing abnormal-result alerts.
- Review current test catalogue.
- Review existing location and laboratory directory.
- Review existing notifications.
- Identify existing dashboard functionality.
Produce an architecture assessment and identify reusable components.

Deliverable: Technical discovery report and migration plan.
Phase 1: Clinical safety and upload alert parity
Highest priority.

Build the complete PDF and photograph upload-to-alert workflow.

Tasks:
- Secure uploads.
- OCR extraction.
- Standardised result schema.
- Test catalogue mapping.
- Confidence scoring.
- Validation.
- Verification workflow.
- Clinical rules integration.
- Doctor alert dashboard.
- Escalation and audit trail.
Acceptance criterion:

A validated abnormal result from an uploaded PDF must generate the same appropriate clinical alert as an equivalent structured result.

Do not proceed to general production rollout without successful end-to-end safety testing.
Phase 2: Longitudinal health record
Build:
- Structured result history.
- Health parameter dashboard.
- Trend charts.
- Historical comparison.
- Deterioration detection.
- Doctor trend review.
Acceptance criterion:

A doctor can view a patient's previous and current results, identify changes and understand the source of each measurement.
Phase 3: Preventative health plan engine
Build:
- Baseline assessment.
- Clinical test catalogue.
- Doctor-approved investigation rules.
- Personalised test plan.
- Downloadable request forms.
- Due dates.
- Reminders.
- Overdue coordinator tasks.
Acceptance criterion:

A newly enrolled member can receive a personalised, doctor-approved test plan and complete investigations at an external laboratory.
Phase 4: Membership and pricing transformation
Build:
- Removal of Plus from active customer journeys.
- Membership price update to ₦100,000.
- Updated payment logic.
- Updated entitlements.
- Renewal management.
- Existing subscription migration.
- Updated website and marketing content.
Acceptance criterion:

A new patient can purchase the correct membership, receive the appropriate entitlements and access all membership services.
Phase 5: Doctor and patient experience
Build:
- Doctor review dashboard.
- Result explanation workflow.
- Monthly check-in scheduling.
- Doctor follow-up tasks.
- Annual health report.
- Patient notifications.
Acceptance criterion:

The doctor can manage the patient's preventative care journey through a single clinical dashboard.
Phase 6: Laboratory directory
Build:
- Laboratory and branch database.
- MLSCN verification fields.
- Accreditation records.
- Test availability.
- Geographical search.
- Filters.
- Verification workflow.
- Directory administration.
Acceptance criterion:

A patient can find a suitable laboratory based on their location and required investigation.
Phase 7: Care Circle and sponsorship
Build:
- Individual sponsorship.
- Beneficiary activation.
- Consent-based access.
- Care Circle permissions.
- Renewal and payment management.
Phase 8: Employer programme
Build:
- Employer accounts.
- Sponsored memberships.
- Employee invitations.
- Discounted annual pricing.
- On-site screening event management.
- Individual health records.
- Confidential employer reporting.
15. TESTING AND QUALITY ASSURANCE
Before release, create a dedicated testing environment.
AI extraction test dataset
Build a diverse, anonymised dataset of laboratory reports from Nigerian laboratories.

Include:
- Different laboratory brands.
- Different report layouts.
- PDF exports.
- Scanned reports.
- Photographs.
- Poor lighting.
- Low-resolution documents.
- Handwritten additions.
- Multiple investigations.
- Multi-page reports.
- Different measurement units.
Clinicians should manually verify the ground truth for the test dataset.

Measure:
- Test identification accuracy.
- Numerical value extraction accuracy.
- Unit extraction accuracy.
- Reference interval extraction accuracy.
- Patient association accuracy.
- Abnormality detection sensitivity.
- Critical-result detection sensitivity.
- False-negative rate.
- False-positive rate.
Prioritise avoiding false negatives for clinically significant and critical findings.

A high average OCR accuracy is not sufficient if clinically important values are being missed.
End-to-end testing
Test the entire journey:
1. Patient purchases membership.
2. Patient completes baseline assessment.
3. System generates a test plan.
4. Patient downloads a laboratory request form.
5. Patient attends an external laboratory.
6. Laboratory issues a PDF report.
7. Patient uploads the report.
8. AI extracts the results.
9. System validates the results.
10. Abnormal result generates an alert.
11. Doctor receives the alert.
12. Doctor reviews and documents action.
13. Patient receives an appropriate communication.
14. Result is added to the longitudinal health record.
15. Trend chart updates.
16. Future investigation plan adjusts where clinically appropriate.
16. PRODUCT PERFORMANCE INDICATORS
Build a management dashboard to measure the effectiveness of the new model.

Commercial KPIs:
- Number of active members.
- Annual membership revenue.
- Membership conversion rate.
- Renewal rate.
- Customer acquisition cost.
- Revenue per member.
- Sponsored memberships.
- Employer memberships.
Clinical KPIs:
- Percentage of members completing baseline investigations.
- Percentage completing scheduled investigations.
- Percentage of uploaded results successfully processed.
- Extraction accuracy.
- Percentage of results requiring manual verification.
- Abnormal-result detection sensitivity.
- Critical-result detection sensitivity.
- Time from upload to processing.
- Time from abnormal result to doctor acknowledgement.
- Time from alert to patient contact.
- Percentage of members receiving monthly check-ins.
- Percentage of overdue investigations followed up.
Operational KPIs:
- OCR processing cost per report.
- AI processing cost per report.
- Average doctor review time.
- Number of pending clinical alerts.
- Unacknowledged critical alerts.
- Laboratory directory verification coverage.
- System uptime.
17. FUTURE INNOVATION AND DIFFERENTIATION
After the foundational platform is safe and operational, introduce more advanced capabilities.
17.1 Tarragon Health Intelligence
Develop a longitudinal AI health assistant that can answer clinically relevant questions using the patient's verified health record.

Examples:
- How has my HbA1c changed over the last year?
- Which investigations are overdue?
- What did my doctor recommend after my last review?
- Has my kidney function changed?
- What should I prepare for my next appointment?
The assistant must retrieve verified clinical information and cite the relevant measurements and dates within its responses.

It should distinguish between documented facts, clinical interpretations and unanswered questions.
17.2 Predictive health risk monitoring
Develop validated risk models for relevant conditions, such as:
- Diabetes risk.
- Cardiovascular risk.
- Chronic kidney disease risk.
- Hypertension control.
- Other locally relevant chronic disease risks.
Use validated clinical models where appropriate.

Do not market unvalidated machine-learning predictions as clinical diagnoses.
17.3 Intelligent investigation scheduling
Use patient demographics, history, previous results and clinical guidelines to determine when an investigation is due.

The system should avoid:
- Unnecessary repeated testing.
- Duplicated investigations.
- Tests that are not clinically indicated.
- Tests that are inaccessible in the patient's location.
17.4 Laboratory interoperability
Although the model should work without laboratory APIs, develop an integration-ready architecture.

In the future, laboratories may provide:
- Direct result transmission.
- FHIR-based integrations.
- HL7 interfaces.
- Secure result portals.
- Laboratory information system integrations.
All sources must feed the same result validation and clinical alert engine.
17.5 Population health intelligence
With appropriate legal basis, consent and de-identification safeguards, build aggregate insights into:
- Prevalence of abnormal screening results.
- Geographic health trends.
- Investigation completion rates.
- Chronic disease risk patterns.
- Preventative healthcare engagement.
This could eventually support employer health programmes, public health partnerships and population health research.

18. INSTRUCTIONS TO CLAUDE: HOW TO EXECUTE THIS PROJECT
You are acting as the lead software architect, senior full-stack engineer, AI systems engineer and technical product manager for Tarragon Health.

Your task is to transform the existing Tarragon Health application into Tarragon Health 2.0 using the specification in this document.

Do not assume the existing application has no relevant functionality. First inspect the complete existing codebase.
Rules for implementation
1. Do not rebuild working features unnecessarily.
2. Do not introduce duplicate database models or APIs.
3. Do not remove existing patient records, payment records or clinical history.
4. Do not make destructive database migrations.
5. Maintain backward compatibility where necessary.
6. Keep the application functional throughout development.
7. Use modular, maintainable and documented code.
8. Implement proper authentication and role-based permissions.
9. Ensure all patient information is protected.
10. Build automated tests alongside the implementation.
11. Do not use AI-generated clinical interpretations as a substitute for deterministic clinical rules.
12. Do not deploy unvalidated clinical rules to production.
13. Do not silently alter existing patient entitlements.
14. Do not change production pricing until the migration and commercial decisions are approved.
Step 1: Conduct a complete codebase audit
Inspect:
- Project structure.
- Django models.
- Database relationships.
- Views and API endpoints.
- Serializers.
- Authentication.
- Membership and subscription logic.
- Payment integrations.
- Laboratory models.
- Synlab functionality.
- Result processing.
- Clinical alerts.
- Notifications.
- Admin dashboard.
- Patient dashboard.
- Doctor dashboard.
- Existing AI integrations.
- Existing test catalogue.
Produce a report identifying:
- What already exists.
- What can be reused.
- What requires modification.
- What is missing.
- What should be retired.
- What new models and services are required.
Do not start modifying the codebase before completing this audit.
Step 2: Produce an implementation architecture
Prepare:
- Proposed database changes.
- Model relationships.
- API architecture.
- Document-processing architecture.
- AI/OCR provider strategy.
- Clinical rules engine design.
- Alert workflow.
- Background processing strategy.
- Security architecture.
- Migration plan.
- Testing strategy.
Identify the most cost-effective reliable implementation.
Step 3: Implement in phases
Follow the implementation roadmap in this document.

For every phase:
1. Explain the planned changes.
2. Identify affected files.
3. Implement the changes.
4. Create or update database migrations.
5. Run automated tests.
6. Test API endpoints.
7. Test the frontend.
8. Document any outstanding issues.
9. Provide a completion report.
10. Obtain approval before moving to a phase involving major architectural or commercial decisions.
Do not mark a feature complete merely because its code has been written. Demonstrate that it works.
Step 4: Prioritise laboratory AI and clinical safety
The PDF/photo upload processing and clinical alert workflow is the most important technical feature.

Build it as a reusable, provider-independent processing pipeline.

The system must work with laboratory reports from different providers without requiring direct integrations.

Maintain the original document, extraction output, verified result, clinical interpretation and audit history separately.

Use a deterministic clinical rules engine for alert generation.

Ensure critical alerts cannot be lost because of OCR uncertainty, background processing failure or notification failure.

Build retries, monitoring, dead-letter handling and operational escalation.
Step 5: Deliver proper documentation
At the end of each phase, provide:
- Features implemented.
- Database changes.
- API endpoints.
- Frontend changes.
- New dependencies.
- Security considerations.
- Test results.
- Known limitations.
- Deployment instructions.
- Outstanding work.
At the end of the complete project, provide a final technical handover document.
Final objective
The end product must be a robust, secure, AI-enabled preventative healthcare platform.

Tarragon should be able to manage a patient's preventative healthcare journey from initial assessment to investigation planning, laboratory testing, result extraction, clinical review, abnormal-result escalation, longitudinal monitoring and ongoing doctor-led follow-up.

The technology must be designed for Nigerian laboratory conditions, variable document quality, different laboratory formats, uneven digital integration and the practical realities of healthcare delivery.

Build for clinical safety first, operational reliability second, scalability third and advanced AI innovation on top of that foundation.





My additional recommendations: Five innovations I would insist on building
The specification above provides the foundation. However, I would introduce five additional innovations to make Tarragon significantly more differentiated.
1. Build a proprietary laboratory intelligence layer
Highest strategic value







testresult.ai


Do not build a system that only works with Synlab PDFs.

Build a proprietary document intelligence layer that learns to recognise different laboratory report formats.

For example, a patient could upload a report from Synlab, Cerba Lancet or a small independent laboratory. The system should recognise the layout, identify the investigations and standardise the results.

Over time, you will accumulate a valuable library of anonymised and appropriately governed document templates, extraction corrections and test mappings.

This becomes an important technology asset.

My recommendation: Keep the OCR provider interchangeable. Tarragon should own the extraction workflow, standardised data model, clinical validation and intelligence layer.
2. Introduce a patient Health Score, but make it clinically defensible







dribbble.com


Develop a dashboard that summarises a patient's health status across clinically meaningful domains.

For example:
- Cardiometabolic health.
- Renal health.
- Metabolic health.
- Haematological health.
- Preventative screening completion.
- Lifestyle and behavioural indicators.
I would avoid introducing an arbitrary score such as 85/100 without clinical validation.

Instead, initially show transparent status indicators, trends and outstanding actions. A composite score can come later after validation.
3. Introduce a smart test recommendation engine







10bitpartners.com


This is particularly important in Nigeria.

The system should not simply recommend 20 or 30 tests to every member.

It should consider:
- Age.
- Sex.
- Medical history.
- Family history.
- Previous test results.
- Risk factors.
- Previous investigations.
- Screening guidelines.
- Test availability in the patient's location.
For example, a 35-year-old with no known medical conditions should not automatically receive the same investigation schedule as a 60-year-old with hypertension and diabetes.

This makes membership clinically valuable while avoiding unnecessary testing expenditure for patients.
4. Build a clinical operations command centre







o2t.ai


This is for Tarragon's internal team.

I would create a dashboard showing:
- Members with critical results.
- Abnormal results awaiting review.
- Results awaiting verification.
- Overdue investigations.
- Members awaiting monthly check-ins.
- Members with deteriorating trends.
- Pending patient communications.
- Clinical workload by doctor.
- Response-time performance.
This is essential because the membership model promises active healthcare management, not simply access to software.
5. Build Tarragon's longitudinal patient health record
Long-term competitive advantage







storage.googleapis.com


This is potentially the most valuable long-term asset.

Imagine a patient who has used Tarragon for five years.

Their platform contains:
- Five years of laboratory results.
- Blood pressure history.
- Weight changes.
- Medication history.
- Previous clinical reviews.
- Diagnoses.
- Screening history.
- Doctor recommendations.
- Health trends.
Tarragon becomes the central place where the patient understands their health history.

This creates meaningful retention because the value of the platform increases as the patient's longitudinal record develops.

6. Important decisions before Claude starts implementation
There are several areas I would settle before approving production changes.
Decision	My recommendation
Membership	₦100,000 annually
Plus	Retire completely
Laboratory testing	Patient pays laboratory directly
Partner laboratories	Same patient-facing workflow as listed laboratories
Result uploads	PDF, photographs and scanned reports
AI extraction	Hybrid OCR and AI architecture
Clinical alerts	One central rules engine for every result source
Clinical interpretation	AI-assisted, doctor-governed
Monthly consultation	One scheduled check-in
Laboratory prices	Contact laboratory
Family membership	Do not introduce
Sponsorship	Introduce individual sponsorship
Employer membership	₦90,000 proposed annual rate
Employer screening	Separately costed service

One commercial point to resolve: The ₦90,000 employer membership and on-site screening should not automatically be bundled together. The screening activities involve equipment, consumables, staffing and potentially confirmatory testing. Keep them as separate commercial components until the economics are established.
7. What I would prioritise
I would not ask Claude to implement all these changes simultaneously. The correct order is:
Recommended implementation priorities
1. Laboratory upload intelligence
   
   PDF/photo ingestion, OCR, extraction, validation and standardisation.
   Priority 1
2. Clinical safety and alert engine
   
   Ensure uploaded abnormalities generate doctor alerts and critical results are escalated reliably.
   Priority 1
3. Longitudinal health record
   
   Structured results, trend charts and clinical history.
4. Personalised preventative plan
   
   Baseline assessment, test scheduling and laboratory request forms.
5. Doctor and patient workflows
   
   Result reviews, monthly check-ins, reminders and annual reports.
6. Commercial transformation
   
   Retire Plus, implement ₦100,000 Membership and update payment logic.
7. Laboratory directory and employer programme
   
   Nationwide directory, sponsorship and employer functionality.

My most important advice: Do not allow Claude to start by changing the subscription code or redesigning the dashboard. First establish whether the existing application can reliably convert an uploaded laboratory report into a validated structured result and trigger the correct clinical alert.

That is the foundational technology.

Once that works, the rest of Tarragon Health 2.0 can be built around it.

The long-term ambition should be for Tarragon to own the patient's preventative healthcare intelligence layer, independent of which laboratory performs the tests, where the patient lives or which doctor provides their care.
