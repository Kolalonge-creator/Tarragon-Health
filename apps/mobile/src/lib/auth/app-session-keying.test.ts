import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * S40 gate finding: App.tsx keyed the identity load and the patient background work on the Session OBJECT. supabase-js hands out a
 * new object on every token refresh (hourly, and whenever lib/api.ts retries a 401 with refreshSession), so each refresh reset
 * identity, remounted the home shell and re-ran push and HealthKit registration; a persistent 401 made that a loop of about 17
 * remounts a second on the iOS simulator. These effects must depend on the user id.
 */
const source = readFileSync(join(__dirname, "../../../App.tsx"), "utf8");

function effectEndingWith(depsLine: string): string {
  const end = source.indexOf(depsLine);
  if (end < 0) throw new Error(`dependency line not found: ${depsLine}`);
  return source.slice(Math.max(0, end - 2500), end);
}

describe("App.tsx effects are keyed on who is signed in, not on the session object", () => {
  it("loads identity on the user id", () => {
    expect(source).toContain("const sessionUserId = session?.user.id;");
    expect(source).toContain("}, [sessionUserId, session === null, retryToken]);");
    expect(source).not.toMatch(/\}, \[session, retryToken\]\);/);
  });

  it("runs the patient background work on the user id", () => {
    expect(source).toContain("}, [sessionUserId, identity, openOwnRecord]);");
    expect(source).not.toMatch(/\}, \[session, identity, openOwnRecord\]\);/);
    expect(effectEndingWith("}, [sessionUserId, identity, openOwnRecord]);")).toContain("registerPushToken(session.user.id, identity.organisationId)");
  });
});
