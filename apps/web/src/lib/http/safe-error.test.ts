import { GENERIC_ERROR_MESSAGE, safeErrorMessage } from "./safe-error";

describe("safeErrorMessage (security audit 2026-11-05, L-2)", () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  afterEach(() => log.mockClear());

  it("hides a raw Postgres message and logs it on the server", () => {
    const raw = { code: "23505", message: 'duplicate key value violates unique constraint "vitals_readings_pkey"' };
    expect(safeErrorMessage(raw, "mobile/vitals")).toBe(GENERIC_ERROR_MESSAGE);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("vitals_readings_pkey"));
  });

  it("hides a storage error that has no code", () => {
    expect(safeErrorMessage({ message: "new row violates row-level security policy" }, "upload", "Could not save that upload.")).toBe(
      "Could not save that upload."
    );
  });

  it("passes through a message a database function raised on purpose", () => {
    expect(safeErrorMessage({ code: "P0001", message: "That time is no longer free." }, "slot")).toBe("That time is no longer free.");
    expect(log).not.toHaveBeenCalled();
  });

  it("returns the fallback, without logging, when there is no error object", () => {
    expect(safeErrorMessage(null, "x", "Could not book that time.")).toBe("Could not book that time.");
    expect(log).not.toHaveBeenCalled();
  });
});

describe("no API route returns a raw error message (regression scan)", () => {
  // Allowed: a curated refusal (assistedRefusalResponse) and a SQLSTATE 22023 the database raised as readable text.
  // Cron routes answer only the scheduler, never a person, so they are out of scope.
  it("finds none outside the allowed shapes", () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { readdirSync, readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    /* eslint-enable @typescript-eslint/no-require-imports */
    const apiDir = join(__dirname, "..", "..", "app", "api");
    const offenders: string[] = [];
    for (const rel of readdirSync(apiDir, { recursive: true }) as string[]) {
      if (!rel.endsWith("route.ts") || rel.startsWith("cron")) continue;
      readFileSync(join(apiDir, rel), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/error: *[A-Za-z_]+\??\.message\b/.test(line) && !/refused|22023/.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
