# Third-party code and licences

Rule (CLAUDE.md v5, S08): code from another project is reused only when its licence is permissive (MIT, Apache-2.0, BSD, ISC), its attribution terms are met, and it is recorded here with name, URL, version or commit, licence, what was used and where. A maintained dependency is preferred to pasted source. Never reuse proprietary code, a repository with no licence, GPL or AGPL code, or anything seen only in a leaked or decompiled form. Never copy another product's text, icons, illustrations or visual design.

| Name | URL | Version / commit | Licence | What was used | Where |
|---|---|---|---|---|---|
| (none) | | | | S08 reused no third-party code. The schedule, adherence, supply and reminder logic is written in-house in `packages/medicines`, because Lagos is a fixed UTC+1 with no daylight saving and a recurrence library adds timezone surface the app does not need (docs/research/S08.md section 4). | |

Studied for ideas only, no code copied: MedTimer (MIT), RxDroid and Daily Pill (GPL, not reusable), `rrule` (BSD-3, not adopted). Medisafe, MyTherapy and the other products in `docs/research/S08.md` were studied from public store listings, help pages and release notes only.
