import { friendlyDbError } from "./errors";

describe("friendlyDbError", () => {
  it("explains the CMO approval refusal in plain English", () => {
    const t = friendlyDbError({ code: "42501", message: "the rules of a health group need the current Chief Medical Officer approval before it goes live" });
    expect(t).toMatch(/Chief Medical Officer/);
    expect(t).not.toMatch(/need the current/);
  });
  it("explains safety rule activation and the contact guard", () => {
    expect(friendlyDbError({ code: "42501", message: "a filter rule set with safety rules can only be activated by an active Chief Medical Officer" })).toMatch(/only be made live by the Chief Medical Officer/);
    expect(friendlyDbError({ code: "42501", message: "a filter rule set cannot go live without blocking phone numbers, email addresses, links and handles" })).toMatch(/keep blocking/);
  });
  it("explains that a community permission goes to care coordinator accounts only", () => {
    const t = friendlyDbError({ code: "42501", message: "community moderation is granted to an active care coordinator account" });
    expect(t).toBe("Only an active care coordinator account can be given a community permission. Admin accounts cannot.");
    expect(t).not.toMatch(/granted to/);
    expect(friendlyDbError({ code: "42501", message: "only an admin grants community moderation" })).toBe("Only an admin can give or end these permissions.");
  });
  it("explains who may look a member up", () => {
    expect(friendlyDbError({ code: "42501", message: "admins, the Chief Medical Officer and doctors only" })).toBe("This is for doctors, the Chief Medical Officer and admins.");
  });
  it("never echoes unknown database text", () => {
    const raw = 'duplicate key value violates unique constraint "community_groups_slug_key"';
    for (const code of ["23505", "XX000", undefined, "42501", "23514"]) {
      const t = friendlyDbError({ code, message: raw });
      expect(t).not.toMatch(/constraint|violates|community_groups/);
    }
    expect(friendlyDbError({ message: "boom" })).toBe("That could not be done. Please try again.");
    expect(friendlyDbError(null)).toBe("That could not be done. Please try again.");
  });
  it("uses no em dashes", () => {
    expect(friendlyDbError({ code: "42501", message: "archived" })).not.toContain(String.fromCharCode(8212));
  });
});
