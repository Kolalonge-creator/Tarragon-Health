# S40 competitor review: mDoc (mymdoc.com), public sources only, 2026-10-06

## Read this first: scope limit
mymdoc.com returned a Cloudflare "Sorry, you have been blocked" page (HTTP 403, server: cloudflare) to
both the built-in browser and a plain HEAD/GET of the home page and /robots.txt. Per our rules we did not
try to bypass bot detection. So the **public website could not be reviewed at all**: no home/inner page
screenshots (desktop or 390px), no page source, no script/vendor inventory, no performance.getEntries, no
sitemap/robots/JSON-LD, no pricing page. Everything marked UNVERIFIED below is therefore unverified by us.
What WAS observed directly: the Google Play listing (full text, data-safety summary) and the Cloudflare
block response headers. Secondary facts come from third-party pages found via web search (TechXLab,
Social Innovations Journal abstract, AI World, Devex); the existing desk report already covers founder
story, funding and B2G capitation, so those are not repeated.
Recommendation: retry from a normal consumer browser by a human, or from a different network, if the
website design review matters; otherwise treat this file as app-listing plus secondary-source only.

## Snapshot
- Product: mDoc CompleteHealth (Android package com.mDoc.completehealth; no iOS listing found in this pass: UNVERIFIED).
- Play listing (observed): 10K+ downloads, PEGI 3, category Health & Fitness, updated 16 Sep 2026,
  "What's new" is only "Bug fixes and performance improvements". No rating or review summary shown on the
  page we read.
- Positioning (observed): "self-care support and health coaching platform", with an explicit disclaimer
  at the top that it is not a substitute for professional advice, diagnosis or treatment.
- Secondary sources: launched 2017; "130,000+ members, 86% women" (TechXLab); Nigeria, Kenya, Ghana;
  "free with premium options" (TechXLab, undated, UNVERIFIED against live pricing).
- Edge: Cloudflare in front of the whole site, with a strict WAF that blocks ordinary scripted and
  at least some real-browser requests from our network.

## Design (strengths / weaknesses)
UNVERIFIED for the website (blocked). From the Play listing only:
Strengths
- Clear audience self-qualification checklist ("this app is for you if..." covering chronic condition,
  abdominal weight, family history of T2D, age 45+, large-baby delivery). Good for conversion and
  screening intent, plain language.
- Disclaimer placed first, before any benefit claim. Trust-positive.
- Benefits listed concretely (weekly coach session, weekly virtual exercise class, free in-person
  checks) rather than abstract.
Weaknesses
- Listing is emoji-heavy and long; reads as marketing copy not product proof. No visible rating, so no
  social proof on the surface we saw.
- No screenshots/UI reviewed by us (not extracted), so app visual system, accessibility and mobile
  layout are UNVERIFIED.
- Bot-blocking the public site harms legitimate visitors, referrers and crawlers (see Code).

## Functionality (feature inventory)
| Feature | Evidence | Status |
|---|---|---|
| 24-week Propel programme, weekly coaching sessions | Play listing | Observed (claim) |
| Dedicated health coach, personalised lifestyle action plans | Play listing | Observed (claim) |
| My Diary: BP, glucose, cholesterol, exercise logging, shared with coach | Play listing | Observed (claim) |
| Health Passport: conditions, meds, procedures, surgeries, providers | Play listing | Observed (claim) |
| Symptom Tracker: type and intensity log | Play listing | Observed (claim) |
| Weekly virtual exercise classes | Play listing | Observed (claim) |
| Appointment booking with multidisciplinary team (nutrition, emotional health coaches) | Play listing | Observed (claim) |
| Condition programmes: diabetes, hypertension, obesity, cancer, pregnancy, mental health | Play listing | Observed (claim) |
| Free BP and glucose tests at select NudgeHub centres | Play listing | Observed; location list UNVERIFIED |
| Subscription plans tab inside app | Play listing | Observed; prices UNVERIFIED |
| Kem chatbot, 24/7; began rules-based, later LLM-based | Social Innovations Journal abstract, TechXLab | Secondary |
| Kem languages (Pidgin/English) | Prior desk report cites Gates article | Not confirmed by us (TechXLab: "not specified") |
| Human escalation from Kem | Prior desk report only | UNVERIFIED; not stated on pages we read |
| USSD / basic-phone access "via simple code" | TechXLab, AI World | Secondary; code, flow and screens UNVERIFIED |
| NaviHealth.ai geo-coded facility directory | TechXLab, search summary | Secondary; verification and reviews UNVERIFIED |
| Webinars / tele-education | Play listing title, TechXLab | Secondary |
| Data and consent claims | Play data safety | See below |

