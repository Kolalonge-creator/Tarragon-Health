import { asksForPerson, classifyIncoming, EMERGENCY_FOLLOWUP_REPLY, fixedReplyFor, FALLBACK_HANDOFF_REPLY, REPLACED_REPLY, type RuleOutcome } from "./safety";
import { guardReply } from "./output-guard";
import type { ChatConfig } from "./config";
import { knowledgeText, type KnowledgeEntry, type LiveFacts } from "./knowledge";
import type { HistoryMessage, ReceptionistFn, SummariserFn } from "./types";

/**
 * Front Desk F1 + F2 + F3 + F11 + F14 + F17, composed. One function, `handleChatTurn`, decides what happens to every visitor message, in a fixed
 * order, with every dependency injected so the same code runs in production and in the evaluation set:
 *
 *   kill switch -> spend cap -> store the message (session cap) -> RULES (emergency, prompt extraction, medical advice, wants a person)
 *   -> approved knowledge -> MODEL -> output GUARD -> store the reply -> handoff when a person is needed.
 *
 * The rules come before the model and the guard comes after it, so the model is never the only safety control. An emergency never reaches the
 * model. A reply the guard rejects is never shown; fixed wording and a handoff replace it.
 */
export interface ChatDb {
  open(secretHash: string, page: string, intro: string): Promise<string>;
  turn(conversationId: string, secretHash: string, text: string): Promise<
    | { ok: true; status: ConversationStatus; count: number; history: HistoryMessage[] }
    | { ok: false; reason: "not_found" | "closed" | "message_cap" | "invalid_message" }
  >;
  reply(args: { conversationId: string; text: string; model: string | null; tokensIn: number | null; tokensOut: number | null; flags: string[]; interactionId: string | null; answeredBy: "model" | "rules" | "fallback" }): Promise<void>;
  handoff(args: { conversationId: string; reason: HandoffReason; urgency: "normal" | "urgent"; summary: string; suggestedReply: string | null }): Promise<void>;
  usageAdd(model: string, tokensIn: number, tokensOut: number): Promise<void>;
  spendToday(): Promise<number | null>;
}

export type ConversationStatus = "open" | "handed_off" | "emergency" | "closed";
export type HandoffReason = "visitor_asked" | "cannot_answer" | "ai_unavailable" | "clinical_request" | "emergency" | "complaint" | "form_fallback";

export interface ChatDeps {
  readonly db: ChatDb;
  readonly config: () => Promise<{ config: ChatConfig; ok: boolean }>;
  readonly knowledge: (facts: LiveFacts) => Promise<{ entries: KnowledgeEntry[]; ok: boolean }>;
  readonly facts: (launchDateIso: string | null) => LiveFacts;
  readonly receptionist: ReceptionistFn;
  readonly summariser: SummariserFn | null;
}

export interface ChatTurnInput {
  readonly conversationId: string | null;
  readonly secretHash: string;
  readonly text: string;
  readonly page: string;
}

export type ChatTurnResult =
  | { readonly mode: "form"; readonly reason: "disabled" | "spend_cap" | "config_unreadable" }
  | { readonly mode: "error"; readonly reason: "not_found" | "closed" | "invalid_message" }
  | {
      readonly mode: "chat";
      /** Null only when an emergency reply had to be given while the database was unreachable. */
      readonly conversationId: string | null;
      readonly reply: string;
      readonly status: ConversationStatus;
      /** The widget should ask for name and email or phone (with the consent tick). */
      readonly needsContact: boolean;
      readonly emergency: boolean;
    };

export function buildIntro(config: ChatConfig, launchDate: string): string {
  const stage = config.prelaunch ? ` TarragonHealth opens to the public on ${launchDate}.` : "";
  return `Hello, I am TarragonHealth's AI assistant, not a person and not a doctor.${stage} I can answer questions about our service. I cannot give medical advice, and if this is an emergency please go to the nearest hospital. You can ask for a person at any time. How can I help?`;
}

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** A plain summary used when no model-written one is available (always for an emergency, where speed matters more than polish). */
export function plainSummary(history: readonly HistoryMessage[], reason: HandoffReason, outcome?: RuleOutcome): string {
  const visitor = history.filter((m) => m.role === "visitor").map((m) => m.content);
  const first = visitor[0];
  const last = visitor[visitor.length - 1];
  const parts = [`Why: ${reason.replace(/_/g, " ")}.`];
  if (outcome?.kind === "emergency") parts.push(`Emergency wording matched: ${outcome.matched.join(", ")}.`);
  if (first) parts.push(`First message: "${clip(first, 240)}"`);
  if (last && last !== first) parts.push(`Latest message: "${clip(last, 240)}"`);
  parts.push(`${visitor.length} visitor message${visitor.length === 1 ? "" : "s"} so far.`);
  return clip(parts.join(" "), 1900);
}

