# S40 competitor review: Avura Cares and WellNation Nigeria

Method: public pages only, 2026-10-06. Raw HTML and headers via curl, plus the built-in browser. No sign-ups, no form submissions, no personal data entered.
The shared browser pane was repeatedly navigated by other sessions, so runtime performance numbers and the 390px mobile check are mostly UNVERIFIED. Static measurements below are reliable.
Not to be confused with the unrelated "Avura" ozone-sanitiser brand.

## 1. Avura Cares (avuracares.com)

### Snapshot
- A one-page marketing site for a "preventive healthcare-tech company". Services listed: telemedicine, outpatient clinics, domiciliary (home) care, health insurance, nutritional profiling, ambulance, mental health, physiotherapy and exercise or dance classes for elders.
- Only price shown: "from N5,000/month for basic telemedicine", stated in the FAQ and in the FAQ JSON-LD. A phone number and WhatsApp link are the contact route.
- No named doctors, partners, underwriter, licence numbers or reviews anywhere. Footer says 2025.
- `/about`, `/services` and `/pricing` return 404. The nav links are in-page anchors.
- No app found (agrees with the desk research).

### Design
- Information architecture: a single scroll with 4 nav anchors (Home, Services, About, Contact). Hero, services grid, story, "What we offer", FAQ, contact form.
- Visual system: navy header, cream hero, orange pill CTA. The look is generic Tailwind template. Only 3 images, all stock or team shots with descriptive alt text. 51 `hidden` utility hits suggest several hidden or never-shown components.
- CTA: a single "Explore Our Services" button that scrolls the page. No visible "start" or "pay" action.
- Mobile at 390px: hamburger menu with max-height animation exists in code. Layout at 390px UNVERIFIED. In the 1024px browser run the document was wider than the viewport (`scrollWidth > innerWidth`), probably from AOS scroll animations. Needs a retest.
- Accessibility signals: `lang="en"`, alt text present, viewport meta. Not checked: contrast and focus states. About 17 of the interactive elements measured under 44px tall.
- Tone: the Pidgin line is only the hero headline; the rest is formal English. Typos that undermine trust: "emphatic" used for "empathic" (3 times), "adaptive equipments", "healthy mental environment" garbled.
  - The headline is idiomatic and reads authentic. A single line then a formal register means the Pidgin works as a hook, not a voice. It stops at the hero.

### Functionality
- Observable features: a contact form posting to Formspree, a WhatsApp click-to-chat link, an FAQ accordion (Alpine.js), a "download plan guide" modal. No booking, no login, no portal.
- Dormant code found in the page source (no visible button calls it, 0 `openModal` triggers rendered):
  - A registration modal with two named plans, "SafeBuddy" (N83,000 individual, N155,000 couple, N415,000 family) and "SafePal" (N107,000, N210,000, N535,000), with a dependents picker and Paystack inline checkout. Billing period UNVERIFIED.
  - The site's meta description still tells people to "Start with SafeBuddy today", so the N5,000/month headline and the N83k+ plans contradict each other.
- Disclaimers: none visible. No privacy policy, terms, clinical disclaimer or emergency advice (the word "emergency" appears only for ambulance).

### Code and performance
- Hosting: Netlify (Netlify Edge cache). Static hand-written HTML, no framework or CMS.
- Vendors: Tailwind Play CDN (runtime JIT in production, a known anti-pattern), Alpine.js, AOS, Font Awesome via CDN, Google Tag Manager/GA4, Amplitude (session-replay config fetched), Paystack inline.js loaded on every page view, Formspree.
- Weight: HTML 38 KB, about 17 requests, transfer total UNVERIFIED (browser reading returned 0 KB from cross-origin entries). Load event about 0.8s on a warm connection.
- Security headers: only `strict-transport-security`. No CSP, X-Frame-Options, X-Content-Type-Options or Referrer-Policy.
- Notable defect: the checkout script reads `process.env.PAYSTACK_PUBLIC_KEY` and `process.env.PAYSTACK_SECRET_KEY` in browser code and tries to verify payments client-side with a Bearer secret key. On a static site `process.env` is undefined, so checkout cannot work as written. The design is also unsafe: it expects a secret key in the browser. Not exploitable here (no key is exposed), but it shows no one has reviewed the payment path.
- SEO: good basics for a tiny site: title, description, canonical, Open Graph and Twitter cards, `MedicalClinic` JSON-LD (phone, 24/7 hours, `PreventiveMedicine`) and `FAQPage` JSON-LD. `/robots.txt` and `/sitemap.xml` both 404 (SPA-style catch-all). No manifest, no service worker (both 404).

