# Tarragon Health: instructions for Claude Code

Read `docs/BUILD-SPEC-v5.md` 

1. Build in the milestone order. A milestone is done only when its acceptance tests pass in CI.
3. Clinical thresholds, deadlines, fees and protocol content live in versioned configuration. Values marked PROPOSED are loaded as configuration and must not be hard-coded.
4. Every user-facing string uses the i18n catalogues in `packages/i18n` (English `en`, Nigerian Pidgin `pcm`). No em dashes in user-facing copy. Never use the words cure, instant doctor, free healthcare or "your doctor"; say "your care team".
5. Money is integer kobo everywhere.
6. `packages/clinical` and `packages/queue` are pure TypeScript with 100 percent branch coverage.
7. Never call a language model in the triage path. Never write AI output to the patient record without a clinician signature.
8. When something is unclear or conflicts with an invariant, add it to `docs/OPEN-QUESTIONS.md` and stop that piece of work rather than guessing.
9. Never commit secrets. Test data is always flagged `is_test`.
11. Reference platforms named against a function are for studying behaviour and functionality and design study. do not ocvertly plagiarise another company's code, text, content or visual design you can design something similar but uniquew to prvent any legal issue
