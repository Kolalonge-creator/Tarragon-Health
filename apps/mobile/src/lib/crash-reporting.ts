/**
 * S88a: wires the JS crash reporter (crash-report.ts) into React Native. JS only, so it ships by OTA without a native
 * build. Dormant unless EXPO_PUBLIC_SENTRY_DSN is set at bundle time. See docs/design/S88a.md.
 *
 * Installs three hooks: ErrorUtils global handler (the previous handler is always called afterwards, so the red box in
 * development and the OS crash behaviour in production are unchanged), unhandled promise rejections, and an exported
 * `reportBoundaryError` for the React error boundary. Every step is wrapped: installing or reporting can never throw.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import * as SecureStore from "expo-secure-store";
import { randomUUID } from "expo-crypto";
import { createCrashReporter, type CaptureSource, type CrashReporter } from "./crash-report";

const INSTALL_ID_KEY = "crash_install_id_v1";
let reporter: CrashReporter | null = null;
let installed = false;

async function readInstallId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY);
    if (existing) return existing;
    const fresh = randomUUID();
    await SecureStore.setItemAsync(INSTALL_ID_KEY, fresh);
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
      HermesInternal?: { enablePromiseRejectionTracker?: (opts: { allRejections: boolean; onUnhandled: (id: number, error: unknown) => void }) => void };
    };
    const previous = g.ErrorUtils?.getGlobalHandler();
    g.ErrorUtils?.setGlobalHandler((error, fatal) => {
      try {
        reporter?.capture(describeUnknown(error), "global_handler", fatal === true);
      } catch {
        // never
      }
      previous?.(error, fatal);
    });

    const onUnhandled = (_id: number, error: unknown) => {
      reporter?.capture(describeUnknown(error), "promise_rejection" satisfies CaptureSource, false);
    };
    try {
      if (typeof g.HermesInternal?.enablePromiseRejectionTracker === "function") {
        g.HermesInternal.enablePromiseRejectionTracker({ allRejections: true, onUnhandled });
      }
    } catch {
      // Hermes only (this app's engine); a static require of the JS rejection-tracking package would not resolve under pnpm and could break the bundle. The tracker is optional: the global handler above still covers thrown errors.
    }
  } catch {
    // Installing must never break app start.
  }
}
