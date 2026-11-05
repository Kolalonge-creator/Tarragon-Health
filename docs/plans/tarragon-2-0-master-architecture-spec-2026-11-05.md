# Tarragon Health 2.0: master architecture and platform integration spec (founder, 2026-11-05)

Verbatim copy of the founder's message of 2026-11-05, extracted from the session transcript, not retyped. The message contains the master specification twice (once inside section 5 of the covering note, once standalone at the end); both copies are kept as received. Read with `docs/plans/tarragon-2-0-founder-brief-2026-11-04.md` (the first brief) and the Phase 0 assessment `docs/plans/tarragon-2-0-master-architecture-assessment-2026-11-05.md`. Nothing here is a decision until it is logged in `docs/DECISIONS.md`.

---

I think Tarragon 2.0 needs to move beyond being a collection of healthcare features and become one integrated preventative healthcare operating platform.

You have already identified several important components:
- Patient registration and membership.
- Personalised preventative health plans.
- Laboratory and diagnostic provider directory.
- AI laboratory and medical document processing.
- Doctor consultations.
- Patient messaging and care coordination.
- Care Circle for family abroad.
- Tarragon Circles community.
- Sponsorship and payments.
- Doctor, coordinator and administrator dashboards.
These are valuable, but their real potential comes from how they work together.

For example, a patient should not have to navigate separate systems to get a health assessment, receive a test recommendation, find a suitable laboratory, upload the result, receive a doctor's review, update their health plan and inform an authorised family member.

Tarragon should coordinate that entire journey.

I would make the next development priority the integration architecture, rather than simply adding more features.
1. What Tarragon 2.0 should become
Tarragon Health 2.0
One connected preventative healthcare platform
A single patient journey, supported by connected clinical, operational, diagnostic and family services.
Patient and longitudinal health record

One identity, one clinical record, one health timeline


Health assessment


Preventative care plan


Diagnostics network


AI clinical intelligence


Doctor consultations


Care coordination


Care Circle


Tarragon Circles




Shared platform infrastructure

Identity · Permissions · Workflow · Notifications · Payments · Audit · Security · Analytics


The architecture should have a single source of truth for patient information, with specialised modules using the same underlying data and services.
2. The additional capabilities I would build
I would prioritise these ten capabilities.
A. A unified longitudinal patient record
Highest priority
This should be the foundation of everything.

Every patient should have one chronological record containing:
- Personal and demographic information.
- Medical and family history.
- Risk factors.
- Preventative health assessments.
- Doctor consultations.
- Diagnoses and clinical problems.
- Medications and medication reviews.
- Blood pressure and other observations.
- Laboratory investigations.
- Imaging and diagnostic reports.
- Care plans.
- Referrals.
- Follow-up activities.
- Clinical communications.
- Relevant family-sharing events.
Every module should reference this patient record.

Do not create separate records for the same patient in the laboratory, consultation, Care Circle and messaging systems.

Important: A unified record does not mean every user sees everything. Access remains permission-controlled.
B. A clinical workflow and care-plan engine
Highest priority
This is what connects preventative healthcare to actual clinical activity.

A doctor should be able to create a care plan, and Tarragon should automatically coordinate the actions required to deliver it.

For example:

A patient has hypertension and is due for a preventative assessment.

The doctor creates a care plan containing:
- Blood pressure monitoring.
- Kidney function assessment.
- Urine albumin-to-creatinine ratio, where indicated.
- Cardiovascular risk assessment.
- Medication review.
- Follow-up consultation.
Tarragon then creates the relevant tasks.
Action	Responsible party
Record BP readings	Patient
Complete laboratory tests	Patient
Find suitable diagnostic provider	Tarragon
Review results	Doctor
Follow up missing results	Care coordinator
Update care plan	Doctor
View authorised progress	Family supporter

The workflow engine should track what is due, who is responsible, whether it has been completed and what happens next.

It should support conditional actions rather than blindly creating every investigation for every patient.
C. Patient risk stratification and clinical prioritisation
Tarragon should help doctors identify which patients require attention first.

Develop a clinically governed risk and prioritisation engine using approved rules.

Potential inputs:
- Blood pressure trends.
- Relevant laboratory results.
- Existing diagnoses.
- Medication adherence information.
- Missed follow-ups.
- Clinically significant changes.
- Outstanding investigations.
- Relevant risk factors.
The engine should produce operational categories such as:
- Routine follow-up.
- Review required.
- Priority clinical review.
- Urgent escalation.
These categories must be based on clinically approved rules, not an unvalidated AI risk score.

It should also distinguish between a missing reading and an abnormal reading.
D. A central task and worklist engine
Highest priority
This is an important missing piece in many healthcare platforms.

Every outstanding action should become a task with an owner and status.

Examples:
- Doctor needs to review an HbA1c.
- Patient needs to complete a mammogram.
- Coordinator needs to contact a patient.
- Laboratory liaison needs to upload a report.
- Doctor needs to approve a family update.
- Patient needs to attend a consultation.
- An abnormal result requires follow-up.
Each task should have:
- Patient.
- Task type.
- Priority.
- Owner.
- Due date.
- Status.
- Source event.
- Escalation rule.
- Completion record.
This will allow Tarragon to manage healthcare operations rather than simply display information.
E. Unified appointment and telemedicine system
Integrate consultations, bookings, reminders and follow-ups.

Capabilities:
- Doctor availability.
- Appointment booking.
- Consultation scheduling.
- Video consultations.
- Appointment reminders.
- Rescheduling and cancellations.
- Consultation notes.
- Follow-up tasks.
- Payment status where relevant.
- Patient and authorised supporter participation.
A completed consultation should automatically update the patient's timeline and create any agreed follow-up actions.

Do not make patients enter the same information again in different modules.
F. Medication management
I would develop this into a proper medication-management module.

It should include:
- Medication list.
- Dose and frequency.
- Start and stop dates.
- Prescribing clinician.
- Medication reconciliation.
- Patient-reported adherence.
- Medication review.
- Allergy information.
- Interaction and safety checks through an appropriately governed clinical knowledge source.
- Prescription history where legally and operationally supported.
The system should distinguish prescribed medication from medication the patient reports taking.

AI should not independently prescribe, discontinue or alter medication.
G. Pharmacy and medicine access network
This is a logical extension of the diagnostic directory.

A patient may receive a prescription but struggle to obtain the medication.

Tarragon could eventually identify:
- Verified pharmacies.
- Location.
- Contact information.
- Medicine availability, where confirmed.
- Prescription fulfilment options.
- Delivery options.
- Price enquiry.
Do not display a medicine as available unless stock information is current and verified.

