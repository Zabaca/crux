import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { userConfig } from "@crux/core";
const { resolveCruxHome } = userConfig;

function resolveInboxPath(): string | null {
  if (process.env.CRUX_AGENT_INBOX) return process.env.CRUX_AGENT_INBOX;
  try {
    const runtime = JSON.parse(readFileSync(join(resolveCruxHome(), "runtime.json"), "utf8"));
    if (runtime.inboxPath) return runtime.inboxPath.replace(/^~/, homedir());
  } catch {
    // runtime.json absent or malformed — fall through
  }
  return join(homedir(), ".claude/teams/crux/inboxes/team-lead.json");
}

export async function POST() {
  const inboxPath = resolveInboxPath();
  if (!inboxPath) {
    return Response.json({ error: "No inbox configured" }, { status: 503 });
  }

  try {
    mkdirSync(dirname(inboxPath), { recursive: true });

    let entries: unknown[] = [];
    try {
      entries = JSON.parse(readFileSync(inboxPath, "utf8"));
    } catch {
      // file doesn't exist yet or is empty — start fresh
    }

    entries.push({
      from: "crux-web",
      text: "view-state-update",
      summary: "User requested agent attention on current view",
      timestamp: new Date().toISOString(),
      read: false,
    });

    writeFileSync(inboxPath, JSON.stringify(entries, null, 2));
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
