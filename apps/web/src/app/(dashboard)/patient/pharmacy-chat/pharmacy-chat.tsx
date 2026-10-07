"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStartThread } from "@/lib/queries/care-messages";
import {
  useChatPharmacies,
  usePatientChatMessages,
  usePatientChatThreads,
  useSendPharmacistChat,
  useStartPharmacistChat,
} from "@/lib/pharmacist-chat/queries";
import { MAX_MESSAGE_LENGTH, MAX_TOPIC_LENGTH, chatErrorKind, validMessage, validTopic } from "@/lib/pharmacist-chat/model";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

function EmergencyNote() {
  return (
    <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
      {t("pharmchat.emergency")}{" "}
      <Link href="/patient/emergency-card" className="font-medium underline">
        {t("pharmchat.emergency_link")}
      </Link>
    </p>
  );
}

function errorText(error: unknown): string {
  const kind = chatErrorKind(error instanceof Error ? error.message : undefined);
  return kind === "closed" ? t("pharmchat.err.closed") : kind === "too_many" ? t("pharmchat.err.too_many") : kind === "not_available" ? t("pharmchat.err.not_available") : t("pharmchat.err.failed");
}

function ThreadView({ threadId, escalated, closed, topic }: { threadId: string; escalated: boolean; closed: boolean; topic: string }) {
  const messages = usePatientChatMessages(threadId);
  const send = useSendPharmacistChat();
  const toCareTeam = useStartThread();
  const [body, setBody] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [careBody, setCareBody] = useState<string | null>(null);
  const [sentToCare, setSentToCare] = useState(false);

  function onSend(event: FormEvent) {
    event.preventDefault();
    const text = validMessage(body);
    if (!text) return;
    send.mutate({ threadId, body: text }, { onSuccess: (r) => { setBody(""); setEmergency(r.emergency); } });
  }

  const flagged = emergency || (messages.data ?? []).some((m) => m.sender_role === "patient" && m.flagged_potential_emergency);
  const lastQuestion = [...(messages.data ?? [])].reverse().find((m) => m.sender_role === "patient")?.body ?? "";

  return (
    <div className="space-y-3">
      {flagged ? <EmergencyNote /> : null}
      {messages.isError ? <p role="alert" className="text-sm text-red-700">{t("pharmchat.err.load")}</p> : null}
      <ul className="space-y-2" aria-label={topic}>
        {(messages.data ?? []).map((m) => (
          <li key={m.message_id} className={`rounded-lg p-2 text-sm ${m.sender_role === "patient" ? "ml-6 bg-brand-green/10" : "mr-6 bg-charcoal-ink/5 dark:bg-night-ink/10"}`}>
            <p className="text-xs font-medium">{m.sender_role === "patient" ? t("pharmchat.you") : t("pharmchat.pharmacist")}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
      {escalated && !sentToCare ? (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
          <p className="text-sm text-amber-900 dark:text-amber-200">{t("pharmchat.escalated")}</p>
          {careBody === null ? (
            <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setCareBody(lastQuestion)}>
              {t("pharmchat.to_care_team")}
            </Button>
          ) : (
            <div className="space-y-2">
              <Label htmlFor={`care-${threadId}`}>{t("pharmchat.care_label")}</Label>
              <Input id={`care-${threadId}`} value={careBody} maxLength={MAX_MESSAGE_LENGTH} onChange={(e) => setCareBody(e.target.value)} />
              <p className={`text-xs ${MUTED}`}>{t("pharmchat.care_hint")}</p>
              <Button
                type="button"
                size="sm"
                className="min-h-11"
                disabled={toCareTeam.isPending || !validMessage(careBody)}
                onClick={() => toCareTeam.mutate({ subject: topic.slice(0, 80), body: careBody.trim() }, { onSuccess: () => setSentToCare(true) })}
              >
                {t("pharmchat.send_care")}
              </Button>
              {toCareTeam.isError ? <p role="alert" className="text-sm text-red-700">{t("pharmchat.err.failed")}</p> : null}
            </div>
          )}
        </div>
      ) : null}
      {sentToCare ? <p role="status" className="text-sm">{t("pharmchat.care_sent")} <Link href="/patient/messages" className="underline">{t("pharmchat.care_open")}</Link></p> : null}
      {closed ? (
        <p className={`text-sm ${MUTED}`}>{t("pharmchat.closed")}</p>
      ) : (
        <form onSubmit={onSend} className="space-y-2">
          <Label htmlFor={`msg-${threadId}`}>{t("pharmchat.message")}</Label>
          <Input id={`msg-${threadId}`} value={body} maxLength={MAX_MESSAGE_LENGTH} onChange={(e) => setBody(e.target.value)} />
          {send.isError ? <p role="alert" className="text-sm text-red-700">{errorText(send.error)}</p> : null}
          <Button type="submit" size="sm" className="min-h-11" disabled={send.isPending || !validMessage(body)}>{t("pharmchat.send")}</Button>
        </form>
      )}
    </div>
  );
}

function NewChat({ onStarted }: { onStarted: (threadId: string) => void }) {
  const pharmacies = useChatPharmacies();
  const start = useStartPharmacistChat();
  const [partnerId, setPartnerId] = useState("");
  const [topic, setTopic] = useState("");
  const [body, setBody] = useState("");
  const [emergency, setEmergency] = useState(false);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const t1 = validTopic(topic);
    const b = validMessage(body);
    if (!t1 || !b || !partnerId) return;
    start.mutate({ partnerId, topic: t1, body: b }, { onSuccess: (r) => { setEmergency(r.emergency); setBody(""); setTopic(""); if (r.thread_id) onStarted(r.thread_id); } });
  }

  if (pharmacies.isError) return <p role="alert" className="text-sm text-red-700">{t("pharmchat.err.load")}</p>;
  if (pharmacies.data && pharmacies.data.length === 0) return <p className={`text-sm ${MUTED}`}>{t("pharmchat.no_pharmacy")}</p>;
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {emergency ? <EmergencyNote /> : null}
      <div className="space-y-1.5">
        <Label htmlFor="chat-pharmacy">{t("pharmchat.which")}</Label>
        <select id="chat-pharmacy" className="min-h-11 w-full rounded-md border border-charcoal-ink/20 bg-white px-2 text-sm dark:border-night-ink/25 dark:bg-night-card" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
          <option value="">{t("pharmchat.choose")}</option>
          {(pharmacies.data ?? []).map((p) => (
            <option key={p.partner_id} value={p.partner_id}>{[p.partner_name, p.city, p.state].filter(Boolean).join(", ")}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="chat-topic">{t("pharmchat.topic")}</Label>
        <Input id="chat-topic" value={topic} maxLength={MAX_TOPIC_LENGTH} onChange={(e) => setTopic(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="chat-body">{t("pharmchat.question")}</Label>
        <Input id="chat-body" value={body} maxLength={MAX_MESSAGE_LENGTH} onChange={(e) => setBody(e.target.value)} />
        <p className={`text-xs ${MUTED}`}>{t("pharmchat.privacy")}</p>
      </div>
      {start.isError ? <p role="alert" className="text-sm text-red-700">{errorText(start.error)}</p> : null}
      <Button type="submit" className="min-h-11" disabled={start.isPending || !partnerId || !validTopic(topic) || !validMessage(body)}>{t("pharmchat.start")}</Button>
    </form>
  );
}

export function PharmacyChat({ patientId }: { patientId: string }) {
  void patientId;
  const threads = usePatientChatThreads();
  const [open, setOpen] = useState<string | null>(null);
  const current = (threads.data ?? []).find((th) => th.thread_id === open);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>{t("pharmchat.new")}</CardTitle></CardHeader>
        <CardContent><NewChat onStarted={setOpen} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("pharmchat.yours")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {threads.isError ? <p role="alert" className="text-sm text-red-700">{t("pharmchat.err.load")}</p> : null}
          {threads.data && threads.data.length === 0 ? <p className={`text-sm ${MUTED}`}>{t("pharmchat.none")}</p> : null}
          <ul className="space-y-2">
            {(threads.data ?? []).map((th) => (
              <li key={th.thread_id}>
                <button type="button" className="min-h-11 w-full rounded-md border border-charcoal-ink/15 px-3 py-2 text-left text-sm dark:border-night-ink/20" aria-expanded={open === th.thread_id} onClick={() => setOpen(open === th.thread_id ? null : th.thread_id)}>
                  <span className="font-medium">{th.topic}</span>
                  <span className={`block text-xs ${MUTED}`}>{th.partner_name}{th.unread > 0 ? ` · ${t("pharmchat.new_reply")}` : ""}{th.status === "closed" ? ` · ${t("pharmchat.closed_tag")}` : ""}</span>
                </button>
                {open === th.thread_id && current ? (
                  <div className="mt-2"><ThreadView threadId={th.thread_id} escalated={th.escalated} closed={th.status === "closed"} topic={th.topic} /></div>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
