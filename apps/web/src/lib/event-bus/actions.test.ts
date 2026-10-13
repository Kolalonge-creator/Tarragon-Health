import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>>();
let role: string | null = "admin";

jest.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => (role ? { role } : null) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { replayDeliveryAction } from "./actions";

const ID = "6f1d7a2e-3b44-4c8e-9a51-0c2d1e8f7a10";
function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
async function run(f: FormData): Promise<string> {
  try {
    await replayDeliveryAction(f);
  } catch (e) {
    return (e as Error).message;
  }
  return "no redirect";
}

describe("replayDeliveryAction", () => {
  beforeEach(() => {
    rpc.mockReset();
    role = "admin";
  });

  it("replays through the audited database function and reports ok", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await run(form({ delivery_id: ID, status: "dead", subscriber: "paging.on_red" }))).toBe("REDIRECT:/admin/ops/event-bus?status=dead&subscriber=paging.on_red&r=ok");
    expect(rpc).toHaveBeenCalledWith("replay_event_delivery", { p_delivery_id: ID, p_redo_effects: false });
  });

  it("never calls the database for someone who is not an admin", async () => {
    role = "clinician";
    expect(await run(form({ delivery_id: ID }))).toBe("REDIRECT:/admin/ops/event-bus?r=failed");
    role = null;
    expect(await run(form({ delivery_id: ID }))).toBe("REDIRECT:/admin/ops/event-bus?r=failed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an id that is not a uuid before calling the database", async () => {
    expect(await run(form({ delivery_id: "1; drop table x" }))).toBe("REDIRECT:/admin/ops/event-bus?r=failed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("tells the admin when the delivery is running right now (55P03)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55P03" } });
    expect(await run(form({ delivery_id: ID }))).toBe("REDIRECT:/admin/ops/event-bus?r=busy");
  });

  it("reports failure on a database error or a delivery that no longer exists, never success", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await run(form({ delivery_id: ID }))).toBe("REDIRECT:/admin/ops/event-bus?r=failed");
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await run(form({ delivery_id: ID }))).toBe("REDIRECT:/admin/ops/event-bus?r=failed");
  });

  it("drops filter values that are not a known shape when it sends the admin back", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await run(form({ delivery_id: ID, status: "bogus", subscriber: "A B" }))).toBe("REDIRECT:/admin/ops/event-bus?r=ok");
  });
});
