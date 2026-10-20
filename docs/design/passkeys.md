# Optional passkeys for patient sign-in (design and as-built)

Written 2026-10-16 on branch `feat/optional-passkeys`, cut from `origin/main-dev` at `69546102b`. Founder decision 2026-10-16: passkeys are **strictly optional**, an extra for tech-savvy people. Phone and email sign-in, passwords, backup codes and every S03b recovery route stay the default and are not removed, hidden behind, or slowed by this. It ships **OFF**; the founder flips it.

## 1. What is actually possible (researched, not assumed)

| Question | Finding |
|---|---|
| Does Supabase Auth support passkeys for primary sign-in, or only as an MFA factor? | **Primary sign-in, natively**, as an experimental feature: `signInWithPasskey`, `registerPasskey`, a two-step `auth.passkey` API, list/rename/delete, and admin list/delete. Discoverable credentials, so no email or phone is needed to start. Source: Supabase docs, "Passkey authentication". Needs `@supabase/supabase-js` 2.105 or later; we have 2.110.0, and `auth-js` 2.110.0 ships the `auth.passkey` namespace (checked in `dist/main/GoTrueClient.js`). It must be enabled per project in Authentication, Passkeys (relying-party id, display name, up to five origins) and opted into in the client with `auth.experimental.passkey = true`. "Experimental: the API may change without notice." |
| Is it live on our project? | The live database has `auth.webauthn_credentials` and `auth.webauthn_challenges` (checked 2026-10-16, `execute_sql`), so the Auth version has the tables. Whether Passkeys is **switched on in the Auth settings** cannot be read from here: a dashboard step (OQ-PASSKEY-01). |
| Can we write our own with `@simplewebauthn/server` and mint a session? | Possible only by minting sessions with the Admin API, which means our server can sign anyone in. That is the riskiest piece of the whole auth system to own. Rejected: the native path gives the same user result with no session-minting code of ours. |
| Expo SDK 54 / React Native | Passkeys on native need a native module (the usual choice is `react-native-passkeys`; I did not verify its SDK 54 compatibility, only that guides for it exist). It does **not** work in Expo Go: it needs a development or EAS build. iOS needs `ios.associatedDomains` with `webcredentials:<domain>` and an Apple App Site Association file on that domain; Android needs `/.well-known/assetlinks.json` with the app package and signing-certificate fingerprint (and every build must sign with a fingerprint that is listed). Android needs API 28 or later with Google Play services; guides cite iOS 16 or later and call parts experimental. Supabase supports an Android native origin (`android:apk-key-hash:...`) in the allowed origins, and the `auth.passkey` two-step API exists exactly so a native ceremony can be plugged in. |

## 2. Decision

**Use Supabase Auth's native passkeys, driven from our server, with a database gate on Auth's credential table.** Web only in this change.

Why this and not the alternatives:

1. **No session-minting code of ours.** Auth verifies the signature, counter, origin, relying-party id and challenge expiry and issues the session. We never hold or mint a token.
2. **Passkeys are an extra sign-in route, not a replacement or a "fast unlock" bolt-on.** The native route gives a real session, so no second design is needed. The fast-unlock fallback in the brief was only for the case where passwordless sessions could not be done safely; they can.
3. **Server-driven, not browser-driven.** The browser could call `registerPasskey()` and `signInWithPasskey()` directly, but then no rate limit, no password re-check, no patient-only rule, no audit row and no new-device notice would run. So the browser only does the ceremony (`navigator.credentials.create/get`); the two halves of each flow are server actions that call `auth.passkey.*` with the cookie session (`apps/web/src/lib/passkeys/actions.ts`).
4. **A direct call to Auth can skip any server action.** Once Passkeys is enabled in Auth, anyone holding a valid access token can call the registration endpoints themselves. A passkey is a persistent way in that outlives the token, which is the thing S03b's step-up exists to prevent. So the real gate is in the database, on `auth.webauthn_credentials` (same pattern as the change-number gate on `auth.users`).

## 3. How it works

**Switch.** `public.platform_switches` row `passkeys`, `is_on = false`, `readable_by_anon = true` (the sign-in page asks signed out). Only an admin flips it (`set_platform_switch`, audited). It is the ON/OFF shape the repo already has for kill switches. The app also requires `public.passkey_gate_ready()` (all five triggers installed; service role only, so no signed-out role gets another function); both must be true or passkeys do not exist for anyone.

**Adding a passkey** (Settings, "Passkeys (optional)", patients only):
1. The person types their password again and names the passkey.
2. Server: switch and gate ready, active patient, password checked with the existing throw-away-client check (`verifyAccountPassword`, rate limited), then the service role records a single-use authorisation (`authorise_passkey_add`, 3 minutes, PROPOSED in `auth.passkey_rules`, clamped 1..15 in SQL), the order being: Auth issues the challenge first, then the window opens.
3. Browser runs the ceremony; the server calls `verifyRegistration` and names it.
4. The trigger on `auth.webauthn_credentials` runs `BEFORE INSERT`: active patient, switch on, and a fresh unspent authorisation, which it spends. A direct Auth call with a stolen token has none and is refused.
5. A fifth trigger refuses the `last_used_at` update (the moment Auth records a passkey sign-in) while the switch is off, so the switch is a kill switch for signing in by any client, not only for our screens. `AFTER INSERT`: an audit row (`account.passkey_added`, no key material) and an in-app **and** email notice (`security.passkey_added`, `routine` priority, never SMS). Removal does the same (`security.passkey_removed`); a use writes only an audit row (`account.passkey_used`, driven by `last_used_at`). All of this is in the database, so it also fires for a direct Auth call. The notice is wrapped: a failure to queue it never blocks the change.

