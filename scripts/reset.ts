#!/usr/bin/env bun
/**
 * Drop the local libSQL db, re-run migrations, re-seed.
 */
import { existsSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

const dbFile = ".crux.db";
for (const suffix of ["", "-journal", "-shm", "-wal"]) {
  const p = dbFile + suffix;
  if (existsSync(p)) unlinkSync(p);
}
console.log("removed local db file(s)");

function run(cmd: string, args: string[]) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

run("bun", ["run", "migrate"]);
run("bun", ["run", "seed"]);
