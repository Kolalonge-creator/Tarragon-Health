import {
  acceptSpan,
  allReviewed,
  assembleText,
  canSign,
  changedWordCount,
  editSpan,
  editTelemetryFromPairs,
  editTelemetryFromSpans,
  splitIntoSpans,
  unreviewedCount,
} from "./ai-spans";

const TEXT = "Headache for two days. No fever reported. Advised rest.";

describe("ai spans", () => {
  it("splits a draft into sentence spans, all unreviewed", () => {
    const spans = splitIntoSpans(TEXT);
    expect(spans.map((s) => s.text)).toEqual(["Headache for two days.", "No fever reported.", "Advised rest."]);
    expect(unreviewedCount(spans)).toBe(3);
  });

  it("an empty draft has no spans and cannot be signed even when attested", () => {
    expect(splitIntoSpans("   ")).toEqual([]);
    expect(canSign([], true)).toBe(false);
  });

  it("sign is disabled while any span is unreviewed, even when attested (sabotage: accepting the last one flips it)", () => {
    let spans = splitIntoSpans(TEXT);
    spans = acceptSpan(acceptSpan(spans, 0), 1);
    expect(canSign(spans, true)).toBe(false);
    spans = acceptSpan(spans, 2);
    expect(allReviewed(spans)).toBe(true);
    expect(canSign(spans, true)).toBe(true);
  });

  it("sign is disabled without the attestation, even when every span is reviewed", () => {
    const spans = [0, 1, 2].reduce(acceptSpan, splitIntoSpans(TEXT));
    expect(canSign(spans, false)).toBe(false);
  });

  it("editing a span reviews it and marks it edited; empty text removes it; the original text is kept", () => {
    let spans = splitIntoSpans(TEXT);
    spans = editSpan(spans, 1, "Fever reported since yesterday.");
    expect(spans[1]).toMatchObject({ status: "edited", original: "No fever reported." });
    spans = editSpan(spans, 2, "  ");
    expect(spans[2]?.status).toBe("removed");
    expect(assembleText(spans)).toBe("Headache for two days. Fever reported since yesterday.");
  });

  it("retyping the original text counts as an explicit accept, not an edit", () => {
    expect(editSpan(splitIntoSpans(TEXT), 0, "Headache for two days.")[0]?.status).toBe("accepted");
  });

  it("accepting does not overwrite an edited span", () => {
    const spans = acceptSpan(editSpan(splitIntoSpans(TEXT), 0, "Changed."), 0);
    expect(spans[0]?.status).toBe("edited");
  });
});

describe("edit-rate telemetry", () => {
  it("counts word-level changes", () => {
    expect(changedWordCount("a b c d", "a b c d")).toBe(0);
    expect(changedWordCount("a b c d", "a b x d")).toBe(2);
    expect(changedWordCount("a b c d", "")).toBe(4);
    expect(changedWordCount("", "x y")).toBe(2);
  });

  it("all spans accepted unchanged is rate 0 and flagged leftUnedited (the rubber-stamp alarm figure)", () => {
    const spans = [0, 1, 2].reduce(acceptSpan, splitIntoSpans(TEXT));
    const t = editTelemetryFromSpans(spans);
    expect(t.editRate).toBe(0);
    expect(t.leftUnedited).toBe(true);
    expect(t.aiWords).toBe(9);
  });

  it("an edited and a removed span raise the rate and clear leftUnedited", () => {
    let spans = [0, 1, 2].reduce(acceptSpan, splitIntoSpans(TEXT));
    spans = editSpan(spans, 1, "No fever reported today.");
    spans = editSpan(spans, 2, "");
    const t = editTelemetryFromSpans(spans);
    expect(t.leftUnedited).toBe(false);
    expect(t.changedWords).toBe(1 + 2);
    expect(t.editRate).toBeCloseTo(3 / 9);
  });

  it("is zero, not NaN, with no AI text, and is capped at 1", () => {
    expect(editTelemetryFromPairs([{ original: "", final: "all mine" }])).toMatchObject({ editRate: 0, leftUnedited: false });
    expect(editTelemetryFromPairs([{ original: "a", final: "x y z w" }]).editRate).toBe(1);
  });

  it("works on section pairs (the scribe panel's shape)", () => {
    const t = editTelemetryFromPairs([
      { original: "Rest and fluids.", final: "Rest and fluids." },
      { original: "Call if worse.", final: "Call if worse or if fever." },
    ]);
    expect(t.changedWords).toBe(3);
    expect(t.leftUnedited).toBe(false);
  });
});
