# S40 competitor review: Mobihealth International

Reviewed 2026-10-06 from public pages only (browser pane, curl, WebSearch). No sign-up, no forms. The authenticated app (apps.mobihealthinternational.com), the Play listing and the doctor-side app were NOT inspected (UNVERIFIED). Desk context: reports/Nigeria healthtech competitor analysis.md.

## Snapshot
- Global telemedicine plus physical "telehealth clinic" infrastructure. Four audiences: B2C, B2B, B2G, SaaS/white-label. Offices in Lagos, Abuja, London, Kigali.
- Marketing claims seen live: "88K+ users globally", "20k+ healthcare professionals", "3+ countries", 24/7. The earlier desk note cites "100,000+ experts"; the live site now says 20k+. Claims drift between sources.
- Airtel bundle: app live on Airtel network since March 2026 per trade press; reported from N5,000/year, with one report of N2,500-5,000 for individual/couple/family-of-four plans (press, UNVERIFIED on the site itself; the homepage shows no price).
- Funding per desk research: N1bn SCM Capital, $1M USTDA, $1.5M Afreximbank (not re-verified here).

## Design
Strengths
- Clear persona routing on the home page: Patients, Health Practitioners, Organisations, Pharmacies, each with its own call to action. Mega-menu groups Who We Serve (Family, Government and NGOs, Corporate, Healthcare Systems), What We Offer, About, Resources.
- Plain benefit-first hero ("anytime anywhere"), concrete FAQ with numbered booking steps, explicit non-emergency disclaimer in the FAQ.
- Eligibility hook ("Your healthcare may already be covered", HMO check) is a smart conversion device.
- Consistent blue brand, Ionicons set, doctor-card mock with "consultation begins in 30 minutes".
- Mobile at 390px: no horizontal overflow (scrollWidth 390), viewport meta correct, hamburger nav.

Weaknesses
- Cookie banner takes about 45% of the mobile viewport on first load and covers the hero CTAs; reject/accept buttons are stacked and large but the banner is not dismissible without a choice.
- Hero text on the teleconsultation page is low-contrast grey on pale grey (visual judgement, no contrast tool run).
- 25 of 51 images on the home page have no alt text. 23 interactive elements under 32px at 390px.
- Stat counter rendered "0K+" in the text capture (animated counter; content invisible to non-JS readers and crawlers).
- Trust surface is thin: one first-name testimonial, "No 1 trusted healthcare" superlative, no named regulator licence, no doctor registration numbers, no named hospital or lab on the home page. Partner logos present but not named in text.
- B2B pages (healthcare-integration) are thin: four value bullets, no pricing, no API docs, no case study, no security or certification detail. The B2C and B2B voices share one nav, so a patient sees "Government and NGOs" and "Donate" next to "Get Started".
- Fragmented identity: the old site mentions a discount code "MHI2022", and the FAQ mixes "Client" registration with newer "Patients" language.
- Languages: English only on the site (html lang="en"; no hreflang). Pidgin or Yoruba/Hausa/Igbo: not seen.

## Functionality (feature inventory)
| Area | What is documented publicly | Status |
|---|---|---|
| Teleconsultation | Video, phone or chat; book a slot then "Join Call"; 24/7; reschedule up to 24h before; fees may apply for missed slots | Documented, not exercised |
| Specialist access | "International medical experts", e.g. a neurologist card; no referral pathway or SLA described | UNVERIFIED depth |
| e-Pharmacy | E-prescriptions sent to pharmacies, doorstep delivery | Documented |
| Lab diagnosis | Orders go to diagnostic centres; follow-up consult needed to read results; extra tests paid out of pocket | Documented |
| EMR | Patient records "in one place"; EMR as a sold service to providers | Documented, no detail |
| Weight loss programme | "Personalised plan" page, no clinical protocol shown | Marketing only |
| Chronic care | Not a named product. Hypertension/diabetes not on the nav; "disease management" appears only as a benefit line | Gap vs Tarragon |
| Home visits, physio, nursing | Mentioned in the FAQ | Documented, no detail |
| Clinics/kiosks | Solar and satellite telehealth clinics: on-site health assistant takes vitals, remote doctor consults, digital prescription. Mobile units. Public pages show a model, not a clinic count or locations | Count UNVERIFIED |
| Remote patient monitoring | Listed as a Healthcare Systems value; no device or alert mechanism described | Marketing only |
| White-label SaaS | "Onboard your team", "Healthcare Systems" page; a white-labelled sibling app was noted by desk research | Pricing/API UNVERIFIED |
| Airtel | Embedded in Airtel app; subscription via telco | Press only |
| Premium membership | FAQ describes upgrade, choose preferred provider, cancel anytime; tiers and price not published | Price UNVERIFIED |
| Donations/impact | "One Dollar, One Life", "Project 1000 Hope Clinics" donate flow | Documented |
| Doctor-side | /doctors "Join our network"; separate doctor app per desk research | UNVERIFIED |
| Support | 24/7 phone, email, live chat in-app (claimed) | Claimed |

