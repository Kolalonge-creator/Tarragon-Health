import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/queries/patient-timeline", () => ({ usePatientTimeline: jest.fn() }));
jest.mock("@/components/item-note", () => ({ canAnnotate: () => false, ItemNote: () => null }));
jest.mock("@/components/doctor-name-link", () => ({ DoctorNameLink: () => null }));
jest.mock("@/components/timeline-trust-tier", () => ({ TimelineTrustTier: () => null }));

import { eventLinkSubpathFor, eventStyleFor } from "./patient-timeline";

// A finished video consultation is written to patient_timeline as encounter_documented from video_consultations
// (20261105164409_consultation_completion_chain.sql). It must not be shown as a clinical note.
describe("timeline label for a finished consultation", () => {
  it("labels a completed video consultation as a consultation and links to appointments", () => {
    const event = { event_type: "encounter_documented" as const, source_table: "video_consultations" };
    expect(eventStyleFor(event).label).toBe("Consultation");
    expect(eventLinkSubpathFor(event)).toBe("/appointments");
  });

  it("still labels a signed note as a clinical note, with no link", () => {
    const event = { event_type: "encounter_documented" as const, source_table: "clinical_encounter_notes" };
    expect(eventStyleFor(event).label).toBe("Clinical note");
    expect(eventLinkSubpathFor(event)).toBeUndefined();
  });

  it("leaves other event types unchanged", () => {
    const event = { event_type: "lab_completed" as const, source_table: "video_consultations" };
    expect(eventStyleFor(event).label).toBe("Lab result");
    expect(eventLinkSubpathFor(event)).toBe("/labs");
  });
});
