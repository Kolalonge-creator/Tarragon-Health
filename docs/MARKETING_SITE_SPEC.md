# Tarragon Health — Marketing Website Build Spec (v1)

> **Read this file in full before writing any code.** This is the authoritative spec for the public marketing site. `CLAUDE.md` has a short pointer to this file — this doc has the detail.

---

## 0. Architecture Decision — Do Not Deviate

**Now:** Marketing site lives inside `apps/web` as a route group.  
**Later:** If marketing needs its own CMS, team, or deploy velocity, it splits into `apps/marketing` as a sibling package. That trigger has not been pulled yet — build it as a route group.

```
apps/web/
  src/app/
    (marketing)/          # public site — this build
      page.tsx            # homepage
      hypertension/page.tsx
      diabetes/page.tsx
      parentcare/page.tsx
      prevention/page.tsx
      medication/page.tsx
      labs/page.tsx
      pricing/page.tsx
      about/page.tsx
      corporate/page.tsx
      hmo/page.tsx
      contact/page.tsx
      layout.tsx          # marketing-only nav/footer, NOT the app shell
    (platform)/           # existing/future authenticated product
      ...
  middleware.ts
```

`apps/web/src/proxy.ts` (Next.js 16 — renamed from `middleware.ts`) routes by hostname so the split is invisible to users and trivial to peel off later:

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") || "";
  const isApp = host.startsWith("app.");
  const { pathname } = req.nextUrl;

  if (isApp && pathname.startsWith("/(marketing)")) {
    return NextResponse.rewrite(new URL("/404", req.url));
  }
  // On app.tarragonhealth.com, root "/" resolves to the platform's own
  // root page (dashboard redirect / login), not the marketing homepage.
  return NextResponse.next();
}
```

**Vercel config:** one project, two domains attached — `tarragonhealth.com` (and `www`) plus `app.tarragonhealth.com` — both pointing at the same deployment. No env var differences needed since it's one build; the hostname check in middleware is the only branch point.

Marketing pages import shared primitives from `packages/ui` and `packages/types` only — never import anything from platform-only modules (auth context, patient data hooks). This keeps the future split a pure directory move, not a rewrite. *(Today: types live in `packages/shared`; UI primitives in `apps/web/src/components/ui` until `packages/ui` is extracted.)*

**Rendering:** every marketing page is static or ISR (`export const revalidate = 3600` where content may change, e.g. Pricing). No auth check, no Supabase client, no loading spinners — this site must be fast for an investor on a bad hotel wifi connection.

**Exception:** Contact/Join is the only marketing page that talks to Supabase (leads form submission). See §3.7.

---

## 1. Design Direction — Distinctive, Not Templated

The brand system already exists in `docs/BRAND_GUIDE.md` (Guard Leaf) — this section tells Claude Code how to turn it into a page that doesn't look like a generic SaaS template.

**Avoid the defaults.** Don't reach for: warm cream background + high-contrast serif + terracotta accent; near-black background + single acid accent; or a hairline-rule broadsheet layout with zero border-radius. These are the three looks every AI-generated site clusters around right now. Tarragon's brief already has a real point of view — use it instead.

### Token system (derived from the brand guide, not invented)

| Token | Value / rule |
|---|---|
| **Tarragon Green** | `#0E7C52` — primary/brand |
| **Clinical Navy** | `#12324B` — B2B pages, headers |
| **Sprout Gold** | Sparingly — one accent per page, screening/upgrade moments only |
| **Soft Sage / Warm Ivory** | Backgrounds |
| **Charcoal Ink** | Text — never pure black |
| **Ratio** | 60% ivory/sage/white · 25% green/navy · 10% charcoal text · 5% gold |
| **Clinical red/amber** | Reserved for clinical states — **never use decoratively on the marketing site** |

**Type:** Sora (SemiBold/Bold) for headlines, Inter for body and UI chrome. Set a real type scale — don't let every heading be the same weight at different sizes.

**Signature element:** the Guard Leaf checkmark-vein motif is the one bold move. The brand truth is continuity — *"the care between doctor visits"* — so the hero should visually imply an unbroken thread (a reading → a reminder → a clinician call → a family update) rather than a static stock photo or a generic dashboard mockup. A subtle continuous line/path motif connecting these moments, echoing the leaf's checkmark vein, is a good candidate for the one thing this page is remembered by. Keep everything else quiet around it.

