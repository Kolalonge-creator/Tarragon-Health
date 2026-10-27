import { buildCrashEvent, createCrashReporter, parseDsn, type CrashContext } from "./crash-report";
import { scrubMessage, scrubStack } from "./crash-scrub";

const DSN = "https://abc123@o1.ingest.sentry.io/4567";
const CTX: CrashContext = {
  appVersion: "0.1.0",
  runtimeVersion: "0.1.0-native8",
  platform: "android",
  osVersion: "13",
  deviceBrand: "TECNO",
  installId: "11111111-2222-3333-4444-555555555555",
  environment: "production",
};

// Fake tokens are assembled at runtime so no committed literal matches a gitleaks token pattern (jwt, stripe-access-token). Neither is a real credential.
const FAKE_JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghijk"].join(".");
const FAKE_PAYMENT_KEY = ["sk", "live", "51HxyzABCDEFGHIJ"].join("_");

// Realistic strings an error could be built from. Every one must be unrecoverable after scrubbing.
const PHI_CASES: { input: string; mustNotContain: string[] }[] = [
  { input: "invalid reading 142/91 for Ada Obi", mustNotContain: ["142", "91", "Ada", "Obi"] },
  { input: "Failed to save vitals for patient Chinedu Okafor, systolic=188 diastolic=104", mustNotContain: ["Chinedu", "Okafor", "188", "104"] },
  { input: "lookup failed: ada.obi@example.com", mustNotContain: ["ada.obi", "example.com"] },
  { input: "SMS to +2348031234567 rejected", mustNotContain: ["2348031234567", "8031234567"] },
  { input: "call 0803 123 4567 failed", mustNotContain: ["0803", "4567"] },
  { input: 'JSON parse error near {"note":"my chest hurts when I climb stairs","glucose":"11.2 mmol/L"}', mustNotContain: ["chest", "stairs", "11.2"] },
  { input: `Unauthorized: Bearer ${FAKE_JWT}`, mustNotContain: ["eyJ", "abcdefghijk"] },
  { input: "row 6f1c2d3e-9a8b-4c7d-8e6f-0a1b2c3d4e5f not found", mustNotContain: ["6f1c2d3e", "0a1b2c3d4e5f"] },
  { input: "Mrs Funke Adebayo missed metformin 500 mg dose", mustNotContain: ["Funke", "Adebayo", "500"] },
  { input: "weight 82 kg, spo2 94%, pulse 72 bpm out of range", mustNotContain: ["82", "94", "72"] },
  { input: "password=hunter2secret token: abcd1234efgh", mustNotContain: ["hunter2secret", "abcd1234efgh"] },
  { input: `apikey ${FAKE_PAYMENT_KEY} leaked`, mustNotContain: ["51Hxyz", "ABCDEFGHIJ"] },
];

describe("scrubMessage", () => {
  it.each(PHI_CASES)("removes PHI from: $input", ({ input, mustNotContain }) => {
    const out = scrubMessage(input);
    for (const bad of mustNotContain) expect(out).not.toContain(bad);
  });

  it("keeps a useful, non-PHI shape and HTTP statuses", () => {
    const out = scrubMessage("Network request failed: HTTP 503 from upstream");
    expect(out).toContain("HTTP 503");
    expect(out).toContain("Network request failed");
  });

  it("caps length and never throws on odd input", () => {
    expect(scrubMessage("x ".repeat(5000)).length).toBeLessThanOrEqual(203);
    expect(() => scrubMessage(undefined)).not.toThrow();
    expect(() => scrubMessage({ toString: () => { throw new Error("boom"); } })).not.toThrow();
  });
});

describe("scrubStack", () => {
  it("keeps function, file base name and position only", () => {
    const stack = [
      "Error: x",
      "    at readVitals (address at /data/user/0/ng.tarragon/files/index.android.bundle?token=secret:1:2345)",
      "    at index.android.bundle:10:20",
      "garbage line with ada@example.com",
    ].join("\n");
    const frames = scrubStack(stack);
    expect(frames.length).toBeGreaterThan(0);
    const json = JSON.stringify(frames);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("example.com");
    expect(json).not.toContain("/data/user");
  });
});

