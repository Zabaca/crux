import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { abandonments, problems, workstreams } from "@crux/core/db/schema";
import { NotFoundError } from "@crux/core/transitions";
import { eq, inArray } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";

async function resolveWorkstream(slug: string) {
  const rows = await getDb().select().from(workstreams).where(eq(workstreams.slug, slug)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`workstream not found: ${slug}`, { slug });
  return row;
}

const listCmd = defineCommand({
  meta: { name: "list", description: "List abandonments in a workstream." },
  args: {
    workstream: { type: "string", required: true, alias: "w" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const ws = await resolveWorkstream(args.workstream);
    const db = getDb();
    const wsProblems = await db
      .select({ id: problems.id })
      .from(problems)
      .where(eq(problems.workstreamId, ws.id));
    const problemIds = wsProblems.map((p) => p.id);
    if (problemIds.length === 0) {
      emit([]);
      return;
    }
    const rows = await db
      .select()
      .from(abandonments)
      .where(inArray(abandonments.problemId, problemIds));
    emit(rows);
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show an abandonment by id." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const rows = await getDb()
      .select()
      .from(abandonments)
      .where(eq(abandonments.id, args.id))
      .limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`abandonment not found: ${args.id}`, { id: args.id });
    emit(rows[0]!);
  },
});

export const abandonmentCommand = defineCommand({
  meta: {
    name: "abandonment",
    description: "Problem abandonments (created via `crux problem abandon`).",
  },
  subCommands: { list: listCmd, show: showCmd },
});
