import { describe, expect, it } from "@jest/globals";
import { parseRoster } from "./parse-roster";

describe("parseRoster", () => {
  it("parses one 'Full Name, phone' contact per line", () => {
    const { contacts, errors } = parseRoster("Amaka Okoye, +2348012345678\nChidi Eze, +2348023456789");
    expect(errors).toEqual([]);
    expect(contacts).toEqual([
      { full_name: "Amaka Okoye", phone: "+2348012345678" },
      { full_name: "Chidi Eze", phone: "+2348023456789" },
    ]);
  });

  it("treats a value with @ as an email, not a phone", () => {
    const { contacts, errors } = parseRoster("Amaka Okoye, amaka@example.com");
    expect(errors).toEqual([]);
    expect(contacts).toEqual([{ full_name: "Amaka Okoye", email: "amaka@example.com" }]);
  });

  it("ignores blank lines", () => {
    const { contacts, errors } = parseRoster("Amaka Okoye, +2348012345678\n\n\nChidi Eze, +2348023456789\n");
    expect(errors).toEqual([]);
    expect(contacts).toHaveLength(2);
  });

  it("reports a per-line error for a missing contact, without dropping the good lines silently", () => {
    const { contacts, errors } = parseRoster("Amaka Okoye, +2348012345678\nChidi Eze");
    expect(contacts).toEqual([{ full_name: "Amaka Okoye", phone: "+2348012345678" }]);
    expect(errors).toEqual(["Line 2 (Chidi Eze): missing a phone number or email"]);
  });

  it("reports a per-line error for a missing name", () => {
    const { errors } = parseRoster(", +2348012345678");
    expect(errors).toEqual(["Line 1: missing a name"]);
  });

  it("rejects a malformed email rather than letting it reach the RPC's own Zod parse", () => {
    const { contacts, errors } = parseRoster("Amaka Okoye, +2348012345678\nChidi Eze, chidi@");
    expect(contacts).toEqual([{ full_name: "Amaka Okoye", phone: "+2348012345678" }]);
    expect(errors).toEqual(['Line 2 (Chidi Eze): "chidi@" isn\'t a valid email address']);
  });

  it("rejects a non-E.164 phone number rather than silently passing it through", () => {
    const { contacts, errors } = parseRoster("Amaka Okoye, 08012345678");
    expect(contacts).toEqual([]);
    expect(errors).toEqual(["Line 1 (Amaka Okoye): phone must be E.164, e.g. +2348012345678"]);
  });

  it("returns no contacts and no errors for an empty roster", () => {
    expect(parseRoster("")).toEqual({ contacts: [], errors: [] });
  });
});
