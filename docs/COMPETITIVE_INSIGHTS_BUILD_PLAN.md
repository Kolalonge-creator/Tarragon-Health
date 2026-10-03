# Competitive Insights Build Plan

> Source: `reports/Nigeria healthtech competitor analysis.md` (2026-09-24 competitive research
> across Presibo, mDoc, Medlitics, MyMedicalBank, Avura Cares, WellNation Nigeria, Mobihealth
> International). This doc converts that report's "worth adopting" and "how to outcompete"
> sections into 12 independent, self-contained build briefs — each one is written so a **fresh
> Claude Code session with no other context beyond this repo's `CLAUDE.md`** can pick it up and
> know exactly what to build, why, and what not to do. Open one session per category below; paste
> that category's brief as the opening message.

**How to use this doc:** each category is independent — there is no required build order, except
where a category's own "Depends on" line says otherwise. Every category already assumes the
session has read this repo's root `CLAUDE.md` (it loads automatically) — briefs below only add the
category-specific context CLAUDE.md doesn't already cover. Every category must still go through
this repo's existing discipline: feature branch, `/code-review high` before any PR, a regression
test for any bug-shaped fix, and no direct commits to `main`/`main-dev`.

---

## 1. Reputation & Review-Generation Engine

**One-line goal:** Build the systematic, post-interaction review-request flow the research report
identifies as Tarragon's single highest-leverage opportunity — no competitor in this category has
built one.

**Why (research finding):** All seven competitors researched have an almost total absence of
independent, verifiable reputation signal — no populated Trustpilot pages, app-store ratings that
are absent, suppressed below the platform's minimum threshold despite real download counts (mDoc:
10K+ downloads, zero visible rating), or based on samples too small to mean anything (Presibo: 7
reviews; MyMedicalBank: 3 ratings). Even the best-funded rival, Mobihealth International (₦1bn
raise), has no Trustpilot/Nairaland/Reddit footprint. This is a market-wide gap, not a
Tarragon-specific one, and the report's conclusion names it the highest-leverage differentiator
available because it requires patient trust, not capital.

**What to build:**
- A triggered review-request mechanism fired at genuine moments of relief/resolution — after a
  resolved `clinician_alerts`/`escalations` case, a clean or explained abnormal lab result, or a
  completed chronic-care check-in/programme milestone. This should be a real trigger tied to actual
  event completion, not a blanket "rate us" popup on login.
- An in-app prompt that deep-links to the App Store / Play Store native review flow (use each
  platform's in-app-review API where available — `StoreReview` for Expo/React Native on iOS,
  Play In-App Review API on Android — rather than just linking out, since native in-app review
  prompts convert far better).
- A separate, lighter-weight prompt for a Trustpilot review request (web/email), since Trustpilot
  has no in-app SDK equivalent — likely a post-interaction email or in-app banner linking to a
  Trustpilot review URL for the org's Trustpilot profile (create the profile first if one doesn't
  exist — that's a founder/ops action, flag it, don't silently skip it).
- An admin-facing dashboard widget (in the existing admin console) tracking rating-request-sent vs.
  rating-submitted conversion over time, as a tracked growth metric, per the report's
  recommendation #1.
- Respect platform review-prompt rate limits (Apple and Google both cap how often you can trigger
  the native prompt per user per year) — build a `review_prompts` tracking table so the app knows
  not to over-ask a given user.

**Guardrails:**
- Never fabricate, incentivize with a discount, or gate a feature behind leaving a review — that
  crosses into manipulated/fake reviews, which is exactly what makes competitor testimonials in
  this research unverifiable and untrustworthy; Tarragon's differentiator is that its reviews are
  real.
