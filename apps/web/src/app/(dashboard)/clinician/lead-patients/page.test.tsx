/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn().mockResolvedValue({ id: "me" }) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import LeadPatientsPage from "./page";

const row = { patient_id: "22222222-2222-4222-8222-222222222222", first_name: "Ada", last_bp: { systolic: 150, diastolic: 95, measured_at: "2026-10-05T09:00:00Z" }, adherence_percent: 80, pending_proposals: 1, due_tasks: 0 };

beforeEach(() => rpc.mockReset());

describe("LeadPatientsPage", () => {
  it("lists my leads with the numbers", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    render(await LeadPatientsPage());
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText(/150\/95/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open the summary/ }).getAttribute("href")).toBe(`/clinician/lead-patients/${row.patient_id}`);
  });

  it("an empty list is said plainly", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(await LeadPatientsPage());
    expect(screen.getByText(/do not lead any patients/)).toBeTruthy();
  });

  it("a failed load is an error, never 'you have none'", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(await LeadPatientsPage());
    expect(screen.getByRole("alert").textContent).toMatch(/not the same as having none/);
    expect(screen.queryByText(/do not lead any patients/)).toBeNull();
  });
});
