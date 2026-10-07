"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  usePharmacistChatClose,
  usePharmacistChatEscalate,
  usePharmacistChatMessages,
  usePharmacistChatReply,
  usePharmacistChatThreads,
} from "@/lib/pharmacist-chat/queries";
import { MAX_MESSAGE_LENGTH, validMessage } from "@/lib/pharmacist-chat/model";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

function Thread({ threadId, closed, escalated }: { threadId: string; closed: boolean; escalated: boolean }) {
  const messages = usePharmacistChatMessages(threadId);
  const reply = usePharmacistChatReply();
  const escalate = usePharmacistChatEscalate();
  const close = usePharmacistChatClose();
  const [body, setBody] = useState("");
  const first = messages.data?.[0];

  function onReply(event: FormEvent) {
    event.preventDefault();
    const text = validMessage(body);
    if (text) reply.mutate({ threadId, body: text }, { onSuccess: () => setBody("") });
  }

  return (
    <div className="mt-2 space-y-3">
      {messages.isError ? <p role="alert" className="text-sm text-red-700">These messages could not be loaded. They are not empty.</p> : null}
      {(messages.data ?? []).some((m) => m.sender_role === "patient" && m.possible_emergency) ? (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          This conversation contains words that may mean an emergency. Tell the patient to use the emergency steps in the app or go to the nearest hospital now. Do not leave it for a routine reply.
        </p>
      ) : null}
      {first?.medicine ? (
        <p className={`text-sm ${MUTED}`}>About: {first.medicine}{first.dose ? `, ${first.dose}` : ""}. You see only this medicine, the first name and the messages.</p>
      ) : (
        <p className={`text-sm ${MUTED}`}>You see only the first name and the messages. For anything beyond a medicine question, suggest the patient asks their care team.</p>
      )}
      <ul className="space-y-2">
        {(messages.data ?? []).map((m) => (
          <li key={m.message_id} className={`rounded-lg p-2 text-sm ${m.sender_role === "pharmacist" ? "ml-6 bg-brand-green/10" : "mr-6 bg-charcoal-ink/5"}`}>
            <p className="text-xs font-medium">{m.sender_role === "pharmacist" ? "You" : (m.patient_first_name ?? "Patient")}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
      {closed ? (
        <p className={`text-sm ${MUTED}`}>This conversation is closed.</p>
      ) : (
        <>
          <form onSubmit={onReply} className="space-y-2">
            <Label htmlFor={`reply-${threadId}`}>Your reply</Label>
            <Input id={`reply-${threadId}`} value={body} maxLength={MAX_MESSAGE_LENGTH} onChange={(e) => setBody(e.target.value)} />
            {reply.isError ? <p role="alert" className="text-sm text-red-700">The reply was not sent. Please try again.</p> : null}
            <Button type="submit" size="sm" className="min-h-11" disabled={reply.isPending || !validMessage(body)}>Send reply</Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={escalate.isPending || escalated} onClick={() => escalate.mutate({ threadId })}>
              {escalated ? "Suggested: ask the care team" : "Suggest the patient asks their care team"}
            </Button>
            <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={close.isPending} onClick={() => close.mutate({ threadId })}>Close conversation</Button>
          </div>
        </>
      )}
    </div>
  );
}

export function PharmacistMessages() {
  const threads = usePharmacistChatThreads();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Patient questions</CardTitle>
        <p className={`text-sm ${MUTED}`}>Medicine questions sent to your pharmacy. Opening a conversation is recorded. Answer what a pharmacist can answer; for anything else, suggest the patient asks their care team.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {threads.isError ? <p role="alert" className="text-sm text-red-700">Conversations could not be loaded. This is not an empty list.</p> : null}
        {threads.data && threads.data.length === 0 ? <p className={`text-sm ${MUTED}`}>No questions yet.</p> : null}
        <ul className="space-y-2">
          {(threads.data ?? []).map((th) => (
            <li key={th.thread_id}>
              <button type="button" className="min-h-11 w-full rounded-md border border-charcoal-ink/15 px-3 py-2 text-left text-sm" aria-expanded={open === th.thread_id} onClick={() => setOpen(open === th.thread_id ? null : th.thread_id)}>
                <span className="font-medium">{th.patient_first_name ?? "Patient"}: {th.topic}</span>
                <span className={`block text-xs ${MUTED}`}>{th.possible_emergency ? "Possible emergency. " : ""}{th.waiting && th.status === "open" ? "Waiting for your reply" : th.status === "closed" ? "Closed" : "Replied"}</span>
              </button>
              {open === th.thread_id ? <Thread threadId={th.thread_id} closed={th.status === "closed"} escalated={th.escalated} /> : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
