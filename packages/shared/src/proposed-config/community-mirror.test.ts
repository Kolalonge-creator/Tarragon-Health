import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(suffix: string, marker: string): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`${suffix} not found`);
  const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error(`${marker} seed not found in ${file}`);
  return JSON.parse(match[1]);
}

interface CommunityRules {
  post_max_chars: number;
  edit_window_minutes: number;
  new_member_premoderated_posts: number;
  appeal_window_days: number;
  quality_sample_pct: number;
  image_max_bytes: number;
  qa_questions_per_member: number;
  qa_answer_grace_minutes: number;
  overdue_safety_minutes: number;
  overdue_queue_minutes: number;
  rate_posts_per_hour: number;
  rate_posts_per_day: number;
  block_cooldown: { max_blocks: number; window_minutes: number; cooldown_minutes: number };
  auto_hide_report_threshold: number;
  removed_body_retention_days: number;
  unmask: { min_reason_chars: number; max_per_day: number; signal_window_days: number };
  consent_version: string;
  feed_page_size: number;
  max_page_size: number;
  avatars: string[];
  handle_words: { adjectives: string[]; nouns: string[] };
}

describe("community.rules mirrors the migration seed", () => {
  const rules = getProposedConfig("community.rules").value as unknown as CommunityRules;

  it("v1 is identical to the community_config v1 seed", () => {
    expect(seed("_community_guard_and_seed.sql", "community-rules")).toEqual(getProposedConfig("community.rules").value);
  });

  it("the handle words can only make the handle shape the database accepts", () => {
    const word = /^[a-z]{3,12}$/;
    for (const w of [...rules.handle_words.adjectives, ...rules.handle_words.nouns]) expect(w).toMatch(word);
    expect(new Set(rules.handle_words.adjectives).size).toBe(rules.handle_words.adjectives.length);
    expect(new Set(rules.handle_words.nouns).size).toBe(rules.handle_words.nouns.length);
    // enough combinations that a group of thousands does not run out of handles
    expect(rules.handle_words.adjectives.length * rules.handle_words.nouns.length * 90).toBeGreaterThan(50_000);
  });

  it("no word can spell a phone number, an email or a link (a handle is shown to everyone)", () => {
    for (const w of [...rules.handle_words.adjectives, ...rules.handle_words.nouns]) {
      expect(w).not.toMatch(/\d|@|\./);
    }
  });

  it("avatars are preset codes the database accepts", () => {
    expect(rules.avatars.length).toBeGreaterThan(0);
    for (const a of rules.avatars) expect(a).toMatch(/^[a-z0-9_]{1,30}$/);
  });

  it("the limits are sane and fail safe", () => {
    expect(rules.post_max_chars).toBeGreaterThan(0);
    expect(rules.post_max_chars).toBeLessThanOrEqual(5000); // the table's own CHECK is the ceiling
    expect(rules.new_member_premoderated_posts).toBeGreaterThanOrEqual(1); // pre-moderation can be tuned, never silently switched off
    expect(rules.auto_hide_report_threshold).toBeGreaterThanOrEqual(2); // one angry member cannot hide a post
    expect(rules.rate_posts_per_hour).toBeLessThanOrEqual(rules.rate_posts_per_day);
    expect(rules.block_cooldown.max_blocks).toBeGreaterThanOrEqual(2);
    expect(rules.block_cooldown.cooldown_minutes).toBeGreaterThan(0);
    expect(rules.unmask.min_reason_chars).toBeGreaterThanOrEqual(20);
    expect(rules.unmask.max_per_day).toBeGreaterThan(0);
    expect(rules.feed_page_size).toBeLessThanOrEqual(rules.max_page_size);
  });

  it("the consent text is not yet approved, and says so", () => {
    // OQ-COM-06: counsel approves the wording. Until then the version string must say it is a draft.
    expect(rules.consent_version).toMatch(/^DRAFT/);
  });
});
