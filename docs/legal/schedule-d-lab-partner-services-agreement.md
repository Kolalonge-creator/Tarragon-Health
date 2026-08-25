# Schedule D — Lab Services Partnership Agreement & Data Processing Addendum

**STATUS: DRAFT FOR INTERNAL REVIEW. NOT FOR EXECUTION.** Every commercial figure below is
a placeholder marked `[CONFIRM: …]`. This draft has not been reviewed by outside counsel. Do not
send this to a prospective lab partner until (a) the founder has filled in every placeholder and
(b) counsel has reviewed it alongside Schedules A–C (see `docs/legal/cover-memo-to-counsel.md`) —
this is a new schedule for that same review, not a separate legal track.

**Note on Schedules A–C:** those three documents (dated 29 July 2026) were drafted against a
narrower, cardiometabolic-only product description that was reversed the same evening (see
`CLAUDE.md`'s "PIVOT REVERSED" banner). Some of their platform-context language (the Control/
Concierge two-tier framing, "no owned clinics" scope, etc.) no longer matches what is actually
built. This schedule describes the platform as it exists today; it does not attempt to fix A–C —
that is a separate, flagged follow-up (see the accompanying session note).

**Note on partner status (added 2026-08-25):** Synlab Nigeria is now a real, signed, nationwide
lab partner — the founder reversed lab testing from the self-arranged model back to
partner-fulfilled on 2026-08-25, and Tarragon again books and bills the patient for lab tests
(commission to Synlab; see `CLAUDE.md`). This schedule was drafted as a generic template with a
placeholder partner name and placeholder commercial figures below; it has not been executed with
Synlab and does not yet reflect Synlab's actual agreed terms. It should be reviewed and finalized
against Synlab's real, signed terms before being treated as describing the live commercial
relationship — the DRAFT FOR INTERNAL REVIEW / NOT FOR EXECUTION status above is unchanged by this
note and still applies in full.

---

## Part 1 — Lab Services Partnership Agreement

**Between:** Tarragon Health Ltd (RC 9702108), a company incorporated in Nigeria ("**Tarragon**"),
**and:** `[CONFIRM: partner lab legal entity name and registration number]` ("**Partner**").

### 1. Background

Tarragon operates a digital health platform connecting patients with clinicians, laboratories,
pharmacies, and specialists across five service categories: chronic disease management,
preventive screening, care coordination, institutional (employer/HMO) programmes, and the
underlying notification/decisioning infrastructure that ties them together. Tarragon does not
operate its own laboratories. Partner is a licensed clinical laboratory in Nigeria. The parties
wish to establish a referral and fulfilment relationship under which Tarragon refers patients to
Partner for laboratory testing, and Partner performs those tests and returns results through the
Tarragon platform.

### 2. Scope of services

2.1. Tarragon will make Partner discoverable to patients booking laboratory tests through the
platform, at the branch/location(s) Partner maintains in its own facility listing (see §5).

2.2. Partner will perform the ordered test(s), collect samples where applicable (including, where
agreed, home sample collection — see §2.4), and upload the result to the patient's record through
the platform within the turnaround time agreed at §4.

2.3. Partner may access the platform in either of two ways, at Partner's choice, and may use both
for different staff:
   (a) **Partner-operated login** ("Lab Partner" account) — Partner's own staff log into a
       dedicated dashboard, see only orders routed to Partner, and upload results directly; or
   (b) **Liaison-assisted** — Partner sends results to Tarragon's Lab Liaison function (by the
       channel agreed at onboarding), and Tarragon staff upload on Partner's behalf.

2.4. Home sample collection, where offered, is governed by the same turnaround and quality
standards as in-branch collection, and is subject to Tarragon's separate home-collection logistics
terms if a third-party courier is involved.

2.5. Partner is responsible for the clinical and analytical accuracy of every result it uploads.
Tarragon is responsible for correctly routing the order, correctly attributing the result to the
right patient record, and for its own escalation of abnormal results to the patient's care team —
Tarragon does not re-interpret or alter Partner's result.

### 3. Commercial terms

3.1. **Commission.** Tarragon will pay Partner `[CONFIRM: commission % or fixed fee structure —
    e.g. "Partner retains 100% of the patient-facing price; Tarragon invoices Partner X% of gross
    test value as a platform fee" OR "Tarragon collects payment and remits Y% to Partner"]`
    per completed, resulted order. State clearly which party collects payment from the patient —
    the platform's default is that Tarragon collects via Paystack/Stripe at time of booking and
    a commission is recorded against Partner at that point.

3.2. **Payment cadence.** `[CONFIRM: e.g. net-15 or net-30 from month-end, paid by bank transfer]`.

3.3. **Minimum volume.** `[CONFIRM: none, or a stated minimum]`. If none, state that explicitly —
    do not leave this silently blank in the executed version.

3.4. **Price list.** Test prices are as published in Tarragon's live catalogue
    (`panel_bundles`/`lab_tests`) at the time of order. `[CONFIRM: process for Partner to request a
    price change, and notice period]`.

3.5. **Currency.** Naira (₦), unless the parties separately agree a foreign-currency arrangement.

### 4. Turnaround-time service standard

4.1. Partner will use commercially reasonable efforts to upload results within
    `[CONFIRM: target hours per test type — e.g. 24h for routine chemistry, 4h for urgent panels]`
    of payment confirmation.

