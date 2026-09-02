# Data Processing Addendum — Clinical & Fulfilment Partner Template

**STATUS: DRAFT — NOT YET REVIEWED BY COUNSEL, NOT FOR EXECUTION.** Every commercial and
operational figure below is a placeholder marked `[CONFIRM: …]`. This draft has not been reviewed
by outside counsel. Do not send this to a prospective partner until (a) the founder has filled in
every placeholder and (b) counsel has reviewed it alongside the rest of the legal package (see
`docs/legal/cover-memo-to-counsel.md`) — this is a new template for that same review, not a
separate legal track.

**Scope of this template.** This is a *Data Processing Addendum only* — it governs personal data
handled in the course of a partner relationship, and is meant to be attached to, and read alongside,
the separate commercial Services Agreement for the applicable partner category (that Services
Agreement is out of scope of this document and does not yet exist as a drafted template for these
categories). It is written to cover the three partner catalogue types not addressed by
`docs/legal/schedule-d-lab-partner-services-agreement.md` (which already combines a lab-specific
services agreement with its own DPA): **specialist providers** (`specialist_providers`),
**home-visit providers** (`home_visit_providers`), and **logistics partners**
(`logistics_partners`) — i.e., partners who may incidentally handle patient personal data, including
health data, while fulfilling a referral, a home visit, or a delivery, but who are not themselves a
laboratory. Do not use this template for a lab partner (use Schedule D) or for an HMO/employer
institutional account (see `docs/legal/dpa-template-hmo-employer.md`).

---

**Between:** Tarragon Health Ltd (RC 9702108), a company incorporated in Nigeria ("**Tarragon**"),
**and:** `[CONFIRM: partner legal entity name, registration/licence number, and — where the partner
is an individual practitioner rather than a corporate entity, e.g. a specialist in private
practice — the appropriate individual identification]` ("**Partner**"), a
`[CONFIRM: specialist provider / home-visit provider / logistics partner, as applicable]`.

### 1. Background

1.1. Tarragon operates a digital health platform connecting patients with clinicians, laboratories,
     pharmacies, specialists, home-visit providers, and logistics partners across five service
     categories: chronic disease management, preventive screening, care coordination, institutional
     (employer/HMO) programmes, and the underlying notification/decisioning infrastructure that ties
     them together. Tarragon does not itself provide specialist consultations, home visits, or
     logistics/courier services.

1.2. Partner is `[CONFIRM: a licensed specialist practice / a home-visit clinical service / a
     logistics or courier operator]`, engaged by Tarragon under a separate Services Agreement to
     `[CONFIRM: receive specialist referrals / dispatch home-visit staff / deliver medication or
     specimens on Tarragon's behalf]`. This Addendum governs the personal data — including, where
     applicable, health data — that Tarragon shares with Partner, and that Partner generates and
     returns to Tarragon, in the course of that Services Agreement.

1.3. This Addendum forms part of, and is incorporated by reference into, the Services Agreement
     between the parties dated `[CONFIRM]`. In the event of a conflict between this Addendum and the
     Services Agreement on a data-protection matter, this Addendum controls.

### 2. Definitions

For the purposes of this Addendum:

2.1. **"Applicable Data Protection Law"** means the Nigeria Data Protection Act 2023 ("NDPA"), the
     Nigeria Data Protection Regulation, and any subsidiary regulation or guidance issued by the
     Nigeria Data Protection Commission ("NDPC"), together with any other data protection law that
     applies to the processing under this Addendum.

2.2. **"Personal Data"** means any information relating to an identified or identifiable natural
     person, including a patient, that is processed under this Addendum.

2.3. **"Health Data"** means Personal Data concerning a person's physical or mental health,
     including their receipt of health-care services, that reveals information about their health
     status.

2.4. **"Processing"** means any operation performed on Personal Data, whether or not by automated
     means — including collection, recording, storage, use, disclosure, and deletion.

2.5. **"Data Controller"** means the party that determines the purpose and means of Processing.
     **"Data Processor"** means a party that Processes Personal Data on behalf of, and under the
     instructions of, a Data Controller.

2.6. **"Data Subject"** means the natural person to whom the Personal Data relates — principally, a
     Tarragon patient referred to, or served by, Partner under the Services Agreement.

2.7. **"Sub-processor"** means any third party a Data Processor engages to Process Personal Data on
     the Data Processor's behalf in order to perform its obligations under this Addendum.

2.8. **"Personal Data Breach"** means a breach of security leading to the accidental or unlawful
     destruction, loss, alteration, unauthorised disclosure of, or access to, Personal Data
     Processed under this Addendum.

