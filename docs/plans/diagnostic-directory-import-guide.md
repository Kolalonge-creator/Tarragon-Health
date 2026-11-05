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
