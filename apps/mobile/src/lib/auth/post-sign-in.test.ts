import { runPostSignIn, type ProfileLanguageApi } from "./post-sign-in";
import type { RpcApi } from "./device-recognition";

const okRpc = { rpc: jest.fn(async () => ({ error: null })) } as unknown as RpcApi;
const failingRpc = {
  rpc: jest.fn(async () => {
    throw new Error("offline");
  }),
} as unknown as RpcApi;

function profiles(error: { message: string } | null = null) {
  const setLanguage = jest.fn(async () => ({ error }));
  return { api: { setLanguage } as ProfileLanguageApi, setLanguage };
}

describe("runPostSignIn", () => {
  it("records the device and writes a chosen language once", async () => {
    const p = profiles();
    const onWritten = jest.fn();
    const out = await runPostSignIn({
      userId: "u1",
      rpc: okRpc,
      profiles: p.api,
      readChosenLocale: async () => "pcm",
      onLanguageWritten: onWritten,
    });
    expect(out).toEqual({ deviceRecorded: true, languageWritten: true });
    expect(p.setLanguage).toHaveBeenCalledWith("u1", "pcm");
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  it("does not touch profiles.language when nothing was chosen", async () => {
    const p = profiles();
    const out = await runPostSignIn({
      userId: "u1",
      rpc: okRpc,
      profiles: p.api,
      readChosenLocale: async () => null,
    });
    expect(out.languageWritten).toBe(false);
    expect(p.setLanguage).not.toHaveBeenCalled();
  });

  it("a device-record failure does not block the rest or throw", async () => {
    const p = profiles();
    const out = await runPostSignIn({
      userId: "u1",
      rpc: failingRpc,
      profiles: p.api,
      readChosenLocale: async () => "en",
    });
    expect(out).toEqual({ deviceRecorded: false, languageWritten: true });
  });

  it("keeps the local choice if the profile write fails", async () => {
    const p = profiles({ message: "rls" });
    const onWritten = jest.fn();
    const out = await runPostSignIn({
      userId: "u1",
      rpc: okRpc,
      profiles: p.api,
      readChosenLocale: async () => "pcm",
      onLanguageWritten: onWritten,
    });
    expect(out.languageWritten).toBe(false);
    expect(onWritten).not.toHaveBeenCalled();
  });
});
