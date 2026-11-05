# Tarragon Health marketing site: code audit

Read-only audit of the repo at `bbaef1f7f`, which is 0 commits behind `origin/main-dev`. Paths are relative to `apps/web/src/` unless stated. `(m)` is short for `app/(marketing)/`.

Two kinds of evidence are used below. **Verified** means I read the code. **Unverified** means it depends on the live DB, the live site or runtime behaviour, none of which I opened.

---

## 1. Page inventory

Notes on the sources:
- Route registry: `lib/marketing/routes.ts:3-51`. It holds 45 keys.
- `MARKETING_ROUTES_BUILT` (`routes.ts:56-99`) drives both the sitemap (`app/sitemap.ts:41-46`) and the nav's greyed-out state.
- The sitemap also lists every published `/resources/<slug>` (`sitemap.ts:53-59`), read from the DB with a fallback to the 41 static articles.
- **Nav** is the top bar, the audience strip and the mobile menu. **Footer** is `(m)/_components/marketing-footer.tsx`.
- "SitemapY" means the page is in `MARKETING_ROUTES_BUILT`.

| Route | Purpose (one line) | H1 (source) | Primary CTA | Sitemap | Nav | Footer | Status under the 2-plan model |
|---|---|---|---|---|---|---|---|
| `/` | Home, with heroes per channel (`?channel=hmo\|employer\|diaspora`) | "Care that stays with you." (`_content/channel-heroes.ts:46`, via PhotoBannerHero/ChannelHero, page.tsx:125/140) | `/signup` "Create your free account" | Y | logo | — | Current. Line 258 still says "plus a yearly health check" |
| `/services` | How it works, and what is tracked | "What we help you manage" (services/page.tsx:30) | `/signup` | Y | "How it works" | Y | Current |
| `/chronic-care` | Chronic-care overview | "Steady, followed-up care for long-term conditions" (:55) | `/signup` | Y | Y | Y | Current |
| `/prevention` | Preventive health product page | "Find health problems early, while they are easiest to treat." (`_content/products.ts:151`) | `/signup` | Y | Y | Y | Current |
| `/care-coordination` | Labs and medication coordination | "The pieces of your care, kept connected" (:70) | `/signup` | Y | — | "Laboratories and medication" | Overlaps `/labs` and `/medication` |
| `/hypertension` | Condition page | products.ts:18 | `/signup` | Y | — | Y | Current |
| `/diabetes` | Condition page | products.ts:51 | `/signup` | Y | — | Y | Current |
| `/obesity` | Weight health | products.ts:84 | `/signup` | Y | — | "Weight Health" | Current |
| `/medication` | Reminders and supply | products.ts:185 | `/signup` | Y | — | Y | Current |
| `/labs` | Request form, any laboratory, upload the result | products.ts:217 | `/signup` | Y | — | Y | Says "We partner with Synlab Nigeria" (labs/page.tsx:50). This sits badly with the lab-independent model |
| `/parentcare` | Caring for a parent: Care Circle, next of kin, gift a year | products.ts:117 | `/signup` | Y | — | "Caring for a parent" | **Likely obsolete as a product name.** ParentCare was killed 2026-07-29. The content is now Care Circle plus gifting, so it should be renamed or merged into a Care Circle / family page |
| `/annual-health-check` | Yearly tests via a request form at any lab | "Your yearly health check" (h1 inline) | links to `/pricing` and `/prevention` | Y | — | Y | **Rewritten for the new model** (lines 54-98). It is now a Membership feature, not a product, so merge it into Prevention/Membership |
| `/screening-journey` | Interactive screening explorer by age band | "Your Screening Journey" | `/signup` | Y | — | Y | Copy works with any lab ("Paid to the laboratory"). Has overlap with prevention and the annual check. Consolidate it |
| `/advanced-diagnostics` | Imaging "register interest" page, with no service yet | "Advanced diagnostic imaging" | `/contact?source=advanced-diagnostics` | Y | — | Y | **Candidate for removal** ("We will not advertise a service that we cannot deliver", :34) |
| `/vaccinations` | Vaccination schedule and verification | "Vaccinations, tracked and verified" | `/signup` | Y | — | Y | Current |
| `/mental-wellbeing-check` | Public self-check tool | "How are you really doing?" | `/signup` | Y | — | Y | Current |
| `/symptom-checker` | Public symptom tool | "What are you noticing?" | `/signup` and `/patient/care` | Y | — | Y | Current |
| `/health-education` | Static explainer of the personalised library | "Health education matched to you" | `/signup` | Y | — | Y | Overlaps `/resources` |
| `/bmi-calculator` | Calculator tool | SectionHeading h1 "BMI & Calorie Calculator" (:48) | `/signup` | Y | — | Y | Current |
| `/activity-calculator` | Calculator tool | "Physical Activity Intensity Calculator" (:41) | `/signup` | Y | — | Y | Current |
| `/monitoring` | Why a doctor is told when it matters | "A doctor is told when it matters" (:95) | links to `/chronic-care` | **N** | — | Y | Not in the sitemap. Also has no OG image |
| `/result-interpretation` | Understand your lab results | "You have your result. What does it mean?" (:97) | links to `/prevention` | **N** | — | Y | Not in the sitemap. No OG image. Strong SEO candidate for the AI lab-report engine |
| `/therapy` | Verified therapists | "Verified therapists, booked in the same place…" (:91) | links to `/mental-wellbeing-check` | **N** | — | "Talk to someone" | Not in the sitemap. No OG image. Whether therapy is actually live is **unverified** |
| `/devices` | Devices that work with Tarragon | "Devices and Tarragon" (:22) | `/signup` | Y | — | Y | Current |
| `/pricing` | Free vs Membership | `Free, or ${paidProductName()}` (:57) | `/signup`, plus `/contact?source=corporate\|hmo` | Y | Y | Y | Current. Reads config |
| `/pricing/how-it-works` | Pricing principles, Care Voucher, referral voucher | "How pricing works" (:49) | `/signup` | Y | — | **N** | Linked from the pricing page, trust band, partners page and the HMO channel hero. Its Care Voucher and referral-voucher sections (`_content/pricing.ts:233-247`) need a re-check against T2 |
| `/gift` | Gift a year of Membership | "Give the gift of health" (:106) | `/signup?intent=support` | Y | — | "Gift Tarragon" | Current as long as gifting stays (diaspora). Keep it, re-skinned |
| `/for-you` | Individuals landing page | "Monitor your health with a care team beside you" | `/signup` | Y | audience strip | Y | Overlaps `/who-its-for` |
| `/who-its-for` | Audience router | "Find your starting point" | `/pricing` | Y | — | Y | Duplicates the audience strip and `/for-you`. Merge |
| `/corporate` | Employer B2B page, with eligibility checker | "Help your workforce detect and manage chronic disease risk." (`_content/b2b.ts:52`) | `/contact?source=corporate` | Y | "For employers" | "Corporate Health" | Current. **Does not show the ₦90,000 seat price.** It appears only on home (page.tsx:231) and pricing |
| `/hmo` | HMO B2B page | b2b.ts:113 | `/contact?source=hmo` | Y | "For HMOs" | "HMO Support" | Flagged as possibly obsolete. Capitation is banned (I8) and the page is aggregate-only. Decide whether HMOs remain a sales channel |
| `/partners` | Real partnerships, no capitation, how we price | "Who we actually work with" (:75) | `/contact` | Y | — | Y | Synlab listed as "Our contracted laboratory partner" (`_content/partners.ts:36-39`) |
| `/coverage` | State coverage checker and partner map | "Where we work" | `/contact`, `/pricing` | Y | — | "Where we work" | `coverage/partner-map.tsx:18,24` still has a "Delivery courier" partner type, even though home delivery was removed (OQ-261) |
| `/accountability` | How we hold ourselves accountable | inline h1 | `/contact` | Y | — | Y | Current |
| `/impact` | Outcomes figures | "Our impact" | `/signup` | Y | — | Y | Self-noindexes when there are no figures (impact/page.tsx:26) |
| `/about` | Company, leadership | "Care should not stop when the appointment ends." (:66) | `/signup` | Y | Y | Y | Current. Has the real leadership photos |
| `/careers` | Open roles | "Help us build care that continues between visits." (:26) | `#roles`, `/contact?source=careers&role=<id>` | Y | — | Y | **Bug:** `role=head-engineering` etc. is not a `LEAD_ROLES` value, so the contact form silently falls back to "patient" (contact-form.tsx:46-47, lib/validation/lead.ts:3) |
| `/faq` | FAQ | "The questions people ask most often" (:50) | `/signup` | Y | — | Y | Current |
| `/resources` | Article hub | "Health, in plain language" | `/signup` | Y | — | Y | Current |
| `/resources/[slug]` | Article | `{article.title}` | `article.relatedHref` | Y (per slug) | — | — | Current |
| `/learn/[code]` | Shared Learning Centre article (link-only) | `{article.title}` | `/` | N (deliberately) | — | — | noindex (learn/[code]/page.tsx:26). Correct |
| `/contact` | Lead form | "Talk to us" (:22) | form | Y | — | Y | Current |
| `/privacy`, `/terms`, `/telehealth-consent`, `/accessibility`, `/cookies` | Legal | LegalDocumentPage h1 (legal-document.tsx:67/106) or inline | — | Y | — | legal row | Current. Privacy, terms and telehealth consent load from the DB via `lib/marketing/legal-data.ts` |

