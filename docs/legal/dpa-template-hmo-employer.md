# Data Processing Addendum — HMO & Employer Institutional Account Template

**STATUS: DRAFT — NOT YET REVIEWED BY COUNSEL, NOT FOR EXECUTION.** Every commercial and
operational figure below is a placeholder marked `[CONFIRM: …]`. This draft has not been reviewed
by outside counsel. Do not send this to a prospective HMO or employer partner until (a) the founder
has filled in every placeholder and (b) counsel has reviewed it alongside the rest of the legal
package (see `docs/legal/cover-memo-to-counsel.md`) — this is a new template for that same review,
not a separate legal track.

**Scope of this template.** This is a *Data Processing Addendum only* — it governs personal data
handled in the course of an HMO or employer institutional account relationship, and is meant to be
attached to, and read alongside, the separate commercial Institutional Services Agreement for that
relationship (which sets out payment, coverage/eligibility, and other commercial terms and is out of
scope of this document). It applies to both an HMO institutional account and an employer/corporate
wellness institutional account — pick the applicable term throughout wherever `[HMO / Employer]`
appears.

---

**Between:** Tarragon Health Ltd (RC 9702108), a company incorporated in Nigeria ("**Tarragon**"),
**and:** `[CONFIRM: institution legal entity name and registration number]`, a
`[CONFIRM: HMO licensed under NHIA rules / employer]` ("**Institution**").

### 1. Background

1.1. Tarragon operates a digital health platform for chronic disease management, preventive
     screening, and care coordination. Institution wishes to sponsor or make available Tarragon's
     platform to a defined population of `[CONFIRM: members / employees and, where applicable,
     their dependants]` ("**Covered Individuals**") under a separate Institutional Services
     Agreement dated `[CONFIRM]`.

1.2. This Addendum governs (a) the enrollment/eligibility data Institution provides to Tarragon to
     identify who is a Covered Individual, and (b) the reporting data Tarragon provides back to
     Institution about its Covered Individuals as a population. **It does not create, and must never
     be read to create, any right for Institution to see an individual Covered Individual's clinical
     data** — see §5, which is the operative constraint of this entire Addendum.

1.3. This Addendum forms part of, and is incorporated by reference into, the Institutional Services
     Agreement between the parties. In the event of a conflict between this Addendum and that
     Agreement on a data-protection matter, this Addendum controls.

### 2. Definitions

2.1. **"Applicable Data Protection Law"** means the Nigeria Data Protection Act 2023 ("NDPA"), the
     Nigeria Data Protection Regulation, and any subsidiary regulation or guidance issued by the
     Nigeria Data Protection Commission ("NDPC").

2.2. **"Covered Individual"** means a natural person who is eligible for, or enrolled in,
     Tarragon's platform through Institution's sponsorship — a `[CONFIRM: member / employee or
     dependant]` of Institution. A Covered Individual is, and remains, a Tarragon patient in their
     own right; their Patient Record belongs to their own individual relationship with Tarragon, not
     to Institution.

2.3. **"Individual-Level Data"** means any Personal Data, including Health Data, that identifies or
     could reasonably be used to identify a specific Covered Individual — including their name, and
     any care-plan, diagnosis, medication, vitals reading, screening result, escalation, or any
     other clinical or platform-usage detail specific to them.

2.4. **"Aggregate Data"** means statistical or summary information about a group of Covered
     Individuals that does not identify, and could not reasonably be used to re-identify, any
     specific Covered Individual — including through a small group size, a rare condition, or a
     combination of otherwise-anonymous attributes. `[CONFIRM: the minimum group/cohort size below
     which a statistic is suppressed or generalised rather than disclosed to Institution — e.g. "no
     statistic is shown for a cohort of fewer than N Covered Individuals" — this number needs a real
     statistical-disclosure-control judgment, not an invented figure.]`

2.5. **"Institution Personnel"** means Institution's own employees, contractors, or agents who
     access Tarragon's institutional dashboard or receive reporting under this Addendum.

2.6. **"Superadmin"** means a Tarragon platform administrator account with the highest level of
     internal access, as distinct from any Institution-facing account role.

2.7. **"Personal Data," "Health Data," "Processing," "Data Controller," "Data Processor," "Data
     Subject," "Sub-processor,"** and **"Personal Data Breach"** carry the same meanings as in
     `docs/legal/dpa-template-clinical-partner.md` §2, applied here to Institution in place of
     Partner.

### 3. Roles of the parties

3.1. For the enrollment/eligibility roster Institution provides to identify Covered Individuals,
     Institution acts as the Data Controller of its own employment/membership records, and Tarragon
     Processes that roster to administer platform access. `[CONFIRM WITH COUNSEL: whether Tarragon
     acts as a Data Processor of Institution for this specific, limited act of enrollment, or as an
     independent Data Controller once a Covered Individual is enrolled.]`

