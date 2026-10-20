import type { ConnectionKind } from "./data-cost-rules";

/**
 * What the phone is connected over right now (S06z). Read through NetInfo, imported lazily so a binary
 * without it (or a test) answers "unknown". "Unknown" is never treated as mobile data: the data meter
 * counts it separately and Wi-Fi only never holds anything because of it. Never throws.
 */

/** Maps NetInfo's connection type names to ours. Anything not Wi-Fi or mobile data is "other". */
export function connectionKindFromNetInfo(type: string | null | undefined, isConnected: boolean | null | undefined): ConnectionKind {
  if (isConnected === false || type === "none") return "none";
  switch (type) {
    case "wifi":
      return "wifi";
    case "cellular":
      return "cellular";
    case "unknown":
    case undefined:
    case null:
      return "unknown";
    default:
      // ethernet, bluetooth tethering, vpn, wimax and so on: not known to be metered mobile data.
      return "other";
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
