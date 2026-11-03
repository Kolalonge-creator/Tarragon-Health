/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  redirect: (p: string) => {
    throw new Error(`REDIRECT:${p}`);
  },
}));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn().mockResolvedValue({ id: "me" }) }));
const noteRow = jest.fn();
const fromTable = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => {
      fromTable(table);
      return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => noteRow() }) }) }) }) };
    },
  }),
}));
jest.mock("@/components/consultation/family-note-form", () => ({
  FamilyNoteForm: ({ latest }: { latest: { body: string } | null }) => <div>family-note-form:{latest ? latest.body : "none"}</div>,
}));
jest.mock("@/components/dashboard-placeholder", () => ({ DashboardPlaceholder: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock("@/components/consultation/consultation-room", () => ({ ConsultationRoom: () => <div>room</div> }));
jest.mock("@/components/consultation/caregiver-call-panel", () => ({ CaregiverCallPanel: () => null }));
jest.mock("@/components/consultation/consult-checkins-card", () => ({ ConsultCheckinsCard: () => null }));
jest.mock("@/components/consultation/clinician-intake-panel", () => ({ ClinicianIntakePanel: () => null }));
jest.mock("@/components/consultation/live-redflag-prompts", () => ({ LiveRedFlagPrompts: () => <div>live-prompts</div> }));

import ClinicianConsultationPage from "./page";

const enc = "11111111-1111-4111-8111-111111111111";
const answers = (guard: unknown, status?: string) =>
  rpc.mockImplementation((name: string) => {
    if (name === "consultation_room_view") return Promise.resolve({ data: { role: "clinician", video_consultation_id: null, reconnect_grace_seconds: 60, status }, error: null });
    if (name === "go_live_guard_is_open") return Promise.resolve({ data: guard, error: null });
    return Promise.resolve({ data: null, error: null });
  });
const renderPage = async () => render(await ClinicianConsultationPage({ params: Promise.resolve({ encounterId: enc }) }));

beforeEach(() => {
  rpc.mockReset();
  noteRow.mockReset().mockResolvedValue({ data: null, error: null });
  fromTable.mockReset();
});

describe("clinician consultation room live red-flag prompts (S77, 23.7)", () => {
  it("renders nothing while the guard is off", async () => {
    answers(false);
    await renderPage();
    expect(screen.queryByText("live-prompts")).toBeNull();
    expect(screen.getByText("room")).toBeTruthy();
  });
  it("renders nothing when the guard read returns nothing", async () => {
    answers(null);
    await renderPage();
    expect(screen.queryByText("live-prompts")).toBeNull();
  });
  it("mounts the prompts when the guard is open", async () => {
    answers(true);
    await renderPage();
    expect(screen.getByText("live-prompts")).toBeTruthy();
  });
});

describe("the doctor's line for the family (2026-11-03)", () => {
  it("is not offered before the consultation is finished, and nothing is read", async () => {
    answers(false, "in_progress");
    await renderPage();
    expect(screen.queryByText(/family-note-form/)).toBeNull();
    expect(fromTable).not.toHaveBeenCalled();
  });
  it("is offered once the consultation is completed, with the latest saved line", async () => {
    answers(false, "completed");
    noteRow.mockResolvedValue({ data: { body: "She did well today.", created_at: "2026-11-03T10:00:00Z" }, error: null });
    await renderPage();
    expect(fromTable).toHaveBeenCalledWith("family_doctor_notes");
    expect(screen.getByText("family-note-form:She did well today.")).toBeTruthy();
  });
  it("a failed read still shows an empty form", async () => {
    answers(false, "completed");
    noteRow.mockResolvedValue({ data: null, error: { message: "x" } });
    await renderPage();
    expect(screen.getByText("family-note-form:none")).toBeTruthy();
  });
});
