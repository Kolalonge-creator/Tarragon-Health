# S40 Competitor review: Medlitics (medlitics.com)

Method: public pages only, fetched with curl/WebFetch and the built-in browser on 2026-10-06. No sign-up, no forms, no personal data. Screenshots were taken at 390px and desktop in the browser pane but could not be saved into the repo (the tool returns them outside the working tree). Anything not directly observed is marked UNVERIFIED.

## Snapshot

- **The site has been rebuilt since the earlier desk research.** The prior report (condition funnels, $9.99/$19.99, "78% / 50%" claims, three chat widgets in the CSP) no longer matches the live site.
  - There are now no per-condition pages and no "78%" or "50%" strings anywhere on the nine pages fetched.
  - Pricing is Free (30 days) / Basic $14.99 per month / Premium $24.99 per month, USD, with Naira "at payment where available".
  - The pitch is "four-sided": users, practitioners, hospitals/clinics and insurers. Tagline: "Predict Earlier. Act Sooner. Live Healthier."
- **Stack:** Next.js (OpenNext on Cloudflare, `x-opennext: 1`), App Router, Tailwind-style classes, dark default theme with a light toggle.
- **Maturity:** the marketing site is polished. The patient portal (`/patients`) is a client-rendered shell that shows "Loading your secure user portal..." to an anonymous viewer, so the product itself is UNVERIFIED.
- **Footprint:** the NDPR page is dated 29 April 2026 and the site says it is "being rolled out with a small group" of partners. The insurer page shows a "12,480 members" demo cohort, which is illustrative, not a customer count.

## Design

Strengths:
- **Story-led hero.** One idea ("care that runs between the appointments"), a three-point timeline (06:10 reading, 20:05 out of range, 20:41 "her doctor already knows"), and four portal chips as the IA.
- **Narrative demos.** A fictional patient (a glucose of 11.4 mmol/L, then a consult booking, then a prescription) and a practitioner queue ("48 patients, 2 need you now") are rendered as product UI. They show the severity-ordered, alert-age-ordered queue concept without screenshots of a real product.
- **Clear IA.** Nav is Portals (Users, Practitioners, Hospitals, Insurers), Sign in, Security, Company, and two CTAs ("Request a demo", "Request access"). Pricing is on the home page and on `/pricing`, visible before sign-in.
- **Accessibility signals.** A skip-link (`#main`), `lang="en"`, a theme toggle that respects `prefers-color-scheme`, and no horizontal scroll at 390px (scrollWidth 390).
- **Honest trust language.** "These are targets, not results already achieved, and we will publish the real numbers." Meddy's limits (does not diagnose or prescribe) are repeated on every page footer.

Weaknesses:
- Mobile: the tawk.to chat widget auto-opens a prompt panel over the pricing hero and covers the copy. The "Request access" button wraps onto two lines in the header.
- No third-party proof anywhere: no real testimonials, press, named hospital partners or app-store ratings. The only named partner is Curacel.
- The patient and practitioner experiences are one-page marketing mockups, not walkthroughs or videos.
- A B2B-heavy IA dilutes the consumer funnel. There is no condition-specific page and no condition SEO target.

## Functionality (publicly observable)

| Area | What the site claims | Evidence level |
|---|---|---|
| Monitoring | Manual entry, Apple Health, Google Fit, Samsung Health, Fitbit, Bluetooth glucometers and BP monitors | Claim only (UNVERIFIED in product) |
| Alerts | Out-of-range reading alerts patient and practitioner together; severity and alert-age queue | Illustrative demo |
| Doctor loop | Book a consult from the alert, with history attached; digital prescription; adherence score shown to the practitioner | Claim only |
| Consults | Video steps down to audio, then chat, as bandwidth falls | Claim only |
| Offline | Readings, doses and messages queue on the device, labelled "waiting to sync", de-duplicated by per-action id | Claim only (see Code) |
| Meddy AI | Explains the user's own trends and helps prepare for visits; "does not diagnose or prescribe"; gated to Basic/Premium | Claim; sample quote only |
| Plans | Free 30 days; Basic $14.99 (baseline AI insights, reminders, "basic early-warning alerts", discounts); Premium $24.99 (advanced AI risk prediction, included and priority consults, specialists, caregiver access, remote monitoring) | Observed pricing |
| Insurance | Curacel-powered cover "as those programs go live"; claims with health data attached; partner API | Roadmap language |
| Hospitals | EHR connection via standards-based APIs, else scheduled file import; write-back; anonymised population insight | Claim only |
| Couple/family/corporate | Premium mentions "families" and caregiver access. No couple plan or corporate price list found. `/request-access` has pharma, corporate and government roles | Partial |
| Targets (the "claims") | 70% weekly sync, under 2 h alert-to-action, 85% consult completion, 80% adherence, 5-day claim decision | Stated as targets, not results |

