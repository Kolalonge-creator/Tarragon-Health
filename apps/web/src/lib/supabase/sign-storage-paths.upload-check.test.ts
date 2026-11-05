/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): the one shared signing helper never signs a client-uploaded file the server has not
 * cleared; that path comes back null (the screens' existing "could not be loaded" state) and the rest are signed as before.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("server-only", () => ({}));
const signed: string[][] = [];
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          signed.push(paths);
          return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null };
        },
      }),
    },
  }),
}));
const blocked = jest.fn<() => Promise<Set<string>>>();
jest.mock("@/lib/uploads/cleared-for-reading", () => ({ blockedUncheckedPaths: () => blocked() }));

import { signStoragePaths } from "./sign-storage-paths";

beforeEach(() => {
  signed.length = 0;
  blocked.mockReset();
});

describe("signStoragePaths upload check", () => {
  it("withholds a path that is not cleared and signs the rest", async () => {
    blocked.mockResolvedValue(new Set(["u/bad.jpg"]));
    const map = await signStoragePaths("care-message-attachments", ["u/ok.jpg", "u/bad.jpg"], 60);
    expect(map.get("u/bad.jpg")).toBeNull();
    expect(map.get("u/ok.jpg")).toBe("https://signed/u/ok.jpg");
    expect(signed).toEqual([["u/ok.jpg"]]);
  });

  it("signs nothing when every path is withheld", async () => {
    blocked.mockResolvedValue(new Set(["a", "b"]));
    const map = await signStoragePaths("patient-documents", ["a", "b"], 60);
    expect([...map.values()]).toEqual([null, null]);
    expect(signed).toHaveLength(0);
  });
});
