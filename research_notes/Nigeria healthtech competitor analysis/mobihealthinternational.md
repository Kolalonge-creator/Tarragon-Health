# Mobihealth International — Competitive Research Note

## Marketing website (headline copy, value proposition, design/tone, CTAs)

### Takeaway
Mobihealth International's marketing site (mobihealthinternational.com, mirrored at mobihealth.vercel.app) positions the company as a large-scale, multi-segment (B2C/B2B/B2G/SaaS/white-label) global telemedicine platform, leading with quantified cost/efficiency claims ("75% cost savings," "100,000+ global medical experts," "60% hospital congestion reduction") rather than an emotional/trust-based pitch. The direct homepage URL returned HTTP 404 on a live fetch attempt during this research session; the content below was recovered via a mirror (mobihealth.vercel.app) and via search-engine indexing/snippets, so treat exact page structure as approximate rather than a live-verified crawl.

### Cited Findings
- Homepage headline (verbatim, under 15 words): "Quality Affordable Healthcare at Your Finger Tip!" — [mobihealth.vercel.app](https://mobihealth.vercel.app/)
- Homepage subheading (verbatim): "Instantly connect with top-tier medical professionals, locally and globally." — [mobihealth.vercel.app](https://mobihealth.vercel.app/)
- Value-prop claim: "75% Cost Savings" — [mobihealth.vercel.app](https://mobihealth.vercel.app/)
- Value-prop claim: hospital congestion reduced "by over 60%" — [mobihealth.vercel.app](https://mobihealth.vercel.app/)
- Value-prop claim: access to "100,000+ global medical experts" for video consultations and prescriptions — [mobihealth.vercel.app](https://mobihealth.vercel.app/)
- CTA button copy observed: "get started," "book appointment," "get started now" — [mobihealth.vercel.app](https://mobihealth.vercel.app/)
- Homepage sections observed: Features/What We Offer, Trusted Partners (logo strip), Medical Specialties grid (Dentistry, Cardiology, Healthcare, Dermatology, Gynecological, Oncology), "Customized Healthcare Solutions," Client Testimonials, FAQ, footer with Company/Services/Social links — [mobihealth.vercel.app](https://mobihealth.vercel.app/)
- Site explicitly frames itself across four go-to-market motions: B2B, B2C, B2G, and SaaS/white-label solutions — [mobihealth.vercel.app](https://mobihealth.vercel.app/)
- Separate site tagline indexed for the domain: "Global Telemedicine & Telehealth Platform" — [mobihealthinternational.com](https://mobihealthinternational.com)
- App Store listing copy (verbatim, patient app): "We offer you seamless access to healthcare anytime, anywhere, ensuring your well-being with convenience, safety, and privacy at the forefront." — [Apple App Store](https://apps.apple.com/us/app/mobihealth-patient/id6754172339)
- App Store listing feature bullets: "24/7 Quick Access," "No Queue," "Save Travel Cost," reduced "Spread and Exposure to Infection" — [Apple App Store](https://apps.apple.com/us/app/mobihealth-patient/id6754172339)
- Older marketing/product copy (from search-indexed page content, not independently verified live): platform said to offer "50% discounts on medicines and quality diagnostic tests" and portal access "from as low as $10 per annum" — [Solve MIT profile via search summary](https://solve.mit.edu/solutions/19735)
- A distinct "$1 a month" initiative is described for rural/underserved populations, positioned as a diaspora-sponsorship product (diaspora members and global supporters sponsor consultations/tests for people in Nigeria) — [Hippo Hive reprint of Mobihealth feature](https://hippohive.org/2024/10/15/how-mobihealth-is-driving-a-telemedicine-revolution-in-africa/)
- A dedicated `/diaspora` URL exists on the marketing site (mobihealthinternational.com/diaspora) but returned HTTP 404 when fetched live in this session, so its current copy could not be verified — [mobihealthinternational.com/diaspora](https://mobihealthinternational.com/diaspora)
- An `/about-us-2/` URL exists but also returned HTTP 404 on live fetch — [mobihealthinternational.com/about-us-2/](https://mobihealthinternational.com/about-us-2/)

### Inferences
- The repeated 404s on specific sub-pages (homepage root, /diaspora, /about-us-2) during this session, contrasted with a working mirror at a `vercel.app` subdomain, suggest the marketing site may be mid-migration/rebuild, or that the crawler's session hit a bot-protection/redirect issue rather than the pages being genuinely gone — worth a manual browser check before citing page structure as current in the final report.
- The messaging leans heavily on hard numbers (75%, 60%, 100,000+) rather than warmth/trust language — a different voice from Tarragon's "warm, not a hospital PA system" brand guidance, useful as a contrast point.
- The B2B/B2C/B2G/SaaS/white-label framing signals Mobihealth positions itself as infrastructure-for-hire (selling its platform to governments/telcos/corporates), not purely a consumer app — this is a materially different business model from Tarragon's direct-to-patient platform.

### Gaps
- Could not verify a live pricing page (no `/pricing` URL was found or confirmed); the N5000/year figure came from a press article about the Airtel partnership, not the marketing site itself (see Business section).
- Could not confirm current homepage testimonial text verbatim, trust-badge/certification logos, or the FAQ content — only that these sections exist per the mirror.
- Could not independently re-verify the mirror site (`mobihealth.vercel.app`) is an accurate, current copy of the production marketing site rather than a stale or third-party clone — flag this uncertainty to the report writer.

---

## Product functionality (patient/clinician features, chronic care, screening, labs/pharmacy, telemedicine, wearables, insurance, pricing tiers)

### Takeaway
Mobihealth is fundamentally a telemedicine-first platform (video/voice/chat consults with a large pooled network of "100k+" local and diaspora clinicians) layered with physical infrastructure — 20 solar/satellite-powered "telehealth clinics"/cabins, mobile clinics, and partner lab/pharmacy fulfilment — rather than a chronic-disease-management or structured-care-coordination product in the way Tarragon is; no evidence was found of a dedicated chronic-disease program, screening ladder, or wearables integration comparable to Tarragon's stated scope.

### Cited Findings
- Core offer: "connects users to over 100k medical experts from the US, UK and other carefully selected countries within minutes for video consultations, investigation, prescription, treatment and referrals available 24/7" — [search-engine synthesis of company materials](https://businessday.ng/health/article/mobihealth-raises-n1bn-equity-investment-to-push-telehealth-expansion-in-nigeria/)
- Physical infrastructure: "20 integrated telehealth clinics that offer remote consultations, diagnostics, and access to specialist care via digital health tools," described as solar-powered with internet connectivity, located primarily in Nigeria — [search synthesis / Hippo Hive](https://hippohive.org/2024/10/15/how-mobihealth-is-driving-a-telemedicine-revolution-in-africa/)
- Product line per Techpoint Africa coverage: "quick online appointments, real-time video consultations, mobile clinics for remote locations, telehealth cabins, and electronic medical records" — [Techpoint Africa via search synthesis](https://techpoint.africa/insight/9-affordable-telemedicine-startups-nigeria/)
- Lab/pharmacy fulfilment: platform "connects with trusted laboratories near users for genuine quality laboratory and radiologic investigations" and delivers medication "to doorsteps only from trusted pharmacies" — [search synthesis of company site](https://mobihealthinternational.com/)
- Partner network scale claim: "partnerships with over 200 hospitals, labs, and pharmacies" — [search synthesis, source page not individually confirmed](https://www.himss.org/mobihealth/)
- Diaspora/local clinician model: "utilizes local and diaspora medical professionals who are able to diagnose and prescribe to patients remotely" — [search synthesis of company materials](https://mobihealthinternational.com/diaspora)
- Institutional/government use case: the company "has collaborated with governments and insurers, including work with the Nigerian Air Force, to scale services and reduce wait times" — [Techpoint Africa via search synthesis](https://techpoint.africa/insight/9-affordable-telemedicine-startups-nigeria/)
- Airtel partnership (Nov 2024/Mar 2025) embeds Mobihealth inside the Airtel Nigeria app: Airtel subscribers get "24/7 access to doctor globally with affordable subscription plans from N5000 per year," including e-prescriptions, referrals, and access to walk-in telemedicine clinics — [Innovation Village / Vanguard, via search synthesis](https://www.vanguardngr.com/2025/03/mobihealth-and-airtel-partner-to-bring-instant-telemedicine-services-to-millions-of-nigerians/)
- Airtel's stated goal for the partnership is extending reach into rural/remote areas via Airtel's network infrastructure — [search synthesis](https://businessday.ng/technology/article/airtel-mobihealth-to-provide-telemedicine-services-for-nigerians-in-rural-areas/)
- Company self-description (LinkedIn): "Mobihealth is revolutionizing access and delivery of healthcare across Africa and globally through integrated tele-health platform using Artificial Intelligence and IoT powered remote point of care diagnostic tools." — [LinkedIn](https://www.linkedin.com/company/mobihealthinternational)
- LinkedIn specialties list: Medicine, Surgery, Paediatrics, O&G, Telemedicine, Laboratories, Radiology, General Surgery, "All Specialties of Medicine," Pharmaceuticals, Hospitals, Corporations, and NGOs — [LinkedIn](https://uk.linkedin.com/company/mobihealthinternational)
- Product is split into at least three distinct apps on app stores: "Mobihealth Patient," "Mobihealth Doctor" (clinician-side app, evidence it has a dedicated provider app), and a legacy "Mobihealth Consult" app — [Apple App Store listings](https://apps.apple.com/us/app/mobihealth-doctor/id6754277089)

### Inferences
- The "AI and IoT powered remote point of care diagnostic tools" language is a recurring self-description across press/LinkedIn but no research call found a concrete description of what the IoT devices actually are (no product-page detail, no device model names) — likely refers to diagnostic kit deployed at the physical telehealth clinics/cabins rather than a consumer wearable-integration feature.
- No evidence of a structured chronic-disease-management program (e.g., named hypertension/diabetes pathway, escalation SLA, doctor-tier ladder) analogous to Tarragon's core wedge — Mobihealth's public materials describe itself as an access/triage/consultation layer plus physical clinic infrastructure, not a longitudinal chronic-care platform. This should be flagged as a genuine product-scope difference in the comparative report, not just an omission in this research.
- The existence of a separate "Mobihealth Doctor" app (clinician-facing) confirms the company has built a two-sided marketplace (patient app + clinician app), similar in structure to Tarragon's clinician dashboard, but details of clinician workflow, tiering, or escalation logic were not discoverable from public sources.

### Gaps
- No confirmed wearables/remote-patient-monitoring integration was found specific to Mobihealth International (a generic academic "MobiHealth" body-area-network research system exists in the literature but is unrelated to this company — explicitly excluding that from findings to avoid misattribution).
- No confirmed HMO/insurance integration list (which HMOs, if any, partner with Mobihealth) was found — only a generic mention of "collaborated with... insurers" with no names.
- No pricing-tier table (e.g., named plans, feature-gated tiers) was found on the marketing site itself; the only concrete price point found (N5,000/year) comes from the Airtel-channel partnership, not necessarily Mobihealth's own direct-to-consumer pricing.
- Could not confirm whether video consults happen via a proprietary video stack or a third-party SDK (e.g., Twilio, Agora, Zoom) — no technical documentation or engineering blog was found describing this.

---

## Mobile apps (App Store / Google Play — installs, ratings, reviews)

### Takeaway
Mobihealth's app presence is fragmented across at least six distinct app listings (old and new, patient and clinician, plus at least one white-label variant under a different developer name "Fluvina"), and none of the currently-live listings found in this research show a statistically meaningful public rating — the apps appear to have very low install/review counts despite the company's scale claims, which is itself a notable reputation signal.

### Cited Findings
- "Mobihealth Patient" (iOS, developer: Mobihealth International, ID 6754172339): Apple App Store shows "This app hasn't received enough ratings or reviews to display an overview" — [Apple App Store](https://apps.apple.com/us/app/mobihealth-patient/id6754172339)
- "Mobihealth Patient" app is listed as Free, category Medical, size 142.3 MB, age rating 16+, requires iOS 13.0+ — [Apple App Store](https://apps.apple.com/us/app/mobihealth-patient/id6754172339)
- A third-party app-analytics aggregator (MWM) reports the Mobihealth Patient app at "1.0/5 with 100+ downloads" — [MWM](https://mwm.ai/apps/mobihealth-patient/6754172339) — this is a low-confidence third-party estimate, not an Apple-confirmed rating (Apple's own page shows no published rating), so treat as directionally suggestive only, not a verified figure.
- A separate, older app, "Mobihealth Consult" (iOS ID 1448483577, Android package `com.mobihealthinternational.app`), exists and is described in search-indexed content as connecting users to "over 100k medical experts" — [Apple App Store](https://apps.apple.com/in/app/mobihealth-consult/id1448483577)
- One user review surfaced for the older "Mobihealth Consult" app (via search synthesis, exact platform/date not confirmed): "It's so amazing. Whenever I get ill, i just open the app to talk to a doctor and I follow their instructions in bettering my health. So coool!!! I recommend it for anyone." — [search-engine synthesis, primary source page not independently loaded]
- A distinct "Mobihealth Doctor" clinician-facing app exists on iOS (ID 6754277089) and Android (package `com.mobihealth.doctor.v3`) — [Apple App Store](https://apps.apple.com/gb/app/mobihealth-doctor/id6754277089)
- Additional, apparently white-labeled/related Android apps were found under a different publisher name, "Fluvina": "Chronico - MobiHealth" (`com.fluvina.mobihealthuser`), "MobiHealth Reception" (`fluvina.com.mobireceptionist`), and "Clini App by MobiHealth" (`com.fluvina.mobihealth`) — [Google Play search results](https://play.google.com/store/apps/details?id=com.fluvina.mobihealthuser&hl=en_US)

### Inferences
- The lack of any visible rating on the two newest, actively-marketed apps (Patient and Doctor) — despite the company's public claims of large scale (100,000+ experts, N1bn raise, Airtel distribution to "millions of Nigerians") — suggests either very recent app relaunches (new bundle IDs replacing an older app) or genuinely low organic mobile-app adoption relative to the marketing narrative. This gap between marketing scale-claims and app-store adoption evidence is worth flagging explicitly in the comparative report.
- The presence of a separately-branded "Fluvina" family of apps referencing MobiHealth suggests Mobihealth may license or white-label a platform built by/with a company or product called "Fluvina" — this was not confirmed via any official source and should be treated as a lead for further investigation, not a fact.

### Gaps
- Could not directly load the Google Play Store listings (fetch attempts failed with tool errors/HTTP 403) for "Mobihealth Patient," "Mobihealth Consult," or "Mobihealth Doctor" on Android — so Android install counts, star ratings, and review text could not be captured in this session. This is a meaningful gap; a manual browser visit to Google Play is recommended before finalizing the report.
- Could not retrieve a representative sample of negative/critical reviews for any Mobihealth app — none were found with enough specificity (no recurring complaint themes could be extracted). Explicitly note as "not found" rather than inferring complaint patterns.
- Could not confirm current download/install-count bracket (e.g., "1,000+", "10,000+") for any Android listing.

---

## Tech/backend signals (stack fingerprints, hosting, job postings, engineering presence)

### Takeaway
Direct technical fingerprinting of the production marketing site was not achievable in this session (page-source/header inspection tools were not used; only WebFetch, which does not expose raw headers or JS bundle signatures), but one job posting confirms a JavaScript/TypeScript + React/Next.js web stack, and the existence of a `mobihealth.vercel.app` mirror is a strong independent signal the company uses (or has used) Vercel for at least one deployment, consistent with a Next.js/React front end.

### Cited Findings
- A "Freelance Full-Stack Developer at Mobihealth International" role (sourced via Freshtalent Africa job board, full posting could not be loaded — 404 on direct fetch) is summarized in search results as requiring "proficiency in JavaScript/TypeScript, React/Next.js or similar," plus "back-end technologies, databases, APIs, and Git" — [search synthesis of job posting](https://jobs.freshtalent.africa/jobs/freelance-full-stack-developer-at-mobihealth-international-d59d9db1)
- A working mirror/alternate deployment of the marketing site is hosted at a `vercel.app` subdomain (`mobihealth.vercel.app`), which loaded successfully when the canonical domain did not — consistent with (though not proof of) a Next.js/Vercel-based front end — [mobihealth.vercel.app](https://mobihealth.vercel.app/)
- Current open roles skew non-engineering: search results for careers listed "Laboratory Technician / Scientist," "Videographer & Video Editor," and "Sales & Marketing Representative" positions in Lagos/Abuja, alongside the one full-stack developer role — [MyJobMag/Jobzilla via search synthesis](https://www.myjobmag.com/jobs-at/mobihealth-international)
- Company size on LinkedIn is listed as 11-50 employees, headquartered in London, W1S 4JL, GB — [LinkedIn](https://uk.linkedin.com/company/mobihealthinternational)

### Inferences
- An 11-50-person company (per LinkedIn) with mostly non-engineering current job postings and at least one *freelance* (not full-time) developer role suggests a lean, possibly outsourced/contractor-dependent engineering function relative to the scale of its public claims (100k+ experts, N1bn raise, pan-African expansion plans) — worth noting as a scale/credibility contrast point for the comparative report.
- No public engineering blog, API/developer docs, or GitHub org was found in any search — suggesting Mobihealth does not currently invest in public technical thought-leadership or a developer ecosystem, unlike some larger health-tech platforms.

### Gaps
- Could not directly view page source/HTTP response headers of the live production site (mobihealthinternational.com) to fingerprint framework, CDN, or analytics tags — the canonical domain returned 404 on the specific paths fetched in this session; a manual browser-based inspection is recommended to confirm.
- No GitHub organization or public repositories were found for Mobihealth International — treat as "not found," not as confirmed absence, since a targeted GitHub search was not run in this session.
- No confirmed cloud provider, hosting details for the app-facing domain (app.mobihealthinternational.com), or backend architecture details were found.
- Could not load the full text of the Freshtalent full-stack developer job posting (fetch returned 404), so only the search-engine's summary of required skills could be captured — the original posting may contain more specific stack details (e.g., named cloud provider, database) not reflected here.

---

## Business/network signals (funding, partners, press, social, founders)

### Takeaway
Mobihealth International is a well-funded, well-connected, decade-old (founded 2017) Nigerian-British telemedicine company led by founder/CEO Dr. Funmi Adewara, with a track record of high-profile institutional backing (USTDA, Afreximbank, SCM Capital/United Capital, Airtel Nigeria, reportedly the Nigerian Air Force) and an ambitious multi-country African expansion agenda — making it a larger, more capital-and-partnership-heavy competitor than a typical Nigerian healthtech startup.

### Cited Findings
- Founded 2017 by Dr. Funmi Adewara, described as a Nigerian-British medical doctor who worked 15 years in the UK's NHS before founding the company — [search synthesis, multiple corroborating sources including CNN and Techpoint Africa](https://www.cnn.com/world/africa/mobihealth-africa-telemedicine-intl-cmd)
- February 2026: raised a N1 billion equity investment from SCM Capital "to strengthen telehealth platforms, expand solar- and satellite-powered telehealth clinics nationwide, deploy AI-enabled healthcare services... and support geographic expansion in underserved communities" — [Businessday NG](https://businessday.ng/health/article/mobihealth-raises-n1bn-equity-investment-to-push-telehealth-expansion-in-nigeria/)
- CEO quote on the SCM Capital raise: the investment was "a strong validation of Mobihealth's vision to democratise access to quality healthcare through innovative technology." — [Businessday NG](https://businessday.ng/health/article/mobihealth-raises-n1bn-equity-investment-to-push-telehealth-expansion-in-nigeria/)
- SCM Capital characterized Mobihealth as "the type of innovative, impact-driven healthcare company that is critical to the future of healthcare delivery in Nigeria." — [Businessday NG](https://businessday.ng/health/article/mobihealth-raises-n1bn-equity-investment-to-push-telehealth-expansion-in-nigeria/)
- United Capital's Gbadebo Adenrele on structuring the raise: "We worked closely with Mobihealth to structure and execute a funding solution that supports the company's expansion strategy." — [Businessday NG](https://businessday.ng/health/article/mobihealth-raises-n1bn-equity-investment-to-push-telehealth-expansion-in-nigeria/)
- 2022: received a US$1 million grant/feasibility-study award from the U.S. Trade and Development Agency (USTDA) to study expansion of telehealth services from Nigeria into Côte d'Ivoire, Ghana, Kenya, and Egypt, targeting an additional "100,000 individuals per year across Africa" — [USTDA](https://www.ustda.gov/ustda-mobihealth-partner-on-african-telehealth-infrastructure/)
- The USTDA award materials noted Mobihealth is a women-led business and highlighted funding challenges facing African female entrepreneurs, per CEO Adewara's comments — [USTDA-related coverage via search synthesis](https://www.ustda.gov/ustda-mobihealth-partner-on-african-telehealth-infrastructure/)
- 2024: Afreximbank and MobiHealth signed a Project Preparation Facility (reported around US$1.5 million) intended to advance the project to "bankability," which is expected to unlock further investment "estimated at US$65 million" — [Afreximbank](https://www.afreximbank.com/afreximbank-and-mobihealth-sign-project-preparation-facility-to-drive-digital-healthcare-solutions-across-africa/)
- March 2022: Mobihealth featured in a virtual boardroom session tied to efforts to raise $67 million to finance an "integrated, proprietary telemedicine platform" strategy — [search synthesis, DAWN Commission profile of CEO](https://dawncommission.org/dr-funmi-adewara-building-mobihealth-a-67m-telemedicine-empire-to-save-lives-across-africa/)
- Separately, a $1,000,000 seed funding close is referenced (as of a September 2024 data point) — [leadsontrees.com via search synthesis](https://www.leadsontrees.com/news/mobihealth-international-secures-1-million-in-seed-funding-to-revolutionize-global-healthcare-delivery) — note this figure could reflect the same USTDA/seed capital already cited above rather than a separate distinct round; the research could not fully disambiguate whether these are the same $1M or different raises, so flag as a possible duplicate-counting risk in the funding history.
- Nov 2024/Mar 2025: partnership with Airtel Nigeria embeds Mobihealth's telemedicine services directly inside the Airtel app for Airtel subscribers, described as bringing "instant telemedicine services to millions of Nigerians" — [Vanguard News](https://www.vanguardngr.com/2025/03/mobihealth-and-airtel-partner-to-bring-instant-telemedicine-services-to-millions-of-nigerians/)
- June 2020: Mobihealth won the "AfricaTech Healthcare Challenge," organized by Sanofi in Paris — [Nairametrics](https://nairametrics.com/2020/06/14/nigerian-mobihealth-wins-africatech-healthcare-challenge/)
- Partnership with Union Bank of Nigeria was announced (details of scope not captured in this session; only the existence of the partnership announcement was found) — [Union Bank of Nigeria newsroom](https://www.unionbankng.com/in-the-news/union-bank-and-mobihealth-international-announce-partnership/)
- LinkedIn company profile: Industry "Hospitals and Health Care," 11-50 employees, headquartered in London (W1S 4JL, GB), founded 2017, 3,146 followers — [LinkedIn](https://uk.linkedin.com/company/mobihealthinternational)
- LinkedIn specialties listed: "Medicine, Surgery, Paediatrics, O&G, Telemedicine, Laboratories, Radiology, General Surgery, All Specialties of Medicine, Pharmaceuticals, Hospitals, Corporations, and NGOs" — [LinkedIn](https://uk.linkedin.com/company/mobihealthinternational)
- CNN profiled the company under the headline "How Mobihealth is driving a telemedicine revolution in Africa" (full article text could not be retrieved — CNN blocked the fetch tool with an HTTP 451 "Unavailable for Legal Reasons" response in this session, likely a geo/consent-wall issue rather than a takedown) — [CNN, title only confirmed](https://www.cnn.com/world/africa/mobihealth-africa-telemedicine-intl-cmd)
- Additional referenced institutional relationship: the company "has collaborated with governments and insurers, including work with the Nigerian Air Force" (source: Techpoint Africa, via search synthesis; the primary article was not independently loaded, so treat as secondary-sourced) — [Techpoint Africa](https://techpoint.africa/insight/9-affordable-telemedicine-startups-nigeria/)

### Inferences
- Mobihealth's funding and partnership pattern (development-finance grants, an equity raise structured by a Nigerian investment bank, a telco distribution deal, and pursuit of a large infrastructure-style facility via Afreximbank) marks it as pursuing a capital-intensive, infrastructure-plus-telehealth model — closer to a national telehealth-infrastructure operator than a lean consumer app startup. This is a materially different strategic posture from Tarragon Health's app/web-first, no-owned-infrastructure model.
- The multiple, possibly-overlapping funding figures ($1M grant, $1M seed close, $1.5M facility, $67M fundraising target, N1bn/~$650k-$700k equity raise depending on FX rate at time of raise) suggest a company that discloses funding activity frequently and in a fragmented way across press releases — the report writer should present these as a timeline of distinct announced events rather than summing them into one "total raised" figure, since this research could not fully confirm which are distinct capital events versus restatements of the same money.

### Gaps
- Could not find TechCabal- or Disrupt Africa-specific original reporting on Mobihealth in this session (searches surfaced TechCabal's general African-tech-funding commentary and Nairametrics articles, but no dedicated Disrupt Africa piece) — explicitly note as not found rather than assumed absent.
- Could not confirm current follower counts or engagement levels on X/Twitter, Instagram, or Facebook (an Instagram hiring post and a Facebook page "Mobihealth Consult | Lagos" were found to exist, but follower counts/engagement metrics were not captured) — [Facebook](https://www.facebook.com/MyMobihealth/), [Instagram](https://www.instagram.com/p/DTgc9YyCEhO/)
- Could not verify the Nigerian Air Force collaboration directly from a primary source — flagged above as secondary-sourced only.
- No Crunchbase data could be retrieved (fetch returned HTTP 403), so a structured funding-round table (round names, exact dates, lead investors) could not be independently confirmed beyond the press-release-level detail above.

---

## Reviews/reputation (Trustpilot, Google Reviews, forums, red flags)

### Takeaway
No dedicated Trustpilot or Google Reviews presence for Mobihealth International itself could be found (a Trustpilot search surfaced only unrelated companies with similar names, e.g., "Mobidoctor" and "Mobilae"), and no Nairaland or Reddit discussion threads specifically about the company were found — this is itself worth reporting as a notable gap in independent public reputation signal, in contrast to the company's heavy institutional/press profile.

### Cited Findings
- A Trustpilot search for "Mobihealth International" did not return a Trustpilot profile for the company; results instead surfaced unrelated, similarly-named companies ("Mobidoctor.eu," a European telemedicine service, and "Mobilae.nl," unrelated) — [Trustpilot search results](https://www.trustpilot.com/review/mobidoctor.eu)
- A Nairaland-specific search returned no threads discussing Mobihealth; results were general company-background sources rather than forum discussion — [search results, no Nairaland thread found]
- No Reddit threads about Mobihealth International were surfaced by any search run in this session.
- The one positive Apple App Store/consult-app review found (see Mobile Apps section) is the only direct end-user sentiment captured in this session: "It's so amazing... I recommend it for anyone." — [search synthesis, primary source not independently loaded]
- A Glassdoor company page exists ("Working at Mobihealth International") but could not be loaded (HTTP 403), so employee-reported ratings/pros/cons could not be captured — [Glassdoor](https://www.glassdoor.com/Overview/Working-at-Mobihealth-International-EI_IE1919569.11,35.htm)

### Inferences
- The near-total absence of independent consumer review-platform presence (no Trustpilot, no confirmed Google Reviews, negligible app-store ratings, no forum chatter found) despite years of major press coverage and institutional funding suggests a company whose public narrative is driven primarily by press releases, award announcements, and partnership PR rather than by a large, vocal, reviewed consumer user base — a meaningful reputation contrast to flag in the comparative report (i.e., strong "top-down"/institutional credibility signals, weak "bottom-up"/consumer-review credibility signals).

### Gaps
- Not found: any Trustpilot company profile for Mobihealth International.
- Not found: any Google Maps/Google Reviews listing for Mobihealth clinics or offices.
- Not found: Nairaland or Reddit discussion threads.
- Not found: Glassdoor employee rating/review content (page exists but blocked the fetch tool with HTTP 403 in this session — a manual visit is recommended).
- Not found: any specific recurring complaint themes from real users (the research could not surface a negative-review sample large enough to identify patterns) — explicitly note this as "no reliable negative-sentiment sample found," not as evidence the product has no complaints.

---

## Session notes for the report writer
- Several canonical URLs on mobihealthinternational.com (homepage root, `/diaspora`, `/about-us-2/`) returned HTTP 404 to the automated fetch tool used in this session, while a `vercel.app` mirror and search-engine-indexed snapshots of the same domain returned content. This is very likely a bot-blocking/redirect quirk of the fetch tool rather than the pages being gone (search engines have clearly crawled them), but the report writer should treat page-structure claims sourced from the mirror/search-synthesis as "recovered, not live-verified" and ideally spot-check with a real browser before publishing exact copy.
- Google Play Store listings could not be loaded at all in this session (tool errors / HTTP 403 on every attempt) — Android-side install counts and review text are a genuine, not-yet-closed gap; recommend a manual browser pass specifically at play.google.com for: `com.mobihealth.patient.v3`, `com.mobihealth.doctor.v3`, and `com.mobihealthinternational.app`.
- CNN's profile piece and Crunchbase's funding page both exist and are clearly relevant (title/existence confirmed) but could not be read in this session (HTTP 451 and HTTP 403 respectively) — both are worth a manual look if time allows, as they likely contain additional scale statistics (patient counts, consult volumes) not captured elsewhere.