async function recordHandoff(deps: ChatDeps, cfg: ChatConfig, conversationId: string, history: readonly HistoryMessage[], reason: HandoffReason, outcome?: RuleOutcome) {
  const urgent = reason === "emergency";
  let summary = plainSummary(history, reason, outcome);
  let suggested: string | null = null;
  // A model-written summary and suggested reply for everything except an emergency (which must not wait on a model) and an AI outage (the model is
  // known to be unavailable). Failure falls back to the plain one.
  if (!urgent && reason !== "ai_unavailable" && deps.summariser) {
    try {
      const s = await deps.summariser({ history, reason, modelId: cfg.modelStrong });
      if (s) {
        summary = clip(s.summary, 1900);
        suggested = clip(s.suggestedReply, 3900);
        await deps.db.usageAdd(s.model, s.tokensIn, s.tokensOut);
      }
    } catch {
      /* keep the plain summary */
    }
  }
  await deps.db.handoff({ conversationId, reason, urgency: urgent ? "urgent" : "normal", summary, suggestedReply: suggested });
}

/**
 * An emergency is answered FIRST and unconditionally. It does not wait for, and is not blocked by, the kill switch, the spend cap, the session
 * cap, the model or the database: the fixed reply is returned whatever else fails, and storing the message, opening the urgent handoff and
 * alerting are each attempted separately and logged if they fail. The only thing worse than a late alert is no answer to the visitor.
 */
async function handleEmergency(deps: ChatDeps, input: ChatTurnInput, rule: Extract<RuleOutcome, { kind: "emergency" }>): Promise<ChatTurnResult> {
  const reply = fixedReplyFor(rule) as string;
  const attempt = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.error(`front desk: emergency path could not ${label}`, e);
      return null;
    }
  };
  let cfg: ChatConfig | null = null;
  const loaded = await attempt("read the configuration", () => deps.config());
  if (loaded) cfg = loaded.config;
  const launch = cfg ? deps.facts(cfg.launchDate).launchDate : "soon";
  let conversationId = input.conversationId;
  if (conversationId === null) conversationId = await attempt("open the conversation", () => deps.db.open(input.secretHash, input.page, cfg ? buildIntro(cfg, launch) : "I am TarragonHealth's AI assistant."));
  let history: HistoryMessage[] = [{ role: "visitor", content: input.text }];
  if (conversationId !== null) {
    const turn = await attempt("store the message", () => deps.db.turn(conversationId as string, input.secretHash, input.text));
    if (turn && turn.ok) history = turn.history;
    await attempt("store the reply", () => deps.db.reply({ conversationId: conversationId as string, text: reply, model: null, tokensIn: null, tokensOut: null, flags: ["emergency"], interactionId: null, answeredBy: "rules" }));
    await attempt("open the urgent handoff", () =>
      deps.db.handoff({ conversationId: conversationId as string, reason: "emergency", urgency: "urgent", summary: plainSummary(history, "emergency", rule), suggestedReply: null }),
    );
  }
  return { mode: "chat", conversationId, reply, status: "emergency", needsContact: true, emergency: true };
}

