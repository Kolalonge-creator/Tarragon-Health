"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AiLabel } from "@/components/ai/ai-label";
import { Button } from "@/components/ui/button";
import { ENQUIRY_CONSENT_WORDING } from "@/lib/frontdesk/lead-consent";

/**
 * The website chat widget (Front Desk F1/F2). Everything a visitor needs is on screen at all times: it says it is an AI assistant, it says what
 * to do in an emergency, it offers a person, and every assistant message carries the shared AI label. When the assistant is switched off, over
 * its daily limit, or failing, the widget becomes a contact form instead of an error. The conversation secret lives only in this tab's
 * sessionStorage and is sent with each message; the server stores only its hash.
 */
type Role = "visitor" | "assistant";
interface Bubble {
  readonly role: Role;
  readonly text: string;
}
type Mode = "loading" | "chat" | "form" | "done";

const STORAGE_KEY = "th-fd-chat";
const EMERGENCY_NOTE = "If this is an emergency, go to the nearest hospital now. I cannot help in an emergency.";

interface Saved {
  readonly id: string;
  readonly secret: string;
}

function readSaved(): Saved | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Saved>;
    return typeof v.id === "string" && typeof v.secret === "string" ? { id: v.id, secret: v.secret } : null;
  } catch {
    return null;
  }
}
function writeSaved(v: Saved | null): void {
  try {
    if (v) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: the chat still works for this page load */
  }
}

async function post<T>(path: string, body: unknown): Promise<{ status: number; json: T | null }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as T | null };
}

interface ChatReply {
  mode?: "chat" | "form";
  conversationId?: string | null;
  secret?: string;
  reply?: string;
  needsContact?: boolean;
  emergency?: boolean;
  status?: string;
}

