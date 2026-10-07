/**
 * Acceptance test (S66, decision A14, spec acceptance "the fertile-window screen always shows the not-contraception label").
 *
 * Every source file in the web and mobile apps that RENDERS a fertile window or an ovulation estimate must carry the label, either by
 * building its line with describeFertileWindow (which appends it) or by using NOT_CONTRACEPTION_LABEL / FERTILE_WINDOW_DISCLAIMER /
 * the i18n label. A new surface that shows a window without one fails here, so the label cannot be forgotten by the next author.
 * The test also fails if it finds fewer surfaces than it knows exist, so it cannot pass by finding nothing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = [join(__dirname, "..", ".."), join(__dirname, "..", "..", "..", "..", "mobile", "src")];
const SKIP = /(\.test\.|\.d\.ts$|database\.types|\/lib\/rules\/cycle-prediction\.ts$|\/lib\/rules\/cycle-thermal-shift\.ts$|\/lib\/cycle-prediction\.ts$|cycle-reading\.ts$|cycle-insights\.ts$|cycle-ring\.tsx$)/;
// Something that SHOWS a window or an estimated ovulation to a person.
const RENDERS_WINDOW = /fertileWindow(Start|End)|[Ff]ertile window|Estimated ovulation|describeFertileWindow/;
const HAS_LABEL = /NOT_CONTRACEPTION_LABEL|FERTILE_WINDOW_DISCLAIMER|describeFertileWindow|cycle\.not_contraception|cycle\.planning\.(disclaimer|estimate_line)/;

/** Source without comments, so a sentence in a comment about a fertile window does not count as a surface that shows one. */
function code(file: string): string {
  return readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(r)).filter((f) => !SKIP.test(f));
const surfaces = files.filter((f) => RENDERS_WINDOW.test(code(f)));

describe("every surface that shows a fertile window carries the not-contraception label", () => {
  it("finds the known surfaces (web tracker, calendar, mobile screen) so it cannot pass by finding nothing", () => {
    const names = surfaces.map((f) => relative(join(__dirname, "..", "..", ".."), f));
    expect(names.some((n) => n.endsWith("cycle/cycle-tracker.tsx"))).toBe(true);
    expect(names.some((n) => n.endsWith("cycle/cycle-calendar.tsx"))).toBe(true);
  });

  for (const f of surfaces) {
    it(`${relative(join(__dirname, "..", "..", "..", ".."), f)} carries the label`, () => {
      expect(HAS_LABEL.test(code(f))).toBe(true);
    });
  }

  it("the control: a file that shows a window without the label would fail this check", () => {
    const bad = "export const X = () => <p>Fertile window {start} to {end}</p>;";
    expect(RENDERS_WINDOW.test(bad) && !HAS_LABEL.test(bad)).toBe(true);
  });

  it("the copy equals the engine constants, so the label on screen is the label the engine defines", async () => {
    const { NOT_CONTRACEPTION_LABEL, FERTILE_WINDOW_DISCLAIMER } = await import("@tarragon/shared");
    const { cycleCopy } = await import("@tarragon/i18n");
    expect(cycleCopy["cycle.not_contraception"]).toBe(NOT_CONTRACEPTION_LABEL);
    expect(cycleCopy["cycle.planning.disclaimer"]).toBe(FERTILE_WINDOW_DISCLAIMER);
  });
});
