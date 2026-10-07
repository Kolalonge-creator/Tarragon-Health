import { describe, expect, it } from "@jest/globals";
import { parseFaq, parseInfographic } from "./learning-render";

describe("parseFaq", () => {
  it("parses question and answer blocks", () => {
    const body = "Q: What is blood pressure?\nA: The force of blood on your artery walls.\n\nQ: Can I stop my tablets?\nA: Ask your care team first.\nDo not stop on your own.";
    expect(parseFaq(body)).toEqual([
      { question: "What is blood pressure?", answer: "The force of blood on your artery walls." },
      { question: "Can I stop my tablets?", answer: "Ask your care team first.\nDo not stop on your own." },
    ]);
  });
  it("returns null for plain text so the caller falls back to reading it as text", () => {
    expect(parseFaq("Just a paragraph with no questions.")).toBeNull();
    expect(parseFaq(null)).toBeNull();
  });
});

describe("parseInfographic", () => {
  it("reads image, alt and the text version", () => {
    expect(parseInfographic("image: https://cdn.example.org/a.png\nalt: A plate with half vegetables\n\nHalf your plate is vegetables.")).toEqual({
      imageUrl: "https://cdn.example.org/a.png",
      alt: "A plate with half vegetables",
      text: "Half your plate is vegetables.",
    });
  });
  it("ignores a non-https image but keeps the text", () => {
    const r = parseInfographic("image: javascript:alert(1)\nHello");
    expect(r.imageUrl).toBeNull();
    expect(r.text).toBe("Hello");
  });
  it("is just text when there is no image line", () => {
    expect(parseInfographic("Only words here.")).toEqual({ imageUrl: null, alt: "", text: "Only words here." });
  });
});
