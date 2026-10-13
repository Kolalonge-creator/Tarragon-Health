/**
 * S06x: encryption at rest depends on build flags no unit test can exercise, so the flags themselves are asserted.
 * apps/mobile/ios is committed prebuild output (EAS will not re-run config plugins for it), so the iOS flag must be in
 * ios/Podfile.properties.json as well as in the app.json plugin that serves Android.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("SQLCipher build flags", () => {
  it("app.json turns on SQLCipher through the expo-sqlite plugin", () => {
    const plugins = (JSON.parse(read("app.json")) as { expo: { plugins: unknown[] } }).expo.plugins;
    const entry = plugins.find((p) => Array.isArray(p) && p[0] === "expo-sqlite") as [string, { useSQLCipher?: boolean }] | undefined;
    expect(entry?.[1]?.useSQLCipher).toBe(true);
  });

  it("ios/Podfile.properties.json sets the same flag (the committed iOS project ignores the plugin)", () => {
    const props = JSON.parse(read("ios/Podfile.properties.json")) as Record<string, string>;
    expect(props["expo.sqlite.useSQLCipher"]).toBe("true");
  });

  it("the runtime version was bumped for the native build", () => {
    const version = (JSON.parse(read("app.json")) as { expo: { runtimeVersion: string } }).expo.runtimeVersion;
    expect(version).not.toBe("0.1.0-native5");
  });
});
