/**
 * The phone's text-meal endpoint (S49a). The outbox replays it, so idempotency and "the phone's numbers are never trusted" are the points.
 */
const insertMeal = jest.fn();
jest.mock("@/lib/nutrition/meal-log", () => ({ insertMeal: (...a: unknown[]) => insertMeal(...a) }));

let user: { id: string } | null = { id: "patient-1" };
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: "bad" } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" } }) }) }) }),
  }),
}));

import { POST } from "./route";

const CID = "33333333-3333-4333-8333-333333333333";
const req = (body: unknown, auth: string | null = "Bearer tok") =>
  new Request("http://x/api/mobile/nutrition/meal-log", {
    method: "POST",
    headers: auth ? { authorization: auth, "content-type": "application/json" } : { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  insertMeal.mockReset().mockResolvedValue({ ok: true, id: "e1", duplicate: false });
  user = { id: "patient-1" };
});

describe("POST /api/mobile/nutrition/meal-log", () => {
  it("401 without a bearer token", async () => {
    expect((await POST(req({}, null))).status).toBe(401);
    expect(insertMeal).not.toHaveBeenCalled();
  });

  it("401 with an invalid session", async () => {
    user = null;
    expect((await POST(req({ meal_type: "lunch", description: "rice", client_id: CID }))).status).toBe(401);
  });

  it("400 for a bad body, and never writes", async () => {
    expect((await POST(req({ meal_type: "brunch", description: "rice", client_id: CID }))).status).toBe(400);
    expect((await POST(req({ meal_type: "lunch", description: "rice", client_id: "nope" }))).status).toBe(400);
    expect((await POST(req({ meal_type: "lunch", description: "", client_id: CID }))).status).toBe(400);
    expect((await POST(req("{not json"))).status).toBe(400);
    expect(insertMeal).not.toHaveBeenCalled();
  });

  it("saves the words and the client id, and ignores any numbers the phone tries to send", async () => {
    const res = await POST(req({ meal_type: "lunch", description: "a wrap of eba", client_id: CID, client_recorded_at: "2026-10-20T10:00:00+01:00", nutrition_analysis: { caloriesKcal: 1 } }));
    expect(res.status).toBe(200);
    const [, ctx, input] = insertMeal.mock.calls[0]!;
    expect(ctx).toEqual({ userId: "patient-1", organisationId: "org-1" });
    expect(input).toEqual({ mealType: "lunch", description: "a wrap of eba", clientId: CID, clientRecordedAt: "2026-10-20T10:00:00+01:00" });
    expect(JSON.stringify(input)).not.toContain("caloriesKcal");
  });

  it("a replay of the same client id is a 200 duplicate, so the outbox stops retrying", async () => {
    insertMeal.mockResolvedValue({ ok: true, id: null, duplicate: true });
    const res = await POST(req({ meal_type: "lunch", description: "rice", client_id: CID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, duplicate: true });
  });

  it("a database failure is a 500 the outbox retries, never a false success", async () => {
    insertMeal.mockResolvedValue({ ok: false, error: "down" });
    expect((await POST(req({ meal_type: "lunch", description: "rice", client_id: CID }))).status).toBe(500);
  });

  it("an unreadable food list is a 503 so the outbox retries, instead of saving an uncounted meal", async () => {
    insertMeal.mockResolvedValue({ ok: false, error: "The food list is unavailable", retryable: true });
    expect((await POST(req({ meal_type: "lunch", description: "rice", client_id: CID }))).status).toBe(503);
  });

  it("a refusal that will never succeed is a 4xx so the outbox holds it for the person and does not retry forever", async () => {
    insertMeal.mockResolvedValue({ ok: false, error: "x", code: "23514" });
    expect((await POST(req({ meal_type: "lunch", description: "rice", client_id: CID }))).status).toBe(422);
    insertMeal.mockResolvedValue({ ok: false, error: "x", code: "42501" });
    expect((await POST(req({ meal_type: "lunch", description: "rice", client_id: CID }))).status).toBe(403);
  });
});
