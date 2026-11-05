/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): a vaccination card the browser wrote straight to Storage is never read by the AI reader
 * until the server has cleared it; an uncleared file fails the draft (manual entry stays open) and nothing is downloaded.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn(), getCurrentUser: jest.fn() }));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: jest.fn() }));
jest.mock("@/lib/preventive/generate-vaccination-schedule", () => ({ generateVaccinationScheduleBestEffort: jest.fn() }));
jest.mock("@/lib/ai-governance", () => ({ AI_SYSTEMS: {}, decideAiGovernance: jest.fn(), recordAiInteraction: jest.fn() }));
jest.mock("./extract", () => ({ extractVaccinationCard: jest.fn(), isVaccinationCardExtractionConfigured: () => true }));
const cleared = jest.fn<(...a: unknown[]) => Promise<boolean>>();
jest.mock("@/lib/uploads/cleared-for-reading", () => ({ isClearedForReading: (...a: unknown[]) => cleared(...a) }));

import { runVaccinationCardExtraction } from "./extraction-actions";

const updates: Record<string, unknown>[] = [];
const download = jest.fn();
const service = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "x1", patient_id: "p1", organisation_id: "o1", source_path: "u1/card.jpg" } }) }) }),
    update: (row: Record<string, unknown>) => {
      updates.push(row);
      return { eq: async () => ({ error: null }) };
    },
  }),
  storage: { from: () => ({ download }) },
} as never;

beforeEach(() => {
  updates.length = 0;
  download.mockReset();
  cleared.mockReset();
});

describe("runVaccinationCardExtraction upload check", () => {
  it("an uncleared card is never downloaded or read, and the draft is marked failed", async () => {
    cleared.mockResolvedValue(false);
    const out = await runVaccinationCardExtraction(service, "x1");
    expect(out.status).toBe("failed");
    expect(download).not.toHaveBeenCalled();
    expect(cleared.mock.calls[0]?.slice(1)).toEqual(["vaccination-certificates", "u1/card.jpg"]);
    expect(updates[0]).toMatchObject({ status: "failed" });
  });
});
