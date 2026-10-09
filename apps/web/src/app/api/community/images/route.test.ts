/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>();
const upload = jest.fn<(path: string, bytes: Uint8Array, opts: unknown) => Promise<{ error: unknown }>>();
const remove = jest.fn<(paths: string[]) => Promise<{ error: unknown }>>();
let authenticated = true;

jest.mock("@/lib/community/api-auth", () => ({
  authenticateCommunity: async () =>
    authenticated
      ? { userId: "11111111-1111-4111-8111-111111111111", supabase: { rpc } }
      : { response: new Response(JSON.stringify({ error: "Please sign in again." }), { status: 401 }) },
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ storage: { from: () => ({ upload, remove }) } }),
}));

import { POST } from "./route";

const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
function jpegBytes(): Uint8Array {
  const dqt = [0xff, 0xdb, ...be16(67), 0, ...Array<number>(64).fill(8)];
  const sof = [0xff, 0xc0, ...be16(17), 8, ...be16(10), ...be16(10), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, ...be16(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0];
  return Uint8Array.from([0xff, 0xd8, ...dqt, ...sof, ...sos, 1, 2, 3, 0xff, 0xd9]);
}

const GROUP = "22222222-2222-4222-8222-222222222222";
function request(parts: { image?: Uint8Array | string | null; body?: string | null }): Request {
  const form = new FormData();
  form.set("group_id", GROUP);
  if (parts.body !== null) form.set("body", parts.body ?? "A picture of my home cuff");
  if (parts.image !== null) {
    const content = parts.image ?? jpegBytes();
    form.set("image", new File([content as BlobPart], "x.jpg", { type: "image/jpeg" }));
  }
  return new Request("http://localhost/api/community/images", { method: "POST", body: form });
}

beforeEach(() => {
  rpc.mockReset();
  upload.mockReset().mockResolvedValue({ error: null });
  remove.mockReset().mockResolvedValue({ error: null });
  authenticated = true;
});

describe("POST /api/community/images", () => {
  it("needs a signed-in member", async () => {
    authenticated = false;
    expect((await POST(request({}))).status).toBe(401);
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses a file that is not a JPEG or PNG, without storing anything", async () => {
    const res = await POST(request({ image: "<svg onload=alert(1)>" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ status: "refused", reason: "bad_image" });
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a post with no picture or no words", async () => {
    expect((await POST(request({ image: null }))).status).toBe(400);
    expect((await POST(request({ body: null }))).status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("stores the cleaned file under the group's folder and keeps it when the post is held", async () => {
    rpc.mockImplementation(async (fn) => (fn === "community_image_precheck" ? { data: { ok: true }, error: null } : { data: { status: "held", reason: "image", post_id: "p1" }, error: null }));
    const res = await POST(request({}));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("held");
    const [path] = upload.mock.calls[0]!;
    expect(path).toMatch(new RegExp(`^${GROUP}/11111111-1111-4111-8111-111111111111/[0-9a-f-]{36}\\.jpg$`));
    const [fn, args] = rpc.mock.calls[1]!;
    expect(fn).toBe("community_submit_post_with_image");
    expect(args).toMatchObject({ p_group_id: GROUP, p_storage_path: path, p_mime: "image/jpeg", p_width: 10, p_height: 10 });
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ["blocked", { status: "blocked", reason: "contact" }],
    ["refused", { status: "refused", reason: "images_off" }],
    ["a repeat of an earlier request", { status: "held", repeat: true, post_id: "p1" }],
  ])("removes the file again when the post is %s", async (_label, result) => {
    rpc.mockImplementation(async (fn) => (fn === "community_image_precheck" ? { data: { ok: true }, error: null } : { data: result, error: null }));
    await POST(request({}));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("keeps the file when the database answer is lost or unreadable (the post may have been saved)", async () => {
    rpc.mockImplementation(async (fn) => (fn === "community_image_precheck" ? { data: { ok: true }, error: null } : { data: null, error: { message: "boom" } }));
    expect((await POST(request({}))).status).toBe(502);
    rpc.mockImplementation(async (fn) => (fn === "community_image_precheck" ? { data: { ok: true }, error: null } : { data: { surprise: true }, error: null }));
    expect((await POST(request({}))).status).toBe(502);
    expect(remove).not.toHaveBeenCalled();
  });

  it("writes nothing when the database says this person may not post a picture here", async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: "images_off" }, error: null });
    const res = await POST(request({}));
    expect(await res.json()).toEqual({ status: "refused", reason: "images_off" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("never returns raw database text", async () => {
    rpc.mockImplementation(async (fn) => (fn === "community_image_precheck" ? { data: { ok: true }, error: null } : { data: null, error: { message: "relation community_posts permission denied" } }));
    const text = await (await POST(request({}))).text();
    expect(text).not.toMatch(/relation|permission|community_posts/);
  });
});
