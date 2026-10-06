#!/usr/bin/env node
/**
 * Record approved ElevenLabs masters in the audio manifest and bundle the ones the app ships.
 *
 *   node scripts/audio/ingest-recordings.mjs <folder of TH-*.mp3> [--with-sym] [--manifest f] [--assets-dir d] [--map f]
 *
 * For every file in the folder whose name is in `audio/manifest.json`: records its sha256, size and (when ffprobe is
 * installed) duration. A re-recorded file (a different checksum) moves its old recording and sign-offs to `history` and starts
 * unsigned, because a different recording is a different thing to sign; sign-offs are added to the manifest by a person, never by this script.
 *
 * Then copies every PLAYABLE `bundled` recording (all the reviews it needs are signed) into apps/mobile/assets/audio
 * and regenerates the asset map. SYM ships only with --with-sym (spec 8.8: only if the symptom checker is enabled).
 * Prints the bundled size so the app-size budget (audio.bundled_max_bytes) can be checked.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const withSym = args.includes("--with-sym");
const VALUE_FLAGS = new Set(["--manifest", "--assets-dir", "--map"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1]));
const dir = positional[0];
if (!dir) {
  console.error("usage: ingest-recordings.mjs <folder> [--with-sym] [--manifest f] [--assets-dir d] [--map f]");
  process.exit(2);
}
const manifestPath = resolve(flag("--manifest", join(ROOT, "audio/manifest.json")));
const assetsDir = resolve(flag("--assets-dir", join(ROOT, "apps/mobile/assets/audio")));
const mapPath = resolve(flag("--map", join(ROOT, "apps/mobile/src/lib/audio/bundled-assets.generated.ts")));

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function duration(file) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
    const s = Number.parseFloat(out);
    return Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : null;
  } catch {
    return null;
  }
}

const byFile = new Map();
for (const clip of manifest.clips) for (const [key, f] of Object.entries(clip.files)) byFile.set(f.file, { clip, key, f });

const unknown = [];
let updated = 0;
for (const name of readdirSync(dir).filter((n) => n.endsWith(".mp3")).sort()) {
  const hit = byFile.get(name);
  if (!hit) {
    unknown.push(name);
    continue;
  }
  const path = join(dir, name);
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  const { f } = hit;
  if (f.sha256 !== sha256) {
    // The replaced recording keeps its sign-offs in history (so it can be restored); the new one starts unsigned.
    if (f.sha256 !== null) f.history = [{ sha256: f.sha256, bytes: f.bytes, duration_ms: f.duration_ms, approvals: f.approvals }, ...(f.history ?? [])];
    f.approvals = [];
    f.duration_ms = null;
  }
  f.history ??= [];
  f.sha256 = sha256;
  f.bytes = statSync(path).size;
  f.duration_ms = duration(path) ?? f.duration_ms;
  updated += 1;
}

// A file is playable only when every review it needs is signed (same rule as `playable` in packages/audio).
const required = (clip, key) => ["brand", ...(clip.clinical ? ["clinical"] : []), ...(clip.legal ? ["legal"] : []), ...(key === "pcm" ? ["native_pidgin"] : [])];
const playable = (clip, key, f) => f.sha256 !== null && f.bytes !== null && required(clip, key).every((r) => f.approvals.some((a) => a.review === r && a.sha256 === f.sha256));

// Compact manifest: header pretty-printed, one clip per line (matches import-production-list.py).
const head = JSON.stringify({ ...manifest, clips: undefined }, null, 2);
const rows = manifest.clips.map((c) => "    " + JSON.stringify(c)).join(",\n");
writeFileSync(manifestPath, head.slice(0, -2) + ',\n  "clips": [\n' + rows + "\n  ]\n}\n");

// Bundle: keep every playable `bundled` file (copy it from this folder if present, else keep the copy already in
// the assets folder from an earlier batch), and remove only files that are no longer playable or in scope.
mkdirSync(assetsDir, { recursive: true });
const shipped = [];
let bytes = 0;
const missing = [];
for (const clip of manifest.clips) {
  if (clip.bundle_group !== "bundled" || (clip.group === "SYM" && !withSym)) continue;
  for (const [key, f] of Object.entries(clip.files)) {
    if (!playable(clip, key, f)) continue;
    const src = join(dir, f.file);
    const dest = join(assetsDir, f.file);
    if (existsSync(src)) copyFileSync(src, dest);
    else if (!existsSync(dest)) {
      missing.push(f.file);
      continue;
    }
    shipped.push(f.file);
    bytes += f.bytes;
  }
}
for (const name of readdirSync(assetsDir)) if (!shipped.includes(name)) rmSync(join(assetsDir, name));
const rel = (file) => join("../../../assets/audio", file);
const body = shipped.length === 0 ? "" : shipped.map((n) => `  ${JSON.stringify(n)}: require(${JSON.stringify(rel(n))}) as number,`).join("\n") + "\n";
writeFileSync(
  mapPath,
  `/**\n * GENERATED by \`node scripts/audio/ingest-recordings.mjs\`. Do not edit by hand.\n *\n * File name -> Metro asset module id, for every recording in \`apps/mobile/assets/audio/\` that the manifest lists\n * as bundled and fully signed. ${shipped.length === 0 ? "Empty today: no clip has been recorded and signed yet, so every clip shows its text." : `${shipped.length} files.`}\n */\nexport const BUNDLED_AUDIO: Readonly<Record<string, number>> = {\n${body}};\n`,
);

console.log(`recorded ${updated} file(s); ${shipped.length} bundled (${bytes} bytes)${unknown.length ? `; ignored unknown: ${unknown.join(", ")}` : ""}${missing.length ? `; SIGNED BUT NO FILE TO BUNDLE: ${missing.join(", ")}` : ""}`);
