import { buildSentryOptions, DEFAULT_TRACES_SAMPLE_RATE, parseSampleRate } from "./options";
import { scrubPiiBeforeSend } from "./scrub-pii";

describe("buildSentryOptions", () => {
  it("returns null when there is no DSN, so Sentry stays opt-in", () => {
    expect(buildSentryOptions(undefined, {})).toBeNull();
    expect(buildSentryOptions("", { environment: "production" })).toBeNull();
  });

  it("builds options with the PII scrubber, no default PII, the environment and the release", () => {
    const o = buildSentryOptions("https://k@o1.ingest.sentry.io/1", { environment: "production", nodeEnv: "production", release: "abc123" });
    expect(o).not.toBeNull();
    expect(o?.beforeSend).toBe(scrubPiiBeforeSend);
    expect(o?.sendDefaultPii).toBe(false);
    expect(o?.environment).toBe("production");
    expect(o?.release).toBe("abc123");
  });

  it("falls back from the Vercel environment to NODE_ENV and leaves release undefined when unknown", () => {
    const o = buildSentryOptions("https://k@o1.ingest.sentry.io/1", { nodeEnv: "development" });
    expect(o?.environment).toBe("development");
    expect(o?.release).toBeUndefined();
  });

  it("defaults the trace sample rate to 0.1, not the old 1.0", () => {
    expect(buildSentryOptions("https://k@o1.ingest.sentry.io/1", {})?.tracesSampleRate).toBe(DEFAULT_TRACES_SAMPLE_RATE);
    expect(DEFAULT_TRACES_SAMPLE_RATE).toBe(0.1);
  });
});

describe("parseSampleRate", () => {
  it.each([
    ["0.25", 0.25],
    ["0", 0],
    ["1", 1],
    [undefined, 0.1],
    ["", 0.1],
    ["abc", 0.1],
    ["-1", 0.1],
    ["2", 0.1],
  ])("%p becomes %p", (raw, expected) => {
    expect(parseSampleRate(raw)).toBe(expected);
  });
});