**Orphans and near-orphans:**
- No marketing page is completely unlinked. The footer links almost everything.
- `/pricing/how-it-works` is missing from the footer.
- `/monitoring`, `/result-interpretation` and `/therapy` are in the footer but missing from the sitemap. They are not in `MARKETING_ROUTES_BUILT`.
- `/learn/*` is link-only by design.
- `/access-fund` (`app/access-fund/page.tsx`, "Community Access Fund") is a public page outside the marketing group, with no marketing nav or footer link. I did not verify how it is reached.

**Looks obsolete or merge-worthy under two plans:** `parentcare` (name), `annual-health-check` (now a Membership feature), `advanced-diagnostics` (no service), `screening-journey` and `health-education` (overlap), `who-its-for` (duplicate), `hmo` (strategy decision), the Care Voucher block on `pricing/how-it-works` (needs a check), and `care-coordination` (overlaps labs and medication).

---

## 2. Navigation and footer as built

**Utility strip** (`marketing-nav.tsx:96-111`): tagline "Care that stays with you." (hidden below `sm`), and an Audiences nav with "For individuals" → `/for-you`, "For employers" → `/corporate`, "For HMOs" → `/hmo` (lines 30-34).

**Sticky main bar** (lines 113-195):
- Logo → `/`.
- Desktop nav (`lg+`): "Chronic care", "Prevention", "How it works" (→ `/services`), "Pricing", "About" (lines 21-27).
- "Sign in" → `/login` (`sm+`).
- "Get started" → `/signup`, shown at every width (153-168).
- Hamburger below `lg`.

