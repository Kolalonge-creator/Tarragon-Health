import { describe, expect, it } from "@jest/globals";
import {
  approverLabel,
  canOfferApprove,
  parseDefinitionText,
  protocolRowSchema,
  statusLabel,
  summariseDefinition,
  withBookkeeping,
} from "./titration-review";

describe("statusLabel and canOfferApprove", () => {
  it("labels every status and offers Approve only for a draft", () => {
    expect(statusLabel("draft")).toBe("Draft, not approved");
    expect(statusLabel("approved")).toBe("Approved");
    expect(statusLabel("retired")).toBe("Retired");
    expect(canOfferApprove("draft")).toBe(true);
    expect(canOfferApprove("approved")).toBe(false);
    expect(canOfferApprove("retired")).toBe(false);
  });
});

describe("approverLabel", () => {
  const id = "5b2f3c52-6f29-4d1a-8f3e-1a2b3c4d5e6f";
  it("shows no approver for a draft", () => {
    expect(approverLabel("draft", null, null)).toBeNull();
  });
  it("shows the real name when there is one", () => {
    expect(approverLabel("approved", id, "  Test Name ")).toBe("Test Name");
    expect(approverLabel("retired", id, "Test Name")).toBe("Test Name");
  });
  it("never invents a name when the approver is missing or unnamed", () => {
    expect(approverLabel("approved", null, "Test Name")).toBeNull();
    expect(approverLabel("approved", id, null)).toBe("Approver name not on record");
    expect(approverLabel("approved", id, "   ")).toBe("Approver name not on record");
    expect(approverLabel("approved", id, undefined)).toBe("Approver name not on record");
  });
});

describe("summariseDefinition", () => {
  it("renders params and steps generically", () => {
    const s = summariseDefinition({ params: { someLimit: 3, flag: true }, steps: [{ id: "a", label: "First", requires: [], propose: null }, { id: "b" }] });
    expect(s?.params).toEqual([{ name: "Some limit", value: "3" }, { name: "Flag", value: "true" }]);
    expect(s?.steps[0].heading).toBe("First");
    expect(s?.steps[0].fields).toEqual([{ name: "Id", value: "a" }, { name: "Requires", value: "none" }, { name: "Propose", value: "none" }]);
    expect(s?.steps[1].heading).toBe("b");
  });
  it("degrades safely on malformed input and never prints undefined", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { params: 1, steps: [] }, { params: {}, steps: "no" }]) {
      expect(summariseDefinition(bad)).toBeNull();
    }
    const s = summariseDefinition({ params: { a: undefined, b: { c: [1, { d: null }] } }, steps: [null, 7, { x: undefined }] });
    const text = JSON.stringify(s);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("[object Object]");
    expect(s?.steps).toHaveLength(3);
    expect(s?.steps[0].heading).toBe("Step 1");
  });
});

describe("parseDefinitionText", () => {
  it("refuses empty text, bad JSON and non-objects with plain words", () => {
    expect(parseDefinitionText("   ")).toEqual({ ok: false, errors: [expect.stringContaining("empty")] });
    expect(parseDefinitionText("{nope")).toEqual({ ok: false, errors: [expect.stringContaining("not valid JSON")] });
    expect(parseDefinitionText("[1]").ok).toBe(false);
    expect(parseDefinitionText("3").ok).toBe(false);
  });
  it("accepts an object", () => {
    expect(parseDefinitionText('{"a":1}')).toEqual({ ok: true, definition: { a: 1 } });
  });
});

describe("withBookkeeping", () => {
  it("only stamps code, version and status", () => {
    expect(withBookkeeping({ params: {}, steps: [] }, "some_code")).toEqual({ params: {}, steps: [], code: "some_code", version: 1, status: "draft" });
  });
});

describe("protocolRowSchema", () => {
  it("accepts a draft row with null approver", () => {
    const r = protocolRowSchema.safeParse({ id: "5b2f3c52-6f29-4d1a-8f3e-1a2b3c4d5e6f", code: "x", version: 1, status: "draft", approved_by: null, approved_at: null, note: null, definition: {} });
    expect(r.success).toBe(true);
  });
});
