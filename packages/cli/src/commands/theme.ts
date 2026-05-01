import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { solutions, themes, themeSolutions, workstreams } from "@crux/core/db/schema";
import {
  ThemeAttachInput,
  ThemeInput,
  OkWithIdOutput,
  RenameOutput,
  ThemeAttachOutput,
} from "@crux/core/validation";
import { NotFoundError, renameTheme } from "@crux/core/transitions";
import { eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { guardAction, recordMutation } from "../collab.js";

async function resolveWorkstream(slug: string) {
  const rows = await getDb().select().from(workstreams).where(eq(workstreams.slug, slug)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`workstream not found: ${slug}`, { slug });
  return row;
}

const addCmd = defineCommand({
  meta: { name: "add", description: "Create a theme." },
  args: {
    workstream: { type: "string", required: true, alias: "w" },
    slug: { type: "string", required: true },
    title: { type: "string", required: true },
    description: { type: "string" },
    timeframe: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    guardAction("ADD_THEME");
    const parsed = ThemeInput.parse({
      workstream: args.workstream,
      slug: args.slug,
      title: args.title,
      description: args.description,
      timeframe: args.timeframe,
    });
    const ws = await resolveWorkstream(parsed.workstream);
    const id = `THM-${parsed.slug}`;
    await getDb().insert(themes).values({
      id,
      slug: parsed.slug,
      workstreamId: ws.id,
      title: parsed.title,
      description: parsed.description,
      timeframe: parsed.timeframe,
    });
    recordMutation("ADD_THEME");
    emit({ ok: true, id }, OkWithIdOutput, `added ${id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List themes in a workstream." },
  args: {
    workstream: { type: "string", required: true, alias: "w" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const ws = await resolveWorkstream(args.workstream);
    emit(await getDb().select().from(themes).where(eq(themes.workstreamId, ws.id)));
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show a theme by slug with attached solutions." },
  args: { slug: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const db = getDb();
    const rows = await db.select().from(themes).where(eq(themes.slug, args.slug)).limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`theme not found: ${args.slug}`, { slug: args.slug });
    const attached = await db
      .select({ solutionId: themeSolutions.solutionId })
      .from(themeSolutions)
      .where(eq(themeSolutions.themeId, rows[0]!.id));
    emit({ ...rows[0]!, solutionIds: attached.map((a) => a.solutionId) });
  },
});

const attachCmd = defineCommand({
  meta: { name: "attach", description: "Attach a Solution to a theme." },
  args: {
    slug: { type: "positional", required: true, description: "theme slug" },
    solution: { type: "string", required: true, description: "solution slug" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    guardAction("ATTACH_THEME");
    const parsed = ThemeAttachInput.parse({ themeSlug: args.slug, solutionSlug: args.solution });
    const db = getDb();
    const theme = await db.select().from(themes).where(eq(themes.slug, parsed.themeSlug)).limit(1);
    if (theme.length === 0)
      throw new NotFoundError(`theme not found: ${parsed.themeSlug}`, { slug: parsed.themeSlug });
    const sol = await db
      .select()
      .from(solutions)
      .where(eq(solutions.slug, parsed.solutionSlug))
      .limit(1);
    if (sol.length === 0)
      throw new NotFoundError(`solution not found: ${parsed.solutionSlug}`, {
        slug: parsed.solutionSlug,
      });
    await db
      .insert(themeSolutions)
      .values({ themeId: theme[0]!.id, solutionId: sol[0]!.id })
      .onConflictDoNothing();
    recordMutation("ATTACH_THEME");
    emit(
      { ok: true, themeId: theme[0]!.id, solutionId: sol[0]!.id },
      ThemeAttachOutput,
      `attached ${sol[0]!.id} → ${theme[0]!.id}`,
    );
  },
});

const renameCmd = defineCommand({
  meta: {
    name: "rename",
    description: "Rename a theme slug (cascades to all FK referrers).",
  },
  args: {
    oldSlug: { type: "positional", required: true, description: "Current slug" },
    newSlug: { type: "positional", required: true, description: "New slug" },
    title: { type: "string" },
    description: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    guardAction("RENAME_THEME");
    const r = await renameTheme(
      args.oldSlug,
      args.newSlug,
      { title: args.title, description: args.description },
      getDb(),
    );
    recordMutation("RENAME_THEME");
    emit({ ok: true, ...r }, RenameOutput, `renamed ${r.oldId} → ${r.newId}`);
  },
});

export const themeCommand = defineCommand({
  meta: { name: "theme", description: "Themes — cross-Problem groupings of Solutions." },
  subCommands: {
    add: addCmd,
    list: listCmd,
    show: showCmd,
    attach: attachCmd,
    rename: renameCmd,
  },
});
