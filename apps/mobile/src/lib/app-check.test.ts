import { appCheckHeaders, resetAppCheckForTests, APP_CHECK_HEADER, type AppCheckBackend } from "./app-check";

function backend(token: string | null | Error, initError?: Error): AppCheckBackend & { inits: boolean[] } {
  const inits: boolean[] = [];
  return {
    inits,
    async init(debug) {
      inits.push(debug);
      if (initError) throw initError;
      return async () => {
        if (token instanceof Error) throw token;
        return token;
      };
    },
  };
}

beforeEach(() => resetAppCheckForTests());

describe("appCheckHeaders", () => {
  it("adds the token on Android, initialising App Check once", async () => {
    const b = backend("tok-123");
    await expect(appCheckHeaders({ platform: "android", debug: false, backend: b })).resolves.toEqual({ [APP_CHECK_HEADER]: "tok-123" });
    await appCheckHeaders({ platform: "android", debug: false, backend: b });
    expect(b.inits).toEqual([false]);
  });

  it("sends nothing on iOS until App Attest is set up", async () => {
    const b = backend("tok");
    await expect(appCheckHeaders({ platform: "ios", backend: b })).resolves.toEqual({});
    expect(b.inits).toEqual([]);
  });

  it("fails open when the native module is missing or the attestation fails", async () => {
    await expect(appCheckHeaders({ platform: "android", backend: backend("x", new Error("no native module")) })).resolves.toEqual({});
    resetAppCheckForTests();
    await expect(appCheckHeaders({ platform: "android", backend: backend(new Error("integrity refused")) })).resolves.toEqual({});
    resetAppCheckForTests();
    await expect(appCheckHeaders({ platform: "android", backend: backend(null) })).resolves.toEqual({});
  });

  it("never waits longer than the timeout for a slow attestation", async () => {
    const slow: AppCheckBackend = {
      async init() {
        return () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 5000));
      },
    };
    const started = Date.now();
    await expect(appCheckHeaders({ platform: "android", backend: slow, timeoutMs: 50 })).resolves.toEqual({});
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