What the old "78% / 50%" claims rest on: nothing visible. They are no longer on the site, and the current numbers are explicitly targets. Treat the old figures as UNVERIFIED and likely retired.

## Code and performance

**Offline/PWA approach (concrete):**
- There is no web app manifest: `/manifest.webmanifest` and `/manifest.json` return 404, and no `<link rel=manifest>` is in the HTML.
- There is no service worker: `/sw.js` and `/service-worker.js` return 404. In the browser, `getRegistrations()` returned `[]` and `caches.keys()` returned `[]`.
- No `serviceWorker`, Workbox, IndexedDB or `beforeinstallprompt` strings were found in the 13 public JS chunks. There is no install prompt on the marketing site.
- Conclusion: the public site is not an installable PWA. The "offline-first" claim describes the logged-in app (a local queue plus de-duplicated sync), which is UNVERIFIED because it sits behind sign-in. The desk research's "PWA only" claim could not be confirmed from public pages.

**Everything else observed:**
- Framework: Next.js on Cloudflare via OpenNext, HTTP/3, `cache-control: no-store` on HTML (so no edge caching of pages). Fonts and theme are inline; a `localStorage` key `medlitics-theme` is set.
- Vendors: only one chat vendor is loaded now (Tawk.to, `embed.tawk.to` and `va.tawk.to`). The earlier Intercom + Crisp + Tawk CSP could not be re-observed. No CSP, HSTS, X-Frame-Options or Referrer-Policy headers appeared on the HTML responses I fetched (UNVERIFIED if Cloudflare adds them elsewhere).
- Performance (pricing page, mobile emulation, cold): 30 requests, about 324 KB transferred and 838 KB decoded, LCP about 3.2 s, DCL about 255 ms. Page weight is modest. LCP is hurt by a hero image and the chat widget.
- SEO: `noindex` is emitted on the pages that rendered the not-found shell. The home page has title, description, keywords, OG and Twitter tags, but no JSON-LD (0 blocks), no `sitemap.xml` (404) and no canonical link. `robots.txt` carries Cloudflare content-signal text.

## Safety and regulatory concerns

- "Predict earlier" and "advanced AI risk prediction" in marketing, with no validation, intended-use statement or regulator (NAFDAC/SaMD) reference visible. The risk-prediction claim sits in the paid tier.
- "Under 2 hours from a critical alert to practitioner action" is a service-level promise with no stated staffing model or escalation ladder, and the "critical" thresholds shown (such as glucose 7.8) are not sourced.
- The NDPR page claims "Compliant" with AES-256 at rest, a DPO, 72-hour breach notice, and "primary health data within Nigeria" while the infrastructure is Cloudflare and Next.js on an unspecified cloud. There is no NDPC registration or DPCO audit reference. UNVERIFIED.
- The AI disclaimer is good practice, but an AI explanation that says trends "usually follow a change in routine" is still interpretive clinical language.
- The emergency line says "contact your local emergency service" and gives no number or in-flow emergency path.
- Money pitch: USD price shown to Nigerian users, with a "Naira at payment where available" caveat.

## What Tarragon should adapt (originally)

1. A single before-and-after timeline in the hero (reading, alert, doctor knows) as one visual, built with Tarragon's real escalation SLA data, not an invented demo.
2. A practitioner-queue vignette ("severity then wait time") on the marketing site, using real UI screenshots and the actual escalation ladder.
3. Publish targets openly as targets, and later publish real outcomes against them. Do it in Tarragon's own metrics, with sources.
4. Offline queue with visible "waiting to sync" labels and an idempotency key per action. Tarragon can ship this on the mobile app and web (the plan is to check what exists first).
5. Consultation step-down (video, then audio, then chat) as a documented resilience feature, if Zoom/WebRTC support allows it.
6. Show prices before sign-in, in NGN, on the first screen.

## What Tarragon should avoid

- USD list pricing for a Naira market, and plan tiers that gate safety features ("basic early-warning alerts" on Basic, "real-time alerts" on Premium). Tarragon's red-flag detection is on every plan.
- Unvalidated "AI risk prediction" claims and a numeric alert-to-action promise without a real escalation SLA behind it.
- Claiming "offline-first PWA" without a manifest, service worker or install path. Check Tarragon's own claims against what ships.
- A chat widget that auto-opens over pricing on mobile, and a missing JSON-LD, sitemap and canonical setup.
- NDPR "Compliant" checklists without registration and audit evidence. Tarragon has NDPC approval and a DPO, so say so with the reference.
- Names like "Meddy" for a bot that interprets trends without a governed registry. Any Tarragon equivalent must go through `runGovernedAi()`.
