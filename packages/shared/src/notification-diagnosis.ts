/**
 * "Notifications not arriving?" (S13b). Pure: takes what the phone knows (permission, brand) and the person's own
 * delivery counts from `my_notification_delivery_health()`, and says what is most likely wrong.
 * Brand matters because Transsion phones (Tecno, Infinix, Itel) stop apps in the background to save battery, which
 * looks like silence on our side: the push is accepted, no one opens it. A diagnosis is a hint, never a promise.
 */
export type PermissionLevel = "granted" | "denied" | "undetermined";
export type MakerGroup = "transsion" | "other_android" | "ios" | "unknown";

export interface DeliveryHealth {
  readonly pushSent: number;
  readonly pushDelivered: number;
  readonly pushOpened: number;
  readonly pushFailed: number;
  readonly tokenDead: number;
  readonly activePushDevices: number;
}

export type DiagnosisFinding =
  | "permission_off"
  | "no_device_registered"
  | "token_dead"
  | "receipts_failing"
  | "never_opened"
  | "not_enough_data"
  | "all_good";

export interface DiagnosisInput {
  readonly os: string;
  readonly brand?: string | null;
  readonly manufacturer?: string | null;
  /** Android `Build.MODEL` and `Build.FINGERPRINT`. Some Transsion builds report a generic brand, but the fingerprint starts with the real one. */
  readonly model?: string | null;
  readonly fingerprint?: string | null;
  readonly permission: PermissionLevel;
  readonly health: DeliveryHealth | null;
}

export interface Diagnosis { readonly maker: MakerGroup; readonly findings: readonly DiagnosisFinding[] }

/** Enough pushes before "never opened" means something. Below this we say there is not enough data yet. */
export const MIN_PUSHES_FOR_VERDICT = 5;

const TRANSSION = /(tecno|infinix|itel|transsion)/i;

export function makerGroup(os: string, brand?: string | null, manufacturer?: string | null, model?: string | null, fingerprint?: string | null): MakerGroup {
  if (os === "ios") return "ios";
  if (os !== "android") return "unknown";
  // The fingerprint is "brand/product/device:...", so only its first segment is the brand.
  const fingerprintBrand = (fingerprint ?? "").split("/")[0];
  return TRANSSION.test(`${brand ?? ""} ${manufacturer ?? ""} ${model ?? ""} ${fingerprintBrand}`) ? "transsion" : "other_android";
}

export function diagnose(i: DiagnosisInput): Diagnosis {
  const maker = makerGroup(i.os, i.brand, i.manufacturer, i.model, i.fingerprint);
  const findings: DiagnosisFinding[] = [];
  if (i.permission === "denied") findings.push("permission_off");
  const h = i.health;
  if (h) {
    if (h.activePushDevices === 0 && i.permission !== "denied") findings.push("no_device_registered");
    if (h.tokenDead > 0) findings.push("token_dead");
    if (h.pushSent >= 3 && h.pushFailed >= Math.max(2, Math.ceil(h.pushSent * 0.3))) findings.push("receipts_failing");
    if (h.pushSent >= MIN_PUSHES_FOR_VERDICT && h.pushOpened === 0) findings.push("never_opened");
  }
  if (findings.length === 0) {
    findings.push(!h || h.pushSent < MIN_PUSHES_FOR_VERDICT ? "not_enough_data" : "all_good");
  }
  return { maker, findings };
}

/** Raw row from the RPC (snake case, bigint as number or string) to the shape above. */
export function healthFromRow(row: {
  push_sent: number | string; push_delivered: number | string; push_opened: number | string;
  push_failed: number | string; token_dead: number | string; active_push_devices: number | string;
} | null | undefined): DeliveryHealth | null {
  if (!row) return null;
  return {
    pushSent: Number(row.push_sent), pushDelivered: Number(row.push_delivered), pushOpened: Number(row.push_opened),
    pushFailed: Number(row.push_failed), tokenDead: Number(row.token_dead), activePushDevices: Number(row.active_push_devices),
  };
}
