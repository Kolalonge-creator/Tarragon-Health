import { parseCuffSizingConfig, type CuffSizingConfig } from "@tarragon/clinical";
import { supabase } from "./supabase";
import type { CuffType } from "./bp-checklist";

/**
 * The cuff size step and the patient's own cuff record (S07y). The server returns nothing until the Chief Medical Officer has signed the cuff size
 * table, so before then the step does not appear at all and nothing is recorded (INV-14, INV-16). The sizes come from that signed row, never from
 * this app. A failed read shows nothing; the next open asks again.
 */
export type CuffDeviceList = "listed" | "not_listed" | "list_empty" | null;

export interface RecordedCuff {
  cuffType: CuffType;
  model: string | null;
  armCm: number | null;
  sizeKey: string | null;
  deviceList: CuffDeviceList;
}

export interface CuffGuidance {
  version: number;
  config: CuffSizingConfig;
  cuff: RecordedCuff | null;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const CUFF_TYPES: readonly string[] = ["upper_arm", "wrist", "not_sure"];
const LISTS: readonly string[] = ["listed", "not_listed", "list_empty"];

/** Pure; null for anything that is not a well-formed answer. */
export function parseCuffGuidance(raw: unknown): CuffGuidance | null {
  if (!isRecord(raw) || typeof raw["version"] !== "number") return null;
  let config: CuffSizingConfig;
  try {
    config = parseCuffSizingConfig(raw["config"]);
  } catch {
    return null;
  }
  const c = raw["cuff"];
  let cuff: RecordedCuff | null = null;
  if (isRecord(c) && typeof c["cuff_type"] === "string" && CUFF_TYPES.includes(c["cuff_type"])) {
    cuff = {
      cuffType: c["cuff_type"] as CuffType,
      model: typeof c["model"] === "string" ? c["model"] : null,
      armCm: typeof c["arm_cm"] === "number" ? c["arm_cm"] : null,
      sizeKey: typeof c["size_key"] === "string" ? c["size_key"] : null,
      deviceList: typeof c["device_list"] === "string" && LISTS.includes(c["device_list"]) ? (c["device_list"] as CuffDeviceList) : null,
    };
  }
  return { version: raw["version"], config, cuff };
}

export async function loadCuffGuidance(): Promise<CuffGuidance | null> {
  try {
    const { data, error } = await supabase.rpc("my_bp_cuff_guidance");
    if (error) return null;
    return parseCuffGuidance(data);
  } catch {
    return null;
  }
}

export type SaveCuffOutcome = { kind: "saved"; sizeKey: string | null; deviceList: CuffDeviceList } | { kind: "failed" };

export async function saveCuff(input: { cuffType: CuffType; model: string; armCm: number | null }): Promise<SaveCuffOutcome> {
  try {
    const { data, error } = await supabase.rpc("record_my_bp_cuff", {
      p_cuff_type: input.cuffType,
      p_model: input.model.trim() === "" ? undefined : input.model.trim(),
      p_arm_cm: input.armCm ?? undefined,
    });
    if (error || !isRecord(data) || data["ok"] !== true) return { kind: "failed" };
    const list = typeof data["device_list"] === "string" && LISTS.includes(data["device_list"]) ? (data["device_list"] as CuffDeviceList) : null;
    return { kind: "saved", sizeKey: typeof data["size_key"] === "string" ? data["size_key"] : null, deviceList: list };
  } catch {
    return { kind: "failed" };
  }
}
