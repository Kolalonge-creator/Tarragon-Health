# Speech gold-set scoring specification (Q19)

Vendor neutral. No audio, no network, no model call. Runs on any vendor's transcript once it is converted to the small JSON shape below.

## The gold set
- 24 scripted clips (20 to 30 is the plan; `scaffold.mjs` makes 24 slots). **Scripted, not recorded from real consultations**: staff or actors read a clinician-written script. No real patient, name or reading is ever in it.
- The slots cover 12 scenarios (blood pressure readout, new medication, dose change, glucose readout, side effect report, lab result explanation, antenatal visit, weight-based paediatric dose, refill, allergy and interaction check, negation-heavy symptom history) across 5 accent tags (`yoruba, igbo, hausa, south_south, other`) and 3 conditions (`quiet_room, phone_call, background_noise`). Every clip carries at least one drug name and one number so both rates have denominators (the gate needs at least 30 of each).
- The reference transcript for each clip is written by a clinician from the script, once, and not edited after a vendor has been scored.
- The CMO owns `drug-names.json` (it drives both this scoring and the on-screen highlight on the scribe draft).

## Folder
```
node scripts/asr-eval/scaffold.mjs gold-2026-11     # manifest.json, ref/c01.json ... (empty), hyp/
# fill ref/*.json from the script; run the vendor on each recording; convert its output to hyp/*.json
node scripts/asr-eval/run.mjs gold-2026-11/manifest.json
```
Transcript file (reference and hypothesis alike): `{ "clipId": "c01", "accent": "yoruba", "segments": [ { "speaker": "clinician" | "patient" | "unknown", "text": "..." } ] }`.

## What is measured
- Overall WER, per speaker, per accent tag.
- **Drug-name accuracy** and **number accuracy**, each its own rate: of the drug names (numbers) in the reference, the share heard correctly. A substitution or a deletion is wrong. Spoken numbers are normalised ("one twenty over eighty" is 120 over 80; a lone "one" counts as a number only beside a dose or time word).
- Reported separately and never netted off: drug names or numbers the vendor invented, and negations dropped ("no chest pain" heard as "chest pain").
- Every mismatch is printed with the words around it so a person reads exactly what went wrong.

## The gate (Q19, decision OQ-343: pass mark 95 percent)
`PASS` needs drug-name accuracy at least 95 percent AND number accuracy at least 95 percent, on at least 20 clips and at least 30 occurrences of each. `FAIL` if either is below, however small the set (a vendor already below the mark on 12 clips will not recover on 24). `NOT_ENOUGH_DATA` otherwise. An accent tag with at least 3 clips below the mark is printed as an accent gap even when the total passes. Exit codes: 0 pass (or `--pass-mark none`), 3 fail, 4 not enough data, 1 a listed file is missing, 2 bad usage.

## What a PASS means and does not
It means the vendor met the measurable bar on this set. It does not choose a vendor, does not switch the AI scribe on (AI-017 stays OFF until the CMO approves and runs the evaluations), and does not relax INV-11: a clinician reads and signs every section whatever the score. Run-to-run variance is real: score at least two runs and do not cherry-pick.
