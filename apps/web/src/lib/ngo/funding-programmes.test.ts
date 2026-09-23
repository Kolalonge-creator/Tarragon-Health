import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  claimFundingProgrammeInvitation,
  createFundingProgramme,
  inviteToFundingProgramme,
  revokeFundingProgrammeInvitation,
  setFundingProgrammeStatus,
} from "./funding-programmes";

function mockClient(rpc: jest.Mock) {
  return { rpc } as unknown as SupabaseClient<Database>;
}

describe("funding-programmes RPC wrappers", () => {
  it("createFundingProgramme maps camelCase input to the RPC's p_ args", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: "programme-id", error: null });
    await createFundingProgramme(mockClient(rpc), {
      organisationId: "org-1",
      serviceProductId: "product-1",
      name: "Test Programme",
      contractReference: "CONTRACT-1",
      fundedUnitCap: 50,
      priceKobo: 1000000,
    });
    expect(rpc).toHaveBeenCalledWith("create_funding_programme", {
      p_organisation_id: "org-1",
      p_service_product_id: "product-1",
      p_name: "Test Programme",
      p_contract_reference: "CONTRACT-1",
      p_funded_unit_cap: 50,
      p_price_kobo: 1000000,
      p_starts_at: undefined,
      p_ends_at: undefined,
    });
  });

  it("createFundingProgramme throws the Supabase error rather than swallowing it", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: new Error("not an NGO organisation") });
    await expect(
      createFundingProgramme(mockClient(rpc), {
        organisationId: "org-1",
        serviceProductId: "product-1",
        name: "Test",
        contractReference: "C-1",
        fundedUnitCap: 10,
      })
    ).rejects.toThrow("not an NGO organisation");
  });

  it("setFundingProgrammeStatus passes status and an optional note through", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    await setFundingProgrammeStatus(mockClient(rpc), "programme-1", "active", "signed contract");
    expect(rpc).toHaveBeenCalledWith("set_funding_programme_status", {
      p_programme_id: "programme-1",
      p_status: "active",
      p_note: "signed contract",
    });
  });

  it("inviteToFundingProgramme rejects a contact with neither phone nor email before ever calling the RPC", async () => {
    const rpc = jest.fn();
    await expect(
      inviteToFundingProgramme(mockClient(rpc), "programme-1", [{ full_name: "No Contact Info" }])
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("inviteToFundingProgramme rejects a non-E.164 phone number before ever calling the RPC", async () => {
    const rpc = jest.fn();
    await expect(
      inviteToFundingProgramme(mockClient(rpc), "programme-1", [{ phone: "08012345678" }])
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("inviteToFundingProgramme forwards a valid contact list", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { invited: 1 }, error: null });
    const result = await inviteToFundingProgramme(mockClient(rpc), "programme-1", [
      { phone: "+2348012345678", full_name: "A Beneficiary" },
    ]);
    expect(result).toEqual({ invited: 1 });
    expect(rpc).toHaveBeenCalledWith("invite_to_funding_programme", {
      p_programme_id: "programme-1",
      p_contacts: [{ phone: "+2348012345678", full_name: "A Beneficiary" }],
    });
  });

  it("revokeFundingProgrammeInvitation forwards the invitation id and reason", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    await revokeFundingProgrammeInvitation(mockClient(rpc), "invite-1", "sent by mistake");
    expect(rpc).toHaveBeenCalledWith("revoke_funding_programme_invitation", {
      p_invitation_id: "invite-1",
      p_reason: "sent by mistake",
    });
  });

  it("claimFundingProgrammeInvitation returns the RPC's voucher payload", async () => {
    const payload = {
      voucher_id: "voucher-1",
      voucher_number: "TAR-VCH-000001",
      sku_name: "Preventive Health Check Review",
      face_value_kobo: 1500000,
    };
    const rpc = jest.fn().mockResolvedValue({ data: payload, error: null });
    const result = await claimFundingProgrammeInvitation(mockClient(rpc), "a-real-token");
    expect(result).toEqual(payload);
    expect(rpc).toHaveBeenCalledWith("claim_funding_programme_invitation", { p_token: "a-real-token" });
  });
});