## Code and performance
- Stack: Vite-built React single-page app (hashed /assets/index-*.js, empty `<div id="root">`), hosted as static files on S3 behind CloudFront. Routing and SEO tags are set client-side by an SEO component.
- Page weight (home, desktop, cold): 76 requests, about 20 MB transferred, DOMContentLoaded about 0.5s, load about 1.8s on this connection. Largest assets are unoptimised PNGs (2.5 MB, 2.4 MB, 1.7 MB, 1.5 MB). Main JS bundle is 1.76 MB uncompressed with no code splitting evident.
- Vendors seen: Google Tag Manager/Ads (AW-16638673597) with DoubleClick calls, Google Fonts, unpkg.com (Ionicons loaded from a public CDN at runtime), Axios, Paystack, Zoom and Agora strings in the bundle (video stack appears to include Zoom and/or Agora, UNVERIFIED which is live). No Sentry, no chat vendor strings found in the main bundle.
- Ads tracking fires on load; the cookie banner appears at the same time. Whether tags wait for consent: UNVERIFIED.
- Security headers: the S3/CloudFront responses showed no HSTS, CSP, X-Frame-Options, X-Content-Type-Options or Referrer-Policy.
- Real defect: the apex and www URLs return HTTP 404 (S3 NoSuchKey for /index.html) to a non-browser fetch, while a browser renders the page via an SPA fallback. WebFetch also received 404. Crawlers that honour status codes may treat the home page as an error. UNVERIFIED how Googlebot is served.
- SEO: static title and meta description are generic and the canonical stayed at "/" on a sub-route until JS updated it. No JSON-LD (0 blocks). robots.txt exists and allows indexing; sitemap.xml returned 200. Rich keyword meta tag and "revisit-after" are obsolete.
- App listings: homepage links one Android listing (com.mobihealth.patient.v3) and an App Store link; desk research counts 6+ fragmented listings (patient, doctor, older "Consult", white-label). Ratings not verifiable here (Play page did not render via fetch).

## Safety or regulatory concerns
- "No 1 trusted healthcare", "75% cost savings", "more than 80% of medical problems can be resolved through telehealth": unsourced superlatives. Tarragon should not mirror these.
- Emergency line is only in the FAQ. No visible red-flag triage, no emergency number on the booking path in public pages.
- No public clinical governance (protocol sign-off, escalation timing, clinician verification IDs) and no MDCN registration display seen. Privacy claim "comply with healthcare privacy laws" does not name NDPA or NDPC registration.
- Doctor/patient pairing across jurisdictions (UK/global specialists to Nigerian patients): licensure basis for prescribing is not stated publicly. UNVERIFIED.
- Free-consult discount-code mechanism and HMO eligibility are consumer-friendly but pricing opacity limits comparison.
- Kiosk and mobile-unit diagnostics described as "AI-powered point of care" with no validation or device regulation detail.

## What Tarragon should adapt (originally)
- A persona-routed home page that sends a patient, doctor, employer and pharmacy to distinct entry points, but with B2B surfaces kept off the patient's first screen.
- An eligibility check up front ("is this already covered?") framed around Tarragon's own coverage model, not copied wording.
- Telco or partner distribution as a channel to scope: a light, optional bundle entry that still lands in the same free app, so no feature depends on the partner.
- Last-mile assisted-visit idea (a trained facilitator captures vitals, remote doctor reviews) as a possible partner-pharmacy or lab-site pilot for hypertension and diabetes check-ins, with Tarragon's escalation rules intact.
- Numbered, plain-language booking FAQ and an explicit non-emergency statement placed where the user actually books, not only in the FAQ.

## What Tarragon should avoid
- Unaudited headline numbers and "No 1" claims; keep claims tied to mechanism and verifiable records.
- A client-rendered shell with HTTP 404 on the home route, 20 MB pages, uncompressed PNG heroes, no security headers and no structured data. Tarragon's server-rendered pages should keep Organization, MedicalOrganization and FAQ JSON-LD, HSTS and a CSP.
- Loading marketing and ad tags before consent, and a cookie banner that blocks half a phone screen.
- Mixing donation, government, B2B SaaS and consumer sign-up in one flat nav; also avoid publishing no price at all for the thing patients buy.
- Fragmented app listings under several names; keep one store identity per audience.
- Treating chronic disease as a footnote: Mobihealth leads with episodic consults and a weight-loss plan, so Tarragon's condition pathways and doctor-signed protocols remain the differentiator to make visible.
- Relying on global or foreign specialist access as a trust claim without stating licensure and escalation accountability.
