# Data Processing Addendum — Anthropic Claude API (AI-Drafted Case Briefs)

**STATUS: DRAFT — NOT YET REVIEWED BY COUNSEL, NOT FOR EXECUTION.** Every figure and legal
characterisation below is a placeholder marked `[CONFIRM: …]` unless it is a plain description of
data already documented elsewhere in this repository. This draft has not been reviewed by outside
counsel and has not been sent to, or negotiated with, Anthropic. Do not treat it as, or represent it
as, an executed agreement.

**Note on how to use this draft.** Anthropic, PBC (or the relevant contracting entity under
Tarragon's Claude API commercial terms — `[CONFIRM: exact contracting entity name]`) is a large AI
vendor that offers its own standard-form commercial terms and data processing addendum to API
customers, rather than negotiating a bespoke document from a customer's own template. This draft is
therefore Tarragon's **internal checklist of what must be true, and confirmed, before the AI
case-brief feature (see `docs/legal/dpia-ai-case-briefs.md`) can be considered fully assessed** — a
document to review Anthropic's actual, real commercial DPA against, clause by clause, not a document
Tarragon expects Anthropic to sign as drafted. Every `[CONFIRM]` below marks a fact that must be
verified against Anthropic's real agreement, not assumed from this draft.

---

**Between:** Tarragon Health Ltd (RC 9702108), a company incorporated in Nigeria ("**Tarragon**"),
**and:** Anthropic, PBC `[CONFIRM: exact contracting entity, registered address, and which
Anthropic commercial agreement (API Terms of Service, and any separate enterprise/DPA) governs the
relationship as actually executed]` ("**Anthropic**").

### 1. Background

1.1. Tarragon uses the Anthropic Claude API (model in current use: Claude Haiku 4.5, per
     `docs/legal/dpia-ai-case-briefs.md`) to generate an AI-drafted summary and suggested next step
     for a doctor or clinician reviewing a claimed escalation or acknowledged clinical alert — the
     "**AI Case-Brief Feature**." The full description of this processing, its necessity assessment,
     and its residual risks are set out in the DPIA at `docs/legal/dpia-ai-case-briefs.md`, which
     this Addendum incorporates by reference and does not repeat in full.

1.2. This is Tarragon's second, distinct cross-border transfer of patient Personal Data, separate
     from the Supabase/eu-west-1 transfer that underlies the platform generally (see
     `docs/legal/dpia-health-data-processing.md`). It is assessed here on its own terms.

1.3. This Addendum governs the Personal Data Tarragon sends to Anthropic as part of the AI
     Case-Brief Feature, and Anthropic's handling of that data as Tarragon's processor for this
     specific processing.

### 2. Definitions

2.1. **"Applicable Data Protection Law"** means the Nigeria Data Protection Act 2023 ("NDPA"), the
     Nigeria Data Protection Regulation, and any subsidiary regulation or guidance issued by the
     Nigeria Data Protection Commission ("NDPC").

2.2. **"Personal Data," "Health Data," "Processing," "Data Controller," "Data Processor," "Data
     Subject," "Sub-processor,"** and **"Personal Data Breach"** carry the same meanings as in
     `docs/legal/dpa-template-clinical-partner.md` §2.

2.3. **"API Input"** means the structured snapshot Tarragon sends to the Claude API for a single
     AI Case-Brief Feature request, as described in §3.2.

2.4. **"API Output"** means the AI-drafted summary and suggested next step the Claude API returns,
     always stored and displayed with an "AI-drafted — not yet reviewed" label, per
     `docs/legal/dpia-ai-case-briefs.md` §1.

### 3. Description of the processing

3.1. **Purpose.** Anthropic Processes Personal Data solely to generate the API Output — an
     AI-drafted, plain-language summary and suggested next step — in response to a single API Input,
     for the sole purpose of helping a Tarragon doctor or clinician orient quickly on a case they are
     about to review. The API Output is never used to make, and never treated as, a clinical
     decision, a diagnosis, or a substitute for the doctor's own review
     (`docs/legal/dpia-ai-case-briefs.md` §1).

3.2. **Categories of Personal Data sent (API Input).** Per the DPIA, the API Input is a narrowed,
     structured-fields-only snapshot of one patient's record: active care-plan condition(s), the
     latest risk-score number(s), the last five vitals readings (value and type only), and the last
     five escalations for the same patient (alert level and date only). **The patient's free-text
     clinical notes are never sent** — this is a structural design property of the snapshot builder,
     not a policy stated only in this document (`docs/legal/dpia-ai-case-briefs.md` §1, Risk table
     row 1).

3.3. **Categories of Data Subjects.** Every patient whose escalation is claimed, or clinical alert
     acknowledged, by a doctor or clinician (`docs/legal/dpia-ai-case-briefs.md` §3). This is not an
     opt-in feature at the point of use.

3.4. **Duration and frequency.** One API Input/Output pair is generated per claimed escalation or
     acknowledged alert; there is no continuous or bulk transfer of patient data to Anthropic.

3.5. **Nature of processing.** Text generation via a hosted large language model API call; Anthropic
     does not, to Tarragon's knowledge, perform any further analytics, profiling, or automated
     decision-making on the API Input beyond generating the API Output.
     `[CONFIRM: verify this understanding against Anthropic's actual API documentation/agreement.]`

### 4. Roles of the parties

4.1. Tarragon is the **Data Controller** of all Personal Data in the API Input. Anthropic is a
     **Data Processor**, Processing that Personal Data solely on Tarragon's instructions (as
     expressed through the API call) to generate the API Output.
     `[CONFIRM WITH COUNSEL: whether Anthropic's own standard commercial terms characterise the
     relationship this way, or differently — do not assume this Addendum's characterisation
     overrides Anthropic's actual agreement.]`

