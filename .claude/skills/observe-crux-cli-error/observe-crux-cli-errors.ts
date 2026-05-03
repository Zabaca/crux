#!/usr/bin/env bun
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const STATE_DIR = join(homedir(), ".claude", ".crux", "observe-reports");
const LAST_RAN_FILE = join(STATE_DIR, "last-ran");
const PROJECTS_DIR = join(homedir(), ".claude", "projects");

mkdirSync(STATE_DIR, { recursive: true });

const lastRan = (() => {
  try {
    const s = readFileSync(LAST_RAN_FILE, "utf8").trim();
    return s ? new Date(s) : new Date(0);
  } catch {
    return new Date(0);
  }
})();

function globJsonl(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) results.push(...globJsonl(full));
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) results.push(full);
    }
  } catch {}
  return results;
}

interface Instance {
  ts: string;
  cmd: string;
  code: string;
  message: string;
}

const instances: Instance[] = [];
const byCode: Map<string, { count: number; examples: { cmd: string; msg: string }[] }> = new Map();
let sessionsScanned = 0;

const files = globJsonl(PROJECTS_DIR);

for (const file of files) {
  let lines: string[];
  try {
    lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    continue;
  }

  // Build map: tool_use_id → bash command (only crux commands)
  const cmdMap = new Map<string, string>();
  for (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const msg = entry?.message;
    if (!msg) continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block.type === "tool_use" && block.name === "Bash") {
        const cmd: string = block.input?.command ?? "";
        if (cmd.includes("crux")) {
          cmdMap.set(block.id, cmd);
        }
      }
    }
  }

  if (cmdMap.size === 0) continue;
  sessionsScanned++;

  for (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = entry?.timestamp ? new Date(entry.timestamp) : null;
    if (!ts || ts <= lastRan) continue;

    const msg = entry?.message;
    if (!msg) continue;
    const content = Array.isArray(msg.content) ? msg.content : [];

    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const id: string = block.tool_use_id ?? "";
      if (!cmdMap.has(id)) continue;

      const output: string =
        typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((c: any) => c.text ?? "").join("")
            : "";

      const cmd = cmdMap.get(id)!;
      let code: string | null = null;
      let message: string | null = null;

      // Form 1: JSON error — {"code":"...","message":"..."} emitted to stderr by emitError()
      const jsonMatch =
        output.match(/\{\s*"code"\s*:\s*"([^"]+)"[^}]*"message"\s*:\s*"((?:[^"\\]|\\.)*)"/s) ??
        output.match(/\{\s*"message"\s*:\s*"((?:[^"\\]|\\.)*)"[^}]*"code"\s*:\s*"([^"]+)"/s);
      if (jsonMatch) {
        // Match group order depends on which pattern matched
        const hasCodeFirst = output.indexOf('"code"') < output.indexOf('"message"');
        code = hasCodeFirst ? jsonMatch[1] : jsonMatch[2];
        message = hasCodeFirst ? jsonMatch[2] : jsonMatch[1];
      }

      // Form 2: plain-text [CODE] message — non-JSON mode or transition errors
      if (!code) {
        const bracketMatch = output.match(/^\[([A-Z_]+)\] (.+)/m);
        if (bracketMatch) {
          code = bracketMatch[1];
          message = bracketMatch[2].trim();
        }
      }

      // Form 3: "error: ..." lines from citty/bun (missing args, unknown flags)
      if (!code) {
        const errorLine = output.match(/^error: (.+)/m);
        if (errorLine && !errorLine[1].startsWith('script "')) {
          code = "CLI_ERROR";
          message = errorLine[1].trim();
        }
      }

      if (!code || !message) continue;

      instances.push({ ts: ts.toISOString(), cmd, code, message });

      const existing = byCode.get(code);
      if (existing) {
        existing.count++;
        if (existing.examples.length < 2) existing.examples.push({ cmd, msg: message });
      } else {
        byCode.set(code, { count: 1, examples: [{ cmd, msg: message }] });
      }
    }
  }
}

const ranAt = new Date().toISOString();

const report = {
  ran_at: ranAt,
  since: lastRan.toISOString(),
  sessions_scanned: sessionsScanned,
  total_errors: instances.length,
  by_code: Object.fromEntries(
    [...byCode.entries()].map(([code, v]) => [code, { count: v.count, examples: v.examples }]),
  ),
  instances,
};

const reportFile = join(STATE_DIR, `${ranAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(reportFile, JSON.stringify(report, null, 2));
writeFileSync(LAST_RAN_FILE, ranAt);

console.log(JSON.stringify({ ...report, report_file: reportFile }));