**Signing in.** Sign-in page: a quiet "Use a passkey" button under the normal forms, shown only if the switch is on, the browser supports WebAuthn, **and** this device has been used with a passkey before. The last part is a note in `localStorage` set when a passkey is added. The page cannot ask the server "does this person have a passkey?" before anyone says who they are, and must not (enumeration), so the device note is the honest version of "has at least one". Trade-off: a synced passkey on a brand-new device will not show the button there; that person signs in the usual way (OQ-PASSKEY-03).
1. `beginPasskeySignIn` (rate limited per source, no account name taken) returns Auth's challenge.
2. Browser ceremony; `finishPasskeySignIn` (rate limited) calls `verifyAuthentication`. **Every failure is the same sentence** (expired challenge, replayed counter, wrong origin or relying-party id, removed credential, banned, unconfirmed, non-patient).
3. On success the session lands through `redirectAfterLogin`, exactly like password and code sign-in, so the new-device notice and the sanitised redirect run. If the account has an authenticator-app factor, `proxy.ts` still demands it next: **a passkey never skips MFA**.

**Not touched.** `signInWithPassword`, OTP, `forgot-password`, backup codes, recovery contact, change-number gate, and the 72-hour text-code hold (`my_phone_recovery_hold`). The hold guards recovery by a text code; a passkey sign-in is not that route, and adding a passkey needs the password, so a SIM-swapper with only the phone cannot plant one.

## 4. Honest limits

1. **Not run end to end.** There is no real authenticator, no Passkeys setting enabled on the project, and no browser run against hosted Auth in this session. What is proven: the database gate (rolled-back proof), the server logic with Auth faked (Jest), the browser codec (Jest). What is not: a real ceremony. First real run is the founder's checklist in OQ-PASSKEY-01.
2. **Auth owns the cryptography, so Jest cannot prove it.** Challenge expiry (5 minutes), counter replay, wrong origin or RP id and removed credentials are enforced by Auth; our tests prove that each such failure comes back as one indistinguishable message, creates no session and does not redirect.
3. **Experimental upstream API.** It may change without notice; the `auth.passkey` calls are isolated in `lib/passkeys/` for that reason.
4. **Relying-party id is permanent.** Changing it kills every registered passkey. Proposed: `tarragonhealth.ng` (covers the root and the `app.` subdomain). Origins must include the host that serves `/login` (`https://app.tarragonhealth.ng`, and the root if it ever serves it). Localhost cannot be added next to a production id, so local development cannot exercise the real ceremony.
5. **Password required to add.** Accounts with no password route (phone-code-only, nothing confirmed) are told to set a password first. Deliberate: otherwise a session alone could plant a passkey.
6. **Window after the password check.** For up to 3 minutes after a correct password, opened only once Auth has issued the challenge, a passkey can be stored for that ACCOUNT (the authorisation is bound to the user, not to the session or the Auth challenge, because Auth's connection carries no session claim to compare). The window is closed early when the prompt is cancelled or a step fails (`cancel_passkey_add`). An attacker would need a stolen token AND to act inside that window.
7. **The gate is on a table Auth owns.** An Auth upgrade could rename or recreate it. `passkey_gate_ready()` then reports false and the feature closes instead of running unguarded. If Authenticator-app style WebAuthn **MFA** factors are ever enabled, they share this table and would also need the gate's conditions.
8. **Staff.** Patients only. The gate refuses anyone else, the cards render nothing for them, and `apps/console` has no passkey code.
9. **Email notice caveat.** The email half depends on the dispatcher having the new `security.passkey_*` templates: `send-pending-notifications` must be redeployed after merge (the edge-drift job will flag it). In-app delivery does not depend on that (see OQ-S03B-02 for the older notices).

## 5. Mobile (apps/mobile)

**Not built, by the brief's own rule.** A passkey library is a native dependency: it needs a `runtimeVersion` bump and a new EAS build, which must not be auto-published by the OTA workflow, plus the associated-domains file and `assetlinks.json` on the production domain and a real device test. None of that can be done or verified here. Recorded as follow-up OQ-PASSKEY-02. When done: gate it behind the same `passkeys` switch, call the same server actions' equivalents (or `auth.passkey.*` with a native ceremony), add Android origin `android:apk-key-hash:...` to the Auth origins, and test on a Tecno-class Android and an iPhone. Phone sign-in stays the default there too.

## 6. Values (PROPOSED, `auth.passkey_rules`)

`add_authorisation_minutes 3`, `start_per_ip_per_5min 30`, `verify_per_ip_per_5min 20`, `label_max_chars 60`. A test fails if the SQL clamp and default drift from the registry.

## 7. Proof

- `packages/db/tests/optional_passkeys.sql` (registered in `ci.manifest`): switch OFF and anon-readable; authorisation service-role only, patient only, clamped, one at a time; gate refuses with the switch off, with no authorisation, for a clinician, with another account's or an expired authorisation, and after one use; audit and notices on add, remove, use; counter-only change silent; a failing notice does not block; **three sabotage steps** that each flip their check. Where Auth's credential table is absent (older local image) the gate part is skipped with a NOTICE and `passkey_gate_ready()` must be false.
- Jest: `apps/web/src/lib/passkeys/` (actions with Auth faked, wording, codec) and `packages/shared` (rules mirror).
