/** @jest-environment jsdom */
/** Design audit P3: the help button comes first; the location choice is folded under it but its state is always visible. */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { granted: true }, error: null }) }) }) }),
    rpc: jest.fn(),
  }),
}));

import { HelpAlertCard } from "./help-alert-card";

function renderIt() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <HelpAlertCard patientId="p1" locale="en" />
    </QueryClientProvider>,
  );
}

describe("HelpAlertCard order", () => {
  it("shows the help button before the folded location section, and the section is closed by default", async () => {
    const { container } = renderIt();
    const button = container.querySelector("button") as HTMLElement;
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(button.textContent).toMatch(/help/i);
    expect(details.open).toBe(false);
    expect(button.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the current location choice in the folded heading once it is read", async () => {
    renderIt();
    expect(await screen.findAllByText(/location/i)).not.toHaveLength(0);
  });
});
