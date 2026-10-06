import { describe, expect, it } from "@jest/globals";
import { asNotice, chooseFormSchema, dispenseProblem, noticeForError, viewFor, type Collection } from "./model";

const base: Collection = { state: "signed", pharmacy_name: null, location_name: null, address: null, code: null, code_expires_at: null, locked: null, expired: null, collected: null };

describe("pharmacy collection model", () => {
  it("shows the chooser for a signed prescription, the code once sent, and closed for anything else", () => {
    expect(viewFor(base)).toBe("choose");
    expect(viewFor({ ...base, state: "sent", code: "ABCD2345" })).toBe("code");
    expect(viewFor({ ...base, state: "dispensed" })).toBe("collected");
    expect(viewFor({ ...base, state: "sent", collected: true })).toBe("collected");
    expect(viewFor({ ...base, state: "cancelled" })).toBe("closed");
  });
  it("maps database refusals to a notice and anything unknown to a plain failure", () => {
    expect(noticeForError("pharmacy_not_available")).toBe("pharmacy_not_available");
    expect(noticeForError("collection_already_started")).toBe("collection_already_started");
    expect(noticeForError("something odd")).toBe("failed");
    expect(noticeForError(undefined)).toBe("failed");
    expect(asNotice("chosen")).toBe("chosen");
    expect(asNotice("<script>")).toBeNull();
  });
  it("needs three real ids to choose a pharmacy", () => {
    const id = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
    expect(chooseFormSchema.safeParse({ prescription: id, partner: id, location: id }).success).toBe(true);
    expect(chooseFormSchema.safeParse({ prescription: id, partner: "x", location: id }).success).toBe(false);
  });
  it("checks a supply the way the database does", () => {
    const ok = { partial: false, note: "", registration: "PCN12345", pharmacist: "Ada Okafor" };
    expect(dispenseProblem(ok)).toBeNull();
    expect(dispenseProblem({ ...ok, registration: "!!" })).toBe("registration");
    expect(dispenseProblem({ ...ok, pharmacist: "A" })).toBe("pharmacist");
    expect(dispenseProblem({ ...ok, partial: true })).toBe("note");
    expect(dispenseProblem({ ...ok, partial: true, note: "Ten owed" })).toBeNull();
    expect(dispenseProblem({ ...ok, partial: true, note: "x".repeat(301) })).toBe("note");
  });
});