**Motion:** restrained. A single orchestrated hero reveal or scroll-triggered moment beats scattered hover effects everywhere. Respect `prefers-reduced-motion`.

**Photography/illustration:** per the brand guide — Nigerian families in natural settings, adult children with parents, calm clinician follow-up calls. Avoid emergency imagery, Western stock, doctors pointing at charts, or generic wellness/yoga photography. Simple line illustration in green/navy is the fallback where photography isn't available yet.

**Voice:** warm, calm, credible — *"a clinician who knows your name, not a hospital PA system."* No fear-based urgency, no red medical crosses, no "revolutionary AI-powered platform" language. Copy for each page is given below — use it as the source of truth, don't rewrite the strategy.

---

## 2. Sitemap — 12 Pages

Homepage · Hypertension Monitoring · Diabetes Monitoring · ParentCare · Preventive Health · Medication Support · Lab Coordination · Pricing · About Founder · Corporate Health · HMO Support · Contact/Join

| Route | Page |
|---|---|
| `/` | Homepage |
| `/hypertension` | Hypertension Monitoring |
| `/diabetes` | Diabetes Monitoring |
| `/parentcare` | ParentCare |
| `/prevention` | Preventive Health |
| `/medication` | Medication Support |
| `/labs` | Lab Coordination |
| `/pricing` | Pricing |
| `/about` | About Founder |
| `/corporate` | Corporate Health |
| `/hmo` | HMO Support |
| `/contact` | Contact / Join |

---

## 3. Page Content

### 3.1 Homepage

**Headline:** Care that stays with you.  
**Subheadline:** Clinician-led health monitoring for you, your parents, and your loved ones.  
**Body copy:** Track blood pressure, blood sugar, medication, lab checks, and preventive health needs in one secure platform. Tarragon helps families stay informed and supports escalation when closer care is needed.

**CTAs:**
- Primary — Start monitoring
- Secondary — Join the 90-Day Health Reset
- Corporate — Request employer health plan
- HMO — Talk to Tarragon Health

**Section order and job of each section:**

1. **Hero** — headline/subhead/body above, plus the signature continuity visual.
2. **Problem** — one short paragraph: families worry because chronic disease is poorly followed up between doctor visits.
3. **Solution** — Tarragon monitors, reminds, reviews, coordinates, and escalates.
4. **Services** — six cards: Hypertension, Diabetes, ParentCare, Medication, Labs, Prevention — each links to its own page.
5. **How it works** — sign up → onboard → monitor → clinician review → doctor escalation → family updates. *(Only use numbered steps here — this is a real sequence, unlike elsewhere.)*
6. **Why trust us** — clinician-led, protocol-driven, evidence-focused.
7. **For families / For employers / For HMOs** — three short audience-specific blocks, each with its own line (see Product Messages below) and a link to Corporate/HMO pages.
8. **Pricing teaser** — link through to the full Pricing page, don't duplicate the tier table here.
9. **Final CTA** — repeat primary CTA.

### 3.2 Product pages

Each product page (Hypertension, Diabetes, ParentCare, Preventive Health, Medication, Labs) follows the same shape:

> headline → 2–3 sentence explanation of what Tarragon does for that need → how it works for this specific condition/need → relevant CTA → link back to Pricing

| Page | Headline / message |
|---|---|
| Hypertension | Stay ahead of high blood pressure before it causes complications. |
| Diabetes | Track glucose, HbA1c, medication, labs, and complications in one place. |
| ParentCare | Know how your parent is doing, even when you are not there every day. |
| Preventive Health | Find care gaps early and know what checks may be due. |
| Medication Support | Reduce missed doses and avoid running out of medication. |
| Lab Coordination | Know what tests are due, book them, and track follow-up. |

**Campaign lines** (secondary headlines/pull-quotes — one per page, never stack two):

| Page | Campaign line |
|---|---|
| ParentCare | Your parents looked after you. Now help look after them. |
| Hypertension | High blood pressure needs follow-up, not guesswork. |
| Diabetes | Diabetes care is more than sugar checks. |
| Prevention | The best emergency is the one you prevent. |

### 3.3 Pricing

Use the four-label system already established for customer-facing pricing — **every line item on this page must carry exactly one label:**

| Label | Meaning |
|---|---|
| **INCLUDED** | Part of the plan at no extra charge |
| **BOOK & PAY** | Available through Tarragon; patient pays partner directly |
| **FREE ELSEWHERE** | Available outside Tarragon at no charge |
| **ADD-ON** | Optional paid upgrade |

