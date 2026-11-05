/**
 * @jest-environment node
 *
 * Security audit 2026-11-05: a profile photo is checked and cleaned on the server (prepareUpload, refused if it cannot be
 * cleaned), written by the service role (patients have no write policy on the public bucket any more), and stored at an opaque
 * path that does not carry the patient's id, so the public URL reveals nothing about whose photo it is.
 */
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const serviceUploads: { bucket: string; path: string; contentType?: string }[] = [];
const serviceRemoves: string[][] = [];
const userUploads: string[] = [];
let profileUpdateError: { message: string } | null = null;
const profileUpdates: Record<string, unknown>[] = [];

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _b: unknown, opts: { contentType?: string }) => {
          serviceUploads.push({ bucket, path, contentType: opts.contentType });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${bucket}/${path}` } }),
        remove: async (paths: string[]) => {
          serviceRemoves.push(paths);
          return { error: null };
        },
      }),
    },
  }),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "patient-1" } } }) },
    storage: { from: () => ({ upload: async (p: string) => { userUploads.push(p); return { error: null }; } }) },
    from: () => ({
      update: (row: Record<string, unknown>) => {
        profileUpdates.push(row);
        return { eq: async () => ({ error: profileUpdateError }) };
      },
    }),
  }),
}));

import { uploadPatientAvatar } from "./actions";

const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
function jpegWithExif(): Uint8Array {
  const exif = [...enc("Exif"), 0, 0, ...enc("GPS-HERE")];
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, exif.length + 2, ...exif, 0xff, 0xda, 0, 2, 0x11, 0x22, 0x33, 0xff, 0xd9]);
}
function form(bytes: Uint8Array, type: string): FormData {
  const f = new FormData();
  f.set("file", new File([Uint8Array.from(bytes)], "me.jpg", { type }));
  return f;
}

beforeEach(() => {
  serviceUploads.length = 0;
  serviceRemoves.length = 0;
  userUploads.length = 0;
  profileUpdates.length = 0;
  profileUpdateError = null;
});

describe("uploadPatientAvatar", () => {
  it("writes the cleaned photo with the service role at a path that does not carry the patient's id", async () => {
    const r = await uploadPatientAvatar(form(jpegWithExif(), "image/jpeg"));
    expect(r.success).toBe(true);
    expect(userUploads).toHaveLength(0);
    expect(serviceUploads).toHaveLength(1);
    expect(serviceUploads[0]!.bucket).toBe("patient-avatars");
    expect(serviceUploads[0]!.path).toMatch(/^v\/[0-9a-f-]{36}\.jpg$/);
    expect(serviceUploads[0]!.path).not.toContain("patient-1");
    expect(r.avatarUrl).not.toContain("patient-1");
    expect(profileUpdates[0]).toEqual({ avatar_url: r.avatarUrl });
  });

  it("refuses a file that is not really a photo, before anything is stored", async () => {
    const r = await uploadPatientAvatar(form(Uint8Array.from(enc("<html><script></script></html>")), "image/jpeg"));
    expect(r.error).toBeTruthy();
    expect(serviceUploads).toHaveLength(0);
  });

  it("removes the stored photo when the profile cannot be updated", async () => {
    profileUpdateError = { message: "rls" };
    const r = await uploadPatientAvatar(form(jpegWithExif(), "image/jpeg"));
    expect(r.error).toBe("rls");
    expect(serviceRemoves).toEqual([[serviceUploads[0]!.path]]);
  });
});