export async function handleChatTurn(deps: ChatDeps, input: ChatTurnInput): Promise<ChatTurnResult> {
  const early = classifyIncoming(input.text);
  if (early.kind === "emergency") return handleEmergency(deps, input, early);

  const { config: cfg, ok: configOk } = await deps.config();
  // The kill switch, and an unreadable configuration, both mean the contact form (the safe state).
  if (!configOk) return { mode: "form", reason: "config_unreadable" };
  if (!cfg.assistantEnabled) return { mode: "form", reason: "disabled" };

  const spent = await deps.db.spendToday();
  if (spent === null || spent >= cfg.dailySpendCapUsd) return { mode: "form", reason: "spend_cap" };

  const facts = deps.facts(cfg.launchDate);
  const conversationId = input.conversationId ?? (await deps.db.open(input.secretHash, input.page, buildIntro(cfg, facts.launchDate)));

  const turn = await deps.db.turn(conversationId, input.secretHash, input.text);
  if (!turn.ok) {
    if (turn.reason === "message_cap") {
      // The session limit is not an error to the visitor: they are handed to a person.
      const history: HistoryMessage[] = [{ role: "visitor", content: input.text }];
      const reply = "We have talked for a while, so I have passed this to our team. Please leave your name and an email address or phone number and a person will reply.";
      await deps.db.reply({ conversationId, text: reply, model: null, tokensIn: null, tokensOut: null, flags: [], interactionId: null, answeredBy: "rules" });
      await recordHandoff(deps, cfg, conversationId, history, "cannot_answer");
      return { mode: "chat", conversationId, reply, status: "handed_off", needsContact: true, emergency: false };
    }
    return { mode: "error", reason: turn.reason };
  }
  const history = turn.history;

  // ---- RULES (no model) ---------------------------------------------------------------------------------------------------------------
  const rule = early;
  const fixed = fixedReplyFor(rule);
  if (fixed !== null) {
    const flags = rule.kind === "medical_advice" ? ["clinical_request"] : rule.kind === "prompt_extraction" ? ["out_of_scope"] : [];
    await deps.db.reply({ conversationId, text: fixed, model: null, tokensIn: null, tokensOut: null, flags, interactionId: null, answeredBy: "rules" });
    if (rule.kind === "wants_human") {
      await recordHandoff(deps, cfg, conversationId, history, "visitor_asked");
      return { mode: "chat", conversationId, reply: fixed, status: "handed_off", needsContact: true, emergency: false };
    }
    return { mode: "chat", conversationId, reply: fixed, status: turn.status, needsContact: false, emergency: false };
  }

  // A conversation already marked as an emergency never reaches the model again: only the fixed wording answers it.
  if (turn.status === "emergency") {
    await deps.db.reply({ conversationId, text: EMERGENCY_FOLLOWUP_REPLY, model: null, tokensIn: null, tokensOut: null, flags: [], interactionId: null, answeredBy: "rules" });
    return { mode: "chat", conversationId, reply: EMERGENCY_FOLLOWUP_REPLY, status: "emergency", needsContact: true, emergency: true };
  }

  // A complaint is also a person's job, whatever the model would have said.
  const complaint = asksForPerson(input.text);

  // ---- KNOWLEDGE + MODEL ---------------------------------------------------------------------------------------------------------------
  const kb = await deps.knowledge(facts);
  if (!kb.ok || kb.entries.length === 0) {
    // Nothing approved to say: never guess. A person answers.
    await deps.db.reply({ conversationId, text: FALLBACK_HANDOFF_REPLY, model: null, tokensIn: null, tokensOut: null, flags: [], interactionId: null, answeredBy: "fallback" });
    await recordHandoff(deps, cfg, conversationId, history, "cannot_answer");
    return { mode: "chat", conversationId, reply: FALLBACK_HANDOFF_REPLY, status: "handed_off", needsContact: true, emergency: false };
  }
  const knowledge = knowledgeText(kb.entries);
  const answer = await deps.receptionist({ history, knowledge, prelaunch: cfg.prelaunch, launchDate: facts.launchDate, modelId: cfg.modelFast });
  if (answer.source === "model") await deps.db.usageAdd(answer.model, answer.tokensIn, answer.tokensOut);

  // ---- OUTPUT GUARD --------------------------------------------------------------------------------------------------------------------
  let reply = answer.reply;
  let flags: string[] = [];
  let guardedOut = false;
  if (answer.source === "model") {
    const guard = guardReply(answer.reply, { knowledge });
    if (!guard.ok) {
      reply = REPLACED_REPLY;
      flags = ["reply_replaced", ...guard.violations.map((v) => `guard:${v}`)];
      guardedOut = true;
    }
  }
  await deps.db.reply({
    conversationId,
    text: reply,
    model: answer.source === "model" ? answer.model : null,
    tokensIn: answer.tokensIn,
    tokensOut: answer.tokensOut,
    flags,
    interactionId: answer.aiInteractionId,
    answeredBy: answer.source === "model" && !guardedOut ? "model" : "fallback",
  });

  // ---- HANDOFF WHEN A PERSON IS NEEDED -------------------------------------------------------------------------------------------------
  let handoff: HandoffReason | null = null;
  if (answer.source === "fallback") handoff = "ai_unavailable";
  else if (guardedOut) handoff = "cannot_answer";
  else if (complaint || answer.intent === "complaint") handoff = "complaint";
  else if (answer.intent === "needs_human") handoff = "cannot_answer";
  if (handoff) await recordHandoff(deps, cfg, conversationId, history, handoff);

  const status: ConversationStatus = handoff ? "handed_off" : turn.status;
  return { mode: "chat", conversationId, reply, status, needsContact: handoff !== null || answer.askContact || answer.intent === "wants_contact", emergency: false };
}
