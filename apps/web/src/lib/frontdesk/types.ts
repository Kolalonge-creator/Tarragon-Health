export interface HistoryMessage {
  readonly role: "visitor" | "assistant" | "founder";
  readonly content: string;
}

export interface ReceptionistInput {
  readonly history: readonly HistoryMessage[];
  /** Resolved approved knowledge (live prices filled in). */
  readonly knowledge: string;
  readonly prelaunch: boolean;
  /** Human readable, for example "31 December 2026". */
  readonly launchDate: string;
  readonly modelId: string;
}

export type ReceptionistIntent = "answer" | "needs_human" | "complaint" | "out_of_scope" | "wants_contact";

export interface ReceptionistAnswer {
  readonly reply: string;
  readonly intent: ReceptionistIntent;
  readonly askContact: boolean;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly model: string;
  /** "fallback" means the AI path did not run (switched off, ungoverned or failed) and the reply is the fixed capture-and-handoff wording. */
  readonly source: "model" | "fallback";
  readonly aiInteractionId: string | null;
  readonly fallbackReason: string | null;
}

export type ReceptionistFn = (input: ReceptionistInput) => Promise<ReceptionistAnswer>;

export interface SummaryResult {
  readonly summary: string;
  readonly suggestedReply: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly model: string;
}

export type SummariserFn = (input: { history: readonly HistoryMessage[]; reason: string; modelId: string }) => Promise<SummaryResult | null>;
