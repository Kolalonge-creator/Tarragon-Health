/**
 * The testing-day calendar file: signed out is 401, a booking that is not in the caller's own my_testing_bookings is 404
 * (the function only ever returns the caller's rows), a failed read is 503 and never an empty file, a confirmed place on a
 * day that has ended is not exported, and links use the host the person reached the app on.
 */

const getUser = jest.fn();
const rpc = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockImplementation(async () => ({ auth: { getUser }, rpc })),
}));

import { GET } from "./route";

const MINE = "11111111-1111-4111-8111-111111111111";
const booking = (over: Record<string, unknown> = {}) => ({
  booking_id: MINE,
  state: "confirmed",
  kind: "public_day",
  event_id: "22222222-2222-4222-8222-222222222222",
  event_date: "2026-11-20",
  starts_at: "09:00:00",
  ends_at: "15:00:00",
  venue_name: "Ikeja Civic Hall",
  address: "12 Obafemi Awolowo Way",
  city: "Ikeja",
  lga: null,
  state_name: "Lagos",
  directions: null,
  event_status: "open",
  waitlist_position: null,
  ...over,
});

function call(id: string) {
  const request = new Request(`http://internal/api/calendar/testing/${id}`, { headers: { host: "app.tarragonhealth.ng", "x-forwarded-proto": "https" } });
  return GET(request, { params: Promise.resolve({ bookingId: id }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "patient-1" } } });
  rpc.mockResolvedValue({ data: [booking()], error: null });
});

it("refuses a signed-out caller", async () => {
  getUser.mockResolvedValue({ data: { user: null } });
  expect((await call(MINE)).status).toBe(401);
});

it("returns the caller's own confirmed place, with links on the host they used", async () => {
  const res = await call(MINE);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/calendar");
  const body = await res.text();
  expect(body).toContain("DTSTART:20261120T080000Z");
  expect(body).toContain("URL:https://app.tarragonhealth.ng/patient/testing-days");
});

it("404s an id that is not among the caller's bookings", async () => {
  expect((await call("33333333-3333-4333-8333-333333333333")).status).toBe(404);
});

it("404s a malformed id without reading anything", async () => {
  expect((await call("not-a-uuid")).status).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
});

it("does not export a place on a day that is completed or cancelled, or a waiting-list place", async () => {
  rpc.mockResolvedValue({ data: [booking({ event_status: "completed" })], error: null });
  expect((await call(MINE)).status).toBe(404);
  rpc.mockResolvedValue({ data: [booking({ state: "waitlisted" })], error: null });
  expect((await call(MINE)).status).toBe(404);
});

it("answers 503, not an empty file, when the read fails", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
  expect((await call(MINE)).status).toBe(503);
});
