export interface WrittenQuestionDraft {
  category: string;
  question: string;
  duration: string;
}

interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const keyFor = (patientId: string) => `tarragon.wq.draft.${patientId}`;

function defaultStore(): DraftStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Unsent drafts live only on this device. Every access is guarded: storage can be blocked or full. */
export function loadDraft(patientId: string, store: DraftStore | null = defaultStore()): WrittenQuestionDraft | null {
  try {
    const raw = store?.getItem(keyFor(patientId));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.category !== "string" || typeof o.question !== "string" || typeof o.duration !== "string") return null;
    return { category: o.category, question: o.question, duration: o.duration };
  } catch {
    return null;
  }
}

export function saveDraft(patientId: string, draft: WrittenQuestionDraft, store: DraftStore | null = defaultStore()): boolean {
  try {
    if (!store) return false;
    if (!draft.question.trim() && !draft.duration.trim()) {
      store.removeItem(keyFor(patientId));
      return false;
    }
    store.setItem(keyFor(patientId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(patientId: string, store: DraftStore | null = defaultStore()): void {
  try {
    store?.removeItem(keyFor(patientId));
  } catch {
    /* nothing to clear */
  }
}
