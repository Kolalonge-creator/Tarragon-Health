#!/usr/bin/env node
// Usage: node scripts/asr-eval/scaffold.mjs <new-gold-set-dir>
// Creates the folder a gold set lives in: manifest.json with 24 clip slots across the scenario and accent matrix in SCORING.md, an empty
// reference file per clip to be filled by a clinician from the SCRIPT (never from real patient audio), and a hyp/ folder for the vendor's
// transcripts converted to the same shape. Refuses to overwrite an existing folder.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const SCENARIOS = [
  "bp_follow_up_readout", "bp_new_medication_start", "bp_dose_change", "diabetes_follow_up_glucose_readout", "diabetes_new_medication_start",
  "side_effect_report", "lab_result_explanation", "antenatal_visit", "paediatric_weight_based_dose", "refill_request", "allergy_and_interaction_check", "negation_heavy_symptom_history",
];
export const ACCENTS = ["yoruba", "igbo", "hausa", "south_south", "other"];
export const CONDITIONS = ["quiet_room", "phone_call", "background_noise"];

export function buildManifest(count = 24) {
  const clips = [];
  for (let i = 0; i < count; i++) {
    const id = `c${String(i + 1).padStart(2, "0")}`;
    clips.push({
      id,
      scenario: SCENARIOS[i % SCENARIOS.length],
      accent: ACCENTS[i % ACCENTS.length],
      condition: CONDITIONS[i % CONDITIONS.length],
      reference: `ref/${id}.json`,
      hypothesis: `hyp/${id}.json`,
    });
  }
  return { description: "Gold set manifest. Scripted clips only: no real patient, no real recording of a consultation. See SCORING.md.", clips };
}

export function scaffold(dir, count = 24) {
  const root = resolve(dir);
  if (existsSync(root)) throw new Error(`${dir} already exists; choose a new folder`);
  mkdirSync(join(root, "ref"), { recursive: true });
  mkdirSync(join(root, "hyp"), { recursive: true });
  const manifest = buildManifest(count);
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
  for (const c of manifest.clips) {
    writeFileSync(join(root, c.reference), JSON.stringify({ clipId: c.id, accent: c.accent, segments: [{ speaker: "clinician", text: "" }, { speaker: "patient", text: "" }] }, null, 2));
  }
  return root;
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!process.argv[2]) { console.error("usage: node scripts/asr-eval/scaffold.mjs <new-gold-set-dir>"); process.exit(2); }
  try { console.log(`created ${scaffold(process.argv[2])}`); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
}
