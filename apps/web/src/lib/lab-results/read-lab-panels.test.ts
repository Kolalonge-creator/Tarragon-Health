/**
 * Regression test (2026-10-28): the CMO sign-off panel for lab ranges read only the active sign-off, which was already signed, so it showed
 * "Signed" with no sign form and a newer drafted version (v4 live) could never be signed from the hub. The panel must be offered the newest
 * unsigned draft newer than the version in force.
 */
jest.mock("server-only", () => ({}));
import { newestWaitingLabDraft } from "./read-lab-panels";

const row = (version: number, over: Partial<{ is_active: boolean; approved_at: string | null }> = {}) => ({
  id: `id-${version}`, version, notes: `v${version}`, created_at: "2026-10-21T00:00:00Z", is_active: false, approved_at: null, ...over,
});

describe("newestWaitingLabDraft", () => {
  it("returns the newest unsigned inactive draft newer than the version in force", () => {
    expect(newestWaitingLabDraft([row(1), row(2, { approved_at: "x" }), row(4), row(5)], 3)?.version).toBe(5);
  });
  it("ignores older unsigned drafts, signed rows and the active row", () => {
    expect(newestWaitingLabDraft([row(1), row(2, { approved_at: "x" }), row(3, { is_active: true, approved_at: "x" })], 3)).toBeNull();
  });
  it("treats everything as newer when nothing is in force", () => {
    expect(newestWaitingLabDraft([row(1)], null)?.version).toBe(1);
  });
});
