# Superadmin console: audit and phased plan (2026-11-07)

Source: the founder's "Superadmin Dashboard Enterprise UX ... Enhancement Specification" (pasted 2026-11-07).
This file is Phase 1 of that spec (the audit). It records what exists, what conflicts with standing decisions,
and the order the work should land in. Nothing here is built yet.

Audited against `origin/main-dev` at the time of writing (the main checkout was 141 commits behind).

## 1. What exists today

| Area | What is there | Where |
| --- | --- | --- |
| Pages | 197 `page.tsx` under `/admin`, 56 top-level areas, 82 settings pages | `apps/web/src/app/(dashboard)/admin/` |
| Sidebar | 3 groups: an unlabelled top band (7 links), **"Operations" (86 links, one flat list)**, "Configuration" (1 link: Settings) | `lib/navigation.ts` `case "admin"` |
| Collapsible groups | Exists: labelled groups collapse to headings, open state kept in localStorage, the active group re-opens | `components/shell/app-shell.tsx` |
| Settings | 82 pages behind one Settings link, a 7-section tab bar | `admin/settings/layout.tsx`, `lib/admin-settings-nav` |
| Global search | ⌘K overlay. Pages: every reachable page, matched in the browser with extra keywords. Records: **staff and profiles only** | `lib/admin-search.ts`, `components/shell/admin-search.tsx`, `app/api/admin/search/route.ts` |
| Header | Notification bell, profile menu, theme toggle, environment badge (draws nothing on Production, a label on Preview and local) | `components/shell/` |
| Homepage | Attention hero (`attentionView` from shared), 4 KPI tiles (patients, active clinicians, 90-day revenue, open bookings), "All areas" tile grid, System status from `checkDependencies` | `admin/page.tsx` (718 lines) |
| Operations | Ops console, incidents, event bus, partner webhooks, chain health, providers, automation health, AI cost and monitoring, reliability, wall, desk | `admin/ops/*` |
| Security and governance | Security dashboard, access review, staff access review, data rights requests, data-breach incidents, account recovery | `admin/security`, `admin/access-review`, `admin/staff-access-review`, `admin/data-rights`, `admin/settings/data-breach-incidents` |
| Integrations | A settings page exists | `admin/settings/integrations` |
| Gates | Go-live guards (G-01: 9 masters plus features), platform modules, feature flags page | `admin/go-live`, `admin/settings/feature-flags`, `admin/settings/platform-modules` |
| Commercial | Memberships, catalogue and prices, organisation prices, promo codes, Membership discount codes, refund requests, payouts, earnings, sponsors, employers, access fund; finance console at `/finance` | `admin/*`, `finance/*` |

## 2. The real problems (what the spec is right about)

