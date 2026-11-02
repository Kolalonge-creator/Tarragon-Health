/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import type { EmergencyClinicalFacts } from "@/lib/emergency/card";
import { EmergencyCardPreview } from "./emergency-card-preview";

const FULL: EmergencyClinicalFacts = {
  full_name: "Ada Okafor",
  date_of_birth: "1980-02-01",
  sex: "female",
  patient_number: "TH-1",
  emergency_contact: { name: "Chi Okafor", phone: "+2348012345678", relationship: "sister" },
  allergies: [{ allergen: "Penicillin", reaction: null, severity: null }],
  medications: [{ drug_name: "Warfarin", dose: null, frequency: null }],
  conditions: ["type_2_diabetes"],
  blood: { blood_group: "O+", genotype: "AA", note: null, provenance: "lab_document", recorded_at: null },
};

const EMPTY: EmergencyClinicalFacts = { ...FULL, full_name: null, emergency_contact: null, allergies: [], medications: [], conditions: [], blood: null };

describe("EmergencyCardPreview", () => {
  it("shows every field the card holds", () => {
    render(<EmergencyCardPreview facts={FULL} hidden={[]} />);
    expect(screen.getByTestId("preview-name").textContent).toBe("Ada Okafor");
    expect(screen.getByText("O+ · AA")).toBeTruthy();
    expect(screen.getByText("Penicillin")).toBeTruthy();
    expect(screen.getByText("type 2 diabetes")).toBeTruthy();
    expect(screen.getByText("Warfarin")).toBeTruthy();
    expect(screen.getByText("Chi Okafor · +2348012345678")).toBeTruthy();
    expect(screen.queryByText(/not added yet/i)).toBeNull();
  });

  it("says Not added yet with a link for each empty field, and invents nothing", () => {
    render(<EmergencyCardPreview facts={EMPTY} hidden={[]} />);
    expect(screen.getAllByText(/not added yet/i)).toHaveLength(5);
    const links = screen.getAllByRole("link", { name: "Add it" });
    expect(links).toHaveLength(5);
    expect(links[0].getAttribute("href")).toBe("#blood-attestation");
    expect(screen.getByTestId("preview-name").textContent).toBe("Name not recorded");
  });

  it("shows a withheld field as not shared, never as not added", () => {
    render(<EmergencyCardPreview facts={{ ...FULL, allergies: [], medications: [] }} hidden={["allergies", "medications"]} />);
    expect(screen.getAllByText(/not shared by the patient/i)).toHaveLength(2);
    expect(screen.queryByText(/not added yet/i)).toBeNull();
  });
});
