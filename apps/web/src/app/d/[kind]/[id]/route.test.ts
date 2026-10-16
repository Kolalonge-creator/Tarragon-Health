/** OQ-336: a signed document link opened while signed out goes to login with a same-origin `next` that returns to the same signed link. */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const getUser = jest.fn<() => Promise<{ data: { user: { id: string } | null } }>>();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
jest.mock("@/lib/notifications/document-link", () => ({
  verifyDocumentLink: (_secret: unknown, _kind: string, _id: string, e: string | null, s: string | null) => e === "1" && s === "good",
  documentTarget: (kind: string, id: string) => `/patient/${kind}/${id}`,
}));

import { GET } from "./route";
import { pickRedirectTarget } from "@tarragon/auth/redirect";

const call = (qs: string) => GET(new Request(`https://app.example.test/d/care-plan/user-1${qs}`), { params: Promise.resolve({ kind: "care-plan", id: "user-1" }) });

describe("GET /d/<kind>/<id>", () => {
  beforeEach(() => { getUser.mockReset(); });

  it("signed out: redirects to /login?next=<the same signed link>, and that next survives the login sanitiser", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await call("?e=1&s=good");
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.pathname).toBe("/login");
    expect(loc.origin).toBe("https://app.example.test");
    const next = loc.searchParams.get("next");
    expect(next).toBe("/d/care-plan/user-1?e=1&s=good");
    expect(pickRedirectTarget({ next })).toBe(next);
  });

  it("a tampered link is a 404 and never reaches login", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call("?e=1&s=bad")).status).toBe(404);
  });

  it("signed in as the owner: goes straight to the document; someone else gets a 404", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    expect(new URL((await call("?e=1&s=good")).headers.get("location") ?? "").pathname).toBe("/patient/care-plan/user-1");
    getUser.mockResolvedValue({ data: { user: { id: "someone-else" } } });
    expect((await call("?e=1&s=good")).status).toBe(404);
  });
});
