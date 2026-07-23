import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { formatRot } from "../check.js";

const REPO_ROOT = resolve(import.meta.dir, "../../../../..");
const SCRIPT = join(REPO_ROOT, "scripts/docs-check.ts");

const roots: string[] = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "crux-docs-"));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return root;
}

async function runCheck(root: string) {
  const proc = Bun.spawn(["bun", "run", SCRIPT, root], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, out: stdout + stderr };
}

describe("docs:check", () => {
  test("exits 0 on a clean doc tree", async () => {
    const root = fixture({
      "README.md": "See the [guide](docs/guide.md).\n",
      "docs/guide.md": "# Guide\n",
    });

    const { exitCode, out } = await runCheck(root);

    expect(exitCode).toBe(0);
    expect(out).toContain("no rot");
  });

  test("exits 1 and names the rot", async () => {
    const root = fixture({
      "README.md": "See the [guide](docs/guide.md).\n",
      "docs/orphan.md": "# Orphan\n",
    });

    const { exitCode, out } = await runCheck(root);

    expect(exitCode).toBe(1);
    expect(out).toContain("README.md → docs/guide.md");
    expect(out).toContain("docs/orphan.md");
  });
});

describe("formatRot", () => {
  test("reports every broken link and orphan by path", () => {
    const text = formatRot({
      brokenLinks: [{ from: "README.md", raw: "./gone.md", target: "gone.md" }],
      orphans: ["docs/lost.md"],
    });

    expect(text).toContain("README.md → gone.md");
    expect(text).toContain("docs/lost.md");
  });

  test("says so when there is no rot", () => {
    expect(formatRot({ brokenLinks: [], orphans: [] })).toContain("no rot");
  });
});
