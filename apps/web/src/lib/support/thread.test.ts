import { describe, expect, it } from "@jest/globals";
import { channelsIn, readingOrder, threadRowsSchema } from "./thread";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, channel: string, at: string, over: Record<string, unknown> = {}) => ({
  kind: "ticket", ticket_id: id(n), entry_id: id(n), channel, at, author: "patient", body: "x", is_internal: false, red_flagged: false, ...over,
});

describe("patient support thread", () => {
  it("parses the database rows and refuses a malformed one instead of showing a partial thread", () => {
    expect(threadRowsSchema.safeParse([row(1, "email", "2026-10-27T10:00:00Z")]).success).toBe(true);
    expect(threadRowsSchema.safeParse([row(1, "sms", "2026-10-27T10:00:00Z")]).success).toBe(false);
    expect(threadRowsSchema.safeParse([{ ...row(1, "email", "2026-10-27T10:00:00Z"), body: undefined }]).success).toBe(false);
  });
  it("reads oldest first without changing the input, and lists channels in a fixed order", () => {
    const rows = threadRowsSchema.parse([row(1, "email", "2026-10-27T12:00:00Z"), row(2, "in_app", "2026-10-27T09:00:00Z"), row(3, "phone", "2026-10-27T10:00:00Z")]);
    const copy = [...rows];
    expect(readingOrder(rows).map((r) => r.channel)).toEqual(["in_app", "phone", "email"]);
    expect(rows).toEqual(copy);
    expect(channelsIn(rows)).toEqual(["in_app", "phone", "email"]);
  });
});