Nothing implied, nothing ambiguous — this is a Nigerian-trust-first design constraint, not a style preference.

**Consumer tiers to display:** Tarragon Free · Essential Care · Complete Care · Family Plan — plus diaspora GBP pricing shown as a toggle or adjacent column (Stripe billing, not Paystack).

**Do not display** corporate Bronze/Silver/Gold or HMO capitation tiers on this page — those live on the Corporate and HMO pages as "request a quote," not self-serve pricing.

Every price must state currency explicitly (₦ or £). Include a visible **"no hidden costs"** statement — this is a stated trust requirement, not optional copy.

Use `export const revalidate = 3600` (ISR) since pricing content may change.

### 3.4 About Founder

**Purpose:** build clinical credibility. Founder bio, why Tarragon exists, the continuity thesis in founder's own voice. Keep this page editable as plain content (MDX or CMS-ready), since founder bios change more often than product pages.

### 3.5 Corporate Health

**Message:** Help your workforce detect and manage chronic disease risk.  
**Campaign line:** Know your workforce health risks before they become costs.

Include: what a corporate report looks like (reference the *"12% pre-diabetic, 60 women overdue for cervical smears"* style of finding — described, not with real client data).

**CTA:** Request employer health plan → routes to Contact/Join form tagged `source: corporate`.

### 3.6 HMO Support

**Message:** Monitor member risk, close care gaps, and generate outcome evidence.  
**Campaign line:** Close care gaps. Monitor risk. Prove outcomes.  
**HMO pitch line** (usable as a pull-quote): *"We don't just manage chronic disease. We catch it earlier — and we can prove it."*

**CTA:** Talk to Tarragon Health → routes to Contact/Join form tagged `source: hmo`.

### 3.7 Contact / Join

Single form: name, email/phone, role (patient / family / employer / HMO / other), message.

On submit:
- Store to a `leads` table in Supabase (new migration)
- Schema: `leads(id, name, contact, role, message, source, created_at)`
- No auth required to submit
- Confirmation screen — not a redirect
- `source` tag must reflect the referring page (`corporate`, `hmo`, `homepage`, etc.)

This is the **only** marketing page that talks to Supabase — everything else is static.

---

## 4. Technical Requirements

| Requirement | Detail |
|---|---|
| **Framework** | Next.js 16 App Router, Tailwind, shadcn/ui — same primitives as the platform |
| **Shared components** | Import from `packages/ui` where genuinely shared (buttons, cards); marketing-only layout components (nav, footer, hero) live in `app/(marketing)/_components/`, not in `packages/ui` |
| **Rendering** | All pages statically generated or ISR. No client-side data fetching on first paint |
| **Logo assets** | Guard Leaf mark and lockup at `apps/web/public/brand/guard-leaf-mark.png` and `apps/web/public/brand/guard-leaf-lockup.png` |
| **Metadata** | Every page needs its own `title` / `description` for SEO — write per page, don't reuse the homepage's |
| **Accessibility** | Responsive to mobile, visible keyboard focus states, `prefers-reduced-motion` respected on any hero animation |
| **Fonts** | Sora + Inter loaded via `next/font`, not a CDN link tag |
| **Import boundary** | **No platform/auth imports anywhere under `app/(marketing)/`** |

---

## 5. Definition of Done

- [ ] All 12 pages built and linked from nav/footer
- [x] Hostname routing stub separates root domain from `app.*` subdomain (`proxy.ts`)
- [x] Pricing page uses all four labels correctly; no ambiguous line items
- [x] Contact/Join form writes to `leads` table with correct `source` tag per page
- [ ] Lighthouse: 90+ performance, 100 accessibility, on the homepage
- [x] No platform/auth imports anywhere under `app/(marketing)/`
- [x] Guard Leaf assets in place; colours match hex values above; no clinical red/amber used decoratively

---

## 6. Product Messages (reference)

Use these audience-specific lines in the homepage audience blocks and cross-link to dedicated pages:

| Audience | Message |
|---|---|
| Families | Peace of mind for the people you love. |
| Employers | Smarter monitoring for healthier populations. |
| HMOs | Close care gaps. Monitor risk. Prove outcomes. |
| Diaspora | Look after home, even from far away. |

Full tagline system and voice rules: `docs/BRAND_GUIDE.md`.

---

## 7. Build Progress (handoff tracker)

> **Update this section every marketing session** so Claude Code can continue without re-discovery.
> Branch: `feat/marketing-site-scaffold` · Last updated: 2026-07-10

