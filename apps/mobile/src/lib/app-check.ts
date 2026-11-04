import { Platform } from "react-native";

/**
 * Firebase App Check for the Android app, attested by Google Play Integrity (Firebase project tarragonhealth-f19b3).
 *
 * Every call to our API (src/lib/api.ts) carries an `X-Firebase-AppCheck` token when one is available, so the server can
 * tell the real Play-installed app from a script replaying a stolen session. The server starts in MONITOR mode
 * (apps/web/src/lib/app-check/verify.ts): it records what it sees and refuses nothing. Enforcement is a later, separate
 * decision once real traffic shows the tokens arriving.
 *
 * FAILS OPEN, ALWAYS. A missing native module (iOS for now, Expo Go, tests), an attestation that is slow or refused, or
 * any exception gives no header, never an error and never a delay longer than TOKEN_TIMEOUT_MS. A patient logging a
 * dangerous reading must never wait on Play Integrity.
 *
 * Debug builds use App Check's debug provider: the first run prints a debug token to the device log, which is added in the
 * Firebase console (App Check > Apps > Manage debug tokens) so a development build can obtain tokens too.
 */

export const APP_CHECK_HEADER = "X-Firebase-AppCheck";
export const TOKEN_TIMEOUT_MS = 2500;

export interface AppCheckBackend {
  /** Initialise once; resolves to a token getter. */
  init(debug: boolean): Promise<() => Promise<string | null>>;
}

/** The real backend, loaded lazily so a build without the native module never crashes on import. */
const nativeBackend: AppCheckBackend = {
  async init(debug) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { getApp } = require("@react-native-firebase/app") as typeof import("@react-native-firebase/app");
    const appCheckModule = require("@react-native-firebase/app-check") as typeof import("@react-native-firebase/app-check");
    /* eslint-enable @typescript-eslint/no-require-imports */
    // The index re-exports the provider class from ./modular at run time, but its type barrel exports the same name
    // type-only, so TypeScript cannot see the constructor. Reach it with the type the package itself declares.
    const ProviderClass = (
      appCheckModule as unknown as {
        ReactNativeFirebaseAppCheckProvider: new () => import("@react-native-firebase/app-check").ReactNativeFirebaseAppCheckProvider;
      }
    ).ReactNativeFirebaseAppCheckProvider;
    const provider = new ProviderClass();
    provider.configure({
      android: { provider: debug ? "debug" : "playIntegrity" },
      apple: { provider: debug ? "debug" : "appAttestWithDeviceCheckFallback" },
    });
    const instance = await appCheckModule.initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
    return async () => {
      const result = await appCheckModule.getToken(instance, false);
      return result?.token ? result.token : null;
    };
  },
};

let getter: Promise<(() => Promise<string | null>) | null> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** Headers to add to an API request: the App Check token, or nothing. Never throws. */
export async function appCheckHeaders(
  options: { platform?: string; debug?: boolean; backend?: AppCheckBackend; timeoutMs?: number } = {},
): Promise<Record<string, string>> {
  const platform = options.platform ?? Platform.OS;
  if (platform !== "android") return {};
  try {
    if (!getter) {
      const backend = options.backend ?? nativeBackend;
      const debug = options.debug ?? (typeof __DEV__ !== "undefined" && __DEV__);
      getter = backend.init(debug).catch(() => null);
    }
    const timeoutMs = options.timeoutMs ?? TOKEN_TIMEOUT_MS;
    const get = await withTimeout(getter, timeoutMs);
    if (!get) return {};
    const token = await withTimeout(get(), timeoutMs);
    return token ? { [APP_CHECK_HEADER]: token } : {};
  } catch {
    return {};
  }
}

/** Test seam: forget the initialised backend. */
export function resetAppCheckForTests(): void {
  getter = null;
}
