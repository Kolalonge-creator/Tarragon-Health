/** @jest-environment jsdom */
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { DoctorWorklistRow } from "@tarragon/shared";

// The CMO's assign control is a client component that pulls in the query layer; a marker stands in for it here.
jest.mock("@/components/clinical/assign-escalation-select", () => ({
  AssignEscalationSelect: ({ escalationId }: { escalationId: string }) => `[assign ${escalationId}]`,
}));

import { dueText, WorklistTable } from "./worklist-table";

const NOW = new Date("2026-11-06T10:00:00Z");
// Read the rendered text through the DOM (not a tag-stripping regex), so entities decode and no markup can slip through.
const text = (html: string) => {
  const box = document.createElement("div");
  box.innerHTML = html;
  return (box.textContent ?? "").replace(/\s+/g, " ").trim();
};

const row = (over: Partial<DoctorWorklistRow>): DoctorWorklistRow => ({
  key: "k",
  source: "escalation",
  patientId: "p1",
  patientName: "Ada Obi",
  patientNumber: "TH-0001",
  issue: "BP 200/120 with headache",
  priority: "critical",
  receivedAt: "2026-11-06T08:00:00Z",
  dueAt: "2026-11-06T09:00:00Z",
  assignedName: null,
  assignedToMe: true,
  unassigned: false,
  status: "New",
  nextAction: "Start the review",
  href: "/clinician/escalations/e1",
  ...over,
});

describe("WorklistTable", () => {
  it("names the patient and writes priority, overdue and owner in words", () => {
    const out = text(renderToStaticMarkup(<WorklistTable rows={[row({})]} now={NOW} />));
    expect(out).toContain("Ada Obi");
    expect(out).toContain("TH-0001");
    expect(out).toContain("Critical");
    expect(out).toContain("Overdue since");
    expect(out).toContain("You");
    expect(out).toContain("Start the review");
  });

  it("links the patient to the chart and the action to its own screen", () => {
    const html = renderToStaticMarkup(<WorklistTable rows={[row({})]} now={NOW} />);
    expect(html).toContain('href="/clinician/patients/p1"');
    expect(html).toContain('href="/clinician/escalations/e1"');
  });

  it("labels a shared review item and an ungraded row honestly", () => {
    const out = text(
      renderToStaticMarkup(
        <WorklistTable rows={[row({ source: "queue", priority: "not_graded", assignedToMe: false, unassigned: true, dueAt: null })]} now={NOW} />,
      ),
    );
    expect(out).toContain("Not graded");
    expect(out).toContain("Shared queue");
    expect(out).toContain("No due time");
  });
});

describe("dueText", () => {
  it("handles no, bad, future and past due times", () => {
    expect(dueText({ dueAt: null }, NOW)).toBe("No due time");
    expect(dueText({ dueAt: "nope" }, NOW)).toBe("No due time");
    expect(dueText({ dueAt: "2026-11-06T12:00:00Z" }, NOW)).toMatch(/^Due /);
    expect(dueText({ dueAt: "2026-11-06T09:00:00Z" }, NOW)).toMatch(/^Overdue since /);
  });

  it("offers Assign to only on escalation rows, and only when the CMO's organisation is passed (DW-15)", () => {
    const rows = [
      row({ key: "escalation:e1", escalationId: "e1", assignedProfileId: "d1" }),
      row({ key: "alert:a1", source: "alert" }),
    ];
    expect(text(renderToStaticMarkup(<WorklistTable rows={rows} now={NOW} />))).not.toContain("[assign");
    const cmo = text(renderToStaticMarkup(<WorklistTable rows={rows} now={NOW} assignOrganisationId="org-1" />));
    expect(cmo).toContain("[assign e1]");
    expect(cmo.match(/\[assign /g)?.length).toBe(2); // the e1 row, once in the table and once in the phone card
  });
});
