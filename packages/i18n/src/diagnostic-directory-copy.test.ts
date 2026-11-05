import { describe, expect, it } from "@jest/globals";
import { diagnosticDirectoryCopy } from "./diagnostic-directory-copy";

describe("diagnostic directory copy", () => {
  const values = Object.values(diagnosticDirectoryCopy);
  it("has no em dashes", () => {
    expect(values.filter((v) => v.includes("—"))).toEqual([]);
  });
  it("never calls a listing accredited or a partner better", () => {
    expect(values.filter((v) => /\baccredited\b/i.test(v) || /\bbetter\b/i.test(v))).toEqual([]);
  });
  it("every key is in the dxdir namespace", () => {
    expect(Object.keys(diagnosticDirectoryCopy).filter((k) => !k.startsWith("dxdir."))).toEqual([]);
  });
});
