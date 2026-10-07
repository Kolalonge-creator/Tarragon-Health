# audio

`manifest.json` is the audio manifest (spec 8.8): every clip id, its file per language, size, checksum, duration, sign-offs and bundle group (`bundled`, `post_signup`, `on_demand`). `source/TH-NUM-number-list.csv` is the number list. No recording exists yet, so every clip is "not recorded" and the app shows text.

Do not hand-edit the generated parts.

1. Wording or clip list changes: `python3 scripts/audio/import-production-list.py <Audio-Production-List.docx>`. Keeps recordings and sign-offs for clips whose words did not change; drops them for a clip whose words changed. Rewrites `packages/i18n/src/audio-scripts.ts`.
2. New masters: `node scripts/audio/ingest-recordings.mjs <folder of TH-*.mp3> [--with-sym]`. Records checksum, size and duration, drops sign-offs on a re-recorded file, copies fully signed bundled files into `apps/mobile/assets/audio/` and regenerates the asset map.
3. Sign-offs: a person adds `{review, by, on}` entries to a file's `approvals` in a pull request. Needed per file: brand always; clinical for clinical clips; legal for ONB-010 and CON-001.

Masters (`TH-*.mp3`) are not committed here; they go to the company folder named in the Production List. Only the signed bundled files are copied into the app.
