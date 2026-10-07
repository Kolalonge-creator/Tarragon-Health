import { describe, expect, it } from "@jest/globals";
import {
  describeViolations, FORBIDDEN_PARAM_KEYS, FORBIDDEN_TERMS, forbiddenPayloadKeys, lintRenderFn, lintText, placeholders,
} from "./index.ts";

describe("lintText", () => {
  it("passes neutral wording", () => {
    expect(lintText("Hi, a reminder is waiting for you. Open the Tarragon Health app.")).toEqual([]);
  });
  it("flags conditions, readings, results and medicines, with stems", () => {
    for (const bad of ["Your diabetes check", "blood pressure is high", "your readings", "Lab results are in", "refill due", "Medications ready", "an HIV test", "x-ray done"]) {
      expect(lintText(bad).some((v) => v.kind === "term")).toBe(true);
    }
  });
  it("is case insensitive and matches whole words only", () => {
    expect(lintText("DIABETES").length).toBe(1);
    expect(lintText("Your card was scanned")).toEqual([]);
    expect(lintText("Synlab opens at nine")).toEqual([]);
  });
  it("flags a forbidden placeholder by name, not by value", () => {
    expect(lintText("Take {{drug_name}}")).toEqual([{ kind: "param", match: "drug_name" }]);
    expect(lintText("Hi {{ patient_name }}")).toEqual([]);
    expect(placeholders("a {{x}} b {{ y_z }}")).toEqual(["x", "y_z"]);
  });
  it("flags a blood pressure pair and clinical units", () => {
    expect(lintText("You logged 150/95").some((v) => v.kind === "number")).toBe(true);
    expect(lintText("Level 7.2 mmol/L").some((v) => v.kind === "number")).toBe(true);
    expect(lintText("5 mg").some((v) => v.kind === "number")).toBe(true);
    expect(lintText("Order 20260101").some((v) => v.kind === "number")).toBe(false);
  });
  it("flags emoji that hint at a condition", () => {
    expect(lintText("Time 💊").some((v) => v.kind === "emoji")).toBe(true);
  });
  it("ignores placeholder braces when scanning words", () => {
    expect(lintText("{{person_name}} has not opened the app")).toEqual([]);
  });
  it("escapes a regex character in a term", () => {
    expect(FORBIDDEN_TERMS).toContain("x-ray");
    expect(lintText("An (x-ray) today").length).toBe(1);
  });
});

describe("payload keys", () => {
  it("lists the forbidden keys a payload carries", () => {
    expect(forbiddenPayloadKeys({ drug_name: "a", order_number: "1", reading: 3 })).toEqual(["drug_name", "reading"]);
    expect(FORBIDDEN_PARAM_KEYS).toContain("condition_label");
  });
});

describe("lintRenderFn", () => {
  it("passes a neutral template", () => {
    expect(lintRenderFn((p) => ({ smsText: `Hi ${String(p.patient_name)}, a reminder is waiting.` }))).toEqual([]);
  });
  it("catches a template that interpolates a clinical key even though the source is code", () => {
    const v = lintRenderFn((p) => ({ smsText: `Time for ${String(p.drug_name)}` }));
    expect(v).toContainEqual({ kind: "param", match: "drug_name" });
  });
  it("catches clinical wording in the fixed text of sms, email subject, text and html", () => {
    const v = lintRenderFn(() => ({ smsText: "ok", email: { subject: "Your diabetes plan", html: "<p>lab</p>", text: "your readings" } }));
    expect(v.map((x) => x.match.toLowerCase()).sort()).toEqual(["diabetes", "lab", "readings"]);
  });
  it("de-duplicates a repeated finding", () => {
    const v = lintRenderFn(() => ({ smsText: "diabetes diabetes", email: { subject: "diabetes", html: "diabetes", text: "diabetes" } }));
    expect(v.length).toBe(1);
  });
  it("reports a render function that throws instead of passing silently", () => {
    const v = lintRenderFn(() => { throw new Error("boom"); });
    expect(v[0]?.kind).toBe("unrenderable");
  });
  it("reads a symbol key as undefined", () => {
    expect(lintRenderFn((p) => ({ smsText: String((p as Record<symbol, unknown>)[Symbol.iterator] ?? "none") }))).toEqual([]);
  });
  it("handles a missing email part", () => {
    expect(lintRenderFn(() => ({ smsText: "ok", email: { subject: "s", html: "h" } }))).toEqual([]);
  });
});

it("describes violations as kind:match", () => {
  expect(describeViolations([{ kind: "term", match: "lab" }])).toEqual(["term:lab"]);
});
