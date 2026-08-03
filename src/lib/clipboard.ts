import { spawnSync } from "node:child_process";

export interface ClipboardResult {
  ok: boolean;
  tool?: string;
  error?: string;
}

function tryCopy(tool: string, args: string[], text: string): ClipboardResult {
  const r = spawnSync(tool, args, {
    input: text,
    encoding: "utf8",
    stdio: ["pipe", "ignore", "pipe"],
    timeout: 1000,
  });
  if (r.error) return { ok: false, tool, error: r.error.message };
  if (r.status === 0) return { ok: true, tool };
  return {
    ok: false,
    tool,
    error: typeof r.stderr === "string" && r.stderr.trim() ? r.stderr.trim() : `exit ${r.status}`,
  };
}

export function copyToClipboard(text: string): ClipboardResult {
  const candidates: [string, string[]][] =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "win32"
        ? [["clip.exe", []]]
        : [
            ["wl-copy", []],
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--input"]],
          ];

  let last: ClipboardResult = { ok: false, error: "no clipboard command tried" };
  for (const [tool, args] of candidates) {
    last = tryCopy(tool, args, text);
    if (last.ok) return last;
  }
  return last;
}
