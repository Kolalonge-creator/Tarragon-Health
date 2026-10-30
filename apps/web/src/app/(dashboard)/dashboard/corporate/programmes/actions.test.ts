/**
 * An access check that cannot complete is not a refusal: the action reports a
 * retryable problem and writes nothing, rather than throwing out of the form.
 */
jest.mock("server-only", () => ({}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

const accessCheck = jest.fn();
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: async () => ({ id: "u-1", organisation_id: "org-1" }),
}));
jest.mock("@/lib/institutions/aggregate-access", () => ({
  requireInstitutionAggregateAccess: (...a: unknown[]) => accessCheck(...a),
}));

import { requestCampaignFromTemplateAction } from "./actions";

describe("requestCampaignFromTemplateAction access check", () => {
  beforeEach(() => accessCheck.mockReset());

  it("reports a retryable problem when the access check throws", async () => {
    accessCheck.mockRejectedValue(new Error("boom"));
    const result = await requestCampaignFromTemplateAction("t-1");
    expect(result?.error).toMatch(/could not check your access/);
  });

  it("still says 'Not authorised' for a genuine refusal", async () => {
    accessCheck.mockResolvedValue(null);
    expect(await requestCampaignFromTemplateAction("t-1")).toEqual({ error: "Not authorised" });
  });
});
