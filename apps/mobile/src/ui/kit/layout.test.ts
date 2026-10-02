import { splitLayoutStyle } from "./layout";

describe("splitLayoutStyle", () => {
  it("puts positioning on the outer touchable and painting on the inner view", () => {
    const { outer, inner } = splitLayoutStyle({ alignSelf: "flex-start", marginTop: 8, backgroundColor: "red", borderRadius: 12, minHeight: 48 });
    expect(outer).toEqual({ alignSelf: "flex-start", marginTop: 8 });
    expect(inner).toEqual({ backgroundColor: "red", borderRadius: 12, minHeight: 48 });
  });

  it("flattens arrays and later entries win", () => {
    const { outer } = splitLayoutStyle([{ flex: 1 }, [{ flex: 2 }, undefined, false]]);
    expect(outer).toEqual({ flex: 2 });
  });

  it("handles no style at all", () => {
    expect(splitLayoutStyle(undefined)).toEqual({ outer: {}, inner: {} });
  });
});