Pharmacy regulatory verification should be separate from laboratory and diagnostic-centre verification.
H. Preventative screening and recall engine
This could become one of Tarragon's most valuable long-term capabilities.

The system should identify when a patient is due for appropriate preventative activities.

Examples:
- Blood pressure review.
- Diabetes screening.
- Lipid assessment.
- Kidney function monitoring.
- Cervical screening.
- Breast screening.
- Colorectal screening.
- Other age-, sex-, history- and risk-appropriate assessments.
Use clinician-approved guidelines appropriate to the Nigerian population and the patient's circumstances.

The engine should:
1. Determine whether an activity is relevant.
2. Identify when it is due.
3. Add it to the care plan.
4. Notify the patient appropriately.
5. Help identify an eligible provider.
6. Track completion.
7. Receive the report.
8. Route the result for clinical review.
9. Calculate the next due date under approved rules.
Avoid indiscriminate screening recommendations.
I. Patient education and behaviour-change engine
Tarragon should help patients act on their care plans between consultations.

For example:
- Hypertension education.
- Diabetes education.
- Nutrition guidance.
- Physical activity.
- Weight management.
- Medication adherence education.
- Sleep and lifestyle.
- Screening awareness.
Content should be clinically reviewed, relevant to Nigerian patients and available in accessible language.

This should connect to Tarragon Circles, but public community participation must remain separate from private clinical care.
J. Operational and business intelligence
The management team should be able to see how the entire platform is performing.

Examples:
- Total registered patients.
- Active Free members.
- Active Membership members.
- Membership revenue.
- Sponsorship revenue.
- New patients.
- Patient retention.
- Completed health assessments.
- Care plans created.
- Investigations requested.
- Investigations completed.
- Results awaiting doctor review.
- Outstanding clinical tasks.
- Consultations completed.
- Average review time.
- Provider network coverage.
- Doctor workload.
- Coordinator workload.
- Membership contribution margin.
Use aggregated or appropriately de-identified data for business reporting.

Do not allow the analytics dashboard to become an unrestricted route into patient records.

3. The most important architectural decision: build a central orchestration layer
I would ask Claude to create a common infrastructure that connects every module.
Shared infrastructure	What it does
Patient identity service	Establishes one patient identity across the platform
Clinical record service	Maintains authoritative patient health information
Consent and permissions service	Controls who can see and share information
Clinical terminology catalogue	Standardises investigations, diagnoses and medications
Care-plan engine	Coordinates personalised preventative activities
Workflow and task engine	Tracks outstanding work and ownership
Notification service	Sends appropriate reminders and updates
Document service	Stores and retrieves clinical documents securely
Integration service	Connects external laboratories, pharmacies and other providers
Audit service	Records sensitive actions
Entitlement service	Determines which commercial membership benefits apply
Analytics service	Produces operational and commercial metrics

One particularly important distinction:

Membership entitlements, clinical permissions and emergency safety pathways must be separate systems.

For example, a Free member may not receive routine doctor consultations, but a potentially critical result must still enter the appropriate safety workflow. Paying for Membership must never automatically grant a family member access to confidential clinical information.
4. How all the systems should work together
This is the most important part of the Tarragon 2.0 strategy.

Consider the following example.
Example: Complete patient journey
Illustrative patient journey, from registration to ongoing care.
1. Patient registers
   
   Patient completes registration, health questionnaire and medical history.
2. AI-supported health assessment
   
   Information is structured, relevant risk factors are identified and missing information is highlighted.
3. Doctor reviews and approves care plan
   
   The doctor determines appropriate investigations, monitoring and follow-up.
4. Tarragon finds diagnostic facilities
   
   The system searches for suitable verified laboratories and imaging centres near the patient's location.
5. Patient completes investigations
   
   Patient visits the selected provider and obtains the results.
6. Results enter the clinical record
   
   Patient or laboratory liaison uploads the report. AI extracts structured information and flags uncertainty.
7. Clinical rules and safety checks run
   
   Approved rules identify potentially significant results and route them appropriately.
8. Doctor reviews results
   
   Doctor verifies findings, records interpretation and updates the care plan.
9. Care coordinator manages follow-up
   
   Outstanding actions, appointments and investigations are tracked.
10. Patient and family remain connected
    
    Patient receives updates. Authorised family members see only the information the patient has chosen to share.
11. Longitudinal monitoring continues
    
    Tarragon tracks the next appropriate assessment, investigation and follow-up.

Every step should update the same patient record and relevant workflow.

This is the experience I want Tarragon to deliver.
5. The master specification for Claude
I would give Claude the following as the overarching Tarragon 2.0 development instruction. It should sit above the individual specifications we have already prepared for Care Circle, diagnostics, security and community.
TARRAGON HEALTH 2.0
MASTER PRODUCT ARCHITECTURE AND PLATFORM INTEGRATION SPECIFICATION
Project: Tarragon Health 2.0
Objective: Build an integrated, AI-enabled preventative and longitudinal healthcare platform for Nigeria.

Primary users:
- Patients.
- Doctors.
- Care coordinators.
- Laboratory liaison staff.
- Diagnostic providers.
- Pharmacy partners.
- Family supporters.
- Administrators.
- Finance and operational management.
1. PRODUCT VISION
Tarragon Health 2.0 must operate as one connected healthcare platform rather than a collection of independent features.

The platform should coordinate the complete patient journey:

Registration → Health assessment → Clinical review → Personalised care plan → Investigation referral → Diagnostic provider → Result ingestion → Clinical interpretation → Follow-up → Longitudinal monitoring.

Every stage should connect to the patient's longitudinal health record.

The platform must make it easier for patients to receive preventative healthcare, easier for doctors to oversee patients, and easier for families to support relatives receiving healthcare in Nigeria.

Tarragon should be laboratory-independent. Patients should be able to complete investigations at any eligible diagnostic provider, pay that provider directly and have their results incorporated into their Tarragon clinical record.
2. MANDATORY INITIAL CODEBASE AUDIT
Before implementing Tarragon 2.0, inspect the latest codebase and live database.

The local checkout may be behind main-dev or origin/main-dev.

Claude must:
1. Inspect the current branch and working-tree status.
2. Compare local and latest remote code.
3. Review recent commits and existing pull requests.
4. Read existing technical and product specifications.
5. Inspect all existing Django models.
6. Inspect the existing patient, doctor and staff workflows.
7. Inspect database migrations.
8. Inspect APIs and frontend routes.
9. Inspect feature flags and production configuration.
10. Inspect existing integrations.
11. Inspect security and access-control implementation.
12. Identify duplicated functionality and data structures.
Do not rebuild existing functionality without demonstrating why the current implementation is inadequate.

