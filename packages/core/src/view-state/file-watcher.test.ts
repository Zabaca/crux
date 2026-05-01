import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchViewStateFile } from "./file-watcher.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "crux-watcher-"));
  file = join(dir, "view-state.json");
  writeFileSync(file, JSON.stringify({ hello: 0 }), "utf8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("file watcher", () => {
  test("fires on mutation", async () => {
    let count = 0;
    const h = watchViewStateFile(file, () => count++);
    await sleep(100); // let chokidar settle
    writeFileSync(file, JSON.stringify({ hello: 1 }), "utf8");
    await sleep(400);
    expect(count).toBeGreaterThanOrEqual(1);
    await h.stop();
  });

  test("debounces rapid mutations to a single callback", async () => {
    let count = 0;
    const h = watchViewStateFile(file, () => count++);
    await sleep(100);
    for (let i = 0; i < 5; i++) {
      writeFileSync(file, JSON.stringify({ hello: i }), "utf8");
    }
    await sleep(500);
    expect(count).toBe(1);
    await h.stop();
  });

  test("mutations separated by debounce window fire twice", async () => {
    let count = 0;
    const h = watchViewStateFile(file, () => count++);
    await sleep(100);
    writeFileSync(file, JSON.stringify({ hello: 1 }), "utf8");
    await sleep(500);
    writeFileSync(file, JSON.stringify({ hello: 2 }), "utf8");
    await sleep(500);
    expect(count).toBe(2);
    await h.stop();
  });

  test("atomic tmp+rename write fires onChange (regression: dir-watch survives rename)", async () => {
    let count = 0;
    const h = watchViewStateFile(file, () => count++);
    await sleep(100);

    // Simulate atomicWrite: write tmp, rename over target.
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify({ hello: "renamed" }), "utf8");
    renameSync(tmp, file);

    await sleep(500);
    expect(count).toBeGreaterThanOrEqual(1);
    await h.stop();
  });

  test("two atomic rename writes in sequence fire twice", async () => {
    let count = 0;
    const h = watchViewStateFile(file, () => count++);
    await sleep(100);

    const writeAtomic = (payload: unknown) => {
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random()}`;
      writeFileSync(tmp, JSON.stringify(payload), "utf8");
      renameSync(tmp, file);
    };

    writeAtomic({ n: 1 });
    await sleep(500);
    writeAtomic({ n: 2 });
    await sleep(500);

    expect(count).toBe(2);
    await h.stop();
  });

  test("stopped watcher does not fire", async () => {
    let count = 0;
    const h = watchViewStateFile(file, () => count++);
    await sleep(100);
    await h.stop();
    writeFileSync(file, JSON.stringify({ hello: "after-stop" }), "utf8");
    await sleep(400);
    expect(count).toBe(0);
  });
});