describe("buildCrashEvent", () => {
  it("contains only allowlisted fields and no PHI", () => {
    const err = new Error("could not sync Zainab Okoro reading 150/95 zainab@example.com");
    const event = buildCrashEvent(err, "global_handler", true, CTX, 1_700_000_000_000, () => 0.5);
    expect(Object.keys(event).sort()).toEqual(
      ["contexts", "dist", "environment", "event_id", "exception", "level", "platform", "release", "sdk", "tags", "timestamp"].sort(),
    );
    const json = JSON.stringify(event);
    for (const bad of ["Zainab", "Okoro", "150/95", "example.com"]) expect(json).not.toContain(bad);
    expect(event.level).toBe("fatal");
    expect(event.tags.runtime_version).toBe("0.1.0-native8");
  });

  it("drops hostile context values rather than forwarding them", () => {
    const event = buildCrashEvent(new Error("x"), "manual", false, { ...CTX, deviceBrand: "Ada's Phone <script>" }, 0);
    expect(event.contexts.device.brand).not.toMatch(/[<>']/);
  });
});

describe("createCrashReporter", () => {
  it("is dormant with no DSN or a malformed one: no fetch, ever", () => {
    const f = jest.fn();
    for (const dsn of [undefined, "", "not a dsn", "http://abc@o1.ingest.sentry.io/1"]) {
      const r = createCrashReporter({ dsn, context: CTX, fetchImpl: f as unknown as typeof fetch });
      expect(r.enabled).toBe(false);
      r.capture(new Error("boom"), "manual");
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("sends a Sentry envelope with scrubbed content and never throws when fetch rejects", async () => {
    const f = jest.fn().mockRejectedValue(new Error("offline"));
    const r = createCrashReporter({ dsn: DSN, context: CTX, fetchImpl: f as unknown as typeof fetch });
    expect(() => r.capture(new Error("bad value for Mr Tunde Bello 160/100"), "promise_rejection")).not.toThrow();
    await new Promise((res) => setTimeout(res, 0));
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, { body: string; method: string }];
    expect(url).toContain("/api/4567/envelope/");
    expect(init.method).toBe("POST");
    expect(init.body).not.toContain("Tunde");
    expect(init.body).not.toContain("160/100");
  });

  it("does not block the caller: capture returns undefined synchronously", () => {
    const f = jest.fn(() => new Promise(() => {}));
    const r = createCrashReporter({ dsn: DSN, context: CTX, fetchImpl: f as unknown as typeof fetch });
    expect(r.capture(new Error("a"), "manual")).toBeUndefined();
  });

  it("de-duplicates identical errors and caps events per process", async () => {
    let t = 0;
    const f = jest.fn().mockResolvedValue({ ok: true });
    const r = createCrashReporter({ dsn: DSN, context: CTX, fetchImpl: f as unknown as typeof fetch, now: () => (t += 10_000), maxEvents: 3 });
    for (let i = 0; i < 5; i++) r.capture(new Error("same"), "manual");
    await new Promise((res) => setTimeout(res, 0));
    expect(f).toHaveBeenCalledTimes(1);
    for (const m of ["a", "b", "c", "d"]) r.capture(new Error(`distinct ${m}`), "manual");
    await new Promise((res) => setTimeout(res, 0));
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("rate limits a burst of distinct non-fatal errors but lets a fatal through", async () => {
    const f = jest.fn().mockResolvedValue({ ok: true });
    const r = createCrashReporter({ dsn: DSN, context: CTX, fetchImpl: f as unknown as typeof fetch, now: () => 1_000 });
    r.capture(new Error("one"), "manual");
    r.capture(new Error("two"), "manual");
    r.capture(new Error("three"), "global_handler", true);
    await new Promise((res) => setTimeout(res, 0));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("writes nothing to disk: the module imports no storage", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require("fs").readFileSync(require("path").join(__dirname, "crash-report.ts"), "utf8") as string;
    expect(src).not.toMatch(/AsyncStorage|SecureStore|expo-sqlite|FileSystem|localStorage/);
  });
});

describe("sabotage: the PHI tests are not vacuous", () => {
  it("every case input really contains each forbidden token before scrubbing", () => {
    for (const { input, mustNotContain } of PHI_CASES) {
      for (const bad of mustNotContain) expect(input).toContain(bad);
    }
  });
});

describe("parseDsn", () => {
  it("requires https and a numeric project", () => {
    expect(parseDsn(DSN)?.endpoint).toBe("https://o1.ingest.sentry.io/api/4567/envelope/");
    expect(parseDsn("https://abc@o1.ingest.sentry.io/notnum")).toBeNull();
  });
});
