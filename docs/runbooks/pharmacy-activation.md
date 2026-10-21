# Pharmacy activation runbook

*Operational runbook for the first partner pharmacy (S28e). It documents the steps; it does not perform them. Nothing here is done by a build session: every step is a person with the right role pressing a button or recording a fact, and the go-live switch is the founder's and the Chief Medical Officer's decision (OQ-274: switch on only when a real partner exists). Check each statement against the live screens before relying on it, because the screens and functions named below are the ones in the repository today.*

## What "live" means here

Collection only: the patient sends a signed prescription to a verified pharmacy, gets a collection code, and the pharmacy checks the code and records a full or partial supply. No home delivery, no price comparison and no chat (Part C.2): the pharmacy asks the prescriber from a fixed list of questions, and a stock answer is a plain yes or no. The patient pays the pharmacy herself.

The whole feature sits behind one platform switch, the S37 go-live guard `prescribing_enabled`. While it is off, every patient choice, pharmacy list, counter check, supply and stock answer refuses. Taking a prescription back, the downloadable prescription and the QR and phone-desk paths are never behind it.

**The guard is a single platform switch, not a per-pharmacy flag.** "Switch it on for one pharmacy only" therefore means: activate exactly one partner pharmacy first, confirm no other pharmacy is active, and only then switch the guard on. To add a second pharmacy later, repeat steps 1 to 6 for it; the guard stays on.

## Before you start

- You are an administrator with the `partners.pharmacies.manage` permission (or the Chief Medical Officer for the attestations in step 7).
- The pharmacy exists as a business with a current premises licence from the Pharmacists Council of Nigeria (PCN), a superintendent pharmacist, and at least one branch that can be visited. Do not start without the licence document in hand (spec D.6: licensed pharmacies only).
- Nobody has switched the guard on. Check at Admin, Go-live (`/admin/go-live`).

## Steps

### 1. Add the partner and check the business

1. Admin, Settings, Partners, Pharmacies (`/admin/settings/partners/pharmacies`): **Add a pharmacy partner** with the legal name, city and state, contact phone and a **real** contact email. A seeded `.example` address is a placeholder; do not activate a pharmacy that still carries one.
2. The row starts at **Application received**. Press **Start business verification**. Record the business registration number (CAC) and check it against the CAC register. Press **Mark business verified**.

### 2. Verify the licence

1. Open the licence editor on the pharmacy row. Enter the licence type, number and **expiry date** exactly as on the PCN document.
2. Check the licence with the PCN and keep the evidence on file (the exact PCN route and turnaround are not confirmed anywhere in the project: UNVERIFIED process, agree it with the pharmacy lead first). Press **Confirm licence verified** at the Regulatory verification stage. This sets the verified time and is the only thing that lets the pharmacy be offered to patients; an expired licence stops it being offered again (a patient never sees it) until it is renewed.
3. Enter a licence with no expiry date only if the document truly has none. A missing date is shown as "no expiry date on file" on the scorecard and will not warn you.

### 3. Add and verify its locations

1. Locations are added from the pharmacy's own self-service page after its login exists (step 4), or by the administrator on its behalf. Each branch needs a name, state and street address.
2. At **Location verification**, open each branch and press **Verify**. At least one verified, active location is required to advance, and it is the only kind a patient can choose.

### 4. Create the pharmacist login

1. Admin, Settings, Members (`/admin/settings/members`): create a login with the role **Pharmacist**. Use the superintendent pharmacist's own email. A shared login is not acceptable: every read and every supply is audited under a named person.
2. Back on the pharmacy row, use **Link an existing pharmacist login** to attach it to the pharmacy. Use **Make partner admin** on one login so the pharmacy can invite its own staff.
3. Sign in once as that pharmacist (or ask them to) and confirm they land on the pharmacist area and see "Prescriptions sent to you" with nothing in it.

### 5. Attest the NAFDAC sourcing statement