**Mobile panel** (201-240): the same 5 links, the 3 audience links, Sign in and Get started. It has a focus trap and Escape-to-close (61-91).

**Footer** (`marketing-footer.tsx:6-67, 166-252`):
- Brand block: tagline, a one-line description, hello@ and support@ emails, `+234 806 119 7940`, "Headquarters: {SITE.headquarters}", and Facebook, Instagram and X links.
- **Care:** Services, Chronic care, Prevention, Laboratories and medication, Devices.
- **Programmes:** Annual Health Check, Advanced Diagnostics, Screening Journey, Vaccinations, Health Education, Mental Wellbeing Check, Symptom Checker, Caring for a parent.
- **Conditions:** Hypertension, Diabetes, Weight Health, Continuous monitoring, Understand your laboratory results, Talk to someone, Medication, Laboratories, BMI & Calorie Calculator, Activity Calculator.
- **Company:** Pricing, Gift Tarragon, Who it is for, For individuals, About, Careers, Resources, Our impact, Our partners, How we are accountable, Where we work, FAQ, Contact.
- **Business:** Corporate Health, HMO Support, Sign in, Get started.
- Emergency disclaimer band.
- Bottom row: "© year TarragonHealth. Health monitoring for Nigerians · RC 9702108 · Registered with the Nigeria Data Protection Commission", then the legal row: Privacy, Telehealth consent, Terms of service, Accessibility, Cookies.

That is 5 columns and about 40 links. "Medication" and "Laboratories" sit under Conditions, which is a taxonomy problem.

**Always-on overlays** (`(m)/layout.tsx:112-113`): `StickyCtaBar` and `FrontDeskChat` (the AI website chat, rate-limited in `app/api/frontdesk/chat/route.ts:51-52`).

---

## 3. Design system as built

**Fonts** (`app/layout.tsx:3-17,56`): `next/font/google`, with Sora as `--font-sora` (headings) and Inter as `--font-inter` (body). They are self-hosted by Next, so there is no runtime Google Fonts request. They map to `--font-heading` and `--font-sans` in `packages/ui/src/theme.css:74-75`.

**Colour tokens:**
- There is no `tailwind.config.*`. This is Tailwind v4 CSS-first: `app/globals.css:1-3` imports `packages/ui/src/theme.css`.
- Tokens (`theme.css:9-15`, mapped at 49-58):
  - brand-green `#0e7c52`
  - clinical-navy `#12324b`
  - charcoal-ink `#171717`
  - sprout-gold `#c9962b`
  - soft-sage `#e7eee7`
  - warm-ivory `#faf7f0`
  - deep-forest `#0b5c3e`
  - brand-green-bright `#45b389` (dark-theme only, :113)
- There are separate chart and menstrual-cycle palettes.
- The site is light only (`viewport.colorScheme: "light"`, layout.tsx:45, theme.css `color-scheme: light`).
- `globals.css` holds the marketing keyframes (fade, hero float, reveal, marquee), guarded by `prefers-reduced-motion` (43, 75, 114-125).

**Shared components in `(m)/_components`:**

| Component | Purpose |
|---|---|
| `section` | Section wrapper and SectionHeading (`as="h1"\|"h2"`). The main layout primitive, used about 53 times |
| `marketing-nav`, `marketing-footer`, `sticky-cta-bar`, `frontdesk-chat` | Site chrome |
| `marketing-photo-banner-hero` | Full-bleed photo/video hero. Renders the h1. Video is hidden on reduced motion |
| `marketing-hero` | Older two-column hero (text beside a media frame) |
| `channel-hero` | Home hero re-skinned per `?channel=` |
| `marketing-media-frame` | Image, video or illustration frame (used 13 times) |
| `marketing-video` | Click-to-play YouTube-nocookie embed |
| `phone-mockup` | Phone frame around app screenshots |
| `dashboard-preview` | App dashboard mock |
| `product-page-template` | Condition/product page template (7 pages). Emits MedicalWebPage JSON-LD |
| `b2b-page-template` | Corporate/HMO template, with the eligibility checker |
| `legal-document` | Legal page renderer |
| `cta-band` | End-of-page CTA (33 uses) |
| `og-card` | OG image renderer (43 uses) |
| `brand-logo` | Guard Leaf mark and lockup |
| `home-entry-chips`, `continuity-path`, `story-panel`, `steps-explorer`, `home-plan-compare`, `home-business-door`, `founding-members-strip`, `care-circle-abroad`, `tarragon-community` | Homepage sections |
| `trust-band`, `trust-pillars`, `partner-logo-strip`, `leadership-panel`, `testimonials-section`, `doctor-testimonials-section`, `testimonials-carousel` | Trust. Testimonials stay dormant until a real, consented quote is published (DB) |
| `pricing-free-features`, `pricing-label`, `membership-cta-card`, `plan-preview-sample` | Pricing |
| `how-testing-works`, `screening-journey`, `symptom-to-test-check`, `condition-monitoring`, `condition-risk-note` | Clinical explainers |
| `bmi-calorie-calculator`, `activity-intensity-calculator`, `mental-wellbeing-check`, `roi-calculator` | Tools |
| `eligibility-checker`, `eligibility-actions`, `eligibility-search-term` | "Is my company covered?" (server action) |
| `marketing-faq-accordion` | FAQ accordion |
| `emergency-notice`, `mental-health-support-notice` | Safety notices |
| `resource-carousel`, `resource-thumbnail`, `share-article-button` | Articles |
| `service-card`, `audience-tabs`, `conditions-marquee`, `animated-number`, `staggered-reveal` | Misc UI and motion |
| `json-ld-script`, `breadcrumb-json-ld` | Structured data |
| `illustrations/marketing-illustrations.tsx` | Inline SVG line illustrations |

