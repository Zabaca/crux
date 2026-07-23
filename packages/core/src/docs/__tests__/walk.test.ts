import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { walkDocs } from "../walk.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

/** Materialize a fixture repo from a { repoRelativePath: contents } map. */
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

function childPaths(root: string) {
  return walkDocs(root).tree.children.map((c) => c.path);
}

describe("walkDocs — reachability", () => {
  test("walks a markdown link from README into the doc tree", () => {
    const root = fixture({
      "README.md": "# Root\n\nSee the [guide](docs/guide.md).\n",
      "docs/guide.md": "# Guide\n",
    });

    const result = walkDocs(root);

    expect(result.tree.path).toBe("README.md");
    expect(childPaths(root)).toEqual(["docs/guide.md"]);
    expect(result.reachable).toEqual(["README.md", "docs/guide.md"]);
    expect(result.rot.brokenLinks).toEqual([]);
    expect(result.rot.orphans).toEqual([]);
  });
});

describe("walkDocs — broken links", () => {
  test("reports a missing markdown target with its source and target", () => {
    const root = fixture({ "README.md": "See the [guide](docs/guide.md).\n" });

    expect(walkDocs(root).rot.brokenLinks).toEqual([
      { from: "README.md", raw: "docs/guide.md", target: "docs/guide.md" },
    ]);
  });

  test("reports a missing code path, and checks live code paths without walking them", () => {
    const root = fixture({
      "README.md": "Live [code](src/live.ts), dead [code](src/dead.ts).\n",
      "src/live.ts": "export {};\n",
    });

    const result = walkDocs(root);

    expect(result.rot.brokenLinks).toEqual([
      { from: "README.md", raw: "src/dead.ts", target: "src/dead.ts" },
    ]);
    expect(result.reachable).toEqual(["README.md"]);
  });

  test("skips external URLs and bare fragments entirely", () => {
    const root = fixture({
      "README.md":
        "[site](https://bun.sh) [mail](mailto:a@b.com) [anchor](#why) [proto](//cdn.example.com/x.md)\n",
    });

    expect(walkDocs(root).rot.brokenLinks).toEqual([]);
  });

  test("ignores links inside fenced code blocks and code spans", () => {
    const root = fixture({
      "README.md": "```sh\n[nope](docs/nope.md)\n```\n\nand `[also](docs/nope.md)` inline.\n",
    });

    expect(walkDocs(root).rot.brokenLinks).toEqual([]);
  });
});

describe("walkDocs — @imports", () => {
  test("walks an @import that targets markdown", () => {
    const root = fixture({
      "README.md": "Shared rules:\n\n@docs/rules.md\n",
      "docs/rules.md": "# Rules\n",
    });

    const result = walkDocs(root);

    expect(result.reachable).toEqual(["README.md", "docs/rules.md"]);
    expect(result.tree.links[0]).toMatchObject({ via: "import", target: "docs/rules.md" });
  });

  test("existence-checks a non-markdown @import without walking it", () => {
    const root = fixture({ "README.md": "@config/gone.json\n" });

    const result = walkDocs(root);

    expect(result.rot.brokenLinks).toEqual([
      { from: "README.md", raw: "config/gone.json", target: "config/gone.json" },
    ]);
    expect(result.reachable).toEqual(["README.md"]);
  });

  test("does not mistake an email address for an @import", () => {
    const root = fixture({ "README.md": "Mail you@example.com/nope.md about it.\n" });

    expect(walkDocs(root).rot.brokenLinks).toEqual([]);
  });
});

describe("walkDocs — orphans", () => {
  test("reports unreachable docs under docs/ and an unreachable CONTEXT.md", () => {
    const root = fixture({
      "README.md": "See the [guide](docs/guide.md).\n",
      "docs/guide.md": "# Guide\n",
      "docs/adr/0001-thing.md": "# Thing\n",
      "CONTEXT.md": "# Glossary\n",
    });

    expect(walkDocs(root).rot.orphans).toEqual(["CONTEXT.md", "docs/adr/0001-thing.md"]);
  });

  test("agent machinery is neither walked nor an orphan candidate", () => {
    const root = fixture({
      "README.md": "Onboarding: [dev-start](.claude/skills/dev-start/SKILL.md).\n",
      ".claude/skills/dev-start/SKILL.md": "# Dev start\n\n[deeper](nope.md)\n",
      "skills/crux/SKILL.md": "# Crux skill\n",
      ".fredrin/FREDRIN.md": "# Fredrin\n",
    });

    const result = walkDocs(root);

    expect(result.reachable).toEqual(["README.md"]);
    expect(result.rot.orphans).toEqual([]);
    expect(result.rot.brokenLinks).toEqual([]);
  });
});

describe("walkDocs — cycles", () => {
  test("terminates when two docs link each other", () => {
    const root = fixture({
      "README.md": "[a](docs/a.md)\n",
      "docs/a.md": "[b](b.md)\n",
      "docs/b.md": "[a](a.md) and back to [readme](../README.md)\n",
    });

    const result = walkDocs(root);

    expect(result.reachable).toEqual(["README.md", "docs/a.md", "docs/b.md"]);
    expect(result.rot).toEqual({ brokenLinks: [], orphans: [] });
  });
});
