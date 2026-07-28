/**
 * The Worker's module graph is fs-free.
 *
 * `wrangler deploy --dry-run` is the real check, but it is slow and lives
 * outside the test suite. This walks the same graph — every module reachable
 * from the cloud entry point through workspace source — and fails the moment a
 * filesystem or file-watching import becomes reachable again. The deny-list is
 * the wrangler warnings we set out to kill, not a re-derivation of the imports.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../../..");
const entry = join(repoRoot, "apps/cloud/src/index.ts");

/** Imports that drag Node built-ins into a Worker bundle. */
const FORBIDDEN = [
  "node:fs",
  "node:fs/promises",
  "node:os",
  "node:stream",
  "node:events",
  "node:path",
  "chokidar",
];

/** `@crux/core/<subpath>` → source file, read from the package's own exports map. */
function coreExports(): Record<string, string> {
  const pkgDir = join(repoRoot, "packages/core");
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
    name: string;
    exports: Record<string, string>;
  };
  const map: Record<string, string> = {};
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    const specifier = subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
    map[specifier] = resolve(pkgDir, target);
  }
  return map;
}

/** Every `from "..."` / `import("...")` specifier in a source file. */
function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']\s*\)?/g)) {
    found.push(m[1] as string);
  }
  return found;
}

/** Walk workspace source from `entry`, collecting every external specifier seen. */
function externalImports(entryFile: string): Map<string, string[]> {
  const exportsMap = coreExports();
  const seen = new Set<string>();
  const external = new Map<string, string[]>();
  const queue: string[] = [entryFile];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);

    for (const spec of specifiersOf(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) {
        const resolved = resolve(dirname(file), spec).replace(/\.js$/, ".ts");
        queue.push(resolved);
        continue;
      }
      const mapped = exportsMap[spec];
      if (mapped) {
        queue.push(mapped);
        continue;
      }
      external.set(spec, [...(external.get(spec) ?? []), file]);
    }
  }
  return external;
}

describe("the Worker's module graph", () => {
  test("reaches no filesystem or file-watching import", () => {
    const external = externalImports(entry);
    const offenders = FORBIDDEN.flatMap((spec) =>
      (external.get(spec) ?? []).map((file) => `${spec} <- ${file.slice(repoRoot.length + 1)}`),
    );
    expect(offenders).toEqual([]);
  });
});
