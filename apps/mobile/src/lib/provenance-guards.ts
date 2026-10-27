import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

/**
 * The three go-live guards behind the reading labels and the paper diary (S07y, INV-14), all born OFF on the server. The phone only offers a box or a screen
 * while the matching guard is open for the signed-in person; the database refuses a labelled reading anyway, so this is about not offering what will be refused.
 *
 * The last answer is remembered per account so an offline phone keeps behaving the way it last knew; a phone that has never learned an answer offers nothing
 * (fail closed). A remembered "open" never lets anything through on its own: the server decides every save.
 *
 *  - pharmacy_bp_readings   "taken at a pharmacy or clinic machine" on a blood pressure reading
 *  - paper_diary_entry      readings copied from a paper diary, typed by the person
 *  - paper_diary_ai_reader  a photo of a diary page read into suggestions (AI-021)
 */
export const PROVENANCE_GUARD_KEYS = ["pharmacy_bp_readings", "paper_diary_entry", "paper_diary_ai_reader"] as const;
export type ProvenanceGuardKey = (typeof PROVENANCE_GUARD_KEYS)[number];

export interface ProvenanceGuards {
  pharmacyOpen: boolean;
  diaryEntryOpen: boolean;
  diaryReaderOpen: boolean;
}

export const NO_PROVENANCE_GUARDS: ProvenanceGuards = { pharmacyOpen: false, diaryEntryOpen: false, diaryReaderOpen: false };

const memoryKey = (patientId: string, key: ProvenanceGuardKey) => `@tarragon/provenance-guard/v1:${patientId}:${key}`;

async function readOne(patientId: string, key: ProvenanceGuardKey): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: key });
    if (!error && typeof data === "boolean") {
      await AsyncStorage.setItem(memoryKey(patientId, key), String(data)).catch(() => undefined);
      return data;
    }
  } catch {
    // fall through to the remembered answer
  }
  try {
    return (await AsyncStorage.getItem(memoryKey(patientId, key))) === "true";
  } catch {
    return false;
  }
}

export async function loadProvenanceGuards(patientId: string): Promise<ProvenanceGuards> {
  const [pharmacyOpen, diaryEntryOpen, diaryReaderOpen] = await Promise.all(PROVENANCE_GUARD_KEYS.map((k) => readOne(patientId, k)));
  return { pharmacyOpen: pharmacyOpen === true, diaryEntryOpen: diaryEntryOpen === true, diaryReaderOpen: diaryReaderOpen === true };
}
