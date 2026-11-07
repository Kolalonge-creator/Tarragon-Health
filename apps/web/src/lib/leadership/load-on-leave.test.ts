import { loadOnLeave } from "./load-on-leave";

function client(result: { data: unknown[] | null; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "lte", "gt", "returns"]) chain[m] = () => chain;
  chain.then = (resolve: (r: unknown) => unknown) => resolve(result);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => chain } as any;
}

describe("loadOnLeave", () => {
  it("keeps one line per clinician with the latest return date", async () => {
    const rows = [
      { clinician_id: "a", ends_at: "2026-11-09T00:00:00Z", clinician: { full_name: "Dr A" } },
      { clinician_id: "a", ends_at: "2026-11-12T00:00:00Z", clinician: { full_name: "Dr A" } },
      { clinician_id: "b", ends_at: "2026-11-10T00:00:00Z", clinician: null },
    ];
    await expect(loadOnLeave(client({ data: rows, error: null }), new Date())).resolves.toEqual([
      { name: "Dr A", until: "2026-11-12T00:00:00Z" },
      { name: "A clinician", until: "2026-11-10T00:00:00Z" },
    ]);
  });

  it("returns null when the read fails, so the page says unknown rather than nobody on leave", async () => {
    await expect(loadOnLeave(client({ data: null, error: { message: "x" } }), new Date())).resolves.toBeNull();
  });
});
