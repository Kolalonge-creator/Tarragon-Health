import type { Connection } from "./media-policy";
import { recordSyncError } from "./sync-diagnostics";

/**
 * The kind of connection the phone is on right now (S06y), for the S34 media and bulk-upload rules. NetInfo is imported
 * lazily so a binary without it still runs; "unknown" then counts as not Wi-Fi (media-policy.ts), and the missing module is
 * recorded so a phone stuck on "unknown" is explainable. Never throws.
 */
export async function readConnectionType(): Promise<Connection> {
  try {
    const mod = await import("@react-native-community/netinfo");
    const state = await mod.default.fetch();
    if (state.type === "wifi") return "wifi";
    if (state.type === "cellular") return "cellular";
    return "unknown";
  } catch (error) {
    recordSyncError("offline_outbox", "netinfo:connectionType", error);
    return "unknown";
  }
}
