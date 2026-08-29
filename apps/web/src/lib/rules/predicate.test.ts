import { describe, expect, it } from "@jest/globals";
import { evaluatePredicate, type Predicate } from "./predicate";

describe("evaluatePredicate", () => {
  it("true/false are unconditional", () => {
    expect(evaluatePredicate({ op: "true" }, {})).toBe(true);
    expect(evaluatePredicate({ op: "false" }, {})).toBe(false);
  });

  it("eq matches only an exact, present value", () => {
    expect(evaluatePredicate({ op: "eq", field: "smoking_status", value: "current" }, { smoking_status: "current" })).toBe(true);
    expect(evaluatePredicate({ op: "eq", field: "smoking_status", value: "current" }, { smoking_status: "never" })).toBe(false);
    expect(evaluatePredicate({ op: "eq", field: "smoking_status", value: "current" }, {})).toBe(false);
    expect(evaluatePredicate({ op: "eq", field: "smoking_status", value: "current" }, { smoking_status: null })).toBe(false);
  });

  it("neq requires the field to be present and different", () => {
    expect(evaluatePredicate({ op: "neq", field: "x", value: 1 }, { x: 2 })).toBe(true);
    expect(evaluatePredicate({ op: "neq", field: "x", value: 1 }, {})).toBe(false);
  });

  it("in checks membership, missing field never matches", () => {
    expect(evaluatePredicate({ op: "in", field: "x", value: [1, 2] }, { x: 2 })).toBe(true);
    expect(evaluatePredicate({ op: "in", field: "x", value: [1, 2] }, { x: 3 })).toBe(false);
    expect(evaluatePredicate({ op: "in", field: "x", value: [1, 2] }, {})).toBe(false);
  });

  it("includes checks array-field membership", () => {
    expect(evaluatePredicate({ op: "includes", field: "tags", value: "a" }, { tags: ["a", "b"] })).toBe(true);
    expect(evaluatePredicate({ op: "includes", field: "tags", value: "z" }, { tags: ["a", "b"] })).toBe(false);
    expect(evaluatePredicate({ op: "includes", field: "tags", value: "a" }, { tags: "a" })).toBe(false);
  });

  it("numeric comparisons are conservative on non-numbers", () => {
    expect(evaluatePredicate({ op: "gte", field: "age", value: 45 }, { age: 50 })).toBe(true);
    expect(evaluatePredicate({ op: "gte", field: "age", value: 45 }, { age: 40 })).toBe(false);
    expect(evaluatePredicate({ op: "gte", field: "age", value: 45 }, { age: "50" })).toBe(false);
    expect(evaluatePredicate({ op: "lt", field: "age", value: 45 }, { age: 40 })).toBe(true);
  });

  it("and/or/not compose", () => {
    const p: Predicate = {
      op: "and",
      clauses: [
        { op: "eq", field: "smoking_status", value: "current" },
        { op: "in", field: "cigarettes_per_day", value: ["11_20", "20_plus"] },
      ],
    };
    expect(evaluatePredicate(p, { smoking_status: "current", cigarettes_per_day: "20_plus" })).toBe(true);
    expect(evaluatePredicate(p, { smoking_status: "current", cigarettes_per_day: "1_5" })).toBe(false);

    const orP: Predicate = { op: "or", clauses: [{ op: "eq", field: "x", value: 1 }, { op: "eq", field: "y", value: 2 }] };
    expect(evaluatePredicate(orP, { y: 2 })).toBe(true);

    expect(evaluatePredicate({ op: "not", clause: { op: "true" } }, {})).toBe(false);
  });

  it("an unrecognised op fails closed (false), never throws", () => {
    const bogus = { op: "eval", code: "1+1" } as unknown as Predicate;
    expect(() => evaluatePredicate(bogus, {})).not.toThrow();
    expect(evaluatePredicate(bogus, {})).toBe(false);
  });
});