export function FrontDeskChat() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("loading");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [emergency, setEmergency] = useState(false);
  const [askContact, setAskContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactDetails, setContactDetails] = useState("");
  const [consent, setConsent] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const saved = useRef<Saved | null>(null);
  const started = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);

  // Start on first open: ask the server whether the assistant is on, and show the opening disclosure it wrote.
  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    saved.current = readSaved();
    fetch("/api/frontdesk/chat/config")
      .then((r) => r.json() as Promise<{ enabled: boolean; intro: string }>)
      .then((c) => {
        if (c.enabled) {
          setBubbles([{ role: "assistant", text: c.intro }]);
          setMode("chat");
        } else {
          setMode("form");
        }
      })
      .catch(() => setMode("form"));
  }, [open]);

  useEffect(() => {
    // scrollTop works in every browser (and in the test environment); Element.scrollTo is newer.
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [bubbles, askContact, mode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        launcherRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = useCallback(async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setNotice(null);
    setBubbles((b) => [...b, { role: "visitor", text: message }]);
    setText("");
    try {
      const { status, json } = await post<ChatReply>("/api/frontdesk/chat", {
        message,
        page: window.location.pathname,
        ...(saved.current ? { conversationId: saved.current.id, secret: saved.current.secret } : {}),
      });
      if (status === 429 && !json?.reply) {
        setNotice("You are sending messages quickly. Please wait a moment and try again.");
      } else if (json?.mode === "form") {
        setMode("form");
        setFormMessage(message);
      } else if (json?.reply) {
        if (json.conversationId && json.secret) {
          saved.current = { id: json.conversationId, secret: json.secret };
          writeSaved(saved.current);
        }
        setBubbles((b) => [...b, { role: "assistant", text: json.reply as string }]);
        if (json.emergency) setEmergency(true);
        if (json.needsContact) setAskContact(true);
      } else if (status === 404 || status === 409) {
        // The conversation is gone or closed: start a fresh one next time.
        saved.current = null;
        writeSaved(null);
        setNotice("That chat has ended. Please send your message again to start a new one.");
      } else {
        setNotice("Something went wrong. Please try again, or use the contact page.");
      }
    } catch {
      setNotice("Something went wrong. Please check your connection and try again.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [text, sending]);

  const submitContact = useCallback(async () => {
    if (sending) return;
    setSending(true);
    setNotice(null);
    try {
      const { status, json } = await post<ChatReply & { captured?: boolean }>("/api/frontdesk/chat/contact", {
        name: contactName,
        contact: contactDetails,
        consent: consent === true,
        ...(mode === "form" ? { message: formMessage } : {}),
        ...(saved.current && mode !== "form" ? { conversationId: saved.current.id, secret: saved.current.secret } : {}),
      });
      if (json?.emergency && json.reply) {
        setBubbles((b) => [...b, { role: "assistant", text: json.reply as string }]);
        setEmergency(true);
        setMode("chat");
      } else if (json?.captured) {
        setMode("done");
        setAskContact(false);
      } else if (status === 429) {
        setNotice("Too many attempts. Please try again later.");
      } else {
        setNotice("We could not save your details. Check them and try again.");
      }
    } catch {
      setNotice("Something went wrong. Please check your connection and try again.");
    } finally {
      setSending(false);
    }
  }, [sending, contactName, contactDetails, consent, mode, formMessage]);

  const contactForm = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submitContact();
      }}
      className="space-y-3 border-t border-charcoal-ink/10 p-4"
      aria-label="Leave your details"
    >
      <p className="text-sm text-charcoal-ink/80">{mode === "form" ? "Leave your message and a member of our team will reply." : "Leave your details and a member of our team will reply."}</p>
      {mode === "form" && (
        <label className="block text-sm font-medium text-charcoal-ink">
          Your message
          <textarea
            value={formMessage}
            onChange={(e) => setFormMessage(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Please do not include health details."
            className="mt-1 w-full rounded-lg border border-charcoal-ink/20 p-2 text-sm"
          />
        </label>
      )}
      <label className="block text-sm font-medium text-charcoal-ink">
        Name
        <input value={contactName} onChange={(e) => setContactName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" className="mt-1 w-full rounded-lg border border-charcoal-ink/20 p-2 text-sm" />
      </label>
      <label className="block text-sm font-medium text-charcoal-ink">
        Email or phone
        <input value={contactDetails} onChange={(e) => setContactDetails(e.target.value)} required maxLength={200} autoComplete="email" placeholder="you@example.com or 0803 123 4567" className="mt-1 w-full rounded-lg border border-charcoal-ink/20 p-2 text-sm" />
      </label>
      <label className="flex items-start gap-2 text-xs leading-relaxed text-charcoal-ink/80">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {ENQUIRY_CONSENT_WORDING}{" "}
          <a href="/privacy" className="font-medium text-brand-green underline underline-offset-2">Privacy Notice</a>
        </span>
      </label>
      <Button type="submit" disabled={sending || !consent || contactName.trim().length < 2 || contactDetails.trim().length < 5} className="w-full">
        {sending ? "Sending..." : "Send my details"}
      </Button>
    </form>
  );

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="th-fd-chat-panel"
        className="fixed bottom-20 right-4 z-40 flex min-h-12 items-center gap-2 rounded-full bg-brand-green px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-green/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 sm:bottom-6"
      >
        {open ? "Close chat" : "Ask us a question"}
      </button>

      {open && (
        <section
          id="th-fd-chat-panel"
          role="dialog"
          aria-label="Chat with the TarragonHealth assistant"
          className="fixed inset-x-3 bottom-36 z-40 flex max-h-[min(34rem,70vh)] flex-col overflow-hidden rounded-2xl border border-charcoal-ink/15 bg-white shadow-2xl sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-96"
        >
          <header className="border-b border-charcoal-ink/10 bg-brand-green/5 px-4 py-3">
            <p className="font-heading text-base font-semibold text-charcoal-ink">TarragonHealth assistant</p>
            <p className="text-xs text-charcoal-ink/70">An AI assistant, not a person and not a doctor. Ask for a person at any time.</p>
          </header>

          {emergency && (
            <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800">
              {EMERGENCY_NOTE}
            </p>
          )}

          {mode === "loading" && <p className="p-4 text-sm text-charcoal-ink/70">One moment...</p>}

          {mode !== "loading" && mode !== "form" && (
            <div ref={listRef} role="log" aria-live="polite" aria-label="Conversation" className="flex-1 space-y-3 overflow-y-auto p-4">
              {bubbles.map((b, i) => (
                <div key={i} className={b.role === "visitor" ? "ml-8 rounded-xl bg-brand-green/10 p-3 text-sm text-charcoal-ink" : "mr-8 space-y-1 rounded-xl bg-charcoal-ink/5 p-3 text-sm text-charcoal-ink"}>
                  {b.role === "assistant" && <AiLabel variant="coach" />}
                  <p className="whitespace-pre-wrap">{b.text}</p>
                </div>
              ))}
              {mode === "done" && <p role="status" className="rounded-xl bg-brand-green/10 p-3 text-sm text-charcoal-ink">Thank you. Our team has your details and will reply personally.</p>}
            </div>
          )}

          {mode === "form" && <div className="flex-1 overflow-y-auto">{contactForm}</div>}

          {notice && <p role="status" className="px-4 pb-2 text-sm text-red-700">{notice}</p>}

          {mode === "chat" && askContact && contactForm}

          {mode === "chat" && !askContact && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="flex items-end gap-2 border-t border-charcoal-ink/10 p-3"
            >
              <label className="sr-only" htmlFor="th-fd-chat-input">Your message</label>
              <textarea
                id="th-fd-chat-input"
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                maxLength={1000}
                placeholder="Type your question. Please do not share health details."
                className="min-h-12 flex-1 resize-none rounded-lg border border-charcoal-ink/20 p-2 text-sm"
              />
              <Button type="submit" disabled={sending || text.trim() === ""}>{sending ? "..." : "Send"}</Button>
            </form>
          )}

          <footer className="border-t border-charcoal-ink/10 px-4 py-2 text-xs text-charcoal-ink/60">
            <span>{EMERGENCY_NOTE}</span>{" "}
            <a href="/privacy" className="underline underline-offset-2">Privacy Notice</a>
            {" "}
            <span>Chats are saved so our team can follow up.</span>
          </footer>
        </section>
      )}
    </>
  );
}