Do not assume that an existing feature is fully functional simply because its code exists.

Create a module inventory with these statuses:
- Live and verified.
- Built but disabled.
- Partially implemented.
- In development.
- Not implemented.
- Requires security remediation.
- Requires clinical governance.
- Requires integration.
3. CORE PLATFORM ARCHITECTURE
Build Tarragon around a central patient record and reusable shared platform services.

The target architecture should contain the following modules.
3.1 Patient identity and account management
One patient identity across the entire platform.

Support:
- Patient registration.
- Login.
- Account recovery.
- Profile management.
- Contact details.
- Demographics.
- Address and location.
- Patient preferences.
- Account status.
- Consent records.
Prevent duplicate patient identities.

Where duplicate accounts are identified, provide a controlled identity-resolution process with audit history.

Support a separate supporter-only account type.

A supporter should become a patient only through an explicit patient registration and onboarding process.
3.2 Longitudinal clinical record
Create or consolidate a unified patient health record.

It should contain references to:
- Medical history.
- Family history.
- Diagnoses and clinical problems.
- Risk factors.
- Allergies.
- Medications.
- Observations.
- Laboratory investigations.
- Imaging.
- Cardiac investigations.
- Pathology.
- Consultations.
- Care plans.
- Referrals.
- Clinical communications.
- Follow-up actions.
Use existing clinical records as authoritative sources.

Do not duplicate clinical records in Care Circle, messaging, analytics or diagnostic modules.

Every clinical event should be attributable to its source, timestamp and relevant author.
3.3 Preventative health assessment
Build a structured health assessment workflow.

Collect appropriate information, including:
- Age and demographics.
- Medical history.
- Family history.
- Medication history.
- Relevant risk factors.
- Lifestyle information.
- Previous investigations.
- Relevant symptoms.
- Existing diagnoses.
- Previous screening history.
Allow AI to assist with structuring and summarising responses.

AI must not independently diagnose the patient or prescribe investigations.

A doctor must approve clinical decisions requiring professional judgement.
3.4 Personalised preventative care-plan engine
The care-plan engine should generate and manage clinically approved actions.

Potential actions include:
- Laboratory investigations.
- Imaging.
- Screening.
- Blood pressure monitoring.
- Medication review.
- Lifestyle interventions.
- Consultations.
- Follow-up assessments.
Each action must have:
- Patient.
- Care-plan reference.
- Clinical rationale.
- Responsible party.
- Due date.
- Priority.
- Status.
- Source.
- Authorising clinician where required.
- Completion evidence.
- Review date.
Use clinically approved rules and patient-specific context.

Do not apply the same investigations or screening recommendations indiscriminately to every patient.
3.5 Diagnostic provider directory
Integrate the verified laboratory and diagnostic provider network.

The directory must support:
- Standard investigation catalogue.
- Investigation synonyms.
- Laboratory providers.
- Imaging providers.
- Diagnostic centres.
- Hospital diagnostic departments.
- Branch-level service mapping.
- Regulatory verification.
- Accreditation and scope.
- Service verification.
- Location-based search.
- Tarragon preferred partners.
- Referral selection.
- Patient-facing facility profiles.
The doctor must be able to identify facilities offering the requested investigation near the patient's selected location.

Preferred partners may receive first placement only after satisfying the same applicable safety and service eligibility requirements.
3.6 Investigation referral engine
Connect doctor investigation requests to the diagnostic directory.

A doctor should be able to:
1. Select an investigation.
2. Enter the clinical indication.
3. Select appropriate facility options.
4. Generate a referral or request form.
5. Send it to the patient.
6. Track completion.
7. Receive the resulting report.
8. Review the report.
Patients must retain freedom to choose another eligible provider.
3.7 Unified document ingestion and AI processing
Build one secure document ingestion engine for:
- Laboratory reports.
- Imaging reports.
- ECG reports.
- Histopathology.
- Cancer screening.
- Discharge summaries.
- Specialist reports.
- Other supported clinical documents.
Support patient upload, laboratory liaison upload and other authorised routes.

Every uploaded document must be linked to the correct patient and source.

AI should extract structured information, but the original document must remain available.

Preserve:
- Original document.
- Raw extraction.
- Confidence scores.
- Verification status.
- Corrected values.
- Doctor interpretation.
- Audit history.
AI processing must not be confused with clinical verification.
3.8 Clinical rules and safety engine
Build a central, version-controlled clinical rules engine.

It should process relevant clinical events, including:
- Laboratory results.
- Observations.
- Medication-related information.
- Imaging findings.
- Pathology reports.
- Other clinically significant events.
The rules engine must be separate from AI document extraction.

Clinical rules must be:
- Authored or approved by appropriate clinicians.
- Version-controlled.
- Tested.
- Documented.
- Assigned effective dates.
- Assigned review dates.
- Auditable.
Critical findings must enter the appropriate escalation pathway regardless of Membership status.

Do not allow uncertain extraction or processing failures to silently classify a potentially critical result as normal.
3.9 Doctor consultation and telemedicine
Integrate:
- Doctor availability.
- Appointment scheduling.
- Consultation booking.
- Video consultation.
- Consultation notes.
- Clinical decisions.
- Follow-up tasks.
- Patient communication.
A completed consultation should update the longitudinal record and generate relevant follow-up actions.
3.10 Medication management
Create a central medication record.

Support:
- Medication history.
- Prescribed medication.
- Patient-reported medication.
- Dose.
- Frequency.
- Start date.
- Stop date.
- Prescriber.
- Medication reconciliation.
- Adherence reporting.
- Medication review.
- Relevant allergies and safety checks.
Do not allow AI or administrative staff to independently change prescriptions.
3.11 Care coordination and messaging
Unify the existing patient messaging and operational coordination architecture.

Support:
- Patient-to-care-team messages.
- Administrative requests.
- Clinical requests.
- Appointment coordination.
- Investigation follow-up.
- Result follow-up.
- Medication-related communication.
- Care coordinator worklists.
Maintain separate support, clinical and clinical-safety queues.

Use the existing in-app messaging model.

Do not reintroduce WhatsApp as a clinical communication channel without a separate approved product and privacy decision.
3.12 Care Circle
Integrate family support with the longitudinal patient record.

Support:
- Patient-initiated invitations.
- Supporter-only accounts.
- Granular sharing permissions.
- Family health summaries.
- Investigation status.
- Appointment tracking.
- Care-plan progress.
- Doctor-approved family updates.
- Family assistance requests.
- Sponsorship.
Sponsorship and information-sharing permissions must remain independent.
3.13 Tarragon Circles
Integrate community engagement with health education and private clinical services.

