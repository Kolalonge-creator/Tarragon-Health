# Offline / Low-Bandwidth Resilience Audit

> **Status: audit + conservative fix, not a build order for offline-first architecture.** Scope was
> deliberately narrow — see §0. This is not a design/reconciliation doc for a future feature; it's a
> record of what was actually tested, what was found (including one dead end, kept rather than
> deleted from the record — see §6), and exactly what changed.

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

This document is that audit, plus the fixes it justified. Per the original brief: audit first, fix
conservatively, and explicitly do **not** build a full offline-write-queue for clinical data in this
pass (conflict resolution and sync-ordering guarantees are a much bigger commitment than "handle a
dropped connection without crashing" — see §4).

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
  patient had just filled in, and replaces it with a generic full-page "Oops" fallback. This is the
  worst of the three outcomes the original brief asked about (silent failure / clear retryable error /
  queue for retry): it wasn't silent, but it was a crash, which is worse than a same-page inline error
  would have been.
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

A network failure during `logVital` can happen at **two different layers** — the browser can't reach
the Next.js server at all, or the server reaches out to Supabase and that call fails — and each layer
needed a genuinely different fix, discovered only by reproducing both live (see §5 and §6 for the
first, wrong attempt at the client-side one).

1. **Server-side: `logVital` no longer crashes the dashboard segment when the SERVER's own call to
   Supabase fails mid-request** (`apps/web/src/app/(dashboard)/patient/actions.ts`). The body
   (everything past the Zod parse, which can't throw) was factored into `logVitalInner` and wrapped
   in a `try/catch` in `logVital` itself. A thrown exception here — a dropped/unstable connection
   between the Next.js server and Supabase being the realistic cause, since every *expected*
   Postgrest failure already returns a `{ error }` result instead of throwing — is now reported to
   Sentry (`Sentry.captureException`, matching the existing convention in
   `src/lib/audit/log-denied-action.ts`) and returned as a friendly, retryable `{ error }` shape the
   form already knows how to render inline via `FormError`. Regression test:
   `vitals-network-error.test.ts`.
2. **Same file, a second, narrower bug found and fixed in the same pass: a failure AFTER a
   successful insert was misreported as "couldn't save."** `logVitalInner`'s original body ran several
   `assess*BestEffort` calls (BP control, heart rate, glucose red-flag) and `recordWeeklyPlanProgress`
   immediately after the insert succeeded, all inside the same try/catch as the insert itself. Those
   helpers are documented "never throws," but that contract isn't literally enforced — three of the
   four (`assessBpControlBestEffort`, `assessHeartRateBestEffort`, `assessGlucoseBestEffort`) await a
   Supabase call directly with no internal try/catch of their own (confirmed by reading each). A
   network drop in that narrow post-insert window was therefore caught by the SAME outer catch as a
   pre-insert failure and reported as "Couldn't save that reading" — false, since the row was already
   committed, and a real risk of a duplicate insert if the patient believed the message and retried.
   Fixed with a second, inner try/catch scoped to exactly that post-insert tail: a failure there is
   reported to Sentry (`stage: "post_insert_best_effort"`) but still returns `{ success: true }`, the
   correct signal. Regression test: `vitals-post-insert-best-effort-failure.test.ts` (sabotage-tested:
   confirmed to fail without the fix, see its own comment).
3. **Client-side: `VitalsForm` no longer attempts a submission the browser already knows is
   doomed** (`apps/web/src/app/(dashboard)/patient/vitals-form.tsx`). `handleSubmit` now checks
   `useOnlineStatus()` before anything else and, if offline, calls `event.preventDefault()` and shows
   an inline "You're offline — reconnect, then press Save reading again" message instead of letting
   the submission reach `formAction` at all. **This is a pre-submit guard, not a wrapper around the
   action** — `useActionState(logVital, undefined)` still receives the real, unwrapped Server Action
   reference. That distinction matters and is the direct lesson from §6: an earlier version of this
   fix wrapped `logVital` in a local `try/catch` and passed that wrapper to `useActionState` instead,
   which silently broke this form's no-JS/pre-hydration submission fallback. `navigator.onLine` is a
   device-level signal, not proof of real reachability (documented in the hook's own comment) — a
   connection that drops in the narrow window between this check and the request actually going out
   is still possible, and is what fix #1 above exists for. This narrows, but does not close, the
   client-transport gap — see §4. Regression test: `vitals-form-offline-guard.test.ts`.
4. **A visible "you're offline" signal, where there was none** —
   `src/lib/network/use-online-status.ts` (a small hook wrapping `navigator.onLine` +
   `online`/`offline` window events) and `src/components/shell/offline-banner.tsx` (a persistent,
   non-dismissible inline banner in the existing house style, mounted once in
   `(dashboard)/layout.tsx` alongside `MfaNudgeBanner`/`ConsentNudgeBanner`/`PendingJobsBanner`, so
   it's visible on every signed-in page for every role, and reused by fix #3's guard above).
   `navigator.onLine` is a device-level signal, not a proof of real reachability to Supabase — it
   drives this banner (and the pre-submit guard) only; nothing skips a real request because of it.

**Important correction, found during live verification, not assumed:** none of the above preserves
the patient's *typed values* through a failed submission that DOES reach the action (fixes #1/#2's
territory — #3 pre-empts the attempt entirely, so nothing is lost there by construction). React
resets a `<form action={...}>`'s uncontrolled inputs after **any** action completion — success or a
returned `{ error }` state alike — because from React's perspective the action didn't throw, it
resolved. This is true of the *pre-existing* validation-error path too (confirmed live, not just for
the new network-failure path — see §5), so it is not a regression introduced here. Every message this
pass writes says only "check your connection and try again," never that what was typed survives.
Preserving the actual values would require converting `VitalsForm`'s inputs from uncontrolled DOM
state to React state — a separate, form-wide change, listed as a follow-up in §4, not attempted in
this pass.

All changes: TypeScript strict, `pnpm typecheck` clean, `pnpm lint` clean, full Jest suite green (293
suites / 2706 tests), and verified live end-to-end against a real signed-in session (see §5).

**Found, deliberately not used: Next.js 16's own `experimental.useOffline` flag.** While tracing the
client-side failure through Next's source, this repo's installed Next 16.3.3 turned out to ship a
real, if experimental, framework-level answer to exactly this problem — `next/offline`'s
`useOffline()` hook plus an `experimental.useOffline` config flag that makes the router automatically
poll for connectivity and **replay** a failed Server Action once it returns (safe because, per the
framework's own comment, "the fetch rejection means the request never reached the server — there are
no side effects to duplicate"). Checked directly against the flag's own implementation
(`next/dist/client/components/offline.js`, `use-offline.js`): the read-only `useOffline()` signal and
the auto-retry behaviour are **not separable** — `useOffline()` only ever updates when
`checkOfflineError()` runs, which is itself gated behind the same `process.env.__NEXT_USE_OFFLINE`
flag as the retry logic, so there is no way to get the more-accurate connectivity signal alone
without also opting the whole app into the router-level replay behaviour. Deliberately **not enabled
here**: it is an experimental flag with a documented known limitation (concurrent offline navigations
can all replay at once) sitting on top of an already-bleeding-edge Next.js version (`CLAUDE.md`'s own
warning: "this Next.js has breaking changes vs. training data"), and flipping it would change
behaviour for every Server Action across the platform — including clinical write paths (medication
logging, symptom checks, escalation actions) this audit did not individually re-verify — in one step.
That's a bigger, less-reviewable change than this pass's own "scope conservatively" brief allows.
Worth a dedicated future evaluation (a founder/engineering decision, not an audit-scope call) once
it's had more time to mature upstream.

## 4. Explicitly not done in this pass (by design, per the original brief, or found and deliberately
deferred)

- **No offline write queue for clinical data.** Vitals, medications, symptom logs, etc. are not
  captured locally and replayed when connectivity returns. That's a materially larger commitment
  (conflict resolution, sync-ordering guarantees, and — the brief's own explicit guardrail — making
  sure a delayed-but-later-submitted dangerous reading still triggers the same real-time
  escalation/red-flag logic it would have if submitted live, not a quietly-delayed Category 2→1
  upgrade) than "don't crash." `apps/mobile` already has its own local-first offline vitals queue
  (`offline-vitals-queue.ts`) for a different reason (a genuinely disconnected mobile session) — that
  is not this audit's concern and was not touched.
- **No service-worker changes.** The existing navigation-only fallback + explicit no-clinical-data-
  caching stance (§1) is the right call and wasn't second-guessed here.
- **No platform-wide sweep of every mutation call site.** Only the two flows in §2 were traced end to
  end against a network-level failure, and only `logVital`/`VitalsForm` were fixed. A `grep -rln
  "useActionState(" apps/web/src` turns up roughly 90 files / 113 call sites total (login, signup,
  checkout, onboarding, every clinician review form, etc.) — every one of them is structurally exposed
  to the SAME two-layer crash class this audit found and fixed for vitals alone, unless already
  independently guarded. `OfflineBanner`'s copy is written to not overclaim beyond what was actually
  verified — it's an ambient signal, not a guarantee that every form on the platform already handles a
  dropped connection gracefully. **The more general fix this audit did NOT make**: the dashboard's
  shared `error.tsx` boundary (untouched by this diff) is the one place a fix would automatically
  cover every present and future Server-Action-backed form — detecting a network-error shape there
  (e.g. `TypeError: Failed to fetch`) and rendering a "connection lost, try again" message instead of
  the generic "Oops" fallback, rather than requiring every individual form to opt in with its own
  local guard the way vitals now does. That's a reasonable, contained follow-up (one file) worth a
  deliberate future pass — not attempted here because it's a shared boundary touching every route in
  the app, a bigger blast radius than this pass's per-form, individually-tested approach.
- **`src/app/manifest.ts`'s stale "No service worker on purpose" comment** was noticed but not fixed
  — it has no functional effect (the manifest and the service worker are independent), and touching
  it wasn't in scope for a resilience audit. Worth a one-line follow-up.
- **Preserving the patient's typed reading through a failed submission that reaches the action.**
  Found during verification (§3, §5) to be false for the *existing* validation-error path too, not
  just the new network-failure path — this is a pre-existing, form-wide React behaviour (uncontrolled
  inputs reset after any `<form action={...}>` completion), not something this pass introduced or
  could fix without converting `VitalsForm` to controlled inputs. That conversion is a reasonable,
  contained follow-up (one form, one component) but is a different kind of change (general form UX)
  than an offline-resilience audit, so it wasn't done here.
- **Next.js's own `experimental.useOffline` flag** (§3) — a real, more complete answer to the
  client-transport half of this problem, found but deliberately left off pending a dedicated
  evaluation; see §3 for the reasoning, including why its retry behaviour can't be adopted piecemeal.
- **The residual client-transport race window.** Fix #3 (§3) blocks a submission when the browser
  already knows it's offline, and fix #1 catches a failure once the server has been reached — the gap
  between them (connectivity drops in the instant between the pre-submit check and the request
  actually leaving the browser) is real but narrow, and is the same class of race the framework-level
  `experimental.useOffline` flag would close if adopted later.

## 5. Verification

Verified against a real signed-in session (`patient.complete.test@tarragon.test`, via the QA magic-
link flow) on the running dev server, `/patient/vitals`, across two separate verification passes (the
second one after the redesign in §6).

**Methodology note:** a genuinely dropped connection has more than one distinct reproduction point,
and each needed a different technique — none of them is exactly "DevTools offline mode," which would
block *every* request indiscriminately (confirmed by trying it first: an unscoped `window.fetch`
override that rejected every POST also broke the session-heartbeat call and silently signed the test
account out mid-test — a useful reminder that a real network outage does exactly that too, just not
in a way this audit is trying to reproduce on purpose).

- **Fix #1 (server-side, post-insert included):** exercised via the Jest regression tests
  (`vitals-network-error.test.ts`, `vitals-post-insert-best-effort-failure.test.ts`) — mocking
  Supabase's `auth.getUser()` or a specific `assess*BestEffort` helper to reject is the direct,
  faithful way to reproduce each failure point, and doing either as a real browser test would require
  actually breaking the deployed Supabase connection, not something to do against a shared project.
  Both tests were sabotage-tested (temporarily reverted the corresponding try/catch, confirmed the
  test fails, restored the fix).
- **Fix #3 (client-side pre-submit guard), final version:** exercised live in the browser, in the
  redesigned form. First, confirmed the vitals form's raw `action` attribute matches every other
  genuine Server-Action-backed form on the same page (`action="" method="POST"` — a real Server
  Reference, not the `action="javascript:throw new Error(...)"` poison-pill React emits for a plain
  client function, which is what the earlier, reverted wrapper approach produced — see §6). Then, with
  `navigator.onLine` set false and a real `offline` event dispatched: filled the blood-pressure
  fields, clicked Save, and confirmed via an intercepted `window.fetch` that **no request carrying the
  `Next-Action` header was ever sent** — the guard blocked it before any network attempt — while the
  inline "You're offline — reconnect, then press Save reading again" message appeared and the typed
  values remained in the inputs (never touched, since the action never ran). Then, with `navigator.onLine`
  set back to true and a real `online` event dispatched, clicked Save again: the submission reached the
  real Supabase project normally and "Reading logged." appeared, screenshotted at each step.
- **`OfflineBanner` (§3.4):** exercised live by defining `navigator.onLine` and dispatching real
  `window` `offline`/`online` events (the same events the hook listens for) — the banner appeared with
  the WifiOff icon and correct copy above the consent/MFA banners on `offline`, and disappeared within
  one render on `online`, screenshotted both states. Also covered by the automated
  `offline-banner.test.tsx` suite (hidden while online, accessible non-dismissible notice while
  offline via `jest-axe`, and reacts live to both events).
- **Care-team messaging (§2)** was re-read, not re-driven live in this pass — its existing behaviour
  was unchanged by anything in §3, and was already traced end-to-end in §2.

## 6. A dead end, kept in the record on purpose: wrapping the action broke progressive enhancement

The first version of fix #3 (§3) was a client-side `try/catch` wrapper —
`logVitalWithConnectionFallback(prevState, formData) { try { return await logVital(...) } catch { return { error: "..." } } }`
— passed to `useActionState` **instead of** `logVital` directly. It worked exactly as intended for the
failure it targeted: a scoped `window.fetch` override that rejected only requests carrying the
`Next-Action` header (the real invocation, isolated from heartbeat/tracking POSTs — see §5's
methodology note) reproduced the crash from §2 before the fix and the correct inline retry message
after it, with no crash-page text anywhere in the DOM, live in the browser against a real session.

**What it broke, found only by continuing to verify after it "worked":** inspecting the rendered
`<form>`'s raw `action` attribute showed `action="javascript:throw new Error('React form unexpectedly
submitted.')"` — React's own deliberate poison-pill for a form whose `action` prop is a plain client
function rather than a genuine Server Reference (a "use server" export invoked directly). Per Next's
bundled docs (`node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`: "In Client
Components, forms invoking Server Actions will queue submissions if JavaScript isn't loaded yet, and
will be prioritized for hydration") and its source
(`node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js`), that
queueing depends on the form's `action` being the real reference. Wrapping it in a local function —
even one that calls the real action internally — loses that. The practical consequence: on the exact
slow-connection audience this whole audit is FOR, a patient submitting the form before the JS bundle
finishes hydrating would previously have had their submission queued and resolved once hydration
completed; with the wrapper, the browser instead evaluates the poison-pill `javascript:` URI and the
submission silently does nothing — a worse, and more ironic, failure than the crash this pass set out
to fix, for the audience it was written for.

No error-boundary infrastructure exists anywhere in this codebase (`react-error-boundary` is not a
dependency; no hand-rolled `componentDidCatch` component exists) to fall back to, and building one
from scratch — the only way to keep the wrapper approach while containing its blast radius to a local
boundary instead of the shared `error.tsx` — was judged more architecture than "scope conservatively"
allows for an audit fix. **Resolution:** dropped the wrapper entirely, kept `logVital` passed to
`useActionState` unwrapped (restoring the real Server Reference and progressive enhancement), and
replaced it with the pre-submit guard described as fix #3 in §3 — which needs no wrapper, no error
boundary, and no framework-level opt-in, at the cost of not catching the narrower race window where
connectivity drops between the guard's check and the request actually leaving the browser (§4).

This is recorded here rather than quietly edited out of the diff's history because the lesson
generalises: **wrapping an imported Server Action in local client code for error handling is not free**
— it can silently change how that specific form behaves for exactly the low-bandwidth audience an
offline-resilience fix is trying to help, and the only way this was caught was by checking the raw DOM
`action` attribute after the fix "worked," not by trusting that a passing browser test for the
targeted failure meant nothing else had changed.
