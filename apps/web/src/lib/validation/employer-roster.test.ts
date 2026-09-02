import { rosterMemberSchema, parseBulkRosterInput } from "./employer-roster";

describe("rosterMemberSchema (Module 26 §26.4/§26.5)", () => {
  it("accepts a phone-only entry", () => {
    const result = rosterMemberSchema.safeParse({ phone: "+2348012345678" });
    expect(result.success).toBe(true);
  });

  it("accepts an email-only entry — §26.4's email join route", () => {
    const result = rosterMemberSchema.safeParse({ email: "worker@example.com" });
    expect(result.success).toBe(true);
  });

  it("rejects an entry with neither phone nor email — nobody could ever be reached", () => {
    const result = rosterMemberSchema.safeParse({ full_name: "Ada" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-E.164 phone", () => {
    const result = rosterMemberSchema.safeParse({ phone: "08012345678" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const result = rosterMemberSchema.safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("accepts eligibility and segmentation fields together", () => {
    const result = rosterMemberSchema.safeParse({
      phone: "+2348012345678",
      department_id: "11111111-1111-4111-8111-111111111111",
      location_id: "22222222-2222-4222-8222-222222222222",
      employment_status: "full_time",
      eligible_from: "2026-01-01",
      eligible_until: "2026-12-31",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unrecognised employment status", () => {
    const result = rosterMemberSchema.safeParse({ phone: "+2348012345678", employment_status: "freelance" });
    expect(result.success).toBe(false);
  });
});

describe("parseBulkRosterInput (Module 26 §26.4 bulk upload)", () => {
  it("parses a header row followed by data rows", () => {
    const rows = parseBulkRosterInput(
      "phone,email,full_name,department,location,employment_status\n" +
        "+2348011112222,,Ada Worker,Engineering,Lagos HQ,full_time\n" +
        ",bello@example.com,Bello Worker,Sales,,part_time"
    );
    expect(rows).toEqual([
      {
        phone: "+2348011112222",
        email: "",
        full_name: "Ada Worker",
        department: "Engineering",
        location: "Lagos HQ",
        employment_status: "full_time",
      },
      {
        phone: "",
        email: "bello@example.com",
        full_name: "Bello Worker",
        department: "Sales",
        location: "",
        employment_status: "part_time",
      },
    ]);
  });

  it("parses headerless input — a row is only treated as a header if its first cell is literally 'phone'", () => {
    const rows = parseBulkRosterInput("+2348011112222,,Ada Worker");
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe("+2348011112222");
  });

  it("ignores blank lines and surrounding whitespace", () => {
    const rows = parseBulkRosterInput("\n  +2348011112222,,Ada  \n\n  \n+2348022223333,,Bello\n");
    expect(rows).toHaveLength(2);
    expect(rows[0].phone).toBe("+2348011112222");
    expect(rows[1].phone).toBe("+2348022223333");
  });

  it("returns an empty array for blank input", () => {
    expect(parseBulkRosterInput("")).toEqual([]);
    expect(parseBulkRosterInput("   \n  \n")).toEqual([]);
  });
});
