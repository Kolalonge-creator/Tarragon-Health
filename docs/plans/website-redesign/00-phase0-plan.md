# Tarragon Health marketing website upgrade: Phase 0 plan

Date: 2026-11-05. Status: **proposal, awaiting founder approval.** Nothing on the live site has changed.

This plan follows the founder's "Tarragon Health 2.0 marketing website" specification, applied to the
site we already run. It is an upgrade of the existing Next.js site in `apps/web/src/app/(marketing)/`,
not a rewrite. The specification mentions Django; Tarragon does not use Django (Stack A: Next.js 16 +
Supabase), so every technical choice below stays on the current stack.

Supporting reports in this folder:

| File | What it is |
|---|---|
| `01-code-audit.md` | Read-only audit of the marketing code: pages, nav, design tokens, pricing source, content system, SEO, forms, analytics, accessibility, tests, with a Retain/Improve/Redesign/Replace/Remove/Build-new table |
| `02-live-site-audit.md` | Crawl of tarragonhealth.ng: status codes, metadata, sitemap gaps, screenshots review, lab performance, axe-core results, trackers before consent |
| `03-benchmark.md` | Review of One Medical, Doctolib, Maven, Mayo Clinic, Teladoc, Ada, Cleveland Clinic and Hims (Zocdoc and Carbon Health blocked automated access), with 14 principles for Tarragon |

## 1. Founder decisions taken in this session (2026-11-05)

| # | Decision |
|---|---|
| W-01 | Pace: plan first, show a homepage mock-up, build only after approval; one PR per phase, each checked on a Vercel preview link |
| W-02 | Imagery: real app screens with synthetic data, plus **licensed** stock photography of Nigerian adults and families, never presented as Tarragon patients or staff. The current AI-generated (Midjourney) hero and body photos are replaced. Real leadership headshots stay |
| W-03 | Logo (Guard Leaf, no checkmark) stays; a new colour palette is proposed (section 5) for the founder to choose |
| W-04 | Six overlapping or retired pages are 301-redirected to their new home (section 3.3) |
| W-05 | `/hmo` merges into one "For Employers & Organisations" page with an HMO/insurer section and its own enquiry option; `/hmo` redirects there (the payer platform is dormant and no insurer contract is signed) |
| W-06 | Synlab Nigeria is named as "our laboratory partner", logo allowed by the agreement, never presented as an accreditation, never as the only choice (placement in section 4.4) |
| W-07 | Cookie consent becomes **opt-in**: only essential cookies until the visitor accepts |

## 2. What we found (summary)

**Already strong, keep:**
- Prices and Membership inclusions come from one place (`lib/marketing/membership.ts`, versioned config
  `commerce.membership_prices` v4: ₦100,000 individual, ₦90,000 employer seat). `no-public-prices.test.ts`
  blocks typed naira figures, "Membership Plus" and "testing day". The new pages reuse this; no price is typed.
- `MEMBERSHIP_INCLUDES` already states the approved entitlements honestly (one online doctor meeting a
  month, no lab costs included, no turnaround promised).
- All 84 sitemap URLs return 200, no broken internal links, one H1 per page, canonicals and OG images on
  almost every page, strict CSP, first-party analytics only (no GA4 / pixels), no trackers before consent.
- Good accessibility bones: skip link, landmarks, focus rings, focus-trapped mobile menu, reduced-motion guards.
- Article admin exists (`marketing_resources`, edited at `/admin/settings/resources`); reviewer byline is null-gated.

**Problems to fix (high first):**
1. `/terms` still describes "three plans… Membership Plus"; `/telehealth-consent` mentions Plus; both render raw `**` Markdown.
2. Mobile: cookie banner (~20% of screen) + top bar and header (~27%) bury the hero; hero text on busy photos; home page ~20,000px tall on mobile; fade-in leaves sections blank until scrolled.
3. Information architecture: 5-column footer with ~40 links in the wrong groups; no dedicated Membership page; no Families page; `/corporate` never shows the ₦90,000 seat price; six overlapping pages.
4. Imagery is AI-generated; hero video loads a 555 KB poster + 402 KB MP4; ~460–540 KB JavaScript per marketing page; 35 prefetch requests on the homepage.
5. SEO gaps: `/monitoring`, `/therapy`, `/result-interpretation` missing from the sitemap and OG images; `/impact` in the sitemap but noindex; `www.` does not redirect; login/signup lack noindex; 35 of 40 article titles over 65 characters; `lastmod` is build time; robots does not cover `/payer`, `/provider-org`, `/reader`, `/share`, `/claim`.
6. Articles have no references, next-review date or person author, and no Article schema.
7. Contact form has no honeypot or rate limit on the `leads` insert; the careers link records enquiries as "patient".
8. Contrast: green links on pale green 4.41:1, 12px text in the green stat strip 4.0:1; 45–54 tap targets under 24px per mobile page; one video autoplays without a reduced-motion check.
9. Synlab wording ("contracted laboratory partner") and a "Delivery courier" partner type that no longer exists; homepage line "plus a yearly health check".
10. Cookie banner is opt-out (fixed by W-07).

