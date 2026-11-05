/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): the browser-side "check my upload" helper. A refusal is shown; anything else, including
 * a failed request, never blocks the person (the server sweep checks the file anyway).
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const action = jest.fn<(input: { bucket: string; path: string }) => Promise<unknown>>();
jest.mock("./check-my-upload-action", () => ({ checkMyUploadAction: (i: { bucket: string; path: string }) => action(i) }));

import { confirmDirectUpload, REFUSED_UPLOAD_MESSAGE } from "./confirm-direct-upload";

beforeEach(() => {
  action.mockReset();
});

describe("confirmDirectUpload", () => {
  it("returns the refusal message when the server refused the file", async () => {
    action.mockResolvedValue({ checked: true, refused: true });
    expect(await confirmDirectUpload("meal-photos", "u1/a.jpg")).toBe(REFUSED_UPLOAD_MESSAGE);
    expect(action).toHaveBeenCalledWith({ bucket: "meal-photos", path: "u1/a.jpg" });
  });

  it("returns null for a checked file, a server error, or a failed request", async () => {
    action.mockResolvedValue({ checked: true, refused: false });
    expect(await confirmDirectUpload("meal-photos", "u1/a.jpg")).toBeNull();
    action.mockResolvedValue({ error: "Could not check the file" });
    expect(await confirmDirectUpload("meal-photos", "u1/a.jpg")).toBeNull();
    action.mockRejectedValue(new Error("network"));
    expect(await confirmDirectUpload("meal-photos", "u1/a.jpg")).toBeNull();
  });
});