Play data safety (observed summary): "No data shared with third parties"; may collect personal info,
health and fitness and 4 other types; encrypted in transit; users can request deletion. The detailed
"see details" panel was not expanded, so exact data types and any independent security review are UNVERIFIED.
Nothing observed shows an emergency/red-flag pathway, a clinician-owned escalation, or a stated response
time. The model is coach-led (non-prescriber), with a disclaimer rather than a safety net.

## Code and performance
- Observed: server: cloudflare; 403 with cache-control no-store; x-frame-options: SAMEORIGIN;
  referrer-policy: same-origin; HTTP/2, HTTP/3 advertised (alt-svc h3); Cloudflare NEL reporting on.
  Only the block page's headers were visible, so these may not apply to the real site.
- Framework/CMS, analytics, chat, payment vendors, service worker, manifest, JSON-LD, sitemap,
  page weight, Core Web Vitals: all UNVERIFIED (site not reachable).
- Play listing is a standard store page; nothing app-side (SDKs, permissions) was inspected.
- SEO impact (inference): a WAF that blocks automated fetches and also blocked our browser can
  depress crawl, link-preview and AI-answer visibility. Not confirmed with their analytics.

## Safety or regulatory concerns (Nigeria)
- Coach-led care with only a disclaimer: for hypertension/diabetes/cancer programmes there is no
  visible emergency or abnormal-reading escalation. Confirm before assuming; UNVERIFIED either way.
- Logging BP and glucose with a non-clinician coach interpreting them is a scope-of-practice risk
  unless a licensed clinician reviews flagged values (not shown publicly).
- LLM chatbot on health topics: guardrails, evaluation results and escalation not public in what we read.
- "Cancer" and "pregnancy" programmes through a lifestyle-coaching model: claims should be checked for
  clinical review. NDPA (Nigeria Data Protection Act) consent specifics, retention and cross-border
  hosting are not visible; Play says no third-party sharing, which we cannot verify.
- USSD health data over telco rails carries privacy and spoofing risk; flow not documented publicly.
- B2G capitation (from prior report) creates payer-aligned incentives; Tarragon already rules this out (I8).

## What Tarragon should adapt (originally, not copy)
1. Self-qualification checklist on condition landing pages ("is this for you?"), written in our voice,
   leading to a signed-in check, never a diagnosis. Fits SEO and ties to existing risk questionnaire.
2. Disclaimer-first, plain-scope wording on any AI surface, paired with a visible "what happens if this
   is serious" line (our deterministic red-flag path and doctor escalation), which they do not show.
3. A personal diary/passport framing for the patient record, using our own record, and making the
   patient-owned view of it easy to find and export.
4. Facility finder with patient feedback, built on our lab-location picker, with verification status
   shown. Gap check only; no new build without an ask.
5. Reach for non-smartphone users: assess a read-only reminder/status surface (SMS/USSD) consistent
   with the in-app-first rule. Not a transactional channel.
6. Make our public site crawlable and reliably reachable: tune bot rules so real users and search/AI
   crawlers are not blocked, and test it from outside Nigeria and UK.
7. Show a visible rating or review signal (Trustpilot/Play) since this competitor shows none.

## What Tarragon should avoid
- Anything that mixes coaching with clinical interpretation without a named clinician owner.
- Capitation or payer-aligned monetisation (already prohibited, I8).
- Emoji-heavy, benefit-list store copy that overclaims; keep claims tied to shipped features.
- Treating "no third-party sharing" as a trust claim unless our own data-safety form is audited.
- A WAF posture that blocks ordinary visitors; test public pages in a clean browser before launch.
- Building USSD or LLM features without governance (AI registry, kill switch) and clinical sign-off.

## Sources
Observed: https://play.google.com/store/apps/details?id=com.mDoc.completehealth ; mymdoc.com block response.
Secondary: techxlab.org/solutions/completehealth-app ; socialinnovationsjournal.com/index.php/sij/article/view/7107 ;
aiworld.eu/story/mdoc-provides-ai-driven-disease-support-across-nigeria ; existing desk report mDoc section.
