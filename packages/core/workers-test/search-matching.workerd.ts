import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { applyD1Schema } from "../src/db/d1/index.js";

// Seam: D1 itself. `SEARCH` matches with `LIKE` rather than FTS5, and the whole
// case for that choice is three facts about this database engine — facts a
// comment can only assert. They are pinned here so the decision stays
// re-checkable: if a future D1 changes any of them, the argument the read is
// built on changes with it, and this suite is where that surfaces.

beforeEach(async () => {
  await reset();
  await applyD1Schema(env.DB);
});

describe("why SEARCH matches with LIKE and not FTS5", () => {
  test("FTS5 is available — so the choice is a choice, not a limitation", async () => {
    await env.DB.batch([
      env.DB.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS probe_fts USING fts5(content)`),
    ]);
    await env.DB.prepare(`INSERT INTO probe_fts (content) VALUES ('the quick brown fox')`).run();
    const hit = await env.DB.prepare(`SELECT content FROM probe_fts WHERE probe_fts MATCH ?`)
      .bind("brown")
      .all();
    expect(hit.results).toHaveLength(1);
  });

  test("but MATCH is word-aware where near-duplicate hunting needs a substring", async () => {
    await env.DB.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS probe_fts USING fts5(content)`).run();
    await env.DB.prepare(
      `INSERT INTO probe_fts (content) VALUES ('reauthentication keeps failing')`,
    ).run();
    const match = await env.DB.prepare(`SELECT content FROM probe_fts WHERE probe_fts MATCH ?`)
      .bind("auth")
      .all();
    const like = await env.DB.prepare(`SELECT content FROM probe_fts WHERE content LIKE ?`)
      .bind("%auth%")
      .all();
    expect(match.results).toHaveLength(0);
    expect(like.results).toHaveLength(1);
  });

  test("and raw user text is not a legal MATCH query, where LIKE takes it as-is", async () => {
    await env.DB.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS probe_fts USING fts5(content)`).run();
    const typed = `sign-in "flow`;
    await expect(
      env.DB.prepare(`SELECT content FROM probe_fts WHERE probe_fts MATCH ?`).bind(typed).all(),
    ).rejects.toThrow(/unterminated string/i);
    await expect(
      env.DB.prepare(`SELECT content FROM probe_fts WHERE content LIKE ?`).bind(`%${typed}%`).all(),
    ).resolves.toBeTruthy();
  });
});
