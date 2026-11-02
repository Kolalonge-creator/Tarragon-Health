import { describe, expect, it } from "@jest/globals";
import { TOPICS, topicOf } from "./topic";

describe("topicOf", () => {
  const cases: [string, string][] = [
    ["How much does it cost?", "pricing"],
    ["Is the app free?", "pricing"],
    ["What is the price in naira", "pricing"],
    ["When will you launch?", "launch"],
    ["Is it available yet", "launch"],
    ["Can I join the waitlist", "launch"],
    ["I want a refund", "payment_refund"],
    ["I was charged twice", "payment_refund"],
    ["How do I cancel", "payment_refund"],
    ["Do you work with HMOs", "business_partnership"],
    ["We are a company with 300 staff", "business_partnership"],
    ["Is my data safe? Who can see my records", "privacy_data"],
    ["I cannot log in", "account_help"],
    ["How do I sign up", "account_help"],
    ["Do you do blood tests", "tests_screening"],
    ["Can I book a doctor", "doctors_care"],
    ["I have diabetes, can you help", "conditions"],
    ["Is there an Android app", "app_access"],
    ["Can I use it on my phone?", "app_access"],
    ["How does it work", "how_it_works"],
    ["What is TarragonHealth", "how_it_works"],
    ["I am very unhappy with this", "complaint"],
    ["hello", "other"],
    ["", "other"],
  ];
  it.each(cases)("%s -> %s", (text, topic) => expect(topicOf(text)).toBe(topic));
  it("is case-insensitive", () => expect(topicOf("HOW MUCH IS IT")).toBe("pricing"));
  it("only ever returns a word the database accepts (lowercase letters and underscores, 3 to 40)", () => {
    for (const t of TOPICS) expect(t).toMatch(/^[a-z_]{3,40}$/);
    for (const [text] of cases) expect(TOPICS).toContain(topicOf(text));
  });
  it("puts a complaint before a price word (it is a person's job)", () => expect(topicOf("this price is terrible")).toBe("complaint"));
});