Support:
- Moderated topic groups.
- Pseudonymous participation.
- Approved educational content.
- Weekly discussion prompts.
- Misinformation management.
- Safety screening.
- Private transition to care-team support where appropriate.
Community discussions must not become clinical records automatically.

Do not expose patient identity or clinical information through community activity.
3.14 Pharmacy and healthcare provider network
Plan a future provider network covering:
- Pharmacies.
- Hospitals.
- Dental providers.
- Physiotherapy.
- Specialist clinics.
- Other appropriate healthcare services.
Reuse the existing provider and healthcare-service architecture where appropriate.

Each provider type must have appropriate regulatory and professional verification.

Do not launch provider categories without suitable verification requirements.
3.15 Membership, billing and sponsorship
Implement a central commercial entitlement service.

Support the existing Free and annual Membership model.

The entitlement service must determine which commercial services a patient can access.

Examples:
- Monthly doctor consultation.
- Routine clinical review.
- Personalised preventative care.
- Care coordination.
- Membership support services.
Do not mix commercial entitlements with clinical safety permissions.

Critical clinical safety pathways must remain available to every patient.

Payment does not automatically grant family access to clinical records.
3.16 Operational and management analytics
Build central reporting across the platform.

Provide role-appropriate dashboards for:
- Clinical leadership.
- Doctors.
- Care coordinators.
- Diagnostic network administrators.
- Finance.
- Operations.
- Senior management.
Track operational performance, patient engagement, clinical workload, provider network performance and commercial outcomes.

Use privacy-preserving aggregation where appropriate.
4. SHARED PLATFORM SERVICES
The modules above must use common infrastructure.

Do not allow each module to implement its own independent identity, permission, notification or audit logic.

Build or consolidate the following services.
4.1 Identity service
One authoritative identity system.
4.2 Authorisation service
Central role-based, relationship-based and object-level access control.
4.3 Consent service
Record patient permissions, disclosures, sharing, withdrawal and history.
4.4 Clinical terminology service
Maintain standardised investigations, diagnoses, medications, units and other relevant clinical concepts.

Use recognised standards where appropriate, including LOINC for laboratory observations, UCUM for measurement units and appropriate clinical terminology standards where licensing and implementation permit.

Do not force an incomplete terminology mapping.
4.5 Workflow and task service
Provide one reusable system for clinical and administrative tasks.
4.6 Notification service
Centralise in-app, email, push and SMS verification notifications.

Apply role, consent, urgency and privacy rules.
4.7 Document service
Centralise secure document storage, retrieval, versioning and audit.
4.8 Audit service
Maintain a consistent record of sensitive activities.
4.9 Payment and entitlement service
Separate payment processing from healthcare permissions.
4.10 Integration service
Connect external providers through controlled interfaces.
4.11 Analytics service
Produce reliable operational and commercial reporting.
5. EVENT-DRIVEN INTEGRATION
Introduce a consistent mechanism for modules to communicate when important events occur.

Examples of platform events:
- PatientRegistered.
- HealthAssessmentCompleted.
- CarePlanApproved.
- InvestigationRequested.
- ReferralIssued.
- AppointmentBooked.
- InvestigationCompleted.
- DocumentUploaded.
- ResultExtracted.
- ResultVerified.
- CriticalResultDetected.
- DoctorReviewCompleted.
- FollowUpCreated.
- FollowUpCompleted.
- MembershipActivated.
- SponsorshipAccepted.
- CareCirclePermissionChanged.
- FamilyUpdateReleased.
When an event occurs, relevant modules should respond without duplicating business logic.

Example:

When a doctor approves a care plan:
1. Care-plan service stores the approved plan.
2. Workflow service creates the required tasks.
3. Investigation service creates the appropriate investigation requests.
4. Diagnostic directory identifies eligible providers.
5. Notification service informs the patient.
6. Care Circle updates only the information authorised for family sharing.
7. Analytics receives an appropriate operational event.
Implement event delivery reliably.

Use a transactional outbox or equivalent reliable mechanism so that database changes and event publication do not become inconsistent.

Consumers must be idempotent to prevent duplicate tasks, notifications, referrals or payments.

Critical clinical alerts must not depend on a best-effort background notification alone.
6. CENTRAL PATIENT TIMELINE
Create one chronological patient timeline using events from all relevant modules.

Potential entries:
- Registration.
- Health assessment.
- Care-plan approval.
- Consultation.
- Investigation request.
- Referral issued.
- Investigation completed.
- Result uploaded.
- Doctor review.
- Medication change.
- Blood pressure reading.
- Follow-up task.
- Appointment.
- Patient communication.
The timeline should reference authoritative source records.

Do not create a second source of truth.

Different users should see different parts of the timeline according to their permissions.
7. CLINICAL GOVERNANCE
Every clinical decision must have an accountable source.

Define which actions can be performed by:
- AI.
- Patient.
- Care coordinator.
- Doctor.
- Other authorised clinical professionals.
AI may:
- Extract information.
- Summarise records.
- Identify missing data.
- Suggest possible follow-up actions.
- Assist with administrative work.
- Identify potential safety concerns for review.
AI must not independently:
- Diagnose.
- Prescribe.
- Modify medication.
- Approve clinical care plans.
- Release clinical notes to family.
- Close critical alerts.
- Override clinician-approved rules.
- Change patient permissions.
Clinical rules must be reviewed and approved by appropriately qualified clinicians.
8. SECURITY AND PRIVACY
Use the separate Tarragon Enterprise Security Architecture specification as a mandatory implementation requirement.

In particular:
- Patient-data isolation.
- Staff MFA.
- Least-privilege access.
- Object-level API permissions.
- Private document storage.
- Encryption.
- Secure AI processing.
- Consent enforcement.
- Audit logging.
- Backup and recovery.
- Independent penetration testing.
No new module should bypass the shared security architecture.
9. MEMBERSHIP AND PATIENT SAFETY SEPARATION
The platform must maintain separate systems for:

A. Commercial entitlement.

B. Clinical permissions.

C. Patient consent.

D. Clinical safety and escalation.

For example, a Free patient may not receive a routine doctor consultation but must still be able to access emergency pathways and appropriate critical-result escalation.

A sponsor may pay for Membership without gaining clinical access.

A supporter may see a permitted summary without accessing the full patient record.
10. ARCHITECTURAL IMPLEMENTATION STRATEGY
Inspect the current Django architecture before choosing a migration strategy.

My preferred direction for the current stage is a well-structured modular Django application with clearly defined domain boundaries.

