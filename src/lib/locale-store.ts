/**
 * UI language preference (first-run choice).
 *
 * File: $OMS_DATA_DIR/ui-locale
 * Content: single line `en` or `zh`
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";

export type Locale = "en" | "zh";

const VALID = new Set<string>(["en", "zh"]);

export function localePath(): string {
  return path.join(dataDir(), "ui-locale");
}

/** null = never chosen (first run should ask). */
export function loadLocale(): Locale | null {
  try {
    const p = localePath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8").trim().toLowerCase();
    if (VALID.has(raw)) return raw as Locale;
    return null;
  } catch {
    return null;
  }
}

export function saveLocale(locale: Locale): { ok: boolean; path: string; error?: string } {
  const p = localePath();
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${locale}\n`, "utf8");
    fs.renameSync(tmp, p);
    return { ok: true, path: p };
  } catch (e) {
    return {
      ok: false,
      path: p,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
