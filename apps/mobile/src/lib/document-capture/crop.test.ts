import { MAX_TRIM_PER_AXIS_PERCENT, MAX_TRIM_PER_EDGE_PERCENT, NO_TRIM, TRIM_STEP_PERCENT, cropRect, isUntouched, rotate, rotatedSize, stepTrim } from "./crop";

describe("document crop and rotate (S43m)", () => {
  it("turns a quarter at a time and wraps", () => {
    expect(rotate(0, "right")).toBe(90);
    expect(rotate(270, "right")).toBe(0);
    expect(rotate(0, "left")).toBe(270);
    expect(rotate(90, "left")).toBe(0);
  });

  it("swaps width and height on a quarter turn only", () => {
    expect(rotatedSize(400, 300, 90)).toEqual({ width: 300, height: 400 });
    expect(rotatedSize(400, 300, 270)).toEqual({ width: 300, height: 400 });
    expect(rotatedSize(400, 300, 180)).toEqual({ width: 400, height: 300 });
    expect(rotatedSize(400, 300, 0)).toEqual({ width: 400, height: 300 });
  });

  it("steps one edge at a time and never below nothing or above the edge limit", () => {
    let t = stepTrim(NO_TRIM, "top", 1);
    expect(t.top).toBe(TRIM_STEP_PERCENT);
    expect(stepTrim(NO_TRIM, "top", -1)).toEqual(NO_TRIM);
    for (let i = 0; i < 30; i += 1) t = stepTrim(t, "top", 1);
    expect(t.top).toBeLessThanOrEqual(MAX_TRIM_PER_EDGE_PERCENT);
  });

  it("never lets opposite edges remove so much that nothing is left to read", () => {
    let t = NO_TRIM;
    for (let i = 0; i < 30; i += 1) {
      t = stepTrim(t, "left", 1);
      t = stepTrim(t, "right", 1);
    }
    expect(t.left + t.right).toBeLessThanOrEqual(MAX_TRIM_PER_AXIS_PERCENT);
    let v = NO_TRIM;
    for (let i = 0; i < 30; i += 1) {
      v = stepTrim(v, "top", 1);
      v = stepTrim(v, "bottom", 1);
    }
    expect(v.top + v.bottom).toBeLessThanOrEqual(MAX_TRIM_PER_AXIS_PERCENT);
  });

  it("says nothing is trimmed as null, so no crop is applied", () => {
    expect(cropRect(1000, 800, 0, NO_TRIM)).toBeNull();
    expect(isUntouched(0, NO_TRIM)).toBe(true);
    expect(isUntouched(90, NO_TRIM)).toBe(false);
  });

  it("computes the crop on the rotated picture, in whole pixels, inside the picture", () => {
    expect(cropRect(1000, 800, 0, { top: 10, bottom: 10, left: 0, right: 20 })).toEqual({ originX: 0, originY: 80, width: 800, height: 640 });
    // after a quarter turn the picture is 800 wide and 1000 tall, so percentages apply to those
    expect(cropRect(1000, 800, 90, { top: 10, bottom: 0, left: 10, right: 0 })).toEqual({ originX: 80, originY: 100, width: 720, height: 900 });
    for (const rect of [cropRect(333, 777, 90, { top: 40, bottom: 30, left: 40, right: 30 }), cropRect(1, 1, 0, { top: 40, bottom: 0, left: 0, right: 0 })]) {
      expect(rect).not.toBeNull();
      expect(rect!.width).toBeGreaterThanOrEqual(1);
      expect(rect!.height).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(rect!.originX) && Number.isInteger(rect!.originY) && Number.isInteger(rect!.width) && Number.isInteger(rect!.height)).toBe(true);
    }
  });
});