Do not prematurely split the platform into multiple microservices.

The existing system should initially use modular components and shared services within a maintainable deployment architecture.

Separate services should only be introduced where there is a demonstrated need for independent scaling, deployment, security isolation or integration.

Use:
- Clear domain models.
- Service-layer business logic.
- Explicit API contracts.
- Background job processing.
- Reliable event delivery.
- Database transactions.
- Idempotent event consumers.
- Versioned clinical rules.
- Automated integration tests.
Avoid circular dependencies between modules.
11. MASTER USER JOURNEY TESTING
Build end-to-end tests demonstrating that the modules work together.

Test the following journey:
1. Patient registers.
2. Patient completes health assessment.
3. Doctor reviews assessment.
4. Doctor approves preventative care plan.
5. Care-plan engine creates tasks.
6. Doctor requests investigations.
7. Diagnostic directory finds appropriate facilities near the patient.
8. Patient selects a facility.
9. Referral is issued.
10. Patient completes investigation.
11. Laboratory liaison uploads result.
12. AI extracts the report.
13. Clinical rules engine evaluates relevant findings.
14. Doctor reviews the result.
15. Care plan is updated.
16. Follow-up tasks are generated.
17. Care coordinator manages outstanding actions.
18. Patient receives appropriate notifications.
19. Authorised family supporter receives permitted updates.
20. Analytics records appropriate operational events.
Repeat the journey with a Free member and a paid Membership member.

Verify that commercial entitlements behave correctly without interfering with safety processes.

Test revoked Care Circle permissions, incorrect patient identifiers, failed OCR, duplicate uploads, unavailable diagnostic facilities, expired credentials and notification failures.
12. IMPLEMENTATION PHASES
Phase 0: Full platform audit
Produce a complete module inventory, dependency map, architecture diagram and data-flow diagram.

Identify duplicated models and services.

Do not modify production functionality.
Phase 1: Shared infrastructure
Prioritise:
- Patient identity.
- Authorisation.
- Consent.
- Audit.
- Notification.
- Document storage.
- Clinical terminology.
- Workflow and task management.
Phase 2: Unified patient record
Consolidate the clinical timeline and authoritative record relationships.

Do not duplicate data.
Phase 3: Clinical workflow integration
Connect:
- Health assessment.
- Care plans.
- Investigation requests.
- Diagnostic provider directory.
- Document ingestion.
- Clinical rules.
- Doctor review.
- Follow-up tasks.
Phase 4: Patient and family integration
Connect:
- Messaging.
- Care Circle.
- Sponsorship.
- Appointment scheduling.
- Consultation participation.
- Patient reminders.
Phase 5: Community and extended provider network
Connect:
- Tarragon Circles.
- Approved education.
- Pharmacy network.
- Other healthcare provider categories.
Phase 6: Analytics and optimisation
Build management dashboards and measure platform performance.
Phase 7: Independent assurance
Complete security testing, clinical governance review, integration testing and production readiness assessment.
13. REQUIRED CLAUDE DELIVERABLES
Before implementation, provide:
1. Existing architecture assessment.
2. Module inventory.
3. Current database and model inventory.
4. Duplicate functionality assessment.
5. Patient data-flow diagram.
6. Module dependency diagram.
7. Proposed shared services architecture.
8. Proposed event and workflow architecture.
9. Patient timeline design.
10. Security and permission architecture.
11. Clinical governance requirements.
12. Migration plan.
13. Integration roadmap.
14. Risk register.
15. Prioritised development backlog.
After implementation, provide:
1. Completed modules.
2. Integration points.
3. Shared services created or consolidated.
4. Database changes.
5. APIs created or modified.
6. End-to-end test results.
7. Security test results.
8. Clinical governance sign-off requirements.
9. Outstanding dependencies.
10. Production rollout plan.
Do not claim that the platform is integrated simply because separate modules can open one another.

Integration must be demonstrated through shared data, reliable event processing, consistent permissions and complete end-to-end workflows.
14. FINAL PRODUCT OBJECTIVE
Tarragon Health 2.0 should give patients one place to manage preventative healthcare.

It should give doctors one place to understand a patient's health, review results and coordinate care.

It should give care coordinators one place to manage outstanding actions.

It should give diagnostic providers a structured route to participate in Tarragon's network.

It should give families a secure way to support loved ones with the patient's consent.

It should give management one reliable view of clinical operations and commercial performance.

The objective is not to build the largest number of features.

The objective is to make every important healthcare activity connect to the next.

Tarragon should become the infrastructure that coordinates preventative healthcare from assessment through investigation, clinical review, follow-up and ongoing health management.




6. What I would actually build first
I would not ask Claude to start implementing all the modules in that document at once.

Here is my recommended development sequence.
Priority	Build	Why
1	Unified patient record and timeline	Everything needs one source of truth
2	Security and permissions architecture	Protects the entire platform
3	Central workflow and task engine	Connects all the activities
4	Clinical care-plan engine	Makes preventative care actionable
5	Diagnostic referral integration	Connects doctors, patients and providers
6	AI document and clinical intelligence	Makes results useful and actionable
7	Consultation and follow-up integration	Closes the clinical care loop
8	Care Circle integration	Brings family into the journey
9	Operational analytics	Allows management to measure performance
10	Pharmacy and wider provider network	Extends the ecosystem

7. Three things I would avoid
1. Do not rush into microservices.

Tarragon is still developing its core product. A well-designed modular Django architecture is likely to be easier to maintain, secure and operate at this stage. You can separate services later when there is a genuine scaling or operational reason.

2. Do not make AI the central decision-maker.

AI should assist with extraction, summarisation, workflow suggestions and operational efficiency. Clinical decisions should remain governed by approved clinical rules and accountable professionals.

3. Do not build dashboards without operational workflows.

A dashboard showing 50 patients awaiting investigations is useful only if the system can assign those patients to someone, track follow-up and record completion.

8. The bigger opportunity
There is a significant distinction between a digital health app and a healthcare operating platform.

A typical health app stores information and displays it to the patient.

What I am proposing for Tarragon is a platform that connects the different people and organisations involved in delivering preventative healthcare.
- The patient provides information and completes care activities.
- The doctor makes clinical decisions.
- The diagnostic provider performs investigations.
- AI helps structure and interpret incoming information under clinical governance.
- The care coordinator manages outstanding activities.
- The family supports the patient where authorised.
- Management monitors service delivery and commercial performance.
All of these participants work from connected, permission-controlled information.

My strongest recommendation is to make the Unified Patient Record, Clinical Workflow Engine and Security Architecture the three foundations of Tarragon 2.0.

