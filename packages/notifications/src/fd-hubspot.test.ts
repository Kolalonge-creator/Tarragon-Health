/**
 * Front Desk M3: the HubSpot client, the sync loop and its handler (F5), against an in-memory fake of the parts of HubSpot's API the front desk
 * uses. The fake enforces what HubSpot enforces (email is unique; a phone-only create can race and 409), so "one person is one contact" is
 * tested, not assumed. The database half (consent, queueing, backoff) is proved in packages/db/tests/fd_m3_crm_link.sql.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { createHubspotClient, splitName, syncToHubspot, type ClaimedCrmRow } from "../../../supabase/functions/_shared/frontdesk/index.ts";
import { handleSync } from "../../../supabase/functions/fd-hubspot-sync/handler.ts";

interface Contact { id: string; props: Record<string, string> }
interface Note { body: string; contactId: string; associationTypeId: number }

function fakeHubspot(opts: { schemaScope?: boolean; raceOnCreate?: boolean } = {}) {
  const contacts: Contact[] = [];
  const notes: Note[] = [];
  const calls: { method: string; path: string; body: unknown }[] = [];
  let nextId = 1000;
  let property: "none" | "created" = "none";
  const respond = (status: number, json: unknown) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(json) });

  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const path = url.replace("https://api.hubapi.com", "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body });
    if (init.headers["Authorization"] !== "Bearer test-token") return respond(401, { message: "invalid token" });
    const byEmail = (e: string) => contacts.find((c) => c.props["email"] === e);

    if (path === "/crm/v3/properties/contacts") {
      if (opts.schemaScope === false) return respond(403, { message: "missing scope" });
      if (property === "created") return respond(409, { message: "property exists" });
      property = "created";
      return respond(201, {});
    }
    if (path === "/crm/v3/objects/contacts/batch/upsert") {
      const input = body.inputs[0];
      let c = byEmail(input.id);
      if (!c) { c = { id: String(nextId++), props: {} }; contacts.push(c); }
      Object.assign(c.props, input.properties);
      return respond(200, { results: [{ id: c.id }] });
    }
    if (path === "/crm/v3/objects/contacts/search") {
      const v = body.filterGroups[0].filters[0].value;
      const c = contacts.find((x) => x.props["phone"] === v);
      return respond(200, { results: c ? [{ id: c.id }] : [] });
    }
    if (path === "/crm/v3/objects/contacts/batch/update") {
      const input = body.inputs[0];
      const c = contacts.find((x) => x.id === input.id);
      if (!c) return respond(404, { message: "not found" });
      Object.assign(c.props, input.properties);
      return respond(200, { results: [{ id: c.id }] });
    }
    if (path === "/crm/v3/objects/contacts") {
      const phone = body.properties.phone;
      if (opts.raceOnCreate && phone) {
        const racer = { id: "777", props: { phone } };
        contacts.push(racer);
        return respond(409, { message: "Contact already exists. Existing ID: 777" });
      }
      const c = { id: String(nextId++), props: { ...body.properties } };
      contacts.push(c);
      return respond(201, { id: c.id });
    }
    if (path === "/crm/v3/objects/notes") {
      notes.push({ body: body.properties.hs_note_body, contactId: body.associations[0].to.id, associationTypeId: body.associations[0].types[0].associationTypeId });
      return respond(201, { id: "n1" });
    }
    if (path === "/crm/v3/objects/contacts/batch/read") {
      const c = contacts.find((x) => x.id === body.inputs[0].id);
      return respond(200, { results: [{ id: body.inputs[0].id, properties: { lifecyclestage: c?.props["lifecyclestage"] ?? "lead", hs_lead_status: "NEW", hubspot_owner_id: "" } }] });
    }
    return respond(404, { message: `unexpected ${path}` });
  };
  return { fetch, contacts, notes, calls };
}

const client = (f: ReturnType<typeof fakeHubspot>) => createHubspotClient({ token: "test-token", fetch: f.fetch });
const input = (o: Partial<{ email: string | null; phone: string | null; name: string | null; stage: string | null }> = {}) => ({
  email: "ada@example.invalid", phone: "+2348031234567", name: "Ada Obi", stage: "enquiry", ...o,
});

describe("splitName", () => {
  it("splits first and last, keeps a single word as a first name, and handles blanks", () => {
    expect(splitName("Aisha Bello")).toEqual({ firstname: "Aisha", lastname: "Bello" });
    expect(splitName("  Mary   Ann Okoro ")).toEqual({ firstname: "Mary", lastname: "Ann Okoro" });
    expect(splitName("Chidi")).toEqual({ firstname: "Chidi" });
    expect(splitName(null)).toEqual({});
    expect(splitName("   ")).toEqual({});
  });
});

describe("HubSpot client: one person is one contact", () => {
  it("a form lead and a chat lead with the same email produce exactly one HubSpot contact", async () => {
    const h = fakeHubspot();
    const c = client(h);
    const a = await c.upsertContact(input());
    const b = await c.upsertContact(input({ phone: null }));
    expect(a).toEqual({ ok: true, data: "1000" });
    expect(b).toEqual({ ok: true, data: "1000" });
    expect(h.contacts).toHaveLength(1);
  });

  it("keys the write on email through the atomic batch upsert, and never creates by a separate POST", async () => {
    const h = fakeHubspot();
    await client(h).upsertContact(input());
    expect(h.calls.some((x) => x.path === "/crm/v3/objects/contacts" && x.method === "POST")).toBe(false);
    const up = h.calls.find((x) => x.path.endsWith("/batch/upsert"));
    expect((up?.body as { inputs: { idProperty: string; id: string }[] }).inputs[0]).toMatchObject({ idProperty: "email", id: "ada@example.invalid" });
  });

  it("writes identity and our stage only: never the sales fields HubSpot owns", async () => {
    const h = fakeHubspot();
    await client(h).upsertContact(input());
    const written = Object.keys(h.contacts[0]!.props);
    expect(written.sort()).toEqual(["email", "firstname", "lastname", "phone", "tarragon_stage"]);
    for (const banned of ["lifecyclestage", "hs_lead_status", "hubspot_owner_id"]) expect(written).not.toContain(banned);
  });

  it("falls back to notes-only when the token cannot create our property (stage is simply not written)", async () => {
    const h = fakeHubspot({ schemaScope: false });
    const r = await client(h).upsertContact(input());
    expect(r.ok).toBe(true);
    expect(Object.keys(h.contacts[0]!.props)).not.toContain("tarragon_stage");
  });

  it("creates the property once, not on every call", async () => {
    const h = fakeHubspot();
    const c = client(h);
    await c.upsertContact(input());
    await c.upsertContact(input({ email: "other@example.invalid" }));
    expect(h.calls.filter((x) => x.path === "/crm/v3/properties/contacts")).toHaveLength(1);
  });

  it("a phone-only enquiry searches first: creates once, then updates the same contact", async () => {
    const h = fakeHubspot();
    const c = client(h);
    const first = await c.upsertContact(input({ email: null }));
    const second = await c.upsertContact(input({ email: null, name: "Ada O" }));
    expect(first).toEqual(second);
    expect(h.contacts).toHaveLength(1);
  });

  it("recovers from a create race by using the id HubSpot names, never making a second contact", async () => {
    const h = fakeHubspot({ raceOnCreate: true });
    const r = await client(h).upsertContact(input({ email: null }));
    expect(r).toEqual({ ok: true, data: "777" });
    expect(h.contacts).toHaveLength(1);
  });

  it("refuses a contact with neither email nor phone", async () => {
    const r = await client(fakeHubspot()).upsertContact(input({ email: null, phone: null }));
    expect(r.ok).toBe(false);
  });

  it("attaches a note to the contact with the note-to-contact association", async () => {
    const h = fakeHubspot();
    const c = client(h);
    const id = await c.upsertContact(input());
    if (!id.ok) throw new Error("setup");
    expect((await c.addNote(id.data, "Enquiry via website form")).ok).toBe(true);
    expect(h.notes).toEqual([{ body: "Enquiry via website form", contactId: "1000", associationTypeId: 202 }]);
  });

  it("reads the sales fields back", async () => {
    const h = fakeHubspot();
    const c = client(h);
    const id = await c.upsertContact(input());
    if (!id.ok) throw new Error("setup");
    expect(await c.readSales(id.data)).toEqual({ ok: true, data: { lifecyclestage: "lead", hs_lead_status: "NEW", hubspot_owner_id: null } });
  });

  it("reports a bad token as unauthorized (not retryable) and never throws on a network failure", async () => {
    const bad = createHubspotClient({ token: "wrong", fetch: fakeHubspot().fetch });
    const r = await bad.upsertContact(input());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unauthorized");
    const down = createHubspotClient({ token: "x", fetch: async () => { throw new Error("offline"); } });
    const d = await down.upsertContact(input());
    expect(d.ok).toBe(false);
  });
});

const row = (o: Partial<ClaimedCrmRow> = {}): ClaimedCrmRow => ({
  outbox_id: "o1", kind: "contact_upsert", contact_id: "c1", email: "ada@example.invalid", phone: null, name: "Ada Obi", lifecycle_stage: "enquiry",
  source: "website_form", hubspot_contact_id: null, payload: null, attempts: 1, ...o,
});

function syncHarness(rows: ClaimedCrmRow[], f = fakeHubspot()) {
  const finished: { id: string; ok: boolean; hubspotId: string | null; stage: string | null; sales: Record<string, string | null> | null; err: string | null }[] = [];
  const deps = {
    client: client(f),
    claim: async () => ({ ok: true as const, rows }),
    finish: async (id: string, ok: boolean, hubspotId: string | null, stage: string | null, sales: Record<string, string | null> | null, err: string | null) => void finished.push({ id, ok, hubspotId, stage, sales, err }),
  };
  return { f, finished, deps };
}

describe("syncToHubspot", () => {
  it("upserts, reads the sales fields back, and records the HubSpot id and the synced stage", async () => {
    const h = syncHarness([row()]);
    expect(await syncToHubspot(h.deps)).toEqual({ claimed: 1, sent: 1, failed: 0, unrecorded: 0 });
    expect(h.finished[0]).toMatchObject({ ok: true, hubspotId: "1000", stage: "enquiry", err: null });
    expect(h.finished[0]?.sales).toMatchObject({ lifecyclestage: "lead", hs_lead_status: "NEW" });
  });

  it("a form lead and a chat lead (two upsert rows, same person) leave one contact and two notes in HubSpot", async () => {
    const h = syncHarness([
      row({ outbox_id: "u1" }),
      row({ outbox_id: "n1", kind: "note", payload: { body: "Enquiry via website form" } }),
      row({ outbox_id: "n2", kind: "note", payload: { body: "Enquiry via website chat" } }),
    ]);
    expect(await syncToHubspot(h.deps)).toEqual({ claimed: 3, sent: 3, failed: 0, unrecorded: 0 });
    expect(h.f.contacts).toHaveLength(1);
    expect(h.f.notes.map((n) => n.body)).toEqual(["Enquiry via website form", "Enquiry via website chat"]);
    expect(h.f.notes.every((n) => n.contactId === "1000")).toBe(true);
  });

  it("a note for a contact with no HubSpot id upserts first, so it is never orphaned", async () => {
    const h = syncHarness([row({ outbox_id: "n1", kind: "note", payload: { body: "hello" } })]);
    await syncToHubspot(h.deps);
    expect(h.f.contacts).toHaveLength(1);
    expect(h.f.notes).toHaveLength(1);
  });

  it("a note for a contact that already has an id does not search or upsert again", async () => {
    const f = fakeHubspot();
    const h = syncHarness([row({ outbox_id: "n1", kind: "note", hubspot_contact_id: "555", payload: { body: "hello" } })], f);
    await syncToHubspot(h.deps);
    expect(f.calls.some((x) => x.path.includes("upsert") || x.path.endsWith("/search"))).toBe(false);
    expect(f.notes[0]?.contactId).toBe("555");
  });

  it("records a failed write with the vendor's code and carries on", async () => {
    const f = fakeHubspot();
    const bad = createHubspotClient({ token: "wrong", fetch: f.fetch });
    const h = syncHarness([row({ outbox_id: "a" }), row({ outbox_id: "b" })], f);
    expect(await syncToHubspot({ ...h.deps, client: bad })).toEqual({ claimed: 2, sent: 0, failed: 2, unrecorded: 0 });
    expect(h.finished[0]?.err).toMatch(/unauthorized/);
  });

  it("a delivered write whose bookkeeping fails is counted unrecorded and NOT recorded as a failure", async () => {
    const h = syncHarness([row()]);
    const calls: boolean[] = [];
    const r = await syncToHubspot({ ...h.deps, finish: async (_i, ok) => { calls.push(ok); throw new Error("db down"); } });
    expect(r).toEqual({ claimed: 1, sent: 0, failed: 0, unrecorded: 1 });
    expect(calls).toEqual([true]);
  });

  it("a failed sales read-back does not turn a delivered write into a failure", async () => {
    const f = fakeHubspot();
    const flaky = { ...client(f), readSales: async () => ({ ok: false as const, error: { code: "network" as const, message: "x", retryable: true } }) };
    const h = syncHarness([row()], f);
    expect(await syncToHubspot({ ...h.deps, client: flaky })).toEqual({ claimed: 1, sent: 1, failed: 0, unrecorded: 0 });
    expect(h.finished[0]).toMatchObject({ ok: true, sales: null });
  });

  it("returns the claim error and touches HubSpot not at all when the database cannot be read", async () => {
    const f = fakeHubspot();
    const r = await syncToHubspot({ ...syncHarness([], f).deps, claim: async () => ({ ok: false as const, error: "boom" }) });
    expect(r).toEqual({ error: "boom" });
    expect(f.calls).toHaveLength(0);
  });
});

describe("handleSync", () => {
  const req = (secret?: string) => new Request("https://x.invalid/s", { method: "POST", headers: secret ? { "x-fd-followup-secret": secret } : {} });
  const base = () => { const h = syncHarness([row()]); return { secret: "s3cret" as string | null, client: h.deps.client as ReturnType<typeof client> | null, claim: h.deps.claim, finish: h.deps.finish }; };

  it("fails closed without a secret, refuses a wrong one", async () => {
    expect((await handleSync(req("s3cret"), { ...base(), secret: null })).status).toBe(503);
    expect((await handleSync(req(), base())).status).toBe(401);
    expect((await handleSync(req("nope"), base())).status).toBe(401);
  });
  it("claims nothing without a HubSpot token (rows wait)", async () => {
    let claimed = 0;
    const res = await handleSync(req("s3cret"), { ...base(), client: null, claim: async () => { claimed += 1; return { ok: true as const, rows: [] }; } });
    expect(res.status).toBe(503);
    expect(claimed).toBe(0);
  });
  it("syncs with the right secret", async () => {
    const res = await handleSync(req("s3cret"), base());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 1, sent: 1, failed: 0, unrecorded: 0 });
  });
  it("answers 500 when a write was delivered but could not be recorded", async () => {
    const res = await handleSync(req("s3cret"), { ...base(), finish: async () => { throw new Error("db down"); } });
    expect(res.status).toBe(500);
  });
  it("answers 500 when the database cannot be read", async () => {
    expect((await handleSync(req("s3cret"), { ...base(), claim: async () => ({ ok: false as const, error: "x" }) })).status).toBe(500);
  });
});
