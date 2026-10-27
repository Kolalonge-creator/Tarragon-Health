import {
  attestationHolds,
  formatEditRate,
  liveSpans,
  spansFingerprint,
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

  it("is n/a (null), not 0 and not NaN, when the model returned nothing; 0 stays 0 when words were kept", () => {
    expect(formatEditRate(editTelemetryFromPairs([]))).toBe("n/a");
    expect(formatEditRate(editTelemetryFromPairs([{ original: "a b", final: "a b" }]))).toBe("0%");
    expect(formatEditRate(editTelemetryFromPairs([{ original: "a b c d", final: "a b c x" }]))).toBe("50%");
  });

  it("is null, not NaN, with no AI text, and is capped at 1", () => {
    expect(editTelemetryFromPairs([{ original: "", final: "all mine" }])).toMatchObject({ editRate: null, leftUnedited: false });
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

describe("sign gate and attestation (S89 review item 8)", () => {
  it("cannot sign when every span has been removed: an emptied draft has nothing to sign (sabotage: one live span lets it through)", () => {
    let spans = splitIntoSpans(TEXT);
    for (const id of [0, 1, 2]) spans = editSpan(spans, id, "");
    expect(allReviewed(spans)).toBe(true);
    expect(liveSpans(spans)).toEqual([]);
    expect(canSign(spans, true)).toBe(false);
    spans = editSpan(spans, 1, "No fever.");
    expect(canSign(spans, true)).toBe(true);
  });

  it("the attestation holds only for the exact spans it was given for", () => {
    const spans = [0, 1, 2].reduce(acceptSpan, splitIntoSpans(TEXT));
    const attested = spansFingerprint(spans);
    expect(attestationHolds(attested, spans)).toBe(true);
    expect(attestationHolds(null, spans)).toBe(false);
    // any later edit, removal or added span makes it lapse
    expect(attestationHolds(attested, editSpan(spans, 0, "Headache for three days."))).toBe(false);
    expect(attestationHolds(attested, editSpan(spans, 2, ""))).toBe(false);
    const added = [...spans, { id: 3, original: "New.", text: "New.", status: "unreviewed" as const, sep: " " }];
    expect(attestationHolds(attested, added)).toBe(false);
  });
});

describe("line breaks and list structure survive (S89 review item 8)", () => {
  const NOTE = "Plan:\n1. Rest and fluids.\n2. Review in 2 weeks.\n\nAdvice given. Call if worse.";

  it("keeps lines, numbered items and paragraph breaks when reassembled, whatever is accepted", () => {
    const spans = splitIntoSpans(NOTE).map((s) => ({ ...s, status: "accepted" as const }));
    expect(assembleText(spans)).toBe(NOTE);
  });

  it("splits per line and keeps '1.' with its item", () => {
    expect(splitIntoSpans(NOTE).map((s) => s.text)).toEqual(["Plan:", "1. Rest and fluids.", "2. Review in 2 weeks.", "Advice given.", "Call if worse."]);
  });

  it("handles CRLF and bullet lists", () => {
    const t = "- Rest.\r\n- Fluids.";
    expect(assembleText(splitIntoSpans(t).map((s) => ({ ...s, status: "accepted" as const })))).toBe("- Rest.\n- Fluids.");
  });

  it("removing a span keeps the paragraph break that came before it", () => {
    let spans = splitIntoSpans("First point.\n\nSecond point. Third point.");
    spans = editSpan(spans, 1, "");
    spans = [0, 2].reduce(acceptSpan, spans);
    expect(assembleText(spans)).toBe("First point.\n\nThird point.");
  });

  it("removing the first span leaves no leading break", () => {
    let spans = splitIntoSpans("One.\nTwo.");
    spans = editSpan(spans, 0, "");
    expect(assembleText(acceptSpan(spans, 1))).toBe("Two.");
  });
});

describe("sentence splitter (S89 review item 8)", () => {
  const texts = (t: string) => splitIntoSpans(t).map((s) => s.text);

  it("does not break 'Dr. Smith', 'approx. 5 mg' or initials", () => {
    expect(texts("Seen by Dr. Smith today. Give approx. 5 mg daily.")).toEqual(["Seen by Dr. Smith today.", "Give approx. 5 mg daily."]);
    expect(texts("Reviewed by J. Okafor. Stable.")).toEqual(["Reviewed by J. Okafor.", "Stable."]);
  });

  it("does not break at a decimal or before a lowercase word, but does break at ! and ?", () => {
    expect(texts("BP 150.5 over 90. Stable e.g. on treatment.")).toEqual(["BP 150.5 over 90.", "Stable e.g. on treatment."]);
    expect(texts("Any pain? None. Good!")).toEqual(["Any pain?", "None.", "Good!"]);
  });

  it("sabotage: a plain sentence break still splits", () => {
    expect(texts("Headache. Nausea.")).toEqual(["Headache.", "Nausea."]);
  });
});
