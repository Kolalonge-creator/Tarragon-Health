/**
 * claimReservation() is the recipient's own claim wrapper around
 * claim_sponsored_service_reservation — it must refuse before calling the
 * RPC at all when nobody is signed in, pass the RPC's own error message
 * straight through on refusal (invalid token, wrong phone, expired, etc. —
 * see that migration's own error strings), and map a genuine success onto
 * the shape claim-card.tsx renders.
 */

const getCurrentUser = jest.fn();
const rpc = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: () => getCurrentUser(),
  createClient: jest.fn().mockResolvedValue({ rpc }),
}));

import { claimReservation } from "./actions";

describe("claimReservation", () => {
  beforeEach(() => {
    getCurrentUser.mockReset();
    rpc.mockReset();
  });

  it("refuses without calling the RPC when nobody is signed in", async () => {
    getCurrentUser.mockResolvedValue(null);

    const result = await claimReservation("tok_abc123");

    expect(result).toEqual({ error: "Not signed in" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the RPC's own refusal message straight through", async () => {
    getCurrentUser.mockResolvedValue({ id: "recipient-1" });
    rpc.mockResolvedValue({
      data: null,
      error: { message: "this invitation was sent to a different phone number than the one on your account" },
    });

    const result = await claimReservation("tok_abc123");

    expect(result).toEqual({
      error: "this invitation was sent to a different phone number than the one on your account",
    });
  });

  it("calls the RPC with the token and maps a genuine success onto the claim-card shape", async () => {
    getCurrentUser.mockResolvedValue({ id: "recipient-1" });
    rpc.mockResolvedValue({
      data: { ok: true, voucher_id: "v-1", voucher_number: "RSV-ABC123", sku_name: "Annual Health Check", face_value_kobo: 500000 },
      error: null,
    });

    const result = await claimReservation("tok_abc123");

    expect(rpc).toHaveBeenCalledWith("claim_sponsored_service_reservation", { p_token: "tok_abc123" });
    expect(result).toEqual({
      ok: true,
      skuName: "Annual Health Check",
      faceValueKobo: 500000,
      voucherNumber: "RSV-ABC123",
    });
  });
});
