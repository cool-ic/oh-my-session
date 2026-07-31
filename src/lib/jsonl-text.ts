/**
 * Shared helpers for agent jsonl transcripts (Claude / Qoder-style content).
 */

/** Flatten message.content (string | content-blocks) to plain text. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (typeof b === "object" && b && "text" in b) {
          const t = (b as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .join(" ");
  }
  if (typeof content === "object" && content && "text" in content) {
    const t = (content as { text?: unknown }).text;
    return typeof t === "string" ? t : "";
  }
  return "";
}

export function oneLine(s: string, limit: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > limit ? t.slice(0, limit) + "…" : t;
}

/** Tool-generated / meta user blobs we should not use as titles. */
export function isGeneratedMetaText(text: string): boolean {
  return (
    /^\s*<[a-z][A-Za-z0-9_.:-]*(?:\s|\/?>)/.test(text) ||
    /^\s*\[Request interrupted by user/i.test(text)
  );
}