4.2. **Both parties can see the real number, not just promise one.** The platform records the
    time from payment confirmation to result upload for every order, and Partner can view its own
    turnaround statistics (order count, average, median, and percentage over 72 hours) at any time
    through its own dashboard — the same numbers Tarragon's admin team sees. `[CONFIRM: review
    cadence — e.g. a quarterly call to discuss the numbers if turnaround consistently exceeds the
    target]`.

4.3. Consistent, material breach of the agreed turnaround time is a ground for termination under
    §7, subject to the cure period there.

### 5. Facility / branch listing

5.1. Partner is responsible for keeping its own branch listing (name, state, city, area, address,
     contact details, active/inactive status) accurate through its own dashboard. Tarragon is not
     responsible for a patient being sent to a branch Partner has not kept current.

5.2. Partner will provide and keep current a real contact email and phone number for order
     notifications — not a placeholder address. `[CONFIRM at onboarding — do not leave a seeded
     `.example` address live; verified per-partner in the admin console.]`

### 6. Data protection

See Part 2 (Data Processing Addendum) below, which forms part of this Agreement.

### 7. Term, termination, and liability

7.1. **Term.** `[CONFIRM: initial term — e.g. 12 months, auto-renewing]`.

7.2. **Termination for convenience.** Either party may terminate on `[CONFIRM: e.g. 30 days']`
     written notice.

7.3. **Termination for cause.** Either party may terminate immediately on written notice if the
     other materially breaches this Agreement (including, for Partner, a sustained turnaround-time
     or quality failure under §4) and fails to cure within `[CONFIRM: e.g. 14 days]` of notice.

7.4. **Liability.** `[CONFIRM WITH COUNSEL — placeholder only]`: each party is responsible for
     losses directly caused by its own breach, negligence, or (for Partner) an incorrect or
     mislabelled result; neither party is liable for the other's indirect or consequential losses;
     `[CONFIRM: whether a liability cap applies, and its amount]`.

7.5. **Indemnification.** `[CONFIRM WITH COUNSEL]` — each party indemnifies the other against
     third-party claims arising from its own breach of this Agreement or applicable law.

### 8. Confidentiality

Each party will keep the other's confidential business information (including pricing, volumes,
and this Agreement's terms) confidential, using it only to perform this Agreement.

### 9. Governing law and dispute resolution

This Agreement is governed by the laws of the Federal Republic of Nigeria.
`[CONFIRM WITH COUNSEL: dispute resolution mechanism — litigation venue vs. arbitration, and
seat/venue]`.

### 10. Signatures

| For Tarragon Health Ltd | For `[Partner name]` |
|---|---|
| Name: | Name: |
| Title: | Title: |
| Date: | Date: |
| Signature: | Signature: |

---

## Part 2 — Data Processing Addendum

This Addendum governs personal data Tarragon shares with Partner, and personal data Partner
generates (test results) and returns to Tarragon, in the course of the Agreement above.

### 1. Roles

For the limited data exchanged under this Agreement — a patient's identity, the test(s) ordered,
and the resulting values — **each party acts as an independent data controller** for its own
records (Partner's own laboratory information system, if any, and its own regulatory retention
obligations under Nigerian medical-laboratory practice rules; Tarragon's patient record on the
platform). Neither party processes data on the other's behalf as a service provider.
`[CONFIRM WITH COUNSEL: whether this characterisation is correct, or whether Partner should
instead be treated as a processor for the specific act of returning a result into Tarragon's
platform.]`

### 2. What is shared

- **Tarragon → Partner:** the patient's name, a Tarragon-generated patient number (not a national
  ID), the test(s) ordered, and — only through the scoped worklist described in §2.3 of Part 1 —
  nothing beyond what is needed to perform and report the test.
- **Partner → Tarragon:** the result value(s) and any accompanying report/document.

Partner does not receive broad access to a patient's full clinical record, medication list, or
any other platform data beyond the order itself.

### 3. Where the data lives

Tarragon's platform database runs on Supabase (PostgreSQL) in AWS's **eu-west-1 region (Dublin,
Ireland)**, because Tarragon's infrastructure provider does not currently operate a data centre in
Nigeria or elsewhere in Africa. This means patient data, including the order and result shared
under this Agreement, is transferred outside Nigeria as a routine infrastructure fact, not an
occasional event. **This is flagged as the highest-priority open item in Tarragon's own legal
review** (see `docs/legal/cover-memo-to-counsel.md`, Question 1) and is not yet resolved as of this
draft. Partner should retain the right to be told once Tarragon's cross-border transfer position
is finalised, and Tarragon should not represent this Addendum as final until that happens.

`[CONFIRM WITH COUNSEL: the lawful transfer mechanism this Addendum should rely on, once decided —
do not leave this paragraph as the final word in an executed version.]`

### 4. Security measures

Tarragon protects data in transit and at rest via its infrastructure provider's standard controls,
enforces row-level database access control scoped to each party's own orders (a Partner account
can see and act on orders routed to it and no others — this is a database-level guarantee, not
just an application-layer convention), and logs administrative access to partner data for audit.
`[CONFIRM: whether Partner has its own security commitments to state here — e.g. encryption of any
local copy of a result before it is uploaded.]`

### 5. Retention

`[CONFIRM: retention period for order/result data after the relationship ends — align with
Nigerian medical-laboratory record-retention requirements, which may exceed Tarragon's own
default.]`

### 6. Breach notification

Each party will notify the other without undue delay, and in any case within
`[CONFIRM: e.g. 72 hours]`, of becoming aware of a security incident affecting data shared under
this Agreement.

### 7. Audit

`[CONFIRM: whether either party may request evidence of the other's compliance with this
Addendum, and how often.]`

---

*This schedule was prepared as an internal draft. It has not been reviewed by outside counsel and
carries the same open-items discipline as Schedules A–C: nothing marked `[CONFIRM]` should be
treated as agreed until the founder and counsel have both signed off.*
