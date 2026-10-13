# Competitor review: Nigeria / Africa digital health (October 2026)

Method and honesty note. This review was built from public web search results and a few page fetches on 2026-10-06. Most evidence is secondary (press, funder pages, job boards, CB Insights/MIT Solve profiles), not first-hand product use. No app was installed, no screenshot was inspected, no private code was seen. "Not verified" means exactly that. Vendor-reported outcomes (percent improvements, member counts) are marketing claims, not audited results. Nothing here is copied from competitors; entries are paraphrased. Re-verify any row before using it in a decision, deck, or clinical claim.

Coverage gaps up front:
- Duredoc: no search result found for this name (results returned MyDokita, Tremendoc, Doc-on-Call247, Hudibia instead). Not verified, may be misspelled or too new.
- Avura Cares and WellNation: search returned nothing specific. Not verified.
- Ada Health: found only as a generic symptom-assessment vendor, no Nigeria-specific evidence. Afya/Zuri: only Zuri Health found.
- Jumia/Hellomum: not researched (low relevance).
- Design/UX lens: app-store listings and screenshots were NOT opened. UX claims below are inferred from vendor descriptions and are low confidence.
- Code/tech lens: public evidence is limited to job posts, press and vendor claims. No GitHub org was confirmed for any product.

---

## 1. Helium Health (EMR/HMIS, payer and credit tools)

| Lens | Finding |
|---|---|
| Functionality | HeliumOS: EMR/HMIS covering registration, clinical notes, lab orders, pharmacy, billing, reporting; practice management; HeliumCredit (financing for providers); analytics for payers/governments. Reported 500+ facilities, 800K+ enrolled patients, about 80% in Nigeria, plus Ghana, Kenya, Senegal and others; about $42M raised (secondary sources, 2026). |
| Design/UX | Described as offline-first with a simple, social-media-like interface built for intermittent connectivity and mixed digital literacy. Not verified first-hand. |
| Code/tech | Job posts show Node.js/TypeScript backend, React and Vue frontend, Postgres/MySQL/MongoDB/Redis, AWS, Docker. A third-party summary claims HL7 FHIR plus REST and GraphQL APIs; no public API docs or GitHub confirmed. |
| Strengths | Provider-side distribution; interoperability stance (FHIR/HL7); offline-first design discipline; financing wedge. |
| Weaknesses | B2B provider tool, little patient-facing chronic care loop evidence; public API docs not found. |
| Unsafe/unsuitable for Nigeria | Nothing unsafe found. Caution: a provider-side EMR as the data source means patient record access depends on facility adoption. |
| Evidence | https://techcabal.com/2020/08/13/the-backend-helium-health/ ; https://www.promptloop.com/directory/what-does-helium-health-do ; https://techpoint.africa/news/helium-health-30m-seriesb/ ; https://www.myjobmag.com/job/senior-backend-engineer-nodejs-helium-health-1 ; https://kolonell.com/en/blog/helium-health-emr-africa-2026-en |

## 2. WellaHealth (embedded micro-insurance, pharmacy network, ZOI-Embed)

| Lens | Finding |
|---|---|
| Functionality | B2B2C. Plug-in module lets partners (reported: PalmPay, MTN, Airtel) offer consultations, pharmacy access, lab orders, micro-insurance inside their own apps. Pricing reported as very low: from about USD 1/month; a NGN 750 plan giving medication value up to NGN 6,000/month at about 3,000 partner pharmacies. Pharmacy point-of-care testing for common illnesses. Chronic care and pharmacy/provider solutions listed. |
| Design/UX | Distribution through apps people already use (super-app style). Own-app UX not verified. |
| Code/tech | Integration via API claimed deployable in under 48 hours. No public docs or repos found. |
| Strengths | Distribution through partners; pharmacy as the physical touchpoint; extremely low entry price. |
| Weaknesses | Brand and care relationship sit with the partner app; likely thin longitudinal chronic care (not verified). |
| Unsafe/unsuitable | Pharmacy point-of-care "diagnosis" for malaria/infections at scale raises quality-control questions (not verified how governed). Low-price insurance-like products raise NAICOM/NHIA regulatory questions for a non-insurer. |
| Evidence | https://techpoint.africa/?p=342247 ; https://bfaglobal.com/catalyst-fund/insights/wellahealth-microinsurance-innovations-deliver-significant-benefit-nigerians/ ; https://www.swissre.com/foundation/e4ra-21-wellahealth.html ; https://intuitionlabs.ai/companies/digital-health/wellahealth |

