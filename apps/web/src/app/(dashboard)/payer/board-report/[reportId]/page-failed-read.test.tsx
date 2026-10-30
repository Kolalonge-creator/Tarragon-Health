/** @jest-environment jsdom */
/** A failed read of one report must not be shown as "this report does not exist". */
jest.mock("server-only", () => ({}));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
const notFound = jest.fn(() => { throw new Error("NEXT_NOT_FOUND"); });
jest.mock("next/navigation", () => ({ notFound: () => notFound() }));

let reply: { data: unknown; error: { message: string } | null } = { data: null, error: null };
jest.mock("@/lib/supabase/server", () => {
  const { fakeSupabase } = jest.requireActual("@/lib/institutions/fake-supabase");
  return { createClient: async () => fakeSupabase({ payer_board_reports: reply }) };
});
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => ({ role: "payer_admin" }) }));
jest.mock("./report-document", () => ({ ReportDocument: () => <div data-testid="doc" /> }));
jest.mock("./sign-off-panel", () => ({ SignOffPanel: () => null }));
jest.mock("./print-button", () => ({ PrintButton: () => null }));

import { render, screen } from "@testing-library/react";
import BoardReportPage from "./page";

const params = { params: Promise.resolve({ reportId: "r1" }) };

describe("outcomes report page", () => {
  beforeEach(() => notFound.mockClear());

  it("throws the read error, not a 404, when the read fails", async () => {
    reply = { data: null, error: { message: "boom" } };
    await expect(BoardReportPage(params)).rejects.toMatchObject({ message: "boom" });
    expect(notFound).not.toHaveBeenCalled();
  });
  it("is a genuine 404 when there is no such report", async () => {
    reply = { data: null, error: null };
    await expect(BoardReportPage(params)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
  it("renders the report when the read works", async () => {
    reply = { data: { id: "r1" }, error: null };
    render(await BoardReportPage(params));
    expect(screen.getByTestId("doc")).toBeTruthy();
  });
});