1. **Navigation.** 86 links in one "Operations" group is the main usability problem. Pages for payments, partners,
   outcomes, AI, security and settings sit side by side with no hierarchy. Several appear twice (Go-live guards and
   its "(view)", AI cost twice, ops links copied into three roles' menus).
2. **Record search is narrow.** ⌘K finds any page but only staff and profile records. No organisation, provider,
   branch, transaction, Membership, incident or audit event.
3. **The homepage answers "what needs me" but not "how is the platform doing".** Four tiles, no period selector,
   no previous-period comparison, no commercial split (free / Membership / sponsored / employer), no recent activity.
4. **No shared page frame.** Each admin page builds its own title, filters and table. Tables differ in paging,
   sorting, empty and error states.
5. **No single integrations view with evidence.** Health lives across `checkDependencies`, the event bus, partner
   webhooks and automation health; there is no one page per provider showing last success, last failure and errors.

## 3. Where the spec conflicts with standing decisions (these win; the spec is adjusted)

| Spec asks for | Standing decision | What we do |
| --- | --- | --- |
| WhatsApp Business, SMS integration pages | WhatsApp removed (F-02, 2026-09-30); SMS is phone verification only | Show Email (Resend), Push (Expo/VAPID), SMS (verification only). No WhatsApp anywhere |
| Flutterwave | Paystack is the only payment provider | Show Paystack only |
| Feature flag management with staged rollout | G-01: nine masters plus features, one gate per feature, no new flags | The "Feature flags" area **is** the go-live page. No staged-rollout control (nothing in the platform supports one) |
| MFA required for privileged users | SEC-01 (2026-11-05): staff MFA stays opt-in | Show MFA status per privileged account; do not enforce |
| Superadmin drills into any record | I9 and the privacy model: superadmin is not a clinical reader by default; Support view-as is audited | Search returns identity and account facts only, never clinical content. Links go to existing audited pages |
| "Membership ₦100,000, no Plus" | Check live `service_products` / Membership config before quoting any price | Read the price from the database; never hard-code it on the page |
| Restart services / alter infrastructure | Not supported | Not built |
| Separate staff app | S01d: staff areas move to `apps/console` one at a time; only `/ngo` has moved | Decision needed (Q1 below) |

## 4. Phased plan (one PR each, in this order)

**Phase 2a: navigation and page frame** (no data change, no migration)
- Regroup the admin sidebar into labelled, collapsible groups. Proposed groups, mapped only to pages that exist:
  Overview; People and access; Care delivery; Organisations and partners; Membership and money;
  Outcomes and analytics; Platform operations; Security and governance; Configuration.
- Remove duplicate entries; keep every page reachable (a test asserts every current href is still in the nav or
  in Settings, so nothing silently drops out).
- Icon-only collapsed sidebar with tooltips (desktop), breadcrumbs from the nav tree.
- A shared `AdminPageHeader` (title, one-line description, primary actions) and `DataTable` frame (search, filters,
  sort, server paging, total count, empty and error states). Adopt on the 5 busiest pages first, the rest move as touched.

**Phase 2b: homepage**
- Period selector (today, 7, 30, 90 days, year to date), last-updated time, live vs historical clearly separated.
- Keep the attention hero; group items Critical / High / Needs attention / Information with a link to each record.
- 8 to 10 KPIs with previous-period comparison, each with its definition and a link to the underlying list:
  registered users, active patients, active clinicians, new registrations, active Memberships, renewal rate (with
  numerator and denominator), gross collected, refunds, net collected, failed notifications, failed jobs.
- Commercial split: Free / Membership / employer-sponsored / individually sponsored.
- System health with five states (operational, degraded, failed, unknown, not configured) from real checks only.
- Recent activity from the existing audit tables, no clinical content.
- Money figures come from the existing finance readers (`analytics_clean`, test data excluded), never a new sum.

**Phase 2c: record search**
- Extend `/api/admin/search` to organisations, facilities and branches, diagnostic directory entries, Memberships,
  payments (by Paystack reference), sponsors and employers, incidents, and audit events.
- Recent searches and recently viewed records (per viewer).
- Every result scoped by the caller's own RLS session (never the service-role client), with a Jest test proving a
  non-admin gets nothing back.

**Phase 2d: integrations centre**
- One page listing each configured provider (Paystack, Resend, Expo push, Termii verification, Zoom, Google Maps,
  Anthropic, ClamAV, Supabase storage) with last success, last failure, recent error count, webhook status, last check.
- "Test connection" only where a safe read-only probe exists. No secret is ever sent to the browser.

**Phase 3: module pages** (users, organisations and providers, Memberships and payments, security and audit log)
moved onto the shared frame with detail pages in tabs. Each is its own PR.

**Phase 4: reports** (exports, data freshness, metric definitions) and the test pass in the spec's section 21.

## 5. Founder decisions (2026-11-07)

- Q1: build in `apps/web` `/admin` now, shaped so a later move to `apps/console` is a plain move.
- Q2: sidebar regroup approved, including "More in this group" for less-used links.
- Q3: keep the current brand (Tarragon Green, Clinical Navy, current font); denser tables, page headers and breadcrumbs.
  No new colours or fonts.
- Q4: after the sidebar and page frame, the homepage ships first, then record search, then the integrations centre.

## 6. Progress

- **2a-1 sidebar regroup: done** (this branch). One unlabelled top band plus eight labelled groups. All 84 previous
  links kept; six admin pages that had no link gained one (Security, Record access review, Staff access review,
  Assisted account recovery, Task types and priorities, Refund requests). The group first drafted as "Clinical
  operations" is named "Care delivery" because the old name pulled every page in the group into a search for the
  `clinical_operations_enabled` master switch and pushed the go-live page off the results. `lib/admin-console-nav.test.ts`
  pins every link.
- **2a-2 icon-only sidebar and breadcrumbs: done** (this branch). Admin only, through `AppShell`'s `consoleChrome`;
  every other role's shell is unchanged. "Collapse menu" folds the desktop sidebar to a 64px rail
  (`components/shell/nav-rail.tsx`): the top band's links as icons, then one icon per group. A group icon unfolds the
  sidebar with that group open rather than jumping to one of its pages. Each icon has an accessible name and a label on
  hover and keyboard focus. The fold is remembered per browser (localStorage, read safely; the server always draws the
  sidebar unfolded, so a folded sidebar unfolds for one frame on first load). Breadcrumbs (home, group, page) come from
  the same nav tree (`lib/navigation-breadcrumbs.ts`) and are hidden on phones. Tests: `navigation-breadcrumbs.test.ts`,
  `nav-rail.test.tsx` (including an axe check).
- **2a-3 page frame: done** (branch `feat/superadmin-page-frame`, stacked on 2a-1/2a-2).
  - Header: no new component. The shared `PageHeader` (`@tarragon/ui`) already had title, description, actions and a
    back link and was used by 128 of 197 admin pages; the bare titles on Patients, Security, Staff access review, both
    AI cost pages, the partner chase list and the access history page now use it too. About 30 others remain and move
    as they are touched.
  - Table: `DataTable` (`@tarragon/ui/components/data-table`, pure rules in `data-table-model.ts`), lifted from the
    patient directory. Rows carry pre-rendered cells so a Server Component can pass them. Client mode searches, sorts
    and pages itself; server mode hands sort and page to the caller. Sticky header, sortable headers with
    `aria-sort`, missing values sort last both ways, numbers sort as numbers, count line, empty and error states.
  - Moved onto it: patient directory (server mode), AI cost by month, AI cost per feature (cost deliberately not
    sortable: rows can be in different currencies), partner chase list (keeps the loader's stalest-first order), and
    all three lists on "Who holds which access". Community pages keep their own style module for now (a separate
    decision).
  - Second batch: event bus (subscribers; deliveries sort only the database page in hand and say "on this page",
    since that list is cursor-paged with an "older" link), partner webhooks (endpoints and the event map), payment,
    video and email providers (health, settlement breaks with the difference sorted by size, payout postings that need
    finance, the event inbox), the lab and imaging directory, follow-ups, and doctor caseload (caseload and
    utilisation). Sorting by status puts what needs attention first (down providers, dead deliveries, switched-off
    endpoints). The free-text fields inside row forms on the providers page gained labels; they had placeholders only.
  - Twelve more list pages moved to `PageHeader` (patient directory, clinical sign-off, sign-up invites, translations,
    automation health, automations, lab and imaging directory and its import page, AI monitoring, directory freshness,
    Community Access Fund). Left on purpose: the 12 Community pages, the dashboard (2b), the settings tab bar, the AI
    governance console (its header block carries a long scoping note) and record detail pages (phase 3).
  - Third batch: the exception queue (worst first, from the queue's own rank; a failed filter says "Not loaded", never
    the empty-domain wording), both health-education reports (the emoji thumbs headings became "Helpful" and "Not
    helpful" for screen readers; quiz score sorts as a share of its total), provider quality (metric health, and the
    provider list), service margins,
    alert types, result release policies, the vaccination schedule, mental-health screening cadence, quality-policy
    metrics (arrows became "higher/lower is better"), and promo codes (expiry now shown in Lagos time).
  - Review fix: in client mode the table keeps every row mounted and hides the ones a search or page leaves out, so
    in-row state survives (a rotated signing key shown once on Partner webhooks, a half-typed break note or lift
    reason). Tested, with a sabotage run. The count line is announced to screen readers once typing pauses.
  - Left as they are, on purpose: the escalation SLA table (CMO-signed, and its number boxes are fields of one form, so
    filtering or paging would unmount some and drop them from the save), reward rules (a row component with its own
    controls), the patient merge preview and the broadcast composer (small, inside a multi-step tool), and the three
    Community files. Seven files in all.
  - Also: the three small items from 2a-2's second review (one roll-up rule for the badge mark and words; one badge
    lookup per link; a count shared by two links counted once on its group icon, with a sabotage-checked test).
- **2b homepage: done** (branch `feat/superadmin-homepage`, stacked on 2a-3).
  - New read-only database function `analytics_platform_overview(from, to)` (migration
    `20261107023802_analytics_platform_overview.sql`): the chosen window and the equal-length window before it, plus
    a live snapshot. Analyst/admin only, refused callers get 42501 (never zeros), test data left out. Proof:
    `packages/db/tests/analytics_platform_overview.sql` (15 checks measured as differences from fixtures, sabotage
    included); the console-wide gate test now covers it too. Both run green on a fresh local replay.
  - Money definition: **collected** = Paystack-confirmed money in naira from the two places a confirmed charge is
    recorded, which never overlap: `payments` with status `success` for catalogue orders (the current checkout,
    Membership included, by `verified_at`, `total_kobo`) and `payment_transactions` `charge.success` for every other
    route (the webhook returns from its order branch before writing `payment_transactions`). A row with no currency is
    left out, never assumed to be naira. **Refunded** = `payment_transactions` `refund.processed`, the complete,
    de-duplicated refund record (order refunds included). **Net** = collected minus refunded. **Failed payments** =
    failed charge events plus catalogue orders that moved to `failed`. Not recognised revenue and not orders placed.
    Every definition is on the page. (The first draft read only `payment_transactions` and would have missed every
    Membership purchase; the review caught it before the PR.)
  - Page: header with Lagos-time "updated" and refresh, a period picker (today, 7, 30, 90 days, year to date), the
    attention panel, nine figures each against the previous window (colour by whether the change is good, the arrow
    by direction, a rise from zero shows the old figure), Free and Membership by who pays with shares and the number
    ending in 30 days, the live operations tiles, all areas, and system health in five states with the evidence each
    rests on (a key that is merely set is "Unknown", never "Operational"). The gradient welcome banner is gone.
  - Not in this PR: a custom date range, recent activity (the audit log carries patient-record views, so it needs a
    curated list of administrative events first), trend charts, and Paystack health from real webhook evidence.
  - Also: DataTable announces its count only after the reader searches, sorts or pages (the 2a-3 second review item).

- **2c record search: done** (branch `feat/superadmin-record-search`, stacked on 2b).
  - ⌘K now also finds, for the admin: employers (corporate organisations), sponsor programmes (name, code or sponsor),
    lab and imaging providers, incidents (reference or title), and checkout orders by Paystack reference (only a
    term that looks like a reference is looked up, and only on the reference column, so a name never pulls up anyone's
    payments). `lib/admin-search-records.ts`.
  - Every record read goes through the admin's own session, so the database's row rules decide what comes back (the
    service-role client is not used for any new group). A result is an identity line and a link to the page that
    already shows the record behind its own gate; an order opens the admin Patients page for the person it was for.
    Nothing clinical is returned. A source that fails is reported in the box rather than shown as a shorter list.
  - The matched words are highlighted in each result title; the failure note now says part of the search is missing
    (not "only pages are shown", which was wrong once some groups load).
  - Not yet: recent searches and recently viewed records, Memberships as their own group (they are reached through the
    patient), audit events (need the same curated admin-event list as the homepage's recent activity), and a direct name
    search for sponsor programmes and directory providers (today both small lists are read whole and filtered, fine at
    current size, worth an indexed lookup as they grow).