## 3. Reliance Health (HMO + app, Alafia plans)

| Lens | Finding |
|---|---|
| Functionality | HMO with app: chat with a doctor, find providers, manage prescription delivery; 2,700-3,800 provider network (varies by source). Plans reported from about NGN 3,500 to NGN 148,500 with monthly/quarterly/annual options. Alafia plans for parents (diaspora can buy for relatives, NGN or USD): cover pre-existing diabetes and hypertension, free drug delivery, claims reimbursement within 5 business days (vendor claim), two tiers. Piloted Platos Health virtual diabetes programme for enrollees. |
| Design/UX | Not verified. Phone-call purchase path plus web suggests omnichannel sales. |
| Code/tech | Not found. |
| Strengths | Diaspora-buys-for-parents framing; chronic drug delivery bundled; payer data to evaluate outcomes. |
| Weaknesses | Insurance economics tie growth to hospital network quality and claims friction (general sector issue). |
| Unsafe/unsuitable | HMO model is a different regulated business than Tarragon's membership; do not imitate insurance-style coverage claims. |
| Evidence | https://getreliancehealth.com/alafia/ ; https://techcrunch.com/2022/02/07/nigerian-healthtech-startup-reliance-health-raises-40m-led-by-general-atlantic ; https://www.brandtimes.com.ng/?p=27581 ; https://techeconomy.ng/?p=142137 |

## 4. Platos Health (virtual chronic care, diabetes; relevant peer)

| Lens | Finding |
|---|---|
| Functionality | Virtual platform for preventive and chronic disease management. Reported Reliance pilot: about 12% mean fasting glucose reduction and about 15% lower insulin dose over 12 weeks, estimated savings over NGN 88,000 (small pilot, vendor/partner-reported). Raised about $1.4M in 2025. |
| Design/UX, Code/tech | Not verified. |
| Strengths | Payer-validated 12-week outcome framing, very close to Tarragon's 12-week programme shape. |
| Weaknesses | Tiny sample; self-reported by partners. |
| Unsafe/unsuitable | Insulin dose changes through a virtual programme need clear clinician ownership; treat savings numbers as unverified. |
| Evidence | https://www.brandtimes.com.ng/?p=27581 ; https://launchbaseafrica.com/2025/05/07/nigerias-platos-health-raises-1-4m-to-scale-preventive-health-platform-amid-rising-chronic-disease-burden/ |

## 5. Healthtracka (at-home lab testing)

| Lens | Finding |
|---|---|
| Functionality | Book tests on web, phlebotomist home/office sample collection, results by email in 24-48 hours after collection; partner labs reported as vCare Diagnostics, Lancet, Afriglobal. Average test about NGN 15,000 (2022). Panels: full-body checkups, cancer and STD screening, fertility. Founded 2021, $1.5M pre-seed (2022). |
| Design/UX | Web-first booking; results by email (not verified for current app). |
| Code/tech | Not found. |
| Strengths | Clear single-purpose flow; named partner labs; home collection. |
| Weaknesses | Results by email only (2022 description) means no longitudinal record or clinician follow-up evident. |
| Unsafe/unsuitable | Results delivered with no clinician interpretation is the gap Tarragon's abnormal-result escalation fills. Emailing results is a privacy weak point. |
| Evidence | https://techcabal.com/2022/06/21/nigerian-healthtracka-raises-1-5-million-to-expand-medical-diagnostics/ ; https://techpoint.africa/feature/healthtracka-digital-diagnostics/ ; https://techcrunch.com/2022/06/21/nigerian-at-home-lab-testing-platform-healthtracka-gets-1-5m-backed-by-female-vcs/embed |

## 6. mPharma / Mutti (pharmacy network + membership)

