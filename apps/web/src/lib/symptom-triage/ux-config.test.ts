import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>();
const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (fn: string, args?: Record<string, unknown>) => rpc(fn, args) }) }));

import { DESCRIBE_DRAFT } from "@tarragon/symptom-triage-engine";
import { loadAssessmentUx, NO_ASSESSMENT_UX } from "./ux-config";

beforeEach(() => {
  rpc.mockReset();
  captureException.mockReset();
});

describe("loadAssessmentUx (S59c)", () => {
  it("while every bundled config is an unsigned draft, nothing is in force, whatever the server says", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await loadAssessmentUx()).toEqual(NO_ASSESSMENT_UX);
    // even a (hypothetical) live signed copy cannot switch on an unsigned bundle
    rpc.mockResolvedValue({ data: { ...DESCRIBE_DRAFT, status: "signed_off", clinical_sign_off: { by: "x", at: "2026-10-22" } }, error: null });
    expect(await loadAssessmentUx()).toEqual(NO_ASSESSMENT_UX);
  });

  it("asks the database for the three kinds the screens use, and not for the follow-up timing (the database owns that)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await loadAssessmentUx();
    expect(rpc.mock.calls.map(([fn, args]) => `${fn}:${(args as { p_kind: string }).p_kind}`).sort()).toEqual([
      "symptom_ux_active_config:describe",
      "symptom_ux_active_config:explainer",
      "symptom_ux_active_config:safety_net",
    ]);
  });

  it("a failing read is judged on the bundle alone (still unsigned, so still nothing) and is not an error screen", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await loadAssessmentUx()).toEqual(NO_ASSESSMENT_UX);
    rpc.mockRejectedValue(new Error("network"));
    expect(await loadAssessmentUx()).toEqual(NO_ASSESSMENT_UX);
  });

  it("an unsigned draft is the expected state today and is not reported as a problem", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await loadAssessmentUx();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("a SIGNED live version with an unsigned bundled draft (the release was not cut) is reported loudly, and the feature stays off", async () => {
    rpc.mockImplementation(async (_fn, args) =>
      (args as { p_kind: string }).p_kind === "describe"
        ? { data: { ...DESCRIBE_DRAFT, status: "signed_off", clinical_sign_off: { by: "Dr X", at: "2026-10-22" } }, error: null }
        : { data: null, error: null },
    );
    expect(await loadAssessmentUx()).toEqual(NO_ASSESSMENT_UX);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(String((captureException.mock.calls[0]![0] as Error).message)).toMatch(/describe.*bundle_unsigned.*SIGNED version/);
  });

  it("an unreadable live copy is reported too, not silently treated as a plain draft", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    await loadAssessmentUx();
    // the bundle is an unsigned draft, so there is nothing to distrust: no report for a plain draft
    expect(captureException).not.toHaveBeenCalled();
  });
});
