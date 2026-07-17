import { describe, expect, it } from "@jest/globals";
import { toCsv } from "./to-csv";

describe("toCsv", () => {
  it("serializes rows with an inferred header", () => {
    const csv = toCsv([
      { currency: "NGN", mrr_minor: 800000 },
      { currency: "USD", mrr_minor: 2000 },
    ]);
    expect(csv).toBe("currency,mrr_minor\r\nNGN,800000\r\nUSD,2000");
  });

  it("uses the explicit column order and header when provided", () => {
    const csv = toCsv([{ b: 2, a: 1 }], ["a", "b"]);
    expect(csv).toBe("a,b\r\n1,2");
  });

  it("quotes cells containing commas, quotes, or newlines (RFC 4180)", () => {
    const csv = toCsv([{ name: "Doe, Jane", note: 'say "hi"', multi: "a\nb" }]);
    expect(csv).toBe('name,note,multi\r\n"Doe, Jane","say ""hi""","a\nb"');
  });

  it("renders null and undefined as empty cells", () => {
    const csv = toCsv([{ a: null, b: undefined, c: 0 }], ["a", "b", "c"]);
    expect(csv).toBe("a,b,c\r\n,,0");
  });

  it("returns just the header when there are no rows but columns are given", () => {
    expect(toCsv([], ["a", "b"])).toBe("a,b");
  });

  it("returns an empty string when there is nothing to serialize", () => {
    expect(toCsv([])).toBe("");
  });
});