Every component is imported at least once. I found no dead components.

**Image assets** (`apps/web/public/`, `marketing/` is about 75 MB, of which `video/` is about 28 MB):
- `brand/`: guard-leaf mark and lockup.
- `marketing/photos/hero/`: 16 hero JPGs (about, care-coordination, careers, chronic-care, corporate, diabetes, gift, hmo, homepage-family-phone, hypertension, labs, medication, obesity, parentcare, prevention, services).
- `photos/body/`: 10 images.
- `photos/app/`: 3 real app screenshots, plus 5 loose `app-*.png` and 5 loose `*.png` subject images.
- `illustrations/`: 2 PNGs.
- `logos/partners/synlab.svg`.
- `video/`: 19 MP4s and posters. The homepage hero uses a Kling image-to-video cinemagraph (`_content/media.ts:93-101`).
- Leadership headshots: `cmo-maxwell-dayok.jpg`, `founder-kola-longe.jpg`, `head-clinical-ops-adefola-adetunbi.jpg`.

**Is any of it real photography?** Mostly no:
- The leadership headshots and the app screenshots are real.
- The hero and body "photos" come from the founder's Midjourney library (`media.ts:13-16` cites `.../midjourney-library/INDEX.md`). They are AI-generated stock, though the code comments call them "real photo".
- None is captioned as a real patient or doctor (`media.ts:20-23`).
- There is no photography of real Tarragon staff at work, real users, or real Nigerian lab or pharmacy settings.

---

## 4. Pricing source

**Prices come from code-side versioned config, not a DB read.**
- `lib/marketing/membership.ts:20-45` calls `getProposedConfig("commerce.membership_prices")` from `@tarragon/shared` and formats kobo with `formatNaira` from `@tarragon/commerce`.
- Current value: `packages/shared/src/proposed-config/registry.ts:3736` (version 4, effectiveFrom 2026-11-04), `{ individual_kobo: 10_000_000, organisation_member_kobo: 9_000_000 }`. That is **₦100,000** individual and **₦90,000** employer seat.
- `membership-prices-mirror.test.ts` pins the config to the migrations, so the live `prices` rows are mirrored by test, not read at render time.
- The product name comes from i18n (`membership.ts:49-51`, `catalog.membership_annual_no_panel.name`).
- The founding-offer strip reads live `founding_offer_status()` from the DB (`founding-members-strip.tsx:6-12`).

**Hard-coded naira amounts on marketing pages: none in rendered code.**
- Rendered `₦` uses are all templates over config: `(m)/page.tsx:74`, `gift/page.tsx:25,107`, `pricing/page.tsx:37`, `home-plan-compare.tsx:61`, `membership.ts:78`.
- Two figures survive only in comments: "50,000 naira" (`_content/pricing.ts:31`) and "₦120,000" (`home-plan-compare.tsx:14`). They are not rendered.
- Non-price numbers such as "2,000 kilocalories" in `_content/resources.ts:1507-1515` are nutrition facts.
- No lab price is quoted. `LAB_TESTS_NOT_INCLUDED` is at `membership.ts:72`.

**Guard tests:**
- `lib/marketing/no-public-prices.test.ts`:
  - scans `(m)` and `lib/marketing` (:15);
  - rejects any typed naira amount (:72);
  - allows a naira template only where config is read (:78);
  - allows only 2 config keys (:93, :108);
  - bans "Membership Plus", "blood panel" and "testing day(s)" (:116-118);
  - bans instalment, monthly-payment, family-plan and bulk/volume-discount offers, with negations allowed (:28-30, :121-150);
  - includes a sabotage case (:176).
- `(m)/home-pricing-consistency.test.ts:33,45`: home, pricing, monitoring and how-it-works read the price, refund window and renewal copy from the one source.
- `lib/marketing/public-prices-render.test.tsx`, `lib/marketing/membership.test.ts`, `lib/marketing/pricing-ladder.test.ts`, `(m)/pricing/one-membership.test.tsx`, `lib/marketing/founding-offer.test.ts`.

---

## 5. Leftover obsolete claims

I grepped `(m)` and `lib/marketing` (excluding tests and comments) for: "Plus", "testing day", "17", "yearly panel", "WhatsApp", "doctor-led", "Stripe", "family plan", "ParentCare", "instalment", "monthly", GBP/USD/£/$, and em dashes.

**Clean:** "Membership Plus", "testing day", "17-test", "yearly panel" and "blood panel" all return 0 hits. So do WhatsApp, doctor-led, Stripe, GBP/USD/£/$, "family plan" (one false positive in a genotype article) and instalment. Em dashes appear only in code comments.

