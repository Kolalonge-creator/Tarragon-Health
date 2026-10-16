/**
 * S19e: the Android alarm channel for on-call pages. The sender names `on_call_page` only for a page or test page, only on Android,
 * and only for a phone that said it created the channel (page_channel_ready); everything else keeps `urgent`. The id must equal the
 * one the app creates, and the migration must carry the column the sender reads.
 */
import "./support/deno.ts";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { expoChannelFor, expoUrgencyFields, PAGE_CHANNEL_ID, URGENT_CHANNEL_ID } from "../../../supabase/functions/_shared/notifications/delivery.ts";

describe("expoChannelFor", () => {
  it("a page and a test page ring the alarm channel on a ready phone", () => {
    expect(expoChannelFor("on_call_page", true)).toBe(PAGE_CHANNEL_ID);
    expect(expoChannelFor("on_call_test_page", true)).toBe(PAGE_CHANNEL_ID);
  });
  it("a phone that has not created the channel keeps urgent (never a channel it lacks)", () => {
    expect(expoChannelFor("on_call_page", false)).toBe(URGENT_CHANNEL_ID);
    expect(expoChannelFor("on_call_page", null)).toBe(URGENT_CHANNEL_ID);
    expect(expoChannelFor("on_call_page", undefined)).toBe(URGENT_CHANNEL_ID);
  });
  it("leadership notices and every other template stay on urgent", () => {
    for (const t of ["on_call_escalation", "on_call_expired", "on_call_unfinished", "red_event_guidance_waiting", "test_alert", null, undefined]) {
      expect(expoChannelFor(t as string | null | undefined, true)).toBe(URGENT_CHANNEL_ID);
    }
  });
  it("feeds the push fields; the default stays urgent", () => {
    expect(expoUrgencyFields(true, false, true, PAGE_CHANNEL_ID).channelId).toBe("on_call_page");
    expect(expoUrgencyFields(true, false, true).channelId).toBe("urgent");
    expect(expoUrgencyFields(true, false, false, PAGE_CHANNEL_ID).channelId).toBeUndefined();
  });
});

describe("the sender, the app and the migration agree", () => {
  it("the app creates the same channel id", () => {
    expect(readFileSync("../../apps/mobile/src/lib/paging/page-channel.ts", "utf8")).toContain(`PAGE_CHANNEL_ID = "${PAGE_CHANNEL_ID}"`);
  });
  it("the sender reads page_channel_ready, falls back without it, and the app reports it at registration", () => {
    const src = readFileSync("../../supabase/functions/send-pending-notifications/index.ts", "utf8");
    expect(src).toContain("page_channel_ready");
    expect(src).toContain("retrying without page_channel_ready");
    expect(readFileSync("../../apps/mobile/src/lib/push-registration.ts", "utf8")).toContain("page_channel_ready");
  });
  it("a phone that has the page channel but not `urgent` is still sent the page on the page channel", () => {
    const src = readFileSync("../../supabase/functions/send-pending-notifications/index.ts", "utf8");
    expect(src).toContain("channelFor(sub, template) === PAGE_CHANNEL_ID || sub.urgent_channel_ready === true");
  });
  it("a migration adds the column with default false", () => {
    const dir = "../../supabase/migrations";
    const f = readdirSync(dir).find((n) => n.endsWith("_s19e_native_page_receipts.sql"))!;
    expect(readFileSync(`${dir}/${f}`, "utf8")).toMatch(/add column page_channel_ready boolean not null default false/);
  });
});
