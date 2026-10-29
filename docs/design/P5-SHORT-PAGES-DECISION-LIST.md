# P5: short and gated patient pages, decision list (2026-10-29)

Source: the 844px-or-shorter rows of `PATIENT-DESIGN-AUDIT-2026-10-29.md`. 844px is one phone screen, so these pages are empty, "not open yet", or a single card. Wording below comes from the audit's capture notes; I have **not** re-opened each page or checked each go-live flag, so "gated" means "was gated in the captured environment".

Rules I applied: a safety surface is never hidden; nothing shows a fake number or slot; "waitlist" is only offered where a write path already exists (none was found in this pass, so a waitlist means building one); hiding a page means removing its link, not its route.

## A. Hide the link until the feature is on (nothing useful to show)
| Page | Captured as | Why |
|---|---|---|
| Lowcarb | "not available" | Bare header, no action |
| Diary (paper readings) | "Not switched on yet" | Dead end |
| Result passport | "Not open yet" | Dead end |
| Ask for your records | "Letters are not open yet" + legal draft note | Draft legal text shown to patients |
| Yearly reports for people | empty | No content |
| Contraception | "Not open yet" | Dead end (route stays; no safety content lost) |

## B. Fold into a hub or Home as a card, shown only once there is data
| Page | Fold into |
|---|---|
| Your month / progress | Home card |
| Health score | Home hero (needs the real-reading check, audit S13) |
| Biomarkers | Labs, under results |
| Doses marked taken | Medications, as a "Report" button |
| Your visits | Appointments |
| Health report (yearly) | Health summary |
| Summary of what is inside | Health summary |
| Immunisation card | Prevention |
| Receipts | Profile > Payments |
| Ask someone to pay | Profile > Payments |
| Insurance | Profile |
| My phones | Profile > Devices |

## C. Keep, give a proper empty state (one line + one next step)
| Page | Note |
|---|---|
| Weight | Done in P4 |
| Lock-screen card | Strong privacy copy; keep |
| Care pathway | "Not on a pathway yet": say how to get on one |
| Wellbeing: breathing, library | "Nothing is ready here yet": show what is coming or fold into Wellbeing |

## D. Needs your decision, not mine
| Page | Question |
|---|---|
| Membership / payment | Captured as "Membership is not open yet", but project notes say Membership is live. Check the live flag first; if it is on, this is a bug, not a gate. |
| Group screening days, Testing days | "Part of Membership" / request form. Hide, or keep as a request form? A real waitlist needs a new table and an owner for the list. |

Counts: A 6, B 12, C 4 rows, D 3. Total about 25 rows (some audit rows hold two pages), consistent with the audit's 34 pages.
