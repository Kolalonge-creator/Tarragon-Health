import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "@jest/globals";

/**
 * The audio ingest script was written for English only. These tests run it on a scratch manifest with a TEST-ONLY
 * stub language ("xx"): English output is unchanged, and a stub recording ships only when the caller names the language
 * and the recording is signed against its own checksum and its current source script.
 */
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/audio/ingest-recordings.mjs");

interface Scratch {
  dir: string;
  run: (extra: string[]) => string;
  bundled: () => string[];
  manifest: () => { clips: { files: Record<string, { sha256: string | null; approvals: unknown[] }> }[] };
}

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function scratch(xx: { approvalSha?: string; sourceScriptHash?: string; unrecorded?: boolean }): Scratch {
  const dir = mkdtempSync(join(tmpdir(), "s86-audio-"));
  made.push(dir);
  const folder = join(dir, "masters");
  mkdirSync(folder);
  const bytes = Buffer.from("not really an mp3");
  const sha = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(folder, "TH-ONB-900-EN.mp3"), bytes);
  writeFileSync(join(folder, "TH-ONB-900-XX.mp3"), bytes);
  const signed = (s: string) => [{ review: "brand", by: "test", on: "2026-01-01", sha256: s }];
  const manifest = {
    schema_version: 1,
    languages: ["en"],
    clips: [
      {
        id: "ONB-900",
        group: "ONB",
        bundle_group: "bundled",
        clinical: false,
        legal: false,
        language_neutral: false,
        script_hash: "h1",
        files: {
          en: { file: "TH-ONB-900-EN.mp3", sha256: sha, bytes: bytes.length, duration_ms: null, approvals: signed(sha), history: [] },
          xx: {
            file: "TH-ONB-900-XX.mp3",
            sha256: xx.unrecorded ? null : sha,
            bytes: xx.unrecorded ? null : bytes.length,
            duration_ms: null,
            ...(xx.unrecorded ? {} : { source_script_hash: xx.sourceScriptHash ?? "h1" }),
            approvals: signed(xx.approvalSha ?? sha),
            history: [],
          },
        },
      },
    ],
  };
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const assets = join(dir, "assets");
  const map = join(dir, "map.ts");
  return {
    dir,
    run: (extra) =>
      execFileSync("node", [SCRIPT, folder, "--manifest", manifestPath, "--assets-dir", assets, "--map", map, ...extra], { encoding: "utf8" }),
    bundled: () => readdirSync(assets).sort(),
    manifest: () => JSON.parse(readFileSync(manifestPath, "utf8")),
  };
}

describe("audio ingest with a stub language", () => {
  it("English only by default: the stub recording is ignored and the English output is the same as before", () => {
    const s = scratch({});
    const out = s.run([]);
    expect(out).toContain("recorded 1 file(s); 1 bundled");
    expect(out).toContain("ignored unknown: TH-ONB-900-XX.mp3");
    expect(s.bundled()).toEqual(["TH-ONB-900-EN.mp3"]);
    expect(s.manifest().clips[0].files.xx.approvals).toHaveLength(1);
  });

  it("ships the stub only when the language is named and the recording is signed against its own checksum", () => {
    const s = scratch({});
    expect(s.run(["--languages", "en,xx"])).toContain("recorded 2 file(s); 2 bundled");
    expect(s.bundled()).toEqual(["TH-ONB-900-EN.mp3", "TH-ONB-900-XX.mp3"]);
  });

  it("SABOTAGE: a sign-off for a different recording (hash mismatch) does not ship", () => {
    const s = scratch({ approvalSha: "f".repeat(64) });
    // The approval names another recording's checksum, so the clip is not playable.
    expect(s.run(["--languages", "en,xx"])).toContain("1 bundled");
    expect(s.bundled()).toEqual(["TH-ONB-900-EN.mp3"]);
  });

  it("records the source script a new stub recording was made from (and it still needs its own sign-off)", () => {
    const s = scratch({ unrecorded: true });
    // Approvals were signed for a checksum that is the same bytes, so a first ingest keeps them only if sha matches; here the
    // file is new, so approvals are reset and nothing ships for xx.
    expect(s.run(["--languages", "en,xx"])).toContain("1 bundled");
    const file = s.manifest().clips[0].files.xx as unknown as { source_script_hash: string; approvals: unknown[] };
    expect(file.source_script_hash).toBe("h1");
    expect(file.approvals).toEqual([]);
    expect(s.bundled()).toEqual(["TH-ONB-900-EN.mp3"]);
  });

  it("refuses to delete bundled files of a language the run did not name", () => {
    const s = scratch({});
    s.run(["--languages", "en,xx"]);
    expect(() => s.run([])).toThrow();
    expect(s.bundled()).toEqual(["TH-ONB-900-EN.mp3", "TH-ONB-900-XX.mp3"]);
  });

  it("does not ship a stub recording made from an older source script", () => {
    const s = scratch({ sourceScriptHash: "old" });
    expect(s.run(["--languages", "en,xx"])).toContain("1 bundled");
    expect(s.bundled()).toEqual(["TH-ONB-900-EN.mp3"]);
  });
});
