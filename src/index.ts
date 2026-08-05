#!/usr/bin/env node
import { discoverAll } from "./discover/index.js";
import type { AgentSource } from "./types.js";
import { ALL_SOURCES } from "./types.js";
import { enrichSessions } from "./lib/health.js";
import { applyTitleOverrides } from "./lib/title-store.js";
import { applyStarFlags } from "./lib/star-store.js";
import { applyTags } from "./lib/tag-store.js";
import { formatTable } from "./lib/format.js";
import { auditRetention } from "./lib/retention.js";
import { pendingRetentionRisks } from "./lib/retention-prefs.js";
import { runRawTui } from "./tui/rawApp.js";
import {
  packageName,
  packageVersion,
  upgradeCommand,
} from "./lib/pkg-meta.js";
import {
  checkForUpdate,
  formatUpdateNotice,
  readCachedUpdate,
  scheduleUpdateCheck,
} from "./lib/update-check.js";
import {
  completionScript,
  parseShellKind,
  type ShellKind,
} from "./lib/completion.js";

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
  const name = packageName();
  const ver = packageVersion();
  console.log(`${name} ${ver}

  npm install -g ${name}
  oms                    Interactive TUI

Commands:
  oms version            Print version (+ check npm for updates)
  oms upgrade            Print upgrade instructions
  oms completion <shell> Print shell completion (bash|zsh|fish)

Flags:
  -h, --help             This help
  -V, --version          Same as version (no network if cache fresh)
  -l, --list             Plain table on stdout
  -j, --json             JSON array on stdout
  -s, --source <list>    Filter: grok,qoder,claude
      --cwd <path>       Filter by resume directory
      --limit <n>        Max sessions

Notes:
  RESUME DIR = project path when the session was started (kept even if deleted)
  Qoder      = must resume under that dir → command includes cd …
  Grok       = UUID works from any cwd → grok --resume <id>
  Claude     = resume by ID from its project dir → command includes cd … when known
  OK/Empty/Missing = has messages / 0 msgs / resume path gone on disk

  Update checks hit the public npm registry (cached 24h).
  Disable: OMS_NO_UPDATE=1  or  NO_UPDATE_NOTIFIER=1

Keys: ↑↓ Space · * star · i rename · dd · :empty/:bad · / search · yy copy · :q/:wq
      :retention  check & disable agent session auto-deletion (asks first)

Shell completion:
  eval "$(oms completion bash)"
  oms completion zsh > ~/.zfunc/_oms
  oms completion fish > ~/.config/fish/completions/oms.fish
`);
}

function printUpgradeGuide(info?: {
  current: string;
  latest?: string;
  updateAvailable?: boolean;
}): void {
  const name = packageName();
  const current = info?.current ?? packageVersion();
  console.log(`${name} ${current}`);
  if (info?.updateAvailable && info.latest) {
    console.log(`Update available: ${current} → ${info.latest}`);
  } else if (info && !info.updateAvailable && info.latest) {
    console.log(`You are on the latest version (${current}).`);
  } else {
    console.log("Upgrade anytime with:");
  }
  console.log();
  console.log(`  ${upgradeCommand()}`);
  console.log();
  console.log("Then re-open your terminal (or hash -r) so PATH picks up the new bin.");
  console.log("Disable update checks: OMS_NO_UPDATE=1");
}

async function printVersion(opts: { forceCheck: boolean }): Promise<void> {
  const name = packageName();
  const current = packageVersion();
  console.log(`${name} ${current}`);

  const info = await checkForUpdate({ force: opts.forceCheck });
  if (!info) {
    console.log(`Upgrade: ${upgradeCommand()}`);
    console.log("(update check skipped or offline)");
    return;
  }
  if (info.updateAvailable) {
    console.log(`Update available: ${current} → ${info.latest}`);
    console.log(`Run: ${info.upgradeCmd}`);
  } else {
    console.log("Up to date.");
  }
}

function printCompletion(shell: ShellKind | null, arg: string | undefined): void {
  if (!shell) {
    console.error(
      `Unknown or missing shell for completion${arg ? `: ${arg}` : ""}.`,
    );
    console.error("Usage: oms completion <bash|zsh|fish>");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(completionScript(shell));
}

/** stderr only — never pollute --json / pipes. */
function warnCachedUpdate(): void {
  const info = readCachedUpdate();
  if (!info?.updateAvailable) return;
  console.error(`⚠ ${formatUpdateNotice(info)}`);
}

function parseArgs(argv: string[]): {
  list: boolean;
  json: boolean;
  help: boolean;
  version: boolean;
  upgrade: boolean;
  completion: boolean;
  completionShell?: string;
  /** force network on version command */
  versionForce: boolean;
  sources?: AgentSource[];
  cwdFilter?: string;
  limit?: number;
} {
  const out: ReturnType<typeof parseArgs> = {
    list: false,
    json: false,
    help: false,
    version: false,
    upgrade: false,
    completion: false,
    versionForce: false,
  };
  const sources: AgentSource[] = [];
  const allowed = new Set(ALL_SOURCES);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--version" || a === "-V") {
      out.version = true;
    } else if (a === "version") {
      out.version = true;
      out.versionForce = true;
    } else if (a === "upgrade") {
      out.upgrade = true;
    } else if (a === "completion") {
      out.completion = true;
      out.completionShell = argv[++i];
    } else if (a === "--list" || a === "-l") out.list = true;
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

/** stderr, so --list / --json stdout stays pipe-safe.
 * Only warn about open (non-ignored) risks — acknowledged agents stay quiet. */
function warnRetention(): void {
  const pending = pendingRetentionRisks(auditRetention());
  if (pending.length === 0) return;
  for (const r of pending) {
    console.error(`⚠ ${r.notice}`);
    console.error(`  Suggested config: ${r.fixHint}  (${r.settingsPath})`);
  }
  console.error(
    "  Run the TUI for the retention popup (y = fix config · i = acknowledge).",
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.completion) {
    printCompletion(parseShellKind(args.completionShell), args.completionShell);
    return;
  }

  if (args.upgrade) {
    const info = await checkForUpdate({ force: true });
    printUpgradeGuide(
      info
        ? {
            current: info.current,
            latest: info.latest,
            updateAvailable: info.updateAvailable,
          }
        : { current: packageVersion() },
    );
    return;
  }

  if (args.version) {
    // -V / --version: prefer cache (fast); `version` subcommand forces check
    await printVersion({ forceCheck: args.versionForce });
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
    warnCachedUpdate();
    // Refresh cache for next run (non-blocking)
    scheduleUpdateCheck();
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("TTY required. Falling back to --list:");
    console.log(formatTable(sessions));
    warnRetention();
    warnCachedUpdate();
    scheduleUpdateCheck();
    return;
  }

  // Raw differential TUI — NOT Ink (full-frame erase causes flicker)
  // reload every 8s; CSV title overrides re-applied each pass
  // (update check runs inside TUI → status line)
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
