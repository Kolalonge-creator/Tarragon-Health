import { describe, expect, it, jest } from "@jest/globals";
import { safePeopleError } from "./people-errors";

describe("safePeopleError", () => {
  it("passes the database's own plain sentences through", () => {
    expect(safePeopleError({ code: "P0001", message: "That would make a reporting loop." })).toBe("That would make a reporting loop.");
    expect(safePeopleError({ code: "42501", message: "Only an admin can record an employment change." })).toBe(
      "Only an admin can record an employment change."
    );
  });

  it("replaces a raw database message", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(safePeopleError({ code: "XX000", message: 'relation "x" does not exist' })).toBe("Something went wrong. Please try again.");
    expect(safePeopleError({ code: "23514", message: 'violates check constraint "staff_employment_leaving_note"' })).not.toContain("constraint");
    spy.mockRestore();
  });
});