- Do not add this as a WhatsApp-only flow — WhatsApp/SMS is notification/reminder only, never a
  required interaction surface (see CLAUDE.md's Non-Negotiable Business Rules). An SMS/WhatsApp
  nudge pointing back into the app is fine; requiring the review to happen over WhatsApp is not.
- This is not a registered AI system (no LLM call site), so `ai_systems`/`runGovernedAi()` does not
  apply here — don't over-engineer it as an AI feature.

**Definition of done:** trigger logic ships behind a feature flag, fires on at least the three
named event types above, native review prompts work on both iOS and Android with rate-limiting,
Trustpilot profile exists and is linked, and an admin metric shows request-to-submission conversion.

---

## 2. Marketing Site — Condition-Specific Landing Pages

**One-line goal:** Build dedicated hypertension and diabetes (and eventually other core-wedge
condition) landing pages, matching a pattern mDoc and Medlitics both use effectively.

**Why (research finding):** mDoc and Medlitics both build tight, dedicated pages per condition
rather than one generic product pitch, each carrying its own risk-education stat, its own
testimonial, and its own SEO target. Tarragon's marketing site currently has no equivalent.

**What to build:**
- New route(s) under `apps/web/src/app/(marketing)/` (per CLAUDE.md's marketing-site architecture
  note — this is a route group inside the existing Next.js app, not a separate package) — e.g.
  `/conditions/hypertension`, `/conditions/diabetes`.
- Each page: a quiet-urgency statistic in Tarragon's brand voice (model it on the register of
  Presibo's "most complications happen because people go months without checking their numbers" —
  a real consequence stated plainly, NOT Medlitics's blunter unverified percentage claims like
  "reduce risk by 78%", which cross into the fear-based-urgency register `docs/BRAND_GUIDE.md`
  explicitly rules out), a real two-sided testimonial pair (patient + doctor, both genuinely
  consented and sourced — never invented, per the report's explicit callout that competitor
  testimonials are unverifiable), a plain explanation of how Tarragon's escalation/review process
  works for that condition, and a clear CTA into signup.
- Read `docs/MARKETING_SITE_SPEC.md` first for the site's existing sitemap, copy patterns, and
  design tokens before adding new pages, and `docs/BRAND_GUIDE.md` for voice/tone/color rules.

**Guardrails:**
- Marketing pages must not import platform/auth modules (existing rule, `apps/web/proxy.ts`
  hostname routing depends on this separation being clean).
