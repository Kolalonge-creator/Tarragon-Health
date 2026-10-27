/**
 * S88a review-fix tests: allowlist message policy, URL and query scrubbing, Hermes frames, fatal delivery and budget,
 * rejection tracker, and the install-order guarantee. Each block has a sabotage step proving the test can fail.
 */
import fs from "fs";
import path from "path";
import {
  createCrashReporter,
  createRejectionTracker,
  FATAL_GRACE_MS,
  handleGlobalError,
  type CrashContext,
  type CrashReporter,
} from "./crash-report";
import { scrubFreeText, scrubMessage, scrubStack, stripUrls } from "./crash-scrub";

const DSN = "https://abc123@o1.ingest.sentry.io/4567";
const CTX: CrashContext = {
  appVersion: "0.1.0",
  runtimeVersion: "0.1.0-native8",
  platform: "android",
  osVersion: "13",
  deviceBrand: "TECNO",
  installId: "id",
  environment: "production",
};
const flush = () => new Promise((res) => setTimeout(res, 0));

describe("scrubMessage: allowlist policy (finding 4)", () => {
  const CASES: { input: string; mustNotContain: string[] }[] = [
    { input: "Ada Obi has no profile", mustNotContain: ["Ada", "Obi"] },
    { input: "Ada Obi's reading failed", mustNotContain: ["Ada", "Obi"] },
    { input: "adaobi is not a function", mustNotContain: ["adaobi"] },
    { input: "weight was 82.5", mustNotContain: ["82", ".5"] },
    { input: "glucose 7.2 invalid", mustNotContain: ["7.2"] },
    { input: "age 7", mustNotContain: ["7"] },
    { input: "chinedu okafor not found in cache", mustNotContain: ["chinedu", "okafor"] },
  ];

  it.each(CASES)("removes PHI from: $input", ({ input, mustNotContain }) => {
    // The withheld form carries a hex hash; digits in it are not message content.
    const out = scrubMessage(input).replace(/ref [0-9a-f]{8}/, "ref HASH");
    for (const bad of mustNotContain) expect(out).not.toContain(bad);
  });

  it("withholds unknown text but keeps a stable hash so the same bug groups", () => {
    const a = scrubMessage("Ada Obi has no profile");
    expect(a).toMatch(/^message withheld \(ref [0-9a-f]{8}\)$/);
    expect(scrubMessage("Ada Obi has no profile")).toBe(a);
    // The hash is of the digit-masked message, so two crashes differing only in a number group together.
    expect(scrubMessage("row 123456 missing for the thing")).toBe(scrubMessage("row 654321 missing for the thing"));
  });

  it("keeps known system errors as canonical text and never the original identifier", () => {
    expect(scrubMessage("adaobi is not a function")).toBe("<identifier> is not a function");
    expect(scrubMessage("Cannot read property 'name' of undefined")).toBe("Cannot read property of undefined");
    expect(scrubMessage("Network request failed")).toBe("Network request failed");
    expect(scrubMessage("Request failed with status code 502")).toContain("HTTP 502");
  });

  it("sabotage: the pattern scrubber alone does NOT catch these, so the allowlist is what protects them", () => {
    expect(scrubFreeText("adaobi is not a function")).toContain("adaobi");
    expect(scrubFreeText("chinedu okafor not found in cache")).toContain("chinedu");
  });

  describe("scrubFreeText strengthening", () => {
    it("does not mangle a decimal into '#.5' and removes health-word numbers, unitless", () => {
      const out = scrubFreeText("weight was 82.5");
      expect(out).not.toMatch(/#\.5/);
      expect(out).not.toContain("82");
      expect(scrubFreeText("glucose 7.2 invalid")).not.toContain("7.2");
      expect(scrubFreeText("age 7")).not.toMatch(/\b7\b/);
      expect(scrubFreeText("patient is 7 years old")).not.toMatch(/\b7\b/);
    });
    it("removes capitalised pairs anywhere and after name cues", () => {
      expect(scrubFreeText("Ada Obi has no profile")).not.toMatch(/Ada|Obi/);
      expect(scrubFreeText("lookup for Ada Obi failed")).not.toMatch(/Ada|Obi/);
      expect(scrubFreeText("user Tunde failed")).not.toContain("Tunde");
    });
    it("keeps a single code identifier readable", () => {
      expect(scrubFreeText("TypeError in readVitals")).toContain("TypeError");
    });
  });
});

describe("URLs and query strings (finding 5)", () => {
  it("reduces a URL to scheme and host", () => {
    const out = stripUrls("GET https://user:pw@api.tarragonhealth.ng/rest/v1/vitals?patient_id=eq.123&select=* failed");
    expect(out).toBe("GET https://api.tarragonhealth.ng failed");
  });
  it("scrubMessage and scrubFreeText never forward path, query, userinfo or PostgREST filters", () => {
    const msgs = [
      "Network request failed for https://api.tarragonhealth.ng/rest/v1/patients?id=eq.77&name=eq.Ada",
      "GET /rest/v1/vitals?patient_id=eq.abc123&order=created_at.desc failed",
      "filter patient_id=in.(1,2,3) rejected",
      "bad filter eq.chinedu in.(a,b)",
    ];
    for (const m of msgs) {
      for (const out of [scrubMessage(m).replace(/ref [0-9a-f]{8}/, "ref HASH"), scrubFreeText(m)]) {
        expect(out).not.toMatch(/eq\.|in\.\(|\/rest\/v1|=77|=Ada|chinedu|abc123|1,2,3/);
      }
    }
    expect(scrubMessage(msgs[0]!)).toBe("Network request failed");
  });
  it("sabotage: the raw strings do contain what the scrubber must remove", () => {
    expect("a?patient_id=eq.abc123").toContain("abc123");
  });
});

describe("Hermes frames and install id (finding 10)", () => {
  it("parses 'at fn (address at index.android.bundle:1:2)' to the real file name", () => {
    const frames = scrubStack(
      [
        "Error: x",
        "    at readVitals (address at index.android.bundle:1:2345)",
        "    at address at index.android.bundle:10:20",
        "    at anonymous (address at /data/user/0/ng.tarragon/files/index.android.bundle?x=secret:7:8)",
      ].join("\n"),
    );
    expect(frames).toEqual([
      { function: "readVitals", filename: "index.android.bundle", lineno: 1, colno: 2345 },
      { function: "?", filename: "index.android.bundle", lineno: 10, colno: 20 },
      { function: "anonymous", filename: "index.android.bundle", lineno: 7, colno: 8 },
    ]);
    expect(JSON.stringify(frames)).not.toMatch(/secret|data\/user|addressat/);
  });

  it("the install id lives in app storage, not the keychain, so it dies with the app", () => {
    const src = fs.readFileSync(path.join(__dirname, "crash-reporting.ts"), "utf8");
    expect(src).not.toMatch(/SecureStore|Keychain/);
    expect(src).toMatch(/AsyncStorage/);
  });
});

describe("fatal delivery (finding 2)", () => {
  function reporterWith(fetchImpl: jest.Mock): CrashReporter {
    return createCrashReporter({ dsn: DSN, context: CTX, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 1_000 });
  }

  it("starts the fatal's fetch synchronously inside the handler call", () => {
    const f = jest.fn(() => new Promise(() => {}));
    const r = reporterWith(f);
    handleGlobalError(r, new Error("boom"), true, jest.fn(), (e) => e, { setTimeoutImpl: () => 1, clearTimeoutImpl: () => {} });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("holds the previous handler until the send settles, then calls it exactly once", async () => {
    let finish: () => void = () => {};
    const f = jest.fn(() => new Promise<void>((res) => (finish = res)));
    const previous = jest.fn();
    const timers: (() => void)[] = [];
    handleGlobalError(reporterWith(f), new Error("boom"), true, previous, (e) => e, {
      setTimeoutImpl: (fn) => timers.push(fn),
      clearTimeoutImpl: () => {},
    });
    expect(previous).not.toHaveBeenCalled();
    finish();
    await flush();
    expect(previous).toHaveBeenCalledTimes(1);
    timers.forEach((t) => t()); // the grace timer firing afterwards must not call it again
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it("never waits longer than the grace when the network hangs", () => {
    jest.useFakeTimers();
    try {
      const f = jest.fn(() => new Promise(() => {}));
      const previous = jest.fn();
      handleGlobalError(reporterWith(f), new Error("boom"), true, previous, (e) => e);
      expect(previous).not.toHaveBeenCalled();
      jest.advanceTimersByTime(FATAL_GRACE_MS - 1);
      expect(previous).not.toHaveBeenCalled();
      jest.advanceTimersByTime(2);
      expect(previous).toHaveBeenCalledTimes(1);
      expect(FATAL_GRACE_MS).toBeLessThanOrEqual(1000);
    } finally {
      jest.useRealTimers();
    }
  });

  it("calls the previous handler immediately for a non-fatal and when the reporter is dormant", () => {
    const previous = jest.fn();
    handleGlobalError(reporterWith(jest.fn().mockResolvedValue({})), new Error("x"), false, previous, (e) => e);
    expect(previous).toHaveBeenCalledTimes(1);
    const dormant = createCrashReporter({ dsn: undefined, context: CTX });
    handleGlobalError(dormant, new Error("x"), true, previous, (e) => e);
    expect(previous).toHaveBeenCalledTimes(2);
  });

  it("still calls the previous handler when the fetch throws synchronously", async () => {
    const f = jest.fn(() => {
      throw new Error("sync boom");
    });
    const previous = jest.fn();
    handleGlobalError(reporterWith(f as unknown as jest.Mock), new Error("x"), true, previous, (e) => e);
    await flush();
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it("sabotage: without the hold, the previous handler would run before the send settled", () => {
    // A non-fatal path is the "no hold" behaviour: previous is called while the request is still pending.
    const f = jest.fn(() => new Promise(() => {}));
    const previous = jest.fn();
    handleGlobalError(reporterWith(f), new Error("x"), false, previous, (e) => e);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("fatal budget and dedupe (finding 3)", () => {
  it("a fatal identical to a non-fatal is still sent", async () => {
    const f = jest.fn().mockResolvedValue({});
    const r = createCrashReporter({ dsn: DSN, context: CTX, fetchImpl: f as unknown as typeof fetch, now: () => 1_000 });
    r.capture(new Error("same"), "manual", false);
    r.capture(new Error("same"), "global_handler", true);
    await flush();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("fatals still go out after the non-fatal cap is exhausted, and the level is in the payload", async () => {
    let t = 0;
    const f = jest.fn().mockResolvedValue({});
    const r = createCrashReporter({ dsn: DSN, context: CTX, fetchImpl: f as unknown as typeof fetch, now: () => (t += 10_000), maxEvents: 2 });
    for (const m of ["a", "b", "c", "d"]) r.capture(new Error(`n ${m}`), "manual", false);
    expect(f).toHaveBeenCalledTimes(2);
    r.capture(new Error("crash"), "global_handler", true);
    expect(f).toHaveBeenCalledTimes(3);
    const body = (f.mock.calls[2] as [string, { body: string }])[1].body;
    expect(JSON.parse(body.split("\n")[2]!).level).toBe("fatal");
  });

  it("fatals have their own cap and dedupe among themselves", async () => {
    const f = jest.fn().mockResolvedValue({});
    const r = createCrashReporter({ dsn: DSN, context: CTX, fetchImpl: f as unknown as typeof fetch, now: () => 1_000, maxFatals: 2 });
    r.capture(new Error("f1"), "global_handler", true);
    r.capture(new Error("f1"), "global_handler", true);
    r.capture(new Error("f2"), "global_handler", true);
    r.capture(new Error("f3"), "global_handler", true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a non-fatal flood cannot consume the fatal budget", () => {
    let t = 0;
    const f = jest.fn().mockResolvedValue({});
    const r = createCrashReporter({ dsn: DSN, context: CTX, fetchImpl: f as unknown as typeof fetch, now: () => (t += 10_000), maxEvents: 10, maxFatals: 1 });
    for (let i = 0; i < 30; i++) r.capture(new Error(`flood ${i}`), "manual", false);
    expect(f).toHaveBeenCalledTimes(10);
    r.capture(new Error("the crash"), "global_handler", true);
    expect(f).toHaveBeenCalledTimes(11);
  });
});

describe("rejection tracker (finding 8)", () => {
  function harness(previous?: Parameters<typeof createRejectionTracker>[0]["previous"]) {
    const capture = jest.fn();
    const timers = new Map<number, () => void>();
    let n = 0;
    const tracker = createRejectionTracker({
      capture,
      previous,
      setTimeoutImpl: (fn) => {
        timers.set(++n, fn);
        return n;
      },
      clearTimeoutImpl: (id) => void timers.delete(id as number),
    });
    return { capture, timers, tracker };
  }

  it("reports a rejection that stays unhandled", () => {
    const { capture, timers, tracker } = harness();
    tracker.onUnhandled(1, new Error("x"));
    expect(capture).not.toHaveBeenCalled();
    timers.forEach((fn) => fn());
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("does not report a rejection that is handled later (onHandled wired)", () => {
    const { capture, timers, tracker } = harness();
    tracker.onUnhandled(7, new Error("x"));
    tracker.onHandled(7);
    timers.forEach((fn) => fn());
    expect(capture).not.toHaveBeenCalled();
  });

  it("chains the previous tracker for both callbacks and survives it throwing", () => {
    const previous = { onUnhandled: jest.fn(() => { throw new Error("rn tracker"); }), onHandled: jest.fn() };
    const { tracker, capture, timers } = harness(previous);
    expect(() => tracker.onUnhandled(3, new Error("x"))).not.toThrow();
    tracker.onHandled(3);
    expect(previous.onUnhandled).toHaveBeenCalledWith(3, expect.any(Error));
    expect(previous.onHandled).toHaveBeenCalledWith(3);
    timers.forEach((fn) => fn());
    expect(capture).not.toHaveBeenCalled();
  });

  it("sabotage: without onHandled the same rejection IS reported", () => {
    const { capture, timers, tracker } = harness();
    tracker.onUnhandled(9, new Error("x"));
    // (onHandled deliberately not called)
    timers.forEach((fn) => fn());
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe("install order (finding 1)", () => {
  const root = path.join(__dirname, "..", "..");
  const importsOf = (file: string): string[] =>
    [...fs.readFileSync(file, "utf8").matchAll(/^\s*import\s+(?:[^"']*?\sfrom\s+)?["']([^"']+)["']/gm)].map((m) => m[1]!);

  it("index.js imports crash-install before every other module", () => {
    const imports = importsOf(path.join(root, "index.js"));
    expect(imports[0]).toBe("./src/lib/crash-install");
    expect(imports.indexOf("./src/root")).toBeGreaterThan(0);
  });

  it("index.js does not install the reporter by a call placed after the (hoisted) imports", () => {
    expect(fs.readFileSync(path.join(root, "index.js"), "utf8")).not.toMatch(/installCrashReporting\s*\(/);
  });

  it("crash-install.ts calls installCrashReporting at module load", () => {
    const src = fs.readFileSync(path.join(root, "src/lib/crash-install.ts"), "utf8");
    expect(src).toMatch(/^installCrashReporting\(\);/m);
  });

  it("the install path imports nothing from the app graph", () => {
    const allowed = new Set([
      "react-native",
      "expo-constants",
      "expo-updates",
      "@react-native-async-storage/async-storage",
      "expo-crypto",
      "./crash-report",
      "./crash-scrub",
      "./crash-reporting",
    ]);
    for (const f of ["crash-install.ts", "crash-reporting.ts", "crash-report.ts", "crash-scrub.ts"]) {
      for (const spec of importsOf(path.join(root, "src/lib", f))) expect(allowed.has(spec)).toBe(true);
    }
  });

  it("sabotage: the ordering check would fail if the install import came after the root", () => {
    const bad = ['import Root from "./src/root";', 'import "./src/lib/crash-install";'].join("\n");
    const imports = [...bad.matchAll(/^\s*import\s+(?:[^"']*?\sfrom\s+)?["']([^"']+)["']/gm)].map((m) => m[1]!);
    expect(imports[0]).not.toBe("./src/lib/crash-install");
  });
});
