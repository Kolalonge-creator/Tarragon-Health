import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Staff names are typed by hand and often already start with "Dr" ("Dr Isaac Longe"). Any place that prints
 * `Dr. ${name}` must strip the stored title first, or the page reads "Dr. Dr Isaac Longe". This guard fails if a new
 * call site is added without it.
 */
const SRC_ROOT = join(__dirname, "..", "..");
const UNGUARDED = /`Dr\.\s\$\{(?!\s*stripDoctorTitle\()/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("doctor title is never doubled", () => {
  it("every `Dr. ${...}` template strips the stored title", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("//")) return;
          if (UNGUARDED.test(line)) offenders.push(`${file.slice(SRC_ROOT.length + 1)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
