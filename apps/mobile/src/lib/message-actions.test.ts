import { loadMessageActions, MESSAGE_ACTIONS } from "./message-actions";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn() } }));

const mockFrom = supabase.from as unknown as jest.Mock;

function actionsTable(rows: unknown[]) {
  return { select: () => ({ in: () => Promise.resolve({ data: rows, error: null }) }) };
}

describe("loadMessageActions", () => {
  it("groups buttons by message and drops kinds this app does not know", async () => {
    mockFrom.mockReturnValue(
      actionsTable([
        { message_id: "m1", kind: "book_appointment" },
        { message_id: "m1", kind: "log_reading" },
        { message_id: "m2", kind: "somewhere_else" },
      ])
    );
    expect(await loadMessageActions(["m1", "m2"])).toEqual({ m1: ["book_appointment", "log_reading"] });
  });

  it("asks nothing when there are no messages", async () => {
    mockFrom.mockClear();
    expect(await loadMessageActions([])).toEqual({});
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("opens one of the app's own screens for every kind", () => {
    expect(Object.keys(MESSAGE_ACTIONS).sort()).toEqual(["book_appointment", "log_reading", "review_medications", "upload_result"]);
  });
});
