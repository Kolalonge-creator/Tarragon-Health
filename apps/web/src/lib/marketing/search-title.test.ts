import { articleSearchTitle, SEARCH_TITLE_MAX } from "./search-title";

describe("article search titles", () => {
  it("keeps the brand suffix when the whole title fits", () => {
    expect(articleSearchTitle("HbA1c explained")).toBe("HbA1c explained");
  });

  it("drops the suffix for a long title instead of letting it be cut", () => {
    const long = "HbA1c: the 3-month sugar test, explained simply for everyone";
    expect(long.length + " | TarragonHealth".length).toBeGreaterThan(SEARCH_TITLE_MAX);
    expect(articleSearchTitle(long)).toEqual({ absolute: long });
  });
});
