import { composerEffect, fromSubmit, fromUpload } from "./compose";
import { composeOutcome } from "./model";

const outcome = (status: Parameters<typeof composeOutcome>[0]["status"], extra: Partial<Parameters<typeof composeOutcome>[0]> = {}) =>
  fromSubmit({ ok: true, outcome: composeOutcome({ status, ...extra }) });

describe("composerEffect", () => {
  it("published: clears the text and the picture, ends the attempt, reloads and closes", () => {
    expect(composerEffect(outcome("published"))).toEqual({
      message: "community.compose.published",
      clearText: true,
      clearPicture: true,
      settleRequestId: true,
      safety: null,
      refresh: true,
      close: true,
    });
  });
  it("held: clears (the post exists), shows the reason", () => {
    const e = composerEffect(outcome("held", { reason: "image" }));
    expect(e).toMatchObject({ message: "community.compose.held.image", clearText: true, clearPicture: true, refresh: true, settleRequestId: true });
  });
  it("blocked and refused: keep the text and the picture so they can be fixed, but end the attempt", () => {
    for (const r of [outcome("blocked", { reason: "contact" }), outcome("refused", { reason: "bad_image" })]) {
      expect(composerEffect(r)).toMatchObject({ clearText: false, clearPicture: false, settleRequestId: true, refresh: false, safety: null });
    }
    expect(composerEffect(outcome("blocked", { reason: "contact" })).message).toBe("community.compose.blocked.contact");
    expect(composerEffect(outcome("refused", { reason: "bad_image" })).message).toBe("community.compose.refused.bad_image");
  });
  it("safety: clears the text AND the picture, shows no message, and asks for the safety card", () => {
    expect(composerEffect(outcome("withheld", { safety_kind: "self_harm" }))).toEqual({
      message: null,
      clearText: true,
      clearPicture: true,
      settleRequestId: true,
      safety: "self_harm",
      refresh: false,
      close: false,
    });
    expect(composerEffect(outcome("withheld", { safety_kind: "emergency" })).safety).toBe("emergency");
  });
  it("a failure with no clear answer keeps everything, including the request id", () => {
    const e = composerEffect({ kind: "failed", message: "community.compose.refused.other", definite: false });
    expect(e).toMatchObject({ clearText: false, clearPicture: false, settleRequestId: false, refresh: false, message: "community.compose.refused.other" });
  });
  it("a failure with a clear no keeps the words but starts a new attempt", () => {
    const e = composerEffect({ kind: "failed", message: "community.compose.refused.other", definite: true });
    expect(e).toMatchObject({ clearText: false, settleRequestId: true });
  });
});

describe("adapters", () => {
  it("fromSubmit carries the failure's definiteness", () => {
    expect(fromSubmit({ ok: false, key: "community.compose.refused.empty", definite: true })).toEqual({ kind: "failed", message: "community.compose.refused.empty", definite: true });
  });
  it("fromUpload maps a picture-route answer the same way as the text route", () => {
    expect(fromUpload({ kind: "outcome", outcome: composeOutcome({ status: "held", reason: "image" }) })).toEqual({
      kind: "outcome",
      outcome: { kind: "held", message: "community.compose.held.image" },
    });
    expect(fromUpload({ kind: "failed", definite: false })).toEqual({ kind: "failed", message: "community.compose.refused.other", definite: false });
  });
});
