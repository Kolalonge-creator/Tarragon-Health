import { isValidElement, type ReactElement } from "react";

const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
jest.mock("./feature-consent-prompt", () => ({ FeatureConsentPrompt: function FeatureConsentPrompt() { return null; } }));

import { FeatureConsentGate } from "./feature-consent-gate";
import { FeatureConsentPrompt } from "./feature-consent-prompt";

const CHILD = <span>the form</span>;

async function run(onBehalfOf = false): Promise<ReactElement> {
  return (await FeatureConsentGate({ dataType: "reproductive", children: CHILD, onBehalfOf })) as ReactElement;
}
/** The gate returns a fragment around its children when open, and the prompt element when closed. */
function showsForm(el: ReactElement): boolean {
  return isValidElement(el) && el.type !== FeatureConsentPrompt;
}

describe("FeatureConsentGate (S47d)", () => {
  beforeEach(() => rpc.mockReset());

  it("shows the form when the person has said yes", async () => {
    rpc.mockResolvedValue({ data: { on: true }, error: null });
    expect(showsForm(await run())).toBe(true);
    expect(rpc).toHaveBeenCalledWith("feature_consent_state", { p_data_type: "reproductive" });
  });

  it("shows the prompt, not the form, when the person has not said yes", async () => {
    rpc.mockResolvedValue({ data: { on: false, asked: false }, error: null });
    expect(showsForm(await run())).toBe(false);
  });

  it("fails closed: a failed lookup shows the prompt", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(showsForm(await run())).toBe(false);
  });

  it("a malformed answer is treated as no", async () => {
    rpc.mockResolvedValue({ data: { on: "true" }, error: null });
    expect(showsForm(await run())).toBe(false);
  });

  it("a carer looking at someone else's page is not asked (the database still refuses the write)", async () => {
    expect(showsForm(await run(true))).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});
