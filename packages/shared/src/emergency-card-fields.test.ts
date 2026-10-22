import { describe, expect, it } from "@jest/globals";
import {
  EMERGENCY_CARD_FIELDS,
  EMERGENCY_CARD_FIELDS_COLUMNS,
  EMERGENCY_DEFAULT_CHOICES,
  EMERGENCY_MINIMAL_CHOICES,
  emergencyChoicesFromRow,
  emergencyRowFromChoices,
} from "./emergency-card-fields";

describe("emergency card field choices", () => {
  it("round-trips every choice through the table row", () => {
    for (const c of [EMERGENCY_DEFAULT_CHOICES, EMERGENCY_MINIMAL_CHOICES, { ...EMERGENCY_DEFAULT_CHOICES, conditions: true, mental_health: true, lock_screen_opt_in: true }]) {
      expect(emergencyChoicesFromRow(emergencyRowFromChoices(c))).toEqual(c);
    }
  });

  it("no row means the defaults, with conditions, reproductive and mental health off and the lock screen off", () => {
    const c = emergencyChoicesFromRow(null);
    expect(c).toEqual(EMERGENCY_DEFAULT_CHOICES);
    expect([c.conditions, c.reproductive, c.mental_health, c.lock_screen_opt_in]).toEqual([false, false, false, false]);
  });

  it("the minimum keeps blood, allergies and the emergency contact and nothing sensitive", () => {
    expect(EMERGENCY_MINIMAL_CHOICES).toMatchObject({ blood: true, allergies: true, emergency_contact: true, conditions: false, reproductive: false, mental_health: false });
  });

  it("the read columns name exactly the fields the row carries", () => {
    const cols = EMERGENCY_CARD_FIELDS_COLUMNS.split(", ").sort();
    const row = Object.keys(emergencyRowFromChoices(EMERGENCY_DEFAULT_CHOICES)).sort();
    expect(cols).toEqual(row);
    expect(EMERGENCY_CARD_FIELDS.length + 1).toBe(row.length);
  });
});