- No specific doctor:patient ratio in this copy (under review, see CLAUDE.md's Non-Negotiable
  Business Rules) — describe the mechanism ("reviewed against care protocols," "escalates to a
  doctor") instead of a number.
- Do not use "doctor-led" as a headline/marketing claim (retired per Brand section of CLAUDE.md) —
  describe the actual clinical process instead.
- No em dashes in marketing copy (per memory: `feedback_no_em_dashes_marketing_copy`).
- If no real, consented testimonial exists yet for a condition, ship the page without a fabricated
  one rather than inventing a quote — leave a clearly-marked placeholder block instead.

**Definition of done:** at least hypertension and diabetes pages live, reviewed against
`docs/BRAND_GUIDE.md` voice rules, `/code-review high` run before PR.

---

## 3. Marketing Site — Trust, Named Partners & Guardrail Messaging

**One-line goal:** Make Tarragon's real, documented partner relationships and deliberate business
guardrails visible on the marketing site — a rare, credible differentiator in this category.

**Why (research finding):** Five of the seven competitors either name zero partners (WellNation
Nigeria's "trusted national partnerships" names no labs, HMOs, or pharmacy chains anywhere) or name
only one thin vendor relationship (Medlitics names only Curacel, an insurance-tech vendor, no
hospitals or labs). Tarragon has real, documented relationships (Synlab Nigeria; HMOs Reliance,
Avon, Ronsberger, Wellahealth per CLAUDE.md's Key Partners section) that are currently under-featured.
Separately, the report identifies two of Tarragon's founder-set guardrails as citable competitor
weaknesses when framed as deliberate discipline: "no capitation, ever" (unlike mDoc's B2G capitation
revenue) and NGN-first, one-price-list pricing (unlike Medlitics's USD-denominated consumer pricing
and MyMedicalBank's inconsistent brochure-vs-live pricing).

**What to build:**
- A visually prominent "Our Partners" section/page on the marketing site naming real, current lab
  and HMO relationships — confirm current partner names and `is_active` status against the live
  database (`lab_providers`, HMO-related tables) before publishing anything, per CLAUDE.md's
  standing lesson that partner rosters change (e.g. only Synlab may currently be `is_active`; do
  not name a lab or HMO as a live partner without checking).
- A short, explicit pricing-trust message: "always priced in Naira, one price list, no surprise FX
  conversion" — placed near or on the pricing page.
- A short "why we don't do capitation" or equivalent framing statement, in Tarragon's warm brand
  voice (not defensive or comparison-baiting — never name a competitor by name in public marketing
  copy), presented as considered philosophy rather than omission.
- An "how escalation actually works" trust/transparency section or page, in plain language,
  supporting Category 4 below (see also Category 4 — the concrete mechanism this page describes is
  what Category 4 provides the copy/design for).

**Guardrails:**
- Never name a competitor by name in public-facing marketing copy.
- Do not invent or round up partner counts/names — verify against the live `lab_providers` table's
  `is_active` flag and current HMO integration status before publishing (see CLAUDE.md's
  "Laboratory fulfilment model" section — the roster of active labs has changed multiple times).
- Don't cite a specific doctor:patient ratio (see Category 2's guardrails, same rule applies).

**Definition of done:** partner section live with verified-current names only, pricing-trust
message live on/near the pricing page, capitation-philosophy statement live, all copy reviewed
against `docs/BRAND_GUIDE.md`.

---

## 4. Governed AI Lab-Result & Symptom Explainer

**One-line goal:** Build a "upload a lab result or describe a symptom → get a plain-language AI
explanation → seamless handoff to a doctor" flow, matching a pattern that converts well for
MyMedicalBank and Medlitics — but built through Tarragon's existing AI governance layer, which none
of the seven competitors show any evidence of having.

**Why (research finding):** MyMedicalBank's "upload your result, get a plain-language explanation,
then book a doctor from the same screen" flow, and Medlitics's "Meddy" assistant, are both
effective top-of-funnel/engagement patterns. Tarragon's existing AI governance discipline
(`ai_systems` registry, `runGovernedAi()`, evaluation + red-team gate) is a genuine point of
technical superiority the report explicitly calls out as worth preserving, not shortcutting, while
building this.

**What to build:**
- Read `docs/AI_GOVERNANCE_SPEC.md` and `docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md` in full before
  writing any code — the latter already gap-analyzes the existing `apps/web/src/lib/ai-coach/`
  LangGraph assistant against exactly this kind of feature and identifies the three structural gaps
  (no tool-calling layer, context reads only 2 of 11 patient-record items, no per-turn AI-provenance
  record) that block most of this. Do not re-derive that analysis from scratch — extend it.
- A new, or extended, AI call site that: accepts an uploaded lab result (PDF/image/document) or a
  free-text symptom description, produces a plain-language explanation, and then offers a clear,
  one-tap path to book a doctor consult or raise it with the care team via the existing
  `care_messages` channel (never WhatsApp — see CLAUDE.md's two-way-conversation rule).
- Register the call site in `ai_systems` with `runtime_governed` starting `false` until a real
  evaluation run, prompt approval, and knowledge-source approval exist — per CLAUDE.md's explicit
  rule against ever seeding a fake passing evaluation, prompt approval, or knowledge-source approval.
- Route every invocation through `runGovernedAi()` so `public.ai_runtime_config()` and the kill
  switch (`ai_systems.is_enabled`) actually govern it.

**Guardrails:**
- **Never add an unregistered AI call site** — this is a hard "never" in CLAUDE.md.
- Never invent or seed a passing evaluation, prompt approval, or knowledge-source approval record —
  each represents a real human judgement call; a fabricated one defeats the entire governance
  module's purpose.
- This must never become a mechanism that auto-creates a `specialist_referrals` row — if the
  explainer surfaces a referral-worthy finding, the existing `lib/ai-coach/referral-tool.ts` pattern
  (write a `clinician_alerts` row with `type_code='referral_requested'` for a clinician to review)
  is the only allowed path, per CLAUDE.md's standing invariant on that table being staff/trigger-created only.
- Respect the abnormal-result escalation pipeline — this feature explains a result to the patient in
  plain language, it must never replace, delay, or short-circuit the existing Category 2→1
  escalation trigger for a genuinely abnormal result.

**Definition of done:** call site registered in `ai_systems`, routed through `runGovernedAi()`,
a real (not seeded) evaluation run exists before `runtime_governed` is ever flipped true, and the
existing abnormal-result escalation pipeline is unaffected and covered by a regression test proving
so.

**Depends on:** should be scoped alongside `docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md`'s existing
phased build order — read that doc's own phasing before starting, don't treat this brief as
overriding it.

---

## 5. Verified Provider/Lab Directory with User Feedback

**One-line goal:** Add a review/rating layer to Tarragon's existing lab-location picker, modeled on
mDoc's NaviHealth.ai (a geo-coded, feedback-enabled, credential-verified provider directory).

**Why (research finding):** mDoc's NaviHealth.ai directory is cross-checked against Nigeria's
Medical Laboratory Science Council register and includes user feedback — a credible pattern
Tarragon's own `list_lab_test_locations` RPC (built as part of the 2026-08-29 Laboratory Network
build, see CLAUDE.md's lab-fulfilment history) currently lacks: no user-review layer exists on it.

**What to build:**
- Read the "Laboratory fulfilment model" section of CLAUDE.md in full first — it documents three
  reversals in this exact area and the specific guards (`lab_providers_active_needs_real_contacts`,
  never-sell-below-partner-cost triggers) that must not be relaxed.
- A new table (e.g. `lab_location_reviews` or similar) capturing a patient's post-visit rating and
  optional comment for a specific `lab_test_locations` row, tied to a real completed `lab_orders`
  row (never allow an unverified/no-visit review — this is the same "real, consented" discipline as
  Category 1 and Category 2's testimonials).
- Surface an aggregate rating on the location picker in the booking flow, and a simple
  moderation/reporting path for a clearly abusive or wrong review (staff-actionable, not automated
  takedown).
- RLS: a patient can only review a location tied to their own completed order; staff/admin can read
  all; follow this repo's existing per-table RLS + `organisation_id` filtering conventions.

**Guardrails:**
- Never let a review be tied to anything other than a genuinely completed order — this is exactly
  the kind of "unverifiable testimonial" problem the report flags as a category-wide competitor
  weakness; Tarragon's differentiator is that these are real.
- Grant table-level access explicitly (`alter default privileges` pattern already exists in this
  repo) — a new table needs its own `grant ... to authenticated`, RLS alone does not provide it (see
  CLAUDE.md's standing lesson on this, it has silently broken access three times before).
- Confirm which labs are currently `is_active` before testing against them — do not assume more
  than one real lab is live.

**Definition of done:** review table + RLS + grants shipped with a DB-level proof test in
`packages/db/tests/` (including a sabotage step proving the RLS actually discriminates), aggregate
rating visible in the booking flow.

---

## 6. Offline/Low-Bandwidth Resilience Audit & PWA Enhancements

**One-line goal:** Audit and improve how Tarragon's Next.js web app behaves on a slow or
intermittent connection — a real, felt Nigerian-market constraint that Medlitics has bet its entire
architecture on (offline-first PWA, no native app at all) and mDoc addresses via USSD.

**Why (research finding):** Medlitics deliberately ships no native app, betting entirely on an
installable offline-first PWA for low-bandwidth reach. The report's recommendation is explicitly
**not** to copy Medlitics's PWA-only bet (Tarragon already has a working React Native app — going
PWA-only would be the wrong lesson), but to audit whether Tarragon's own web app degrades gracefully
on a poor connection, since a credible competitor treating this as a first-order architectural
decision implies it's a real, felt problem in the target market.

**What to build:**
- An audit (throttled/offline network testing in Chrome DevTools or via the Browser pane's preview
  tools) of what currently happens on `apps/web` when the network drops mid-session: does data entry
  (a vitals log, a message) fail silently, queue for retry, or show a clear error? Document findings
  before writing any fix code.
- Where gaps are found: add a service worker for basic asset caching and a clear "you're offline,
  this will retry" UI state for form submissions, rather than a silent failure. This is a UX/resilience
  improvement, not a full offline-write-queue rebuild — scope conservatively.
- Do NOT attempt to make clinical data entry (vitals, medications) work fully offline-first with
  local write queues in this pass unless explicitly asked — that's a much larger architectural
  commitment (conflict resolution, sync guarantees) than "handle a dropped connection gracefully."

**Guardrails:**
- This is a resilience/UX improvement to the existing Next.js app, not a rebuild — do not introduce
  a second frontend framework or a PWA-only strategy that would compete with the existing React
  Native mobile app's role.
- Any offline queuing of clinical data must never bypass the existing escalation/red-flag pipelines
  once connectivity resumes — a delayed-but-later-submitted dangerous vitals reading must still
  trigger the same real-time logic it would have if submitted live; flag this explicitly rather than
  quietly building a naive queue-and-replay that could delay a Category 2→1 escalation.

**Definition of done:** a written audit of current offline behavior exists, at minimum a graceful
"offline, will retry" state replaces any silent failure found, verified in the browser preview per
this repo's UI verification workflow (throttle/offline network, confirm behavior, screenshot).

---

## 7. USSD Read-Only Reminder/Status Channel

**One-line goal:** Scope and build a USSD channel for feature-phone users — strictly a read-only
status-check and reminder surface, matching mDoc's USSD reach pattern without violating Tarragon's
WhatsApp/SMS notification-only rule.

**Why (research finding):** mDoc supports USSD access for feature phones, extending reach well
beyond smartphone owners — a real technical pattern Tarragon's existing Termii SMS relationship
could plausibly extend into, but only carefully scoped.

**What to build:**
- A USSD gateway integration (via Termii, which Tarragon already has a relationship with, or a
  dedicated Nigerian USSD aggregator if Termii doesn't offer USSD) exposing a narrow menu: e.g.
  "check next appointment," "check last logged vitals," "request a callback/reminder," "check
  medication refill status." Read-only status checks and reminder requests only.
- No clinical data entry, no vitals logging, no medication logging, no chat, no account
  creation/signup over USSD.

**Guardrails — read carefully, this is the highest-risk category to get wrong:**
- This is a hard boundary in CLAUDE.md: **no feature may be built to depend on a WhatsApp/SMS/USSD
  send succeeding, and no core patient/clinician transaction (vitals/meds/screening/booking logging)
  may happen via USSD/WhatsApp.** Every core action stays app/web-only. If in doubt about whether a
  proposed USSD menu item crosses from "read-only status check" into "core transaction," don't build
  it — flag it for the founder instead.
- Never build USSD-initiated signup, onboarding, or account creation — same rule as the existing
  WhatsApp-signup prohibition, applied to USSD by the same logic.
- This is genuinely optional scope, not a committed roadmap item — the report frames it as "worth
  exploring... if reaching non-smartphone users becomes a stated priority." Confirm that priority
  with the founder before investing significant build time.

**Definition of done:** a written scope doc naming the exact allowed menu items (all read-only)
exists and is founder-approved before code is written; if approved, the USSD flow ships as pure
read/notify with zero write paths into clinical tables.

---

## 8. Risk-Reversal Guarantee on First Paid Engagement

**One-line goal:** Build a low-cost trust mechanic — a money-back guarantee or refund path on a
patient's first paid engagement — modeled on Presibo's 30-day money-back guarantee.

**Why (research finding):** Presibo's tiered pricing page names exactly what each tier includes and
backs it with a 30-day money-back guarantee — a concrete risk-reversal mechanic that reduces
first-purchase friction without requiring any change to the underlying pricing model.

**What to build:**
- A defined guarantee scoped to Tarragon's actual current product: e.g. a satisfaction guarantee on
  the first month of the 12-week doctor-supported chronic-care programme, or a no-questions-asked
  refund on a first one-off `service_products` consult purchase.
- The actual refund mechanism through Paystack (Tarragon's only live payment provider — Stripe was
  removed entirely) — confirm Paystack's refund API supports the chosen guarantee window and that
  any related ledger/journal entries (if Platform Credit or ledger accounting is touched) are
  correctly reversed, not just the Paystack charge.
- Marketing copy naming the guarantee clearly on the pricing/checkout page (see Category 3 for where
  this pairs with other pricing-trust messaging).
- A simple admin-facing way to process/approve a guarantee-triggered refund (even a manual
  request-then-approve flow is fine for a first version — this doesn't need to be fully automated).

**Guardrails:**
- Any monetary reversal must correctly touch whichever ledger/accounting tables exist for the
  purchase type (Platform Credit ledger split into `paid`/`promo` buckets, or a direct Paystack
  refund) — do not just delete or silently ignore a purchase record.
- This is a pricing/money-flow feature — per CLAUDE.md's Definition of Done, explicitly ask
  `/code-review high` to check for money-related bugs by name on this diff (silent ledger
  mismatches, double-refunds, race conditions on refund + concurrent purchase).
- Do not extend this into a subscription-cancellation/proration feature — scope is strictly a
  first-engagement guarantee, not general billing changes.

**Definition of done:** guarantee scope decided and documented, refund path works end-to-end through
Paystack, ledger/journal entries reconcile correctly, `/code-review high` explicitly checked this
diff for money-handling bugs before PR.

---

## 9. Multilingual / Local-Language Support (Scoping + Phase 1)

**One-line goal:** Scope, then build a first real, shipped local-language feature — open,
differentiated territory, since no competitor studied has a confirmed, live multilingual product
feature beyond mDoc's Pidgin-capable chatbot responses.

**Why (research finding):** mDoc's chatbot "Kem" responds in Nigerian Pidgin; Presibo has announced
(but not confirmed as shipped) Yoruba/Igbo/Hausa voice/text symptom triage. The report calls this
"the most ambitious version of this pattern found across all seven competitors" and "open territory"
— genuinely differentiated given Tarragon's stronger engineering base.

**What to build:**
- Start with scoping, not code: decide which language(s) to target first (Pidgin is the lowest-risk
  starting point — it's English-adjacent and mDoc has already market-validated it; Yoruba/Igbo/Hausa
  are a bigger commitment), and which surface gets it first (a good first candidate: adding
  Pidgin-register responses to the existing `apps/web/src/lib/ai-coach/` assistant, which is a
  contained, already-governed AI surface rather than translating the entire UI).
- Any AI-generated multilingual response must go through the existing governed-AI registry exactly
  like any other AI call site (see Category 4's guardrails on `ai_systems`/`runGovernedAi()` —
  the same rule applies here without exception).
- If UI-level translation (not just AI-coach responses) is in scope, this is a much larger
  commitment (every string, every legal/consent document, every clinical protocol's plain-language
  explanation) — treat that as a separate, later phase, not bundled into this first build.

**Guardrails:**
- CLAUDE.md records a **2026-08-03 founder decision that the platform is English-only** (a
  production-quality Nigerian-language voice/TTS vendor was deliberately never built). This is a
  standing decision requiring an explicit founder ask to reverse or narrow. **Do not start building
  UI/product-language support without first confirming with the founder that this decision is being
  revisited** — this brief exists so the founder can make that call with the competitive context in
  hand, not as pre-authorization to proceed.
- If approved: any AI-generated non-English response is still a governed AI call site — no exception.

**Definition of done:** a founder go/no-go decision is captured first; if approved, a narrow Phase 1
(e.g. Pidgin-register AI-coach responses only) ships through the governed-AI registry with its own
evaluation run.

---

## 10. Caregiver/Family Access Visibility (Onboarding & Marketing UX)

**One-line goal:** Make Tarragon's existing caregiver/family consent-graph model (`profile_access`,
`care_access_requests`, `clinical_access`, `family_history`) more visible and better-explained in
onboarding and marketing copy — capturing the same trust benefit Presibo's bundled Family/Elder-care
tiers demonstrate market appetite for, without reopening the individual-enrolment-only decision.

**Why (research finding):** Presibo bundles a "Family portal" into its base tier and runs dedicated
Elder Care and Family pricing tiers, showing real market demand for caregiver-inclusive plans. The
report's explicit recommendation is **not** to reopen Tarragon's individual-enrolment-only decision
(a confirmed, shipped 2026-07-29 founder narrowing — no family plans, no ParentCare, ever) but to
make the platform's existing caregiver/dependent access model more discoverable.

**What to build:**
- Read `docs/FAMILY_CARE_CIRCLE_SPEC.md` first — it already documents why the existing
  `profile_access`/consent-graph model is the correct mechanism (not a "Family Group" primitive) and
  what's safe to extend vs. what would require reopening the founder's decision.
- Pure UX/discoverability work: clearer onboarding copy explaining "you can grant a family member or
  caregiver access to help manage your care" where that flow already exists but may be buried;
  clearer marketing-site copy (in `apps/web/src/app/(marketing)/`) describing this capability using
  real product language, not a "family plan" framing.
- This is explicitly NOT: a new pricing tier, a new `family_plan_members`-style table, or anything
  that reverses the individual-enrolment-only decision.

**Guardrails:**
- Do not resurrect `clinical_access_level` or any graded permission model superseded by the
  8-category `profile_access_categories` model (per `docs/FAMILY_CARE_CIRCLE_SPEC.md`'s own
  2026-09-02 reconciliation note in CLAUDE.md) — use the category-scoped access model as-is.
- No copy suggesting a bundled "family plan" price — Tarragon prices and enrolls individuals; a
  caregiver's *access* to help manage someone else's care is not the same as a shared subscription.

**Definition of done:** onboarding flow clearly surfaces the existing caregiver-access grant option
where applicable; marketing copy describes the real capability without implying a family-plan
pricing model exists.

---

## 11. Privacy-Safe Marketing/Onboarding Funnel Analytics Audit

**One-line goal:** Evaluate (and if needed, fix) Tarragon's own marketing/onboarding funnel
analytics tooling to ensure it never records full sessions on any authenticated, PHI-adjacent
surface — the opposite of a real mistake found in this research.

**Why (research finding):** MyMedicalBank runs Mixpanel with `record_sessions_percent: 100` (full
session recording) sitewide — real investment in funnel visibility, but a genuine privacy exposure
risk on a platform that also handles clinical data. This is flagged as a caution, not a pattern to
copy.

**What to build:**
- Audit whatever analytics tooling `apps/web` currently uses (check for any session-recording
  vendor — Mixpanel, Hotjar, FullStory, PostHog session replay, etc. — and its current
  configuration/scope).
- Confirm no session-recording or event-tracking tool is active on any authenticated,
  PHI-adjacent route (patient dashboard, clinician dashboard, any page rendering vitals, messages,
  lab results, medications). If one is found active there, scope it down to the public marketing
  site only, or disable session-recording (as opposed to plain pageview/funnel-step analytics, which
  is a much lower-risk category and can stay).
- Document the finding either way (clean audit, or the fix applied) since this is exactly the kind
  of thing a founder-requested audit later finds the hard way per CLAUDE.md's own stated rationale
  for the `/code-review high` habit.

**Guardrails:**
- This is a privacy audit, not a request to add new analytics — if nothing risky is found, the
  "build" here is the audit and its written finding, not new instrumentation.
- Never send PHI-adjacent page content, form field values, or session recordings to a third-party
  analytics vendor.

**Definition of done:** a written audit finding exists; if a scope violation was found, it's fixed
and verified (e.g. via `read_network_requests` in the browser preview, confirming no session-replay
payload fires on an authenticated clinical route).

---

## 12. Telco/Partner Distribution Channel — Scoping Only

**One-line goal:** Produce a scoping document (not a build) for a telco-embedded distribution
channel, modeled on Mobihealth International's Airtel Nigeria partnership — the one acquisition
channel among all seven competitors that none of the others (including Tarragon today) use.

**Why (research finding):** Mobihealth's November 2024 Airtel Nigeria partnership embeds the
product directly inside the Airtel app, offering subscribers 24/7 doctor access "from ₦5,000 per
year" — a telco-distribution channel with no equivalent among the other six competitors.

**What to build (this category is deliberately scoping-only, not implementation):**
- A short technical feasibility memo: what would a telco-embedded or telco-bundled offer need
  technically (a redemption/activation-code system tied to a telco billing relationship, an embedded
  webview or lightweight SDK surface, a distinct pricing SKU)? What's the minimum integration
  surface Tarragon would need to expose?
- Explicitly flag that this requires a real business-development relationship with a telco first —
  this is not something to build speculatively.

**Guardrails:**
- Do not write integration code against a specific telco's API without a confirmed partnership —
  this would be speculative work with no counterparty, unlike every other category in this doc.
- Any resulting pricing SKU must still respect Tarragon's one-NGN-price-list rule and must not
  create a capitation-style arrangement with the telco (per the "no capitation, ever" guardrail) —
  flag this explicitly in the memo as a structuring constraint for whoever negotiates the deal.

**Definition of done:** a scoping memo exists; no code is written until a real telco partnership is
confirmed by the founder.
