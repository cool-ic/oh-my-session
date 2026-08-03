#!/usr/bin/env node
import { discoverAll } from "./discover/index.js";
import type { AgentSource } from "./types.js";
import { ALL_SOURCES } from "./types.js";
import { enrichSessions } from "./lib/health.js";
import { applyTitleOverrides } from "./lib/title-store.js";
import { applyStarFlags } from "./lib/star-store.js";
import { applyTags } from "./lib/tag-store.js";
import { formatTable } from "./lib/format.js";
import { retentionRisks } from "./lib/retention.js";
import { runRawTui } from "./tui/rawApp.js";

function loadSessions(opts: {
  sources?: import("./types.js").AgentSource[];
  cwdFilter?: string | null;
  limit?: number;
}) {
  let sessions = applyTags(
    applyStarFlags(
      applyTitleOverrides(
        enrichSessions(
          discoverAll({
            sources: opts.sources,
            cwdFilter: opts.cwdFilter ?? null,
          }),
        ),
      ),
    ),
  );
  if (opts.limit != null && Number.isFinite(opts.limit) && opts.limit >= 0) {
    sessions = sessions.slice(0, opts.limit);
  }
  return sessions;
}

function printHelp(): void {
  console.log(`oh-my-sessions

  npm start              Interactive TUI (main entry)
  npx oh-my-sessions     After npm link / global install (alias: oms)

Notes:
  RESUME DIR = project path when the session was started (kept even if deleted)
  Qoder      = must resume under that dir → command includes cd …
  Grok       = UUID works from any cwd → grok --resume <id>
  Claude     = UUID works from any cwd → claude --resume <id>  (-c is cwd-scoped)
  OK/Empty/Missing = has messages / 0 msgs / resume path gone on disk

Keys: ↑↓ Space · * star · i rename · dd · :empty/:bad · / search · y copy · :q/:wq
      :retention  check & disable agent session auto-deletion (asks first)
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

/** stderr, so --list / --json stdout stays pipe-safe */
function warnRetention(): void {
  const risks = retentionRisks();
  if (risks.length === 0) return;
  for (const r of risks) {
    console.error(`⚠ ${r.notice}`);
    console.error(`  Suggested config: ${r.fixHint}  (${r.settingsPath})`);
  }
  console.error("  Run the TUI and type :retention to apply it (asks first).");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const sessions = loadSessions({
    sources: args.sources,
    cwdFilter: args.cwdFilter,
    limit: args.limit,
  });

  if (args.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (args.list) {
    console.log(formatTable(sessions));
    warnRetention();
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("TTY required. Falling back to --list:");
    console.log(formatTable(sessions));
    warnRetention();
    return;
  }

  // Raw differential TUI — NOT Ink (full-frame erase causes flicker)
  // reload every 8s; CSV title overrides re-applied each pass
  await runRawTui(sessions, {
    reload: () =>
      loadSessions({
        sources: args.sources,
        cwdFilter: args.cwdFilter,
        limit: args.limit,
      }),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
