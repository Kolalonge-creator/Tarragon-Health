/**
 * INV-05: a self-harm concern the MODEL flags, in wording no keyword matched, must still bring in a person. The keyword screen is the floor;
 * the model's flag only adds the page (same queue, same dedupe), it never lowers anything.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SELF_HARM_REPLY, type Database } from "@tarragon/shared";

const pageOnCallForSelfHarm = jest.fn(async () => true);
jest.mock("./emergency-page", () => ({ pageOnCallForSelfHarm }));
jest.mock("./nearest-hospital", () => ({ emergencyAddendumFor: jest.fn(async () => "") }));

import { finalizeModelReply } from "./graph";
import { buildEmergencyReply } from "./emergency-reply";

const supabase = {} as unknown as SupabaseClient<Database>;
const MESSAGE = "I just want everything to stop";

describe("a self-harm concern flagged by the model", () => {
  it("is finalised as an emergency with the self-harm flag, even if the model called the tier routine", () => {
    const out = finalizeModelReply({
      result: { tier: "routine", reply: "I hear you.", suggestedAction: "none", isHealthInformationRequest: false, isSelfHarmConcern: true },
      incomingMessage: MESSAGE,
      grounded: false,
      sources: [],
    });
    expect(out.tier).toBe("emergency");
    expect(out.selfHarm).toBe(true);
  });

  it("pages the on-call clinician and uses the self-harm copy", async () => {
    pageOnCallForSelfHarm.mockClear();
    const out = await buildEmergencyReply({ supabase, service: supabase }, { profileId: "p1", conversationId: "c1", message: MESSAGE, selfHarmHint: true });
    expect(pageOnCallForSelfHarm).toHaveBeenCalledTimes(1);
    expect(out.selfHarm).toBe(true);
    expect(out.reply.startsWith(SELF_HARM_REPLY)).toBe(true);
  });

  it("with neither the model's flag nor a keyword there is no page", async () => {
    pageOnCallForSelfHarm.mockClear();
    await buildEmergencyReply({ supabase, service: supabase }, { profileId: "p1", conversationId: "c1", message: "my chest hurts" });
    expect(pageOnCallForSelfHarm).not.toHaveBeenCalled();
  });

  it("an ordinary reply without the flag is untouched", () => {
    const out = finalizeModelReply({
      result: { tier: "routine", reply: "Good morning.", suggestedAction: "none", isHealthInformationRequest: false },
      incomingMessage: "hello",
      grounded: false,
      sources: [],
    });
    expect(out.tier).toBe("routine");
    expect(out.selfHarm).toBeUndefined();
  });
});