Once those are properly established, every new feature becomes easier to integrate, and Tarragon can scale its patient population without having to build a separate system for every new service.TARRAGON HEALTH 2.0
MASTER PRODUCT ARCHITECTURE AND PLATFORM INTEGRATION SPECIFICATION
Project: Tarragon Health 2.0
Objective: Build an integrated, AI-enabled preventative and longitudinal healthcare platform for Nigeria.
Primary users:

* Patients.
* Doctors.
* Care coordinators.
* Laboratory liaison staff.
* Diagnostic providers.
* Pharmacy partners.
* Family supporters.
* Administrators.
* Finance and operational management.

1. PRODUCT VISION
Tarragon Health 2.0 must operate as one connected healthcare platform rather than a collection of independent features.
The platform should coordinate the complete patient journey:
Registration → Health assessment → Clinical review → Personalised care plan → Investigation referral → Diagnostic provider → Result ingestion → Clinical interpretation → Follow-up → Longitudinal monitoring.
Every stage should connect to the patient's longitudinal health record.
The platform must make it easier for patients to receive preventative healthcare, easier for doctors to oversee patients, and easier for families to support relatives receiving healthcare in Nigeria.
Tarragon should be laboratory-independent. Patients should be able to complete investigations at any eligible diagnostic provider, pay that provider directly and have their results incorporated into their Tarragon clinical record.
2. MANDATORY INITIAL CODEBASE AUDIT
Before implementing Tarragon 2.0, inspect the latest codebase and live database.
The local checkout may be behind `main-dev` or `origin/main-dev`.
Claude must:

1. Inspect the current branch and working-tree status.
2. Compare local and latest remote code.
3. Review recent commits and existing pull requests.
4. Read existing technical and product specifications.
5. Inspect all existing Django models.
6. Inspect the existing patient, doctor and staff workflows.
7. Inspect database migrations.
8. Inspect APIs and frontend routes.
9. Inspect feature flags and production configuration.
10. Inspect existing integrations.
11. Inspect security and access-control implementation.
12. Identify duplicated functionality and data structures.

Do not rebuild existing functionality without demonstrating why the current implementation is inadequate.
Do not assume that an existing feature is fully functional simply because its code exists.
Create a module inventory with these statuses:

* Live and verified.
* Built but disabled.
* Partially implemented.
* In development.
* Not implemented.
* Requires security remediation.
* Requires clinical governance.
* Requires integration.

3. CORE PLATFORM ARCHITECTURE
Build Tarragon around a central patient record and reusable shared platform services.
The target architecture should contain the following modules.
3.1 Patient identity and account management
One patient identity across the entire platform.
Support:

* Patient registration.
* Login.
* Account recovery.
* Profile management.
* Contact details.
* Demographics.
* Address and location.
* Patient preferences.
* Account status.
* Consent records.

Prevent duplicate patient identities.
Where duplicate accounts are identified, provide a controlled identity-resolution process with audit history.
Support a separate supporter-only account type.
A supporter should become a patient only through an explicit patient registration and onboarding process.
3.2 Longitudinal clinical record
Create or consolidate a unified patient health record.
It should contain references to:

* Medical history.
* Family history.
* Diagnoses and clinical problems.
* Risk factors.
* Allergies.
* Medications.
* Observations.
* Laboratory investigations.
* Imaging.
* Cardiac investigations.
* Pathology.
* Consultations.
* Care plans.
* Referrals.
* Clinical communications.
* Follow-up actions.

Use existing clinical records as authoritative sources.
Do not duplicate clinical records in Care Circle, messaging, analytics or diagnostic modules.
Every clinical event should be attributable to its source, timestamp and relevant author.
3.3 Preventative health assessment
Build a structured health assessment workflow.
Collect appropriate information, including:

* Age and demographics.
* Medical history.
* Family history.
* Medication history.
* Relevant risk factors.
* Lifestyle information.
* Previous investigations.
* Relevant symptoms.
* Existing diagnoses.
* Previous screening history.

Allow AI to assist with structuring and summarising responses.
AI must not independently diagnose the patient or prescribe investigations.
A doctor must approve clinical decisions requiring professional judgement.
3.4 Personalised preventative care-plan engine
The care-plan engine should generate and manage clinically approved actions.
Potential actions include:

* Laboratory investigations.
* Imaging.
* Screening.
* Blood pressure monitoring.
* Medication review.
* Lifestyle interventions.
* Consultations.
* Follow-up assessments.

Each action must have:

* Patient.
* Care-plan reference.
* Clinical rationale.
* Responsible party.
* Due date.
* Priority.
* Status.
* Source.
* Authorising clinician where required.
* Completion evidence.
* Review date.

Use clinically approved rules and patient-specific context.
Do not apply the same investigations or screening recommendations indiscriminately to every patient.
3.5 Diagnostic provider directory
Integrate the verified laboratory and diagnostic provider network.
The directory must support:

* Standard investigation catalogue.
* Investigation synonyms.
* Laboratory providers.
* Imaging providers.
* Diagnostic centres.
* Hospital diagnostic departments.
* Branch-level service mapping.
* Regulatory verification.
* Accreditation and scope.
* Service verification.
* Location-based search.
* Tarragon preferred partners.
* Referral selection.
* Patient-facing facility profiles.

The doctor must be able to identify facilities offering the requested investigation near the patient's selected location.
Preferred partners may receive first placement only after satisfying the same applicable safety and service eligibility requirements.
3.6 Investigation referral engine
Connect doctor investigation requests to the diagnostic directory.
A doctor should be able to:

1. Select an investigation.
2. Enter the clinical indication.
3. Select appropriate facility options.
4. Generate a referral or request form.
5. Send it to the patient.
6. Track completion.
7. Receive the resulting report.
8. Review the report.

Patients must retain freedom to choose another eligible provider.
3.7 Unified document ingestion and AI processing
Build one secure document ingestion engine for:

* Laboratory reports.
* Imaging reports.
* ECG reports.
* Histopathology.
* Cancer screening.
* Discharge summaries.
* Specialist reports.
* Other supported clinical documents.

Support patient upload, laboratory liaison upload and other authorised routes.
Every uploaded document must be linked to the correct patient and source.
AI should extract structured information, but the original document must remain available.
Preserve:

* Original document.
* Raw extraction.
* Confidence scores.
* Verification status.
* Corrected values.
* Doctor interpretation.
* Audit history.

AI processing must not be confused with clinical verification.
3.8 Clinical rules and safety engine
Build a central, version-controlled clinical rules engine.
It should process relevant clinical events, including:

* Laboratory results.
* Observations.
* Medication-related information.
* Imaging findings.
* Pathology reports.
* Other clinically significant events.