| Lens | Finding |
|---|---|
| Functionality | Mutti pharmacies as mini primary-care points; membership grew from under 10,000 (2019) to over 400,000 (end 2024, company-reported). "Keep My Price" caps chronic-drug prices for members. mutti+ (April 2023, Nigeria): reported free primary consultations, free lab tests and 150 medications for under NGN 1,000/month, covering malaria, diabetes, hypertension and others. Heal-now-pay-later, free screenings. mymutti Android app with online pharmacy, Ghana and Nigeria. Acquired majority of HealthPlus (Nigeria, 2022). |
| Design/UX | Android-first app; not verified beyond press release. |
| Code/tech | Supply-chain data platform heritage (vendor-managed inventory); no public repos found in this pass. |
| Strengths | Price certainty for chronic medicines; membership loyalty loop; physical presence; reports of no stockouts (company-reported). |
| Weaknesses | Retail-led; clinical depth varies by outlet (not verified). |
| Unsafe/unsuitable | Sub-NGN 1,000 bundles are subsidised by pharmacy margin, so copying the price is unsafe for a doctor-time business. |
| Evidence | https://mpharma.com/2023/04/06/revolutionizing-healthcare-access-in-africa-mpharma-launches-mutti-health-subscription-plan-across-partner-pharmacies-in-nigeria/ ; https://mpharma.com/2023/07/06/press-release-mpharma-releases-mymutti-mobile-app-v2-the-ultimate-health-companion-at-your-fingertips/ ; https://gna.org.gh/2025/11/gip-ghana-partners-with-mpharma-to-expand-access-to-affordable-healthcare-across-west-africa/ |

## 7. Mobihealth International (telehealth, clinics, RPM)

| Lens | Finding |
|---|---|
| Functionality | Mobihealth Consult app: quick online appointments, video consultation, mobile clinics, telehealth cabins/solar-and-satellite clinics for remote areas, remote patient monitoring, digital diagnostics, EMR integration. Airtel distribution deal. Reported N1bn equity from SCM Capital. "Mere" could not be linked to Mobihealth; not verified. |
| Design/UX, Code/tech | Not verified. |
| Strengths | Telco distribution; physical telehealth cabins for connectivity gaps; hardware-assisted consults. |
| Weaknesses | Capital-heavy; app-level chronic follow-up depth not visible. |
| Unsafe/unsuitable | AI-enabled services claims not evidenced; do not borrow claims without sourcing. |
| Evidence | https://businessday.ng/health/article/mobihealth-raises-n1bn-equity-investment-to-push-telehealth-expansion-in-nigeria/ ; https://guardian.ng/news/mobihealth-offers-telehealth-to-nigerians-africans-through-app-on-airtel-network/ ; https://techpoint.africa/insight/9-affordable-telemedicine-startups-nigeria/ |

## 8. mDoc (CompleteHealth chronic care, health coaches, USSD)

| Lens | Finding |
|---|---|
| Functionality | Chronic care for diabetes, hypertension, cancer and others. Human health coaches plus AI-driven behavioural nudges and community support; omnichannel including USSD for basic phones. Reported 100,000+ members, mostly women and low-income; reported 84% improved condition management and 60%+ improved BP or glucose in a pilot (self-reported, not audited). Partners listed: Roche, Gates Foundation, WHO, USAID, GIZ. Hiring health coaches. |
| Design/UX | Works without constant internet (USSD); coach-led nudges. App UX not verified. |
| Code/tech | No public repos found. |
| Strengths | Closest model to Tarragon's chronic wedge; low-bandwidth path; human coach layer; donor/pharma partner validation. |
| Weaknesses | Donor-funded reach with a thin consumer-paid model (not verified); coach scaling cost. |
| Unsafe/unsuitable | USSD health messaging must not carry PHI beyond minimal content; USSD sessions are unauthenticated at app level. |
| Evidence | https://solve.mit.edu/solutions/9831 ; https://aiworld.eu/story/mdoc-provides-ai-driven-disease-support-across-nigeria ; https://globalizer.ashoka.org/casestudies/nneka-mobisson ; https://nigeriahealthwatch.com/?p=51912 |

## 9. Presibo (AI workflow health platform)

