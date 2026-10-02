# S05f live probes

Two rolled-back SQL probes used to check, against production, the staff-access rules S05f put on the ten health-record tables
(see `SESSIONS/S05f-click-through-checklist.md` in the founder's working folder). They exist because the click-through needs staff
logins that production does not have (a Medical Officer, an untied Senior Medical Officer), and creating login accounts on
production is not something an agent may do. A probe makes the fake staff **inside a transaction and rolls it back**, so nothing is saved.

| File | Checks |
|---|---|
| `probe-1-staff-access.sql` | Tied Senior Medical Officer reads (control); untied Senior Medical Officer is `denied` on medications and vitals, and cannot prescribe, confirm a refill or amend; tied Medical Officer can read and confirm a refill on a clinician-prescribed medicine but cannot prescribe, amend, or confirm a refill on a patient-added one; drug-name embeds for worklist rows. 14 checks. |
| `probe-2-dose-log-referral-chart.sql` | Dose-history read (1.12), chart sections for a case file (2.8), referral read and clinical-summary save (2.4), and the untied refusals for each (3.1, 3.3, 3.8). 8 checks. |

Last run 2026-10-02: 14/14 and 8/8 passed, and a check afterwards found 0 fake users, staff, referrals or dose logs.

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
- `supabase db query` prints only the last statement's result, so collect results in a temp table and select it at the end.
