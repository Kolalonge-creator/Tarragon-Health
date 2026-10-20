import { t } from "./translate";

/**
 * The words for one phone on the "My phones" list (web and phone). Takes the state already worked out by `phoneState` in
 * `@tarragon/shared` and the few row fields it needs, so this package stays free of that dependency. Never names a health value.
 */
export type PhoneCopyState = "active" | "lease_ending" | "lease_lapsed" | "lost_reported" | "cleared" | "quiet";

export interface PhoneCopyInput {
  state: PhoneCopyState;
  platform: string;
  lastCheckinAt: string;
  leaseExpiresAt: string;
  wipeConfirmedAt: string | null;
  unsentAtWipe: number | null;
  dangerAtWipe: number | null;
}

export interface PhoneCopy {
  name: string;
  lastSeen: string;
  stateLine: string;
  /** Extra sentences after a phone was cleared (what had not reached us); empty otherwise. */
  clearedLines: string[];
}

const lagos = (value: string, withTime: boolean): string => {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
};

const count = (n: number | null): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function describePhone(input: PhoneCopyInput): PhoneCopy {
  const name = input.platform === "ios" ? t("phones.kind.ios") : input.platform === "android" ? t("phones.kind.android") : t("phones.kind.other");
  const lastSeen = t("phones.last_seen", "en", { when: lagos(input.lastCheckinAt, true) });
  const stateLine = (() => {
    switch (input.state) {
      case "active":
        return t("phones.state.active");
      case "lease_ending":
        return t("phones.state.lease_ending", "en", { date: lagos(input.leaseExpiresAt, false) });
      case "lease_lapsed":
        return t("phones.state.lease_lapsed");
      case "lost_reported":
        return t("phones.state.lost_reported");
      case "cleared":
        return t("phones.state.cleared", "en", { when: lagos(input.wipeConfirmedAt ?? input.lastCheckinAt, true) });
      case "quiet":
        return t("phones.state.quiet");
    }
  })();

  const clearedLines: string[] = [];
  if (input.state === "cleared") {
    const unsent = count(input.unsentAtWipe);
    const urgent = Math.min(count(input.dangerAtWipe), unsent);
    if (unsent === 0) clearedLines.push(t("phones.cleared.none"));
    else {
      clearedLines.push(t("phones.cleared.unsent", "en", { unsent: String(unsent) }));
      if (urgent > 0) clearedLines.push(t("phones.cleared.urgent", "en", { urgent: String(urgent) }));
    }
  }
  return { name, lastSeen, stateLine, clearedLines };
}
