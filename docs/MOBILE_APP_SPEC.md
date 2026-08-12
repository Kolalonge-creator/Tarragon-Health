# Tarragon Health — Mobile App Spec (iOS + Android)

*Written 2026-08-08, grounded in the live codebase (`apps/mobile`, `apps/web`, the deployed Supabase
project `koiplnmbgnqnbywhpjlf`) rather than the older platform docs. Where this conflicts with
`docs/FULL_SPECIFICATION_V4.md` §5/§9's "unbuilt" wording on wearables/mobile, this document is
current — see `CLAUDE.md`'s Device & Wearable Integration section, corrected 2026-08-05/08.*

## 0. Architecture decision: hybrid, not a full native rewrite

`apps/mobile` today is a two-tab Expo shell (`apps/mobile/App.tsx`): a WebView of the live web
deployment ("Home") plus a genuinely native "Devices" tab (BLE pairing + Apple Health). That split is
the right shape to build on, not a stopgap to replace.

**Decision: go native only for the ~10 screens a patient touches weekly. WebView everything else.**
Rewriting prevention, labs, wellness, family, referrals, or any admin/staff surface natively buys
nothing — those are low-frequency, form-heavy pages already built and maintained once, on web. Every
native screen is a second implementation of business logic that has to stay in sync with the web one
forever. Reserve native for screens where speed, offline, hardware access, or push immediacy
materially change the experience.

This doc lists the full patient feature set once (§2) and marks each item **[NATIVE]** or
**[WEBVIEW]**. The non-patient roles (§7) stay web-only, full stop.

---

## 1. Auth & onboarding — native (unavoidable)

Session, deep links, and the App Store review surface all require native auth regardless of the
hybrid split.