**Hits worth action:**
- `(m)/page.tsx:258`: "…plus a yearly health check." The wording is ambiguous now that the yearly panel is gone (the feature is a yearly request form).
- The `parentcare` route, the `ParentCareIllustration` component, and "Caring for a parent" links in for-you:253, gift:171, chronic-care:97, vaccinations:162, services.ts:36/269 and footer:25. The name is from a killed product, though the copy describes Care Circle plus gifting.
- Synlab as the "contracted laboratory partner": `_content/partners.ts:36-39` and `labs/page.tsx:50`. This conflicts with the 2026-11-04 lab-independent brief and with annual-health-check's "Any test, any laboratory, no commission" (:184-185). Needs a decision.
- Care Voucher and referral "reward voucher": `_content/pricing.ts:233-247`, rendered on `pricing/how-it-works/page.tsx:106-109`. Check against T2.
- The diaspora channel hero (`_content/channel-heroes.ts:76-85`). It is current as gifting, but confirm it is still wanted.
- "Delivery courier" partner type on the coverage map (`coverage/partner-map.tsx:18,24`). Home delivery was removed. The copy itself correctly says "we do not deliver medication" (coverage-checker.tsx:94-97).
- `/hmo` and the `?channel=hmo` hero. These are HMO sales motions, a strategy question (capitation is already excluded on `/partners`).
- "monthly" hits are all about the monthly doctor meeting, which is a current Membership benefit, plus `pricing.ts:352` "There is no monthly subscription". No monthly pricing remains.
- **The spec docs are stale:** `docs/MARKETING_SITE_SPEC.md:131,197,313,319` still describe a WhatsApp hero mockup, per-service pricing and the old hero line, and §7 calls itself stale. `docs/marketing/` holds only the 2026-11-04 SEO article-rewrite batches 1-6.

---

## 6. Content system

**`/resources` and `/resources/[slug]`:**
- Source is the DB table `marketing_resources`, read with a bare anon client, `is_published = true`, ordered by `sort_order` (`lib/marketing/resources-data.ts:65-77`).
- If the read fails or returns empty, it falls back to the static seed of 41 articles in `(m)/_content/resources.ts`, a 1,540-line TS file.
- Fields: title, description, category (6 fixed values), read_minutes, related link, `sections` JSON (heading plus paragraphs), `reviewed_by_name`, `reviewed_at`, created_at and updated_at (`resources-data.ts:17-33`).
- The "Medically reviewed by X on date" byline and the JSON-LD `reviewedBy`/`lastReviewed` render only when both reviewer fields are set (`resources/[slug]/page.tsx:74-101,145`).
- The author is always the Organization (:91). There is no person author.
- **There is no references/sources field and no next-review date** on resources.
- Admin UI is at `/admin/settings/resources` (`app/(dashboard)/admin/settings/resources/resources-manager.tsx`). It edits the reviewer name and date, the sort order and published/draft status.
- Per-article FAQ JSON-LD comes from `lib/marketing/resource-faq.ts`.
- Live DB row count and review status are **unverified**. Memory notes 24 CMO-reviewed live articles.

**`/learn/[code]`:**
- Source is the DB RPC `public.learn_shared_article()`, which returns an article only while it is published, clinically reviewed, shareable and inside its review date (`lib/marketing/learn-data.ts:1-26`).
- It carries `reviewedByName`, `reviewedAt`, `nextReviewDue`, `sourceReference`, `evidenceSource` and `creatorName`. This is the richest provenance model on the site, and the public one lacks it.
- The page is noindex.
- It is edited through the Learning Centre / health-education admin (`admin/settings/health-education/health-education-manager.tsx`, `health_education_content` table).

**`/health-education`:** a static marketing explainer. It does not list articles.

**FAQ:**
- Static TS. `HOMEPAGE_FAQS` lives in `(m)/_content/services.ts:317` (17 `question:` entries in that file, with categories via `FAQ_CATEGORY_LABEL`, :422).
- Page-local FAQ arrays exist on gift, pricing (`planFaq` in `_content/pricing-ladder.ts`), devices (`DEVICES_FAQ`), monitoring, therapy and result-interpretation.
- There is no admin UI for FAQs.

**Legal pages:** privacy, terms and telehealth consent load from the DB via `lib/marketing/legal-data.ts`.

---

## 7. SEO

**Metadata:**
- The marketing layout sets `metadataBase`, a title template `%s | TarragonHealth`, keywords, default OG/Twitter values, and `robots index/follow` with max-image-preview large (`(m)/layout.tsx:11-45`).
- Pages use `export const metadata = pageMetadata({...})` (`lib/marketing/site.ts:77-110`). That sets the title, description, `alternates.canonical` (absolute URL) and a full OG/Twitter restatement.
- The template pages use `generateMetadata()`: corporate, hmo and the product pages (for example `diabetes/page.tsx:15`).
- `learn/[code]` and `resources/[slug]` use dynamic `generateMetadata`.
- Note that the root `app/layout.tsx:25` has a different template ("%s · TarragonHealth"), which the marketing layout overrides.

**OG images:** 43 `opengraph-image.tsx` routes, all built on `og-card`, including a root default and `resources/[slug]`. Missing on `/monitoring`, `/result-interpretation`, `/therapy` and `/learn/[code]`.

