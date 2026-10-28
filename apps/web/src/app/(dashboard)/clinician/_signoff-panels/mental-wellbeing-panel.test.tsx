/** @jest-environment jsdom */
/**
 * The wording attestations used to pre-fill the note box with "Text fingerprint <hash>. Read in full." so the database would count them. The
 * fingerprint must now travel as a hidden field, the note box must be empty and optional, and a slot with no wording set still needs a real note.
 */
import { render } from "@testing-library/react";

jest.mock("@/lib/go-live/actions", () => ({ attestConditionAction: jest.fn() }));
jest.mock("../clinical-signoff/mental-wellbeing-actions", () => ({ signMentalHealthWorklistConfigAction: jest.fn() }));

import { MentalWellbeingPanel } from "./mental-wellbeing-panel";
import { ATTESTATION_SLOTS, wordingFingerprint } from "@/lib/clinical/mental-wellbeing-signoff-model";

const wording = ATTESTATION_SLOTS.find((s) => s.wordingSet === "panic")!;
const cover = ATTESTATION_SLOTS.find((s) => !s.wordingSet)!;

describe("MentalWellbeingPanel attestations", () => {
  it("sends the fingerprint hidden and leaves the note box empty and optional", () => {
    const { container } = render(<MentalWellbeingPanel worklistVersion={null} worklistRules={null} attestations={[wording]} />);
    expect((container.querySelector('input[name="fingerprint"]') as HTMLInputElement).value).toBe(wordingFingerprint("panic"));
    const note = container.querySelector('input[name="note"]') as HTMLInputElement;
    expect(note.value).toBe("");
    expect(note.required).toBe(false);
    expect(container.textContent).not.toMatch(/Text fingerprint/);
  });
  it("still requires a real note, and sends no fingerprint, for an attestation with no wording set", () => {
    const { container } = render(<MentalWellbeingPanel worklistVersion={null} worklistRules={null} attestations={[cover]} />);
    expect(container.querySelector('input[name="fingerprint"]')).toBeNull();
    expect((container.querySelector('input[name="note"]') as HTMLInputElement).required).toBe(true);
  });
});
