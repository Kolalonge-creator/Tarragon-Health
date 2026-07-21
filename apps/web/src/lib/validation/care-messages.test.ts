import { startThreadSchema, postMessageSchema } from "./care-messages";

describe("startThreadSchema", () => {
  it("requires a subject of at least 3 chars", () => {
    expect(startThreadSchema.safeParse({ subject: "hi", body: "hello" }).success).toBe(false);
  });

  it("accepts a valid subject + body", () => {
    expect(
      startThreadSchema.safeParse({ subject: "My blood pressure", body: "Should I be worried?" })
        .success,
    ).toBe(true);
  });
});

describe("postMessageSchema", () => {
  it("rejects an empty body", () => {
    expect(postMessageSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("accepts a non-empty body", () => {
    expect(postMessageSchema.safeParse({ body: "Thanks!" }).success).toBe(true);
  });
});
