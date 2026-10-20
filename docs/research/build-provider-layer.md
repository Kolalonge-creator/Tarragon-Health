# Provider layer completion: research (2026-10-20)

Scope: what the platform can finish about the vendor layer (Zoom, Paystack, Resend, Termii, a speech vendor) without live credentials, and a short study of how comparable products handle the same jobs. Companion design: `docs/design/build-provider-layer.md`. Runbook: `docs/runbooks/provider-sandbox-check.md`.

**How to read the evidence tags.** The vendors' own documentation pages could not be read by this session (the Paystack reference answered 403, the Zoom reference page came back truncated before the meeting endpoints). So nothing below is "read from the vendor page today". Tags: **[K]** the vendor's published reference as the author knows it, not re-opened today; **[F]** confirmed today from Zoom developer-forum threads found by search; **[C]** a fact about our own code, checked by reading it. Every [K] line is exactly what `scripts/provider-sandbox-check.mjs` exists to prove against the real vendor; until the founder runs it, treat [K] as a strong lead, not proof.

## 1. Adapter-by-adapter audit

### 1.1 Zoom (`video-zoom.ts`, `zoom-webhook`, `/api/zoom/webhook`)
| Item | What we do | Source says | Verdict |
|---|---|---|---|
| Auth | `POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id=...`, Basic client id:secret; token cached until 60 s before `expires_in` | Server-to-Server OAuth, one hour token [K] | Correct |
| Host user | `POST /users/{host}/meetings`; host from `ZOOM_HOST_USER_ID`, else `me` | A Server-to-Server token is account level; `me` resolves only for a user-authorised token, so S2S apps must name the user id or email [F] | **Real risk, not changed at runtime** (see 1.1a) |
| Create meeting body | `topic, type 2, start_time, duration, timezone, settings{join_before_host:false, waiting_room:true, auto_recording:"none", audio:"both", global_dial_in_countries:["NG"]}` | Documented fields [K] | Correct |
| `start_time` | was `toISOString()` (with `.mmmZ`) | Zoom's examples and query patterns use `yyyy-MM-ddTHH:mm:ssZ` (the response samples seen carry no milliseconds) [K] | **Fixed**: milliseconds stripped |
| Read meeting | `GET /meetings/{id}`: `start_time, duration, join_url, start_url, password, pstn_password, host_id, host_email, settings.global_dial_in_numbers[{country,city,number,type}]` | Documented fields [K]; `type` is `toll` or `tollfree` | Correct |
| Host key | `GET /users/{owner}/token?type=zak&ttl=` | Documented [K]; scope names unconfirmed (OQ-136) | Correct, scope to confirm |
| Meeting SDK token | HS256 JWT with `appKey, sdkKey, mn, role, iat, exp, tokenExp`; role 1 host, 0 attendee | Documented Meeting SDK signature [K]; since 2023 the SDK key and secret are the app's Client ID and Secret | Correct |
| End room | `PUT /meetings/{id}/status {action:"end"}` then `DELETE /meetings/{id}` | Documented [K] | Correct |
| Webhook signature | HMAC-SHA256 hex of `v0:{x-zm-request-timestamp}:{raw body}`, compared with `x-zm-signature` (`v0=` prefix) | Documented [K] | Correct. Adapter used constant time and a 5 minute window; **the `zoom-webhook` function used neither: fixed** |
| Replay | none in the function | Zoom advises rejecting old timestamps (about 5 minutes) [K] | **Fixed**: a validly signed request more than 5 minutes off is acknowledged and ignored |
| Endpoint validation | `endpoint.url_validation`: answer `{plainToken, encryptedToken: HMAC-SHA256 hex(plainToken)}` | Documented [K] | Correct; the challenge is also shape-checked so it cannot be used as a signing oracle [C] |
| Event names and fields | `meeting.ended`, `meeting.participant_joined`, `..._joined_waiting_room`, `..._left`; `payload.object.id`, `participant.user_name`, `participant.customer_key`, `event_ts` in ms | Documented [K] | Correct. Phone callers have no `customer_key` and no role: nothing is claimed for them |
| Retries | non-2xx makes Zoom retry (a few times over hours) [K] | | Stale signed events answer 200 so a late retry is not counted as a failing endpoint |

