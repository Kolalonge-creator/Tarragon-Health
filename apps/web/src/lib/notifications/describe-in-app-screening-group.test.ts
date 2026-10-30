import { describe as describeNotification } from "./describe-in-app";

type Input = Parameters<typeof describeNotification>[0];
const note = (template: string, payload: Record<string, unknown>) => describeNotification({ template, payload } as Input);

describe("grouped screening reminders in the inbox", () => {
  it("says how many checks are due, names no test, and opens Prevention", () => {
    const d = note("screening_due", { count: 7, screen_type_name: "your screening checks", lab_order_id: "abc" });
    expect(d.text).toBe("You have 7 checks due");
    expect(d.href).toBe("/patient/prevention");
  });

  it.each([
    ["screening_upcoming", "4 checks are coming up soon"],
    ["screening_overdue", "4 checks are still waiting"],
    ["screening_escalated", "4 checks are still waiting: your care team may follow up"],
  ])("%s with a count reads as a group", (template, text) => {
    expect(note(template, { count: 4 }).text).toBe(text);
  });

  it("leaves a single reminder as it was, with or without a request", () => {
    expect(note("screening_due", { lab_order_id: "abc" }).text).toBe("Your test request is ready to download");
    expect(note("screening_due", {}).text).toBe("A reminder is due");
    expect(note("screening_overdue", { lab_order_id: "abc" }).text).toBe("Your test request is waiting for you");
  });

  it("ignores a count that is not a whole number above 1", () => {
    for (const count of [1, 0, -3, 2.5, "7", null]) {
      expect(note("screening_due", { count }).text).toBe("A reminder is due");
    }
  });
});
