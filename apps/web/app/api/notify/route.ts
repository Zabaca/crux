import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";

function resolveInboxPath(): string | null {
  if (process.env.CRUX_AGENT_INBOX) return process.env.CRUX_AGENT_INBOX;
  const defaultPath = join(homedir(), ".claude/teams/crux-mvp/inboxes/team-lead.json");
  return defaultPath;
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