### 5. International transfer

5.1. Anthropic's infrastructure is not in Nigeria. This is a transfer of Personal Data, including
     Health Data, from Nigeria (by way of Tarragon's Supabase/eu-west-1 platform, itself already a
     transfer out of Nigeria — see `docs/legal/nigeria-regulatory-compliance-status.md`, §1, "the
     single highest-priority open item in the whole review") to wherever Anthropic Processes API
     Inputs. `[CONFIRM: mechanism TBD]` — as of this draft, **no lawful cross-border transfer
     mechanism has been selected or documented for either leg of this path**, and no
     data-processing agreement with Anthropic is confirmed to be in place
     (`docs/legal/nigeria-regulatory-compliance-status.md`, §1; `docs/legal/dpia-ai-case-briefs.md`
     §4).

5.2. `[CONFIRM WITH COUNSEL: whether Anthropic's standard commercial DPA offers a transfer
     mechanism Tarragon can rely on for the Nigeria-outbound leg specifically (as opposed to a
     mechanism built for e.g. EU-outbound transfers), and whether an NDPC-recognised mechanism needs
     to be added on top of whatever Anthropic offers.]`

### 6. No use of Personal Data for model training

6.1. Tarragon's working assumption, consistent with Anthropic's standard commercial terms for API
     customers, is that **API Inputs and API Outputs are not used to train Anthropic's models by
     default** and are not used to improve Anthropic's services beyond the specific API call, absent
     a separate, affirmative opt-in Tarragon has not given and must not give without a further
     review. `[CONFIRM: cite the exact clause of Anthropic's actual, currently-in-force commercial
     agreement once reviewed — do not rely on this draft's summary as the operative language, and
     re-confirm if Tarragon's Anthropic agreement or plan ever changes.]`

6.2. `[CONFIRM: whether Tarragon's Anthropic account is provisioned under terms that structurally
     guarantee §6.1 (e.g. a commercial/enterprise agreement) as opposed to a self-serve tier where
     the default may differ — verify the actual account type in use.]`

### 7. Data retention by Anthropic

7.1. `[CONFIRM: Anthropic's API Input/Output retention window under the agreement actually in
     force — e.g. a fixed number of days for trust-and-safety purposes, or a shorter/zero-retention
     option if available and adopted — and whether Tarragon has selected any available
     retention-minimisation option.]`

7.2. This is separate from, and does not change, Tarragon's own retention of the stored API Output
     on its own platform (the `case_briefs` table), which is subject to Tarragon's own retention
     schedule. `[CONFIRM: Tarragon's own retention period for a stored AI Case-Brief once created —
     see the open "Formal data-retention schedule" item in
     `docs/legal/nigeria-regulatory-compliance-status.md`, §1.]`

### 8. Sub-processors

8.1. `[CONFIRM: obtain and attach Anthropic's current sub-processor list (typically published via
     Anthropic's Trust Center or equivalent) as an exhibit to this Addendum once the real agreement
     is reviewed, and establish a process for Tarragon to be notified of, and be able to object to,
     future changes.]`

8.2. Anthropic remains responsible for any Sub-processor's compliance with data protection
     obligations equivalent to those Anthropic owes Tarragon under the agreement actually in force.
     `[CONFIRM: verify this is in fact how Anthropic's standard terms treat sub-processor
     liability.]`

### 9. Security obligations

9.1. `[CONFIRM: Anthropic's security certifications/attestations actually in force (e.g. a SOC 2
     report or equivalent) and whether Tarragon has requested and reviewed one.]`

9.2. On Tarragon's side, the API Input is limited by the structural minimisation described in §3.2,
     and the API Output is never written back into a clinical record, never closes a case, and never
     adjusts a medication (`docs/legal/dpia-ai-case-briefs.md` §1) — this is a Tarragon-side control,
     not an Anthropic obligation, but is recorded here because it materially reduces the practical
     impact of any Anthropic-side incident.

### 10. Breach notification

10.1. `[CONFIRM: Anthropic's breach-notification timeline to Tarragon under the agreement actually
      in force, and whether it is fast enough for Tarragon to meet its own NDPC notification
      obligations — Tarragon's internal target is documented at
      `docs/legal/breach-notification-runbook.md`.]`

### 11. Data subject rights cooperation

11.1. If a patient exercises a right under Applicable Data Protection Law (e.g., access, correction,
      deletion) that touches an AI Case-Brief or the underlying API Input, Tarragon remains solely
      responsible for responding to the patient, as Data Controller. `[CONFIRM: what mechanism, if
      any, Anthropic offers to delete or restrict a specific past API Input/Output at Tarragon's
      request, and the timeline for Anthropic to act on such a request.]`

### 12. Audit rights

12.1. `[CONFIRM: what Anthropic offers in lieu of, or in addition to, a bespoke audit — e.g. a
      standard compliance report Tarragon can request — under the agreement actually in force; a
      large AI vendor is unlikely to accept a bespoke on-site audit right, so this section should be
      reconciled with what Anthropic's real terms actually provide, not drafted as if Tarragon can
      dictate the mechanism.]`

### 13. Liability

13.1. `[CONFIRM WITH COUNSEL — placeholder only]`: Anthropic's standard commercial terms will very
      likely set their own liability position (including a cap), which this section should record
      once reviewed, rather than assume Tarragon's own preferred liability language from
      `docs/legal/schedule-d-lab-partner-services-agreement.md` applies to a large AI vendor's
      standard-form agreement.

### 14. Governing law and dispute resolution

14.1. `[CONFIRM: the governing law and venue specified in Anthropic's actual commercial
      agreement — likely not Nigerian law, since this is Anthropic's own standard-form agreement,
      not one Tarragon can dictate the terms of; do not assume Nigerian law applies here the way it
      does in Tarragon's own partner-facing agreements.]`

### 15. Term and termination

15.1. This Addendum tracks the term of Tarragon's underlying Claude API commercial agreement with
      Anthropic. `[CONFIRM: what happens to previously-sent API Inputs/Outputs, and Anthropic's
      retention of them, if Tarragon terminates or downgrades its Anthropic account — see §7.]`

15.2. If this Addendum, once actually agreed, is at any point no longer confirmed to be in place,
      Tarragon must stop sending API Inputs under the AI Case-Brief Feature until it is — the
      feature is not permitted to run on an unconfirmed or lapsed data-processing basis.

### 16. Signatures

`[CONFIRM: whether Anthropic's actual agreement is executed by signature, by clickthrough
acceptance of standard terms, or by an authorised order form — this signature block is included for
Tarragon's internal sign-off discipline and may not reflect how the real agreement is actually
executed.]`

| For Tarragon Health Ltd | For Anthropic, PBC |
|---|---|
| Name: | Name: |
| Title: | Title: |
| Date: | Date: |
| Signature: | Signature: |

---

*This draft was prepared as an internal checklist, not a document to send to Anthropic. It has not
been reviewed by outside counsel. Its purpose is to make explicit exactly which facts about
Anthropic's real, current commercial agreement still need to be located and confirmed before the AI
Case-Brief Feature (see `docs/legal/dpia-ai-case-briefs.md`) can be considered fully assessed — per
that DPIA's own conclusion, "the processing should not be treated as fully assessed until a
data-processing agreement with Anthropic is confirmed." Nothing marked `[CONFIRM]` should be treated
as agreed until the founder, counsel, and Anthropic's own actual terms have all been reconciled.*
