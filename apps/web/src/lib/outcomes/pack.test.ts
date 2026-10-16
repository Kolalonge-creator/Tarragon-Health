import { assertNoCausalWording, packRows, packToCsv, parsePackReply } from "./pack";

const pack = {
  cover: { programme: "Acme staff", range: { from: null, to: null } },
  evaluation_design: "There is no comparison group, so this cannot show what would have happened without the programme.",
  group_figures: { members: { suppressed: true, reason: "small_cell", minimum: 20 } },
  clinical_measures: { hba1c: { withheld: true, reason: "awaiting_cmo_signature" } },
};

describe("sponsor pack rows", () => {
  it("flattens every leaf and writes missing values as withheld", () => {
    const rows = packRows(pack);
    expect(rows.find((r) => r.item === "range.from")?.value).toBe("withheld");
    expect(rows.find((r) => r.section === "clinical_measures")?.value).toBe("true");
  });
  it("builds a CSV when the wording is clean and neutralises spreadsheet formulas", () => {
    const csv = packToCsv(packRows({ ...pack, note: "=HYPERLINK(\"x\")" }));
    expect(csv.split("\r\n")[0]).toBe("section,item,value");
    expect(csv).toContain("'=HYPERLINK");
  });
  it("REFUSES to build a file whose text claims cause", () => {
    const rows = packRows({ ...pack, summary: "Blood pressure fell because of the programme." });
    expect(() => assertNoCausalWording(rows)).toThrow(/because of the programme/);
    expect(() => packToCsv(rows)).toThrow();
  });
  it("allows a sentence that states a limit", () => {
    expect(() => assertNoCausalWording(packRows({ note: "This does not show that the programme caused any change." }))).not.toThrow();
  });
});

describe("parsePackReply", () => {
  it("reads an issued pack and a refusal; nothing else", () => {
    expect(parsePackReply({ ok: true, pack, wording_check: { passed: true } })).not.toBeNull();
    expect(parsePackReply({ ok: false, reason: "causal_wording", hits: ["caused"] })).not.toBeNull();
    expect(parsePackReply({ ok: true, pack })).toBeNull();
    expect(parsePackReply(null)).toBeNull();
  });
});
