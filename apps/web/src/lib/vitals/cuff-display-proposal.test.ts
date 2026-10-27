import { finalisePhotoReading, draftFromRecognisedText } from "@tarragon/shared";
import { normaliseCuffProposal, proposalToRecognisedLines } from "./cuff-display-proposal";

/**
 * Item 6 (cuff display camera). The model output here is MOCKED text-shaped JSON: no photo fixture is used, because no clearly synthetic
 * seven-segment image could be made honestly. What is proved is the deterministic half: refusals, the plausibility ranges, the hand-off to
 * the existing confirm gate, and that a proposal on its own can never become a saved reading.
 */
const good = { display_visible: true, systolic: 128, diastolic: 82, pulse: 71, confidence: "high", note: null };

describe("normaliseCuffProposal", () => {
  it("proposes a clean reading", () => {
    expect(normaliseCuffProposal(good)).toEqual({ ok: true, systolic: 128, diastolic: 82, pulse: 71, confidence: "high", pulseDropped: false });
  });

  it("refuses when no display is visible, or confidence is low, and asks for a retake", () => {
    expect(normaliseCuffProposal({ ...good, display_visible: false })).toMatchObject({ ok: false, reason: "unreadable" });
    expect(normaliseCuffProposal({ ...good, confidence: "low" })).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("refuses output that does not match the schema (a model that rambles)", () => {
    expect(normaliseCuffProposal({ text: "Your pressure is high" })).toMatchObject({ ok: false, reason: "unreadable" });
    expect(normaliseCuffProposal(null)).toMatchObject({ ok: false, reason: "unreadable" });
    expect(normaliseCuffProposal({ ...good, systolic: 128.5 })).toMatchObject({ ok: false });
  });

  it("never offers a half-read pair", () => {
    expect(normaliseCuffProposal({ ...good, systolic: null })).toMatchObject({ ok: false, reason: "incomplete" });
    expect(normaliseCuffProposal({ ...good, diastolic: null })).toMatchObject({ ok: false, reason: "incomplete" });
  });

  it("refuses a top number that is not above the bottom number, and says why", () => {
    const r = normaliseCuffProposal({ ...good, systolic: 80, diastolic: 128 });
    expect(r).toMatchObject({ ok: false, reason: "implausible" });
    expect(r.ok === false && r.impossible).toContain("systolic_not_above_diastolic");
    expect(normaliseCuffProposal({ ...good, systolic: 80, diastolic: 80 })).toMatchObject({ ok: false, reason: "implausible" });
  });

  it("refuses values outside the physiological ranges in devices.plausibility", () => {
    expect(normaliseCuffProposal({ ...good, systolic: 400, diastolic: 82 })).toMatchObject({ ok: false, reason: "implausible" });
    expect(normaliseCuffProposal({ ...good, systolic: 128, diastolic: 3 })).toMatchObject({ ok: false, reason: "implausible" });
  });

  it("keeps an extreme but possible reading: a real crisis is never blocked here", () => {
    expect(normaliseCuffProposal({ ...good, systolic: 220, diastolic: 130 })).toMatchObject({ ok: true, systolic: 220, diastolic: 130 });
  });

  it("drops an impossible pulse instead of sinking a good pair", () => {
    expect(normaliseCuffProposal({ ...good, pulse: 900 })).toMatchObject({ ok: true, pulse: null, pulseDropped: true });
    expect(normaliseCuffProposal({ ...good, pulse: null })).toMatchObject({ ok: true, pulse: null, pulseDropped: false });
  });
});

describe("hand-off to the existing confirm gate", () => {
  const proposal = normaliseCuffProposal(good);

  it("a proposal becomes editable boxes marked as suggestions", () => {
    if (!proposal.ok) throw new Error("expected a proposal");
    const lines = proposalToRecognisedLines(proposal);
    expect(lines).toEqual(["128", "82", "71"]);
    const draft = draftFromRecognisedText("blood_pressure", lines);
    expect(draft.fields.map((f) => [f.field, f.value, f.suggested])).toEqual([
      ["systolic", "128", true],
      ["diastolic", "82", true],
      ["pulse_bpm", "71", true],
    ]);
  });

  it("nothing is saved until every number is ticked: an unticked proposal is refused", () => {
    if (!proposal.ok) throw new Error("expected a proposal");
    const draft = draftFromRecognisedText("blood_pressure", proposalToRecognisedLines(proposal));
    expect(finalisePhotoReading({ draft, edits: {}, confirmedFields: [] })).toMatchObject({ ok: false });
    expect(finalisePhotoReading({ draft, edits: {}, confirmedFields: ["systolic", "diastolic"] })).toMatchObject({ ok: false });
  });

  it("ticked, it becomes the same payload a typed photo reading makes, and an edited number is the person's", () => {
    if (!proposal.ok) throw new Error("expected a proposal");
    const draft = draftFromRecognisedText("blood_pressure", proposalToRecognisedLines(proposal));
    const done = finalisePhotoReading({ draft, edits: { systolic: "130" }, confirmedFields: ["systolic", "diastolic", "pulse_bpm"] });
    expect(done).toMatchObject({ ok: true, held: false, reading: { vital_type: "blood_pressure", systolic: 130, diastolic: 82, pulse_bpm: 71 } });
  });
});
