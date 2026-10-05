# Medilitics (Nigerian digital-health competitor)

**Critical naming/domain note, read first:** The domain given in the assignment, `medilitics.com`, does **not** resolve to an operating company — it 307-redirects to a GoDaddy "domain for sale" parked page (`forsale.godaddy.com/forsale/medilitics.com`), confirmed live 2026-09-24. Extensive searching found zero company, app, LinkedIn page, or press coverage under the exact spelling "Medilitics." The company that matches every element of the brief (Nigeria-based, chronic-disease-management/preventive-health platform, direct Tarragon Health competitor) is **"Medlitics"** (no second "i"), operating at `medlitics.com`, tagline "Smarter Chronic Care for Africa," legal entity "Medlitics Limited," Nigerian phone number `+234-816-675-3541`. A separate, unrelated company, "Medilitics Connect" (`mediliticsconnect.com`), also exists but is a health-data-interoperability/FHIR-conversion B2B tool with no stated Nigerian ties, no chronic-care product, and no evidence of Nigerian operations — it does not match the brief and was not researched further beyond confirming it's a different business. **All findings below are about Medlitics (medlitics.com)**, treated as the intended subject; the report-writer should confirm this substitution is acceptable, or note it as a name/spelling discrepancy in the final report.

## Marketing website: homepage, product pages, pricing, about

### Takeaway
Medlitics runs a modern, conversion-optimized marketing site (Cloudflare-hosted, Manrope/DM Sans fonts, HubSpot + Intercom + Crisp + Tawk.to chat stack) built around three chronic conditions (diabetes, hypertension, asthma), each with its own dedicated sales landing page, a tiered freemium pricing model, and patient/clinician testimonials — all styled around a cost-savings and "continuous care" narrative rather than clinical authority claims.

