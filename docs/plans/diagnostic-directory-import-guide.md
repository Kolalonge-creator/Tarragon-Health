# Diagnostic directory import: how to fill the spreadsheet

Template: `diagnostic-directory-import-template.csv` (one row per **branch**). Upload it at **Admin, Lab and imaging directory, Import**.

**Importing never lists anything.** A good row becomes a **draft**, and each part is set up as follows:
- **Facility and branch:** a new facility that is not contracted, or a new branch of an existing uncontracted one with the same name.
- **Tests:** each one is marked "awaiting confirmation".
- **Credentials:** the registration and accreditation are recorded as **pending**.

A verifier still has to do four things before anything can be recommended:
- check each credential against its source;
- phone the branch to confirm each test;
- check the location;
- list the branch.

A contracted provider's branches are managed on the partner screen, never by import.

| Column | Required | What to put |
|---|---|---|
| provider_ref | no | Your own reference for the provider (kept for reference only) |
| legal_name | no | Registered company name (kept for reference only) |
| trading_name | **yes** | Public name. Rows with the same name and type become branches of one provider |
| branch_name | **yes** | The branch, for example "Lekki branch" |
| facility_type | **yes** | `lab` or `imaging` (hospitals are out of scope) |
| state, town, address | **yes** | As on the branch's signboard or the regulator register |
| lga | no | Local Government Area |
| latitude, longitude | no | Both or neither, decimal degrees, inside Nigeria |
| phone | no | `+234...` form. A branch cannot be recommended without a phone |
| email | no | Kept for reference only |
| investigation_codes | no | Catalogue codes separated by `;`, for example `inv.hba1c;inv.fbc`. A group code (for example "ultrasound") is refused: use the specific test |
| regulator | no | `mlscn_registration`, `nnra_authorisation`, `state_facility_licence`, `rrbn`, `mdcn` or `other` |
| regulator_name | no | For example "MLSCN" or "Lagos HEFAMAA" |
| registration_number | if regulator | The number on the register |
| registration_expires_on | no | `YYYY-MM-DD` |
| accreditation_body, accreditation_number, accreditation_scope_codes | together | ISO 15189 only. The scope codes are the tests the certificate covers |
| accreditation_expires_on | no | `YYYY-MM-DD` |
| partner_status | no | Reference only. Partner status is set by an admin on the directory screen |
| service_verification_date | no | Reference only. Tests are confirmed by phone in the directory screen |
| evidence | **yes** | Where this row came from, for example "MLSCN approved list, downloaded 5 Nov 2026" |
| evidence_url | if regulator or accreditation | A link to the register entry or certificate |
| record_status | no | Reference only |

Problems are shown row by row after upload. Fix the spreadsheet and upload it again; a row with problems cannot be applied.

## First real data: Lagos and Abuja seed (6 Nov 2026)

`diagnostic-directory-seed-lagos-abuja-2026-11-06.csv` holds 34 branch rows from 7 providers, each taken from a public source named in its `evidence` and `evidence_url` columns. Synlab is excluded (it is contracted and managed on the partner screen). Every row passed the database's own row check (`private.diagnostic_import_problems`) with no problems. Importing it creates drafts only: nothing is listed until a verifier has done the four steps above.

What the verifier should know:
- No regulator or accreditation numbers are filled in. No provider publishes one, so every credential starts empty. Several providers claim ISO 15189 without a certificate number; the claim is noted in `evidence` and must not be treated as proof.
- Test codes are filled in only where a branch's own page lists the test (3 rows). Every other branch's tests must be confirmed by phone.
- All 11 Afriglobal branches publish one shared phone line. Cerba Lancet Ebute Metta is a collection point only, and Gudu sits inside CedarCrest Hospital. Me Cure's Lekki and Ajah rows assume a lab and its Oshodi imaging row assumes the imaging suite is there.
- The 3 Echolab rows come from a 2024 blog listing only (`AGGREGATOR ONLY` in evidence). Treat them as the weakest.
- Coordinates are empty: the verifier sets each location. LGAs are mapped from town names, not published by the providers.
