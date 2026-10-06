import { describe, expect, it } from "@jest/globals";
import { contentToParagraphs, paragraphsToContent, parseOptions } from "./content";

describe("parseOptions", () => {
  it("reads one option per line with a short id", () => {
    expect(parseOptions("a | Give oxygen\nb: Wait and see\n\nc | Refer now")).toEqual([
      { id: "a", text: "Give oxygen" },
      { id: "b", text: "Wait and see" },
      { id: "c", text: "Refer now" },
    ]);
  });

  it("refuses fewer than two options, repeated ids or a malformed line", () => {
    expect(parseOptions("a | only one")).toBeNull();
    expect(parseOptions("a | one\na | two")).toBeNull();
    expect(parseOptions("a | one\nno separator here")).toBeNull();
    expect(parseOptions("")).toBeNull();
  });
});

describe("training paragraphs", () => {
  it("round trips blank-line separated paragraphs", () => {
    const content = paragraphsToContent("First part.\n\n  Second part.  \n\n\n");
    expect(content).toEqual([
      { type: "text", body: "First part." },
      { type: "text", body: "Second part." },
    ]);
    expect(contentToParagraphs(content)).toBe("First part.\n\nSecond part.");
  });
});
