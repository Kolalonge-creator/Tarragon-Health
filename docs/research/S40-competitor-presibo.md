# S40 competitor review: Presibo (presibo.com)

Public pages only, reviewed 2026-10-06. Nothing was signed up for, submitted or entered. Prior desk research
(reports/Nigeria healthtech competitor analysis.md) is not repeated; this adds hands-on observation.
Browser-pane note: the shared pane was repeatedly hijacked by other sessions, so DOM measurements came from a
dedicated tab plus curl; anything not confirmed is marked UNVERIFIED.

## Snapshot
- Static marketing site on Vercel (server: Vercel, HSTS on, `last-modified` 2026-09-30). Pages per sitemap: home, about, doctors, agent-signup,
  fitness, elders, subscribe, download, contact, join, blog (9 posts, mostly grants, awards, partnerships).
- Positioning: continuous BP and sugar tracking from home, doctor on standby, device bundle, elder and family plans, agent (reseller) programme.
- Hero claims "35 million Nigerians" with hypertension and diabetes; stats band says 22.5M+ (a market figure, not Presibo users).
- Trust surface is institutional logos (TEF, Orange Corners, MIT Solve, Lagos LSETF and Ministry, GITEX). No named hospital, lab, regulator or doctor on the pages checked.

## Design
Strengths
- Calm, premium palette: warm off-white background (rgb 250,247,242), deep navy text, muted teal-green primary. Serif display (Fraunces) with DM Sans body, italic accent words in headlines. Feels human, not clinical.
- Clear hero: one primary CTA ("Start Monitoring Today"), one secondary, store badges directly under. Mobile at ~375px is clean, no horizontal scroll, hamburger nav, large tap targets on primary buttons.
- Plain-language problem framing and a four-step "how it works" section; consistent card styling on pricing.
Weaknesses
- Desktop nav is crowded: 10 items plus Sign Up (About, Doctors, Become Agent, Fitness, Elder Care, Subscribe, Download, Blog, Devices, Contact); fitness and agent items dilute the chronic-care message.
- Accessibility signals are weak: no `<main>` landmark, only 2 `aria-label`s, 24 interactive elements under 32px tall on mobile, hero image alt text is "Elder Care Services" on a general hero. Hero and subtitle text looked pale in captures (probably a scroll-reveal animation mid-fade; contrast UNVERIFIED).
- Pricing page uses emoji as icons; heavy reveal animations delay readable text.
- Hero image is a single 368KB PNG (see below).

## Functionality (publicly observable)
| Area | What the public site says | Notes |
|---|---|---|
| Plans | Individual N5,000/mo; Elder Care N15,000/mo; Family N25,000/mo (up to 4 people); weekly N3,000 mentioned on home | Individual says includes device on home but device page sells devices separately: inconsistent |
| Included | Daily tracking, doctor chat and video, AI insights, emergency SOS, family portal | No limits on consult count stated |
| Devices | Smart BP monitor N52,000, free shipping; glucometer N58,000 pre-order with 10 strips | "Clinically validated" claimed; no NAFDAC or model name seen |
| Doctors | Directory-style search by specialty and availability | No credential, MDCN or onboarding detail visible |
| Elder care | Remote monitoring, medication management, SOS, caregiver alerts, 24/7 hotline number, "nurses around the clock" | No disclaimer or response-time promise visible |
| App | Log BP, glucose, weight, medication; messaging; prescriptions; reminders. Android and iOS badges; WhatsApp channel link | iOS availability UNVERIFIED (prior research found a broken link) |
| Refund | 30-day money-back on subscription | Payment methods not stated |
| Sign-up | Account created in app; web "Sign Up" button | Not followed (no sign-up) |
| B2B | Clinic SaaS from N50k/mo; agent programme with N25,000 onboarding fee | Reseller model |
| Languages | English only on site | Local-language triage not live |
| Offline | No PWA, manifest or service worker found | |

## Code and performance
- Hand-built static HTML/CSS/JS, no framework or CMS (single `script1001.js`, `assets/style.css`). No generator meta.
- Third parties: Google Fonts, Font Awesome 6.4 from cdnjs. No Google Analytics, chat widget or payment SDK on the homepage (WhatsApp link only).
- Page weight: 13 requests, about 533KB encoded; hero PNG 368KB is most of it; partner logos are JPG/PNG (no WebP/AVIF). Fast TTFB via Vercel edge cache. LCP not captured reliably (UNVERIFIED).
- No service worker, no web manifest, so no install or offline use.
- Script calls `/api/config` and `/api/counter` (live visitor counter, hardcoded fallback of 222) and queries ipapi.co from the visitor's browser to derive location: sends visitor IP to a third party on a health site, a privacy smell.
- SEO: good basics (title, description, canonical, OG and Twitter cards, robots allow-all, sitemap with 20 URLs). No JSON-LD structured data at all, no MedicalOrganization or FAQ schema.
- Security headers: only HSTS seen; no CSP, X-Frame-Options, X-Content-Type-Options or Referrer-Policy; `access-control-allow-origin: *` on the HTML.
- Privacy and terms pages exist (200). NDPA/NDPC reference not found in a quick text scan (UNVERIFIED).

## Safety or regulatory concerns
- "24/7 remote monitoring" and nurses "around the clock" with no stated response times, escalation rules or disclaimer; risk of implied emergency cover that an app cannot guarantee.
- Emergency SOS and a phone hotline are promoted without saying who answers or what happens when it is missed.
- "Clinically validated" device claim without model, validation body or NAFDAC registration; selling devices makes Presibo an importer/representative (the same burden Tarragon deliberately avoided).
- Doctor directory with no visible MDCN verification; unverifiable AI "insights" claims without a stated human-review path.
- IP geolocation to a third party and no consent banner seen; weak for health-data trust under NDPA.
- Vanity or mixed statistics (35M vs 22.5M, "Real Users" counter with fallback) can mislead.

## What Tarragon should adapt (in its own way)
- Quiet-urgency headline plus one primary CTA and store badges directly under the hero; keep nav short and chronic-care focused.
- Plain pricing cards with a clear refund promise, applied to Tarragon's actual paid products only (doctor time, 12-week programme).
- Founder/mission story told in first person, and institutional logos shown only where a real relationship exists.
- Caregiver visibility: explain the existing consent-graph and caregiver access more prominently, without reopening individual-enrolment-only.
- Four-step "how it works" with real screenshots; condition pages for hypertension and diabetes with JSON-LD.
- Tiny page weight: static, edge-cached, WebP/AVIF hero, which gives a fast first load on poor mobile data.

## What Tarragon should avoid
- Vague 24/7, nurse-around-the-clock or SOS promises with no response SLA or disclaimer.
- Unnamed "clinically validated" claims and bundling hardware.
- Inconsistent pricing between pages; unsourced headline user numbers.
- Third-party IP lookups or trackers on health pages without consent; missing security headers and `<main>`/alt-text hygiene.
- A crowded 10-link nav mixing fitness, agent recruitment and care.
- Reveal animations that hide text on slow devices or low-contrast first paint.
