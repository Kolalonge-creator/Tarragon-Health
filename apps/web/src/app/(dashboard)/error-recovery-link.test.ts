import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { ROLE_HOME_PATH } from "@/lib/auth/roles";

/**
 * The (dashboard) error boundary is shared by every signed-in role, so its
 * one recovery link must not point at any single role's home. It previously
 * linked to /patient, which proxy.ts bounces for a clinician, admin, finance,
 * pharmacist or coordinator account, leaving the only offered way out of an
 * error screen in a redirect loop.
 *
 * A rendering test would need React plus a Next Link stub for what is really
 * a one-line invariant, so this reads the source instead. It is a guard
 * against the exact regression, not a substitute for rendering the page.
 */
const source = readFileSync(join(__dirname, "error.tsx"), "utf8");

describe("(dashboard) error boundary recovery link", () => {
  it("does not send every role to one role's dashboard", () => {
    for (const home of Object.values(ROLE_HOME_PATH)) {
      expect(source).not.toContain(`href="${home}"`);
    }
  });

  it('offers "/" instead, which proxy.ts resolves per role', () => {
    expect(source).toContain('href="/"');
  });
});
