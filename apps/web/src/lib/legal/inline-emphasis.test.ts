import { splitEmphasis } from "./inline-emphasis";

describe("legal text bold marks", () => {
  it("turns **x** into bold parts and keeps the rest as plain text", () => {
    expect(splitEmphasis("**Refunds.** You can ask within 21 days.")).toEqual([
      { bold: true, text: "Refunds." },
      { bold: false, text: " You can ask within 21 days." },
    ]);
  });

  it("leaves text with no marks, or an unpaired mark, exactly as typed", () => {
    expect(splitEmphasis("Plain sentence.")).toEqual([{ bold: false, text: "Plain sentence." }]);
    expect(splitEmphasis("A ** stray mark")).toEqual([{ bold: false, text: "A ** stray mark" }]);
  });

  it("never turns text into markup", () => {
    const parts = splitEmphasis("**<script>alert(1)</script>**");
    expect(parts).toEqual([{ bold: true, text: "<script>alert(1)</script>" }]);
  });
});
