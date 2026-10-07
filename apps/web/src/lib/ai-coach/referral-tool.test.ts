import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Constants, type Database } from "@tarragon/shared";
import { buildReferralRequestTool } from "./referral-tool";
import { chainable } from "./test-support";

function fakeServiceRole(alertResult: unknown = { data: { id: "alert-1" }, error: null }) {
  const from = jest.fn(() => ({ insert: jest.fn(() => chainable(alertResult)) }));
  return { from } as unknown as SupabaseClient<Database>;
}

describe("buildReferralRequestTool", () => {
  it("does NOT call getServiceRoleSupabase until the tool is actually invoked", () => {
    const getServiceRoleSupabase = jest.fn(() => fakeServiceRole());
    buildReferralRequestTool({
      patientSupabase: { rpc: jest.fn() } as unknown as SupabaseClient<Database>,
      getServiceRoleSupabase,
      organisationId: "org-1",
      patientId: "pat-1",
      conversationId: "conv-1",
      onReferralRequested: jest.fn(),
    });

    // Building the tool (what graph.ts does for every turn, whether or not
    // the model ends up calling it) must not construct the service-role
    // client -- doing so eagerly would throw in any environment missing
    // SUPABASE_SERVICE_ROLE_KEY and break every chat turn, not just
    // referral requests.
    expect(getServiceRoleSupabase).not.toHaveBeenCalled();
  });

  it("on success: calls onReferralRequested with the created ids and tells the model this is a request, not a booking", async () => {
    const rpc = jest.fn(async () => ({ data: "thread-1", error: null }));
    const onReferralRequested = jest.fn();
    const tool = buildReferralRequestTool({
      patientSupabase: { rpc } as unknown as SupabaseClient<Database>,
      getServiceRoleSupabase: () => fakeServiceRole(),
      organisationId: "org-1",
      patientId: "pat-1",
      conversationId: "conv-1",
      onReferralRequested,
    });

    const output = await tool.invoke({ specialistType: "cardiology", reason: "chest tightness on exertion" });

    expect(onReferralRequested).toHaveBeenCalledWith({ clinicianAlertId: "alert-1", careMessageThreadId: "thread-1" });
    const parsed = JSON.parse(output as string);
    expect(parsed.requested).toBe(true);
    // Must plainly deny that anything is booked -- it's a request, not a
    // clinical decision or an appointment (this is the whole point of
    // routing through this tool instead of writing specialist_referrals
    // directly, see referral-request.ts's own header).
    expect(parsed.note.toLowerCase()).toContain("not a booked appointment");
  });

  it("on failure: never throws, does not call onReferralRequested, and says so plainly", async () => {
    const getServiceRoleSupabase = () => fakeServiceRole({ data: null, error: { message: "boom" } });
    const onReferralRequested = jest.fn();
    const tool = buildReferralRequestTool({
      patientSupabase: { rpc: jest.fn() } as unknown as SupabaseClient<Database>,
      getServiceRoleSupabase,
      organisationId: "org-1",
      patientId: "pat-1",
      conversationId: "conv-1",
      onReferralRequested,
    });

    const output = await tool.invoke({ specialistType: "cardiology", reason: "chest tightness" });

    expect(onReferralRequested).not.toHaveBeenCalled();
    const parsed = JSON.parse(output as string);
    expect(parsed.requested).toBe(false);
  });

  it("schema requires a specialistType and reason -- exposes no patientId argument", () => {
    const tool = buildReferralRequestTool({
      patientSupabase: { rpc: jest.fn() } as unknown as SupabaseClient<Database>,
      getServiceRoleSupabase: () => fakeServiceRole(),
      organisationId: "org-1",
      patientId: "pat-1",
      conversationId: "conv-1",
      onReferralRequested: jest.fn(),
    });

    const schemaShape = (tool as unknown as { schema: { shape: Record<string, unknown> } }).schema.shape;
    expect(Object.keys(schemaShape).sort()).toEqual(["reason", "specialistType"]);
  });

  it("specialistType enum covers every live specialist_type value -- a patient asking for a type left out here can never be flagged", () => {
    // Before this was derived from @tarragon/shared's SPECIALIST_TYPE_VALUES,
    // this file hand-copied its own subset of the enum and silently drifted
    // out of sync with it (missing psychiatry, psychology, and
    // genitourinary_medicine) as the enum grew -- see
    // packages/shared/src/specialist-type-options.test.ts for the sibling
    // assertion against every other call site.
    const tool = buildReferralRequestTool({
      patientSupabase: { rpc: jest.fn() } as unknown as SupabaseClient<Database>,
      getServiceRoleSupabase: () => fakeServiceRole(),
      organisationId: "org-1",
      patientId: "pat-1",
      conversationId: "conv-1",
      onReferralRequested: jest.fn(),
    });

    const schemaShape = (tool as unknown as { schema: { shape: { specialistType: { options: string[] } } } }).schema
      .shape;
    const liveValues = [...Constants.public.Enums.specialist_type].sort();
    expect([...schemaShape.specialistType.options].sort()).toEqual(liveValues);
  });
});
