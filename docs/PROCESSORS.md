# Register of data processors

Spec section 13. Written 2026-10-07 (S39) from what the code actually calls, not from memory. Region and DPA columns come from `docs/legal/*`; "not documented" means nobody has written it down yet. No signed data processing agreement (DPA) exists with any processor; the Anthropic one is an unexecuted draft (`docs/legal/dpa-anthropic-ai-processing.md`). Env var names only, never values. Review every quarter and whenever a vendor is added; a new vendor needs a row before it ships.

| Vendor | Purpose | Personal data it receives | Health data | Region | DPA | Env vars |
|---|---|---|---|---|---|---|
| Supabase | Database, auth, storage, edge functions, vault | Everything the platform holds | Yes | AWS eu-west-1 (Ireland) | No | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, EXPO_PUBLIC_SUPABASE_* |
| Vercel | Web and API hosting, cron | All traffic in transit, request logs | In transit | Not documented | No | CRON_SECRET |
| Anthropic | AI coach, case briefs, scribe drafts, document extraction, drafts, navigation | Chat text, records, document images, consultation text | Yes | Outside Nigeria; retention not confirmed | Draft only | ANTHROPIC_API_KEY, ANTHROPIC_MODEL |
| Voyage AI | Embeddings for the coach and content library | Content library text (confirm no patient query is embedded) | Probably no | Unknown | No | VOYAGE_API_KEY |
| Paystack | NGN payments, webhooks, transfers | Name, email, amounts, references, payout bank details | No | Nigeria | Merchant terms only | PAYSTACK_SECRET_KEY, PAYSTACK_WEBHOOK_SECRET |
| Termii | SMS verification codes and clinician paging only (INV-08, D-12) | Phone number, code | No | Nigeria | No; sender ID pending (OQ-21) | TERMII_API_KEY, TERMII_SENDER_ID, SMS_PROVIDER, SEND_SMS_HOOK_SECRET |
| Expo push | Mobile push | Device token, neutral title and body (INV-07) | No | US, not documented | No | NOTIFICATION_JOBS_SECRET |
| Resend | Transactional email | Email address, neutral subject and body, receipts | Possibly (reports) | Not documented | No | RESEND_API_KEY, RESEND_WEBHOOK_SECRET |
| Sentry | Error tracking (web, edge) | Stack traces, URLs, user context after scrubbing | Incidental | Not confirmed (US or DE ingest allowed) | No | SENTRY_DSN, SENTRY_AUTH_TOKEN |
| Zoom | Video and audio consultations, dial-in, presence | Names, meeting ids, call content, dial-in numbers | Yes | Not documented | No | ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_WEBHOOK_SECRET_TOKEN, ZOOM_SDK_KEY, ZOOM_SDK_SECRET |
| Twilio Proxy | Masked calls (M8); may be superseded by OQ-132 | Both parties' phone numbers | No | US | No | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PROXY_SERVICE_SID |
| Dojah | NIN and BVN lookup | NIN or BVN (sent in a GET query string; only the last 4 digits are stored) | No | Nigeria presumed | No | IDENTITY_PROVIDER, IDENTITY_API_KEY, IDENTITY_APP_ID |
| Upstash Redis | Rate limiting (not provisioned; in-memory fallback in use) | Hashed IP or key | No | Unconfirmed | No | UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN |
| Have I Been Pwned (range API) | Breached-password check | First 5 characters of a hash | No | US | n/a | none |
| Google Maps | Coverage map, admin partner addresses | Partner addresses, visitor IP | No | US | No | NEXT_PUBLIC_GOOGLE_MAPS_API_KEY |
| YouTube (no-cookie embed) | Marketing video | Visitor IP | No | US | n/a | none |
| Wearable clouds (Fitbit, Oura, WHOOP, Garmin, Dexcom) | Device sync, built but no credentials yet | Steps, sleep, heart rate, glucose, tokens | Yes | Each provider's own | No | per provider `*_CLIENT_ID`, `*_CLIENT_SECRET`, webhook secrets |
| ML service (`services/ml`) | Risk scores; no host provisioned yet | Patient data in the request body, stateless | Yes | Not provisioned | n/a (own service) | ML_SERVICE_URL, ML_SERVICE_KEY |

On device only (no server vendor): Apple HealthKit, Android Health Connect.

## Not in use (checked)
WhatsApp or Meta (removed, F-02), Stripe, Africa's Talking, any analytics or advertising SDK (no firebase, segment, mixpanel, amplitude, posthog, facebook, adjust, appsflyer, gtag or Vercel analytics in any `package.json` or `pyproject.toml`), any speech-to-text or text-to-speech vendor (none chosen; the scribe uses an interface and a mock until OQ-96).

## Known problems (OQ-268)
No DPAs; region and retention unconfirmed for Anthropic, Zoom, Vercel, Sentry; a NIN or BVN in a GET URL; the Sentry scrubber misses names and free text and traces are sampled at 100%; the `vendor_assessments` seed and the Play Store text are stale.