| Lens | Finding |
|---|---|
| Functionality | Positions as AI healthcare workflow automation: virtual consults, AI-assisted triage, health tracking, prescriptions, care coordination; works across mobile, web, call and text; includes emergency responder location. |
| Design/UX, Code/tech | Not verified. |
| Strengths | Multichannel reach; emergency locating idea. |
| Weaknesses | Claims broad, evidence thin; early stage. |
| Unsafe/unsuitable | AI triage without published validation is unsafe to copy. |
| Evidence | https://vc4a.com/ventures/presibo ; https://www.producthunt.com/p/presibo/presibo ; https://businessday.ng/life/article/firm-launches-ai-powered-solution-to-tackle-lifestyle-diseases/ |

## 10. Duredoc, Avura Cares, WellNation, Medsaf/Lifebank

| Product | Finding |
|---|---|
| Duredoc | Not found. Not verified. |
| Avura Cares, WellNation | Not found in this pass. Not verified. |
| Medsaf | B2B pharma marketplace for pharmacies and hospitals: access, credit, inventory, logistics, quality testing of manufacturers. Relevance: counterfeit-drug risk context for any pharmacy partner network. |
| Lifebank | Blood, oxygen and supply marketplace and logistics with a cool chain; relevance is logistics partnership for emergencies, not patient app design. |
| Evidence | https://www.wamda.com/en/memakersge/2018/08/tragedy-spurs-nigerian-entrepreneur-combat-scourge-fake-medicines ; https://qz.com/africa/1192712/nigerian-blood-delivery-startup-lifebank-funded-by-echo-vc-co-creation-hubs-growth-capital/ ; https://www.cbinsights.com/compare/lifebank-vs-medsaf |

## 11. Zuri Health (Kenya, pan-Africa incl. Nigeria)

| Lens | Finding |
|---|---|
| Functionality | App, SMS and WhatsApp access to doctors, medication, lab booking, home visits, health plans; reported 16+ mobile network partnerships, 400,000+ SMS subscribers, 300+ doctors, 27 labs, 15 pharmacies across seven or more countries. |
| Design/UX | Channel breadth is the lesson; UX not verified. |
| Code/tech | Not found. |
| Strengths | Telco and SMS distribution. |
| Weaknesses | Breadth over depth for chronic follow-up. |
| Unsafe/unsuitable | WhatsApp-based care conflicts with Tarragon's rule (removed channel, app/web only). Do not adopt. |
| Evidence | https://citizen.digital/article/kenyan-healthtech-startup-zuri-raises-ksh151m-to-expand-across-africa-n298670 ; https://nextbillion.net/news/kenyan-e-health-startup-zuri-raises-1-3-million-pre-seed-to-expand-product-launch-in-new-markets |

## 12. Vula Mobile (South Africa, clinician referral)

| Lens | Finding |
|---|---|
| Functionality | Secure chat and referral between primary care workers and specialists; Android, iOS, Huawei and web; specialty-specific referral forms co-designed with academic hospitals; 32K+ health workers, 1.3M+ patients served (reported); reported 31% fewer unnecessary referrals and about 25 times less data than WhatsApp. |
| Design/UX | Very low-data design, replaces insecure WhatsApp/phone/letter referrals. |
| Code/tech | Not verified; Huawei build indicates Android breadth. |
| Strengths | Structured referral forms, low data, specialist routing. |
| Weaknesses | Clinician-facing only; patient experience out of scope. |
| Unsafe/unsuitable | None found. |
| Evidence | https://www.drkfoundation.org/?p=18660 ; https://www.dailymaverick.co.za/article/2020-03-17-innovative-local-app-to-help-in-covid-19-response.md ; https://digitalx.undp.org/vula-mobile_1.html |

## 13. Babyl Rwanda (national telemedicine, halted)

| Lens | Finding |
|---|---|
| Functionality | 2019 to September 2023: nurse-led triage with physician oversight, e-prescriptions, tied to national insurance; reached 450 of 510 facilities, about 2 million enrolled, 3.9M consultations; USSD and SMS for basic phones; chatbot reportedly handled about 3,000 consultations per day. Halted September 2023 for redesign. A 2026 JMIR qualitative study examines why. I could not read the full paper (fetch returned empty), so the causes are not verified here. |
| Strengths | Scale proof; USSD/SMS inclusion; agent network. |
| Weaknesses | Platform halted, which is itself the key lesson: reliance on one payer/government and volume economics (hypothesis, not confirmed). |
| Evidence | https://www.jmir.org/2026/1/e84832 ; https://www.techinafrica.com/scaling-mobile-telemedicine-lessons-from-african-startups/ |

