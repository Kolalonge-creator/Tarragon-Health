import { describe, expect, it } from "@jest/globals";
import { parseDoseLogPayload } from "./dose-log";

describe("parseDoseLogPayload (INV-10)", () => {
  it("returns the rows for a tied reader, and an empty ok list is an empty list", () => {
    expect(parseDoseLogPayload({ status: "ok", rows: [{ id: "l1" }] })).toEqual({ status: "ok", rows: [{ id: "l1" }] });
    expect(parseDoseLogPayload({ status: "ok", rows: [] })).toEqual({ status: "ok", rows: [] });
  });

  it("a refusal is denied, never an empty list", () => {
    expect(parseDoseLogPayload({ status: "denied", rows: [] })).toEqual({ status: "denied" });
  });

  it("a malformed or missing response is an error, never an empty list", () => {
    for (const bad of [null, undefined, "x", {}, { status: "ok" }, { status: "weird", rows: [] }]) {
      expect(parseDoseLogPayload(bad).status).toBe("error");
    }
  });
});