### Safety or regulatory concerns
- "Health Insurance" is sold with no named licensed insurer. Possible NAICOM issue if it is underwriting or brokering. Coverage "varies by plan"; the plan guide is not found.
- "Qualified healthcare professionals" and "toll free consultation" without named doctors, MDCN registration or clinical governance.
- Collects names, email, dependents and a free-text health message via Formspree (US third party) with no privacy notice. NDPA/NDPC exposure.
- Google Analytics and Amplitude session replay on a health site with no consent banner.
- 24/7 "24 hours active listening sessions" and ambulance claims are unsupported.

### What Tarragon should adapt (originally)
- One plain price sentence near the top of the pricing page, as Avura does. Keep Tarragon's real structure (free app plus membership); do not copy a number.
- A single Pidgin line used as a warm hook in a clearly optional place (a push notification, an empty state, a share card), written and checked by a native speaker. Do not make Pidgin the only language of any safety message.
- FAQ and `MedicalClinic`-style JSON-LD with a real phone number, since it costs little. Check Tarragon's marketing pages carry both.
- Click-to-WhatsApp as a lead route for people who will not fill a form. Note: Tarragon removed WhatsApp as a care channel (F-02); a marketing-only link on a public page is a separate decision for the founder. Flag it, do not assume.

### What Tarragon should avoid
- Typos and invented words in clinical copy ("emphatic").
- Contradictory prices between headline, meta description and hidden code.
- Payment keys or verification in browser code; unbranded Tailwind CDN in production.
- Listing services (ambulance, insurance, home care) with no named provider, licence or limits.
- Analytics and session replay on health pages without consent, and no privacy policy.

## 2. WellNation Nigeria (wellnationnigeria.com)

### Snapshot
- A five-page brochure site for an "ecosystem integrator": wellness, telehealth, diagnostics, insurance and pharmacy through unnamed licensed partners. Pages: Home, About Us, Services, Who Benefits, Contact Us. No pricing, no product screenshots, no testimonials, no partner logos, no named team.
- Contact details: Lagos, a phone number, a personal Gmail address on the Contact page and a different `wellnation.com` address in the footer. Copyright 2025; page last modified Feb 2026.
- Sister sites:
  - wellnationafrica.com: shows a hosting "Website Inactive" suspended-account page (302 to cgi-sys/suspendedpage). So the South African wearables-and-challenges site is currently down.
  - wellnation.com: DNS resolves (45.40.148.117) but HTTPS timed out or failed the TLS handshake from my tools. UNVERIFIED.
- The wellness challenge and wearable features described in the earlier desk research are UNVERIFIED: no live page or app listing could be reached in this pass. Nothing on the Nigeria site mentions challenges, wearables or an app.

### Design
- Information architecture: shallow 5-item top nav with a "Skip to content" link. Home has hero, about, five service blocks, "why choose", a closing CTA.
- Visual system: Elementor Hello theme with stock photos of smiling people; 9 images, all with alt text. Generic and polished enough to read as credible, but indistinguishable from any consultancy.
- CTA: "Get Started" and "Partner With Us" both lead to a contact form. The Contact page says Request Proposal / Join Our Network / Book A Demo: the audience is B2B partners, not patients. There is no patient action at all.
- Tone: formal English, heavy on compliance qualifiers, no local language. Mobile at 390px UNVERIFIED (Elementor with `additional_custom_breakpoints` normally handles it).
- Accessibility signals: skip link, `aria-label` on form, alt text on images. Not tested for contrast or keyboard.

