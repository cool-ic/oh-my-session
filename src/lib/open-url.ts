/**
 * Open a URL in the default browser (macOS / Windows / Linux).
 * Fire-and-forget — does not block the TUI.
 */
import { spawn } from "node:child_process";

export interface OpenUrlResult {
  ok: boolean;
  tool?: string;
  error?: string;
}

export function openUrl(url: string): OpenUrlResult {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) {
    return { ok: false, error: "url must be http(s)" };
  }

  try {
    if (process.platform === "darwin") {
      const c = spawn("open", [u], {
        detached: true,
        stdio: "ignore",
      });
      c.unref();
      return { ok: true, tool: "open" };
    }
    if (process.platform === "win32") {
      const c = spawn("cmd", ["/c", "start", "", u], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      c.unref();
      return { ok: true, tool: "start" };
    }
    const c = spawn("xdg-open", [u], {
      detached: true,
      stdio: "ignore",
    });
    c.unref();
    return { ok: true, tool: "xdg-open" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Project feedback / issues page. */
export const GITHUB_REPO_URL = "https://github.com/cool-ic/oh-my-session";
