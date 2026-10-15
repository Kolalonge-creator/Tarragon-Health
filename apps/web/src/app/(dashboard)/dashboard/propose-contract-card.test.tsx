/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));

import { ProposeContractCard } from "./propose-contract-card";
import { proposeContractChange } from "@/lib/outcomes-contracts/propose-contract-change";
import { createClient } from "@/lib/supabase/server";

describe("S-14 fee-at-risk freeze in the proposal form", () => {
  it("does not offer or default to fee_at_risk", () => {
    const html = renderToStaticMarkup(createElement(ProposeContractCard, { organisationId: "org-1" }));
    expect(html).not.toContain("fee_at_risk");
    expect(html).not.toMatch(/Fee-at-risk/);
    expect(html).toMatch(/<option value="flat"[^>]*selected/);
  });

  it("refuses a fee_at_risk submission before calling the database", async () => {
    const fd = new FormData();
    fd.set("contractType", "fee_at_risk");
    const result = await proposeContractChange("org-1", undefined, fd);
    expect(result?.error).toMatch(/paused/);
    expect(createClient).not.toHaveBeenCalled();
  });
});
