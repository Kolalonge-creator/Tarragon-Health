# DRAFT narration content for S55 and S57

Status of everything in this folder: **DRAFT, awaiting the Chief Medical Officer (CMO).** Nothing here is published, seeded, approved or voiced. No audio has been generated. Every file has `status: DRAFT`, `needs_clinical_review: true`, `reviewer: null`, `reviewed_at: null`, `is_placeholder: false` in its front matter. Setting those is a human decision, made by the CMO, not by this folder.

Drafted 2026-10-07. Written for ElevenLabs narration (plain spoken English, English only per D-14). Maps to the S55 learning tables (myth-busting series, micro-lessons) and the S57 `media_library` (series: intro, stress, grief, work, exams, faith_reflection, sleep; kinds: meditation, sleep_story, breathing).

## What is here (46 items)

| Folder | Items | Library mapping |
|---|---|---|
| `meditations/` | 12 sessions: intro 3, stress 2, grief 2, work 2, exams 1, faith_reflection 2 | S57 kind `meditation` |
| `sleep/` | 8: six sleep stories (Ibadan, Calabar, Jos, Benue, Kano, Enugu) and two wind-down scripts | S57 kind `sleep_story`, series `sleep` |
| `breathing/` | 6 guides | S57 kind `breathing` |
| `myth-busting/` | 10 myth scripts | S55 `myth_busting` series (kind `series`, currently inactive) |
| `bp-care-course/` | 10 daily micro-lessons, each one action and one check question with answer | S55 micro-lessons (`is_micro_lesson`, `lesson_action`) |

`manifest.csv` lists every item (code, title, series, minutes, status, word count). `SOURCES.md` is the source register with the verification status of every citation.

Notes on the manifest: `minutes` is rounded from `estimated_runtime_minutes`, which is words at 90 words a minute (meditation, sleep, breathing) or 125 (myths and lessons) plus the pause markers. It is an estimate, not a recording. Wind-down 02 (about 7.5 min) is just under the 8 minute floor; the six stories are 8.4 to 10.3. Meditation runs 3.3 to 6. Myths run about 2 to 2.3 minutes. Lessons run about 2 minutes.

## Rules the scripts follow (checked by search before commit)

No em dashes. "Your care team", never "your doctor". No cure, instant, guaranteed, free-healthcare or "doctor-led" wording. No dosing advice. No "stop your medicine" advice, and every myth that touches medicine says not to change anything on your own. No fear-based urgency. No religious claims (faith items are non-denominational and prayer is optional). No model, no tracking, no names of real patients.

Every myth ends with the same fixed "get care now" line (one string, reproduced in each file): chest pain, trouble breathing, sudden severe headache, weakness on one side, trouble speaking, confusion, fainting, or very unwell and cannot keep fluids down; go to the nearest hospital or ask someone to take you; do not wait for a call back. The lessons carry a short version. The app also renders its own fixed urgent-help box (template, not content); the scripts do not replace it. **No emergency phone number is given, on purpose** (real Nigerian emergency numbers are still an open ops fact in CLAUDE.md).

## Reviewer checklist for the CMO

Tick per item before any status change. A failed line sends the item back to DRAFT with a note.

