/**
 * Review (S52, INV-05): a short, vague message that is really low mood or giving up must never be answered with symptom questions. It goes to
 * the model, whose own self-harm flag is the second net after the keyword screen.
 */
import { describe, expect, it } from "@jest/globals";
import { decideClarification } from "./clarify";

describe("oblique distress is not clarified", () => {
  it.each(["I feel bad, I can't go on", "I feel off, I want to give up", "I feel bad and there's no point", "I feel weak and worthless"])("%s", (message) => {
    expect(decideClarification({ message, priorMessages: [] })).toBeNull();
  });
  it("an ordinary vague symptom is still clarified", () => {
    expect(decideClarification({ message: "it hurts", priorMessages: [] })).not.toBeNull();
  });
});
