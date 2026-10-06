# S40 Competitor review: MyMedicalBank (public pages only, 2026-10-06)

Method: curl headers/HTML, WebFetch, in-app browser on public pages (desktop and 390px), performance.getEntries, and the public WordPress REST feed of resources.mymedicalbank.com. No sign-up, no forms, nothing submitted. The desk-research section of "Nigeria healthtech competitor analysis.md" was not repeated here.
Limits: the 390px screenshot covered only the top of /health-market. A service-detail page was not reached (the "View Details" links did not expose hrefs). /health-assistant returned an "Access Denied" page to my browser, so the live AI flow is UNVERIFIED and is described only from the vendor's own blog post.

## Snapshot
- Nigerian digital health marketplace: "find, book and pay" for 200+ services from verified providers, 36 states plus FCT. Claims 10,000+ users and a 4.8 app rating (both UNVERIFIED, self-reported).
- Pay-as-you-go, "no membership". Examples seen: online consult from 2,000 NGN, doctor home visit 40,000 NGN, GP consult 8,000 NGN, FBC from 8,500 NGN, HMO outpatient plan 60,000 NGN (Hygeia listed), BLS training 50,000-200,000 NGN, quarterly package 140,000 NGN. The blog says consults start at 5,000 NGN, which conflicts with the 2,000 NGN on the home page.
- Breadth, not depth: no chronic-care programme, longitudinal record or escalation ladder was visible publicly. A "Personal Health Record" is mentioned in the blog only.
- Free top-of-funnel tools: AI health assistant, ElderWell 30-question assessment (offers 10% off a first nurse visit for an emailed report, "first 200 this month"), hospital directory pages, blog. Support is WhatsApp plus Zoho chat. Payments via Paystack.

## Design
Strengths
- Clear IA: Health Market, Home Care, Clinic Visit, Corporate Plans, Our Tools, Resources. Category filters carry counts (Lab 40+, Home Care 25+, Mental 12+ ...).
- The market page has a faceted filter set: category, all 36 states, price range, "Verified only". It also has sort, grid/list toggle and a "Most booked this week" strip.
- Each card shows provider, location, one-line scope, a price and two buttons (View Details, Book Now). Price and CTA are unambiguous.
- A "Quick access" panel with starting prices on the hero gives pricing up front. A "Not sure what you need? Ask the AI assistant" card helps indecisive users.
- Trust surfaces: a "verified providers" badge, verified-only filter, a 4.8 rating claim, a Paystack secure-payment line, and a corporate-plans link for organisations.
Weaknesses
- Mobile 390px: three floating widgets stack on the viewport (WhatsApp, Zoho "We're Online", a GetButton badge) and cover content and CTAs. The logo image rendered as broken alt text in my capture. Hero stats and the quick-access panel push the first real service below the fold.
- Accessibility: images carry alt text (0 of 7 missing), but there is no `lang` attribute on the document, two H1s on the market page, no skip link, and an emoji-as-icon pattern in card headers. Contrast of the teal-on-dark hero was not measured (UNVERIFIED).
- Listing quality looks like seed data: some cards show Nationwide, and a few provider names read as generic. Whether prices are live is UNVERIFIED.
- No cookie or consent banner was visible, despite Mixpanel, Meta and Google Ads tags (see below).

## Functionality (feature inventory)
| Area | Observed (public) | Notes |
|---|---|---|
| Marketplace | 11 categories incl. lab, home care, GP, mental, dental, optical, training, insurance, physio, maternal, pharmacy ("New") | 34 services in the list at fetch, though the hero claims 200+ |
| Home visit | Doctor 40,000 NGN, nurse from 25,000 NGN, elderly package 200,000 NGN | Booking steps not public |
| Lab | Tests with home collection | Results flow not public |
| Telemedicine | Online consult, chat/audio/video per blog | Doctor choice at booking |
| HMO | HMO plan listed as a marketplace product (Hygeia); "R-Care" per brief UNVERIFIED on site | Bought like any item |
| Corporate | Plans: wellness, EAP, maternity, pre-employment | Custom quotes |
| Free tools | AI health assistant, ElderWell assessment, hospital directory | Lead-capture oriented |
| Auth | "Register / Login" in header; no sign-up needed to start the AI (per blog) | UNVERIFIED live |

