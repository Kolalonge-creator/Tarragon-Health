import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRecording } from "./bundle";
import { parseManifest, playable } from "./manifest";
import { REPO_ROOT } from "./test-helpers";
import type { Manifest } from "./types";

const SCRIPT = join(REPO_ROOT, "scripts/audio/ingest-recordings.mjs");

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "audio-ingest-"));
  const masters = join(root, "masters");
  mkdirSync(masters);
  const manifest = join(root, "manifest.json");
  copyFileSync(join(REPO_ROOT, "audio/manifest.json"), manifest);
  const assets = join(root, "assets");
  const map = join(root, "map.ts");
  const run = (...extra: string[]) =>
    execFileSync("node", [SCRIPT, masters, "--manifest", manifest, "--assets-dir", assets, "--map", map, ...extra], { encoding: "utf8" });
  const read = () => parseManifest(JSON.parse(readFileSync(manifest, "utf8")));
  const sign = (names: string[]) => {
    const m = JSON.parse(readFileSync(manifest, "utf8")) as { clips: { clinical: boolean; legal: boolean; files: Record<string, { file: string; approvals: unknown[] }> }[] };
    for (const c of m.clips)
      for (const [key, f] of Object.entries(c.files))
        if (names.includes(f.file)) {
          const reviews = ["brand", ...(c.clinical ? ["clinical"] : []), ...(c.legal ? ["legal"] : []), ...(key === "pcm" ? ["native_pidgin"] : [])];
          f.approvals = reviews.map((review) => ({ review, by: "Test Reviewer", on: "2026-10-06" }));
        }
    writeFileSync(manifest, JSON.stringify(m));
  };
  return { masters, manifest, assets, map, run, read, sign };
}

describe("scripts/audio/ingest-recordings.mjs", () => {
  it("records checksum and size, ignores unknown files, and bundles nothing that is not signed", () => {
    const w = workspace();
    writeFileSync(join(w.masters, "TH-EMG-001-EN.mp3"), "emergency audio");
    writeFileSync(join(w.masters, "TH-NUM-148.mp3"), "one hundred and forty-eight");
    writeFileSync(join(w.masters, "TH-NOT-A-CLIP.mp3"), "?");
    const out = w.run();
    expect(out).toMatch(/recorded 2 file\(s\); 0 bundled/);
    expect(out).toMatch(/ignored unknown: TH-NOT-A-CLIP.mp3/);
    const m = w.read();
    const emg = m.clips.find((c) => c.id === "EMG-001")!.files.en!;
    expect(emg).toMatchObject({ bytes: 15 });
    expect(emg.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(emg.approvals).toEqual([]);
    expect(existsSync(w.assets)).toBe(false);
    expect(readFileSync(w.map, "utf8")).toContain("= {\n};");
  });

  it("matches applyRecording for the same file", () => {
    const w = workspace();
    writeFileSync(join(w.masters, "TH-EMG-001-EN.mp3"), "emergency audio");
    w.run();
    const viaScript = w.read();
    const sha = viaScript.clips.find((c) => c.id === "EMG-001")!.files.en!.sha256!;
    const base = parseManifest(JSON.parse(readFileSync(join(REPO_ROOT, "audio/manifest.json"), "utf8")));
    const viaTs = applyRecording(base, "TH-EMG-001-EN.mp3", { sha256: sha, bytes: 15, durationMs: null }) as Manifest;
    expect(viaScript.clips.find((c) => c.id === "EMG-001")).toEqual(viaTs.clips.find((c) => c.id === "EMG-001"));
  });

  it("bundles a recording only once every review it needs is signed, and agrees with `playable`", () => {
    const w = workspace();
    writeFileSync(join(w.masters, "TH-EMG-001-EN.mp3"), "emergency audio");
    writeFileSync(join(w.masters, "TH-TRI-001-EN.mp3"), "well done");
    w.run();
    w.sign(["TH-EMG-001-EN.mp3"]);
    const out = w.run();
    expect(out).toMatch(/1 bundled \(15 bytes\)/);
    expect(existsSync(join(w.assets, "TH-EMG-001-EN.mp3"))).toBe(true);
    expect(existsSync(join(w.assets, "TH-TRI-001-EN.mp3"))).toBe(false);
    expect(readFileSync(w.map, "utf8")).toContain('"TH-EMG-001-EN.mp3": require("../../../assets/audio/TH-EMG-001-EN.mp3") as number');
    const m = w.read();
    expect(playable(m.clips.find((c) => c.id === "EMG-001")!, "en").ok).toBe(true);
    expect(playable(m.clips.find((c) => c.id === "TRI-001")!, "en").ok).toBe(false);
  });

  it("drops the sign-offs when a clip is re-recorded, and stops bundling it", () => {
    const w = workspace();
    writeFileSync(join(w.masters, "TH-EMG-001-EN.mp3"), "emergency audio");
    w.run();
    w.sign(["TH-EMG-001-EN.mp3"]);
    w.run();
    writeFileSync(join(w.masters, "TH-EMG-001-EN.mp3"), "a different take");
    const out = w.run();
    expect(out).toMatch(/0 bundled/);
    expect(w.read().clips.find((c) => c.id === "EMG-001")!.files.en!.approvals).toEqual([]);
    expect(existsSync(join(w.assets, "TH-EMG-001-EN.mp3"))).toBe(false);
  });

  it("ships SYM only with --with-sym, and never ships post-sign-up or on-demand groups", () => {
    const w = workspace();
    for (const n of ["TH-SYM-001-EN.mp3", "TH-NAV-001-EN.mp3", "TH-RES-001-EN.mp3"]) writeFileSync(join(w.masters, n), n);
    w.run();
    w.sign(["TH-SYM-001-EN.mp3", "TH-NAV-001-EN.mp3", "TH-RES-001-EN.mp3"]);
    expect(w.run()).toMatch(/0 bundled/);
    expect(w.run("--with-sym")).toMatch(/1 bundled/);
    expect(existsSync(join(w.assets, "TH-SYM-001-EN.mp3"))).toBe(true);
    expect(existsSync(join(w.assets, "TH-NAV-001-EN.mp3"))).toBe(false);
  });

  it("keeps clips bundled from an earlier folder when a later batch is ingested (regression: the assets folder was wiped)", () => {
    const w = workspace();
    writeFileSync(join(w.masters, "TH-EMG-001-EN.mp3"), "emergency audio");
    w.run();
    w.sign(["TH-EMG-001-EN.mp3"]);
    w.run();
    const batch2 = mkdtempSync(join(tmpdir(), "audio-batch2-"));
    writeFileSync(join(batch2, "TH-NUM-148.mp3"), "148");
    execFileSync("node", [SCRIPT, batch2, "--manifest", w.manifest, "--assets-dir", w.assets, "--map", w.map]);
    w.sign(["TH-NUM-148.mp3"]);
    const out = execFileSync("node", [SCRIPT, batch2, "--manifest", w.manifest, "--assets-dir", w.assets, "--map", w.map], { encoding: "utf8" });
    expect(out).toMatch(/2 bundled/);
    expect(existsSync(join(w.assets, "TH-EMG-001-EN.mp3"))).toBe(true);
    expect(readFileSync(w.map, "utf8")).toContain("TH-EMG-001-EN.mp3");
  });

  it("needs a folder", () => {
    expect(() => execFileSync("node", [SCRIPT], { stdio: "pipe" })).toThrow();
  });
});
