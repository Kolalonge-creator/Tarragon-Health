# audio

`manifest.json` is the audio manifest (spec 8.8): every clip id, its file per language, size, checksum, duration, sign-offs and bundle group (`bundled`, `post_signup`, `on_demand`). `source/TH-NUM-number-list.csv` is the number list. No recording exists yet, so every clip is "not recorded" and the app shows text.

Do not hand-edit the generated parts.

Long-form clips (BPC lessons, BRE-01) take their scripts from `source/long-form-scripts.json`, which is generated from `packages/i18n/src/bpc-course.ts` (`UPDATE_BPC_SEED=1 pnpm --filter @tarragon/i18n test bpc-seed`). Run that first, then the importer. A lesson edit changes its script hash, which drops any recording and sign-off for that clip.

1. Wording or clip list changes: `python3 scripts/audio/import-production-list.py <Audio-Production-List.docx>`. Keeps recordings and sign-offs for clips whose words did not change; drops them for a clip whose words changed. Rewrites `packages/i18n/src/audio-scripts.ts`.
2. New masters: `node scripts/audio/ingest-recordings.mjs <folder of TH-*.mp3> [--with-sym]`. Records checksum, size and duration, drops sign-offs on a re-recorded file, copies fully signed bundled files into `apps/mobile/assets/audio/` and regenerates the asset map.
3. Sign-offs: a person adds `{review, by, on}` entries to a file's `approvals` in a pull request. Needed per file: brand always; clinical for clinical clips; legal for ONB-010 and CON-001.

Masters (`TH-*.mp3`) are not committed here; they go to the company folder named in the Production List. Only the signed bundled files are copied into the app.

`source/extra-clips.json` holds clips the Production List does not have yet (today: NUM-P24, the blood pressure unit). The import script adds them; move them into the list at its next version.