## 3. Information architecture

### 3.1 Primary navigation

Desktop: **How it works · Services · Membership · For families · For employers · Resources · About**,
then `Log in` (text) and `Get started` (primary button). On mobile: a labelled "Menu" button opens a
full-screen drawer with the same items, then the two actions full width. The current audience utility
strip is removed (the audiences move into the main nav).

### 3.2 Sitemap (target)

| Page | URL | Built from |
|---|---|---|
| Home | `/` | Redesign |
| How it works | `/how-it-works` (new URL) | Rebuild from `/services` + `/pricing/how-it-works`; old URLs redirect |
| Services (index) | `/services` | Redesign as the index of service pages |
| Preventive care | `/prevention` | Improve |
| Lab results and upload | `/result-interpretation` | Improve (the AI lab-report engine story, clinician review) |
| Doctor consultations | `/consultations` (new) | Build from existing consult copy |
| Ongoing monitoring / chronic care | `/chronic-care`, `/hypertension`, `/diabetes`, `/obesity`, `/monitoring` | Improve |
| Medication, devices, vaccinations, therapy | existing URLs | Copy check |
| Diagnostic provider network | `/labs` | Improve (directory, Synlab partner line, provider application) |
| Membership | `/membership` (new) | Build: the standalone sales page; `/pricing` becomes the compact comparison and links to it |
| For families | `/families` (new) | Build: Care Circle + sponsorship; `/gift` and `/parentcare` fold in |
| For employers & organisations | `/corporate` | Redesign (Maven-style) + HMO section; `/hmo` redirects |
| Healthcare professionals | `/clinicians` (new) | Build: clinical approach, join the network, enquiry |
| Our clinical approach | `/clinical-approach` (new) | Build from `/accountability` content; `/accountability` stays as the evidence page |
| About | `/about` | Improve |
| Resources and health library | `/resources`, `/resources/[slug]` | Improve (article template, filters) |
| Tools | `/bmi-calculator`, `/activity-calculator`, `/mental-wellbeing-check`, `/symptom-checker` | Retain |
| FAQ, Contact, Careers, Partners, Coverage, Impact | existing | Improve |
| Legal | `/privacy`, `/cookies`, `/terms`, `/telehealth-consent`, `/accessibility` + new `/clinical-disclaimer`, `/complaints` | Fix Plus copy and Markdown rendering; add the two missing pages |

### 3.3 Redirects (301, in `next.config.ts` redirects so they are server-side)

| Old URL | Goes to |
|---|---|
| `/parentcare` | `/families` |
| `/gift` | `/families#sponsor` (after the sponsor flow is checked) |
| `/annual-health-check` | `/membership#annual-review` |
| `/advanced-diagnostics` | `/labs` |
| `/who-its-for` | `/for-you` |
| `/screening-journey` | `/how-it-works` |
| `/health-education` | `/resources` |
| `/care-coordination` | `/how-it-works` |
| `/hmo` | `/corporate#insurers` |
| `/pricing/how-it-works` | `/how-it-works` |
| `www.tarragonhealth.ng/*` | `tarragonhealth.ng/*` (Vercel domain redirect) |

A redirect test lists every old URL and its target so nothing is dropped. Authenticated app routes
(`app.` subdomain, `/patient`, `/clinician`, `/admin`, `/login`, `/signup`) are untouched.

### 3.4 Footer

