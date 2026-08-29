# AI/LLM Cost Analysis — 1,000 Daily Active Users

> Written 2026-08-29. Grounded in the actual code (`apps/web/src/lib/`), not the aspirational
> caching architecture described elsewhere — see the correction below. Prices and adoption
> assumptions will drift; re-verify both before trusting a number here more than a few months out.

## What's actually AI-backed today

Every LLM call in the codebase goes through `@langchain/anthropic`'s `ChatAnthropic` — no OpenAI,
no other vendor for text generation. Nine features call Claude:

| # | Feature | File | Model | Turn shape |
|---|---|---|---|---|
| 1 | AI Coach chat | `apps/web/src/lib/ai-coach/{model,graph,index}.ts` | Sonnet 5 | Multi-turn, history capped at last 20 msgs |
| 2 | Case brief (clinician-facing) | `apps/web/src/lib/case-briefs/generate.ts` | Haiku 4.5 | Single-turn |
| 3 | Patient result explainer | `apps/web/src/lib/patient-explainer/generate.ts` | Haiku 4.5 | Single-turn |
| 4 | Lab report extraction (vision) | `apps/web/src/lib/lab-reports/extract.ts` | Sonnet 5 | Single-turn, image/PDF + full analyte vocabulary in every prompt |
| 5 | ECG report extraction (vision) | `apps/web/src/lib/ecg-reports/extract.ts` | Sonnet 5 | Single-turn, image + ECG parameter catalogue |
| 6 | Meal-photo vision | `apps/web/src/lib/nutrition/meal-vision.ts` | Sonnet 5 | Single-turn, image + Nigerian food reference text |
| 7 | Medication pack vision | `apps/web/src/lib/medications/pack-vision.ts` | Sonnet 5 | Single-turn, image, transcription only |
| 8 | Lifestyle nudge copy | `apps/web/src/lib/lifestyle/coaching-proposer.ts` | Sonnet 5 | Single-turn, ≤2-sentence output; action selection itself is deterministic, not LLM |
| 9 | Voyage embeddings (retrieval for #1, #8) | `apps/web/src/lib/lifestyle/voyage-embedder.ts` | `voyage-3-large` | Not Claude — separate, low-cost vendor line item, omitted from totals below |

Not found in the code: a standalone symptom/triage AI, or an LLM-based risk score (SCORE2/HbA1c
trajectory are deterministic Python in `services/ml/`, no LLM). `packages/shared/src/ml-client.ts`
confirmed the ML microservice has no Anthropic/OpenAI/LangChain dependency, per the architecture
rule that it stays stateless and LLM-free.

**Important finding: `cache_control` appears nowhere in the repo.** Zero prompt caching is
implemented on any of the nine calls above, despite `docs/ARCHITECTURE.md`-style documents
describing caching as part of the intended design. Every request re-sends its full system prompt
from scratch, uncached, every time.

## Pricing used (verified 2026-08-29, not the number in this file's earlier chat draft)

**Correction:** Claude Sonnet 5 was announced with "introductory" pricing of $2/$10 per million
input/output tokens, due to rise to $3/$15 on 2026-09-01. Anthropic reversed that decision around
2026-08-10/11 and made $2/$10 the permanent price — the September hike is not happening. Any
estimate built on a $3/$15 September figure (including one given earlier in this same
conversation, before this doc was written) is now wrong; use $2/$10.

| Model | Input $/MTok | Output $/MTok |
|---|---|---|
| Claude Sonnet 5 (`claude-sonnet-5`) | $2.00 | $10.00 |
| Claude Haiku 4.5 (`claude-haiku-4-5`) | $1.00 | $5.00 |

## Per-call token profile (estimated from each file's system prompt + `maxTokens` cap)

| Feature | Model | Input tokens/call | Output tokens/call |
|---|---|---|---|
| AI Coach turn | Sonnet 5 | ~1,600 (fixed coaching prompt + patient risk/programme context + 1-2 retrieved snippets + capped history) | ~200 (capped at 500) |
| Case brief | Haiku 4.5 | ~1,000 (structured case snapshot + optional protocol excerpt) | ~250 (capped at 400) |
| Result explainer | Haiku 4.5 | ~300 (one measurement, latest+previous value) | ~150 (capped at 300) |
| Lab report extraction | Sonnet 5 | ~3,500 (image/PDF + full analyte vocabulary block) | ~800 (capped at 4,000) |
| ECG extraction | Sonnet 5 | ~1,800 (image + ECG parameter catalogue) | ~400 (capped at 2,000) |
| Meal-photo vision | Sonnet 5 | ~1,500 (image + food reference text) | ~300 (capped at 700) |
| Medication pack vision | Sonnet 5 | ~1,000 (image + transcription instructions) | ~250 (capped at 700) |
| Lifestyle nudge | Sonnet 5 | ~700 (programme context JSON + 1 retrieved reference) | ~80 (capped at 200) |

These are estimates from reading each file's prompt-construction code, not measured
`response.usage` — treat as directional, not exact, until logged.

## Two scenarios for 1,000 daily active users

### Scenario A — literal reading: every user triggers every one of the 9 features once a day

This is the ceiling implied by "1,000 people use *all* the AI functions daily" taken literally.
It's unrealistic on its face (not every patient scans an ECG or a medication pack daily), but it's
a useful stress-test upper bound.

- Sonnet 5 input: ~10,100 tokens/user/day → 10.1M tokens/day across 1,000 users
- Sonnet 5 output: ~2,030 tokens/user/day → 2.03M tokens/day
- Haiku 4.5 input: ~1,300 tokens/user/day → 1.3M tokens/day
- Haiku 4.5 output: ~400 tokens/user/day → 0.4M tokens/day

Daily cost: (10.1M × $2 + 2.03M × $10)/1M + (1.3M × $1 + 0.4M × $5)/1M
= ($20.20 + $20.30) + ($1.30 + $2.00) ≈ **$43.80/day → ~$1,315/month**

### Scenario B — realistic adoption mix (more useful for actual budgeting)

Weighting each feature by a plausible daily-trigger rate rather than assuming universal daily use
of every feature (coach chat used by ~40% of DAUs with ~3 turns when used; lab/ECG/med-pack scans
used by a small single-digit-to-low-teens percent since those aren't daily habits; meal-photo and
lifestyle nudges used by a much larger share since they're designed as daily-use surfaces; case
briefs driven by clinician/escalation volume, not raw patient count — assumed ~150/day):

Daily cost ≈ **$12/day → ~$360/month** for 1,000 daily active users.

This lands close to the "efficient architecture, ~$300–450/month" range floated earlier in this
conversation — but for a different reason than assumed then. It's not because caching is doing the
work (there is none); it's because most of these calls are already single-turn, Haiku is already
used for the two lightweight text-only features, and every `maxTokens` cap is small. The
architecture is accidentally cost-disciplined on the model/output-size axis, even though the
caching axis is completely unexploited.

## The one clear, currently-unrealized lever: prompt caching

Every one of the 9 features sends a **fixed, byte-identical block on every single call, regardless
of which patient triggered it** — the lab-report analyte vocabulary, the ECG parameter catalogue,
the meal-vision food reference text, the coach's fixed coaching-prompt text, the lifestyle nudge's
coaching instructions. None of that is caching-eligible in the code today because no `cache_control`
is set anywhere. A cache hit costs roughly 10% of a normal input token; a cache write costs about
1.25x — so this pays for itself within the second call that hits the same cached prefix, and at
1,000-DAU volume, the same fixed system prompt is being re-sent thousands of times a month.

Rough impact: the fixed-vocabulary/system-prompt portion is a large minority-to-roughly-half share
of input tokens on the four vision-extraction features and the coach (less so on the two Haiku
features, which are already small). Caching that portion plausibly cuts total input-token spend by
something in the 30–45% range platform-wide — on Scenario B's ~$360/month, that's roughly
$80–110/month back; on Scenario A's ~$1,315/month ceiling, roughly $350–500/month. Given the
zero-`cache_control`-calls finding above, this is a real, currently-unclaimed savings opportunity,
not a hypothetical one — and it costs nothing in output quality, unlike model downgrades or effort
tuning.

## Caveats

- Token estimates are read from each file's prompt-construction code, not measured production
  `response.usage` — the fastest way to sharpen this analysis is to log `usage.input_tokens` /
  `usage.output_tokens` / `usage.cache_read_input_tokens` per feature and replace these estimates
  with real numbers.
- Scenario B's per-feature adoption percentages are judgment calls, not measured DAU behavior —
  there's no analytics event volume checked here to ground them further.
- Excludes Voyage AI embedding cost (separate vendor, small relative to Claude spend at this
  volume) and excludes non-AI infrastructure (Supabase, Upstash Redis, Vercel, WhatsApp/SMS,
  Paystack/Stripe fees) — this document is LLM API spend only.
- Pricing is current as of 2026-08-29; re-verify before relying on it for a budget more than a
  couple of months out — this project's own history (see `CLAUDE.md`) shows pricing/entitlement
  assumptions here churn often.