1. **Claim check.** Every factual sentence is supported by a listed source. Open the sources marked PARTLY VERIFIED or WEAK in `SOURCES.md` (S7, S9, S12, S16, S17) yourself; they were not fully read.
2. **Local evidence honesty.** Where the evidence is weak or local-only (bitter leaf, seasoning cubes, herb use in Nigeria), the script says so. Confirm the wording is fair.
3. **No dosing, no stop advice.** Nothing tells a patient to start, stop, skip, double or change a medicine or its timing.
4. **Fasting (myth-09).** Confirm the principle (get a plan from your care team before fasting) is right for blood pressure medicines as well as diabetes medicines. The source is diabetes and Ramadan specific.
5. **Safe action.** The one action in each myth and lesson is safe for any adult, including someone with heart disease, pregnancy or kidney problems.
6. **Care-now line.** The fixed line is clinically right and complete. Approve it once; it is the same everywhere.
7. **Measurement technique (bp-lesson-01, 02).** Confirm against the protocol the app actually uses (rest time, arm position, number of readings). The technique was not read from a fetched page.
8. **Salt (myth-06, bp-lesson-05).** WHO 5 g a day is verified. The statement that cubes are widely used and salty rests on secondary Nigerian reports. Approve the qualitative claim or ask for a primary study. If the care team sets a patient target, theirs wins (the scripts say so).
9. **Breathing and meditation safety.** The stop-if-dizzy, chest-pain and lung-condition notes are Tarragon's own precaution (the NHS breathing page has none). Confirm. No script claims it lowers blood pressure or treats anxiety.
10. **Grief and faith items.** Read med-grief-01 and 02 and both faith items for tone. Grief 01 names a route to help (someone close, the care team, the nearest hospital) and does not give a helpline number: the S56 crisis card owns the numbers.
11. **Sleep stories.** Nothing frightening, no hunger or illness imagery, no claim that it treats insomnia. Wind-down 01 mentions sleep apnoea only as "tell your care team"; confirm that fits the S57 screening guard being OFF.
12. **Language.** Plain, no jargon, correct for low literacy listeners. Pronunciation notes are right for Ibadan, Calabar, Jos, Kano, Enugu, Benue, ewuro, onugbu.
13. **Sign-off.** Name, date, and a next review date (a future date). Only then may the item go through the S55 and S57 publish gates (named reviewer, review date, source, self-care step, `next_review_due`, not a placeholder).

## Voice-direction sheet

**Voice style.** One warm adult voice, calm and close, like a kind neighbour who knows things. A Nigerian English accent that a Lagos, Kano or Enugu listener finds natural; clear to a diaspora listener. Not a call-centre voice, not a hospital announcement, not a radio preacher. Smiling but never bubbly. Lower and softer for sleep and grief; a little brighter for myths and lessons. Never urgent, never alarmed. The fixed care-now line is read plainly and slowly, as information, not alarm.

**Pace.** Meditation, sleep, breathing: about 90 words a minute, with long pauses. Myths and lessons: about 125 to 140 words a minute, natural. Breathing counts are read evenly, one beat a second, so the listener can follow. End every sleep story on a long quiet tail and fade out.

**Suggested ElevenLabs settings (a starting point, tune by ear; the setting names and ranges below are from memory, not checked against current ElevenLabs docs in this session).**

| Content | Speed | Stability | Similarity | Style exaggeration | Notes |
|---|---|---|---|---|---|
| Sleep stories, wind-downs | 0.80 to 0.88 | high (about 70 to 80) | about 75 | 0 to 10 | speaker boost off; keep volume low and even |
| Meditation, breathing | 0.85 to 0.92 | about 65 to 75 | about 75 | 0 to 15 | |
| Myth-busting, lessons | 0.95 to 1.0 | about 50 to 60 | about 75 | 10 to 25 | a touch more expression is fine |

Generate one segment per paragraph and join them; this keeps pauses exact and lets you re-take a single line.

**Pause markers.** Scripts use `[pause Ns]` (the seconds are already scaled for the library; do not rescale). Convert to ElevenLabs break tags at generation time. A single break tag is believed to be capped at about 3 seconds, so chain tags for longer pauses (a `[pause 12s]` is four chained 3 second breaks). Too many breaks in one request can make the voice unstable; if so, build the silence in the audio editor instead.

**Pronunciation notes.** Each script lists its own. Say medicines and places plainly. Where a script gives a respelling, use the voice's phoneme or alias feature rather than altering the script text.

**Before any audio is made.** The founder approves voices and credits first. This folder does not authorise generation.

## Rebuilding

Files are generated from the drafting sources; edit the `.md` files directly from here on. After any edit, re-run the checks: search for em dashes, "your doctor", "cure", "instant", "doctor-led"; recount words; update `manifest.csv`.
