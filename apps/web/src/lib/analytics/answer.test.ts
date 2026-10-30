import { describe, expect, it } from "@jest/globals";
import { AnalyticsRefusedError, isRefusedAnswer, parseAnalyticsAnswer } from "./answer";
import {
  businessSummarySchema,
  financeInputsSchema,
  governanceSummarySchema,
  patientActivitySchema,
  patientSearchSchema,
} from "./schemas";

/**
 * Every analytics RPC answers a caller who is not an analyst with an empty
 * answer, and every object schema turns `{}` into a full set of zeros. These
 * pin the guard that stops that reading as a healthy "nothing yet", and, as
 * importantly, what it leaves alone.
 */

describe("the bug the guard exists for", () => {
  it("the schemas alone turn a refused answer into believable zeros", () => {
    // Not a test of the guard: a statement of the problem. If a schema ever
    // stops doing this the guard becomes belt-and-braces, which is fine, but
    // this is the reason it was written.
    expect(businessSummarySchema.parse({}).total_patients).toBe(0);
    expect(governanceSummarySchema.parse({}).risk).toEqual({});
  });
});

describe("isRefusedAnswer", () => {
  it("is true only for a plain object with no keys", () => {
    expect(isRefusedAnswer({})).toBe(true);
  });

  it.each([
    ["an object with a key", { total: 0 }],
    ["an empty array", []],
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["zero", 0],
    // Neither has an own key, and neither is an answer an RPC can give.
    ["a Date", new Date(0)],
    ["a Map", new Map()],
  ])("is false for %s", (_label, value) => {
    expect(isRefusedAnswer(value)).toBe(false);
  });

  it("still counts an object with no prototype as a plain empty object", () => {
    expect(isRefusedAnswer(Object.create(null))).toBe(true);
  });
});

describe("parseAnalyticsAnswer", () => {
  it("rejects the empty object instead of parsing it to zeros", () => {
    expect(() => parseAnalyticsAnswer(businessSummarySchema, {})).toThrow(AnalyticsRefusedError);
    expect(() => parseAnalyticsAnswer(patientActivitySchema, {})).toThrow(AnalyticsRefusedError);
  });

  it("names the error so a caller can tell a refusal from a bad payload", () => {
    try {
      parseAnalyticsAnswer(businessSummarySchema, {});
      throw new Error("expected a refusal");
    } catch (e) {
      expect((e as Error).name).toBe("AnalyticsRefusedError");
    }
  });

  it("still parses a real answer", () => {
    const parsed = parseAnalyticsAnswer(businessSummarySchema, { total_patients: 31 });
    expect(parsed.total_patients).toBe(31);
  });

  it("passes an array through, including an empty one", () => {
    // About seventeen RPCs return an array, and for them a refusal is `[]`,
    // identical to a legitimately empty result (no finance inputs saved yet).
    // Nothing on the client can tell those apart, so the guard must not claim
    // to: rejecting `[]` would break every genuinely empty list.
    expect(parseAnalyticsAnswer(financeInputsSchema, [])).toEqual([]);
    expect(parseAnalyticsAnswer(patientSearchSchema, [])).toEqual([]);
  });

  it("does not turn a malformed payload into a refusal", () => {
    let caught: unknown;
    try {
      parseAnalyticsAnswer(businessSummarySchema, { total_patients: "many" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(AnalyticsRefusedError);
  });

  it("leaves a null answer to the schema to judge", () => {
    let caught: unknown;
    try {
      parseAnalyticsAnswer(patientActivitySchema, null);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(AnalyticsRefusedError);
  });
});
