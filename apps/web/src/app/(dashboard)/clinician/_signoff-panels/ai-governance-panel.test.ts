/** @jest-environment node */
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/app/(dashboard)/admin/settings/ai-governance/ai-governance-console", () => ({}));
jest.mock("@/app/(dashboard)/admin/settings/ai-governance/ai-approval-list", () => ({}));
jest.mock("@/lib/queries/pending-ai-evaluation-run-reviews", () => ({}));

import { runningUndeployedVersions } from "./ai-governance-panel";

// 2026-11-05: AI-016 and AI-018 were approved and switched on, but only a Clinical Director may mark a clinically meaningful
// system's version deployed, and the button existed only in the admin console a CMO login cannot open.
describe("runningUndeployedVersions", () => {
  const row = (over: Partial<{ approved_at: string | null; deployed_at: string | null; retired_at: string | null; enabled: boolean }>) => ({
    approved_at: "2026-10-29T00:00:00Z",
    deployed_at: null,
    retired_at: null,
    ...over,
    ai_systems: { is_enabled: over.enabled ?? true },
  });

  it("lists an approved, switched-on version with no deployment date", () => {
    expect(runningUndeployedVersions([row({})])).toHaveLength(1);
  });

  it("leaves out unapproved, already deployed, retired and switched-off versions", () => {
    expect(
      runningUndeployedVersions([
        row({ approved_at: null }),
        row({ deployed_at: "2026-11-05T00:00:00Z" }),
        row({ retired_at: "2026-11-05T00:00:00Z" }),
        row({ enabled: false }),
      ]),
    ).toEqual([]);
  });
});
