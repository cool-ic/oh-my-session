#!/usr/bin/env node
/**
 * Build a throwaway agent home for screenshots and demos.
 *
 * Writes the *real* on-disk layouts (Grok summary.json + updates.jsonl, Qoder
 * <id>-session.json + <id>.jsonl, Claude projects/<slug>/<id>.jsonl) so the TUI
 * discovers them through the normal code path — no special-casing in src/.
 *
 * Usage:
 *   node scripts/demo-fixture.mjs <store-root> [repos-root]
 *
 * `store-root`  where the fake .grok/.qoder/.claude homes go (wiped first).
 * `repos-root`  where the fake project dirs go; these must exist on disk or
 *               every row would show Missing. Defaults to <store-root>/home.
 *
 * Then:
 *   GROK_HOME=<store-root>/.grok QODER_CONFIG_DIR=... npm start
 *
 * Content is deliberately all-English and plausible: mixed agents, mixed ages,
 * plus one Empty and one Missing row so the health badges are visible.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "/tmp/oms-demo");
const reposRoot = path.resolve(process.argv[3] || path.join(root, "home"));
const HOUR = 3600e3;
const DAY = 24 * HOUR;
const now = Date.now();

/** Deterministic UUIDv4-shaped id from a seed. */
function uuid(seed) {
  let h = 2166136261 >>> 0;
  const hex = [];
  for (let i = 0; i < 16; i++) {
    for (let k = 0; k < seed.length; k++) {
      h ^= seed.charCodeAt(k) + i * 131;
      h = Math.imul(h, 16777619) >>> 0;
    }
    hex.push((h & 0xff).toString(16).padStart(2, "0"));
  }
  const s = hex.join("");
  return [
    s.slice(0, 8),
    s.slice(8, 12),
    "4" + s.slice(13, 16),
    "a" + s.slice(17, 20),
    s.slice(20, 32),
  ].join("-");
}

const iso = (ms) => new Date(ms).toISOString();
const w = (p, body) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

/**
 * Sessions. `repo` is a directory we actually create, unless `missing` is set —
 * then the path is recorded but never created, which is what drives Missing.
 */