---

## Ranked list: 15 ideas Tarragon could adapt

Confidence: High = multiple consistent sources; Medium = one credible source; Low = vendor claim or inference.

1. Run the 12-week chronic programme with a pre-registered, payer-shareable outcome report (glucose/BP change, medication use) so B2B buyers see evidence. Evidence: Platos/Reliance pilot reporting. Confidence: Medium.
2. Offer a "buy for a parent abroad" (diaspora sponsor) flow, already close to Care Voucher. Evidence: Reliance Alafia plans purchasable from abroad in NGN or USD. Confidence: High.
3. Price-lock for chronic medicines via a pharmacy partner, framed as a certainty benefit (not a discount race). Evidence: mPharma Keep My Price. Confidence: Medium.
4. Human health-coach layer with scripted nudges between doctor reviews, with escalation back to a doctor. Evidence: mDoc CompleteHealth. Confidence: Medium.
5. A low-bandwidth mode: aggressive caching, small payloads, offline queue for readings (already in progress on mobile). Evidence: Vula (25x less data than WhatsApp), Helium offline-first. Confidence: Medium.
6. Specialty-specific structured referral templates to cut unnecessary referrals and speed specialist triage. Evidence: Vula referral forms (31% fewer unnecessary referrals, reported). Confidence: Medium.
7. Embeddable API/widget so employers, fintechs or telcos can offer Tarragon inside their apps, built after core is stable. Evidence: WellaHealth ZOI-Embed (PalmPay, MTN, Airtel; under 48-hour integration claim). Confidence: Medium.
8. Home sample collection with named partner labs, result push into the longitudinal record plus clinician interpretation (do not email raw results). Evidence: Healthtracka flow and gap. Confidence: Medium.
9. Pharmacy-based screening events and free screening as membership acquisition. Evidence: mutti free screenings, WellaHealth pharmacy point-of-care. Confidence: Low-Medium.
10. FHIR/HL7 interoperability as a stated commitment so facilities and payers can exchange records. Evidence: Helium Health interoperability positioning. Confidence: Medium (Tarragon FHIR import already exists).
11. Telco/device-gap fallback: SMS reminders only (never care delivery) plus USSD refill or appointment reminders, to widen reach without WhatsApp. Evidence: mDoc USSD, Babyl USSD/SMS, Zuri SMS. Confidence: Medium.
12. Heal-now-pay-later or instalment option for programme fee via Paystack. Evidence: mutti heal-now-pay-later. Confidence: Low (vendor description only; credit risk).
13. Diversify revenue beyond one payer or government to avoid a Babyl-style stall; track unit economics per doctor-hour. Evidence: Babyl halt (cause not verified). Confidence: Low.
14. Emergency logistics partnership (blood, oxygen) as a referral destination for escalations. Evidence: Lifebank model. Confidence: Low.
15. Provider-facing quality gate for any pharmacy or lab partner (verified supply, counterfeit control) before listing. Evidence: Medsaf founding rationale on fake medicines. Confidence: Low-Medium.

## Things to avoid (from this review)

- WhatsApp as a care channel (Zuri): conflicts with Tarragon rule F-02.
- Sub-NGN 1,000 bundles and insurance-style coverage claims (mutti+, WellaHealth): subsidised or regulated differently.
- Unvalidated AI triage claims (Presibo): requires registered, governed AI per Tarragon rules.
- Emailing raw lab results (Healthtracka 2022 flow): privacy and no clinician follow-up.

## Next verification steps (not done)

1. Install mymutti, Reliance Health, Mobihealth Consult, Zuri and mDoc from the app stores and record onboarding steps and data usage.
2. Read the full Babyl JMIR paper for the real causes of the halt.
3. Confirm whether any of these firms publish GitHub orgs or API docs (Helium Health, WellaHealth ZOI-Embed).
4. Resolve Duredoc, Avura Cares, WellNation identities with the founder.
