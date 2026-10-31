# Group screening days: audit follow-up (2026-10-31)

Finding: nothing is missing to build. The design audit rows "Group screening days ... GATE ... Request form; clear" and "Testing days ... GATE" describe pages that exist and work. The "GATE" verdict means they show a "not open yet" or "part of Membership" line when a go-live guard or the membership check is off locally.

## What already exists
- Group screening days (a request model, not a calendar): migration `20260829003735_group_screening_days.sql`; web `apps/web/src/app/(dashboard)/patient/screening-days/` (page, panel, actions); `apps/web/src/lib/queries/screening-days.ts`; `apps/web/src/lib/billing/screening-day-checkout.ts`; mobile `apps/mobile/src/screens/sections/screening-days-screen.tsx`. A patient requests a day for a group; staff confirm price and headcount before anyone pays (Paystack, kobo).
- Testing days (scheduled events a member can book): migration `20261013004659_testing_days_employer_visits_point_of_care.sql`; web `patient/testing-days/` (list_testing_days, book, move, cancel, released point-of-care results); mobile `testing-days-screen.tsx`; reminder cron `api/cron/testing-day-reminders`; staff pages under `admin/testing-days`.

## Why no code was added
A list of upcoming days with a sign-up already exists as Testing days. A second list for group days would duplicate it, and group day pricing is set by staff per request, so there is no public price list to show.

## Open decisions for the founder
1. Should the "not open yet" states become a join-the-waitlist action, or should the page be hidden from navigation while its guard is off (audit S3)? This is a cross-cutting product choice, not specific to this feature.
2. Should group screening days stay request-only, or should staff publish fixed dates with a posted per-person naira price that patients can see before requesting? That needs real venues, partners and prices from you; none were invented here.
3. Should Free accounts see what Testing days include (tests and price) instead of only "part of Membership"?
