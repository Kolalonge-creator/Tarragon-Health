import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSISTANT_LIMITS,
  buildEmergencyAddendum,
  EMERGENCY_COPY_STATUS,
  EMERGENCY_GUIDANCE,
  emergencyPhoneNumbers,
  formatHospitalLine,
  nearestHospitalsShown,
  SELF_HARM_GUIDANCE,
  SELF_HARM_REPLY,
} from "./assistant-emergency";

const FILE = join(fileURLToPath(new URL(".", import.meta.url)), "assistant-emergency.ts");

describe("assistant emergency copy (bundled, offline, INV-06)", () => {
  const all = [
    EMERGENCY_GUIDANCE.title, ...EMERGENCY_GUIDANCE.lines, SELF_HARM_GUIDANCE.title, ...SELF_HARM_GUIDANCE.lines,
    ASSISTANT_LIMITS.title, ...ASSISTANT_LIMITS.lines,
  ];

  it("points to the nearest hospital and says nothing about a hotline", () => {
    expect(EMERGENCY_GUIDANCE.lines.join(" ")).toMatch(/nearest hospital/i);
    expect(SELF_HARM_GUIDANCE.lines.join(" ")).toMatch(/nearest hospital/i);
    expect(all.join(" ")).not.toMatch(/helpline|hotline|call \d/i);
  });

  it("has no em dash, no 'your doctor', no 'cure', no fear-based wording", () => {
    for (const line of all) {
      expect(line).not.toMatch(/—/);
      expect(line).not.toMatch(/your doctor|\bcure\b|WARNING|instant doctor|free healthcare/i);
    }
  });

  it("hard-codes no phone number anywhere in the file", () => {
    const src = readFileSync(FILE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/\+?\d[\d\s-]{6,}\d/);
    expect(emergencyPhoneNumbers()).toEqual([]);
  });

  it("is marked as awaiting the CMO, never as approved", () => {
    expect(EMERGENCY_COPY_STATUS).toBe("proposed_awaiting_cmo_signoff");
    expect(SELF_HARM_REPLY.length).toBeGreaterThan(40);
  });

  it("the self-harm copy is not the standard copy", () => {
    expect(SELF_HARM_GUIDANCE.lines.join(" ")).not.toBe(EMERGENCY_GUIDANCE.lines.join(" "));
  });
});

describe("the emergency addendum", () => {
  it("lists hospitals and the patient's own emergency contact", () => {
    const out = buildEmergencyAddendum({
      hospitals: [{ name: "General Hospital Ikeja", city: "Ikeja", address: "Oba Akinjobi Way", phone: null }],
      contactName: "Ada",
      contactPhone: "+2348012345678",
    });
    expect(out).toContain("General Hospital Ikeja (Ikeja, Oba Akinjobi Way)");
    expect(out).toContain("Your emergency contact is Ada, phone +2348012345678.");
  });
  it("is empty when there is nothing to add (the fixed copy stands alone)", () => {
    expect(buildEmergencyAddendum({ hospitals: [], contactName: null, contactPhone: null })).toBe("");
  });
  it("does not name a contact with no number", () => {
    expect(buildEmergencyAddendum({ hospitals: [], contactName: "Ada", contactPhone: null })).toBe("");
  });
  it("formats a hospital with no address or phone", () => {
    expect(formatHospitalLine({ name: "Clinic", city: null, address: null, phone: null })).toBe("Clinic");
  });
  it("shows three hospitals by default (config)", () => {
    expect(nearestHospitalsShown()).toBe(3);
  });
});
