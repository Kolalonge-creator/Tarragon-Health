import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { S59D_DRAFT_PATHWAYS, S59D_REVIEW_NOTES } from "@tarragon/symptom-triage-engine";
import { ProtocolRulesDetail, describeCondition } from "./protocol-rules-detail";

describe("the sign-off panel shows every rule and source of a draft version", () => {
  const config = { version: 7, pathways: [...S59D_DRAFT_PATHWAYS] };

  it("describes a condition in plain words, every key ANDed", () => {
    expect(describeCondition({ measurementAtLeast: { key: "systolic", value: 180 }, anyAssociatedSymptom: ["severe_headache"] })).toBe(
      "any of these symptoms: severe_headache AND systolic is 180 or higher",
    );
  });

  it("lists every red-flag rule key, every node key, and the sources and questions of each S59d pathway", () => {
    const html = renderToStaticMarkup(<ProtocolRulesDetail config={config} />);
    for (const p of S59D_DRAFT_PATHWAYS) {
      for (const r of p.redFlagScreen) expect(html).toContain(r.label.replace(/&/g, "&amp;"));
      for (const k of Object.keys(p.nodes)) expect(html).toContain(k);
      const notes = S59D_REVIEW_NOTES[p.key]!;
      for (const q of notes.cmoQuestions) expect(html).toContain(`${q.id}:`);
      for (const s of notes.sources) expect(html).toContain(s.citation.slice(0, 20).replace(/&/g, "&amp;"));
    }
    expect(html).toContain("NOT opened");
  });

  it("refuses to render a config it cannot parse, and says not to sign", () => {
    const html = renderToStaticMarkup(<ProtocolRulesDetail config={{ nope: true }} />);
    expect(html).toContain("Do not sign it");
  });
});
