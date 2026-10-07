/** @jest-environment jsdom */
/**
 * S70a, 18.9: the held-readings card shows what was held in plain words, offers only "enter it again" or "leave it out", always carries the
 * safety line, shows nothing when nothing is held, and says so when it cannot tell.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let result: { data: unknown[] | null; error: unknown };
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.order = () => b;
      b.limit = async () => result;
      return b;
    },
    rpc: async () => ({ error: null }),
  }),
}));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import { describeHeld, HeldReadingsCard } from "./held-readings-card";

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("describeHeld", () => {
  it("reads each kind back in its own unit", () => {
    expect(describeHeld({ vital_type: "blood_pressure", payload: { systolic: 320, diastolic: 90 } })).toBe("320/90 mmHg");
    expect(describeHeld({ vital_type: "glucose", payload: { glucose_mmol_l: 60 } })).toBe("60 mmol/L");
    expect(describeHeld({ vital_type: "spo2", payload: { spo2_pct: 40 } })).toBe("40%");
    expect(describeHeld({ vital_type: "ketones", payload: {} })).toBe("a reading");
  });
});

describe("HeldReadingsCard", () => {
  it("shows nothing when nothing is held", async () => {
    result = { data: [], error: null };
    const { container } = wrap(<HeldReadingsCard patientId="p1" />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("shows the held value, its source, the two choices and the safety line", async () => {
    result = { data: [{ id: "h1", vital_type: "blood_pressure", source: "device", payload: { systolic: 320, diastolic: 90 }, created_at: "2026-10-07T10:00:00Z" }], error: null };
    wrap(<HeldReadingsCard patientId="p1" />);
    expect(await screen.findByText("Please check this reading")).not.toBeNull();
    expect(screen.getByText(/320\/90 mmHg/)).not.toBeNull();
    expect(screen.getByText("From your device")).not.toBeNull();
    expect(screen.getByText("Enter it again")).not.toBeNull();
    expect(screen.getByText("It was a mistake, leave it out")).not.toBeNull();
    expect(screen.getByText(/If you feel unwell, do not wait/)).not.toBeNull();
  });

  it("says so when it cannot tell, rather than showing nothing", async () => {
    result = { data: null, error: new Error("boom") };
    wrap(<HeldReadingsCard patientId="p1" />);
    expect(await screen.findByText(/could not check for readings waiting/)).not.toBeNull();
  });
});
