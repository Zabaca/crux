#!/usr/bin/env bun
/**
 * Which agent profiles are running right now, and where each one's transcript is.
 *
 * Only sessions started under an agent profile are listed. Plain sessions are
 * the majority — 7 of them shared this repo's directory on the day this was
 * written against 3 with a profile — and none of them is what somebody asking
 * this question means.
 *
 * `ListAgents` names live sessions but reports neither the agent profile nor a
 * transcript path, so it cannot tell two sessions in one directory apart: they
 * are named after that directory, so every agent working one repo shares a
 * prefix. The registry under `~/.claude/sessions/` carries `agent` beside `cwd`
 * and `sessionId`, which resolves a profile to its transcript in one hop.
 *
 * The transcript path is derived (project dir = cwd with `/` → `-`) and then
 * *checked*, with a scan of `~/.claude/projects/` as the fallback: the slug rule
 * is an observation about paths seen here, not a documented contract, and a path
 * containing anything unusual would break it silently.
 *
 * Everything is JSON on stdout, like the sibling scanner in
 * `.claude/skills/observe-crux-cli-error/`.
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const PROJECTS_DIR = join(homedir(), ".claude", "projects");

type Registry = {
  agent?: string;
  name?: string;
  status?: string;
  kind?: string;
  cwd?: string;
  sessionId?: string;
  startedAt?: number;
  updatedAt?: number;
};

type Session = Registry & { transcript: string | null };

/** Args: `--all`, `--agent X`, `--read X`, `--tail N`. */
function parseArgs(argv: string[]) {
  const out: { all: boolean; agent?: string; read?: string; tail: number } = {
    all: false,
    tail: 30,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--agent") out.agent = argv[++i];
    else if (a === "--read") out.read = argv[++i];
    else if (a === "--tail") out.tail = Number(argv[++i]) || 30;
  }
  return out;
}

/**
 * Where a session's transcript lives.
 *
 * Derive first, then fall back to a scan. The derivation is the cheap path and
 * the scan is what makes a wrong derivation harmless rather than a silent null.
 */
function findTranscript(sessionId: string, cwd: string | undefined): string | null {
  if (cwd) {
    const derived = join(PROJECTS_DIR, cwd.replaceAll("/", "-"), `${sessionId}.jsonl`);
    if (existsSync(derived)) return derived;
  }
  try {
    for (const dir of readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const p = join(PROJECTS_DIR, dir.name, `${sessionId}.jsonl`);
      if (existsSync(p)) return p;
    }
  } catch {
    /* no projects dir — nothing to find */
  }
  return null;
}

function readRegistry(): Session[] {
  let files: string[];
  try {
    files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Session[] = [];
  for (const f of files) {
    let d: Registry;
    try {
      d = JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8"));
    } catch {
      continue;
    }
    // Only sessions started under an agent profile — but the whole registry
    // record for each. The narrowing is the filter, not the fields: what looks
    // like noise is the reach. `messagingSocketPath` is how you talk to a
    // session rather than only read it, and `pid`, `version` and `procStart`
    // are what tell a stale row from a live one.
    if (!d.sessionId || !d.agent) continue;
    out.push({ ...d, transcript: findTranscript(d.sessionId, d.cwd) });
  }
  return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** Text blocks from a transcript, oldest first. */
function readTurns(path: string, tail: number) {
  const turns: { role: string; ts: string | null; text: string }[] = [];
  let lines: string[];
  try {
    lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  } catch {
    return turns;
  }
  for (const line of lines) {
    let d: {
      type?: string;
      timestamp?: string;
      message?: { content?: unknown };
    };
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const content = d.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (
        b &&
        typeof b === "object" &&
        (b as { type?: string }).type === "text" &&
        typeof (b as { text?: string }).text === "string" &&
        (b as { text: string }).text.trim()
      ) {
        turns.push({
          role: d.type ?? "?",
          ts: d.timestamp ?? null,
          text: (b as { text: string }).text.trim(),
        });
      }
    }
  }
  return turns.slice(-tail);
}

const args = parseArgs(process.argv.slice(2));
const here = process.cwd();
let sessions = readRegistry();

if (!args.all) sessions = sessions.filter((s) => s.cwd === here);
if (args.agent) sessions = sessions.filter((s) => s.agent === args.agent);

if (args.read) {
  const key = args.read;
  const match =
    sessions.find((s) => s.name === key || s.sessionId === key || s.agent === key) ??
    readRegistry().find((s) => s.name === key || s.sessionId === key || s.agent === key);
  if (!match) {
    console.log(JSON.stringify({ error: "no session matched", query: key }, null, 2));
    process.exit(1);
  }
  if (!match.transcript) {
    console.log(JSON.stringify({ error: "no transcript on disk", session: match }, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify({ session: match, turns: readTurns(match.transcript, args.tail) }, null, 2),
  );
} else {
  console.log(
    JSON.stringify({ cwd: args.all ? null : here, count: sessions.length, sessions }, null, 2),
  );
}
