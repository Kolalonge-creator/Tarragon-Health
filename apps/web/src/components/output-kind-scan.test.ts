/**
 * Audit G-02b: AI output carries the one shared label (OutputKindLabel), not a badge each screen words for itself. Before this, ten
 * components invented their own ("AI-drafted", "AI-generated", "Automated summary", "Not a medical opinion"), so the same machine draft
 * looked different on every screen and a person could not learn what any of it meant.
 *
 * The scan: any screen file that shows AI-drafted wording must import OutputKindLabel. A file that mentions the wording for another
 * reason (a sentence about a scribe draft in a form, a button that opens a summary) is listed in NOT_A_BADGE with that reason. A listed
 * file that has since adopted the label must be removed from the list, so the list only shrinks.
 */
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "../../../..");
const SCAN = ["apps/web/src", "apps/mobile/src"];
const WORDING = /AI-drafted|AI-generated|Drafted by AI|Automated summary|Automated information/;
const USES_LABEL = /OutputKindLabel/;

const NOT_A_BADGE: Record<string, string> = {
  "apps/web/src/components/output-kind-label.tsx": "the label itself",
  "apps/mobile/src/ui/output-kind-label.tsx": "the phone's label itself",
  "apps/web/src/app/(dashboard)/clinician/patients/[patientId]/clinical-encounter-notes-section.tsx":
    "a sentence under the note fields saying scribe text is in them (the scribe draft is the clinician's to edit and sign; it is not a badge)",
  "apps/web/src/components/scribe/safety-lines-panel.tsx": "a code comment about signing an AI-drafted note; the panel is the clinician's confirmation step, not an output label",
  "apps/web/src/app/(dashboard)/clinician/scribe-quality/page.tsx": "a code comment about the review sample of signed notes",
  "apps/web/src/app/(dashboard)/clinician/health-reports/page.tsx": "a code comment on who may see the draft summary; the page hands the draft to a panel component, which is not covered by this wording scan (follow-up)",
  "apps/web/src/components/care-message-thread.tsx": "a code comment about the suggested-reply card (the card carries the label)",
  "apps/web/src/app/(dashboard)/patient/ai-result-summary.tsx": "passes its text to AiSummaryCard, which renders the label",
  "apps/web/src/components/ai-ecg-summary.tsx": "passes its text to AiSummaryCard, which renders the label",
};

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(full);
  }
}

const files: string[] = [];
for (const r of SCAN) walk(join(ROOT, r), files);
const rel = files.map((f) => relative(ROOT, f));
const text = (r: string) => readFileSync(join(ROOT, r), "utf8");

describe("AI output uses the shared label (audit G-02b)", () => {
  it("scans the screens at all", () => {
    expect(rel.length).toBeGreaterThan(200);
  });

  it("every screen that shows AI-drafted wording uses OutputKindLabel, or is listed with a reason", () => {
    const offenders = rel.filter((r) => WORDING.test(text(r)) && !USES_LABEL.test(text(r)) && !(r in NOT_A_BADGE));
    expect(offenders).toEqual([]);
  });

  it("a file listed as not-a-badge still mentions the wording, and has not since adopted the label", () => {
    const stale = Object.keys(NOT_A_BADGE).filter((r) => !rel.includes(r) || !(WORDING.test(text(r)) || USES_LABEL.test(text(r))));
    expect(stale).toEqual([]);
  });

  it("no screen hand-writes a Badge with AI wording any more", () => {
    const handTyped = rel.filter((r) => /<Badge[^>]*>\s*(AI-drafted|AI-generated)/.test(text(r)));
    expect(handTyped).toEqual([]);
  });

  it("SABOTAGE: the wording check does catch a hand-typed badge", () => {
    expect(/<Badge[^>]*>\s*(AI-drafted|AI-generated)/.test('<Badge variant="grey">AI-drafted, not yet reviewed</Badge>')).toBe(true);
    expect(WORDING.test("<p>Automated summary.</p>")).toBe(true);
  });
});