**JSON-LD:**
- `MedicalOrganization` site-wide (layout.tsx:48-92: name, legalName, logo, slogan, founder, telephone, email, RC identifier, locality address, two ContactPoints, sameAs).
- `BreadcrumbList` on every page (`breadcrumb-json-ld.tsx`, a client component using `usePathname`; built in `lib/marketing/structured-data.ts:114`).
- `MedicalWebPage` on product pages (structured-data.ts:151, through `product-page-template`) and on resource articles.
- `FAQPage` on `/`, `/faq`, `/pricing` and resource articles.
- There is no `Article`/`BlogPosting` type, no `Service`/`Offer`/`Product` with price, no `WebSite`/`SearchAction`, and no `Physician`/`Person` for the leadership.

**Sitemap:** described in section 1. Priorities are hand-tuned (`sitemap.ts:16-39`), lastModified is `new Date()` for pages, and resources use the real `updated_at`. It still prioritises `annualHealthCheck` at 0.7 and `screeningJourney` at 0.65. It omits `/monitoring`, `/result-interpretation` and `/therapy`.

**Robots** (`app/robots.ts:14-29`): disallows `/patient`, `/clinician`, `/admin`, `/pharmacist`, `/lab-partner`, `/lab-liaison`, `/finance`, `/analytics`, `/dashboard`, `/onboarding`, `/login`, `/signup`, `/auth` and `/api`.
- **Not disallowed:** `/payer`, `/provider-org`, `/reader`, `/checkout`, `/circle`, `/claim`, `/share`, `/verify-rx`, `/verify-report`, `/emergency`, `/access-fund`. Several of these set their own `robots: { index: false }` (emergency, verify-rx, checkout, circle/join, some dashboard pages), but not all. I did not check every one.
- Dashboard pages generally carry no `noindex` meta. They rely on robots.txt plus the auth redirect.
- The proxy 308-redirects marketing paths requested on the `app.` host to the root domain (`proxy.ts:189-192`), so content is not duplicated across hosts.

---

## 8. Forms and conversion

**Contact/lead form** (`(m)/contact/contact-form.tsx` and `actions.ts`):
- Zod `leadSchema` (`lib/validation/lead.ts:33-44`): name, contact (email or phone, 5-200 characters), role (one of patient, family, employer, hmo, ngo or other), optional goal, message up to 2000 characters, and `source` as a free string up to 100 characters.
- Inserts into the **`leads`** table with the service-role client (`actions.ts:72-79`).
- An optional consent tick also captures the lead into the Front Desk CRM (`service_fd_capture_lead`), and that capture is rate-limited to 6 per IP per hour (`actions.ts:31-38, 90-110`).
- **The `leads` insert itself has no rate limit, no honeypot and no captcha.** I verified there is no honeypot field in the form.
- `?source=` and `?role=` pre-fill the form (contact-form.tsx:40-47).
- Sources in use: corporate, hmo, careers, advanced-diagnostics, default homepage.
- The careers `role` bug is described in section 1.

**Employer/HMO enquiry:** the same form, through `/contact?source=corporate|hmo`. There is also the "Is my company covered?" eligibility checker on corporate and HMO (`_components/eligibility-actions.ts`): Zod, `checkAuthRateLimit`, a service-role roster lookup, and on no match it inserts a lead (:124). An E2E test covers it (`apps/web/e2e-browser/employer-eligibility.spec.ts`).

**Provider/lab application:** there is no marketing form. Partners and labs route to `/contact`.

**Website chat:** the FrontDeskChat AI widget, IP rate-limited at 20 per 10 minutes and 150 per day (`api/frontdesk/chat/route.ts:51-52`).

**Signup entry points:**
- `/signup` is linked from the nav, footer, nearly every hero and the CTA band.
- `intent=` values accepted by `app/signup/page.tsx:73-83` are `health_check` and `support`. **Only `intent=support` is used on marketing** (gift/page.tsx:108,183, gift-personalizer.tsx:123).
- `intent=health_check` no longer has a marketing entry point. It was the old testing-day CTA. Also accepted: `ref` (referral) and `redirect`.
- The home page reads `?channel=` (see section 1).

---

## 9. Analytics, consent and security headers

**Analytics:**
- First-party only. `components/analytics/page-tracker.tsx` sends a beacon to `/api/track` with path, referrer, UTM, session and device. Coarse geo is taken from Vercel edge headers and the raw IP is not read (`api/track/route.ts:12,62`). It also sends a 4-minute heartbeat.
- There is **no GA4, PostHog, Vercel Analytics or Meta pixel** in package.json or the CSP.
- Sentry `@sentry/nextjs` is installed and initialises on the client only if `NEXT_PUBLIC_SENTRY_DSN` is set (`instrumentation-client.ts:5-17`). Its connect-src is allowed in the CSP.

**Consent:**
- `components/consent/cookie-consent-banner.tsx` shows only on marketing paths.
- It is **opt-out**: analytics runs by default and stops on Reject or a Do Not Track signal (banner :16-18, page-tracker :12-14).
- The only non-essential script is the first-party tracker, so nothing third-party waits on consent. Whether opt-out meets NDPA expectations for marketing analytics is a judgement call I did not assess.
- The Cookie Policy page has the reopen control.

