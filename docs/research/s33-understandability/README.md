# Understandability test for the BP care course (S33)

Three gates. A lesson is shown to patients only after the CMO has reviewed it (OQ-302); these gates tell the CMO and the writers what to fix first. Nothing here replaces clinical review.

## Gate 1: automatic (runs on every build)

`packages/i18n/src/bpc-course.test.ts`, on every lesson: under five minutes recorded at a calm pace, short sentences, English reading grade at or under 8.5, one action and one teach-back question, numbers written as words (the voice reads them), no medicine name, dose, mmHg figure, herb claim or banned word, and the warning-signs lesson routes to emergency care.

## Gate 2: people (manual; the kit is here, the test is not yet run, OQ-306)

1. Score each draft lesson with two raters on the PEMAT (understandability and actionability, printable version for the text, audiovisual for the audio) and the CDC Clear Communication Index. Use the official AHRQ and CDC sheets; `pemat-scoring-sheet.csv` and `cci-scoring-sheet.csv` here are blank result sheets (one column per lesson, 1 yes, 0 no, blank not applicable) with item topics paraphrased and UNVERIFIED against the official items. Fix a lesson under 70 percent on PEMAT or under 90 on the Index before any participant sees it. `percentScore` in `packages/i18n/src/understandability.ts` does the sum.
2. Recruit 10 to 15 adults with high blood pressure or at risk, (English only, D-14). Mixed literacy (3 to 4 with low literacy), ages, gender, phone type. At least one site outside Lagos. Pay for their time. Offer every item read aloud by the interviewer so reading ability never blocks someone.
3. One session each, 30 minutes, on the participant's own phone or a test phone with an `is_test` account (INV-13): play or read one lesson, then no looking back.
4. Ask, in this order, without leading: what was the main message in your own words; what would you do today; is any word or phrase hard; is anything hard to believe or wrong for you.
5. Record one row per participant per lesson in `participant-session-sheet.csv`: recalled the message (Y or N), named the right action (Y or N), any unsafe misunderstanding (Y or N, with the words in notes), a hard word, interviewer read it aloud (Y or N).
6. Score: `node scripts/learning/score-understandability.mjs <sheet.csv>`. Pass is the PROPOSED `learning.understandability_pass_rule` (owner CMO): at least 10 participants, at least 80 percent give the message and the action, and no unsafe misunderstanding. One unsafe misunderstanding fails the lesson at any size: rewrite and retest with new participants. A lesson with fewer than 10 participants is reported "too_few", never "pass".
7. Keep a list of the words that confused people and feed it back into the lesson wording.

## Gate 3: in the app (aggregate only)

Each lesson ends with "Was this lesson clear?" (clear or not clear), stored as the existing `helpful` and `unclear` reactions, and the teach-back answer (`understood` or `needs_review` with a score). `health_education_analytics` gives an admin per-lesson counts: views, understood, needs review, helpful, unclear. No staff screen shows an individual patient's answers, and test accounts are excluded (INV-13). A lesson with a high "not clear" share goes back to the CMO and the writer.

## Not done

No participant has been recruited, no lesson has been scored by raters, and no lesson has a recording. "Ready" means the kit and the build exist.
