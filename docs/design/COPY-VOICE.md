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

## Status

First pass covers `apps/web/src/app/(marketing)/_content/` (`products`, `services`, `pillars`, `channel-heroes`). Not yet reviewed: `pricing*.ts`, `resources.ts`, `b2b.ts`, `devices.ts`, the page files under `(marketing)/`, and the patient and clinician dashboards.

Update 2026-10-30: `_content/resources.ts` contractions removed (126 expanded to full forms, no wording or fact changed). Still open in marketing files: 39 uses of "your doctor" (17 in `resources.ts`, 11 in `screening-journey.tsx`), contractions in headlines and page text elsewhere (about 40 in 26 other files), "lab" in four headlines, "escalation" in two patient-facing descriptions, "Mum or Dad" and "Uncontrolled BP".