const SESSIONS = [
  {
    agent: "claude",
    title: "Fix flaky auth test in CI",
    repo: "~/code/payments-api",
    ageMs: 2 * HOUR,
    tag: "payments",
    star: true,
    turns: [
      ["user", "The auth integration test passes locally but fails on CI about one run in three. Can you find the race?"],
      ["assistant", "The test seeds a user and immediately issues a token, but the seed helper commits asynchronously. On a cold CI database the token lookup can run before the commit lands.\n\nTwo options: await the seed transaction explicitly, or make the helper return only after commit. The second one fixes every other test that uses it too."],
      ["user", "Do the second one, and check whether other helpers have the same shape."],
      ["assistant", "Done — `seedUser`, `seedAccount` and `seedInvoice` all returned before commit. All three now await the transaction. I left `seedFixtureBundle` alone because it already awaits."],
      ["user", "Any other place we rely on that implicit ordering?"],
      ["assistant", "One: the nightly reconciliation job reads balances right after writing ledger rows. It has not failed because the write and read are in the same transaction, but it is the same pattern and worth a comment so nobody splits them later."],
      ["user", "Add the comment and run the suite twenty times to confirm the flake is gone."],
      ["assistant", "Twenty runs, no failures. Before the change I reproduced it in 6 of 20."],
    ],
  },
  {
    agent: "claude",
    title: "Migrate settings loader to zod",
    repo: "~/code/payments-api",
    ageMs: 20 * HOUR,
    tag: "payments",
    turns: [
      ["user", "Replace the hand-rolled config validation with zod, but keep the error messages readable for operators."],
      ["assistant", "Schema is in place. I kept a custom `errorMap` so a bad `PORT` still reports `PORT must be an integer between 1 and 65535` instead of zod's default wording."],
      ["user", "What happens to unknown keys? Operators paste whole blocks from the wiki."],
      ["assistant", "Currently they are stripped silently. I would rather warn than drop, so unknown keys log once at startup with the key name and are then ignored."],
      ["user", "Do that. Silent stripping is how people lose an afternoon."],
      ["assistant", "Added. It logs `ignoring unknown config key: RETRY_BACKOFF_MS` once per key at boot."],
    ],
  },
  {
    agent: "qoder",
    title: "Design the retention warning UX",
    repo: "~/code/oh-my-session",
    ageMs: 3 * DAY,
    tag: "oh-my-session",
    star: true,
    turns: [
      ["user", "Agents delete old sessions on a timer. I want to warn the user and offer to fix it, but never change their config behind their back."],
      ["assistant", "Then the audit and the write have to be separate. Startup does a read-only check and shows one line in the footer. The write only happens from `:retention`, which shows the exact key, the value and the file path, then waits for `y`.\n\nBefore writing it copies the file to `settings.json.bak`, merges into the existing JSON so unrelated keys survive, and refuses outright if the file is not valid JSON."],
      ["user", "What if the agent is not installed at all?"],
      ["assistant", "Then there is no home directory and we report nothing — no warning for an agent you do not use."],
      ["user", "And if their settings.json is hand-edited and broken?"],
      ["assistant", "We refuse to write and say so, rather than replacing it with our own version. Overwriting a file someone is mid-edit on would be worse than the problem we are solving."],
      ["user", "Good. What does the footer line say when there is nothing wrong?"],
      ["assistant", "Nothing — it falls back to the normal key hints. A warning that is always on stops being a warning."],
    ],
  },
  {
    agent: "qoder",
    title: "Differential paint regression on Esc",
    repo: "~/code/oh-my-session",
    ageMs: 5 * DAY,
    tag: "oh-my-session",
    turns: [
      ["user", "Leaving the chat view flashes the whole screen. It used to be instant."],
      ["assistant", "Something reintroduced a full-frame erase on the way out. The renderer is supposed to diff cells and repaint only what changed — a clear plus full redraw is what causes the flash. Restoring the diff path brings Esc back under about 25ms."],
      ["user", "Where did the erase come from? It was not there last month."],
      ["assistant", "A refactor moved the chat teardown to reuse the initial mount path, which legitimately clears on first paint. Reusing it on exit brought the clear along."],
      ["user", "Split them so the mount path cannot be called on teardown again."],
      ["assistant", "Split. Teardown now only recomputes the session list region, and I left a comment pointing at the constraint that forbids full-frame erase."],
    ],
  },
  {
    agent: "grok",
    title: "Explain the vector index rebuild",
    repo: "~/code/search-service",
    ageMs: 6 * DAY,
    tag: "search",
    turns: [
      ["user", "Walk me through what the nightly index rebuild actually does, I inherited this service."],
      ["assistant", "It snapshots the document table, recomputes embeddings for anything whose `content_hash` changed, writes a new index segment, then atomically swaps a symlink. Readers never see a partial index because the swap is the only mutating step."],
      ["user", "What happens if it crashes halfway?"],
      ["assistant", "The partial segment is orphaned and the symlink still points at the previous index, so reads are unaffected. Nothing cleans the orphan up though, which is why the disk grows."],
      ["user", "So the disk usage alerts we keep getting are just failed rebuilds piling up?"],
      ["assistant", "That matches the pattern \u2014 the alerts cluster a day or two after a failed nightly run."],
    ],
  },
  {
    agent: "grok",
    title: "Reduce cold start on the worker image",
    repo: "~/code/search-service",
    ageMs: 9 * DAY,
    tag: "search",
    turns: [
      ["user", "Cold starts are around nine seconds. Where is the time going?"],
      ["assistant", "Most of it is importing the model runtime at module scope. Moving it behind the first request drops cold start to about 1.4s and adds roughly 300ms to the first call only."],
      ["user", "Is the first-call penalty acceptable, or should we warm it?"],
      ["assistant", "For a queue worker it is fine, since the first message is not latency sensitive. If you put this behind a synchronous API, warm it on boot instead."],
    ],
  },
  {
    agent: "claude",
    title: "Draft the pricing page copy",
    repo: "~/code/marketing-site",
    ageMs: 12 * DAY,
    tag: "marketing",
    turns: [
      ["user", "Three tiers, and I do not want the middle one to feel like a trap."],
      ["assistant", "Then name the tiers after the work, not the size, and put the limit that actually bites at the top of each card rather than buried in a footnote."],
      ["user", "Give me a first pass at the three headings."],
      ["assistant", "\"Solo\" for one person shipping side projects, \"Team\" for a shared codebase and review, \"Org\" for audit and SSO requirements. Each card leads with the one limit people actually hit."],
    ],
  },
  {
    agent: "qoder",
    title: "Port CSV stores to a shared data dir",
    repo: "~/code/oh-my-session",
    ageMs: 14 * DAY,
    tag: "oh-my-session",
    turns: [
      ["user", "Three modules each resolve the repo root separately. Collapse that."],
      ["assistant", "Moved it into `lib/paths.ts` as `dataDir()`, honoring `OMS_DATA_DIR`. Screenshot fixtures can now point somewhere else instead of overwriting your real titles and stars."],
      ["user", "Does that change where existing users' files live?"],
      ["assistant", "No \u2014 the default resolves to the same `<repo>/data` path as before. The env var only matters if you set it."],
    ],
  },
  {
    agent: "claude",
    title: "Why does the webhook retry twice",
    repo: "~/code/payments-api",
    ageMs: 18 * DAY,
    tag: "payments",
    turns: [
      ["user", "Stripe shows two deliveries for one event and we process both."],
      ["assistant", "The handler returns 200 after enqueueing but before the idempotency key is persisted, so a fast retry finds no key. Persisting the key inside the same transaction as the enqueue removes the window."],
      ["user", "Is there a window where we lose the event instead?"],
      ["assistant", "Not with this ordering. If the transaction fails, nothing is enqueued and no key is stored, so the retry is a clean first attempt."],
      ["user", "Ship it, and add a test that replays the same event id twice."],
      ["assistant", "Test added \u2014 it asserts the second delivery is a no-op and the side effect ran exactly once."],
    ],
  },
  {
    agent: "grok",
    title: "Tune the ranking weights",
    repo: "~/code/search-service",
    ageMs: 23 * DAY,
    tag: "search",
    turns: [
      ["user", "Recency is dominating relevance for older but better documents."],
      ["assistant", "The recency term is linear in days, so it keeps growing without bound. Switching to a decay with a half-life of about two weeks keeps fresh results on top without burying a strong older match."],
      ["user", "What half-life did you settle on, and how did you pick it?"],
      ["assistant", "Fourteen days. I swept 3 to 60 against the click log; below a week fresh-but-thin pages win, above a month recency stops mattering at all."],
    ],
  },
  {
    agent: "claude",
    title: "Audit the S3 bucket policies",
    repo: "~/code/infra",
    ageMs: 27 * DAY,
    tag: "infra",
    turns: [
      ["user", "Which of our buckets are effectively public?"],
      ["assistant", "Two. One is intentional — it serves the docs site. The other has a wildcard principal on `s3:GetObject` that looks accidental, since it holds export archives."],
      ["user", "Can you tell whether anything actually read from the second one?"],
      ["assistant", "Access logging was off for that bucket, so no. I would enable logging before changing the policy, so you can see what breaks."],
    ],
  },
  {
    agent: "qoder",
    title: "Sketch the plugin API",
    repo: "~/code/oh-my-session",
    ageMs: 31 * DAY,
    tag: "oh-my-session",
    turns: [
      ["user", "If someone wants to add Codex discovery without touching core, what is the smallest surface?"],
      ["assistant", "One function returning `SessionRecord[]` plus a resume hint. Everything else — health, tags, deletion — already works off that shape."],
    ],
  },
  // Missing: repo path is recorded but never created on disk.
  {
    agent: "grok",
    title: "Spike: replace the queue with NATS",
    repo: "~/code/scratch-queue-spike",
    ageMs: 41 * DAY,
    missing: true,
    turns: [
      ["user", "Rough out what moving off the current queue would cost us."],
      ["assistant", "The consumer side is a small change. The expensive part is that three services depend on the queue's at-least-once redelivery timing, and NATS would need explicit ack handling to match it."],
    ],
  },
  // Empty: zero messages.
  {
    agent: "claude",
    title: "New Session",
    repo: "~/code/marketing-site",
    ageMs: 44 * DAY,
    turns: [],
  },
];