**Security headers** (`apps/web/next.config.ts`):
- Global: `X-Content-Type-Options`, `X-Frame-Options SAMEORIGIN`, `Referrer-Policy strict-origin-when-cross-origin`, `Permissions-Policy camera/mic/geo=self`, HSTS with preload, and a CSP (205-232).
- The CSP (103-132) allows `script-src 'self' 'unsafe-inline'` plus Google Maps, `connect-src` to Supabase, Sentry and Maps, and `frame-src` to Supabase and youtube-nocookie. It sets `object-src 'none'` and `frame-ancestors 'self'`.
- Consultation routes get a separate CSP with Zoom hosts.
- `proxy.ts` sets `Referrer-Policy: no-referrer` on token pages.
- **Any new third-party analytics or CDN on a redesign will need CSP edits.**

---

## 10. Accessibility quick scan

- **Skip link:** present (`(m)/layout.tsx:103-108`), targeting `<main id="main-content">` (:110).
- **Landmarks:** a header containing navs labelled "Audiences", "Main" and "Mobile"; `main`; `footer` with a visually hidden h2 (footer:169); footer groups use h3 (:152); `Section` takes `labelledBy`.
- **H1:**
  - Every page has exactly one h1 source. I checked by script: inline `<h1>`, `SectionHeading as="h1"`, PhotoBannerHero, or the product/B2B/legal templates.
  - The home page switches between two hero sources conditionally.
  - Heading order below the h1 was not checked page by page (**unverified**). The footer h2 issue was fixed earlier.
- **Images:**
  - All `next/image` uses pass alt.
  - `gift-personalizer.tsx:53` has `alt=""`, which is decorative and probably intended.
  - The product, B2B and photo-banner templates fall back to `imageAlt ?? ""` when the media has no alt.
  - Partner logos use the partner name.
- **Focus:** consistent `focus-visible:ring-2 ring-brand-green` on nav, footer and buttons. The mobile menu has a focus trap and returns focus to the toggle. The contact success message moves focus.
- **Reduced motion:**
  - CSS animations are guarded in globals.css.
  - The PhotoBannerHero video uses `motion-reduce:hidden`.
  - JS motion components check `prefers-reduced-motion`: animated-number, conditions-marquee, continuity-path, sticky-cta-bar, steps-explorer, staggered-reveal, testimonials-carousel.
  - **Gap:** `marketing-media-frame.tsx:31-39` autoplays a looping `<video>` with no reduced-motion check. Today this only matters for slots that set `videoSrc` (**unverified** which ones render through the frame).
- **Colour contrast:** not measured. Body text uses `/60`, `/65` and `/70` opacity charcoal on white or ivory, which is worth checking.

---

## 11. Tests covering the marketing site

- Under `app/(marketing)`:
  - `home-pricing-consistency.test.ts`, `error.test.ts`
  - `contact/actions.test.ts`
  - `learn/[code]/page.test.tsx`
  - `pricing/one-membership.test.tsx`
  - `_components/`: `care-circle-abroad.test.tsx`, `doctor-testimonials-section.test.ts`, `eligibility-search-term.test.ts`, `founding-members-strip.test.tsx`, `frontdesk-chat.test.tsx`, `home-entry-chips.test.tsx`, `json-ld-script.test.tsx`, `mental-health-support-notice.test.tsx`, `plan-preview-sample.test.ts`, `screening-journey.test.ts`, `tarragon-community.test.tsx`, `testimonials-section.test.ts`
- Under `lib/marketing/`: accountability-data, anon-client, data-protection-contacts, founding-offer, impact-data, learn-data, legal-docs-facts, membership, no-public-prices, page-metadata, pricing-ladder, public-prices-render, resource-faq, resources-data, site-headquarters, structured-data.
- Elsewhere: `proxy.test.ts` (hostname routing), `app/signup/signup-copy.test.ts`, `components/brand/guard-leaf-mark-no-checkmark.test.ts`, `packages/shared/.../membership-prices-mirror.test.ts`, `membership-ladder-retired.test.ts`.
- Browser E2E: `apps/web/e2e-browser/employer-eligibility.spec.ts` (`/corporate`). There is no E2E or visual-regression test for other marketing pages, and no Lighthouse/axe run.

**Copy-lint rules:**
- `page-metadata.test.ts:145` bans em dashes in page prose. It also enforces title and description length bounds and fails if a page lacks inline metadata unless the page is on a known list (:120).
- `no-public-prices.test.ts` enforces the price, Plus, panel and testing-day bans and the offer-wording bans.
- `founding-members-strip.test.tsx:31` bans em dashes in that strip.
- `app/jsx-text-has-no-raw-escapes.test.ts` checks for raw escapes in JSX text.
- **Not linted:** "doctor-led", WhatsApp, Stripe, and em dashes in `_content/*.ts` and `_components`. The em-dash test scans page files only. The current grep is clean for all of them, but nothing guards them.

---

## Classification

### Pages

