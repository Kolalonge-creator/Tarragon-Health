import { asObject, httpJson, type FetchLike } from "../integrations/http.ts";
import { fail, ok, type ProviderResult } from "../integrations/result.ts";

/**
 * A small HubSpot CRM client for the front desk (F5). Contacts and notes only. Never throws: every outcome is a ProviderResult.
 *
 * ONE CONTACT PER PERSON. With an email the contact is written with `batch/upsert` keyed on email, which HubSpot makes atomic, so a retry or a
 * race cannot create a second one. Without an email (a phone-only enquiry) the client SEARCHES by phone first, updates what it finds, creates
 * only when nothing is found, and recovers from a 409 "already exists" by using the id HubSpot names in the message.
 *
 * WHAT WE WRITE. Identity and product facts only (email, first name, last name, phone, and our own `tarragon_stage` when that property can
 * exist). Sales fields (lifecycle stage, lead status, owner) belong to the founder in HubSpot: they are read back, never written.
 */
export interface HubspotConfig {
  readonly token: string;
  readonly fetch: FetchLike;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export interface HubspotContactInput {
  readonly email: string | null;
  readonly phone: string | null;
  readonly name: string | null;
  readonly stage: string | null;
}

export interface HubspotSales {
  readonly lifecyclestage: string | null;
  readonly hs_lead_status: string | null;
  readonly hubspot_owner_id: string | null;
}

export interface HubspotClient {
  /** Create or update, returning the HubSpot id. */
  upsertContact(input: HubspotContactInput): Promise<ProviderResult<string>>;
  addNote(contactId: string, body: string): Promise<ProviderResult<null>>;
  readSales(contactId: string): Promise<ProviderResult<HubspotSales>>;
}

const SALES_PROPS = ["lifecyclestage", "hs_lead_status", "hubspot_owner_id"] as const;
const NOTE_TO_CONTACT = 202; // HubSpot-defined association type: note -> contact

/** "Aisha Bello" -> first "Aisha", last "Bello"; a single word is a first name. */
export function splitName(name: string | null): { firstname?: string; lastname?: string } {
  const n = (name ?? "").trim().replace(/\s+/g, " ");
  if (n === "") return {};
  const i = n.indexOf(" ");
  return i === -1 ? { firstname: n } : { firstname: n.slice(0, i), lastname: n.slice(i + 1) };
}

export function createHubspotClient(config: HubspotConfig): HubspotClient {
  const base = (config.baseUrl ?? "https://api.hubapi.com").replace(/\/$/, "");
  const deps = { fetch: config.fetch, timeoutMs: config.timeoutMs ?? 10_000 };
  const auth = { Authorization: `Bearer ${config.token}` };
  // The custom property is created once, best effort: a token without the schema scope just means the stage travels in notes only.
  let stageProperty: "unknown" | "ready" | "unavailable" = "unknown";

  const call = (method: "GET" | "POST", path: string, body?: unknown) => httpJson(deps, { url: `${base}${path}`, method, headers: auth, body });

  async function ensureStageProperty(): Promise<boolean> {
    if (stageProperty === "ready") return true;
    if (stageProperty === "unavailable") return false;
    const res = await call("POST", "/crm/v3/properties/contacts", {
      name: "tarragon_stage",
      label: "Tarragon stage",
      type: "string",
      fieldType: "text",
      groupName: "contactinformation",
      description: "Where this person is in the TarragonHealth journey. Written by TarragonHealth; do not edit.",
    });
    stageProperty = res.ok || res.error.code === "conflict" ? "ready" : "unavailable";
    return stageProperty === "ready";
  }

  function properties(input: HubspotContactInput, withStage: boolean): Record<string, string> {
    const p: Record<string, string> = {};
    if (input.email) p["email"] = input.email;
    if (input.phone) p["phone"] = input.phone;
    const n = splitName(input.name);
    if (n.firstname) p["firstname"] = n.firstname;
    if (n.lastname) p["lastname"] = n.lastname;
    if (withStage && input.stage) p["tarragon_stage"] = input.stage;
    return p;
  }

  const firstId = (data: unknown): string | null => {
    const results = asObject(data)?.["results"];
    const first = Array.isArray(results) ? asObject(results[0]) : null;
    const id = first?.["id"];
    return typeof id === "string" || typeof id === "number" ? String(id) : null;
  };

  async function upsertByEmail(input: HubspotContactInput, withStage: boolean): Promise<ProviderResult<string>> {
    const res = await call("POST", "/crm/v3/objects/contacts/batch/upsert", {
      inputs: [{ idProperty: "email", id: input.email, properties: properties(input, withStage) }],
    });
    if (!res.ok) return res;
    const id = firstId(res.data);
    return id ? ok(id) : fail("bad_response", "HubSpot did not return a contact id");
  }

  async function upsertByPhone(input: HubspotContactInput, withStage: boolean): Promise<ProviderResult<string>> {
    const found = await call("POST", "/crm/v3/objects/contacts/search", {
      filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: input.phone }] }],
      limit: 1,
    });
    if (!found.ok) return found;
    const existing = firstId(found.data);
    if (existing) {
      const upd = await call("POST", "/crm/v3/objects/contacts/batch/update", { inputs: [{ id: existing, properties: properties(input, withStage) }] });
      return upd.ok ? ok(existing) : upd;
    }
    const created = await call("POST", "/crm/v3/objects/contacts", { properties: properties(input, withStage) });
    if (created.ok) {
      const id = asObject(created.data)?.["id"];
      return typeof id === "string" || typeof id === "number" ? ok(String(id)) : fail("bad_response", "HubSpot did not return a contact id");
    }
    // Lost a race: HubSpot says who already exists ("Contact already exists. Existing ID: 123").
    if (created.error.code === "conflict") {
      const m = /Existing ID:\s*(\d+)/i.exec(created.error.message);
      if (m?.[1]) return ok(m[1]);
    }
    return created;
  }

  return {
    async upsertContact(input) {
      if (!input.email && !input.phone) return fail("invalid_input", "A contact needs an email or a phone");
      const withStage = await ensureStageProperty();
      return input.email ? upsertByEmail(input, withStage) : upsertByPhone(input, withStage);
    },

    async addNote(contactId, body) {
      const res = await call("POST", "/crm/v3/objects/notes", {
        properties: { hs_timestamp: new Date().toISOString(), hs_note_body: body.slice(0, 5000) },
        associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: NOTE_TO_CONTACT }] }],
      });
      return res.ok ? ok(null) : res;
    },

    async readSales(contactId) {
      const res = await call("POST", "/crm/v3/objects/contacts/batch/read", { inputs: [{ id: contactId }], properties: [...SALES_PROPS] });
      if (!res.ok) return res;
      const results = asObject(res.data)?.["results"];
      const props = Array.isArray(results) ? asObject(asObject(results[0])?.["properties"]) : null;
      const pick = (k: string): string | null => (typeof props?.[k] === "string" && (props[k] as string) !== "" ? (props[k] as string) : null);
      return ok({ lifecyclestage: pick("lifecyclestage"), hs_lead_status: pick("hs_lead_status"), hubspot_owner_id: pick("hubspot_owner_id") });
    },
  };
}
