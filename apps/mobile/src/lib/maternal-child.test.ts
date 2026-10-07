import { errorKind } from "./maternal-child";

describe("maternal-child error mapping", () => {
  it("55000 (guard closed) reads as not open, 22023 as unavailable, anything else as failed", () => {
    expect(errorKind("55000")).toBe("not_open");
    expect(errorKind("22023")).toBe("unavailable");
    expect(errorKind("42501")).toBe("failed");
    expect(errorKind(undefined)).toBe("failed");
  });
});
