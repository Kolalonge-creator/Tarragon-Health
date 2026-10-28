import { prerender } from "react-dom/static";
import type { ReactNode } from "react";

/**
 * Test helper (W-46/W-47): render an async server component page to plain visible text, waiting for every Suspense boundary. Scripts
 * and tags are dropped so a test sees what a visitor reads, and numbers and names can be asserted on.
 */
export async function renderPageText(page: () => Promise<ReactNode> | ReactNode): Promise<string> {
  const tree = await page();
  const { prelude } = await prerender(tree);
  const reader = prelude.getReader();
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  const html = chunks.join("");
  return html
    .replace(/<script\b[\s\S]*?<\/script[^>]*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
