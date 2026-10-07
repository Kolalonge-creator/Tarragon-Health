#!/usr/bin/env node
/**
 * Render the audio masters with ElevenLabs, one MP3 per clip, named exactly as the manifest expects (TH-<ID>-EN.mp3).
 *
 *   ELEVENLABS_API_KEY=... node scripts/audio/generate-elevenlabs.mjs [--out audio/masters] [--only EMG,TRI,NUM-001] [--limit 20] [--dry-run] [--voice <id>]
 *
 * What it does: reads the words each clip says (packages/i18n/src/audio-scripts.ts, the number list CSV and extra-clips.json), asks ElevenLabs
 * to speak them in the voice named in audio/voice.json (or --voice), and writes the file into the output folder. A clip whose file already
 * exists is skipped, so a run can be stopped and resumed and a clip is never paid for twice. --dry-run prints how many clips and characters it
 * WOULD send and calls nothing.
 *
 * What it never does: edit audio/manifest.json, add a sign-off, or copy anything into the app. Rendering is not approval. After a run:
 *   1. node scripts/audio/ingest-recordings.mjs <out folder>   records each file as "recorded, unsigned";
 *   2. a person listens and adds the sign-offs (brand always; clinical for clinical clips; legal for ONB-010 and CON-001);
 *   3. only fully signed bundled files are then copied into the app by the ingest script.
 * INV-04: no clip may explain a positive HIV, hepatitis B or hepatitis C result by recorded audio; none of the scripted clips does, and this
 * script renders only scripted clips.
 *
 * The API key is read from the environment only and is never written to a file or printed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Parse the generated audio-scripts.ts (one `"ID": { en: "<json string>" },` per line). */
export function parseScripts(source) {
  const out = {};
  for (const m of source.matchAll(/^\s*"([A-Z0-9-]+)": \{ en: (".*") \},?$/gm)) out[m[1]] = JSON.parse(m[2]);
  return out;
}

/** Parse the number list CSV: header `ID,Text`, text in double quotes. */
export function parseNumberCsv(csv) {
  const out = {};
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const m = /^([A-Z0-9-]+),"(.*)"$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/""/g, '"');
  }
  return out;
}

/** What each manifest clip should say; reports clips that have no words so nothing is silently skipped. */
export function buildJobs(manifest, scripts, numbers, extras) {
  const jobs = [];
  const missing = [];
  for (const clip of manifest.clips) {
    const text = scripts[clip.id] ?? numbers[clip.id] ?? extras[clip.id];
    for (const key of Object.keys(clip.files)) {
      const file = clip.files[key].file;
      if (!text) {
        missing.push(clip.id);
        continue;
      }
      jobs.push({ id: clip.id, group: clip.group, file, text, clinical: clip.clinical });
    }
  }
  return { jobs, missing: [...new Set(missing)] };
}

function loadJobs() {
  const manifest = JSON.parse(readFileSync(join(ROOT, "audio/manifest.json"), "utf8"));
  const scripts = parseScripts(readFileSync(join(ROOT, "packages/i18n/src/audio-scripts.ts"), "utf8"));
  const numbers = parseNumberCsv(readFileSync(join(ROOT, "audio/source/TH-NUM-number-list.csv"), "utf8"));
  const extras = Object.fromEntries(JSON.parse(readFileSync(join(ROOT, "audio/source/extra-clips.json"), "utf8")).map((e) => [e.id, e.en]));
  return buildJobs(manifest, scripts, numbers, extras);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A clip counts as rendered only if its file is a real, non-trivial MP3: an interrupted run must never leave a partial file that later runs skip. */
export function isRendered(path) {
  if (!existsSync(path)) return false;
  return statSync(path).size >= 1024;
}

async function render(job, voice, apiKey, cfg) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${encodeURIComponent(cfg.output_format)}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: job.text, model_id: cfg.model_id, voice_settings: cfg.voice_settings }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      throw new Error(`ElevenLabs refused the request (HTTP ${res.status}). Check the key and the plan's remaining credits. Nothing more was sent.`);
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * attempt);
      continue;
    }
    throw new Error(`ElevenLabs HTTP ${res.status} for ${job.id}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error(`Gave up on ${job.id} after 4 attempts.`);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n, d) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : d;
  };
  const dry = args.includes("--dry-run");
  const outDir = resolve(flag("--out", join(ROOT, "audio/masters")));
  const only = flag("--only", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const limit = Number(flag("--limit", "0")) || Infinity;
  const cfg = JSON.parse(readFileSync(join(ROOT, "audio/voice.json"), "utf8"));
  const voice = flag("--voice", process.env.ELEVENLABS_VOICE_ID ?? cfg.voice_id);

  const { jobs, missing } = loadJobs();
  if (missing.length) console.warn(`No words found for ${missing.length} clip(s), skipped: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", ..." : ""}`);
  const wanted = jobs.filter((j) => only.length === 0 || only.some((o) => j.id === o || j.group === o));
  const todo = wanted.filter((j) => !isRendered(join(outDir, j.file)));
  const chars = todo.reduce((n, j) => n + j.text.length, 0);
  console.log(`${wanted.length} clips selected, ${wanted.length - todo.length} already rendered, ${todo.length} to render, ${chars.toLocaleString()} characters (about ${chars.toLocaleString()} ElevenLabs credits).`);
  if (dry) return;

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY in your shell first. It is read from the environment only.");
  if (!voice) throw new Error("No voice chosen. Set voice_id in audio/voice.json, or pass --voice, or set ELEVENLABS_VOICE_ID.");
  mkdirSync(outDir, { recursive: true });

  let done = 0;
  for (const job of todo.slice(0, limit)) {
    const audio = await render(job, voice, apiKey, cfg);
    if (audio.length < 1024) throw new Error(`ElevenLabs returned an unusually small file for ${job.id}; nothing was kept.`);
    // Write to a temporary name and rename, so a killed run never leaves a half-written master under the real name.
    const final = join(outDir, job.file);
    writeFileSync(final + ".part", audio);
    renameSync(final + ".part", final);
    done += 1;
    if (done % 10 === 0 || done === Math.min(todo.length, limit)) console.log(`rendered ${done} of ${Math.min(todo.length, limit)} (${job.id})`);
    await sleep(150);
  }
  console.log(`Done: ${done} file(s) in ${outDir}. They are unsigned drafts. Next: node scripts/audio/ingest-recordings.mjs ${outDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
