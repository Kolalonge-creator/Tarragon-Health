# Competitive Insights Build Plan

> Source: `reports/Nigeria healthtech competitor analysis.md` (2026-09-24 competitive research
> across Presibo, mDoc, Medlitics, MyMedicalBank, Avura Cares, WellNation Nigeria, Mobihealth
> International). This doc converts that report's "worth adopting" and "how to outcompete"
> sections into 2 independent, self-contained build briefs (the two the founder chose to pursue; the other ten from the original report were dropped and are not needed) — each one is written so a **fresh
> Claude Code session with no other context beyond this repo's `CLAUDE.md`** can pick it up and
> know exactly what to build, why, and what not to do. Open one session per brief below; paste
> that category's brief as the opening message.

**How to use this doc:** each category is independent — there is no required build order, except
where a category's own "Depends on" line says otherwise. Every category already assumes the
session has read this repo's root `CLAUDE.md` (it loads automatically) — briefs below only add the
category-specific context CLAUDE.md doesn't already cover. Every category must still go through
this repo's existing discipline: feature branch, `/code-review high` before any PR, a regression
test for any bug-shaped fix, and no direct commits to `main`/`main-dev`.

---

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

## 2. Governed AI Lab-Result & Symptom Explainer

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
