# Mobile native-conversion scope docs — SUPERSEDED, kept for design rationale only

**Status as of 2026-09-08: done.** All six sections these docs describe as
pending (`health-check`, `healthy-ageing`, `womens-health`, `sexual-health`,
`wellness`, `family`) shipped across four same-week commits —
`4ffe7c3b`/PR #508 (healthy-ageing, wellness, health-check, womens-health top
level), `698dbc24`/PR #511 (a further 9 sections including receipts,
notification-settings, technical-support, health-summary, find-a-specialist,
screening-days, financial-profile), `041ca1f0` (lifestyle coaching, my
services), and `b5d236b6` ("Eliminate remaining embedded WebViews from the
mobile app" — medications, vitals/symptoms, labs, care & support, settings/
profile, supporting, family, women's-health cycle tracking). The
`react-native-webview` package, `webview-hub-screen.tsx`, and `sections.ts`'s
`webviewPath` field this README's "established pattern" section refers to
below no longer exist anywhere in `apps/mobile` — there is no more
WebView-wrapped section left to convert. (This correction was made because a
squash-merge commit message for #511 misattributed which screens it
converted — see `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`'s 2026-09-08 entry.)

**Before touching anything named in these docs as "not yet done," read the
actual current screen file first** — several individual "Stay WebView" lists
inside the six docs below are now stale (e.g. `family.md`'s once described
the activity log and audit trail as staying WebView; `family-screen.tsx`
renders both natively today). Where a doc below is still accurate — e.g. the
reproductive-health safety notes in `womens-health.md`/`sexual-health.md`,
or a design rationale for why a specific flow is a browser hand-off rather
than a native rebuild — it remains useful as historical context. Treat the
"Files" table's implied pending-work status and the "Already done" list
below as both obsolete: everything in this folder's scope is done.

---

These six files were handoff specs for converting the (at the time)
remaining WebView-only patient sections in `apps/mobile` to fully native
screens, one at a time. Each was self-contained — paste the **entire
contents of one file** as your first message in a fresh Claude Code session
working in this repo, and it had everything needed to start building without
any other context.

## How to use one of these

1. Open a new Claude Code session in this repo (or a fresh worktree off
   `main-dev` — recommended given how many of these touch shared files like
   `apps/mobile/src/lib/sections.ts` and `apps/mobile/src/screens/home-shell.tsx`).
2. Paste the full contents of the one file you want done.
3. Claude Code should read the exact reference files named in the doc
   (`weight-management.ts`/`weight-management-screen.tsx`,
   `wellbeing.ts`/`wellbeing-screen.tsx`, and the `/api/mobile/*` route
   examples) before writing anything, since those establish the house
   pattern every new section should match.
4. Verify with `tsc --noEmit` and `eslint` on both `apps/web` and
   `apps/mobile` before considering a section done, same as every other
   section built this way so far.

## Already done (reference implementations, do not redo)

- Weight management — `apps/mobile/src/lib/weight-management.ts` +
  `apps/mobile/src/screens/sections/weight-management-screen.tsx` +
  `apps/web/src/app/api/mobile/lifestyle/{enroll,ed-screen-enroll,log}/route.ts`
- Wellbeing — `apps/mobile/src/lib/{wellbeing,mental-health}.ts` +
  `apps/mobile/src/screens/sections/wellbeing-screen.tsx` +
  `apps/web/src/app/api/mobile/mental-health-screen/route.ts`
- Receipts, Notification Settings, Technical Support, Health Summary, Find a
  Specialist, Group Screening Days, Your Finances — all fully native, no new
  API routes needed for any of these.
- Everything else without a scope doc here (Women's Health/Sexual
  Health/Family excepted — see their own files) is still on the
  `WebViewHubScreen` hybrid pattern (native header/chrome, the actual web
  page opens in a contained modal) — see
  `apps/mobile/src/screens/sections/webview-hub-screen.tsx`.

## The established pattern (all six docs assume this — read it once)

- `apps/mobile/src/lib/sections.ts`: a `SectionId` union + `SECTIONS` array
  (id, label, icon, group, optional `webviewPath`). Removing `webviewPath`
  from an entry is what flips it from WebView to native.
- `apps/mobile/src/screens/home-shell.tsx`: renders
  `{section === "xyz" && <XyzScreen ... />}` per section, and resolves
  `subjectId` (acting-for aware) vs `userId` (device owner only) per
  section based on the underlying tables' actual RLS — never guessed, see
  each doc's own finding on this.
- Plain RLS-scoped reads/writes (patient's own row, ordinary RLS policy, no
  service-role client, no clinical scoring) go directly from the mobile
  Supabase client, wrapped in the `QueryResult<T> = { ok: true; data: T } |
  { ok: false; error: string }` shape used throughout `apps/mobile/src/lib/*.ts`.
- Anything using a service-role client server-side, or running
  scoring/red-flag/crisis-detection/consent-gating logic that must never be
  duplicated client-side, or otherwise `"use server"`-only with no RPC
  equivalent: gets a new bearer-token-authenticated route under
  `apps/web/src/app/api/mobile/<feature>/route.ts` that is a **thin,
  verbatim wrapper** around the exact existing server function — never a
  reimplementation. Auth pattern: `createBearerClient(accessToken)` from
  `apps/web/src/lib/supabase/bearer.ts`, then
  `supabase.auth.getUser(accessToken)`.
- Mobile calls those routes via `apps/mobile/src/lib/api.ts`'s shared
  `request<T>()` helper.
- A real Paystack checkout/payment step is never rebuilt natively — it opens
  the equivalent web page in the system browser
  (`WebBrowser.openBrowserAsync`), same pattern as Screening Days' "Pay" and
  Financial Profile's "Pay my share".
- `reproductive_health`/menstrual/pregnancy/fertility/contraception data has
  a documented history of RLS mistakes from copying a sibling table's
  policy shape — the Women's Health and Sexual Health docs each have a
  dedicated safety-notes section on this; read it before writing any code
  touching those tables, and never invent a new access-control shape for
  them.
- Learn and Privacy stay WebView-only, permanently, per explicit founder
  instruction — never port either.

## Files

| Doc | Section id | Size | New API routes needed |
|---|---|---|---|
| `health-check.md` | `healthCheck` | ~2,700 web lines, mostly link-outs | 1 (video-consult confirm) |
| `healthy-ageing.md` | `healthyAgeing` | ~1,070 web lines | 0 |
| `womens-health.md` | `womensHealth` | ~4,100 web lines (cards + cycle tracker) | 0 |
| `sexual-health.md` | `sexualHealth` | ~2,500 web lines | 3 (risk-check, fertility, sexual-wellness screen) |
| `wellness.md` | `wellness` | ~750 web lines | 0 |
| `family.md` | `family` | ~3,500 web lines | 3 (add-child, add-elder-proxy, claim-dependent) |

Recommended order if going one at a time: Healthy Ageing → Wellness →
Health Check → Women's Health → Family → Sexual Health (roughly
smallest/lowest-risk to largest/most sensitive).
