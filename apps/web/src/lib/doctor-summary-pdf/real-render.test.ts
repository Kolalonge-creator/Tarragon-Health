import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The one test that renders a real PDF. react-pdf is ESM only and this Jest is CommonJS, so the render runs in a child process
 * under tsx (the same renderer the route uses, the same fonts) and the file is read back. When `pdftotext` is on the machine the
 * printed text is checked as well; when it is not (some CI images), the structural checks still run.
 */
const webRoot = path.resolve(__dirname, "../../..");
const tsx = path.join(webRoot, "node_modules/.bin/tsx");
const haveTsx = existsSync(tsx);
const haveText = spawnSync("pdftotext", ["-v"]).status !== null && spawnSync("pdftotext", ["-v"]).error === undefined;

(haveTsx ? describe : describe.skip)("real PDF render", () => {
  let dir = "";
  let file = "";
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "doctor-summary-"));
    file = path.join(dir, "summary.pdf");
    const r = spawnSync(tsx, ["src/lib/doctor-summary-pdf/render-sample.tsx", file], { cwd: webRoot, encoding: "utf8", timeout: 90_000 });
    if (r.status !== 0) throw new Error(`render failed: ${r.stderr}`);
  }, 120_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes a real PDF file", () => {
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5_000);
  });

  (haveText ? it : it.skip)("prints the ticked sections, the labels and the footer, and nothing reproductive", () => {
    const r = spawnSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
    const text = r.stdout.replace(/\s+/g, " ");
    expect(text).toContain("Patient summary for a visit");
    expect(text).toContain("Average of 12 home cuff and typed readings: 135/84 mmHg");
    expect(text).toContain("wearable estimate, not in the average");
    // headings are printed in capitals by the style, so they are compared in capitals
    expect(text).toContain("BLOOD PRESSURE OVER TIME");
    expect(text).toContain("Amlodipine, 5 mg: every day at 08:00");
    expect(text).toContain("90% (19 of 21 doses)");
    expect(text).toContain("felt well, felt fine after supper");
    expect(text).toContain("Patient-generated summary, not a clinical document");
    expect(text).not.toMatch(/testicular|should never print/i);
  });
});
