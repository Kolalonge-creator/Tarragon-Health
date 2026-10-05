import { recordLoginDevice, type RpcApi } from "./device-recognition";
import { readChosenAuthLocale } from "./auth-locale";

/**
 * Runs once per real sign-in (App.tsx, on the SIGNED_IN event), after the
 * session exists. Everything here is best effort and must never block or
 * fail the sign-in:
 *  1. record the device (new-device notice),
 *  2. carry a language chosen on the signed-out screens into profiles.language.
 */
export interface ProfileLanguageApi {
  setLanguage(userId: string, language: "en" | "pcm"): Promise<{ error: { message: string } | null }>;
}

export interface PostSignInResult {
  deviceRecorded: boolean;
  languageWritten: boolean;
}

export async function runPostSignIn(deps: {
  userId: string;
  rpc: RpcApi;
  profiles: ProfileLanguageApi;
  readChosenLocale?: () => Promise<"en" | "pcm" | null>;
  onLanguageWritten?: () => void;
}): Promise<PostSignInResult> {
  const deviceRecorded = await recordLoginDevice(deps.rpc);
  let languageWritten = false;
  try {
    const chosen = await (deps.readChosenLocale ?? readChosenAuthLocale)();
    if (chosen) {
      const { error } = await deps.profiles.setLanguage(deps.userId, chosen);
      languageWritten = !error;
      if (languageWritten) deps.onLanguageWritten?.();
    }
  } catch {
    languageWritten = false;
  }
  return { deviceRecorded, languageWritten };
}