**1.1a The host user.** Without `ZOOM_HOST_USER_ID` the adapter sends `me`, which a Server-to-Server app cannot resolve. I first made `videoFromEnv` return "not configured" when it is unset, then reverted that: nothing proves production is not already configured, and silently switching video off is worse than a clear failure. Instead the sandbox check has a dedicated line "a host user is named" that FAILS with this exact explanation, and the closeout lists it first.

### 1.2 Paystack (`payment-paystack.ts`, `paystack-webhook`)
| Item | What we do | Source says | Verdict |
|---|---|---|---|
| Signature | HMAC-SHA512 hex of the raw body with the secret key, header `x-paystack-signature` | Documented [K] | Correct, constant time, lower-cased compare |
| Event body | `{event, data}`; `charge.success` carries `reference, amount (kobo), currency, paid_at, fees, requested_amount, customer.email, metadata` | Documented [K] | Correct |
| Transfer events | `transfer.success / failed / reversed`; `data.reference, transfer_code, amount, status` | Documented [K] | Correct; each type has its own idempotency key so a reversal after a success is not dropped |
| Refund events | `refund.*` with `transaction_reference, amount` (string) | Documented [K] | Correct; amount is part of the key |
| Initialize | `POST /transaction/initialize {reference,email,amount,currency,callback_url,channels,metadata}` | Documented [K] | Correct; duplicate reference answers 400 and is mapped to `conflict` |
| Verify | `GET /transaction/verify/:reference`, status in `success, failed, abandoned, ongoing, pending, queued, reversed` | Documented [K] | Correct: an unknown status reads as pending, never as success |
| Transfers | `POST /transferrecipient {type:nuban,...}`, `POST /transfer {source:"balance", amount, recipient, reference, reason, currency}`, `GET /transfer/verify/:reference` | Documented [K]; reference rule: lower case letters, digits, `-`, `_`, 16 to 50 characters | Correct |
| Transfer idempotency | the reference is the idempotency key; a reused reference answers 400 "already exists" | Documented behaviour [K] | Correct. **Gap found and fixed**: after a timeout the handler recorded "error" without asking whether Paystack had accepted the transfer (money possibly moving while our state said "approved"). It now looks the reference up first |
| Transfer OTP | `status: "otp"` is mapped to `needs_attention` | Founder decision OQ-97: OTP stays off | Correct; the sandbox check says so if an OTP is waiting |
| Settlements | `GET /settlement?from&to&page&perPage` (`id, status, total_amount, total_fees, settlement_date`), `GET /settlement/:id/transactions` (`reference, amount, fees, paid_at`) | Previously read from third-party pages [NV] | Shape matches the reference as recalled [K]; **still unproven until one real settlement is read** (test mode usually has none; the check reports SKIP with that reason) |
| Idempotency of a webhook | event type plus reference | Paystack retries unacknowledged events (every few minutes, then hourly, up to about 72 hours) [K] | Correct |
| IP allow-list | none | Paystack publishes source IPs | Optional extra; not added because the signature is the authority |

### 1.3 Resend (`email-resend.ts`, `resend-webhook`, `_shared/notifications/resend.ts`)
| Item | What we do | Source says | Verdict |
|---|---|---|---|
| Send | `POST /emails` Bearer key, `Idempotency-Key` header, `from, to[], reply_to, subject, text, html, tags[{name,value}], attachments[{filename, content(base64)}]` | Documented [K] | Correct |
| Idempotency | Resend keeps an idempotency key for 24 hours and returns the same email id [K] | | Correct; the sandbox check sends twice with one key and requires one id |
| Webhook signature | Svix: `svix-id`, `svix-timestamp`, `svix-signature` (`v1,<base64>` space separated); HMAC-SHA256 of `id.timestamp.body` keyed by the base64 part of `whsec_...` | Documented [K] | Correct; several signatures accepted for rotation. **Tightened**: the timestamp must be whole seconds (it accepted `1e3` or a space padded value) |
| Events | `email.delivered, email.bounced (data.bounce.type Permanent/Transient/Undetermined), email.complained, email.failed, email.opened`; others (`sent, delivery_delayed, clicked, scheduled`) | Documented [K] | Correct: only a Permanent bounce suppresses an address; unknown types are acknowledged |
| Test inboxes | `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev` | Documented [K] | The sandbox check refuses any other recipient |

