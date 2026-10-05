import { describe, expect, it } from "@jest/globals";
import { parseEncounterNotesPayload } from "./encounter-notes";

describe("parseEncounterNotesPayload (INV-10)", () => {
  it("returns the notes with scope all for a tied reader", () => {
    expect(parseEncounterNotesPayload({ status: "ok", notes: [{ id: "n1" }] })).toEqual({ notes: [{ id: "n1" }], scope: "all" });
  });

  it("reports own_only for an author who is no longer tied", () => {
    expect(parseEncounterNotesPayload({ status: "own_only", notes: [{ id: "n1" }] }).scope).toBe("own_only");
  });

  it("an empty ok list is an empty list, but a refusal is an error and never an empty list", () => {
    expect(parseEncounterNotesPayload({ status: "ok", notes: [] }).notes).toEqual([]);
    expect(() => parseEncounterNotesPayload({ status: "denied", notes: [] })).toThrow();
  });

  it("a malformed or missing response is an error", () => {
    expect(() => parseEncounterNotesPayload(null)).toThrow();
    expect(() => parseEncounterNotesPayload({ status: "ok" })).toThrow();
    expect(() => parseEncounterNotesPayload({ status: "weird", notes: [] })).toThrow();
  });
});