AI assistant funnel (from the vendor blog, not the live tool)
- Symptom chat with follow-up questions, quick-select topics (Headache, Fever, Chest Pain ...), and upload of PDF/JPG/PNG/TXT/CSV lab reports for plain-language interpretation. It also covers medication explanation and appointment prep.
- Safeguards claimed: a list of red-flag symptoms ("when NOT enough") and "always tells you when urgent". The post gives no human review of results and no clinician sign-off step. MDCN registration applies only to the booked doctors.
- Handoff and upsell: "book a consultation from the same screen" (virtual, clinic, home visit). Stored conversations need a free PHR account.
- Compliance claims: NDPR, GDPR, CCPA and HIPAA all asserted in one sentence (UNVERIFIED, and HIPAA does not apply to a Nigerian consumer service).
- Onboarding friction from reviews: not assessed beyond the desk research; no new review evidence was gathered here.

## Code and performance
- Server: PHP, Fat-Free Framework (`X-Powered-By: Fat-Free Framework` is exposed), behind Cloudflare. PHPSESSID cookie is Secure, HttpOnly, SameSite=Lax.
- Frontend: Bootstrap, jQuery plus jQuery UI/DataTables/timepicker, Font Awesome kit, Google Fonts, unpkg libraries. The blog is WordPress (Elementor, Jannah theme, Rank Math SEO).
- Security headers on the home page: X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff, X-XSS-Protection (obsolete). No CSP, HSTS, Referrer-Policy or Permissions-Policy seen. The CORS response header set advertises `allow-credentials: true` with broad methods (could not confirm which origins; UNVERIFIED impact).
- Analytics and vendors: Mixpanel (EU API host) with `track_pageview` and `track_links`, and **`record_sessions_percent: 100` (every visitor session recorded)**. Also Google Tag Manager/gtag, Meta Pixel, Google Ads/DoubleClick, ShareThis, Zoho SalesIQ, GetButton, Paystack, Google APIs. I did not test whether recording runs on the AI chat or results pages (they were not reachable).
- Weight (health-market, desktop): 79 requests, about 40 KB transferred in the browser's counter (many third-party items report 0, so it under-counts). DOMContentLoaded about 0.9 s, load about 1.3 s. Home HTML is 114 KB.
- SEO: unique titles and meta descriptions, JSON-LD `ItemList` on the market page (duplicated twice), Rank Math on the blog, programmatic hospital-directory page by state. No LocalBusiness/MedicalOrganization schema was seen on the page sampled.

## Safety or regulatory concerns
1. AI interpreting uploaded lab results with no stated clinician review: the post promises "which results need attention". For Nigeria (NDPA, MDCN advertising rules) this is a medical-device-adjacent claim with no visible governance, audit trail or kill switch.
2. Session recording at 100 percent on a site that hosts health content, plus Meta Pixel and DoubleClick tags, with no visible consent banner. If recording or pixels fire on symptom, results or booking pages, health inferences leak to ad and analytics vendors (NDPA consent and sensitive-data rules). UNVERIFIED for the AI pages.
3. Stacked compliance claims (NDPR, GDPR, CCPA, HIPAA) read as marketing, not evidence.
4. The urgent-symptom handling is a blog-post list. No documented emergency escalation or contact fan-out is visible.
5. Upsell directly from a symptom/results screen to paid bookings blurs triage and sales.

## What Tarragon should adapt (originally)
- Price-first marketplace cards with one primary CTA. Show Tarragon's per-piece-of-work prices (service_products) the same plainly, with an inline "what's included" line.
- A "not sure? start here" entry that routes to the right service. Tarragon's version should be the existing deterministic triage checker, with escalation to a doctor, not a free-text LLM guess.
- Filter-with-counts and a verified-only toggle where Tarragon lists labs and specialists. Show verification as a dated, checkable fact, not just a badge.
- A free assessment as a lead tool for caregivers (the ElderWell pattern). Tie it to the Care Circle, with no discount-for-email gimmick.
- Directory SEO pages by state, built from Tarragon's own region data.

## What Tarragon should avoid
- Any AI result explainer that releases interpretation before a doctor has signed off. If built, route through runGovernedAi, label it as an explanation not a diagnosis, and show a human handoff.
- Session replay or ad pixels on any signed-in or health page. If analytics are needed, mask all inputs, exclude health routes, and gate behind consent.
- Floating-widget pile-ups on mobile (three overlapping chat buttons), and a hero that pushes content below the fold.
- Inconsistent price claims across pages (2,000 vs 5,000 NGN), and vanity counters that don't match the listing (200+ vs 34).
- Exposing the framework in headers and shipping without CSP/HSTS. Do not copy their blanket "NDPR/GDPR/HIPAA compliant" line; claim only what is documented (NDPC registration and DPO are real for Tarragon).
