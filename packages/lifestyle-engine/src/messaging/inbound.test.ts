import { describe, it, expect } from "@jest/globals";
import { classifyInboundMessage } from "./inbound";

describe("inbound WhatsApp classifier (spec §10.4)", () => {
  it("a bare number is a log attempt → redirect to the app, NEVER stored", () => {
    expect(classifyInboundMessage("128/82").intent).toBe("log_attempt");
    expect(classifyInboundMessage("log 5.6").intent).toBe("log_attempt");
    expect(classifyInboundMessage("72 kg").intent).toBe("log_attempt");
  });

  it("YES / refill is an admin confirmation", () => {
    expect(classifyInboundMessage("YES").intent).toBe("admin_confirm");
    expect(classifyInboundMessage("please refill my meds").intent).toBe("admin_confirm");
  });

  it("danger language escalates urgently, even alongside other words", () => {
    expect(classifyInboundMessage("I have chest pain since morning").intent).toBe("concern_urgent");
    expect(classifyInboundMessage("i want to harm myself").intent).toBe("concern_urgent");
    // urgent wins over a co-occurring number
    expect(classifyInboundMessage("chest pain and bp 180/110").intent).toBe("concern_urgent");
  });

  it("other free-text routes to the human clinician inbox", () => {
    expect(classifyInboundMessage("how do I take my new tablets?").intent).toBe(
      "concern_general",
    );
  });
});
