/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { FrontDeskChat } from "./frontdesk-chat";

type FetchArgs = [string, { method?: string; body?: string } | undefined];
const INTRO = "Hello, I am TarragonHealth's AI assistant, not a person and not a doctor. How can I help?";

function mockFetch(handlers: Record<string, () => { status?: number; json: unknown }>) {
  const calls: FetchArgs[] = [];
  const fn = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
    calls.push([url, init]);
    const h = handlers[url];
    if (!h) throw new Error(`unexpected fetch ${url}`);
    const r = h();
    return { status: r.status ?? 200, json: async () => r.json } as Response;
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return calls;
}

const enabled = { "/api/frontdesk/chat/config": () => ({ json: { enabled: true, intro: INTRO } }) };

beforeEach(() => {
  window.sessionStorage.clear();
});

async function openChat() {
  render(<FrontDeskChat />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /ask us a question/i }));
  });
}

describe("FrontDeskChat", () => {
  it("opens with the AI disclosure, the AI label, an emergency instruction and a privacy link", async () => {
    mockFetch(enabled);
    await openChat();
    expect(await screen.findByText(INTRO)).toBeTruthy();
    expect(screen.getAllByTestId("ai-label").length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog", { name: /tarragonhealth assistant/i })).toBeTruthy();
    expect(screen.getAllByText(/go to the nearest hospital now/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /privacy notice/i }).getAttribute("href")).toBe("/privacy");
    // said in the header and again in the first message
    expect(screen.getAllByText(/not a person and not a doctor/i).length).toBeGreaterThanOrEqual(2);
  });

  it("is accessible (no axe violations) open", async () => {
    mockFetch(enabled);
    await openChat();
    await screen.findByText(INTRO);
    expect((await axe(document.body)).violations).toEqual([]);
  });

  it("shows the contact form, not a chat, when the assistant is off", async () => {
    mockFetch({ "/api/frontdesk/chat/config": () => ({ json: { enabled: false, intro: "" } }) });
    await openChat();
    expect(await screen.findByRole("form", { name: /leave your details/i })).toBeTruthy();
    expect(screen.queryByLabelText(/your message/i, { selector: "#th-fd-chat-input" })).toBeNull();
  });

  it("falls back to the contact form when the config cannot be fetched", async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => { throw new Error("offline"); });
    await openChat();
    expect(await screen.findByRole("form", { name: /leave your details/i })).toBeTruthy();
  });

  it("sends a message with no secret first, then stores the conversation and reuses it", async () => {
    let n = 0;
    const calls = mockFetch({
      ...enabled,
      "/api/frontdesk/chat": () => ({ json: n++ === 0 ? { mode: "chat", conversationId: "c1", secret: "sec", reply: "The app is free to start.", needsContact: false, emergency: false } : { mode: "chat", conversationId: "c1", reply: "Yes.", needsContact: false, emergency: false } }),
    });
    await openChat();
    await screen.findByText(INTRO);
    const box = screen.getByPlaceholderText(/type your question/i);
    fireEvent.change(box, { target: { value: "Is it free?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    expect(await screen.findByText("The app is free to start.")).toBeTruthy();
    const first = JSON.parse(calls.find((c) => c[0] === "/api/frontdesk/chat")![1]!.body!) as Record<string, unknown>;
    expect(first.message).toBe("Is it free?");
    expect(first.secret).toBeUndefined();
    expect(window.sessionStorage.getItem("th-fd-chat")).toContain("sec");

    fireEvent.change(screen.getByPlaceholderText(/type your question/i), { target: { value: "And a refund?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await screen.findByText("Yes.");
    const second = JSON.parse(calls.filter((c) => c[0] === "/api/frontdesk/chat")[1]![1]!.body!) as Record<string, unknown>;
    expect(second).toMatchObject({ conversationId: "c1", secret: "sec" });
  });

  it("labels every assistant reply as AI", async () => {
    mockFetch({ ...enabled, "/api/frontdesk/chat": () => ({ json: { mode: "chat", conversationId: "c1", secret: "s", reply: "Reply one.", needsContact: false } }) });
    await openChat();
    await screen.findByText(INTRO);
    fireEvent.change(screen.getByPlaceholderText(/type your question/i), { target: { value: "hi" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await screen.findByText("Reply one.");
    expect(screen.getAllByTestId("ai-label")).toHaveLength(2); // the opening disclosure and the reply
  });

  it("an emergency reply raises a persistent alert banner", async () => {
    mockFetch({ ...enabled, "/api/frontdesk/chat": () => ({ json: { mode: "chat", conversationId: null, reply: "This sounds like it could be an emergency.", emergency: true, needsContact: true } }) });
    await openChat();
    await screen.findByText(INTRO);
    fireEvent.change(screen.getByPlaceholderText(/type your question/i), { target: { value: "I have chest pain" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("This sounds like it could be an emergency.")).toBeTruthy();
  });

  it("asks for contact details with a consent tick, and will not send until it is ticked", async () => {
    mockFetch({ ...enabled, "/api/frontdesk/chat": () => ({ json: { mode: "chat", conversationId: "c1", secret: "s", reply: "I have passed this to our team.", needsContact: true } }) });
    await openChat();
    await screen.findByText(INTRO);
    fireEvent.change(screen.getByPlaceholderText(/type your question/i), { target: { value: "Corporate plans?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    const form = await screen.findByRole("form", { name: /leave your details/i });
    const submit = form.querySelector("button[type=submit]") as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada Obi" } });
    fireEvent.change(screen.getByLabelText("Email or phone"), { target: { value: "ada@example.com" } });
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit.disabled).toBe(false);
    expect(screen.getByText(/CRM provider \(HubSpot\)/)).toBeTruthy();
  });

  it("sends the details with consent true and shows thanks", async () => {
    const calls = mockFetch({
      ...enabled,
      "/api/frontdesk/chat": () => ({ json: { mode: "chat", conversationId: "c1", secret: "s", reply: "Passed on.", needsContact: true } }),
      "/api/frontdesk/chat/contact": () => ({ json: { captured: true } }),
    });
    await openChat();
    await screen.findByText(INTRO);
    fireEvent.change(screen.getByPlaceholderText(/type your question/i), { target: { value: "Corporate plans?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await screen.findByRole("form", { name: /leave your details/i });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada Obi" } });
    fireEvent.change(screen.getByLabelText("Email or phone"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /send my details/i })); });
    await waitFor(() => expect(screen.getByText(/our team has your details/i)).toBeTruthy());
    const body = JSON.parse(calls.find((c) => c[0] === "/api/frontdesk/chat/contact")![1]!.body!) as Record<string, unknown>;
    expect(body).toMatchObject({ name: "Ada Obi", contact: "ada@example.com", consent: true, conversationId: "c1", secret: "s" });
  });

  it("switches to the contact form when the server says the assistant is unavailable, keeping what was typed", async () => {
    mockFetch({ ...enabled, "/api/frontdesk/chat": () => ({ json: { mode: "form", reason: "spend_cap" } }) });
    await openChat();
    await screen.findByText(INTRO);
    fireEvent.change(screen.getByPlaceholderText(/type your question/i), { target: { value: "How much is it?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    expect(await screen.findByRole("form", { name: /leave your details/i })).toBeTruthy();
    expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).value).toBe("How much is it?");
  });

  it("tells the visitor politely when they are rate limited", async () => {
    mockFetch({ ...enabled, "/api/frontdesk/chat": () => ({ status: 429, json: { error: "rate_limited" } }) });
    await openChat();
    await screen.findByText(INTRO);
    fireEvent.change(screen.getByPlaceholderText(/type your question/i), { target: { value: "hi" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    expect(await screen.findByText(/sending messages quickly/i)).toBeTruthy();
  });

  it("Escape closes the panel and returns focus to the launcher", async () => {
    mockFetch(enabled);
    await openChat();
    await screen.findByText(INTRO);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /ask us a question/i }));
  });
});