On the pharmacy row, under "NAFDAC-registered source", type the supplier names and the paperwork you saw (at least 10 characters) and press **Record attestation**. Without it the pharmacy is not offered to patients (S54 rule). Tarragon does not verify batches and says so; this is the pharmacy's own declaration plus what you saw.

### 6. Finish the onboarding pipeline and activate

1. Complete **Service configuration** (contact phone and at least one service region), then **Integration testing**. For the integration test, run one end-to-end rehearsal with test accounts only: a test patient, a test prescription, the test pharmacist. Check: the pharmacy sees the prescription, a wrong code is refused, five wrong codes lock it, the right code opens it, a partial supply needs a note, a supply needs a batch and an unexpired date, and the patient is told neutrally. Do not use a real patient for the rehearsal.
2. Press **Confirm integration tested** (it moves the pharmacy to Approved), then **Activate**. Activation is the moment the partner becomes active.
3. Open Admin, Pharmacy scorecard (`/admin/pharmacy-scorecard`). The new pharmacy should show the licence with its days left and "no figures yet". If it shows an expired or missing licence, stop.
4. Confirm that **exactly one** pharmacy is active. If any other is, deactivate it before the next step.

### 7. Attest the guard conditions

At Admin, Go-live, open `prescribing_enabled`. Its conditions are read from the data or recorded by a person. Three need a person (the rest read themselves):

1. **Collection rules confirmed.** The CMO confirms the PROPOSED values of `pharmacy.collection_rules` (code length 8, valid 14 days, five wrong tries lock it, suggestion window, and the visit size) at the CMO sign-off hub. **The confirmation is tied to the active version of the rules, so a new version needs a new confirmation.** Check that the confirmation names the version that is active now.
2. **Notification sender deployed.** Confirm the `send-pending-notifications` function deployed in production is the current `main-dev` version (the release-integrity edge-drift job reports this) and that the pharmacy messages are in it. Record who checked it and when, in a sentence (at least 10 characters).
3. **Clinical safety case current.** Only the CMO can record this. Name the safety case document, its version and who signed it (at least 25 characters).

The remaining conditions read themselves: at least one active pharmacy partner, and a pharmacy with a current verified licence and a verified location that patients can actually choose. If either is red, a step above was missed.

### 8. Switch the guard on (the decision, not part of this document)

The founder and the CMO decide this together once steps 1 to 7 are green and one rehearsal has passed. The Chief Medical Officer presses the switch (the clinical lead sign-off condition is given by pressing it). This runbook does not press it.

## After switching on

- Watch the first week. Look at Admin, Pharmacy scorecard each day and at the pharmacist's list: are prescriptions arriving, is stock being answered yes or no, are supplies recorded with a batch and expiry.
- The nightly partner quality check fills the scorecard: turnaround to supply, flags raised, complaints and licence days left. **A flag is a suggestion to look, never an automatic removal.** To act on one, open Partner quality and either record or resolve a complaint, or pause the pharmacy from new work with a written reason (at least 20 characters). Work already in progress is never taken away.
- Diary the licence expiry. The scorecard warns inside 30 days; PCN licences are annual. Re-verify the pharmacy every 6 months (CMO decision S-19, 2026-10-07: pharmacies 6 months, laboratories 12, with an earlier re-check after a complaint). A stale check shows as a notice to staff; a person decides any pause.

## Switching off and stopping a pharmacy

- **One pharmacy:** pause it from new work at Partner quality, or deactivate it on the pharmacies page. Patients already sent to it keep their codes; they can take the prescription back or choose another pharmacy.
- **Everything:** switch the `prescribing_enabled` guard off. Patients can still take a prescription back, download it, and use any pharmacy by paper.
- Controlled medicines are never supplied through this path: the counter refuses them at every step, whatever the pharmacy says. The list is reviewed by the CMO; this runbook does not change it.

## What this runbook deliberately does not cover

Payment to or from the pharmacy (medicines are not in the Membership and the patient pays the pharmacy), settlements, delivery, price lists and consignment stock. Each is out of scope by founder decision or still needs one.