| Screen | Backend |
|---|---|
| Splash / session restore | Supabase session via `expo-secure-store` (already built: `apps/mobile/src/lib/supabase.ts`); route by `profiles.user_role` |
| Login | `login-screen.tsx` exists but is currently only reachable from the Devices tab — promote to an app-level gate in front of both tabs |
| Sign up | Mirrors `/signup`. Never WhatsApp-initiated — platform-wide rule, unchanged for mobile |
| Forgot / reset password | Mirrors `/forgot-password`, `/reset-password`. The web reset flow uses a URL-fragment + PKCE token exchange (`@supabase/ssr`) that broke once before (see `project_finance_tooling_shipped_reset_password_fragment_bug` memory) — native needs its own deep-link handler for the recovery link, don't assume the web flow ports as-is |
| Consent gate | Telehealth + data consent, blocks dashboard access until accepted — same server-side gate as web, called via a Route Handler |
| Guided intake | Conditions, meds, `patient_location`, emergency contact |
| Identity (Dojah KYC) | Optional/gated, WebView is fine here (Dojah's own widget is a web SDK) |

---

## 2. Patient feature set — native vs. WebView, by tab

### 2.1 Home / Overview — **[NATIVE — lightweight]**
Native renders a fast summary card (next best action, latest vitals, doses-today ring, one-tap
"message care team") and deep-links into the WebView for anything requiring detail (full risk
signals, Health Score breakdown, timeline). This is the screen a patient opens most often — it must
be instant and work offline from cache.
- Data: `patient_risk_scores`, `vitals_readings` (latest), `care_plans`, `patient_timeline` — read via
  direct RLS-scoped Supabase client calls, no new Route Handler needed for reads.

### 2.2 Vitals & symptoms
- **[NATIVE] Quick log** — BP, glucose, weight, temperature, SpO2, pulse manual entry. Highest-frequency
  write in the app; must work offline (§6). Writes `vitals_readings` with `source='manual'`.
- **[NATIVE] Vitals history + trend chart, HBPM summary** — read-only, cache-friendly, worth a native
  screen since it's viewed right after logging.
- **[WEBVIEW]** Danger-symptom check, wearable connect/OAuth (opens system browser to
  `/api/wearables/connect/[provider]`, never embed OAuth in a WebView per Google/Apple policy), symptom
  log form + history, out-of-range crosscheck.

### 2.3 Medications
- **[NATIVE] Today's doses** — mark taken/missed. Second-highest-frequency write; offline-capable
  (§6). Local reminder notifications via `expo-notifications` (device-local, no server round trip,
  works with zero signal — the one reminder channel that doesn't depend on WhatsApp/SMS/push at all).
- **[WEBVIEW]** Active medication list detail, add medication, adherence check-ins, "check my pack",
  lab monitoring due, refill request + pharmacy order status.

### 2.4 Prevention — **[WEBVIEW, all of it]**
Risk assessment, screening calendar, vaccination schedule (self + family), programme enrolment,
Annual Health Check booking, reproductive/women's health, health education library, FINDRISC. Low
weekly-touch frequency; the abnormal-result → Category 1 escalation itself is server-triggered and
reaches the patient via push/notification regardless of which surface they're in.

### 2.5 Labs & results
- **[NATIVE] Upload a result** — camera capture is a genuine native win over a web file picker and
  feeds directly into the AI lab-extraction pipeline (`lib/lab-reports`). Uploads via a new
  `POST /api/mobile/lab-result-upload` Route Handler (does not exist yet — budget it).
- **[WEBVIEW]** Catalogue + self-book, facility selector, orders list, results/trends, booking
  requests. Patient pays the lab directly — Tarragon does not book/bill labs (see
  `project_self_arranged_fulfilment` memory) — no payment surface here either way.

### 2.6 Care & support
- **[NATIVE] Messages** — `care_message_threads`/`care_messages`, in-app only, never WhatsApp. Native
  because it's push-driven and benefits from an offline draft queue; use Supabase Realtime for live
  updates while foregrounded.
- **[NATIVE] Notification inbox** — see §4. Respect `content_class` server-side gating; never let a
  broadcast-class push leak a personal result.
- **[WEBVIEW]** Ask a doctor (async), AI coach chat + usage disclosure, care plan display,
  escalations, referrals, hospital admissions, lifestyle/obesity progress, wellness (points/badges/
  challenges/classes), care circle/vouchers, testimonials.
- **Book a video visit** — see §8 for the native-vs-deep-link decision; booking itself is WebView,
  joining the call is native.

### 2.7 Profile & settings
- **[NATIVE] App lock (biometric)** — Face ID / fingerprint gate on app open. Real trust feature for a
  health record living on a phone; has no web equivalent.
- **[NATIVE] Notification preferences** — per-channel opt-in/out, since it directly controls the native
  push permission prompt.
- **[WEBVIEW]** Everything else: personal details, location, condition language, emergency/next-of-kin
  contacts, change password, identity verification status, data & privacy/export/delete request, sign
  out.
- **Subscription / payment** — WebView **only as a browser hand-off**, never embedded. See §7.

### 2.8 Screens outside the tab bar
- **[NATIVE] Emergency card** — must render fully offline (§6) and support the existing
  `/emergency/[token]` no-login share link and blood-group attestation. This is the one screen where
  "the app was open when the ambulance arrived" is a real design constraint.
- **[NATIVE] Health Passport** — Ed25519-signed verifiable credential; cache the PDF and render the
  `/verify` QR offline. Read-only, so no new write surface needed.
- **[WEBVIEW]** Family/dependants, caregiver request flow, sponsor/supporting view, activity feed.

---

## 3. Native-only screens (already built)

These exist today and are the actual reason to ship a native app at all — nothing above should
regress them:

- **Devices tab** (`devices-screen.tsx`) — BLE pairing for all 5 standard GATT clinical profiles (BP
  cuff, glucometer, weight scale, thermometer, pulse oximeter) → `POST /api/mobile/device-readings`.
- **Sync screen** (`sync-screen.tsx`) — per-device read/parse/upload.
- **Apple Health card** (`apple-health-card.tsx`, `lib/healthkit.ts`) — read-only, iOS-only,
  incremental via server-held cursor → `POST /api/mobile/health-samples`.
- **Health Connect card** (`android-health-connect-card.tsx`, `lib/health-connect.ts`) — the Android
  peer, built 2026-08-12 on explicit ask. Same shape: read-only, incremental via the same
  timestamp-window cursor pattern (not Health Connect's own token-based `getChanges` API — see the
  migration header on `20260812161742_wearable_provider_android_health_connect.sql` for why), same
  `POST /api/mobile/health-samples` route, now provider-aware via a `provider` field rather than a
  second endpoint.
- **Background sync** (`lib/background-sync.ts`) — a shared periodic `expo-background-task`
  (BGTaskScheduler on iOS / WorkManager on Android) drives both cards without the patient needing to
  open the app; iOS additionally gets a live `subscribeToChanges` listener on top for while the app is
  already running. See CLAUDE.md's Device & Wearable Integration section for the full mechanism,
  including why HealthKit's own native background delivery isn't the thing actually doing the
  waking here.

**None of this has ever run on real hardware.** HealthKit doesn't work in Expo Go; Health Connect's
native module throws on import outside a real EAS/prebuild binary; `expo-background-task`'s iOS half
doesn't work in the Simulator at all. All three need an EAS development build on physical iPhone and
Android devices before any of this can be called confirmed-working.

---

## 4. Push notifications — unify web + native (biggest backend change)

**Current state, verified against the live deployment (2026-08-08):** `push_subscriptions`
(`supabase/migrations/20260730153214_push_subscriptions.sql`) stores **Web Push only** —
`endpoint`, `p256dh_key`, `auth_key`, no platform/token-type column. `send-pending-notifications`
(deployed version 27, confirmed byte-identical to `supabase/functions/send-pending-notifications/
index.ts` as of this check — the drift this project has hit before, per the standing note in
`CLAUDE.md`, is **not** currently present) sends via `npm:web-push@3.6.7` / VAPID keys only, in
`sendWebPush()`, dispatched on `row.channel === "push"`.

**Goal: one `channel = 'push'` notification, fanned out to whichever device types a recipient has
registered — desktop web, iOS, Android — same as `sendWebPush` already fans out across multiple
Web Push subscriptions for one user.**

### Schema change
Extend `push_subscriptions` with a discriminator rather than a parallel table, so the existing RLS
policies (`profile_id = auth.uid()`) and the disable-on-410 dead-subscription logic apply unchanged:

```sql
alter table public.push_subscriptions
  add column platform text not null default 'web'
    check (platform in ('web', 'ios', 'android')),
  add column expo_push_token text,
  alter column endpoint drop not null,
  alter column p256dh_key drop not null,
  alter column auth_key drop not null,
  add constraint push_subscriptions_web_fields_check
    check (platform <> 'web' or (endpoint is not null and p256dh_key is not null and auth_key is not null)),
  add constraint push_subscriptions_native_fields_check
    check (platform = 'web' or expo_push_token is not null);
```

Expo's push service is the pragmatic choice over raw APNs/FCM — it's already a dependency-free HTTP
API, handles the APNs/FCM credential complexity, and `apps/mobile` is already an Expo project, so no
new native module is needed beyond `expo-notifications` for the client-side registration.

### Edge Function change
Add a `sendExpoPush()` function parallel to `sendWebPush()` in
`supabase/functions/send-pending-notifications/index.ts`, called from the same `channel === "push"`
branch: fetch all active subscriptions for the recipient (as today), split by `platform`, call
`sendWebPush` for the `web` rows and `sendExpoPush` for `ios`/`android` rows (`POST
https://exp.host/--/api/v2/push/send`), treat the notification as sent if **any** device accepts it —
matching the existing multi-device-fanout behavior. Expo's response marks `DeviceNotRegistered`
errors per-token; map those onto the same `disabled_at`/gone-subscription handling `sendWebPush`
already does for 404/410.

### Mobile client change
- `expo-notifications` requests permission, gets an Expo push token, and calls the existing
  `POST /api/push/subscribe` route (`apps/web/src/app/api/push/subscribe/route.ts`) with
  `{ platform: 'ios'|'android', expo_push_token }` — extend that route's Zod schema to accept either
  shape (web keys OR platform+token), it's already RLS-scoped so no auth change needed.
- **Deep links**: every push payload already carries a `url` field (see the `payload.url` passed into
  `sendWebPush`) — the native notification handler parses it and routes to the matching in-app screen
  (WebView deep-link for WebView-owned pages, native navigation for native-owned ones like Messages).
  This is new work; today `url` only ever opens a browser tab.

### Net effect
Both web and native receive the same server-originated push for the same event — no notification
template, escalation SLA, or `content_class` gating logic is duplicated; only the transport fans out.

---

## 5. Server-action boundary — budget per native write

Every **[NATIVE]** screen above that writes data needs one of:
1. A direct RLS-scoped Supabase client call (works today for anything already covered by a
   permissive-enough RLS policy — e.g. inserting into `vitals_readings` as the patient), or
2. A new Route Handler mirroring the `apps/web/src/app/api/mobile/*` pattern (needed wherever the web
   equivalent runs through a Next.js Server Action with logic beyond a plain insert — e.g. the doses
   endpoint likely needs adherence-streak/side-effect logic that a bare insert wouldn't replicate).

New Route Handlers this spec requires that don't exist yet:
- `POST /api/mobile/vitals` (or confirm direct-insert is sufficient — check whether
  `vitals_readings_insert` RLS alone is enough, or whether the web Server Action does extra work like
  triggering the out-of-range crosscheck)
- `POST /api/mobile/doses` (mark taken/missed — check for adherence-tracking side effects)
- `POST /api/mobile/lab-result-upload` (§2.5)
- `POST /api/mobile/messages` or direct Realtime + insert, depending on whether server-side
  attribution logic runs on send

Audit each one against its Server Action counterpart before building — don't assume a bare insert is
equivalent.

---

## 6. Offline — vitals logging, dose marking, emergency card

This matters more for Nigeria than any single feature above. Three screens must work with zero
signal and sync later:

- **Quick vitals log** and **today's doses**: write to a local SQLite/AsyncStorage outbox first,
  render optimistically, sync in the background (`expo-task-manager` or a foreground retry-on-reconnect
  queue) with idempotency keys so a retried sync can't double-insert. Conflict resolution is simple
  here — these are append-only event logs, not editable records, so last-write-wins isn't a concern.
- **Emergency card**: cache the full rendered card (blood group, allergies, conditions, emergency
  contact, the `/emergency/[token]` share link/QR) on every successful app open, so it renders from
  cache with no network at all. This is the one screen where offline isn't a nice-to-have.

---

## 7. Payments — web only, always

**Decision: never embed checkout in the app. Bounce the patient out to the web via
`expo-web-browser` (system browser tab, not an in-app WebView) for any subscription purchase,
upgrade, or renewal.**

Reasons this is the right call, not just the cautious one:
- Paystack checkout is already a web redirect flow — there's no native SDK integration to build.
- Apple App Store Review Guideline 3.1.1 requires IAP for **digital** subscriptions bought in-app;
  Apple has discretion on whether a healthcare-service subscription qualifies for the "physical
  goods/services consumed outside the app" exemption, and that discretion is inconsistently applied
  in review. Never embedding checkout removes the ambiguity entirely rather than betting on a review
  outcome.
- Google Play's policy is more permissive here, but keeping one payment path (web) for both platforms
  avoids maintaining two different purchase flows.

Native shows plan/entitlement status (read-only) and a single "Manage subscription" button that opens
`/patient/subscription` in the system browser. No IAP integration, no Paystack SDK in the mobile app.

---

## 8. Video visits — deep link to the Zoom app, not the mobile SDK

**Decision: booking stays WebView (`/patient/care` → book-video-visit flow); joining an already-booked
call deep-links out to the native Zoom app** (`zoomus://` URL scheme, falling back to the Zoom web
client if the app isn't installed) rather than embedding the Zoom Meeting SDK.

Reasoning: the Zoom Meeting SDK is a substantial native integration (its own binary size, camera/mic
entitlement handling, a separate SDK key/secret pair, ongoing SDK version maintenance) for a feature
used at low frequency per patient (an Annual Health Check or an escalation-triggered consult, not a
weekly action). A deep link gets 90% of the UX — one tap from the appointment reminder into a working
call — for a fraction of the build and maintenance cost. Revisit the full SDK only if patient
feedback flags the app-switch as a real friction point once video visits are in regular use.

---

## 9. Non-patient roles — out of scope for v1

Admin, analytics, finance, pharmacist, lab partner, lab liaison, corporate, HMO, and care-coordinator
dashboards stay web-only. They're desk work, not on-the-go work, and none of them benefit from native
hardware access, offline, or push urgency the way the patient screens above do. If a clinician
companion app is wanted later, the highest-value native subset would be: escalations queue (with the
4-hour SLA clock visible), `/clinician/messages`, patient lookup, and outreach — but that's a
separate app-store listing and a separate spec, not an extension of this one.

---

## 10. Open items / risks

1. **Health Connect (Android) is unbuilt** — see §3. Blocks calling Android health-sync "at parity"
   with iOS until it exists.
2. **HealthKit bridge has never run on real hardware** — confirm on a physical iPhone via an EAS dev
   build before shipping.
3. **`send-pending-notifications` has drifted from source before (repeatedly)** — this spec's push
   design assumes today's confirmed-in-sync state (v27, verified 2026-08-08); re-check
   `deployed sha256` vs. source before building the Expo-push branch on top of it, don't assume it's
   still in sync by the time this work starts.
4. **New Route Handlers (§5) are unbudgeted work**, not a config change — each one needs its own Zod
   schema, RLS-alignment check, and a decision on whether it needs to replicate Server Action side
   effects or whether a bare insert is equivalent.
5. **Deep-link routing table doesn't exist yet** — needed for both push (§4) and Zoom join (§8); build
   once, shared by both.
6. **MDCN/regulatory sign-off on the app itself** is outside this doc's scope — same open item tracked
   in `CLAUDE.md`'s standing follow-ups for the tier ladder generally.
