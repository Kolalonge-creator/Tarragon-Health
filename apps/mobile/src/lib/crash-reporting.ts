/**
 * S88a: wires the JS crash reporter (crash-report.ts) into React Native. JS only, so it ships by OTA without a native
 * build. Dormant unless EXPO_PUBLIC_SENTRY_DSN is set at bundle time. See docs/design/S88a.md.
 *
 * Installs three hooks: ErrorUtils global handler (the previous handler is always called afterwards, once, so the red box
 * in development and the OS crash behaviour in production are unchanged; for a fatal it is held back at most
 * FATAL_GRACE_MS so the report can leave the device), unhandled promise rejections (a rejection that is handled later is
 * not reported), and an exported `reportBoundaryError` for the React error boundary. Every step is wrapped: installing or
 * reporting can never throw.
 *
 * Import order: this module is loaded by `crash-install.ts`, which `index.js` imports before anything else. Keep this
 * module's imports to platform and expo packages (a test enforces it), never anything from the app's own graph.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { createCrashReporter, createRejectionTracker, handleGlobalError, type CrashReporter } from "./crash-report";

// App storage, not the keychain: on iOS the keychain survives an uninstall, which would make this id a persistent
// per-device identifier. AsyncStorage is wiped with the app, so the id is "random per install" as documented.
const INSTALL_ID_KEY = "crash_install_id_v1";
let reporter: CrashReporter | null = null;
let installed = false;

async function readInstallId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (existing) return existing;
    const fresh = randomUUID();
    await AsyncStorage.setItem(INSTALL_ID_KEY, fresh);
    return fresh;
  } catch {
    return "unknown";
  }
}

function osMajor(): string {
  const v = String(Platform.Version ?? "");
  return v.split(".")[0] ?? "";
}

function deviceBrand(): string {
  const constants = (Platform as unknown as { constants?: { Brand?: unknown } }).constants;
  return Platform.OS === "android" && typeof constants?.Brand === "string" ? constants.Brand : Platform.OS === "ios" ? "Apple" : "";
}

function describeUnknown(value: unknown): unknown {
  return value instanceof Error ? value : new Error(typeof value === "string" ? value : "non-Error thrown");
}

export function reportBoundaryError(error: unknown): void {
  try {
    reporter?.capture(describeUnknown(error), "error_boundary", false);
  } catch {
    // never
  }
}

export function installCrashReporting(): void {
  try {
    if (installed) return;
    const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
    if (!dsn) return;
    installed = true;
    // The install id read is async; until it resolves a very early crash reports "unknown", which is fine.
    const context = {
      appVersion: Constants.expoConfig?.version ?? "",
      runtimeVersion: Updates.runtimeVersion ?? String(Constants.expoConfig?.runtimeVersion ?? ""),
      platform: Platform.OS,
      osVersion: osMajor(),
      deviceBrand: deviceBrand(),
      installId: "unknown",
      environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
    };
    reporter = createCrashReporter({ dsn, context });
    if (!reporter.enabled) return;
    void readInstallId().then((id) => {
      context.installId = id;
    });

    const g = globalThis as unknown as {
      ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void };
      HermesInternal?: { enablePromiseRejectionTracker?: (opts: unknown) => void };
    };
    const previous = g.ErrorUtils?.getGlobalHandler();
    g.ErrorUtils?.setGlobalHandler((error, fatal) => {
      handleGlobalError(reporter, error, fatal, previous, describeUnknown);
    });

    try {
      if (typeof g.HermesInternal?.enablePromiseRejectionTracker === "function") {
        // React Native installs its own tracker in development only (LogBox warnings). Hermes keeps one tracker, so ours
        // replaces it: chain the RN options so development behaviour is unchanged.
        let rnOptions: { onUnhandled?: (id: number, e: unknown) => void; onHandled?: (id: number) => void } | null = null;
        if (__DEV__) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            rnOptions = (require("react-native/Libraries/promiseRejectionTrackingOptions") as { default: typeof rnOptions }).default;
          } catch {
            rnOptions = null;
          }
        }
        g.HermesInternal.enablePromiseRejectionTracker(
          createRejectionTracker({
            previous: rnOptions,
            capture: (error) => reporter?.capture(describeUnknown(error), "promise_rejection", false),
          }),
        );
      }
    } catch {
      // Hermes only (this app's engine); the tracker is optional: the global handler above still covers thrown errors.
    }
  } catch {
    // Installing must never break app start.
  }
}
