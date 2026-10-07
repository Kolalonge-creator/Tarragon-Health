import { getContentAudioEngine, isPlayableAudioUrl, registerContentAudioEngine } from "./content-audio";

describe("content audio port", () => {
  it("has no engine until a native build registers one", () => {
    expect(getContentAudioEngine()).toBeNull();
  });
  it("registers and clears an engine", () => {
    const engine = { play: async () => undefined, stop: () => undefined };
    registerContentAudioEngine(engine);
    expect(getContentAudioEngine()).toBe(engine);
    registerContentAudioEngine(null);
    expect(getContentAudioEngine()).toBeNull();
  });
  it("only https addresses are playable", () => {
    expect(isPlayableAudioUrl("https://cdn.example.org/a.mp3")).toBe(true);
    expect(isPlayableAudioUrl("http://cdn.example.org/a.mp3")).toBe(false);
    expect(isPlayableAudioUrl("javascript:alert(1)")).toBe(false);
    expect(isPlayableAudioUrl("file:///etc/passwd")).toBe(false);
    expect(isPlayableAudioUrl(null)).toBe(false);
  });
});