| Page | Verdict | Why |
|---|---|---|
| `/` | Redesign | Correct content, too many sections (about 20 blocks). Needs a two-plan story and real proof |
| `/pricing` | Improve | Config-driven and well tested. Simplify to Free vs Membership plus an employer line |
| `/pricing/how-it-works` | Improve | Re-check the voucher and referral blocks. Add it to the footer |
| `/services` ("How it works") | Redesign | Core explainer. Align the nav label and the URL |
| `/chronic-care`, `/hypertension`, `/diabetes`, `/obesity` | Improve | Good template. Add a lab-report (AI engine) story and real visuals |
| `/prevention` | Improve | Absorb annual-health-check and screening-journey |
| `/annual-health-check` | Remove (merge into Prevention/Membership) | Now a feature, not a product |
| `/screening-journey` | Improve (merge in as a tool on Prevention) | Overlap |
| `/advanced-diagnostics` | Remove | No service, register-interest only |
| `/parentcare` | Replace (with a Care Circle / family page) | Retired product name |
| `/gift` | Retain | Matches the model |
| `/care-coordination` | Remove (merge with `/labs` and `/medication`) | Triple overlap |
| `/labs` | Improve | Resolve the Synlab wording. Feature the "upload your report, a doctor reviews it" flow |
| `/medication`, `/devices`, `/vaccinations` | Retain | Small copy checks only |
| `/monitoring` | Improve | Add to the sitemap and an OG image |
| `/result-interpretation` | Improve, high priority | SEO entry for the lab-report engine. Not in the sitemap, no OG image |
| `/therapy` | Improve (verify it is live first) | Not in the sitemap, no OG image |
| `/mental-wellbeing-check`, `/symptom-checker`, `/bmi-calculator`, `/activity-calculator` | Retain | Tools that pull organic traffic |
| `/health-education` | Remove (merge into `/resources`) | Overlap |
| `/resources`, `/resources/[slug]` | Improve | Add references, a next-review date, a person author and Article schema |
| `/learn/[code]` | Retain | Correct as is |
| `/for-you` | Improve | Make it the individuals page |
| `/who-its-for` | Remove (redirect to `/for-you` or home) | Duplicate |
| `/corporate` | Improve | Show the ₦90k seat line (config-driven) |
| `/hmo` | Remove or Retain, founder decision | Strategy question |
| `/partners`, `/coverage` | Improve | Synlab wording, delivery-courier type |
| `/accountability`, `/impact` | Retain | Trust pages |
| `/about` | Improve | Real leadership photos are an asset to use more |
| `/careers` | Improve | Fix the `role` param bug |
| `/faq` | Improve | Admin-editable source would help |
| `/contact` | Improve | Add a honeypot and rate-limit the insert |
| Legal pages (5) | Retain | DB-backed |
| (new) Membership page | Build new | One canonical "what Membership includes" page (`MEMBERSHIP_INCLUDES` already exists) |
| (new) Lab report / "Upload your results" landing | Build new | For the Tarragon 2.0 AI lab-report engine (may extend `/result-interpretation`) |
| (new) Clinical team / medical governance page | Build new | Named CMO and reviewers, reviewed by real people |

### Components

| Component(s) | Verdict |
|---|---|
| `section`, `cta-band`, `og-card`, `json-ld-script`, `breadcrumb-json-ld`, `brand-logo`, `marketing-faq-accordion`, `emergency-notice`, `mental-health-support-notice`, `legal-document` | Retain |
| `marketing-nav` | Redesign (IA: plans, how it works, for employers, resources) |
| `marketing-footer` | Redesign (about 40 links in 5 columns, wrong taxonomy) |
| `marketing-photo-banner-hero`, `channel-hero` | Improve (keep the mechanics, refresh visuals) |
| `marketing-hero` (old two-column) | Remove once no page falls back to it |
| `marketing-media-frame` | Improve (reduced-motion gap) |
| `product-page-template`, `b2b-page-template` | Improve |
| `home-plan-compare`, `pricing-free-features`, `pricing-label`, `membership-cta-card`, `founding-members-strip` | Retain (config-driven, tested) |
| `plan-preview-sample` | Improve |
| `home-entry-chips`, `continuity-path`, `story-panel`, `steps-explorer`, `home-business-door`, `care-circle-abroad`, `tarragon-community` | Redesign (homepage rationalisation) |
| `trust-band`, `trust-pillars`, `partner-logo-strip` | Improve |
| `leadership-panel` | Retain |
| `testimonials-section`, `doctor-testimonials-section`, `testimonials-carousel` | Retain (dormant until real) |
| `how-testing-works` | Replace (its "three testing lenses" framing predates T2) |
| `screening-journey`, `symptom-to-test-check`, `condition-monitoring`, `condition-risk-note` | Improve |
| `bmi-calorie-calculator`, `activity-intensity-calculator`, `mental-wellbeing-check` | Retain |
| `roi-calculator` | Improve (check employer maths against ₦90k) |
| `eligibility-checker`, `eligibility-actions` | Retain |
| `frontdesk-chat`, `sticky-cta-bar` | Retain (check overlap with the cookie banner on mobile) |
| `audience-tabs`, `conditions-marquee`, `animated-number`, `staggered-reveal`, `service-card` | Improve |
| `dashboard-preview`, `phone-mockup` | Improve (feed them real screenshots) |
| `resource-carousel`, `resource-thumbnail`, `share-article-button` | Retain |
| `marketing-video` | Retain (dormant until a YouTube ID is set) |
| `illustrations/marketing-illustrations.tsx` (incl. `ParentCareIllustration`) | Improve or Remove |
| Midjourney hero and body photo set | Replace (with real or commissioned Nigerian photography) |

### Not verified
- Live `marketing_resources` content and review state.
- Whether `/therapy` is live.
- `/access-fund` reachability.
- Heading order below the h1.
- Colour contrast.
- Live CSP and headers in production.
- Live DB rows for `prices` (only the config mirror was read).
- Whether every non-disallowed public route carries noindex.
