# Offline / Low-Bandwidth Resilience Audit

> **Status: audit + conservative fix, not a build order for offline-first architecture.** Scope was
> deliberately narrow — see §0. This is not a design/reconciliation doc for a future feature; it's a
> record of what was actually tested, what was found, and exactly what changed.

## 0. Why this exists

A competitive-intelligence pass on Medlitics (a Nigerian digital-health competitor) found that it
ships **no native app at all** — it bets its entire low-bandwidth strategy on an installable,
offline-first PWA. The recommendation coming out of that research was explicitly **not** to copy
that bet (`apps/web` + `apps/mobile` (React Native/Expo) is the right architecture for this platform
— see `CLAUDE.md`'s Architecture section; going PWA-only would be the wrong lesson to take from a
competitor whose whole reason for a PWA-only bet is that they *don't* have a native app). What the
finding does imply is narrower and worth checking on its own: a credible competitor treating
low-bandwidth resilience as a first-order architectural decision is a signal that it's a real, felt
constraint in the Nigerian market — so does `apps/web` itself degrade gracefully when the network
drops mid-session, independent of anything mobile-specific?

This document is that audit, plus the one fix it justified. Per the original brief: audit first,
fix conservatively, and explicitly do **not** build a full offline-write-queue for clinical data in
this pass (conflict resolution and sync-ordering guarantees are a much bigger commitment than
"handle a dropped connection without crashing or losing what the patient typed" — see §4).

## 1. What already existed (found, not built here)

`apps/web` was not offline-blank going into this audit:

- **`public/sw.js`** — a hand-rolled service worker (no `next-pwa`/Workbox/Serwist), registered in
  production only (`src/components/pwa/service-worker-registration.tsx`, `NODE_ENV === "production"`
  gate — a dev-mode SW would fight Next's HMR). It intercepts only navigation requests
  (`event.request.mode === "navigate"`) and falls back to a cached `public/offline.html` when the
  network fails. Its own header comment is explicit about why it goes no further: **it never caches
  pages, API responses, or any clinical data** — "stale vitals/escalations/results are a safety
  hazard." That's the correct call and this audit does not touch it.
- **`src/app/manifest.ts`** — a real Next file-convention PWA manifest (installable, standalone
  display). Its own doc comment ("No service worker on purpose…") is now stale relative to `sw.js`
  existing — `sw.js` was added later, for the offline-navigation-fallback + Web Push use case, not
  for asset caching in general. Worth a follow-up comment fix, not touched in this pass (out of
  scope — no functional effect).
- **Zero client-side connectivity detection anywhere** — no `navigator.onLine` read, no
  `online`/`offline` listener, no `useOnlineStatus`-shaped hook, unused or otherwise, in
  `apps/web/src` before this change. The app had no way to tell a signed-in patient or clinician
  "you're offline" as an ambient fact; it only ever surfaced connectivity indirectly, per-action, if
  and when a specific mutation happened to handle its own network failure well (see §2).
- **No toast/notification library** (`sonner`, `react-hot-toast`, etc.) is installed. The codebase's
  house pattern for a failure message is a shared, null-gated inline `<FormError role="alert">`
  (`src/components/ui/form-error.tsx`), and for a *persistent* (non-one-shot) state, a purpose-built
  inline banner mounted in `(dashboard)/layout.tsx` (`MfaNudgeBanner`, `ConsentNudgeBanner`,
  `PendingJobsBanner`, `PaymentFailureBanner`). Anything built here follows that convention rather
  than introducing a toast stack.

## 2. What a dropped connection actually did, before this change

Two representative, real patient-facing write paths were traced end to end against a network-level
failure (a thrown exception — a connection dropping mid-request — not a validation error or a
Postgrest-level rejection, both of which were already handled everywhere checked):

- **Vitals logging (`logVital`, `(dashboard)/patient/actions.ts`, a React 19 `useActionState` +
  Next.js Server Action)** — **silent-failure-to-crash, the real gap this audit found.** The function
  had no top-level `try/catch`. A Postgrest-level rejection on the insert itself *was* handled
  (`if (error) return { error: error.message }`), but `supabase.auth.getUser()`, the `profiles`
  lookup, and the insert call all do real network I/O first, and a dropped connection during any of
  them throws rather than resolving to a `{ data, error }` shape. An uncaught exception inside a
  Next.js Server Action propagates to the nearest `error.tsx` boundary —
  `(dashboard)/error.tsx` — which **unmounts the entire route segment**, including the form the
  patient had just filled in, and replaces it with a generic full-page "Oops" fallback. Because
  `VitalsForm`'s inputs are uncontrolled DOM elements (not React state), nothing preserved the typed
  reading through that unmount. This is the worst of the three outcomes the original brief asked
  about (silent failure / clear retryable error / queue for retry): it wasn't silent, but it was a
  crash that discarded the patient's input, which is worse than a same-page inline error would have
  been.
- **Care-team messaging (`usePostMessage`/`CareMessageThread`, a client-side TanStack Query
  mutation)** — **already correct, used here as the pattern to match.** `onError` shows an inline,
  `role="alert"` message ("We could not send that just then. Please try again.") via the same shared
  `FormError` component, and — because the draft `body` state is only cleared in `onSuccess` — a
  failed send (network or otherwise) leaves the typed message in the textarea for the patient to
  retry. No draft persistence beyond in-memory state (a full page reload during an outage still loses
  it), which is an acceptable, deliberately small gap — this pattern was not changed.

React Query itself (`(dashboard)/providers.tsx`) sets `queries.retry: 1` but leaves
`mutations.retry` at the library default of `0`, and configures no `networkMode`, no
`onlineManager`/`focusManager` usage, and no global `queryCache`/`mutationCache` error handler —
every mutation is individually responsible for its own error UX, which is exactly why the vitals gap
above existed unnoticed next to a correctly-handled messaging flow in the same codebase.

## 3. What changed

Three conservative, additive changes — no service worker changes (the existing one is already
correctly scoped, see §1), no new offline-write-queue, no change to any escalation/red-flag pipeline.
The first two exist because a network-level failure during `logVital` can happen at **two different
layers**, discovered only by reproducing each one live (see §5) — fixing just one left the other
still crashing the page:

1. **Server-side: `logVital` no longer crashes the dashboard segment when the SERVER's own call to
   Supabase fails mid-request** (`apps/web/src/app/(dashboard)/patient/actions.ts`). The body
   (everything past the Zod parse, which can't throw) was factored into `logVitalInner` and wrapped
   in a `try/catch` in `logVital` itself. A thrown exception here — a dropped/unstable connection
   between the Next.js server and Supabase being the realistic cause, since every *expected*
   Postgrest failure already returns a `{ error }` result instead of throwing — is now reported to
   Sentry (`Sentry.captureException`, matching the existing convention in
   `src/lib/audit/log-denied-action.ts`) and returned as a friendly, retryable `{ error }` shape the
   form already knows how to render inline via `FormError`. Regression test:
   `vitals-network-error.test.ts` (a rejected `auth.getUser()` call resolves to the retryable error
   rather than rejecting the whole action; a genuine validation failure is confirmed to still
   short-circuit before any network call and is not misreported as a connectivity issue).
2. **Client-side: `VitalsForm` no longer crashes when the BROWSER can't even reach the Next.js
   server at all** (`apps/web/src/app/(dashboard)/patient/vitals-form.tsx`,
   `logVitalWithConnectionFallback`). This is a genuinely separate failure mode from #1, found only
   by live-testing #1 (see §5) — a fully offline device rejects the Server Action's own client-side
   invocation *before* any server code runs at all (Next's client action-queue does this — see
   `node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js`,
   `fetchServerAction`'s `catch` block, which re-throws on a fetch rejection), and `useActionState`
   has no built-in recovery for that rejection — it also propagates straight to `error.tsx`. Fixed by
   wrapping the imported `logVital` in a plain client-side `try/catch` and passing that wrapper to
   `useActionState` instead of the raw action. Regression test:
   `vitals-form-connection-fallback.test.ts`.
3. **A visible "you're offline" signal, where there was none** —
   `src/lib/network/use-online-status.ts` (a small hook wrapping `navigator.onLine` +
   `online`/`offline` window events) and `src/components/shell/offline-banner.tsx` (a persistent,
   non-dismissible inline banner in the existing house style, mounted once in
   `(dashboard)/layout.tsx` alongside `MfaNudgeBanner`/`ConsentNudgeBanner`/`PendingJobsBanner`, so
   it's visible on every signed-in page for every role). `navigator.onLine` is a device-level signal,
   not a proof of real reachability to Supabase (documented in the hook's own comment) — it drives
   this banner only, nothing downstream skips a real request because of it.

**Important correction, found during live verification, not assumed:** none of the above preserves
the patient's *typed values* through a failed submission. React resets a `<form action={...}>`'s
uncontrolled inputs after **any** action completion — success or a returned `{ error }` state alike
— because from React's perspective the action didn't throw, it resolved. This is true of the
*pre-existing* validation-error path too (confirmed live, not just for the new network-failure path —
see §5), so it is not a regression introduced here. Every message this pass writes says only "check
your connection and try again," never that what was typed survives. Preserving the actual values
would require converting `VitalsForm`'s inputs from uncontrolled DOM state to React state — a
separate, form-wide change, listed as a follow-up in §4, not attempted in this pass. **What this pass
does still meaningfully fix**: the route segment stays mounted with the reading-type context intact,
so re-entering two or three numbers and pressing Save again is a small, same-page action — not a
full-page crash with a "Try again" link that reloads the whole dashboard shell.

All three changes: TypeScript strict, `pnpm typecheck` clean, `pnpm lint` clean, Jest coverage added
(`use-online-status.test.ts`, `offline-banner.test.tsx`, `vitals-network-error.test.ts`,
`vitals-form-connection-fallback.test.ts` — 11 new tests total, all passing, full suite of 292 suites
/ 2706 tests green), and verified live end-to-end against a real signed-in session (see §5).

**Found, deliberately not used: Next.js 16's own `experimental.useOffline` flag.** While tracing the
client-side failure above through Next's source, this repo's installed Next 16.3.3 turned out to ship
a real, if experimental, framework-level answer to exactly this problem —
`next/offline`'s `useOffline()` hook plus an `experimental.useOffline` config flag that makes the
router automatically poll for connectivity and **replay** a failed Server Action once it returns
(safe because, per the framework's own comment, "the fetch rejection means the request never reached
the server — there are no side effects to duplicate"). This would subsume both the crash-prevention
and a real "will retry" guarantee, for every Server Action and navigation in the app, in one flag.
Deliberately **not enabled here**: it is an experimental flag with a documented known limitation
(concurrent offline navigations can all replay at once) sitting on top of an already-bleeding-edge
Next.js version (`CLAUDE.md`'s own warning: "this Next.js has breaking changes vs. training data"),
and flipping it would change behaviour for every Server Action across the platform — including
clinical write paths (medication logging, symptom checks, escalation actions) this audit did not
individually re-verify — in one step. That's a bigger, less-reviewable change than this pass's own
"scope conservatively" brief allows. Worth a dedicated future evaluation (a founder/engineering
decision, not an audit-scope call) once it's had more time to mature upstream.

## 4. Explicitly not done in this pass (by design, per the original brief)

- **No offline write queue for clinical data.** Vitals, medications, symptom logs, etc. are not
  captured locally and replayed when connectivity returns. That's a materially larger commitment
  (conflict resolution, sync-ordering guarantees, and — the brief's own explicit guardrail — making
  sure a delayed-but-later-submitted dangerous reading still triggers the same real-time
  escalation/red-flag logic it would have if submitted live, not a quietly-delayed Category 2→1
  upgrade) than "don't crash and don't lose what's already typed." `apps/mobile` already has its own
  local-first offline vitals queue (`offline-vitals-queue.ts`) for a different reason (a genuinely
  disconnected mobile session) — that is not this audit's concern and was not touched.
- **No service-worker changes.** The existing navigation-only fallback + explicit no-clinical-data-
  caching stance (§1) is the right call and wasn't second-guessed here.
- **No platform-wide sweep of every mutation call site.** Only the two flows in §2 were traced end
  to end against a network-level failure. `OfflineBanner`'s copy is written to not overclaim beyond
  what was actually verified (§3, point 2) — a future pass that wants to claim "every form on this
  platform handles a dropped connection gracefully" would need to actually re-audit every Server
  Action and mutation hook, not just the two sampled here.
- **`src/app/manifest.ts`'s stale "No service worker on purpose" comment** was noticed but not fixed
  — it has no functional effect (the manifest and the service worker are independent), and touching
  it wasn't in scope for a resilience audit. Worth a one-line follow-up.
- **Preserving the patient's typed reading through a failed submission.** Found during verification
  (§3, §5) to be false for the *existing* validation-error path too, not just the new
  network-failure path — this is a pre-existing, form-wide React behaviour (uncontrolled inputs reset
  after any `<form action={...}>` completion), not something this pass introduced or could fix
  without converting `VitalsForm` to controlled inputs. That conversion is a reasonable, contained
  follow-up (one form, one component) but is a different kind of change (general form UX) than an
  offline-resilience audit, so it wasn't done here.
- **Next.js's own `experimental.useOffline` flag** (§3) — a real, more complete answer to the
  client-transport half of this problem, found but deliberately left off pending a dedicated
  evaluation; see §3 for the reasoning.

## 5. Verification

Verified against a real signed-in session (`patient.complete.test@tarragon.test`, via the QA magic-
link flow) on the running dev server, `/patient/vitals`.

**Methodology note:** a genuinely dropped connection has two distinct reproduction points, and each
needed a different technique — neither is exactly "DevTools offline mode," which would have blocked
*every* request indiscriminately (confirmed by trying it first: an unscoped `window.fetch` override
that rejected every POST also broke the session-heartbeat call and silently signed the test account
out mid-test, a useful reminder that a real network outage does exactly that too, just not in a way
this audit is trying to reproduce on purpose).

- **Server-side fix (§3.1):** exercised via the Jest regression test (`vitals-network-error.test.ts`)
  — mocking Supabase's `auth.getUser()` to reject is the direct, faithful way to reproduce "the
  server reached out to Supabase and that call failed," and doing it as a real browser test would
  require actually breaking the deployed Supabase connection, not something to do against a shared
  project.
- **Client-side fix (§3.2):** exercised live in the browser, twice. First attempt used a
  `window.fetch` override that rejected every `POST`, which reproduced the crash correctly but (as
  above) also broke the session by blocking heartbeat/tracking calls — a real finding about
  over-broad simulation, not about the fix. Second attempt scoped the override to only reject
  requests carrying the `Next-Action` header (the one that actually identifies a Server Action
  invocation), leaving every other request untouched: before the fix, submitting a blood-pressure
  reading (133/85) under this override reproduced the exact crash from §2 (`document.body` contained
  "Something didn't load properly", the whole route segment replaced); after the fix, the same
  submission left the form on screen with the inline retryable error
  `"Couldn't save that reading — check your connection and try again."` and no crash-page text
  anywhere in the DOM — screenshotted for the record. Restoring `window.fetch` and submitting again
  succeeded normally against the real Supabase project. This same live pass is what caught the false
  "what you typed is still here" claim (§3) — the systolic/diastolic inputs read back as empty
  strings after the failed submission, in both the network-failure case and, on a follow-up check, a
  plain validation-error case (systolic < diastolic) that never touched the network at all — proving
  it's a pre-existing form behaviour, not a regression from this change.
- **`OfflineBanner` (§3.3):** exercised live by defining `navigator.onLine` and dispatching real
  `window` `offline`/`online` events (the same events the hook listens for) — the banner appeared
  with the WifiOff icon and correct copy above the consent/MFA banners on `offline`, and disappeared
  within one render on `online`, screenshotted both states. Also covered by the automated
  `offline-banner.test.tsx` suite (hidden while online, accessible non-dismissible notice while
  offline via `jest-axe`, and reacts live to both events).
- **Care-team messaging (§2)** was re-read, not re-driven live in this pass — its existing behaviour
  was unchanged by anything in §3, and was already traced end-to-end in §2.
