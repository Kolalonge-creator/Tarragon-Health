# Finance console audit: the other 19 pages

Date: 2026-10-30. Scope: every page under `/finance` except the overview (already fixed in #1495). Read-only audit of the code on main-dev at `3e46a725d`, plus three read-only queries on the live database. Nothing was changed and nothing was opened in a browser.

The question asked of each page: when a read fails, or a figure is typed in, can the page show something false?

## What is already right

These pages handle a failed read honestly and need no change:

| Page | Why |
|---|---|
| Approvals | A failed pending or history read says so, and says it does not mean the queue is empty. |
| Statements | Income statement, balance sheet and cash flow have a failed state. |
| Money reconciliation | Zod-validated, a failed read is an alert, "not the same as everything agreeing". |
| Settlement tie-out | Same, and "nothing compared" is kept apart from "clean". |
| Partner settlements | `loadFailed` and an access notice for roles the table hides from. |
| Investor pack (print) | A failed source blocks the whole pack. A stale one prints an amber banner. This is the model for the other two packs. |
| Layout | Redirects a non-finance caller. |

All finance query hooks (`lib/finance/queries.ts`) throw on a database error and validate the reply with Zod, so `isError` is reliable everywhere. A UI fix will work.

## A. A failed read is shown as "all clear" or zero

Each of these checks `isLoading` only. A failed read lands on the empty-state line.

| # | Page | What a failed read shows | Why it matters |
|---|---|---|---|
| A1 | Fraud signals | "No open signals. ✓" | A green tick on a fraud monitor that could not run. |
| A2 | Reconciliation | "No open flags. Everything the sweep checked ... matched. ✓", "Everything captured is matched. ✓", "No settlements imported yet" | Same class, on the money-matching screen. |
| A3 | Payables | "No outstanding payables. ✓", "No bills yet", "No vendors yet" | Hides money owed. "No vendors yet" invites a duplicate vendor. |
| A4 | Compliance calendar | Overdue 0, Due within 7 days 0, Upcoming 0, and "Nothing configured." | A statutory-deadline tracker saying nothing is overdue. Missed FIRS dates carry penalties. |
| A5 | Audit log | "No finance activity in this range." | The audit log saying nothing happened. |
| A6 | General ledger | "No entries in this range." | |
| A7 | Budgets | "No budgets or activity in this range.", "No budget lines configured yet." | A person may re-enter budgets and overwrite the real ones. A failed accounts read also leaves the Account dropdown silently empty. |
| A8 | Revenue recognition | Deferred ₦0, Recognised ₦0, Active schedules 0, "No recognition schedules yet." | |
| A9 | Employer billing | "No corporate or HMO organisations yet." | |
| A10 | Settings | "No periods yet. The first posting opens one automatically."; the accounts, cost centres and approval threshold cards render blank with no message | The approval threshold is a control. Blank reads as "not set". |
| A11 | Tax | While loading (not failed), all four tiles show ₦0.00, including Net VAT payable | The failed state is handled. The loading state falls through to `?? 0`. Brief, but it is the statutory figure. |
| A12 | Transactions lookup | An error says "Check the ID is correct" | Blames the user for a system failure. A pending payment is also drawn red, like a failed one. |
| A13 | Reports hub | A failed company-profile read hides the "legal name, RC or TIN isn't on file" warning | The reports then print with blank letterheads and no warning. |

## B. The printed packs (highest stakes)

These are printed or saved as PDF and handed to an auditor or a tax adviser.

**Audit and management pack.** Every one of its seven sections checks `isLoading` only:

- Trial balance: "No ledger activity."
- Settlement reconciliation: "No settlements recorded." and "0 unmatched payment event(s)"
- Accounts payable aging: "Nothing outstanding."
- Budget vs actual: "No budgets configured for this period."
- Approval history: "No approval requests in this range."
- Finance system audit trail: "No logged finance activity in this range."
- General ledger detail: "No entries in this range."

In a document an auditor reads as evidence, those are affirmative statements.

**Government filings pack.**

- Income statement: failed read prints Revenue, Expenses and Net income as ₦0.00.
- VAT and WHT: failed read prints Output VAT, Input VAT, Net VAT payable and WHT payable as ₦0.00.
- Filing calendar: failed read prints "Nothing configured."
- Company particulars: a failed (or still loading) profile read prints every field, including the FIRS TIN and RC number, as "not on file".

**Both packs.** Print is available while sections still say "Loading…", so a quick click prints "Loading…" into the document.

**Period boundaries.** From and to are Lagos dates, but the audit trail query uses `T00:00:00.000Z` and `T23:59:59.999Z` (UTC), and the approvals filter compares timestamps to date text. Entries in the first hour of a Lagos day are put in the previous day, and a request in the last second of the final day is dropped.

## C. Wrong numbers even when every read works

**C1. Typed amounts are silently misread (highest value finding).** `majorToMinor` in `_components/primitives.tsx` uses `parseFloat` and returns 0 when the result is not finite. Checked:

| Typed | Stored as |
|---|---|
| `1,500,000` | ₦1.00 |
| `5 000` | ₦5.00 |
| `₦5000` | ₦0.00 |
| `abc` | ₦0.00 |
| `-200` | -₦200.00 (accepted) |

A comma in a money field truncates at the comma, with no message. It is used 21 times across 7 files: manual journal lines, bills, settlement import, budgets, the filed amount on a compliance obligation, the employer per-member rate and the approval threshold. In the manual journal the totals use the same function, so a debit and a credit both typed with commas both become ₦1.00, balance, and post as a ₦1.00 entry. A line typed as `abc` is dropped from the entry without a word, and the rest still posts.

**C2. Lists are cut off without saying so.** Live definitions checked:

| View | Limit | Silent? |
|---|---|---|
| General ledger, and "every posted entry" in the audit pack | 200 entries (newest first) | Yes |
| Finance audit log, and the audit pack's trail | 200 rows | Yes |
| Approval history, and the audit pack's approvals "in range" | the latest 100, filtered by date in the browser | Yes, older in-range approvals are dropped |
| Transactions lookup | 50 per patient | Yes |
| Partner statements | 50 | Yes |

Not biting yet: live counts today are 14 ledger entries this year, 0 finance audit rows in 30 days and 0 reviewed approvals. It becomes true as volume grows, and the audit pack is the place it would hurt.

**C3. Audit log page.** The `to` time is frozen when the page opens, so an action taken afterwards does not appear until reload. Clearing the date input throws `RangeError: Invalid time value` (`new Date("").toISOString()`) and takes the page down.

**C4. Budgets** are created in the currency of the *view* selector, not a currency chosen in the form.

**C5. Approval threshold** saves on blur with no confirmation, quietly ignores an invalid value, and re-saves an unchanged value every time the field is tabbed through. It is a four-eyes control.

**C6. Brittle bank match.** Payables finds bank accounts with `name.startsWith("Bank")` and matches the bill's currency by `name.includes(currency)`. Renaming an account empties the list.

## D. Actions with no confirmation

Immediate and irreversible from one click: remove a budget line, remove an employer billing config, "Undo" a filed obligation, "Ignore" a fraud signal, "Run recognition now" (posts journal entries). Void bill uses `window.prompt`. Pay and approve a bill, period lock and journal reversal already use a proper confirmation.

## Suggested order of work

1. **C1, the amount parser.** One shared function and one validation, 7 files. Reject text it cannot read, accept thousands separators, reject negatives where they make no sense, show the error. Highest value, smallest change.
2. **B, the two print packs.** Copy the investor pack's approach: a failed source blocks the pack or prints a banner. Gate Print while sections load. Fix the Lagos boundary.
3. **A1 to A5 (fraud, reconciliation, payables, compliance, audit log).** These are the "all clear" ticks and the deadline tracker. Same pattern as the overview and tax pages.
4. **A6 to A13 and the rest of C.** Mechanical once the pattern is in.
5. **C2, truncation.** A visible "showing the latest 200" line and a way to page, or the RPCs returning a count. Needs a decision, because the audit pack should probably never truncate.

Items 1 to 4 are front-end only. Item 5 may want a migration.
