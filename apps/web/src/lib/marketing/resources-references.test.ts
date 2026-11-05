import { parseReferences } from "./resources-data";

jest.mock("./anon-client", () => ({ marketingAnonClient: () => null }));

describe("article references from the database", () => {
  it("keeps only labelled http(s) links, so the page never renders a javascript: or relative link", () => {
    expect(
      parseReferences([
        { label: "NICE", url: "https://www.nice.org.uk/guidance/ng136" },
        { label: "Bad", url: "javascript:alert(1)" },
        { label: "", url: "https://x.org" },
        { label: "Relative", url: "/resources" },
        "not an object",
      ])
    ).toEqual([{ label: "NICE", url: "https://www.nice.org.uk/guidance/ng136" }]);
    expect(parseReferences(null)).toEqual([]);
  });
});
