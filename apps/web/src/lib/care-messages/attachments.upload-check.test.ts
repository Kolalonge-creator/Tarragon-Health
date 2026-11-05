/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): a care-message attachment is signed only once the server has cleared it.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const createSignedUrl = jest.fn(async () => ({ data: { signedUrl: "https://signed/x" } }));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ storage: { from: () => ({ createSignedUrl }) } }) }));
const cleared = jest.fn<(...a: unknown[]) => Promise<boolean>>();
jest.mock("@/lib/uploads/cleared-for-reading", () => ({ isClearedForReading: (...a: unknown[]) => cleared(...a) }));

import { signCareMessageAttachmentPath } from "./attachments";

beforeEach(() => {
  createSignedUrl.mockClear();
  cleared.mockReset();
});

describe("signCareMessageAttachmentPath upload check", () => {
  it("returns no URL for an uncleared file", async () => {
    cleared.mockResolvedValue(false);
    expect(await signCareMessageAttachmentPath("u1/a.jpg")).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("signs a cleared file", async () => {
    cleared.mockResolvedValue(true);
    expect(await signCareMessageAttachmentPath("u1/a.jpg")).toBe("https://signed/x");
  });
});