Four columns: **Care** (How it works, Services, Membership, Lab results, Consultations) · **For you**
(Families, Employers, Clinicians, Diagnostic providers) · **Health library** (top 6 topics) · **Company**
(About, Clinical approach, Careers, Contact, FAQ). Bottom: the emergency line ("Tarragon is not an
emergency service…"), RC number and NDPC registration, DPO contact, legal links, Cookie settings,
social links, app badges.

## 4. Homepage

Order (each section one idea; mobile spacing 56–72px, desktop 96–140px):

1. **Hero (split).** Headline recommendation: **"Your health deserves more than an annual check-up."**
   (clearest of the five options; says what is different without fear). Supporting line from the spec.
   One primary CTA "Get started", one secondary "See how it works". Trust line: "Preventive care, guided
   by clinicians and supported by technology." Right side: a licensed photo of a Nigerian adult with the
   real app on a phone. No video, no carousel.
2. **Audience router.** Three tappable rows: For me · For a parent or relative in Nigeria · For my employees.
3. **The problem** ("Your health information should work together"), four short points, no fear language.
4. **One connected journey**: the five capabilities as a looping five-step sequence (profile → plan →
   tests → results reviewed → keep going).
5. **Real product showcase**: phone + desktop frames of real screens with synthetic data (plan, result
   trend, doctor review, Care Circle). Labelled "Example screens".
6. **Services**: six cards linking to the service pages.
7. **Membership**: Free vs Membership cards from `membership.ts`, "lab tests are paid to the laboratory",
   CTA "Join Membership", secondary "Compare plans".
8. **Diagnostic network** (with the Synlab partner line, see 4.4).
9. **Care Circle and sponsorship**: patient controls what is shared; sponsoring does not unlock records.
10. **Employers**: ₦90,000 seat line from config, aggregate-only reporting, CTA "Discuss an employer programme".
11. **Clinical credibility**: named, verified leadership (headshots), MDCN registration only where
    verified, governance commitments, link to `/clinical-approach`.
12. **Testimonials**: stays dormant until a real consented quote exists; otherwise a founder message.
13. **Final CTA** and footer.

### 4.4 Where Synlab appears (W-06)

Enough to build trust, never so much it looks like a Synlab-only service:
- **Homepage, diagnostic network section**: one row "Our laboratory partner" with the Synlab logo at
  modest size (around 28–32px tall, greyscale-to-colour on hover is not needed), next to the sentence
  "Take your request form to any Synlab branch, or to another eligible laboratory in our directory."
- **`/labs`**: a partner panel above the directory search, with the same sentence and a link to find a
  Synlab branch in the directory.
- **`/membership` FAQ** "Where do I do my tests?": the same sentence, name only.
- **Not** in the hero, nav, footer, the trust strip or on every page. Wording never says "accredited by",
  "approved" or "contracted". Partner status is not a quality accreditation, and ISO 15189 is shown only per
  laboratory where verified in the directory.

## 5. Design system

### 5.1 Palette options (choose one; all pass WCAG AA for body text on the canvas)

| Role | A. Evergreen (recommended) | B. Deep teal | C. Refined Tarragon |
|---|---|---|---|
| Primary (brand, primary buttons) | `#0B5D45` forest | `#0F5C63` teal | `#0A6B48` (deepened current green) |
| Secondary / supporting | `#DCE8DF` sage | `#D9ECE8` mint | `#E3EDE4` sage |
| Canvas | `#FAF7F2` warm off-white | `#F8F6F1` | `#FBF8F3` cream |
| Surface | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| Headings | `#14231E` | `#132427` | `#12324B` (Clinical Navy) |
| Body text | `#2A3430` | `#2B3537` | `#2A3133` |
| Secondary text | `#5E6B66` | `#5D6A6C` | `#5F6A66` |
| Accent (one important action / highlights) | `#E0A23B` marigold | `#E2725B` coral | `#C9962B` sprout gold |
| Border | `#E3DED5` | `#E1DDD4` | `#E5E0D6` |
| Success / warning / error | `#2E7D4F` / `#B26A00` / `#B42318` | same | same |

Status colours are never the only signal (icon + text). Clinical dashboard status colours stay a separate system.

### 5.2 Typography

Two options, shown side by side in the mock-up:
1. **Recommended: serif display + sans body.** `Fraunces` (headings, weight 500) + `Inter` (body 16–18px,
   weight 400, line height 1.6). Every strong benchmark site uses an editorial serif for warmth and authority.
2. **Single family.** `Plus Jakarta Sans` for everything (the spec's "one family" preference).

Scale (mobile → desktop): hero 36→60px, page H1 32→48, H2 26→36, H3 20→24, body 16→18, small 14, label 13
(never body text under 16px). Fonts self-hosted via `next/font` (no runtime Google request; CSP unchanged).

### 5.3 Components

Built on the existing `_components` (kept where the audit says Retain), with these new or redesigned:
nav + mobile drawer, footer, split hero, audience router rows, journey stepper, product showcase frame,
service card, plan card + inclusion table, partner row, trust/credential row (null-gated on verified
records), privacy panel, article template (author, clinical reviewer, published, last reviewed, next
review, references, disclaimer), FAQ accordion (kept), enquiry form (honeypot + rate limit), cookie
preferences dialog (opt-in, "Reject non-essential" equal to "Accept"). Tokens documented in
`docs/BRAND_GUIDE.md` and `packages/ui/src/theme.css`.

## 6. Content, CMS and governance

- **No new CMS.** Extend `marketing_resources` with `author_id`, `references` (jsonb), `next_review_at`,
  `status` (draft → in clinical review → approved → published, plus scheduled publish), and a revision
  history table; publishing a clinical article requires a clinical reviewer record (null-gated byline).
  This follows the founder rule that articles follow NICE and Nigerian guidelines (Nigerian wins where they differ).
- FAQs move from static TS to an admin-editable table only in Phase 4, if the founder wants editors to change them.
- Prices stay in versioned config (no editor can change them from the content admin). Marketing editors
  cannot touch clinical rules or entitlements.
- All copy follows the house rules: plain but educated, no em dashes, no "doctor-led" headline, no fear
  language, no invented numbers, testimonials, credentials or partners.

## 7. SEO, analytics, security, performance

- **SEO:** fix the sitemap gaps and `lastmod`; `www` redirect; noindex on login/signup; robots for the
  remaining app paths; Article, Person and Offer (Membership) JSON-LD where accurate; titles under 60
  characters; internal linking from articles to the relevant service. No thin location pages.
- **Analytics:** keep the first-party `/api/track`; switch to opt-in (W-07); add Google Search Console
  (verification only, no script). Funnel events: hero CTA, signup start/complete, membership page view,
  checkout start, payment success, sponsor start/complete, employer enquiry, provider application.
  Never any clinical data in events; no tracking on login, onboarding, payment or clinical pages.
- **Security:** honeypot + per-IP rate limit on the `leads` insert; fix the careers `role` bug;
  keep the strict CSP (no new third-party scripts planned).
- **Performance budget:** LCP ≤ 2.5s, INP < 200ms, CLS < 0.1 (p75); hero as one optimised image (AVIF/WebP,
  responsive sizes, ≤ 120 KB on mobile), no hero video; cut marketing JS by trimming client components and
  prefetching; animations CSS-only and never hide content before it loads.
- **Accessibility:** WCAG 2.2 AA: fix contrast tokens, 24px minimum tap targets, reduced-motion on all
  video, axe-core in CI on key pages.

## 8. Roadmap (one PR per phase, each on a Vercel preview)

| Phase | Scope | Gate |
|---|---|---|
| 0 | This plan + audits + benchmark (this PR, docs only) | Founder approves plan, palette, typeface, homepage mock-up |
| 1 | Design tokens, typography, nav, footer, core components, cookie opt-in; homepage rebuilt | Founder reviews preview on phone + desktop |
| 2 | How it works, Services, Membership, About, Clinical approach, Contact; legal copy fixes (Plus, Markdown) | Preview + content accuracy test |
| 3 | Families (Care Circle + sponsorship), Employers & organisations (with HMO section), Labs/provider network, Clinicians | Each conversion journey demonstrated on the preview |
| 4 | Health library: article template, provenance fields, review workflow, Article schema | CMO/clinical reviewer sign-off on the workflow |
| 5 | SEO fixes, redirects, Search Console, funnel events, analytics dashboard | Redirect test + sitemap check |
| 6 | Accessibility, security, performance pass; axe-core in CI; mobile real-device checks | Test report |
| 7 | Launch: merge to main-dev (Vercel production), monitor, rollback = revert the merge | Live check of every journey with screenshots |

Each phase ends with screenshots on mobile and desktop, the journeys demonstrated on the preview, and
test results, not just a passing build.

## 9. Open items only the founder can supply

1. **Licensed photography**: budget and source (e.g. a Nigerian stock library or a commissioned shoot later). Until then I use licensed stock picked to the brief; you approve each image.
2. **Public clinical leadership**: confirm who is named as CMO on the site (`/about` names Dr Maxwell Dayok) and which MDCN registrations we may display.
3. **Contact details** for the new Contact page: which phone numbers and the business address to publish.
4. **Testimonials**: any real, consented quotes; otherwise the section stays dormant.
5. **Sponsorship flow**: confirm the sponsor-for-a-relative checkout is live before `/families` promises it (Care Circle sessions own it).
