# S05f live probes

Four rolled-back SQL probes used to check, against production, the staff-access rules S05f put on the ten health-record tables
(see `SESSIONS/S05f-click-through-checklist.md` in the founder's working folder). They exist because the click-through needs staff
logins that production does not have (a Medical Officer, an untied Senior Medical Officer), and creating login accounts on
production is not something an agent may do. A probe makes the fake staff **inside a transaction and rolls it back**, so nothing is saved.

| File | Checks |
|---|---|
| `probe-1-staff-access.sql` | Tied Senior Medical Officer reads (control); untied Senior Medical Officer is `denied` on medications and vitals, and cannot prescribe, confirm a refill or amend; tied Medical Officer can read and confirm a refill on a clinician-prescribed medicine but cannot prescribe, amend, or confirm a refill on a patient-added one; drug-name embeds for worklist rows. 14 checks. |
| `probe-2-dose-log-referral-chart.sql` | Dose-history read (1.12), chart sections for a case file (2.8), referral read and clinical-summary save (2.4), and the untied refusals for each (3.1, 3.3, 3.8). 8 checks. |
| `probe-3-patient-pages.sql` | Runs as First Patient under row-level security (no fake accounts): reads own medications and vitals, adds a medication, stops a prescribed one, changes reminder times, a crafted dose edit is refused, logs a dose / symptom / dangerous BP (which raises an emergency event), adds an allergy, cannot write a condition, data export is recorded. 16 checks (section 6). |
| `probe-4-caregivers-supporters.sql` | Fake caregiver with the `medications` category grant, caregiver with no grant, and a manage-level acting supporter: grant holder sees the medication list and log (category-scoped: no vitals), a view-level caregiver cannot log a dose, a no-grant caregiver sees nothing and is refused by the audited read, the supporter can log a dose and a vitals reading and both are stamped with the supporter's id. 13 checks (section 7). |

Last run 2026-10-02: 14/14, 8/8, 16/16 and 13/13 passed, and a check afterwards found 0 fake users, staff, grants, referrals, dose logs or extra vitals.

## What they do not prove
They call the database functions the screens use. They do **not** show how a screen renders the answer (a refusal shown as "not
available to you" instead of an empty list, a blank medication name in a worklist row). That still needs a browser.

## Running
From a checkout where `supabase link` has been run:

```bash
docs/s05f-live-probes/run-probe.sh docs/s05f-live-probes/probe-1-staff-access.sql
```

## Things learned writing them (so the next probe is quicker)
- The audited read functions return **jsonb**: `{status: "ok"|"denied", rows: [...]}`, and the chart read nests under `sections`. Counting
  rows of the function result always gives 1; assert on `status`.
- Audited reads need a reason of at least 10 characters.
- `clinical_staff.active` requires `license_verified_at`.
- `specialist_referrals` has no INSERT policy; make a fake one with `create_specialist_referral` while simulating a tied clinical-tier caller.
- `session_replication_role` cannot be set by the CLI's login role, so triggers cannot be switched off inside a probe.
- Grants are made by the patient: a trigger refuses anyone else, so the probe makes them under the patient's session, and category rows go through `set_care_access_categories`.
- Old prescription versions are `superseded`, not stopped; a symptom needs a severity (the red-flag trigger computes from it).
- `supabase db query` prints only the last statement's result, so collect results in a temp table and select it at the end.
