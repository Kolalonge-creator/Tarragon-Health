/**
 * With the platform-wide Pidgin switch off, a patient cannot save Pidgin as
 * their interface language (a stale open tab could still post it), but can still
 * save English; with it on, Pidgin saves as before.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const update = jest.fn();
const eq = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({ update: (v: unknown) => { update(v); return { eq }; } }),
  })),
}));

const pidginEnabled = jest.fn();
jest.mock("@/lib/language/pidgin-switch", () => ({ getPidginEnabled: () => pidginEnabled() }));

import { updateUiLanguage } from "./ui-language-actions";

function form(language: string) {
  const f = new FormData();
  f.set("language", language);
  return f;
}

describe("updateUiLanguage and the Pidgin kill switch", () => {
  beforeEach(() => {
    update.mockReset();
    eq.mockReset().mockResolvedValue({ error: null });
  });

  it("refuses to save Pidgin while the switch is off, and writes nothing", async () => {
    pidginEnabled.mockResolvedValue(false);
    const result = await updateUiLanguage(undefined, form("pcm"));
    expect(result?.error).toMatch(/not available/i);
    expect(update).not.toHaveBeenCalled();
  });

  it("still saves English while the switch is off", async () => {
    pidginEnabled.mockResolvedValue(false);
    expect(await updateUiLanguage(undefined, form("en"))).toEqual({ success: true });
    expect(update).toHaveBeenCalledWith({ language: "en" });
  });

  it("saves Pidgin while the switch is on", async () => {
    pidginEnabled.mockResolvedValue(true);
    expect(await updateUiLanguage(undefined, form("pcm"))).toEqual({ success: true });
    expect(update).toHaveBeenCalledWith({ language: "pcm" });
  });
});
