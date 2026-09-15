# AI/LLM Cost Analysis — 1,000 Daily Active Users

> Written 2026-08-29, updated same day once prompt caching was actually implemented (see
> "What was implemented" below — the first version of this doc overclaimed what caching would
> save; read that section before trusting the original "one clear lever" pitch). Grounded in the
> actual code (`apps/web/src/lib/`), not the aspirational caching architecture described
> elsewhere. Prices and adoption assumptions will drift; re-verify both before trusting a number
> here more than a few months out.

## What's actually AI-backed today

Every LLM call in the codebase goes through `@langchain/anthropic`'s `ChatAnthropic` — no OpenAI,
no other vendor for text generation. **Ten** features call Claude (corrected 2026-09-03 — a real
call site was missing from this table):

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
| 10 | 7-day Nigerian meal plan generator (added — spec 19.8, PR #292) | `apps/web/src/lib/nutrition/meal-plan-generate.ts` | Sonnet 5, `maxTokens: 4000` | Single-turn, 7-day/21+-meal-slot plan against a ~94-line food-catalogue vocabulary block — the **largest `maxTokens` cap of any feature in this table**, tied with lab/ECG extraction. Fold into Scenario A's ceiling and estimate a realistic daily-trigger rate for Scenario B (likely low-single-digit % of DAUs, similar order to lab/ECG/med-pack scans — a full week's meal plan isn't a daily action). This is the same call site `docs/AI_GOVERNANCE_SPEC.md` flags as registered live (`AI-011`) but not yet merged into `main-dev` — resolve that governance-registration question before treating this row as fully reconciled. |
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

## Prompt caching: what was implemented, and the correction to this doc's first pass

The first version of this document claimed caching the fixed system-prompt/vocabulary block on
"every one of the 9 features" would cut platform-wide input spend by 30–45%. That was wrong — it
skipped checking Anthropic's **minimum cacheable prefix**, which is model-dependent and, critically,
**not** the same for Sonnet 5 and Haiku 4.5:

| Model | Minimum cacheable prefix |
|---|---:|
| Claude Sonnet 5 | 1,024 tokens |
| Claude Haiku 4.5 | 4,096 tokens |

A `cache_control` marker on a block shorter than the model's minimum is a documented no-op — no
error, the request just proceeds uncached (`cache_creation_input_tokens: 0`). Checking each
feature's actual fixed-block size against its model's threshold narrows the real opportunity to
2–3 of the 9 features, not all of them:

| Feature | Model | Fixed-block size (est.) | Threshold | Cacheable? |
|---|---|---:|---:|---|
| Lab report extraction | Sonnet 5 | ~2,200–2,700 tok (71-analyte vocabulary + instructions) | 1,024 | **Yes, comfortably** |
| ECG extraction | Sonnet 5 | ~900–1,100 tok (13-parameter vocabulary + instructions) | 1,024 | Borderline — added anyway, zero cost if it doesn't hit yet |
| AI Coach chat | Sonnet 5 | ~300–900 tok per turn (system + patient context + history), grows each turn | 1,024 | Only from the ~3rd exchange in a session onward |
| Case brief | Haiku 4.5 | ~400 tok | 4,096 | **No — ~10x too small** |
| Patient result explainer | Haiku 4.5 | ~330 tok | 4,096 | **No — ~12x too small** |
| Meal-photo vision | Sonnet 5 | ~500 tok (26-item food reference + instructions) | 1,024 | **No — ~2x too small** |
| Medication pack vision | Sonnet 5 | ~450 tok (no vocabulary block) | 1,024 | **No — ~2x too small** |
| Lifestyle nudge | Sonnet 5 | ~260 tok | 1,024 | **No — ~4x too small** |

Padding a prompt with unrelated filler just to clear the threshold would cost more than it saves
(more billed tokens, for a cache that's disposable in 5 minutes) — not worth it. So caching only
went into the three rows where it does something real:

- **`apps/web/src/lib/lab-reports/extract.ts`** — `cache_control` on the fixed instructions +
  full analyte/qualitative vocabulary. The per-laboratory "learned hints" text (`hintsPromptBlock`,
  which varies call to call) was split into its own uncached block *after* the breakpoint — it used
  to be string-concatenated onto the same block, which would have invalidated the cached vocabulary
  on every single call for a laboratory the platform has already learned something about.
- **`apps/web/src/lib/ecg-reports/extract.ts`** — same pattern, on the smaller 13-parameter
  vocabulary. This one sits right around the 1,024-token line by estimate; it may or may not
  actually cache today, but the marker is free to leave in either way and starts working
  automatically if the catalogue grows.
- **`apps/web/src/lib/ai-coach/graph.ts`** — the multi-turn pattern instead of a system-prompt
  breakpoint: `cache_control` on each turn's newest message, so a session's system prompt +
  accumulated history become one growing cached prefix. Early turns in a session are usually still
  under 1,024 tokens combined (no-op, as above); it starts reading from cache once a session's
  system + context + history crosses that line, typically the 3rd exchange onward.

Verified with `tsc --noEmit`, the existing Jest suite (all passing), and new tests
(`lab-reports/extract.test.ts`, additions to `ecg-reports/extract.test.ts`) that assert the cache
breakpoint lands in the right place and that per-call content stays out of the cached block.
**Not yet verified against real `usage.cache_read_input_tokens`** — no live traffic has hit these
code paths yet. That's the next thing to check once this is deployed (see Caveats).

### Corrected savings estimate

Because only 2–3 of 9 features actually benefit, and one of those three (the coach) only helps
partway through a session, the realistic savings are much smaller than the first draft claimed:

- **Scenario B (realistic mix, ~$360/month baseline):** lab-report + ECG extraction together are
  a small slice of total spend (~8%, ~$1/day) at assumed realistic volumes (50 + 30 calls/day) —
  even a ~50–65% cut to their input cost on a cache hit nets roughly **$15–40/month**, not the
  $80–110/month the first draft claimed. The coach's multi-turn caching costs nothing to have added
  but, at an assumed ~3 turns/session, most sessions end right around where caching would start
  reading — expect close to zero measurable benefit at this session length; it pays off more as
  sessions get longer, not at today's assumed usage shape.
- **Scenario A (literal ceiling, ~$1,315/month):** lab-report + ECG extraction are a much bigger
  slice here (~52% of total spend, since every one of 1,000 users triggers them daily) and
  clustered call volume makes cache hits far more likely — this is where caching's real value
  shows up, roughly **$150–200/month** off the ceiling.

The honest takeaway: prompt caching was worth adding here because it's free where it doesn't apply
and real where it does, but it was never the 30–45%-of-the-whole-bill lever the first draft of this
document claimed. The bigger cost lever at *today's* likely volumes is simply that most of these
calls are single-turn with small `maxTokens` caps on a cheap model — which the architecture already
does, by accident rather than by a caching strategy.

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
