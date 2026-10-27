import { describe, expect, it } from "@jest/globals";
import { asNotice, emailTicketSchema, noticeForError } from "./model";

const ok = { email: "  Pat@Example.com ", sender: "Pat One", subject: "Cannot sign in", body: "I cannot sign in to the app at all", priority: "normal", clinical: false };

describe("email ticket intake (pasted by staff)", () => {
  it("accepts a good form and normalises the address", () => {
    const r = emailTicketSchema.safeParse(ok);
    expect(r.success && r.data.email).toBe("pat@example.com");
  });
  it("refuses a bad address, a short body, a missing sender and an unknown priority", () => {
    expect(emailTicketSchema.safeParse({ ...ok, email: "nope" }).success).toBe(false);
    expect(emailTicketSchema.safeParse({ ...ok, body: "help" }).success).toBe(false);
    expect(emailTicketSchema.safeParse({ ...ok, sender: " " }).success).toBe(false);
    expect(emailTicketSchema.safeParse({ ...ok, priority: "urgent" }).success).toBe(false);
  });
  it("maps database errors to fixed notices and rejects anything else", () => {
    expect(noticeForError("42501")).toBe("denied");
    expect(noticeForError("22023")).toBe("no_match");
    expect(noticeForError("XX000")).toBe("failed");
    expect(asNotice("logged_clinical")).toBe("logged_clinical");
    expect(asNotice("<script>")).toBeNull();
  });
});
