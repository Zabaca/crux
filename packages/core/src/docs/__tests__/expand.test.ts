import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { expandDoc } from "../expand.js";

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

describe("expandDoc", () => {
  test("returns one segment for a doc with no imports", () => {
    const root = fixture({ "README.md": "# Root\n" });

    expect(expandDoc(root, "README.md")).toEqual([
      { path: "README.md", source: "# Root\n", importedFrom: null },
    ]);
  });

  test("splits an @import into its own segment carrying the imported file", () => {
    const root = fixture({
      "README.md": "before\n\n@docs/rules.md\n\nafter\n",
      "docs/rules.md": "# Rules\n",
    });

    expect(expandDoc(root, "README.md")).toEqual([
      { path: "README.md", source: "before\n\n", importedFrom: null },
      { path: "docs/rules.md", source: "# Rules\n", importedFrom: "README.md" },
      { path: "README.md", source: "\n\nafter\n", importedFrom: null },
    ]);
  });

  test("expands nested imports and stops at a cycle", () => {
    const root = fixture({
      "README.md": "@docs/a.md\n",
      "docs/a.md": "a-before\n\n@b.md\n\na-after\n",
      "docs/b.md": "b\n\n@a.md\n",
    });

    expect(expandDoc(root, "README.md").map((s) => s.path)).toEqual([
      "docs/a.md",
      "docs/b.md",
      "docs/a.md",
    ]);
  });

  test("leaves a non-markdown or missing @import in place as literal text", () => {
    const root = fixture({ "README.md": "@config/app.json and @docs/gone.md\n" });

    expect(expandDoc(root, "README.md")).toEqual([
      { path: "README.md", source: "@config/app.json and @docs/gone.md\n", importedFrom: null },
    ]);
  });
});
