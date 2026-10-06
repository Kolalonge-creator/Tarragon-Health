import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest, playable } from "@tarragon/audio";
import manifestJson from "../../../../../audio/manifest.json";
import { BUNDLED_AUDIO } from "./bundled-assets.generated";

const ASSETS = join(__dirname, "../../../assets/audio");

/**
 * The app bundles audio by file name, so these checks hold the bundle to the manifest: every bundled file must be a
 * bundled, fully signed clip, with the exact checksum that was signed (a stale take under a new sign-off is refused).
 */
describe("bundled audio matches the manifest", () => {
  const manifest = parseManifest(manifestJson);
  const files = new Map(
    manifest.clips.flatMap((c) => Object.entries(c.files).map(([key, f]) => [f!.file, { clip: c, key, f: f! }] as const)),
  );

  it("lists only bundled, signed files", () => {
    for (const name of Object.keys(BUNDLED_AUDIO)) {
      const hit = files.get(name);
      expect([name, hit?.clip.bundle_group]).toEqual([name, "bundled"]);
      expect([name, playable(hit!.clip, hit!.key === "shared" ? "en" : (hit!.key as "en" | "pcm")).ok]).toEqual([name, true]);
    }
  });

  it("has an asset file with the signed checksum for every listed file, and no other file", () => {
    const onDisk = existsSync(ASSETS) ? readdirSync(ASSETS).filter((n) => n.endsWith(".mp3")).sort() : [];
    expect(onDisk).toEqual(Object.keys(BUNDLED_AUDIO).sort());
    for (const name of onDisk) {
      const sha = createHash("sha256").update(readFileSync(join(ASSETS, name))).digest("hex");
      expect([name, sha]).toEqual([name, files.get(name)!.f.sha256]);
    }
  });
});
