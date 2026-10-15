import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GOVERNED_CONFIG_TABLES } from "@/lib/queries/governed-config-signoff";

/**
 * The hub opens each governed configuration's own manager inline, through a
 * hand-kept map keyed by table name. A table added to the queue without an entry
 * here would silently fall back to a plain link, so this pins the two lists
 * together. (A source scan, because the page module pulls in server-only data
 * loaders that a unit test cannot import.)
 */
describe("sign-off hub inline panels", () => {
  const source = readFileSync(join(__dirname, "page.tsx"), "utf8");
  const block = source.slice(source.indexOf("const CONFIG_PANELS"), source.indexOf("};", source.indexOf("const CONFIG_PANELS")));
  const keys = [...block.matchAll(/^\s{2}([a-z_]+): \(\) =>/gm)].map((m) => m[1]);

  it("has an inline panel for every governed configuration the queue can list", () => {
    expect([...keys].sort()).toEqual(GOVERNED_CONFIG_TABLES.map((t) => t.table).sort());
  });

  it("renders each table's panel from the shared panels folder, not a copy", () => {
    for (const t of GOVERNED_CONFIG_TABLES) {
      const slug = t.slug;
      expect(source).toContain(`../_signoff-panels/${slug}-panel`);
    }
  });

  it("opens an inline panel for each S06 to S10 line that has no governed table (triage draft, both attestations, registry values)", () => {
    expect(source).toContain("inlinePanels[TRIAGE_DRAFT_ITEM_KEY] = <TriageRulesPanel");
    expect(source).toContain('<WordingAttestationPanel kind="c4" />');
    expect(source).toContain('<WordingAttestationPanel kind="pattern" />');
    expect(source).toContain("inlinePanels[PROPOSED_VALUES_ITEM_KEY] = <ProposedValuesPanel");
  });

  it("opens the glucose triage rules inline on the hub, with the guideline basis, so they are never signed unseen (plan item R2)", () => {
    expect(source).toContain("inlinePanels[GLUCOSE_TRIAGE_ITEM_KEY] = <GlucoseTriageRulesPanel");
    const panel = readFileSync(join(__dirname, "../_signoff-panels/glucose-triage-rules-panel.tsx"), "utf8");
    expect(panel).toContain("GLUCOSE_RULE_BASIS");
    expect(panel).toContain("GLUCOSE_CITATIONS");
    expect(panel).toContain("GLUCOSE_WORDING_DATA");
    expect(panel).toContain('code="glucose_care_triage"');
  });

  it("renders an inline confirm panel for each task type that needs the CMO (call the patient, urgent glucose review), integration of P2 and P3", () => {
    expect(source).toContain("inlinePanels[RED_OUTREACH_ITEM_KEY] = <RedOutreachPanel");
    expect(source).toContain("inlinePanels[GLUCOSE_TASK_TYPE_ITEM_KEY] = <GlucoseTaskTypePanel");
  });

  it("shows the S06 to S10 banner and opens the line a link points at", () => {
    expect(source).toContain("<S06S10Banner");
    expect(source).toContain("<OpenOnHash");
  });
});