2.9. **"Patient Record"** means the full clinical record Tarragon maintains for a patient on its
     platform, as distinct from the narrower order/referral-specific data actually shared with
     Partner under §4 below.

### 3. Roles of the parties

3.1. For the Personal Data exchanged under this Addendum — a patient's identity, the referral,
     visit, or delivery in question, and the outcome Partner reports back — **each party acts as an
     independent Data Controller** for its own records (Partner's own patient/client file or
     delivery log, and its own regulatory record-keeping obligations under the rules governing
     Partner's profession or sector; Tarragon's Patient Record on the platform). Neither party
     Processes Personal Data purely as a service provider to the other by default.
     `[CONFIRM WITH COUNSEL: whether this characterisation is correct for each of the three partner
     categories in scope, or whether a given category (e.g. a logistics partner handling a delivery
     purely on Tarragon's instructions, with no independent purpose of its own) should instead be
     treated as a Data Processor acting on Tarragon's behalf — the answer may differ between a
     specialist provider (more likely an independent controller, as a treating clinician) and a
     logistics partner (more likely a processor, as a courier with no clinical purpose of its own).]`

3.2. Where §3.1's `[CONFIRM]` determines that Partner acts as a Data Processor for some or all of
     the Processing under this Addendum, §6 (Sub-processors) applies to Partner's own use of any
     third party (e.g., a courier subcontractor, a locum staffing agency) to perform its
     obligations.

### 4. Processing purpose, scope, and location

4.1. **Purpose.** Partner Processes Personal Data solely to perform the service Tarragon has
     referred or dispatched to it under the Services Agreement — for example, a specialist
     consultation, a home-visit clinical service, or a delivery of medication, a device, or a
     laboratory specimen — and for no other purpose, including marketing, research, or any use
     unrelated to that specific referral, visit, or delivery.

4.2. **Categories of Personal Data shared.**
   (a) **Tarragon → Partner:** the patient's name, a Tarragon-generated patient number (not a
       national ID), a contact phone number and — only where the service requires an in-person
       visit or delivery (home-visit and logistics partners) — a delivery/visit address, the
       specific service ordered, and, where clinically necessary for a specialist referral, a
       structured referral summary (condition category and reason for referral) rather than the
       patient's full Patient Record.
   (b) **Partner → Tarragon:** the outcome of the referral, visit, or delivery (e.g., a consultation
       note or report, a visit-completion confirmation, or a delivery confirmation), and any
       accompanying document Partner is expected to return under the Services Agreement.

     Partner does not receive broad access to a patient's full Patient Record, medication list, or
     any other platform data beyond what is needed to perform the specific referral, visit, or
     delivery in question.

4.3. **Duration.** Partner Processes this Personal Data for the duration needed to perform and
     report on the specific referral, visit, or delivery, and thereafter only as required by §9
     (Retention and deletion).

4.4. **Location of processing.** Tarragon's platform database runs on Supabase (PostgreSQL) in
     AWS's **eu-west-1 region (Dublin, Ireland)**, because Tarragon's infrastructure provider does
     not currently operate a data centre in Nigeria or elsewhere in Africa. Personal Data Tarragon
     shares with Partner under this Addendum is therefore transferred outside Nigeria as a routine
     infrastructure fact before it ever reaches Partner. **This is flagged as the single
     highest-priority open item in Tarragon's own legal review** (see
     `docs/legal/nigeria-regulatory-compliance-status.md`, §1) and is not yet resolved as of this
     draft. `[CONFIRM WITH COUNSEL: the lawful transfer mechanism this Addendum should rely on, once
     decided, and whether Partner's own Processing location (if outside Nigeria) raises a second,
     separate transfer question — mechanism TBD.]`

### 5. Security obligations

5.1. Each party will implement appropriate technical and organisational measures to protect
     Personal Data Processed under this Addendum against unauthorised or unlawful Processing and
     against accidental loss, destruction, or damage, proportionate to the sensitivity of the data
     involved.

5.2. Tarragon protects data in transit and at rest via its infrastructure provider's standard
     controls, enforces row-level database access control scoped to each partner's own referrals,
     visits, or deliveries (a Partner account can see and act on the work routed to it and no
     others — this is a database-level guarantee, not just an application-layer convention), and
     logs administrative access to partner data for audit.

5.3. `[CONFIRM: Partner's own security commitments — e.g. encryption of any local copy of patient
     data before or after a visit/delivery, device-level protections for any mobile device used to
     access patient information in the field, and staff confidentiality undertakings for any
     Partner personnel who see patient data in the course of a home visit or delivery.]`