### Scaffold (done)

- [x] `(marketing)/` route group with dedicated layout (nav + footer, no platform shell)
- [x] Guard Leaf assets at `apps/web/public/brand/`
- [x] Hostname routing stub in `apps/web/src/proxy.ts` (`isAppHost` — `app.*` / `app.localhost`)
- [x] Marketing paths public via `isMarketingPath()` in `apps/web/src/lib/marketing/routes.ts`
- [x] Shared content in `(marketing)/_content/` and components in `(marketing)/_components/`
- [x] Old platform landing `app/page.tsx` removed — marketing homepage owns `/` on root domain
- [x] Omada-inspired trust additions adapted to Tarragon voice: proof stats strip, Monitor/Review/Coordinate pillars, homepage FAQ, and product-page included lists
- [x] Homepage dashboard preview added — shows readings, reminders, preventive check, nurse review, and family update flow
- [x] Footer redesigned into clear groups: Priority programmes, Coordination, Company, Platform; unfinished pages marked `soon`
- [x] Homepage visual pass (2026-07-11): animated WhatsApp hero mockup (`_components/whatsapp-hero-mockup.tsx`, pure CSS, `prefers-reduced-motion` respected) replaces the illustration hero visual; brand-guide voice pillars + "never do" chips (`_components/trust-pillars.tsx`); interactive four-way audience tabs — For you / families / employers / HMOs — with mini stat-card visuals (`_components/audience-tabs.tsx`, content in `AUDIENCE_TABS`); mobile nav hamburger menu added to `marketing-nav.tsx` (previously no way to reach nav links below `md`)

### Pages

| Page | Route | Status | Notes |
|---|---|---|---|
| Homepage | `/` | **Done** | All 9 sections from §3.1 plus proof stats, 3 pillars, dashboard preview, FAQ, WhatsApp hero mockup, voice trust-pillar grid, audience tabs |
| Hypertension | `/hypertension` | **Done** | Includes condition-specific "what's included" list |
| Diabetes | `/diabetes` | **Done** | Includes condition-specific "what's included" list |
| ParentCare | `/parentcare` | **Done** | Includes condition-specific "what's included" list |
| Prevention | `/prevention` | **Done** | Priority programme — care gaps, screening, Cat 2→1 upgrade path |
| Medication | `/medication` | **Done** | Uses shared `ProductPageTemplate`; no campaign line per §3.2 table |
| Labs | `/labs` | **Done** | Uses shared `ProductPageTemplate`; no campaign line per §3.2 table |
| Pricing | `/pricing` | **Done** | Four-label tiers, ₦/£ toggle, ISR. Rebuilt 2026-07-12 against `docs/Tarragon_Health_Pricing_Guide.docx` (the authoritative source) — `_content/pricing.ts` should be kept in sync with that doc if prices change |
| About | `/about` | **Done (2026-07-12)** | Page shell + design done; founder name/photo/bio are bracketed placeholders — needs real content before this page is announced publicly |
| Corporate | `/corporate` | Unblocked, not started | Platform dashboard moved to `/dashboard/corporate` (2026-07-12) — bare path is free for marketing to build |
| HMO | `/hmo` | Unblocked, not started | Platform dashboard moved to `/dashboard/hmo` (2026-07-12) — bare path is free for marketing to build |
| Contact | `/contact` | **Done** | Leads form + `20260711000000_leads.sql` migration |

### Next session — recommended order

1. **Corporate / HMO** — now unblocked (route collision resolved), build the two remaining pages
2. **About founder — real content** — replace bracketed founder name/photo/bio placeholders with the real bio
3. **Lighthouse pass** — homepage 90+ perf, 100 a11y
4. **Merge marketing branch** → `main-dev`, then staging deploy

### Local dev

- **Marketing (default):** `pnpm --filter @tarragon/web dev` → `http://localhost:3000/` shows marketing homepage
- **Platform entry:** `http://localhost:3000/login` or `http://app.localhost:3000/` (redirects to login / role home)
- **Platform dashboards:** unchanged under `/patient`, `/clinician`, `/doctor`, etc.

### Import boundary (enforce every session)

```
✅  (marketing)/  →  @/components/ui/*, @/lib/marketing/*, @/lib/utils
❌  (marketing)/  →  @/lib/supabase/*, @/lib/auth/*, @/lib/queries/*, (dashboard)/*
```

Exception when Contact page ships: server action only, no client Supabase.