### Cited Findings
- Homepage `<title>`: "Medlitics – Smarter Chronic Care for Africa"; meta description: "AI-powered chronic disease management for Africa. Track vitals, connect wearables, consult verified practitioners, and get real-time health alerts. Installable on your phone." — [medlitics.com](https://www.medlitics.com/)
- Verbatim headline: "Better chronic disease management. Save 50% on care." — [medlitics.com](https://www.medlitics.com/)
- Verbatim hero line: "Manage Diabetes with confidence. At half the cost." — [medlitics.com](https://www.medlitics.com/)
- Verbatim CTAs: "Get Started for FREE!", "Create patient account", "Join as a practitioner", "Talk to us" — [medlitics.com](https://www.medlitics.com/)
- Condition mega-menu copy (verbatim, under 15 words each): "Control blood sugar, save 50%" (Diabetes); "Prevent stroke, reduce risk by 78%" (Hypertension); asthma card present but text not captured — [medlitics.com](https://www.medlitics.com/)
- Feature copy, "Real-time Health Alerts": "Monitor your readings 24/7. The moment a value leaves the safe range, you and your practitioner are notified instantly" — [medlitics.com](https://www.medlitics.com/)
- AI assistant is branded "Meddy" — "Ask Meddy anything about your health. Get personalised explanations, trend summaries, and evidence-based suggestions" — [medlitics.com](https://www.medlitics.com/)
- Testimonial section header (verbatim): "Trusted by patients & doctors across Nigeria" — [medlitics.com](https://www.medlitics.com/)
- Testimonial, patient (verbatim quote, attributed "Funmi Olatunji, Patient · Lagos · Hypertension"): "Medlitics caught my blood pressure spiking before I even felt symptoms. My doctor was already calling when I picked up my phone." — [medlitics.com](https://www.medlitics.com/)
- Testimonial, doctor (verbatim, attributed "Dr. Emeka Adeola, Cardiologist · Abuja"): "Managing 20+ chronic patients used to be overwhelming. With Medlitics I see everything at a glance and intervene before problems escalate." — [medlitics.com](https://www.medlitics.com/)
- Testimonial, patient (verbatim, attributed "Blessing Nwosu, Patient · Port Harcourt · Diabetes"): "My Samsung watch syncs automatically and my doctor sees everything. Managing my diabetes has never felt this controlled." — [medlitics.com](https://www.medlitics.com/)
- Stats banner claims: "2,400+ people on waiting list," average practitioner response "<2min," "98 percent" alert accuracy, "85% success rate in managing glucose levels" — [medlitics.com](https://www.medlitics.com/); alert accuracy and response-time figures corroborated in press — [BusinessDay NG](https://businessday.ng/news/article/african-health-startup-targets-diabetes-hypertension-costs-with-ai-powered-monitoring-platform/)
- Site is dedicated funnel pages per condition: `/diabetes-sales`, `/hypertension-sales`, `/asthma-sales` (confirmed via page source nav markup) — [medlitics.com](https://www.medlitics.com/)
- Platform segments the site markets to: "For patients," "For practitioners," "For insurance partners (via Curacel)," "For hospitals & clinics" — [medlitics.com](https://www.medlitics.com/)
- Footer/company facts: entity "Medlitics Limited," location Nigeria, built by development partner "O'Bounce Technologies," copyright year 2026; footer nav includes About, Blog, Careers, Contact, Privacy Policy, Terms of Service, NDPR Compliance, Cookie Policy — [medlitics.com](https://www.medlitics.com/)
- Named insurance-industry partner: Curacel (insurance-integration partner) — [medlitics.com](https://www.medlitics.com/)
- Visual/UX pattern: hero section with dual "save X%" cost claims, an icon-led mega-dropdown "Conditions" nav menu, a star-rated (★★★★★) testimonial carousel with patient initials/avatars, a stats/trust banner, and a tiered pricing table — [medlitics.com](https://www.medlitics.com/)

### Inferences
- The marketing narrative leans heavily on **cost savings and continuity of care** ("save 50%", "half the cost", "78% risk reduction") rather than on clinical trust-building language — a notably different rhetorical strategy from Tarragon Health's brand voice (which explicitly avoids specific ratio/outcome claims in marketing copy per its own brand guide).
- The presence of three separate condition-specific "sales" landing pages plus a mega-menu suggests active paid-acquisition/SEO funnel-building, not just a single brochure site.
- Chat-widget stacking (Intercom + Crisp + Tawk.to simultaneously present in CSP headers) suggests either an in-progress vendor migration or A/B testing of support tooling, not a settled setup.

### Gaps
- Full `/about` page content (mission statement beyond the tagline, company history, founding date) could not be retrieved — WebFetch repeatedly returned cached homepage content instead of the About page body; only inferred/footer-level facts are available.
- Full asthma condition-page copy and dedicated `/pricing`, `/for-practitioners`, `/for-hospitals` page layouts beyond the pricing table were not individually crawled in depth.
- No blog content was reviewed (footer links to a Blog, not fetched).

## Product functionality (patient/clinician features, chronic disease management, integrations, payment model)

### Takeaway
Medlitics is an AI-augmented remote patient-monitoring and virtual-care platform targeting three conditions (diabetes, hypertension, asthma), combining wearable/device data ingestion, an AI assistant ("Meddy"), doctor tele-consultations, and a three-tier freemium subscription model (Free / Basic $9.99/mo / Premium $19.99/mo) with separate couple and corporate group pricing — structurally similar to Tarragon Health's chronic-care wedge but monetized via a Western-style monthly subscription in USD rather than Tarragon's NGN per-service/Care-Voucher/Platform-Credit model.

### Cited Findings
- Core offering: "Connecting patients, practitioners, hospitals, and insurers for effortless, intelligent chronic disease care" (site's own framing) — [medlitics.com](https://www.medlitics.com/)
- Conditions covered: Diabetes (claims 50% cost savings, 85% success rate managing glucose), Hypertension (claims 78% stroke-risk reduction), Asthma (claims 92% reduction in attacks) — [medlitics.com](https://www.medlitics.com/)
- Wearable/device integrations: Fitbit, Samsung Health, Google Fit, Apple Health, plus Bluetooth-enabled glucometers and BP monitors, with automatic syncing — [medlitics.com](https://www.medlitics.com/); data collection cadence described as "every 15 minutes" in press coverage — [BusinessDay NG](https://businessday.ng/news/article/african-health-startup-targets-diabetes-hypertension-costs-with-ai-powered-monitoring-platform/)
- AI assistant "Meddy": described on-site as answering health questions with "personalised explanations, trend summaries, and evidence-based suggestions" — [medlitics.com](https://www.medlitics.com/); founder frames it explicitly as clinical decision support that "augments clinicians, never replacing them" — [Techeconomy.ng](https://techeconomy.ng/a-chat-with-michael-fasere-on-how-medlitics-is-using-ai-and-offline-first-tech-to-fix-africas-chronic-disease-crisis), also quoted in [THISDAYLIVE (Aug 2026)](https://www.thisdaylive.com/2026/08/20/fasere-digital-tools-will-address-africas-long-term-clinical-conditions/)
- Consultation modes: video, messaging, and in-person consultations with an "assigned doctor" — [medlitics.com](https://www.medlitics.com/)
- Auto-generated monthly health reports, trend charts per metric, medication adherence scores, and exportable doctor-reviewable summaries — [Google/search-aggregated site description](https://www.medlitics.com/)
- Insurance-industry integration via named partner Curacel, positioned as: "Reduce claims, improve member outcomes, and offer real preventive care through seamless health data integration" — [medlitics.com](https://www.medlitics.com/)
- Pricing (verbatim tiers, USD): **Free** — $0 forever, "health profile, essential education, and light logging"; **Basic** — $9.99/mo or $99/yr (30-day free trial), includes a free 15-min doctor consult or $5.99 per additional 30 min, baseline AI risk insights, basic early-warning alerts; **Premium** — $19.99/mo or $199/yr, "Advanced care for high-risk individuals, families & corporate plans requiring continuous clinical oversight," 3 free 30-min doctor sessions/month, remote patient monitoring, limited caregiver seats, priority support — [medlitics.com/pricing](https://www.medlitics.com/pricing)
- Group pricing: Couple plan Basic $39.99 + $6.99/person, Premium $29.99 + $5.99/person; Corporate plan Basic $16.99/employee (min. 20 employees), Premium $14.99/employee (min. 20) — [medlitics.com/pricing](https://www.medlitics.com/pricing)
- Annual billing discount advertised at ~17% off monthly-equivalent pricing — [medlitics.com/pricing](https://www.medlitics.com/pricing)
- Currently free for both patients and doctors at launch, per press coverage (may refer to a promotional/pre-monetization launch phase distinct from the pricing page's paid tiers) — [BusinessDay NG](https://businessday.ng/news/article/african-health-startup-targets-diabetes-hypertension-costs-with-ai-powered-monitoring-platform/)
- Platform explicitly designed **offline-first** as a Progressive Web App, targeting "urban hospitals, rural clinics, and remote regions with inconsistent connectivity," with low-bandwidth optimization — [Techeconomy.ng interview](https://techeconomy.ng/a-chat-with-michael-fasere-on-how-medlitics-is-using-ai-and-offline-first-tech-to-fix-africas-chronic-disease-crisis)
- Security/compliance claims: end-to-end encryption, role-based access control, multi-factor authentication; explicit compliance claims with Nigeria's NDPA/NDPC, UK GDPR, and EU GDPR — [Techeconomy.ng](https://techeconomy.ng/a-chat-with-michael-fasere-on-how-medlitics-is-using-ai-and-offline-first-tech-to-fix-africas-chronic-disease-crisis); [THISDAYLIVE (Aug 2026)](https://www.thisdaylive.com/2026/08/20/fasere-digital-tools-will-address-africas-long-term-clinical-conditions/)
- Founder's positioning quote on differentiation from hardware-dependent competitors: "Africa requires healthcare technology designed for African realities rather than imported assumptions" — [THISDAYLIVE (Aug 2026)](https://www.thisdaylive.com/2026/08/20/fasere-digital-tools-will-address-africas-long-term-clinical-conditions/)
- Founder's continuity-of-care framing: "The challenge isn't merely access to healthcare, it's continuity of care" — [Techeconomy.ng](https://techeconomy.ng/a-chat-with-michael-fasere-on-how-medlitics-is-using-ai-and-offline-first-tech-to-fix-africas-chronic-disease-crisis)
- Founder quote on chronic-care cadence: "Chronic diseases require daily attention, not just quarterly checkups" — [THISDAYLIVE (June 2026)](https://www.thisdaylive.com/2026/06/18/firm-launches-ai-powered-platform-for-chronic-disease-management/); [BusinessDay NG](https://businessday.ng/news/article/african-health-startup-targets-diabetes-hypertension-costs-with-ai-powered-monitoring-platform/)

### Inferences
- Medlitics's USD-denominated subscription pricing (even with a Naira-based phone/contact presence) suggests either a diaspora/dollarized target segment, an unlaunched or aspirational pricing page, or a hedge against Naira volatility — worth flagging as a contrast point against Tarragon Health's kobo-denominated, NGN-first pricing model.
- The "assigned doctor" + tiered consultation-minutes model (free 15 min, then metered) is structurally closer to a telehealth-subscription model (e.g., a Western direct-to-consumer telehealth app) than to Tarragon's doctor-tier/escalation-SLA model — no visible equivalent of a formal doctor-tier ladder, escalation SLA, or auto-assignment engine is described anywhere in the public materials found.
- The partner-network claims (Curacel for insurance; "hospitals & clinics" segment) appear to be positioning/aspirational marketing copy rather than confirmed operational integrations — no named hospital or specific HMO/insurer beyond Curacel was found.

### Gaps
- No pharmacy/lab-network partner names were found (unlike Tarragon's named Synlab/Cerba Lancet/etc. relationships) — could not confirm whether Medlitics has any lab or pharmacy fulfilment partners at all.
- No information found on how many active paying subscribers exist, vs. the "2,400+ waiting list" and "thousands of active patients" figures, which are unaudited self-reported marketing claims.
- Could not confirm whether the "800+ verified doctors" figure (cited in search-aggregated summaries) refers to doctors actively seeing patients vs. doctors merely registered/verified on the platform; no primary-source page was found directly quoting this figure verbatim.

## Mobile apps (App Store / Google Play — install counts, ratings, reviews)

### Takeaway
Medlitics has **no native iOS or Android app** — it is deliberately built and marketed as an installable Progressive Web App (PWA) reachable only via the website, meaning there are no App Store/Google Play listings, install counts, star ratings, or app-store user reviews to analyze.

### Cited Findings
- Site's own positioning: "Progressive Web App that can be installed on Android, iOS, or desktop in seconds with no App Store required. Works offline, loads instantly, and feels native." — [medlitics.com](https://www.medlitics.com/) (site meta description independently confirms: "Installable on your phone")
- Multiple targeted searches for "Medlitics" (and the "Medilitics" spelling) across App Store and Google Play search terms returned zero matching listings — only unrelated apps with similar names (Medtrics, Medics, Medils, MediClinic, etc.) — [search results, no primary source]

### Inferences
- Choosing PWA-only distribution (rather than native apps) is a direct product/technical consequence of the "offline-first, low-bandwidth" design philosophy the founder describes, and also avoids app-store review/approval friction and 30% platform fees — but it forgoes app-store discovery, ratings-based social proof, and push-notification reliability that native apps get.

### Gaps
- No App Store or Google Play listing exists to review — explicitly confirmed absent, not merely unfound. No install counts, star ratings, or user reviews are available from these channels for this company.

## Tech/backend signals (framework fingerprints, hosting, analytics, job postings, engineering blog, GitHub)

### Takeaway
Publicly visible signals show a Cloudflare-fronted, custom-built (non-framework-fingerprinted) static/server-rendered site with a dedicated API subdomain (`api.medlitics.com`), a marketing/support stack of HubSpot, Intercom, Crisp, and Tawk.to, Google Analytics/Tag Manager and a Facebook pixel, reCAPTCHA-gated forms, and a tie to the founder's own fintech venture (`checkout.1app.online`) for payments — but no engineering blog, GitHub org, or job postings were found publicly.

### Cited Findings
- HTTP response headers show `server: cloudflare` (Cloudflare-fronted/CDN-proxied), HTTP/2, standard Cloudflare NEL/report-to telemetry headers — [direct HTTP header inspection, medlitics.com, 2026-09-24]
- Content-Security-Policy header lists allowed script/connect sources: `fonts.googleapis.com`, `www.googletagmanager.com` (Google Tag Manager), `connect.facebook.net` (Facebook Pixel), `js.hs-scripts.com` (HubSpot), `widget.intercom.io` (Intercom chat), `client.crisp.chat` (Crisp chat), `checkout.1app.online` (payment checkout tied to founder's own 1App Technologies fintech platform), `static.cloudflareinsights.com`, `embed.tawk.to`/`va.tawk.to`/`*.tawk.to` (Tawk.to chat), Google reCAPTCHA — [direct HTTP header inspection, medlitics.com, 2026-09-24]
- `connect-src` also lists `formspree.io` (form-submission backend), `api.medlitics.com` (dedicated custom API subdomain — confirms a real backend service, not just a static site), `countriesnow.space` (third-party country/location data API, likely used in signup/location forms), Google Analytics — [direct HTTP header inspection, medlitics.com, 2026-09-24]
- Page source shows hand-authored HTML (`<!DOCTYPE html>`, plain `<link rel="stylesheet" href="/css/style.css?v=20260907">` with a cache-busting version string dated 2026-09-07) with Google Fonts Manrope + DM Sans — no `__NEXT_DATA__`, `data-reactroot`, `ng-version`, or other React/Next.js/Angular/Vue fingerprints were found in the fetched markup, suggesting a custom/vanilla-JS or lightweight static-site build rather than a modern JS framework SPA — [direct source inspection, medlitics.com, 2026-09-24]
- `permissions-policy` header explicitly blocks camera/microphone/geolocation by default (`camera=(), microphone=(), geolocation=(), payment=(self)`) except payment for self — [direct HTTP header inspection, medlitics.com, 2026-09-24]

### Inferences
- The combination of HubSpot + Intercom + Crisp + Tawk.to simultaneously permitted in the CSP suggests either rapid iteration/testing of support-chat vendors or incomplete CSP cleanup after a vendor switch — not a stable, settled tooling choice.
- Payments routed through `checkout.1app.online` (the founder's own fintech company, 1App Technologies) rather than a standard Nigerian gateway (e.g., Paystack/Flutterwave) suggests Medlitics is using its founder's other venture as its payment processor — an unusual vertical-integration choice worth noting for competitive/business-model analysis.
- No dedicated engineering blog, public API/developer docs, or GitHub organization surfaced in any search — suggesting either a very small/early engineering team with no public technical content, or content that exists but isn't indexed/discoverable.

### Gaps
- No LinkedIn job postings, careers page content (despite a "Careers" footer link), or engineering team size/roles could be found or confirmed.
- No GitHub org/repos found under "Medlitics" or obvious variants.
- Could not confirm actual hosting provider behind Cloudflare's proxy (Cloudflare masks the origin), nor confirm database/backend technology choices beyond the existence of a custom API subdomain.

## Business/network signals (funding, partners, press, social media, founder background)

### Takeaway
Medlitics is a very recently launched (2026) Nigerian startup founded and led by serial entrepreneur Michael Fasere (previously founder of fashion-tech platform Pashione and co-founder of fintech platform 1App Technologies), with real Nigerian business-press coverage (BusinessDay NG, THISDAYLIVE, Techeconomy.ng) but **no disclosed funding, no confirmed named hospital/HMO partners beyond insurance-tech vendor Curacel, and no coverage found yet from the major Africa tech-press outlets** (TechCrunch Africa, TechCabal, Techpoint Africa, Disrupt Africa, Nairametrics) that typically cover funded Nigerian healthtech rounds.

### Cited Findings
- Founder/CEO: Michael Fasere, described as having "over two decades of experience in technology, cybersecurity and startup building across Africa" — [BusinessDay NG](https://businessday.ng/news/article/african-health-startup-targets-diabetes-hypertension-costs-with-ai-powered-monitoring-platform/); [Techeconomy.ng](https://techeconomy.ng/a-chat-with-michael-fasere-on-how-medlitics-is-using-ai-and-offline-first-tech-to-fix-africas-chronic-disease-crisis)
- Fasere's prior ventures: founder of Pashione (a fashion-tech social-commerce platform connecting African designers to global buyers, expanded to 10 African countries including Nigeria/Kenya/South Africa, 960+ vendors onboarded) and co-founder of 1App Technologies (a cloud-based fintech infrastructure platform for identity/payments/financial microservices in Africa) — [search-aggregated, corroborated by Pashione's own Crunchbase listing](https://www.crunchbase.com/organization/pashione-inc); [Techeconomy.ng](https://techeconomy.ng/a-chat-with-michael-fasere-on-how-medlitics-is-using-ai-and-offline-first-tech-to-fix-africas-chronic-disease-crisis)
- Fasere also writes a Substack (michaelfasere.com) covering fashion-tech/fintech/healthtech entrepreneurship in Africa, including a post titled "From Fashion to Fintech to Healthcare: How African Innovation Is Rewriting the Global Startup Story" — [michaelfasere.com](https://www.michaelfasere.com/p/from-fashion-to-fintech-to-healthcare)
- Press coverage confirmed from three Nigerian outlets: BusinessDay NG ("African health startup targets diabetes, hypertension costs with AI-powered monitoring platform") — [BusinessDay NG](https://businessday.ng/news/article/african-health-startup-targets-diabetes-hypertension-costs-with-ai-powered-monitoring-platform/); THISDAYLIVE, two separate articles, first dated around June 2026 ("Firm Launches AI-powered Platform for Chronic Disease Management") — [THISDAYLIVE](https://www.thisdaylive.com/2026/06/18/firm-launches-ai-powered-platform-for-chronic-disease-management/) — and a second dated August 2026 ("Fasere: Digital Tools Will Address Africa's Long-term Clinical Conditions") — [THISDAYLIVE](https://www.thisdaylive.com/2026/08/20/fasere-digital-tools-will-address-africas-long-term-clinical-conditions/); Techeconomy.ng founder interview — [Techeconomy.ng](https://techeconomy.ng/a-chat-with-michael-fasere-on-how-medlitics-is-using-ai-and-offline-first-tech-to-fix-africas-chronic-disease-crisis)
- Named partner: Curacel, an African insurtech/insurance-infrastructure company, for "affordable insurance products and preventive care programs" and insurance-claims integration — [medlitics.com](https://www.medlitics.com/); [search-aggregated site description]
- Named development/technical partner: "O'Bounce Technologies" (per site footer) — [medlitics.com](https://www.medlitics.com/)
- Social presence: site links to Facebook, Instagram, Twitter/X, LinkedIn, and a WhatsApp Channel — [medlitics.com](https://www.medlitics.com/); a LinkedIn company page exists at `linkedin.com/company/medlitics` ("Medlitics Inc") and a personal LinkedIn for the founder at `linkedin.com/in/michaelfasere/` — [LinkedIn search results, not directly fetched]; founder is active on X/Twitter as `@michaelfasere` — [x.com/michaelfasere](https://x.com/michaelfasere)
- No funding amount, investor names, or funding round type (pre-seed/seed/etc.) were disclosed in any of the three press articles reviewed — [BusinessDay NG](https://businessday.ng/news/article/african-health-startup-targets-diabetes-hypertension-costs-with-ai-powered-monitoring-platform/); [THISDAYLIVE](https://www.thisdaylive.com/2026/06/18/firm-launches-ai-powered-platform-for-chronic-disease-management/); [Techeconomy.ng](https://techeconomy.ng/a-chat-with-michael-fasere-on-how-medlitics-is-using-ai-and-offline-first-tech-to-fix-africas-chronic-disease-crisis)
- No Crunchbase profile found for "Medlitics" itself (only for Fasere's earlier venture, Pashione) — [search results]

### Inferences
- The company appears to be in a very early, recent-launch phase (2026, per THISDAYLIVE's June 2026 "launch" framing) — young enough that major pan-African tech press (TechCabal, Techpoint Africa, Disrupt Africa, Nairametrics) had not yet covered it as of this research (2026-09-24), which is itself a signal about its current visibility/scale relative to funded competitors.
- The founder's pattern of building and then covering his own multiple ventures (fashion-tech, fintech, now healthtech) across ~a decade, combined with using his own fintech checkout product for Medlitics payments, suggests a single-founder/serial-entrepreneur operating model rather than an institutionally-backed team — worth flagging as a scale/durability signal for the competitive report.

### Gaps
- No confirmed funding round, investor names, or valuation found anywhere.
- No confirmed named hospital, HMO, or lab partner beyond the single insurance-tech vendor Curacel.
- LinkedIn company page content (employee headcount, job postings, founding date as stated by LinkedIn) could not be directly fetched/verified — only its existence was confirmed via search snippets.
- No coverage found from TechCrunch, TechCabal, Techpoint Africa, Disrupt Africa, or Nairametrics specifically — absence noted, not confirmed as "no coverage exists," since these sites' own search/archives were not directly crawled.

## Reviews/reputation (Trustpilot, Google Reviews, app-store reviews, forums)

### Takeaway
No third-party reviews of Medlitics were found on any platform — no Trustpilot listing, no Google Reviews/Maps listing, no app-store reviews (no app exists to review), and no Nairaland or Reddit discussion threads — meaning there is currently no independent, non-marketing-controlled reputation signal available for this company.

### Cited Findings
- Targeted Trustpilot search for "medlitics" returned zero matching results; only unrelated similarly-named companies (Medimpact, Medhealth, MediClinic, Medilisk, MedCline, Medico Clinic, MeduClinic, Medicsi) appeared — [search results, no primary source found]
- Targeted Nairaland search for "Medilitics"/variants returned no forum threads about the company — only unrelated Nairaland pages and an unrelated "Medicay" profile page — [search results, no primary source found]
- No Reddit threads were found in general web search results for the company name.

### Inferences
- The complete absence of third-party review-platform presence is consistent with the company being very recently launched and still small — this is itself the reputational finding: no independent user sentiment (positive or negative) is publicly verifiable yet, so any positive claims (testimonials, stats) currently rest entirely on the company's own marketing site and its own press-interview quotes.

### Gaps
- No Google Maps/Google Reviews listing was directly checked via a Maps-specific search (not fully explorable via general web search) — genuinely unconfirmed either way, should be spot-checked directly on Google Maps if the report needs to close this gap.
- No direct Reddit site-search (`site:reddit.com`) was run — general web search covered this ground indirectly but a dedicated Reddit search was not separately executed given the tool-call budget for this research pass.
- Testimonials quoted on the marketing site (Funmi Olatunji, Dr. Emeka Adeola, Blessing Nwosu) cannot be independently verified as genuine, unpaid, or representative — they are company-published marketing content, not third-party reviews.
