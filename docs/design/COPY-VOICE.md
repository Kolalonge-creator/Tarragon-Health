# Copy voice: plain but educated

Set 2026-10-30 after the founder found the site and app copy too simple. The model is the NHS and Ada Health: everyday words, full sentences, correct medical terms explained once.

## Rules

1. Write complete sentences. Avoid fragments such as "Quiet weeks stay quiet." and slogans such as "Log as you go."
2. Use the proper term, then explain it once if the reader may not know it. Write "blood pressure", not "BP". Write "laboratory", not "lab", in headlines.
3. Say what happens and why. "A run of readings over several weeks shows how well your blood pressure is controlled" beats "Track your trend."
4. Use `referral to a doctor` or `doctor review` in patient copy. Keep "escalate" and "care gap" out of patient-facing text; they are internal words.
5. Use "do not", "cannot" and "is" in headlines and body text. Contractions are fine in short UI messages.
6. No colloquial cheerfulness ("Let's keep it that way", "not left to willpower alone" as a tagline, "Mum"). Warm means respectful, not chatty.
7. Keep every number, price, time limit and claim exactly as the live source states it. Rewording must never change a fact.
8. No em dashes in user-facing text.

## Before and after

| Before | After |
|---|---|
| Healthy today? Let's keep it that way. | Find health problems early, while they are easiest to treat. |
| Log as you go | Record your readings |
| Quiet weeks stay quiet. | When your readings are stable, you hear very little from us. |
| Eat / Move / Relax | Eating / Activity / Stress |
| Know how your parent is doing | Follow your parent's health |

## Process rule (do not repeat the original mistake)

The site was first written in a chatty, simple register that the founder had to ask to have corrected. For any new page, FAQ, email, notification or dashboard string: write it in this voice the first time, then re-read it against the rules above before opening a PR. When rewording, change style only, never a price, number, time limit or clinical claim.

## What is checked by a test

`packages/shared/src/copy-lint/` scans the user-facing source on every test run and fails when a count goes above its baseline. Besides the older rules (cure, instant doctor, free healthcare, "your doctor", dashes), it now checks the parts of this guide a line scan can see:

| Rule id | What it flags | Where | Guide rule |
|---|---|---|---|
| `abbreviation-bp` | "BP" inside a string or JSX text | patient-facing code only | 2 |
| `internal-term` | "escalate", "escalation", "care gap" inside a string or JSX text | patient-facing code only | 4 |
| `colloquial` | "Mum", "Mummy", "Let's" | everywhere | 6 |

Patient-facing code means the marketing site, the patient dashboard and the patient screens of the mobile app (`PATIENT_FACING` in `scan.ts`). Staff screens are excluded because their readers use those words at work. `packages/i18n`, `packages/notifications` and the notification templates mix both audiences, so only `colloquial` applies there.

The rest of this guide needs a reader: complete sentences, saying why, and keeping every number and claim unchanged. A person still checks those before a PR. The test does not replace that.

To fix a failure, reword the string. Do not raise the number in `baseline.ts`. One `colloquial` hit is kept on purpose: `panic.title` belongs to the calm-tool wording, which the CMO attested and which a fingerprint test pins (`s56b-wording-pin.test.ts`). Changing it closes the feature until the CMO attests the new text.

## Status

The marketing site, the patient dashboard, the clinician dashboard, the admin screens, the notification templates, the English string catalogue and the mobile app have all had a pass (2026-10-30). The database-stored message templates have had a pass too (migration `20261030122425`). The legal documents have not: their text is stored as signed, versioned documents in the database, so rewording them is a consent-version change for the owner to make with the consent v2 release, not a copy pass.

Mobile pass (2026-10-30): 37 em dashes and 7 "your doctor" strings were reworded, a developer phrase ("already native") was removed from a patient subtitle, and contractions were expanded in the longer paragraphs. Four hits were left on purpose because they need a human reviewer: the AUDIT-C answer options in `lib/mental-health.ts` (a clinical instrument that mirrors the web copy), `emergency-guidance-modal.tsx`, and the emergency contraception text in `lib/contraception.ts`. The web copies of the video-visit, second-opinion, healthy-ageing and similar strings still carry the old wording.

Update 2026-10-30: the 126 contractions in `apps/web/src/app/(marketing)/_content/resources.ts` were expanded to full forms (rule 5); no wording or fact changed.