The rules engine must be separate from AI document extraction.
Clinical rules must be:

* Authored or approved by appropriate clinicians.
* Version-controlled.
* Tested.
* Documented.
* Assigned effective dates.
* Assigned review dates.
* Auditable.

Critical findings must enter the appropriate escalation pathway regardless of Membership status.
Do not allow uncertain extraction or processing failures to silently classify a potentially critical result as normal.
3.9 Doctor consultation and telemedicine
Integrate:

* Doctor availability.
* Appointment scheduling.
* Consultation booking.
* Video consultation.
* Consultation notes.
* Clinical decisions.
* Follow-up tasks.
* Patient communication.

A completed consultation should update the longitudinal record and generate relevant follow-up actions.
3.10 Medication management
Create a central medication record.
Support:

* Medication history.
* Prescribed medication.
* Patient-reported medication.
* Dose.
* Frequency.
* Start date.
* Stop date.
* Prescriber.
* Medication reconciliation.
* Adherence reporting.
* Medication review.
* Relevant allergies and safety checks.

Do not allow AI or administrative staff to independently change prescriptions.
3.11 Care coordination and messaging
Unify the existing patient messaging and operational coordination architecture.
Support:

* Patient-to-care-team messages.
* Administrative requests.
* Clinical requests.
* Appointment coordination.
* Investigation follow-up.
* Result follow-up.
* Medication-related communication.
* Care coordinator worklists.

Maintain separate support, clinical and clinical-safety queues.
Use the existing in-app messaging model.
Do not reintroduce WhatsApp as a clinical communication channel without a separate approved product and privacy decision.
3.12 Care Circle
Integrate family support with the longitudinal patient record.
Support:

* Patient-initiated invitations.
* Supporter-only accounts.
* Granular sharing permissions.
* Family health summaries.
* Investigation status.
* Appointment tracking.
* Care-plan progress.
* Doctor-approved family updates.
* Family assistance requests.
* Sponsorship.

Sponsorship and information-sharing permissions must remain independent.
3.13 Tarragon Circles
Integrate community engagement with health education and private clinical services.
Support:

* Moderated topic groups.
* Pseudonymous participation.
* Approved educational content.
* Weekly discussion prompts.
* Misinformation management.
* Safety screening.
* Private transition to care-team support where appropriate.

Community discussions must not become clinical records automatically.
Do not expose patient identity or clinical information through community activity.
3.14 Pharmacy and healthcare provider network
Plan a future provider network covering:

* Pharmacies.
* Hospitals.
* Dental providers.
* Physiotherapy.
* Specialist clinics.
* Other appropriate healthcare services.

Reuse the existing provider and healthcare-service architecture where appropriate.
Each provider type must have appropriate regulatory and professional verification.
Do not launch provider categories without suitable verification requirements.
3.15 Membership, billing and sponsorship
Implement a central commercial entitlement service.
Support the existing Free and annual Membership model.
The entitlement service must determine which commercial services a patient can access.
Examples:

* Monthly doctor consultation.
* Routine clinical review.
* Personalised preventative care.
* Care coordination.
* Membership support services.

Do not mix commercial entitlements with clinical safety permissions.
Critical clinical safety pathways must remain available to every patient.
Payment does not automatically grant family access to clinical records.
3.16 Operational and management analytics
Build central reporting across the platform.
Provide role-appropriate dashboards for:

* Clinical leadership.
* Doctors.
* Care coordinators.
* Diagnostic network administrators.
* Finance.
* Operations.
* Senior management.

Track operational performance, patient engagement, clinical workload, provider network performance and commercial outcomes.
Use privacy-preserving aggregation where appropriate.
4. SHARED PLATFORM SERVICES
The modules above must use common infrastructure.
Do not allow each module to implement its own independent identity, permission, notification or audit logic.
Build or consolidate the following services.
4.1 Identity service
One authoritative identity system.
4.2 Authorisation service
Central role-based, relationship-based and object-level access control.
4.3 Consent service
Record patient permissions, disclosures, sharing, withdrawal and history.
4.4 Clinical terminology service
Maintain standardised investigations, diagnoses, medications, units and other relevant clinical concepts.
Use recognised standards where appropriate, including LOINC for laboratory observations, UCUM for measurement units and appropriate clinical terminology standards where licensing and implementation permit.
Do not force an incomplete terminology mapping.
4.5 Workflow and task service
Provide one reusable system for clinical and administrative tasks.
4.6 Notification service
Centralise in-app, email, push and SMS verification notifications.
Apply role, consent, urgency and privacy rules.
4.7 Document service
Centralise secure document storage, retrieval, versioning and audit.
4.8 Audit service
Maintain a consistent record of sensitive activities.
4.9 Payment and entitlement service
Separate payment processing from healthcare permissions.
4.10 Integration service
Connect external providers through controlled interfaces.
4.11 Analytics service
Produce reliable operational and commercial reporting.
5. EVENT-DRIVEN INTEGRATION
Introduce a consistent mechanism for modules to communicate when important events occur.
Examples of platform events:

* PatientRegistered.
* HealthAssessmentCompleted.
* CarePlanApproved.
* InvestigationRequested.
* ReferralIssued.
* AppointmentBooked.
* InvestigationCompleted.
* DocumentUploaded.
* ResultExtracted.
* ResultVerified.
* CriticalResultDetected.
* DoctorReviewCompleted.
* FollowUpCreated.
* FollowUpCompleted.
* MembershipActivated.
* SponsorshipAccepted.
* CareCirclePermissionChanged.
* FamilyUpdateReleased.

When an event occurs, relevant modules should respond without duplicating business logic.
Example:
When a doctor approves a care plan:

1. Care-plan service stores the approved plan.
2. Workflow service creates the required tasks.
3. Investigation service creates the appropriate investigation requests.
4. Diagnostic directory identifies eligible providers.
5. Notification service informs the patient.
6. Care Circle updates only the information authorised for family sharing.
7. Analytics receives an appropriate operational event.

Implement event delivery reliably.
Use a transactional outbox or equivalent reliable mechanism so that database changes and event publication do not become inconsistent.
Consumers must be idempotent to prevent duplicate tasks, notifications, referrals or payments.
Critical clinical alerts must not depend on a best-effort background notification alone.
6. CENTRAL PATIENT TIMELINE
Create one chronological patient timeline using events from all relevant modules.
Potential entries:

* Registration.
* Health assessment.
* Care-plan approval.
* Consultation.
* Investigation request.
* Referral issued.
* Investigation completed.
* Result uploaded.
* Doctor review.
* Medication change.
* Blood pressure reading.
* Follow-up task.
* Appointment.
* Patient communication.

