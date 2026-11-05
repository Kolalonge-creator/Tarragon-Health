/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): the web meal photo is checked by the server before the meal points at it.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

const confirm = jest.fn<(bucket: string, path: string) => Promise<string | null>>();
jest.mock("@/lib/uploads/confirm-direct-upload", () => ({ confirmDirectUpload: (b: string, p: string) => confirm(b, p) }));

import { uploadMealPhoto } from "./upload-meal-photo";

let uploadError: { message: string } | null = null;
const uploads: { bucket: string; path: string }[] = [];
const client = {
  storage: { from: (bucket: string) => ({ upload: async (path: string) => { uploads.push({ bucket, path }); return { error: uploadError }; } }) },
} as unknown as SupabaseClient<Database>;
const photo = () => new File([Uint8Array.from([0xff, 0xd8, 0xff])], "lunch.JPG", { type: "image/jpeg" });

beforeEach(() => {
  uploads.length = 0;
  uploadError = null;
  confirm.mockReset();
});

describe("uploadMealPhoto", () => {
  it("stores under the person's own folder, asks for the check, and returns the path", async () => {
    confirm.mockResolvedValue(null);
    const path = await uploadMealPhoto(client, "user-1", photo());
    expect(path).toMatch(/^user-1\/[0-9a-f-]{36}\.jpg$/);
    expect(uploads).toEqual([{ bucket: "meal-photos", path }]);
    expect(confirm).toHaveBeenCalledWith("meal-photos", path);
  });

  it("a refused photo throws, so the meal never points at it", async () => {
    confirm.mockResolvedValue("That file is not what it says it is.");
    await expect(uploadMealPhoto(client, "user-1", photo())).rejects.toThrow("That file is not what it says it is.");
  });

  it("a failed upload throws before any check", async () => {
    uploadError = { message: "too big" };
    await expect(uploadMealPhoto(client, "user-1", photo())).rejects.toEqual({ message: "too big" });
    expect(confirm).not.toHaveBeenCalled();
  });
});
