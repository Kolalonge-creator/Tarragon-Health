/** @jest-environment node */
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("server-only", () => ({}));

import { loadDoctorWorklist } from "./doctor-worklist-load";

type Result = { data: unknown; error: { message: string } | null };

function fakeClient(tables: Record<string, Result>, rpc: Result) {
  const builder = (res: Result) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "eq", "not", "or", "order", "returns"]) b[m] = () => b;
    b.then = (resolve: (r: Result) => unknown) => Promise.resolve(res).then(resolve);
    return b;
  };
  return { from: (t: string) => builder(tables[t] ?? { data: [], error: null }), rpc: () => Promise.resolve(rpc) };
}

const escalation = {
  id: "e1",
  reason: "BP 200/120 with headache",
  status: "open",
  created_at: "2026-11-06T08:00:00Z",
  assigned_doctor_id: "me",
  clinician_alert_id: "a1",
  patient_id: "p1",
  patient: { full_name: "Ada Obi", patient_number: "TH-1" },
  assigned_doctor: { full_name: "Dr Me" },
  clinician_alert: { level: "emergency", override_level: null, sla_due_at: "2026-11-06T09:00:00Z" },
};
const alert = (id: string) => ({
  id,
  title: "Glucose 2.1 mmol/L",
  status: "open",
  level: "urgent_escalation",
  override_level: null,
  sla_due_at: null,
  created_at: "2026-11-06T07:00:00Z",
  patient_id: "p2",
  responsible_clinician_id: "staff-me",
  patient: { full_name: "Bola Ade", patient_number: "TH-2" },
  responsible_clinician: { full_name: "Dr Me" },
});
const queueItem = {
  kind: "lab_results",
  item_id: "q1",
  patient_id: "p3",
  patient_name: "Chi Eze",
  patient_number: "TH-3",
  item_label: "x",
  item_date: "2026-11-05T00:00:00Z",
  kind_total: 150,
};

const ids = { profileId: "me", staffId: "staff-me" };

describe("loadDoctorWorklist", () => {
  it("merges the three sources, names every row, and shows an escalated alert once", async () => {
    const client = fakeClient(
      { escalations: { data: [escalation], error: null }, clinician_alerts: { data: [alert("a1"), alert("a2")], error: null } },
      { data: [queueItem], error: null },
    );
    const out = await loadDoctorWorklist(client as never, ids, []);
    expect(out.failedSources).toEqual([]);
    expect(out.rows.map((r) => r.key)).toEqual(["escalation:e1", "alert:a2", "queue:lab_results:q1"]);
    expect(out.rows[0]).toMatchObject({ priority: "critical", assignedToMe: true, patientName: "Ada Obi", href: "/clinician/escalations/e1" });
    expect(out.rows[1]).toMatchObject({ priority: "urgent", assignedToMe: true, nextAction: "Acknowledge" });
    expect(out.rows[2]).toMatchObject({ priority: "not_graded", unassigned: true, patientNumber: "TH-3" });
    expect(out.queueOverflow).toEqual([{ kind: "lab_results", shown: 1, total: 150 }]);
  });

  it("reports each failed source instead of returning a quiet empty list", async () => {
    const client = fakeClient(
      { escalations: { data: null, error: { message: "boom" } }, clinician_alerts: { data: [alert("a1")], error: null } },
      { data: null, error: { message: "denied" } },
    );
    const out = await loadDoctorWorklist(client as never, ids, []);
    expect(out.failedSources).toEqual(["escalation", "queue"]);
    // With escalations unknown, an alert cannot be assumed covered, so it is shown.
    expect(out.rows.map((r) => r.key)).toEqual(["alert:a1"]);
  });

  it("leaves test patients out of the shared queues", async () => {
    const client = fakeClient({}, { data: [queueItem], error: null });
    const out = await loadDoctorWorklist(client as never, ids, ["p3"]);
    expect(out.rows).toEqual([]);
  });
});
