import { splitRecentResults } from "./fold";

const r = (id: string, status?: string) => ({ id, status });
const statusOf = (x: { status?: string }) => x.status;

describe("splitRecentResults", () => {
  it("shows the latest three and folds older normal results", () => {
    const { shown, folded } = splitRecentResults([r("a", "normal"), r("b", "normal"), r("c", "normal"), r("d", "normal"), r("e")], statusOf, 3);
    expect(shown.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(folded.map((x) => x.id)).toEqual(["d", "e"]);
  });
  it("never folds an older result that is not normal", () => {
    const { shown, folded } = splitRecentResults(
      [r("a", "normal"), r("b", "normal"), r("c", "normal"), r("d", "normal"), r("e", "abnormal"), r("f", "critical"), r("g", "borderline")],
      statusOf,
      3,
    );
    expect(shown.map((x) => x.id)).toEqual(["a", "b", "c", "e", "f", "g"]);
    expect(folded.map((x) => x.id)).toEqual(["d"]);
  });
});
