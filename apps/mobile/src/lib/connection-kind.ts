import type { ConnectionKind } from "./data-cost-rules";

/**
 * What the phone is connected over right now (S06z). Read through NetInfo, imported lazily so a binary
 * without it (or a test) answers "unknown". "Unknown" is never treated as mobile data: the data meter
 * counts it separately and Wi-Fi only never holds anything because of it. Never throws.
 */

/**
 * Maps NetInfo's connection type names to ours. Wi-Fi, mobile data and wired ethernet are named. Anything else (a VPN, which can
 * ride on mobile data, bluetooth tethering, wimax, "other") cannot be told apart from metered data, so it is "unknown": the data
 * meter counts it toward the estimate and Wi-Fi only never holds anything because of it.
 */
export function connectionKindFromNetInfo(type: string | null | undefined, isConnected: boolean | null | undefined): ConnectionKind {
  if (isConnected === false || type === "none") return "none";
  switch (type) {
    case "wifi":
      return "wifi";
    case "cellular":
      return "cellular";
    case "ethernet":
      return "other";
    default:
      return "unknown";
  }
}

export async function getConnectionKind(): Promise<ConnectionKind> {
  try {
    const mod = await import("@react-native-community/netinfo");
    const state = await mod.default.fetch();
    return connectionKindFromNetInfo(state.type, state.isConnected);
  } catch {
    return "unknown";
  }
}