### 1.4 Termii (SMS)
Allowed uses only (INV-08, OQ-05): phone verification codes and clinician paging. The sandbox check is **read only** (balance, sender ids) and never calls a send endpoint. The Nigerian sender ID registration is the founder's step and is reported as SKIP with that reason while none is approved. The base URL is configurable (`TERMII_BASE_URL`) because Termii has more than one API host over time [K].

### 1.5 Speech vendor shortlist (for the gold set, not a decision)
The platform has no speech vendor and AI-017 stays OFF. A shortlist worth scoring on the same 20 to 30 Nigerian-English clips, vendor neutral:
1. **A general cloud model with strong multi-accent English** (for example OpenAI Whisper large family via API or self-hosted, Google Chirp, Azure Speech): cheapest to trial, no medical tuning. Whisper-class models have shown clinical-entity errors above their overall WER in published work [P, earlier review].
2. **A medical-tuned or Africa-tuned vendor** (Intron Health "Sahara" medical models, reported medical WER 15.25 percent against 27.19 percent for Whisper-large-v3 in a vendor-affiliated preprint [P, earlier review]): the only candidate with African-accent medical claims, so worth the trial; treat the preprint as a claim.
3. **An ambient-scribe vendor** (Abridge, Nuance DAX Copilot, Suki): complete products with note drafting; built for US systems, EHR integration and a BAA, and priced accordingly. Useful as a capability benchmark, unlikely to fit a Nigerian pilot's economics, and their note generation bypasses our own review gate unless it can output a transcript only.
Selection rule: score each on the gold set with `scripts/asr-eval/run.mjs`; none is eligible below the 95 percent mark on drug names AND on numbers; a vendor must also accept an explicit per-encounter consent flag, process in a region the DPO accepts, and sign a data processing agreement. Choosing one is the CMO's decision.

## 2. Competitor study
| Area | What mature products do | What it means here |
|---|---|---|
| Video visits (Teladoc, Doxy.me, Zoom for Healthcare) | Browser join with no install, a waiting room, automatic quality adaptation, audio-only fallback, a BAA/DPA, host controls, no recording by default; Doxy.me and Zoom for Healthcare publish their data-handling terms [K] | Our ladder (audio only, offer video back, phone dial-in) matches the pattern; what nobody publishes is a threshold measured on Nigerian handsets. The measurement tool in this package produces that evidence |
| Ambient scribe (Abridge, Nuance DAX) | Consent at the start, transcript and draft note, clinician edits and signs before anything enters the record, an audit trail of edits; accuracy claims are the vendor's own; one independent study reports more hallucination in ambient notes than in clinician notes (31 percent against 20 percent) [P] | Our controls (explicit consent per encounter in the database, drug and number highlight, forced section-by-section confirmation, AI-017 off) are at least as strict. The gold-set gate adds the missing independent accuracy measure |
| Payout rails (Paystack, Flutterwave) | Idempotent transfers by reference, webhooks for success/failure/reversal, bulk transfer, optional OTP, optional **transfer approval** (the provider asks a URL of the merchant to approve each transfer) and API key IP restrictions [K, NV for the approval feature] | Our maker-checker with the CMO as second approver, limits, idempotent reference, reconciliation and GL are the merchant-side equivalent. The provider-side **transfer approval callback** would be a strong extra control (Paystack asks us, we answer only for a payout in a released batch). Not built: needs the Paystack feature confirmed on the account. Recorded as a follow-up |
| Credentialing (Medallion) | Automated primary-source verification, continuous monitoring and expiry alerts, committee workflow | Already covered by the credentialing gate (S11-S15 P5); not part of this package |

## 3. What cannot be done without credentials
Everything in section 1 marked [K], plus: that Paystack test mode accepts the recipient and transfer calls as written, that the Zoom account allows creating meetings for the named host user and which scopes that and the host key need, that Resend's idempotency returns the same id, and that a Nigerian sender ID is approved. All of it is one command: `docs/runbooks/provider-sandbox-check.md`.
