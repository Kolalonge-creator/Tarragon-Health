/** The booking price on the Appointments screen is the real price or nothing: never a guess, never zero. */
import { supabase } from "./supabase";
import { loadBookingPriceKobo } from "./appointments";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));
jest.mock("./api", () => ({ postAppointmentVideoSetup: jest.fn() }));
const rpc = supabase.rpc as unknown as jest.Mock;

describe("loadBookingPriceKobo", () => {
  it("returns the price from the booking terms", async () => {
    rpc.mockResolvedValueOnce({ data: { price_kobo: 1_000_000, bookable: true }, error: null });
    expect(await loadBookingPriceKobo("telemedicine")).toBe(1_000_000);
    expect(rpc).toHaveBeenCalledWith("my_booking_terms", { p_appointment_type: "telemedicine" });
  });
  it("is null for an error, an unpriced type, zero, or a malformed answer", async () => {
    for (const res of [
      { data: null, error: { message: "x" } },
      { data: { price_kobo: null }, error: null },
      { data: { price_kobo: 0 }, error: null },
      { data: { price_kobo: "100" }, error: null },
      { data: [], error: null },
      { data: null, error: null },
    ]) {
      rpc.mockResolvedValueOnce(res);
      expect(await loadBookingPriceKobo("telemedicine")).toBeNull();
    }
  });
});
