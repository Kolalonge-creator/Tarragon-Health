import {
  checkQtNotShorterThanQrs,
  checkQtcBazettConsistency,
  checkLooksTwelveLead,
} from "./qc";

describe("checkQtNotShorterThanQrs", () => {
  it("flags a QT shorter than QRS as physically impossible", () => {
    const flags = checkQtNotShorterThanQrs(80, 100);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.key).toBe("qt_shorter_than_qrs");
  });

  it("does not flag a normal reading", () => {
    expect(checkQtNotShorterThanQrs(400, 90)).toHaveLength(0);
  });

  it("does not flag when either value is missing", () => {
    expect(checkQtNotShorterThanQrs(null, 90)).toHaveLength(0);
    expect(checkQtNotShorterThanQrs(400, null)).toHaveLength(0);
  });
});

describe("checkQtcBazettConsistency", () => {
  it("does not flag a printed QTc that matches Bazett's formula", () => {
    // QT 400ms, HR 60bpm -> RR 1.0s -> Bazett QTc = 400 / sqrt(1) = 400ms.
    expect(checkQtcBazettConsistency(400, 60, 400)).toHaveLength(0);
  });

  it("does not flag a printed QTc within the formula-variant tolerance", () => {
    // QT 360ms, HR 75bpm -> RR 0.8s -> Bazett QTc ≈ 402ms. A cart computing
    // Fridericia instead would print something close but not identical.
    expect(checkQtcBazettConsistency(360, 75, 415)).toHaveLength(0);
  });

  it("flags a printed QTc that is wildly inconsistent with QT and heart rate", () => {
    // QT 360ms, HR 75bpm -> Bazett QTc ≈ 402ms. A printed QTc of 600ms means
    // at least one of the three numbers was misread.
    const flags = checkQtcBazettConsistency(360, 75, 600);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.key).toBe("qtc_bazett_mismatch");
  });

  it("does not flag when any input is missing", () => {
    expect(checkQtcBazettConsistency(null, 75, 400)).toHaveLength(0);
    expect(checkQtcBazettConsistency(360, null, 400)).toHaveLength(0);
    expect(checkQtcBazettConsistency(360, 75, null)).toHaveLength(0);
  });

  it("does not divide by zero on a nonsensical heart rate", () => {
    expect(() => checkQtcBazettConsistency(360, 0, 400)).not.toThrow();
    expect(checkQtcBazettConsistency(360, 0, 400)).toHaveLength(0);
  });
});

describe("checkLooksTwelveLead", () => {
  it("does not flag when the model reports a genuine 12-lead layout", () => {
    expect(checkLooksTwelveLead(true)).toHaveLength(0);
  });

  it("flags when the model could not confirm a 12-lead layout", () => {
    const flags = checkLooksTwelveLead(false);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.key).toBe("not_twelve_lead_suspected");
  });
});
