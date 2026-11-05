/**
 * Security audit 2026-11-05 (M-4/L-4): a written-question photo the phone wrote straight to Storage is checked by the server
 * before the question points at it. A refused photo is dropped (the question still goes); no answer (offline) never blocks.
 */
import { supabaseQueueRemote } from "./queue-remote";

const mockRpc = jest.fn();
const mockConfirm = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a), storage: { from: jest.fn() } } }));
jest.mock("../api", () => ({ confirmDirectUpload: (...a: unknown[]) => mockConfirm(...a) }));

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ error: null });
  mockConfirm.mockReset();
});

describe("supabaseQueueRemote.register", () => {
  it("a photo the server refused is dropped and never attached", async () => {
    mockConfirm.mockResolvedValue("That file is not what it says it is.");
    expect(await supabaseQueueRemote.register("c1", "u1/c1/p1.jpg", 10)).toEqual({ ok: false, dropPhoto: true });
    expect(mockConfirm).toHaveBeenCalledWith("async-consult-attachments", "u1/c1/p1.jpg");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("a checked photo, or no answer from the check, is attached as before", async () => {
    mockConfirm.mockResolvedValue(null);
    expect(await supabaseQueueRemote.register("c1", "u1/c1/p1.jpg", 10)).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("attach_written_question_photo", { p_consult: "c1", p_path: "u1/c1/p1.jpg", p_mime: "image/jpeg", p_bytes: 10 });
  });
});