### 6. Sub-processors

6.1. To the extent Partner acts as a Data Processor under §3.2, Partner will not engage a
     Sub-processor to Process Personal Data under this Addendum without Tarragon's prior written
     consent (which may be general, subject to Partner notifying Tarragon of any intended change and
     giving Tarragon the opportunity to object).

6.2. Partner will impose data protection obligations on any Sub-processor that are no less
     protective than those in this Addendum, and remains fully liable to Tarragon for a
     Sub-processor's acts and omissions as if they were Partner's own.

6.3. `[CONFIRM: whether Partner is expected to maintain and share on request a current list of its
     Sub-processors, and how changes are notified.]`

### 7. Breach notification

7.1. Each party will notify the other without undue delay, and in any case within
     `[CONFIRM: e.g. 72 hours]`, of becoming aware of a Personal Data Breach affecting data shared
     under this Addendum, and will provide the information reasonably necessary for the other party
     to meet its own notification obligations under Applicable Data Protection Law (including to
     the NDPC and to affected Data Subjects, where required).

7.2. Tarragon's internal breach-notification process is documented at
     `docs/legal/breach-notification-runbook.md`; a Partner-reported incident is handled under that
     same process once notified.

### 8. Data subject rights cooperation

8.1. If Partner receives a request from a Data Subject to exercise a right under Applicable Data
     Protection Law (e.g., access, correction, deletion) that relates to Personal Data shared under
     this Addendum, Partner will, within `[CONFIRM: e.g. 5 business days]`, forward the request to
     Tarragon and take no independent action on it, unless Partner is itself the sole and
     independent Data Controller for the specific data requested (e.g., Partner's own clinical file
     created in the course of treating the patient directly), in which case Partner will respond in
     accordance with its own obligations under Applicable Data Protection Law.

8.2. Each party will provide the other with reasonable assistance necessary to respond to a Data
     Subject request or an NDPC inquiry concerning Personal Data Processed under this Addendum.

### 9. Retention and deletion on termination

9.1. On termination or expiry of the Services Agreement, Partner will, within
     `[CONFIRM: e.g. 30 days]`, delete or return all Personal Data received from Tarragon under this
     Addendum, except to the extent Partner is independently required to retain it under the
     record-retention rules governing its own profession or sector (e.g., MDCN/relevant specialist
     council rules for a specialist provider, or NAFDAC/PCN rules where a logistics partner has
     handled medicines) — in which case Partner will retain only what those rules require, for no
     longer than they require, and will continue to protect it under §5 for as long as it is
     retained.

9.2. `[CONFIRM: retention period for Tarragon's own copy of the referral/visit/delivery record
     after the relationship ends.]`

### 10. Audit rights

10.1. `[CONFIRM: whether either party may request evidence of the other's compliance with this
      Addendum (e.g., a self-certification questionnaire, or an on-site/remote audit), the notice
      period, and how often.]`

### 11. Liability

11.1. `[CONFIRM WITH COUNSEL — placeholder only]`: each party is responsible for losses directly
      caused by its own breach of this Addendum, its own negligence, or its own violation of
      Applicable Data Protection Law; neither party is liable for the other's indirect or
      consequential losses; `[CONFIRM: whether a liability cap applies to this Addendum
      specifically, separate from any cap in the Services Agreement, and its amount]`.

11.2. **Indemnification.** `[CONFIRM WITH COUNSEL]` — each party indemnifies the other against
      third-party claims (including a claim or penalty from the NDPC) arising from its own breach
      of this Addendum or Applicable Data Protection Law.

### 12. Governing law and dispute resolution

12.1. This Addendum is governed by the laws of the Federal Republic of Nigeria.
      `[CONFIRM WITH COUNSEL: dispute resolution mechanism — litigation venue vs. arbitration, and
      seat/venue — should match whatever the Services Agreement specifies, so the two documents do
      not disagree.]`

### 13. Signatures

| For Tarragon Health Ltd | For `[Partner name]` |
|---|---|
| Name: | Name: |
| Title: | Title: |
| Date: | Date: |
| Signature: | Signature: |

---

*This template was prepared as an internal draft. It has not been reviewed by outside counsel and
carries the same open-items discipline as Schedule D: nothing marked `[CONFIRM]` should be treated
as agreed until the founder and counsel have both signed off, and it should not be issued to any
specific partner until the bracketed partner-category choices (specialist provider / home-visit
provider / logistics partner) have been resolved for that partner.*