3.2. For a Covered Individual's own Patient Record and all clinical data generated through their use
     of the platform, **Tarragon is the sole Data Controller**. Institution has no controller or
     processor role over that data — it receives only the Aggregate Data described in §5.

### 4. Processing purpose and scope

4.1. **Institution → Tarragon:** an enrollment/eligibility roster sufficient to identify who is a
     Covered Individual — `[CONFIRM: exact fields, e.g. full name, date of birth, a member/employee
     ID, contact phone number/email, and eligibility tier]` — provided solely to administer platform
     access and coverage, and for no other purpose.

4.2. **Tarragon → Institution:** Aggregate Data only, as described in §5, provided solely for
     Institution's own `[CONFIRM: benefits design / corporate wellness programme management /
     coverage administration]` purposes, and for no other purpose (including, without limitation, no
     use to make an individual employment, coverage, or underwriting decision about a specific
     Covered Individual, since Institution never receives the individual-level data such a decision
     would require).

4.3. **Location of processing.** Tarragon's platform database runs on Supabase (PostgreSQL) in
     AWS's **eu-west-1 region (Dublin, Ireland)**, because Tarragon's infrastructure provider does
     not currently operate a data centre in Nigeria or elsewhere in Africa. This means Covered
     Individuals' Personal Data, including the roster Institution provides, is transferred outside
     Nigeria as a routine infrastructure fact. **This is flagged as the single highest-priority open
     item in Tarragon's own legal review** (see
     `docs/legal/nigeria-regulatory-compliance-status.md`, §1) and is not yet resolved as of this
     draft. `[CONFIRM WITH COUNSEL: the lawful transfer mechanism this Addendum should rely on, once
     decided — mechanism TBD.]`

### 5. Data scope: aggregate-only access, no individual drill-down

5.1. **This is a contractual commitment, not merely an internal engineering practice.** Institution
     acknowledges and agrees that:
   (a) Institution's, and all Institution Personnel's, access to data about Covered Individuals
       through Tarragon's platform is limited exclusively to Aggregate Data, regardless of an
       Institution Personnel's role, seniority, or job function within Institution;
   (b) Tarragon will never provide, and Institution will never request or attempt to obtain, any
       Covered Individual's Individual-Level Data through the institutional account, dashboard, or
       reporting channel;
   (c) the only exception is where a Tarragon platform **Superadmin** — and no other Tarragon or
       Institution role — accesses a specific Covered Individual's Individual-Level Data internally,
       and only for a purpose unrelated to fulfilling an Institution request (e.g., a security
       investigation, a platform audit, or resolving a support matter the Covered Individual raised
       directly with Tarragon) — never at Institution's request, on Institution's behalf, or for
       Institution's benefit; and
   (d) the sole further exception is where a Covered Individual independently and separately
       authorises a specific, opt-in disclosure of their own Individual-Level Data to Institution
       outside this Addendum (for example, a return-to-work medical clearance the Covered Individual
       chooses to share) — such a disclosure is the Covered Individual's own act, governed by their
       own consent at the time, and does not expand Institution's default access under this Addendum
       in any other respect.

5.2. Any breach of §5.1 by Institution or Institution Personnel — including an attempt to
     re-identify a Covered Individual from Aggregate Data, or a request for Individual-Level Data
     made under any pretext — is a material breach of this Addendum, entitling Tarragon to suspend
     Institution's access to reporting immediately, in addition to any other remedy.
     `[CONFIRM WITH COUNSEL: whether to add a specific, itemised remedy or liquidated-damages
     provision for a re-identification attempt, given how central this commitment is to the
     relationship.]`

### 6. Sub-processors

6.1. To the extent Tarragon acts as a Data Processor of Institution's enrollment roster under §3.1,
     Tarragon will not engage a Sub-processor to Process that roster without Institution's prior
     written consent (which may be general, subject to Tarragon notifying Institution of any
     intended change and giving Institution the opportunity to object), and will impose data
     protection obligations on any such Sub-processor no less protective than those in this
     Addendum.

6.2. `[CONFIRM: whether Tarragon should proactively disclose its current infrastructure
     Sub-processor list (e.g. its cloud/database provider, payment processor, and any AI vendor used
     in the course of caring for Covered Individuals) to Institution, and how updates are notified.]`

### 7. Security obligations

7.1. Tarragon protects Personal Data in transit and at rest via its infrastructure provider's
     standard controls, and enforces the aggregate-only access described in §5 at the database
     level — an Institution account is technically incapable of querying Individual-Level Data
     through the institutional dashboard, not merely instructed not to; this is a database-level
     guarantee, not just an application-layer convention. `[CONFIRM: cite the specific access-control
     mechanism once this Addendum is finalised, so the contractual and technical descriptions stay
     in sync.]`

7.2. Institution will implement appropriate technical and organisational measures to protect the
     enrollment/eligibility roster it provides to Tarragon, and to restrict access to its own
     institutional dashboard and reporting to Institution Personnel who need it.

### 8. Breach notification

8.1. Each party will notify the other without undue delay, and in any case within
     `[CONFIRM: e.g. 72 hours]`, of becoming aware of a Personal Data Breach affecting data shared
     under this Addendum, including any unauthorised access to, or disclosure of, Aggregate Data or
     the enrollment roster.

8.2. Tarragon's internal breach-notification process is documented at
     `docs/legal/breach-notification-runbook.md`.

### 9. Data subject rights cooperation

9.1. Because Institution never holds Individual-Level Data, a Covered Individual's request to
     exercise a right under Applicable Data Protection Law (e.g., access, correction, deletion) will
     ordinarily be made to, and handled entirely by, Tarragon. If Institution receives such a request
     directly (e.g., an employee asking their employer to correct their health data), Institution
     will, within `[CONFIRM: e.g. 5 business days]`, forward it to Tarragon and take no independent
     action, since Institution has no access to act on it in any event.

9.2. Each party will provide the other with reasonable assistance necessary to respond to a Data
     Subject request or an NDPC inquiry concerning Personal Data Processed under this Addendum.

### 10. Retention and deletion on termination

10.1. On termination or expiry of the Institutional Services Agreement, Tarragon will, within
      `[CONFIRM: e.g. 30 days]`, delete or return the enrollment/eligibility roster Institution
      provided, except to the extent Tarragon is independently required to retain it.

10.2. A Covered Individual's own Patient Record is **not** deleted on termination of Institution's
      sponsorship, because it belongs to the Covered Individual's own, independent relationship with
      Tarragon as a platform user (consistent with Tarragon's sponsor model, under which a sponsor —
      whether an employer, an HMO, or a diaspora family member — funds a patient's access but is
      never the data subject or owner of that patient's record). `[CONFIRM: what happens to a
      Covered Individual's ongoing platform access itself — as distinct from their historical
      record — once sponsorship ends, e.g. a transition to a self-pay or Free plan, and how/whether
      that is communicated to the Covered Individual.]`

### 11. Audit rights

11.1. `[CONFIRM: whether Institution may request evidence of Tarragon's compliance with §5
      specifically (the aggregate-only commitment) — e.g. an independent attestation or a technical
      walkthrough of the access control — and how often; and whether Tarragon may audit Institution's
      handling of the enrollment roster and its restriction of institutional-dashboard access.]`

### 12. Liability

12.1. `[CONFIRM WITH COUNSEL — placeholder only]`: each party is responsible for losses directly
      caused by its own breach of this Addendum, its own negligence, or its own violation of
      Applicable Data Protection Law; neither party is liable for the other's indirect or
      consequential losses; `[CONFIRM: whether a liability cap applies, and its amount, and whether
      a breach of §5 by Institution should be carved out of any cap given the severity of a
      re-identification risk.]`

12.2. **Indemnification.** `[CONFIRM WITH COUNSEL]` — each party indemnifies the other against
      third-party claims (including a claim or penalty from the NDPC, or a claim by a Covered
      Individual) arising from its own breach of this Addendum or Applicable Data Protection Law.

### 13. Governing law and dispute resolution

13.1. This Addendum is governed by the laws of the Federal Republic of Nigeria.
      `[CONFIRM WITH COUNSEL: dispute resolution mechanism — litigation venue vs. arbitration, and
      seat/venue — should match whatever the Institutional Services Agreement specifies.]`

### 14. Signatures

| For Tarragon Health Ltd | For `[Institution name]` |
|---|---|
| Name: | Name: |
| Title: | Title: |
| Date: | Date: |
| Signature: | Signature: |

---

*This template was prepared as an internal draft. It has not been reviewed by outside counsel and
carries the same open-items discipline as Schedule D: nothing marked `[CONFIRM]` should be treated
as agreed until the founder and counsel have both signed off. §5 (the aggregate-only,
no-drill-down commitment) reflects a non-negotiable engineering and product rule already in force on
the platform (see `CLAUDE.md`'s "Where things actually stand" section — the shipped removal that
"institutions get aggregate-only patient access, ever, only superadmin may drill into an
individual") — counsel review of this Addendum should tighten its legal drafting, not weaken the
underlying commitment.*
