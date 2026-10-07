import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildJobs, isRendered, parseNumberCsv, parseScripts } from "./generate-elevenlabs.mjs";

test("parseScripts reads one clip per line and unescapes newlines and quotes", () => {
  const src = [
    'export const AUDIO_SCRIPTS = {',
    '  "EMG-001": { en: "Go now.\\n\\nDo not drive." },',
    '  "CON-002": { en: "She said \\"wait\\"." },',
    '};',
  ].join("\n");
  assert.deepEqual(parseScripts(src), { "EMG-001": "Go now.\n\nDo not drive.", "CON-002": 'She said "wait".' });
});

test("parseNumberCsv skips the header and unquotes", () => {
  assert.deepEqual(parseNumberCsv('ID,Text\nNUM-000,"zero"\nNUM-014,"fourteen"\n'), { "NUM-000": "zero", "NUM-014": "fourteen" });
});

test("buildJobs finds words from scripts, numbers and extras, and reports a clip with no words instead of skipping it silently", () => {
  const manifest = {
    clips: [
      { id: "EMG-001", group: "EMG", clinical: true, files: { en: { file: "TH-EMG-001-EN.mp3" } } },
      { id: "NUM-000", group: "NUM", clinical: true, files: { shared: { file: "TH-NUM-000.mp3" } } },
      { id: "NUM-P24", group: "NUM", clinical: true, files: { en: { file: "TH-NUM-P24-EN.mp3" } } },
      { id: "XXX-001", group: "XXX", clinical: false, files: { en: { file: "TH-XXX-001-EN.mp3" } } },
    ],
  };
  const { jobs, missing } = buildJobs(manifest, { "EMG-001": "Go now." }, { "NUM-000": "zero" }, { "NUM-P24": "millimetres of mercury" });
  assert.deepEqual(jobs.map((j) => [j.id, j.file, j.text]), [
    ["EMG-001", "TH-EMG-001-EN.mp3", "Go now."],
    ["NUM-000", "TH-NUM-000.mp3", "zero"],
    ["NUM-P24", "TH-NUM-P24-EN.mp3", "millimetres of mercury"],
  ]);
  assert.deepEqual(missing, ["XXX-001"]);
});

test("isRendered: missing and truncated files are not rendered, a real-sized file is", () => {
  const dir = mkdtempSync(join(tmpdir(), "audio-"));
  assert.equal(isRendered(join(dir, "none.mp3")), false);
  writeFileSync(join(dir, "partial.mp3"), Buffer.alloc(200));
  assert.equal(isRendered(join(dir, "partial.mp3")), false);
  writeFileSync(join(dir, "ok.mp3"), Buffer.alloc(4096));
  assert.equal(isRendered(join(dir, "ok.mp3")), true);
});
