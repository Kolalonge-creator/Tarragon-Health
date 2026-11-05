jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));

import { fetchVideoConsultationDetail } from "./consultation-video";

type Result = { data: unknown; error: unknown };

function fakeSupabase(results: Record<string, Result>) {
  const from = jest.fn((table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => results[table],
    };
    return chain;
  });
  return { from } as unknown as Parameters<typeof fetchVideoConsultationDetail>[0];
}

const row = { id: "vc-1", host_start_url: null, join_url: "https://zoom.example/j/1" };

describe("fetchVideoConsultationDetail", () => {
  it("fills host_start_url from the staff-only side table", async () => {
    const supabase = fakeSupabase({
      video_consultations: { data: row, error: null },
      video_consultation_host_links: { data: { host_start_url: "https://zoom.example/s/1?zak=y" }, error: null },
    });
    const result = await fetchVideoConsultationDetail(supabase, "vc-1");
    expect(result?.host_start_url).toBe("https://zoom.example/s/1?zak=y");
    expect(result?.join_url).toBe("https://zoom.example/j/1");
  });

  it("returns a NULL host link when the side table has no row (or the reader may not see it)", async () => {
    const supabase = fakeSupabase({
      video_consultations: { data: row, error: null },
      video_consultation_host_links: { data: null, error: null },
    });
    expect((await fetchVideoConsultationDetail(supabase, "vc-1"))?.host_start_url).toBeNull();
  });

  it("returns null when the consultation is not visible", async () => {
    const supabase = fakeSupabase({
      video_consultations: { data: null, error: null },
      video_consultation_host_links: { data: null, error: null },
    });
    expect(await fetchVideoConsultationDetail(supabase, "vc-1")).toBeNull();
  });

  it("surfaces a side-table error instead of hiding the start button silently", async () => {
    const supabase = fakeSupabase({
      video_consultations: { data: row, error: null },
      video_consultation_host_links: { data: null, error: { message: "boom" } },
    });
    await expect(fetchVideoConsultationDetail(supabase, "vc-1")).rejects.toEqual({ message: "boom" });
  });
});