fs.rmSync(root, { recursive: true, force: true });
// `repo` values are written as `~/code/<name>`; only the bare name is joined
// onto reposRoot, so the caller fully controls the visible path prefix.
const homeFor = (p) => path.join(reposRoot, path.basename(p));

const titles = ["source,id,title,updated_at"];
const stars = ["source,id,starred_at"];
const tags = ["source,id,tag,updated_at"];

for (const s of SESSIONS) {
  const id = uuid(s.agent + s.title);
  const at = now - s.ageMs;
  const repo = homeFor(s.repo);
  if (!s.missing) fs.mkdirSync(repo, { recursive: true });

  // Claude counts user+assistant lines in the transcript, while Grok and Qoder
  // read a metadata field. Declare the real turn count so every row agrees.
  const msgs = s.turns.length;

  // chronological turns, oldest first, one minute apart
  const stamped = s.turns.map((t, i) => ({
    role: t[0],
    text: t[1],
    at: at - (s.turns.length - 1 - i) * 60e3,
  }));

  if (s.agent === "grok") {
    const dir = path.join(
      root,
      ".grok/sessions",
      repo.replace(/\//g, "-").replace(/^-/, ""),
      id,
    );
    w(
      path.join(dir, "summary.json"),
      JSON.stringify(
        {
          info: { id, cwd: repo },
          generated_title: s.title,
          created_at: iso(at - 3 * HOUR),
          last_active_at: iso(at),
          num_messages: msgs,
          current_model_id: "grok-4",
        },
        null,
        2,
      ),
    );
    w(
      path.join(dir, "updates.jsonl"),
      jsonl(
        stamped.map((t) => ({
          timestamp: Math.floor(t.at / 1000),
          params: {
            update: {
              sessionUpdate:
                t.role === "user" ? "user_message_chunk" : "agent_message_chunk",
              content: { type: "text", text: t.text },
            },
          },
        })),
      ),
    );
  } else if (s.agent === "qoder") {
    const slug = repo.replace(/\//g, "-").replace(/^-/, "");
    const dir = path.join(root, ".qoder/projects", slug);
    w(
      path.join(dir, `${id}-session.json`),
      JSON.stringify(
        {
          id,
          title: s.title,
          message_count: msgs,
          created_at: iso(at - 3 * HOUR),
          updated_at: iso(at),
          working_dir: repo,
        },
        null,
        2,
      ),
    );
    w(
      path.join(dir, `${id}.jsonl`),
      jsonl(
        stamped.map((t) => ({
          type: t.role,
          cwd: repo,
          timestamp: iso(t.at),
          message: { role: t.role, content: [{ type: "text", text: t.text }] },
        })),
      ),
    );
  } else {
    const slug = repo.replace(/\//g, "-");
    const dir = path.join(root, ".claude/projects", slug);
    const rows = stamped.map((t) => ({
      type: t.role,
      cwd: repo,
      gitBranch: "main",
      timestamp: iso(t.at),
      message: { role: t.role, content: [{ type: "text", text: t.text }] },
    }));
    rows.unshift({
      type: "custom-title",
      customTitle: s.title,
      cwd: repo,
      // An empty session has no message timestamps, so carry one here —
      // otherwise AGE falls back to file mtime and reads as "0s".
      timestamp: iso(at),
    });
    w(path.join(dir, `${id}.jsonl`), jsonl(rows));
  }

  const ts = iso(at);
  titles.push(`${s.agent},${id},"${s.title.replace(/"/g, '""')}",${ts}`);
  if (s.star) stars.push(`${s.agent},${id},${ts}`);
  if (s.tag) tags.push(`${s.agent},${id},${s.tag},${ts}`);
}

const data = path.join(root, "data");
w(path.join(data, "session-titles.csv"), titles.join("\n") + "\n");
w(path.join(data, "session-stars.csv"), stars.join("\n") + "\n");
w(path.join(data, "session-tags.csv"), tags.join("\n") + "\n");
// Screenshots / demos: skip first-run language popup (English chrome).
w(path.join(data, "ui-locale"), "en\n");

// Agent settings in their default (cleanup-enabled) state, with unrelated keys
// present, so the retention popup has something real to report and to preserve.
w(
  path.join(root, ".qoder/settings.json"),
  JSON.stringify({ general: { statusBar: { enabled: true } } }, null, 2) + "\n",
);
w(
  path.join(root, ".claude/settings.json"),
  JSON.stringify({ theme: "dark", cleanupPeriodDays: 30 }, null, 2) + "\n",
);
// Grok: omit cleanup_ttl_days → default 30-day mtime TTL (at risk).
w(
  path.join(root, ".grok/config.toml"),
  [
    "[cli]",
    'installer = "internal"',
    "",
    "[ui]",
    'theme = "auto"',
    "",
  ].join("\n") + "\n",
);

console.log(`demo fixture: ${root}  (${SESSIONS.length} sessions)`);