The timeline should reference authoritative source records.
Do not create a second source of truth.
Different users should see different parts of the timeline according to their permissions.
7. CLINICAL GOVERNANCE
Every clinical decision must have an accountable source.
Define which actions can be performed by:

* AI.
* Patient.
* Care coordinator.
* Doctor.
* Other authorised clinical professionals.

AI may:

* Extract information.
* Summarise records.
* Identify missing data.
* Suggest possible follow-up actions.
* Assist with administrative work.
* Identify potential safety concerns for review.

AI must not independently:

* Diagnose.
* Prescribe.
* Modify medication.
* Approve clinical care plans.
* Release clinical notes to family.
* Close critical alerts.
* Override clinician-approved rules.
* Change patient permissions.

Clinical rules must be reviewed and approved by appropriately qualified clinicians.
8. SECURITY AND PRIVACY
Use the separate Tarragon Enterprise Security Architecture specification as a mandatory implementation requirement.
In particular:

* Patient-data isolation.
* Staff MFA.
* Least-privilege access.
* Object-level API permissions.
* Private document storage.
* Encryption.
* Secure AI processing.
* Consent enforcement.
* Audit logging.
* Backup and recovery.
* Independent penetration testing.

No new module should bypass the shared security architecture.
9. MEMBERSHIP AND PATIENT SAFETY SEPARATION
The platform must maintain separate systems for:
A. Commercial entitlement.
B. Clinical permissions.
C. Patient consent.
D. Clinical safety and escalation.
For example, a Free patient may not receive a routine doctor consultation but must still be able to access emergency pathways and appropriate critical-result escalation.
A sponsor may pay for Membership without gaining clinical access.
A supporter may see a permitted summary without accessing the full patient record.
10. ARCHITECTURAL IMPLEMENTATION STRATEGY
Inspect the current Django architecture before choosing a migration strategy.
My preferred direction for the current stage is a well-structured modular Django application with clearly defined domain boundaries.
Do not prematurely split the platform into multiple microservices.
The existing system should initially use modular components and shared services within a maintainable deployment architecture.
Separate services should only be introduced where there is a demonstrated need for independent scaling, deployment, security isolation or integration.
Use:

* Clear domain models.
* Service-layer business logic.
* Explicit API contracts.
* Background job processing.
* Reliable event delivery.
* Database transactions.
* Idempotent event consumers.
* Versioned clinical rules.
* Automated integration tests.

Avoid circular dependencies between modules.
11. MASTER USER JOURNEY TESTING
Build end-to-end tests demonstrating that the modules work together.
Test the following journey:

1. Patient registers.
2. Patient completes health assessment.
3. Doctor reviews assessment.
4. Doctor approves preventative care plan.
5. Care-plan engine creates tasks.
6. Doctor requests investigations.
7. Diagnostic directory finds appropriate facilities near the patient.
8. Patient selects a facility.
9. Referral is issued.
10. Patient completes investigation.
11. Laboratory liaison uploads result.
12. AI extracts the report.
13. Clinical rules engine evaluates relevant findings.
14. Doctor reviews the result.
15. Care plan is updated.
16. Follow-up tasks are generated.
17. Care coordinator manages outstanding actions.
18. Patient receives appropriate notifications.
19. Authorised family supporter receives permitted updates.
20. Analytics records appropriate operational events.

Repeat the journey with a Free member and a paid Membership member.
Verify that commercial entitlements behave correctly without interfering with safety processes.
Test revoked Care Circle permissions, incorrect patient identifiers, failed OCR, duplicate uploads, unavailable diagnostic facilities, expired credentials and notification failures.
12. IMPLEMENTATION PHASES
Phase 0: Full platform audit
Produce a complete module inventory, dependency map, architecture diagram and data-flow diagram.
Identify duplicated models and services.
Do not modify production functionality.
Phase 1: Shared infrastructure
Prioritise:

* Patient identity.
* Authorisation.
* Consent.
* Audit.
* Notification.
* Document storage.
* Clinical terminology.
* Workflow and task management.

Phase 2: Unified patient record
Consolidate the clinical timeline and authoritative record relationships.
Do not duplicate data.
Phase 3: Clinical workflow integration
Connect:

* Health assessment.
* Care plans.
* Investigation requests.
* Diagnostic provider directory.
* Document ingestion.
* Clinical rules.
* Doctor review.
* Follow-up tasks.

Phase 4: Patient and family integration
Connect:

* Messaging.
* Care Circle.
* Sponsorship.
* Appointment scheduling.
* Consultation participation.
* Patient reminders.

Phase 5: Community and extended provider network
Connect:

* Tarragon Circles.
* Approved education.
* Pharmacy network.
* Other healthcare provider categories.

Phase 6: Analytics and optimisation
Build management dashboards and measure platform performance.
Phase 7: Independent assurance
Complete security testing, clinical governance review, integration testing and production readiness assessment.
13. REQUIRED CLAUDE DELIVERABLES
Before implementation, provide:

1. Existing architecture assessment.
2. Module inventory.
3. Current database and model inventory.
4. Duplicate functionality assessment.
5. Patient data-flow diagram.
6. Module dependency diagram.
7. Proposed shared services architecture.
8. Proposed event and workflow architecture.
9. Patient timeline design.
10. Security and permission architecture.
11. Clinical governance requirements.
12. Migration plan.
13. Integration roadmap.
14. Risk register.
15. Prioritised development backlog.

After implementation, provide:

1. Completed modules.
2. Integration points.
3. Shared services created or consolidated.
4. Database changes.
5. APIs created or modified.
6. End-to-end test results.
7. Security test results.
8. Clinical governance sign-off requirements.
9. Outstanding dependencies.
10. Production rollout plan.

Do not claim that the platform is integrated simply because separate modules can open one another.
Integration must be demonstrated through shared data, reliable event processing, consistent permissions and complete end-to-end workflows.
14. FINAL PRODUCT OBJECTIVE
Tarragon Health 2.0 should give patients one place to manage preventative healthcare.
It should give doctors one place to understand a patient's health, review results and coordinate care.
It should give care coordinators one place to manage outstanding actions.
It should give diagnostic providers a structured route to participate in Tarragon's network.
It should give families a secure way to support loved ones with the patient's consent.
It should give management one reliable view of clinical operations and commercial performance.
The objective is not to build the largest number of features.
The objective is to make every important healthcare activity connect to the next.
Tarragon should become the infrastructure that coordinates preventative healthcare from assessment through investigation, clinical review, follow-up and ongoing health management.