### Functionality
- One contact form: name, phone, email, message. Submits to WordPress (Elementor Pro). I did not submit it.
- No booking, login, search, pricing or app. All "features" are marketing statements (risk assessments, wellness programs, telehealth via partners, a "nationwide network" of labs, pharmacy support).
- Disclaimers are the strongest part: repeated on every page that it does not diagnose, treat, test or underwrite; consultations by licensed practitioners; labs accredited; insurance via licensed insurers and brokers; "for medical emergencies contact emergency services". Wellness programmes are "not a substitute" for medical advice. No privacy policy or terms page (both 404).

### Code and performance
- WordPress 7.1.2 with Elementor 4.3.3, Elementor Pro, Hello Elementor theme, ElementsKit Lite, a gum-elementor addon and Yoast (robots.txt and `sitemap_index.xml` from Yoast). Hosted behind Cloudflare with a 31-day public cache.
- Weight: HTML 18.5 KB gzip. 33 same-origin assets, 24 JS files, about 2.2 MB of content-length (images dominate, largest about 600 KB JPEG, five photos over 200 KB; some may be gzip-length so treat as approximate). No third-party scripts found in the HTML: no analytics, chat or tag manager. Good for privacy, nothing to measure conversion.
- Security headers: none of CSP, HSTS, X-Frame-Options, X-Content-Type-Options or Referrer-Policy returned. The WordPress REST API (`/wp-json/`) is public and the generator tags leak versions.
- SEO: Yoast defaults. JSON-LD is only the generic Yoast graph (WebPage, BreadcrumbList, WebSite): no `Organization`, `MedicalOrganization`, address or phone. Open Graph present. No manifest or service worker found (not requested in the site, UNVERIFIED by direct fetch).

### Safety or regulatory concerns
- The disclaimer wall is sensible, but a business whose entire proposition is partners names none, so "accredited labs, licensed insurers" is unverifiable.
- Brokering insurance and pharmacy access may need NAICOM and PCN-related registrations; no registration numbers shown. UNVERIFIED whether any exist.
- Personal Gmail as the public contact and a different domain in the footer look unfinished and weaken trust.
- Collects phone and message with no privacy notice or consent text, which is an NDPA exposure.
- Sister site is suspended, so any claim of an African wearables product is not currently checkable.

### What Tarragon should adapt (originally)
- A short, plain "what we do and do not do" block, but backed by Tarragon's real specifics: named lab partners, the doctor-review and escalation mechanism. WellNation's disclaimers show the instinct; Tarragon can do it with proof.
- A visible "for emergencies call X" line on public pages, in a calm register (already in line with Tarragon's no-fear voice).
- A skip-to-content link and `aria-label` on forms as cheap baselines, if not already present.
- A B2B contact route with distinct intents (employer, insurer, lab) as a single form with a dropdown, if Tarragon's employer or HMO modules go live.

### What Tarragon should avoid
- Claiming a "network" without naming one partner.
- A patient-less site: every CTA must lead to something a patient can do today.
- Personal email addresses on public pages; mixed contact domains.
- Version-leaking CMS tags and no security headers on a health site.
- Large unoptimised stock photos (about 2 MB of images for a text page) on low-bandwidth networks.
- Describing wearables or challenges that are not live.

## Comparison for Tarragon
- Both sites are thin and prove the desk research: no verifiable trust footprint. Neither has a privacy policy, a named clinician or a named partner. Tarragon's differentiators (named labs, documented escalation, null-gated reviewer attribution, consent model) are the opposite and should be visible on public pages.
- Avura wins on warmth and one clear price; WellNation wins on disclaimer discipline. Neither ships a patient product.
- Gaps in this review: 390px mobile rendering, real page weight in a browser, app-store checks, wellnation.com and the wellness-challenge/wearable features. Retry with an unshared browser session if these matter.
