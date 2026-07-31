#!/usr/bin/env node
import { discoverAll } from "./discover/index.js";
import type { AgentSource } from "./types.js";
import { ALL_SOURCES } from "./types.js";
import { enrichSessions } from "./lib/health.js";
import { formatTable } from "./lib/format.js";
import { runRawTui } from "./tui/rawApp.js";

function printHelp(): void {
  console.log(`agent-session-history

  npm start              Interactive TUI (main entry)

Notes:
  RESUME DIR = project path when the session was started (kept even if deleted)
  Qoder      = must resume under that dir → command includes cd …
  Grok       = UUID works from any cwd → grok --resume <id>
  Claude     = UUID works from any cwd → claude --resume <id>  (-c is cwd-scoped)
  OK/Empty/Missing = has messages / 0 msgs / resume path gone on disk

Keys: ↑↓ Space · :empty/:missing/:bad · dd · :q/:wq · / search · y yank
`);
}

function parseArgs(argv: string[]): {
  list: boolean;
  json: boolean;
  help: boolean;
  sources?: AgentSource[];
  cwdFilter?: string;
  limit?: number;
} {
  const out: ReturnType<typeof parseArgs> = {
    list: false,
    json: false,
    help: false,
  };
  const sources: AgentSource[] = [];
  const allowed = new Set(ALL_SOURCES);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--list" || a === "-l") out.list = true;
    else if (a === "--json" || a === "-j") out.json = true;
    else if (a === "--source" || a === "-s") {
      const v = argv[++i] || "";
      for (const part of v.split(",")) {
        const p = part.trim().toLowerCase() as AgentSource;
        if (allowed.has(p)) sources.push(p);
      }
    } else if (a.startsWith("--source=")) {
      const v = a.slice("--source=".length);
      for (const part of v.split(",")) {
        const p = part.trim().toLowerCase() as AgentSource;
        if (allowed.has(p)) sources.push(p);
      }
    } else if (a === "--cwd") {
      out.cwdFilter = argv[++i];
    } else if (a.startsWith("--cwd=")) {
      out.cwdFilter = a.slice("--cwd=".length);
    } else if (a === "--limit") {
      out.limit = Number(argv[++i]);
    } else if (a.startsWith("--limit=")) {
      out.limit = Number(a.slice("--limit=".length));
    }
  }
  if (sources.length) out.sources = sources;
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  let sessions = enrichSessions(
    discoverAll({
      sources: args.sources,
      cwdFilter: args.cwdFilter ?? null,
    }),
  );
  if (args.limit != null && Number.isFinite(args.limit) && args.limit >= 0) {
    sessions = sessions.slice(0, args.limit);
  }

  if (args.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (args.list) {
    console.log(formatTable(sessions));
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("TTY required. Falling back to --list:");
    console.log(formatTable(sessions));
    return;
  }

  // Raw differential TUI — NOT Ink (full-frame erase causes flicker)
  // reload every 8s so new/updated agent sessions appear without restart
  await runRawTui(sessions, {
    reload: () => {
      let next = enrichSessions(
        discoverAll({
          sources: args.sources,
          cwdFilter: args.cwdFilter ?? null,
        }),
      );
      if (args.limit != null && Number.isFinite(args.limit) && args.limit >= 0) {
        next = next.slice(0, args.limit);
      }
      return next;
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
